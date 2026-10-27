// TasksAsk.test
// =============
// `bun test TasksAsk.test.ts`: the questions to the user a reply holds
// (Tasks.questions_in, P87), what isn't one, and the task a question
// without one gets (Tasks.task_asked), and when a task of the user's is
// the question's (Tasks.question_tasked).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Deps from "./TaskDeps.ts";
import * as TaskPush from "./TaskPush.ts";
import * as T from "./Tasks.ts";
import * as View from "./View.ts";

const asks = (text: string, ids: string[] = []) => T.questions_in(text, new Set(ids));

test("a question put to the user counts", () => {
  expect(asks("Os três estão aprovados. Quer que eu mescle como admin e crie as tags?")).toEqual(["Quer que eu mescle como admin e crie as tags?"]);
  expect(asks("Posso mesclar o hospitalar#649?")).toEqual(["Posso mesclar o hospitalar#649?"]);
  expect(asks("Mesclo agora?")).toEqual(["Mesclo agora?"]);
  expect(asks("Sigo com o deploy em hom ou prefere esperar?")).toEqual(["Sigo com o deploy em hom ou prefere esperar?"]);
  expect(asks("Qual opção você prefere, A ou B?")).toEqual(["Qual opção você prefere, A ou B?"]);
  expect(asks("Que tal mesclar só o auth?")).toEqual(["Que tal mesclar só o auth?"]);
  expect(asks("Mesclo o auth#306 (tag server/v0.2.0-beta.85)?")).toEqual(["Mesclo o auth#306 (tag server/v0.2.0-beta.85)?"]);
  expect(asks("Should I merge it?")).toEqual(["Should I merge it?"]);
});

test("a request in words, without a question mark, counts", () => {
  expect(asks("Tudo pronto. Aguardo sua ordem para mesclar.")).toEqual(["Aguardo sua ordem para mesclar."]);
  expect(asks("Me diga se posso seguir.")).toEqual(["Me diga se posso seguir."]);
  expect(asks("O merge admin e as tags dependem de ordem sua.")).toEqual(["O merge admin e as tags dependem de ordem sua."]);
  expect(asks("Se quiser, posso montar o agente.")).toEqual(["Se quiser, posso montar o agente."]);
  expect(asks("Preciso da sua decisão sobre o prazo.")).toEqual(["Preciso da sua decisão sobre o prazo."]);
  expect(asks("Let me know when to restart.")).toEqual(["Let me know when to restart."]);
});

test("what isn't a question to the user: none", () => {
  // a question Unii asks itself and answers
  expect(asks("Por que travou? Porque o lint falhou no head novo.")).toEqual([]);
  expect(asks("O que mudou? O filtro de Kind.")).toEqual([]);
  // quoted: in a block quote, in quotes, in code
  expect(asks("> Quer que eu mescle?\n\nFeito.")).toEqual([]);
  expect(asks("O Enzo escreveu “vc tem um agente escutando os prs?” e respondi.")).toEqual([]);
  expect(asks("Rodei:\n```\nread -p 'Continuar?' x\n```\nPassou.")).toEqual([]);
  expect(asks("O teste `deve mesclar?` passou.")).toEqual([]);
  // a heading
  expect(asks("## Posso mesclar?\nNão: falta o CI.")).toEqual([]);
  // another's question reported
  expect(asks("O Enzo perguntou: você tem um agente escutando os PRs? Respondi que não.")).toEqual([]);
  // plain statements, promises, past
  expect(asks("Mesclei os três e criei as tags. P48 fechada com evidência.")).toEqual([]);
  expect(asks("Vou revisar o diff em seguida.")).toEqual([]);
  expect(asks("Você pediu reinício e não há agentes ativos.")).toEqual([]);
});

test("common requests to the user count (M1)", () => {
  const one = (x: string) => expect(asks(x)).toEqual([x]);
  one("Unii perguntou se mescla os três (depende de ordem).");
  one("O merge e as tags dependem de ordem.");
  one("Aguardando decisão.");
  one("Aguardando sua resposta.");
  one("Fico no aguardo.");
  one("Qual opção?");
  one("Qual?");
  one("Você decide.");
  one("Diga qual prefere.");
  one("Preciso que você decida.");
  one("Preciso de decisão sua: mesclar ou esperar.");
  one("Falta só a sua aprovação.");
  one("Pode confirmar o merge");
  one("Quando quiser, aplico.");
  expect(asks("Opções: (a) mesclar agora; (b) esperar o CI. Qual?")).toEqual(["Qual?"]);
  // another's order, decision, answer: not the user's
  expect(asks("O deploy depende de ordem do Enzo.")).toEqual([]);
  expect(asks("Aguardando resposta do Enzo no Slack.")).toEqual([]);
  expect(asks("Preciso da aprovação do comitê antes.")).toEqual([]);
});

test("what isn't asked of the user: none (B1)", () => {
  expect(asks("Perguntei ao Enzo se quer que eu mescle.")).toEqual([]);
  expect(asks("O Enzo quer que eu mescle?")).toEqual([]);
  expect(asks("Alguém sabe por que falhou?")).toEqual([]);
  expect(asks("Você já viu o que houve? Foi o lint.")).toEqual([]);
  expect(asks("Você viu o que houve? Foi o lint.")).toEqual([]);
  expect(asks("Não testado: hom?")).toEqual([]);
  // but to the user still, with a word to them, or said last
  expect(asks("O Enzo quer que eu mescle; você concorda?")).toEqual(["O Enzo quer que eu mescle; você concorda?"]);
  expect(asks("O lint passou. Você viu o PR #22?")).toEqual(["Você viu o PR #22?"]);
  expect(asks("A P86 segue aberta; mesclo?")).toEqual(["A P86 segue aberta; mesclo?"]);
  expect(asks("Pergunto se você quer que eu mescle.")).toEqual(["Pergunto se você quer que eu mescle."]);
});

