// Guard
// =====
// What no subagent may do, whoever started it (P109, 26/10/2026): merge
// a pull request, restart the serve, deploy, or push to main. The user
// gives those orders to Unii alone; an agent's tree inherits the ban, so
// a grandchild can't do through a shell what its parent couldn't. The
// serve checks each shell command a subagent sends (Tools.call) before
// its device runs it, and refuses one that does any of these, saying
// which and why. It stops the mistake, an agent following a habit or a
// task that says "and merge it", not one bent on hiding it; the prompt
// (Tools.ts NESTED) says the same, so neither stands alone.
//
// It reads a command as bash does (Guard.lex), not as text: it splits it
// at ;, &, &&, ||, |, |&, ;;, (, ) and newlines, but not at an escaped or
// quoted one (\; is a word); it takes quotes and backslashes out (ma\in,
// "ma"in, $'main' are main) and joins a line continued with \ (ma\ and a
// newline, then in, is main); it expands braces ({main,x} is main and x);
// it drops comments (git push origin feat/x # main pushes feat/x); and it
// drops each redirection with its target, wherever it stands and however
// it's written (> main, >main, 2>&1, &>>log, >|x, <>x, {fd}>x, 10>x,
// <<<x): a target is a file, not an argument, so git push origin feat/x
// > main goes through. >&- and <&- close a descriptor and take no
// target: git push origin feat/x >&- main is the push of main it is
// (NavyGazelle, P109). What it runs inside, it reads too: $(...), `...`,
// <(...), a shell's -c script, eval's, env -S's, ssh's, watch's, a
// function's body, a case's branch.
//
// Where it can't tell, it refuses: a push that doesn't name where it goes
// (git push, git push origin HEAD, a comment where its refspec would be)
// may land on main if the branch checked out, or its upstream, is main,
// which the serve can't see from here; so may one whose refspec is a
// variable, a command's output, a glob or ${x:-main}. The agent names the
// branch (git push origin HEAD:feat/x) and it goes through. A command
// nested 6 deep or more ($(...) in $(...), sh -c in sh -c) isn't read
// past that, so it is refused.
//
// Out of reach, and so let through (GreenPepper, NavyGazelle, P109): a
// push that names the current branch by another of git's spellings (git
// push origin HEAD~0, HEAD^, main^{}, main@{0}); a command held in a
// variable set elsewhere ($CMD), or one whose name is ($GIT push); a
// script the agent wrote (bash push.sh) or one piped to a shell's stdin
// (echo 'pkill bun' | bash); an alias, of the shell or of git (git -c
// alias.p=push p origin main); pkill or killall run by a program the
// guard doesn't know runs commands (mise exec -- pkill bun). Reading
// those would mean running a shell; the prompt bans them as much as the
// serve bans the rest.
//
// A cost taken on purpose: quotes don't hide a ban but a kill, so a
// command that only writes one down (echo 'git push origin main' >
// /tmp/x, a heredoc, git push named after a word: echo git push) is
// refused as if it ran it; a word with a space is read as a command too
// (bash -c '...' and the like run it). Better a needless refusal, which
// the agent works around by writing it another way, than a push to main
// let through. pkill and killall are read only where they run (as a
// command, or in a script it runs), so grep -r 'pkill bun' . goes.
//
// What pkill -f is matched against is the serve's command line and its
// device's as this very serve runs (the bun running it, the Cli.ts next
// to this file, its home and its user), with some common layouts; not a
// fixed path. So pkill -f '/home/morum/repository/uniichat/Cli.ts device'
// and pkill -f 'morum.*device' are refused whoever runs the serve, and
// wherever (FoggyFox M1, P109).
//
// It reads gh and terraform by their words, past their options: gh pr -R
// o/r merge 5 is a merge, and terraform plan -out=apply.tfplan is a plan,
// not an apply. It also refuses (FoggyFox, P109): gh release create; gh
// api changing main by git/refs (PATCH, PUT, POST, DELETE on heads/main)
// or by contents (PUT, DELETE with branch=main, or no branch: the default
// one); kill -STOP, which froze the serve, in any of its spellings (-s
// STOP, -SIGSTOP, -19, -n 19); kill -1 as the target (kill -9 -1, every
// process); and kill $PPID (the device that runs the agent's shell).
//
// And (GrayCrab, P109): the other signals that freeze a process (-TSTP,
// -TTIN, -TTOU, 20 to 22); killall by the program's path (killall
// /usr/bin/bun); fuser -k on a file or the serve's port (fuser -k
// 8788/tcp; another port goes); a kill fed by lsof or ps that finds the
// serve (kill $(lsof -ti :8788), kill $(ps -C bun -o pid=), ps aux | grep
// bun | xargs kill); a write by gh api to merges, a workflow's
// dispatches, releases or a pull request's merge (pulls/$N/merge too),
// and curl or wget to the GitHub API with a method that changes it (-X
// POST, -d...); git push origin tag v1, a destination heads/main, a tag
// made and pushed in one command (git tag v1 && git push origin v1), and
// git send-pack. A pkill -f pattern that may take long to match (Guard.slow:
// (.+)+x took the guard past 10 s) is refused as one it can't read. Out
// of reach: a tag made in one command and pushed by its name in another
// (git push origin v1 can't be told from a branch v1); GraphQL mutations
// other than a merge; httpie and other clients of the API. A grep counts
// only in the ps's own pipeline, after the ps and before a kill there
// (ps | grep -v Cli.ts | xargs kill goes; ps | xargs kill; grep -v Cli.ts
// f does not, the grep is another command). One that picks by ps's other
// columns (state, start time) is read only against the command line.
//
// What only looks like a ban goes: git push --help, terraform plan -out
// apply (apply is the plan's file), gh api reads (GET, HEAD), curl reads
// of the API, fuser and lsof that only list.

import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

// Types
// =====

// a simple command as the shell runs it: its words (quotes, backslashes,
// comments and redirections taken out, braces expanded), the targets of
// its redirections (files, not arguments) and the scripts it substitutes
// ($(...), `...`, <(...))
export type Simple = { words: string[]; targets: string[]; subs: string[]; join: boolean };

// a command met in a command: loose, when it is only a word that holds a
// space, read as a command because it may be one (bash -c '...'); kills
// are read only where a command runs (Guard header: the cost)
// deep: past the depth read (Guard.DEPTH), what it runs isn't read, so
// it is refused
type Seen = { cmd: Simple; loose: boolean; deep?: boolean };

// a ban: what it is, as the agent is told, and what a command doing it
// looks like: one simple command, with its words joined by spaces (line);
// whole: all the commands met, for what spans them (pgrep x | xargs kill)
// (and, for pkill -f, the serve's command lines: Guard.SERVE_LINES)
type Ban = { what: string; test: (c: Simple, line: string) => boolean; whole?: (seen: Seen[], lines: string[]) => boolean };

// a command's first word, after what only runs it (sudo, env, nohup...),
// and the words after it
type Cmd = { name: string; args: string[] };

// Constants
// =========

// a word boundary for a command's words (a path or flag may hold "-"); a
// program may be named by its path (/usr/bin/gh, ~/bin/git)
const W = "(?<![\\w.-])(?:[\\w.~$/-]*/)?";
const E = "(?![\\w-])";

