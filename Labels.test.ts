// Labels.test
// ===========
// `UNII_DIR=$(mktemp -d /tmp/x-XXXX) bun test Labels.test.ts`: a
// subagent's label (Tools.start): kept in its log's note, so it outlives
// a restart; told to the views (State.labels) and to Unii (Agents at work
// now, spawn's answer); shown where people read an agent, its generated
// name after it; agents without one as before. The AI is a fake that
// never ends a subagent's call, so they stay at work.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { AskAI, type Ask } from "./AskAI.ts";
import * as Call from "./Call.ts";
import * as config from "./Config.ts";
import { Memory } from "./Memory.ts";
import * as Paint from "./Paint.ts";
import { Chat } from "./Server.ts";
import { Tools } from "./Tools.ts";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";

if (!config.DIR.startsWith("/tmp/")) {
  throw new Error("run with UNII_DIR in /tmp: " + config.DIR);
}
// emptied, not removed: a flush (Disk.ts) syncs the dir itself, and
// may come later; TestSetup.ts removes it as the run ends
afterAll(() => {
  fs.rmSync(config.DIR, { recursive: true, force: true });
  fs.mkdirSync(config.DIR, { recursive: true });
});

// a subagent's call never ends (it stays at work); others end at once
(AskAI as any).ask = (ask: Ask) => {
  const done = ask.agent ? new Promise(() => {}) : Promise.resolve({ ok: true, text: "a summary", left: [] });
  return { send: () => {}, stop: () => {}, wake: () => {}, done };
};

const chat = Chat.open() as any;
const tools: Tools = chat.tools;
const call = (name: string, args: object) => Tools.call(tools, "main", name, args, new AbortController().signal, "id-" + Math.random());

// the view a state makes
function viewed(): View.View {
  const v = View.view_new();
  View.view_hear(v, JSON.parse(JSON.stringify(Chat.state(chat))));
  return v;
}

let A = "";
let B = "";
let C = "";

test("label_clean: one line, trimmed, at most 60 characters; empty is none", () => {
  expect(Tools.label_clean("  num-3182 \n verificador\t ")).toBe("num-3182 verificador");
  expect(Tools.label_clean("a\u0007b\u001b[31mc d\u0085e")).toBe("a b [31mc d e");
  expect(Tools.label_clean(" \n ")).toBeNull();
  expect(Tools.label_clean("")).toBeNull();
  expect(Array.from(Tools.label_clean("é".repeat(80) + "😀")!).length).toBe(60);
  expect(Tools.label_clean("x".repeat(59) + "😀😀")).toBe("x".repeat(59) + "😀");
});

test("spawn with labels: the answer names each with its label; one without stays bare", async () => {
  const out = await call("spawn", { tasks: ["tarefa a", "tarefa b", "tarefa c"], labels: ["num-3182-verificador", " uniichat \n links "] });
  expect(out.fail).toBe(false);
  const m = /^Started (\w+) \(num-3182-verificador\), (\w+) \(uniichat links\), (\w+)\. /.exec(out.text);
  expect(m).not.toBeNull();
  [A, B, C] = [m![1], m![2], m![3]];
  expect(tools.agents.get(A)!.label).toBe("num-3182-verificador");
  expect(tools.agents.get(C)!.label).toBeNull();
});

test("the note keeps the label, after model and effort; one without as before", async () => {
  expect(Memory.agent(chat.mem, A)![0]).toMatchObject({ kind: "note", text: "subagent, labeled num-3182-verificador" });
  expect(Memory.agent(chat.mem, C)![0].text).toBe("subagent");
  const out = await call("spawn", { tasks: ["d"], labels: ["com modelo"], effort: "high" });
  const d = /^Started (\w+)/.exec(out.text)![1];
  expect(Memory.agent(chat.mem, d)![0].text).toBe("subagent at effort high, labeled com modelo");
});

test("Agents at work now names the labeled ones with their label", () => {
  const text = Tools.at_work(tools).text;
  expect(text).toContain(A + " (num-3182-verificador)");
  expect(text).toContain(B + " (uniichat links)");
  expect(text).toMatch(new RegExp(C + "[,.]"));
});

test("state tells every label; tabs show the label, the name after it", () => {
  const v = viewed();
  expect(v.labels![A]).toBe("num-3182-verificador");
  expect(v.labels![C]).toBeUndefined();
  const tabs = View.view_tabs(v);
  const a = tabs.find((t) => t.name === A)!;
  expect(a.text).toEndWith(" num-3182-verificador");
  expect(a.sub).toBe(A);
  const c = tabs.find((t) => t.name === C)!;
  expect(c.text).toEndWith(" " + C);
  expect(c.sub).toBeUndefined();
  expect(Html.tabs_html(tabs).find((h) => h.includes("num-3182"))).toContain("<small>" + A + "</small>");
});

test("tell, stop and zoom still take the generated name", async () => {
  expect((await call("tell", { name: A, message: "oi" })).text).toStartWith("Sent. " + A);
  expect((await call("zoom", { id: A })).text).toContain("labeled num-3182-verificador");
  expect((await call("tell", { name: "num-3182-verificador", message: "oi" })).text).toStartWith("No agent");
});

