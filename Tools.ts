// Tools
// =====
// Unii's prompts, tools and agents. Calls get the tools as MCP over one
// local port, at a URL with the chat's secret and the caller ("main", an
// agent; a compaction has none).
// shell, read, write, edit and view_video run on the device their
// `device` field names: a computer running `unii device` (Device.ts), one
// per sign-in (host, host-2...), listed in each call's message. A name
// stays its sign-in's while the server runs, so a call meant for one
// computer never reaches another. A device's links are its sockets: one
// whose link is lost stays, its jobs waiting, until it quits. It is told its
// jobs' ids as they change, and each job new to it; a job's output is an
// act (Server.ts). A device's skills (Machine.skills), read as a job when
// it joins and as each turn starts, are listed in each call's message
// while it is open; the skill tool loads one, as a job too.
// A subagent has a name and a log; each call
// gets its context and its whole log, so a told agent goes on even after
// a restart; its replies reach the chat as one "[Name]" message.
// The master's schedules (schedule, schedules, unschedule) are kept with
// its chat, each coming as a "[Timer id]" message (Timer.ts). Its resume
// wakes every call waiting for a usage limit (Agent.resume), for a user
// who knows one lifted early.
// The user's MCP servers (Mcp.ts) add their tools to the master's and its
// subagents', but those of servers the chat turned off (Memory `off`).

import { AskAI, type Ask, type Block, type Call, type Event, type Kind } from "./AskAI.ts";
import { Agent, type Out } from "./Agent.ts";
import { report_text } from "./Call.ts";
import { clip_page } from "./Clip.ts";
import * as config from "./Config.ts";
import { INT, Machine, STR, TOOLS, VIDEO_LIMIT, spec, type Job, type Skill, type Spec } from "./Machine.ts";
import { Mcp, type Server, type Servers } from "./Mcp.ts";
import { Memory } from "./Memory.ts";
import PROMPT from "./prompt.txt" with { type: "text" };
import COMPACT_PROMPT from "./compact.txt" with { type: "text" };
import { EFFORTS, Pick } from "./Pick.ts";
import * as Tasks from "./Tasks.ts";
import * as Evidence from "./Evidence.ts";
import * as Restart from "./Restart.ts";
import * as Timer from "./Timer.ts";
import * as Guard from "./Guard.ts";
import type { Live } from "./View.ts";

export type { Live };

// Types
// =====

// a device: its sign-in (a session's hash), its links by tab (none:
// closed), jobs by id, and its skills as last looked at (Tools.look)
type Device = {
  who    : string;
  terms  : Map<string, Link>;
  jobs   : Map<string, Running>;
  skills : Skill[];
};

// a job: the link it runs on, what it runs, its output, what ends it
type Running = { term: string; job: Job; out: Promise<Out>; end: (out: Out) => void };

// a device's link: how to reach it, whether its socket is open now, its
// work dir, its shell if not a POSIX one
export type Link = { send: (msg: object) => void; live: () => boolean; work: string; shell: string | null };

// at work, the view its calls get and its replies so far
export type Agent = {
  name    : string;
  label   : string | null; // what the user reads it as (Tools.start)
  role    : { effort: string | null; model: string | null };
  call    : Call | null;
  live    : Live[];
  calls   : Record<string, string>; // its tool calls awaiting their results, by id (Chat.on)
  stop    : boolean; // its call was stopped: the report stays unanswered
  why     : string | null; // its report, if stopped by the stop tool
  view    : Block[];
  replies : string[];
  // its tree (P109): who started it (an agent's name; null: Unii), how
  // deep it is (Unii's own 1, theirs 2); waiting: it ended with agents
  // of its own at work, so its report waits for theirs (Tools.run);
  // waking: a report of one of them is starting it again (Tools.wake)
  parent?  : string | null;
  depth?   : number;
  waiting? : boolean;
  waking?  : boolean;
  // the vigia (Tools.vigia): its last sign of life (ms), whether it
  // waits for a usage limit, whether the vigia resumed it in this run
  // (once: the next stall is reported), is resuming it now, or found it
  // stalled again
  seen?     : number;
  parked?   : boolean;
  revived?  : boolean;
  reviving? : boolean;
  stuck?    : boolean;
  // when the vigia stopped its call (to resume it, or as stalled): one
  // that hasn't ended VIGIA.grace later is let go (Tools.abandon); run:
  // the run (Tools.run) its call belongs to, so one let go ends unsaid
  since?    : number;
  run?      : symbol;
};

// what the server does for agents (report: work stopped stays unanswered;
// pick: the chat's pick; halt: what stops its turn; note: a note to the
// chat, as of an MCP server failing), and as the chat's schedules change
// (timed)
type Hooks = {
  push   : (agent: Agent, kind: Kind, text: string) => void;
  note   : (text: string) => void;
  on     : (agent: Agent, ev: Event) => void;
  report : (agent: Agent, text: string, stopped: boolean) => void;
  change : () => void;
  timed  : () => void;
  pick   : () => Pick;
  halt   : () => AbortSignal;
  restart? : (how: Restart.How) => void; // the process restarted, as `how` says, once the tool answered (Server.ts)
  agents?  : () => void; // an agent started: AGENTES.md written again (Pipeline.agents_md; as it ends, its report does it, Server.ts Chat.report)
};

// the tools: the chat's MCP servers
export type Tools = {
  mem     : Memory;
  devices : Map<string, Device>;
  agents  : Map<string, Agent>;
  labels  : Map<string, string>; // every agent's label it has, by name (Tools.labels)
  parents : Map<string, string>; // who started each agent that an agent started, by name (Tools.parents)
  vigia?  : ReturnType<typeof setInterval>; // the vigia's timer (Tools.vigia)
  mcp     : Servers;
  key     : string;
  url     : string;
  hooks   : Hooks;
  origin? : string; // where the master's turn now came from (Tasks.Origin; Server.ts Chat.call)
};

// Constants
// =========

// the most web searches a request of a turn or a subagent runs
export const SEARCHES = 10;

// how long the stop tool waits for its agent to end (ms)
const HALT = 5000;

// how a refusal of the serve's starts (a spawn past the tree's limits:
// Tools.spawn_check), so the call says it failed
const REFUSED = "Recusado pelo serve: ";

// the vigia (Tools.vigia): how long an agent at work may show no sign of
// life (config vigia_minutes), how often it looks (ms; the tests set
// both), and what a call it resumed is told
// grace: how long a call the vigia stopped may take to end before the
// serve lets it go and reports the agent stalled (ShinyRhino, P109: a
// call that never ended kept its agent "at work" forever, unreported)
export const VIGIA = { idle: config.VIGIA_MINUTES * 60_000, every: Math.min(30_000, Math.max(1000, config.VIGIA_MINUTES * 15_000)), grace: 60_000 };
const VIGIA_SAY = "[Vigia] Your call showed no sign of life for " + config.VIGIA_MINUTES + " minutes, so the serve stopped it and asked again from your log: go on from where you were. If you are stalled again, you'll be stopped and reported stalled.";

// how long past a device's own limit for a shell or view_video job the
// server waits before ending it (ms), and how long it waits on a quick
// job (read, write, edit, skill) (Tools.job_limit)
const SPARE = 30_000;
const QUICK = 120_000;

// the chats' tools, by their secret; the server, once one is
const CHATS = new Map<string, Tools>();
let HTTP: ReturnType<typeof Bun.serve> | null = null;

// the requests running, by chat, caller, MCP session and JSON-RPC id:
// what a `notifications/cancelled` for one stops
const RUNNING = new Map<string, Set<AbortController>>();
const SESSION = "mcp-session-id";

// the two prompts: the user prompt, every turn's (prompt.txt), and the
// compaction prompt, every summary's and nothing else (compact.txt, after
// upstream #37 by @tinqr: with one prompt for both, a turn sometimes came
// back a summary). Each is replaced by its file in the server's dir,
// written by hand or on the Settings page (Server.ts)
export const PROMPTS = {
  prompt  : { def: PROMPT.trim(), file: config.DIR + "/prompt.md" },
  compact : { def: COMPACT_PROMPT.trim(), file: config.DIR + "/compact.md" },
};

const SUB_HEAD = `You are a subagent of Unii, an AI agent that works for one user in a
single chat that never ends. Unii gave you a task. Do it yourself, with
your tools, following the user's instructions at the end of this
prompt: they say who the user is, how their files are organized and how
they want work done.

Your first message holds the view below, then your chat with Unii so far,
its lines as "i|kind: text": what you are (note), your task (user), and
later all you did and were told. The view shows you what Unii knows: what the user wants,
decided and taught. Use it as context only, and do what your task says,
not what the user's last message says, since Unii may have given you
just part of the work. Your final reply is your report to whoever started
you: Unii, or the agent your first note names ("child of Name"). Either
may send you more messages, even while you work: answer the last.`;

// agents that start agents (P109): the tree, its limits, the bans every
// subagent inherits (Guard.ts) and the vigia (Tools.vigia)
const NESTED = `Agents of your own: spawn, tell and stop work for you as they do for
Unii. Start agents only for parts of your task that truly run apart (a
verifier is never the author of what it verifies). Each one's report
reaches you as a message "[Name]" when it ends; tell and stop reach
only the agents you started and theirs. The serve keeps the tree small:
Unii's agents are depth 1, theirs depth 2, and a spawn deeper than
depth ${config.AGENTS_DEPTH} is refused, as one past ${config.AGENTS_FRONT} agents at work under
one agent of Unii's, or past ${config.AGENTS_MAX} at work in all: then do that part
yourself. If you end while agents you started are at work, your report
waits: each of their reports wakes you with it, and your report goes up
once none of yours is at work, with all you said meanwhile.

What no subagent does, whoever started it, by the user's order: merge a
pull request, push to main or master, push tags, create a release,
restart or stop the serve, deploy or apply infrastructure. The serve
refuses a shell command that does one of these, and a push that doesn't
name the branch it goes to (git push, git push origin HEAD: name it, as
git push origin HEAD:feat/x). It refuses too: git push origin tag v1,
a destination heads/main or tags/x, a tag made and pushed in one
command, git send-pack; gh release create; gh api writes to git/refs or
contents on main, merges, a workflow's dispatches, releases or
pulls/N/merge, and curl or wget to the GitHub API with a method that
changes it; terraform, tofu or terragrunt apply, destroy or import;
kill -STOP, -TSTP, -TTIN, -TTOU (signals 19 to 22), kill -1, kill
$PPID; pkill, killall (by name or path), pgrep or pidof that reach the
serve; fuser -k on a file or the serve's port; a kill fed by lsof or ps
that finds the serve; a pkill -f pattern that may take long to match
(nested or many quantifiers). Don't look for another way (a script, an
alias): say in your report what is left, for Unii to take to the user.
Agents you start inherit this.

The vigia: an agent at work with no sign of life for ${config.VIGIA_MINUTES} minutes (no
output, no tool running, no usage limit) is resumed once, and whoever
started it is told; stalled again, it is stopped and reported stalled.`;