test("a request negated just before it asks nothing (P87 #2, B1)", () => {
  expect(asks("Não depende de ordem sua.")).toEqual([]);
  expect(asks("Isso não depende de você.")).toEqual([]);
  expect(asks("Nenhum agente depende de ordem.")).toEqual([]);
  expect(asks("Ele nem depende de você.")).toEqual([]);
  expect(asks("Não cabe a você decidir.")).toEqual([]);
  // the negation of another clause, or further before, doesn't cancel it
  expect(asks("Não mesclei porque aguardo sua ordem.")).toEqual(["Não mesclei porque aguardo sua ordem."]);
  expect(asks("Não, você decide.")).toEqual(["Não, você decide."]);
  expect(asks("Isso não depende de ordem sua, mas preciso da sua decisão sobre o prazo.")).toEqual(["Isso não depende de ordem sua, mas preciso da sua decisão sobre o prazo."]);
  // what asks still does
  expect(asks("O merge e as tags dependem de ordem.")).toEqual(["O merge e as tags dependem de ordem."]);
  expect(asks("Depende de você.")).toEqual(["Depende de você."]);
});

test("short confirmations, \"Me avise\", whose call it is, and the user's name ask (P87 #2, B2)", () => {
  const one = (x: string, names: string[] = []) => expect(T.questions_in(x, new Set(), names)).toEqual([x]);
  one("Ok?");
  one("Vale?");
  one("Pode ser?");
  one("Me avise.");
  one("Me avise quando puder.");
  one("Quem decide é você.");
  one("Cabe a você decidir.");
  one("Depende da ordem do Guilherme.", ["Guilherme"]);
  one("Aguardando resposta do Guilherme.", ["Guilherme"]);
  expect(asks("Mesclo agora. Ok?")).toEqual(["Ok?"]);
  // the user's name unknown (no owner_name): another's, as before
  expect(asks("Depende da ordem do Guilherme.")).toEqual([]);
  // another's still not, with the user's name known
  const none = (x: string) => expect(T.questions_in(x, new Set(), ["Guilherme"])).toEqual([]);
  none("O deploy depende de ordem do Enzo.");
  none("Depende da ordem do Enzo, não do Guilherme.");
  none("Aguardando resposta do Enzo");
  none("O Enzo me avisou.");
  // the false positives fixed before stay fixed
  none("O Enzo quer que eu mescle?");
  none("Alguém sabe por que falhou?");
  none("Não testado: hom?");
  none("depende de ordem do Enzo");
});

test("\"você decide\" by contrast, and \"Me avise se…\" on an event, ask nothing (P87 #3, B1 and B2)", () => {
  const none = (x: string) => expect(asks(x)).toEqual([]);
  const one = (x: string) => expect(asks(x)).toEqual([x]);
  // B1: who decides, told by contrast
  none("Ele não decide, você decide.");
  none("O Enzo não decide, você decide.");
  none("Ele não escolhe, você escolhe.");
  // B2: an instruction to tell on an event
  none("Me avise se falhar.");
  none("Me avise caso o CI falhe.");
  none("Me avisa se der erro.");
  // what asked still does
  one("Não, você decide.");
  one("Você decide.");
  one("Ele não sabe, você decide.");
  one("Me avise.");
  one("Me avise quando puder.");
  one("Me avise se quiser que eu mescle.");
  one("Me avise se posso seguir.");
  one("Me diga se posso seguir.");
  one("Quem decide é você.");
  // "Não está ok?" is a question to the user: it asks (FoggySalmon)
  one("Não está ok?");
  // B3: "Falta só a sua aprovação." asks, as meant; negated, it doesn't
  one("Falta só a sua aprovação.");
  none("Não falta a sua aprovação.");
});

test("\"Se falhar, me avise.\" tells on an event; \"Me avise caso aprove.\" asks (P87 #4, B1 and B2)", () => {
  const none = (x: string) => expect(asks(x)).toEqual([]);
  const one = (x: string) => expect(asks(x)).toEqual([x]);
  // B1: the condition before, on an event: an instruction
  none("Se falhar, me avise.");
  none("Caso o CI falhe, me avise.");
  none("Se der erro, me avisa.");
  none("Rodei o deploy. Se falhar, me avise.");
  // ... on the user's will: a request
  one("Se quiser, me avise.");
  one("Se você preferir, me avise.");
  one("Caso aprove, me avise.");
  // B2: the subjunctive of the user's will asks
  one("Me avise caso aprove.");
  one("Me avise caso queira que eu mescle.");
  one("Me avise se aprovar.");
  one("Me avise caso autorize.");
  // ... an event doesn't
  none("Me avise caso falhe.");
  none("Me avise caso o CI falhe.");
  // the table of verification #4 holds
  none("Ele não decide, você decide.");
  none("Me avise se falhar.");
  one("Não, você decide.");
  one("Você decide.");
  one("Quem decide é você.");
  one("Me avise.");
  one("Me avise se posso seguir.");
  one("Não está ok?");
});