// git's options before its subcommand that take the next word as their
// value (git -C dir push, git -c k=v push, git --git-dir .git push)
const GIT_VALUED = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--list-cmds"]);
// push's options that take the next word as their value
const PUSH_VALUED = new Set(["-o", "--push-option", "--repo", "--exec", "--receive-pack"]);
// a refspec's destination naming main or master (heads/main too: git
// reads it as refs/heads/main)
const MAIN = /^(?:(?:refs\/)?heads\/)?(?:main|master)$/;
// a refspec's destination naming a tag (refs/tags/x, tags/x)
const TAG = /(?:^|:)\+?(?:refs\/)?tags\//;
// a pull request's merge in the API's paths (pulls/5/merge, pulls/$N/merge)
const PR_MERGE = /pulls\/[^/\s]+\/merge(?![\w-])/;
// the API's paths a write to is a user's order: a merge of branches, a
// workflow's run, a release (POST, PATCH, DELETE); a pull request's merge
// is the first ban's (PR_MERGE)
const API_WRITES = /(?:^|\/)merges(?:\/|$|\?)|\/dispatches(?:\/|$|\?)|(?:^|\/)releases(?:\/|$|\?)/;
// the GitHub API's hosts
const GITHUB_API = /(?:^|\/\/|@)(?:api|uploads)\.github\.com(?:[/:?]|$)/;
// gh's options, its commands' and its api's, that take the next word as
// their value (gh pr -R o/r merge 5, gh api -X PATCH path -f sha=x)
const GH_VALUED = new Set(["-R", "--repo", "-X", "--method", "-f", "--raw-field", "-F", "--field", "-H", "--header", "-q", "--jq",
  "-t", "--template", "--input", "--hostname", "-p", "--preview", "--cache", "-S", "--search", "--title", "-b", "--body"]);
// the infrastructure tools whose apply, destroy or import is a deploy,
// and their options that may take the next word as their value
// (terraform plan -out apply is a plan)
const IAC = new Set(["terraform", "tofu", "terragrunt"]);
const IAC_VALUED = new Set(["-out", "-var", "-var-file", "-target", "-replace", "-state", "-state-out", "-backup", "-lock-timeout", "-parallelism", "-chdir"]);
// the signals that freeze a process (stop it, as the serve was frozen)
const FREEZE = /^(?:SIG)?(?:STOP|TSTP|TTIN|TTOU)$|^(?:19|20|21|22)$/i;

// what only runs the command after it, and its options that take a value;
// and the shell's words that start a command (if pkill bun; then ...)
const RUNNERS: Record<string, string[]> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-U", "-r", "-t", "-D"], doas: ["-u", "-C"], exec: ["-a"], command: [], nohup: [], time: ["-f", "-o"],
  nice: ["-n"], ionice: ["-c", "-n", "-p"], env: ["-u", "-C", "-S"], xargs: ["-n", "-I", "-P", "-L", "-d", "-E", "-s", "-a"], setsid: [],
  stdbuf: ["-i", "-o", "-e"], timeout: ["-s", "-k"], chronic: [], "!": [], then: [], do: [], else: [], if: [], elif: [], while: [], until: [],
  coproc: [], "{": [], builtin: [],
};
// shells that run a script given with -c, and the like
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "su"]);
const SSH_VALUED = new Set(["-p", "-i", "-l", "-o", "-F", "-J", "-b", "-c", "-D", "-E", "-L", "-R", "-S", "-W", "-w", "-m", "-O", "-Q", "-B", "-e", "-I"]);
// how deep scripts run inside scripts are read: deeper is refused (a word
// only read as one, loose, deeper is let be)
const DEPTH = 6;
// how many words one brace expansion may give ({a,b}{c,d}... past it is
// cut, its first words read)
const BRACES = 4096;

// what a process of the serve looks like to pkill and its kin: its name
// (the program's: bun) and its command lines (pkill -f), the serve's and
// its device's (Guard header)
const SERVE_NAMES = ["bun"];
const MODES = ["serve", "device", "serve --port 8788"];
// the serve's port: the default one, and this serve's if it was given one
// (unii serve 8790)
const AT_SERVE = process.argv.indexOf("serve");
export const SERVE_PORTS = [...new Set(["8788", ...(AT_SERVE < 0 ? [] : process.argv.slice(AT_SERVE + 1).filter((a) => /^\d+$/.test(a)))])];
// a pattern pkill -f is matched against is read only if it can't take
// long to match (Guard.slow): this long at most
const PATTERN_MAX = 256;

// the command lines of the serve and its device run by each bun with each
// Cli.ts: "<bun> <cli> serve", "<bun> <cli> device"...
export function serve_lines(buns: string[], clis: string[]): string[] {
  const out = new Set<string>();
  for (const b of buns) {
    for (const c of clis) {
      for (const m of MODES) {
        out.add(b + " " + c + " " + m);
      }
    }
  }
  return [...out];
}

// where a serve runs: the bun running it, the dir of its Cli.ts, its HOME,
// its user's name and its argv
export type Here = { bun: string; dir: string; home: string; user: string; argv: string[] };

// a serve's command lines: run by its bun, with the Cli.ts in its dir,
// under its home and its user's (HOME may be another), and the common
// layouts; its own argv when it is the serve or the device
export function here(at: Here): string[] {
  const homes = [...new Set([at.home, "/home/" + at.user, "/home/user", "/root"])];
  const buns = ["bun", "bun run", "/usr/bin/bun", "/usr/local/bin/bun", at.bun,
    ...homes.flatMap((h) => [h + "/.local/share/mise/installs/bun/" + Bun.version + "/bin/bun", h + "/.bun/bin/bun"])];
  const clis = ["Cli.ts", join(at.dir, "Cli.ts"), ...homes.flatMap((h) => [h + "/repository/uniichat/Cli.ts", h + "/.unii/uniichat/Cli.ts"])];
  const own = at.argv.includes("serve") || at.argv.includes("device") ? [at.argv.join(" ")] : [];
  return [...serve_lines(buns, clis), ...own];
}

// this process's user's name, from the passwd file (not HOME)
function user_name(): string {
  try {
    return userInfo().username;
  } catch {
    return "user";
  }
}

// this very serve's command lines (Guard.here)
export const SERVE_LINES = here({ bun: process.execPath, dir: import.meta.dir, home: homedir(), user: user_name(), argv: process.argv });

