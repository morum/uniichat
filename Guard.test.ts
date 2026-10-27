// Guard.test
// ==========
// `bun test Guard.test.ts`: what no subagent may do (Guard.ts, P109):
// merge, push to main, push tags, restart the serve, deploy. Refused as
// bash would run a command, in any of its parts; the everyday work of an
// agent (a branch's push, a commit whose message says "main", a test
// serve on another port) goes through.

import { expect, test } from "bun:test";
import * as Guard from "./Guard.ts";

const NO = [
  "gh pr merge 22 --admin --merge",
  "cd repo && gh pr merge https://github.com/morum/uniichat/pull/22 --squash",
  "gh api -X PUT repos/Numih/apoio/pulls/580/merge",
  "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
  "git push origin main",
  "git push -f origin HEAD:main",
  "git -C ~/x push origin +main",
  "git push origin feat/x:refs/heads/master",
  "git push --all origin",
  "git push --mirror",
  "git push origin --tags",
  "git push origin refs/tags/server/v1.0.0",
  "systemctl --user restart unii-serve",
  "systemctl --user stop unii-serve.service",
  "unii-restart",
  "pkill -f 'Cli.ts serve'",
  "kill $(cat ~/.unii-arteeh/server.pid)",
  "terraform apply -auto-approve",
  "cd infra && terraform -chdir=hom apply",
  "gcloud run deploy apoio --image x",
  "kubectl apply -f k.yaml",
  "helm upgrade x y",
  "gh workflow run deploy.yml",
  "curl -X POST https://app.terraform.io/api/v2/runs/run-abc/actions/apply",
  "echo ok\ngit push origin main",
  "true; git push origin main 2>&1 | tail -3",
  // quoted, or by its path (ShinyRhino, P109)
  "git push origin \"HEAD:main\"",
  "git push 'origin' 'main'",
  "'git' push origin main",
  "/usr/bin/git push origin main",
  "/usr/bin/gh pr merge 22 --admin",
  "~/bin/gh pr merge 22",
  "curl -X PUT -H 'Authorization: token x' https://api.github.com/repos/Numih/apoio/pulls/580/merge",
  "curl -sS --request PUT https://api.github.com/repos/a/b/pulls/3/merge -d '{}'",
  "curl -XPUT https://api.github.com/repos/a/b/pulls/3/merge",
  // where it goes left to git: the branch, or its upstream, may be main
  "git push",
  "git push -u origin",
  "git push origin HEAD",
  "git push -u origin HEAD",
  "git push origin @",
  "git push origin $(git branch --show-current)",
  "git push origin HEAD:$BRANCH",
  "cd repo && git push 2>&1 | tail -3",
  // the serve killed by name or command line, however it's run
  "pkill bun",
  "pkill -f bun",
  "pkill -9 -f 'Cli.ts serve'",
  "pkill -f uniichat",
  "pkill -u morum",
  "sudo -u morum pkill bun",
  "/usr/bin/pkill bun",
  "timeout 5 pkill -f Cli.ts",
  "bash -c 'pkill -f Cli.ts'",
  "bash -lc \"pkill bun\"",
  "echo $(pkill bun)",
  "killall bun",
  "killall -r 'b.n'",
  "kill $(pgrep -f 'Cli.ts serve')",
  "kill $(pgrep -f Cli.ts | head -1)",
  "pgrep -f uniichat | xargs kill",
  "kill -9 `pidof bun`",
  "pkill -f \"$PAT\"",
  // in a subshell or group, or a redirection glued on (GreenPepper, P109)
  "(git push origin main)",
  "(cd x && git push origin main)",
  "cd x && (git push origin main)",
  "git push origin main>/dev/null",
  "git push origin main>>log 2>&1",
  "{ git push origin main;}",
  "(git push origin HEAD:master)",
  "(git push origin HEAD)",
  "git push origin HEAD>/dev/null",
  "(git push --tags)",
  // a backslash taken out as a quote is; an & inside a redirection is no
  // split, so what follows it is still the push's (HoneyPig, P109)
  "git push origin main\\",
  "git push origin ma\\in",
  "git pu\\sh origin main",
  "git push origin feat/x \\> main",
  "git push origin feat/x 2>&1 main",
  "git push origin feat/x &> log main",
  "git push origin feat/x >& log main",
  "git push origin main&>/dev/null",
  "git push origin > x main",
  "git push origin feat/x '>' main",
  "pkill bun>/dev/null",
  "pkill bun&>/dev/null",
  "pkill -f Cli.ts 2>&1 >/dev/null",
  // a closed descriptor (>&-, <&-) takes no target; >-, <- and &>- name a
  // file "-": main is a refspec all the same (NavyGazelle 1, P109)
  "git push origin feat/x >&- main",
  "git push origin feat/x 2>&- main",
  "git push origin feat/x <&- main",
  "git push origin feat/x 0<&- main",
  "git push origin feat/x &>- main",
  "git push origin feat/x >- main",
  "git push origin feat/x <- main",
  "git push origin feat/x >&-main",
  "git push origin feat/x>&-main",
  "(git push origin feat/x >&- main)",
  "git push origin feat/x {fd}>&- main",
  "killall >&- bun",
  "killall -9 >- bun",
  "pkill >&- bun",
  // a backslash is taken out of pkill and killall too (NavyGazelle 2)
  "\\pkill bun",
  "pk\\ill bun",
  "pkill bu\\n",
  "kill\\all bun",
  "\\pkill -f 'Cli.ts serve'",
  "pk\\ill -9 bun",
  // >| is a redirection, not a pipe (NavyGazelle 3)
  "git push origin feat/x >|x main",
  // a line continued inside a word or an operator (NavyGazelle 4)
  "git push origin ma\\\nin",
  "git push origin HEAD:ma\\\nin",
  "git pu\\\nsh origin main",
  "pk\\\nill bun",
  "git push origin feat/x 2>\\\n&1 main",
  "git push origin feat/x >\\\n&- main",
  // braces and ${x:-...}, which bash expands (NavyGazelle 5)
  "git push origin {main,x}",
  "git push origin {a,main}",
  "git push origin {main,}",
  "git push origin ma{in,}",
  "git push origin {l..n}ain",
  "git push origin ${x:-main}",
  "pkill {bun,x}",
  // a redirection before the command, or between git and push
  // (NavyGazelle 6)
  "git 2>&1 push origin main",
  "git >x push origin main",
  "gh >x pr merge 1",
  "gh pr 2>&1 merge 1",
  ">x pkill bun",
  "2>&1 sudo pkill bun",
  // an escaped ; & | is a word, not a split (NavyGazelle 7)
  "git push origin feat/x \\; main",
  "git push origin feat/x \\& main",
  "git push origin feat/x \\| main",
  // git's option values with a space (NavyGazelle 8)
  "git -C 'a b' push origin main",
  "git -c 'a b' push origin main",
  "git -c a=b\\ c push origin main",
  "git --git-dir .git push origin main",
  // pkill in a function's body, a case's branch, a subshell, an if
  // (NavyGazelle 9)
  "f() { pkill bun; }; f",
  "case a in a) pkill bun;; esac",
  "(killall bun)",
  "if pkill bun; then :; fi",
  "while pkill bun; do :; done",
  // a comment where the refspec would be: a push that names none
  // (NavyGazelle 10)
  "git push origin #main",
  // a heredoc's body read apart: a ' in it opens nothing past it
  "cat <<EOF\ndon't\nEOF\npkill bun",
  "bash <<EOF\ngit push origin main\nEOF",
  "env -S 'pkill bun'",
  "git push --branches origin",
  "git push origin $'ma\\x69n'",
  "git push origin \"ma\"in",
  "git push origin m''ain",
  "git push origin :",
  "git push origin +HEAD:",
  "echo $(echo ')'; pkill bun)",
];

