// Tasks
// =====
// The chat's pending list ("pendências"): what Unii needs of the user (an
// approval, a product decision, a hand step) or keeps for itself, shown
// apart from the chat (the web's Mesa, the Conversa keeping only its
// count in the header; the terminal's footer and /p) where
// the user resolves each: done (with one of its choices, if any, and a
// comment), dropped, or opened again. Only the master's tools add and
// edit them (Tools.ts task_add, task_edit, tasks); subagents ask in
// their reports. Kept with the chat in tasks.json, apart from view.json
// (Memory.ts), written whole as it is; closed ones past KEEP or AGE go
// to tasks-arquivo.jsonl, only appended, never read in a turn.
// Each turn's message carries the list (Tasks.block, after "Agents at
// work now", out of the cached prefix): the open ones, then what the user
// changed since the last turn, marked told once a call that showed it
// ends well (Tasks.told), so a failed call shows it again. A user's
// resolution is a note in the chat; with go, a "[Pendências]" message
// that starts a turn, as a report does (Server.ts).
// Every text is stripped of control characters as it comes: titles and
// details reach the terminal (ANSI) and the web (escaped there). What
// tasks.json holds is read item by item (task_read): a hand edit, or a
// file of another version, can't break a turn or a view; an item with
// no id "P<n>" is left out, said in the server's log, the file kept
// whole as tasks.json.bad.
// Each change by the user stamps the task with the list's next version
// (rev, only ever up), so a block's shown changes are told by version,
// never by clock: two in one millisecond stay apart. Unii's own edits
// keep the stamp and whether it was told, unless it changes the state of
// one already told; the user's change untold is kept as made (heard), so
// Unii changing the state meanwhile can't hide it. Ids go to 15 digits
// (MAXID), past which none is made.
// A task may wait for others (after: their ids, TaskDeps.ts): blocked
// while any is open, it's out of the user's list (a count of those
// waiting shows instead) and can't be resolved; the open ones that free
// others come first, by how many. Freed (its last open one closed), it's
// a change Unii is told of, as a user's is (freed, a version stamped);
// waiting again (one reopened) before it was told, that change is moot.
// An after list is checked as given (ids that exist, not itself, no
// cycle) and as read from tasks.json (what's wrong left out, said in the
// log), so a hand edit can't make a list that loops.
// A task may ask several things at once (fields: a choice, many, a text,
// yes or no, each required or not). The user answers each apart, kept
// as a draft (no turn, no change told) till they conclude: then every
// answer goes at once (answers), the required ones first all given.
// The user may also talk about a task without resolving it: a message
// in its thread is a message of the chat (one memory: marked with the
// task, Tasks.task_mark), that starts a turn with the task in focus;
// the task then waits for Unii ("aguardando o Unii") till it replies in
// the thread (task_reply) or the turn ends (its last reply goes there,
// tasks_talked): then, if it's a task of the user's (or one of Unii's
// waiting for them), it's the user's turn ("sua vez"); one of Unii's,
// Unii's reply is news to read, no step of the user's ("Unii
// respondeu": TaskDeps.user_move).

// The evidence round (Evidence.ts): no task is closed without a
// concrete, documented solution. Unii closes one (task_edit, done or
// dropped) only with evidence, checked (a message sent on Slack, a PR
// merged as GitHub says, a commit and its tests, a Terraform Cloud run,
// a file that exists; a reason only to drop); the user's resolution is
// its own evidence (user), kept with it. A choice that's an order to
// Unii (acts: unii) doesn't close the task: it becomes Unii's, an order
// received (order), open till Unii closes it with evidence of the
// execution (Unii can't drop it; the user may cancel it). Each task
// says when it's done (done_when, given as it's made by Unii's tools);
// one of Unii's has its next step and when it's due (next_step,
// next_due; TaskDeps.due_at), and a status: open, waiting for the user,
// blocked (why, and what unblocks it). One closed before this round
// with no evidence is said "sem evidência" (task_unproven): it may get
// evidence (task_edit evidence) or be opened again; nothing is erased.

import * as fs from "node:fs";
import { Disk } from "./Disk.ts";
import * as Deps from "./TaskDeps.ts";
import * as Ev from "./Evidence.ts";
import type { Evidence } from "./Evidence.ts";
export type { Evidence } from "./Evidence.ts";

// Types
// =====

export type State = "open" | "done" | "dropped";
export type Who   = "user" | "unii";

// who is responsible for a task: one of ASSIGNEES ("user", "unii"; a
// string, so others may come); where it came from: one of ORIGINS
// ("chat": the user's message; "timer": a schedule's turn; "agent:<name>":
// a subagent's report; "slack", "github" for later), with a link to its
// source if any
export type Assignee = string;
export type Origin   = string;

// a pending item (rev: the list's version at the last change by the
// user, Store.rev): id ("P7"), title, detail (Markdown), state, who must
// act (assignee; tasks.json and the tools' `who` of older versions read
// as it), where it came from (origin, null: not known) and its source's
// link, who made it ("main", "user"), the answers offered, the one chosen,
// the comment it was closed with, a free link (a project, an agent, a
// PR), when made, last changed and closed (ISO), whether Unii saw its
// last change by the user; the ids it waits for (TaskDeps.ts), and
// whether that last change untold is its being freed; the user's
// change untold as made (Heard); its fields, the user's answers to them
// so far (draft) and as concluded (answers); its thread, and whose turn
// it is in it (unii: the user wrote, Unii hasn't replied; user: Unii
// replied; null: neither)
export type Task = {
  id      : string;
  title   : string;
  detail  : string;
  state   : State;
  assignee   : Assignee;
  origin     : Origin | null;
  origin_url : string | null;
  agent      : string | null; // the agent at work on it, by name (a task of Unii's: who follows it up now)
  by      : string;
  choices : string[];
  recommend? : string | null; // the choice Unii recommends (one of choices; null or none: none)
  answer  : string | null;
  note    : string | null;
  ref     : string | null;
  made    : string;
  changed : string;
  moved   : string; // its last change but linking an agent alone (how long it stalled: View.task_stalled_said, vigia.ts)
  kind    : Deps.TaskKind | null; // what it is, as how long before it's late says (TaskDeps.late_after; null: as its links say)
  priority: Deps.Priority; // declared; sorts "Agora" first (TaskDeps.now_order)
  prs     : PrCheck[]; // the pull requests it's about, each as verified (R5: a PR's approval needs one)
  acts    : Record<string, Act>; // by choice, who acts once it's picked: the user did it (a report), or Unii must (an order, told at once)
  waits_for : string | null; // what outside the list it waits for ("CI do #42", "merge no GitHub"), beside after
  ready   : string; // since when it's the user's to act on (made, freed, opened again, handed to them): its lateness counts from then
  closed  : string | null;
  closed_by : "user" | "unii" | null; // who closed it last (done or dropped): the user (Mesa, terminal: task_resolve) or Unii (task_edit); null: open, or closed before it was kept. Only the user's lets a restart (Restart.check)
  told    : boolean;
  rev     : number;
  after   : string[];
  freed   : boolean;
  heard   : Heard | null;
  fields  : Field[];
  draft   : Values;
  answers : Values | null;
  thread  : Talk[];
  talk    : Who | null;
  done_when : string | null; // what makes it done, said as it's made (null: made before the evidence round, or from outside)
  evidence  : Evidence[]; // what closed it (Evidence.ts): checked as given; none on an open one
  status    : Deps.Status; // an open one's: open, waiting_user (Unii's, waiting for something of the user's), blocked
  status_why: string | null; // what it waits for of the user, or why it's blocked
  unblock   : string | null; // what unblocks it (blocked)
  order     : Order | null; // the user's order (a choice of acts unii), received and not yet executed with evidence
  next_step : string | null; // Unii's next step on it
  next_due  : string | null; // when that step is due (ISO; null: STALL after it last moved, TaskDeps.due_at)
  due?      : string | null; // as views get it (tasks_view): when its next step is due, by the server's setting
};

// the user's order: the choice picked (acts: unii), the comment, when
export type Order = { answer: string | null; note: string | null; at: string };

// a pull request as verified (R5, the task's contract): its link (a
// GitHub pull), the head verified (7 to 40 hex), the verdict, the
// verifier, the notes by severity and what wasn't tested
export type Sev     = "high" | "medium" | "low";
export type Verdict = "approved" | "approved_with_notes" | "rejected" | "pending";
export type Note    = { sev: Sev; text: string };
export type PrCheck = { url: string; head: string; verdict: Verdict; verifier: string | null; notes: Note[]; untested: string[] };

// who acts once a choice is picked: the user (it reports what they did)
// or Unii (it's an order: Unii is told at once, Server.ts)
export type Act = "user" | "unii";

// the user's last change as they made it, kept till Unii is told of it:
// Unii changing the state meanwhile (task_edit) doesn't hide it
export type Heard = { state: State; answer: string | null; note: string | null; answers?: Values | null; order?: boolean };

// a question of a task: its id (letters, digits, - and _), its label,
// its kind (one choice, many, a text, yes or no), its choices (yes or
// no: sim, não), whether it must be answered to conclude, and the answer
// Unii recommends, if any ("Aceitar as recomendadas" takes it)
export type Kind  = "choice" | "multi" | "text" | "yesno";
export type Field = { id: string; label: string; kind: Kind; choices: string[]; required: boolean; recommend?: Value };

// answers by field id: a choice or a text, or the choices picked
export type Value  = string | string[];
export type Values = Record<string, Value>;

// a message of a task's thread: whose, its text, when; none: Unii's
// that says it gave no reply (the turn ended without one: failed,
// halted, the server restarted), so the views say "Unii não respondeu"
// and Unii's next turn is told the user still waits for a reply
export type Talk = { who: Who; text: string; at: string; none?: true };

// the list of a chat's dir: the next id's number, the last version
// stamped (only up), the tasks; shown: the changes the last block
// showed, by id, at each one's rev
// refs: the list's fronts, the refs a task of Unii's may be given (R5:
// one not among them refused, unless it starts a new one, ref_new)
export type Store = { dir: string; next: number; rev: number; tasks: Task[]; shown: Map<string, number>; refs: string[] };

// a change asked: by Unii (task_add, task_edit) or the user (an act)
export type Edit = {
  title?   : unknown;
  detail?  : unknown;
  who?     : unknown;
  assignee?   : unknown;
  origin?     : unknown;
  origin_url? : unknown;
  agent?      : unknown;
  choices? : unknown;
  recommend? : unknown;
  kind?    : unknown;
  priority? : unknown;
  ref?     : unknown;
  ref_new? : unknown;
  prs?     : unknown;
  acts?    : unknown;
  waits_for? : unknown;
  state?   : unknown;
  answer?  : unknown;
  note?    : unknown;
  after?   : unknown;
  fields?  : unknown;
  done_when? : unknown;
  evidence?  : unknown;
  status?    : unknown;
  status_why?: unknown;
  unblock?   : unknown;
  next_step? : unknown;
  next_due?  : unknown;
};

// Constants
// =========

// the longest title, detail, comment, choice, ref; the most choices
export const TITLE   = 200;
export const DETAIL  = 2000;
export const NOTE    = 1000;
export const CHOICE  = 80;
export const CHOICES = 9;
export const REF     = 100;

// the evidence round: the longest done_when, next step, status's why
// and what unblocks it; the most a next_due may be ahead
export const DONE_WHEN = 300;
export const NEXT_STEP = 300;
export const WHY       = 300;
export const DUE_MOST  = 30 * 24 * 3600e3;

// those a task may be assigned to; its origins, an agent's by name; the
// longest origin and source link
export const ASSIGNEES = ["user", "unii"];
const ORIGIN = /^(chat|timer|slack|github|agent:[A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/;
export const ORIGIN_URL = 500;

// an agent's name, as a task links it (agent): its technical name
// (WiseDolphin) or its label (uniichat-ux-impl)
const AGENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

// a task's pull requests (R5): the most, a note's and an untested
// item's length, the most of each; what it waits for outside, its
// length; the most fronts (refs) kept
export const PRS       = 8;
export const NOTES     = 20;
export const NOTE_TEXT = 300;
export const UNTESTED  = 20;
export const WAITS_FOR = 200;
export const REFS      = 200;
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const HEAD   = /^[0-9a-f]{7,40}$/;
const SEVS: Record<string, Sev> = { high: "high", alta: "high", medium: "medium", "média": "medium", media: "medium", low: "low", baixa: "low" };
const VERDICTS: Record<string, Verdict> = {
  approved: "approved", aprovado: "approved", approved_with_notes: "approved_with_notes", "aprovado com ressalvas": "approved_with_notes",
  rejected: "rejected", reprovado: "rejected", pending: "pending", pendente: "pending",
};
export const ACTS: Act[] = ["user", "unii"];

// the most fields of a task, a label's length, a text answer's (NOTE);
// a thread message's length, the most a thread keeps, the most views get
export const FIELDS  = 12;
export const LABEL   = 200;
export const TALK    = 4000;
export const THREAD  = 40;
export const VIEW_TALK = 12;

// a field's id; its kinds, by the names they're given in (Portuguese too)
const FIELD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/;
const KINDS: Record<string, Kind> = {
  choice: "choice", one: "choice", escolha: "choice", radio: "choice",
  multi: "multi", many: "multi", multiple: "multi", "múltipla": "multi", multipla: "multi", checkbox: "multi",
  text: "text", texto: "text",
  yesno: "yesno", "yes/no": "yesno", bool: "yesno", boolean: "yesno", simnao: "yesno", "sim/não": "yesno", "simnão": "yesno",
};
export const YESNO = ["sim", "não"];

// the most open at once; closed ones kept past KEEP, or older than AGE,
// go to the archive (unless Unii hasn't seen them)
export const OPEN = 100;
export const KEEP = 200;
const DAY         = 86400000;
export const AGE  = 30 * DAY;

// a turn's block lists at most LINES open; views get the open ones and
// those closed in RECENT, at most VIEW of those
export const LINES  = 30;
export const RECENT = 7 * DAY;
export const VIEW   = 50;

// an id as tasks.json holds it, "P<n>", n up to MAXID (15 digits: a
// safe integer, so an id made is always one read back)
const ID         = /^P([1-9]\d{0,14})$/;
export const MAXID = 999999999999999;

const FILE    = "/tasks.json";
const ARCHIVE = "/tasks-arquivo.jsonl";

// the lists open, by dir (one per chat; tests open many)
const STORES = new Map<string, Store>();

const STATES: State[] = ["open", "done", "dropped"];

// how a resolution reads, in the chat (the user's language: notes show
// in both views)
const SAID: Record<State, string> = { open: "reaberta", done: "concluída", dropped: "descartada" };

// Texts
// =====

// a line: control characters (ESC included) and runs of spaces as one
// space, trimmed, cut at n
export function text_line(x: unknown, n: number): string {
  return String(x ?? "").replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}

// a text of lines: control characters gone but newlines (tabs as
// spaces), cut at n
export function text_body(x: unknown, n: number): string {
  return String(x ?? "").replace(/\r\n?|[\u2028\u2029]/g, "\n").replace(/\t/g, "  ").replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "").trim().slice(0, n);
}

// "P7", "p7", "7": "P7"
export function task_id(x: unknown): string {
  const m = /^\s*[Pp]?(\d+)\s*$/.exec(String(x ?? ""));
  return m === null ? String(x ?? "").trim() : "P" + Number(m[1]);
}

// Store
// =====

// a time as read: an ISO date, else `or`
function time_read(x: unknown, or: string): string {
  return typeof x === "string" && !Number.isNaN(Date.parse(x)) ? new Date(Date.parse(x)).toISOString() : or;
}

// a whole number >= 0 as read, else 0
function count_read(x: unknown): number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : 0;
}

// an item of tasks.json as a task: each field checked, its texts cleaned
// and cut as if given now, what's missing or wrong filled in; null: none
// can be made (no id "P<n>")
export function task_read(x: unknown, now: number): Task | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return null;
  }
  const o = x as Record<string, unknown>;
  const m = ID.exec(typeof o.id === "string" ? o.id.trim() : "");
  if (m === null) {
    return null;
  }
  const state = STATES.includes(o.state as State) ? (o.state as State) : "open";
  const choices = Array.isArray(o.choices) ? [...new Set(o.choices.filter((c) => typeof c === "string").map((c) => text_line(c, CHOICE)).filter((c) => c !== ""))].slice(0, CHOICES) : [];
  const answer = typeof o.answer === "string" ? text_line(o.answer, CHOICE) : "";
  const text = (y: unknown, n: number, f: (y: unknown, n: number) => string) => (typeof y === "string" ? f(y, n) : "");
  const note = text(o.note, NOTE, text_body);
  const ref = text(o.ref, REF, text_line);
  const fields = fields_read(o.fields).fields;
  const at = new Date(now).toISOString();
  const made = time_read(o.made, at);
  const changed = time_read(o.changed, made);
  const acts = acts_clean(o.acts, choices);
  const order = order_read(o.order, choices);
  const status = state === "open" && Deps.STATUSES.includes(o.status as Deps.Status) ? (o.status as Deps.Status) : "open";
  const why = text(o.status_why, WHY, text_line);
  const unblock = text(o.unblock, WHY, text_line);
  const closed_by = state !== "open" && (o.closed_by === "user" || o.closed_by === "unii") ? o.closed_by : null;
  return {
    id      : "P" + Number(m[1]),
    title   : text(o.title, TITLE, text_line) || "(sem título)",
    detail  : text(o.detail, DETAIL, text_body),
    state,
    assignee   : assignee_read(o.assignee) ?? assignee_read(o.who) ?? "user",
    origin     : origin_read(o.origin),
    origin_url : origin_read(o.origin) === null ? null : url_read(o.origin_url),
    agent      : agent_read(o.agent),
    by      : text(o.by, 40, text_line) || "main",
    choices,
    recommend : typeof o.recommend === "string" && choices.includes(o.recommend) ? o.recommend : null,
    answer  : (state === "done" || order !== null) && choices.includes(answer) ? answer : null,
    note    : note === "" ? null : note,
    ref     : ref === "" ? null : ref,
    made,
    changed,
    moved   : time_read(o.moved, changed),
    kind    : Deps.KINDS.includes(o.kind as Deps.TaskKind) ? (o.kind as Deps.TaskKind) : null,
    priority: Deps.PRIORITIES.includes(o.priority as Deps.Priority) ? (o.priority as Deps.Priority) : "normal",
    prs     : prs_read(o.prs).prs,
    acts,
    waits_for : text(o.waits_for, WAITS_FOR, text_line) || null,
    ready   : time_read(o.ready, made),
    closed  : state === "open" ? null : time_read(o.closed, changed),
    closed_by,
    told    : o.told !== false,
    rev     : count_read(o.rev),
    after   : after_raw(o.after, "P" + Number(m[1])),
    freed   : o.freed === true && o.told === false,
    heard   : o.told === false ? heard_read(o.heard, fields) : null,
    fields,
    draft   : values_clean(fields, o.draft),
    answers : state === "done" && fields.length > 0 && typeof o.answers === "object" && o.answers !== null ? values_clean(fields, o.answers) : null,
    thread  : thread_read(o.thread),
    talk    : state === "open" && (o.talk === "unii" || o.talk === "user") ? o.talk : null,
    done_when : text(o.done_when, DONE_WHEN, text_line) || null,
    evidence  : state === "open" ? [] : evidence_migrated(Ev.evidence_clean(o.evidence), { state, closed_by, acts, answer: choices.includes(answer) ? answer : null, note: note === "" ? null : note, closed: time_read(o.closed, changed) }),
    status,
    status_why: status === "open" || why === "" ? null : why,
    unblock   : status === "blocked" && unblock !== "" ? unblock : null,
    order,
    next_step : state === "open" ? text(o.next_step, NEXT_STEP, text_line) || null : null,
    next_due  : state === "open" && typeof o.next_due === "string" && !Number.isNaN(Date.parse(o.next_due)) ? new Date(Date.parse(o.next_due)).toISOString() : null,
  };
}

