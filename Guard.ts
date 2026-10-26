// Guard
// =====
// What no subagent may do, whoever started it (P109, 26/10/2026): merge
// a pull request, restart the serve, deploy, or push to main. The user
// gives those orders to Unii alone; an agent's tree inherits the ban, so
// a grandchild can't do through a shell what its parent couldn't. The
// serve checks each shell command a subagent sends (Tools.call) before
// its device runs it, and refuses one that does any of these, saying
// which and why. It reads the command as written: it stops the mistake,
// an agent following a habit or a task that says "and merge it", not one
// bent on hiding it (a script it wrote, an alias, a variable); the
// prompt (Tools.ts NESTED) says the same, so neither stands alone.
// Where it can't tell, it refuses: a push that doesn't name where it goes
// (git push, git push origin HEAD) may land on main if the branch checked
// out, or its upstream, is main, which the serve can't see from here; the
// agent names the branch (git push origin HEAD:feat/x) and it goes through.
// A subshell or group around the push, or a redirection glued to its last
// word ((git push origin main), git push origin main>/dev/null), is read
// as the push it holds: ), } and what a < or > starts are cut off a word's
// end before its refspec is read. A redirection's target is a file, not a
// refspec, glued or not: (git push origin feat/x) > main and git push
// origin feat/x > main go through (HoneyPig, P109); & is read inside
// 2>&1, >& and &>, so git push origin feat/x 2>&1 main is the push of main
// it is, not a push and a command "1 main".
// A backslash is read as a quote is: taken out (git push origin ma\in and
// git push origin main\ are refused as git push origin main; HoneyPig).
// Out of reach, as said above, and so let through (GreenPepper, P109): a
// push that names the current branch by another of git's spellings (git
// push origin HEAD~0, HEAD^, main^{}), a command held in a variable set
// elsewhere ($CMD), a script the agent wrote (bash push.sh), an alias.
// Reading those would mean running a shell; the prompt bans them as much
// as the serve bans the rest.
// A cost taken on purpose: quotes don't hide a ban, so a command that only
// writes one down (echo 'git push origin main' > /tmp/x, a heredoc) is
// refused as if it ran it. Better a needless refusal, which the agent
// works around by writing it another way, than a push to main let through.

// Types
// =====

// a ban: what it is, as the agent is told, and what a command doing it
// looks like (on one of its parts: Guard.parts; whole: the command, for
// what spans parts, as `pgrep x | xargs kill`)
type Ban = { what: string; test: (part: string) => boolean; whole?: (command: string) => boolean };

// a command's first word, after what only runs it (sudo, env, nohup...),
// and the words after it
type Cmd = { name: string; args: string[] };

// Constants
// =========

// a word boundary for a command's words (a path or flag may hold "-"); a
// program may be named by its path (/usr/bin/gh, ~/bin/git)
const W = "(?<![\\w.-])(?:[\\w.~$/-]*/)?";
const E = "(?![\\w-])";

// git's push, as its subcommand, after its options ("git -C dir push"; not
// a commit's message that says "push em main")
const PUSH = new RegExp(W + "git(?:\\s+(?:-[Cc]\\s+\\S+|--?[\\w-]+(?:=\\S+)?))*\\s+push" + E);
// a refspec naming main or master as where it goes (src:main, main, +main,
// refs/heads/main, HEAD:main), or every branch at once, or tags
const PUSH_MAIN = /(?:^|\s)\+?(?:[^\s:]*:)?(?:refs\/heads\/)?(?:main|master)(?=\s|$)/;
const PUSH_ALL = /(?:^|\s)--(?:all|mirror)(?=\s|$|=)/;
const PUSH_TAGS = /(?:^|\s)(?:--tags|--follow-tags)(?=\s|$)|(?:^|\s)\+?(?:[^\s:]*:)?refs\/tags\//;
// push's options that take the next word as their value
const PUSH_VALUED = new Set(["-o", "--push-option", "--repo", "--exec", "--receive-pack"]);
// a word that is a redirection (2>&1, >x, &>log, <<EOF), and one that is
// only its operator, its target the next word (>, 2>>, &>, >&, <<)
const REDIR = /^(?:\d*|&)[<>]/;
const REDIR_OP = /^(?:\d*|&)[<>][<>&|-]*$/;

