// Nested.server.test
// ==================
// `bun test Nested.server.test.ts`: agents that start agents (P109). A
// subagent gets spawn, tell and stop; its agents' notes name it, their
// depth is 2, and a third level is refused; the front's cap (4) and the
// whole one (12) refuse a spawn past them; tell and stop reach only an
// agent's own; each report goes to the agent that started it, which
// waits for its agents before its own report reaches the chat; a stop
// takes the tree with it; a subagent's shell command that merges,
// pushes to main, restarts or deploys is refused; the vigia resumes a
// stalled agent once, telling its parent, then reports it stalled, and
// lets go of a call that doesn't end when stopped; two spawns at once
// can't both pass the caps. The AI is a fake whose agents' calls end only
// when the test says (or, for the deaf ones, never, even stopped).

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask, type End } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import { Chat } from "./Server.ts";
import { Tools, VIGIA } from "./Tools.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
afterAll(() => {
  fs.rmSync(config.DIR, { recursive: true, force: true });
  fs.mkdirSync(config.DIR, { recursive: true });
});

// an agent's call: what it was sent, whether stopped, how to end it
type Fake = { name: string; sent: string[]; stopped: boolean; end: (e: End) => void; ask: Ask };
const CALLS: Fake[] = [];
// agents whose calls don't end when stopped (a hung connection)
const DEAF = new Set<string>();
(AskAI as any).ask = (ask: Ask) => {
  if (!ask.agent) {
    return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "ok", left: [] }) };
  }
  const { promise, resolve } = Promise.withResolvers<End>();
  const fake: Fake = { name: ask.server.split("/").pop()!, sent: [], stopped: false, end: resolve, ask };
  CALLS.push(fake);
  return {
    send: (s: { text: string }) => fake.sent.push(s.text),
    stop: () => {
      fake.stopped = true;
      if (!DEAF.has(fake.name)) {
        resolve({ ok: false, text: "stopped", left: [] });
      }
    },
    wake: () => {},
    done: promise,
  };
};

const chat = Chat.open() as any;
const tools: Tools = chat.tools;
const call = (who: string, name: string, args: object) => Tools.call(tools, who, name, args, new AbortController().signal, "id-" + Math.random());
const last = (name: string) => CALLS.findLast((c) => c.name === name)!;
const calls = (name: string) => CALLS.filter((c) => c.name === name).length;
const finish = async (name: string, text: string) => {
  last(name).end({ ok: true, text, left: [] });
  await Bun.sleep(60);
};
const log = (name: string) => Memory.agent(tools.mem, name)!.map((r) => r.kind + ": " + r.text);
const chat_texts = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i)).filter((m) => m !== null).map((m) => m!.kind + ": " + m!.text);
const started = (text: string) => [...text.matchAll(/\b([A-Z][a-z]+[A-Z][a-z]+)\b/g)].map((m) => m[1] ?? "").filter((n) => tools.agents.has(n));
const first = (names: string[]): string => {
  const n = names[0];
  if (n === undefined) {
    throw new Error("no agent started");
  }
  return n;
};

let C = "";
let K1 = "";
let K2 = "";

test("a subagent gets spawn, tell and stop; Unii's tools stay Unii's", async () => {
  const out = await call("main", "spawn", { tasks: ["coordene"], labels: ["p109-coordenador"] });
  C = first(started(out.text));
  const listed = await Tools.answer(tools, C, "tools/list", {}, new AbortController().signal, "x") as { tools: { name: string }[] };
  const names = listed.tools.map((t) => t.name);
  expect(names).toContain("spawn");
  expect(names).toContain("tell");
  expect(names).toContain("stop");
  expect(names).not.toContain("restart");
  expect(names).not.toContain("task_edit");
  expect(names).not.toContain("schedule");
  expect(last(C).ask.system).toContain("What no subagent does");
});

