// Resume.server.test
// ==================
// `bun test Resume.server.test.ts`: Unii's turn cut by a stop (SIGTERM
// in the middle of a turn) goes on as the server starts again. The
// server before left view.json with work ["Unii's turn"]; Chat.open
// takes that work as loaded, before anything saves what runs now
// (Chat.timed saves work [] at once), so the note "The server
// restarted…" is said and a turn is asked. Before the fix, the work
// read by Chat.resume was the one Chat.timed had just saved: [], so no
// note and no turn, and a task's thread that waited for Unii was given
// back at once as if no turn came (Chat.orphans: "Unii não
// respondeu"); now it's left to the resumed turn's end (Chat.talked).
// An agent cut: ResumeAgent.server.test.ts. The AI is a fake that
// answers at once; the chat's dir is the run's.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Disk } from "./Disk.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import { Chat } from "./Server.ts";
import * as Deps from "./TaskDeps.ts";
import * as Tasks from "./Tasks.ts";
import { Tools } from "./Tools.ts";
import { TURN } from "./View.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

const ASKED: Ask[] = [];
(AskAI as any).ask = (ask: Ask) => {
  if (ask.blocks.some((b) => b.text.startsWith("Turn: "))) {
    ASKED.push(ask);
  }
  return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "", left: [] }) };
};
const DELIVER = Push.deliver;
const PHONE = Push.phones;
(Push as any).deliver = async () => true;
(Push as any).phones = () => {};

// the chat as the server before left it, cut in Unii's turn: view.json
// says work ["Unii's turn"], no restart asked (restart.json absent), and
// a task's thread waits for Unii (the user wrote there)
const DIR = config.DIR + "/chat";
fs.mkdirSync(DIR, { recursive: true });
fs.rmSync(DIR + "/restart.json", { force: true });
if (Memory.saved(DIR) === null) {
  Memory.load(DIR, (() => {}) as any);
}
fs.writeFileSync(DIR + "/view.json", JSON.stringify({ ...Memory.saved(DIR)!, work: [TURN], timers: [] }));
Tasks.tasks_forget();
fs.rmSync(DIR + "/tasks.json", { force: true });
const T0 = Date.now() - 20 * 60e3;
const s0 = Tasks.tasks_load(DIR);
const waits = Tasks.task_new(s0, { origin: "chat", title: "Aprovar o PR", choices: ["Mesclar", "Corrigir antes"] }, "main", T0) as Tasks.Task;
Tasks.task_say(s0, waits.id, "Pode resumir?", T0 + 60e3);
expect(Tasks.task_find(s0, waits.id)!.talk).toBe("unii");
Tasks.tasks_forget();
const SAID = Tools.restarted([TURN]);
const said = (mem: Memory) => {
  const found: number[] = [];
  for (let i = 0; i < mem.count; i++) {
    const m = Memory.message(mem, i);
    if (m?.kind === "note" && m.text === SAID) {
      found.push(i);
    }
  }
  return found;
};

const chat = Chat.open() as any;
const BEFORE = chat.mem.count;
// the thread as Chat.open left it, before the resumed turn's end
// (Chat.talked) answers it
const AT_OPEN = structuredClone(Tasks.task_find(Tasks.tasks_load(DIR), waits.id)!);

// the last writes synced before the run's dir is removed (TestSetup.ts)
afterAll(async () => {
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
  Tasks.tasks_forget();
  fs.rmSync(DIR + "/tasks.json", { force: true });
  await Disk.synced();
});

test("a turn cut by a stop: the server starts, says it restarted in a note and asks a turn", async () => {
  for (let i = 0; i < 50 && ASKED.length === 0; i++) {
    await Bun.sleep(20);
  }
  const notes = said(chat.mem);
  expect(notes.length).toBe(1);
  expect(notes[0]).toBe(BEFORE - 1);
  expect(ASKED.length).toBe(1);
  expect(ASKED[0].blocks.some((b) => b.text.startsWith("Turn: ") && b.text.includes(SAID))).toBe(true);
});

test("a thread waiting for Unii as the cut turn is resumed: not given back at once ('Unii não respondeu'), left to that turn's end", () => {
  expect(AT_OPEN.talk).toBe("unii");
  expect(Deps.task_missed(AT_OPEN)).toBe(false);
  expect(AT_OPEN.thread[AT_OPEN.thread.length - 1]).toMatchObject({ who: "user", text: "Pode resumir?" });
});

test("the turn resumed ends: work saved [] again, nothing left running", async () => {
  for (let i = 0; i < 50 && chat.busy; i++) {
    await Bun.sleep(20);
  }
  expect(chat.busy).toBe(false);
  expect(Memory.saved(DIR)!.work).toEqual([]);
});
