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

// Types
// =====

// a simple command as the shell runs it: its words (quotes, backslashes,
// comments and redirections taken out, braces expanded), the targets of
// its redirections (files, not arguments) and the scripts it substitutes
// ($(...), `...`, <(...))
export type Simple = { words: string[]; targets: string[]; subs: string[] };

// a command met in a command: loose, when it is only a word that holds a
// space, read as a command because it may be one (bash -c '...'); kills
// are read only where a command runs (Guard header: the cost)
// deep: past the depth read (Guard.DEPTH), what it runs isn't read, so
// it is refused
type Seen = { cmd: Simple; loose: boolean; deep?: boolean };

// a ban: what it is, as the agent is told, and what a command doing it
// looks like: one simple command, with its words joined by spaces (line);
// whole: all the commands met, for what spans them (pgrep x | xargs kill)
type Ban = { what: string; test: (c: Simple, line: string) => boolean; whole?: (seen: Seen[]) => boolean };

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
// a refspec's destination naming main or master
const MAIN = /^(?:refs\/heads\/)?(?:main|master)$/;

// what only runs the command after it, and its options that take a value;
// and the shell's words that start a command (if pkill bun; then ...)
const RUNNERS: Record<string, string[]> = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-U", "-r", "-t", "-D"], doas: ["-u", "-C"], exec: ["-a"], command: [], nohup: [], time: ["-f", "-o"],
  nice: ["-n"], ionice: ["-c", "-n", "-p"], env: ["-u", "-C", "-S"], xargs: ["-n", "-I", "-P", "-L", "-d", "-E", "-s", "-a"], setsid: [],
  stdbuf: ["-i", "-o", "-e"], timeout: ["-s", "-k"], chronic: [], "!": [], then: [], do: [], else: [], if: [], elif: [], while: [], until: [],
  coproc: [], "{": [],
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
    test: (_, p) => new RegExp(W + "gh\\s+pr\\s+merge" + E).test(p)
      || new RegExp(W + "gh\\s+api\\b[^\\n]*pulls/\\d+/merge" + E).test(p)
      || /pulls\/\d+\/merge(?![\w-])/.test(p) && /(?<![A-Za-z])PUT(?![A-Za-z])|-X\s*put\b|--(?:request|method)[\s=]+put\b/i.test(p)
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
    test: (c) => pushes(c.words).some((p) => p.tags || p.specs.some((s) => /(?:^|:)\+?refs\/tags\//.test(s.replace(/^\+/, "")))),
  },
  {
    what: "reiniciar ou parar o serve",
    test: (_, p) => new RegExp(W + "systemctl\\b[^\\n]*\\b(?:restart|stop|start|kill|reload|try-restart|reload-or-restart)\\b[^\\n]*\\bunii").test(p)
      || new RegExp(W + "unii-restart" + E).test(p)
      || /\bserver\.pid\b/.test(p) && new RegExp(W + "kill" + E).test(p),
    whole: (seen) => {
      const run = seen.filter((s) => !s.loose).map((s) => command_of(s.cmd.words)).filter((c) => c !== null);
      return run.some((c) => (c.name === "pkill" || c.name === "killall") && targets(c))
        || run.some((c) => c.name === "kill") && run.some((c) => (c.name === "pgrep" || c.name === "pidof") && targets(c));
    },
  },
  {
    what: "fazer deploy ou aplicar infraestrutura",
    test: (_, p) => new RegExp(W + "(?:terraform|tofu|terragrunt)\\b[^\\n]*\\b(?:apply|destroy|import)" + E).test(p)
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
  let cmd: Simple = { words: [], targets: [], subs: [] };
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
      out.push(cmd);
    }
    cmd = { words: [], targets: [], subs: [] };
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
        out.push({ words: [], targets: [], subs: [body] });
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
    // ;, &, |, (, ): each ends a command (;;, &&, ||, |& are two of them
    // in a row, to the guard the same)
    if (c === ";" || c === "&" || c === "|" || c === "(" || c === ")") {
      end_cmd();
      i += 1;
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
      out.push({ cmd: { words: [], targets: [], subs: [] }, loose, deep: true });
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
    out.push({
      specs: repo ? pos : pos.slice(1),
      all: opts.some((o) => /^--(?:all|mirror|branches)(?:=|$)/.test(o)),
      tags: opts.some((o) => o === "--tags" || o === "--follow-tags"),
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
// (killall bun); its words come from Guard.lex, redirections out
function targets(cmd: Cmd): boolean {
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
export function forbidden(command: string): string | null {
  const all = commands(command);
  const hit = BANS.filter((b) => all.some((s) => b.test(s.cmd, s.cmd.words.join(" "))) || b.whole?.(all) === true);
  if (hit.length === 0) {
    return null;
  }
  return "Recusado pelo serve: subagentes não podem " + hit.map((b) => b.what).join(", nem ") + ". Essas ações são ordens do usuário à Unii. Não tente outro caminho (script, alias, variável): termine o que pode fazer e diga no relato o que falta, para a Unii decidir com o usuário.";
}
