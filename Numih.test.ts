// Numih.test
// ==========
// `bun test Numih.test.ts`: the Numih rules in a Numih subagent's system
// prompt (Numih.ts, P119 phase 2): the pack read from a reference copy
// made here (never the real ~/.unii/numih: TestSetup.ts points it into
// the run's dir), whole, with its index of the rules by path, its size
// in bytes and its log line; the notice instead when it is missing,
// empty or above the ceiling; the spawn tool's `numih`, kept in the
// agent's note so a restart keeps it; the same system prompt reaching
// Claude Code (ClaudeSub.options) and the Cursor CLI (Cursor.room's
// unii.mdc); the cursor's skills in every task (Machine.skills), but
// claude-mem-memory. The AI is a fake that never ends a subagent's call.

import { afterAll, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AskAI, type Ask } from "./AskAI.ts";
import { ClaudeSub } from "./ClaudeSub.ts";
import * as config from "./Config.ts";
import { Cursor } from "./Cursor.ts";
import { Machine } from "./Machine.ts";
import { Memory } from "./Memory.ts";
import { BY_PATH, CORE, NUMIH, Numih } from "./Numih.ts";
import * as Pipeline from "./Pipeline.ts";
import { Chat } from "./Server.ts";
import { PROMPTS, Tools } from "./Tools.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}

const TMP = fs.mkdtempSync(os.tmpdir() + "/unii-numih-");
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(config.DIR, { recursive: true, force: true });
  fs.mkdirSync(config.DIR, { recursive: true });
});

// the core: a text with accents, a line only the core has
const NUCLEO = "<!-- GERADO -->\n\n# Convenção de Branch e PR\n\n`{tipo}/{descricao_breve}_{num-xx}`\n\nLINHA-SÓ-DO-NÚCLEO\n";

// a reference copy: the core, two rules by path and the core's own
// file among them (left out of the index), a git dir at `sha`
function copy(name: string, opt: { core?: string | null; rules?: boolean; sha?: string; packed?: boolean } = {}): string {
  const home = path.join(TMP, name);
  const core = path.join(home, CORE);
  fs.mkdirSync(path.dirname(core), { recursive: true });
  if (opt.core !== null) {
    fs.writeFileSync(core, opt.core ?? NUCLEO);
  }
  if (opt.rules !== false) {
    const dir = path.join(home, BY_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "20-goose-migrations.md"), "---\npaths:\n  - \"**/migrations/*.sql\"\n  - \"**/server/cmd/server/migrations/*.sql\"\n---\n\n# Guia Obrigatório: Goose Migrations\n\ncorpo\n");
    fs.writeFileSync(path.join(dir, "25-isolamento-de-testes.md"), "---\npaths:\n  - '**/*_test.go'\n---\n# Isolamento de testes\n");
    fs.writeFileSync(path.join(dir, "_numih-nucleo.md"), "# Núcleo\n" + NUCLEO);
    fs.writeFileSync(path.join(dir, "leia-me.txt"), "não é regra\n");
  }
  const git = path.join(home, "cursor/.git");
  fs.mkdirSync(path.join(git, "refs/heads"), { recursive: true });
  fs.writeFileSync(path.join(git, "HEAD"), "ref: refs/heads/main\n");
  const sha = opt.sha ?? "76183bd0123456789abcdef0123456789abcdef0";
  if (opt.packed) {
    fs.writeFileSync(path.join(git, "packed-refs"), "# pack-refs with: peeled fully-peeled sorted\n" + sha + " refs/heads/main\n");
  } else {
    fs.writeFileSync(path.join(git, "refs/heads/main"), sha + "\n");
  }
  return home;
}

