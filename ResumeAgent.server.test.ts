// ResumeAgent.server.test
// =======================
// `bun test ResumeAgent.server.test.ts`: an agent cut by a stop (SIGTERM
// while it worked) goes on as the server starts again. The server before
// left the agent's log (its note, its task) and view.json with work [the
// agent's name]. Chat.open takes that work as loaded, before anything
// saves what runs now (Chat.timed saves work [] at once), and
// Chat.resume tells the agent "The server restarted…" (Tools.tell): its
// log gets the note as the user's message, and it's called again, taken
// back from its log. Before the fix, the work read by Chat.resume was the
// one Chat.timed had just saved: [], so no note and the agent never
// called again. Unii's turn cut: Resume.server.test.ts. The AI is a fake
// that answers at once; the chat's dir is the run's.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Disk } from "./Disk.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import { Chat } from "./Server.ts";
import { Tools } from "./Tools.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

// the agents' calls (ask.agent) and the chat's (a block "Turn: …")
const AGENT_ASKED: Ask[] = [];
const TURNS: Ask[] = [];
(AskAI as any).ask = (ask: Ask) => {
  if (ask.agent === true) {
    AGENT_ASKED.push(ask);
  } else if (ask.blocks.some((b) => b.text.startsWith("Turn: "))) {
    TURNS.push(ask);
  }
  return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "Relato: feito.", left: [] }) };
};
const DELIVER = Push.deliver;
const PHONE = Push.phones;
(Push as any).deliver = async () => true;
(Push as any).phones = () => {};

// the chat as the server before left it, cut in an agent's work: its log
// (the note a spawn writes, its task), view.json saying work [the
// agent], no restart asked (restart.json absent)
const DIR = config.DIR + "/chat";
fs.mkdirSync(DIR, { recursive: true });
fs.rmSync(DIR + "/restart.json", { force: true });
const before = Memory.load(DIR, (() => {}) as any);
const AGENT = Memory.agent_new(before);
const TASK = "Corrija o teste e relate o SHA.";
Memory.agent_push(before, AGENT, "note", "subagent at effort high, labeled resume-test");
Memory.agent_push(before, AGENT, "user", TASK);
fs.writeFileSync(DIR + "/view.json", JSON.stringify({ ...Memory.saved(DIR)!, work: [AGENT], timers: [] }));
const SAID = Tools.restarted([AGENT]);

const chat = Chat.open() as any;
const BEFORE = chat.mem.count;

// the last writes synced before the run's dir is removed (TestSetup.ts)
afterAll(async () => {
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
  await Disk.synced();
});

test("an agent cut by a stop: the chat says the restart in a note, once", () => {
  const notes: number[] = [];
  for (let i = 0; i < chat.mem.count; i++) {
    const m = Memory.message(chat.mem, i);
    if (m?.kind === "note" && m.text === SAID) {
      notes.push(i);
    }
  }
  expect(notes).toEqual([BEFORE - 1]);
});

test("the agent is told the restart (Tools.tell) and called again: its log, task then note, is what it's asked", async () => {
  for (let i = 0; i < 50 && AGENT_ASKED.length === 0; i++) {
    await Bun.sleep(20);
  }
  expect(AGENT_ASKED.length).toBe(1);
  const ask = AGENT_ASKED[0];
  const log = ask.blocks[ask.blocks.length - 1].text;
  expect(log).toContain(TASK);
  expect(log).toContain(SAID);
  expect(log.indexOf(TASK)).toBeLessThan(log.indexOf(SAID));
  // taken back from its log: the effort its note says
  expect(ask.effort).toBe("high");
  const roots = Memory.agent(chat.mem, AGENT)!;
  expect(roots.map((r) => [r.kind, r.text]).slice(0, 3)).toEqual([["note", "subagent at effort high, labeled resume-test"], ["user", TASK], ["user", SAID]]);
});

test("the agent ends: its report reaches the chat, work saved [] again, nothing left running", async () => {
  for (let i = 0; i < 100 && (chat.busy || Chat.running(chat).length > 0 || TURNS.length === 0); i++) {
    await Bun.sleep(20);
  }
  expect(Chat.running(chat)).toEqual([]);
  expect(Memory.saved(DIR)!.work).toEqual([]);
  // the report, the agent's reply, as a "[Name]" message: a turn of Unii's
  expect(TURNS.length).toBe(1);
  expect(TURNS[0].blocks.some((b) => b.text.startsWith("Turn: ") && b.text.includes("[" + AGENT + "]") && b.text.includes("Relato: feito."))).toBe(true);
});