// what only runs the command after it, and its options that take a value
const RUNNERS: Record<string, string[]> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-U", "-r", "-t", "-D"], doas: ["-u", "-C"], exec: ["-a"], command: [], nohup: [], time: ["-f", "-o"],
  nice: ["-n"], ionice: ["-c", "-n", "-p"], env: ["-u", "-C", "-S"], xargs: ["-n", "-I", "-P", "-L", "-d", "-E", "-s", "-a"], setsid: [],
  stdbuf: ["-i", "-o", "-e"], timeout: ["-s", "-k"], chronic: [], "!": [], then: [], do: [], else: [], "{": [], "(": [],
};
// shells that run a script given with -c, and the like
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "su"]);
const SSH_VALUED = new Set(["-p", "-i", "-l", "-o", "-F", "-J", "-b", "-c", "-D", "-E", "-L", "-R", "-S", "-W", "-w", "-m", "-O", "-Q", "-B", "-e", "-I"]);

// what a process of the serve looks like to pkill and its kin: its name
// (the program's: bun) and its command lines (pkill -f), the serve's and
// its device's, this very serve's among them when it is one
const SERVE_NAMES = ["bun"];
const SERVE_LINES = [
  "bun Cli.ts serve",
  "bun run Cli.ts serve --port 8788",
  "bun Cli.ts device",
  "/home/user/.local/share/mise/installs/bun/1.4.2/bin/bun /home/user/repository/uniichat/Cli.ts serve",
  "/home/user/.local/share/mise/installs/bun/1.4.2/bin/bun /home/user/repository/uniichat/Cli.ts device",
  "/usr/bin/bun /home/user/.unii/uniichat/Cli.ts serve",
  ...(process.argv.includes("serve") ? [process.argv.join(" ")] : []),
];

export const BANS: Ban[] = [
  {
    what: "mesclar um pull request (merge)",
    test: (p) => new RegExp(W + "gh\\s+pr\\s+merge" + E).test(p)
      || new RegExp(W + "gh\\s+api\\b[^\\n]*pulls/\\d+/merge" + E).test(p)
      || /pulls\/\d+\/merge(?![\w-])/.test(p) && /(?<![A-Za-z])PUT(?![A-Za-z])|-X\s*put\b|--(?:request|method)[\s=]+put\b/i.test(p)
      || /\bmergePullRequest\b|\benablePullRequestAutoMerge\b/.test(p),
  },
  {
    what: "fazer push em main/master (ou de todos os ramos)",
    test: (p) => PUSH.test(p) && (PUSH_MAIN.test(after_push(p)) || PUSH_ALL.test(after_push(p))),
  },
  {
    what: "fazer push sem dizer para qual ramo (sem refspec, HEAD, @ ou variável: o ramo atual, ou o upstream, pode ser main; diga-o, como em git push origin HEAD:feat/x)",
    test: (p) => PUSH.test(p) && !PUSH_ALL.test(after_push(p)) && push_unnamed(after_push(p)),
  },
  {
    what: "publicar tags (um release é ordem do usuário)",
    test: (p) => PUSH.test(p) && PUSH_TAGS.test(after_push(p)),
  },
  {
    what: "reiniciar ou parar o serve",
    test: (p) => new RegExp(W + "systemctl\\b[^\\n]*\\b(?:restart|stop|start|kill|reload|try-restart|reload-or-restart)\\b[^\\n]*\\bunii").test(p)
      || new RegExp(W + "unii-restart" + E).test(p)
      || /\bserver\.pid\b/.test(p) && new RegExp(W + "kill" + E).test(p),
    whole: (c) => kills_serve(c, 0) || new RegExp(W + "kill" + E).test(c) && finds_serve(c, 0),
  },
  {
    what: "fazer deploy ou aplicar infraestrutura",
    test: (p) => new RegExp(W + "(?:terraform|tofu|terragrunt)\\b[^\\n]*\\b(?:apply|destroy|import)" + E).test(p)
      || new RegExp(W + "gcloud\\b[^\\n]*\\bdeploy" + E).test(p)
      || new RegExp(W + "gcloud\\s+run\\s+(?:services|jobs)\\s+(?:update|replace|execute)" + E).test(p)
      || new RegExp(W + "kubectl\\b[^\\n]*\\b(?:apply|rollout|set\\s+image|delete|scale|patch|replace)" + E).test(p)
      || new RegExp(W + "helm\\s+(?:upgrade|install|rollback|uninstall)" + E).test(p)
      || new RegExp(W + "(?:fly|flyctl|vercel|netlify|firebase)\\b[^\\n]*\\bdeploy" + E).test(p)
      || new RegExp(W + "gh\\s+workflow\\s+run" + E).test(p)
      || /\/actions\/(?:apply|confirm)\b/.test(p),
  },
];