const VIEW_DOC = `The view: the whole chat between Unii and the user, oldest first, inside
<chat> tags, as one-line summaries. Each line is

  id+n|text   the n messages from id on, summarized (newlines shown as spaces)

A summary tags each item with its kind: user (the user's words), unii
(Unii's replies), tool (Unii's tool calls), echo (their results), note
(memories from before this chat), or work (the report of a subagent,
starting "[Name]", or a scheduled message from the timer, starting "[Timer id]"). A short message is its own line, word for word. Recent lines
cover one message each; the older the messages, the more a line covers.
A message not summarized yet shows as "(not summarized yet: zoom it)".
No message appears in full, not even the last ones. A text too long for
one message is split over several in a row.

Navigating: zoom(id, n) opens line id+n into the two lines of n/2
messages it was made from; zoom(id, 1) gives message id in full, with
the images its "[image <file>]" lines name. Zoom whenever a summary
only mentions something you need, such as what your last reply said, a
decision, a past attempt or where a file is, before you act, guess or
ask. date(id) gives the date and time of message id. zoom("Name") gives
an agent's whole chat.`;

// an agent's log starts with a note of what it is: SUB_NOTE, and its
// model and effort if not the configured ones, and its label if given
// (one line, last: older notes, without, read the same)
const SUB_NOTE   = "subagent";
const SUB_ON     = " on ";
const SUB_AT     = " at effort ";
const SUB_AS     = ", labeled ";
const SUB_OF     = ", child of "; // the agent that started it, if not Unii (P109)
const SUB_ROLE   = new RegExp("^" + SUB_NOTE + "(?:" + SUB_ON + "(\\S+))?(?:" + SUB_AT + "(\\S+))?(?:" + SUB_OF + "([A-Za-z-]+))?(?:" + SUB_AS + "(.+))?$", "s"); // s: a label edited by hand with a line break (U+2028...) still reads

// a label's most characters (graphemes: an emoji's parts are never cut
// apart), and most code points, so marks piled on them can't make it long
const LABEL = 60;
const LABEL_POINTS = 2 * LABEL;
const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

// the models a subagent may be given (Tools.call): by label, or
// "vendor:model" for one more than one vendor offers
const MODELS = Pick.names(config.OFFER.vendors, config.OFFER.models);

// the devices: how they work, in the system prompt (DEVICES); those open
// now, at the start of each call's message (Tools.devices), so one
// joining or leaving changes a call's tail, never its cached prefix
const DEVICES = `Devices: the user's computers that run unii's device now, by name, listed
at the start of each message. Your shell, read, write, edit and view_video
tools run on the one their \`device\` field names. A computer is listed only
while its device runs, and leaves the list when it stops: a task that needs
one not listed can't be done now, so tell the user it isn't available.`;
const DEVICES_NONE = "(None is open now.)";

const SKILLS = "Skills on the devices open now, by device: when a task matches one's description, load it with the skill tool first, then follow it.";

// how long a device may take to list its skills, in ms: one that takes
// longer keeps those it listed last
const LOOK = 3000;

// a subagent's prompt: its part, then the view's and the devices' docs;
// then, after AGENT_PROMPT, the user prompt if the user wrote one (their
// instructions are in it; the built-in one holds none, only Unii's turns)
const SUB = SUB_HEAD + "\n\n" + VIEW_DOC + "\n\n" + NESTED + "\n\n" + DEVICES;
const AGENT_PROMPT = "Unii's own prompt follows, for the user's instructions in it. Where it speaks to Unii, it speaks of the agent you work for, not of you.";

// the tools of everyone (OWN), the master's (BOSS), those that run on a
// device (`kit`: Machine.ts's)
const OWN: Spec[] = [
  spec("zoom", "Open the line id+n of the view into the two lines of n/2 under it; n = 1 gives the message whole. With an agent's name as id, give that agent's whole chat. A long text comes in pages from character at, saying where to go on.", { id: { type: ["integer", "string"] }, n: INT, at: INT }, ["id"]),
  spec("date", "The date and time of message id.", { id: INT }, ["id"]),
];
// a task's fields (Tasks.ts fields_read)
const FIELDS_SPEC = {
  type: "array",
  description: "Questions asked at once, each answered apart (at most 12): id (letters, digits, - or _), label (the question, in the user's language), kind: choice (one of choices), multi (any of choices), text, yesno (sim or não); choices for choice and multi (2 to 9); required (true by default: the user can't conclude without it); recommend: the answer you recommend, if any (one of its choices; for multi, a list of them; for yesno, sim or não; for text, a text), which the user takes with one click (\"Aceitar as recomendadas\") instead of writing \"(recomendado)\" in a choice.",
  items: { type: "object", properties: { id: STR, label: STR, kind: { type: "string", enum: ["choice", "multi", "text", "yesno"] }, choices: { type: "array", items: STR }, required: { type: "boolean" }, recommend: { type: ["string", "array"], items: STR } }, required: ["id", "label", "kind"] },
};

// the choice Unii recommends (Tasks.ts recommend_read)
const RECOMMEND_SPEC = { type: "string", description: "The choice you recommend (one of choices): the user sees it marked and takes it, with the fields' recommendations, in one click (\"Aceitar as recomendadas\"). Give it rather than writing \"(recomendado)\" in the choice. With choices and none recommended, the click only fills the fields' recommendations and the user still picks the choice." };

