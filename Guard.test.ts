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
];

const YES = [
  "git push -u origin feat/agentes-aninhados",
  "git push origin HEAD",
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
];

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
});