test("pack: the core whole, after a head and the index of the rules by path; its bytes are the UTF-8 text's", () => {
  const home = copy("inteiro");
  const pack = Numih.pack(home, 1_000_000);
  expect(pack.injected).toBe(true);
  expect(pack.why).toBe("");
  expect(pack.commit).toBe("76183bd");
  expect(pack.text.startsWith("# Regras da Numih\n\nEsta tarefa é da Numih:")).toBe(true);
  expect(pack.text).toContain("Numih/cursor (commit 76183bd), na cópia de referência em " + path.join(home, "cursor"));
  // the core, whole and last, trimmed
  expect(pack.text.endsWith("## Núcleo (sempre ativo)\n\n" + NUCLEO.trim() + "\n")).toBe(true);
  expect(pack.bytes).toBe(Buffer.byteLength(pack.text, "utf8"));
  expect(pack.bytes).toBeGreaterThan(pack.text.length); // accents: more bytes than code units
  // the index: each rule with its title, its patterns and its file; the
  // core's own file and what is no .md, out
  const dir = path.join(home, BY_PATH);
  expect(pack.text).toContain("- 20-goose-migrations (Guia Obrigatório: Goose Migrations): `**/migrations/*.sql`, `**/server/cmd/server/migrations/*.sql`. Arquivo: " + path.join(dir, "20-goose-migrations.md"));
  expect(pack.text).toContain("- 25-isolamento-de-testes (Isolamento de testes): `**/*_test.go`. Arquivo: " + path.join(dir, "25-isolamento-de-testes.md"));
  expect(pack.text).not.toContain("_numih-nucleo");
  expect(pack.text).not.toContain("leia-me");
  expect(pack.text.indexOf("## Regras por caminho")).toBeLessThan(pack.text.indexOf("## Núcleo (sempre ativo)"));
  expect(pack.text.split("LINHA-SÓ-DO-NÚCLEO").length).toBe(2); // once: not the core's copy among the rules too
});

test("pack: the ceiling is numih_rules_max bytes; one byte more is no injection, never a cut", () => {
  const home = copy("teto");
  const whole = Numih.pack(home, 1_000_000);
  expect(Numih.pack(home, whole.bytes)).toEqual(whole);
  const over = Numih.pack(home, whole.bytes - 1);
  expect(over.injected).toBe(false);
  expect(over.commit).toBe("76183bd");
  expect(over.why).toBe("o pacote tem " + whole.bytes + " bytes e passa do teto de " + (whole.bytes - 1) + " bytes (configuração numih_rules_max)");
  expect(over.text).not.toContain("LINHA-SÓ-DO-NÚCLEO");
  expect(over.text).toContain("não foram injetadas neste prompt: " + over.why + ".");
  expect(over.text).toContain("leia por inteiro " + path.join(home, CORE));
  expect(over.text).toContain(path.join(home, BY_PATH));
  expect(over.bytes).toBe(Buffer.byteLength(over.text, "utf8"));
});

test("pack: missing, unreadable or empty core: a notice that forbids changing a Numih repo and says how to get the rules", () => {
  const none = Numih.pack(path.join(TMP, "nada"), 1_000_000);
  expect(none.injected).toBe(false);
  expect(none.commit).toBe("");
  expect(none.why).toBe(path.join(TMP, "nada", CORE) + " não existe");
  expect(none.text).toContain("Sem elas, não faça commit, push nem PR em repositório da Numih");
  expect(none.text).toContain("`numih-sync sync`");
  expect(none.bytes).toBe(Buffer.byteLength(none.text, "utf8"));
  const empty = Numih.pack(copy("vazio", { core: " \n\n" }), 1_000_000);
  expect(empty.injected).toBe(false);
  expect(empty.why).toEndWith(" está vazio");
  const dir = copy("diretorio", { core: null });
  fs.mkdirSync(path.join(dir, CORE));
  const odd = Numih.pack(dir, 1_000_000);
  expect(odd.injected).toBe(false);
  expect(odd.why).toBe(path.join(dir, CORE) + " não pôde ser lido (EISDIR)");
});

test("pack: without the rules by path, the core still goes, the index says why it is missing", () => {
  const pack = Numih.pack(copy("sem-indice", { rules: false }), 1_000_000);
  expect(pack.injected).toBe(true);
  expect(pack.text).toContain("Índice indisponível: " + path.join(TMP, "sem-indice", BY_PATH) + " não pôde ser lido.");
  expect(pack.text).toContain("LINHA-SÓ-DO-NÚCLEO");
  const bare = copy("indice-vazio", { rules: false });
  fs.mkdirSync(path.join(bare, BY_PATH), { recursive: true });
  expect(Numih.pack(bare, 1_000_000).text).toContain("não tem nenhuma regra.");
});