export const BANS: Ban[] = [
  {
    what: "mesclar um pull request (merge)",
    test: (c, p) => new RegExp(W + "gh\\s+pr\\s+merge" + E).test(p)
      || gh(c.words).some((g) => g.pos[0] === "pr" && g.pos[1] === "merge")
      || gh(c.words).some((g) => g.pos[0] === "api" && api_method(g) !== "GET" && PR_MERGE.test(g.pos[1] ?? ""))
      || PR_MERGE.test(p) && /(?<![A-Za-z])PUT(?![A-Za-z])|-X\s*put\b|--(?:request|method)[\s=]+put\b/i.test(p)
      || /\bmergePullRequest\b|\benablePullRequestAutoMerge\b/.test(p),
  },
  {
    what: "fazer push em main/master (ou de todos os ramos)",
    test: (c) => pushes(c.words).some((p) => p.all || p.specs.some((s) => MAIN.test(dst(s)))),
  },
  {
    what: "fazer push sem dizer para qual ramo (sem refspec, HEAD, @ ou variável: o ramo atual, ou o upstream, pode ser main; diga-o, como em git push origin HEAD:feat/x)",
    test: (c) => pushes(c.words).some((p) => !p.all && (p.specs.length === 0 || p.specs.some((s) => unnamed(s)))),
  },
  {
    what: "publicar tags (um release é ordem do usuário)",
    test: (c) => pushes(c.words).some((p) => p.tags || p.specs.some((s) => TAG.test(s.replace(/^\+/, "")))),
    // a tag made and pushed by its name in one command (git tag v1 && git
    // push origin v1); in two commands the serve can't tell v1 is a tag.
    // v1:feat/x publishes a tag too (refs/tags/feat/x) when the remote
    // has no branch feat/x (git 2.x, tried on a bare repository; PlumJaguar
    // read the destination as the branch). The serve can't see the remote:
    // only a destination under refs/heads/ goes (v1:refs/heads/feat/x)
    whole: (seen) => {
      const made = seen.flatMap((s) => tags_made(s.cmd.words));
      return made.length > 0 && seen.some((s) => pushes(s.cmd.words).some((p) => p.specs.some((x) => {
        const raw = x.replace(/^\+/, "");
        const cut = raw.indexOf(":");
        const src = cut < 0 ? raw : raw.slice(0, cut);
        const dst = cut < 0 ? "" : raw.slice(cut + 1);
        return made.includes(src) && !dst.startsWith("refs/heads/");
      })));
    },
  },
  {
    what: "usar git send-pack (o push de baixo nível, que o serve não lê)",
    test: (c) => calls(c.words, new Set(["git"]), GIT_VALUED).some((g) => g.pos[0] === "send-pack") || c.words.some((w) => w.slice(w.lastIndexOf("/") + 1) === "git-send-pack"),
  },
  {
    what: "reiniciar ou parar o serve",
    test: (_, p) => new RegExp(W + "systemctl\\b[^\\n]*\\b(?:restart|stop|start|kill|reload|try-restart|reload-or-restart)\\b[^\\n]*\\bunii").test(p)
      || new RegExp(W + "unii-restart" + E).test(p)
      || /\bserver\.pid\b/.test(p) && new RegExp(W + "kill" + E).test(p),
    whole: (seen, lines) => {
      const run = seen.filter((s) => !s.loose).map((s) => command_of(s.cmd.words)).filter((c) => c !== null);
      const kill = run.some((c) => c.name === "kill");
      return run.some((c) => (c.name === "pkill" || c.name === "killall") && targets(c, lines))
        || run.some((c) => c.name === "fuser" && fuser_kills(c))
        || kill && run.some((c) => (c.name === "pgrep" || c.name === "pidof") && targets(c, lines))
        || kill && run.some((c) => c.name === "lsof" && lsof_finds(c))
        || kill && run.some((c) => c.name === "ps") && ps_finds(seen, lines);
    },
  },
  {
    what: "congelar ou matar processos sem alvo certo (kill -STOP, -TSTP, -TTIN, -TTOU, kill -1, kill $PPID), o que alcança o serve e o device",
    test: () => false,
    whole: (seen) => seen.filter((s) => !s.loose).map((s) => command_of(s.cmd.words)).some((c) => c !== null && blind(c)),
  },
  {
    what: "criar um release (gh release create; um release é ordem do usuário)",
    test: (c) => gh(c.words).some((g) => g.pos[0] === "release" && g.pos[1] === "create"),
  },
  {
    what: "alterar o GitHub pela API (gh api ou curl: main por git/refs ou contents, merges, dispatches de workflow, releases, merge de PR)",
    test: (c) => gh(c.words).some((g) => g.pos[0] === "api" && (api_main(g) || api_write(g)))
      || curl_writes(c.words),
  },
  {
    what: "fazer deploy ou aplicar infraestrutura",
    test: (c, p) => calls(c.words, IAC, IAC_VALUED).some((t) => t.pos.some((w) => w === "apply" || w === "destroy" || w === "import"))
      || new RegExp(W + "gcloud\\b[^\\n]*\\bdeploy" + E).test(p)
      || new RegExp(W + "gcloud\\s+run\\s+(?:services|jobs)\\s+(?:update|replace|execute)" + E).test(p)
      || new RegExp(W + "kubectl\\b[^\\n]*\\b(?:apply|rollout|set\\s+image|delete|scale|patch|replace)" + E).test(p)
      || new RegExp(W + "helm\\s+(?:upgrade|install|rollback|uninstall)" + E).test(p)
      || new RegExp(W + "(?:fly|flyctl|vercel|netlify|firebase)\\b[^\\n]*\\bdeploy" + E).test(p)
      || new RegExp(W + "gh\\s+workflow\\s+run" + E).test(p)
      || /\/actions\/(?:apply|confirm)\b/.test(p),
  },
  {
    what: "rodar um comando com " + DEPTH + " ou mais níveis de comandos dentro de comandos ($(...), sh -c '...'), que o serve não lê",
    test: () => false,
    whole: (seen) => seen.some((s) => s.deep === true),
  },
];

// Guard
// =====

// a command's simple commands, as bash reads them (Guard header): words
// with quotes, backslashes and comments taken out and braces expanded,
// split at the shell's operators; each redirection dropped with its
// target, kept apart (targets); what it substitutes kept as scripts
// (subs) and, in its word, as written ($(git branch) stays a word with a
// $, so a refspec of it is unnamed). A heredoc's body is read apart, as
// a script it substitutes (the cost: a ban written in one is refused);
// an unclosed quote runs to the end.
export function lex(script: string): Simple[] {
  const out: Simple[] = [];
  const s = script;
  const n = s.length;
  let cmd: Simple = { words: [], targets: [], subs: [], join: false };
  // the command now being read continues the pipeline opened by | or |&
  // (|| && ;; and ; & do not: ps || grep is not a pipe)
  let piped = false;
  // the word being read: its characters, each quoted (or escaped) or not
  let cs: string[] = [];
  let qs: boolean[] = [];
  let started = false;
  // the next word is a redirection's target; a heredoc's (<<, <<-), whose
  // body starts at the next newline
  let target = false;
  let here: string | null = null;
  const bodies: { end: string; tabs: boolean }[] = [];
  const add = (t: string, quoted: boolean) => {
    for (const ch of t) {
      cs.push(ch);
      qs.push(quoted);
    }
    started = true;
  };
  const end_word = () => {
    if (started) {
      if (target) {
        cmd.targets.push(cs.join(""));
        if (here !== null) {
          bodies.push({ end: cs.join(""), tabs: here === "<<-" });
        }
        target = false;
        here = null;
      } else {
        cmd.words.push(...braces(cs, qs));
      }
    }
    cs = [];
    qs = [];
    started = false;
  };
  const end_cmd = () => {
    end_word();
    target = false;
    here = null;
    if (cmd.words.length + cmd.targets.length + cmd.subs.length > 0) {
      cmd.join = piped;
      out.push(cmd);
    }
    cmd = { words: [], targets: [], subs: [], join: false };
  };
  // where the k-th character from i stands: bash takes a line continued
  // (\ and a newline) out before it reads a token, so >\ newline &- is >&-
  const at = (i: number, k: number): number => {
    let j = i;
    for (let m = 0; m < k; m++) {
      j += 1;
      while (s[j] === "\\" && s[j + 1] === "\n") {
        j += 2;
      }
    }
    return j;
  };
  // the token from i that matches re, read past line continuations; and
  // where it ends
  const token = (i: number, re: RegExp): [string, number] => {
    let text = "";
    const ends: number[] = [];
    for (let j = i, m = 0; m < 3 && j < n; m++) {
      text += s[j];
      j = at(j, 1);
      ends.push(j);
    }
    const t = re.exec(text)?.[0] ?? text.slice(0, 1);
    return [t, ends[t.length - 1] ?? i + 1];
  };
  // a substitution ($( or <( or >( at i, its script from open): its
  // script kept, the whole kept in the word as written; where it ends
  const sub = (i: number, open: number): number => {
    const close = closing(s, open);
    const end = close < 0 ? n : close;
    cmd.subs.push(s.slice(open, end));
    add(s.slice(i, end + 1), true);
    return end + 1;
  };
  // a ${...} at i, its body from open: kept as written, quoted
  const param = (i: number, open: number): number => {
    const close = closing(s, open, "{", "}");
    const end = close < 0 ? n : close;
    add(s.slice(i, end + 1), true);
    return end + 1;
  };
  let i = 0;
  while (i < n) {
    const c = s[i] ?? "";
    const next = s[at(i, 1)];
    if (c === "\\") {
      // a line continued: the two go, the word goes on; a backslash at
      // the end goes too (read as what it ends: main\ is main)
      if (s[i + 1] === "\n" || s[i + 1] === undefined) {
        i += 2;
        continue;
      }
      add(s[i + 1] ?? "", true);
      i += 2;
      continue;
    }
    if (c === "'") {
      const close = s.indexOf("'", i + 1);
      const end = close < 0 ? n : close;
      add(s.slice(i + 1, end), true);
      i = end + 1;
      continue;
    }
    if (c === "$" && next === "'") {
      const [text, end] = ansi_c(s, at(i, 2));
      add(text, true);
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "$" && next === '"') {
      i = c === "$" ? at(i, 2) : i + 1;
      started = true;
      while (i < n && s[i] !== '"') {
        const d = s[i] ?? "";
        const e = s[at(i, 1)];
        if (d === "\\" && i + 1 < n && "$`\"\\\n".includes(s[i + 1] ?? "")) {
          if (s[i + 1] !== "\n") {
            add(s[i + 1] ?? "", true);
          }
          i += 2;
        } else if (d === "$" && e === "(") {
          i = sub(i, at(i, 2));
        } else if (d === "$" && e === "{") {
          i = param(i, at(i, 2));
        } else if (d === "`") {
          const [inner, end] = backtick(s, i + 1);
          cmd.subs.push(inner);
          add(s.slice(i, end + 1), true);
          i = end + 1;
        } else {
          add(d, true);
          i += 1;
        }
      }
      i += 1;
      continue;
    }
    if (c === "$" && next === "(") {
      i = sub(i, at(i, 2));
      continue;
    }
    if (c === "$" && next === "{") {
      i = param(i, at(i, 2));
      continue;
    }
    if (c === "`") {
      const [inner, end] = backtick(s, i + 1);
      cmd.subs.push(inner);
      add(s.slice(i, end + 1), true);
      i = end + 1;
      continue;
    }
    if ((c === "<" || c === ">") && next === "(") {
      i = sub(i, at(i, 2));
      continue;
    }
    if (c === "#" && !started) {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? n : nl;
      continue;
    }
    // a \r too (a line ended \r\n): main\r is main
    if (c === " " || c === "\t" || c === "\r") {
      end_word();
      i += 1;
      continue;
    }
    if (c === "\n") {
      end_cmd();
      piped = false;
      i += 1;
      // the heredocs opened on this line: each body runs to its end's
      // line, read apart (a ' in it opens nothing past it) and as run
      // (the cost: bash <<EOF runs it, cat <<EOF only writes it)
      for (const b of bodies.splice(0)) {
        let body = "";
        while (i < n) {
          const nl = s.indexOf("\n", i);
          const line = s.slice(i, nl < 0 ? n : nl);
          i = nl < 0 ? n : nl + 1;
          if ((b.tabs ? line.replace(/^\t+/, "") : line) === b.end) {
            break;
          }
          body += line + "\n";
        }
        out.push({ words: [], targets: [], subs: [body], join: false });
      }
      continue;
    }
    if (c === "<" || c === ">" || c === "&" && next === ">") {
      // a descriptor glued before it (2>, 10>, {fd}>) is no word
      const word = cs.join("");
      if (started && !target && qs.every((q) => !q) && /^(?:\d+|\{[A-Za-z_]\w*\})$/.test(word)) {
        cs = [];
        qs = [];
        started = false;
      } else {
        end_word();
      }
      const [op, end] = token(i, /^(?:&>>|&>|<<<|<<-|<<|<>|<&|>&|>>|>\||<|>)/);
      i = end;
      // >&- and <&- close a descriptor: no target
      if ((op === "<&" || op === ">&") && s[i] === "-") {
        i = at(i, 1);
        continue;
      }
      target = true;
      here = op === "<<" || op === "<<-" ? op : null;
      continue;
    }
    // ; & | ( ): each ends a command. || && ;; |& are one operator.
    // A pipe (| or |&) joins the next command to this pipeline; || &&
    // ;; ; & do not (ps || grep is not ps | grep)
    if (c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      const two = c + (s[i + 1] ?? "");
      const pair = two === "||" || two === "&&" || two === ";;" || two === "|&";
      end_cmd();
      piped = c === "|" && s[i + 1] !== "|";
      i += pair ? 2 : 1;
      continue;
    }
    add(c, false);
    i += 1;
  }
  end_cmd();
  return out;
}

