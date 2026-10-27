// Pipeline
// ========
// The pipeline's panel (R6, uniichat-ux-r1.md §6): where each front (a
// task's ref) is, from the demand to the merge, read from what the serve
// already keeps, nothing typed by hand:
// - the agents' logs (Memory.ts docs/agent/<name>.jsonl): each one's note
//   (model, label <front>-<role>), its task, its report and when it
//   started and ended; one at work now is told by the live agents
//   (Tools.working). Its role is read from its label (…-impl, …-verif):
//   each verifier's run is one cycle of verification, its verdict and
//   its notes by severity read from its report (best effort: the first
//   lines say the verdict; listed notes say their severity), unless a
//   task's prs (R5) gives them, which wins;
// - the tasks (tasks.json): who has the front now (the user, Unii),
//   since when, and how long the user took to decide;
// - the pull requests the agents' tasks and the tasks' prs name, their
//   state read live from GitHub (`gh pr view`, Pipeline.GH), cached.
// And AGENTES.md, written by the serve as an agent starts and ends
// (agents_md): the table vigia.ts reads, so no one keeps it by hand.

import * as fs from "node:fs";
import type { PrCheck, Store, Task } from "./Tasks.ts";
import { ROLE_SAID, VERDICT_SAID, sevs_said, when_said } from "./View.ts";

// Types
// =====

export type Role     = "impl" | "verif" | "survey";
export type RunState = "working" | "done" | "cut";
export type Verdict  = PrCheck["verdict"];
export type Sevs     = { high: number; medium: number; low: number };

// an agent's run, as its log says it: its name, label, model, front,
// role; when it started and last wrote (its end, once not at work);
// whether it's at work, reported or was cut (a restart, a stop without
// report); a verifier's verdict and notes (noted: its report listed them
// by severity), the PRs its task names ("repo#n"), the head each was
// given at and the link of those named with their owner, the tasks its task marks ("(P48)") or that link it (agent),
// and its report's first line
export type Run = {
  name    : string;
  label   : string | null;
  model   : string | null;
  ref     : string;
  role    : Role;
  start   : string;
  end     : string;
  state   : RunState;
  verdict : Verdict | null;
  notes   : Sevs;
  noted   : boolean;
  prs     : string[];
  heads   : Record<string, string>;
  links   : Record<string, string>;
  tasks   : string[];
  said    : string;
};

// a pull request read live: open, merged or closed, its head, its checks
export type Ci   = "ok" | "failed" | "running" | "none";
export type Live = { state: "OPEN" | "MERGED" | "CLOSED"; head: string; ci: Ci };

// a PR of a front: its key ("auth#307"), its link if known (owner and
// repo: one named only "auth#307" has none, unless another mention or a
// task's prs gives it), how many cycles verified it, the head and
// verdict of the last, and its state live (null: not read yet, or no
// link, or gh failed)
export type FrontPr = { key: string; url: string | null; cycles: number; head: string | null; verdict: Verdict | null; live: Live | null };

// a cycle: a verifier's run, numbered in its front, with the work it
// verified (the runs of other roles since the cycle before)
export type Cycle = { n: number; run: Run; after: Run[] };

// where a front is: an agent implementing or verifying, the user's move,
// waiting on others (outside the list: CI, a merge on GitHub; or a task
// it waits for), stalled with Unii (none at work, nothing with the user),
// or closed (nothing open). A task of the user's that waits for others
// (after, waits_for) is the others' move, not theirs
export type Stage = "impl" | "verif" | "user" | "others" | "stalled" | "closed";

// a task as the panel shows it
export type FrontTask = { id: string; title: string; assignee: string; state: Task["state"] };

// a front: its ref, stage and since when, its tasks open, its runs and
// cycles, its PRs, the notes still open by severity (the last cycle's,
// while no work followed it; fixing: work followed), and its metrics:
// idle (how long, over its life, no agent was at work and no task was
// the user's: waiting on Unii), decide (how long the user took, from
// when each task became theirs to when they closed it: each, ms) and
// cycles per PR
export type Front = {
  ref    : string;
  stage  : Stage;
  since  : string;
  tasks  : FrontTask[];
  runs   : Run[];
  cycles : Cycle[];
  prs    : FrontPr[];
  open   : Sevs;
  fixing : boolean;
  idle   : number;
  decide : number[];
  first  : string;
};

// the panel: the fronts (the active first), and the totals over them
export type Panel = { at: string; fronts: Front[]; refreshing: boolean };

// Constants
// =========

// where the agents' logs are, in a chat's dir (Memory.ts AGENTS)
const AGENTS_DIR = "/docs/agent/";

// an agent's note (Tools.ts SUB_ROLE)
const NOTE = /^subagent(?: on (\S+))?(?: at effort (\S+))?(?: with the Numih rules)?(?:, labeled (.+))?$/s;

// a role, by its label's words
const VERIF  = /(^|-)(verif\w*|verificador\w*|revis\w*|review\w*)(-|$)/i;
const SURVEY = /(^|-)(levantamento|diagnostico|diagnóstico|survey|avaliacao|avaliação)(-|$)/i;