test("commit: from the ref's file, else packed-refs, a detached HEAD; unknown: '' and the head says so", () => {
  expect(Numih.commit(copy("packed", { packed: true, sha: "abcdef0123456789abcdef0123456789abcdef01" }))).toBe("abcdef0");
  const det = copy("detached");
  fs.writeFileSync(path.join(det, "cursor/.git/HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
  expect(Numih.commit(det)).toBe("0123456");
  const bad = copy("ruim", { sha: "não é sha" });
  expect(Numih.commit(bad)).toBe("");
  expect(Numih.pack(bad, 1_000_000).text).toContain("Numih/cursor (commit desconhecido)");
  const up = copy("fora");
  fs.writeFileSync(path.join(up, "cursor/.git/HEAD"), "ref: refs/../../../x\n");
  fs.writeFileSync(path.join(up, "x"), "1111111111111111111111111111111111111111\n"); // what that ref would reach
  expect(Numih.commit(up)).toBe("");
  expect(Numih.commit(path.join(TMP, "nada"))).toBe("");
});

test("rule_head: the title after the frontmatter, its paths: or globs: list, quoted or not", () => {
  expect(Numih.rule_head("---\npaths:\n  - \"a/**\"\n  - 'b'\n  - c\ndescription: x\n  - fora\n---\n# Título  aqui\n")).toEqual({ title: "Título aqui", paths: ["a/**", "b", "c"] });
  expect(Numih.rule_head("---\nglobs:\n  - x.ts\n---\n")).toEqual({ title: "", paths: ["x.ts"] });
  expect(Numih.rule_head("# Só título\n")).toEqual({ title: "Só título", paths: [] });
  // the frontmatter's own "# " is not the title
  expect(Numih.rule_head("---\n# comentário\n---\n# Título\n").title).toBe("Título");
});

test("log_line: the bytes injected and the commit; or why not", () => {
  expect(Numih.log_line("Ana", { text: "x", bytes: 79123, injected: true, commit: "76183bd", why: "" })).toBe("unii: regras da Numih para Ana: 79123 bytes injetados (cursor 76183bd)");
  expect(Numih.log_line("Ana", { text: "x", bytes: 12, injected: true, commit: "", why: "" })).toBe("unii: regras da Numih para Ana: 12 bytes injetados (cursor commit desconhecido)");
  expect(Numih.log_line("Bia", { text: "aviso", bytes: 300, injected: false, commit: "", why: "/x não existe" })).toBe("unii: regras da Numih para Bia: não injetadas (/x não existe); aviso de 300 bytes no lugar");
});

test("numih_max: a whole number above 0, else 131072; config's defaults", () => {
  expect(config.numih_max("80000")).toBe(80000);
  expect(config.numih_max(" 5 ")).toBe(5);
  for (const bad of ["0", "-1", "1.5", "abc", "", " ", "1e400"]) {
    expect(config.numih_max(bad)).toBe(131072);
  }
  expect(config.NUMIH_RULES_MAX).toBe(131072);
  expect(config.NUMIH_HOME).toBe(process.env.UNII_NUMIH_HOME!);
  expect(config.NUMIH_HOME.startsWith("/tmp/")).toBe(true);
});

// Agents
// ------

// every subagent call's Ask; none ends
const ASKS: Ask[] = [];
const REAL_START = AskAI.start;
(AskAI as any).ask = (ask: Ask) => {
  ASKS.push(ask);
  const done = ask.agent ? new Promise(() => {}) : Promise.resolve({ ok: true, text: "a summary", left: [] });
  return { send: () => {}, stop: () => {}, wake: () => {}, done };
};

const chat = Chat.open() as any;
const tools: Tools = chat.tools;
const call = (name: string, args: object) => Tools.call(tools, "main", name, args, new AbortController().signal, "id-" + Math.random());

// the Ask of the agent last started: its first call is asked as it starts
const last_ask = () => ASKS.filter((a) => a.agent).at(-1)!;

// the names a spawn's answer gives
const started = (text: string) => [...text.matchAll(/\b([A-Z][a-z]+[A-Z][a-z]+)\b/g)].map((m) => m[1]).filter((n) => n !== "Started" && n !== "Each");

test("spawn numih: the rules in the system prompt, after SUB, before the user's prompt; logged with their bytes", async () => {
  const home = copy("agentes");
  NUMIH.home = home;
  NUMIH.max = 1_000_000;
  fs.writeFileSync(PROMPTS.prompt.file, "PROMPT-DO-USUÁRIO");
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const out = await call("spawn", { tasks: ["tarefa numih"], labels: ["num-37-impl"], numih: true });
    expect(out.fail).toBe(false);
    const [name] = started(out.text);
    const ask = last_ask();
    const pack = Numih.pack(home, 1_000_000);
    expect(ask.system).toContain(pack.text.trim());
    expect(ask.system.startsWith("You are a subagent of Unii")).toBe(true);
    expect(ask.system.indexOf("# Regras da Numih")).toBeLessThan(ask.system.indexOf("Unii's own prompt follows"));
    expect(ask.system.endsWith("\n\nPROMPT-DO-USUÁRIO")).toBe(true);
    expect(ask.agent).toBe(true);
    const lines = log.mock.calls.map((c) => c.map(String).join(" "));
    expect(lines).toContain("unii: regras da Numih para " + name + ": " + pack.bytes + " bytes injetados (cursor 76183bd)");
    // its note says it, before the label
    expect(Memory.agent(chat.mem, name)![0]).toMatchObject({ kind: "note", text: "subagent with the Numih rules, labeled num-37-impl" });
  } finally {
    log.mockRestore();
  }
});

test("spawn without numih, or numih false: no rules, no log; numih not a boolean: refused", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    for (const args of [{ tasks: ["tarefa comum"], labels: ["uniichat-x-impl"] }, { tasks: ["tarefa falsa"], labels: ["uniichat-y-impl"], numih: false }]) {
      const out = await call("spawn", args);
      const [name] = started(out.text);
      const ask = last_ask();
      expect(ask.system).not.toContain("Regras da Numih");
      expect(ask.system).not.toContain("LINHA-SÓ-DO-NÚCLEO");
      expect(Memory.agent(chat.mem, name)![0].text).toBe("subagent, labeled " + args.labels[0]);
    }
    expect(log.mock.calls.some((c) => String(c[0]).includes("regras da Numih"))).toBe(false);
    const bad = await call("spawn", { tasks: ["x"], numih: "sim" });
    expect(bad).toEqual({ text: "numih is true or false.", fail: true });
  } finally {
    log.mockRestore();
  }
});