// an order as read: its answer one of the choices (else none), its note,
// when; null: none
function order_read(x: unknown, choices: string[]): Order | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return null;
  }
  const o = x as Record<string, unknown>;
  const answer = typeof o.answer === "string" && choices.includes(o.answer) ? o.answer : null;
  const note = typeof o.note === "string" ? text_body(o.note, NOTE) : "";
  return { answer, note: note === "" ? null : note, at: time_read(o.at, new Date(0).toISOString()) };
}

// a closed task's evidence as read: what it holds; none, one closed
// before the evidence round: the user's own resolution of a choice they
// said they act on (acts: user) is its evidence, so marked (migrated);
// any other (Unii's close, an order the user gave, one whose closer
// isn't known) stays without: "sem evidência" (task_unproven)
function evidence_migrated(had: Evidence[], t: { state: State; closed_by: "user" | "unii" | null; acts: Record<string, Act>; answer: string | null; note: string | null; closed: string }): Evidence[] {
  if (had.length > 0 || t.state === "open") {
    return had;
  }
  if (t.closed_by === "user" && t.answer !== null && t.acts[t.answer] === "user") {
    return [{ type: "user", at: t.closed, answer: t.answer, note: t.note, migrated: true }];
  }
  return [];
}

// whether a task is closed with no evidence ("sem evidência": closed
// before the evidence round, or by hand)
export function task_unproven(t: { state: State; evidence?: Evidence[] | null }): boolean {
  return t.state !== "open" && (t.evidence ?? []).length === 0;
}

// whether a task is an order of the user's received, not yet executed
export function task_ordered(t: { state: State; order?: Order | null }): boolean {
  return t.state === "open" && (t.order ?? null) !== null;
}

// an assignee as given (one of ASSIGNEES, any case, spaces around);
// else null
export function assignee_read(x: unknown): Assignee | null {
  const a = typeof x === "string" ? x.trim().toLowerCase() : "";
  return ASSIGNEES.includes(a) ? a : null;
}

// an origin as given ("chat", "timer", "agent:Name", ...); else null
export function origin_read(x: unknown): Origin | null {
  const o = typeof x === "string" ? x.trim() : "";
  const kind = o.split(":")[0].toLowerCase();
  const as = kind === "agent" ? "agent:" + o.slice(6) : kind;
  return ORIGIN.test(as) ? as : null;
}

// an agent's name as given (AGENT, spaces around); else null
export function agent_read(x: unknown): string | null {
  const a = typeof x === "string" ? x.trim() : "";
  return AGENT.test(a) ? a : null;
}

// a source's link as given: http(s), no spaces, quotes, angle brackets
// or control characters, at most ORIGIN_URL; else null
export function url_read(x: unknown): string | null {
  const u = typeof x === "string" ? x.trim() : "";
  if (u.length > ORIGIN_URL || !/^https?:\/\/[^\s"'<>`\\\x00-\x1f\x7f-\x9f\u2028\u2029]+$/i.test(u)) {
    return null;
  }
  try {
    return new URL(u).protocol.startsWith("http") ? u : null;
  } catch {
    return null;
  }
}

// where a turn came from, by its messages' origins (a message of the
// user's has none): the user's among them, chat; else the first's
export function turn_origin(origins: (string | undefined)[]): Origin {
  return origins.length === 0 || origins.some((o) => o === undefined) ? "chat" : origin_read(origins[0]) ?? "chat";
}

// a task's assignee, origin, link and agent as given by a tool (assignee, or the
// older who; origin_url only with an origin, its own or the task's); each
// absent undefined; else why not
function whose_args(args: Edit, origin: Origin | null): { assignee?: Assignee; origin?: Origin; origin_url?: string | null; agent?: string | null } | string {
  const out: { assignee?: Assignee; origin?: Origin; origin_url?: string | null; agent?: string | null } = {};
  const given = (x: unknown) => x !== undefined && x !== null;
  if (given(args.assignee) || given(args.who)) {
    const a = given(args.assignee) ? assignee_read(args.assignee) : null;
    const w = given(args.who) ? assignee_read(args.who) : null;
    if ((given(args.assignee) && a === null) || (given(args.who) && w === null)) {
      return "assignee is one of: " + ASSIGNEES.join(", ") + ".";
    }
    if (a !== null && w !== null && a !== w) {
      return "assignee and who differ: give assignee only (who is its older name).";
    }
    out.assignee = (a ?? w)!;
  }
  if (given(args.origin)) {
    const o = origin_read(args.origin);
    if (o === null) {
      return "origin is chat, timer, slack, github or agent:<name> (letters, digits, . _ -).";
    }
    out.origin = o;
  }
  if (args.origin_url !== undefined) {
    const raw = args.origin_url === null ? "" : String(args.origin_url).trim();
    const u = raw === "" ? null : url_read(raw);
    if (raw !== "" && u === null) {
      return "origin_url is an http(s) link of at most " + ORIGIN_URL + " characters, without spaces, quotes or angle brackets.";
    }
    if (u !== null && (out.origin ?? origin) === null) {
      return "origin_url needs an origin.";
    }
    out.origin_url = u;
  }
  if (args.agent !== undefined) {
    const raw = args.agent === null ? "" : String(args.agent).trim();
    const a = raw === "" ? null : agent_read(raw);
    if (raw !== "" && a === null) {
      return "agent is an agent's name: letters, digits, . _ - (at most 64).";
    }
    out.agent = a;
  }
  return out;
}

// a thread as read: its messages that are one (whose, a text), cleaned,
// the newest THREAD
function thread_read(x: unknown): Talk[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const all: Talk[] = [];
  for (const y of x) {
    if (typeof y !== "object" || y === null || Array.isArray(y)) {
      continue;
    }
    const o = y as Record<string, unknown>;
    const text = typeof o.text === "string" ? text_body(o.text, TALK) : "";
    if ((o.who === "user" || o.who === "unii") && text !== "") {
      all.push({ who: o.who, text, at: time_read(o.at, new Date(0).toISOString()), ...(o.who === "unii" && o.none === true ? { none: true as const } : {}) });
    }
  }
  return all.slice(-THREAD);
}
// a Heard as read; null: none, or not one
function heard_read(x: unknown, fields: Field[]): Heard | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return null;
  }
  const o = x as Record<string, unknown>;
  if (!STATES.includes(o.state as State)) {
    return null;
  }
  const answer = typeof o.answer === "string" ? text_line(o.answer, CHOICE) : "";
  const note = typeof o.note === "string" ? text_body(o.note, NOTE) : "";
  const answers = typeof o.answers === "object" && o.answers !== null ? values_clean(fields, o.answers) : null;
  return { state: o.state as State, answer: answer === "" ? null : answer, note: note === "" ? null : note, ...(answers === null ? {} : { answers }), ...(o.order === true ? { order: true } : {}) };
}

// an after list as tasks.json holds it: its ids "P<n>" (or n, as the
// tools take them; none twice, not the task's own), at most AFTER;
// anything else left out
function after_raw(x: unknown, self: string): string[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const ids = x.map((y) => (typeof y === "number" && Number.isSafeInteger(y) ? "P" + y : y)).filter((y) => typeof y === "string" && ID.test(y.trim())).map((y) => (y as string).trim());
  return [...new Set(ids)].filter((id) => id !== self).slice(0, Deps.AFTER);
}

// the after lists of tasks read, made sound: ids of no task left out, and
// those that would close a cycle (each task's in turn, in the list's
// order, kept only if it waits for no one that waits for it); how many
// lists changed, from what was read (raw: the items as read, by id)
function after_sound(tasks: Task[], raw: Map<string, unknown>): number {
  const ids = new Set(tasks.map((t) => t.id));
  const kept: Task[] = tasks.map((t) => ({ ...t, after: [] }));
  let fixed = 0;
  tasks.forEach((t, k) => {
    const after = t.after.filter((id) => ids.has(id) && !Deps.reaches(kept, [id], t.id));
    kept[k].after = after;
    t.after = after;
    const was = raw.get(t.id);
    if (JSON.stringify(was ?? []) !== JSON.stringify(after)) {
      fixed += 1;
    }
  });
  return fixed;
}

// a task read as freed (its being freed untold) that still waits (a hand
// edit) is no change to tell: it stays hidden, so its next turn would
// say "the user sees it now" falsely; how many were so
function freed_sound(tasks: Task[]): number {
  const blocked = Deps.blocked_ids(tasks);
  const wrong = tasks.filter((t) => t.freed && blocked.has(t.id));
  wrong.forEach((t) => {
    t.freed = false;
    t.told = true;
  });
  return wrong.length;
}

// the list of a chat's dir, read once (none: empty). Read whole before
// it's taken: unreadable, it's kept aside and the list is empty; items
// left out (task_read; an id twice: the first) are said in the log, the
// file kept aside as it was. The next id and version: past every one read
export function tasks_load(dir: string, now = Date.now()): Store {
  const had = STORES.get(dir);
  if (had !== undefined) {
    return had;
  }
  const s: Store = { dir, next: 1, rev: 0, tasks: [], shown: new Map(), refs: [] };
  const file = dir + FILE;
  if (fs.existsSync(file)) {
    try {
      const got = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof got !== "object" || got === null || !Array.isArray(got.tasks)) {
        throw new Error("no list of tasks");
      }
      const tasks: Task[] = [];
      const raw = new Map<string, unknown>();
      let left = 0;
      let bad = 0;
      for (const x of got.tasks) {
        const t = task_read(x, now);
        if (t === null || tasks.some((u) => u.id === t.id)) {
          left += 1;
        } else {
          tasks.push(t);
          raw.set(t.id, (x as Record<string, unknown>).after ?? []);
          const f = (x as Record<string, unknown>).fields;
          bad += f === undefined || (Array.isArray(f) && f.length === t.fields.length) ? 0 : 1;
        }
      }
      const fixed = after_sound(tasks, raw) + freed_sound(tasks) + bad;
      if (fixed > 0) {
        console.error("unii: " + file + ": " + fixed + " task(s) with an after list wrong (not a list of ids, an id of no task, the task itself, a cycle: those ids left out), freed while still waiting (made unfreed), or with fields wrong (those left out)");
      }
      if (left > 0 || fixed > 0) {
        if (left > 0) {
          console.error("unii: " + file + ": " + left + " item(s) left out (no id P<n>, or an id twice); the file as it was kept as " + file + ".bad");
        }
        fs.copyFileSync(file, file + ".bad");
      }
      const unproven = tasks.filter(task_unproven).length;
      const migrated = tasks.filter((t) => t.evidence.some((e) => e.migrated === true)).length;
      // said once: as a list of before the evidence round is first read
      if (unproven + migrated > 0 && !got.tasks.some((x: any) => x !== null && typeof x === "object" && "evidence" in x)) {
        console.error("unii: " + file + ": evidence round: " + unproven + " closed task(s) without evidence, said \"sem evidência\" (they may get evidence or be opened again); " + migrated + " with the user's own resolution as their evidence");
      }
      s.tasks = tasks;
      s.next = Math.max(1, count_read(got.next), ...tasks.map((t) => Number(t.id.slice(1)) + 1));
      s.rev = Math.max(count_read(got.rev), ...tasks.map((t) => t.rev));
      // a list of before R5 has no fronts: those its tasks of Unii's and
      // the user's name (the inbox's, a conversation each, aren't)
      s.refs = refs_clean(Array.isArray(got.refs) ? got.refs : tasks.filter((t) => t.by !== "inbox").map((t) => t.ref));
    } catch (err: any) {
      console.error("unii: " + file + " unreadable, kept as " + file + ".bad: " + (err?.message ?? err));
      fs.renameSync(file, file + ".bad");
    }
  }
  STORES.set(dir, s);
  return s;
}

// forgets the lists read (tests)
export function tasks_forget(): void {
  STORES.clear();
}

// written whole, then moved in place; flushed soon (Disk.ts)
// (each with who too, its assignee as an older version reads it: going
// back a version keeps whose each is)
export function tasks_save(s: Store): void {
  const file = s.dir + FILE;
  fs.mkdirSync(s.dir, { recursive: true });
  fs.writeFileSync(file + ".new", JSON.stringify({ next: s.next, rev: s.rev, refs: s.refs, tasks: s.tasks.map((t) => ({ ...t, who: t.assignee === "unii" ? "unii" : "user" })) }));
  fs.renameSync(file + ".new", file);
  Disk.wrote(file);
}

// the closed ones past KEEP (the newest kept) or older than AGE, seen by
// Unii, appended to the archive and dropped
export function tasks_archive(s: Store, now: number): Task[] {
  const closed = s.tasks.filter((t) => t.state !== "open" && t.told).sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? ""));
  const old = closed.filter((t, k) => k >= KEEP || now - Date.parse(t.closed ?? t.changed) > AGE);
  if (old.length === 0) {
    return [];
  }
  fs.appendFileSync(s.dir + ARCHIVE, old.map((t) => JSON.stringify(t) + "\n").join(""));
  Disk.wrote(s.dir + ARCHIVE);
  s.tasks = s.tasks.filter((t) => !old.includes(t));
  const gone = new Set(old.map((t) => t.id));
  s.tasks.forEach((t) => (t.after = t.after.filter((id) => !gone.has(id))));
  return old;
}

export function task_find(s: Store, id: unknown): Task | null {
  const key = task_id(id);
  return s.tasks.find((t) => t.id === key) ?? null;
}

// Changes
// =======

// a choices list as given: strings, each a line, none empty or twice
function choices_read(x: unknown): string[] | string {
  if (x === undefined || x === null) {
    return [];
  }
  if (!Array.isArray(x)) {
    return "choices is a list of strings.";
  }
  const all = [...new Set(x.map((c) => text_line(c, CHOICE)).filter((c) => c !== ""))];
  return all.length > CHOICES ? "At most " + CHOICES + " choices." : all;
}

// the choice recommended, as given: one of choices (null: none; ""
// clears); else why not
function recommend_read(x: unknown, choices: string[]): { v: string | null } | string {
  if (x === undefined || x === null || x === "") {
    return { v: null };
  }
  const said = typeof x === "string" || typeof x === "number" ? text_line(String(x), CHOICE) : "";
  const got = choices.find((c) => c === said) ?? choices.find((c) => c.toLowerCase() === said.toLowerCase());
  if (got === undefined) {
    return choices.length === 0 ? "recommend is one of the task's choices, and it has none." : "recommend is one of the choices: " + choices.join(" | ") + ".";
  }
  return { v: got };
}

// The task's contract (R5)
// ------------------------

// a task's pull requests as given: each {url, head, verdict?, verifier?,
// notes?: [{sev, text}], untested?: [...]} (url: a GitHub pull link;
// head: the commit verified, 7 to 40 hex; verdict: approved,
// approved_with_notes, rejected, pending, by default; sev: high, medium,
// low; Portuguese too), at most PRS, no link twice. prs: those sound;
// why: the first that isn't (null: all are). A hand edit's file keeps
// the sound ones; a tool refuses the list
export function prs_read(x: unknown): { prs: PrCheck[]; why: string | null } {
  if (x === undefined || x === null) {
    return { prs: [], why: null };
  }
  if (!Array.isArray(x)) {
    return { prs: [], why: "prs is a list of {url, head, verdict, verifier, notes, untested}." };
  }
  const prs: PrCheck[] = [];
  let why: string | null = x.length > PRS ? "At most " + PRS + " prs." : null;
  for (const [k, y] of x.slice(0, PRS).entries()) {
    const got = pr_read(y, k + 1);
    if (typeof got === "string") {
      why ??= got;
    } else if (prs.some((p) => p.url === got.url)) {
      why ??= "prs " + (k + 1) + ": " + got.url + " is given twice.";
    } else {
      prs.push(got);
    }
  }
  return { prs, why };
}

// one pull request as given (n: its place, for what's wrong); else why not
function pr_read(x: unknown, n: number): PrCheck | string {
  const at = "prs " + n + ": ";
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return at + "each is an object {url, head, verdict, verifier, notes, untested}.";
  }
  const o = x as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url.trim().replace(/\/+$/, "") : "";
  if (!PR_URL.test(url)) {
    return at + "url is the PR's GitHub link, https://github.com/<owner>/<repo>/pull/<n>" + (url === "" ? " (none given)." : ".");
  }
  const head = typeof o.head === "string" ? o.head.trim().toLowerCase() : "";
  if (!HEAD.test(head)) {
    return at + "head is the commit verified, 7 to 40 hex characters" + (head === "" ? " (none given)." : ".");
  }
  const said = o.verdict === undefined || o.verdict === null || o.verdict === "" ? "pending" : text_line(o.verdict, 40).toLowerCase();
  const verdict = VERDICTS[said];
  if (verdict === undefined) {
    return at + "verdict is approved, approved_with_notes, rejected or pending.";
  }
  const verifier = o.verifier === undefined || o.verifier === null || o.verifier === "" ? null : agent_read(o.verifier);
  if (o.verifier !== undefined && o.verifier !== null && o.verifier !== "" && verifier === null) {
    return at + "verifier is an agent's name: letters, digits, . _ - (at most 64).";
  }
  const notes: Note[] = [];
  if (o.notes !== undefined && o.notes !== null) {
    if (!Array.isArray(o.notes) || o.notes.length > NOTES) {
      return at + "notes is a list of at most " + NOTES + " {sev: high, medium or low, text}.";
    }
    for (const y of o.notes) {
      const r = typeof y === "object" && y !== null ? (y as Record<string, unknown>) : {};
      const sev = SEVS[text_line(r.sev, 10).toLowerCase()];
      const text = text_line(r.text, NOTE_TEXT);
      if (sev === undefined || text === "") {
        return at + "each note is {sev: high, medium or low, text}.";
      }
      notes.push({ sev, text });
    }
  }
  if (o.untested !== undefined && o.untested !== null && (!Array.isArray(o.untested) || o.untested.length > UNTESTED || o.untested.some((y) => typeof y !== "string"))) {
    return at + "untested is a list of at most " + UNTESTED + " texts.";
  }
  const untested = (Array.isArray(o.untested) ? o.untested : []).map((y) => text_line(y, NOTE_TEXT)).filter((y) => y !== "");
  return { url, head, verdict, verifier, notes, untested };
}

// who acts on each choice as given ({"Sim, reinicie": "unii"}): each key
// one of choices (any case), each value user or unii; else why not
function acts_read(x: unknown, choices: string[]): Record<string, Act> | string {
  if (x === undefined || x === null) {
    return {};
  }
  if (typeof x !== "object" || Array.isArray(x)) {
    return "acts is an object: by choice, who acts once it's picked, user or unii.";
  }
  const out: Record<string, Act> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const said = text_line(k, CHOICE);
    const c = choices.find((y) => y === said) ?? choices.find((y) => y.toLowerCase() === said.toLowerCase());
    if (c === undefined) {
      return choices.length === 0 ? "acts names choices, and the task has none." : "acts: " + JSON.stringify(said) + " is not a choice; one of: " + choices.join(" | ") + ".";
    }
    const a = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (!ACTS.includes(a as Act)) {
      return "acts: who acts on " + JSON.stringify(c) + " is user or unii.";
    }
    out[c] = a as Act;
  }
  return out;
}

