// Cursor
// ======
// The cursor vendor: a Cursor plan, on the Cursor CLI (cursor-agent),
// run as claude-sub runs Claude Code (ClaudeSub.ts). Its sign-in is the
// CLI's own (`unii serve cursor` runs its `agent login`), kept under
// DIR (config `cursor_sub`) or where config `cursor_login` says (an
// XDG_CONFIG_HOME: "~/.config" takes this computer's sign-in), never
// read by us; or a Cursor key (Settings, keys.json `cursor`), handed to
// it in its environment. A call is one turn: our system prompt as an
// always-applied rule of its workspace, our blocks as its message (on
// its stdin: never on a command line, nor past one's size), our tools
// over MCP (the call's URL, in its workspace's .cursor/mcp.json, 0600).
// It runs the tool loop; we log what it streams (stream-json). A message
// sent mid-run goes in once its turn ends, as the same session resumed.
//
// Its own tools are off as far as it lets them be (its permissions deny
// shell, read, write and delete; web search follows `searches`), and it
// runs in bubblewrap (config `cursor_sandbox`: "bwrap", the default, or
// "off"): the root read-only, an empty home (no ~/.ssh, ~/.config/gh,
// ~/.netrc, nor the unii dir), an empty /tmp, its own pid namespace, an
// environment of our choosing; writable only the call's dir (RUNS/<id>:
// its workspace and CLI config, removed as the call ends) and its
// sign-in. Its permissions alone don't hold (tested: its sandbox let a
// write through), so a missing bwrap is an error, not a fallback to none.
// The network is shared: it reaches Cursor and our MCP port.
//
// Errors, as at claude-sub: one it ends with (it prints "Error: [code]
// message" and exits 1) is the vendor's, logged, the user told only
// that the AI service is busy; one that is every call's (no such model,
// payment, an outdated client) is `off`, so a fallback goes on; not
// signed in, the call ends as one its vendor can't be asked for here.
// A usage limit (resource_exhausted, "usage limit", "rate limit"...)
// never ends a call: it waits for the reset (if the message tells it;
// else a doubling wait up to LIMIT), parks past LONG, and a call that
// ran no tool of ours and has a fallback goes on with it instead
// (Agent.ts, on the same code as the others). One that did resumes its
// session at the reset, told ON. A reset told is remembered (Agent.note,
// "cursor <model>"), so no call on that model asks into it.
//
// The CLI may go silent (it waits out a rate limit without a word, or
// its service hangs): a turn with no line for config `cursor_idle` (10
// min; half that, 5 min at most, before any came) and no tool of ours
// running is stopped. One that said nothing
// yet is asked once more anew; one that did resumes its session once,
// told to go on; silent again, the call ends: the service is down
// (`off`, so a fallback goes on), its end saying it stalled.

import * as child from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { AGAIN, AskAI, type Ask, type End, type Event, type Say, type Try } from "./AskAI.ts";
import { Agent, BUSY, LIMIT, type Emit, type Hold } from "./Agent.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import { Machine } from "./Machine.ts";
import { EFFORTS } from "./Pick.ts";
import { live_push, type Live } from "./View.ts";
import * as config from "./Config.ts";

// Types
// =====

// a model of the CLI's: its name's head, the efforts it is offered at
// (none: the head alone), whether a "-fast" one is
type Variant = { head: string; efforts: string[]; fast: boolean };

// what runs it: the executable, the sandbox, the silences that stop a
// turn (ms), the grace a stop gives before SIGKILL (ms)
type Setup = { bin: string; sandbox: string; first: number; idle: number; grace: number };

// a call's dir: its workspace (the CLI's cwd), its CLI config
type Room = { dir: string; work: string; conf: string };

// what a turn runs, in its environment, from its dir
type Command = { file: string; args: string[]; env: Record<string, string>; cwd: string };