test("spawn numih with no pack: the notice in its place, the log says why", async () => {
  NUMIH.home = path.join(TMP, "nada");
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const [name] = started((await call("spawn", { tasks: ["sem pacote"], labels: ["num-38-impl"], numih: true, effort: "high" })).text);
    const ask = last_ask();
    expect(ask.system).toContain("As regras da Numih não foram injetadas neste prompt: " + path.join(TMP, "nada", CORE) + " não existe.");
    expect(ask.system).toContain("não faça commit, push nem PR");
    const notice = Numih.pack(NUMIH.home, NUMIH.max);
    expect(log.mock.calls.map((c) => String(c[0]))).toContain("unii: regras da Numih para " + name + ": não injetadas (" + notice.why + "); aviso de " + notice.bytes + " bytes no lugar");
    expect(Memory.agent(chat.mem, name)![0].text).toBe("subagent at effort high with the Numih rules, labeled num-38-impl");
  } finally {
    log.mockRestore();
  }
});

test("a restart keeps numih: the agent read back from its note gets the rules again, its label and effort too", async () => {
  NUMIH.home = path.join(TMP, "agentes");
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const [name] = started((await call("spawn", { tasks: ["volta"], labels: ["num-39-verif"], numih: true, effort: "low" })).text);
    tools.agents.delete(name);
    const back = Tools.agent(tools, name)!;
    expect(back.role).toEqual({ effort: "low", model: null, numih: true });
    expect(back.label).toBe("num-39-verif");
    expect(Tools.ask(tools, back).system).toContain("LINHA-SÓ-DO-NÚCLEO");
    // one without, read back: none
    const [plain] = started((await call("spawn", { tasks: ["volta comum"], labels: ["uniichat-z-impl"] })).text);
    tools.agents.delete(plain);
    const other = Tools.agent(tools, plain)!;
    expect(other.role.numih).toBe(false);
    expect(Tools.ask(tools, other).system).not.toContain("Regras da Numih");
    // an old note, from before numih: read the same
    expect(Tools.labels(chat.mem).get(name)).toBe("num-39-verif");
  } finally {
    log.mockRestore();
  }
});