// where the bracket opened before `from` closes (open and close given;
// quotes and backslashes skipped), or -1
function closing(s: string, from: number, open = "(", close = ")"): number {
  let depth = 1;
  let i = from;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      const q = s.indexOf("'", i + 1);
      if (q < 0) {
        return -1;
      }
      i = q + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        j += s[j] === "\\" ? 2 : 1;
      }
      i = j + 1;
      continue;
    }
    if (c === open) {
      depth += 1;
    } else if (c === close) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

// a `...` from `from` (past its opening `): its script, its \`, \$ and
// \\ taken as the shell does, and where it ends
function backtick(s: string, from: number): [string, number] {
  let out = "";
  let i = from;
  while (i < s.length && s[i] !== "`") {
    if (s[i] === "\\" && "`$\\".includes(s[i + 1] ?? "x")) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return [out, Math.min(i, s.length)];
}

// a $'...' from `from` (past its opening '): its text, its escapes read
// (\n, \t, \x69, \151, i...), and where it ends
function ansi_c(s: string, from: number): [string, number] {
  const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };
  let out = "";
  let i = from;
  while (i < s.length && s[i] !== "'") {
    if (s[i] !== "\\") {
      out += s[i];
      i += 1;
      continue;
    }
    const e = s[i + 1] ?? "";
    const m = /^(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3})|c(.))/.exec(s.slice(i + 1));
    if (simple[e] !== undefined) {
      out += simple[e];
      i += 2;
    } else if (m !== null) {
      const hex = m[1] ?? m[2] ?? m[3];
      out += hex !== undefined ? String.fromCodePoint(parseInt(hex, 16)) : m[4] !== undefined ? String.fromCharCode(parseInt(m[4], 8)) : String.fromCharCode((m[5] ?? "@").charCodeAt(0) & 31);
      i += 1 + m[0].length;
    } else {
      out += "\\" + e;
      i += 2;
    }
  }
  return [out, Math.min(i, s.length)];
}

// a word's brace expansion, as bash's: an unquoted {a,b} or {a..c} with
// what is around it (ma{in,} is main ma); one with neither , nor .. is
// kept ({main}, main^{})
function braces(cs: string[], qs: boolean[]): string[] {
  for (let a = 0; a < cs.length; a++) {
    if (cs[a] !== "{" || qs[a] === true) {
      continue;
    }
    let depth = 0;
    let b = -1;
    const commas: number[] = [];
    for (let k = a; k < cs.length; k++) {
      if (qs[k] === true) {
        continue;
      }
      if (cs[k] === "{") {
        depth += 1;
      } else if (cs[k] === "}") {
        depth -= 1;
        if (depth === 0) {
          b = k;
          break;
        }
      } else if (cs[k] === "," && depth === 1) {
        commas.push(k);
      }
    }
    if (b < 0) {
      continue;
    }
    const alts: [string[], boolean[]][] = [];
    if (commas.length > 0) {
      let from = a + 1;
      for (const k of [...commas, b]) {
        alts.push([cs.slice(from, k), qs.slice(from, k)]);
        from = k + 1;
      }
    } else {
      const body = cs.slice(a + 1, b).join("");
      const seq = qs.slice(a + 1, b).some((q) => q) ? null : /^(-?\d+|[A-Za-z])\.\.(-?\d+|[A-Za-z])(?:\.\.-?\d+)?$/.exec(body);
      if (seq === null) {
        continue;
      }
      const num = /\d/.test(seq[1] ?? "");
      const from = num ? Number(seq[1]) : (seq[1] ?? "a").charCodeAt(0);
      const to = num ? Number(seq[2]) : (seq[2] ?? "a").charCodeAt(0);
      const step = from <= to ? 1 : -1;
      for (let v = from; alts.length < BRACES; v += step) {
        const t = num ? String(v) : String.fromCharCode(v);
        alts.push([[...t], [...t].map(() => false)]);
        if (v === to) {
          break;
        }
      }
    }
    const out: string[] = [];
    for (const [x, xq] of alts) {
      out.push(...braces([...cs.slice(0, a), ...x, ...cs.slice(b + 1)], [...qs.slice(0, a), ...xq, ...qs.slice(b + 1)]));
      if (out.length >= BRACES) {
        break;
      }
    }
    return out.slice(0, BRACES);
  }
  return [cs.join("")];
}