// a turn's end: answered (ok, text), a usage limit (until: its reset if
// told, ms since 1970), silent past its IDLE (stall), its process gone
// without a word (died), or failed as the vendor's (text, stop, off);
// session: the CLI's, as it told it
export type Turn = Partial<End> & {
  session? : string;
  limit?   : { until: number | null; text: string };
  stall?   : boolean;
  died?    : boolean;
};

// Constants
// =========

const DIR = config.CURSOR_SUB;

// the calls' dirs
const RUNS = path.join(DIR, "runs");

// what a call that ran tools is told as its usage limit resets
export const ON = "(The AI service's usage limit cut your last step short. It has reset: go on.)";

// what one is told after its CLI went silent and was stopped
export const AGAIN_ON = "(Your last step was cut short: the AI service went silent. Go on from where you were.)";

const SIGN_IN = "cursor is not signed in, or its sign-in expired: run `unii serve cursor` on the server, or set a Cursor key";

const NO_BIN = "cursor needs the Cursor CLI: install it (curl https://cursor.com/install -fsS | bash), or set `cursor` to its executable";

const NO_BWRAP = "cursor runs the Cursor CLI in bubblewrap, which isn't installed here: install bwrap, or set cursor_sandbox to off";

const STALLED = "the AI service went silent (Cursor CLI)";

// the CLI's models (Pick.ts ids) and what it calls each at an effort
const VARIANTS: Record<string, Variant> = {
  "claude-opus-5-5"   : { head: "claude-opus-5-5",            efforts: ["low", "medium", "high", "xhigh", "max"], fast: true  },
  "claude-sonnet-5-5" : { head: "claude-sonnet-5-5",          efforts: ["low", "medium", "high", "xhigh", "max"], fast: false },
  "claude-haiku-5-5"  : { head: "claude-haiku-5-5-thinking",  efforts: ["low", "medium", "high", "xhigh", "max"], fast: false },
  "gpt-5.6-sol"       : { head: "gpt-5.6-sol",                efforts: ["low", "medium", "high", "xhigh", "max"], fast: true  },
  "grok-4.7"          : { head: "grok-4.7",                   efforts: ["low", "medium", "high", "xhigh"],        fast: true  },
  "composer-2.5"      : { head: "composer-2.5",               efforts: [],                                        fast: true  },
};

// its own tools denied (Cursor's permission names); ours allowed
const DENY = ["Shell(*)", "Read(**)", "Write(**)", "Delete(**)", "WebFetch(*)"];
const ALLOW = ["Mcp(unii:*)"];

// a refusal a reset ends (its code, or its words)
const LIMITED = /resource_exhausted|usage.?limit|rate.?limit|too many requests|hit your (usage )?limit|limit (reached|exceeded)|out of (fast )?requests|quota/i;

// not signed in, or a key refused
const UNSIGNED = /authentication required|agent login|not logged in|sign in required|unauthenticated|api key is invalid|auth(entication)? token/i;

// every call's: no such model, payment, a client too old, a region
const OFF = /cannot use this model|payment|billing|usage pricing|outdated client|update required|unsupported region|permission_denied/i;

// State
// =====

const SETUP: Setup = {
  bin     : config.CURSOR,
  sandbox : config.CURSOR_SANDBOX,
  first   : Math.min(300, config.CURSOR_IDLE / 2) * 1e3,
  idle    : config.CURSOR_IDLE * 1e3,
  grace   : 5e3,
};

// the executable, found once
const FOUND = { bin: null as string | null };

// Cursor
// ======

export namespace Cursor {

  // what runs it changed (for tests)
  export function set(setup: Partial<Setup>): void {
    Object.assign(SETUP, setup);
    FOUND.bin = null;
  }