test("known limits, kept as documented (P87 #2, B3 and B4)", () => {
  // B3: "Rodei x? ok.": two words and "?", read as a question
  expect(asks("Rodei x? ok.")).toEqual(["Rodei x?"]);
  expect(asks("Rodei os testes? ok.")).toEqual(["Rodei os testes?"]);
  // P87 #4, B3: "quando" isn't read as an event: it asks
  expect(asks("Me avise quando falhar.")).toEqual(["Me avise quando falhar."]);
  // B4: question_tasked: a word in common with an unrelated task of the
  // user's made in the turn spares a question
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  T.task_new(s, { title: "Revisar o hospitalar#700", origin: "chat" }, "main", now + 10);
  expect(T.question_tasked(s, "Quer que eu mescle o hospitalar?", now)).toBe(true);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a question tied by id to an open task of the user's is that task's", () => {
  expect(asks("A P86 segue aberta: mesclo os três como admin?", ["P86"])).toEqual([]);
  // the id of a task not open (or not the user's): still a question
  expect(asks("A P86 segue aberta: mesclo os três como admin?", ["P85"])).toEqual(["A P86 segue aberta: mesclo os três como admin?"]);
  // another paragraph: still a question
  expect(asks("Abri a P86.\n\nE o deploy, faço hoje?", ["P86"])).toEqual(["E o deploy, faço hoje?"]);
});

test("at most 3, each once", () => {
  expect(asks("Mesclo? Mesclo? Aplico? Reinicio? Publico?")).toEqual(["Mesclo?", "Aplico?", "Reinicio?"]);
});