// acts as read from tasks.json: those of its choices, each user or unii
function acts_clean(x: unknown, choices: string[]): Record<string, Act> {
  const out: Record<string, Act> = {};
  if (typeof x === "object" && x !== null && !Array.isArray(x)) {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (choices.includes(k) && ACTS.includes(v as Act)) {
        out[k] = v as Act;
      }
    }
  }
  return out;
}

// who acts once a task's answer is picked (null: none said)
export function task_act(t: { acts?: Record<string, Act> | null; answer?: string | null }, answer = t.answer ?? null): Act | null {
  return answer === null ? null : (t.acts ?? {})[answer] ?? null;
}

// a list's fronts as read: texts, a line each, none twice (in any case),
// at most REFS
function refs_clean(x: unknown[]): string[] {
  const out: string[] = [];
  for (const y of x) {
    const r = typeof y === "string" ? text_line(y, REF) : "";
    if (r !== "" && !out.some((o) => o.toLowerCase() === r.toLowerCase())) {
      out.push(r);
    }
  }
  return out.slice(-REFS);
}

// the front a ref names, as the list has it (any case); null: none
export function ref_known(s: Store, ref: string): string | null {
  return s.refs.find((r) => r.toLowerCase() === ref.toLowerCase()) ?? null;
}

// the fronts nearest a ref unknown: those that hold it, or it them, or
// a few letters apart, the nearest first, at most n
export function refs_near(s: Store, ref: string, n = 3): string[] {
  const a = ref.toLowerCase();
  const far = (r: string) => {
    const b = r.toLowerCase();
    return b.includes(a) || a.includes(b) ? 0 : edits(a, b);
  };
  return s.refs.map((r) => [r, far(r)] as const).filter(([r, d]) => d <= Math.max(2, Math.floor(r.length / 3))).sort((x, y) => x[1] - y[1]).slice(0, n).map(([r]) => r);
}

// how many letters apart two texts are (Levenshtein)
function edits(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    row = next;
  }
  return row[b.length];
}

// a front added to the list (one known: nothing), saved
export function refs_add(s: Store, ref: string): void {
  const r = text_line(ref, REF);
  if (r !== "" && ref_known(s, r) === null) {
    s.refs = refs_clean([...s.refs, r]);
    tasks_save(s);
  }
}

// a task's ref as Unii gives it (task_add, task_edit; R5): one of the
// list's fronts, as the list writes it; ref_new: a new front, added once
// the task is kept. "" or none: no ref. Else why not, with the nearest
export function ref_args(s: Store, args: Edit): { ref?: string | null; added?: string } | string {
  if (args.ref === undefined) {
    return {};
  }
  const ref = text_line(args.ref, REF);
  if (ref === "") {
    return { ref: null };
  }
  const known = ref_known(s, ref);
  if (known !== null) {
    return { ref: known };
  }
  if (args.ref_new === true || args.ref_new === "true") {
    return { ref, added: ref };
  }
  const near = refs_near(s, ref);
  return "No front (ref) " + JSON.stringify(ref) + (near.length === 0 ? "" : "; did you mean " + near.map((r) => JSON.stringify(r)).join(" or ") + "?") + " Fronts: " + (s.refs.length === 0 ? "none yet" : s.refs.join(", ")) + ". To start a new front, give ref_new: true.";
}

// a task of kind pr (given, or as its title says) needs the PRs it asks
// to approve, each with its link and the head verified (R5: what the
// rule of 23/10 asked in words); and so does any task of the user's
// whose title or detail cites a GitHub pull, whatever its kind (a kind
// given doesn't get round the contract). A task of Unii's (assignee
// unii) follows a PR up, it doesn't ask the user to approve it: held
// only by the kind given (pr), never by a link, in its title or its
// detail alike. Else why not
export function pr_sound(t: { title: string; detail?: string; assignee?: Assignee | null; kind: Deps.TaskKind | null; prs: PrCheck[] }): string | null {
  if (t.prs.length > 0) {
    return null;
  }
  const unii = (t.assignee ?? "user") === "unii";
  if (unii ? t.kind === "pr" : Deps.kind_of({ id: "", state: "open", made: "", title: t.title, kind: t.kind }) === "pr") {
    return "A PR's approval (kind pr" + (t.kind === "pr" ? "" : ", as its title's PR link says") + ") needs prs: [{url: the GitHub pull link, head: the commit verified (7 to 40 hex), verdict, verifier, notes: [{sev, text}], untested: [...]}]. Refused: no PR given with its link and head.";
  }
  const link = unii ? null : (Deps.pr_link(t.title) ?? Deps.pr_link(t.detail ?? ""));
  if (link === null) {
    return null;
  }
  return "This task cites a PR (" + link + ") in its " + (Deps.PR_LINK.test(t.title) ? "title" : "detail") + ": whatever its kind, a task of the user's that cites a PR goes with prs: [{url, head (the commit verified, 7 to 40 hex), verdict, verifier, notes, untested}]. Refused: no PR given with its link and head. (Drop the link if the PR isn't what it's about.)";
}

// what Unii's tools hold a task to besides (R5): task_add needs its
// origin given, never taken from the turn (turn: where it came from, said
// only to help); a ref, of either, one of the list's fronts. And (the
// evidence round) task_add needs done_when (what makes it done); one of
// Unii's, its next_step; one with choices, who acts on each (acts: every
// choice named), so an order to Unii is never taken for the user's own
// act. The args
// with the ref as the list writes it, and the front to add once the task
// is kept (null: none); else why not
export function tool_args(s: Store, name: string, args: Edit, turn: Origin | null): { args: Edit; added: string | null } | string {
  if (name === "task_add" && (args.origin === undefined || args.origin === null || String(args.origin).trim() === "")) {
    return "Give origin: where this task came from: chat (the user asked for it), timer (a schedule's turn), agent:<name> (a subagent's report), slack or github. It's not taken from the turn" + (turn === null ? "" : " (this one came from " + turn + ")") + ": say who it really came from.";
  }
  if (name === "task_add") {
    if (text_line(args.done_when, DONE_WHEN) === "") {
      return "Give done_when: what concretely makes this task done (\"PR #19 mesclado e serve reiniciado\", \"resposta enviada a Enzo no Slack\"). It's what its evidence must show when it's closed.";
    }
    const mine = assignee_read(args.assignee ?? args.who) === "unii";
    if (mine && text_line(args.next_step, NEXT_STEP) === "") {
      return "Give next_step: your next concrete step on this task (and next_due, when it's due; none: " + Deps.stall_ms() / 3600e3 + " h after it last moved).";
    }
    const choices = choices_read(args.choices);
    if (Array.isArray(choices) && choices.length > 0 && !String(args.kind ?? "").trim().toLowerCase().startsWith("restart")) {
      const acts = acts_read(args.acts, choices);
      const left = typeof acts === "string" ? [] : choices.filter((c) => acts[c] === undefined);
      if (left.length > 0) {
        return "Give acts for every choice: who acts once it's picked, user (it reports what they did or decided) or unii (an order to you, which stays open as an order received until you close it with evidence). Not said: " + left.map((c) => JSON.stringify(c)).join(", ") + ".";
      }
    }
  }
  const ref = ref_args(s, args);
  if (typeof ref === "string") {
    return ref;
  }
  return { args: ref.ref === undefined ? args : { ...args, ref: ref.ref }, added: ref.added ?? null };
}