// where a task came from, and its source's link (Tasks.ts)
const ORIGIN_SPEC = { type: "string", description: "Where it came from, always given (never taken from the turn): chat (the user asked for it), timer (a schedule's turn), agent:<name> (a subagent's report asked for it), slack or github. A task you add after an agent's report, of your own accord, is chat or timer, not that agent's." };
const ORIGIN_URL_SPEC = { type: "string", description: "A link (http/https) to its source, such as the Slack message or the GitHub issue." };
// the task's contract (R5, Tasks.ts): its pull requests as verified, who
// acts on each choice, what outside the list it waits for, a new front
const PRS_SPEC = {
  type: "array",
  description: "The pull requests it's about, each as verified: url (the GitHub pull link), head (the commit verified, 7 to 40 hex), verdict (approved, approved_with_notes, rejected, pending), verifier (the verifier agent's name), notes ([{sev: high, medium or low, text}]: its notes by severity), untested (what wasn't tested). Required for kind pr: a PR's approval without its link and head is refused. The views show each as a verification card.",
  items: { type: "object", properties: { url: STR, head: STR, verdict: { type: "string", enum: ["approved", "approved_with_notes", "rejected", "pending"] }, verifier: STR, notes: { type: "array", items: { type: "object", properties: { sev: { type: "string", enum: ["high", "medium", "low"] }, text: STR }, required: ["sev", "text"] } }, untested: { type: "array", items: STR } }, required: ["url", "head"] },
};
const ACTS_SPEC = { type: "object", additionalProperties: { type: "string", enum: ["user", "unii"] }, description: "By choice, who acts once the user picks it: user (it reports what they did, \"Mesclado\") or unii (an order to you, \"Sim, reinicie\": you're told at once, not in the minute's batch). Choices not named: none said." };
const WAITS_FOR_SPEC = { type: "string", description: "What outside the list it waits for (\"CI do #42\", \"merge no GitHub\"), beside after (tasks); \"\" for none." };
const REF_SPEC = { type: "string", description: "Its front: one of the list's (an unknown one is refused, with the nearest and the list), as uniichat-ux or num-2337. \"\" for none." };
const REF_NEW_SPEC = { type: "boolean", description: "true: ref starts a new front, added to the list. Only for a front truly new, never a variant of one listed." };
const KIND_SPEC = "What it is, as when it's late counts, from when it became the user's to act on: pr (a PR's approval: needs prs) 24 h, decision 72 h, test 2 h, action (a step only the user can do) 24 h, restart (the serve's restart, only while agents are at work: with no choices it gets its template, \"Sim, reinicie\" (yours) or \"Eu reinicio depois\"; with none at work, use the restart tool) 24 h, info (only to read) never, priority low unless given, and listed after every task to act on; none: 24 h (a GitHub pull link in its title makes it pr, a title opening with \"Teste\" makes it test). Whatever its kind, a task of the user's that cites a GitHub pull in its title or detail needs prs. A late one only says so: it never expires.";
// the evidence round (Evidence.ts, Tasks.ts)
const EVIDENCE_SPEC = {
  type: ["object", "array"],
  description: "What closes it (state done or dropped): evidence of a concrete, documented solution, checked by the system; without it the close is refused. One object or a list (at most 5), each {type, ..., summary?}: slack {channel: the channel's id (C…/D…/G…), ts: the message's ts} (a message you sent); pr_merged {url} (read live on GitHub: must be MERGED); commit_tests {repo: owner/repo, sha, command, passed, failed: 0} (the commit read live on GitHub); tfc {run: run-<16>, status: applied or planned_and_finished}; file {path: absolute, on the server's computer, must exist}; reason {text: at least 40 characters} (only to drop: why it no longer applies). On a task closed already without evidence (sem evidência), it's added.",
  items: { type: "object" },
};
const DONE_WHEN_SPEC = { type: "string", description: "What concretely makes it done (\"PR #19 mesclado e serve reiniciado\", \"resposta enviada a Enzo no Slack\"): its evidence must show it when it's closed. Required." };
const NEXT_STEP_SPEC = { type: "string", description: "Your next concrete step on it (required for a task of yours): the views show it, and once its due passes the task is overdue." };
const NEXT_DUE_SPEC = { type: "string", description: "When the next step is due: a time (ISO) or from now (\"4h\", \"30m\", \"2d\"). None: the server's setting (4 h by default) after the task last moved. Past it, the task is overdue: said to you in each turn's block, shown in the views, pushed to the user once." };
const STATUS_SPEC = { type: "string", enum: ["open", "waiting_user", "blocked"], description: "An open task's status: open (being worked on); waiting_user (yours, waiting for something only the user can give: status_why says what; it shows in their Agora); blocked (status_why: why; unblock: what unblocks it). An order received is the user's pick, never set." };
const AGENT_SPEC = { type: "string", description: "The agent at work on it now, by name (its generated name or its label): for a task of yours, who follows it up, so the views show it and a task with no agent at work is seen as stalled. \"\" for none." };
const BOSS: Spec[] = [
  spec("spawn", "Start one subagent per task, in parallel, and return their names at once. Each one's report reaches you as a message \"[Name] report\" when it finishes. A subagent sees the view and the user's instructions, but knows what you want only from its task.", { tasks: { type: "array", items: STR }, labels: { type: "array", items: STR, description: "A short label per task, in the tasks' order, that the user reads as that subagent's name instead of its generated one: <project>-<role>, as num-3182-verifier or uniichat-links-impl. Give one for every task. You still name it by its generated name in tell, stop and zoom." }, effort: { type: "string", enum: EFFORTS, description: "How hard they think; by default, as hard as you." }, model: { type: "string", enum: MODELS, description: "Their model (\"vendor:model\" names its vendor too, as cursor:sonnet-5.5); by default, the one they'd run on. Set it ONLY when the user asks for that model or vendor in this chat, since another vendor may come with additional costs." } }, ["tasks"]),
  spec("tell", "Send a message to a subagent, by name. One at work reads it between its tool calls, and its report answers it; an idle one goes on from its chat, and its reply reaches you as a message \"[Name] reply\".", { name: STR, message: STR }, ["name", "message"]),
  spec("schedule", "Schedule a message to yourself: at its time it reaches you as a message \"[Timer id]\" from the timer, not the user, starting a turn as a report does, whether or not the user is online. Give `at` to send it once, or `cron` to send it again and again, and the time zone both are read in (the user's). Write the message as the task to do then, whole: by then this turn is far back in the view.", {
    message : STR,
    at      : { type: "string", description: "Once: YYYY-MM-DD HH:MM, in zone." },
    cron    : { type: "string", description: "Again and again: minute hour day month weekday, as cron, in zone (\"0 8 * * mon-fri\": weekdays at 08:00); its times at least 5 minutes apart." },
    zone    : { type: "string", description: "An IANA time zone, such as Europe/Amsterdam or UTC." },
  }, ["message", "zone"]),
  spec("schedules", "List the chat's schedules: id, when each comes next, its message.", {}, []),
  spec("unschedule", "Cancel a schedule, by its id.", { id: STR }, ["id"]),
  spec("stop", "Stop a subagent at once, by name, whatever it is doing (mid-call, waiting on a usage limit, running a tool on a device: that job is cancelled). Others keep running. Its report says it was stopped; its chat and work dir stay, so a later tell resumes it.", { name: STR, why: { type: "string", description: "Why, for its report." } }, ["name"]),
  spec("resume", "Wake every call on this server waiting for an AI service's usage limit (your turn, summaries), when the user says a limit was reset early. Each asks again once; one still limited waits again. A subagent at a usage limit ends and reports it instead: tell it to go on.", {}, []),
  // the pending list (Tasks.ts)
  spec("task_add", "Add a task to the chat's pending list, which the user sees beside the chat and resolves there, whenever they can (done, with one of its choices and a comment, or dropped). Add one for each thing you need of the user (an approval, a product decision, a step only they can do, such as restarting a server) instead of leaving the question at the end of a reply, where it gets lost; and, with assignee \"unii\", for what you must follow up yourself. Each turn's message lists the open tasks and what the user changed since your last turn: check it first and never add one already open. When one can only be resolved after another (a token before a test, a merge before a deploy), give it after: the user then sees only what they can do now, sorted by priority, then the tasks that free others, then the one theirs to act on longest. Give each its origin (where it truly came from) and its kind (pr, decision, test, action, restart, info), which says when it is late; a PR's approval (kind pr) goes with its prs as verified (link, head, verdict, notes by severity, what wasn't tested), and an option that's an order to you (\"Sim, reinicie\") with acts. Several questions or decisions on one subject go in one task as fields (each answered apart, kept as a draft, all sent when the user concludes, in your next turn's block). The user may also talk with you in a task's thread without resolving it: their message reaches you marked \"[Pendência P7: …]\"; reply with task_reply. What the user resolves reaches you on its own, within a minute, in a \"[Pendências]\" message (several at once if they came together). On a task of yours (assignee \"unii\") the user can only ask after it (\"Cobrar agora\", a message in its thread) or tell you to close it (\"Pode fechar\", done by them): keep its agent set. No task is closed without a documented solution: give done_when (what concretely makes it done); for one of yours, next_step (and next_due, else it's due 4 h after it last moved, and overdue past it). With choices, acts must name every one: a choice of yours is an order, which stays open as yours (an order received) until you close it with evidence of the execution. Whenever you tell the user you will do something later (\"vou revisar\", \"em seguida eu…\"), add it here as a task of yours in the same turn, or don't promise it. Title: short, the action or question, in the user's language.", {
    title   : STR,
    detail  : { type: "string", description: "Markdown: the context needed to decide, with links." },
    assignee   : { type: "string", enum: ["user", "unii"], description: "Who is responsible, who must act; by default the user. (who: its older name, still read.)" },
    origin     : ORIGIN_SPEC,
    origin_url : ORIGIN_URL_SPEC,
    agent      : AGENT_SPEC,
    choices : { type: "array", items: STR, description: "Answers the user picks with one click (\"sim\", \"não\"), at most 9." },
    recommend : RECOMMEND_SPEC,
    acts    : ACTS_SPEC,
    kind    : { type: "string", enum: ["pr", "decision", "test", "action", "restart", "info"], description: KIND_SPEC },
    prs     : PRS_SPEC,
    waits_for : WAITS_FOR_SPEC,
    priority : { type: "string", enum: ["high", "normal", "low"], description: "Sorts \"Agora\": the higher first, then the one that frees more tasks, then the one the user could act on longest (since it became actionable, or since it was created). Normal by default; high only for what truly comes first." },
    ref     : REF_SPEC,
    ref_new : REF_NEW_SPEC,
    after   : { type: "array", items: STR, description: "Ids of the tasks this one waits for (\"P3\"), the user's or yours: while any is open it's hidden from the user and can't be resolved; once all are closed it shows, and your next turn is told it was freed." },
    fields  : FIELDS_SPEC,
    done_when : DONE_WHEN_SPEC,
    next_step : NEXT_STEP_SPEC,
    next_due  : NEXT_DUE_SPEC,
    status    : STATUS_SPEC,
    status_why: { type: "string", description: "With status waiting_user or blocked: what it waits for, or why it's blocked." },
    unblock   : { type: "string", description: "With status blocked: what unblocks it." },
  }, ["title", "origin", "done_when"]),
  spec("task_edit", "Change a task of the pending list, by its id (P7): its texts, choices, ref or the tasks it waits for (after), or its state: close (done, dropped) one that you resolved or that no longer applies, always with evidence (checked: a Slack message sent, a PR merged, a commit and its tests, a TFC run, a file; a reason only to drop), or open one again. An order received (the user picked a choice of yours) closes only done, with evidence of the execution: you can't drop it. Keep next_step and next_due current, and set status waiting_user or blocked (with why and what unblocks it) instead of letting it stand still. Done is refused while it waits for open tasks (drop it, or change its after). A closed task keeps its kind, choices and acts (what the user picked from): open it again to change them. A change by the user you haven't been told of yet stays to tell, even if you change the state meanwhile.", {
    id      : STR,
    title   : STR,
    detail  : STR,
    assignee   : { type: "string", enum: ["user", "unii"], description: "Who is responsible. (who: its older name, still read.)" },
    origin     : { type: "string", description: "Where it came from: chat, timer, agent:<name>, slack or github." },
    origin_url : { ...ORIGIN_URL_SPEC, description: "A link to its source; \"\" for none." },
    agent      : AGENT_SPEC,
    choices : { type: "array", items: STR },
    recommend : { ...RECOMMEND_SPEC, description: RECOMMEND_SPEC.description + " \"\" for none." },
    acts    : { ...ACTS_SPEC, description: ACTS_SPEC.description + " Replaces them; changing the choices keeps those of the choices kept." },
    kind    : { type: "string", enum: ["pr", "decision", "test", "action", "restart", "info", ""], description: "As task_add's; \"\" for none. Making it pr needs prs." },
    prs     : { ...PRS_SPEC, description: "Its pull requests as verified, replacing the list (as task_add's): after a new verification, give the new head, verdict and notes." },
    waits_for : WAITS_FOR_SPEC,
    priority : { type: "string", enum: ["high", "normal", "low"] },
    ref     : REF_SPEC,
    ref_new : REF_NEW_SPEC,
    state   : { type: "string", enum: ["open", "done", "dropped"] },
    answer  : STR,
    note    : { type: "string", description: "How it was resolved." },
    after   : { type: "array", items: STR, description: "The ids it waits for, replacing the list; [] for none. No task that waits for this one (a cycle)." },
    fields  : { ...FIELDS_SPEC, description: "Its fields, replacing the list (add or remove questions); [] for none. The user's draft answers to fields kept (same id) stay." },
    evidence  : EVIDENCE_SPEC,
    done_when : { ...DONE_WHEN_SPEC, description: "What concretely makes it done." },
    next_step : { ...NEXT_STEP_SPEC, description: "Your next step on it (a new one: its due resets unless next_due is given)." },
    next_due  : NEXT_DUE_SPEC,
    status    : STATUS_SPEC,
    status_why: { type: "string", description: "With status waiting_user or blocked." },
    unblock   : { type: "string", description: "With status blocked." },
  }, ["id"]),
  spec("task_reply", "Reply in a task's thread, where the user talks with you about it without resolving it (their messages reach you marked \"[Pendência P7: …]\"). It's then the user's turn there. Use it for every reply to such a message; a turn that ends without one puts its last reply there. You may also write first, to ask about a task. Reply in the user's language; Markdown.", { id: STR, text: STR }, ["id", "text"]),
  spec("restart", "Restart the serve (this server), the user's standing leave (P8): only with no subagent at work, said in the chat before and after; never restart it by a shell command. Your turn ends with it: give resume, the task to go on with, which comes back to you as a \"[Restart]\" message that starts your turn once the serve is back. With agents at work it's refused: wait for their reports, or add a task of kind restart for the user (its template offers \"Sim, reinicie\", an order to you) and, once they pick it, call restart with that task's id.", { why: { type: "string", description: "What it's for, in the user's language (said in the chat)." }, resume: { type: "string", description: "What to do once it's back, whole: by then this turn is far back in the view." }, task: { type: "string", description: "The id of a task of kind restart the user resolved with an option of yours, to restart while agents are at work (each task lets one; one you closed yourself with task_edit lets none)." } }, ["why", "resume"]),
  spec("tasks", "List the pending list: the open tasks with their details; all: those closed in the last 7 days too; ref: only those whose ref contains it; id: that one whole; unproven: the closed ones without evidence (sem evidência), to prove (task_edit evidence) or open again.", { all: { type: "boolean" }, ref: STR, id: STR, unproven: { type: "boolean" } }, []),
];
// a subagent's own agents (P109): spawn, tell and stop as Unii's, said
// for it (NESTED in its prompt)
const CREW_INFO: Record<string, string> = {
  spawn : "Start one subagent per task, in parallel, as a part of your own task, and return their names at once. Each one's report reaches you as a message \"[Name]\" when it finishes; if you end first, your report waits for theirs. Refused past depth " + config.AGENTS_DEPTH + " (Unii's agents are 1, theirs 2), past " + config.AGENTS_FRONT + " agents at work under one agent of Unii's, or past " + config.AGENTS_MAX + " at work in all: then do it yourself. They inherit your bans (no merge, no push to main, no tags, no restart, no deploy).",
  tell  : "Send a message to an agent you started (or one of theirs), by name. One at work reads it between its tool calls; an idle one goes on, and its reply reaches you as a message \"[Name]\".",
  stop  : "Stop an agent you started (or one of theirs), by name, at once, and the agents it started. Its report says it was stopped.",
};
const CREW: Spec[] = BOSS.filter((s) => s.name in CREW_INFO).map((s) => ({ ...s, info: CREW_INFO[s.name] ?? s.info }));
const DEVICE = { device: { type: "string", description: "The name of the device to run on, one listed under Devices." } };
function kit(who: string): Spec[] {
  return TOOLS.map((t) => {
    const schema = t.schema as { properties: object; required: string[] };
    const info = t.info + " It runs on the device named, in <work>/" + who + ", <work> being the work dir Devices lists for it.";
    return spec(t.name, info, { ...DEVICE, ...schema.properties }, ["device", ...schema.required]);
  });
}
const SKILL: Spec = spec("skill", "Load a skill listed under Skills: its SKILL.md, with the folder its other files are in on that device (read or run them there with your other tools).", { ...DEVICE, name: STR }, ["device", "name"]);
// Tools
// =====