test("a question without a task gets one of Unii's (P112): no fields, its next step due in 4 h, each sentence with its origin; one open gets the next added", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  expect(T.question_tasked(s, "Quer que eu mescle?", now)).toBe(false);
  const from = { id: 4823, text: "Os três estão aprovados, sem ressalvas. Quer que eu mescle?", date: new Date(now).toISOString() };
  const t = T.task_asked(s, ["Quer que eu mescle?"], now, from) as T.Task;
  expect(t.title).toBe(T.ASKED_TITLE);
  expect([t.assignee, t.origin, t.kind, t.by]).toEqual(["unii", "chat", "action", "trava"]);
  expect(t.fields).toEqual([]);
  expect(t.choices).toEqual([]);
  expect(t.next_step).toBe(T.ASKED_STEP);
  expect(Date.parse(t.next_due!)).toBe(now + 4 * 3600e3);
  expect(t.done_when).toBe(T.ASKED_DONE);
  expect(t.done_when).toContain("pendência aberta ao usuário");
  expect(t.detail).toStartWith(T.ASKED_HEAD);
  expect(t.detail).toContain("Mensagem de origem: nº 4823, resposta do Unii, em ");
  expect(t.detail).toContain("que começa assim: “Os três estão aprovados, sem ressalvas. Quer que eu mescle?”");
  expect(t.detail).toContain("• “Quer que eu mescle?”");
  // Unii's: it doesn't spare the next question (only the user's do)
  expect(T.question_tasked(s, "Quer que eu mescle?", now)).toBe(false);
  // the next question, while it's open: added to it with its own origin
  const u = T.task_asked(s, ["Aplico em hom?"], now + 1000, { id: 4830, text: "CI verde. Aplico em hom?", date: null }) as T.Task;
  expect(u.id).toBe(t.id);
  expect(u.assignee).toBe("unii");
  expect(u.next_due).toBe(t.next_due);
  expect(u.detail).toContain("nº 4823");
  expect(u.detail).toContain("Mensagem de origem: nº 4830, resposta do Unii, que começa assim: “CI verde. Aplico em hom?”.\nFrases a decidir (pergunta real ou alarme falso):\n• “Aplico em hom?”");
  expect(u.detail.indexOf("nº 4823")).toBeLessThan(u.detail.indexOf("nº 4830"));
  // its head once, the task's own: not taken for an older record
  expect(u.detail.split(T.ASKED_HEAD)).toHaveLength(2);
  expect(u.detail).not.toContain("Registro anterior");
  expect(s.tasks.filter((x) => x.state === "open")).toHaveLength(1);
  // a task of Unii's made: not the user's question's
  const later = now + 60e3;
  T.task_new(s, { title: "Conferir o deploy", assignee: "unii", done_when: "CI lido", next_step: "ler" }, "main", later);
  expect(T.question_tasked(s, "Faço o deploy hoje?", later)).toBe(false);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("each sentence of the task has its origin: no sentence alone, even as the detail outgrows its most (P112)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  const long = "Relato longo ".repeat(40) + "Mesclo?";
  let t: T.Task | undefined;
  for (let i = 0; i < 12; i++) {
    t = T.task_asked(s, ["Mesclo o PR " + i + "?", "Aplico o " + i + " em hom?", "Reinicio o serve " + i + "?"], now + i, { id: 100 + i, text: long, date: null }) as T.Task;
  }
  expect(t!.detail.length).toBeLessThanOrEqual(T.DETAIL);
  expect(t!.detail).toStartWith(T.ASKED_HEAD);
  // the newest kept, the oldest gone whole
  expect(t!.detail).toContain("nº 111");
  expect(t!.detail).not.toContain("nº 100,");
  expect(t!.detail).not.toContain("PR 0?");
  // every block: its origin, then its sentences
  const blocks = t!.detail.slice(T.ASKED_HEAD.length).trim().split(/\n\n/);
  for (const b of blocks) {
    expect(b).toStartWith("Mensagem de origem: nº ");
    expect(b.split("\n").slice(2).every((l) => l.startsWith("• “"))).toBe(true);
  }
  // the text quoted is cut, with an ellipsis
  expect(t!.detail).toContain("Relato longo Relato longo");
  expect(t!.detail).toContain("…”");
  // the origin unknown: said so
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  T.tasks_forget();
  const s2 = T.tasks_load(dir2);
  const v = T.task_asked(s2, ["Mesclo?"], now) as T.Task;
  expect(v.detail).toContain("Mensagem de origem: a última resposta do Unii no turno (número não disponível).");
  // when it was logged, in the server's local time (bun test runs in
  // UTC: the zone set here, so local and UTC differ)
  const TZ = process.env.TZ;
  process.env.TZ = "America/Sao_Paulo";
  try {
    const w = T.task_asked(s2, ["Aplico?"], now, { id: 9, text: "Aplico?", date: "2026-10-27T12:05:00.000Z" }) as T.Task;
    expect(w.detail).toContain("Mensagem de origem: nº 9, resposta do Unii, em 27/10 às 09:05, que começa assim: “Aplico?”.");
  } finally {
    if (TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = TZ;
    }
  }
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test("a \"Pergunta sem pendência\" of the user's, made before P112, open: made Unii's, the next added, its fields gone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  const old = T.task_new(s, {
    title: T.ASKED_TITLE, detail: "O Unii terminou o turno perguntando ou pedindo algo a você sem abrir pendência (trava da P87):\n“Mesclo?”\nResponda no campo abaixo; a resposta chega ao Unii.", assignee: "user", origin: "chat", kind: "decision",
    fields: [{ id: "resposta", label: "Sua resposta", kind: "text", required: true }], done_when: "o usuário responder",
  }, "trava", now - 3600e3) as T.Task;
  expect(old.assignee).toBe("user");
  // a due of its own (the user's lateness): not Unii's 4 h, so not kept
  old.next_due = new Date(now + 3600e3).toISOString();
  const t = T.task_asked(s, ["Aplico?"], now, { id: 7, text: "Aplico?", date: null }) as T.Task;
  expect(t.id).toBe(old.id);
  expect([t.assignee, t.kind, t.fields, t.next_step]).toEqual(["unii", "action", [], T.ASKED_STEP]);
  expect(Date.parse(t.next_due!)).toBe(now + 4 * 3600e3);
  expect(t.detail).toStartWith(T.ASKED_HEAD);
  expect(t.detail).toContain("Registro anterior, feito antes desta tarefa ser do Unii:\nO Unii terminou o turno");
  expect(t.detail).toContain("Mensagem de origem: nº 7");
  expect(s.tasks.filter((x) => x.state === "open")).toHaveLength(1);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the task isn't the user's move: not in \"Agora\", nor counted nor pushed (P112)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const t = T.task_asked(s, ["Quer que eu mescle?"], Date.now(), { id: 1, text: "Quer que eu mescle?", date: null }) as T.Task;
  const blocked = Deps.blocked_ids(s.tasks);
  expect(Deps.user_move(t, blocked)).toBe(false);
  expect(View.desk_group(t, blocked)).toBe("others");
  expect(View.desk_list(s.tasks).map((g) => [g.group, g.tasks.map((x) => x.id)])).toEqual([["others", [t.id]]]);
  expect(TaskPush.turn_count(s.tasks)).toBe(0);
  expect(TaskPush.actionable(s.tasks)).toEqual([]);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("only a task of the user's about the question spares it (B2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const before = Date.now() - 3600e3;
  const old = T.task_new(s, { title: "Mesclar o hospitalar#649?", origin: "chat", kind: "decision", choices: ["Sim", "Não"] }, "main", before) as T.Task;
  const now = Date.now();
  // made before the turn, even about it, and moved in it: the id in the
  // paragraph ties it (questions_in), the words don't
  T.task_edit(s, { id: old.id, detail: "Mesclar o hospitalar agora?" }, now + 5);
  expect(T.question_tasked(s, "Quer que eu mescle o hospitalar?", now)).toBe(false);
  // made in the turn, about something else
  T.task_new(s, { title: "Assinar o ritsu.lock", detail: "Rode o comando de assinatura.", origin: "chat" }, "main", now + 10);
  expect(T.question_tasked(s, "Quer que eu mescle o hospitalar?", now)).toBe(false);
  // made in the turn, about it (words in common: "mescl", "hospi")
  T.task_new(s, { title: "Mesclar o hospitalar#649 como admin?", origin: "chat", kind: "decision", choices: ["Sim", "Não"] }, "main", now + 20);
  expect(T.question_tasked(s, "Quer que eu mescle o hospitalar?", now)).toBe(true);
  // made in the turn but Unii's: not
  T.task_new(s, { title: "Aplicar o infra#1127", assignee: "unii", done_when: "aplicado", next_step: "aplicar" }, "main", now + 30);
  expect(T.question_tasked(s, "Aplico o infra#1127?", now)).toBe(false);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the note says the task made is Unii's, to resolve, or why none", () => {
  const t = { id: "P9" } as T.Task;
  expect(T.questions_said(["Mesclo?"], t)).toBe("Pergunta sem pendência: o Unii perguntou “Mesclo?” sem abrir nem atualizar, neste turno, uma pendência do usuário. Registrei na P9, tarefa do Unii, não do usuário. Unii: resolva a P9: leia a mensagem de origem; se era pergunta real, abra a pendência do usuário com task_add (assignee user, com as opções) e encerre a P9 com task_edit (state dropped, evidence do tipo reason) citando a nova pendência; se era alarme falso, encerre a P9 do mesmo modo, com o motivo no reason.");
  const none = T.questions_said(["Mesclo?"], "The list has 100 open tasks");
  expect(none).toContain("não foi possível registrar a tarefa do Unii (The list has 100 open tasks)");
  expect(none).toContain("abra a pendência do usuário com task_add");
});