// the restart's template (kind restart, R5, P8): with no choices given,
// "Sim, reinicie" (Unii acts: Restart.ts, recommended) or "Eu reinicio
// depois" (the user does)
export const RESTART_YES   = "Sim, reinicie";
export const RESTART_LATER = "Eu reinicio depois";
// whether an order's answer asks the restart now: the template's "Sim,
// reinicie", or a restart choice of its own read the other way round
// (SmoothDove): now only with a plain sign of it. A restart with no task
// (Server.ts Chat.back) closes only such orders: one for later stays
// open, for Unii to close with its own restart. In order:
// 1. no word of restarting: no
// 2. a hard wait (RESTART_WAIT: a refusal, a clock time, an event, a day,
//    a condition, "depois", "em seguida"...): later, even beside "agora"
// 3. a word of now ("agora", "já", "now", "imediatamente", or a wait
//    denied: "sem esperar", "não espere", "don't wait"): now, whatever
//    else it says ("Reinicie agora, de manhã já está", "Restart the early
//    worker now")
// 4. else now only if every other word is a plain one (RESTART_PLAIN:
//    "sim", "pode", "e avise", "o serve", "a 1 instância"...): any other,
//    a time of its own ("ao almoço", "de tardinha", "hoje", "logo",
//    "outro dia", "afterwards") or a name it doesn't know ("o night
//    worker"), keeps the order open: the safe side
// By design (PaperWaffle, baixa 3): a bare "Reinicie" is now (the verb
// alone asks nothing else), and a count is plain only in one or two
// digits: "a 100 instâncias" stays open (no serve runs that many)
export function restart_now(answer: string | null): boolean {
  // any run of blanks (two spaces, a line break, a tab) reads as one
  // space, so "quem  sabe" or "em\nseguida" match as "quem sabe" (PaperWaffle)
  const lower = (answer ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const a = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (a === RESTART_YES.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()) {
    return true;
  }
  // "sem esperar", "não espere": the restart asked now, its words of
  // waiting said only to deny them (read as "agora")
  // "não depende de mais nada", "sem depender": a doubt denied, read as
  // "agora" too, unless a "se", "if" or "caso" comes before it in the
  // same clause (a condition: "se não depende", "se isso não depende de
  // nada", "if it doesn't depend on anything") (SillyHippo, LunarMelon)
  const c = a.replace(RESTART_NO_WAIT, " agora ").replace(RESTART_NO_DOUBT, (m: string, at: number, s: string) => (RESTART_IF.test(clause_before(s, at)) ? m : " agora "));
  // "Reinicie agora e depois decide": a "depois" after the restart asked
  // now, about another thing, is no wait for it (SillyHippo)
  const b = restart_then(c);
  if (!/\b(?:reinici\w*|restart\w*)\b/.test(b)) {
    return false;
  }
  // "à uma", "à 1": the accent tells the hour from the article
  if (RESTART_AT_HOUR.test(lower) || RESTART_WAIT.some((w) => w.test(b))) {
    return false;
  }
  if (RESTART_NOW.test(b)) {
    return true;
  }
  // a number is plain only as a count ("a 3 instâncias"): a digit on its
  // own ("o 2º", "Reinicie 2") may be a date or an order: open (PeachCow)
  const words = b.split(/[^a-z0-9']+/).filter((w) => w !== "");
  return words.every((w, k) => RESTART_PLAIN.has(w) || /^(?:reinici|restart)/.test(w) || (/^\d{1,2}$/.test(w) && RESTART_COUNTED.has(words[k + 1] ?? "")));
}

// the nouns a count goes with (already without accents, lower): "a 3
// instâncias", "a segunda instância", "the 2 instances"
const RESTART_COUNTED = new Set(["instancia", "instancias", "instance", "instances", "vez", "vezes", "time", "times", "servidor", "servidores", "server", "servers", "servico", "servicos", "worker", "workers", "processo", "processos", "process", "processes"]);

// a wait denied (already without accents, lower): "sem esperar", "não
// espere", "nem aguarde", "don't wait", "without waiting". Limits: "Reinicie
// já, não depois" still reads "não depois" as a wait, and "Reinicie sem
// esperar não" reads its trailing "não" as a refusal (both stay open: the
// safe side)
const RESTART_NO_WAIT = /\b(?:sem (?:esperar|aguardar|demora|demorar)|(?:nao|nem) (?:espere|esperar|espera|aguarde|aguardar|aguarda)|don'?t wait|do not wait|without waiting|no wait(?:ing)?)\b/g;

// a doubt denied (already without accents, lower): "não depende", "nem
// depende de nada", "sem depender de mais ninguém", "doesn't depend on
// anything". The "se" before it is caught to keep a condition ("se não
// depende de nada") as it was: a wait. A condition is found by RESTART_IF
// in the clause before it (clause_before), not only right before it.
// Denied by its subject too (StormyFlamingo): "não dependo de ninguém",
// "nada depende disso", "ninguém depende", "nenhum agente depende do
// serve" ("nenhum" and up to two words, none a connector: "nenhum
// problema, mas depende" stays a doubt), "isso depende de nada", "nothing
// depends on it", "no agent depends on it". "tudo depende", "depende de
// mim" stay doubts.
// By design (ThinCamel, Verif. 12): the rule needs "reinicie"/"restart"
// in the sentence, so "não dependo de ninguém" alone is false (open);
// "Reinicie agora, não dependo de ninguém" is true
const RESTART_NO_DOUBT = new RegExp(
  [
    "\\b(?:(?:nao|nem) depend(?:e|em|o|emos)|sem depender|(?:doesn'?t|does not|don'?t|do not) depend)\\b(?: (?:de|on) (?:mais )?(?:nada|ninguem|anything|anyone))?",
    "\\b(?:nada|ninguem|nenhuma?(?: (?!(?:mas|porem|e|ou)\\b)[a-z0-9']+){0,2}?) depend(?:e|em)\\b",
    "\\b(?:nothing|nobody|no one|no(?: (?!(?:but|and|or)\\b)[a-z0-9']+){1,2}?) depends?\\b",
    "\\bdepend(?:e|em|s)? (?:de|on) (?:mais )?(?:nada|ninguem|nothing|nobody)\\b",
  ].join("|"),
  "g",
);

// a word of condition (already without accents, lower): "se", "if",
// "caso". Read only in the clause before a doubt denied (clause_before):
// "Reinicie, se isso não depende de nada", "Restart now if it doesn't
// depend on anything", "Reinicie caso não dependa": a condition, a wait
// (LunarMelon, M1). A limit: "se" as a pronoun ("Reinicie, faz-se agora,
// não depende" has a stop before it, so it's not read; "o que se faz não
// depende" is) and "caso" as a noun ("nesse caso não depende") read as a
// condition too: the order stays open, the safe side
const RESTART_IF = /\b(?:se|if|caso)\b/;

// the clause before a position: from the last stop (, ; . ! ? :) or line
// start up to it. A condition after a stop ("Se der. Reinicie agora, não
// depende") is held by RESTART_WAIT on the whole answer instead
function clause_before(s: string, at: number): string {
  const head = s.slice(0, at);
  const stop = Math.max(...[",", ";", ".", "!", "?", ":"].map((x) => head.lastIndexOf(x)));
  return head.slice(stop + 1);
}

// an event to wait for (already without accents, lower): "ao terminar",
// "os agentes acabarem", "concluir o PR", "aguarde", "espere" (RESTART_WAIT,
// RESTART_THEN_WAIT)
const RESTART_WAIT_EVENT = /\b(?:termin\w*|acab\w*|conclu\w*|finaliz\w*|finish\w*|complet\w*|esper\w*|aguard\w*|wait\w*)\b/;

// a condition (already without accents, lower): "se puder", "se der", "se
// possível", "if you can" (RESTART_WAIT, RESTART_THEN_WAIT)
const RESTART_WAIT_IF = /\bse (?:puder|pude\w*|der|possivel|conseguir|for possivel)\b|\bif (?:you can|possible)\b/;

// the connector of a later act after a restart asked now: "e depois",
// ", depois", ". Em seguida", "and afterwards", "and after that"
const RESTART_THEN = /^(.*?\b(?:reinici\w*|restart\w*)\b.*?\b(?:agora|ja|now|imediatamente|immediately|asap|right away)\b.*?)(?:\s*[,;.!]\s*(?:(?:e|and) )?|\s+(?:e|and) )(?:depois|em seguida|afterwards|after that)\b(.*)$/;

// what may follow "depois" to tie it to the restart itself ("depois dos
// agentes", "depois que terminar", "after the PR"): a wait, kept
const RESTART_THEN_TIED = new Set(["de", "do", "da", "dos", "das", "que", "disso", "disto", "dele", "dela", "deles", "delas", "daquilo", "daqui", "of", "the", "that", "this", "it"]);

// a restart asked now, then another act: "Reinicie agora e depois decide",
// "Restart now and afterwards tell me". The "depois" and what follows it
// are cut off when: a word of now comes after the restart's verb and
// before "depois"; "depois" is joined by "e" or a stop; a word follows it
// that doesn't tie it to the restart (RESTART_THEN_TIED); and no verb of
// restarting follows it ("e depois reinicie de novo" keeps the wait: the
// safe side). The rest is still read as a whole: a wait before "depois"
// ("Reinicie agora à tarde e depois avise") still holds. A limit: the
// hour by its accent (RESTART_AT_HOUR) is read in the whole answer, so
// "Reinicie agora e depois, à uma, revise" stays open (the safe side)
function restart_then(a: string): string {
  const m = RESTART_THEN.exec(a);
  if (m === null) {
    return a;
  }
  const tail = m[2]!;
  const words = tail.split(/[^a-z0-9']+/).filter((w) => w !== "");
  if (words.length === 0 || RESTART_THEN_TIED.has(words[0]!) || /\b(?:reinici|restart)/.test(tail) || RESTART_THEN_WAIT.some((w) => w.test(tail))) {
    return a;
  }
  return m[1]!;
}

// what in the act after "depois" may still be a wait for the restart, so
// "depois" is not cut off (LunarMelon, B2): an event ("depois aguarde os
// agentes", "depois só quando acabar", "depois espere o PR"), a condition
// ("depois, se der, avise", "if you can") or a word of when ("quando",
// "assim que", "só se", "until"). Any other act ("depois decide",
// "depois avise", "depois revise o log") is cut off: the restart is now.
// A limit (B3, the safe side): a time or a day in that act ("e depois me
// conte amanhã") is not looked at here but by RESTART_WAIT on what is
// left, so it still keeps the order open only if it sits before "depois";
// and a wait meant for the other act ("e depois espere o deploy para
// avisar") keeps it open too, as the words can't tell whose wait it is
const RESTART_THEN_WAIT: RegExp[] = [
  RESTART_WAIT_EVENT,
  RESTART_WAIT_IF,
  /\b(?:quando|assim que|logo que|so se|somente se|enquanto|ate|when|once|until|as soon)\b/,
];

// a plain sign of now (already without accents, lower). "já já" is a
// soon, not a now: RESTART_WAIT takes it first
const RESTART_NOW = /\b(?:agora|ja|now|imediatamente|immediately|asap|right away)\b/;

// the hour by its accent (lower, accents kept): "à uma", "à 1", "à uma e
// meia". "a" with no accent is the article ("a 1 instância"), read as an
// hour only at the end or before "h", "hora", "e meia" (RESTART_WAIT)
const RESTART_AT_HOUR = /(?:^|[^\p{L}\p{N}])à (?:uma|\d{1,2})(?![\p{L}\p{N}])/u;

// the words a restart asked now may carry besides its verb (already
// without accents, lower): a yes, a courtesy, an "e avise", an object
// ("o serve", "a 1 instância", "as duas instâncias", "de novo"). Numbers
// of one or two digits too (restart_now). Any other word keeps it open
const RESTART_PLAIN = new Set([
  "sim", "s", "yes", "y", "ok", "okay", "pode", "podes", "voce", "vc", "you", "can", "may", "please", "pls", "por", "favor", "pf", "vai", "go", "ahead", "la", "entao", "so",
  "e", "and", "avise", "avisa", "avisar", "me", "notify", "tell", "let", "know",
  "o", "a", "os", "as", "the", "it", "this", "isso", "ele", "serve", "servidor", "server", "service", "servico", "unii", "chat", "8788",
  "instancia", "instancias", "instance", "instances", "um", "uma", "dois", "duas", "tres", "one", "two", "three", "tudo", "all", "both", "ambos", "ambas", "de", "novo", "again",
  // an ordinal before a counted noun ("a segunda instância"): RESTART_WAIT
  // reads "segunda" as a day unless such a noun follows it
  "primeira", "primeiro", "segunda", "segundo", "terceira", "terceiro", "first", "second", "third",
  // "vez" too, the noun RESTART_WAIT lets follow "segunda" ("Reinicie a
  // segunda vez", "uma vez"): plain like "instância" (PaperWaffle)
  "vez", "vezes",
]);

// what puts off a restart asked, even beside "agora" (already without
// accents, lower): a word of waiting or refusal, a time ("às 22h",
// "22:30", "em 1 hora", "daqui a pouco"), an event to wait for ("ao
// terminar o PR", "assim que os agentes acabarem"), a day or a condition.
// "agora" is no wait: "hora" is whole. A part of the day ("manhã",
// "cedo", "night", "early"), "hoje", "logo", "em breve" are no hard wait:
// without a word of now they keep the order open (not plain words), with
// one ("Reinicie agora, de manhã já está") they don't. "tarde" and
// "noite" stay hard: "agora à tarde" is this afternoon
const RESTART_WAIT: RegExp[] = [
  /\b(?:depois|apos|quando|mais tarde|amanha|noite|tarde|antes|ao fim|ao final|no fim|no final|fim do|so se|somente|nao|nunca|ate|daqui|assim que|logo que|enquanto|em seguida|outro dia|outra hora|ja ja|later|after|afterwards|afterward|when|tomorrow|tonight|until|before|once|soon|next|don'?t|not|never|as soon)\b/,
  // a time: "às 22h", "22:30", "22 h", "at 10", "em 1 hora", "em uma hora", "in an hour"
  /\bas \d|\b\d{1,2} ?h\b|\b\d{1,2}h\d{2}\b|\b\d{1,2}:\d{2}\b|\bat \d|\bem (?:\d+|um|uma|meia|duas|dois|tres|alguns|algumas|poucos|poucas)\b|\bin (?:\d+|an?|one|two|few)\b/,
  /\b(?:hora|horas|minuto|minutos|min|hour|hours|minute|minutes)\b/,
  RESTART_WAIT_EVENT,
  // a day: "na sexta", "segunda-feira", "dia 27", "27/10", "no fim de
  // semana", "monday", "weekend"
  /\bsegunda(?! (?:instancia|instancias|vez|vezes|servidor|servico|worker|processo)\b)|\b(?:terca|quarta|quinta|sexta|sabado|domingo|feira|semana|mes|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|week|month)\b|\bdia (?:\d|primeiro|um|dois|tres)|\b\d{1,2}\/\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\b|\bon the\b/,
  // a time in words: "ao meio-dia", "à meia-noite", "às dez", "às três e
  // meia", "a uma" at the end, "a 1h", "a 1 hora", "at noon". "a uma
  // instância", "a 2 instâncias" are counts, no hour ("à uma":
  // RESTART_AT_HOUR). A limit: "as" is also the article ("Reinicie as
  // duas instâncias" stays open: the safe side)
  /\bmei[oa][- ](?:dia|noite)\b|\ba (?:uma|\d{1,2})(?= ?h\b| ?hora| e meia|\s*[,.;:!?](?!\s*(?:agora|ja|now|imediatamente|immediately)\b)|\s*$)|\bas (?:uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte)\b|\b(?:noon|midnight|o'?clock)\b|\bat (?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,
  RESTART_WAIT_IF,
  // a doubt: "agora, quem sabe", "talvez", "quiçá", "sei lá", "depende",
  // "provavelmente", "maybe", "who knows" (PeachCow, PaperWaffle). The
  // blanks between words are already one space (restart_now)
  /\b(?:quem sabe|talvez|quica|porventura|sei la|depend\w*|provavel\w*|maybe|perhaps|possibly|probably|who knows|it depends)\b/,
];

export const RESTART_DETAIL = "Política (P8): o Unii reinicia sozinho quando nenhum agente está rodando, avisando antes e depois. Esta pendência só existe porque há agentes rodando agora, e o reinício os interrompe.";

// Fields
// ------

// a fields list as given: each {id, label, kind, choices?, required?,
// recommend?} (recommend: an answer it takes, as value_read; required by default; yesno's choices: sim, não; choice and multi: at
// least 2), at most FIELDS, no id twice (in any case). fields: those
// that are sound; why: the first that isn't (null: all are). A hand
// edit's file keeps the sound ones; a tool refuses the list
export function fields_read(x: unknown): { fields: Field[]; why: string | null } {
  if (x === undefined || x === null) {
    return { fields: [], why: null };
  }
  if (!Array.isArray(x)) {
    return { fields: [], why: "fields is a list of {id, label, kind, choices?, required?}." };
  }
  const fields: Field[] = [];
  let why: string | null = null;
  const no = (said: string) => (why = why ?? said);
  x.forEach((y, k) => {
    if (typeof y !== "object" || y === null || Array.isArray(y)) {
      return no("fields[" + k + "] is not an object.");
    }
    const o = y as Record<string, unknown>;
    const id = typeof o.id === "string" || typeof o.id === "number" ? String(o.id).trim() : "";
    if (!FIELD_ID.test(id)) {
      return no("fields[" + k + "]: id is 1 to 24 letters, digits, - or _, starting with a letter or digit.");
    }
    if (fields.some((f) => f.id.toLowerCase() === id.toLowerCase())) {
      return no("Field id " + id + " given twice.");
    }
    const kind = Object.hasOwn(KINDS, String(o.kind ?? "").trim().toLowerCase()) ? KINDS[String(o.kind).trim().toLowerCase()] : undefined;
    if (kind === undefined) {
      return no("Field " + id + ": kind is one of choice, multi, text, yesno.");
    }
    const label = text_line(o.label, LABEL);
    if (label === "") {
      return no("Field " + id + " needs a label.");
    }
    if (o.required !== undefined && typeof o.required !== "boolean") {
      return no("Field " + id + ": required is true or false.");
    }
    let choices: string[] = kind === "yesno" ? [...YESNO] : [];
    if (kind === "choice" || kind === "multi") {
      const got = choices_read(o.choices);
      if (typeof got === "string") {
        return no("Field " + id + ": " + got);
      }
      if (got.length < 2) {
        return no("Field " + id + " (" + kind + ") needs at least 2 choices.");
      }
      choices = got;
    }
    const field: Field = { id, label, kind, choices, required: o.required !== false };
    if (o.recommend !== undefined && o.recommend !== null && o.recommend !== "") {
      const rec = value_read(field, o.recommend);
      if (typeof rec === "string") {
        return no("Field " + id + ": recommend must be " + (kind === "multi" ? "a list of its choices" : kind === "text" ? "a text" : "one of its choices") + " (" + rec + ")");
      }
      if (rec.v !== null) {
        field.recommend = rec.v;
      }
    }
    fields.push(field);
  });
  if (fields.length > FIELDS) {
    no("At most " + FIELDS + " fields.");
  }
  return { fields: fields.slice(0, FIELDS), why };
}

// whether a field's answer is given
export function value_given(v: Value | undefined): boolean {
  return v !== undefined && v.length > 0;
}

// an answer given to a field: its value ({ v: null }: none, cleared),
// else why not (the user's words: views show it)
export function value_read(f: Field, x: unknown): { v: Value | null } | string {
  if (x === undefined || x === null || x === "" || (Array.isArray(x) && x.length === 0)) {
    return { v: null };
  }
  const name = "“" + f.label + "”";
  if (f.kind === "text") {
    if (typeof x !== "string") {
      return "O campo " + name + " espera um texto.";
    }
    const text = text_body(x, NOTE);
    return { v: text === "" ? null : text };
  }
  const all = Array.isArray(x) ? x : [x];
  if (all.some((y) => typeof y !== "string") || (f.kind !== "multi" && all.length > 1)) {
    return f.kind === "multi" ? "O campo " + name + " espera uma lista de opções." : "O campo " + name + " espera uma opção.";
  }
  const got = all.map((y) => text_line(y, CHOICE));
  const bad = got.find((y) => !f.choices.includes(y));
  if (bad !== undefined) {
    return "O campo " + name + " não tem a opção “" + bad + "”. Opções: " + f.choices.join(", ") + ".";
  }
  return { v: f.kind === "multi" ? f.choices.filter((c) => got.includes(c)) : got[0] };
}

// a values object as read (tasks.json): those of fields of the list,
// sound, kept; the rest left out
export function values_clean(fields: Field[], x: unknown): Values {
  const out: Values = {};
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return out;
  }
  for (const f of fields) {
    const got = Object.hasOwn(x, f.id) ? value_read(f, (x as Record<string, unknown>)[f.id]) : null;
    if (got !== null && typeof got !== "string" && got.v !== null) {
      out[f.id] = got.v;
    }
  }
  return out;
}

// a task's field by its id (as given, or in another case)
export function field_find(t: { fields: Field[] }, id: string): Field | null {
  return t.fields.find((f) => f.id === id) ?? t.fields.find((f) => f.id.toLowerCase() === id.toLowerCase()) ?? null;
}

// answers given (by field id) laid over a task's draft: the draft as it
// would be, else why not (the user's words)
export function values_merge(t: Task, x: unknown): Values | string {
  if (x === undefined || x === null) {
    return { ...t.draft };
  }
  if (typeof x !== "object" || Array.isArray(x)) {
    return "Respostas inválidas: informe um objeto com as respostas de cada campo.";
  }
  const out: Values = { ...t.draft };
  for (const [key, value] of Object.entries(x)) {
    const f = field_find(t, key);
    if (f === null) {
      return "A pendência " + t.id + " não tem o campo “" + text_line(key, 40) + "”.";
    }
    const got = value_read(f, value);
    if (typeof got === "string") {
      return got;
    }
    if (got.v === null) {
      delete out[f.id];
    } else {
      out[f.id] = got.v;
    }
  }
  return out;
}

// the required fields a draft leaves unanswered
export function fields_missing(t: Task, values: Values): Field[] {
  return t.fields.filter((f) => f.required && !value_given(Object.hasOwn(values, f.id) ? values[f.id] : undefined));
}

// answers as read: "Ambiente: hom; Prazo: “sexta”" ("" for none)
export function values_said(fields: Field[], values: Values | null | undefined): string {
  if (values === null || values === undefined) {
    return "";
  }
  return fields.filter((f) => Object.hasOwn(values, f.id)).map((f) => {
    const v = values[f.id];
    return f.label + ": " + (Array.isArray(v) ? v.join(", ") : f.kind === "text" ? "“" + v + "”" : v);
  }).join("; ");
}

// an after list as given (["P3", "P4"], or "P3, P4"; null: none): ids
// of tasks of the list, none twice; self: the task's own id, refused, as
// an id whose own after lists reach it (a cycle); else why not
function after_read(s: Store, x: unknown, self: string | null): string[] | string {
  if (x === undefined || x === null || x === "") {
    return [];
  }
  const all = typeof x === "string" ? x.split(/[\s,;]+/).filter((y) => y !== "") : Array.isArray(x) ? x : null;
  if (all === null || all.some((y) => typeof y !== "string" && typeof y !== "number")) {
    return "after is a list of task ids, as [\"P3\", \"P4\"].";
  }
  const ids = [...new Set(all.map(task_id))];
  if (ids.length > Deps.AFTER) {
    return "A task waits for at most " + Deps.AFTER + " others.";
  }
  for (const id of ids) {
    if (id === self) {
      return "A task can't wait for itself (" + id + ").";
    }
    if (task_find(s, id) === null) {
      return "No task " + id + " to wait for.";
    }
  }
  if (self !== null) {
    const loop = ids.find((id) => Deps.reaches(s.tasks, [id], self));
    if (loop !== undefined) {
      return loop + " waits for " + self + " already (directly or through others): " + self + " can't wait for it, a cycle.";
    }
  }
  return ids;
}

// a task's kind and priority as given by a tool (kind: pr, decision,
// test, "" or null for none; priority: high, normal, low, "" or null for
// normal); each only if given; else why not
function kind_args(args: Edit): { kind?: Deps.TaskKind | null; priority?: Deps.Priority } | string {
  const out: { kind?: Deps.TaskKind | null; priority?: Deps.Priority } = {};
  if (args.kind !== undefined) {
    const k = args.kind === null ? "" : String(args.kind).trim().toLowerCase();
    if (k !== "" && !Deps.KINDS.includes(k as Deps.TaskKind)) {
      return "kind is one of " + Deps.KINDS.join(", ") + " (\"\" for none).";
    }
    out.kind = k === "" ? null : (k as Deps.TaskKind);
  }
  if (args.priority !== undefined) {
    const p = args.priority === null ? "" : String(args.priority).trim().toLowerCase();
    if (p !== "" && !Deps.PRIORITIES.includes(p as Deps.Priority)) {
      return "priority is one of " + Deps.PRIORITIES.join(", ") + ".";
    }
    out.priority = p === "" ? "normal" : (p as Deps.Priority);
  }
  return out;
}

// when a next step is due, as given: a time (ISO), or from now ("4h",
// "30m", "2d", "90 min"); not past, at most DUE_MOST ahead. "" or null:
// none ({ v: null }). Else why not
export function due_read(x: unknown, now: number): { v: string | null } | string {
  if (x === undefined || x === null || String(x).trim() === "") {
    return { v: null };
  }
  const said = String(x).trim().toLowerCase();
  const m = /^(\d{1,4})\s*(m|min|mins|minutos?|h|hs|horas?|d|dias?|days?|hours?|minutes?)$/.exec(said);
  const unit = m === null ? 0 : m[2].startsWith("m") ? 60e3 : m[2].startsWith("h") ? 3600e3 : 86400e3;
  const at = m !== null ? now + Number(m[1]) * unit : /^\d{4}-\d{2}-\d{2}/.test(said) ? Date.parse(String(x).trim()) : NaN;
  if (Number.isNaN(at)) {
    return "next_due is a time (ISO, as 2026-10-27T14:00:00-03:00) or how long from now (\"4h\", \"30m\", \"2d\").";
  }
  if (at < now - 60e3) {
    return "next_due is past (" + new Date(at).toISOString() + "): give when the next step is due from now.";
  }
  if (at > now + DUE_MOST) {
    return "next_due is at most 30 days ahead: a step that far is no next step; say a nearer one.";
  }
  return { v: new Date(at).toISOString() };
}

// the evidence round's fields as a tool gives them (done_when,
// next_step, next_due, status with its why and what unblocks it), for a
// task of `assignee`; each only if given; else why not
function round_args(args: Edit, now: number, assignee: Assignee): { done_when?: string | null; next_step?: string | null; next_due?: string | null; status?: Deps.Status; status_why?: string | null; unblock?: string | null } | string {
  const out: { done_when?: string | null; next_step?: string | null; next_due?: string | null; status?: Deps.Status; status_why?: string | null; unblock?: string | null } = {};
  if (args.done_when !== undefined) {
    out.done_when = text_line(args.done_when, DONE_WHEN) || null;
  }
  if (args.next_step !== undefined) {
    out.next_step = text_line(args.next_step, NEXT_STEP) || null;
  }
  if (args.next_due !== undefined) {
    const due = due_read(args.next_due, now);
    if (typeof due === "string") {
      return due;
    }
    out.next_due = due.v;
  }
  if (args.status !== undefined && args.status !== null && args.status !== "") {
    const st = String(args.status).trim().toLowerCase() as Deps.Status;
    if (!Deps.STATUSES.includes(st)) {
      return "status is one of " + Deps.STATUSES.join(", ") + " (an order is the user's pick, never set; done and dropped are state).";
    }
    const why = text_line(args.status_why, WHY);
    const unblock = text_line(args.unblock, WHY);
    if (st === "blocked" && (why === "" || unblock === "")) {
      return "status blocked needs status_why (why it's blocked) and unblock (what unblocks it).";
    }
    if (st === "waiting_user" && why === "") {
      return "status waiting_user needs status_why: what of the user's it waits for.";
    }
    if (st === "waiting_user" && assignee === "user") {
      return "status waiting_user is for a task of yours (assignee unii) that waits for the user; one of the user's is theirs already.";
    }
    out.status = st;
    out.status_why = st === "open" ? null : why;
    out.unblock = st === "blocked" ? unblock : null;
  } else if (args.status_why !== undefined || args.unblock !== undefined) {
    return "status_why and unblock go with status (waiting_user, blocked).";
  }
  return out;
}

// a new task made by Unii (by: "main"); else why not
// (origin: where the turn came from, unless args give one)
export function task_new(s: Store, args: Edit, by: string, now: number, origin: Origin | null = null): Task | string {
  const title = text_line(args.title, TITLE);
  const restart = String(args.kind ?? "").trim().toLowerCase() === "restart";
  // a restart with no choices given: its template's (R5, P8)
  const plain = restart && (args.choices === undefined || args.choices === null || (Array.isArray(args.choices) && args.choices.length === 0));
  if (plain) {
    args = { ...args, choices: [RESTART_YES, RESTART_LATER], recommend: args.recommend ?? RESTART_YES, acts: args.acts ?? { [RESTART_YES]: "unii", [RESTART_LATER]: "user" }, detail: text_body(args.detail, DETAIL) === "" ? RESTART_DETAIL : args.detail };
  }
  const choices = choices_read(args.choices);
  if (title === "") {
    return "A task needs a title.";
  }
  if (typeof choices === "string") {
    return choices;
  }
  const acts = acts_read(args.acts, choices);
  if (typeof acts === "string") {
    return acts;
  }
  const prs = prs_read(args.prs);
  if (prs.why !== null) {
    return prs.why;
  }
  const whose = whose_args(args, origin_read(origin));
  if (typeof whose === "string") {
    return whose;
  }
  const after = after_read(s, args.after, null);
  if (typeof after === "string") {
    return after;
  }
  const fields = fields_read(args.fields);
  if (fields.why !== null) {
    return fields.why;
  }
  const recommend = recommend_read(args.recommend, choices);
  if (typeof recommend === "string") {
    return recommend;
  }
  const kp = kind_args(args);
  if (typeof kp === "string") {
    return kp;
  }
  const round = round_args(args, now, whose.assignee ?? "user");
  if (typeof round === "string") {
    return round;
  }
  // from outside (the inbox) a PR's link says what it's about, not that
  // it was verified: only Unii's are held to the contract
  const unsound = by === "inbox" ? null : pr_sound({ title, detail: text_body(args.detail, DETAIL), assignee: whose.assignee ?? "user", kind: kp.kind ?? null, prs: prs.prs });
  if (unsound !== null) {
    return unsound;
  }
  const open = s.tasks.filter((t) => t.state === "open");
  const twin = open.find((t) => t.title.toLowerCase() === title.toLowerCase());
  if (twin !== undefined) {
    return twin.id + " is open with this title already: edit it (task_edit) instead.";
  }
  if (open.length >= OPEN) {
    return "The list has " + OPEN + " open tasks, the most it keeps: close some first.";
  }
  if (s.next > MAXID) {
    return "The list has no ids left (the last is P" + MAXID + ").";
  }
  const at = new Date(now).toISOString();
  const ref = text_line(args.ref, REF);
  const task: Task = {
    id: "P" + s.next, title, detail: text_body(args.detail, DETAIL), state: "open", assignee: whose.assignee ?? "user", origin: whose.origin ?? origin_read(origin), origin_url: whose.origin_url ?? null, agent: whose.agent ?? null, by, choices, recommend: recommend.v, answer: null, note: null,
    ref: ref === "" ? null : ref, made: at, changed: at, moved: at, kind: kp.kind ?? null, priority: kp.priority ?? (kp.kind === "info" ? "low" : "normal"), prs: prs.prs, acts, waits_for: text_line(args.waits_for, WAITS_FOR) || null, ready: at, closed: null, closed_by: null, told: true, rev: 0, after, freed: false, heard: null,
    fields: fields.fields, draft: {}, answers: null, thread: [], talk: null,
    done_when: round.done_when ?? null, evidence: [], status: round.status ?? "open", status_why: round.status_why ?? null, unblock: round.unblock ?? null, order: null,
    next_step: round.next_step ?? null, next_due: round.next_due ?? null,
  };
  s.next += 1;
  s.tasks.push(task);
  tasks_save(s);
  return task;
}

// Inbox
// -----
// A task from outside (Server.ts /api/inbox: a script with the inbox
// token, as the Slack sorter or the stalled tasks' watch, vigia.ts),
// always the user's, from slack, github or timer (a script run by a
// systemd timer), keyed by its ref (one conversation, "slack:D0123"): an open one of
// that ref and origin gets the new text appended (its oldest lines
// dropped past DETAIL), the newest title and link; else a new one (by
// "inbox"). Nothing is told to Unii and no turn starts: the user
// decides, and their resolution reaches Unii as any other. Only the keys
// below are taken; any other, or a wrong value, is refused, said why

export const INBOX_ORIGINS = ["slack", "github", "timer"];
const INBOX_KEYS = ["title", "detail", "origin", "origin_url", "ref", "choices", "acts"];

// the marks that turn text's direction (U+202A-U+202E, U+2066-U+2069,
// U+200E, U+200F): from outside (anyone on Slack), so a title can't read
// backwards in the Mesa or the terminal
const BIDI = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;

export function bidi_strip(x: unknown): unknown {
  return typeof x === "string" ? x.replace(BIDI, "") : Array.isArray(x) ? x.map(bidi_strip) : x;
}

export function task_inbox(s: Store, x: unknown, now: number): { task: Task; made: boolean } | string {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return "task is an object {title, detail, origin, origin_url, ref, choices, acts}.";
  }
  const o = Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, bidi_strip(v)]));
  const odd = Object.keys(o).filter((k) => !INBOX_KEYS.includes(k));
  if (odd.length > 0) {
    return "Unknown key(s): " + odd.slice(0, 5).map((k) => text_line(k, 40)).join(", ") + ".";
  }
  const bad = INBOX_KEYS.filter((k) => k !== "choices" && k !== "acts" && o[k] !== undefined && typeof o[k] !== "string");
  if (bad.length > 0) {
    return bad.join(", ") + " must be text.";
  }
  const origin = origin_read(o.origin);
  if (origin === null || !INBOX_ORIGINS.includes(origin)) {
    return "origin is one of: " + INBOX_ORIGINS.join(", ") + ".";
  }
  const ref = text_line(o.ref, REF);
  if (ref === "") {
    return "A task from outside needs a ref (its conversation).";
  }
  const title = text_line(o.title, TITLE);
  if (title === "") {
    return "A task needs a title.";
  }
  const url = o.origin_url === undefined || o.origin_url === "" ? null : url_read(o.origin_url);
  if (o.origin_url !== undefined && o.origin_url !== "" && (url === null || !/^https:/i.test(url))) {
    return "origin_url is an https link of at most " + ORIGIN_URL + " characters, without spaces, quotes or angle brackets.";
  }
  if (Array.isArray(o.choices) && o.choices.some((c) => typeof c !== "string")) {
    return "choices is a list of strings.";
  }
  const choices = choices_read(o.choices);
  if (typeof choices === "string") {
    return choices;
  }
  // who acts on each choice (the evidence round): "Enviar rascunho" an
  // order to Unii (unii), so picking it doesn't close the task untold
  const acts = acts_read(o.acts, choices);
  if (typeof acts === "string") {
    return acts;
  }
  const detail = text_body(o.detail, DETAIL);
  const had = s.tasks.find((t) => t.state === "open" && t.assignee === "user" && t.origin === origin && t.ref === ref);
  if (had === undefined) {
    const t = task_new(s, { title, detail, choices, acts, ref, origin, origin_url: url, assignee: "user" }, "inbox", now);
    return typeof t === "string" ? t : { task: t, made: true };
  }
  const twin = s.tasks.find((t) => t !== had && t.state === "open" && t.title.toLowerCase() === title.toLowerCase());
  if (twin !== undefined) {
    return twin.id + " is open with this title already.";
  }
  had.title = title;
  had.detail = detail_join(had.detail, detail, DETAIL);
  had.origin_url = url ?? had.origin_url;
  if (choices.length > 0) {
    had.choices = choices;
    had.acts = acts_clean(o.acts === undefined ? had.acts : acts, choices);
    had.recommend = had.recommend != null && choices.includes(had.recommend) ? had.recommend : null;
  }
  had.changed = new Date(now).toISOString();
  had.moved = had.changed;
  tasks_save(s);
  return { task: had, made: false };
}

// two texts, one after the other; past n, the first's oldest lines go
// (an ellipsis line where they were), the newest kept whole if it can be
export function detail_join(a: string, b: string, n: number): string {
  const all = a === "" ? b : b === "" ? a : a + "\n" + b;
  if (all.length <= n) {
    return all;
  }
  const tail = all.slice(all.length - (n - 2));
  const cut = tail.indexOf("\n");
  return "…\n" + (cut >= 0 && cut < tail.length - 1 ? tail.slice(cut + 1) : tail);
}

// a task changed by Unii (task_edit): any field, its state too. A new
// state makes the task told (Unii did it), unless a change by the user
// is still untold: then, as any other edit, told and rev stay as they
// were, so that change (its Heard) is still told. Done can't be set while
// it waits for open tasks (dropped can: it no longer applies); else why
// not
export function task_edit(s: Store, args: Edit & { id?: unknown }, now: number): Task | string {
  const task = task_find(s, args.id);
  if (task === null) {
    return "No task " + task_id(args.id) + ".";
  }
  const next = { ...task };
  if (args.title !== undefined) {
    next.title = text_line(args.title, TITLE);
    if (next.title === "") {
      return "A task needs a title.";
    }
  }
  if (args.detail !== undefined) {
    next.detail = text_body(args.detail, DETAIL);
  }
  const whose = whose_args(args, task.origin);
  if (typeof whose === "string") {
    return whose;
  }
  Object.assign(next, whose);
  if (whose.origin !== undefined && whose.origin !== task.origin && whose.origin_url === undefined) {
    next.origin_url = null;
  }
  if (args.choices !== undefined) {
    const choices = choices_read(args.choices);
    if (typeof choices === "string") {
      return choices;
    }
    next.choices = choices;
  }
  if (args.acts !== undefined) {
    const acts = acts_read(args.acts, next.choices);
    if (typeof acts === "string") {
      return acts;
    }
    next.acts = acts;
  } else {
    next.acts = acts_clean(task.acts, next.choices);
  }
  if (args.prs !== undefined) {
    const prs = prs_read(args.prs);
    if (prs.why !== null) {
      return prs.why;
    }
    next.prs = prs.prs;
  }
  if (args.waits_for !== undefined) {
    next.waits_for = text_line(args.waits_for, WAITS_FOR) || null;
  }
  if (args.recommend !== undefined) {
    const recommend = recommend_read(args.recommend, next.choices);
    if (typeof recommend === "string") {
      return recommend;
    }
    next.recommend = recommend.v;
  } else if (next.recommend != null && !next.choices.includes(next.recommend)) {
    next.recommend = null;
  }
  const kp = kind_args(args);
  if (typeof kp === "string") {
    return kp;
  }
  Object.assign(next, kp);
  const round = round_args(args, now, next.assignee);
  if (typeof round === "string") {
    return round;
  }
  Object.assign(next, round);
  if (round.next_step !== undefined && round.next_due === undefined && round.next_step !== task.next_step) {
    next.next_due = null;
  }
  if (next.assignee === "user" && next.status === "waiting_user") {
    next.status = "open";
    next.status_why = null;
  }
  // the contract held once the edit touches it (an older task, made
  // before it, keeps being edited otherwise)
  const unsound = args.kind !== undefined || args.prs !== undefined || args.title !== undefined || args.detail !== undefined || args.assignee !== undefined ? pr_sound(next) : null;
  if (unsound !== null && next.state !== "dropped" && args.state !== "dropped") {
    return unsound;
  }
  if (args.ref !== undefined) {
    const ref = text_line(args.ref, REF);
    next.ref = ref === "" ? null : ref;
  }
  if (args.note !== undefined) {
    const note = text_body(args.note, NOTE);
    next.note = note === "" ? null : note;
  }
  if (args.after !== undefined) {
    const after = after_read(s, args.after, task.id);
    if (typeof after === "string") {
      return after;
    }
    next.after = after;
  }
  if (args.fields !== undefined) {
    const fields = fields_read(args.fields);
    if (fields.why !== null) {
      return fields.why;
    }
    next.fields = fields.fields;
    next.draft = values_clean(next.fields, task.draft);
    next.answers = task.answers === null ? null : values_clean(next.fields, task.answers);
  }
  if (args.state !== undefined) {
    const state = String(args.state) as State;
    if (!STATES.includes(state)) {
      return "state is one of " + STATES.join(", ") + ".";
    }
    if (state === "open" && task.state !== "open" && s.tasks.filter((t) => t.state === "open").length >= OPEN) {
      return "The list has " + OPEN + " open tasks, the most it keeps: close some first.";
    }
    next.state = state;
  }
  if (args.answer !== undefined) {
    const answer = args.answer === null ? null : text_line(args.answer, CHOICE);
    if (answer !== null && answer !== "" && !next.choices.includes(answer)) {
      return "No choice " + JSON.stringify(answer) + "; one of: " + next.choices.join(" | ") + ".";
    }
    next.answer = answer === "" ? null : answer;
  }
  // what the user picked from stays as they saw it: a closed task (and
  // staying closed) keeps its kind, choices and who acts on each; else
  // Unii could turn the user's pick into a leave they never gave
  // (Restart.check: a restart with agents at work). Open it again first
  // (so is an order received: the user picked from them as they were)
  const fixed = (task.state !== "open" && next.state !== "open") || task_ordered(task);
  const was = { kind: task.kind ?? null, choices: task.choices, acts: acts_clean(task.acts, task.choices) };
  const moved = (k: "kind" | "choices" | "acts"): boolean => same_json(was[k], next[k] ?? null) === false;
  const touched: string[] = fixed ? (["kind", "choices", "acts"] as const).filter(moved) : [];
  if (task_ordered(task) && next.answer !== task.answer) {
    touched.unshift("answer");
  }
  // an order received is Unii's to execute: handing it to the user
  // (assignee user) would leave it in limbo as theirs, neither executed
  // nor closed with evidence (what isn't Unii's to do goes in a task of
  // its own, for the user)
  if (task_ordered(task) && next.assignee !== task.assignee) {
    return task.id + " is the user's order received (" + (task.order?.answer ?? "their pick") + "): it stays yours (assignee " + task.assignee + ") till you close it with evidence of the execution. If something of the user's is needed, set status waiting_user (why) or add a task of theirs for it. Nothing was changed.";
  }
  if (touched.length > 0) {
    return task.id + (task_ordered(task) ? " is the user's order received" : " is closed (" + task.state + ")") + ": its " + touched.join(", ") + " can't change, the user picked from them as they were." + (task_ordered(task) ? " Execute it and close it with evidence; for another decision, add a new task." : " Open it again (state open) to change them; the user picks again.");
  }
  const waits = Deps.waits(s.tasks, next);
  if (next.state === "done" && task.state === "open" && waits.length > 0) {
    return task.id + " waits for " + waits.join(", ") + ", still open: it can't be done before them. Close those first, change its after, or drop it if it no longer applies.";
  }
  // the evidence round: an order of the user's is never dropped by Unii;
  // a close needs evidence (Evidence.ts), checked; one closed already
  // may get evidence (one "sem evidência" proven); one opened again
  // loses its close's evidence and order, its status open again
  if (task_ordered(task) && next.state === "dropped") {
    return task.id + " is the user's order (" + (task.order?.answer ?? "their pick") + "): you can't drop it. Execute it and close it done with evidence of the execution; if you can't, set status waiting_user or blocked (why, what unblocks it) and tell the user, who may cancel it. Nothing was changed.";
  }
  const closing = next.state !== "open" && (task.state === "open" || next.state !== task.state);
  if (closing) {
    const ev = Ev.evidence_read(args.evidence, next.state as "done" | "dropped", now);
    if (typeof ev === "string") {
      return task.id + ": " + ev;
    }
    next.evidence = ev;
  } else if (args.evidence !== undefined && args.evidence !== null) {
    if (next.state === "open") {
      return "evidence goes with closing a task (state done or dropped), or on one closed already (sem evidência: it's added). " + task.id + " stays open. Nothing was changed.";
    }
    const ev = Ev.evidence_read(args.evidence, next.state as "done" | "dropped", now);
    if (typeof ev === "string") {
      return task.id + ": " + ev;
    }
    next.evidence = [...(task.evidence ?? []), ...ev].slice(-Ev.EVIDENCES);
  }
  if (next.state === "open" && task.state !== "open") {
    next.evidence = [];
    next.order = null;
  }
  if (next.state !== "open") {
    next.talk = null;
    next.status = "open";
    next.status_why = null;
    next.unblock = null;
    next.next_step = null;
    next.next_due = null;
  }
  const untold = !task.told && !task.freed;
  return task_put(s, task, next, now, next.state !== task.state && !untold ? true : null);
}

// two values alike as JSON, objects' keys in any order
function same_json(a: unknown, b: unknown): boolean {
  const norm = (x: unknown): unknown => Array.isArray(x) ? x.map(norm) : typeof x === "object" && x !== null ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p < q ? -1 : p > q ? 1 : 0).map(([k, v]) => [k, norm(v)])) : x;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

// what a task of Unii's closed by the user says, with no comment typed
export const CLOSE = "Pode fechar";
// what an order canceled by the user says, with no comment typed; an
// order's first next step (its choice after it)
export const CANCEL = "Ordem cancelada pelo usuário";
export const ORDER_STEP = "Executar a ordem do usuário: ";

// a task resolved by the user: done (answer: one of its choices), dropped
// or opened again, with a comment; null: so already (an act done again
// changes nothing), else the task, else why not
export function task_resolve(s: Store, id: unknown, state: unknown, answer: unknown, note: unknown, now: number, values?: unknown): Task | string | null {
  const task = task_find(s, id);
  if (task === null) {
    return "Pendência " + task_id(id) + " não encontrada.";
  }
  const to = String(state) as State;
  if (!STATES.includes(to)) {
    return "Estado inválido: " + String(state) + ".";
  }
  const said = answer === undefined || answer === null ? null : text_line(answer, CHOICE) || null;
  if (said !== null && !task.choices.includes(said)) {
    return "A pendência " + task.id + " não tem a opção " + JSON.stringify(said) + ".";
  }
  // a task of Unii's (P6): the user tells it to close it ("Pode fechar",
  // done) or asks after it in its thread ("Cobrar agora"); not dropped
  const theirs = task.assignee !== "user" && task.state === "open";
  // an order received (the evidence round): it closes only with the
  // evidence of its execution, by Unii; the user may cancel it (dropped)
  const ordered = task_ordered(task);
  if (ordered && to === "done") {
    return said === null || said === task.order?.answer ? null : "A pendência " + task.id + " já é uma ordem sua recebida pelo Unii (" + (task.order?.answer ?? "") + "): ela só fecha com a evidência da execução. Para mudar a ordem, cancele-a. Nada foi alterado.";
  }
  if (theirs && to === "dropped" && !ordered) {
    return "A pendência " + task.id + " está com o Unii: use “Cobrar agora” ou “Pode fechar”. Nada foi alterado.";
  }
  const typed = note === undefined || note === null ? null : text_body(note, NOTE) || null;
  const comment = theirs && to === "done" && typed === null ? CLOSE : ordered && to === "dropped" && typed === null ? CANCEL : typed;
  const waits = Deps.waits(s.tasks, task);
  if (to !== "open" && task.state === "open" && waits.length > 0) {
    return "A pendência " + task.id + " aguarda " + waits.join(", ") + ": resolva " + (waits.length === 1 ? "essa pendência" : "essas pendências") + " antes. Nada foi alterado.";
  }
  if (to === "open") {
    if (task.state === "open") {
      return null;
    }
    if (s.tasks.filter((t) => t.state === "open").length >= OPEN) {
      return "Há " + OPEN + " pendências abertas, o máximo: conclua alguma antes.";
    }
    return task_put(s, task, { ...task, state: "open", answer: null, note: comment, answers: null, evidence: [], order: null, status: "open", status_why: null, unblock: null }, now, false);
  }
  const draft = to === "done" ? values_merge(task, values) : task.draft;
  if (typeof draft === "string") {
    return draft + " Nada foi alterado.";
  }
  const missing = to === "done" && task.state === "open" && !theirs ? fields_missing(task, draft) : [];
  if (missing.length > 0) {
    return "Responda " + (missing.length === 1 ? "o campo obrigatório" : "os campos obrigatórios") + " da pendência " + task.id + " antes de concluir: " + missing.map((f) => "“" + f.label + "”").join(", ") + ". Nada foi alterado.";
  }
  const answers = to === "done" && task.fields.length > 0 ? values_clean(task.fields, draft) : null;
  if (task.state === to && task.answer === said && (comment === null || comment === task.note) && JSON.stringify(task.answers) === JSON.stringify(answers ?? task.answers)) {
    return null;
  }
  const at = new Date(now).toISOString();
  // a choice that's an order to Unii: not closed, an order received,
  // Unii's from now on, till it closes it with evidence of the execution
  if (to === "done" && task.state === "open" && !theirs && said !== null && task_act(task, said) === "unii") {
    return task_put(s, task, { ...task, state: "open", assignee: "unii", order: { answer: said, note: comment, at }, answer: said, note: comment ?? task.note, draft, answers: answers ?? task.answers, talk: null, status: "open", status_why: null, unblock: null, next_step: ORDER_STEP + said, next_due: null }, now, false);
  }
  // the user's resolution is its own evidence: what they picked, said
  const evidence: Evidence[] = [{ type: "user", at, answer: to === "done" ? said : null, note: comment }];
  return task_put(s, task, { ...task, state: to, answer: to === "done" ? said : null, note: comment ?? task.note, draft, answers: to === "done" ? (answers ?? task.answers) : null, talk: null, evidence, status: "open", status_why: null, unblock: null, next_step: null, next_due: null }, now, false);
}

// a task closed by the system itself (done), with its own evidence (a
// restart the user ordered: Server.ts Chat.back); null: none such, or
// not open
export function task_close_system(s: Store, id: string, evidence: Evidence[], now: number): Task | null {
  const task = task_find(s, id);
  if (task === null || task.state !== "open") {
    return null;
  }
  return task_put(s, task, { ...task, state: "done", evidence, talk: null, status: "open", status_why: null, unblock: null, next_step: null, next_due: null }, now, true);
}

// whether a change moves a task on: anything but its agent (linking,
// unlinking or swapping the agent on it alone doesn't: how long it
// stalled goes on)
export function task_moves(task: Task, next: Task): boolean {
  return JSON.stringify({ ...task, agent: null }) !== JSON.stringify({ ...next, agent: null });
}

// a change kept: stamped (a close: its time; moved, unless it's of the
// agent alone: task_moves); told: true, Unii's own change of state;
// false, the user's, stamped with the next version; null, Unii's other
// edits, told and rev as they were. The closed archived, saved. Others
// it frees, or makes wait again: tasks_freed
function task_put(s: Store, task: Task, next: Task, now: number, told: boolean | null): Task {
  const at = new Date(now).toISOString();
  const closes = next.state !== "open" && task.state === "open";
  const was = Deps.blocked_ids(s.tasks);
  next.moved = task_moves(task, next) ? at : (task.moved ?? task.changed);
  // the user's to act on from now (opened again, or handed to them): its
  // lateness counts from here (TaskDeps.ready_at)
  // (a wait outside the list ended counts too: P85, the wait isn't late)
  const handed = next.state === "open" && next.assignee === "user" && (task.state !== "open" || task.assignee !== "user" || (Deps.outside_wait(task) && !Deps.outside_wait(next)));
  next.ready = handed ? at : Deps.ready_at(task);
  next.changed = at;
  next.closed = next.state === "open" ? null : closes ? at : (task.closed ?? at);
  // who closed it: told false is the user's act (task_resolve), else
  // Unii's (task_edit); kept while the close itself doesn't change
  const reclosed = closes || next.state !== task.state || next.answer !== task.answer;
  next.closed_by = next.state === "open" ? null : reclosed ? (told === false ? "user" : "unii") : (task.closed_by ?? null);
  next.told = told ?? task.told;
  next.freed = told === null ? task.freed : false;
  next.heard = told === null ? task.heard : told ? null : { state: next.state, answer: next.answer, note: next.note, answers: next.answers, ...(task_ordered(next) && !task_ordered(task) ? { order: true } : {}) };
  if (told === false) {
    s.rev += 1;
    next.rev = s.rev;
  }
  s.tasks[s.tasks.indexOf(task)] = next;
  tasks_freed(s, was, next.id, at);
  tasks_archive(s, now);
  tasks_save(s);
  return next;
}

// after a change (to the task `by`): each open task that waited (was:
// the blocked before) and waits no more is freed, a change to tell
// (stamped with the next version), but by: Unii changed it itself; each
// that waits again before its being freed was told, that change undone.
// One that waits no more (by itself too) is to act on from `at` (ready)
function tasks_freed(s: Store, was: Set<string>, by: string, at: string): void {
  const now = Deps.blocked_ids(s.tasks);
  for (const t of s.tasks) {
    if (t.state !== "open") {
      continue;
    }
    if (was.has(t.id) && !now.has(t.id)) {
      t.ready = at;
    }
    if (was.has(t.id) && !now.has(t.id) && t.id !== by) {
      s.rev += 1;
      t.rev = s.rev;
      t.told = false;
      t.freed = true;
    } else if (!was.has(t.id) && now.has(t.id) && t.freed && !t.told) {
      t.told = true;
      t.freed = false;
    }
  }
}

// the user's answers to an open task's fields (by id), kept as a draft:
// no turn, no change told; else why not (the user's words)
export function task_draft(s: Store, id: unknown, values: unknown): Task | string {
  const task = task_find(s, id);
  if (task === null) {
    return "Pendência " + task_id(id) + " não encontrada.";
  }
  if (task.state !== "open") {
    return "A pendência " + task.id + " já foi resolvida: reabra-a para mudar as respostas.";
  }
  if (task.fields.length === 0) {
    return "A pendência " + task.id + " não tem campos.";
  }
  const draft = values_merge(task, values);
  if (typeof draft === "string") {
    return draft;
  }
  const next = { ...task, draft };
  s.tasks[s.tasks.indexOf(task)] = next;
  tasks_save(s);
  return next;
}

// a message of the chat about a task (its thread's): marked with it, so
// Unii, and the chat's memory, know what it's about
export function task_mark(t: Task, text: string): string {
  return "[Pendência " + t.id + ": “" + t.title + "”]\n\n" + text;
}

// a message in a thread: kept, the newest THREAD; whose turn it is next
function task_talk(s: Store, task: Task, who: Who, text: string, now: number, none = false): Task {
  const said: Talk = { who, text, at: new Date(now).toISOString(), ...(none && who === "unii" ? { none: true as const } : {}) };
  const thread = [...task.thread, said].slice(-THREAD);
  const next: Task = { ...task, thread, talk: task.state !== "open" ? null : who === "user" ? "unii" : "user" };
  s.tasks[s.tasks.indexOf(task)] = next;
  tasks_save(s);
  return next;
}

// the user writes in an open task's thread (not a resolution: a talk);
// it now waits for Unii; else why not (the user's words)
export function task_say(s: Store, id: unknown, text: unknown, now: number): Task | string {
  const task = task_find(s, id);
  if (task === null) {
    return "Pendência " + task_id(id) + " não encontrada.";
  }
  if (task.state !== "open") {
    return "A pendência " + task.id + " já foi resolvida: reabra-a para conversar sobre ela.";
  }
  const said = text_body(text, TALK + 1);
  if (said === "") {
    return "Escreva uma mensagem.";
  }
  if (said.length > TALK) {
    return "Mensagem longa demais: no máximo " + TALK + " caracteres.";
  }
  return task_talk(s, task, "user", said, now);
}

// Unii replies in a task's thread (task_reply): the user's turn, if open
export function task_reply(s: Store, id: unknown, text: unknown, now: number): Task | string {
  const task = task_find(s, id);
  if (task === null) {
    return "No task " + task_id(id) + ".";
  }
  const said = text_body(text, TALK);
  if (said === "") {
    return "A reply needs a text.";
  }
  return task_talk(s, task, "unii", said, now);
}

// a turn ended: each task still waiting for Unii gets its last reply
// (reply; null: none, said so; failed: the turn's error, said with it,
// so the thread doesn't send the user to look for a reply that isn't
// there) in its thread, and it's the user's turn. With no reply, the
// message is marked none (Talk.none): the views say "Unii não
// respondeu", not a plain "sua vez" as if Unii had answered, and
// Unii's next turn sees the user's message still unanswered (task_line)
export function tasks_talked(s: Store, reply: string | null, now: number, failed: string | null = null): Task[] {
  const none = failed === null || failed.trim() === "" ? "O Unii não respondeu aqui; veja a conversa principal." : "O Unii não conseguiu responder (" + failed.trim() + "). Escreva de novo aqui para tentar outra vez.";
  const missed = reply === null || text_body(reply, TALK) === "";
  const text = missed ? text_body(none, TALK) : text_body(reply, TALK);
  return s.tasks.filter((t) => t.talk === "unii").map((t) => task_talk(s, t, "unii", text, now, missed));
}

// the user's changes Unii hasn't seen, oldest first
export function tasks_untold(s: Store): Task[] {
  return s.tasks.filter((t) => !t.told).sort((a, b) => a.rev - b.rev || a.changed.localeCompare(b.changed));
}

// those changes seen: told, saved (a change since, at another rev, stays
// to tell); shown: rev by id, those the last block showed by default
export function tasks_told(s: Store, shown: Map<string, number> = s.shown): number {
  const told = s.tasks.filter((t) => !t.told && shown.get(t.id) === t.rev);
  told.forEach((t) => {
    t.told = true;
    t.heard = null;
  });
  if (told.length > 0) {
    tasks_save(s);
  }
  return told.length;
}

// every untold change by the user told now (it went in a message); a
// freeing isn't the user's: the block of the turn that message starts
// tells it
export function tasks_tell(s: Store): Task[] {
  const all = tasks_untold(s).filter((t) => !t.freed);
  tasks_told(s, new Map(all.map((t) => [t.id, t.rev])));
  return all;
}

// Showing
// =======

// the open ones free to resolve, as "Agora" sorts them (P3,
// TaskDeps.now_order: priority, then how many it frees, then the one to act on longest (ready_at),
// then by id); then the open that wait, by id; then the closed, newest
// first
export function tasks_sort(tasks: Task[]): Task[] {
  const num = (t: Task) => Number(t.id.slice(1));
  const waiting = Deps.blocked_ids(tasks);
  const free = tasks.filter((t) => t.state === "open" && !waiting.has(t.id)).sort(Deps.now_order(tasks));
  const open = [...free, ...tasks.filter((t) => waiting.has(t.id)).sort((a, b) => num(a) - num(b))];
  const closed = tasks.filter((t) => t.state !== "open").sort((a, b) => (b.closed ?? "").localeCompare(a.closed ?? ""));
  return [...open, ...closed];
}

// what views get: the open ones, then at most VIEW closed in RECENT
export function tasks_view(s: Store, now: number): Task[] {
  const all = tasks_sort(s.tasks);
  const open = all.filter((t) => t.state === "open");
  const closed = all.filter((t) => t.state !== "open" && now - Date.parse(t.closed ?? t.changed) <= RECENT).slice(0, VIEW);
  // each with when its next step is due, by the server's setting (the
  // views never read it: TaskDeps.due_at)
  return [...open, ...closed].map((t) => ({ ...t, due: Deps.due_at({ ...t, due: undefined }), ...(t.thread.length > VIEW_TALK ? { thread: t.thread.slice(-VIEW_TALK) } : {}) }));
}

// how long ago: "5m", "3h", "2d"
export function ago(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  return ms < 3600000 ? Math.floor(ms / 60000) + "m" : ms < DAY ? Math.floor(ms / 3600000) + "h" : Math.floor(ms / DAY) + "d";
}

// a resolution as the chat reads it: "Pendência P7 concluída pelo
// usuário: “título”. Resposta: sim. Comentário: “pode”."
export function task_said(t: Task): string {
  if (t.freed && t.state === "open") {
    return "Pendência " + t.id + " liberada: “" + t.title + "”. As pendências de que dependia (" + t.after.join(", ") + ") foram resolvidas.";
  }
  const ordered = task_ordered(t);
  const answer = t.answer === null ? "" : " Resposta: " + t.answer + "." + (ordered ? " Essa opção é uma ordem: cabe ao Unii executá-la; a pendência fica com o Unii e só fecha com a evidência da execução." : "");
  const answers = t.state === "done" || ordered ? values_said(t.fields, t.answers) : "";
  const note = t.note === null ? "" : " Comentário: “" + t.note + "”.";
  const how = ordered ? "recebida como ordem do usuário" : SAID[t.state] + " pelo usuário";
  return "Pendência " + t.id + " " + how + ": “" + t.title + "”." + answer + (answers === "" ? "" : " Respostas: " + answers + ".") + note;
}

// resolutions already said by their notes (each without go has one), as
// the batch's message names them (Server.ts Chat.tell_soon): each id,
// how and its answer, not the title, the fields or the comment again
// (R4: the batch half as long, the notes holding the whole)
export function tasks_noted_said(tasks: Task[]): string {
  const one = (t: Task) => t.id + " " + (task_ordered(t) ? "recebida como ordem" : SAID[t.state]) + (t.answer === null ? "" : " (" + t.answer + (task_ordered(t) ? ", ordem ao Unii: só fecha com evidência da execução" : "") + ")");
  return "O usuário resolveu, como dizem as notas acima: " + tasks.map(one).join("; ") + ".";
}

// a task as a line of the tasks tool or the block (all: the list it's
// of, for whom it waits and frees; none given, those not said)
export function task_line(t: Task, now: number, whole = false, all: Task[] | null = null): string {
  const waits = all === null ? [] : Deps.waits(all, t);
  const frees = all === null ? [] : Deps.frees_direct(all, t);
  const deps = (waits.length === 0 ? "" : " waits for " + waits.join(", ")) + (frees.length === 0 ? "" : " frees " + frees.join(", ")) + (all === null && t.after.length > 0 ? " after " + t.after.join(", ") : "");
  const rec = (f: Field) => (f.recommend === undefined ? "" : ", recommended: " + (Array.isArray(f.recommend) ? f.recommend.join(" + ") : f.recommend));
  const kind = (f: Field) => f.kind + (f.kind === "choice" || f.kind === "multi" ? ": " + f.choices.join(" | ") : "") + rec(f);
  const fields = t.fields.length === 0 ? "" : " fields: " + t.fields.map((f) => f.id + (f.required ? "*" : "") + " " + JSON.stringify(f.label) + " (" + kind(f) + ")").join("; ");
  const talk = t.talk === "unii" ? " [the user wrote in its thread: reply with task_reply]" : Deps.task_missed(t) ? " [your turn ended with no reply to the user's message in its thread: reply with task_reply]" : "";
  const acted = Object.entries(t.acts ?? {}).filter(([, a]) => a === "unii").map(([c]) => c);
  const opts = (t.choices.length === 0 ? "" : " options: " + t.choices.join(" | ") + (t.recommend == null ? "" : " (recommended: " + t.recommend + ")") + (acted.length === 0 ? "" : " (you act on: " + acted.join(" | ") + ")")) + fields + deps + talk;
  const st = Deps.status_of(t);
  const round = [
    task_ordered(t) ? "ORDER received: " + JSON.stringify(t.order!.answer) + " (execute it; close it done only with evidence of the execution)" : "",
    st === "open" ? "" : "status " + st + ": " + JSON.stringify(t.status_why ?? "") + (st === "blocked" ? " unblock: " + JSON.stringify(t.unblock ?? "") : ""),
    // what makes it done and its next step: in its whole line; overdue
    // in any
    !whole || (t.done_when ?? null) === null ? "" : "done when " + JSON.stringify(t.done_when),
    !whole || (t.next_step ?? null) === null ? "" : "next " + JSON.stringify(t.next_step),
    Deps.overdue_ms(all ?? [t], t, now) > 0 ? "OVERDUE since " + Deps.due_at(t) : !whole || Deps.due_at(t) === null ? "" : "due " + Deps.due_at(t),
    t.state === "open" ? "" : task_unproven(t) ? "NO EVIDENCE (sem evidência)" : "evidence: " + (t.evidence ?? []).map(Ev.evidence_line).join("; "),
  ].filter((x) => x !== "");
  const tail = [...round, t.ref === null ? "" : "ref " + t.ref, t.origin === null ? "" : "from " + t.origin + (t.origin_url === null ? "" : " " + t.origin_url), (t.agent ?? null) === null ? "" : "agent " + t.agent, t.kind == null ? "" : "kind " + t.kind, Deps.priority_of(t) === "normal" ? "" : "priority " + Deps.priority_of(t), (t.waits_for ?? null) === null ? "" : "waits for " + JSON.stringify(t.waits_for), ...(t.prs ?? []).map(pr_line), ago(t.made, now)].filter((x) => x !== "").join(", ");
  const how   = [t.state, t.answer === null ? "" : "answer: " + t.answer, t.note === null ? "" : "note: " + JSON.stringify(t.note)].filter((x) => x !== "");
  const state = t.state === "open" ? "" : " (" + how.join(", ") + ")";
  const head = "- " + t.id + " [" + t.assignee + "] " + t.title + state + opts + " (" + tail + ")";
  if (!whole) {
    return head;
  }
  const answers = values_said(t.fields, t.state === "done" ? t.answers : t.draft);
  const more = [
    t.detail,
    answers === "" ? "" : (t.state === "done" ? "answers: " : "draft (not sent yet): ") + answers,
    t.thread.length === 0 ? "" : "thread (" + (t.talk === "unii" ? "waiting for your reply" : t.talk === "user" ? (Deps.task_missed(t) ? "your turn ended with no reply here: the user still waits for one" : Deps.user_move(t, all === null ? new Set<string>() : Deps.blocked_ids(all)) ? "the user's turn" : "you replied; the next step is yours, not the user's") : "quiet") + "):\n" + t.thread.slice(-VIEW_TALK).map((m) => (m.who === "user" ? "user: " : "you: ") + m.text).join("\n"),
  ].filter((x) => x !== "");
  return more.length === 0 ? head : head + "\n  " + more.join("\n").replace(/\n/g, "\n  ");
}

// a pull request as a task's line says it: "pr <link> @<head> <verdict> by
// <verifier>, notes 1 high 2 low, untested 3"
export function pr_line(p: PrCheck): string {
  const count = (["high", "medium", "low"] as Sev[]).map((v) => [v, p.notes.filter((n) => n.sev === v).length] as const).filter(([, n]) => n > 0).map(([v, n]) => n + " " + v);
  return ["pr " + p.url + " @" + p.head.slice(0, 12) + " " + p.verdict, p.verifier === null ? "" : "by " + p.verifier, count.length === 0 ? "" : "notes " + count.join(" "), p.untested.length === 0 ? "" : "untested " + p.untested.length].filter((x) => x !== "").join(" ");
}

// the tasks tool: the open ones (all: and those closed lately), or those
// of a ref, or one whole
export function tasks_list(s: Store, args: { all?: unknown; ref?: unknown; id?: unknown; unproven?: unknown }, now: number): string {
  if (args.unproven === true || args.unproven === "true") {
    const none = tasks_sort(s.tasks).filter(task_unproven);
    return none.length === 0 ? "No closed task without evidence." : "Closed without evidence (sem evidência; give it with task_edit evidence, or open it again):\n" + none.map((t) => task_line(t, now)).join("\n");
  }
  if (args.id !== undefined) {
    const t = task_find(s, args.id);
    return t === null ? "No task " + task_id(args.id) + "." : task_line(t, now, true);
  }
  const all = args.all === true || args.all === "true";
  const ref = args.ref === undefined ? null : String(args.ref).toLowerCase();
  const shown = (all ? tasks_view(s, now) : tasks_sort(s.tasks).filter((t) => t.state === "open")).filter((t) => ref === null || (t.ref ?? "").toLowerCase().includes(ref));
  if (shown.length === 0) {
    return all ? "No tasks." : "No open tasks.";
  }
  const waiting = Deps.blocked_ids(s.tasks);
  const line = (t: Task) => task_line(t, now, true, s.tasks);
  const free = shown.filter((t) => !waiting.has(t.id));
  const wait = shown.filter((t) => waiting.has(t.id));
  return [...free.map(line), ...(wait.length === 0 ? [] : ["Waiting for other tasks (hidden from the user until freed):", ...wait.map(line)])].join("\n");
}

// a turn's block: what the user changed since the last turn, then the
// open ones (the newest LINES), each a line; "" if neither. What it shows
// is kept, to be told once the call ends well (Tasks.told)
export function tasks_block(s: Store, now: number): string {
  const changed = tasks_untold(s);
  const open = tasks_sort(s.tasks).filter((t) => t.state === "open");
  s.shown = new Map(changed.map((t) => [t.id, t.rev]));
  if (changed.length === 0 && open.length === 0) {
    return "";
  }
  const waiting = Deps.blocked_ids(s.tasks);
  const did = (t: Task) => {
    if (t.freed && t.state === "open") {
      return "- " + t.id + " freed: every task it waited for (" + t.after.join(", ") + ") is closed; the user sees it now: " + JSON.stringify(t.title);
    }
    const h = t.heard ?? { state: t.state, answer: t.answer, note: t.note };
    if (h.order === true && task_ordered(t)) {
      const said = values_said(t.fields, h.answers === undefined ? t.answers : h.answers);
      return "- " + t.id + " ORDERED by user: " + JSON.stringify(t.title) + " — answer: " + h.answer + (said === "" ? "" : " — fields: " + said) + (h.note === null ? "" : " — note: " + JSON.stringify(h.note)) + " (an order: execute it now; it stays open as yours until you close it with task_edit state done and evidence of the execution)";
    }
    const what = h.state === "open" ? "reopened" : h.state;
    const answer = h.answer === null ? "" : " — answer: " + h.answer + (h.state === "done" && task_act(t, h.answer) === "unii" ? " (an order: you act on it now)" : "");
    const note = h.note === null ? "" : " — note: " + JSON.stringify(h.note);
    const said = h.state === "done" ? values_said(t.fields, h.answers === undefined ? t.answers : h.answers) : "";
    const answers = said === "" ? "" : " — fields: " + said;
    const since = h.state === t.state ? "" : " — since then you made it " + t.state;
    return "- " + t.id + " " + what + " by user: " + JSON.stringify(t.title) + answer + answers + note + since;
  };
  const newest = tasks_sort([...open].sort((a, b) => b.made.localeCompare(a.made)).slice(0, LINES));
  const free = newest.filter((t) => !waiting.has(t.id));
  const wait = newest.filter((t) => waiting.has(t.id));
  const line = (t: Task) => task_line(t, now, false, s.tasks);
  const late = Deps.overdue_ids(s.tasks, now);
  const lines = [
    "Tasks (your pending list; the user sees it beside the chat and resolves items there):",
    ...(late.length === 0 ? [] : ["OVERDUE (yours, past their next step's due; the user was alerted): " + late.join(", ") + ". Do the step, or give a new next_step and next_due, or set status blocked/waiting_user, or close with evidence."]),
    ...(changed.length === 0 ? [] : ["Changed since your last turn (by the user, or freed):", ...changed.map(did)]),
    ...(open.length === 0 ? ["Open: none."] : ["Open (" + (open.length - waiting.size) + "; those that free others first, then the user's):", ...free.map(line)]),
    ...(wait.length === 0 ? [] : ["Waiting for other tasks (" + waiting.size + "; hidden from the user until freed):", ...wait.map(line)]),
    ...(open.length > LINES ? ["+" + (open.length - LINES) + " older (the tasks tool lists them)"] : []),
  ];
  return lines.join("\n") + "\n\n";
}

// Promises
// ========
// What Unii says it will do later ("vou revisar", "em seguida eu
// assino", "I'll check") is a task of its own, or it ends in limbo (the
// evidence round): a turn whose last reply promises with no task of
// Unii's made or moved in it gets a note (Server.ts Chat.promised).

// a promise: "vou"/"irei"/"vamos" and a verb (an infinitive: -ar, -er,
// -ir, -or, with a pronoun or not), "em seguida", "depois eu", "I'll"
const PROMISE = /(?:^|[^\p{L}])((?:(?:eu|n[óo]s)\s+)?(?:vou|irei|vamos|iremos)\s+(?:(?:j[áa]|logo|agora|depois|ainda|tamb[ée]m)\s+)?(?:(?:te|lhe|o|a|os|as|me|se)\s+)?[\p{L}]+(?:ar|er|ir|or|[áéíô]-l[oa]s?|-l[oa]s?|-lhe|-me|-se)\b[^.!?\n]{0,80}|em seguida[^.!?\n]{0,80}|depois eu\s[^.!?\n]{0,80}|\bI(?:'ll| will)\s+[a-z]+[^.!?\n]{0,80})/giu;
// what reads as a promise but isn't one: past or present, a question, a
// condition ("se quiser, vou..."), what's done in the turn already
const NOT_PROMISE = /^(?:vou\s+(?:bem|indo)|vamos\s+l[áa])\b/i;

// the promises in a text (each a phrase, at most 3), outside code
export function promises_in(text: string): string[] {
  const plain = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, "…").replace(/^>.*$/gm, " ");
  const out: string[] = [];
  for (const m of plain.matchAll(PROMISE)) {
    const said = text_line(m[1], 120);
    const before = plain.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 1);
    if (NOT_PROMISE.test(said) || /\b(?:se|caso)\s+(?:voc[êe]\s+)?(?:quiser|preferir|aprovar|concordar|mandar)\b[^.!?\n]*$/i.test(before) || /\?\s*$/.test(plain.slice(m.index ?? 0, (m.index ?? 0) + m[0].length + 2))) {
      continue;
    }
    if (!out.includes(said)) {
      out.push(said);
    }
    if (out.length >= 3) {
      break;
    }
  }
  return out;
}

// whether any task of Unii's was made or moved since `since` (ms); with
// the promises said, only one related to them: its id said in one, or a
// word of one in its title, detail, next step or done when, whole
// (4 letters or more, no accents, not a filler nor a word any task may
// have, as "pendência", "infra" or a verb of action in any form,
// "revisar", "atualizo", "verificação": PROMISE_GENERIC). Whole:
// "infraestrutura" isn't "infra" (the note asks for a task then:
// harmless). A heuristic: a task registered for the
// promise in other words isn't seen, and one sharing a distinct word by
// chance hides a promise (rare: the words must be in the same turn).
// The ref isn't compared (NeatFinch): it's a project's or a channel's
// name any task of it has ("slack", "fractal-ritsu"), so "Vou ajustar o
// slack" would relate any task with ref slack. Limits, known: a verb out
// of PROMISE_GENERIC relates ("Vou documentar o fluxo" a task saying
// "documentar"), and so does a common noun ("fluxo", "serviço") a task
// shares by chance: the note is then missed, never wrongly given
export function tasks_moved_since(s: Store, since: number, said: string[] | null = null): boolean {
  const moved = s.tasks.filter((t) => t.assignee !== "user" && (Date.parse(t.made) >= since || Date.parse(t.moved ?? t.changed) >= since));
  if (said === null) {
    return moved.length > 0;
  }
  const keys = new Set(said.flatMap(promise_words));
  const ids = new Set(said.flatMap((x) => (x.match(/\bP\d{1,15}\b/g) ?? [])));
  return moved.some((t) => ids.has(t.id) || [t.title, t.detail, t.next_step, t.done_when].some((x) => typeof x === "string" && promise_words(x).some((w) => keys.has(w))));
}

// what reads as no subject of a promise: its fillers, in Portuguese and
// English (already without accents)
const PROMISE_FILLER = new Set(["agora", "ainda", "depois", "seguida", "tambem", "logo", "isso", "isto", "esse", "essa", "este", "esta", "aquilo", "para", "pelo", "pela", "sobre", "como", "voce", "vamos", "iremos", "irei", "fazer", "fazendo", "feito", "quando", "mais", "will", "then", "that", "this", "with", "later", "after", "soon"]);

// what any task may say, so relates none to a promise (already without
// accents)
const PROMISE_GENERIC = new Set([
  "pendencia", "pendencias", "tarefa", "tarefas", "infra", "item", "itens", "coisa", "coisas", "assunto", "task", "tasks", "issue", "issues", "todo", "todos",
  // verbs of action any task may start with, and their forms: a promise
  // to "atualizar o serviço" isn't the task "Atualizar documentação"
  ...promise_verbs(["atualiz", "verific", "revis", "corrig", "corrij", "confer", "respond", "analis", "investig", "implement", "test", "valid", "ajust", "resolv", "termin", "conclu", "finaliz", "cri", "abr", "fech", "envi", "mand", "registr", "olh", "cheg", "cobr", "acompanh", "rod", "execut", "aplic", "mescl", "junt", "trat", "prepar", "redig", "escrev", "faz", "fiz", "ver", "vej", "ler", "le", "leio", "lend", "checar", "chec", "reinici", "retom", "continu", "segu", "busc", "procur", "confirm", "avis", "pergunt", "pedi", "ped"]),
  "correcao", "correcoes", "resposta", "respostas", "conclusao", "envio", "envios",
  "update", "updates", "updating", "check", "checks", "checking", "review", "reviews", "reviewing", "verify", "verifying", "send", "sending", "answer", "reply", "look", "read", "write", "test", "tests", "testing", "open", "close", "merge", "apply", "run", "handle", "resolve", "finish", "start",
]);

// a verb's forms from its stems (no accents): the infinitive and the
// usual inflections of the first, second and third conjugations
function promise_verbs(stems: string[]): string[] {
  const ends = ["ar", "er", "ir", "o", "a", "e", "as", "es", "am", "em", "ei", "ou", "ao", "amos", "emos", "imos", "ando", "endo", "indo", "ado", "ada", "ados", "adas", "ido", "ida", "idos", "idas", "arei", "erei", "irei", "ara", "era", "ira", "arao", "erao", "irao", "aria", "eria", "iria", "acao", "acoes", "icao", "icoes", "isao", "isoes", "ao", "oes", "ia", "ias"];
  return stems.flatMap((s) => [s, ...ends.map((e) => s + e)]).filter((w) => w.length >= 4);
}

// a text's words as compared (no accents, lower, whole, 4 letters or
// more, not a filler nor generic)
function promise_words(text: string): string[] {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !PROMISE_FILLER.has(w) && !PROMISE_GENERIC.has(w));
}

// the note a promise without a task gets (the user's language)
export function promises_said(said: string[]): string {
  return "Compromisso sem pendência: o Unii disse " + said.map((x) => "“" + x + "”").join(", ") + " e não registrou nem atualizou, neste turno, nenhuma pendência sua ligada " + (said.length === 1 ? "a ele" : "a eles") + ". Unii: registre-" + (said.length === 1 ? "o" : "os") + " com task_add (assignee unii, next_step e next_due) ou diga que não vai " + (said.length === 1 ? "fazê-lo" : "fazê-los") + ".";
}

// Questions
// =========
// What Unii asks of the user (a question, a decision, an order to give)
// is a task of the user's, or it ends lost in the chat (P87): a turn
// whose last reply asks the user something with no task of the user's
// about it gets a task of Unii's, "Pergunta sem pendência" (task_asked,
// P112: each sentence with the reply it came from, not in the user's
// "Agora"; Unii asks the user with a task of theirs, or closes it as a
// false alarm), made by the serve, and a note (Server.ts Chat.asked).
//
// A heuristic, in Portuguese (some English), on the reply outside code
// (``` blocks, `inline`), quotes (> lines, “…”, "…", «…») and headings
// (# lines). A sentence (its last clause, after ": ", for a question)
// asks if:
// - it ends in "?", unless: it's one Unii asks itself to answer (it
//   starts with a question word, "por que", "o que", "como", "qual",
//   "quando", "why", "what"…, and has no mark of the user, "você",
//   "quer", "prefere", "posso", "sua"…: ASK_YOU, nor of a choice,
//   "opção", "caminho": ASK_CHOICE; a bare "Qual?" asks); its subject is
//   another ("O Enzo quer que eu mescle?", "Alguém sabe…?": ASK_OTHER)
//   with no word to the user (ASK_DIRECT); it's rhetorical ("Você viu o
//   que houve? Foi o lint.": ASK_RHETORIC, with more said after it); it's
//   a lone word ("Não testado: hom?");
// - or, without "?", it asks in words: "quer que eu", "aguardo sua
//   ordem", "aguardando decisão", "me diga", "diga qual prefere", "você
//   decide", "preciso que você decida", "falta só a sua aprovação",
//   "depende de ordem (sua)", "se quiser, posso …", "quando quiser,
//   aplico", "pode confirmar o merge", "let me know", "should I"
//   (ASK_WORDS, ASK_START), or a short confirmation ("Ok?", "Vale?":
//   ASK_CONFIRM); one about another's ("depende de ordem do Enzo",
//   "aguardando resposta do Enzo") doesn't, nor one negated just before
//   it ("Não depende de ordem sua.", "Nenhum agente depende de ordem.":
//   ASK_NEGATION), but one on the order of the user's name (config
//   owner_name: "Depende da ordem do Guilherme.") does; nor "me avise
//   se/caso" on an event ("Me avise se falhar.", "Se falhar, me avise.":
//   ASK_NOTIFY_IF, ASK_NOTIFY_BEFORE; "Me avise caso aprove." asks), nor
//   "você decide" by contrast ("Ele não decide, você decide."), nor a
//   rule of Unii's ("PR, merge e reinício só quando você mandar.":
//   ASK_ONLY_WHEN, P112), while
//   "Falta só a sua aprovação." and "Não está ok?" ask (P87 #3);
// - but one reporting a question ("Enzo perguntou: …?", "Perguntei ao
//   Enzo se quer que eu mescle": ASK_REPORTED) only if it asks in words
//   too ("…, depende de ordem");
// - and a question tied to an open task of the user's by its id in the
//   same paragraph ("A P86 segue aberta: mesclo?") is that task's.
// Then (question_tasked) a question has its task if one of the user's,
// open, was made in the turn with words of it in its title or detail
// (stems of 5 letters: "mescle" is "Mesclar os três?"), or Unii said it
// in the thread of one in the turn; another task of the user's made,
// moved or answered in the turn, about something else, doesn't spare it.
// Limits, known: a rhetorical question said last, or put another way,
// counts (a needless task, which the user drops); a request in other
// words isn't seen; only the turn's last reply is read (Chat.reply: its
// trailing pages, at most 8), so a question in an earlier message of the
// turn, followed by tools, isn't; at most 3 questions per reply go in the
// task, the rest left out (the reply is in the chat still); a word in
// common with an unrelated task made in the turn spares a question (B4:
// "Revisar o hospitalar#700" spares "Quer que eu mescle o hospitalar?");
// a short phrase with "?" that isn't a question counts (B3: "Rodei x?
// ok." asks "Rodei x?"); "Me avise quando falhar." asks ("quando" isn't
// read as an event, P87 #4, B3).

// marks that a question is put to the user (no accents, lower, whole)
const ASK_YOU = /\b(?:voce|voces|vc|vcs|senhor|quer|queira|queres|prefere|prefira|posso|podemos|devo|devemos|deseja|desejas|confirma|confirme|autoriza|autorize|aprova|aprove|concorda|topa|pode|poderia|consegue|sigo|seguimos|mesclo|aplico|reinicio|fecho|envio|mando|abro|crio|faco|publico|respondo|ignoro|descarto|aguardo|seu|sua|seus|suas|te|lhe|contigo|you|your|shall|should i|can i|may i|que tal)\b/;
// a question about a choice ("Qual opção?"), the user's to make
const ASK_CHOICE = /\b(?:opcao|opcoes|alternativa|alternativas|caminho|caminhos)\b/;
// a bare question word, after options ("Qual?", "Qual delas?")
const ASK_BARE = /^(?:e\s+)?(?:qual|quais|which|which one)(?:\s+(?:delas|deles|das duas|dos dois|das tres|dos tres))?\s*\?+$/;
// a question word Unii's own questions start with
const ASK_SELF = /^(?:e\s+)?(?:por\s*que|porque|pq|o\s+que|que|como|qual|quais|quando|onde|aonde|quem|quanto|quantos|quantas|para\s+que|why|what|how|which|when|where|who)\b/;
// another's question reported ("Enzo perguntou: …?", "perguntei ao Enzo
// se…", "ele pergunta se"); not "pergunto se você…", which is Unii's
const ASK_REPORTED = /\bpergunt(?:ei|ou|aram|amos|ava|avam)\b[^.!?\n]{0,60}?(?:[:,]|\bse\b)|\bpergunta\s+(?:se|if)\b|\b(?:asked|asks)\b\s*(?:[:,]|if\b|whether\b)/;
// another as the subject (the sentence as written: a name after an
// article, "O Enzo"; or folded: "alguém", "ele"): not to the user
const ASK_OTHER_NAME = /^(?:[Ee]\s+)?(?:[OoAa]s?)\s+[A-ZÀ-Ý][a-zà-ÿ]/;
const ASK_OTHER = /^(?:e\s+)?(?:alguem|ninguem|someone|anyone|somebody|anybody|ele|ela|eles|elas)\b/;
// a word to the user, which makes another's subject the user's question
const ASK_DIRECT = /\b(?:voce|voces|vc|vcs|seu|sua|seus|suas|te|lhe|you|your)\b|\bme (?:diga|diz|avise|avisa|fale|fala|confirme|confirma|responda|responde|mande|manda|passe|passa)\b|\b(?:aguardo|aguardando|preciso)\b/;
// a rhetorical question, answered after it ("Você viu o que houve? Foi
// o lint.")
const ASK_RHETORIC = /^(?:e\s+)?(?:(?:voce|vc)\s+(?:ja\s+)?(?:viu|sabe|sabia|lembra|percebeu|notou|reparou|imagina|acredita|entende)|sabe|sabia|adivinha)\b/;
// what a request waits for (no accents, lower)
const ASK_WANT = "(?:ordem|decisao|resposta|confirmacao|aval|ok|retorno|escolha|aprovacao|autorizacao)";
// ... not another's: "decisão do Enzo"
const ASK_NOT_OTHERS = "(?! (?:d[oa]s?|de) )";
// an offer as a question in words: "quer que eu…" (not when reported:
// "perguntei ao Enzo se quer que eu…")
const ASK_OFFER = /(?:^|\b(?:voce|vc|voces|ou|e|se|entao|senao|mas)\s+|,\s*)(?:ainda |mesmo |realmente )?(?:quer|queira|prefere|prefira) que eu\b/;
// a request in words, without "?" (no accents, lower), counted even in a
// sentence that reports a question ("perguntei se mesclo (depende de
// ordem)")
const ASK_WORDS = new RegExp([
  "\\baguard(?:o|ando|amos)(?: a| o)? (?:sua|seu|tua|teu|suas|seus) ",
  "\\baguard(?:o|ando|amos)(?: a| o| uma| um)? " + ASK_WANT + "\\b" + ASK_NOT_OTHERS,
  "\\bfico no aguardo\\b",
  "\\bme (?:diga|diz|avise|avisa|fale|fala|confirme|confirma|responda|responde|mande|manda|passe|passa)\\b",
  "\\b(?:diga|digam|confirme|responda|escolha|decida|informe|indique)(?: me)? (?:se|qual|quais|quando|como|o que|onde|quanto)\\b",
  "(?:^|[,;:] ?|\\b(?:entao|mas|e|aqui) )(?:voce|vc) (?:que )?(?:decide|escolhe|manda|define)\\b",
  "\\b(?:a )?(?:decisao|escolha) (?:e|fica) (?:sua|tua)\\b|\\ba (?:seu|teu) criterio\\b",
  "\\bpreciso que (?:voce |vc )?(?:me )?(?:decida|escolha|confirme|aprove|autorize|responda|diga|mande|de|assine|aplique|mescle|reinicie|avise|libere|valide|revise|olhe|teste|rode)\\b",
  "\\bpreciso (?:da|de|do) (?:sua |seu |uma |um )?" + ASK_WANT + "\\b" + ASK_NOT_OTHERS,
  "\\bfalta(?:m)?(?: so| apenas| somente)?(?: a| o| as| os)? (?:sua|seu|suas|seus|tua|teu) ",
  "\\b(?:depende|dependem)(?: so| apenas)? (?:de|da|do) (?:uma |sua |tua )?" + ASK_WANT + "\\b" + ASK_NOT_OTHERS,
  "\\b(?:depende|dependem) de voce\\b",
  "\\bquem (?:decide|escolhe|define|manda|aprova|autoriza) (?:e|sera|vai ser) (?:voce|vc)\\b",
  "\\bcabe(?: so| apenas)? a (?:voce|vc|ti)\\b",
  "\\bse (?:voce )?(?:quiser|preferir|autorizar|mandar|aprovar|concordar)\\b[^.!?\\n]{0,40}\\b(?:posso|vou|faco|mesclo|sigo|abro|crio|aplico|reinicio|publico|envio|rodo|fecho|monto|preparo|deixo|mando|ajusto|corrijo)\\b",
  "\\bquando (?:voce |vc )?(?:quiser|preferir|puder|mandar|autorizar|liberar|der (?:o )?(?:ok|aval|sinal))\\b",
  "\\blet me know\\b|\\bshould i\\b|\\bwant me to\\b|\\bdo you want\\b",
].join("|"));
// ... each found, to see what comes before it
const ASK_WORDS_ALL = new RegExp(ASK_WORDS.source, "g");
// a negation just before a request (in its clause, at most 2 words
// before it): "Não depende de ordem sua.", "Isso não depende de você.",
// "Nenhum agente depende de ordem." ask nothing
const ASK_NEGATION = /\b(?:nao|nem|nunca|jamais|nenhum|nenhuma|nada|ninguem|not|no|never|nobody|nothing)\b/;
// a confirmation asked in a word or two ("Ok?", "Vale?", "Pode ser?")
const ASK_CONFIRM = /^(?:e\s+)?(?:ok|okay|vale|certo|beleza|blz|fechado|combinado|bora|pode ser|tudo bem|tudo certo|ta bom|ta certo|ta ok|de acordo|faz sentido|sim ou nao|right|alright|sounds good)\s*\?+$/;
// a request as the sentence starts: "Pode confirmar o merge", "Confirme"
const ASK_START = /^(?:por favor,? )?(?:(?:voce |vc )?(?:pode|poderia|podes|consegue|conseguiria) (?:me )?(?:confirmar|aprovar|autorizar|decidir|escolher|responder|dizer|avisar|mandar|dar|olhar|revisar|validar|assinar|aplicar|mesclar|rodar|testar|reiniciar|liberar|ver|checar)\b|(?:confirme|aprove|autorize|escolha|decida|responda|assine|diga)\b)/;

// the text as the heuristic reads it: outside code, quotes and headings
function ask_plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`[^`\n]*`/g, "…")
    .replace(/^\s*(?:>|#).*$/gm, "\n")
    .replace(/“[^”\n]*”|"[^"\n]*"|«[^»\n]*»/g, "…");
}

// a text as compared: no accents, lower
function ask_fold(x: string): string {
  return x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// the user's will or Unii's next step, after "se"/"caso" (no accents,
// lower; infinitive, indicative and subjunctive: "se aprovar", "caso
// aprove", "se quiser", "caso queira"): a request still; so are the
// will denied ("caso não queira", P87 #5, B3), a disagreement ("caso
// discorde", P87 #5, B2), a need or a liking ("caso precise de algo",
// "se não gostar", P87 #6, B1 and B2) and an act of the user's, with no subject
// before it ("Se mesclar, me avise.", P87 #5, B4: the user merges; "Se
// o CI falhar" has a subject, an event)
const ASK_WILL = "(?:voce\\s+|vc\\s+)?(?:nao\\s+)?(?:quiser|queira|quer|preferir|prefira|prefere|puder|possa|pode|decidir|decida|decide|escolher|escolha|escolhe|aprovar|aprove|aprova|autorizar|autorize|autoriza|concordar|concorde|concorda|mandar|mande|manda|liberar|libere|libera|discordar|discorde|discorda|precisar|precise|precisa|gostar|goste|gosta|gostaria|mesclar|mescle|aplicar|aplique|assinar|assine|publicar|publique|revisar|revise|validar|valide|confirmar|confirme|responder|responda|posso|podemos|devo|devemos)\\b";
// "me avise se falhar": an instruction to Unii, to tell on an event, not
// a request (P87 #3, B2); one on the user's will or Unii's next step
// still asks: "Me avise se quiser que eu mescle.", "Me avise se posso
// seguir.", "Me avise caso aprove." (P87 #4, B2), and a bare "Me avise."
// or "Me avise quando puder."
const ASK_NOTIFY_IF = new RegExp("^me (?:avise|avisa|fale|fala)\\s+(?:se|caso)\\s+(?!" + ASK_WILL + ")");
// the same with the condition before, in the clause just before the
// request: "Se falhar, me avise." tells on an event (P87 #4, B1); "Se
// quiser, me avise." still asks
const ASK_NOTIFY_BEFORE = new RegExp("^\\s*(?:e\\s+|mas\\s+)?(?:se|caso)\\s+(?!" + ASK_WILL + ")");
// "você decide" (a request of ASK_WORDS) told by contrast with another
// who doesn't, in the clause before: "Ele não decide, você decide." (P87
// #3, B1); "Não, você decide." still asks
const ASK_WHO_VERB = /\b(decide|escolhe|manda|define)\b/;
// "só" (no accents, lower) anywhere in the clause before a request on
// the user's will ("quando você mandar"): a rule Unii keeps ("PR, merge
// e reinício só quando você mandar.", "Só mesclo quando você mandar.",
// "Mesclo só quando você mandar.", P112), not a request; in another
// clause it limits something else ("Falta só o CI; mesclo quando você
// mandar." asks)
const ASK_ONLY_WHEN = /\b(?:so|somente|apenas|unicamente|exclusivamente)\b/;

// whether a sentence (folded) asks in words (ASK_WORDS), one request in
// it not negated just before (ASK_NEGATION), nor an instruction on an
// event (ASK_NOTIFY_IF, ASK_NOTIFY_BEFORE), nor "você decide" in
// contrast (ASK_WHO_VERB)
function ask_in_words(s: string): boolean {
  for (const m of s.matchAll(ASK_WORDS_ALL)) {
    let at = m.index;
    while (at < s.length && !/[a-z0-9]/.test(s[at] ?? "")) {
      at++;
    }
    const parts = s.slice(0, at).split(/[,;:()]/);
    const clause = parts.pop() ?? "";
    const before = (clause.match(/[a-z0-9]+/g) ?? []).slice(-2).join(" ");
    if (ASK_NEGATION.test(before) || ASK_NOTIFY_IF.test(s.slice(at))) {
      continue;
    }
    // a rule of Unii's, not a request: "PR, merge e reinício só quando
    // você mandar.", "Só mesclo quando você mandar." (P112); "Mesclo
    // quando você mandar." still asks
    if (/^quando\b/.test(s.slice(at)) && ASK_ONLY_WHEN.test(clause)) {
      continue;
    }
    if (/^me (?:avise|avisa|fale|fala)\b/.test(s.slice(at)) && clause.trim() === "" && ASK_NOTIFY_BEFORE.test(parts[parts.length - 1] ?? "")) {
      continue;
    }
    const verb = /^(?:voce|vc) (?:que )?/.test(s.slice(at)) ? ASK_WHO_VERB.exec(m[0])?.[1] : undefined;
    const prev = parts.pop() ?? "";
    if (verb !== undefined && new RegExp("\\b(?:nao|nem|nunca|jamais)\\s+(?:[a-z]+\\s+)?" + verb + "\\b").test(prev)) {
      continue;
    }
    return true;
  }
  return false;
}

// a sentence (folded) with the user's names (`names`, as said: "do
// Guilherme") as the user ("sua"): "Depende da ordem do Guilherme." is
// a request to the user, "depende de ordem do Enzo" isn't
function ask_owner(s: string, names: string[]): string {
  let out = s;
  for (const name of names) {
    const n = ask_fold(name).trim().replace(/[^a-z0-9 ]/g, "");
    if (n.length >= 2) {
      out = out.replace(new RegExp("\\b(?:d[oa]s?|de) " + n.replace(/ +/g, " +") + "\\b", "g"), "sua");
    }
  }
  return out;
}

// whether a sentence (`raw`, as written) asks the user something; `more`:
// more is said after it in its paragraph; `names`: the user's
function ask_one(raw: string, more: boolean, names: string[] = []): boolean {
  const s = ask_owner(ask_fold(raw), names);
  if (ASK_REPORTED.test(s)) {
    return ask_in_words(s);
  }
  // its last clause: "A P86 segue aberta: mesclo?" asks "mesclo?"
  const cut = raw.lastIndexOf(": ");
  const raw_c = cut < 0 ? raw : raw.slice(cut + 2).trim();
  const c = ask_fold(raw_c);
  if ((ASK_OTHER_NAME.test(raw_c) || ASK_OTHER.test(c)) && !ASK_DIRECT.test(c)) {
    return false;
  }
  if (/\?\s*$/.test(c)) {
    if (ASK_BARE.test(c) || ASK_CHOICE.test(c) || ASK_CONFIRM.test(c)) {
      return true;
    }
    if (ASK_RHETORIC.test(c) && more) {
      return false;
    }
    if ((c.match(/[a-z0-9]+/g) ?? []).length >= 2 || ASK_YOU.test(c)) {
      if (!ASK_SELF.test(c) || ASK_YOU.test(c)) {
        return true;
      }
    }
  }
  return ASK_OFFER.test(s) || ask_in_words(s) || ASK_START.test(c);
}

// the questions to the user in a text (each a sentence, at most 3), but
// those tied by id to a task in `open_ids` (the user's open ones);
// `names`: the user's, as the chat calls them (config owner_name)
export function questions_in(text: string, open_ids: Set<string> = new Set(), names: string[] = []): string[] {
  const out: string[] = [];
  for (const para of ask_plain(text).split(/\n\s*\n/)) {
    const ids = para.match(/\bP\d{1,15}\b/g) ?? [];
    if (ids.some((id) => open_ids.has(id))) {
      continue;
    }
    const sentences = [...para.matchAll(/(?:[^.!?\n]|[.!?]+(?=[^\s.!?]))+(?:[.!?]+(?=\s|$)|\n|$)/g)]
      .map((m) => m[0].replace(/^[\s\-*•\d.)]+/, "").trim())
      .filter((raw) => ask_fold(raw).length >= 2);
    for (const [i, raw] of sentences.entries()) {
      if (!ask_one(raw, i < sentences.length - 1, names)) {
        continue;
      }
      const said = text_line(raw, 200);
      if (said !== "" && !out.includes(said)) {
        out.push(said);
      }
      if (out.length >= 3) {
        return out;
      }
    }
  }
  return out;
}

// what reads as no subject of a question (no accents, 4 letters or more)
const ASK_FILLER = new Set(["quer", "queira", "prefere", "prefira", "posso", "podemos", "pode", "poderia", "devo", "voce", "voces", "para", "como", "isso", "isto", "este", "esta", "esse", "essa", "agora", "ainda", "depois", "antes", "mais", "qual", "quais", "quando", "onde", "sobre", "entao", "aguardo", "aguardando", "ordem", "decisao", "decida", "decide", "resposta", "confirmar", "confirme", "pendencia", "pergunta", "opcao", "opcoes", "favor", "sigo", "fazer", "faco", "tudo", "todos", "tres", "dois", "duas", "preciso", "falta", "seguir", "hoje", "should", "what", "with", "this", "that", "want"]);

// a text's words as compared: stems of 5 letters (no accents, lower),
// of words of 4 letters or more, not fillers
function ask_words(text: string): Set<string> {
  return new Set((ask_fold(text).match(/[a-z0-9#]+/g) ?? []).filter((w) => w.length >= 4 && !ASK_FILLER.has(w)).map((w) => w.slice(0, 5)));
}

// whether a question (`said`, as questions_in gives it) has its task of
// the user's, open: made since `since` (ms) with words of it in its
// title or detail, or one in whose thread Unii said it since then
export function question_tasked(s: Store, said: string, since: number): boolean {
  const keys = ask_words(said);
  const line = ask_fold(text_line(said, 200));
  return s.tasks.some((t) => {
    if (t.assignee !== "user" || t.state !== "open") {
      return false;
    }
    if (t.thread.some((x) => x.who === "unii" && Date.parse(x.at) >= since && ask_fold(text_line(x.text, 100000)).includes(line))) {
      return true;
    }
    return Date.parse(t.made) >= since && [...ask_words(t.title + " " + (t.detail ?? ""))].some((w) => keys.has(w));
  });
}

export const ASKED_TITLE = "Pergunta sem pendência";

// where a turn's questions came from: the reply of Unii's that ended it
// (Server.ts Chat.reply_msg): its id in the chat (null: not known), its
// text, when it was logged (ISO; null: not known)
export type AskFrom = { id: number | null; text: string; date: string | null };

// the task's head (its detail starts so), its next step, what makes it
// done, how long Unii has for it (P112: the task is Unii's, not the
// user's: Unii reads where the questions came from and asks the user
// with a task of theirs, or closes it as a false alarm)
// How it's closed: never done (done needs evidence of a solution, and
// a reason in words only drops a task, Evidence.ts), but dropped with a
// reason (task_edit, state dropped, evidence of type reason, at least
// Evidence.REASON characters) naming the user's new task, or why the
// sentence asked nothing (B3)
export const ASKED_HEAD = "O Unii terminou um turno perguntando ou pedindo algo ao usuário sem abrir pendência (trava da P87). Esta tarefa é do Unii, não do usuário. Para cada frase abaixo, leia a mensagem de origem e decida se era pergunta real ou alarme falso. Se era pergunta real, abra a pendência do usuário com task_add (assignee user, com as opções). Depois encerre esta tarefa com task_edit, state dropped e evidence do tipo reason (no mínimo " + Ev.REASON + " caracteres): se era pergunta real, cite no reason o número da nova pendência; se era alarme falso, diga no reason por que a frase não pedia nada. Esta tarefa não fecha como done, porque done exige evidência de uma solução e o reason só serve para dropped.";
export const ASKED_STEP = "Ler a mensagem de origem; se era pergunta real, abrir a pendência do usuário com task_add e opções; depois encerrar esta tarefa com task_edit (state dropped, evidence reason) citando a nova pendência ou o motivo do alarme falso.";
export const ASKED_DONE = "esta tarefa encerrada como dropped, com evidence do tipo reason que cita a pendência aberta ao usuário (task_add, assignee user) ou diz por que era alarme falso";
export const ASKED_DUE = 4 * 3600e3;
// the most of the origin's text a block quotes
const ASKED_QUOTE = 160;

// a block of the task's detail: the origin, then its sentences, each
// with what to decide (so no sentence is ever read without its origin)
function asked_block(said: string[], from: AskFrom | null): string {
  const when = from === null || from.date === null ? NaN : Date.parse(from.date);
  const d = new Date(when);
  const two = (n: number) => String(n).padStart(2, "0");
  const at = Number.isNaN(when) ? "" : ", em " + two(d.getDate()) + "/" + two(d.getMonth() + 1) + " às " + two(d.getHours()) + ":" + two(d.getMinutes());
  const text = from === null ? "" : text_line(from.text, 100000);
  const quote = text === "" ? "" : ", que começa assim: “" + (text.length > ASKED_QUOTE ? text.slice(0, ASKED_QUOTE).trimEnd() + "…" : text) + "”";
  const head = from === null || from.id === null ? "Mensagem de origem: a última resposta do Unii no turno (número não disponível)" + at + quote + "." : "Mensagem de origem: nº " + from.id + ", resposta do Unii" + at + quote + ".";
  return [head, "Frases a decidir (pergunta real ou alarme falso):", ...said.map((x) => "• “" + x + "”")].join("\n");
}

// the task's detail: its head, then the blocks it had (a task of the
// user's made before P112: one block, said so) and the new one; the
// oldest blocks go first, whole, as the detail outgrows DETAIL
function asked_detail(prev: string, block: string): string {
  const old = prev.startsWith(ASKED_HEAD) ? prev.slice(ASKED_HEAD.length) : prev.trim() === "" ? "" : "Registro anterior, feito antes desta tarefa ser do Unii:\n" + prev.trim();
  const blocks = old.split(/\n\s*\n/).map((x) => x.trim()).filter((x) => x !== "");
  blocks.push(block);
  const join = () => ASKED_HEAD + "\n\n" + blocks.join("\n\n");
  while (blocks.length > 1 && join().length > DETAIL) {
    blocks.shift();
  }
  return join().slice(0, DETAIL);
}

// the task a question without one gets: Unii's (P112), no fields, its
// next step due in ASKED_DUE, each sentence with its origin (`from`);
// one open already (Unii's, or the user's made before P112, made
// Unii's) gets these added, Unii's keeping its due (late or not);
// else why not (a full list)
export function task_asked(s: Store, said: string[], now: number, from: AskFrom | null = null): Task | string {
  const block = asked_block(said, from);
  const due = new Date(now + ASKED_DUE).toISOString();
  const had = s.tasks.find((t) => t.state === "open" && t.title === ASKED_TITLE);
  if (had !== undefined) {
    const at = new Date(now).toISOString();
    // Unii's already, with a due: its due and when it last moved stay,
    // past or not (a new question doesn't restart its 4 h nor hide that
    // it's late or stalled: it's the server's change, not Unii's move);
    // the user's (made before P112), or none: due from now
    const keep = had.assignee === "unii" && had.next_due !== null && !Number.isNaN(Date.parse(had.next_due));
    const next: Task = {
      ...had, assignee: "unii", kind: "action", fields: [], draft: {}, answers: null,
      detail: asked_detail(had.detail, block), done_when: ASKED_DONE, next_step: ASKED_STEP, next_due: keep ? had.next_due : due,
      changed: at, moved: keep ? had.moved : at, ready: keep ? had.ready : at,
    };
    s.tasks[s.tasks.indexOf(had)] = next;
    tasks_save(s);
    return next;
  }
  return task_new(s, {
    title: ASKED_TITLE, detail: asked_detail("", block), assignee: "unii", origin: "chat", kind: "action",
    done_when: ASKED_DONE, next_step: ASKED_STEP, next_due: due,
  }, "trava", now);
}

// the note the turn gets (the user's language): the task is Unii's, to
// resolve
export function questions_said(said: string[], task: Task | string): string {
  const q = said.map((x) => "“" + x + "”").join(", ");
  return typeof task === "string"
    ? "Pergunta sem pendência: o Unii perguntou " + q + " sem abrir nem atualizar, neste turno, uma pendência do usuário, e não foi possível registrar a tarefa do Unii (" + task + "). Unii: releia a sua última resposta; se era pergunta real, abra a pendência do usuário com task_add (assignee user, com as opções); se era alarme falso, não faça nada."
    : "Pergunta sem pendência: o Unii perguntou " + q + " sem abrir nem atualizar, neste turno, uma pendência do usuário. Registrei na " + task.id + ", tarefa do Unii, não do usuário. Unii: resolva a " + task.id + ": leia a mensagem de origem; se era pergunta real, abra a pendência do usuário com task_add (assignee user, com as opções) e encerre a " + task.id + " com task_edit (state dropped, evidence do tipo reason) citando a nova pendência; se era alarme falso, encerre a " + task.id + " do mesmo modo, com o motivo no reason.";
}