// Guard
// =====

// what follows git's push in a part (its remote and refspecs), each word
// with what closes a subshell or group, or starts a redirection glued to
// it, cut off its end ((git push origin main) and git push origin
// main>/dev/null push main), and each redirection dropped with its
// target, glued (2>&1, >/dev/null, &>log) or the next word (> main,
// 2> log): the shell takes those, git never sees them
export function after_push(p: string): string {
  const m = PUSH.exec(p);
  if (m === null) {
    return "";
  }
  const ws = p.slice(m.index + m[0].length).split(/\s+/).filter((w) => w !== "");
  const out: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i] ?? "";
    if (REDIR_OP.test(w)) {
      i += 1;
      continue;
    }
    if (REDIR.test(w)) {
      continue;
    }
    out.push(w.replace(/&?[<>].*$/, "").replace(/[)}]+$/, ""));
  }
  return out.map((w) => " " + w).join("");
}

// whether a push leaves where it goes to git (a remote and no refspec, or
// none at all), or says it with HEAD, @, a variable, a glob or ":"
// (matching branches): then the branch checked out or its upstream says
// it, and either may be main
function push_unnamed(rest: string): boolean {
  const ws = rest.split(/\s+/).filter((w) => w !== "");
  const pos: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i] ?? "";
    // a redirection (2>, >>, 2>&1 split at &: "2>") and its target
    if (/^\d*[<>]/.test(w)) {
      if (/^\d*[<>]+$/.test(w)) {
        i += 1;
      }
      continue;
    }
    if (w.startsWith("-") && w !== "-") {
      if (PUSH_VALUED.has(w)) {
        i += 1;
      }
      continue;
    }
    pos.push(w);
  }
  const specs = pos.slice(1);
  if (specs.length === 0) {
    return true;
  }
  return specs.some((s) => {
    const r = s.replace(/^\+/, "");
    const dst = r.includes(":") ? r.slice(r.lastIndexOf(":") + 1) : r;
    return dst === "" || /^(?:HEAD|@|refs\/heads\/HEAD)$/.test(dst) || /[$`*?\[]/.test(dst);
  });
}

// a command's parts: split at ;, &&, ||, |, & and newlines (a line
// continued with "\" is one), so one ban looks at one command; an & in a
// redirection (2>&1, >&, &>) is no split; quotes are not read, so a ban
// named only inside a quoted string still counts (refused: never wrongly
// let through)
export function parts(command: string): string[] {
  return command.replace(/\\\r?\n/g, " ").split(/\n|;|&&|\|\||\||(?<![<>])&(?!>)/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p !== "");
}

// a part with its quotes and backslashes taken out: git push origin
// "HEAD:main" is git push origin HEAD:main, 'gh' pr merge is gh pr
// merge, git push origin ma\in and main\ are git push origin main
function bare(p: string): string {
  return p.replace(/["'\\]/g, "");
}

// a part's words, as a shell reads them: a quoted string is one word (an
// unclosed quote runs to the end: parts split inside quotes)
export function words(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  let some = false;
  for (const ch of s) {
    if (q !== null) {
      if (ch === q) {
        q = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      some = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur !== "" || some) {
        out.push(cur);
      }
      cur = "";
      some = false;
      continue;
    }
    cur += ch;
  }
  if (cur !== "" || some) {
    out.push(cur);
  }
  return out;
}

// the command a part runs: its first word past variables set for it and
// what only runs what follows (sudo -u x, env, nohup, timeout 5...), named
// by its file's name (/usr/bin/pkill is pkill); null: none
export function command_of(ws: string[]): Cmd | null {
  let i = 0;
  while (i < ws.length) {
    const w = (ws[i] ?? "").replace(/^(?:\$\(|`|\(|\{)+/, "");
    if (w === "" || /^[A-Za-z_]\w*=/.test(w)) {
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

// the scripts a part runs inside it: what $(...) and `...` hold (one a
// pipe split, as $(pgrep x | head -1), to the part's end), a shell's -c
// script, eval's words, ssh's remote command, watch's
function inner(part: string, cmd: Cmd | null): string[] {
  const out = [...part.matchAll(/\$\(([^()]*)\)|`([^`]*)`|\$\(([^()]*)$|`([^`]*)$/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
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

// whether a pattern given to pkill, pgrep, killall -r reaches the serve;
// one that can't be read (a variable, a command's output, not a regular
// expression) is taken to
function hits(pattern: string, full: boolean, exact: boolean, nocase: boolean): boolean {
  if (/\$[({\w]|`/.test(pattern)) {
    return true;
  }
  let re: RegExp;
  try {
    re = new RegExp(exact ? "^(?:" + pattern + ")$" : pattern, nocase ? "i" : "");
  } catch {
    return true;
  }
  return (full ? SERVE_LINES : SERVE_NAMES).some((t) => re.test(t));
}

// whether pkill, pgrep or pidof, as called, reaches the serve (pkill bun,
// pkill -f Cli.ts, pkill -u morum; not pkill -f 'bun test'), or killall
// (killall bun)
function targets(cmd: Cmd): boolean {
  const opts: string[] = [];
  const pos: string[] = [];
  const valued = cmd.name === "killall"
    ? new Set(["-s", "--signal", "-u", "--user", "-o", "--older-than", "-y", "--younger-than", "-n", "--ns", "-Z", "--context"])
    : new Set(["--signal", "-g", "--pgroup", "-G", "--group", "-P", "--parent", "-s", "--session", "-t", "--terminal", "-u", "--euid", "-U", "--uid", "--ns", "--nslist", "-q", "--queue", "-d", "--delimiter", "-F", "--pidfile", "--env", "--cgroup"]);
  for (let i = 0; i < cmd.args.length; i++) {
    // a redirection and its target (> log, 2>&1), or one glued to a word's
    // end (pkill bun>/dev/null, bun&>log: the pattern is bun)
    if (REDIR_OP.test(cmd.args[i] ?? "")) {
      i += 1;
      continue;
    }
    if (REDIR.test(cmd.args[i] ?? "")) {
      continue;
    }
    const a = (cmd.args[i] ?? "").replace(/&?[<>].*$/, "");
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
    return pos.some((p) => regex ? hits(p, false, false, nocase) : /\$|`/.test(p) || SERVE_NAMES.some((n) => nocase ? n.toLowerCase() === p.toLowerCase() : n === p));
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
  return hits(pattern, has("-f", "--full"), has("-x", "--exact"), has("-i", "--ignore-case"));
}

// whether a command kills the serve by its name or command line: pkill or
// killall run as a command (not words a grep looks for), in any of its
// parts, or in a script inside one (sh -c '...', $(...), ssh host '...')
function kills_serve(command: string, depth: number): boolean {
  return depth < 4 && parts(command).some((p) => {
    const cmd = command_of(words(p));
    if (cmd !== null && (cmd.name === "pkill" || cmd.name === "killall") && targets(cmd)) {
      return true;
    }
    return inner(p, cmd).some((s) => kills_serve(s, depth + 1));
  });
}

// whether a command looks the serve up (pgrep, pidof), for a kill in it
// (kill $(pgrep -f Cli.ts), pgrep bun | xargs kill)
function finds_serve(command: string, depth: number): boolean {
  return depth < 4 && parts(command).some((p) => {
    const cmd = command_of(words(p));
    if (cmd !== null && (cmd.name === "pgrep" || cmd.name === "pidof") && targets(cmd)) {
      return true;
    }
    return inner(p, cmd).some((s) => finds_serve(s, depth + 1));
  });
}

// why a subagent's shell command is refused, or null: it does none of the
// bans. Each part is read as written and with its quotes taken out
// (git push origin "HEAD:main")
export function forbidden(command: string): string | null {
  const ps = parts(command).flatMap((p) => [p, bare(p)]);
  const hit = BANS.filter((b) => ps.some((p) => b.test(p)) || b.whole?.(command) === true);
  if (hit.length === 0) {
    return null;
  }
  return "Recusado pelo serve: subagentes não podem " + hit.map((b) => b.what).join(", nem ") + ". Essas ações são ordens do usuário à Unii. Não tente outro caminho (script, alias, variável): termine o que pode fazer e diga no relato o que falta, para a Unii decidir com o usuário.";
}