const YES = [
  "git push -u origin feat/agentes-aninhados",
  "git push origin HEAD:feat/agentes-aninhados",
  "git push -u origin feat/x 2>&1 | tail -3",
  "git push --force-with-lease origin +HEAD:refs/heads/feat/x",
  "git push origin feat/main-fix",
  "git push origin main:feat/x",
  "git commit -m 'Corrige push em main e merge do PR'",
  "gh pr view 22 --json state,mergeable",
  "gh pr create --draft --title x",
  "git merge origin/main",
  "git fetch origin main && git rebase origin/main",
  "UNII_DIR=/tmp/x bun Cli.ts serve --port 8790 &",
  "terraform plan -out p",
  "gcloud run services describe apoio",
  "kubectl get pods",
  "bun test && bunx tsc --noEmit",
  "kill 12345",
  // ShinyRhino's: kept going through
  "git commit -m 'merge main'",
  "gh pr view 22",
  "terraform plan",
  // pkill's words as a grep's, a test runner killed, other programs
  "grep -r 'pkill bun' .",
  "grep -rn \"pkill -f bun\" README.md",
  "pkill -f 'bun test'",
  "pkill -f 'Cli.ts serve --port 8793'",
  "killall node",
  "pgrep -f 'bun test'",
  "curl -s https://api.github.com/repos/a/b/pulls/3",
  "gh api repos/a/b/pulls/3 --jq .mergeable",
  // a branch's push in a subshell or with a redirection glued on
  "(git push origin feat/x)",
  "(cd x && git push -u origin feat/main-fix)",
  "git push origin HEAD:feat/x>/dev/null",
  "git push origin feat/x 2>&1",
  // a redirection's target is a file, not a refspec (HoneyPig, P109)
  "(git push origin feat/x) > main",
  "git push origin feat/x > main",
  "git push origin feat/x 2> main",
  "git push origin feat/x &> main",
  "git push origin feat/x >main",
  "git push -u origin feat/x 2>&1 | tail -3 &",
  // read as bash reads them, these don't do what they seem to say
  // (NavyGazelle 11): a pattern quoted in a subshell, an option's value,
  // a comment, a redirection's target, braces giving other branches
  "(pkill -f 'bun test')",
  "( pkill -f 'bun test' )",
  "git push -o main origin feat/x",
  "git push --push-option main origin feat/x",
  "git push -o ci.skip origin feat/x",
  "git push origin feat/x # main branch untouched",
  "git push origin feat/x # nada em main",
  "git push origin feat/x >&2",
  "git push origin feat/x > '>'",
  "git push origin {feat/x,feat/y}",
  "git push origin feat/x\\ main",
  "pkill -f 'bun test' >/dev/null 2>&1",
  "cat <<'EOF'\ndon't\nEOF",
  "grep -n 'main' README.md && git push origin feat/x",
  "man pkill",
];