  // the executable: config `cursor`, else cursor-agent (or agent) on the
  // PATH or in ~/.local/bin, where Cursor's installer puts it
  export function bin(): string {
    if (FOUND.bin !== null && fs.existsSync(FOUND.bin)) {
      return FOUND.bin;
    }
    const dirs = [...(process.env.PATH ?? "").split(path.delimiter), path.join(os.homedir(), ".local", "bin")].filter((d) => d !== "");
    const all = SETUP.bin !== "" ? [SETUP.bin] : ["cursor-agent", "agent"].flatMap((name) => dirs.map((d) => path.join(d, name)));
    const hit = all.find((f) => Cursor.runs(f));
    if (hit === undefined) {
      throw new Error(NO_BIN);
    }
    FOUND.bin = hit;
    return hit;
  }

  export function runs(file: string): boolean {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }

  // bubblewrap, if the sandbox is on (null: off); an Error if missing
  export function bwrap(): string | null {
    if (SETUP.sandbox === "off") {
      return null;
    }
    const dirs = (process.env.PATH ?? "").split(path.delimiter).concat(["/usr/bin", "/bin", "/usr/local/bin"]);
    const hit = dirs.map((d) => path.join(d, "bwrap")).find((f) => Cursor.runs(f));
    if (hit === undefined) {
      throw new Error(NO_BWRAP);
    }
    return hit;
  }

  // the sign-in's dir: XDG_CONFIG_HOME for the CLI (its auth.json is in
  // cursor/ there), made its owner's alone
  export function login(): string {
    const xdg = config.CURSOR_LOGIN;
    fs.mkdirSync(path.join(xdg, "cursor"), { recursive: true, mode: 0o700 });
    return xdg;
  }

  // what the CLI is called at an effort and speed: the model's nearest
  // effort at or below it (else its lowest), "-fast" if it has one
  export function variant(model: string, effort: string, speed: string): string {
    const v = VARIANTS[model];
    if (v === undefined) {
      return model;
    }
    const at = EFFORTS.indexOf(effort);
    const below = v.efforts.filter((e) => EFFORTS.indexOf(e) <= at);
    const pick = below.length > 0 ? below[below.length - 1] : v.efforts[0];
    const fast = v.fast && speed !== "slow" ? "-fast" : "";
    return v.head + (pick === undefined ? "" : "-" + pick) + fast;
  }

