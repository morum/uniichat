// NestedRestartMark.server.test
// =============================
// `bun test NestedRestartMark.server.test.ts`: a restart Unii asked (the
// restart tool) cuts its own turn too; as the server starts, the turn
// goes on once, by the "[Restart]" message (Chat.back), not also by the
// cut turn's resume (NestedRestart.server.test.ts): one turn, not two.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import { Chat } from "./Server.ts";
import * as Tasks from "./Tasks.ts";
import { TURN } from "./View.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

const TURNS: Ask[] = [];
(AskAI as any).ask = (ask: Ask) => {
  if (ask.blocks.some((b) => b.text.startsWith("Turn: "))) {
    TURNS.push(ask);
  }
  return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "Retomado.", left: [] }) };
};
const DELIVER = Push.deliver;
const PHONE = Push.phones;
(Push as any).deliver = async () => true;
(Push as any).phones = () => {};

// the server before stopped in Unii's turn, which asked the restart: its
// mark, asked as this process started
const DIR = config.DIR + "/chat";
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(DIR + "/restart.json", JSON.stringify({ why: "teste", resume: "siga com P109", at: new Date(Date.now() - process.uptime() * 1000).toISOString(), agents: [], task: null, done: false, used: [], pid: 1 }));
const saved = Memory.saved(DIR);
fs.writeFileSync(DIR + "/view.json", JSON.stringify(saved === null ? { parts: [], size: 0, work: [TURN] } : { ...saved, work: [TURN] }));
Tasks.tasks_forget();
fs.rmSync(DIR + "/tasks.json", { force: true });
const before = Tasks.tasks_load(DIR);
const asked = Tasks.task_new(before, { origin: "chat", title: "Resumo do PR" }, "main", Date.now() - 60e3) as Tasks.Task;
Tasks.task_say(before, asked.id, "Pode resumir?", Date.now() - 30e3);
Tasks.tasks_forget();

const chat = Chat.open() as any;
// as it started: the thread still waits for Unii (its turn's end answers)
const at_start = Tasks.task_find(Tasks.tasks_load(DIR), asked.id)!;
const texts = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i)).filter((m) => m !== null).map((m) => m!.kind + ": " + m!.text);

afterAll(() => {
  fs.rmSync(DIR + "/restart.json", { force: true });
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
  Tasks.tasks_forget();
  fs.rmSync(DIR + "/tasks.json", { force: true });
});

test("a restart Unii asked goes on by its [Restart] message alone: one turn", async () => {
  await Bun.sleep(100);
  expect(TURNS.length).toBe(1);
  expect(texts().some((t) => t.startsWith("work: [Restart]") && t.includes("siga com P109"))).toBe(true);
  // nothing since this start (its first note: the restart said) resumes
  // the cut turn too (the chat's log may hold an older start's)
  const all = texts();
  const since = all.findLastIndex((t) => t.startsWith("note: Serve reiniciado (pedido às"));
  expect(since).toBeGreaterThanOrEqual(0);
  expect(all.slice(since).some((t) => t.includes("cutting " + TURN))).toBe(false);
  expect(at_start.talk).toBe("unii");
});