test("\"PR, merge e reinício só quando você mandar.\" is a rule of Unii's, not a question (P112)", () => {
  expect(asks("PR, merge e reinício só quando você mandar.")).toEqual([]);
  expect(asks("Sem merge sem ordem: PR, merge e reinício só quando você mandar.")).toEqual([]);
  expect(asks("Merge somente quando você mandar.")).toEqual([]);
  expect(asks("Mesclei o #23. PR, merge e reinício só quando você mandar.")).toEqual([]);
  // an offer on the user's order still asks; so does a request beside it
  expect(asks("Mesclo quando você mandar.")).toEqual(["Mesclo quando você mandar."]);
  expect(asks("Quando você mandar, reinicio.")).toEqual(["Quando você mandar, reinicio."]);
  expect(asks("PR, merge e reinício só quando você mandar: aguardo sua ordem.")).toEqual(["PR, merge e reinício só quando você mandar: aguardo sua ordem."]);
  expect(asks("Reinicio só quando você mandar?")).toEqual(["Reinicio só quando você mandar?"]);
});

test("\"só\" in the simple clause of \"quando você mandar\" makes it a rule of Unii's; in another clause, or inside a word, it doesn't (P112, B1)", () => {
  // "só" first, or not just before "quando": the same rule
  expect(asks("Só mesclo quando você mandar.")).toEqual([]);
  expect(asks("Mesclo só quando você mandar.")).toEqual([]);
  expect(asks("Apenas aplico em prod quando você mandar.")).toEqual([]);
  // "e" starts another clause (verif2 B1): "só" before it limits the
  // first verb, not the request
  expect(asks("Só mesclo hoje e faço o deploy quando você mandar.")).toEqual(["Só mesclo hoje e faço o deploy quando você mandar."]);
  // in the clause before (a comma, a semicolon): it limits something else
  expect(asks("Falta só o CI; mesclo quando você mandar.")).toEqual(["Falta só o CI; mesclo quando você mandar."]);
  expect(asks("Só falta o CI, mesclo quando você mandar.")).toEqual(["Só falta o CI, mesclo quando você mandar."]);
  // "so" inside a word is no "só"
  expect(asks("Faço isso quando você mandar.")).toEqual(["Faço isso quando você mandar."]);
  expect(asks("Faço sozinho quando você mandar.")).toEqual(["Faço sozinho quando você mandar."]);
  // only before "quando": "só" beside another request still asks
  expect(asks("Só falta a sua aprovação.")).toEqual(["Só falta a sua aprovação."]);
  expect(asks("Só mesclo se você quiser, posso mesclar agora.")).toEqual(["Só mesclo se você quiser, posso mesclar agora."]);
});

// The rule of "só" (P112, verif2 B1), the simplest coherent: "só",
// "somente", "apenas", "unicamente" or "exclusivamente" makes "quando você
// mandar" a rule of Unii's if it is in the same simple clause. A simple
// clause ends at a stop (, ; :) or a conjunction (e, mas, ou, que,
// porém, pois, porque, então, senão). Parentheses don't end it, and one
// comma just before "quando" doesn't either. So "só" is just before the
// verb ("Só mesclo"), just after it ("Mesclo só o #24"), or just before
// "quando" ("Mesclo só quando"), with at most one comma between.
test("\"só\" limits the request only in its own simple clause: after \"e\" or \"que\" it limits something else (P112, verif2 B1)", () => {
  // a request: "só" in a clause before, ended by "e" or "que"
  for (const x of [
    "Falta só o CI e mesclo quando você mandar.",
    "Tem só um PR e mesclo quando você mandar.",
    "Mesclo apenas o #24 e o #25 quando você mandar.",
    "Peço apenas que você mande quando puder.",
    "Falta só o CI, mas mesclo quando você mandar.",
    "Revisei só o #24 mas mesclo quando você mandar.",
    "Falta só o CI: mesclo quando você mandar.",
    // the last stop counts, not the first
    "Revisei o #24, só falta o CI e mesclo quando você mandar.",
  ]) {
    expect(asks(x)).toEqual([x]);
  }
  // a rule: "só" in the request's own clause
  for (const x of [
    "Só mesclo quando você mandar.",
    "Somente mesclo quando você mandar.",
    "Apenas mesclo quando você mandar.",
    "Mesclo só quando você mandar.",
    "Mesclo, só quando você mandar.",
    "Só mesclo, quando você mandar.",
    "Mesclo só o #24 quando você mandar.",
    "Mesclo (só o #24) quando você mandar.",
    "Só mesclo (o #24) quando você mandar.",
    "Mesclo unicamente quando você mandar.",
    "Exclusivamente mesclo quando você mandar.",
  ]) {
    expect(asks(x)).toEqual([]);
  }
  // a comma gives the same as none
  expect(asks("Mesclo, só quando você mandar.")).toEqual(asks("Mesclo só quando você mandar."));
  expect(asks("Só mesclo, quando você mandar.")).toEqual(asks("Só mesclo quando você mandar."));
  // the same in capitals, without accents, or with "!"
  for (const x of ["SÓ MESCLO QUANDO VOCÊ MANDAR.", "Mesclo so quando voce mandar.", "So mesclo quando voce mandar.", "Mesclo só quando você mandar!"]) {
    expect(asks(x)).toEqual([]);
  }
  expect(asks("FALTA SÓ O CI E MESCLO QUANDO VOCÊ MANDAR.")).toEqual(["FALTA SÓ O CI E MESCLO QUANDO VOCÊ MANDAR."]);
  // a question still asks
  expect(asks("Mesclo só quando você mandar?")).toEqual(["Mesclo só quando você mandar?"]);
  // "só" just after the request put first: the same rule (verif3 B4;
  // before it, this asked)
  expect(asks("Quando você mandar, só então mesclo.")).toEqual([]);
});