test("the pipeline reads a numih note's label and model", () => {
  const raw = { note: "subagent on opus-5.5 at effort high with the Numih rules, labeled num-40-verif", task: "t", report: "", last: "unii", start: "2026-10-27T00:00:00Z", end: "2026-10-27T00:00:00Z" };
  const run = Pipeline.run_of("Ana", raw as any, true, []);
  expect(run.label).toBe("num-40-verif");
  expect(run.model).toBe("opus-5.5");
  expect(run.role).toBe("verif");
});

// Vendors
// -------

test("the same system prompt reaches Claude Code (systemPrompt) and the Cursor CLI (.cursor/rules/unii.mdc)", async () => {
  NUMIH.home = path.join(TMP, "agentes");
  const log = spyOn(console, "log").mockImplementation(() => {});
  const got: Ask[] = [];
  const fake = (ask: Ask) => {
    got.push(ask);
    return { send: () => {}, stop: () => {}, wake: () => {}, done: Promise.resolve({ ok: true, text: "", left: [] }) };
  };
  const was = { claude: ClaudeSub.ask, cursor: Cursor.ask };
  (ClaudeSub as any).ask = fake;
  (Cursor as any).ask = fake;
  try {
    const [name] = started((await call("spawn", { tasks: ["fornecedores"], labels: ["num-41-impl"], numih: true })).text);
    const ask = Tools.ask(tools, Tools.agent(tools, name)!);
    const rules = Numih.pack(NUMIH.home, NUMIH.max).text.trim();
    expect(ask.system).toContain(rules);
    // AskAI's dispatch hands each vendor the Ask as is
    REAL_START({ ...ask, vendor: "claude-sub" }, () => {});
    REAL_START({ ...ask, vendor: "cursor" }, () => {});
    expect(got.map((a) => a.vendor)).toEqual(["claude-sub", "cursor"]);
    expect(got.every((a) => a.system === ask.system)).toBe(true);
    // Claude Code: its system prompt
    const opts = ClaudeSub.options(got[0], new AbortController(), []);
    expect(opts.systemPrompt).toBe(ask.system);
    expect(String(opts.systemPrompt)).toContain("LINHA-SÓ-DO-NÚCLEO");
    // the Cursor CLI: an always-on rule in its call's workspace
    const room = Cursor.room(got[1]);
    try {
      const mdc = fs.readFileSync(path.join(room.work, ".cursor", "rules", "unii.mdc"), "utf8");
      expect(mdc).toBe("---\ndescription: Unii\nalwaysApply: true\n---\n" + ask.system + "\n");
      expect(mdc).toContain(rules);
    } finally {
      fs.rmSync(room.dir, { recursive: true, force: true });
    }
  } finally {
    (ClaudeSub as any).ask = was.claude;
    (Cursor as any).ask = was.cursor;
    log.mockRestore();
  }
});

// Skills
// ------

// a skill dir: <root>/<dir>/SKILL.md named `name`
function skill(root: string, dir: string, name: string, description = "descrição de " + name): void {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, "SKILL.md"), "---\nname: " + name + "\ndescription: " + description + "\n---\n# " + name + "\n");
}