test("a restart reads the labels back from the notes; an agent taken back keeps its label", () => {
  const again = Tools.labels(chat.mem);
  expect(again.get(A)).toBe("num-3182-verificador");
  expect(again.get(B)).toBe("uniichat links");
  expect(again.has(C)).toBe(false);
  const other = { ...tools, agents: new Map(), labels: again };
  expect(Tools.agent(other, A)!.label).toBe("num-3182-verificador");
  expect(Tools.agent(other, C)!.label).toBeNull();
  expect(Tools.agent(other, C)!.role).toEqual({ effort: null, model: null, numih: false });
});

test("old notes (before labels) read as before", () => {
  const dir = chat.mem.dir + "/docs/agent/";
  fs.writeFileSync(dir + "OldOwl.jsonl", JSON.stringify(Memory.root(0, { kind: "note", text: "subagent on opus-5.5 at effort high" })) + "\n");
  fs.writeFileSync(dir + "EmptyEel.jsonl", "");
  fs.writeFileSync(dir + "BadBat.jsonl", "{not json\n");
  const again = Tools.labels(chat.mem);
  expect(again.has("OldOwl")).toBe(false);
  const other = { ...tools, agents: new Map(), labels: again };
  const old = Tools.agent(other, "OldOwl")!;
  expect(old.label).toBeNull();
  expect(old.role).toEqual({ effort: "high", model: "opus-5.5", numih: false });
});