  // its environment: none of ours (no key of ours, no token, no proxy of
  // a parent's), but what it needs; a Cursor key, if set
  export function env(home: string, room: Room | null, bin: string): Record<string, string> {
    const env: Record<string, string> = {
      HOME              : home,
      PATH              : [path.dirname(bin), "/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter),
      LANG              : "C.UTF-8",
      TERM              : "dumb",
      NO_OPEN_BROWSER   : "1",
      XDG_CONFIG_HOME   : Cursor.login(),
      CURSOR_CONFIG_DIR : room?.conf ?? path.join(DIR, "config"),
    };
    const key = config.KEYS.cursor ?? "";
    return key === "" ? env : { ...env, CURSOR_API_KEY: key };
  }

  // `unii serve cursor [logout|status]`, as `unii serve claude`: the
  // CLI's own login (a link to open in any browser), logout, status
  // (exit 1 if not signed in)
  export async function cli(args: string[]): Promise<void> {
    const bin = Cursor.bin();
    fs.mkdirSync(path.join(DIR, "config"), { recursive: true, mode: 0o700 });
    const env = Cursor.env(os.homedir(), null, bin);
    const cmd = args.includes("status") ? ["status"] : args.includes("logout") ? ["logout"] : ["login"];
    const out = cmd[0] === "status" ? "pipe" : "inherit";
    const run = child.spawnSync(bin, cmd, { env, stdio: ["inherit", out, "inherit"], encoding: "utf8" });
    if (cmd[0] === "status") {
      const text = String(run.stdout ?? "").trim();
      const yes = /logged in/i.test(text) && !/not logged in/i.test(text);
      console.log(text + "\n" + (yes ? "Sign-in in " + config.CURSOR_LOGIN + "." : "Not signed in to Cursor: run `unii serve cursor`."));
      process.exitCode = yes ? 0 : 1;
      return;
    }
    process.exitCode = run.status ?? 1;
  }

  // A call's dir
  // ------------

  // its dir under RUNS (named by this process's pid, so dirs a dead
  // process left are removed: `prune`): its workspace, holding our MCP
  // server and our system prompt as a rule; its CLI config, our
  // permissions
  export function room(ask: Ask): Room {
    fs.mkdirSync(RUNS, { recursive: true, mode: 0o700 });
    Cursor.prune();
    const dir = path.join(RUNS, process.pid + "-" + crypto.randomBytes(6).toString("hex"));
    const work = path.join(dir, "work");
    const conf = path.join(dir, "config");
    fs.mkdirSync(path.join(work, ".cursor", "rules"), { recursive: true, mode: 0o700 });
    fs.mkdirSync(conf, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const file = (f: string, text: string) => fs.writeFileSync(f, text, { mode: 0o600 });
    file(path.join(work, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: ask.server === "" ? {} : { unii: { url: ask.server } } }));
    file(path.join(work, ".cursor", "rules", "unii.mdc"), "---\ndescription: Unii\nalwaysApply: true\n---\n" + ask.system + "\n");
    file(path.join(conf, "cli-config.json"), JSON.stringify(Cursor.settings(ask), null, 2));
    return { dir, work, conf };
  }

  // the CLI's config: its tools denied but ours, web search as asked
  export function settings(ask: Ask): object {
    return { version: 1, permissions: { allow: ALLOW, deny: DENY }, autoAcceptWebSearch: ask.searches > 0, notifications: false, hints: false };
  }

  // the dirs a process no longer running left
  export function prune(): void {
    for (const name of fs.existsSync(RUNS) ? fs.readdirSync(RUNS) : []) {
      const pid = Number(name.split("-")[0]);
      if (!(pid > 0) || (pid !== process.pid && !Machine.alive(pid))) {
        fs.rmSync(path.join(RUNS, name), { recursive: true, force: true });
      }
    }
  }

  // the command a turn runs: the CLI's (resuming `session`), in the
  // sandbox unless it is off
  export function command(bin: string, jail: string | null, room: Room, model: string, session: string | null): Command {
    const own = ["-p", "--trust", "--approve-mcps", "--output-format", "stream-json", "--stream-partial-output", "--model", model, "--workspace", room.work, ...(session === null ? [] : ["--resume", session])];
    if (jail === null) {
      const home = path.join(room.dir, "home");
      fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      return { file: bin, args: own, env: Cursor.env(home, room, bin), cwd: room.work };
    }
    const home = os.homedir();
    const xdg = Cursor.login();
    const ro = [...new Set([path.dirname(bin), path.dirname(fs.realpathSync(bin)), path.join(home, ".local", "share", "cursor-agent")])].filter((d) => fs.existsSync(d));
    const args = [
      "--unshare-pid", "--unshare-ipc", "--die-with-parent", "--new-session",
      "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--tmpfs", home,
      ...ro.flatMap((d) => ["--ro-bind", d, d]),
      "--bind", path.join(xdg, "cursor"), path.join(xdg, "cursor"),
      "--bind", room.dir, room.dir,
      "--chdir", room.work,
      bin, ...own,
    ];
    return { file: jail, args, env: Cursor.env(home, room, bin), cwd: room.work };
  }

  // A call
  // ------

  // a call (Cursor.run); a message sent, a wake or a stop ends a wait
  // for a usage limit
  export function ask(ask: Ask, on: (ev: Event) => void): Try {
    const end = AskAI.end("");
    const sent: Say[] = [];
    const abort = new AbortController();
    const wake: Hold = { poke: () => {}, said: false };
    const send = (say: Say) => {
      sent.push(say);
      wake.poke();
    };
    const stop = () => {
      end.text = "stopped";
      abort.abort();
    };
    const done = Cursor.run(ask, on, sent, abort.signal, wake).then(
      (out) => abort.signal.aborted || Object.assign(end, out),
      (err) => (end.text ||= err.message),
    ).then(() => {
      end.ok   = end.ok && !abort.signal.aborted;
      end.left = sent;
      return end;
    });
    return { send, stop, wake: () => wake.poke(), done };
  }

  // the call's message: its blocks, and a word for images it can't take
  export function message(texts: string[], imgs: number): string {
    const note = imgs > 0 ? ["(" + imgs + " image" + (imgs > 1 ? "s" : "") + " not shown: this AI service takes text only here.)"] : [];
    return [...texts.filter((t) => t !== ""), ...note].join("\n\n");
  }

  // the call's end: its turns, each a CLI run, the session resumed for a
  // message sent mid-run, at a usage limit's reset (ran tools: told ON;
  // else asked anew), or after a silence (told AGAIN_ON, once)
  export async function run(ask: Ask, on: (ev: Event) => void, sent: Say[], signal: AbortSignal, wake: Hold): Promise<Partial<End>> {
    const bin = Cursor.bin();
    const jail = Cursor.bwrap();
    let seen: Live[] = [];
    let said = false;
    const emit: Emit = (kind, text, fresh) => {
      said = true;
      // (View.ts types live_push with Pipeline's Live, of the same name)
      live_push(seen as unknown as Parameters<typeof live_push>[0], kind, text, fresh);
      on({ $: "Delta", kind, text, fresh });
    };
    const log = (ev: Event) => {
      said = true;
      on(ev);
    };
    const acted = { v: false };
    let woke = false;
    const sleep = async (ms: number, known: boolean) => {
      woke = await Agent.park(wake, on, signal, "cursor", ms, known);
    };
    const out = (ms: number, until: number | null, why: string): Partial<End> | null => {
      if (!Agent.ends(ask, acted.v, ms)) {
        return null;
      }
      const r = Agent.limit_off(Agent.fail(why, []), until, ask).refusal!;
      console.error(ask.model + ": " + r.why.slice(0, 300));
      return { text: r.say, stop: "down", off: true, acted: acted.v, until: r.until };
    };
    const room = Cursor.room(ask);
    const model = Cursor.variant(ask.model, ask.effort, ask.speed);
    let session: string | null = null;
    // what the next turn is told on its session (null: the call's message, anew)
    let next: string | null = null;
    let resume = false;
    const used = { runs: 0, input: 0, output: 0, read: 0, write: 0 };
    try {
      for (let tries = 0, n = 0, stalls = 0; !signal.aborted; ) {
        const until = Cursor.limited(ask.model, woke);
        woke = false;
        if (until !== null) {
          const ms = until - Date.now();
          const end = out(ms, until, "usage limit");
          if (end !== null) {
            return end;
          }
          await sleep(ms, true);
          continue;
        }
        if (resume) {
          resume = false;
          const says = sent.splice(0);
          says.forEach((say) => log({ $: "Entry", kind: "user", text: say.text }));
          next = Cursor.message([ON, ...says.map((say) => say.text)], says.reduce((k, say) => k + say.imgs.length, 0));
        }
        const text: string = session === null ? Cursor.message(ask.blocks.map((b) => b.text), ask.imgs?.length ?? 0) : next!;
        const held = ask.patient === true;
        if (held && !(await ClaudeSub.slot(ask, signal))) {
          return {};
        }
        used.runs += 1;
        const got: Turn | null = await Cursor.turn(Cursor.command(bin, jail, room, model, session), text, emit, log, signal, acted, () => (seen = []), used).finally(() => held && ClaudeSub.free());
        if (got === null) {
          return {};
        }
        session = got.session ?? session;
        if (got.died === true && !said && tries === 0) {
          tries += 1;
          session = null;
          continue;
        }
        if (got.stall === true) {
          console.error("cursor: " + model + ": no word in " + Math.round((said ? SETUP.idle : SETUP.first) / 1e3) + " s: stopped");
          if (!said && tries === 0) {
            tries += 1;
            session = null;
            continue;
          }
          if (session !== null && stalls === 0) {
            stalls += 1;
            log({ $: "Entry", kind: "mind", text: "The AI service went silent: asking it to go on." });
            next = AGAIN_ON;
            continue;
          }
          return { text: BUSY + " (" + STALLED + ")", stop: "down", off: true, acted: acted.v };
        }
        if (got.limit !== undefined) {
          n += 1;
          Cursor.note(ask.model, got.limit.until);
          if (acted.v && session !== null) {
            resume = true;
          } else {
            session = null;
          }
          const { ms, known } = Agent.limit_wait(got.limit.until, n, ask.patient === true ? AGAIN : LIMIT);
          const end = out(ms, got.limit.until, got.limit.text);
          if (end !== null) {
            return end;
          }
          await sleep(ms, known);
          continue;
        }
        if (got.ok !== true) {
          return { text: got.text, stop: got.stop, off: got.off, acted: acted.v };
        }
        Cursor.note(ask.model, null);
        const says = sent.splice(0);
        if (says.length === 0 || session === null) {
          sent.unshift(...says);
          return { ok: true, text: got.text ?? "", acted: acted.v };
        }
        acted.v = true;
        says.forEach((say) => log({ $: "Entry", kind: "user", text: say.text }));
        next = Cursor.message(says.map((say) => say.text), says.reduce((k, say) => k + say.imgs.length, 0));
      }
      return {};
    } finally {
      fs.rmSync(room.dir, { recursive: true, force: true });
      if (used.runs > 0) {
        console.error("cursor: " + model + ": " + used.runs + " run" + (used.runs > 1 ? "s" : "") + ", tokens in " + used.input + ", out " + used.output + ", cache read " + used.read + ", written " + used.write);
      }
      if (signal.aborted) {
        Agent.fail("stopped", seen).entries.forEach((e) => on({ $: "Entry", ...e }));
      }
    }
  }

  // Usage limits
  // ------------

  // a limit told on a model, kept till its reset (null: lifted, or not
  // told), as openai-sub's are: one model's (Cursor's limits name a
  // model's family, or the plan: each model then hits it in turn), so a
  // fallback to another model goes on
  export function note(model: string, until: number | null): void {
    Agent.note("cursor " + model, until);
  }

  // the reset of the limit remembered on a model (null: none, or a wake
  // just ended its wait)
  export function limited(model: string, woke: boolean): number | null {
    return woke ? null : Agent.under(["cursor " + model], false);
  }

  // the limits told forgotten (for tests)
  export function forget(): void {
    Agent.forget("cursor");
  }

  // when a limit resets, as its message tells it ("resets at 2026-10-27
  // 05:00 UTC", "try again in 3 hours"; ms since 1970); null: not told
  export function reset(text: string, now = Date.now()): number | null {
    const at = /reset[s]?\s+(?:at|on)?\s*(\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d)?)\s*(UTC|Z)?/i.exec(text);
    if (at !== null) {
      const t = Date.parse(at[1].replace(" ", "T") + (at[2] ? "Z" : ""));
      return t > now ? t : null;
    }
    const UNIT: Record<string, number> = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 };
    const span = /\b(?:in|after)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i.exec(text);
    if (span !== null) {
      return now + Number(span[1]) * UNIT[span[2][0].toLowerCase()];
    }
    return null;
  }

  // A turn
  // ------

  // what a turn's failure (its words, as it printed them) is: a usage
  // limit, a sign-in missing, every call's (off), or this one's
  export function failure(text: string): Turn {
    const why = text.replace(/\x1b\[[0-9;]*m/g, "").trim() || "the Cursor CLI ended without an answer";
    if (UNSIGNED.test(why)) {
      return { text: SIGN_IN };
    }
    if (LIMITED.test(why)) {
      return { limit: { until: Cursor.reset(why), text: why } };
    }
    console.error("cursor: " + why.slice(0, 300));
    return { text: BUSY, stop: "down", off: OFF.test(why) };
  }

  // a turn: the CLI run, told `text` on its stdin, its stream read to its
  // end (null: stopped). A tool of ours run marks the call `acted`. No
  // line for the silence allowed while no tool of ours runs: a stall
  export async function turn(cmd: Command, text: string, emit: Emit, log: (ev: Event) => void, signal: AbortSignal, acted: { v: boolean }, fresh: () => void, used: { input: number; output: number; read: number; write: number }): Promise<Turn | null> {
    const proc = child.spawn(cmd.file, cmd.args, { env: cmd.env, cwd: cmd.cwd, stdio: ["pipe", "pipe", "pipe"], detached: true, windowsHide: true });
    const lines: string[] = [];
    const noise: string[] = [];
    let wake = () => {};
    let closed = false;
    const failed = { why: null as string | null };
    const exit = new Promise<number | null>((ok) => {
      proc.once("close", (code) => ok(code));
      proc.once("error", (err) => ((failed.why = err.message), ok(null)));
    });
    exit.then(() => ((closed = true), wake()));
    readline.createInterface({ input: proc.stdout! }).on("line", (line) => (lines.push(line), wake()));
    proc.stderr!.on("data", (b: Buffer) => noise.push(b.toString("utf8")));
    proc.stdin!.on("error", () => {});
    proc.stdin!.end(text);
    const kill = () => {
      Cursor.kill(proc);
      wake();
    };
    signal.addEventListener("abort", kill, { once: true });
    const open = new Set<string>();
    let think = "";
    let session: string | undefined;
    let got: Turn | null = null;
    let heard = false;
    try {
      for (;;) {
        if (signal.aborted) {
          return null;
        }
        if (lines.length === 0 && closed) {
          break;
        }
        if (lines.length === 0) {
          const quiet = open.size > 0 ? null : heard ? SETUP.idle : SETUP.first;
          const timer = quiet === null ? null : setTimeout(() => wake(), quiet);
          const was = Date.now();
          await new Promise<void>((ok) => (wake = ok));
          clearTimeout(timer ?? undefined);
          if (lines.length === 0 && !closed && !signal.aborted && quiet !== null && Date.now() - was >= quiet) {
            Cursor.kill(proc);
            await exit;
            return { stall: true, session };
          }
          continue;
        }
        const line = lines.shift()!;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          noise.push(line + "\n");
          continue;
        }
        heard = true;
        session = typeof ev.session_id === "string" ? ev.session_id : session;
        got = Cursor.read(ev, emit, log, acted, fresh, open, (t) => (think = t), think, used) ?? got;
      }
      const code = await exit;
      if (failed.why !== null) {
        return { text: "the Cursor CLI couldn't run: " + failed.why, session };
      }
      if (got?.ok === true) {
        return { ...got, session };
      }
      const words = [got?.text ?? "", noise.join("").trim()].filter((w) => w !== "").join("\n");
      if (words === "") {
        return { text: "the Cursor CLI ended (exit " + code + ") without a word", session, died: session === undefined };
      }
      return { ...Cursor.failure(words), session };
    } finally {
      signal.removeEventListener("abort", kill);
      if (!closed) {
        kill();
      }
    }
  }

  // an event of its stream: shown, logged; a result's end (null: none)
  export function read(ev: any, emit: Emit, log: (ev: Event) => void, acted: { v: boolean }, fresh: () => void, open: Set<string>, keep: (think: string) => void, think: string, used: { input: number; output: number; read: number; write: number }): Turn | null {
    switch (ev.type) {
      case "thinking": {
        if (ev.subtype === "delta" && typeof ev.text === "string") {
          emit("mind", ev.text);
          keep(think + ev.text);
        } else if (ev.subtype === "completed") {
          if (think.trim() !== "") {
            log({ $: "Entry", kind: "mind", text: think.trim() });
            fresh();
          }
          keep("");
        }
        return null;
      }
      case "assistant": {
        const text = (ev.message?.content ?? []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
        if (ev.timestamp_ms !== undefined) {
          emit("unii", text);
        } else if (text.trim() !== "") {
          log({ $: "Entry", kind: "unii", text: text.trim() });
          fresh();
        }
        return null;
      }
      case "tool_call": {
        const id = String(ev.call_id ?? "");
        const [name, call] = Cursor.tool(ev.tool_call);
        // its lookup of an MCP tool's schema, before a first call: not logged
        const lookup = name === "getMcpTools" && call?.result?.error === undefined;
        if (ev.subtype === "started" && lookup) {
          open.add(id);
        } else if (ev.subtype === "completed" && lookup) {
          open.delete(id);
        } else if (ev.subtype === "started") {
          open.add(id);
          acted.v ||= name.startsWith("mcp__unii__");
          log({ $: "Entry", kind: "tool", text: name + " " + JSON.stringify(call?.args?.args ?? call?.args ?? {}), of: id });
        } else if (ev.subtype === "completed") {
          open.delete(id);
          log({ $: "Entry", kind: "echo", text: Cursor.back(call?.result), of: id });
        }
        return null;
      }
      case "result": {
        const u = ev.usage ?? {};
        used.input += Number(u.inputTokens) || 0;
        used.output += Number(u.outputTokens) || 0;
        used.read += Number(u.cacheReadTokens) || 0;
        used.write += Number(u.cacheWriteTokens) || 0;
        if (ev.subtype === "success" && ev.is_error !== true) {
          return { ok: true, text: String(ev.result ?? "").trim() };
        }
        return { text: String(ev.result ?? ev.error ?? ev.subtype ?? "error") };
      }
    }
    return null;
  }

  // a tool call's name, as logged ("mcp__<server>__<tool>" for an MCP
  // server's, as Claude Code names them; else the CLI's: read, edit...),
  // and its body
  export function tool(t: any): [string, any] {
    const [key, call] = Object.entries(t ?? {}).find(([k]) => k.endsWith("ToolCall")) ?? ["tool", null];
    const c = call as any;
    if (key === "mcpToolCall") {
      return ["mcp__" + (c?.args?.providerIdentifier ?? c?.args?.serverIdentifier ?? "mcp") + "__" + (c?.args?.toolName ?? "tool"), c];
    }
    return [key.replace(/ToolCall$/, ""), c];
  }

  // a tool call's result as text: an MCP tool's content, else an error
  // or the CLI's own (as JSON, clipped)
  export function back(r: any): string {
    if (r?.success?.content !== undefined && Array.isArray(r.success.content)) {
      const text = r.success.content.map((p: any) => p?.text?.text ?? p?.text ?? "[" + Object.keys(p ?? {})[0] + "]").join("\n");
      return (r.success.isError === true ? "error: " : "") + (text || "(no output)");
    }
    if (r?.error !== undefined) {
      return "error: " + (r.error.errorMessage ?? JSON.stringify(r.error));
    }
    if (r !== undefined && r !== null && r.success === undefined) {
      return "error: " + Object.keys(r)[0];
    }
    const json = JSON.stringify(r?.success ?? r ?? null);
    return json.length > 2000 ? json.slice(0, 2000) + "…" : json;
  }

  // its process ended: SIGTERM to its group, SIGKILL after the grace
  export function kill(proc: child.ChildProcess): void {
    const pid = proc.pid;
    if (pid === undefined || proc.exitCode !== null || proc.signalCode !== null) {
      return;
    }
    const group = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
      } catch {
        try {
          proc.kill(sig);
        } catch {}
      }
    };
    group("SIGTERM");
    const timer = setTimeout(() => group("SIGKILL"), SETUP.grace);
    timer.unref?.();
    proc.once("close", () => clearTimeout(timer));
  }

}