// The rule of "só" grown (P112, verif3 B1 and B4): the request's clause
// may go on a list that a clause led by "só" starts, through "e" or
// commas: of nouns ("o #25", "a tag"), of bare verbs ("reinicio"), or of
// conditions ("… e quando você mandar"); "que" of a time ("depois que")
// ends no clause; "só" just after a request put first is the same rule.
// Anything else asks: in doubt a needless task (which Unii drops) costs
// less than a question lost.
test("Unii's rules with a list in \"e\" make no task; a request after \"e\" still does (P112, verif3 B1 and B4)", () => {
  for (const x of [
    "Só mesclo e reinicio quando você mandar.",
    "Só mesclo o #24 e o #25 quando você mandar.",
    "Só mesclo depois que o CI passar quando você mandar.",
    "Só abro o PR e a tag quando você mandar.",
    "Reinicio só quando não houver agente e quando você mandar.",
    // longer lists, "eu", another condition, another time
    "Só mesclo, aplico e reinicio quando você mandar.",
    "Só mesclo o #24, o #25 e o #26 quando você mandar.",
    "Eu só mesclo e reinicio quando você mandar.",
    "Só mesclo depois do CI e quando você mandar.",
    "Só aplico antes que o lote feche quando você mandar.",
    "Só mesclo e reinicio, quando você mandar.",
    // "só" just after the request put first (B4)
    "Quando você mandar, só mesclo.",
    "Quando você mandar, eu só mesclo.",
    "Sem merge: quando você mandar, só mesclo.",
    // a number with no article, a noun in parentheses
    "Só mesclo o #24 e #25 quando você mandar.",
    "Só mesclo o #24 e (o #25) quando você mandar.",
    // what made no task before stays so
    "Só mesclo, quando você mandar.",
    "Só mesclo quando você mandar.",
  ]) {
    expect(asks(x)).toEqual([]);
  }
  for (const x of [
    // a request after "e": a clause of its own, not on the list
    "Falta só o CI e mesclo quando você mandar.",
    "Só mesclo hoje e faço o deploy quando você mandar.",
    "Tem só um PR e mesclo quando você mandar.",
    "Falta só o CI e quando você mandar mesclo.",
    "Falta só o CI e, quando você mandar, mesclo.",
    // the list's first clause not led by "só": in doubt, it asks (a known
    // limit: "Mesclo apenas o #24 e o #25" reads as a rule, too)
    "Falta só o CI e o deploy quando você mandar.",
    "Mesclo apenas o #24 e o #25 quando você mandar.",
    // a verb with words after it, on either side: in doubt, it asks
    "Só abro o PR e mesclo quando você mandar.",
    "Só mesclo e faço o deploy quando você mandar.",
    // a list that mixes nouns and verbs: in doubt, it asks
    "Só mesclo, reinicio e o deploy quando você mandar.",
    "Só mesclo o #24, o #25 e reinicio quando você mandar.",
    // a list goes on only through "e" or a comma, not ";" nor "mas"
    "Só mesclo o #24 hoje; o #25 quando você mandar.",
    "Só revisei o #24, mas o #25 quando você mandar.",
    // a condition goes on only through "e": ";" and "mas" end it
    "Só mesclo hoje; quando você mandar, faço o deploy.",
    "Só mesclo hoje, mas quando você mandar faço o deploy.",
    // "que" not of a time still ends a clause
    "Peço apenas que você mande quando puder.",
    // "só" after a request not put first, or another request after it
    "Mesclo quando você mandar, só depois do CI.",
    "Mesclo quando você mandar, só isso.",
    "Quando você mandar, só me avise.",
    "Quando você mandar, reinicio.",
    // what made a task before stays so
    "Faço isso quando você mandar.",
    "Mesclo quando você mandar.",
  ]) {
    expect(asks(x)).toEqual([x]);
  }
});

test("\"ou\", \"pois\", \"senão\" and \"porque\" end the clause of \"só\": the request after them asks (P112, verif3 B2: M23 to M26)", () => {
  for (const x of [
    "Espero só o CI ou mesclo quando você mandar.",
    "Revisei só o #24 pois mesclo quando você mandar.",
    "Rodo só o lint senão mesclo quando você mandar.",
    "Revisei só o #24 porque mesclo quando você mandar.",
    "Revisei só o #24 porém mesclo quando você mandar.",
    "Falta só o CI então mesclo quando você mandar.",
  ]) {
    expect(asks(x)).toEqual([x]);
  }
  // the same clause without them: the rule
  expect(asks("Espero só o CI quando você mandar.")).toEqual([]);
});

