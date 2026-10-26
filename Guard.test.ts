// Guard.test
// ==========
// `bun test Guard.test.ts`: what no subagent may do (Guard.ts, P109):
// merge, push to main, push tags, restart the serve, deploy. Refused as
// written in a command, in any of its parts; the everyday work of an
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
];

test("a word's closing ) or } and a glued redirection are cut before its refspec is read", () => {
  expect(Guard.after_push("(git push origin main)")).toBe(" origin main");
  expect(Guard.after_push("git push origin main>/dev/null 2>&1")).toBe(" origin main");
  expect(Guard.after_push("git push origin feat/x}")).toBe(" origin feat/x");
  expect(Guard.after_push("(git push origin feat/x) > main")).toBe(" origin feat/x");
  expect(Guard.after_push("git push origin feat/x 2>&1 main")).toBe(" origin feat/x main");
  expect(Guard.after_push("git push origin main&>/dev/null")).toBe(" origin main");
});

test("an & inside a redirection doesn't split a command", () => {
  expect(Guard.parts("git push origin feat/x 2>&1 main")).toEqual(["git push origin feat/x 2>&1 main"]);
  expect(Guard.parts("a &> log b")).toEqual(["a &> log b"]);
  expect(Guard.parts("a & b && c")).toEqual(["a", "b", "c"]);
});

// what the header says the guard doesn't read, fixed so a change to it is
// seen: git's other spellings of the branch, a command in a variable, a
// script (out of reach: the prompt bans them)
test("what is out of the guard's reach goes through, as its header says", () => {
  for (const c of ["git push origin HEAD~0", "git push origin HEAD^", "git push origin main^{}", "$CMD", "bash script.sh"]) {
    expect([c, Guard.forbidden(c)]).toEqual([c, null]);
  }
});

// the cost taken on purpose: a command that only writes a ban down is
// refused as if it ran it
test("a ban only written down, in quotes, is refused all the same", () => {
  expect(Guard.forbidden("echo 'git push origin main' > /tmp/x")).toContain("push em main");
  expect(Guard.forbidden("printf '%s\\n' \"gh pr merge 22\" >> notas.txt")).toContain("mesclar");
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
});

test("a command's words and what it runs, past sudo, env, timeout", () => {
  expect(Guard.words("grep -r 'pkill bun' .")).toEqual(["grep", "-r", "pkill bun", "."]);
  expect(Guard.command_of(Guard.words("FOO=1 sudo -u morum timeout -s 9 5 /usr/bin/pkill -f x"))).toEqual({ name: "pkill", args: ["-f", "x"] });
  expect(Guard.command_of(Guard.words("grep -r 'pkill bun' ."))!.name).toBe("grep");
});