test("skills: the Numih cursor's in every task, after the user's and the project's; claude-mem-memory out, by dir or by name", () => {
  const home = path.join(TMP, "casa");
  const dir = path.join(TMP, "projeto");
  const numih = Machine.numih_skills(home, {});
  expect(numih).toBe(home + "/.unii/numih/cursor/dist/claude-plugin/skills");
  skill(numih, "criar-issue-linear", "criar-issue-linear", "Cria issue no Linear");
  skill(numih, "resolver-issues-linear-mcp", "resolver-issues-linear-mcp");
  skill(numih, "claude-mem-memory", "claude-mem-memory");
  skill(numih, "outra-pasta", "claude-mem-memory");
  skill(numih, "ritsu", "ritsu", "do cursor");
  skill(home + "/.agents/skills", "ritsu", "ritsu", "do usuário");
  skill(dir + "/.agents/skills", "local", "local");
  const got = Machine.skills(home, dir, numih);
  expect(got.map((s) => s.name)).toEqual(["ritsu", "local", "criar-issue-linear", "resolver-issues-linear-mcp"]);
  expect(got.find((s) => s.name === "ritsu")!.description).toBe("do usuário");
  expect(got.find((s) => s.name === "criar-issue-linear")).toEqual({ name: "criar-issue-linear", description: "Cria issue no Linear", dir: path.join(numih, "criar-issue-linear") });
  // by default, where $NUMIH_HOME says (the device's job: Machine.skills
  // with its home); the skill tool loads one of the cursor's
  const was = process.env.NUMIH_HOME;
  process.env.NUMIH_HOME = home + "/.unii/numih";
  try {
    expect(Machine.skills(home, dir)).toEqual(got);
    const out = Machine.skill(home, dir, "criar-issue-linear");
    expect(out.fail).toBe(false);
    expect(out.text).toContain("Skill criar-issue-linear, in " + path.join(numih, "criar-issue-linear"));
    expect(Machine.skill(home, dir, "claude-mem-memory").fail).toBe(true);
  } finally {
    process.env.NUMIH_HOME = was;
  }
  // elsewhere, none of them
  expect(Machine.skills(home, dir).map((s) => s.name)).toEqual(["ritsu", "local"]);
  // a user's claude-mem-memory is the user's: kept
  skill(home + "/.agents/skills", "claude-mem-memory", "claude-mem-memory");
  expect(Machine.skills(home, dir, numih).map((s) => s.name)).toContain("claude-mem-memory");
});

test("skills: a frontmatter strict YAML refuses (\": \" in a plain value) read line by line; quotes gone; with no description, still out", () => {
  const root = path.join(TMP, "frouxas");
  const put = (dir: string, head: string) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "SKILL.md"), "---\n" + head + "\n---\n# corpo\n");
  };
  put("configurar-ambiente-modulo", "name: configurar-ambiente-modulo\ndescription: Gerencia ambiente Numih: sobe a stack do devtools. Use quando: subir ambiente\nversion: 1.0");
  put("aspas", "name: 'aspas'\ndescription: \"Com: aspas\"\nx: [quebrado");
  put("sem-descricao", "name: sem-descricao\nx: a: b");
  put("estrita", "name: estrita\ndescription: >\n  em duas\n  linhas");
  put("dupla", "name: dupla\ndescription: primeira: sim\ndescription: segunda");
  const got = Machine.skills(path.join(TMP, "ninguem"), path.join(TMP, "nenhum"), root);
  expect(got.map((s) => [s.name, s.description])).toEqual([
    ["aspas", "Com: aspas"],
    ["configurar-ambiente-modulo", "Gerencia ambiente Numih: sobe a stack do devtools. Use quando: subir ambiente"],
    ["dupla", "primeira: sim"],
    ["estrita", "em duas linhas"],
  ]);
});

test("numih_skills: $NUMIH_HOME if absolute, as numih-sync reads it; else ~/.unii/numih", () => {
  expect(Machine.numih_skills("/h", { NUMIH_HOME: "/outro/lugar/" })).toBe("/outro/lugar/cursor/dist/claude-plugin/skills");
  expect(Machine.numih_skills("/h", { NUMIH_HOME: "relativo" })).toBe("/h/.unii/numih/cursor/dist/claude-plugin/skills");
  expect(Machine.numih_skills("/h", { NUMIH_HOME: "" })).toBe("/h/.unii/numih/cursor/dist/claude-plugin/skills");
  expect(Machine.numih_skills("/h", {})).toBe("/h/.unii/numih/cursor/dist/claude-plugin/skills");
  // the run's: TestSetup.ts's, never the real copies
  expect(Machine.numih_skills(os.homedir()).startsWith("/tmp/")).toBe(true);
});