// a command's simple commands, and those of the scripts it runs inside
// (Guard.inner, what it substitutes), and, loose, those of each of its
// words holding a space (Guard header: the cost)
function seen(script: string, depth: number, loose: boolean, out: Seen[]): Seen[] {
  if (depth >= DEPTH) {
    if (!loose) {
      out.push({ cmd: { words: [], targets: [], subs: [], join: false }, loose, deep: true });
    }
    return out;
  }
  for (const s of lex(script)) {
    out.push({ cmd: s, loose });
    for (const x of s.subs) {
      seen(x, depth + 1, loose, out);
    }
    for (const x of inner(command_of(s.words))) {
      seen(x, depth + 1, loose, out);
    }
    for (const w of [...s.words, ...s.targets]) {
      if (/\s/.test(w)) {
        seen(w, depth + 1, true, out);
      }
    }
  }
  return out;
}

// the pushes in a simple command's words: each word naming git (git,
// /usr/bin/git) followed by git's options and push, wherever it stands
// (a runner the guard doesn't know: mise exec -- git push); each with its
// refspecs (past the remote), whether it pushes every branch, and tags
export function pushes(ws: string[]): { specs: string[]; all: boolean; tags: boolean }[] {
  const out: { specs: string[]; all: boolean; tags: boolean }[] = [];
  for (let k = 0; k < ws.length; k++) {
    const g = ws[k] ?? "";
    if (g.slice(g.lastIndexOf("/") + 1) !== "git") {
      continue;
    }
    let i = k + 1;
    while (i < ws.length && (ws[i] ?? "").startsWith("-")) {
      i += GIT_VALUED.has(ws[i] ?? "") ? 2 : 1;
    }
    if (ws[i] !== "push") {
      continue;
    }
    // git push --help, -h: its manual, no push
    if (ws.slice(i + 1).some((a) => a === "--help" || a === "-h")) {
      continue;
    }
    const opts: string[] = [];
    const pos: string[] = [];
    let rest = false;
    for (let j = i + 1; j < ws.length; j++) {
      const a = ws[j] ?? "";
      if (!rest && a === "--") {
        rest = true;
      } else if (!rest && a.startsWith("-") && a !== "-") {
        opts.push(a);
        if (PUSH_VALUED.has(a)) {
          j += 1;
        }
      } else {
        pos.push(a);
      }
    }
    // --repo names the remote: then every word left is a refspec
    const repo = opts.some((o) => o === "--repo" || o.startsWith("--repo="));
    const specs = repo ? pos : pos.slice(1);
    out.push({
      specs,
      all: opts.some((o) => /^--(?:all|mirror|branches)(?:=|$)/.test(o)),
      // tag v1 is refs/tags/v1
      tags: opts.some((o) => o === "--tags" || o === "--follow-tags") || specs.includes("tag"),
    });
  }
  return out;
}

// a refspec's destination: what follows its last ":", or all of it (a
// ${...} read as one thing: ${x:-main} is a variable, not -main}); its +
// taken out
function dst(spec: string): string {
  const r = spec.replace(/^\+/, "").replace(/\$\{[^}]*\}?/g, "$V");
  return r.includes(":") ? r.slice(r.lastIndexOf(":") + 1) : r;
}

// whether a refspec leaves where it goes to git: HEAD, @, ":" (matching
// branches), or what the serve can't read (a variable, a command's
// output, a glob, xargs' {})
function unnamed(spec: string): boolean {
  const d = dst(spec);
  return d === "" || /^(?:HEAD|@|refs\/heads\/HEAD)$/.test(d) || /[$`*?[]/.test(d) || d === "{}";
}

// the command a part runs: its first word past variables set for it and
// what only runs what follows (sudo -u x, env, nohup, timeout 5...), named
// by its file's name (/usr/bin/pkill is pkill); null: none
export function command_of(ws: string[]): Cmd | null {
  let i = 0;
  while (i < ws.length) {
    const w = ws[i] ?? "";
    if (w === "" || /^[A-Za-z_]\w*\+?=/.test(w)) {
      i += 1;
      continue;
    }
    const name = w.slice(w.lastIndexOf("/") + 1);
    const valued = RUNNERS[name];
    if (valued === undefined) {
      return { name, args: ws.slice(i + 1) };
    }
    i += 1;
    while (i < ws.length && (ws[i] ?? "").startsWith("-") && ws[i] !== "-") {
      i += valued.includes(ws[i] ?? "") ? 2 : 1;
    }
    // timeout's duration
    if (name === "timeout" && i < ws.length) {
      i += 1;
    }
  }
  return null;
}

// the scripts a command runs inside it: a shell's -c script, eval's
// words, env -S's string, ssh's remote command, watch's
function inner(cmd: Cmd | null): string[] {
  const out: string[] = [];
  if (cmd === null) {
    return out;
  }
  const c = cmd.args.indexOf("-c");
  if (SHELLS.has(cmd.name) && c >= 0) {
    out.push(cmd.args[c + 1] ?? "");
  } else if (SHELLS.has(cmd.name)) {
    const lc = cmd.args.findIndex((a) => /^-\w*c\w*$/.test(a));
    if (lc >= 0) {
      out.push(cmd.args[lc + 1] ?? "");
    }
  }
  if (cmd.name === "eval" || cmd.name === "watch") {
    out.push(cmd.args.filter((a) => !a.startsWith("-")).join(" "));
  }
  if (cmd.name === "ssh") {
    let i = 0;
    while (i < cmd.args.length && (cmd.args[i] ?? "").startsWith("-")) {
      i += SSH_VALUED.has(cmd.args[i] ?? "") ? 2 : 1;
    }
    out.push(cmd.args.slice(i + 1).join(" "));
  }
  return out;
}

// env -S 'pkill bun': env's split string, as a command (command_of skips
// env's options and their values, so it is read here)
function env_split(ws: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i] ?? "";
    if (w.slice(w.lastIndexOf("/") + 1) !== "env") {
      continue;
    }
    for (let j = i + 1; j < ws.length && (ws[j] ?? "").startsWith("-"); j++) {
      const o = ws[j] ?? "";
      if (o === "-S" || o === "--split-string") {
        out.push(ws[j + 1] ?? "");
      } else if (o.startsWith("-S") || o.startsWith("--split-string=")) {
        out.push(o.replace(/^-S|^--split-string=/, ""));
      }
    }
  }
  return out;
}

// whether a pattern given to pkill, pgrep, killall -r reaches the serve;
// one that can't be read (a variable, a command's output, not a regular
// expression) is taken to
function hits(pattern: string, full: boolean, exact: boolean, nocase: boolean, lines: string[]): boolean {
  if (/\$[({\w]|`/.test(pattern) || slow(pattern)) {
    return true;
  }
  let re: RegExp;
  try {
    re = new RegExp(exact ? "^(?:" + pattern + ")$" : pattern, nocase ? "i" : "");
  } catch {
    return true;
  }
  return (full ? lines : SERVE_NAMES).some((t) => re.test(t));
}