test("a command is read as bash reads it: operators, quotes, backslashes, comments", () => {
  const w = (c: string) => Guard.lex(c).map((x) => x.words);
  expect(w("a; b && c || d | e |& f & g\nh")).toEqual([["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]]);
  expect(w("case a in a) b;; esac")).toEqual([["case", "a", "in", "a"], ["b"], ["esac"]]);
  expect(w("f() { b; }; f")).toEqual([["f"], ["{", "b"], ["}"], ["f"]]);
  expect(w("a \\; b \\& c \\| d")).toEqual([["a", ";", "b", "&", "c", "|", "d"]]);
  expect(w("'a b' \"c d\" e\\ f $'g\\x68' i''j \\k")).toEqual([["a b", "c d", "e f", "gh", "ij", "k"]]);
  expect(w("ma\\\nin pu\\\nsh")).toEqual([["main", "push"]]);
  expect(w("a # b ; c\nd")).toEqual([["a"], ["d"]]);
  expect(w("a#b '#c'")).toEqual([["a#b", "#c"]]);
  expect(w("x\\")).toEqual([["x"]]);
  expect(w("a 'b c\nd; e")).toEqual([["a", "b c\nd; e"]]);
  expect(w("a;; b |& c && d")).toEqual([["a"], ["b"], ["c"], ["d"]]);
  expect(w("\"a\\\"b\\$c\\x\" $\"d e\" a\rb")).toEqual([["a\"b$c\\x", "d e", "a", "b"]]);
});

test("each redirection is dropped with its target, and >&- and <&- have none", () => {
  const w = (c: string) => Guard.lex(c).map((x) => [x.words, x.targets]);
  expect(w("a > m b >m c 2>&1 d &>>l e")).toEqual([[["a", "b", "c", "d", "e"], ["m", "m", "1", "l"]]]);
  expect(w("a >|x b <>y c {fd}>z d 10>w e <<<v")).toEqual([[["a", "b", "c", "d", "e"], ["x", "y", "z", "w", "v"]]]);
  expect(w("a >&- b 2>&- c <&- d >&-e")).toEqual([[["a", "b", "c", "d", "e"], []]]);
  expect(w("a >- b &>- c")).toEqual([[["a", "b", "c"], ["-", "-"]]]);
  expect(w("a 2>\\\n&1 b >\\\n&- c")).toEqual([[["a", "b", "c"], ["1"]]]);
  expect(w("a2>x b")).toEqual([[["a2", "b"], ["x"]]]);
  expect(w("a '>' b \\> c")).toEqual([[["a", ">", "b", ">", "c"], []]]);
  expect(w(">x a")).toEqual([[["a"], ["x"]]]);
});

test("braces expand as bash's, and what it substitutes is kept as a script", () => {
  const w = (c: string) => Guard.lex(c)[0]!.words;
  expect(w("{main,x} ma{in,} {a..c} {main} main^{} '{a,b}' \\{a,b} ${x:-{a,b}}")).toEqual(["main", "x", "main", "ma", "a", "b", "c", "{main}", "main^{}", "{a,b}", "{a,b}", "${x:-{a,b}}"]);
  expect(w("{x,y}{1,2}")).toEqual(["x1", "x2", "y1", "y2"]);
  const s = Guard.lex("echo $(pgrep bun | head -1) `id -u` <(ls) \"$(date)\"")[0]!;
  expect(s.subs).toEqual(["pgrep bun | head -1", "id -u", "ls", "date"]);
  expect(s.words[1]).toBe("$(pgrep bun | head -1)");
  expect(Guard.lex("echo $(echo ')' \")\"; pkill bun) `echo \\` x`")[0]!.subs).toEqual(["echo ')' \")\"; pkill bun", "echo ` x"]);
});

test("a heredoc's body is read apart from what follows it", () => {
  const l = Guard.lex("cat <<EOF >x\ndon't\nEOF\npkill bun");
  expect(l.map((x) => [x.words, x.subs])).toEqual([[["cat"], []], [[], ["don't\n"]], [["pkill", "bun"], []]]);
  expect(Guard.lex("cat <<-E\n\tx\n\tE\ny")[2]!.words).toEqual(["y"]);
});

test("a push's refspecs, past its options and their values", () => {
  expect(Guard.pushes(["git", "-C", "a b", "push", "-o", "main", "origin", "feat/x"])).toEqual([{ specs: ["feat/x"], all: false, tags: false }]);
  expect(Guard.pushes(["git", "push", "--", "origin", "main"])).toEqual([{ specs: ["main"], all: false, tags: false }]);
  expect(Guard.pushes(["git", "push", "--", "origin", "--tags"])).toEqual([{ specs: ["--tags"], all: false, tags: false }]);
  expect(Guard.pushes(["git", "push", "--repo=origin", "main"])).toEqual([{ specs: ["main"], all: false, tags: false }]);
  expect(Guard.pushes(["git", "push", "--branches", "--follow-tags"])).toEqual([{ specs: [], all: true, tags: true }]);
  expect(Guard.pushes(["mise", "exec", "--", "git", "push", "origin", "x"])).toEqual([{ specs: ["x"], all: false, tags: false }]);
  expect(Guard.pushes(["git", "log", "push"])).toEqual([]);
});

test("a command nested too deep to read is refused, one less deep is read", () => {
  const nest = (k: number, c: string) => "echo " + "$(echo ".repeat(k) + c + ")".repeat(k);
  expect(Guard.forbidden(nest(5, "git push origin main"))).toContain("push em main");
  expect(Guard.forbidden(nest(5, "ls"))).toBeNull();
  expect(Guard.forbidden(nest(6, "ls"))).toContain("6 ou mais níveis");
  expect(Guard.forbidden("cat <<EOF\n{\"a\": \"b 'c d' e\", \"x\": \"$(date '+%F %T')\"}\nEOF")).toBeNull();
});

// what the header says the guard doesn't read, fixed so a change to it is
// seen: git's other spellings of the branch, a command in a variable, a
// script, an alias, a runner it doesn't know (out of reach: the prompt
// bans them)
test("what is out of the guard's reach goes through, as its header says", () => {
  for (const c of ["git push origin HEAD~0", "git push origin HEAD^", "git push origin main^{}", "git push origin main@{0}", "$CMD", "$GIT push origin main", "bash script.sh",
    "echo 'pkill bun' | bash", "git -c alias.p=push p origin main", "mise exec -- pkill bun"]) {
    expect([c, Guard.forbidden(c)]).toEqual([c, null]);
  }
});

// the cost taken on purpose: a command that only writes a ban down is
// refused as if it ran it
test("a ban only written down, in quotes, is refused all the same", () => {
  expect(Guard.forbidden("echo 'git push origin main' > /tmp/x")).toContain("push em main");
  expect(Guard.forbidden("printf '%s\\n' \"gh pr merge 22\" >> notas.txt")).toContain("mesclar");
  expect(Guard.forbidden("cat > x.md <<EOF\ngit push origin main\nEOF")).toContain("push em main");
  expect(Guard.forbidden("echo git push origin main")).toContain("push em main");
  expect(Guard.forbidden("git commit -m 'fix git push'")).toContain("sem dizer para qual ramo");
});

test("each ban is refused, said in the user's language, whatever part of the command holds it", () => {
  for (const c of NO) {
    const no = Guard.forbidden(c);
    expect(no === null ? "passou: " + c : no).toStartWith("Recusado pelo serve: subagentes não podem ");
  }
});

test("everyday work goes through", () => {
  for (const c of YES) {
    expect([c, Guard.forbidden(c)]).toEqual([c, null]);
  }
});

test("the refusal names what it bans", () => {
  expect(Guard.forbidden("gh pr merge 1")).toContain("mesclar um pull request");
  expect(Guard.forbidden("git push origin main")).toContain("push em main");
  expect(Guard.forbidden("systemctl --user restart unii-serve")).toContain("reiniciar ou parar o serve");
  expect(Guard.forbidden("terraform apply")).toContain("deploy");
  expect(Guard.forbidden("git push --tags")).toContain("tags");
  expect(Guard.forbidden("git push origin HEAD")).toContain("sem dizer para qual ramo");
  expect(Guard.forbidden("git push origin HEAD")).toContain("HEAD:feat/x");
  expect(Guard.forbidden("pkill bun")).toContain("reiniciar ou parar o serve");
  expect(Guard.forbidden("git push origin #main")).toContain("sem dizer para qual ramo");
  expect(Guard.forbidden("git push origin feat/x >&- main")).toContain("push em main");
});

test("a command's words and what it runs, past sudo, env, timeout, if", () => {
  const w = (c: string) => Guard.lex(c)[0]!.words;
  expect(w("grep -r 'pkill bun' .")).toEqual(["grep", "-r", "pkill bun", "."]);
  expect(Guard.command_of(w("FOO=1 sudo -u morum timeout -s 9 5 /usr/bin/pkill -f x"))).toEqual({ name: "pkill", args: ["-f", "x"] });
  expect(Guard.command_of(w("grep -r 'pkill bun' ."))!.name).toBe("grep");
  expect(Guard.command_of(w("if ! pkill bun"))!.name).toBe("pkill");
  expect(Guard.command_of(w("{ coproc pkill bun"))!.name).toBe("pkill");
});
