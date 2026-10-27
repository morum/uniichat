// TasksAsk.server.test
// ====================
// `UNII_DIR=$(mktemp -d) bun test TasksAsk.server.test.ts`: the trava
// of P87 in the server (Server.ts, Chat.asked). A whole turn (Chat.turn,
// the model's call faked) whose last reply asks the user something with
// no task of the user's about it: the serve makes one of Unii's (P112),
// "Pergunta sem pendência", with the reply's id, and a note says so; with one, or with no question,
// nothing; with one about something else, still one. Push.deliver and
// Push.phones are fakes.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI } from "./AskAI.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import { Push } from "./Push.ts";
import * as TaskPush from "./TaskPush.ts";
import { Chat } from "./Server.ts";
import * as Tasks from "./Tasks.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

(AskAI as any).ask = () => ({ send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "", left: [] }) });
const DELIVER = Push.deliver;
const PHONE = Push.phones;
(Push as any).deliver = async () => true;
(Push as any).phones = () => {};

const chat = Chat.open() as any;
const dir = chat.mem.dir;
Tasks.tasks_forget();
fs.rmSync(dir + "/tasks.json", { force: true });

afterAll(() => {
  (Push as any).deliver = DELIVER;
  (Push as any).phones = PHONE;
  Tasks.tasks_forget();
  fs.rmSync(dir + "/tasks.json", { force: true });
});

const last = () => Memory.message(chat.mem, chat.mem.count - 1)!;
const asked = () => Tasks.tasks_load(dir).tasks.filter((t) => t.state === "open" && t.title === Tasks.ASKED_TITLE);

// the task closed as Unii closes it (it's Unii's, P112): dropped with its
// reason (a false alarm)
function drop(id: string): void {
  const got = Tasks.task_edit(Tasks.tasks_load(dir), { id, state: "dropped", evidence: { type: "reason", text: "Alarme falso do teste: a frase não pedia nada ao usuário." } }, Date.now());
  expect(typeof got).not.toBe("string");
}

// a whole turn, as the server runs it, whose call does `act` (tools,
// say) and then replies `reply`
async function turn(reply: string, act: () => void = () => {}): Promise<void> {
  const CALL = Chat.call;
  (Chat as any).call = async (c: any) => {
    c.wait = [];
    act();
    await Chat.writing(c, async () => Chat.push(c, null, "unii", reply));
    return false;
  };
  try {
    chat.wait = [{ id: -1 }];
    await Chat.turn(chat);
  } finally {
    (Chat as any).call = CALL;
  }
  await Bun.sleep(20);
}

test("a turn ending in a question to the user with no task of theirs: the serve makes one of Unii's, with the reply's id, and says so (P112)", async () => {
  // the user's message first, as a turn has (else the reply may be read
  // with Unii's hello, logged just before, as its first page)
  Chat.push(chat, null, "user", "Como estão os três PRs?");
  await turn("Os três estão aprovados, sem ressalvas. Quer que eu mescle como admin e crie as tags?");
  const made = asked();
  expect(made).toHaveLength(1);
  const t = made[0]!;
  // the reply: the message before the note
  const reply = chat.mem.count - 2;
  expect(Memory.message(chat.mem, reply)!.kind).toBe("unii");
  expect([t.assignee, t.origin, t.kind, t.by, t.fields.length]).toEqual(["unii", "chat", "action", "trava", 0]);
  expect(t.next_step).toBe(Tasks.ASKED_STEP);
  expect(t.next_due).not.toBeNull();
  expect(t.detail).toContain("Mensagem de origem: nº " + reply + ", resposta do Unii, em ");
  expect(t.detail).toContain("que começa assim: “Os três estão aprovados, sem ressalvas. Quer que eu mescle como admin e crie as tags?”");
  expect(t.detail).toContain("• “Quer que eu mescle como admin e crie as tags?”");
  expect(last().kind).toBe("note");
  expect(last().text).toStartWith("Pergunta sem pendência: o Unii perguntou “Quer que eu mescle como admin e crie as tags?”");
  expect(last().text).toContain("Registrei na " + t.id + ", tarefa do Unii, não do usuário. Unii: resolva a " + t.id);
  // not the user's: not in their "Agora"
  expect(TaskPush.turn_count(Tasks.tasks_load(dir).tasks)).toBe(0);
  // the next question, while that one is open: added to it with its own
  // origin, no other
  await turn("Aguardo sua ordem para aplicar o #1127.");
  const again = chat.mem.count - 2;
  expect(asked()).toHaveLength(1);
  expect(asked()[0]!.id).toBe(t.id);
  expect(asked()[0]!.detail).toContain("nº " + reply + ",");
  expect(asked()[0]!.detail).toContain("Mensagem de origem: nº " + again + ", resposta do Unii");
  expect(asked()[0]!.detail).toContain("• “Aguardo sua ordem para aplicar o #1127.”");
  drop(t.id);
});

test("a reply in pages, and a promise's note before the trava's: the origin is the reply's first page (P112)", async () => {
  Chat.push(chat, null, "user", "E o #23?");
  const CALL = Chat.call;
  let first = -1;
  (Chat as any).call = async (c: any) => {
    c.wait = [];
    await Chat.writing(c, async () => {
      first = Chat.push(c, null, "unii", "Mesclei o #23. ", [], true).id;
      Chat.push(c, null, "unii", "Vou revisar o diff em seguida. Quer que eu reinicie o serve agora?");
    });
    return false;
  };
  try {
    chat.wait = [{ id: -1 }];
    await Chat.turn(chat);
  } finally {
    (Chat as any).call = CALL;
  }
  await Bun.sleep(20);
  const t = asked()[0]!;
  expect(t.detail).toContain("Mensagem de origem: nº " + first + ", resposta do Unii");
  expect(t.detail).toContain("• “Quer que eu reinicie o serve agora?”");
  drop(t.id);
});