test("a coordinator starts 2 agents: their notes name it, depth 2, names and labels show it", async () => {
  const out = await call(C, "spawn", { tasks: ["parte A", "parte B"], labels: ["p109-a", "p109-b"] });
  expect(out.fail).toBe(false);
  const two = started(out.text).filter((n) => n !== C);
  K1 = first(two);
  K2 = first(two.slice(1));
  expect(log(K1)[0]).toBe("note: subagent, child of " + C + ", labeled p109-a");
  expect(Tools.depth(tools, K1)).toBe(2);
  expect(Tools.depth(tools, C)).toBe(1);
  expect(Tools.named(tools, K1)).toBe(K1 + " (p109-a, filho de " + C + ")");
  expect(Tools.shown(tools)[K1]).toBe("p109-a ← p109-coordenador");
  expect(Tools.at_work(tools).text).toContain(K2 + " (p109-b, filho de " + C + ")");
  // read back from its note as the server starts (a restart)
  expect(Tools.parents(tools.mem).get(K2)).toBe(C);
});

test("a third level is refused, with a clear message", async () => {
  const out = await call(K1, "spawn", { tasks: ["neto"], labels: ["p109-neto"] });
  expect(out.fail).toBe(true);
  expect(out.text).toContain("profundidade 3, e o limite é 2");
  expect(calls("neto")).toBe(0);
});

test("the front's cap: 4 at work under one agent of Unii's", async () => {
  const many = await call(C, "spawn", { tasks: ["c", "d", "e"] });
  expect(many.fail).toBe(true);
  expect(many.text).toContain("teto por frente é 4; cabem 2");
  const two = await call(C, "spawn", { tasks: ["c", "d"] });
  expect(two.fail).toBe(false);
  const extra = started(two.text).filter((n) => n !== C);
  expect((await call(C, "spawn", { tasks: ["f"] })).text).toContain("cabem 0");
  // stopped by the coordinator (its own): the front has room again
  for (const n of extra) {
    expect((await call(C, "stop", { name: n })).text).toStartWith("Stopped " + n);
  }
  await Bun.sleep(60);
  expect(Tools.descendants(tools, C).filter(Tools.active).map((a) => a.name).sort()).toEqual([K1, K2].sort());
});

test("the whole cap: 12 at work in all, Unii's spawns too", async () => {
  // C, K1, K2 at work: 9 more fit, not 10
  const no = await call("main", "spawn", { tasks: Array.from({ length: 10 }, (_, i) => "t" + i) });
  expect(no.fail).toBe(true);
  expect(no.text).toContain("teto total é 12; cabem 9");
});

test("tell and stop reach only an agent's own", async () => {
  const other = first(started((await call("main", "spawn", { tasks: ["outra frente"] })).text));
  const tell = await call(C, "tell", { name: other, message: "oi" });
  expect(tell.fail).toBe(true);
  expect(tell.text).toContain("não foi criado por você");
  expect((await call(K1, "stop", { name: K2 })).fail).toBe(true);
  expect((await call(C, "tell", { name: K1, message: "foque em X" })).fail).toBe(false);
  expect(last(K1).sent).toContain("foque em X");
  expect((await call("main", "stop", { name: other })).text).toStartWith("Stopped " + other);
});

test("a subagent's merge, push to main, restart or deploy is refused before any device runs it", async () => {
  for (const command of ["gh pr merge 22 --admin", "git push origin main", "systemctl --user restart unii-serve", "terraform apply"]) {
    const out = await call(K2, "shell", { device: "nenhum", command });
    expect(out.fail).toBe(true);
    expect(out.text).toStartWith("Recusado pelo serve: subagentes não podem");
  }
  // quoted, by its path, or killing the serve by name (ShinyRhino)
  for (const command of ["git push origin \"HEAD:main\"", "/usr/bin/gh pr merge 22", "curl -X PUT https://api.github.com/repos/a/b/pulls/1/merge", "git push origin HEAD", "pkill -f bun"]) {
    expect((await call(K2, "shell", { device: "nenhum", command })).text).toStartWith("Recusado pelo serve: subagentes não podem");
  }
  for (const command of ["grep -r 'pkill bun' .", "pkill -f 'bun test'", "git push origin HEAD:feat/x"]) {
    expect((await call(K2, "shell", { device: "nenhum", command })).text).toStartWith("No device nenhum");
  }
  // anything else reaches the device check
  expect((await call(K2, "shell", { device: "nenhum", command: "git push -u origin feat/x" })).text).toStartWith("No device nenhum");
  // Unii's own commands aren't the guard's
  expect((await call("main", "shell", { device: "nenhum", command: "gh pr merge 22" })).text).toStartWith("No device nenhum");
});