// whether a pattern may take long to match the serve's lines (a JS regex
// backtracks: (.+)+x or (.*.*.*.*)x took the guard past 10 s, the serve
// frozen with it): too long, a quantifier or an alternation inside a
// quantified group ((.|.)*zz), a back reference, more than 2 quantifiers
// that repeat (*, +, {n,m}; a ?
// after a group only makes it optional), or
// more than 8 in all (?, {n} too). Such a pattern is refused as one that
// can't be read (Guard.hits); a measure, not a proof: the test holds it
// under 1 s
export function slow(pattern: string): boolean {
  if (pattern.length > PATTERN_MAX || /\\[1-9]|\\k</.test(pattern)) {
    return true;
  }
  // each group open: whether a quantifier stands in it
  const open: boolean[] = [];
  // each group open: whether an alternation stands in it ((.|.)*zz took
  // 1162 ms on the serve's lines: its branches match the same text)
  const alts: boolean[] = [];
  let repeats = 0;
  let all = 0;
  let inside = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? "";
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "[") {
      // a class: to its ] (a ] first in it is a character)
      let j = i + 1;
      if (pattern[j] === "^") j += 1;
      if (pattern[j] === "]") j += 1;
      while (j < pattern.length && pattern[j] !== "]") j += pattern[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if (c === "(") {
      open.push(false);
      alts.push(false);
      continue;
    }
    if (c === "|") {
      if (alts.length > 0) {
        alts[alts.length - 1] = true;
      }
      continue;
    }
    const quant = c === "*" || c === "+" || c === "?" && pattern[i - 1] !== "(" || c === "{" && /^\{\d*,?\d*\}/.test(pattern.slice(i));
    if (c === ")") {
      inside = open.pop() ?? false;
      const alt = alts.pop() ?? false;
      // a quantifier after a group with one or an alternation in it
      const q = pattern[i + 1] ?? "";
      if ((inside || alt) && (q === "*" || q === "+" || q === "{")) {
        return true;
      }
      if (alt && alts.length > 0) {
        alts[alts.length - 1] = true;
      }
      if (inside && open.length > 0) {
        open[open.length - 1] = true;
      }
      continue;
    }
    if (quant) {
      // a lazy ? after a quantifier is no other
      if (c === "?" && /[*+?}]/.test(pattern[i - 1] ?? "")) {
        continue;
      }
      if (open.length > 0) {
        open[open.length - 1] = true;
      }
      all += 1;
      const range = c === "{" ? /^\{(\d*)(,?)(\d*)\}/.exec(pattern.slice(i)) : null;
      if (c === "*" || c === "+" || range !== null && range[2] === "," && (range[3] === "" || Number(range[3]) > Number(range[1] || "0"))) {
        repeats += 1;
      }
    }
  }
  return repeats > 2 || all > 8;
}

// whether fuser kills (-k) what may be the serve: any file (its program,
// its data), or the serve's port; a port of another serve (fuser -k
// 8790/tcp) goes
function fuser_kills(cmd: Cmd): boolean {
  const a = cmd.args;
  if (!a.some((o) => o === "--kill" || /^-[a-zA-Z]*k[a-zA-Z]*$/.test(o))) {
    return false;
  }
  const ns = a.findIndex((o) => o === "-n" || o === "--namespace");
  const named = ns >= 0 ? a[ns + 1] ?? "" : "";
  const pos = a.filter((o, k) => !o.startsWith("-") && !(ns >= 0 && k === ns + 1));
  if (pos.length === 0 || a.some((o) => o === "-m" || o === "--mount" || /^-[a-zA-Z]*[mM][a-zA-Z]*$/.test(o))) {
    return true;
  }
  return pos.some((p) => {
    const port = /^(\d+)(?:,[^/]*)?\/(?:tcp|udp)$/.exec(p)?.[1] ?? (/^(?:tcp|udp)$/.test(named) && /^\d+$/.test(p) ? p : undefined);
    return port === undefined || SERVE_PORTS.includes(port);
  });
}

// whether lsof, in a command with a kill (kill $(lsof -ti :8788)), finds
// what may be the serve: its port, a network spec with no port (every
// process with a socket), or a file (one the serve may hold)
function lsof_finds(cmd: Cmd): boolean {
  const a = cmd.args;
  // a selection by another port, or by pids (-p 123), goes; none: every
  // process with a file open, the serve among them
  let picked = false;
  for (let k = 0; k < a.length; k++) {
    const o = a[k] ?? "";
    const i = /^-[a-zA-Z]*i(.*)$/.exec(o);
    if (i !== null) {
      const spec = i[1] !== "" ? i[1] ?? "" : (a[k + 1] ?? "").startsWith("-") ? "" : a[k + 1] ?? "";
      if (i[1] === "" && spec !== "") {
        k += 1;
      }
      // the port list after the last colon (:8788, TCP:8787-8789,
      // :8787,8788, :http); none: every socket
      const at = spec.lastIndexOf(":");
      if (at < 0 || ports_hit(spec.slice(at + 1))) {
        return true;
      }
      picked = true;
      continue;
    }
    if (o === "-p" && /^[\d,]+$/.test(a[k + 1] ?? "")) {
      picked = true;
      k += 1;
      continue;
    }
    if (!o.startsWith("-")) {
      return true;
    }
  }
  return !picked;
}

// the services file's text (/etc/services), read once
let SERVICES: string | null = null;