test("\"PR, merge e reinício só quando você mandar.\" (a rule of Unii's) makes no task nor note (P112)", async () => {
  const count = chat.mem.count;
  await turn("Mesclei o #23 por ordem sua. PR, merge e reinício só quando você mandar.");
  expect(chat.mem.count).toBe(count + 1);
  expect(asked()).toHaveLength(0);
});

test("with a task of the user's made in the turn, or no question, nothing", async () => {
  let count = chat.mem.count;
  await turn("Abri a decisão. Quer que eu mescle?", () => {
    Tasks.task_new(Tasks.tasks_load(dir), { title: "Mesclar os três?", origin: "chat", kind: "decision", choices: ["Sim", "Não"] }, "main", Date.now());
  });
  expect(chat.mem.count).toBe(count + 1);
  expect(last().kind).toBe("unii");
  expect(asked()).toHaveLength(0);
  // a question tied by id to an open task of the user's, not moved now
  const open = Tasks.tasks_load(dir).tasks.find((t) => t.title === "Mesclar os três?")!;
  count = chat.mem.count;
  await turn("A " + open.id + " segue aberta: mesclo os três?");
  expect(chat.mem.count).toBe(count + 1);
  // a task of Unii's only: still a note and a task
  await turn("Mesclei. E o deploy, faço hoje?", () => {
    Tasks.task_new(Tasks.tasks_load(dir), { title: "Conferir o CI", assignee: "unii", done_when: "CI lido", next_step: "ler" }, "main", Date.now());
  });
  expect(asked()).toHaveLength(1);
  expect(asked()[0]!.assignee).toBe("unii");
  expect(last().text).toStartWith("Pergunta sem pendência: o Unii perguntou “E o deploy, faço hoje?”");
  drop(asked()[0]!.id);
  // no question; a question in code or quoted; one Unii answers itself
  count = chat.mem.count;
  await turn("Mesclei os três e criei as tags.");
  await turn("O Enzo perguntou: “vc tem um agente escutando os prs?”. Respondi que não.");
  await turn("Por que travou? Porque o lint falhou.\n```\nread -p 'Continuar?'\n```");
  expect(chat.mem.count).toBe(count + 3);
  expect(asked()).toHaveLength(0);
});

test("a task of the user's about something else, made in the turn, doesn't spare the question (B2)", async () => {
  await turn("Abri a assinatura do lock. Quer que eu mescle o hospitalar?", () => {
    Tasks.task_new(Tasks.tasks_load(dir), { title: "Assinar o ritsu.lock", origin: "chat", choices: ["Assinei", "Depois"] }, "main", Date.now());
  });
  expect(asked()).toHaveLength(1);
  expect(last().kind).toBe("note");
  expect(last().text).toStartWith("Pergunta sem pendência: o Unii perguntou “Quer que eu mescle o hospitalar?”");
  drop(asked()[0]!.id);
  for (const t of Tasks.tasks_load(dir).tasks.filter((x) => x.state === "open" && x.title === "Assinar o ritsu.lock")) {
    drop(t.id);
  }
});

test("a reply in a task's thread (the user wrote there) is that task's: nothing", async () => {
  const s = Tasks.tasks_load(dir);
  const t = Tasks.task_new(s, { title: "Aprovar o PR", origin: "chat", choices: ["Mesclar", "Corrigir antes"] }, "main", Date.now() - 60e3) as Tasks.Task;
  Tasks.task_say(s, t.id, "Pode resumir?", Date.now() - 30e3);
  const count = chat.mem.count;
  await turn("Resumo: CI verde, verificação limpa. Mesclo?");
  expect(chat.mem.count).toBe(count + 1);
  expect(asked()).toHaveLength(0);
  expect(Tasks.tasks_load(dir).tasks.find((x) => x.id === t.id)!.thread.at(-1)!.text).toBe("Resumo: CI verde, verificação limpa. Mesclo?");
});

test("the user's name (config owner_name): a request on their order is theirs (P87 #2)", async () => {
  const names = config.OWNER_NAMES as string[];
  const had = names.splice(0);
  try {
    let count = chat.mem.count;
    await turn("Depende da ordem do Guilherme.");
    expect(chat.mem.count).toBe(count + 1);
    expect(asked()).toHaveLength(0);
    names.push("Guilherme");
    await turn("Depende da ordem do Guilherme.");
    expect(asked()).toHaveLength(1);
    expect(last().text).toStartWith("Pergunta sem pendência: o Unii perguntou “Depende da ordem do Guilherme.”");
    drop(asked()[0]!.id);
    // negated: nothing
    count = chat.mem.count;
    await turn("Isso não depende de você.");
    expect(chat.mem.count).toBe(count + 1);
    expect(asked()).toHaveLength(0);
  } finally {
    names.splice(0, names.length, ...had);
  }
});

test("a turn halted (a note last): nothing", async () => {
  const count = chat.mem.count;
  Chat.push(chat, null, "unii", "Quer que eu mescle?");
  Chat.push(chat, null, "note", "Stopped by the user: Unii's turn.");
  Chat.asked(chat, Date.now(), Chat.reply(chat));
  await Bun.sleep(20);
  expect(chat.mem.count).toBe(count + 2);
  expect(asked()).toHaveLength(0);
});