test("a report and a [Name] show the label, the name after it; unknown names as before", () => {
  viewed(); // the labels known
  const rows = View.entry_rows(1, "work", Call.report_text(A, "feito"));
  expect((rows[0] as any).who).toBe("num-3182-verificador (" + A + ")");
  expect((View.entry_rows(2, "work", Call.report_text("Timer ab12", "x"))[0] as any).who).toBe("Timer ab12");
  const html = Html.row_html(View.entry_rows(3, "unii", "veja [" + A + "] e [" + C + "]")[0]);
  expect(html).toContain("[num-3182-verificador <small>" + A + "</small>]");
  expect(html).toContain("[" + C + "]");
  const ansi = Paint.rows_lines([View.entry_rows(4, "unii", "veja [" + A + "]")[0]], 80).map((l) => Paint.line_ansi(l)).join("\n");
  expect(ansi.replace(/\x1b\[[0-9;]*m/g, "")).toContain("[num-3182-verificador " + A + "]");
});

test("labels are escaped in HTML and cleaned in the terminal", async () => {
  const out = await call("spawn", { tasks: ["e"], labels: ["<img src=x onerror=alert(1)>\"&"] });
  const e = /^Started (\w+)/.exec(out.text)![1];
  const v = viewed();
  const html = Html.tabs_html(View.view_tabs(v)).join("") + Html.row_html(View.entry_rows(5, "unii", "[" + e + "]")[0]);
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&amp;");
  const line = Paint.line_ansi(Paint.tabs_line(v, 400)).replace(/\x1b\[[0-9;]*m/g, "");
  expect(line).toContain("<img src=x onerror=alert(1)>\"& " + e);
  expect(line).not.toContain("\x1b");
});

test("the spawn call shows its labels", () => {
  const c = Call.call_parse('spawn {"tasks":["a","b"],"labels":["x-impl","y-verif"],"model":"opus-5.5"}');
  expect(c.head).toBe("2 agents: x-impl, y-verif · opus-5.5");
  expect(Call.call_parse('spawn {"tasks":["a"]}').head).toBe("1 agent");
});

// Correções após a verificação de 9364973 (CleverBagel)
// ------------------------------------------------------

// a view whose agents are given: name -> label ("" none), at work or done
function view_of(work: Record<string, string>, done: Record<string, string> = {}): View.View {
  const v = View.view_new();
  const labels = Object.fromEntries(Object.entries({ ...work, ...done }).filter(([, l]) => l !== ""));
  View.view_hear(v, JSON.parse(JSON.stringify({ ...Chat.state(chat), agents: Object.keys(work), labels })));
  return v;
}

test("agent_find: a shared prefix acts on none and lists them; exact name or unique label acts", () => {
  const v = view_of({ FooCat: "uniichat-avaliacao-pr37", BarDog: "uniichat-implementacao-nomes", BazEel: "num-3182-verificador" }, { OldOwl: "uniichat-verificador-pendencias" });
  expect(View.agent_find(v, "uniichat")).toEqual({ many: ["FooCat", "BarDog"] });
  expect(View.agents_many("uniichat", ["FooCat", "BarDog"])).toContain("uniichat-avaliacao-pr37 (FooCat), uniichat-implementacao-nomes (BarDog)");
  expect(View.agent_find(v, "uniichat-impl")).toEqual({ name: "BarDog" });
  expect(View.agent_find(v, "UNIICHAT-AVALIACAO-PR37")).toEqual({ name: "FooCat" });
  expect(View.agent_find(v, "bazeel")).toEqual({ name: "BazEel" });
  expect(View.agent_find(v, "num")).toEqual({ name: "BazEel" });
  expect(View.agent_find(v, "uniichat-verificador-pendencias")).toEqual({ name: "OldOwl" });
  expect(View.agent_find(v, "OldOwl")).toEqual({ name: "OldOwl" });
  expect(View.agent_find(v, "nada")).toEqual({ name: "nada" });
});

test("agent_find: names at work sharing a prefix are ambiguous too; a done one never beats one at work", () => {
  const v = view_of({ SmokyRadish: "", SmokyPepper: "x" }, { DoneDog: "smoky-velho", Done2: "smoky-velho-2" });
  expect(View.agent_find(v, "smoky")).toEqual({ many: ["SmokyRadish", "SmokyPepper"] });
  expect(View.agent_find(v, "smokyr")).toEqual({ name: "SmokyRadish" });
  expect(View.agent_find(v, "smoky-v")).toEqual({ many: ["DoneDog", "Done2"] });
  expect(View.agent_find(v, "smoky-velho")).toEqual({ name: "DoneDog" });
});

test("agent_find: a label repeated: the one at work; several at work: listed", () => {
  const v = view_of({ AaA: "igual", BbB: "outro" }, { CcC: "igual" });
  expect(View.agent_find(v, "igual")).toEqual({ name: "AaA" });
  const w = view_of({ AaA: "igual", BbB: "igual" });
  expect(View.agent_find(w, "igual")).toEqual({ many: ["AaA", "BbB"] });
});

test("labels that aren't text are none", async () => {
  const out = await call("spawn", { tasks: ["n1", "n2", "n3", "n4"], labels: [null, 7, { a: 1 }, "ok-label"] });
  const m = /^Started (\w+), (\w+), (\w+), (\w+) \(ok-label\)\. /.exec(out.text);
  expect(m).not.toBeNull();
  for (const k of [1, 2, 3]) {
    expect(tools.agents.get(m![k])!.label).toBeNull();
    expect(Memory.agent(chat.mem, m![k])![0].text).toBe("subagent");
  }
  expect(out.text).not.toMatch(/null|\[object|\(7\)/);
});

test("a note edited by hand: its label cleaned on reading (escapes, U+2028), cut to 60; the frame's title clean", () => {
  const dir = chat.mem.dir + "/docs/agent/";
  const note = (text: string) => JSON.stringify(Memory.root(0, { kind: "note", text })) + "\n";
  fs.writeFileSync(dir + "EscEel.jsonl", note("subagent on opus-5.5, labeled a\x1b]8;;http://x.com\x1b\\b\x1b[2Jc"));
  fs.writeFileSync(dir + "SepSeal.jsonl", note("subagent on opus-5.5 at effort high, labeled lin\u2028ha\u2029fim"));
  fs.writeFileSync(dir + "LongLynx.jsonl", note("subagent, labeled " + "y".repeat(500)));
  const again = Tools.labels(chat.mem);
  expect(again.get("EscEel")).not.toContain("\x1b");
  expect(again.get("SepSeal")).toBe("lin ha fim");
  expect(again.get("LongLynx")).toBe("y".repeat(60));
  const other = { ...tools, agents: new Map(), labels: again };
  const sep = Tools.agent(other, "SepSeal")!;
  expect(sep).not.toBeNull();
  expect(sep.label).toBe("lin ha fim");
  expect(sep.role).toEqual({ effort: "high", model: "opus-5.5", numih: false });
  expect(Tools.agent(other, "LongLynx")!.label).toBe("y".repeat(60));
  expect(Tools.agent(other, "EscEel")!.label).toBe(again.get("EscEel"));
  // the frame of a report, even from a state not cleaned (an older server)
  const v = View.view_new();
  View.view_hear(v, JSON.parse(JSON.stringify({ ...Chat.state(chat), labels: { EscEel: "a\x1b]8;;http://x.com\x1b\\b\x1b[2Jc" } })));
  const ansi = Paint.rows_lines(View.entry_rows(9, "work", Call.report_text("EscEel", "feito")), 80).map((l) => Paint.line_ansi(l)).join("\n");
  expect(ansi).not.toContain("\x1b[2J");
  expect(ansi).not.toContain("\x1b]8");
  expect(ansi).toContain("a]8;;http://x.com\\b[2Jc (EscEel)"); // inert text
  viewed(); // back to the true labels
});

test("label_clean cuts by grapheme: an emoji with ZWJ is never split; piled marks stay short", () => {
  const family = "👨‍👩‍👧‍👦";
  expect(Tools.label_clean("x".repeat(59) + family + family)).toBe("x".repeat(59) + family);
  expect(Tools.label_clean("x".repeat(58) + "🇧🇷🇧🇷🇧🇷")).toBe("x".repeat(58) + "🇧🇷🇧🇷");
  const zalgo = Tools.label_clean(("a" + "́".repeat(30)).repeat(60))!;
  expect(Array.from(zalgo).length).toBeLessThanOrEqual(120);
});