test("each report goes to the agent that started it, which waits for its agents before its own", async () => {
  const before = chat_texts().length;
  await finish(C, "Disparei A e B; espero os relatos.");
  expect(tools.agents.get(C)!.waiting).toBe(true);
  expect(Tools.at_work(tools).text).toContain("Waiting for agents they started: " + C);
  expect(chat_texts().slice(before).some((t) => t.includes("[" + C + "]"))).toBe(false);
  // K1 reports: to C, which wakes with it
  await finish(K1, "A feita: 3 arquivos.");
  expect(log(C).some((t) => t.startsWith("work: [" + K1 + "]") && t.includes("A feita"))).toBe(true);
  expect(chat_texts().slice(before).some((t) => t.includes("A feita"))).toBe(false);
  expect(calls(C)).toBe(2);
  // C ends again, K2 still at work: waits again
  await finish(C, "A ok; falta B.");
  expect(tools.agents.get(C)!.waiting).toBe(true);
  // K2 reports while C waits: C wakes, ends, and its report reaches the chat
  await finish(K2, "B feita.");
  expect(calls(C)).toBe(3);
  await finish(C, "Tudo pronto: A e B.");
  await Bun.sleep(60);
  const said = chat_texts().slice(before).filter((t) => t.startsWith("work: [" + C + "]"));
  expect(said.length).toBe(1);
  expect(said[0]).toContain("Disparei A e B");
  expect(said[0]).toContain("Tudo pronto: A e B.");
  expect(tools.agents.get(C)!.waiting).toBe(false);
});

test("a stop takes the agents it started with it", async () => {
  const c2 = first(started((await call("main", "spawn", { tasks: ["coordene 2"] })).text));
  const kids = started((await call(c2, "spawn", { tasks: ["x", "y"] })).text).filter((n) => n !== c2);
  expect(kids.length).toBe(2);
  const out = await call("main", "stop", { name: c2, why: "teste" });
  expect(out.text).toContain("Stopped " + c2 + ". With it: ");
  for (const k of kids) {
    expect(last(k).stopped).toBe(true);
  }
  await Bun.sleep(60);
  expect(Tools.descendants(tools, c2).filter(Tools.active)).toEqual([]);
});

test("the vigia: a stalled agent is resumed once, its parent told; stalled again, it's reported stalled", async () => {
  const c3 = first(started((await call("main", "spawn", { tasks: ["coordene 3"] })).text));
  const k = first(started((await call(c3, "spawn", { tasks: ["vai travar"] })).text).filter((n) => n !== c3));
  const agent = tools.agents.get(k)!;
  const was = VIGIA.idle;
  VIGIA.idle = 1000;
  try {
    // a tool running is no stall
    agent.seen = Date.now() - 5000;
    agent.calls = { x: "shell: sleep 900" };
    Tools.vigia(tools, Date.now());
    expect(calls(k)).toBe(1);
    agent.calls = {};
    // stalled: resumed once, told so; its parent (at work) told
    Tools.vigia(tools, Date.now());
    await Bun.sleep(60);
    expect(calls(k)).toBe(2);
    expect(log(k).some((t) => t.startsWith("user: [Vigia]"))).toBe(true);
    expect(log(c3).some((t) => t.startsWith("note: [Vigia] " + k) && t.includes("retomado uma vez"))).toBe(true);
    expect(last(c3).sent.some((t) => t.includes("retomado uma vez"))).toBe(true);
    // stalled again: stopped, reported stalled to its parent (not as a stop)
    agent.seen = Date.now() - 5000;
    Tools.vigia(tools, Date.now());
    await Bun.sleep(80);
    expect(last(k).stopped).toBe(true);
    expect(log(c3).some((t) => t.startsWith("work: [" + k + "]") && t.includes("Travado"))).toBe(true);
    expect(last(c3).sent.some((t) => t.includes("Travado"))).toBe(true);
    // Unii's own agent stalled: a note in the chat
    const u = tools.agents.get(c3)!;
    u.seen = Date.now() - 5000;
    Tools.vigia(tools, Date.now());
    await Bun.sleep(60);
    expect(chat_texts().some((t) => t.startsWith("note: [Vigia] " + c3))).toBe(true);
  } finally {
    VIGIA.idle = was;
  }
  await call("main", "stop", { name: c3 });
});

