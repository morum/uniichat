// NestedRestart.server.test
// =========================
// `bun test NestedRestart.server.test.ts`: Unii's turn cut by a restart
// (not one Unii asked) goes on as the server starts (ShinyRhino, P109):
// the server reads the turn among the work the server before left before
// anything here saves what runs now (Chat.timed made it none, so it was
// never resumed). The turn is asked again, said in the chat, and a
// task's thread that waited for Unii is left to that turn's end, not
// given back as unanswered. The AI is a fake that records each turn.

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

// the server before stopped in Unii's turn (a crash, systemd, the user),
// with the user's message in a task's thread waiting for it
const DIR = config.DIR + "/chat";
fs.mkdirSync(DIR, { recursive: true });
fs.rmSync(DIR + "/restart.json", { force: true });
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
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
  Tasks.tasks_forget();
  fs.rmSync(DIR + "/tasks.json", { force: true });
});

test("Unii's turn cut by a restart is resumed as the server starts, said so; the threads that wait for it are left to it", async () => {
  await Bun.sleep(100);
  expect(TURNS.length).toBe(1);
  expect(texts().some((t) => t.startsWith("note: The server restarted, cutting " + TURN))).toBe(true);
  // its thread wasn't given back as "Unii não respondeu" as the server
  // started (Chat.orphans, with the turn to come)
  expect(at_start.talk).toBe("unii");
  expect(at_start.thread.some((m) => m.who === "unii" && m.none === true)).toBe(false);
});