// whether an lsof -i port list holds the serve's port: a port (8788), a
// range (8780-8790), a list (8787,8788), or a service's name looked up
// in the services file (http is 80: it goes); what can't be read ($P)
// may be the serve
export function ports_hit(list: string, services?: string): boolean {
  if (services === undefined) {
    if (SERVICES === null) {
      try {
        SERVICES = readFileSync("/etc/services", "utf8");
      } catch {
        SERVICES = "";
      }
    }
    services = SERVICES;
  }
  const text = services;
  return list.split(",").some((p) => {
    const range = /^(\d+)-(\d+)$/.exec(p);
    if (range !== null) {
      return SERVE_PORTS.some((s) => Number(s) >= Number(range[1]) && Number(s) <= Number(range[2]));
    }
    if (/^\d+$/.test(p)) {
      return SERVE_PORTS.includes(p);
    }
    if (!/^[A-Za-z][\w.+-]*$/.test(p)) {
      return true;
    }
    // its lines: name port/protocol aliases...
    return text.split("\n").some((l) => {
      const w = l.replace(/#.*/, "").trim().split(/\s+/);
      return (w[0] === p || w.slice(2).includes(p)) && SERVE_PORTS.includes((w[1] ?? "").split("/")[0] ?? "");
    });
  });
}

// a grep's reading: its patterns (-e, -eX, --regexp=X, else its first
// word), whether it inverts (-v), ignores case (-i), matches only whole
// lines or words (-x, -w), or reads its patterns from a file (-f)
function grep_of(c: Cmd): { pats: string[]; v: boolean; i: boolean; whole: boolean; file: boolean } {
  const out = { pats: [] as string[], v: false, i: false, whole: false, file: false };
  const pos: string[] = [];
  const a = c.args;
  for (let k = 0; k < a.length; k++) {
    const o = a[k] ?? "";
    if (o === "--") {
      pos.push(...a.slice(k + 1));
      break;
    }
    if (o.startsWith("--")) {
      const [name = "", val] = o.split(/=(.*)/s);
      if (name === "--regexp" || name === "--file") {
        const x = val ?? a[++k] ?? "";
        if (name === "--file") out.file = true;
        else out.pats.push(x);
      } else if (name === "--invert-match") out.v = true;
      else if (name === "--ignore-case") out.i = true;
      else if (name === "--line-regexp" || name === "--word-regexp") out.whole = true;
      else if (/^--(?:max-count|after-context|before-context|context)$/.test(name) && val === undefined) k += 1;
      continue;
    }
    if (o.startsWith("-") && o.length > 1) {
      // a cluster of short options (-iv, -ve x, -eX)
      for (let j = 1; j < o.length; j++) {
        const f = o[j] ?? "";
        if ("efmABCdD".includes(f)) {
          const x = j + 1 < o.length ? o.slice(j + 1) : a[++k] ?? "";
          if (f === "e") out.pats.push(x);
          if (f === "f") out.file = true;
          break;
        }
        if (f === "v") out.v = true;
        if (f === "i") out.i = true;
        if (f === "x" || f === "w") out.whole = true;
      }
      continue;
    }
    pos.push(o);
  }
  if (out.pats.length === 0 && !out.file && pos[0] !== undefined) {
    out.pats.push(pos[0]);
  }
  return out;
}

// whether a grep keeps a line of the serve. One that picks (no -v) keeps
// it if a pattern may match it, read as a JS regex and as grep's basic
// one (bun\|x), in any case. One that inverts (-v) drops it only if a
// pattern of plain text stands in it (grep -v Cli.ts); a regex, -x, -w,
// -f: it may keep it
function grep_keeps(g: ReturnType<typeof grep_of>, line: string): boolean {
  if (g.file || g.pats.length === 0) {
    return true;
  }
  if (!g.v) {
    return g.pats.some((p) => hits(p, true, false, true, [line]) || hits(p.replace(/\\([|(){}+?])/g, "$1"), true, false, true, [line]));
  }
  if (g.whole) {
    return true;
  }
  return !g.pats.some((p) => /^[\w .:/=@%,-]+$/.test(p) && (g.i ? line.toLowerCase().includes(p.toLowerCase()) : line.includes(p)));
}

// whether ps, in a command with a kill (kill $(ps -C bun -o pid=), ps aux
// | grep bun | xargs kill), finds what may be the serve: ps -C naming it,
// or every process (ps aux, ps -e) whose pipeline keeps a line of the
// serve. The greps that count stand after that ps and before a kill in
// the same pipeline (ps | grep -v nosuch | xargs kill is refused;
// ps | xargs kill; grep -v Cli.ts f is refused too: the grep is another
// command and does not clear the ps). A pick keeps the line if any of
// them may match it; every invert must drop it. ps -p with its pids goes
function ps_finds(all: Seen[], lines: string[]): boolean {
  const run: { name: string; args: string[]; join: boolean }[] = [];
  for (const s of all) {
    if (s.loose) {
      continue;
    }
    const c = command_of(s.cmd.words);
    run.push({ name: c?.name ?? "", args: c?.args ?? [], join: s.cmd.join });
  }
  const groups: { name: string; args: string[]; join: boolean }[][] = [];
  let cur: { name: string; args: string[]; join: boolean }[] = [];
  for (const c of run) {
    if (!c.join && cur.length > 0) {
      groups.push(cur);
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length > 0) {
    groups.push(cur);
  }
  const isGrep = (n: string) => /^(?:e|f|r)?grep$|^rg$/.test(n);
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === undefined || c.name !== "ps") {
        continue;
      }
      const a = c.args;
      const by = (f: string[]) => a.findIndex((o) => f.includes(o));
      const named = by(["-C"]);
      if (named >= 0) {
        if ((a[named + 1] ?? "").split(",").some((n) => SERVE_NAMES.includes(n) || /\$|`/.test(n))) {
          return true;
        }
        continue;
      }
      const pid = by(["-p", "--pid", "p"]);
      if (pid >= 0 && /^[\d,\s]+$/.test(a[pid + 1] ?? "")) {
        continue;
      }
      let end = g.length;
      for (let j = i + 1; j < g.length; j++) {
        if (g[j]?.name === "kill") {
          end = j;
          break;
        }
      }
      const greps = g.slice(i + 1, end).filter((x) => isGrep(x.name)).map((x) => grep_of({ name: x.name, args: x.args }));
      const picks = greps.filter((x) => !x.v);
      const drops = greps.filter((x) => x.v);
      const kept = (l: string) => (picks.length === 0 || picks.some((x) => grep_keeps(x, l))) && drops.every((x) => grep_keeps(x, l));
      if (lines.some(kept)) {
        return true;
      }
    }
  }
  return false;
}

// whether pkill, pgrep or pidof, as called, reaches the serve (pkill bun,
// pkill -f Cli.ts, pkill -u morum; not pkill -f 'bun test'), or killall
// (killall bun); its words come from Guard.lex, redirections out
function targets(cmd: Cmd, lines: string[]): boolean {
  const opts: string[] = [];
  const pos: string[] = [];
  const valued = cmd.name === "killall"
    ? new Set(["-s", "--signal", "-u", "--user", "-o", "--older-than", "-y", "--younger-than", "-n", "--ns", "-Z", "--context"])
    : new Set(["--signal", "-g", "--pgroup", "-G", "--group", "-P", "--parent", "-s", "--session", "-t", "--terminal", "-u", "--euid", "-U", "--uid", "--ns", "--nslist", "-q", "--queue", "-d", "--delimiter", "-F", "--pidfile", "--env", "--cgroup"]);
  for (let i = 0; i < cmd.args.length; i++) {
    const a = cmd.args[i] ?? "";
    if (a.startsWith("-") && a !== "-" && a !== "--") {
      opts.push(a);
      if (valued.has(a)) {
        opts.push(cmd.args[i + 1] ?? "");
        i += 1;
      }
      continue;
    }
    if (a !== "--") {
      pos.push(a);
    }
  }
  const has = (...f: string[]) => opts.some((o) => f.includes(o) || /^-[a-zA-Z]+$/.test(o) && f.some((x) => x.length === 2 && o.includes(x[1] ?? "")));
  // a pidfile: the serve's (server.pid), or one not read, reaches it
  const pidfile = opts.findIndex((o) => o === "-F" || o === "--pidfile" || o.startsWith("--pidfile="));
  if (pidfile >= 0 && /server\.pid|unii|\$|`/.test(opts[pidfile + 1] ?? opts[pidfile] ?? "")) {
    return true;
  }
  if (cmd.name === "pidof") {
    return pos.some((p) => SERVE_NAMES.includes(p.slice(p.lastIndexOf("/") + 1)) || /\$|`/.test(p));
  }
  if (cmd.name === "killall") {
    const regex = has("-r", "--regexp");
    const nocase = has("-I", "--ignore-case");
    if (pos.length === 0) {
      return opts.some((o) => o === "-u" || o === "--user");
    }
    // killall /usr/bin/bun names the program by its file: its name is bun
    return pos.some((p) => regex ? hits(p, false, false, nocase, lines) : /\$|`/.test(p) || SERVE_NAMES.some((n) => {
      const b = p.slice(p.lastIndexOf("/") + 1);
      return nocase ? n.toLowerCase() === b.toLowerCase() : n === b;
    }));
  }
  // pkill, pgrep: -v (--inverse) picks every process the pattern misses;
  // no pattern, only -u and the like: every process of theirs
  if (opts.includes("-v") || opts.includes("--inverse") || opts.some((o) => /^-[a-zA-Z]*v[a-zA-Z]*$/.test(o) && !/^-\d/.test(o) && o.length > 2 && !o.startsWith("-SIG"))) {
    return true;
  }
  const pattern = pos[0];
  if (pattern === undefined) {
    return pidfile < 0;
  }
  return hits(pattern, has("-f", "--full"), has("-x", "--exact"), has("-i", "--ignore-case"), lines);
}

// a program's calls in a simple command's words: each word naming one of
// them (terraform, /usr/bin/gh), wherever it stands, with the words after
// it, its options (with the values of those in valued) apart from the
// rest (pos): gh pr -R o/r merge 5 is pos pr, merge, 5
export function calls(ws: string[], names: Set<string>, valued: Set<string>): { pos: string[]; opts: string[][] }[] {
  const out: { pos: string[]; opts: string[][] }[] = [];
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k] ?? "";
    if (!names.has(w.slice(w.lastIndexOf("/") + 1))) {
      continue;
    }
    const pos: string[] = [];
    const opts: string[][] = [];
    for (let j = k + 1; j < ws.length; j++) {
      const a = ws[j] ?? "";
      if (a.startsWith("-") && a !== "-" && a !== "--") {
        if (valued.has(a)) {
          opts.push([a, ws[j + 1] ?? ""]);
          j += 1;
        } else {
          opts.push([a]);
        }
      } else if (a !== "--") {
        pos.push(a);
      }
    }
    out.push({ pos, opts });
  }
  return out;
}

// gh's calls (Guard.calls)
function gh(ws: string[]): { pos: string[]; opts: string[][] }[] {
  return calls(ws, new Set(["gh"]), GH_VALUED);
}

// a gh api call's method: the last -X or --method, else POST if it sends
// fields or a body (--input), else GET (as gh does); HEAD is a read
function api_method(g: { pos: string[]; opts: string[][] }): string {
  const set = g.opts.map((o) => o[0] === "-X" || o[0] === "--method" ? o[1] ?? "" : /^-X.|^--method=/.test(o[0] ?? "") ? (o[0] ?? "").replace(/^-X|^--method=/, "") : null)
    .filter((m) => m !== null);
  const body = g.opts.some((o) => /^(?:-f|-F|--field|--raw-field|--input)$|^--(?:raw-)?field=|^--input=/.test(o[0] ?? ""));
  const m = (set.at(-1) ?? (body ? "POST" : "GET")).toUpperCase();
  return m === "HEAD" ? "GET" : m;
}

// whether a gh api call writes where a write is a user's order (merges,
// a workflow's dispatches, releases)
function api_write(g: { pos: string[]; opts: string[][] }): boolean {
  return api_method(g) !== "GET" && API_WRITES.test(g.pos[1] ?? "");
}

// whether curl (or wget) calls the GitHub API with a method that changes
// it: -X (or --request) other than GET and HEAD, or a body (-d, --data*,
// --json, -F, -T) without -G; the serve can't read what a body changes
function curl_writes(ws: string[]): boolean {
  const cmd = command_of(ws);
  if (cmd === null || !cmd.args.some((w) => GITHUB_API.test(w))) {
    return false;
  }
  const a = cmd.args;
  if (cmd.name === "wget") {
    return a.some((o) => /^--(?:post-data|post-file|body-data|body-file)(?:=|$)/.test(o))
      || a.some((o, k) => /^--method(?:=|$)/.test(o) && !/^(?:GET|HEAD)$/i.test(o.includes("=") ? o.slice(9) : a[k + 1] ?? ""));
  }
  if (cmd.name !== "curl") {
    return false;
  }
  let method = "";
  let body = false;
  let get = false;
  for (let k = 0; k < a.length; k++) {
    const o = a[k] ?? "";
    if (o === "--request" || o.startsWith("--request=")) {
      method = o.includes("=") ? o.slice(10) : a[++k] ?? "";
    } else if (/^--(?:data(?:-raw|-binary|-urlencode|-ascii)?|json|form(?:-string)?|upload-file)(?:=|$)/.test(o)) {
      body = true;
    } else if (o === "--get") {
      get = true;
    } else if (/^-[a-zA-Z]/.test(o) && !o.startsWith("--")) {
      // a cluster of short options (-sSX POST, -XPOST, -sd '{}')
      for (let j = 1; j < o.length; j++) {
        const f = o[j] ?? "";
        if (f === "X") {
          method = j + 1 < o.length ? o.slice(j + 1) : a[++k] ?? "";
          break;
        }
        if (f === "d" || f === "F" || f === "T") {
          body = true;
          break;
        }
        if (f === "G") get = true;
      }
    }
  }
  // the GraphQL endpoint is read by POST: its merges are read by name
  // (mergePullRequest), not here
  if ((method === "" || /^POST$/i.test(method)) && a.some((w) => /github\.com\/graphql(?:[?#]|$)/.test(w))) {
    return false;
  }
  const m = (method !== "" ? method : body && !get ? "POST" : "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD";
}

// the tags a git tag command makes (git tag v1, git tag -a v1 -m x): none
// when it lists (-l, --list, -n, --contains...), deletes (-d) or verifies
// (-v)
function tags_made(ws: string[]): string[] {
  const out: string[] = [];
  for (const g of calls(ws, new Set(["git"]), GIT_VALUED)) {
    if (g.pos[0] !== "tag") {
      continue;
    }
    // the words after tag: its options (-m, -F, -u take the next word),
    // then the name
    const at = ws.indexOf("tag", ws.findIndex((w) => w.slice(w.lastIndexOf("/") + 1) === "git"));
    let name: string | undefined;
    let lists = false;
    for (let j = at + 1; j < ws.length; j++) {
      const a = ws[j] ?? "";
      if (/^-[a-zA-Z]*[ldvn]|^--(?:list|delete|verify|contains|no-contains|merged|no-merged|points-at|sort|format)/.test(a)) {
        lists = true;
      } else if (/^-[a-zA-Z]*[mFu]$|^--(?:message|file|local-user)$/.test(a)) {
        j += 1;
      } else if (!a.startsWith("-") && name === undefined) {
        name = a;
      }
    }
    if (!lists && name !== undefined) {
      out.push(name);
    }
  }
  return out;
}

// whether a gh api call changes main: a git/refs write naming heads/main
// or master (in its path, or as its ref field), or one the serve can't
// read; a contents write (PUT, DELETE) on main or master, or naming no
// branch in its fields (the default one), or one the serve can't read
function api_main(g: { pos: string[]; opts: string[][] }): boolean {
  const path = g.pos[1] ?? "";
  const fields = g.opts.filter((o) => ["-f", "-F", "--field", "--raw-field"].includes(o[0] ?? "")).map((o) => o[1] ?? "")
    .concat(g.opts.map((o) => o[0] ?? "").filter((o) => /^--(?:raw-)?field=/.test(o)).map((o) => o.replace(/^--(?:raw-)?field=/, "")));
  const method = api_method(g);
  if (method === "GET") {
    return false;
  }
  const main = (b: string) => /^(?:refs\/heads\/)?(?:main|master)$/.test(b) || /[$`*]/.test(b);
  if (/(?:^|\/)git\/refs(?:\/|$|\?)/.test(path)) {
    const head = /git\/refs\/heads\/([^?]+)/.exec(path)?.[1];
    const ref = fields.find((f) => f.startsWith("ref="))?.slice(4);
    return head !== undefined && main(head) || ref !== undefined && main(ref) || /[$`]/.test(path);
  }
  if (/(?:^|\/)contents(?:\/|$|\?)/.test(path) && (method === "PUT" || method === "DELETE")) {
    // the branch is a field of the body: one in the URL's query is not read
    const branch = fields.find((f) => f.startsWith("branch="))?.slice(7);
    return branch === undefined || main(branch);
  }
  return false;
}

// whether kill, as called, is blind: it stops a process (-STOP, -s STOP,
// -SIGSTOP, -19, -n 19), sends to every process (-1 as its target), or to
// the shell's parent ($PPID)
function blind(cmd: Cmd): boolean {
  if (cmd.name !== "kill") {
    return false;
  }
  const a = cmd.args;
  let i = 0;
  let sig = "";
  const first = a[0] ?? "";
  if (first === "-s" || first === "-n" || first === "--signal") {
    sig = a[1] ?? "";
    i = 2;
  } else if (first.startsWith("--signal=")) {
    sig = first.slice(9);
    i = 1;
  } else if (first.startsWith("-") && first !== "--" && first !== "-") {
    // -STOP, -SIGSTOP, -sigstop, -19; or glued to -s, -n: -sSTOP, -n19
    const glued = /^-[sn](.+)$/.exec(first);
    sig = glued !== null && !FREEZE.test(first.slice(1)) ? glued[1] ?? "" : first.slice(1);
    i = 1;
  }
  // its targets (a -- among them is no process)
  const pids = a.slice(i);
  return FREEZE.test(sig) || pids.includes("-1") || pids.some((p) => /PPID/.test(p));
}

// every simple command a command runs, or may (Guard.seen), env -S's
// strings among them
export function commands(command: string): Seen[] {
  const out = seen(command, 0, false, []);
  for (const s of [...out]) {
    for (const x of env_split(s.cmd.words)) {
      seen(x, 1, s.loose, out);
    }
  }
  return out;
}

// why a subagent's shell command is refused, or null: it does none of the
// bans. Each simple command it runs, or may (Guard.commands), is read as
// bash reads it (Guard.lex)
// (lines: the serve's command lines, this serve's by default; a test gives
// others)
export function forbidden(command: string, lines: string[] = SERVE_LINES): string | null {
  const all = commands(command);
  const hit = BANS.filter((b) => all.some((s) => b.test(s.cmd, s.cmd.words.join(" "))) || b.whole?.(all, lines) === true);
  if (hit.length === 0) {
    return null;
  }
  return "Recusado pelo serve: subagentes não podem " + hit.map((b) => b.what).join(", nem ") + ". Essas ações são ordens do usuário à Unii. Não tente outro caminho (script, alias, variável): termine o que pode fazer e diga no relato o que falta, para a Unii decidir com o usuário.";
}