export namespace Tools {

  export function serve(mem: Memory, hooks: Hooks): Tools {
    const key = crypto.randomUUID();
    const url = Tools.base() + key + "/";
    const run = (device: string, job: Job, signal: AbortSignal) => Tools.job(tools, device, job, signal, crypto.randomUUID());
    const mcp = Mcp.servers((text) => hooks.note(text), config.MCP, run, (device) => typeof Tools.open(tools, device) !== "string");
    const tools: Tools = { mem, devices: new Map(), agents: new Map(), labels: Tools.labels(mem), parents: Tools.parents(mem), mcp, key, url, hooks };
    CHATS.set(key, tools);
    tools.vigia = setInterval(() => Tools.vigia(tools, Date.now()), VIGIA.every);
    tools.vigia.unref?.();
    return tools;
  }

  // this process's tools URL
  export function base(): string {
    HTTP ??= Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: Tools.fetch });
    return "http://127.0.0.1:" + HTTP.port + "/";
  }

  export function close(tools: Tools): void {
    clearInterval(tools.vigia);
    Tools.stop(tools, null);
    Mcp.end(tools.mcp);
    CHATS.delete(tools.key);
  }

  export function at(tools: Tools, who: string): string {
    return tools.url + who;
  }

  // a prompt as used: its file, else its default
  export function prompt(which: keyof typeof PROMPTS): string {
    return Memory.file_text(PROMPTS[which].file) || PROMPTS[which].def;
  }

  export function devices(tools: Tools): Block {
    const work  = (d: Device) => [...d.terms.values()][0]?.work;
    const shell = (d: Device) => [...d.terms.values()][0]?.shell;
    const line  = ([name, d]: [string, Device]) => "- " + name + ", work dir " + work(d) + (shell(d) ? ", shell " + shell(d) + " (stopping the device does not kill a process a call left running after its shell ended)" : "");
    const lines = Tools.opened(tools).map(line);
    return { text: "Devices open now:\n" + (lines.length === 0 ? DEVICES_NONE : lines.join("\n")) + "\n\n", mark: false };
  }

  // after the devices, so a change hits a call's tail, not its cached
  // prefix
  export function skills(tools: Tools): Block {
    const lines = Tools.opened(tools).flatMap(([name, d]) => d.skills.map((s) => "- " + name + ": " + s.name + ": " + s.description.replace(/\s+/g, " ")));
    return { text: lines.length === 0 ? "" : SKILLS + "\n" + lines.join("\n") + "\n\n", mark: false };
  }

  // each open device's skills, asked as a job; one that fails (a unii
  // from before skills) has none
  export async function look(tools: Tools, only: string | null = null): Promise<void> {
    const live = Tools.opened(tools).filter(([name, d]) => (only === null || name === only) && [...d.terms.values()].some((t) => t.live()));
    await Promise.all(live.map(async ([name, d]) => {
      const run = Tools.start_job(tools, name, { name: "skills", input: {}, cwd: "main" }, crypto.randomUUID());
      if (typeof run === "string") {
        return;
      }
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        run.end({ text: "Late.", fail: true });
      }, LOOK);
      const out = await run.out;
      clearTimeout(timer);
      if (!late) {
        try {
          d.skills = out.fail ? [] : JSON.parse(out.text);
        } catch {
          d.skills = [];
        }
      }
    }));
  }

  // the master's agents at work now, at the start of each of its calls'
  // messages: read from their calls, so the list is never kept apart and
  // can't drift from the truth
  export function at_work(tools: Tools): Block {
    const names = Tools.working(tools).map((a) => Tools.named(tools, a.name));
    const waiting = [...tools.agents.values()].filter((a) => a.call === null && a.waiting === true).map((a) => Tools.named(tools, a.name));
    const wait = waiting.length === 0 ? "" : " Waiting for agents they started: " + waiting.join(", ") + ".";
    return { text: "Agents at work now: " + (names.length === 0 ? "none." : names.join(", ") + ".") + wait + "\n\n", mark: false };
  }

  // MCP
  // ---

  // a notification gets no answer; a request dropped, or cancelled (a
  // `notifications/cancelled` naming it), stops its job
  export async function fetch(req: Request): Promise<Response> {
    const [, key, who, ...rest] = new URL(req.url).pathname.split("/");
    const tools = CHATS.get(key);
    const caller = who === "main" || tools?.agents.has(who);
    const msg = await req.json().catch(() => ({}));
    const id = crypto.randomUUID();
    const session = req.headers.get(SESSION) ?? "";
    const scope = [key, who, session].join("/") + "/";
    if (msg.id === undefined && msg.method === "notifications/cancelled" && msg.params?.requestId !== undefined) {
      RUNNING.get(scope + JSON.stringify(msg.params.requestId))?.forEach((c) => c.abort());
    }
    const cancel = new AbortController();
    const signal = AbortSignal.any([req.signal, cancel.signal]);
    const name = scope + JSON.stringify(msg.id);
    if (msg.id !== undefined) {
      RUNNING.set(name, (RUNNING.get(name) ?? new Set()).add(cancel));
    }
    try {
      if (tools === undefined || rest.length > 0 || !caller) {
        return new Response(null, { status: 404 });
      }
      if (req.method !== "POST") {
        return new Response(null, { status: 405 });
      }
      if (msg.id === undefined) {
        return new Response(null, { status: 202 });
      }
      const no = { error: { code: -32601, message: "no method " + msg.method } };
      const out = await Tools.answer(tools, who, msg.method, msg.params ?? {}, signal, id).then(
        (result) => (result === null ? no : { result }),
        (err) => ({ error: { code: -32603, message: String(err?.message ?? err) } }),
      );
      return Response.json({ jsonrpc: "2.0", id: msg.id, ...out });
    } finally {
      const set = RUNNING.get(name);
      if (set?.delete(cancel) && set.size === 0) {
        RUNNING.delete(name);
      }
    }
  }

  // null: no such method
  export async function answer(tools: Tools, who: string, method: string, params: any, signal: AbortSignal, id: string): Promise<object | null> {
    switch (method) {
      case "initialize": {
        const protocolVersion = params.protocolVersion ?? "2025-06-18";
        return { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "unii", version: "1" } };
      }
      case "tools/list": {
        const plugged = Tools.plugged(tools, who);
        const theirs = plugged ? await Mcp.list(tools.mcp, Tools.off(tools)) : [];
        // the servers' notes `who` hasn't heard, for the request it
        // builds (Agent.loop); a subagent's kept in its log for its next
        // ones (the master's are the chat's)
        const notes = plugged ? Mcp.heard(tools.mcp, Tools.off(tools), who) : [];
        const agent = tools.agents.get(who);
        notes.forEach((text) => agent !== undefined && tools.hooks.push(agent, "note", text));
        return { tools: [...Tools.list(tools, who), ...theirs].map((t) => ({ name: t.name, description: t.info, inputSchema: t.schema })), notes };
      }
      case "tools/call": {
        const name = String(params.name);
        const args = params.arguments ?? {};
        const has = Tools.list(tools, who).some((t) => t.name === name);
        const mcp = has ? null : Tools.mcp(tools, who, name);
        const no: Out = { text: "No tool " + name + ".", fail: true };
        const out = has ? await Tools.call(tools, who, name, args, signal, id) : mcp !== null ? await Mcp.call(tools.mcp, mcp, name, args, signal) : no;
        const imgs = (out.imgs ?? []).map((img) => ({ type: "image", data: img.data, mimeType: img.type }));
        return { content: [{ type: "text", text: out.text }, ...imgs], isError: out.fail };
      }
      case "ping": {
        return {};
      }
    }
    return null;
  }

  export function list(tools: Tools, who: string): Spec[] {
    return who === "main" ? [...OWN, ...BOSS, ...kit(who), SKILL] : [...OWN, ...CREW, ...kit(who), SKILL];
  }

  // whether `who` gets the MCP servers' tools: the master and subagents
  export function plugged(tools: Tools, who: string): boolean {
    return who === "main" || tools.agents.has(who);
  }

  // the MCP servers the chat turned off
  export function off(tools: Tools): string[] {
    return tools.mem.off ?? [];
  }

  // the MCP server of `who`'s tool `name`, if it is on (named for it: it
  // need not have listed its tools since it crashed; Mcp.call starts it)
  export function mcp(tools: Tools, who: string, name: string): Server | null {
    return Tools.plugged(tools, who) ? Mcp.find(tools.mcp, Tools.off(tools), name) : null;
  }

  // an MCP server turned off: ended, its calls running failed
  export function unplug(tools: Tools, name: string): void {
    const s = tools.mcp.all.get(name);
    if (s !== undefined) {
      Mcp.close(s);
    }
  }

  // id: a job's, if it starts one
  export async function call(tools: Tools, who: string, name: string, args: any, signal: AbortSignal, id: string): Promise<Out> {
    const mem = tools.mem;
    switch (name) {
      case "zoom": {
        const id = String(args.id);
        const n = Number(args.n ?? 1);
        const at = Number(args.at ?? 0);
        if (/^[A-Za-z]/.test(id)) {
          return { text: clip_page(Memory.agent_show(mem, id), at), fail: false };
        }
        const imgs = n === 1 && at === 0 ? Memory.images(mem, Number(id)) : [];
        return { text: Memory.zoom(mem, Number(id), n, at), fail: false, imgs };
      }
      case "date": {
        return { text: Memory.date(mem, Number(args.id)), fail: false };
      }
      case "spawn": {
        const effort = args.effort === undefined ? null : String(args.effort);
        if (effort !== null && !EFFORTS.includes(effort)) {
          return { text: "No effort " + effort + "; one of " + EFFORTS.join(", ") + ".", fail: true };
        }
        const model = args.model === undefined ? null : String(args.model);
        if (model !== null && !MODELS.includes(model)) {
          return { text: "No model " + model + "; one of " + MODELS.join(", ") + ".", fail: true };
        }
        const labels = Array.isArray(args.labels) ? args.labels.map((l: unknown) => (typeof l === "string" ? l : "")) : [];
        const tasks = (args.tasks ?? []).map(String);
        // a subagent's: its tree's limits (P109)
        const no = Tools.spawn_check(tools, who, tasks.length);
        if (no !== null) {
          return { text: no, fail: true };
        }
        const text = await Tools.spawn(tools, tasks, effort, model, labels, who);
        return { text, fail: text.startsWith(REFUSED) };
      }
      case "tell": {
        const no = Tools.reach(tools, who, String(args.name));
        if (no !== null) {
          return { text: no, fail: true };
        }
        return { text: await Tools.tell(tools, String(args.name), String(args.message)), fail: false };
      }
      case "schedule": {
        return Tools.schedule(tools, Timer.timer_new(args, Date.now()));
      }
      case "schedules": {
        const lines = mem.timers.map(Timer.timer_line);
        return { text: lines.length === 0 ? "No schedules." : lines.join("\n"), fail: false };
      }
      case "unschedule": {
        const id = String(args.id);
        return Tools.unschedule(tools, id) ? { text: "Cancelled " + id + ".", fail: false } : { text: "No schedule " + id + ".", fail: true };
      }
      case "stop": {
        const no = Tools.reach(tools, who, String(args.name));
        if (no !== null) {
          return { text: no, fail: true };
        }
        return await Tools.halt(tools, String(args.name), args.why === undefined ? "" : String(args.why), who);
      }
      case "resume": {
        const n = Agent.resume();
        return { text: n === 0 ? "No call was waiting for a usage limit." : "Woke " + n + " call" + (n === 1 ? "" : "s") + " waiting for a usage limit; any still limited waits again.", fail: false };
      }
      case "skill": {
        return Tools.job(tools, String(args.device), { name, input: { name: String(args.name) }, cwd: "main" }, signal, id);
      }
      case "restart": {
        return Tools.restart(tools, args, Restart.how(process.env));
      }
      case "task_edit": {
        // the evidence of a close read live where it can be (a PR merged,
        // a commit), never taken as given (Evidence.evidence_verify)
        if (args?.evidence !== undefined && args?.evidence !== null) {
          const got = await Evidence.evidence_verify(args.evidence);
          if (typeof got === "string") {
            return { text: Tasks.task_id(args.id) + ": " + got + " Nothing was changed.", fail: true };
          }
          return Tools.task(tools, name, { ...args, evidence: got.v }, who);
        }
        return Tools.task(tools, name, args, who);
      }
      case "task_add":
      case "task_reply":
      case "tasks": {
        return Tools.task(tools, name, args, who);
      }
      default: {
        const { device, ...input } = args;
        // what no subagent does, whoever started it (Guard.ts, P109)
        const no = who !== "main" && name === "shell" ? Guard.forbidden(String(input.command ?? "")) : null;
        if (no !== null) {
          return { text: no, fail: true };
        }
        return Tools.job(tools, String(device), { name, input, cwd: who }, signal, id);
      }
    }
  }

  // Schedules
  // ---------

  // a schedule kept with the chat; else why not
  export function schedule(tools: Tools, timer: Timer.Timer | string): Out {
    const mem = tools.mem;
    if (typeof timer !== "string" && mem.timers.length >= Timer.TIMERS) {
      timer = "The chat has " + Timer.TIMERS + " schedules, the most it keeps: cancel one first.";
    }
    if (typeof timer === "string") {
      return { text: timer, fail: true };
    }
    mem.timers = [...mem.timers, timer];
    Memory.save(mem);
    tools.hooks.timed();
    return { text: "Scheduled " + timer.id + ": " + Timer.timer_when(timer) + ".", fail: false };
  }

  // false: none such
  export function unschedule(tools: Tools, id: string): boolean {
    const mem = tools.mem;
    const left = mem.timers.filter((t) => t.id !== id);
    if (left.length === mem.timers.length) {
      return false;
    }
    mem.timers = left;
    Memory.save(mem);
    tools.hooks.timed();
    return true;
  }

  // Tasks
  // -----

  // the pending list's tools (Tasks.ts); a change told to every view
  export function task(tools: Tools, name: string, args: any, who: string): Out {
    const s = Tasks.tasks_load(tools.mem.dir);
    const now = Date.now();
    if (name === "tasks") {
      return { text: Tasks.tasks_list(s, args, now), fail: false };
    }
    // the contract (R5): an origin given, a ref of the list's fronts
    const held = name === "task_reply" ? { args, added: null } : Tasks.tool_args(s, name, args, Tasks.origin_read(tools.origin));
    if (typeof held === "string") {
      return { text: held, fail: true };
    }
    const t = name === "task_add" ? Tasks.task_new(s, held.args, who, now, null) : name === "task_reply" ? Tasks.task_reply(s, args.id, args.text, now) : Tasks.task_edit(s, held.args, now);
    if (typeof t === "string") {
      return { text: t, fail: true };
    }
    if (held.added !== null) {
      Tasks.refs_add(s, held.added);
    }
    tools.hooks.change();
    if (name === "task_reply") {
      return { text: "Replied in " + t.id + "'s thread" + (t.state === "open" ? "; the user's turn there." : " (it's closed)."), fail: false };
    }
    return { text: (name === "task_add" ? "Added " : "Changed ") + Tasks.task_line(t, now, false, s.tasks).slice(2), fail: false };
  }

  // the restart tool (Restart.ts, P8): refused while agents are at work
  // (unless a task of kind restart lets it), else the mark kept, said in
  // the chat, and the process restarted by the server's hook
  export function restart(tools: Tools, args: any, how: Restart.How): Out {
    const why = Tasks.text_line(args.why, Restart.WHY);
    if (why === "") {
      return { text: "Give why: what the restart is for (it's said in the chat).", fail: true };
    }
    const dir = tools.mem.dir;
    const given = args.task === undefined || args.task === null || String(args.task).trim() === "" ? null : String(args.task);
    const task = given === null ? null : Tasks.task_find(Tasks.tasks_load(dir), given);
    const had = Restart.mark_read(dir);
    const used = had?.used ?? [];
    const working = Tools.working(tools).map((a) => a.label === null || a.label === "" ? a.name : a.name + " (" + a.label + ")");
    const no = Restart.check(how, working, task, given, used);
    if (no !== null) {
      return { text: no, fail: true };
    }
    if (tools.hooks.restart === undefined) {
      return { text: "This server can't restart itself.", fail: true };
    }
    const mark: Restart.Mark = { why, resume: Tasks.text_body(args.resume, Restart.RESUME), at: new Date().toISOString(), agents: working, task: task?.id ?? null, done: false, used: [...used, ...(task === null ? [] : [task.id])].slice(-Restart.USED), pid: process.pid };
    Restart.mark_write(dir, mark);
    tools.hooks.note(Restart.said_before(mark));
    tools.hooks.restart(how);
    return { text: "Restarting in " + Restart.DELAY / 1000 + " s: this turn ends there. Once the serve is back, the chat is told it restarted and you get a \"[Restart]\" message, with what you gave as resume, that starts your turn.", fail: false };
  }

  // Devices
  // -------

  // a device's link joins its sign-in's device on host, and is sent its
  // jobs; the device's name
  export function attach(tools: Tools, term: string, host: string, who: string, link: Link): string {
    let name = host;
    for (let k = 2; (tools.devices.get(name)?.who ?? who) !== who; k++) {
      name = host + "-" + k;
    }
    const d = tools.devices.get(name) ?? { who, terms: new Map(), jobs: new Map(), skills: [] };
    d.terms.set(term, link);
    tools.devices.set(name, d);
    Tools.sync(d, term, () => true);
    Tools.look(tools, name);
    return name;
  }

  // a link told its jobs' ids (it halts the rest), then each that `fresh`
  // picks, a message each
  export function sync(d: Device, term: string, fresh: (id: string) => boolean): void {
    const send = d.terms.get(term)?.send ?? (() => {});
    const mine = [...d.jobs].filter(([, j]) => j.term === term);
    send({ $: "jobs", ids: mine.map(([id]) => id) });
    mine.filter(([id]) => fresh(id)).forEach(([id, j]) => send({ $: "job", id, job: j.job }));
  }

  export function detach(tools: Tools, term: string, device: string): void {
    const d = tools.devices.get(device);
    if (d === undefined || !d.terms.delete(term)) {
      return;
    }
    for (const job of d.jobs.values()) {
      if (job.term === term) {
        job.end({ text: "The device " + device + " that ran this stopped.", fail: true });
      }
    }
  }

  export function opened(tools: Tools): [string, Device][] {
    return [...tools.devices].filter(([, d]) => d.terms.size > 0);
  }

  // else why not
  export function open(tools: Tools, device: string): Device | string {
    const d = tools.devices.get(device);
    const open = Tools.opened(tools).map(([name]) => name).join(", ") || "none";
    if (d === undefined || d.terms.size === 0) {
      // only the user opens one, so a retry in a loop only keeps the chat
      // busy: stop and say so instead
      return "No device " + device + " is open (its unii device isn't running). Open: " + open + ". Only the user starts it, so don't retry or wait: end your turn, saying what is left.";
    }
    return d;
  }

  // the job `id` on a device, waited on: started, unless it runs
  export function job(tools: Tools, device: string, job: Job, signal: AbortSignal, id: string): Promise<Out> {
    const run = tools.devices.get(device)?.jobs.get(id) ?? Tools.start_job(tools, device, job, id);
    if (typeof run === "string") {
      return Promise.resolve({ text: run, fail: true });
    }
    const stop = () => run.end({ text: "Stopped.", fail: true });
    signal.aborted ? stop() : signal.addEventListener("abort", stop, { once: true });
    const most = Tools.job_limit(run.job);
    if (most !== null) {
      const late = "(timed out after " + Math.round(most / 1000) + " s: the device didn't answer in time, and was told to kill the job. The output so far is lost.)";
      const timer = setTimeout(() => run.end({ text: late, fail: true }), most);
      run.out.finally(() => clearTimeout(timer));
    }
    return run.out;
  }

  // how long the server waits on a job (ms) before ending it, which tells
  // its device to kill it (null: no limit here; an MCP call has its own).
  // The device ends a shell or view_video job itself at its limit
  // (Machine.ts); this is a backstop past it, for a device whose unii
  // keeps none (older), or that hangs; read, write, edit and skill are
  // quick, but a hung file system could keep them
  export function job_limit(job: Job): number | null {
    switch (job.name) {
      case "shell":      return Machine.limit(job.input?.timeout) * 1000 + SPARE;
      case "view_video": return VIDEO_LIMIT + SPARE;
      case "read":
      case "write":
      case "edit":
      case "skill":      return QUICK;
      default:           return null;
    }
  }

  // a job started on a device's link (the last live one), told to it;
  // else why not
  export function start_job(tools: Tools, device: string, job: Job, id: string): Running | string {
    const d = Tools.open(tools, device);
    if (typeof d === "string") {
      return d;
    }
    const terms = [...d.terms];
    const [term] = terms.filter(([, t]) => t.live()).at(-1) ?? terms.at(-1)!;
    const run = Tools.track(d, id, term, job);
    Tools.sync(d, term, (x) => x === id);
    return run;
  }

  // a job kept until it ends, its link told then
  export function track(d: Device, id: string, term: string, job: Job): Running {
    const { promise, resolve } = Promise.withResolvers<Out>();
    const end = (out: Out) => {
      if (d.jobs.delete(id)) {
        Tools.sync(d, term, () => false);
        resolve(out);
      }
    };
    const run = { term, job, out: promise, end };
    d.jobs.set(id, run);
    return run;
  }

  export function done(tools: Tools, device: string, id: string, out: Out): void {
    tools.devices.get(device)?.jobs.get(id)?.end(out);
  }

  // Agents
  // ------

  // by: who spawns them ("main": Unii; else an agent, their parent)
  export async function spawn(tools: Tools, tasks: string[], effort: string | null, model: string | null = null, labels: string[] = [], by = "main"): Promise<string> {
    const parent = by === "main" ? null : by;
    const view = tasks.length === 0 ? "No tasks." : await Tools.view(tools, parent === null ? undefined : new AbortController().signal);
    if (typeof view === "string") {
      return view;
    }
    // the limits again, now: another spawn may have started agents while
    // this one waited for the view (ShinyRhino, P109: two at once both
    // passed the check made before it). From here to each start nothing
    // awaits, and a start holds its place at once (Tools.run sets its call)
    const no = Tools.spawn_check(tools, by, tasks.length);
    if (no !== null) {
      return no;
    }
    const names = tasks.map((task, k) => Tools.start(tools, { effort, model }, task, view, labels[k] ?? "", parent));
    return "Started " + names.map((name) => Tools.named(tools, name)).join(", ") + ". Each one's report will reach you as a message when it finishes.";
  }

  // Trees
  // -----
  // Agents start agents (P109, 26/10/2026): Unii's are depth 1, theirs
  // depth 2, and no deeper (config agents_depth); at most AGENTS_FRONT at
  // work under one agent of Unii's (its front), and AGENTS_MAX in all.
  // Each one's report goes to the agent that started it (Server.ts
  // Chat.report: Tools.upward), which waits for them before its own.

  // an agent at work, or waiting for those it started: it holds a place
  export function active(a: Agent): boolean {
    return a.call !== null || a.waiting === true;
  }

  // who started it: an agent's name, or null (Unii); one not loaded is
  // read from its log's note (Tools.parents)
  export function parent_of(tools: Tools, name: string): string | null {
    return tools.agents.get(name)?.parent ?? tools.parents.get(name) ?? null;
  }

  // its depth: Unii 0 ("main"), its agents 1, theirs 2 (a chain read
  // from the notes; a loop, hand-made, stops at the cap)
  export function depth(tools: Tools, name: string): number {
    if (name === "main") {
      return 0;
    }
    let n = 1;
    for (let at = Tools.parent_of(tools, name); at !== null && n <= 20; at = Tools.parent_of(tools, at)) {
      n += 1;
    }
    return n;
  }

  // its front: the agent of Unii's it descends from (itself if Unii's)
  export function root(tools: Tools, name: string): string {
    let at = name;
    for (let n = 0, up = Tools.parent_of(tools, at); up !== null && n < 20; n++, up = Tools.parent_of(tools, at)) {
      at = up;
    }
    return at;
  }

  // whether `name` descends from `from` (started by it, or by one it did)
  export function under(tools: Tools, name: string, from: string): boolean {
    for (let n = 0, up = Tools.parent_of(tools, name); up !== null && n < 20; n++, up = Tools.parent_of(tools, up)) {
      if (up === from) {
        return true;
      }
    }
    return false;
  }

  // the agents loaded that descend from `name`
  export function descendants(tools: Tools, name: string): Agent[] {
    return [...tools.agents.values()].filter((a) => Tools.under(tools, a.name, name));
  }

  // the agents it started that are at work or waiting
  export function kids_active(tools: Tools, name: string): Agent[] {
    return [...tools.agents.values()].filter((a) => Tools.parent_of(tools, a.name) === name && Tools.active(a));
  }

  // why `who` can't spawn n agents now, or null: past the depth, its
  // front's or the whole cap (Unii's spawns have the whole cap only)
  export function spawn_check(tools: Tools, who: string, n: number): string | null {
    if (n === 0) {
      return null;
    }
    const depth = Tools.depth(tools, who) + 1;
    if (depth > config.AGENTS_DEPTH) {
      return "Recusado pelo serve: um agente criado por você teria profundidade " + depth + ", e o limite é " + config.AGENTS_DEPTH + " (a Unii é 0, os agentes dela 1, os deles 2). Faça você mesmo esta parte e diga no relato.";
    }
    const all = [...tools.agents.values()].filter(Tools.active).length;
    if (all + n > config.AGENTS_MAX) {
      return "Recusado pelo serve: há " + all + " agentes em ação, e o teto total é " + config.AGENTS_MAX + "; cabem " + Math.max(0, config.AGENTS_MAX - all) + " agora. Espere relatos ou faça você mesmo.";
    }
    if (who !== "main") {
      const front = Tools.root(tools, who);
      const busy = Tools.descendants(tools, front).filter(Tools.active).length;
      if (busy + n > config.AGENTS_FRONT) {
        return "Recusado pelo serve: a frente de " + Tools.named(tools, front) + " já tem " + busy + " agentes em ação abaixo dela, e o teto por frente é " + config.AGENTS_FRONT + "; cabem " + Math.max(0, config.AGENTS_FRONT - busy) + " agora. Espere relatos ou faça você mesmo.";
      }
    }
    return null;
  }

  // why `who` can't tell or stop `name`, or null: Unii reaches any agent;
  // an agent, only those it started and theirs
  export function reach(tools: Tools, who: string, name: string): string | null {
    if (who === "main" || Tools.under(tools, name, who)) {
      return null;
    }
    return "Recusado pelo serve: " + name + " não foi criado por você nem por um agente seu; você só fala com (e para) os seus.";
  }

  // a report (or the vigia's word) for the agent that started `agent`:
  // logged in its chat and, at work, handed to it; idle, it goes on with
  // it (Tools.wake), unless the report is of a stop that ended it, which
  // only wakes one waiting for none else. One that was stopped passes a
  // report on to its own parent (a stop's report is only logged).
  // false: it was Unii's to take (none of the chain is an agent)
  export function upward(tools: Tools, agent: Agent, text: string, stopped: boolean): boolean {
    for (let at = Tools.parent_of(tools, agent.name), n = 0; at !== null && n < 20; at = Tools.parent_of(tools, at), n++) {
      const p = Tools.agent(tools, at);
      if (p === null) {
        return false;
      }
      tools.hooks.push(p, "work", text);
      if (p.call !== null && !p.stop) {
        p.call.send({ text, imgs: [] });
        return true;
      }
      if (p.stop && p.call === null && p.waiting !== true) {
        if (stopped) {
          return true;
        }
        continue;
      }
      if (!stopped || (p.waiting === true && Tools.kids_active(tools, p.name).length === 0)) {
        Tools.wake(tools, p);
      }
      return true;
    }
    return false;
  }

  // an idle agent goes on from its log (what woke it is in it); one
  // waiting for its agents keeps what it said so far for its report
  export async function wake(tools: Tools, agent: Agent): Promise<void> {
    if (agent.waking === true || agent.call !== null) {
      return;
    }
    agent.waking = true;
    const view = await Tools.view(tools, new AbortController().signal);
    agent.waking = false;
    if (typeof view === "string" || agent.call !== null) {
      return;
    }
    const keep = agent.waiting === true ? agent.replies : [];
    Tools.run(tools, Object.assign(agent, { view, replies: keep, stop: false, why: null, waiting: false }));
  }

  // the vigia (P82, P109): every agent at work is looked at each
  // VIGIA.every; one with no sign of life for VIGIA.idle (no output, no
  // tool call running: a tool's own limit ends it, Tools.job_limit; not
  // waiting for a usage limit) is resumed once (its call stopped, then
  // asked again from its log) and whoever started it is told; still
  // stalled after that, it's stopped and reported stalled, a report its
  // parent (or Unii) takes
  export function vigia(tools: Tools, now: number): void {
    for (const agent of Tools.working(tools)) {
      // a call the vigia stopped that hasn't ended: let go, reported
      // stalled (its run ends unsaid if it ever does)
      if ((agent.reviving === true || agent.stuck === true) && now - (agent.since ?? now) >= VIGIA.grace) {
        const secs = Math.round((now - (agent.since ?? now)) / 1000);
        const how = agent.reviving === true ? "retomado" : "parado";
        agent.why = "Travado: a chamada não encerrou " + secs + " s depois de " + how + " pelo vigia; o serve a abandonou.";
        Tools.tell_parent(tools, agent, "[Vigia] " + Tools.named(tools, agent.name) + " não encerrou " + secs + " s depois de " + how + ": abandonado e relatado como travado.");
        Tools.abandon(tools, agent);
        continue;
      }
      if (agent.stop || agent.reviving === true || agent.parked === true || Object.keys(agent.calls).length > 0) {
        continue;
      }
      const idle = now - (agent.seen ?? now);
      if (idle < VIGIA.idle) {
        continue;
      }
      const mins = Math.round(idle / 6e3) / 10;
      if (agent.revived !== true) {
        agent.revived = true;
        agent.reviving = true;
        agent.since = now;
        agent.seen = now;
        Tools.tell_parent(tools, agent, "[Vigia] " + Tools.named(tools, agent.name) + " ficou " + mins + " min sem sinal de vida: retomado uma vez. Se parar de novo, será dado como travado.");
        agent.call?.stop();
        continue;
      }
      agent.stuck = true;
      agent.since = now;
      agent.why = "Travado: " + mins + " min sem sinal de vida depois de retomado pelo vigia; parado pelo serve.";
      Tools.tell_parent(tools, agent, "[Vigia] " + Tools.named(tools, agent.name) + " travou de novo (" + mins + " min sem sinal de vida): parado e relatado como travado.");
      Tools.stop(tools, agent.name);
    }
  }

  // an agent whose call the vigia stopped and that never ended, let go:
  // no longer at work (its place in the tree's limits freed), its
  // processes swept, reported stalled (not as a stop, so its parent or
  // Unii takes it); the run that awaits that call ends unsaid (Tools.run)
  export function abandon(tools: Tools, agent: Agent): void {
    agent.run = undefined;
    agent.call = null;
    agent.calls = {};
    agent.reviving = false;
    agent.stuck = true;
    agent.stop = true;
    agent.replies.push(agent.why ?? "Travado.");
    Tools.sweep(tools, agent.name).catch(() => {});
    tools.hooks.change();
    tools.hooks.agents?.();
    tools.hooks.report(agent, report_text(agent.name, agent.replies.join("\n\n")), false);
  }

  // the vigia's word to whoever started `agent`: a note in the chat
  // (Unii's), or in its parent's log, handed to it if at work
  export function tell_parent(tools: Tools, agent: Agent, text: string): void {
    const at = Tools.parent_of(tools, agent.name);
    const p = at === null ? null : Tools.agent(tools, at);
    if (p === null) {
      tools.hooks.note(text);
      return;
    }
    tools.hooks.push(p, "note", text);
    p.call?.send({ text, imgs: [] });
  }

  // what the work a restart cut is told as it goes on (Server.ts
  // Chat.resume)
  export function restarted(work: string[]): string {
    return "The server restarted, cutting " + work.join(", ") + "; nothing was lost: go on.";
  }

  // by: who tells it ("main": Unii; else the agent that started it, or
  // one above)
  export async function tell(tools: Tools, name: string, message: string, by = "main"): Promise<string> {
    const agent = Tools.agent(tools, name);
    if (agent === null) {
      return "No agent " + name + " to tell.";
    }
    if (agent.call !== null && agent.stop) {
      // being stopped: told once it has ended, so the message isn't lost
      // in the call that ends
      await agent.call.done.catch(() => {});
    }
    if (agent.call !== null) {
      tools.hooks.push(agent, "user", message);
      agent.call.send({ text: message, imgs: [] });
      return "Sent. " + name + " reads it between its tool calls, and its report answers it.";
    }
    const view = await Tools.view(tools, by === "main" ? undefined : new AbortController().signal);
    if (typeof view === "string") {
      return view;
    }
    if (agent.call !== null) {
      return Tools.tell(tools, name, message, by);
    }
    tools.hooks.push(agent, "user", message);
    Tools.run(tools, Object.assign(agent, { view, replies: [], stop: false, why: null, waiting: false }));
    return "Sent. " + name + "'s reply will reach you as a message.";
  }

  // parent: the agent that starts it (P109); null: Unii
  export function start(tools: Tools, role: Agent["role"], task: string, view: Block[], label = "", parent: string | null = null): string {
    const name = Memory.agent_new(tools.mem);
    const shown = Tools.label_clean(label);
    const depth = parent === null ? 1 : Tools.depth(tools, parent) + 1;
    const agent: Agent = { name, label: shown, role, call: null, live: [], calls: {}, stop: false, why: null, view, replies: [], parent, depth };
    tools.agents.set(name, agent);
    if (shown !== null) {
      tools.labels.set(name, shown);
    }
    if (parent !== null) {
      tools.parents.set(name, parent);
    }
    tools.hooks.push(agent, "note", SUB_NOTE + (role.model === null ? "" : SUB_ON + role.model) + (role.effort === null ? "" : SUB_AT + role.effort) + (parent === null ? "" : SUB_OF + parent) + (shown === null ? "" : SUB_AS + shown));
    tools.hooks.push(agent, "user", task);
    Tools.run(tools, agent);
    return name;
  }

  // one not of this process is taken back from its log, idle
  export function agent(tools: Tools, name: string): Agent | null {
    const log = tools.agents.has(name) ? null : Memory.agent(tools.mem, name);
    const note = log !== null && log.length > 0 && log[0].kind === "note" ? log[0].text : "";
    const sub = SUB_ROLE.exec(note);
    if (sub !== null) {
      const parent = sub[3] ?? null;
      tools.agents.set(name, { name, label: Tools.label_clean(sub[4] ?? ""), role: { effort: sub[2] ?? null, model: sub[1] ?? null }, call: null, live: [], calls: {}, stop: false, why: null, view: [], replies: [], parent });
      if (parent !== null) {
        tools.parents.set(name, parent);
      }
      tools.agents.get(name)!.depth = Tools.depth(tools, name);
    }
    return tools.agents.get(name) ?? null;
  }

  // a label as given, on one line, at most LABEL graphemes (LABEL_POINTS
  // code points); null: none. The spawn's and a note's alike (a note may
  // be edited by hand)
  export function label_clean(label: string): string | null {
    const one = label.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
    let cut = "";
    let n = 0;
    let points = 0;
    for (const { segment } of GRAPHEMES.segment(one)) {
      const size = Array.from(segment).length;
      if (n === LABEL || points + size > LABEL_POINTS) {
        break;
      }
      cut += segment;
      n += 1;
      points += size;
    }
    cut = cut.trim();
    return cut === "" ? null : cut;
  }

  // every agent's label, by name, from its log's note (Memory.agent_heads)
  export function labels(mem: Memory): Map<string, string> {
    const out = new Map<string, string>();
    for (const [name, note] of Memory.agent_heads(mem)) {
      const label = Tools.label_clean(SUB_ROLE.exec(note)?.[4] ?? "");
      if (label !== null) {
        out.set(name, label);
      }
    }
    return out;
  }

  // who started each agent an agent started, by name, from its log's
  // note (P109)
  export function parents(mem: Memory): Map<string, string> {
    const out = new Map<string, string>();
    for (const [name, note] of Memory.agent_heads(mem)) {
      const parent = SUB_ROLE.exec(note)?.[3];
      if (parent !== undefined) {
        out.set(name, parent);
      }
    }
    return out;
  }

  // an agent as Unii reads it: its name, its label after it if it has one,
  // and who started it if an agent did (P109)
  export function named(tools: Tools, name: string): string {
    const label = tools.labels.get(name);
    const parent = Tools.parent_of(tools, name);
    const said = [...(label === undefined ? [] : [label]), ...(parent === null ? [] : ["filho de " + parent])];
    return said.length === 0 ? name : name + " (" + said.join(", ") + ")";
  }

  // the agents' labels as the views show them (Server.ts Chat.state):
  // each one's own, and who started it if an agent did ("← Parent")
  export function shown(tools: Tools): Record<string, string> {
    const out: Record<string, string> = Object.fromEntries(tools.labels);
    for (const [name, parent] of tools.parents) {
      out[name] = (tools.labels.get(name) ?? name) + " ← " + (tools.labels.get(parent) ?? parent);
    }
    return out;
  }

  // calls while a message waits in its log (told too late for the call
  // before); then its report. Detached: a throw ends it as a failed
  // reply, still reported
  // Each sign of life of a call (an event) is seen by the vigia
  // (Tools.vigia); one it resumes is asked again from its log, told so.
  // An agent that ends with agents of its own at work waits for them
  // (P109): its report goes once their last one woke it and it ended
  // again with none at work (Tools.upward, Tools.wake). A stalled one
  // (stopped by the vigia) is reported as any, not as a stop
  export async function run(tools: Tools, agent: Agent): Promise<void> {
    // (assigned as one: the vigia changes them while it awaits)
    const mine = Symbol(agent.name);
    Object.assign(agent, { revived: false, reviving: false, stuck: false, waiting: false, since: undefined, run: mine });
    try {
      for (let more = true; more; ) {
        agent.seen = Date.now();
        agent.parked = false;
        agent.call = AskAI.ask(Tools.ask(tools, agent), (ev) => {
          agent.seen = Date.now();
          if (ev.$ === "Limit") {
            agent.parked = ev.limit !== null;
          }
          tools.hooks.on(agent, ev);
        });
        tools.hooks.change();
        tools.hooks.agents?.();
        const end = await agent.call.done;
        // let go by the vigia (Tools.abandon), or started again since:
        // this run is over, said by whoever took it
        if (agent.run !== mine) {
          return;
        }
        agent.call = null;
        if (agent.reviving === true && !agent.stop) {
          agent.reviving = false;
          tools.hooks.push(agent, "user", VIGIA_SAY);
          continue;
        }
        agent.replies.push(end.ok ? end.text : agent.why ?? "failed: " + end.text);
        more = end.ok && end.left.length > 0;
      }
    } catch (err: any) {
      if (agent.run !== mine) {
        return;
      }
      agent.call = null;
      agent.replies.push("failed: " + String(err?.message ?? err));
    }
    const kids = agent.stop ? [] : Tools.kids_active(tools, agent.name);
    if (kids.length > 0) {
      agent.waiting = true;
      tools.hooks.push(agent, "note", "Waiting for " + kids.map((k) => Tools.named(tools, k.name)).join(", ") + ": your report goes once they reported and you ended again.");
      tools.hooks.change();
      tools.hooks.agents?.();
      return;
    }
    tools.hooks.report(agent, report_text(agent.name, agent.replies.join("\n\n")), agent.stop && agent.stuck !== true);
  }

  // a call of an agent, on Tools.pick
  export function ask(tools: Tools, agent: Agent): Ask {
    const log = { text: Memory.agent_show(tools.mem, agent.name), mark: true };
    const server = Tools.at(tools, agent.name);
    const run = Pick.ask(Tools.pick(tools, agent));
    const own = Memory.file_text(PROMPTS.prompt.file);
    const system = own === "" ? SUB : SUB + "\n\n" + AGENT_PROMPT + "\n\n" + own;
    const blocks = [...agent.view, Tools.devices(tools), Tools.skills(tools), log];
    const effort = agent.role.effort ?? run.effort;
    return { ...run, effort, system, blocks, searches: SEARCHES, server, agent: true };
  }

  // what an agent runs on: config.AGENTS or else the chat's pick, with
  // the model it was spawned with, if any; a throw if no longer offered
  export function pick(tools: Tools, agent: Agent): Pick {
    const base = config.AGENTS ?? tools.hooks.pick();
    const model = agent.role.model;
    const given = model === null ? base : Pick.to_model(base, model, config.OFFER.vendors, config.OFFER);
    if (given === null) {
      throw new Error(agent.name + "'s model " + model + " is no longer offered; spawn another subagent.");
    }
    return given;
  }

  // a string: why there is none (Memory.settle)
  // halt: what stops the wait (Unii's turn's, by default; an agent's
  // spawn or a report waking one waits on none of Unii's)
  export async function view(tools: Tools, halt?: AbortSignal): Promise<Block[] | string> {
    const why = await Memory.settle(tools.mem, tools.mem.count, halt ?? tools.hooks.halt());
    return why ?? Memory.view(tools.mem);
  }

  export function working(tools: Tools): Agent[] {
    return [...tools.agents.values()].filter((a) => a.call !== null);
  }

  // the stop tool: the agent named stopped at once (Tools.stop), its
  // report saying why and what it was last doing; waited for (up to
  // HALT), then every process its shells started killed on each open
  // device (Machine.halt), so the answer says it ended and nothing of it
  // runs on, or what does. One not at work only has that sweep
  // The agents it started, and theirs, are stopped with it (P109).
  // by: who stops it ("main": Unii, else the agent above it)
  export async function halt(tools: Tools, name: string, why: string, by = "main"): Promise<Out> {
    const agent = Tools.agent(tools, name);
    if (agent === null) {
      return { text: "No agent " + name + ".", fail: true };
    }
    const who = by === "main" ? "Unii" : by;
    const said = why.trim() === "" ? "." : ": " + why.trim().replace(/\.?$/, ".");
    const tree = Tools.descendants(tools, name).filter(Tools.active);
    for (const kid of tree) {
      kid.why = "Stopped with " + name + ", stopped by " + who + said;
    }
    const calls = [agent, ...tree].map((a) => a.call).filter((c) => c !== null);
    const call = agent.call;
    const waited = agent.waiting === true;
    if (call !== null) {
      const live = agent.live.at(-1);
      const last = Object.values(agent.calls).at(-1) ?? (live && live.kind + ": " + live.text);
      const doing = last === undefined ? "" : " It was last at " + last.replace(/\s+/g, " ").slice(0, 300);
      agent.why = "Stopped by " + who + said + doing;
    } else if (waited) {
      agent.why = "Stopped by " + who + " while waiting for the agents it started" + said;
    }
    for (const a of [...tree, agent]) {
      Tools.stop(tools, a.name);
    }
    const ended = await Promise.race([Promise.all(calls.map((c) => c.done.catch(() => {}))).then(() => true), Bun.sleep(HALT).then(() => false)]);
    const left = (await Promise.all([name, ...tree.map((a) => a.name)].map((n) => Tools.sweep(tools, n)))).flat();
    const runs = left.length === 0 ? "" : " Still running: " + left.join("; ") + ".";
    const with_ = tree.length === 0 ? "" : " With it: " + tree.map((a) => a.name).join(", ") + ".";
    const text = call === null && !waited ? name + " isn't working: nothing to stop." + (left.length === 0 ? "" : runs) : ended ? "Stopped " + name + "." + with_ + runs : "Stopping " + name + ": it hasn't ended yet." + with_ + runs;
    return { text, fail: !ended || left.length > 0 };
  }

  // every process `name`'s shells started killed on each open device;
  // what is left, by device (one that didn't answer in HALT, too)
  export async function sweep(tools: Tools, name: string): Promise<string[]> {
    const live = Tools.opened(tools).filter(([, d]) => [...d.terms.values()].some((t) => t.live()));
    const outs = await Promise.all(live.map(async ([device]) => {
      const run = Tools.start_job(tools, device, { name: "halt", input: { agent: name }, cwd: "main" }, crypto.randomUUID());
      if (typeof run === "string") {
        return null;
      }
      const timer = setTimeout(() => run.end({ text: "no answer", fail: true }), HALT);
      const out = await run.out;
      clearTimeout(timer);
      return out.fail ? device + ": " + out.text : null;
    }));
    return outs.filter((o) => o !== null);
  }

  // every agent at work (name null), or the one named; one waiting for
  // the agents it started (P109) ends at once: named, its report a
  // stop's; with all (the user's stop, the server ending) it ends with no
  // report, as its agents' (stopped too) are only logged in its chat, and
  // after a restart the report of one resumed wakes it (Tools.upward)
  export function stop(tools: Tools, name: string | null): void {
    for (const agent of Tools.working(tools).filter((a) => name === null || a.name === name)) {
      agent.stop = true;
      agent.call?.stop();
    }
    for (const agent of [...tools.agents.values()].filter((a) => a.call === null && a.waiting === true && (name === null || a.name === name))) {
      agent.stop = true;
      agent.waiting = false;
      if (name !== null) {
        agent.replies.push(agent.why ?? "Stopped while waiting for the agents it started.");
        tools.hooks.report(agent, report_text(agent.name, agent.replies.join("\n\n")), true);
      }
    }
  }

}