test("the origin is quoted whole up to 160 characters, cut after, with no blank before the ellipsis; one block too long is cut at DETAIL (P112, verif3 B2: M16, M17, M31, M32)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  const quote = (text: string) => {
    const t = T.task_asked(s, ["Mesclo?"], now, { id: 1, text, date: null }) as T.Task;
    const got = t.detail.match(/que começa assim: “([^”]*)”/)?.[1];
    t.state = "dropped";
    return got;
  };
  // 160 characters: whole, no ellipsis
  expect(quote("a".repeat(160))).toBe("a".repeat(160));
  // 161: the first 160, then the ellipsis
  expect(quote("b".repeat(161))).toBe("b".repeat(160) + "…");
  // 159: whole
  expect(quote("c".repeat(159))).toBe("c".repeat(159));
  // the cut ends in a blank: no blank before the ellipsis
  expect(quote("d".repeat(159) + " " + "e".repeat(10))).toBe("d".repeat(159) + "…");
  // one block longer than DETAIL alone: the detail cut at DETAIL
  const t = T.task_asked(s, ["f".repeat(T.DETAIL + 500) + "?"], now, { id: 2, text: "Mesclo?", date: null }) as T.Task;
  expect(t.detail).toStartWith(T.ASKED_HEAD);
  expect(t.detail.length).toBe(T.DETAIL);
  expect(t.detail).toContain("Mensagem de origem: nº 2,");
  // the same block added to an open task: the old block goes, the new
  // one alone is still cut at DETAIL
  const u = T.task_asked(s, ["g".repeat(T.DETAIL + 500) + "?"], now + 1, { id: 3, text: "Aplico?", date: null }) as T.Task;
  expect(u.id).toBe(t.id);
  expect(u.detail).toStartWith(T.ASKED_HEAD);
  expect(u.detail.length).toBe(T.DETAIL);
  expect(u.detail).toContain("Mensagem de origem: nº 3,");
  expect(u.detail).not.toContain("nº 2,");
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("\":\" ends a clause for a negation: \"Nada mudou: depende de ordem sua.\" asks (P112, verif2 B2)", () => {
  expect(asks("Nada mudou: depende de ordem sua.")).toEqual(["Nada mudou: depende de ordem sua."]);
  expect(asks("Nada mudou, depende de ordem sua.")).toEqual(["Nada mudou, depende de ordem sua."]);
  expect(asks("Nada depende de ordem sua.")).toEqual([]);
});