test("the vigia lets go of a call that doesn't end when it resumes it: reported stalled, its place freed", async () => {
  const c5 = first(started((await call("main", "spawn", { tasks: ["coordene 5"] })).text));
  const k = first(started((await call(c5, "spawn", { tasks: ["conexão pendurada"] })).text).filter((n) => n !== c5));
  const agent = tools.agents.get(k)!;
  const was = { ...VIGIA };
  VIGIA.idle = 1000;
  VIGIA.grace = 1000;
  DEAF.add(k);
  try {
    const t0 = Date.now();
    // its parent shows life all along (the vigia leaves it be)
    tools.agents.get(c5)!.seen = t0 + 60_000;
    agent.seen = t0 - 5000;
    Tools.vigia(tools, t0);
    expect(last(k).stopped).toBe(true);
    expect(agent.reviving).toBe(true);
    // within the grace: still waited for
    Tools.vigia(tools, t0 + 500);
    expect(agent.call).not.toBe(null);
    // past it: let go, reported stalled to its parent (not as a stop)
    Tools.vigia(tools, t0 + 1500);
    await Bun.sleep(60);
    expect(agent.call).toBe(null);
    expect(Tools.active(agent)).toBe(false);
    expect(log(c5).some((t) => t.startsWith("note: [Vigia] " + k) && t.includes("não encerrou"))).toBe(true);
    expect(log(c5).some((t) => t.startsWith("work: [" + k + "]") && t.includes("Travado: a chamada não encerrou"))).toBe(true);
    expect(last(c5).sent.some((t) => t.includes("Travado: a chamada não encerrou"))).toBe(true);
    // the call ending late says nothing more, and starts nothing
    const reports = log(c5).filter((t) => t.startsWith("work: [" + k + "]")).length;
    last(k).end({ ok: true, text: "tarde demais", left: [] });
    await Bun.sleep(60);
    expect(log(c5).filter((t) => t.startsWith("work: [" + k + "]")).length).toBe(reports);
    expect(calls(k)).toBe(1);
  } finally {
    Object.assign(VIGIA, was);
    DEAF.delete(k);
  }
  await call("main", "stop", { name: c5 });
});

test("the vigia lets go of a call that doesn't end when it's stopped as stalled again", async () => {
  const k = first(started((await call("main", "spawn", { tasks: ["trava duas vezes"] })).text));
  const agent = tools.agents.get(k)!;
  const was = { ...VIGIA };
  VIGIA.idle = 1000;
  VIGIA.grace = 1000;
  try {
    const t0 = Date.now();
    agent.seen = t0 - 5000;
    Tools.vigia(tools, t0);
    await Bun.sleep(60);
    expect(calls(k)).toBe(2);
    DEAF.add(k);
    agent.seen = t0 - 5000;
    Tools.vigia(tools, t0 + 10);
    expect(agent.stuck).toBe(true);
    expect(agent.call).not.toBe(null);
    Tools.vigia(tools, t0 + 1100);
    await Bun.sleep(60);
    expect(agent.call).toBe(null);
    expect(chat_texts().some((t) => t.startsWith("work: [" + k + "]") && t.includes("Travado: a chamada não encerrou"))).toBe(true);
  } finally {
    Object.assign(VIGIA, was);
    DEAF.delete(k);
  }
});

test("two spawns at once can't both pass the front's cap", async () => {
  const c6 = first(started((await call("main", "spawn", { tasks: ["coordene 6"] })).text));
  const [a, b] = await Promise.all([call(c6, "spawn", { tasks: ["r1", "r2", "r3"] }), call(c6, "spawn", { tasks: ["r4", "r5", "r6"] })]);
  const outs = [a!, b!];
  expect(outs.filter((o) => o.fail).length).toBe(1);
  expect(outs.find((o) => o.fail)!.text).toContain("teto por frente é 4; cabem 1");
  expect(Tools.descendants(tools, c6).filter(Tools.active).length).toBe(3);
  await call("main", "stop", { name: c6 });
});
