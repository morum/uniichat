// Resume.server.test
// ==================
// `bun test Resume.server.test.ts`: Unii's turn cut by a stop (SIGTERM
// in the middle of a turn) goes on as the server starts again. The
// server before left view.json with work ["Unii's turn"]; Chat.open
// takes that work as loaded, before anything saves what runs now
// (Chat.timed saves work [] at once), so the note "The server
// restarted…" is said and a turn is asked. Before the fix, the work
// read by Chat.resume was the one Chat.timed had just saved: [], so no
// note and no turn. The AI is a fake that answers at once; the chat's
// dir is the run's.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Disk } from "./Disk.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import { Chat } from "./Server.ts";
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
// says work ["Unii's turn"], no restart asked (restart.json absent)
const DIR = config.DIR + "/chat";
fs.mkdirSync(DIR, { recursive: true });
fs.rmSync(DIR + "/restart.json", { force: true });
if (Memory.saved(DIR) === null) {
  Memory.load(DIR, (() => {}) as any);
}
fs.writeFileSync(DIR + "/view.json", JSON.stringify({ ...Memory.saved(DIR)!, work: [TURN], timers: [] }));
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

// the last writes synced before the run's dir is removed (TestSetup.ts)
afterAll(async () => {
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
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

test("the turn resumed ends: work saved [] again, nothing left running", async () => {
  for (let i = 0; i < 50 && chat.busy; i++) {
    await Bun.sleep(20);
  }
  expect(chat.busy).toBe(false);
  expect(Memory.saved(DIR)!.work).toEqual([]);
});