test("the origin's time is the server's local date and minute, not UTC: a zone of 30 minutes, past midnight (P112, verif2 B2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const TZ = process.env.TZ;
  try {
    // 18:45 UTC on 31/10 is 00:15 on 01/11 in Asia/Kolkata (UTC+5:30)
    process.env.TZ = "Asia/Kolkata";
    const a = T.task_asked(s, ["Aplico?"], Date.now(), { id: 3, text: "Aplico?", date: "2026-10-31T18:45:00.000Z" }) as T.Task;
    expect(a.detail).toContain("Mensagem de origem: nº 3, resposta do Unii, em 01/11 às 00:15, que começa assim");
    // 02:20 UTC on 01/01 is 22:50 on 31/12 in America/St_Johns (UTC-3:30)
    process.env.TZ = "America/St_Johns";
    const b = T.task_asked(s, ["Mesclo?"], Date.now(), { id: 4, text: "Mesclo?", date: "2027-01-01T02:20:00.000Z" }) as T.Task;
    expect(b.detail).toContain("Mensagem de origem: nº 4, resposta do Unii, em 31/12 às 22:50, que começa assim");
  } finally {
    if (TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = TZ;
    }
  }
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an open task of Unii's with a due not a date: a new question sets its due from now (P112, verif2 B2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  const t = T.task_asked(s, ["Mesclo?"], now, { id: 1, text: "Mesclo?", date: null }) as T.Task;
  t.next_due = "amanhã";
  const later = now + 60e3;
  const u = T.task_asked(s, ["Aplico?"], later, { id: 2, text: "Aplico?", date: null }) as T.Task;
  expect(u.id).toBe(t.id);
  expect(Date.parse(u.next_due!)).toBe(later + 4 * 3600e3);
  expect(u.moved).toBe(new Date(later).toISOString());
  expect(u.ready).toBe(new Date(later).toISOString());
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a new question doesn't restart the 4 h of an open task of Unii's: its due, when it moved, and so its lateness stay (P112)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  const t = T.task_asked(s, ["Mesclo?"], now, { id: 1, text: "Mesclo?", date: null }) as T.Task;
  expect(Date.parse(t.next_due!)).toBe(now + 4 * 3600e3);
  // 5 h later, past its due: a new question is added, the due stays
  const later = now + 5 * 3600e3;
  expect(Deps.overdue_ms(s.tasks, t, later)).toBe(3600e3);
  const u = T.task_asked(s, ["Aplico?"], later, { id: 2, text: "Aplico?", date: null }) as T.Task;
  expect(u.id).toBe(t.id);
  expect(u.detail).toContain("• “Aplico?”");
  expect(u.next_due).toBe(t.next_due);
  expect(u.moved).toBe(t.moved);
  // when it became ready stays too (verif2 B2)
  expect(t.ready).toBe(new Date(now).toISOString());
  expect(u.ready).toBe(t.ready);
  expect(u.changed).toBe(new Date(later).toISOString());
  expect(Deps.overdue_ms(s.tasks, u, later)).toBe(3600e3);
  expect(T.tasks_load(dir).tasks.find((x) => x.id === t.id)!.next_due).toBe(t.next_due);
  // still stalled, as the vigia sees it
  expect(View.task_stalled_said(u, new Set(), later).text).toBe("parada há 5 h");
  // one of Unii's with no due (edited so by hand): due from now
  u.next_due = null;
  const v = T.task_asked(s, ["Reinicio?"], later, null) as T.Task;
  expect(Date.parse(v.next_due!)).toBe(later + 4 * 3600e3);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the task closes as its head says: dropped with a reason citing the user's new task; done with a reason is refused (P112, B3)", () => {
  expect(T.ASKED_HEAD).toContain("encerre esta tarefa com task_edit, state dropped e evidence do tipo reason (no mínimo 40 caracteres)");
  expect(T.ASKED_HEAD).toContain("cite no reason o número da nova pendência");
  expect(T.ASKED_HEAD).toContain("não fecha como done");
  expect(T.ASKED_HEAD).not.toContain("feche esta tarefa citando");
  expect(T.ASKED_STEP).toContain("task_edit (state dropped, evidence reason)");
  expect(T.ASKED_DONE).toStartWith("esta tarefa encerrada como dropped");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-"));
  const s = T.tasks_load(dir);
  const now = Date.now();
  const t = T.task_asked(s, ["Quer que eu mescle?"], now, { id: 1, text: "Quer que eu mescle?", date: null }) as T.Task;
  const real = T.task_new(s, { title: "Ordem de merge do #23", assignee: "user", origin: "chat", choices: ["Mesclar", "Não mesclar"] }, "main", now + 1000) as T.Task;
  const reason = { type: "reason", text: "Pergunta real: registrada na pendência " + real.id + " do usuário, com as opções." };
  // done with a reason: refused, as the head says
  const done = T.task_edit(s, { id: t.id, state: "done", evidence: reason }, now + 2000);
  expect(typeof done).toBe("string");
  expect(done as string).toContain("reason only drops a task");
  // dropped with it: closed, the reason kept
  const dropped = T.task_edit(s, { id: t.id, state: "dropped", evidence: reason }, now + 3000) as T.Task;
  expect(typeof dropped).not.toBe("string");
  expect(dropped.state).toBe("dropped");
  expect(JSON.stringify(dropped.evidence)).toContain(real.id);
  T.tasks_forget();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("\"Me avise caso discorde.\", \"caso não queira\" and \"Se mesclar, me avise.\" ask (P87 #5, B2 to B4)", () => {
  const none = (x: string) => expect(asks(x)).toEqual([]);
  const one = (x: string) => expect(asks(x)).toEqual([x]);
  // B2: a disagreement is the user's will
  one("Me avise caso discorde.");
  one("Se discordar, me avise.");
  // B3: the will denied still asks
  one("Me avise caso não queira.");
  one("Se não quiser, me avise.");
  one("Me avise se não aprovar.");
  // B4: an act of the user's, with no subject, asks
  one("Se mesclar, me avise.");
  one("Me avise se mesclar.");
  one("Caso aplique, me avise.");
  // ... an event, or an act with its subject, doesn't
  none("Se o CI mesclar, me avise.");
  none("Se não falhar, me avise.");
  // B1: "Quando terminar, me avise." asks, as documented ("quando" isn't read)
  one("Quando terminar, me avise.");
  // the table of verification #5 holds
  none("Se falhar, me avise.");
  none("Caso o CI falhe, me avise.");
  none("Se der erro, me avisa.");
  none("Me avise caso falhe.");
  none("Me avise caso o CI falhe.");
  none("Ele não decide, você decide.");
  none("Me avise se falhar.");
  one("Se quiser, me avise.");
  one("Caso aprove, me avise.");
  one("Me avise caso aprove.");
  one("Me avise caso queira que eu mescle.");
  one("Você decide.");
  one("Me avise.");
  one("Não está ok?");
});

test("\"Me avise caso precise de algo.\" and \"Me avise se não gostar.\" ask (P87 #6, B1 and B2)", () => {
  const none = (x: string) => expect(asks(x)).toEqual([]);
  const one = (x: string) => expect(asks(x)).toEqual([x]);
  // B1: a need of the user's
  one("Me avise caso precise de algo.");
  one("Me avise se precisar de algo.");
  one("Caso precise de algo, me avise.");
  one("Se você precisar de mais tempo, me avise.");
  // B2: a liking, also denied
  one("Me avise se não gostar.");
  one("Se não gostar, me avise.");
  one("Me avise caso goste.");
  // ... with a subject, an event: no request
  none("Se o CI precisar de mais tempo, me avise.");
  none("Me avise caso o deploy precise de aprovação.");
  // no regression
  none("Se falhar, me avise.");
  none("Se não falhar, me avise.");
  none("Se o CI mesclar, me avise.");
  one("Me avise caso discorde.");
  one("Me avise caso não queira.");
  one("Se mesclar, me avise.");
  one("Me avise.");
  one("Se quiser, me avise.");
});