// a pull request named in a text: its link, or "owner/repo#n", "repo#n"
const PR_URL = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi;
// (an owner as GitHub's: letters, digits and "-", no "."; "evil.com/x#4"
// names none)
const PR_REF = /(?:^|[^\w\/.#-])(?:([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/)?([A-Za-z][\w.-]*)#(\d+)\b/g;
const NOT_REPO = /^(pr|prs|pull|issue|n|no|nº|item|p)$/i;

// a head given in a text: "head 6178ccf", "commit 33236f0", "em `d0ff55e`"
const HEAD = /\b(?:head|commit|sobre|em)\s+`?([0-9a-f]{7,40})\b/i;

// the ids a text marks between parentheses, only ids (vigia.ts marcados)
const MARKED = /\(\s*(P\d+(?:\s*(?:,|;|\be\b)\s*P\d+)*)\s*\)/g;

// how long a PR read live is kept: open, then merged or closed
export const LIVE_OPEN = 120e3;
export const LIVE_DONE = 3600e3;

// how many PRs are read at once, and the longest a read may take
const LIVE_AT_ONCE = 3;
const LIVE_TIMEOUT = 15e3;

// the most PRs read live per panel (the active fronts' first)
export const LIVE_MOST = 24;

// AGENTES.md: where the serve's part of it starts and ends (the rest of
// the file, written by hand, is kept as it is)
export const MD_START = "<!-- unii: agentes gerados pelo serve (início); não edite entre estas marcas -->";
export const MD_END   = "<!-- unii: agentes gerados pelo serve (fim) -->";

// Agents' logs
// ============

// an agent's log as read: its note, its task, its last report, when it
// started and last wrote, what its last line was
type Raw = { note: string; task: string; report: string; start: string; end: string; last: string };

// each log read once while it doesn't change (by size and time)
const RAWS = new Map<string, { size: number; mtime: number; raw: Raw | null }>();

function raw_read(file: string): Raw | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const had = RAWS.get(file);
  if (had !== undefined && had.size === st.size && had.mtime === st.mtimeMs) {
    return had.raw;
  }
  let raw: Raw | null = null;
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
    const roots = lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter((r) => r !== null && typeof r === "object");
    if (roots.length > 0) {
      const text = (r: any) => (typeof r?.text === "string" ? r.text : "");
      const date = (r: any) => (typeof r?.date === "string" ? r.date : new Date(st.mtimeMs).toISOString());
      const first = roots[0];
      const task = roots.find((r: any) => r.kind === "user");
      const report = [...roots].reverse().find((r: any) => r.kind === "unii");
      raw = { note: first.kind === "note" ? text(first) : "", task: text(task), report: text(report), start: date(first), end: date(roots[roots.length - 1]), last: String(roots[roots.length - 1].kind ?? "") };
    }
  } catch {
    raw = null;
  }
  RAWS.set(file, { size: st.size, mtime: st.mtimeMs, raw });
  return raw;
}

// every agent's run of a chat's dir, by when it started (working: the
// names at work now)
export function runs_read(dir: string, working: Set<string>, refs: string[], tasks: Task[] = []): Run[] {
  const at = dir + AGENTS_DIR;
  const files = fs.existsSync(at) ? fs.readdirSync(at).filter((f) => /^[A-Za-z-]+\.jsonl$/.test(f)) : [];
  const out: Run[] = [];
  for (const f of files) {
    const name = f.slice(0, -".jsonl".length);
    const raw = raw_read(at + f);
    if (raw !== null) {
      out.push(run_of(name, raw, working.has(name), refs, tasks));
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

// a run from its log (pure, for the tests)
export function run_of(name: string, raw: Raw, working: boolean, refs: string[], tasks: Task[] = []): Run {
  const m = NOTE.exec(raw.note.trim());
  const label = m?.[3]?.replace(/\s+/g, " ").trim() || null;
  const role = label !== null ? role_of(label) : role_in(raw.task);
  const state: RunState = working ? "working" : raw.last === "unii" && raw.report !== "" ? "done" : "cut";
  const found = verdict_of(raw.report);
  const verdict = role === "verif" && state === "done" ? found.verdict : null;
  const { prs, heads, links } = prs_named(raw.task);
  const linked = tasks.filter((t) => t.agent !== null && (t.agent === name || (label !== null && t.agent === label))).map((t) => t.id);
  const marked = [...raw.task.split("\n")[0].matchAll(MARKED)].flatMap((x) => x[1].match(/P\d+/g) ?? []);
  return {
    name, label, model: m?.[1] ?? null, ref: label !== null ? ref_of(label, refs) : ref_in(raw.task, refs), role,
    start: raw.start, end: raw.end, state, verdict,
    notes: verdict === null ? zero() : found.notes, noted: verdict !== null && found.noted,
    prs, heads, links, tasks: [...new Set([...marked, ...linked])],
    said: first_line(raw.report),
  };
}

// a label's role: verifying, surveying, else implementing (whatever
// else an agent does is work a verifier may check)
export function role_of(label: string | null): Role {
  if (label === null) {
    return "impl";
  }
  return VERIF.test(label) ? "verif" : SURVEY.test(label) ? "survey" : "impl";
}

// an unlabeled agent's role, as its task's first words say it ("Você é
// verificador…", "Verifique…")
export function role_in(task: string): Role {
  const head = fold(task.slice(0, 200));
  return /verific|revis|review/.test(head) ? "verif" : /levantamento|diagnostic/.test(head) ? "survey" : "impl";
}

// a label's front: the longest of the list's that it is or starts with
// ("num-2337" for "num-2337-svc-impl"); else its issue ("num-3307" for
// "num-3307-ressalva-impl"), else its first word
export function ref_of(label: string, refs: string[]): string {
  const l = label.toLowerCase();
  const by = [...refs].sort((a, b) => b.length - a.length).find((r) => l === r.toLowerCase() || l.startsWith(r.toLowerCase() + "-"));
  if (by !== undefined) {
    return by;
  }
  const issue = /^([a-z]+-\d+)(-|$)/.exec(l);
  return issue !== null ? issue[1] : l.split("-")[0];
}

// an unlabeled agent's front (agents of before labels): the longest of
// the list's its task's first lines name, else the issue they name
// ("NUM-2337" is num-2337), else none (NO_REF)
export const NO_REF = "sem frente";
export function ref_in(task: string, refs: string[]): string {
  const head = task.slice(0, 400).toLowerCase();
  const by = [...refs].sort((a, b) => b.length - a.length).find((r) => new RegExp("(^|[^\\w-])" + r.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\w-])").test(head));
  if (by !== undefined) {
    return by;
  }
  const issue = /\b([a-z]+-\d{2,})\b/.exec(head);
  return issue !== null ? issue[1] : NO_REF;
}

// a label's theme: its words but its role's, a head's or a round's
// ("num-2337-svc-normalizacao" for "num-2337-svc-normalizacao-verif"):
// the work a verifier checks is the theme's
const ROLE_WORD = /^(impl\w*|implementacao\d*|verif\w*|verificador\d*|revis\w*|review\w*|fix\d*|corre\w*|[0-9a-f]{7,40})$/i;
export function theme_of(label: string | null): string {
  const words = label === null ? [] : label.toLowerCase().split("-");
  return words.filter((w, k) => !ROLE_WORD.test(w) && !(/^\d+$/.test(w) && k > 0 && ROLE_WORD.test(words[k - 1]))).join("-");
}

function zero(): Sevs {
  return { high: 0, medium: 0, low: 0 };
}

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
}

// what a text says of a verdict, by the first word of one it has: "Aprovado;
// o PR anterior foi reprovado" is approved, "Reprovado; aprovado só
// depois de…" rejected; said in the first person too ("aprovei o #18",
// SmoothPretzel; "reprovei"), in the present ("aprovo o PR…", YellowHare;
// "reprovo")
const REJECTED = /reprovad|reprovei|\breprovo\b|rejeitad|rejeitei|\brejeito\b|\brejected\b|\bnao\s+aprov(?:ad|ou|ei|o\b)/;
const APPROVED = /aprovad|aprovou|aprovei|\baprovo\b|\bapproved\b/;
// "com 5 baixas", a count then a severity, is "com 5 ressalvas baixas"
// (MagicWhale, 25/10); without a count ("com média de…") it isn't
const WITH_NOTES = /^(?:aprovad[oa]s?\s*,?\s*(?:com|c\/)\s*(?:(?:(?:\d+|uma|duas|tres)\s*)?(?:ressalva|observac)|(?:\d+|uma|duas|tres|quatro|cinco)\s+(?:baixa|media|alta))|aprov(?:ou|ei|o)\b(?:\s+(?:o|a|os|as)\s+[^.;:\n]{0,80}?)?\s*,?\s*(?:com|c\/)\s*(?:(?:(?:\d+|uma|duas|tres)\s*)?(?:ressalva|observac)|(?:\d+|uma|duas|tres|quatro|cinco)\s+(?:baixa|media|alta))|approved with)/;
function verdict_said(s: string): Verdict | null {
  const r = s.search(REJECTED);
  const a = s.search(APPROVED);
  if (r < 0 && a < 0) {
    return null;
  }
  if (r >= 0 && (a < 0 || r <= a)) {
    return "rejected";
  }
  return WITH_NOTES.test(s.slice(a)) || bare_count(s.slice(a)) !== null ? "approved_with_notes" : "approved";
}

// a verdict's word followed right away by a count of notes and their
// severity, without "com": "aprovado. 1 média e 2 baixas", "APROVADO** —
// 2 baixas", "aprovado (1 média, 2 baixas)" (WoodenKangaroo 3, 25/10):
// what says them, to the end of its sentence; not a count of zero, nor a
// sentence that says them fixed ("aprovado. 3 baixas da V19 corrigidas")
// The severities it says none of may come first ("aprovado. Nenhuma média,
// 2 baixas", "0 médias e 2 baixas", "sem alta nem média, 1 baixa",
// PeachEagle 2, 25/10): the count after them is said all the same
// So may they in sentences of their own ("aprovado. Nenhuma média. 2
// baixas", "Sem altas. Nenhuma média. 1 baixa", CleverTaco 2, 25/10)
function bare_count(said: string): string | null {
  const open = counts_of(said.replace(/^\w+/, "")).open;
  return open.length === 0 ? null : open.join(", ");
}
// a sentence that says none of some severities ("Nenhuma alta.", "Sem
// altas nem médias", "Nenhuma alta corrigida", "0 médias"): it says no
// count, but it is still about them, so the ones after it are read
const NONE_SAID = /^[\s*_`.,:;—–()\[\]\/-]*(?:nenhum[a]?|zero|0|sem|no|none)\s+(?:(?:ressalvas?|observac(?:ao|oes))\s+)?(?:altas?|medias?|baixas?|high|medium|low)\b/;
// where a sentence ends: a dot not inside a word ("v1.2.3", "Pipeline.ts"),
// ";" or a line's end
const SENTENCE_END = /\.(?!\w)|[;\n]/;
// the counts said from the start of a text (what follows a verdict's word,
// its line and the lines that go on with it: summary_of), sentence by
// sentence, as long as each one is about notes: one that says a count,
// wherever in it ("O resto passou com 1 média", "GoldenJay 4 baixas
// corrigidas. 1 média aberta", GentleTrout 2, 25/10), one that says none
// of some severities ("Nenhuma alta.", "Nenhuma alta corrigida.",
// GentleTrout 1-2, 25/10), one that only says a fix ("Tudo corrigido.",
// GentleTrout 3, 25/10), or one that says nothing (the dot after the
// verdict's word, a blank line). The first that is about something else
// ("Sem commit nem push.", "3 testes novos.") ends them: what follows it
// is the report's, not the verdict's (the safe side within them: a count
// is read wherever it is said). open: their stretches not said fixed
// (open_counts); said: some count was; rest: from the sentence that ended
// them on
function counts_of(text: string): { open: string[]; said: boolean; rest: string } {
  const open: string[] = [];
  let said = false;
  let rest = text;
  // the verdict's own sentence, what its word's line says before its
  // first end: if about something else, it ends the counts ("aprovo o PR
  // #18, sem ressalvas de severidade média ou alta. Há uma observação
  // baixa.", YellowHare: approved, its list counts). A later sentence
  // about something else doesn't: the counts after it are read too
  // ("aprovado. 2 baixas corrigidas. Testei no Safari. 1 média aberta."
  // 1 medium, RoughHeron 2, 25/10), the safe side
  let own = true;
  while (rest !== "") {
    const end = rest.search(SENTENCE_END);
    const sentence = end < 0 ? rest : rest.slice(0, end);
    const plain = sentence.replace(/[*_`]/g, "");
    const at = [...sentence.matchAll(COUNT_START)].map((p) => p.index! + p[0].length - p[1].length).filter((s) => !/^0+\s/.test(sentence.slice(s)));
    if (at.length > 0) {
      said = true;
      open.push(...open_counts(sentence.slice(0, at[0] + 160)));
    } else if (sev_open(plain).length > 0) {
      said = true;
      open.push(...sev_open(plain));
    } else if (own && !/^[\s*_`.,:;!?—–()\[\]\/-]*$/.test(sentence) && !NONE_SAID.test(sentence) && !says_fixed(plain.replace(/^[\s.,:;!?—–()\[\]\/-]+/, ""))) {
      break;
    }
    own = false;
    rest = end < 0 ? "" : rest.slice(end + 1);
  }
  return { open, said, rest };
}
// the text a verdict's line says its counts in (counts_of): from the line
// on, the lines that go on with it, blank or not ("Aprovado.\n\n1 média e 2
// baixas", "…2 baixas corrigidas.\nNenhuma alta.\n1 média aberta.",
// GentleTrout 1, 25/10), to the first that opens a heading, an item, a
// bold label, a quote, a table or a label ("Conferido:"); on folded lines
function summary_of(lines: string[], k: number): string {
  const out = [lines[k]];
  for (let j = k + 1; j < lines.length && j <= k + 12; j++) {
    if (/^\s*(?:#|\*\*|__|>|\||(?:\d+[.)]|[-*•])\s)/.test(lines[j]) || /:[\s*_`]*$/.test(lines[j])) {
      break;
    }
    out.push(lines[j]);
  }
  return out.join("\n");
}
// each count is its own: a fix said of one is said of it only, not of
// the others ("2 baixas já tratadas e 1 média aberta", "2 baixas foram
// tratadas, mas 1 média não": 1 medium, CleverTaco 1, 25/10). A count's
// stretch goes to the next count; it is fixed if it says a fix, not
// denied, followed only by references (refs_only), else it counts (the
// safe side: "2 baixas tratadas, mas falha no Safari" counts)
// A fix said right before the first count, with nothing between them but
// an article ("Corrigidas 2 baixas. Falta 1 média.", "Corrigi as 2
// baixas", RoughHeron 4, 25/10), says it of that count only, if nothing
// after the count qualifies it ("Corrigidas 2 baixas, mas o Safari
// falha" counts): the counts after it are their own
function open_counts(sentence: string): string[] {
  const starts = [...sentence.matchAll(COUNT_START)].map((p) => p.index! + p[0].length - p[1].length);
  const before = starts.length === 0 ? "" : sentence.slice(0, starts[0]).replace(/[*_`]/g, "");
  const fixed_before = FIX_BEFORE.test(before) && !NOT_FIXED_BEFORE.test(before);
  // a severity named after a count, in its stretch ("2 baixas corrigidas e
  // a média segue aberta", StoneGiraffe 1, 25/10), ends the count's: its
  // clause says its own state (sev_open), the count's fix not of it
  const named: string[] = [];
  const pieces = starts.map((s, k) => {
    const piece = k + 1 < starts.length ? sentence.slice(s, starts[k + 1]).replace(NEXT_LEAD, "") : sentence.slice(s);
    const head = COUNT_HEAD.exec(piece.replace(/[*_`]/g, ""))?.[0].length ?? 0;
    const at = [...piece.matchAll(SEV_NAMED)].find((p) => p.index! >= head);
    if (at === undefined) {
      return piece;
    }
    named.push(...sev_open(piece.slice(at.index!).replace(/[*_`]/g, "")));
    return piece.slice(0, at.index!);
  });
  return pieces
    .filter((piece, k) => !(k === 0 && fixed_before && refs_only(piece.replace(COUNT_HEAD, "").replace(TAIL, ""))))
    .filter((piece) => !/^0+\s/.test(piece))
    .map(part_fixed)
    .filter((piece) => !count_fixed(piece))
    .map((piece) => piece.replace(TAIL, ""))
    .concat(named);
}
// a count and its severity at a text's start: "2 baixas", "1 ressalva média"
const COUNT_HEAD = /^(?:\d+|uma?|dois|duas|tres|quatro|cinco)\s+(?:(?:ressalvas?|observac(?:ao|oes))\s+)?(?:altas?|medias?|baixas?|high|medium|low)\b/;
// a line that opens with one, after marks or a parenthesis (verdict_of)
const SUMMARY_COUNT = /^[\s*_`(\[]*(?:\d+|uma?|dois|duas|tres|quatro|cinco)\s+(?:(?:ressalvas?|observac(?:ao|oes))\s+)?(?:altas?|medias?|baixas?|high|medium|low)\b/;
// what, at a count's stretch's end, says the next count open, not this
// one: "Corrigi as 2 baixas e falta 1 média", "2 baixas corrigidas, mas
// ainda resta 1 média" (StoneGiraffe 3, 25/10); only before another count
const NEXT_LEAD = /[\s,;:—–-]*(?:\b(?:e|mas|porem|and|but)\b[\s,;:—–-]*)?(?:\b(?:ainda|so)\s+)?(?:\b(?:falta|faltam|resta|restam|sobra|sobram|segue|seguem|fica|ficam|ha|tem)\b[\s,;:—–-]*)?(?:\b(?:ainda|so)\s*)?$/;
// a severity said without a count, by its article or a note's name, and
// said open in its clause ("A média continua aberta.", "a alta segue
// pendente", "a ressalva média não foi corrigida", RoughHeron 1, 25/10):
// one note of it, the least it can be. Its clause goes to the next
// severity so said ("A média foi corrigida, mas a baixa continua aberta"
// 1 low); one said fixed, or said neither way ("A média é do Safari"),
// none. Never zero for a note said open, the safe side. On a folded text
const SEV_NAMED = /(?:^|[^\w])(?:a|as|uma|ressalvas?|observac(?:ao|oes))\s+(?:(?:ressalvas?|observac(?:ao|oes))\s+)?(altas?|medias?|baixas?)\b/g;
const OPEN_WORD = /\b(?:abert\w*|pendente\w*|continu\w*|segue|seguem|persist\w*|falt\w*|resta|restam|ainda|nao)\b/;
function sev_open(plain: string): string[] {
  const starts = [...plain.matchAll(SEV_NAMED)];
  return starts
    .map((p, k) => ({ sev: p[1], clause: plain.slice(p.index!, starts[k + 1]?.index ?? plain.length) }))
    .filter((c) => OPEN_WORD.test(c.clause))
    .map((c) => "1 " + c.sev.replace(/s$/, ""));
}
// a count, then how many of it are fixed ("5 baixas, 2 corrigidas", "5
// baixas (2 já tratadas)", "5 baixas, das quais 2 corrigidas", GentleTrout
// 4, 25/10): the rest of them are open ("3 baixas"); all of them, or a fix
// qualified ("5 baixas, 2 corrigidas, mas falha no Safari"), the count as
// said (count_fixed reads it)
const PART_FIXED = /^(\d+|uma?|dois|duas|tres|quatro|cinco)\s+((?:(?:ressalvas?|observac(?:ao|oes))\s+)?(?:altas?|medias?|baixas?|high|medium|low))\b[\s,;:(—–-]*(?:(?:das?|dos?)\s+quais\s+|sendo\s+)?(\d+|uma?|dois|duas|tres|quatro|cinco)\s+(?:ja\s+)?(?:(?:foram|estao|sao)\s+)?(?=(?:corrigid|resolvid|sanad|tratad))/;
function part_fixed(piece: string): string {
  const m = PART_FIXED.exec(piece);
  if (m === null) {
    return piece;
  }
  const amount = (w: string) => (/^\d+$/.test(w) ? Number(w) : COUNT_WORD[w]);
  const left = amount(m[1]) - amount(m[3]);
  const fix = piece.slice(m[0].length).replace(/\)/, " ");
  if (left <= 0 || !count_fixed(fix)) {
    return left <= 0 ? piece : m[1] + " " + m[2];
  }
  return left + " " + m[2];
}
// where a count starts, as SAID_PAIR reads it (notes_said)
const COUNT_START = /(?:^|[\s,:;(]|\be\b)((?:\d+|uma?|dois|duas|tres|quatro|cinco)\s+(?:(?:ressalvas?|observac(?:ao|oes))\s+)?(?:altas?|medias?|baixas?|high|medium|low)\b)/g;
// what joins a count's stretch to the next: ", e", ", mas", " and "
const TAIL = /[\s,;:—–-]*(?:\b(?:e|mas|porem|and|but)\b[\s,;:—–-]*)?$/;
// The fix must be said of the count: between them only a few words that
// say no other severity and no open state ("2 baixas da V19 corrigidas",
// "2 baixas foram tratadas"); "1 média aberta, a alta foi corrigida" says
// the fix of the high, and the medium stays open (RoughHeron 1, 25/10)
function count_fixed(piece: string): boolean {
  const m = FIXED_WORD.exec(piece);
  if (m === null || NOT_FIXED.test(piece)) {
    return false;
  }
  const between = piece.slice(0, m.index).replace(COUNT_HEAD, "");
  if (between.length > 40 || OPEN_WORD.test(between) || /\b(?:altas?|medias?|baixas?|high|medium|low)\b/.test(between)) {
    return false;
  }
  // a parenthesis opened before the fix closes after it ("1 baixa
  // (corrigida)"): its close is not what follows the fix
  let open = 0;
  for (const c of piece.slice(0, m.index)) {
    open += c === "(" ? 1 : c === ")" ? -1 : 0;
  }
  let rest = "";
  let depth = 0;
  for (const c of piece.slice(m.index)) {
    depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    // a close with no open before the count ("(2 baixas corrigidas). 1
    // média aberta", RoughHeron 1, 25/10): the sentence's parenthesis
    if (depth < 0) {
      depth = 0;
      open = Math.max(0, open - 1);
      rest += " ";
      continue;
    }
    rest += c;
  }
  return refs_only(rest.replace(TAIL, ""));
}

// a line that labels the verdict: "**Veredito: …", "Veredito (NUM-2337):
// …", "Veredito final — …", a heading "## Veredito"; not a line that
// only cites the word ("O veredito do anterior foi reprovado.")
const VERDICT_LABEL = /^[\s>#*_`-]*(?:veredito|verdict)\b(?:\s*\([^)\n]{0,80}\)|\s+final)?[*_`\s]*(?:[:—–]|-\s|$)/;

// a report's verdict and the line that says it, within its first 600
// characters: its line labeled "Veredito:", or the first line after a
// label that says none ("**Veredito:**\nREPROVADO"); else its first line
// that says one, by the word said first
export function verdict_line(report: string): { verdict: Verdict; at: number; summary?: string } | null {
  const top: string[] = [];
  let n = 0;
  for (const line of report.split("\n")) {
    if (n >= 600) {
      break;
    }
    top.push(fold(line.slice(0, 600 - n)));
    n += line.length + 1;
  }
  const at = (k: number, verdict: Verdict) => count_next(report, k, verdict);
  for (let k = 0; k < top.length; k++) {
    const label = VERDICT_LABEL.exec(top[k]);
    if (label === null) {
      continue;
    }
    const said = verdict_said(top[k].slice(label[0].length));
    if (said !== null) {
      return at(k, said);
    }
    for (let j = k + 1; j < top.length; j++) {
      const next = verdict_said(top[j]);
      if (next !== null) {
        return at(j, next);
      }
    }
  }
  for (let k = 0; k < top.length; k++) {
    const said = verdict_said(top[k]);
    if (said !== null) {
      return at(k, said);
    }
  }
  return null;
}

// an approval and the counts said after it, on its line and on the lines
// that go on with it (summary_of): "Aprovado.\n1 média e 2 baixas",
// "Aprovado.\n\nNenhuma média, 2 baixas" (PeachEagle 2, 25/10), "aprovado.
// 2 baixas corrigidas\n1 média aberta." (CleverMango 1, 25/10), "…
// corrigidas.\nNenhuma alta.\n1 média aberta." (GentleTrout 1, 25/10):
// approved with notes, those counts; "aprovado com ressalvas.\n2 baixas já
// tratadas e 1 média aberta." (CleverMango 2, 25/10) says them too. summary:
// that text, for notes_said
function count_next(report: string, k: number, verdict: Verdict): { verdict: Verdict; at: number; summary?: string } {
  const lines = report.split("\n").map(fold);
  const line = lines[k] ?? "";
  const a = line.search(APPROVED);
  if (a < 0) {
    return { verdict, at: k };
  }
  const summary = summary_of(lines, k);
  if (verdict === "approved" && bare_count(summary.slice(a)) !== null) {
    return { verdict: "approved_with_notes", at: k, summary };
  }
  return { verdict, at: k, summary };
}

// "sem ressalvas" said of all of them: not followed by a word that
// qualifies which ("bloqueantes", "altas", "novas", "de merge"); on a
// folded text (lower case, no accents). "sem ressalvas pendentes" (or
// "abertas", "restantes") is of all of them too: none left open, so the
// list, if any, is of the ones fixed (decided 25/10, NuttyOyster). A
// lookahead, not a lookbehind (Safari before 16.4)
const NO_NOTES = /sem\s+(?:nenhuma\s+)?(?:ressalvas|ressalva(?!s))(?![\s*_`]*(?:que\s+)?(?:bloquei|bloqueant|impeditiv|impeca|critic|alta|media|grave|serias?\b|nova|novo|adiciona|relevant|significativ|importante|maior|de\s+merge|para\s+(?:o\s+)?merge|ao\s+merge|de\s+(?:severidade|gravidade|nivel)\b))/;

// a report's verdict (verdict_line) and its notes by severity: the list
// items after its verdict's line under a heading on notes, each by the
// first severity it says, and the items that open with their severity
// ("1. MÉDIA: …", "- Baixa — …") outside another heading ("Não
// testado:"). noted: some was found
export function verdict_of(report: string): { verdict: Verdict | null; notes: Sevs; noted: boolean } {
  const top = fold(report.slice(0, 600));
  const notes = zero();
  const found = verdict_line(report);
  if (found === null) {
    return { verdict: null, notes, noted: false };
  }
  const verdict = found.verdict;
  // after the verdict's line: a line on the notes ("**Ressalvas
  // baixas:**", "Ressalvas") opens their list, its severity, if said,
  // given to its items that say none; another heading closes it. An item
  // counts by its own severity, else the list's; an item outside a list
  // of notes counts only if it says it's one ("- **Ressalva média:** …")
  // or opens with its severity ("- **A1 (ALTA, bloqueante)** …")
  let noted = false;
  // where a line is: after no heading yet, under one on notes, under
  // another ("**Não testado:**", "**O que passou**")
  let within: "none" | "notes" | "other" = "none";
  let given: keyof Sevs | null = null;
  let group: keyof Sevs | null = null;
  // the last top-level item counted as a note: its items are its details
  let counted = false;
  // a quote's lines are read as the lines they quote ("> **Baixas**\n> -
  // a", RoyalToucan 2, 25/10): its marks off, its indentation kept, so a
  // list or a heading in it counts as outside it (the safe side)
  const lines = report.split("\n").slice(found.at + 1).map((l) => l.replace(/^(\s*)(?:>[ \t]?)+/, "$1"));
  // how many of them go on with the verdict's line (summary_of)
  const summary_after = found.summary === undefined ? 0 : found.summary.split("\n").length - 1;
  // under a heading on notes: whether a list item came under it yet (then
  // a paragraph after the list is the report's, not a note), and whether
  // the line before was blank or the heading (a paragraph starts)
  let listed = false;
  let fresh = false;
  // under a severity in the singular ("**Média**"): one note, and once it
  // counted, what follows under it is its text, no other note's
  let single = false;
  // a singular severity's note not yet counted, its list's first item
  // labeled by another ("**Média**\n- Baixa: x"): counted at the list's end
  let owed: keyof Sevs | null = null;
  const pay = () => {
    if (owed !== null) {
      notes[owed] += 1;
      noted = true;
      owed = null;
    }
  };
  const one_done = () => {
    if (single) {
      single = false;
      within = "none";
      given = null;
    }
  };
  for (let at = 0; at < lines.length; at++) {
    const raw = lines[at];
    const item = /^(\s*)(\d+[.)]|[-*•])\s/.exec(raw);
    // the line after, if it goes on this one's text (an item's indented
    // line, a paragraph's next line that opens no label): what it says
    // first may qualify a fixed state ("**Ressalva baixa (corrigida em
    // abc1234)**\n   — mas o Safari falha", BraveTiger 3, 25/10)
    const after = lines[at + 1] ?? "";
    // an item's line goes on unindented too (markdown's lazy continuation:
    // "1. **Média** (corrigida)\nO iPhone não foi visto.", DarkGiraffe 3,
    // 25/10), unless it opens a heading, a bold label, a quote or a table
    const goes_on = after.trim() !== "" && !/^\s*(?:\d+[.)]|[-*•])\s/.test(after) && raw.trim() !== "" && ((item !== null && /^\s/.test(after)) || !/^\s*(?:#|\*\*|__|>|\|)/.test(after));
    // with or without a ":" on this line: a fixed state followed by only
    // references, then a line that says more ("…:\nfalta o iPhone",
    // "(corrigida)\nO iPhone não foi visto.", DarkGiraffe 3, 25/10)
    const next_open = goes_on && open_next(after);
    // an item that opens with its label in code, a severity or a note's
    // label with one, then ":" or a dash ("1. `MÉDIA`: a", "- `Ressalva 1
    // (média)`: b", SleepyMoose, 25/10), says it: the label is not cited
    const line = item === null ? raw : said_code(raw);
    // code is cited, never said: a severity or a note's label in it
    // ("- `Ressalva 1 (média)` e `Ressalva 2` somam", SilverNoodle) is
    // neither the line's severity nor makes it cite a note
    const bare = uncoded(line);
    const own = sev_in(bare.slice(0, 160));
    if (item === null) {
      if (line.trim() !== "") {
        group = null;
        pay();
      }
      // a line not indented ends the items: a new list's are no one's details
      if (/^\S/.test(line)) {
        counted = false;
      }
      // a line that goes on with the verdict's (summary_of) and opens with
      // a count ("Veredito: aprovado.\n\n2 baixas corrigidas e 1 média
      // aberta.", "(2 baixas corrigidas). 1 média aberta.", StoneGiraffe
      // 1-2, 25/10) says the verdict's counts, as on its own line: read
      // there (notes_said), each count by its state, not here as a note
      // labeled "2 baixas" (its count read as a note's number)
      if (at < summary_after && SUMMARY_COUNT.test(fold(line))) {
        fresh = false;
        continue;
      }
      // a paragraph labeled by a note and its severity, its text on the
      // same line ("**Ressalva baixa (…):** em verdict_of…", LunarWhale,
      // SmoothPretzel): one note; a label with no text after it heads a
      // list (below)
      // one its label says fixed ("**Ressalva baixa (corrigida):** ok",
      // WhitePelican) isn't open: none
      // a numbered note, its text on the line or on the next ("**Ressalva
      // 1 (média)**\nTexto", ProudCougar): one note too
      // fixed by its label or by its text, with ":" or not ('**Ressalva 1
      // (média)** — corrigida em abc' as '**Ressalva 1 (média):**
      // corrigida em abc', LemonRobin): note_fixed
      // so is one labeled by a single note and its severity, alone on its
      // line ("**Ressalva baixa**"): its items are its details
      // ("- **Efeito:** …", "- **Correção possível:** …", NeatWombat, 25/10)
      // a heading or bold label of one note with its severity, whatever
      // follows ("**Ressalva baixa** (corrigida em abc1234), mas ainda
      // falha", "**Ressalva baixa** (aberta (corrigida em abc1234))"), and
      // a bold label of a severity with its text ("**Baixa: texto
      // corrigida no hash**", JuicyTuna, 25/10): one note too
      const para = NOTE_PARA.exec(fold(line)) ?? NOTE_NUM.exec(fold(line)) ?? NOTE_ONE.exec(fold(line)) ?? NOTE_LEAD.exec(fold(line)) ?? SEV_PARA.exec(fold(line));
      const state = note_state(fold(line));
      const open = state === "open" || (state === "fixed" && next_open);
      // a paragraph that opens with a note's label, bold or not, counts as
      // a list's item does (MagicWhale, 25/10): open if its label says a
      // fixed state that what follows qualifies ("**Média** (corrigida em
      // abc1234) e o teste falha", "Ressalva baixa corrigida, falta o
      // iPhone", "Ressalva baixa corrigida na linha 42", "Ressalva 1
      // (corrigida em abc1234) mas sem teste"), or a note if it says no
      // state and its label, a note's with its severity or a bold
      // severity, has its text after it ("**Média** o botão some"), but
      // under another heading ("**Não testado:**\n**Alta** carga"), as an
      // item there
      const lead = para === null && (open || (state === "none" && within !== "other" && LABEL_TEXT.test(fold(line))));
      if (para !== null && (state !== "fixed" || open)) {
        notes[sev_in(para[1]) ?? "low"] += 1;
        noted = true;
      } else if (lead) {
        const head = NOTE_HEAD.exec(fold(line)) ?? SEV_LABEL.exec(fold(line));
        notes[sev_in(head?.[0] ?? "") ?? "low"] += 1;
        noted = true;
      }
      // a paragraph under a heading on notes, before any item under it,
      // is a note too ("**Baixas**\n\nUma nota em parágrafo.\n\nOutra
      // nota.", RoyalToucan 2, 25/10): one per paragraph, by the severity
      // it opens with, else the heading's, else low; not a heading nor a
      // label of its own ("Não testado: …"), nor one that says none
      // ("Nenhuma.") or only a fix, nor a table, a rule or code
      const f = fold(line);
      // (a note's label that says it fixed, "Ressalva média corrigida em
      // abc1234", isn't one: state)
      const as_para = within === "notes" && !listed && fresh && para === null && !lead && state === "none" && line.trim() !== "" && para_note(f);
      const was = within;
      // a heading on notes fixed ("**Ressalvas corrigidas:**") heads
      // none open: its items aren't notes
      if (/ressalva|observa[cç]/i.test(line) && fixed(label_of(line))) {
        within = "other";
        given = null;
      } else if ((para !== null || lead) && /^[\s>#*_]*(?:ressalva|observacao)\s/.test(f)) {
        // one note, said on its line ("**Ressalva baixa:** um título
        // …", WarmParrot): its items are its details ("- `### …` com
        // `1. **MÉDIA** a` conta 1 média"), not notes
        within = "other";
        given = null;
      } else if (/ressalva|observa[cç]/i.test(line) || (para === null && !lead && SEV_HEADING.test(f) && !FIXED_WORD.test(f))) {
        // a heading of notes by their severity alone ("**Baixas**",
        // "**Baixas** (nenhuma nos relatos reais):", "### Médias",
        // MagicWhale, 25/10) opens their list as "**Ressalvas baixas:**";
        // so does one severity alone on its line, its note's text on the
        // lines after ("**Média**\no botão some", RoyalToucan 3, 25/10),
        // unless it says it fixed ("**Média** (corrigida em abc1234)")
        // only a heading alone on its line ("**Ressalvas:**", "###
        // Baixas") has paragraphs for notes; a sentence that cites them
        // ("Ressalvas 1 e 2 podem ficar…", "**Próximo passo:** decidir se a
        // ressalva 1…", GentleTaco, FastCat) doesn't: what follows it is
        // the report's
        if (!as_para) {
          within = "notes";
          given = own;
          // a severity in the singular, alone ("**Média**", "### Alta"), labels
          // one note: its paragraph or its first item, the items after it its
          // details ("**Média**\n- a\n- b" 1 medium, WoodenKangaroo 3, 25/10);
          // in the plural ("**Baixas**") it heads a list, one per item
          single = !/ressalva|observa[cç]/i.test(line) && /^[\s>]*(?:#{1,6}\s+)?[*_]*\s*(?:alta|media|baixa)\b/.test(f);
          const alone = (/^\s*(?:#{1,6}\s|[*_]{2})/.test(f) || /:[\s*_`]*$/.test(f)) && /^[\s#*_]*[^*_:.\n]{1,60}?[\s*_`]*(?:\([^)\n]*\))?[\s*_`]*:?[\s*_`]*$/.test(f);
          listed = !alone;
        }
      } else if (/^\s*(\*\*|#|_)/.test(line) || /:\s*$/.test(line)) {
        within = "other";
        given = null;
      }
      if (within !== "notes") {
        single = false;
      }
      if (as_para && was === "notes" && within === "notes") {
        // under a heading of a severity ("**Baixas**"), its severity, unless
        // the paragraph labels its own as an item does (sev_first: "Média:
        // …", "**Média** …"); a word that only opens its text ("Alta
        // cobertura de testes.", WoodenKangaroo 1, 25/10) is not one
        notes[(given !== null ? sev_first("- " + line.trim()) ?? given : sev_in(SEV_LABEL.exec(f)?.[0] ?? "")) ?? "low"] += 1;
        noted = true;
        one_done();
      }
      fresh = line.trim() === "" || within !== was || (within === "notes" && (SEV_HEADING.test(f) || /^\s*(\*\*|#|_)/.test(line) || /:\s*$/.test(line)));
      continue;
    }
    fresh = false;
    if (within === "notes") {
      listed = true;
    }
    // an item its label says fixed ("- **Ressalva média (resolvida):**
    // …") isn't open: none, nor what it heads
    // so is one labeled a note with its severity whose text says it fixed
    // ("- **Ressalva 1 (média):** corrigida em abc"), as its paragraph
    const top_level = item[1].length < 2;
    const by_label = fixed(label_of(line));
    const bare_item = fold(line).replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "");
    if (((by_label && !qualified_after(line)) || note_fixed(bare_item)) && !next_open) {
      if (top_level) {
        group = null;
        counted = false;
      }
      continue;
    }
    // under a heading on notes, an item that only says a fix ("**Média**\n-
    // corrigida em abc1234", "**Baixas**\n- Corrigidas em abc1234.") says
    // its note's state, as "Média corrigida em abc1234" does in a paragraph
    // (PeachEagle 3, 25/10): no note open, and what follows it is its detail
    // (under "**Média**", the one note it labels); qualified ("…, mas falha
    // no Safari"), it is open and counts
    if (within === "notes" && top_level && !next_open && says_fixed(bare_item)) {
      group = null;
      counted = true;
      one_done();
      continue;
    }
    // an item that heads its own list by a severity ("- **Baixas e
    // informativas:**"), under no heading: its items count by it, it not
    // (under a heading on notes, an item is a note, its items its words)
    if (top_level) {
      group = within === "none" && SEV_HEAD.test(line) && /:[*_`\s]*$/.test(line) ? own : null;
      if (group !== null) {
        continue;
      }
    } else if (group !== null) {
      if (/^\s*(?:\d+[.)]|[-*•])\s+[*_`]*\s*informa(?:cao|ção|tiv\w*)?\b|^\s*(?:\d+[.)]|[-*•])\s+[*_`]*\s*info\b/i.test(line)) {
        continue;
      }
      notes[own ?? group] += 1;
      noted = true;
      continue;
    }
    // under another heading ("**O que conferi:**"), an item that only
    // cites notes ("- PolarKoala foi de aprovado para aprovado com
    // ressalvas, com 1 baixa", WhitePelican) isn't one: it must open
    // with its label ("- **Ressalva média:** …")
    // under a list of notes, an item under one that counted is its
    // detail ("2. **Pré-existentes:**\n   - **Ressalvas numeradas:**
    // `Ressalva 1 (média)` …", ProudCougar): not a note
    if (!top_level && within === "notes" && counted) {
      continue;
    }
    const cites = /ressalva|observa[cç]/i.test(bare);
    // so does one that opens with a severity and a fixed state it
    // qualifies ("- Média corrigida, falta o iPhone", RoyalToucan 3, 25/10)
    const says = (within === "other" ? cites && NOTE_ITEM.test(fold(line)) : cites) || (top_level && within !== "other" && (SEV_FIRST.test(line) || note_state(bare_item) === "open"));
    // under a list given a severity ("**Ressalvas baixas**"), an item
    // has its own only if it opens with it ("1. MÉDIA: …", "- **Ressalva
    // média:** …"); one it only cites ("… e perde a média dos itens",
    // ProudCougar) is the list's
    // a note's label that says it fixed, but qualified after ("1. **Ressalva
    // 1 (corrigida em abc1234)** mas sem teste", "1. **Ressalva 1
    // corrigida** exceto no Safari", BraveTiger 2, 25/10), is an open note
    // even with no severity: low, as "**Ressalva baixa …**" is
    const sev = (within === "notes" && given !== null ? sev_first(line) ?? given : own ?? (within === "notes" ? given : null)) ?? (by_label || note_state(bare_item) === "open" ? "low" : null);
    if (sev === null || !(says || (within === "notes" && top_level))) {
      if (top_level) {
        counted = false;
      }
      continue;
    }
    // under a severity in the singular ("**Média**"), a first item that
    // labels its own, another ("- Baixa: x"), is a note of its own: the
    // heading's note counts too, not lost ("**Média**\n- Baixa: x\n- Baixa:
    // y" 1 medium and 2 low, PeachEagle 4, 25/10), the safe side
    // An item of its list labeled by the heading's severity ("**Média**\n-
    // Baixa: x\n- Média: y") is that note: it counts, the heading's not
    // again (1 medium and 1 low, CleverTaco 2, 25/10); so the heading's
    // counts when its list ends without one (owed)
    if (single && top_level && given !== null) {
      const label = sev_first(line);
      if (label !== null && label !== given) {
        owed = given;
      }
    } else if (owed !== null && top_level && sev_first(line) === owed) {
      owed = null;
    }
    notes[sev] += 1;
    noted = true;
    if (top_level) {
      counted = true;
      one_done();
    }
  }
  pay();
  // approved without notes: none, and none listed (noted only for notes);
  // not "sem ressalvas bloqueantes" or "sem ressalvas novas", that
  // qualify which ones it hasn't: its list counts (GoldenJay, LunarWhale)
  if (verdict === "approved" && NO_NOTES.test(top)) {
    return { verdict, notes: zero(), noted: false };
  }
  // approved with notes, none found in the report ("Aprovado, com uma
  // ressalva", none listed; WhitePelican): the ones its verdict's line
  // says, at least one, of the severity it gives them, else low, so
  // the count agrees with the verdict
  if (verdict === "approved_with_notes" && !noted) {
    // (and on the lines after it that go on with it: count_next)
    const said = notes_said(found.summary ?? fold(report.split("\n")[found.at] ?? ""));
    notes.high += said.high;
    notes.medium += said.medium;
    notes.low += said.low;
    noted = true;
  }
  return { verdict, notes, noted };
}

// an item whose first words are a code span with a severity or a note's
// label with one ("`MÉDIA`", "`Ressalva 1 (média)`"), then ":" or a
// dash: that span is its label, said, so without its marks; any other
// code ("- `Ressalva 1 (média)` e `Ressalva 2` somam") stays cited
function said_code(line: string): string {
  const m = /^(\s*(?:\d+[.)]|[-*•])\s+[*_]*)`([^`\n]+)`(?=[*_]*\s*(?::|[—–-]\s))/.exec(line);
  if (m === null) {
    return line;
  }
  const label = fold(m[2]).trim();
  const sev = /^[(\[]?\s*(?:[a-z]\d*\s*[(:.—-]?\s*)?(?:altas?|high|medias?|medium|baixas?|low)[)\]]?$/.test(label) || NOTE_HEAD.test(label);
  return sev ? m[1] + m[2] + line.slice(m[0].length) : line;
}

// a line without its code spans: what's in them is cited
function uncoded(line: string): string {
  return line.replace(/`[^`\n]*`/g, " ");
}

// a note's label says it's fixed: "corrigida", "resolvida", "sanada"
// (or "fixed", "resolved"); not "não corrigida", "ainda não resolvida",
// "sem correção", "not fixed"; and what it says from that word (to its
// parenthesis' end, if it's in one, else to its end) says only that
// (ALL_FIXED): "ressalva 1 (média, corrigida)", "média (corrigida em
// abc1234)", "ressalvas corrigidas" are; "média (corrigida só em parte)"
// isn't. On a folded label (label_of)
// "tratada" says it as "corrigida" does ("aprovado. 2 baixas já tratadas",
// PeachEagle 1, 25/10): the words of a fix, one list for every reading
const FIX = String.raw`(?:corrigid|resolvid|sanad|tratad|fixed\b|resolved\b|addressed\b)`;
const FIXED_WORD = new RegExp(String.raw`\b` + FIX);
// what may come before the fixed word for it to be the label's state:
// only a note's name, its number and its severity ("ressalva 1 (média,
// ", "média (", "ressalvas ", "todas as ressalvas já ", "a1 (alta, ");
// a title that says more ("**Baixa cobertura da nota corrigida.**",
// "**Mantém alta a nota corrigida.**", "**Observação sobre ressalva
// corrigida.**", SweetSheep, 25/10) only cites a fix: the note stays open.
// A number may end in "." or ")" ("**1. Média corrigida.**", "**1) Média
// corrigida**", JuicyTuna, 25/10)
const STATUS = /^[\s>#*_`\[(]*(?:(?:todas?|tudo|ambas)\s+)?(?:(?:as|os|a|o)\s+(?:(?:\d+|duas|tres|quatro|cinco)\s+)?)?(?:(?:ressalvas?|observac(?:ao|oes)|notas?)\b[\s*_`]*)?(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?(?:\s*(?:,|\be\b)\s*[a-z]?\d+[a-z]?)*\b[\s*_`]*)?(?:[(\[,;:—–.)-]\s*)*(?:(?:altas?|high|medias?|medium|baixas?|low)\b(?:\s*(?:,|\be\b|\bou\b)\s*(?:altas?|medias?|baixas?)\b)*)?[\s*_`()\[\],;:—–.-]*(?:(?:ja|foram|estao|foi|esta|todas?|tudo|ambas|as|os|duas|tres|quatro|cinco|\d+)\s+)*$/;
const NOT_FIXED = new RegExp(String.raw`\b(?:nao|not|unfixed)\s+(?:\w+\s+){0,2}` + FIX);
// a fix said, then only an article, ":" or a dash, to the end of the text
// (open_counts): "corrigidas ", "foram corrigidas as ", "Corrigi: "
const FIX_BEFORE = new RegExp(String.raw`(?:^|[\s(,;:—–-])(?:` + FIX + String.raw`\w*|corrigi|resolvi|tratei|fixed|resolved)[\s,:—–-]*(?:(?:as|os|the)\s+)?$`);
const NOT_FIXED_BEFORE = new RegExp(String.raw`\b(?:nao|not)\s+(?:\w+\s+){0,2}(?:` + FIX + String.raw`\w*|corrigi|resolvi|tratei)[\s,:—–-]*(?:(?:as|os|the)\s+)?$`);
// what follows a state that says fixed keeps the note open (open_after)
// unless it is only a reference to the fix or to its check (refs_only):
// a hash, a token with a digit, "#", "." or ":" ("#19", "PR #19",
// "Pipeline.ts", "bun 262/0"), "(item 2)", "CI verde", where it was
// tested ("no iPhone"), "e verificada", "e testada em def5678",
// "(testada no Chromium)", "[testada]", joined by ",", ";", "e", a dash
// or a parenthesis. Any other word keeps it open, so no list of caveats
// is needed: "… e continua quebrando no Safari", "… e persiste no iOS",
// "(regrediu)", "… no entanto falta o teste", "… embora falte teste", "(em
// andamento)", "(a verificar)", "… sem testar no iPhone", "… sem CI",
// "(sem iPhone)", "— TODO" (GentleShrimp, 25/10), as "… mas ainda
// falha", "… exceto no Safari", "… apenas no Chromium", "… (aberta)",
// "(iOS desconhecido)". The safe side: a text that only describes the
// note or its fix ("… não renderizava o título", "… e o botão agora
// aparece") keeps it open too, a false alarm, not a note lost; so does
// "parcialmente" or "testada só no Chromium" (a limit said). On a folded
// text
function refs_only(text: string): boolean {
  let t = text.replace(/[*_`]/g, "").trim();
  while (t !== "") {
    // a parenthesis (or brackets) is a reference if what it holds is
    if (t[0] === "(" || t[0] === "[") {
      let d = 0;
      let k = 0;
      for (; k < t.length; k++) {
        d += t[k] === "(" || t[k] === "[" ? 1 : t[k] === ")" || t[k] === "]" ? -1 : 0;
        if (d === 0) {
          break;
        }
      }
      if (k >= t.length || t.slice(1, k).trim() === "" || !refs_only(t.slice(1, k))) {
        return false;
      }
      t = t.slice(k + 1).trim();
      continue;
    }
    const piece = REF_ONLY_PIECES.map((r) => r.exec(t)).find((m) => m !== null && m[0] !== "");
    if (piece === undefined || piece === null) {
      return false;
    }
    t = t.slice(piece[0].length).trim();
  }
  return true;
}
function open_after(text: string): boolean {
  return !refs_only(text);
}
// the line after a label that says fixed, that goes on its text (an
// item's indented line, a paragraph's next line): read as what follows
// the state on the label's line (open_after), whatever its case. Only
// references keep the note fixed ("…**\n   e testada no iPhone", "…**\n
// (bun 262/0)"); anything else keeps it open, a pending word or not
// ("…**\nMas o Safari ainda falha.", "…:\nfalta o iPhone", "…**\nO
// iPhone não foi visto.", DarkGiraffe 3, 25/10): no list of pending
// words, the safe side (a description on the next line is a false alarm)
function open_next(line: string): boolean {
  return open_after(fold(line.replace(/[*_`]/g, "").trim()));
}
function fixed(label: string): boolean {
  const m = FIXED_WORD.exec(label);
  if (m === null || NOT_FIXED.test(label) || !STATUS.test(label.slice(0, m.index))) {
    return false;
  }
  let said = label.slice(m.index);
  let depth = 0;
  for (const c of label.slice(0, m.index)) {
    depth += c === "(" ? 1 : c === ")" ? -1 : 0;
  }
  if (depth > 0) {
    let d = depth;
    for (let k = 0; k < said.length; k++) {
      d += said[k] === "(" ? 1 : said[k] === ")" ? -1 : 0;
      if (d < depth) {
        // past its parenthesis, what qualifies it keeps the note open
        // ("### Ressalva baixa (corrigida em abc1234) e falta teste")
        if (open_after(said.slice(k + 1))) {
          return false;
        }
        said = said.slice(0, k);
        break;
      }
    }
  }
  return ALL_FIXED.test(said.replace(/[*_`\[\]]/g, ""));
}

// a text says a note fixed, and nothing else: "corrigida", "todas
// corrigidas em abc", "ambas resolvidas", "corrigida e testada"
// (SilverNoodle, 25/10), "resolvida e verificada em abc", "corrigida em
// abc e testada em def". What may follow "corrigida" or "testada" is only
// a reference: where ("em abc1234", "no PR #19", "pelo commit abc"), or
// a parenthesis with one ("(commit abc)", "(bun 251/0)", "(Pipeline.ts)").
// A reference is a hash, or a token with a digit, "#", ".", "/" or ":"
// (REF); any other word says more, and the note stays open, so no list of
// caveats is needed: "corrigida só a primeira", "corrigidas, exceto a 2"
// (ProudCougar), "… (mas não no iOS)", "… em parte", "… no Chromium
// apenas" (SleepyMoose), "… (iOS desconhecido)", "… (a confirmar)", "…
// em metade", "… (limitado ao Chromium)" (NeatWombat, 25/10), and also
// "… testada no Chromium apenas" (the place, then a word that limits it).
// A hash has 7 to 40 hex digits, one a digit at least ("a29e956"; not
// "cafe", LongCow, 25/10); a fraction ("em 1/2") or a token with only
// "/" ("a/b"), or a word before a sentence's "." ("abc."), isn't a
// reference, a count is only after its noun ("bun 251/0"); where it was
// tested ("no iPhone", "no Safari 17", "localmente") and an item's
// number ("(item 2)") are (LongCow). On a folded text, without its marks
const HASH = String.raw`(?=[a-f]*\d)[0-9a-f]{7,40}\b`;
const TOKEN = String.raw`(?!\d+\/\d+(?![\w#:\/-]|\.\w))(?=[\w#./:-]*(?:\d|#|[.:]\w))[\w#./:-]*[\w#/]`;
const ENV = String.raw`(?:iphone|ipad|ios|safari|chromium|chrome|firefox|webkit|android|macos|linux|windows|navegador|browser|desktop|celular|pwa)(?:\s+\d+(?:\.\d+)*)?\b`;
const REF = String.raw`(?:` + HASH + String.raw`|ci(?:\s+(?:verde|ok|passou|passando|green|passing|passed))?\b|` + ENV + String.raw`|` + TOKEN + String.raw`)`;
const REF_NOUN = String.raw`(?:commit|commits|head|hash|pr|prs|pull|branch|issue|teste|testes|test|tests|bun|arquivo|arquivos|file|files|build|run|job|item|itens|ponto|pontos|ressalva|ressalvas)`;
const ART = String.raw`(?:(?:o|a|os|as|the)\s+)?`;
const REF_ONE = ART + String.raw`(?:(?:` + REF_NOUN + String.raw`\s+){1,2}(?:\d+\/\d+|` + REF + String.raw`)|` + REF + String.raw`)(?:\s+(?:casos|testes|frases|relatos|cenarios|bordas))?`;
const REFS = REF_ONE + String.raw`(?:\s*(?:,\s*|\s+(?:e|and)\s+)(?:(?:em|no|na|nos|nas|in|on)\s+)?` + REF_ONE + String.raw`)*`;
const FIX_PAREN = String.raw`\s*\(\s*(?:(?:ver|veja|see)\s+)?` + REFS + String.raw`\s*\)`;
const fix_where = (by: string) => String.raw`(?:\s+localmente|\s+(?:` + by + String.raw`)\s+` + REFS + String.raw`)?(?:` + FIX_PAREN + String.raw`)?`;
const ALL_FIXED = new RegExp(
  String.raw`^\s*(?:(?:todas?|tudo|ambas|as\s+(?:\d+|duas|tres|quatro|cinco))\s+(?:(?:as\s+)?ressalvas\s+)?)?(?:(?:ja\s+)?(?:foram|estao)\s+)?` + FIX + String.raw`\w*` +
    fix_where("em|no|na|nos|nas|pelo|pela|por|in|on|by|at") +
    String.raw`(?:(?:\s*,\s*|\s*,?\s+(?:e|and)\s+)(?:testad|verificad|conferid|validad|cobert|tested|verified)\w*` +
    fix_where("em|no|na|nos|nas|pelo|pela|por|com|in|on|by|at|with") +
    String.raw`)?\s*\.?\s*$`,
);

// the pieces of a text that only refers (refs_only)
const REF_ONLY_PIECES = [
  /^(?:[.,;]+|[—–-]+|(?:e|and)\b)/,
  new RegExp(String.raw`^` + FIX + String.raw`\w*`),
  /^(?:testad|verificad|conferid|validad|cobert|tested\b|verified\b)\w*/,
  /^(?:ja|tambem|depois|agora|ok|localmente|locally|also|now)\b/,
  /^(?:com|with)\s+(?:testes?|tests?|cobertura|coverage)\b/,
  new RegExp(String.raw`^(?:(?:ver|veja|see)\s+)?(?:(?:em|no|na|nos|nas|do|da|dos|das|de|pelo|pela|pelos|pelas|por|via|com|in|on|of|by|at|with)\s+)?(?:` + REFS + String.raw`)`),
];

// the start of a line labeled a note with its severity, to the severity:
// "**Ressalva 1 (média", "### Ressalva 2 — baixa", "Observação alta";
// on a folded line
const NOTE_HEAD = /^[\s>#*_]*(?:ressalvas?|observac(?:ao|oes))\s+(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,—–-]?\s*)?(?:altas?|medias?|baixas?)\b/;

// a line labeled a note with its severity is fixed, by its label
// ("**Ressalva 1 (média, corrigida):** x") or by its text, that says
// only that (ALL_FIXED: "corrigida em abc"), whether a ":" ends the
// label or not: "**Ressalva 1 (média):** corrigida em abc", "**Ressalva
// 1 (média)** — corrigida em abc", "Ressalva 1 (alta) corrigida." all
// are (LemonRobin, 25/10); "…: corrigida só em parte" or "… — o teste
// corrigido não cobre x" aren't. Its label ends after the severity and
// its parenthesis, at its first ":", bold's end or dash. On a folded line
// A label of only a severity, without "Ressalva" ("**Média** (corrigida em
// abc1234)", "**Baixa (corrigida)**", JuicyTuna, 25/10), is fixed by its
// label or its parenthesis too, not by its text ("Baixa: corrigida em abc"
// says it of the text: label_of). What qualifies the state after it ("…
// (corrigida em abc1234), mas ainda falha", "… (corrigida em abc1234)
// (aberta)", "… — mas o Safari falha": open_after) keeps the note open
const SEV_LABEL = /^[\s>#*_]*(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,.):—–-]?\s*)?(?:altas?|medias?|baixas?)\b/;
// a note labeled by its number without a severity ("**Ressalva 1
// (corrigida em abc1234)** mas sem teste", BraveTiger 2, 25/10): its
// state is read as one with a severity's. On a folded line
const NOTE_NUM_HEAD = /^[\s>#*_]*(?:ressalva|observacao)\s+(?:n[o.]?\s*)?[a-z]?\d+[a-z]?\b/;
const FIX_START = new RegExp(String.raw`^` + FIX);
// a text that says only a fix: "corrigida em abc1234", "já tratada",
// "todas corrigidas (bun 262/0)"; on a folded text, its marks off
function says_fixed(f: string): boolean {
  const t = f.replace(/[*_`]/g, "").trim();
  return ALL_FIXED.test(t) || (FIX_START.test(t.replace(/^ja\s+/, "")) && refs_only(t));
}
function note_fixed(f: string): boolean {
  return note_state(f) === "fixed";
}
// a note's state, by its label (note_fixed): "fixed"; "open" if its label
// says a fixed state that what follows qualifies ("**Média** (corrigida em
// abc1234) e o teste falha", "**Média (corrigida em abc1234), mas falta
// teste**", "**Ressalva 1 (corrigida)** mas sem teste", BraveTiger, 25/10)
// or that's only in part ("**Média** (corrigida em parte)"); "none" if it
// says no state
function note_state(f: string): "fixed" | "open" | "none" {
  const named = NOTE_HEAD.exec(f) ?? NOTE_NUM_HEAD.exec(f);
  const head = named ?? SEV_LABEL.exec(f);
  if (head === null) {
    return "none";
  }
  let i = head[0].length;
  const close = f.slice(i).search(/[)\]]/);
  const open = f.slice(i).search(/[(\[]/);
  if (close >= 0 && (open < 0 || open > close)) {
    i += close + 1;
  }
  // a parenthesis right after the severity is the label's, whatever ends
  // it ("### Ressalva baixa (corrigida em abc1234)", "Ressalva baixa
  // (corrigida)" with no bold nor ":", as "**Ressalva baixa (corrigida
  // em abc1234)**", SweetSheep, 25/10)
  for (let p = /^\s*[(\[]/.exec(f.slice(i)); p !== null; p = /^\s*[(\[]/.exec(f.slice(i))) {
    let d = 0;
    let k = i;
    for (; k < f.length; k++) {
      d += f[k] === "(" || f[k] === "[" ? 1 : f[k] === ")" || f[k] === "]" ? -1 : 0;
      if (d === 0 && k >= i + p[0].length - 1) {
        break;
      }
    }
    if (k >= f.length) {
      break;
    }
    i = k + 1;
  }
  const sep = /:|\*\*|__|\s[—–-]\s|^\s*[—–]/.exec(f.slice(i));
  const end = sep === null ? i : i + sep.index;
  const label = f.slice(0, end);
  const text = f.slice(sep === null ? end : end + sep[0].length).replace(/[*_`]/g, "").replace(/^[\s:—–-]+/, "");
  // a dash that ends the label connects what follows ("— e o teste falha")
  const dashed = sep !== null && /[—–-]/.test(sep[0]) ? "— " + text : text;
  // a parenthesis that opens the text, after the bold or the dash, says
  // the label's state too ("**Ressalva baixa** (corrigida em abc1234)")
  const paren = /^\([^()\n]*\)/.exec(text);
  // after the state, with a colon or without one, only references keep
  // it fixed (open_after): "**Ressalva baixa (corrigida):** ok",
  // "**Média** (corrigida em abc1234): (item 2)" are; "**Média**
  // (corrigida em abc1234): não foi testada no iPhone", "…: só no
  // Chromium", "**Ressalva média (corrigida):** o Safari ainda falha"
  // (DarkGiraffe 1-2, 25/10) and also a description ("…: só o título
  // mudava", CrispyWasp) aren't: the safe side, a false alarm, never a
  // note lost
  const colon = sep !== null && (sep[0] === ":" || /^[*_`]*\s*:/.test(f.slice(end + sep[0].length)));
  if (fixed(label)) {
    return !open_after(dashed) ? "fixed" : "open";
  }
  if (paren !== null && fixed(label + " " + paren[0])) {
    const rest = text.slice(paren[0].length).replace(/^\s*:/, "");
    return !open_after(rest) ? "fixed" : "open";
  }
  if (named !== null && text !== "" && ALL_FIXED.test(text)) {
    return "fixed";
  }
  // a bold severity, then a dash or a space and its text that opens with
  // its state ("**Média** — corrigida em abc1234", DarkGiraffe 4, 25/10):
  // as a named note's, fixed only if what follows only refers; after a
  // ":" ("**Baixa:** corrigida em abc") the text is the note's, it counts
  // so does a severity without bold, its state right after it ("Média
  // corrigida, falta o iPhone", "Baixa corrigida em abc1234", RoyalToucan
  // 3, 25/10), in a paragraph or an item, under a heading or not
  if (named === null && !colon && FIX_START.test(text)) {
    return refs_only(text) ? "fixed" : "open";
  }
  // a numbered or labeled note whose text opens with its state, with no
  // bold ("Ressalva 2 corrigida, falta o iPhone", "Ressalva 1 corrigida
  // exceto no Safari", GentleShrimp 2, 25/10): as with bold, fixed only if
  // what follows only refers (refs_only), else open
  if (named !== null && FIX_START.test(text)) {
    return refs_only(text) ? "fixed" : "open";
  }
  return states(label) || (paren !== null && states(label + " " + paren[0])) ? "open" : "none";
}

// a label says a state of fixed, whole or not: its fixed word after only
// the note's name, number and severity (STATUS), not denied
function states(label: string): boolean {
  const m = FIXED_WORD.exec(label);
  return m !== null && !NOT_FIXED.test(label) && STATUS.test(label.slice(0, m.index));
}

// the severity an item opens with (SEV_FIRST: "1. MÉDIA: …"), or the one
// its note label gives ("- **Ressalva média:** …", "- Ressalva 1 (alta): …")
function sev_first(line: string): keyof Sevs | null {
  const first = SEV_FIRST.exec(line);
  if (first !== null) {
    return sev_in(first[1]);
  }
  const head = NOTE_HEAD.exec(fold(line).replace(/^\s*(?:\d+[.)]|[-*•])\s+/, ""));
  return head === null ? null : sev_in(head[0]);
}

// a line's label, folded: a heading's whole title ("### Ressalvas
// corrigidas", "## Ressalvas (corrigidas)", WarmParrot), up to its ":"
// if it has one, with what follows only if that says all fixed
// (ALL_FIXED: "### Ressalvas: corrigida só a primeira" is "ressalvas",
// open), else its words
// up to its first ":" (within 160 characters), else its first bold
// words ("1. **MÉDIA (corrigida)** x"), else none (""): "Baixa:
// corrigida em abc" says it of the text, not of the label, so it stays
// a note
function label_of(line: string): string {
  const heading = /^\s*#{1,6}\s+(.*)$/.exec(fold(line.slice(0, 160)));
  if (heading !== null) {
    const title = heading[1].replace(/[*_`]/g, "").trim();
    const colon = title.indexOf(":");
    if (colon < 0) {
      return title;
    }
    const rest = title.slice(colon + 1);
    return ALL_FIXED.test(rest) ? title.slice(0, colon) + " " + rest.trim() : title.slice(0, colon);
  }
  // a code span is cited, its ":" not the label's ("2. **Borda.** `**Ressalva
  // 1 (média)** — corrigida` (sem `:`)", LemonRobin)
  const f = fold(line.slice(0, 160)).replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").replace(/`[^`\n]*`/g, "");
  // a quote opens it: what it says is cited, not its label
  // ("1. \"Ressalva baixa (corrigida): ok\" conta 1 nota", WhitePelican)
  if (/^[\s*_]*["“”'‘’«]/.test(f)) {
    return "";
  }
  const colon = f.indexOf(":");
  const label = colon >= 0 ? f.slice(0, colon) : /^\s*(\*\*|__)([^*_\n]+)\1/.exec(f)?.[2] ?? "";
  // a label on a note names it or its severity ("**Ressalva média
  // (resolvida):**", "1. **MÉDIA (corrigida)** x"); a sentence in bold
  // that only says "corrigida" ("2. **Mantém aberta uma nota que já
  // estava corrigida.**", LongCow, 25/10) is the note's text: none
  return /\b(?:ressalvas?|observac(?:ao|oes)|altas?|high|medias?|medium|baixas?|low)\b/.test(label) ? label : "";
}

// an item labeled in bold, with no ":", whose text right after the bold
// qualifies the state the label says ("1. **Ressalva baixa (corrigida em
// abc1234)** mas ainda falha no Safari", "… — falta teste no iPhone", "…
// e outra coisa", JuicyTuna, 25/10): open_after, the note stays open. After
// a ":" the text is the note's own ("1. **Ressalva 1 (média, corrigida):**
// só o título mudava")
function qualified_after(line: string): boolean {
  const m = /^\s*(?:\d+[.)]|[-*•])\s+(\*\*|__)([^*_\n]+)\1(.*)$/.exec(line);
  if (m !== null && !m[2].includes(":") && !/^\s*:/.test(m[3])) {
    return open_after(fold(m[3]));
  }
  // after the label's ":" (label_of), the same: only references keep it
  // fixed ("1. **Ressalva baixa (corrigida):** ok"); any other text, a
  // pending one ("…:** mas falha no Safari", "…:** o Safari ainda
  // falha") or a description ("…:** só o título mudava"), keeps it open
  // (DarkGiraffe 1-2, 25/10)
  const body = fold(line).replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").replace(/`[^`\n]*`/g, (s) => " ".repeat(s.length));
  const colon = body.indexOf(":");
  return colon >= 0 && open_after(body.slice(colon + 1));
}

// how many notes, and of what severity, a verdict's line says it has:
// "aprovado com duas ressalvas baixas" 2 low, "com 3 ressalvas, todas
// médias" 3 medium; "com ressalvas" (no number) at least one; no
// severity said, low. On a folded line
const COUNT_WORD: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };
// Every count and severity it says, not only the first: "com 1 média e 2
// baixas" 1 medium and 2 low, "com 3 ressalvas: 1 média e 2 baixas" the
// same (RoyalToucan 1, 25/10); a total said above what its pairs add up
// to gives the rest as low ("com 3 ressalvas, 1 média": 1 medium, 2 low)
const SAID_PAIR = /(?:^|[\s,:;(]|\be\b)(\d+|uma?|dois|duas|tres|quatro|cinco)\s+(?:(?:ressalvas?|observac(?:ao|oes))\s+)?(altas?|medias?|baixas?|high|medium|low)\b/g;
// (on its line: a parenthesis on the next one opens a sentence of its own,
// "com ressalvas\n(2 baixas corrigidas). 1 média aberta.", StoneGiraffe 2)
const SAID_PAREN = /^((?:com|c\/|with)\s*(?:(?:\d+|uma?|dois|duas|tres|quatro|cinco)\s+)?(?:ressalvas?|observac(?:ao|oes)|notes?)[ \t*_`,]*)\(([^()\n]*)\)/;
function notes_said(line: string): Sevs {
  const out = zero();
  const a = Math.max(0, line.search(APPROVED));
  // "com" in the verdict's sentence says the notes ("aprovado com
  // ressalvas, …"); else the counts said after the verdict's word do
  // ("aprovado. 2 baixas corrigidas. O resto passou com 1 média.",
  // GentleTrout 2, 25/10)
  const said = line.slice(a);
  const first = said.search(SENTENCE_END);
  const from = /(?:\bcom|\bwith|c\/)\s?/.exec(first < 0 ? said : said.slice(0, first));
  const bare = from === null ? bare_count(said) : null;
  if (bare !== null || from !== null) {
    // a parenthesis right after the notes said gives their count
    // ("com ressalvas (1 média, 2 baixas)", WoodenKangaroo 2, 25/10); any
    // other ends what says them, as a sentence's end does
    const with_ = from === null ? "" : line.slice(a + from.index);
    // the parenthesis is read whole, its ";" and dots as commas ("com
    // ressalvas (nenhuma alta; 1 média, 4 baixas)"); what follows it, to
    // its sentence's end, goes on with it ("(2 baixas corrigidas) e 1 média
    // aberta"), and its sentence ends after it, never inside it
    const paren = SAID_PAREN.exec(with_);
    const after = paren === null ? with_ : with_.slice(paren[0].length);
    const head = paren === null ? "" : paren[1] + ", " + paren[2].replace(/\.(?!\w)|;/g, ",");
    let stretch = bare ?? (head + after.split(/[.;(\n]/)[0]).slice(0, 160);
    // no count said with them, or all said fixed: the sentences after say
    // it, as after a verdict's word (counts_of: "aprovado com ressalvas. 2
    // baixas já tratadas e 1 média aberta.": 1 medium, CleverMango 2;
    // "aprovado com ressalvas, 2 baixas corrigidas. 1 média aberta.",
    // "aprovado com ressalvas. Tudo corrigido. 1 média aberta.": 1 medium,
    // GentleTrout 3, 25/10); so do they after a parenthesis that says
    // none open, on its line too ("aprovado com ressalvas (2 baixas
    // corrigidas). 1 média aberta.": 1 medium, LivelyWaffle, 25/10): the
    // parenthesis is not the count of all of them
    const end = after.search(SENTENCE_END);
    if (bare === null && open_counts(stretch).length === 0 && end >= 0) {
      const next = bare_count("x" + after.slice(end));
      stretch = next === null ? stretch : stretch + ", " + next;
    }
    // of what it says, only the counts not said fixed ("com ressalvas (2
    // baixas já tratadas, 1 média aberta)": 1 medium)
    const counted = bare ?? open_counts(stretch).join(", ");
    const amount = (p: RegExpMatchArray) => (/^\d+$/.test(p[1]) ? Number(p[1]) : COUNT_WORD[p[1]]);
    let sum = 0;
    for (const p of counted.matchAll(SAID_PAIR)) {
      const k = amount(p);
      if (k > 0) {
        out[sev_in(p[2])!] += k;
        sum += k;
      }
    }
    // a total said above what its pairs add up to, fixed or not, gives the
    // rest as low ("com 3 ressalvas, 1 média corrigida": 2 low)
    let all = 0;
    for (const p of stretch.matchAll(SAID_PAIR)) {
      all += Math.max(0, amount(p));
    }
    if (all > 0) {
      const total = /(?:com|c\/|with)\s*(\d+|uma?|dois|duas|tres|quatro|cinco)\s*(?:ressalvas|observacoes|notes)\b/.exec(stretch);
      const n = total === null ? 0 : /^\d+$/.test(total[1]) ? Number(total[1]) : COUNT_WORD[total[1]];
      out.low += Math.max(0, n - all);
      if (sum > 0 || out.low > 0) {
        return out;
      }
    }
  }
  const m = /(?:com|c\/|with)\s*(\d+|uma?|dois|duas|tres|quatro|cinco)?\s*(?:ressalvas?|observac(?:ao|oes)|notes?)([^.;(\n]{0,30})/.exec(line);
  if (m === null) {
    out.low = 1;
    return out;
  }
  const n = m[1] === undefined ? 1 : /^\d+$/.test(m[1]) ? Math.max(1, Number(m[1])) : COUNT_WORD[m[1]];
  // the severity said right after it, "baixas", ", todas baixas"; not
  // one it denies ("nenhuma alta")
  const sev = /^[\s,*_`]*(?:(?:todas?|tudo|ambas)\s+)?(altas?|medias?|baixas?|high|medium|low)\b/.exec(m[2]);
  out[sev === null ? "low" : sev_in(sev[1])!] = n;
  return out;
}

// an item that opens with a note's label: "- **Ressalva média:** …",
// "1. Observação baixa — …"; not one in code ("- `Ressalva 1 (média)` e
// `Ressalva 2` somam", LemonRobin): it cites it. On a folded line
const NOTE_ITEM = /^\s*(?:\d+[.)]|[-*•])\s+[*_]*\s*(?:ressalvas?|observac(?:ao|oes))\b/;

// a paragraph that opens with a label on a note with its severity, then
// says it on the same line: "**Ressalva baixa (o problema…):** em…",
// "Observação média: …", one numbered with its severity after its number
// ("Ressalva 1 (média): …", "**Observação B2 — baixa:** …", ProudCougar);
// not "**Ressalva 1:** corrigida" (no severity), nor "**Ressalvas
// baixas:**" alone (a heading), nor one in code (cited). On a folded line
const NOTE_PARA = /^[\s>*_]*(?:ressalvas?|observac(?:ao|oes))\s+(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,—–-]?\s*)?(altas?|medias?|baixas?)\b[^:\n]{0,160}:[*_`\s]*[^*_`\s]/;

// a line that labels one note by its number and severity, its text
// maybe on the next line: "**Ressalva 1 (média)**", "### Ressalva 2 —
// baixa"; to its ":" or its end, so a "(corrigida)" after its severity
// is in it (fixed). Singular: "Ressalvas 1 e 2 (baixas)" heads a list.
// On a folded line
const NOTE_NUM = /^[\s>#*_]*(?:ressalva|observacao)\s+(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,—–-]?\s*(alta|media|baixa)\b[^:\n]*/;

// a line that labels one note by its severity, and only that, its text
// on the lines after: "**Ressalva baixa**", "### Observação média:",
// "**Ressalva baixa (corrigida)**" (fixed). Singular: "**Ressalvas
// baixas**" heads a list. On a folded line
const NOTE_ONE = /^[\s>#*_]*(?:ressalva|observacao)\s+(alta|media|baixa)\b[\s*_`]*(?:\([^)\n]*\))?[\s*_`:]*$/;

// a heading or a bold label that opens with one note and its severity,
// whatever follows on its line: "### Ressalva baixa (corrigida em abc1234)
// e falta teste", "**Ressalva baixa** (corrigida em abc1234), mas ainda
// falha", "**Ressalva baixa** (aberta (corrigida em abc1234))" (JuicyTuna,
// 25/10). Singular, as NOTE_ONE. On a folded line
const NOTE_LEAD = /^[\s>]*(?:#{1,6}\s+[*_]*|[*_]{2})\s*(?:ressalva|observacao)\s+(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,—–-]?\s*)?(alta|media|baixa)\b/;

// a heading or bold label of a severity ("**Média** …", "**Média, …") or
// of a numbered note without one ("**Ressalva 1 …", "Ressalva 1 …"): a note only if its
// state is said and qualified (note_state "open"), its severity, if any,
// in its group. On a folded line
const LEAD_LABEL = /^[\s>]*(?:(?:#{1,6}\s+[*_]*|[*_]{2})\s*(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,.):—–-]?\s*)?(alta|media|baixa)\b|(?:#{1,6}\s+[*_]*|[*_]{2})?\s*(?:ressalva|observacao)\s+(?:n[o.]?\s*)?[a-z]?\d+[a-z]?\b)/;

// a bold label of a severity, then ":" and its text on the line: "**Baixa:
// texto corrigida no hash**", "**Média:** x" (JuicyTuna, 25/10); not
// "**Baixas:**" alone (a heading). On a folded line
const SEV_PARA = /^[\s>]*[*_]{2}\s*(alta|media|baixa)\b\s*(?:\([^)\n]*\))?[*_\s]*:[*_`\s]*[^*_`\s]/;

// a paragraph's label that says no state, then its text on the line, with
// no ":" (MagicWhale 2, 25/10): a bold severity ("**Média** o botão
// some", "**Baixa (Tasks.ts)** — o aviso") or a note with its severity
// ("Ressalva baixa o botão some"), as an item under no heading is ("-
// **Média** o botão some"); not a bold title that goes on ("**Baixa
// cobertura**"). On a folded line
const LABEL_TEXT = /^[\s>]*(?:[*_]{2}\s*(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,.):—–-]?\s*)?(?:alta|media|baixa)\s*(?:\([^)\n]*\))?\s*[*_]{2}|(?:ressalva|observacao)\s+(?:(?:n[o.]?\s*)?[a-z]?\d+[a-z]?[\s*_`]*[(\[,—–-]?\s*)?(?:alta|media|baixa)\b(?:\s*\([^)\n]*\))?)[\s—–-]*[^\s:*_—–-]/;

// an item that opens with its severity: "1. MÉDIA: …", "- **A1 (ALTA,
// bloqueante)** …", "1. A: baixa", "- Baixa — …", "- **Média** o botão
// some" (its bold closed, as a paragraph's: LABEL_TEXT, MagicWhale 2,
// 25/10); not a word that goes on ("- Baixa cobertura de iPhone")
const SEV_FIRST = /^\s*(?:\d+[.)]|[-*•])\s+[*_`(\[]*\s*(?:[A-Z]\d*\s*[(:.—-]?\s*)?(altas?|high|m[eé]dias?|medium|baixas?|low)(?=[\s*_`)\]]*(?:[:.,;—–()-]|$)|\s*(?:\([^)\n]*\))?\s*[*_]{2}[\s—–-]*[^\s:*_—–-])/i;

// an item that opens with a severity, said as it may go on ("- **Baixas e
// informativas:**")
const SEV_HEAD = /^\s*(?:\d+[.)]|[-*•])\s+[*_`(\[]*\s*(altas?|high|m[eé]dias?|medium|baixas?|low)(?![\p{L}\d])/iu;

// a line that heads notes by their severity, and only that: "**Baixas**",
// "**Baixas:**", "### Médias", "**Baixas** (nenhuma nos relatos reais):"
// (MagicWhale, 25/10); singular too, one note's label, its text on the
// lines after ("**Média**\no botão some", RoyalToucan 3, 25/10); not
// "**Baixas e informativas:**". On a folded line
const SEV_HEADING = /^[\s>]*(?:#{1,6}\s+)?[*_]*\s*(?:altas?|medias?|baixas?)\b[\s*_`]*(?:\([^)\n]*\))?[\s*_`]*:?[\s*_`]*$/;

// a paragraph under a heading on notes that may be one (verdict_of): not
// a label of its own whose name is no note's ("Não testado: iPhone",
// "Conferido: …"), nor one that says none ("Nenhuma.", "Sem outras.") or
// only a fix ("Todas corrigidas em abc1234."), nor a table, a rule, code
// or a comment. On a folded line
function para_note(f: string): boolean {
  const t = f.replace(/[*_`]/g, "").trim();
  if (t === "" || /^(?:\||#|<!--|```|~~~|[-*_]{3,}\s*$)/.test(t) || /^\s*(?:\*\*|__)/.test(f) || /:\s*$/.test(t)) {
    return false;
  }
  if (/^(?:nenhum|nenhuma|nada|n\/a|sem\b|nao\s+ha\b|none\b|nothing\b)/.test(t) || ALL_FIXED.test(t)) {
    return false;
  }
  const label = /^([^:]{1,40}):\s*\S/.exec(t);
  return label === null || /\b(?:ressalvas?|observac(?:ao|oes)|altas?|medias?|baixas?)\b/.test(label[1]);
}

// the first severity a text says ("MÉDIA", "baixas", "high")
function sev_in(s: string): keyof Sevs | null {
  const m = /\b(altas?|high|m[eé]dias?|medium|baixas?|low)\b/i.exec(s);
  if (m === null) {
    return null;
  }
  const f = fold(m[1]).replace(/s$/, "");
  return f === "alta" || f === "high" ? "high" : f === "media" || f === "medium" ? "medium" : "low";
}

function first_line(s: string): string {
  const line = s.split("\n").map((l) => l.replace(/[*_`#>]/g, "").trim()).find((l) => l !== "") ?? "";
  return line.length > 240 ? line.slice(0, 239) + "…" : line;
}

// the PRs a text names, as "repo#n" (lower case), with the head given
// near each (its next 160 characters), and the link of each named with
// its owner ("Numih/auth#307", a GitHub link)
export function prs_named(text: string): { prs: string[]; heads: Record<string, string>; links: Record<string, string> } {
  const found: { key: string; at: number; end: number; link: string | null }[] = [];
  for (const m of text.matchAll(PR_URL)) {
    found.push({ key: m[2].toLowerCase() + "#" + m[3], at: m.index!, end: m.index! + m[0].length, link: "https://github.com/" + m[1] + "/" + m[2] + "/pull/" + m[3] });
  }
  for (const m of text.matchAll(PR_REF)) {
    if (NOT_REPO.test(m[2]) || found.some((f) => m.index! >= f.at && m.index! < f.end)) {
      continue;
    }
    found.push({ key: m[2].toLowerCase() + "#" + m[3], at: m.index!, end: m.index! + m[0].length, link: m[1] === undefined ? null : "https://github.com/" + m[1] + "/" + m[2] + "/pull/" + m[3] });
  }
  found.sort((a, b) => a.at - b.at);
  const heads: Record<string, string> = {};
  const links: Record<string, string> = {};
  for (const f of found) {
    const head = HEAD.exec(text.slice(f.end, f.end + 160));
    if (head !== null && heads[f.key] === undefined) {
      heads[f.key] = head[1].toLowerCase();
    }
    if (f.link !== null && links[f.key] === undefined) {
      links[f.key] = f.link;
    }
  }
  return { prs: [...new Set(found.map((f) => f.key))], heads, links };
}

// two keys of one PR, one named shorter ("messaging#17" and
// "dp-bk-messaging#17"): the longer one's
export function pr_same(a: string, b: string): boolean {
  const [ra, na] = a.split("#");
  const [rb, nb] = b.split("#");
  return na === nb && (ra === rb || ra.endsWith("-" + rb) || rb.endsWith("-" + ra));
}

// Fronts
// ======

// the panel's fronts: of every ref of the list, its tasks' and its runs'
export function fronts(store: Store, runs: Run[], live: Map<string, Live>, now: number): Front[] {
  const refs = new Map<string, string>();
  const add = (r: string | null) => r !== null && r.trim() !== "" && !refs.has(r.toLowerCase()) && refs.set(r.toLowerCase(), r);
  store.refs.forEach(add);
  store.tasks.forEach((t) => add(t.ref));
  runs.forEach((r) => add(r.ref));
  const out: Front[] = [];
  for (const [low, ref] of refs) {
    const tasks = store.tasks.filter((t) => (t.ref ?? "").toLowerCase() === low);
    const mine = runs.filter((r) => r.ref.toLowerCase() === low);
    if (tasks.length === 0 && mine.length === 0) {
      continue;
    }
    out.push(front_of(ref, tasks, mine, store.tasks, live, now));
  }
  const rank: Record<Stage, number> = { user: 0, stalled: 1, verif: 2, impl: 3, others: 4, closed: 5 };
  return out.sort((a, b) => rank[a.stage] - rank[b.stage] || (a.stage === "closed" ? b.since.localeCompare(a.since) : a.since.localeCompare(b.since)));
}

function front_of(ref: string, tasks: Task[], runs: Run[], all: Task[], live: Map<string, Live>, now: number): Front {
  const open = tasks.filter((t) => t.state === "open");
  const shut = new Set(all.filter((t) => t.state !== "open").map((t) => t.id));
  const blocked = (t: Task) => t.after.some((id) => !shut.has(id) && all.some((u) => u.id === id));
  const working = runs.filter((r) => r.state === "working");
  const nowIso = new Date(now).toISOString();
  // runs with their verdict and notes as a task's prs gives them, if any
  const checks = tasks.flatMap((t) => t.prs ?? []);
  const runs_ = runs.map((r) => {
    if (r.role !== "verif") {
      return r;
    }
    const by = checks.filter((p) => p.verifier !== null && (p.verifier === r.name || p.verifier === r.label));
    if (by.length === 0) {
      return r;
    }
    const notes = zero();
    by.forEach((p) => p.notes.forEach((n) => (notes[n.sev] += 1)));
    const worst = by.some((p) => p.verdict === "rejected") ? "rejected" : by.some((p) => p.verdict === "approved_with_notes") ? "approved_with_notes" : by.every((p) => p.verdict === "approved") ? "approved" : r.verdict;
    return { ...r, verdict: worst, notes, noted: true };
  });
  // stage
  let stage: Stage;
  let since: string;
  const last_end = runs_.filter((r) => r.state !== "working").map((r) => r.end).sort().pop() ?? null;
  const verifying = working.filter((r) => r.role === "verif");
  const user = open.filter((t) => t.assignee === "user" && !blocked(t) && (t.waits_for ?? null) === null);
  const outside = open.filter((t) => (t.waits_for ?? null) !== null || blocked(t));
  if (verifying.length > 0) {
    stage = "verif";
    since = verifying.map((r) => r.start).sort()[0];
  } else if (working.length > 0) {
    stage = "impl";
    since = working.map((r) => r.start).sort()[0];
  } else if (user.length > 0) {
    stage = "user";
    since = user.map((t) => t.ready ?? t.made).sort()[0];
  } else if (outside.length > 0) {
    stage = "others";
    since = outside.map((t) => t.moved ?? t.changed).sort()[0];
  } else if (open.length > 0) {
    stage = "stalled";
    since = [last_end, ...open.map((t) => t.moved ?? t.changed)].filter((x): x is string => x !== null).sort().pop() ?? nowIso;
  } else {
    stage = "closed";
    since = [last_end, ...tasks.map((t) => t.closed ?? t.changed)].filter((x): x is string => x !== null).sort().pop() ?? nowIso;
  }
  // cycles: each verifier's run, with the work it checks: the runs
  // before it not yet given to a cycle, of its theme if any is
  const cycles: Cycle[] = [];
  const given = new Set<string>();
  for (const r of runs_) {
    if (r.role !== "verif") {
      continue;
    }
    const before = runs_.filter((x) => x.role !== "verif" && !given.has(x.name) && x.start <= r.start);
    const theme = theme_of(r.label);
    const same = before.filter((x) => theme !== "" && theme_of(x.label) === theme);
    const work = same.length > 0 ? same : before.filter((x) => theme_of(x.label) === "" || !runs_.some((v) => v.role === "verif" && v.start > r.start && theme_of(v.label) === theme_of(x.label)));
    work.forEach((x) => given.add(x.name));
    cycles.push({ n: cycles.length + 1, run: r, after: work });
  }
  // the work after the last cycle, not verified yet: fixing its notes
  const after = runs_.filter((x) => x.role !== "verif" && !given.has(x.name) && cycles.length > 0 && x.start > cycles[cycles.length - 1].run.start);
  const lastCycle = cycles[cycles.length - 1] ?? null;
  const fixing = lastCycle !== null && after.some((r) => r.role === "impl");
  const userChecks = open.flatMap((t) => t.prs ?? []);
  let notes = zero();
  if (userChecks.length > 0) {
    userChecks.forEach((p) => p.notes.forEach((n) => (notes[n.sev] += 1)));
  } else if (lastCycle !== null && !fixing && stage !== "closed") {
    notes = { ...lastCycle.run.notes };
  }
  // PRs
  const prs = front_prs(runs_, tasks, live);
  // metrics
  const first = [...runs_.map((r) => r.start), ...tasks.map((t) => t.made)].sort()[0] ?? nowIso;
  const busy: [number, number][] = [
    ...runs_.map((r) => [Date.parse(r.start), r.state === "working" ? now : Date.parse(r.end)] as [number, number]),
    ...tasks.filter((t) => t.assignee === "user").map((t) => [Date.parse(t.ready ?? t.made), t.closed !== null && t.state !== "open" ? Date.parse(t.closed) : now] as [number, number]),
  ];
  const endAt = stage === "closed" ? Date.parse(since) : now;
  const idle = idle_ms(Date.parse(first), endAt, busy);
  const decide = tasks.filter((t) => t.assignee === "user" && t.state !== "open" && t.closed !== null && t.closed_by !== "unii")
    .map((t) => Date.parse(t.closed!) - Date.parse(t.ready ?? t.made)).filter((ms) => Number.isFinite(ms) && ms >= 0);
  return {
    ref, stage, since,
    tasks: open.map((t) => ({ id: t.id, title: t.title, assignee: t.assignee, state: t.state })),
    runs: runs_, cycles, prs, open: notes, fixing, idle, decide, first,
  };
}

// a front's PRs: those its runs' tasks and its tasks' prs name, one key
// each (a shorter name folded into the longer: pr_same)
function front_prs(runs: Run[], tasks: Task[], live: Map<string, Live>): FrontPr[] {
  const keys: string[] = [];
  const links = new Map<string, string>();
  const keyOf = (k: string): string => {
    const same = keys.find((x) => pr_same(x, k));
    if (same === undefined) {
      keys.push(k);
      return k;
    }
    if (k.length > same.length) {
      keys[keys.indexOf(same)] = k;
      const l = links.get(same);
      if (l !== undefined) {
        links.delete(same);
        links.set(k, l);
      }
      return k;
    }
    return same;
  };
  for (const r of runs) {
    r.prs.forEach((k) => keyOf(k));
    Object.entries(r.links ?? {}).forEach(([k, l]) => links.has(keyOf(k)) || links.set(keyOf(k), l));
  }
  for (const t of tasks) {
    for (const p of t.prs ?? []) {
      const n = prs_named(p.url);
      n.prs.forEach((k) => links.set(keyOf(k), n.links[k] ?? p.url));
    }
    const n = prs_named(t.title + "\n" + t.detail + "\n" + (t.origin_url ?? ""));
    n.prs.forEach((k) => keyOf(k));
    Object.entries(n.links).forEach(([k, l]) => links.has(keyOf(k)) || links.set(keyOf(k), l));
  }
  return keys.map((key) => {
    const verifs = runs.filter((r) => r.role === "verif" && r.prs.some((k) => pr_same(k, key)));
    const last = verifs[verifs.length - 1] ?? null;
    const headKey = last === null ? undefined : Object.keys(last.heads).find((k) => pr_same(k, key));
    const check = tasks.flatMap((t) => t.prs ?? []).filter((p) => prs_named(p.url).prs.some((k) => pr_same(k, key))).pop() ?? null;
    const url = links.get(key) ?? null;
    return {
      key, url, cycles: verifs.length,
      head: check?.head ?? (headKey === undefined ? null : last!.heads[headKey]),
      verdict: check?.verdict ?? last?.verdict ?? null,
      live: url === null ? null : live.get(url) ?? null,
    };
  });
}

// how long, from `from` to `to`, none of the spans was going on (ms)
export function idle_ms(from: number, to: number, busy: [number, number][]): number {
  if (!(to > from)) {
    return 0;
  }
  const spans = busy.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let covered = 0;
  let at = from;
  for (const [a, b] of spans) {
    if (b <= at) {
      continue;
    }
    covered += b - Math.max(a, at);
    at = b;
  }
  return to - from - covered;
}

// Pull requests, live
// ===================

// how a PR is read: `gh pr view` (replaced in the tests)
export const GH: { read: (url: string) => Promise<Live | null> } = { read: gh_read };

const LIVE = new Map<string, { live: Live | null; at: number }>();
let reading = 0;
const queue: string[] = [];

async function gh_read(url: string): Promise<Live | null> {
  try {
    const proc = Bun.spawn(["gh", "pr", "view", url, "--json", "state,headRefOid,statusCheckRollup"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const kill = setTimeout(() => proc.kill(), LIVE_TIMEOUT);
    const text = await new Response(proc.stdout).text();
    clearTimeout(kill);
    if ((await proc.exited) !== 0) {
      return null;
    }
    return live_of(JSON.parse(text));
  } catch {
    return null;
  }
}

// gh's answer as a Live (pure, for the tests)
export function live_of(x: any): Live | null {
  const state = x?.state;
  if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") {
    return null;
  }
  const checks: any[] = Array.isArray(x.statusCheckRollup) ? x.statusCheckRollup : [];
  const said = checks.map((c) => String(c?.conclusion || c?.state || c?.status || "").toUpperCase());
  const ci: Ci = said.length === 0 ? "none"
    : said.some((s) => /FAIL|ERROR|CANCEL|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE/.test(s)) ? "failed"
    : said.some((s) => /PENDING|QUEUED|IN_PROGRESS|EXPECTED|WAITING|REQUESTED|^$/.test(s)) ? "running" : "ok";
  return { state, head: typeof x.headRefOid === "string" ? x.headRefOid.toLowerCase() : "", ci };
}

// the PRs read so far, and whether any of `urls` is being read again:
// those not read, or read too long ago, are asked for (at most
// LIVE_AT_ONCE at a time), not awaited; done: called as each ends
export function live_get(urls: string[], now: number, done: () => void = () => {}): { live: Map<string, Live>; refreshing: boolean } {
  const live = new Map<string, Live>();
  let refreshing = false;
  for (const url of urls) {
    const had = LIVE.get(url);
    if (had?.live) {
      live.set(url, had.live);
    }
    const ttl = had?.live && had.live.state !== "OPEN" ? LIVE_DONE : LIVE_OPEN;
    if (had === undefined || now - had.at > ttl) {
      refreshing = true;
      if (!queue.includes(url)) {
        queue.push(url);
      }
    }
  }
  live_pump(done);
  return { live, refreshing: refreshing || reading > 0 };
}

function live_pump(done: () => void): void {
  while (reading < LIVE_AT_ONCE && queue.length > 0) {
    const url = queue.shift()!;
    reading += 1;
    GH.read(url).catch(() => null).then((live) => {
      LIVE.set(url, { live, at: Date.now() });
      reading -= 1;
      done();
      live_pump(done);
    });
  }
}

// forget what was read (the tests)
export function live_clear(): void {
  LIVE.clear();
  queue.length = 0;
}

// The panel
// =========

// the panel of a chat's dir: its fronts, and the PRs read live (those of
// the active fronts first, at most LIVE_MOST)
export function panel(store: Store, dir: string, working: Set<string>, now: number): Panel {
  const runs = runs_read(dir, working, store.refs, store.tasks);
  const first = fronts(store, runs, new Map(), now);
  const urls = first.flatMap((f) => f.prs.filter((p) => p.url !== null && p.live?.state !== "MERGED").map((p) => p.url!));
  const { live, refreshing } = live_get([...new Set(urls)].slice(0, LIVE_MOST), now);
  return { at: new Date(now).toISOString(), fronts: fronts(store, runs, live, now), refreshing };
}

// AGENTES.md
// ==========

// a run's row of the table vigia.ts reads: Nome de papel | Nome técnico |
// Projeto | Papel (its tasks marked "(P48)") | Modelo | Estado ("em
// andamento" first, while at work)
export function md_row(r: Run): string {
  // a pipe in a cell is a "/": vigia.ts splits a row by every "|", an
  // escaped one too
  const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "—";
  const notes = sevs_said(r.notes);
  const state = r.state === "working" ? "em andamento desde " + when_said(r.start)
    : r.state === "cut" ? "interrompido (sem relato), " + when_said(r.end)
    : "concluído" + (r.verdict === null ? "" : ": " + VERDICT_SAID[r.verdict] + (notes === "nenhuma" ? "" : " (ressalvas: " + notes + ")")) + ", " + when_said(r.end);
  const role = ROLE_SAID[r.role] + (r.prs.length > 0 ? " " + r.prs.join(", ") : "") + (r.tasks.length > 0 ? " (" + r.tasks.join(", ") + ")" : "");
  return "| " + [r.label ?? "", r.name, r.ref, role, r.model ?? "padrão", state].map(cell).join(" | ") + " |";
}

// the serve's part of AGENTES.md: its marks, a note, the table
export function md_block(runs: Run[]): string {
  return [
    MD_START,
    "## Agentes (gerado pelo serve)",
    "Escrito pelo serve quando um agente começa e termina (uniichat, R6). Não edite à mão: a próxima escrita desfaz.",
    "",
    "| Nome de papel | Nome técnico | Projeto | Papel | Modelo | Estado |",
    "|---|---|---|---|---|---|",
    ...runs.map(md_row),
    MD_END,
  ].join("\n");
}

// the file with the serve's part put in: in the place of its first part
// (an end mark and the start mark nearest before it), if there; else
// after what's there (a file written by hand keeps all it had). Other
// parts are taken out, and a mark with no pair (an end with no start
// before it, a start with no end after it) too: never two parts
export function md_merge(had: string, block: string): string {
  const PLACE = "\u0000unii-agentes\u0000";
  let rest = had;
  let placed = false;
  for (let from = 0; ;) {
    const b = rest.indexOf(MD_END, from);
    if (b < 0) {
      break;
    }
    const a = rest.lastIndexOf(MD_START, b);
    if (a < from) {
      from = b + MD_END.length;
      continue;
    }
    const after = rest.slice(b + MD_END.length);
    rest = rest.slice(0, a) + (placed ? after.replace(/^\n/, "") : PLACE + after);
    from = placed ? a : a + PLACE.length;
    placed = true;
  }
  for (const mark of [MD_START, MD_END]) {
    rest = rest.split(mark + "\n").join("").split(mark).join("");
  }
  if (placed) {
    return rest.replace(PLACE, () => block);
  }
  return rest.trim() === "" ? block + "\n" : rest.replace(/\n*$/, "\n\n") + block + "\n";
}

// where the serve writes AGENTES.md: UNII_AGENTES (the file vigia.ts
// reads, ~/orquestracao/AGENTES.md), else the chat's dir
export function md_file(dir: string): string {
  const env = process.env.UNII_AGENTES ?? "";
  return env !== "" ? env : dir + "/AGENTES.md";
}

// write it, if what it says changed; a failure is said in the log, never
// thrown (an agent's start or end goes on)
export function agents_md(store: Store, dir: string, working: Set<string>): void {
  const file = md_file(dir);
  try {
    const runs = runs_read(dir, working, store.refs, store.tasks);
    const had = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const next = md_merge(had, md_block(runs));
    if (next !== had) {
      fs.writeFileSync(file + ".new", next);
      fs.renameSync(file + ".new", file);
    }
  } catch (err: any) {
    console.error("unii: AGENTES.md not written (" + file + "): " + String(err?.message ?? err));
  }
}
