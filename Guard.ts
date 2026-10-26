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

// Types
// =====

// a ban: what it is, as the agent is told, and what a command doing it
// looks like (on one of its parts: Guard.parts)
type Ban = { what: string; test: (part: string) => boolean };

// Constants
// =========

// a word boundary for a command's words (a path or flag may hold "-")
const W = "(?<![\\w./-])";
const E = "(?![\\w-])";

// a push's refspec naming main or master as where it goes (src:main,
// main, +main, refs/heads/main, HEAD:main), or every branch at once
// (push as git's subcommand, after its options: "git -C dir push"; not
// a commit's message that says "push em main")
const PUSH = new RegExp(W + "git(?:\\s+(?:-[Cc]\\s+\\S+|--?[\\w-]+(?:=\\S+)?))*\\s+push" + E);
const PUSH_MAIN = /(?:^|\s)\+?(?:[^\s:]*:)?(?:refs\/heads\/)?(?:main|master)(?=\s|$)/;
const PUSH_ALL = /(?:^|\s)--(?:all|mirror)(?=\s|$|=)/;
const PUSH_TAGS = /(?:^|\s)(?:--tags|--follow-tags)(?=\s|$)|(?:^|\s)\+?(?:[^\s:]*:)?refs\/tags\//;

export const BANS: Ban[] = [
  {
    what: "mesclar um pull request (merge)",
    test: (p) => new RegExp(W + "gh\\s+pr\\s+merge" + E).test(p)
      || new RegExp(W + "gh\\s+api\\b[^\\n]*pulls/\\d+/merge" + E).test(p)
      || /\bmergePullRequest\b|\benablePullRequestAutoMerge\b/.test(p),
  },
  {
    what: "fazer push em main/master (ou de todos os ramos)",
    test: (p) => PUSH.test(p) && (PUSH_MAIN.test(after_push(p)) || PUSH_ALL.test(after_push(p))),
  },
  {
    what: "publicar tags (um release é ordem do usuário)",
    test: (p) => PUSH.test(p) && PUSH_TAGS.test(after_push(p)),
  },
  {
    what: "reiniciar ou parar o serve",
    test: (p) => new RegExp(W + "systemctl\\b[^\\n]*\\b(?:restart|stop|start|kill|reload|try-restart|reload-or-restart)\\b[^\\n]*\\bunii").test(p)
      || new RegExp(W + "unii-restart" + E).test(p)
      || new RegExp(W + "(?:pkill|killall)\\b[^\\n]*(?:unii|Cli\\.ts|\\bbun\\b)").test(p)
      || /\bserver\.pid\b/.test(p) && new RegExp(W + "kill" + E).test(p),
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

// what follows git's push in a part (its remote and refspecs)
function after_push(p: string): string {
  const m = PUSH.exec(p);
  return m === null ? "" : p.slice(m.index + m[0].length);
}

// a command's parts: split at ;, &&, ||, |, & and newlines (a line
// continued with "\" is one), so one ban looks at one command; quotes are
// not read, so a ban named only inside a quoted string still counts
// (refused: never wrongly let through)
export function parts(command: string): string[] {
  return command.replace(/\\\r?\n/g, " ").split(/\n|;|&&|\|\||\||&/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p !== "");
}

// why a subagent's shell command is refused, or null: it does none of the
// bans
export function forbidden(command: string): string | null {
  const hit = BANS.filter((b) => parts(command).some((p) => b.test(p)));
  if (hit.length === 0) {
    return null;
  }
  return "Recusado pelo serve: subagentes não podem " + hit.map((b) => b.what).join(", nem ") + ". Essas ações são ordens do usuário à Unii. Não tente outro caminho (script, alias, variável): termine o que pode fazer e diga no relato o que falta, para a Unii decidir com o usuário.";
}
