// Clip.ts
var CAP = 30000;
function clip_end(str, at) {
  if (str.length - at <= CAP) {
    return str.length;
  }
  const nl = str.lastIndexOf(`
`, at + CAP - 1);
  const low = str.charCodeAt(at + CAP) >> 10 === 55;
  return nl >= at ? nl + 1 : at + CAP - (low ? 1 : 0);
}
function clip_pages(str) {
  const pages = [];
  let at = 0;
  do {
    const end = clip_end(str, at);
    pages.push(str.slice(at, end));
    at = end;
  } while (at < str.length);
  return pages;
}
async function* stream_lines(stream) {
  const reader = stream.pipeThrough(new TextDecoderStream).getReader();
  let rest = "";
  for (let got = await reader.read();!got.done; got = await reader.read()) {
    const nl = got.value.lastIndexOf(`
`);
    if (nl >= 0) {
      yield (rest + got.value.slice(0, nl)).split(`
`);
      rest = "";
    }
    rest += got.value.slice(nl + 1);
  }
  yield [rest];
}

// Import.ts
var PART = 2 ** 20;
var OLD = "Nothing new: these chats are in Unii's memory already.";
var NOT_EXPORT = "Not a Claude or ChatGPT export.";
var MIDWAY = "Meanwhile, UniiChat can answer with a partial tree.";
var DONE = "Your past chats are in Unii's memory: ask about them any time.";
var DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" });
var COUNT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 0 });
var EXPORTS = { Claude: "Settings › Privacy › Export data", ChatGPT: "Settings › Data controls › Export data" };
var INJECTED = /^(<[a-z_]+[ >]|# AGENTS\.md)/;
var SKIP = /^(<command-|<local-command|\[Request interrupted)/;
function import_file(path) {
  const session = /(^|\/)(projects|sessions|archived_sessions)\//.test(path);
  return session && path.endsWith(".jsonl") && !path.includes("subagents/");
}
async function import_session(file, form, app = "", where = "") {
  const s = { app, form, where, start: "", file, heads: [] };
  for await (const m of import_read(s)) {
    s.heads.push({ kind: m.kind, date: m.date, size: import_size(m), n: s.heads.length });
  }
  s.start = s.heads[0]?.date ?? "";
  return s.heads.length > 0 ? s : null;
}
async function* import_read(s) {
  let date = "";
  for await (const lines of stream_lines(s.file.stream())) {
    for (const line of lines) {
      const msgs = line_msgs(s, line, date);
      date = msgs.at(-1)?.date ?? date;
      yield* msgs;
    }
  }
}
function line_log(s, j, last) {
  s.app ||= j.type === "session_meta" ? "ChatGPT" : "Claude";
  return s.app === "ChatGPT" ? line_codex(s, j, last) : line_claude(s, j, last);
}
function line_msgs(s, line, last) {
  try {
    const j = JSON.parse(line);
    return s.form === "msgs" ? [j] : line_log(s, j, last);
  } catch {
    return [];
  }
}
function import_pick(sessions, want, done) {
  const old = [...sessions].sort((a, b) => a.start.localeCompare(b.start));
  const keep = (m, last) => (want.tools || m.kind === "user" || m.kind === "unii") && m.date >= want.since && import_new(m, last);
  const kept = (s, last) => s.heads.filter((m) => keep(m, last));
  return old.map((s) => ({ ...s, heads: kept(s, done[import_id(s)]) })).filter((s) => s.heads.length > 0);
}
function import_plan(sessions, want, done) {
  const all = import_pick(sessions, { ...want, since: "" }, done);
  const shown = import_pick(all, want, {});
  const picked = shown.filter((s) => !want.off.includes(import_id(s)));
  const first = all.map((s) => s.heads[0].date).sort()[0] ?? "";
  const sizes = picked.flatMap((s) => [import_size(import_note(s)), ...s.heads.map((m) => m.size)]);
  return { sessions: shown, picked, msgs: sizes.length - picked.length, first: first.slice(0, 10), sizes };
}
function import_new(m, last) {
  return last === undefined || (m.date ?? "") > last;
}
function import_name(s) {
  return s.app + " " + s.where + ", from " + new Date(s.start).toLocaleString("sv-SE").slice(0, 16);
}
function import_cells(s) {
  const day = DAY.format(new Date(s.start));
  const where = s.where.startsWith("session in ") ? path_short(s.where.slice(11)) : s.where.replace(/^chat "(.*)"$/, "$1") || "untitled";
  return [day, count_short(s.heads.length), where];
}
function count_short(n) {
  return COUNT.format(n).toLowerCase();
}
function path_short(path) {
  const parts = path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~").split("/");
  const head = parts[0] === "" ? 2 : 1;
  return parts.length - head > 3 ? [...parts.slice(0, head + 1), "…", ...parts.slice(-2)].join("/") : parts.join("/");
}
function import_note(s) {
  return { kind: "note", text: import_name(s) + " (imported)", date: s.start };
}
function import_id(s) {
  return import_key(import_note(s));
}
function import_key(note) {
  return note.date + " " + note.text.replace(/^.*?(?= session in | chat ")/, "").replace(/, from [^,]*$/, "");
}
async function* import_body(picked) {
  let part = "";
  for (const s of picked) {
    const kept = new Set(s.heads.map((m) => m.n));
    let n = 0;
    part += JSON.stringify(import_note(s)) + `
`;
    for await (const m of import_read(s)) {
      part += kept.has(n++) ? JSON.stringify(m) + `
` : "";
      if (part.length >= PART) {
        yield part;
        part = "";
      }
    }
  }
  yield part;
}
function import_size(m) {
  return new TextEncoder().encode(m.kind + ": " + m.text).length;
}
function import_count(n, what) {
  return n.toLocaleString("en-US") + " " + what + (n === 1 ? "message" : "messages");
}
async function import_export(file) {
  const zip = await file.slice(0, 2).text() === "PK";
  const json = zip ? await zip_file(file, "conversations.json") : file;
  if (json === null) {
    throw new Error("No conversations.json in the zip.");
  }
  const chats = await json.text().then(JSON.parse).catch(() => null);
  if (!Array.isArray(chats) || !chats.every((chat) => chat?.mapping !== undefined || Array.isArray(chat?.chat_messages))) {
    throw new Error(NOT_EXPORT);
  }
  const sessions = await Promise.all(chats.map(chat_session));
  return sessions.filter((s) => s !== null);
}
function chat_session(chat) {
  const [app, msgs] = chat.mapping ? ["ChatGPT", chat_openai(chat)] : ["Claude", chat_claude(chat)];
  const file = new Blob(msgs.map((m) => JSON.stringify(m) + `
`));
  return import_session(file, "msgs", app, 'chat "' + String(chat.title ?? chat.name ?? "") + '"');
}
function chat_openai(chat) {
  const nodes = [];
  for (let id = chat.current_node;id; id = chat.mapping[id]?.parent) {
    nodes.unshift(chat.mapping[id]?.message);
  }
  let date = import_date(chat.create_time, "");
  return nodes.flatMap((m) => {
    const role = m?.author?.role;
    const type = String(m?.content?.content_type);
    const kind = role === "user" ? "user" : role === "assistant" ? m.recipient === "all" ? "unii" : "tool" : role === "tool" ? "echo" : null;
    const skip = kind === null || m.metadata?.is_visually_hidden_from_conversation === true || type === "thoughts" || type === "reasoning_recap";
    date = import_date(m?.create_time, date);
    return skip ? [] : msgs_of(kind, (kind === "tool" ? m.recipient + " " : "") + parts_text(m.content.parts ?? [m.content.text]), date);
  });
}
function chat_claude(chat) {
  let date = import_date(chat.created_at, "");
  return (chat.chat_messages ?? []).flatMap((m) => {
    date = import_date(m.created_at, date);
    const kind = m.sender === "human" ? "user" : "unii";
    const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.text ?? "") }];
    const files = [...m.attachments ?? [], ...m.files ?? []].map((f) => ({ type: "text", text: "[file " + f.file_name + "]" }));
    return blocks_msgs(kind, [...blocks, ...files], date);
  });
}
async function zip_file(zip, name) {
  const view = async (at, n) => new DataView(await zip.slice(at, at + n).arrayBuffer());
  const back = Math.min(zip.size, 65577);
  const tail = await view(zip.size - back, back);
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 101010256) {
    end -= 1;
  }
  if (end < 0) {
    return null;
  }
  const wide = end >= 20 && tail.getUint32(end - 20, true) === 117853008;
  const z64 = wide ? await view(Number(tail.getBigUint64(end - 12, true)), 56) : null;
  const count = z64 === null ? tail.getUint16(end + 10, true) : Number(z64.getBigUint64(32, true));
  const size = z64 === null ? tail.getUint32(end + 12, true) : Number(z64.getBigUint64(40, true));
  const from = z64 === null ? tail.getUint32(end + 16, true) : Number(z64.getBigUint64(48, true));
  const dir = await view(from, size);
  for (let p = 0, k = 0;k < count; k++) {
    const entry = new TextDecoder().decode(new Uint8Array(dir.buffer, p + 46, dir.getUint16(p + 28, true)));
    const [, packed, at] = zip_sizes(dir, p);
    if (entry === name || entry.endsWith("/" + name)) {
      const head = await view(at, 30);
      const data = zip.slice(at + 30 + head.getUint16(26, true) + head.getUint16(28, true)).slice(0, packed);
      return dir.getUint16(p + 10, true) === 8 ? new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob() : data;
    }
    p += 46 + dir.getUint16(p + 28, true) + dir.getUint16(p + 30, true) + dir.getUint16(p + 32, true);
  }
  return null;
}
function zip_sizes(dir, p) {
  const short = [p + 24, p + 20, p + 42].map((at) => dir.getUint32(at, true));
  const extra = p + 46 + dir.getUint16(p + 28, true);
  let x = extra;
  while (x + 4 <= extra + dir.getUint16(p + 30, true) && dir.getUint16(x, true) !== 1) {
    x += 4 + dir.getUint16(x + 2, true);
  }
  let k = 0;
  return short.map((n) => n === 4294967295 ? Number(dir.getBigUint64(x + 4 + 8 * k++, true)) : n);
}
function line_claude(s, j, last) {
  const date = import_date(j.timestamp, last);
  const own = (j.type === "user" || j.type === "assistant") && !j.isMeta && !j.isSidechain && !j.isCompactSummary;
  const content = j.message?.content;
  const blocks = !own ? [] : typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  s.where ||= j.cwd ? "session in " + j.cwd : "";
  if (j.type === "attachment" && j.attachment?.type === "queued_command") {
    return msgs_of("user", String(j.attachment.prompt ?? ""), date);
  }
  return blocks_msgs(j.type === "user" ? "user" : "unii", blocks, date);
}
function blocks_msgs(kind, blocks, date) {
  const say = blocks.filter((b) => b.type === "image" || b.type === "text" && !SKIP.test(b.text));
  const tools = blocks.flatMap((b) => b.type === "tool_use" ? msgs_of("tool", b.name + " " + JSON.stringify(b.input), date) : b.type === "tool_result" ? msgs_of("echo", parts_text(b.content), date) : []);
  return [...msgs_of(kind, parts_text(say), date), ...tools];
}
function line_codex(s, j, last) {
  const p = j.payload ?? {};
  const date = import_date(j.timestamp, last);
  if (j.type === "session_meta") {
    s.where = p.source?.subagent ?? p.source?.internal ? "" : "session in " + String(p.cwd ?? "");
  }
  return j.type === "response_item" && s.where !== "" ? item_codex(p, date) : [];
}
function item_codex(p, date) {
  switch (p.type) {
    case "message": {
      const kind = p.role === "user" ? "user" : p.role === "assistant" ? "unii" : null;
      const parts = (p.content ?? []).filter((c) => !INJECTED.test(c.text ?? ""));
      return kind === null ? [] : msgs_of(kind, parts_text(parts), date);
    }
    case "function_call": {
      return msgs_of("tool", p.name + " " + p.arguments, date);
    }
    case "custom_tool_call": {
      return msgs_of("tool", p.name + " " + JSON.stringify({ input: p.input }), date);
    }
    case "local_shell_call": {
      return msgs_of("tool", "shell " + JSON.stringify({ command: p.action?.command }), date);
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      return msgs_of("echo", parts_text(p.output), date);
    }
  }
  return [];
}
function import_date(at, last) {
  const ms = typeof at === "number" ? at * 1000 : Date.parse(String(at));
  return Number.isNaN(ms) ? last : new Date(ms).toISOString();
}
function msgs_of(kind, text, date) {
  const pages = text.trim() === "" ? [] : clip_pages(text);
  return pages.map((page, k) => ({ kind, text: page, date, more: k < pages.length - 1 }));
}
function parts_text(content) {
  if (typeof content === "string") {
    return content;
  }
  const parts = Array.isArray(content) ? content : [];
  return parts.map((c) => typeof c === "string" ? c : typeof c.text === "string" ? c.text : String(c.type ?? c.content_type).includes("image") ? "[image]" : "").join(`
`);
}

// Theme.ts
var WHO = { work: "Report", note: "Note" };
var KIND = {
  user: { dim: false, it: false },
  work: { dim: false, it: false },
  unii: { dim: false, it: false },
  tool: { dim: true, it: false },
  echo: { dim: true, it: false },
  note: { dim: true, it: true },
  mind: { dim: true, it: true }
};
var TOOL = {
  zoom: "\uD83D\uDD0D",
  date: "\uD83D\uDCC5",
  shell: "⌨️",
  read: "\uD83D\uDCD6",
  write: "\uD83D\uDCC4",
  edit: "\uD83D\uDCDD",
  spawn: "\uD83E\uDD16",
  tell: "\uD83D\uDCAC",
  computer: "\uD83D\uDDB1️",
  schedule: "⏰",
  schedules: "⏰",
  unschedule: "⏰"
};
var TOOL_ANY = "\uD83D\uDD27";
var GLYPH = {
  tab: "◯",
  here: "●",
  input: "> ",
  open: "▾"
};
function tool_glyph(name) {
  return TOOL[name] ?? TOOL_ANY;
}
function theme_css() {
  return Object.entries(KIND).map(([k, look]) => look_css(k, look)).join("");
}
function look_css(kind, look) {
  const ink = look.dim ? "mid" : "ink";
  const style = look.it ? "italic" : "normal";
  const body = "--fg:var(--" + ink + ");--it:" + style;
  return ".msg." + kind + "{" + body + "}";
}

// Call.ts
var SHORT = 60;
var CALL = /^(\S+) (\{[\s\S]*)$/;
var MCP = /^mcp__.+?__/;
var READS = new Map([
  ["shell", (x) => ({ head: String(x.command ?? ""), blocks: [] })],
  ["read", (x) => ({ head: String(x.path ?? "") + lines_show(x.offset, x.limit), blocks: [] })],
  ["write", (x) => ({ head: String(x.path ?? ""), blocks: [] })],
  ["view_video", (x) => ({ head: String(x.path ?? "") + range_show(x.start, x.end, x.unit) + (x.step === undefined ? "" : " every " + x.step), blocks: [] })],
  ["edit", (x) => Array.isArray(x.edits) ? { head: edits_files(x.edits), blocks: [] } : input_shown(x)],
  ["zoom", (x) => ({ head: msg_show(x.id, x.n) + (x.at === undefined ? "" : " from char " + x.at), blocks: [] })],
  ["date", (x) => ({ head: msg_show(x.id, 1), blocks: [] })],
  ["spawn", (x) => ({ head: tasks_show(x.tasks, x.model, x.effort, x.labels), blocks: (Array.isArray(x.tasks) ? x.tasks : []).flatMap(text_block) })],
  ["tell", (x) => ({ head: String(x.name ?? ""), blocks: text_block(x.message) })],
  ["computer", (x) => ({ head: "", blocks: text_block(x.task) })],
  ["schedule", (x) => ({ head: (x.cron === undefined ? String(x.at ?? "") : "cron " + x.cron) + " " + String(x.zone ?? ""), blocks: text_block(x.message) })]
]);
function report_read(text) {
  const m = /^\[([^\]\n]+)\]\s*([\s\S]*?)(?:\s*Full chat: zoom\("[^"\n]*"\))?\s*$/.exec(text);
  return m === null ? null : { name: m[1], text: m[2] };
}
function call_parse(text) {
  const m = CALL.exec(text);
  const input = m === null ? null : input_parse(m[2]);
  if (m === null || input === null) {
    return { name: "", head: text, device: "", blocks: [] };
  }
  const name = m[1].replace(MCP, "");
  const { device, ...rest } = input;
  const shown = (READS.get(name) ?? input_shown)(rest);
  return { name, device: typeof device === "string" ? device : "", ...shown };
}
function call_line(c) {
  const blocks = c.blocks.map((b) => (b.k === "" ? "" : b.k + ": ") + b.x);
  const where = c.device === "" ? [] : ["· " + c.device];
  return [c.head, ...blocks, ...where].join(" ").replace(/\s+/g, " ").trim();
}
function call_text(c) {
  return [(c.name + " " + c.head).trim(), ...c.blocks.map((b) => b.x)].join(`
`);
}
function input_shown(input) {
  const keys = Object.keys(input);
  const args = [];
  const blocks = [];
  for (const k of keys) {
    const v = input[k];
    const json = JSON.stringify(v);
    const word = typeof v !== "string" || /^[^\s"\\]*$/.test(v);
    if (json.length <= SHORT && word) {
      args.push(json);
    } else {
      const x = typeof v === "string" ? v : JSON.stringify(v, null, 2);
      blocks.push({ $: "Code", k: keys.length > 1 ? k : "", x });
    }
  }
  return { head: args.join(" "), blocks };
}
function text_block(x) {
  return typeof x === "string" && x !== "" ? [{ $: "Code", k: "", x: x.replace(/\n$/, "") }] : [];
}
function msg_show(id, n) {
  const many = typeof n === "number" && n > 1 ? "+" + n : "";
  return typeof id === "number" ? "#" + id + many : String(id ?? "");
}
function tasks_show(tasks, model, effort, labels) {
  const n = Array.isArray(tasks) ? tasks.length : 0;
  const named = Array.isArray(labels) ? labels.filter((l) => typeof l === "string" && l.trim() !== "") : [];
  const knobs = [model, effort].filter((k) => typeof k === "string").map((k) => " · " + k).join("");
  return n + (n === 1 ? " agent" : " agents") + (named.length === 0 ? "" : ": " + named.join(", ")) + knobs;
}
function lines_show(offset, limit) {
  const from = typeof offset === "number" ? offset : 1;
  const to = typeof limit === "number" ? String(from + limit - 1) : "";
  return offset === undefined && limit === undefined ? "" : ":" + from + "-" + to;
}
function range_show(start, end, unit) {
  const s = unit === "second" ? "s" : "";
  return start === undefined && end === undefined ? "" : " " + (start ?? 0) + s + "-" + (end ?? "") + (end === undefined ? "" : s);
}
function edits_files(edits) {
  const paths = edits.map((e) => e?.path).filter((p) => typeof p === "string");
  return [...new Set(paths)].join(", ");
}
function input_parse(text) {
  const shut = [];
  let quote = false;
  let esc = false;
  let field = 0;
  for (let i = 0;i < text.length; i++) {
    const c = text[i];
    if (quote) {
      quote = esc || c !== '"';
      esc = !esc && c === "\\";
    } else if (c === '"') {
      quote = true;
    } else if (c === "{" || c === "[") {
      shut.push(c === "{" ? "}" : "]");
      field = shut.length === 1 ? i + 1 : field;
    } else if (c === "}" || c === "]") {
      shut.pop();
    } else if (c === "," && shut.length === 1) {
      field = i;
    }
  }
  const open = quote ? (esc ? text.slice(0, -1) : text) + '"' : text;
  const full = open.replace(/[\s,]*$/, "") + shut.reverse().join("");
  return object_parse(full) ?? object_parse(text.slice(0, field) + "}");
}
function object_parse(text) {
  try {
    const x = JSON.parse(text);
    return typeof x === "object" && x !== null && !Array.isArray(x) ? x : null;
  } catch {
    return null;
  }
}

// Names.ts
var ADJS = `
red blue green yellow orange purple pink brown black white gray silver golden
amber azure bronze copper jade lemon lime mint navy peach plum ruby violet
cherry honey big small tiny huge giant little tall short long round flat thick
thin deep soft hard smooth rough fuzzy fluffy shiny crunchy crispy leafy spiky
hot cold warm cool icy frosty snowy rainy sunny cloudy windy stormy foggy
misty sweet sour salty spicy juicy minty nutty creamy smoky tasty fresh bright
dark quiet loud happy jolly merry calm brave bold clever wise kind gentle
lucky proud quick swift fast slow eager busy sleepy silly funny shy neat noble
grand royal mighty strong steady nimble lively cozy old new young ancient
wooden stone paper iron magic cosmic lunar solar polar wild
`.split(/\s+/).filter(Boolean);
var NOUNS = `
ant bat bear bee beetle bird bison camel cat cheetah chicken clam cobra cougar
cow crab crane crow deer dog dolphin donkey dove dragon duck eagle eel elk
falcon finch fish flamingo fox frog gazelle gecko giraffe goat goose gorilla
hamster hare hawk hedgehog heron hippo horse hyena iguana jaguar jay kangaroo
kitten koala lamb lemur leopard lion lizard llama lobster moose moth mouse
mule octopus orca otter owl ox oyster panda parrot pelican penguin pig pigeon
pony puffin puma rabbit raccoon raven rhino robin salmon seal shark sheep
shrimp skunk sloth snail snake sparrow spider squid squirrel swan tiger toad
toucan trout tuna turkey turtle walrus wasp whale wolf wombat yak zebra apple
banana bagel cookie mango melon muffin noodle pancake pepper potato pretzel
radish taco waffle
`.split(/\s+/).filter(Boolean);
var NAME = "(?:" + ADJS.map(name_word).join("|") + ")-?(?:" + NOUNS.map(name_word).join("|") + ")";
function name_word(word) {
  return word[0].toUpperCase() + word.slice(1);
}

// Md.ts
var NAME2 = new RegExp("\\[(" + NAME + ")\\]", "g");
var HREF = /(?:https?:\/\/|mailto:|\/(?![\s\/\\]))/.source;
var CTRL = "\\x00-\\x1f\\x7f";
var HOLD = /\[[^\]\n]*\]\([^)\n]*\)/.source;
var IN = HOLD + "|[^*\\n\\[]|(?!" + HOLD + ")\\[";
var SPAN = new RegExp([
  /`([^`\n]+)`/.source,
  "\\[([^\\]\\n]+)\\]\\((<" + HREF + "[^>" + CTRL + "]*>|" + HREF + "(?:[^\\s()" + CTRL + "]|\\([^\\s()" + CTRL + "]*\\))*)" + /(?:\s+"[^"\n]*")?\)/.source,
  NAME2.source,
  "\\*\\*(?!\\*)((?:" + IN + "|\\*(?!\\*))+?)\\*\\*",
  "\\*(?![*\\s])((?:" + IN + ")+?)\\*(?![\\w*])",
  /(?:^|[\s(])(https?:\/\/(?:[^\s<()\x00-\x1f\x7f]|\([^\s<()\x00-\x1f\x7f]*\))*(?:[^\s<().,;:!?\x00-\x1f\x7f]|\([^\s<()\x00-\x1f\x7f]*\)))/.source,
  /<(https?:\/\/[^\s<>\x00-\x1f\x7f]+)>/.source
].join("|"), "g");
var LIST = /^ {0,3}([-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
var FENCE = /^\s*```/;
var HEAD = /^(#{1,6})\s+(.*)$/;
var RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
var QUOT = /^\s*>\s?/;
var ROW = /^\s*\|.*\|\s*$/;
var BAR = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
var NEW = /^\+\+\+ (.*)$/;
var READ = /^\[(lines (\d+)-\d+ of \d+[^\]]*)\]$/;
var HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
var MARKS = /^(?:\s*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)|\s*>\s?)*/;
var DEEP = 16;
function Text(x) {
  return { $: "Text", x };
}
function Name(x) {
  return { $: "Name", x };
}
function spans_by(s, re, mark, keep = () => true, lead = () => 0) {
  const out = [];
  let at = 0;
  let from = 0;
  for (;; ) {
    re.lastIndex = from;
    const m = re.exec(s);
    if (m === null) {
      break;
    }
    const i = m.index;
    if (!keep(s, m)) {
      from = i + 1;
      continue;
    }
    const j = i + lead(m);
    if (j > at) {
      out.push(Text(s.slice(at, j)));
    }
    from = at = i + m[0].length;
    out.push(mark(m));
  }
  re.lastIndex = 0;
  if (at < s.length) {
    out.push(Text(s.slice(at)));
  }
  return out;
}
function span_parse(s) {
  return spans_by(s, SPAN, span_mark, span_keep, span_lead);
}
function span_keep(s, m) {
  if (m[6] === undefined || m.index === 0) {
    return true;
  }
  return !/[*\w]/.test(s[m.index - 1]);
}
function span_lead(m) {
  return m[7] === undefined ? 0 : m[0].length - m[7].length;
}
function span_mark(m) {
  if (m[1] !== undefined) {
    return { $: "Code", x: m[1] };
  }
  if (m[2] !== undefined) {
    return { $: "Link", x: unlinked(span_parse(m[2])), k: m[3].replace(/^<(.*)>$/, "$1") };
  }
  if (m[4] !== undefined) {
    return Name(m[4]);
  }
  if (m[5] !== undefined) {
    return { $: "Bold", x: span_parse(m[5]) };
  }
  if (m[6] !== undefined) {
    return { $: "Ital", x: span_parse(m[6]) };
  }
  if (m[8] !== undefined) {
    return { $: "Link", x: [Text(m[8])], k: m[8] };
  }
  return { $: "Link", x: [Text(m[7])], k: m[7] };
}
function unlinked(spans) {
  return spans.flatMap((s) => {
    switch (s.$) {
      case "Link":
        return unlinked(s.x);
      case "Name":
        return [Text("[" + s.x + "]")];
      case "Bold":
        return [{ $: "Bold", x: unlinked(s.x) }];
      case "Ital":
        return [{ $: "Ital", x: unlinked(s.x) }];
      default:
        return [s];
    }
  });
}
function md_flat(s) {
  return span_parse(s).map(span_flat).join("");
}
function span_flat(s) {
  return typeof s.x === "string" ? s.x : s.x.map(span_flat).join("");
}
function md_plain(s) {
  const paras = s.replace(/\r/g, "").split(/\n(?:[ \t]*\n)+/);
  const kept = paras.filter((p) => p.trim() !== "");
  return kept.map((p) => ({ $: "Para", x: p.split(`
`).map(plain_line) }));
}
function plain_line(s) {
  return spans_by(s, NAME2, (m) => Name(m[1]));
}
function md_output(s) {
  const lines = s.replace(/\r/g, "").split(`
`);
  const read = READ.exec(lines[lines.length - 1]);
  if (read !== null) {
    return [{ $: "File", k: read[1], n: Number(read[2]), x: lines.slice(0, -1) }];
  }
  const out = [];
  let [i, at] = [0, 0];
  while (i < lines.length) {
    const [diff, next] = diff_parse(lines, i);
    if (diff !== null) {
      out.push(...output_lines(lines.slice(at, i)), diff);
      at = next;
    }
    i = next;
  }
  return [...out, ...output_lines(lines.slice(at))];
}
function output_lines(lines) {
  const from = lines.findIndex((l) => l.trim() !== "");
  const upto = lines.findLastIndex((l) => l.trim() !== "");
  return from < 0 ? [] : [{ $: "File", k: "result", n: 1, x: lines.slice(from, upto + 1) }];
}
function diff_parse(lines, i) {
  const file = NEW.exec(lines[i + 1] ?? "");
  const hunks = [];
  if (file === null || !lines[i].startsWith("--- ")) {
    return [null, i + 1];
  }
  let j = i + 2;
  for (let h = HUNK.exec(lines[j] ?? "");h !== null; h = HUNK.exec(lines[j] ?? "")) {
    const [hunk, next] = hunk_parse(lines, j + 1, h);
    if (hunk === null) {
      return [null, i + 1];
    }
    hunks.push(hunk);
    j = next;
  }
  return hunks.length === 0 ? [null, i + 1] : [{ $: "Diff", k: file[1], x: hunks }, j];
}
function hunk_parse(lines, j, h) {
  let [olds, news] = [Number(h[2] ?? 1), Number(h[4] ?? 1)];
  let [o, n] = [Number(h[1]), Number(h[3])];
  const out = [];
  for (;olds > 0 || news > 0; j++) {
    const s = lines[j]?.[0];
    const x = lines[j]?.slice(1) ?? "";
    if (s === " " && olds > 0 && news > 0) {
      out.push({ s, n: n++, x });
      [o, olds, news] = [o + 1, olds - 1, news - 1];
    } else if (s === "-" && olds > 0) {
      out.push({ s, n: o++, x });
      olds--;
    } else if (s === "+" && news > 0) {
      out.push({ s, n: n++, x });
      news--;
    } else if (s !== "\\") {
      return [null, j];
    }
  }
  return [out, j];
}
function md_parse(src) {
  return blocks_parse(src.replace(/\r/g, "").split(`
`), 0)[0];
}
function blocks_parse(lines, d) {
  const out = [];
  let [i, gap, apart] = [0, false, false];
  while (i < lines.length) {
    const [block, next] = block_parse(lines, i, d);
    if (block === null) {
      gap = out.length > 0;
    } else {
      [apart, gap] = [apart || gap, false];
      out.push(block);
    }
    i = next;
  }
  return [out, apart];
}
function block_parse(lines, i, d) {
  const line = lines[i];
  const head = HEAD.exec(line);
  const runs = (test) => lines_run(lines, i, test);
  if (line.trim() === "") {
    return [null, i + 1];
  }
  if (FENCE.test(line)) {
    const end = runs((l) => !FENCE.test(l));
    const k = line.trim().slice(3).trim();
    const x = lines.slice(i + 1, end).join(`
`);
    return [{ $: "Code", k, x }, end + 1];
  }
  if (head !== null) {
    const x = span_parse(head[2]);
    return [{ $: "Head", k: head[1].length, x }, i + 1];
  }
  if (RULE.test(line)) {
    return [{ $: "Rule" }, i + 1];
  }
  if (QUOT.test(line)) {
    const end = runs((l) => QUOT.test(l));
    const body = lines.slice(i, end).map((l) => l.replace(QUOT, ""));
    return [{ $: "Quot", x: blocks_parse(body, d + 1)[0] }, end];
  }
  if (list_kind(line) !== null && d < DEEP) {
    return list_parse(lines, i, d);
  }
  if (ROW.test(line) && BAR.test(lines[i + 1] ?? "")) {
    const end = lines_run(lines, i + 1, (l) => ROW.test(l));
    const rows = [line, ...lines.slice(i + 2, end)];
    return [{ $: "Tabl", x: rows.map(row_cells) }, end];
  }
  const end = runs((l, j) => l.trim() !== "" && !block_starts(lines, j));
  const x = lines.slice(i, end).map(span_parse);
  return [{ $: "Para", x }, end];
}
function list_parse(lines, i, d) {
  const kind = list_kind(lines[i]);
  const items = [];
  let [end, w, blank, open, para, fenced, loose] = [i, 0, 0, true, false, false, false];
  for (let j = i;j < lines.length; j++) {
    const l = untab(lines[j]);
    const at = indent(l);
    if (at === l.length) {
      [blank, para] = [blank + 1, false];
      continue;
    }
    if (list_kind(l) === kind && (items.length === 0 || at < w)) {
      const mark = LIST.exec(l)[0];
      const rest = l.slice(mark.length);
      const pad = indent(rest);
      w = mark.length + (rest.trim() === "" || pad > 4 ? 1 : pad);
      open = rest.trim() !== "" || (lines[j + 1] ?? "").trim() !== "";
      loose = loose || blank > 0 && items.length > 0;
      items.push([l.slice(w)]);
      [para, fenced] = item_line(l.slice(w), false);
    } else if (open && at >= w) {
      for (;blank > 0; blank--) {
        items[items.length - 1].push("");
      }
      items[items.length - 1].push(l.slice(w));
      [para, fenced] = item_line(l.slice(w), fenced);
    } else if (open && para && blank === 0 && !LIST.test(l) && !block_starts(lines, j)) {
      items[items.length - 1].push(l.trimStart());
    } else {
      break;
    }
    [blank, end] = [0, j + 1];
  }
  const first = LIST.exec(lines[i])[1];
  const k = /\d/.test(first);
  const parts = items.map((x) => blocks_parse(x, d + 1));
  const t = !loose && !parts.some((p) => p[1]);
  return [{ $: "List", k, n: k ? Number(first.slice(0, -1)) : 1, t, x: parts.map((p) => p[0]) }, end];
}
function item_line(s, fenced) {
  const x = RULE.test(s) ? "" : s.replace(MARKS, "");
  if (FENCE.test(x)) {
    return [false, !fenced];
  }
  return [!fenced && x.trim() !== "" && !HEAD.test(x) && !RULE.test(x) && !ROW.test(x), fenced];
}
function untab(l) {
  return l.replace(/^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*/, (pre) => [...pre].reduce((out, c) => out + (c === "\t" ? " ".repeat(4 - out.length % 4) : c), ""));
}
function indent(l) {
  return l.search(/\S|$/);
}
function lines_run(lines, i, test) {
  let j = i + 1;
  while (j < lines.length && test(lines[j], j)) {
    j++;
  }
  return j;
}
function block_starts(lines, j) {
  const l = lines[j];
  const m = LIST.exec(l);
  const item = m !== null && l.slice(m[0].length).trim() !== "" && (!/\d/.test(m[1]) || Number(m[1].slice(0, -1)) === 1);
  return FENCE.test(l) || HEAD.test(l) || RULE.test(l) || QUOT.test(l) || item || ROW.test(l) && BAR.test(lines[j + 1] ?? "");
}
function list_kind(l) {
  const m = LIST.exec(l);
  return m === null || RULE.test(l) ? null : m[1].slice(-1);
}
function row_cells(line) {
  const t = line.trim();
  const a = t.startsWith("|") ? 1 : 0;
  const z = t.length > a && t.endsWith("|") && t[t.length - 2] !== "\\" ? t.length - 1 : t.length;
  const u = t.slice(a, z);
  const cells = [];
  let from = 0;
  for (let k = 0;k < u.length; k++) {
    if (u[k] === "|" && (k === 0 || u[k - 1] !== "\\")) {
      cells.push(u.slice(from, k));
      from = k + 1;
    }
  }
  cells.push(u.slice(from));
  return cells.map((c) => span_parse(c.trim().replace(/\\\|/g, "|")));
}

// Pick.ts
var VENDORS = ["claude-api", "openai-api", "openai-sub", "claude-sub", "cursor"];
var OPUS = { label: "opus-5.5", id: "claude-opus-5-5", speeds: ["slow", "fast"] };
var SONNET = { label: "sonnet-5.5", id: "claude-sonnet-5-5", speeds: ["slow"] };
var HAIKU = { label: "haiku-5.5", id: "claude-haiku-5-5", speeds: ["slow"] };
var OPENAI = [
  { label: "gpt-6-luna", id: "gpt-6-luna", speeds: ["slow", "fast"] },
  { label: "gpt-6.1-sol", id: "gpt-6.1-sol", speeds: ["slow", "fast"] },
  { label: "gpt-6-astra", id: "gpt-6-astra", speeds: ["slow", "fast", "ultrafast"] }
];
var PLAN = OPENAI.map((m) => ({ ...m, speeds: m.speeds.filter((s) => s !== "ultrafast") }));
var CURSOR = [
  OPUS,
  SONNET,
  HAIKU,
  { label: "gpt-5.6-sol", id: "gpt-5.6-sol", speeds: ["slow", "fast"] },
  { label: "grok-4.7", id: "grok-4.7", speeds: ["slow", "fast"] },
  { label: "composer-2.5", id: "composer-2.5", speeds: ["slow", "fast"] }
];
var MODELS = {
  "claude-api": [OPUS, SONNET, HAIKU],
  "openai-api": OPENAI,
  "openai-sub": PLAN,
  "claude-sub": [{ ...OPUS, speeds: ["slow"] }, SONNET, HAIKU],
  cursor: CURSOR
};
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var SPEEDS = ["slow", "fast", "ultrafast"];
var LABELS = [...new Set(Object.values(MODELS).flat().map((m) => m.label))];
var Pick;
((Pick2) => {
  function model(vendor, label) {
    return MODELS[vendor].find((m) => m.label === label);
  }
  Pick2.model = model;
  function on(pick, vendor, model) {
    const below = SPEEDS.slice(0, SPEEDS.indexOf(pick.speed) + 1);
    const speed = below.filter((s) => model.speeds.includes(s)).pop() ?? "slow";
    return { ...pick, vendor, model: model.label, speed };
  }
  Pick2.on = on;
  function models(vendors, labels) {
    return vendors.flatMap((v) => MODELS[v].filter((m) => labels.includes(m.label)).map((m) => [v, m]));
  }
  Pick2.models = models;
  function options(pick, move, offer) {
    const speeds = Pick.model(pick.vendor, pick.model)?.speeds ?? [];
    const { profile: _, ...plain } = pick;
    const all = Pick.models(offer.vendors, offer.models).map(([v, m]) => [m.label, Pick.on(plain, v, m)]);
    const profiles = Object.keys(offer.profiles ?? {}).map((name) => [name, Pick.profile(name, offer, pick.effort, pick.speed)]);
    switch (move) {
      case "next":
      case "prev":
      case "model": {
        return [...profiles, ...all];
      }
      case "up":
      case "down":
      case "effort": {
        return EFFORTS.map((effort) => [effort, { ...pick, effort }]);
      }
      case "speed": {
        return speeds.map((speed) => [speed, { ...pick, speed }]);
      }
    }
  }
  Pick2.options = options;
  function move(pick, move, offer, to) {
    const list = Pick.options(pick, move, offer);
    const n = list.length;
    const at = list.findIndex(([, p]) => Pick.label(p) === Pick.label(pick) && p.profile === pick.profile);
    const d = move === "prev" || move === "down" ? -1 : 1;
    const ends = move === "up" || move === "down";
    const next = ends ? Math.max(0, Math.min(n - 1, at + d)) : (at + d + n) % n;
    const mine = ([, p]) => p.profile === undefined && p.vendor === pick.vendor;
    const same = list.filter(([part, p]) => part === to || p.profile === undefined && p.vendor + ":" + part === to);
    const like = list.filter(([part]) => part.toLowerCase().includes(String(to).toLowerCase()));
    const one = like.length === 1 ? like[0] : like.filter(mine).length === 1 ? like.find(mine) : undefined;
    const hit = to === undefined ? list[next] : same.find(mine) ?? same[0] ?? one;
    return hit === undefined ? null : hit[1];
  }
  Pick2.move = move;
  function to_model(pick, label, vendors, { models }) {
    const all = Pick.models(vendors, models).filter(([v, m]) => m.label === label || v + ":" + m.label === label);
    const hit = all.find(([v]) => v === pick.vendor) ?? all[0];
    return hit === undefined ? null : Pick.on(pick, hit[0], hit[1]);
  }
  Pick2.to_model = to_model;
  function names(vendors, labels) {
    const all = Pick.models(vendors, labels);
    const twins = all.filter(([v, m]) => Pick.twin(v, m.label, vendors) && labels.includes(m.label)).map(([v, m]) => v + ":" + m.label);
    return [...new Set([...all.map(([, m]) => m.label), ...twins])];
  }
  Pick2.names = names;
  function twin(vendor, label, vendors) {
    return vendors.some((v) => v !== vendor && Pick.model(v, label) !== undefined);
  }
  Pick2.twin = twin;
  function label(pick) {
    return [pick.vendor, pick.model, pick.effort, pick.speed].join(":");
  }
  Pick2.label = label;
  function ask(pick) {
    const model = Pick.model(pick.vendor, pick.model);
    return { ...pick, model: model?.id ?? pick.model };
  }
  Pick2.ask = ask;
  function named(run) {
    const model = MODELS[run.vendor].find((m) => m.id === run.model);
    return { ...run, model: model?.label ?? run.model };
  }
  Pick2.named = named;
  function falls(run, falls) {
    const own = { vendor: run.vendor, model: run.model, effort: run.effort, speed: run.speed };
    const list = falls.map((f) => {
      const on = Pick.on(own, f.vendor, f.model);
      return Pick.ask({ ...on, effort: f.effort ?? on.effort, speed: f.speed ?? on.speed });
    });
    return [own, ...list].filter((p, k, all) => all.findIndex((q) => q.vendor === p.vendor && q.model === p.model) === k);
  }
  Pick2.falls = falls;
  function profile(name, offer, effort, speed) {
    const first = Object.hasOwn(offer.profiles ?? {}, name) ? offer.profiles[name][0] : undefined;
    if (first === undefined) {
      return null;
    }
    const on = Pick.on({ vendor: first.vendor, model: first.model.label, effort, speed }, first.vendor, first.model);
    return { ...on, effort: first.effort ?? effort, speed: first.speed ?? on.speed, profile: name };
  }
  Pick2.profile = profile;
  function read(x, offer) {
    if (x.profile !== undefined) {
      return typeof x.profile === "string" && EFFORTS.includes(x.effort) ? Pick.profile(x.profile, offer, x.effort, String(x.speed)) : null;
    }
    const model = offer.vendors.includes(x.vendor) && offer.models.includes(x.model) ? Pick.model(x.vendor, x.model) : undefined;
    if (model === undefined || !EFFORTS.includes(x.effort) || !model.speeds.includes(x.speed)) {
      return null;
    }
    return { vendor: x.vendor, model: x.model, effort: x.effort, speed: x.speed };
  }
  Pick2.read = read;
  function load(saved, offer, def) {
    return Pick.read(saved ?? def, offer) ?? def;
  }
  Pick2.load = load;
})(Pick ||= {});

// TaskDeps.ts
function after_of(t) {
  return Array.isArray(t.after) ? t.after : [];
}
var LATE = 24 * 60 * 60 * 1000;
var KINDS = ["pr", "decision", "test", "action", "restart", "info"];
var H = 60 * 60 * 1000;
var LATE_BY = { pr: 24 * H, decision: 72 * H, test: 2 * H, action: 24 * H, restart: 24 * H, info: Infinity };
var PRIORITIES = ["high", "normal", "low"];
var PR_LINK = /(?:^|[^\w.\/@-])((?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)/i;
function kind_of(t) {
  if (t.kind != null && KINDS.includes(t.kind)) {
    return t.kind;
  }
  if (PR_LINK.test(t.title ?? "")) {
    return "pr";
  }
  return /^\s*teste\b/i.test(t.title ?? "") ? "test" : null;
}
function late_after(t) {
  const k = kind_of(t);
  return k === null ? LATE : LATE_BY[k];
}
function ready_at(t) {
  return typeof t.ready === "string" && !Number.isNaN(Date.parse(t.ready)) ? t.ready : t.made;
}
function priority_of(t) {
  return t.priority != null && PRIORITIES.includes(t.priority) ? t.priority : "normal";
}
function now_order(tasks) {
  const frees = new Map;
  const n = (t) => {
    if (!frees.has(t.id)) {
      frees.set(t.id, frees_ids(tasks, t).length);
    }
    return frees.get(t.id);
  };
  const p = (t) => PRIORITIES.indexOf(priority_of(t));
  const age = (t) => Date.parse(ready_at(t)) || 0;
  const whose = (t) => t.assignee === undefined || t.assignee === "user" ? 0 : 1;
  const read = (t) => kind_of(t) === "info" ? 1 : 0;
  return (a, b) => read(a) - read(b) || p(a) - p(b) || n(b) - n(a) || whose(a) - whose(b) || age(a) - age(b) || Number(a.id.slice(1)) - Number(b.id.slice(1));
}
function by_id(tasks) {
  return new Map(tasks.map((t) => [t.id, t]));
}
function waits(tasks, t, ids = by_id(tasks)) {
  return after_of(t).filter((id) => ids.get(id)?.state === "open");
}
function blocked(tasks, t, ids = by_id(tasks)) {
  return t.state === "open" && waits(tasks, t, ids).length > 0;
}
function blocked_ids(tasks) {
  const ids = by_id(tasks);
  return new Set(tasks.filter((t) => blocked(tasks, t, ids)).map((t) => t.id));
}
function frees_ids(tasks, t) {
  if (t.state !== "open") {
    return [];
  }
  const seen = new Set([t.id]);
  const todo = [t.id];
  while (todo.length > 0) {
    const at = todo.pop();
    for (const d of tasks) {
      if (d.state === "open" && !seen.has(d.id) && after_of(d).includes(at)) {
        seen.add(d.id);
        todo.push(d.id);
      }
    }
  }
  seen.delete(t.id);
  return [...seen].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}
var STATUSES = ["open", "waiting_user", "blocked"];
var STALL_DEFAULT = 4 * H;
var stall = STALL_DEFAULT;
function status_of(t) {
  return t.status != null && STATUSES.includes(t.status) ? t.status : "open";
}
function due_at(t, ms = stall) {
  if (t.state !== "open" || (t.assignee ?? "user") === "user" || status_of(t) === "waiting_user") {
    return null;
  }
  if (t.due !== undefined) {
    return t.due;
  }
  if (typeof t.next_due === "string" && !Number.isNaN(Date.parse(t.next_due))) {
    return new Date(Date.parse(t.next_due)).toISOString();
  }
  const from = Date.parse(t.moved ?? t.changed ?? t.made);
  return Number.isNaN(from) ? null : new Date(from + ms).toISOString();
}
function overdue_ms(tasks, t, now, ms = stall) {
  const due = due_at(t, ms);
  if (due === null || blocked(tasks, t)) {
    return 0;
  }
  const late = now - Date.parse(due);
  return late > 0 ? late : 0;
}
function user_move(t, blocked_set) {
  if (t.state !== "open" || blocked_set.has(t.id) || t.talk === "unii" || status_of(t) === "blocked" || outside_wait(t)) {
    return false;
  }
  return (t.assignee ?? "user") === "user" || status_of(t) === "waiting_user";
}
function task_missed(t) {
  const thread = t.thread ?? [];
  const last = thread[thread.length - 1];
  return t.talk === "user" && last !== undefined && last.who === "unii" && last.none === true;
}
function outside_wait(t) {
  return typeof t.waits_for === "string" && t.waits_for.trim() !== "";
}

// View.ts
var PACE = 0.0001;
var OPENING = 1;
var SUMMARIES = "summaries";
var MAIN = "UniiChat";
var TURN = "Unii's turn";
var WIRE = 3;
var PING = 1e4;
var RETRY = 1000;
var TICK = "+";
var FRAME = 2 ** 22;
var HINT = "Message UniiChat";
var AI = "Unii is an AI, not a person, and can make mistakes.";
var NOTICE = 3 * 60 * 60 * 1000;
var WAIT = "compressing…";
var SUMS = "compressing earlier messages…";
var UNSENT = "Sends once connected.";
var IMAGE = 2 ** 20;
var PIXELS = 2 ** 28;
var TOOL2 = "tool: ";
var FOLD = "The whole chat, folded into the fewest blocks.";
function Cap(text) {
  return { $: "Cap", text };
}
function view_new() {
  return {
    busy: false,
    wait: "",
    agents: [],
    pick: null,
    vendors: [],
    models: LABELS,
    importing: null,
    limits: {},
    timers: [],
    mcp: [],
    tasks: [],
    parts: [],
    turn: Infinity,
    fold: null,
    nodes: new Map,
    whole: new Map,
    open: new Map,
    live: [],
    minds: new Map,
    pages: new Map,
    page: null,
    notes: [],
    tab: crypto.randomUUID(),
    out: [],
    ws: null,
    up: false,
    flush: () => {}
  };
}
function view_hear(v, msg) {
  switch (msg.$) {
    case "know": {
      view_learn(v, msg);
      return [];
    }
    case "view": {
      v.parts = msg.parts;
      v.turn = msg.turn;
      return v.fold === null ? [] : [{ $: "root" }];
    }
    case "zoom":
    case "jobs":
    case "job": {
      return [];
    }
    case "root": {
      v.fold = v.fold === null ? null : msg.parts;
      return [];
    }
    case "entry": {
      view_entry(v, msg);
      return [];
    }
    case "delta": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_push(live, msg.kind, msg.text, msg.fresh);
      }
      return [];
    }
    case "live": {
      const live = view_live(v, msg.agent);
      if (live !== null) {
        live_set(live, msg.live);
      }
      return [];
    }
    case "state": {
      const { $, ...state } = msg;
      Object.assign(v, state);
      v.tasks = Array.isArray(v.tasks) ? v.tasks.map(task_whole) : [];
      AGENT_LABELS.clear();
      Object.entries(v.labels ?? {}).forEach(([name, label]) => AGENT_LABELS.set(name, label));
      return [];
    }
    case "agent": {
      const page = v.pages.get(msg.name);
      if (page === undefined) {
        return [];
      }
      if (msg.found) {
        page.log = [];
        return [];
      }
      v.pages.delete(msg.name);
      if (v.page === page) {
        v.page = null;
      }
      v.notes.push("No agent " + msg.name + ".");
      return [];
    }
    case "note": {
      v.notes.push(msg.text);
      return [];
    }
    case "ack": {
      const post = v.out.find((p) => p.msg.id === msg.id);
      v.out = v.out.filter((p) => p !== post);
      post?.done(msg);
      return [];
    }
    default: {
      return [];
    }
  }
}
function view_act(v, act) {
  switch (act.$) {
    case "Send": {
      const text = act.text.trim();
      const images = act.images ?? [];
      const word = /^\/[a-z]+(?=\s|$)/i.exec(text)?.[0];
      const goal = word === "/goal" ? text.slice(word.length).trim() : null;
      if (!view_typing(v)) {
        return [];
      }
      if (text === "" && images.length === 0) {
        return v.busy ? [{ $: "stop", name: TURN }] : [];
      }
      if (word === "/halt") {
        return [{ $: "goal", text: null }];
      }
      if (goal === "") {
        v.notes.push("/goal needs one: /goal <message>.");
        return [];
      }
      if (word !== undefined && goal === null) {
        v.notes.push(word + " is no command; nothing was sent. The terminal's /help lists its commands; the site's are in its ☰ menu.");
        return [];
      }
      const blob = new Blob([...images, text]);
      const say = { $: "say", sizes: images.map((b) => b.size), body: () => blob };
      v.fold = null;
      return goal === null ? [say] : [{ $: "goal", text: goal }, say];
    }
    case "Move": {
      const from = v.out.flatMap((p) => p.msg.$ === "pick" ? [p.msg.to] : []).at(-1) ?? v.pick;
      if (from === null) {
        return [];
      }
      const to = Pick.move(from, act.move, v, act.to);
      if (act.move === "speed" && Pick.options(from, "speed", v).length === 1) {
        v.notes.push(from.model + " has no fast.");
        return [];
      }
      if (to === null) {
        const parts = Pick.options(from, act.move, v).map(([part]) => part);
        v.notes.push("No " + [act.move, act.to].join(" ").trim() + "; one of: " + [...new Set(parts)].join(", ") + ".");
        return [];
      }
      return [{ $: "pick", to }];
    }
    case "Open": {
      v.open.set(act.id + "+" + act.n, true);
      return act.n === 1 ? [] : [{ $: "zoom", part: [act.id, act.n] }];
    }
    case "Shut": {
      v.open.set(act.id + "+" + act.n, false);
      return [];
    }
    case "Fold": {
      v.open.clear();
      v.fold = act.on ? [] : null;
      return act.on ? [{ $: "root" }] : [];
    }
    case "Goto": {
      if (act.name === null) {
        v.page = null;
        return [];
      }
      const known = v.pages.get(act.name);
      v.page = known ?? { name: act.name, log: null, live: [] };
      v.pages.set(act.name, v.page);
      return known === undefined ? [{ $: "agent", name: act.name }] : [];
    }
    case "Unschedule": {
      return [{ $: "unschedule", id: act.id }];
    }
    case "Plug": {
      const asked = v.out.flatMap((p) => p.msg.$ === "mcp" && p.msg.name === act.name ? [p.msg.on] : []).at(-1);
      const on = asked ?? v.mcp.find((p) => p.name === act.name)?.on;
      if (on === undefined) {
        const names = v.mcp.map((p) => p.name).join(", ");
        v.notes.push("No MCP server " + act.name + (names === "" ? "; the server's config sets none." : "; one of: " + names + "."));
        return [];
      }
      return [{ $: "mcp", name: act.name, on: !on }];
    }
    case "Task": {
      const t = v.tasks.find((x) => x.id === act.task);
      if (t === undefined) {
        v.notes.push("Pendência " + act.task + " não encontrada.");
        return [];
      }
      if (act.answer !== undefined && !t.choices.includes(act.answer)) {
        v.notes.push("A pendência " + t.id + " não tem a opção “" + act.answer + "”.");
        return [];
      }
      const ordered = t.state === "open" && (t.order ?? null) !== null;
      if (ordered && act.state === "done") {
        v.notes.push("A pendência " + t.id + " é uma ordem sua já recebida pelo Unii: ela só fecha com a evidência da execução. Para desistir dela, cancele-a (/descartar " + t.id + ").");
        return [];
      }
      if (act.state === "dropped" && t.state === "open" && t.assignee !== "user" && !ordered) {
        v.notes.push("A pendência " + t.id + " está com o Unii: use “Cobrar agora” ou “Pode fechar”.");
        return [];
      }
      const waits2 = waits(v.tasks, t);
      if (act.state !== "open" && t.state === "open" && waits2.length > 0) {
        v.notes.push(task_waits_said(t, waits2));
        return [];
      }
      const note = act.note?.trim() ?? "";
      const fields = act.state === "done" && act.fields !== undefined && Object.keys(act.fields).length > 0 ? { fields: act.fields } : {};
      return [{ $: "task", task: t.id, state: act.state, ...act.answer === undefined ? {} : { answer: act.answer }, ...note === "" ? {} : { note }, ...act.go ? { go: true } : {}, ...fields }];
    }
    case "TaskDraft": {
      const t = v.tasks.find((x) => x.id === act.task);
      if (t === undefined) {
        v.notes.push("Pendência " + act.task + " não encontrada.");
        return [];
      }
      return [{ $: "task_draft", task: t.id, fields: act.fields }];
    }
    case "TaskSay": {
      const t = v.tasks.find((x) => x.id === act.task);
      const text = act.text.trim();
      if (t === undefined || text === "") {
        v.notes.push(t === undefined ? "Pendência " + act.task + " não encontrada." : "Escreva uma mensagem sobre a pendência " + t.id + ".");
        return [];
      }
      return [{ $: "task_say", task: t.id, text }];
    }
    case "TaskAccept": {
      const t = v.tasks.find((x) => x.id === act.task);
      if (t === undefined) {
        v.notes.push("Pendência " + act.task + " não encontrada.");
        return [];
      }
      if (task_accept_mode(t) === "fill") {
        v.notes.push(task_fill_said(t));
        return view_act(v, { $: "TaskDraft", task: t.id, fields: task_accept_fill(t, act.fields ?? t.draft ?? {}) });
      }
      const got = task_accept(t, act.fields ?? t.draft ?? {});
      if (typeof got === "string") {
        v.notes.push(got);
        return [];
      }
      return view_act(v, { $: "Task", task: t.id, state: "done", ...got.answer === undefined ? {} : { answer: got.answer }, ...act.note === undefined ? {} : { note: act.note }, fields: got.fields });
    }
    case "TasksTell": {
      return [{ $: "tasks_tell" }];
    }
  }
}
function task_waits_said(t, waits) {
  return "A pendência " + t.id + " aguarda " + waits.join(", ") + ": resolva " + (waits.length === 1 ? "essa pendência" : "essas pendências") + " antes. Nada foi alterado.";
}
function and_said(xs) {
  return xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " e " + xs[xs.length - 1];
}
function whose_short(t) {
  return t === undefined ? "" : t.assignee === "user" ? "sua" : t.assignee === "unii" ? "do Unii" : "de " + t.assignee;
}
function id_whose(tasks, id) {
  const w = whose_short(tasks.find((u) => u.id === id));
  return w === "" ? id : id + " (" + w + ")";
}
var FREES_SAID = 3;
function task_frees_named(tasks, t) {
  const ids = frees_ids(tasks, t);
  if (ids.length === 0) {
    return "";
  }
  return "libera " + (ids.length <= FREES_SAID ? and_said(ids) : ids.slice(0, FREES_SAID - 1).join(", ") + " e mais " + (ids.length - FREES_SAID + 1));
}
function task_waits_named(tasks, t) {
  const ids = waits(tasks, t);
  return ids.length === 0 ? "" : "aguarda " + and_said(ids.map((id) => id_whose(tasks, id)));
}
function turn_title(title, n) {
  return n > 0 ? "(" + n + ") " + title : title;
}
function view_untold(v) {
  return v.tasks.filter((t) => !t.told && !t.freed);
}
var MISSED = "Unii não respondeu";
function task_talk_said(t, blocked = new Set) {
  if (t.talk === "unii") {
    return "aguardando o Unii";
  }
  if (t.talk !== "user") {
    return "";
  }
  if (task_missed(t)) {
    return MISSED;
  }
  return user_move(t, blocked) ? "sua vez" : "Unii respondeu";
}
function turn_of(v) {
  return { busy: v.busy, wait: v.wait, limited: Object.hasOwn(v.limits ?? {}, TURN), up: v.up };
}
function task_talk_since(t) {
  const mine = (t.thread ?? []).filter((m) => m.who === "user");
  return mine.length === 0 ? t.changed : mine[mine.length - 1].at;
}
function turn_why(turn) {
  if (!turn.up) {
    return "sem conexão com o servidor";
  }
  if (turn.limited) {
    return "esperando o limite de uso do serviço de IA";
  }
  if (!turn.busy) {
    return "nenhum turno em andamento (o servidor pode ter reiniciado)";
  }
  return turn.wait === SUMMARIES ? "compactando mensagens antigas" : turn.wait !== "" ? "esperando a resposta de " + turn.wait : "turno em andamento";
}
function task_talk_wait_said(t, now, turn = null, blocked = new Set) {
  if (t.state !== "open" || t.talk !== "unii") {
    return task_talk_said(t, blocked);
  }
  const ms = Math.max(0, now - Date.parse(task_talk_since(t)));
  const ago = Number.isFinite(ms) ? " há " + (ms < 3600000 ? Math.floor(ms / 60000) + " min" : hours_said(ms)) : "";
  return "aguardando o Unii" + ago + (turn === null ? "" : " · " + turn_why(turn));
}
function assignee_said(t) {
  return t.assignee === "user" ? "com você" : t.assignee === "unii" ? "com o Unii" : "com " + t.assignee;
}
function origin_said(t) {
  const o = t.origin ?? "";
  return o.startsWith("agent:") ? "agente " + o.slice(6) : { chat: "chat", timer: "agendamento", slack: "Slack", github: "GitHub" }[o] ?? "";
}
var DESK = [
  ["now", "Agora"],
  ["unii", "Aguardando o Unii"],
  ["others", "Em andamento"],
  ["waiting", "Aguardando outras pendências"],
  ["closed", "Resolvidas recentemente"]
];
function desk_group(t, blocked) {
  if (t.state !== "open") {
    return "closed";
  }
  if (t.talk === "unii") {
    return "unii";
  }
  if (blocked.has(t.id)) {
    return "waiting";
  }
  return user_move(t, blocked) ? "now" : "others";
}
function ago_said(iso, now) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "";
  }
  const n = Math.abs(ms);
  const said = n < 60000 ? "" : n < 3600000 ? Math.floor(n / 60000) + " min" : hours_said(n);
  return said === "" ? "agora" : (ms >= 0 ? "há " : "em ") + said;
}
function task_limit_said(t, tasks, now, blocked = blocked_ids(tasks)) {
  if (t.state !== "open" || blocked.has(t.id)) {
    return "";
  }
  const at = (ms) => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (t.assignee === "user") {
    if (outside_wait(t)) {
      return "em espera: o prazo conta quando a espera acabar";
    }
    const limit = late_after(t);
    const from = Date.parse(ready_at(t));
    if (!Number.isFinite(limit) || Number.isNaN(from)) {
      return "sem prazo";
    }
    const due = from + limit;
    const late = task_late_said(t, blocked, now);
    if (late !== "") {
      return late + "; venceu " + at(due);
    }
    return (due < now ? "venceu " : "vence ") + at(due) + " (" + ago_said(new Date(due).toISOString(), now) + (due < now && t.talk === "unii" ? "; aguardando o Unii" : "") + ")";
  }
  const due = due_at(t);
  if (due === null) {
    return "";
  }
  const ms = Date.parse(due);
  return "próximo passo até " + at(ms) + " (" + (ms < now ? "vencido " : "") + ago_said(due, now) + ")";
}
function talk_cls(said) {
  return said === "sua vez" ? "user" : said.startsWith("aguardando o Unii") ? "unii" : said === "Unii respondeu" ? "replied" : said === MISSED ? "missed" : "";
}
function task_fields_left(t) {
  const draft = t.draft ?? {};
  return (t.fields ?? []).filter((f) => f.required && value_empty(Object.hasOwn(draft, f.id) ? draft[f.id] : undefined));
}
function task_turn_said(t, tasks, now, turn = null, blocked = blocked_ids(tasks)) {
  if (t.state !== "open") {
    return { cls: "closed", lead: t.state === "done" ? "Concluída" : "Descartada", text: task_unproven(t) ? "Fechada sem evidência registrada: reabra-a se o problema não foi resolvido." : "Nada a fazer: a evidência está registrada abaixo." };
  }
  if (blocked.has(t.id)) {
    return { cls: "waiting", lead: "Aguardando outras pendências", text: "Só pode ser resolvida depois de " + and_said(waits(tasks, t).map((id) => id_whose(tasks, id))) + "." };
  }
  if (t.talk === "unii") {
    const ago = ago_said(task_talk_since(t), now);
    return { cls: "unii", lead: "Aguardando o Unii", text: "Você escreveu na conversa" + (ago === "" ? "" : " " + ago) + " e o Unii ainda não respondeu" + (turn === null ? "" : " (" + turn_why(turn) + ")") + ". A resposta chega aqui quando ele responder nesta conversa ou quando o turno dele terminar; se o servidor reiniciar sem turno a retomar, ela volta marcada “Unii não respondeu”. Nada a fazer até lá." };
  }
  if (outside_wait(t)) {
    const missed_wait = task_missed(t) ? " O Unii não respondeu à sua última mensagem na conversa (o turno terminou sem resposta)." : "";
    return { cls: "waiting", lead: "Aguardando", text: "Espera algo fora da lista: " + t.waits_for.trim() + ". Nada a fazer até lá; volta para Agora quando a espera for retirada." + missed_wait };
  }
  if (status_of(t) === "blocked") {
    return { cls: "others", lead: "Bloqueada", text: (t.status_why ?? "sem motivo informado") + ((t.unblock ?? null) === null ? "" : ". Desbloqueia: " + t.unblock) + "." };
  }
  const missed = task_missed(t) ? "O Unii não respondeu à sua última mensagem na conversa (o turno terminou sem resposta); escreva de novo para tentar outra vez. " : "";
  if (user_move(t, blocked)) {
    if (t.assignee !== "user") {
      return { cls: "user", lead: "Sua vez", text: missed + "O Unii aguarda você: " + (t.status_why ?? "algo seu") + ". Responda na conversa desta pendência." };
    }
    const left = task_fields_left(t);
    const one = left.length === 1 ? left[0] : undefined;
    const fill = left.length === 0 ? "" : "preencha " + (one !== undefined ? "o campo obrigatório “" + one.label + "”" : left.length + " campos obrigatórios") + " e ";
    const rec = task_rec(t);
    const pick = t.choices.length === 0 ? "conclua ou descarte" : t.choices.length === 1 ? "conclua como “" + t.choices[0] + "” ou descarte" : "escolha uma das " + t.choices.length + " opções" + (rec === null ? "" : " (recomendada: “" + rec + "”)");
    const late = task_late_said(t, blocked, now);
    const kind = task_kind_said(t);
    const tail = [kind, late].filter((x) => x !== "").join("; ");
    const said = fill + pick;
    return { cls: "user", lead: "Sua vez", text: missed + said.charAt(0).toUpperCase() + said.slice(1) + "." + (tail === "" ? "" : " " + tail.charAt(0).toUpperCase() + tail.slice(1) + ".") };
  }
  const replied = missed !== "" ? " " + missed.trim() : t.talk === "user" ? " O Unii respondeu na conversa." : "";
  if ((t.order ?? null) !== null) {
    return { cls: "others", lead: "Ordem recebida", text: "O Unii executa “" + (t.order.answer ?? "sua escolha") + "” e só fecha com a evidência da execução: nada a fazer agora." + replied + " Você pode cobrar ou cancelar a ordem." };
  }
  const step = (t.next_step ?? null) === null ? "" : " Próximo passo: " + t.next_step + ".";
  return { cls: "others", lead: assignee_said(t).replace(/^c/, "C"), text: "Nada a fazer agora." + replied + step + " Você pode cobrar o andamento ou liberar para fechar." };
}
function desk_turn(tasks) {
  const blocked = blocked_ids(tasks);
  return tasks.some((t) => desk_group(t, blocked) === "now");
}
function desk_refs(tasks) {
  return [...new Set(tasks.flatMap((t) => t.ref === null ? [] : [t.ref]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
function desk_fold(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function desk_match(t, q, ref) {
  if (ref !== "" && t.ref !== ref) {
    return false;
  }
  const words = desk_fold(q).split(" ").filter((w) => w !== "");
  if (words.length === 0) {
    return true;
  }
  const hay = desk_fold([t.id, t.title, t.detail, t.ref ?? "", t.assignee, ...(t.fields ?? []).map((f) => f.label), ...(t.thread ?? []).map((m) => m.text)].join(" "));
  return words.every((w) => hay.includes(w));
}
function desk_list(tasks, q = "", ref = "") {
  const blocked = blocked_ids(tasks);
  const shown = tasks.filter((t) => desk_match(t, q, ref));
  const order = now_order(tasks);
  return DESK.map(([group, label]) => {
    const of = shown.filter((t) => desk_group(t, blocked) === group);
    return { group, label, tasks: group === "now" ? [...of].sort(order) : of };
  }).filter((g) => g.tasks.length > 0);
}
function desk_step(ids, at, by) {
  if (ids.length === 0) {
    return null;
  }
  const k = at === null ? -1 : ids.indexOf(at);
  if (k === -1) {
    return by < 0 ? ids[ids.length - 1] : ids[0];
  }
  return ids[Math.max(0, Math.min(ids.length - 1, k + by))];
}
function desk_next(tasks, sel, q = "", ref = "", order = []) {
  const groups = desk_list(tasks, q, ref);
  const now = (groups.find((g) => g.group === "now")?.tasks ?? []).filter((t) => t.id !== sel);
  if (now.length === 0) {
    return null;
  }
  const list = sel !== null && order.includes(sel) ? order : groups.flatMap((g) => g.tasks.map((t) => t.id));
  const k = sel === null ? -1 : list.indexOf(sel);
  if (k >= 0) {
    const ahead = [...list.slice(k + 1), ...list.slice(0, k)];
    const next = ahead.map((id) => now.find((t) => t.id === id)).find((t) => t !== undefined);
    if (next !== undefined) {
      return next;
    }
  }
  return now[0];
}
var TASK_LATE = LATE;
function task_late_said(t, blocked, now) {
  const age = now - Date.parse(ready_at(t));
  if (t.state !== "open" || t.assignee !== "user" || blocked.has(t.id) || t.talk === "unii" || outside_wait(t) || !(age > late_after(t))) {
    return "";
  }
  return "atrasada há " + hours_said(age);
}
var KIND_SAID = { pr: "aprovação de PR", decision: "decisão", test: "teste", action: "ação sua", restart: "reinício", info: "informação" };
function task_kind_said(t) {
  const k = kind_of(t);
  return k === null ? "" : KIND_SAID[k] + (Number.isFinite(LATE_BY[k]) ? ", prazo " + LATE_BY[k] / 3600000 + " h" : ", sem prazo");
}
function task_waits_for_said(t) {
  return t.state !== "open" || (t.waits_for ?? null) === null ? "" : "aguarda: " + t.waits_for;
}
function act_unii(t, c) {
  return (t.acts ?? {})[c] === "unii";
}
var ACT_SAID = "o Unii executa";
var VERDICT_SAID = { approved: "aprovado", approved_with_notes: "aprovado com ressalvas", rejected: "reprovado", pending: "aguardando verificação" };
var SEV_SAID = { high: ["alta", "altas"], medium: ["média", "médias"], low: ["baixa", "baixas"] };
function pr_label(url) {
  const m = /^https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/.exec(url);
  return m === null ? url : m[1] + "#" + m[2];
}
function pr_notes_said(p) {
  const by = ["high", "medium", "low"].map((v) => [v, p.notes.filter((n) => n.sev === v).length]).filter(([, n]) => n > 0);
  return by.length === 0 ? "sem ressalvas" : "ressalvas: " + and_said(by.map(([v, n]) => n + " " + SEV_SAID[v][n === 1 ? 0 : 1]));
}
function task_priority_said(t) {
  const p = priority_of(t);
  return p === "high" ? "prioridade alta" : p === "low" ? "prioridade baixa" : "";
}
function hours_said(ms) {
  const h = Math.floor(ms / 3600000);
  return h < 48 ? h + " h" : Math.floor(h / 24) + " d";
}
var STALL = 3600000;
function task_stalled_said(t, blocked, now) {
  const age = now - Date.parse(t.moved ?? t.changed ?? t.made);
  if (t.state !== "open" || t.assignee === "user" || blocked.has(t.id) || t.talk === "unii" || !(age >= STALL)) {
    return { text: "", late: false };
  }
  return { text: "parada há " + hours_said(age), late: age > TASK_LATE };
}
function task_agent_said(t) {
  const a = t.agent ?? null;
  return a !== null ? "agente " + a : t.state === "open" && t.assignee !== "user" ? "sem agente" : "";
}
function evidence_said(e) {
  const sum = e.summary === undefined ? "" : " — " + e.summary;
  switch (e.type) {
    case "slack":
      return "Mensagem enviada no Slack (canal " + e.channel + ", ts " + e.ts + ")" + sum;
    case "pr_merged": {
      const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/.exec(e.url ?? "");
      const merge = (e.confirmed ?? "").split(" ")[1];
      return "PR mesclado: " + (m === null ? e.url : m[2] + "#" + m[3]) + (merge === undefined ? "" : " (merge " + merge.slice(0, 12) + ")") + sum;
    }
    case "commit_tests":
      return "Commit " + (e.sha ?? "").slice(0, 12) + " em " + e.repo + ": " + e.passed + " " + (e.passed === 1 ? "teste passou" : "testes passaram") + ", " + e.failed + " falhas (" + e.command + ")" + sum;
    case "tfc":
      return "Run do Terraform Cloud " + e.run + ": " + e.status + sum;
    case "file":
      return "Arquivo " + e.path + (e.size === undefined ? "" : " (" + e.size + " bytes)") + sum;
    case "reason":
      return "Motivo: " + e.text;
    case "user":
      return (e.migrated ? "Resolução do usuário (registro anterior)" : "Resolução do usuário") + (e.answer == null ? "" : ": " + e.answer) + (e.note == null ? "" : " — “" + e.note + "”");
    case "restart":
      return "Serve reiniciado pelo Unii, como o usuário ordenou" + sum;
  }
}
function task_status_said(t) {
  if (t.state !== "open") {
    return t.state === "done" ? "concluída" : "descartada";
  }
  if ((t.order ?? null) !== null) {
    return "ordem recebida";
  }
  const st = status_of(t);
  return st === "blocked" ? "bloqueada" : st === "waiting_user" ? "aguardando você" : "aberta";
}
function task_unproven(t) {
  return t.state !== "open" && (t.evidence ?? []).length === 0;
}
var UNPROVEN_SAID = "sem evidência";
function task_marks(t, tasks, now) {
  const out = [];
  if (t.state !== "open") {
    return task_unproven(t) ? [["unproven", UNPROVEN_SAID]] : [];
  }
  if ((t.order ?? null) !== null) {
    out.push(["order", "ordem recebida" + (t.order.answer === null ? "" : ": " + t.order.answer)]);
  }
  const st = status_of(t);
  if (st === "waiting_user") {
    out.push(["waiting-user", "aguardando você" + ((t.status_why ?? null) === null ? "" : ": " + t.status_why)]);
  }
  if (st === "blocked") {
    out.push(["blocked", "bloqueada" + ((t.status_why ?? null) === null ? "" : ": " + t.status_why) + ((t.unblock ?? null) === null ? "" : "; desbloqueia: " + t.unblock)]);
  }
  const late = overdue_ms(tasks, t, now);
  if (late > 0) {
    out.push(["late overdue", "prazo vencido há " + (late < 3600000 ? Math.max(1, Math.floor(late / 60000)) + " min" : hours_said(late))]);
  }
  return out;
}
var REC_MARK = /\(\s*recomendad[oa]s?\s*\)/i;
function rec_marked(c) {
  return REC_MARK.test(c);
}
function task_rec(t) {
  if (t.recommend != null && t.choices.includes(t.recommend)) {
    return t.recommend;
  }
  const marked = t.choices.filter(rec_marked);
  return marked.length === 1 ? marked[0] : null;
}
function field_rec(f) {
  if (f.recommend !== undefined && f.recommend.length > 0) {
    return f.recommend;
  }
  const marked = f.choices.filter(rec_marked);
  if (f.kind === "multi") {
    return marked.length > 0 ? marked : undefined;
  }
  return (f.kind === "choice" || f.kind === "yesno") && marked.length === 1 ? marked[0] : undefined;
}
function rec_is(rec, c) {
  return rec === c || Array.isArray(rec) && rec.includes(c);
}
function task_accept_mode(t) {
  if (t.state !== "open" || t.assignee !== "user") {
    return null;
  }
  const fields = (t.fields ?? []).some((f) => field_rec(f) !== undefined);
  if (t.choices.length === 0) {
    return fields ? "conclude" : null;
  }
  return task_rec(t) !== null ? "conclude" : fields ? "fill" : null;
}
function task_accepts(t) {
  return task_accept_mode(t) !== null;
}
function task_accept_said(t) {
  return task_accept_mode(t) === "fill" ? "Preencher as recomendadas" : t.fields.length === 0 ? "Aceitar a recomendada" : "Aceitar as recomendadas";
}
function task_fill_said(t) {
  return "Respostas recomendadas preenchidas em " + t.id + ". Escolha uma opção para concluir: " + t.choices.join(" | ") + " (no terminal: /ok " + t.id + " opção).";
}
function value_empty(x) {
  return x === undefined || x === null || typeof x === "string" && x.trim() === "" || Array.isArray(x) && x.length === 0;
}
function task_accept_fill(t, values) {
  const fields = {};
  for (const f of t.fields ?? []) {
    const given = Object.hasOwn(values, f.id) ? values[f.id] : undefined;
    const rec = field_rec(f);
    if (!value_empty(given)) {
      fields[f.id] = given;
    } else if (rec !== undefined) {
      fields[f.id] = rec;
    }
  }
  return fields;
}
function task_accept(t, values) {
  if (!task_accepts(t)) {
    return "A pendência " + t.id + " não tem recomendação para aceitar.";
  }
  const fields = task_accept_fill(t, values);
  if (task_accept_mode(t) === "fill") {
    return task_fill_said(t);
  }
  const missing = (t.fields ?? []).filter((f) => f.required && value_empty(fields[f.id]));
  if (missing.length > 0) {
    return "Sem recomendação para " + (missing.length === 1 ? "o campo obrigatório " : "os campos obrigatórios ") + missing.map((f) => "“" + f.label + "”").join(", ") + ": responda " + (missing.length === 1 ? "esse campo" : "esses campos") + " e conclua.";
  }
  const answer = task_rec(t);
  return { ...answer === null ? {} : { answer }, fields };
}
var CHASE = "Cobrança: qual é o andamento desta pendência e o próximo passo?";
var LINKS = 8;
function task_prs(t) {
  const text = (t.detail ?? "") + " " + (t.origin_url ?? "");
  const seen = new Map;
  for (const p of t.prs ?? []) {
    if (!seen.has(p.url) && seen.size < LINKS) {
      seen.set(p.url, pr_label(p.url));
    }
  }
  for (const m of text.matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g)) {
    const url = m[0];
    if (!seen.has(url) && seen.size < LINKS) {
      seen.set(url, m[2] + "#" + m[3]);
    }
  }
  return [...seen].map(([url, label]) => ({ url, label }));
}
function task_whole(t) {
  const named = typeof t?.assignee === "string" && t.assignee !== "";
  if (named && Array.isArray(t.after) && Array.isArray(t.fields) && Array.isArray(t.thread) && Array.isArray(t.choices) && t.draft !== undefined && t.origin !== undefined && t.agent !== undefined && Array.isArray(t.prs) && t.acts !== undefined && Array.isArray(t.evidence) && t.status !== undefined && t.order !== undefined) {
    return t;
  }
  return {
    ...t,
    assignee: named ? t.assignee : t?.who === "unii" ? "unii" : "user",
    origin: t?.origin ?? null,
    origin_url: t?.origin_url ?? null,
    agent: t?.agent ?? null,
    kind: t?.kind ?? null,
    priority: t?.priority ?? "normal",
    prs: Array.isArray(t?.prs) ? t.prs : [],
    acts: t?.acts ?? {},
    waits_for: t?.waits_for ?? null,
    ready: t?.ready ?? t?.made,
    choices: Array.isArray(t?.choices) ? t.choices : [],
    after: Array.isArray(t?.after) ? t.after : [],
    fields: Array.isArray(t?.fields) ? t.fields : [],
    draft: t?.draft ?? {},
    answers: t?.answers ?? null,
    thread: Array.isArray(t?.thread) ? t.thread : [],
    talk: t?.talk ?? null,
    done_when: t?.done_when ?? null,
    evidence: Array.isArray(t?.evidence) ? t.evidence : [],
    status: t?.status ?? "open",
    status_why: t?.status_why ?? null,
    unblock: t?.unblock ?? null,
    order: t?.order ?? null,
    next_step: t?.next_step ?? null,
    next_due: t?.next_due ?? null
  };
}
function view_body(v) {
  if (v.page !== null) {
    return page_rows(v, v.page);
  }
  if (v.fold !== null) {
    const tops = v.fold.flatMap(([id, n]) => part_rows(v, id, n, Infinity, false));
    return [Cap(FOLD), ...tops];
  }
  return [Cap(AI), ...view_rows(v, v.parts).flat()];
}
function view_rows(v, parts) {
  return parts.map(([id, n], k) => {
    const rows = part_rows(v, id, n, v.turn, true);
    return part_due(v, [id, n], parts[k - 1]) ? [Cap(AI), ...rows] : rows;
  });
}
function view_tail(v, live = view_stream(v)) {
  if (v.page === null && v.fold !== null) {
    return [];
  }
  const rows = live.flatMap((l) => entry_rows(null, l.kind, l.text));
  const load = v.page === null && v.importing !== null ? [Cap(progress_show(v.importing))] : [];
  const said = v.page === null && !v.up ? v.out.flatMap((p) => entry_rows(null, "user", p.said)) : [];
  const kept = said.length > 0 ? [...said, Cap(UNSENT)] : [];
  const limit = v.limits[v.page === null ? TURN : v.page.name];
  if (limit !== undefined) {
    return [...rows, Cap(limit_show(limit)), ...kept, ...load];
  }
  if (v.page !== null || rows.length > 0 || v.wait === "") {
    return [...rows, ...kept, ...load];
  }
  return [Cap(v.wait === SUMMARIES ? SUMS : "waiting for " + v.wait + "…"), ...kept, ...load];
}
function limit_show(limit, now = Date.now()) {
  const at = new Date(limit.until);
  const day = at.toDateString() === new Date(now).toDateString() ? {} : { weekday: "short" };
  return "waiting for the usage limit, " + (limit.known ? "resumes" : "tries again") + " at " + at.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit" });
}
function view_stream(v) {
  return v.page === null ? v.live : v.page.live;
}
function progress_show(p) {
  const n = (k) => k.toLocaleString("en-US");
  const merges = p.open.reduce((x, y) => x + y, 0);
  const phase = p.open[0] > 0 ? "Summarizing messages: " + n(p.msgs - p.open[0]) + " of " + n(p.msgs) : "Merging the top of the tree: " + merges + (merges === 1 ? " merge" : " merges") + " left · about " + Math.ceil((p.total - p.done) * PACE) + " min";
  return phase + (p.why === null ? "" : " · paused");
}
function view_tabs(v) {
  const at = v.page === null ? null : v.page.name;
  const names = at === null || v.agents.includes(at) ? v.agents : [...v.agents, at];
  return [null, ...names].map((name) => {
    const here = name === at;
    const label = name === null ? undefined : AGENT_LABELS.get(name);
    const text = (here ? GLYPH.here : GLYPH.tab) + " " + (label ?? name ?? MAIN);
    return label === undefined ? { name, here, text } : { name, here, text, sub: name };
  });
}
var AGENT_LABELS = new Map;
function agent_label(name) {
  return AGENT_LABELS.get(name);
}
function agent_shown(name) {
  const label = AGENT_LABELS.get(name);
  return label === undefined ? name : label + " (" + name + ")";
}
function view_fold(v) {
  if (v.page !== null) {
    return null;
  }
  return v.fold === null ? "fold all" : "unfold all";
}
function view_typing(v) {
  return v.page === null;
}
function view_pick(v) {
  if (v.pick === null) {
    return [];
  }
  const { model, effort, speed, profile } = v.pick;
  const ranks = (v.profiles?.[profile ?? ""] ?? []).map((f) => f.model.label).join(", ");
  const whose = Pick.twin(v.pick.vendor, model, v.vendors) ? ", " + v.pick.vendor : "";
  return [
    { text: profile ?? model, move: "model", hint: profile === undefined ? model + whose : profile + ": " + ranks, choices: view_choices(v.pick, "model", v) },
    { text: effort, move: "effort", hint: effort + " effort", choices: view_choices(v.pick, "effort", v) },
    { text: speed, move: "speed", hint: speed, choices: view_choices(v.pick, "speed", v) }
  ];
}
function view_choices(pick, move, v) {
  return Pick.options(pick, move, v).map(([text, to], i, all) => {
    const head = (p) => p.profile !== undefined ? "profiles" : p.vendor;
    const vendor = move === "model" && (i === 0 || head(all[i - 1][1]) !== head(to)) ? head(to) : null;
    const here = move !== "model" ? Pick.label(to) === Pick.label(pick) : to.profile !== undefined ? to.profile === pick.profile : pick.profile === undefined && Pick.label(to) === Pick.label(pick);
    const by = move === "model" && to.profile === undefined ? to.vendor + ":" + text : text;
    return { text: move === "model" ? to.profile ?? to.model : text, to: by, move, here, vendor };
  });
}
function view_learn(v, pack) {
  for (const [key, node] of Object.entries(pack.nodes ?? {})) {
    v.nodes.set(key, node);
  }
  for (const [id, entry] of Object.entries(pack.whole ?? {})) {
    v.whole.set(Number(id), entry);
  }
}
function view_entry(v, msg) {
  const { $, agent, id, ...entry } = msg;
  const last = v.parts[v.parts.length - 1];
  if (agent !== undefined) {
    const log = v.pages.get(agent)?.log;
    if (Array.isArray(log)) {
      log.push(entry);
    }
  } else if (id !== undefined) {
    v.whole.set(id, entry);
    v.parts.push([id, 1]);
  } else if (msg.kind === "mind" && last !== undefined) {
    const at = last[0] + last[1] - 1;
    v.minds.set(at, [...v.minds.get(at) ?? [], msg.text]);
  }
}
function view_live(v, agent) {
  if (agent === undefined) {
    return v.live;
  }
  return v.pages.get(agent)?.live ?? null;
}
function link_open(v, link) {
  const ws = link.open("?tab=" + v.tab + "&wire=" + WIRE);
  let heard = Date.now();
  const tick = setInterval(() => Date.now() - heard > PING && drop(), PING / 2);
  async function drop() {
    const up = v.up;
    ws.onmessage = null;
    ws.onclose = null;
    clearInterval(tick);
    ws.close();
    [v.ws, v.up] = [null, false];
    if (await link.lost(up)) {
      setTimeout(() => link_open(v, link), RETRY);
    }
  }
  function flush() {
    for (const post of v.up && v.ws === ws ? v.out.filter((p) => p.ws !== ws) : []) {
      post.ws = ws;
      if ("body" in post.msg) {
        upload(post);
      } else {
        ws.send(JSON.stringify(post.msg));
      }
    }
  }
  async function upload(post) {
    const { body, ...rest } = post.msg;
    const query = Object.entries(rest).map(([k, x]) => k + "=" + encodeURIComponent(String(x)));
    const res = await link.post("/api/act?" + query.join("&"), await body()).catch(() => null);
    const out = await res?.json().catch(() => null);
    if (out != null) {
      link.hear({ $: "ack", id: post.msg.id, ...out });
    } else if (post.ws === ws && v.ws === ws) {
      drop();
    }
  }
  [v.ws, v.flush] = [ws, flush];
  ws.onmessage = (ev) => {
    heard = Date.now();
    if (ev.data === TICK) {
      return;
    }
    const msg = JSON.parse(String(ev.data));
    const join = msg.$ === "view" && !v.up;
    if (join) {
      v.up = true;
      v.pages.clear();
    }
    link.hear(msg);
    if (join) {
      view_act(v, { $: "Goto", name: v.page?.name ?? null }).forEach((out) => link_send(v, out));
      flush();
    }
  };
  ws.onclose = () => drop();
}
function link_send(v, msg, done = (a) => link_note(v, a), said = "") {
  v.out.push({ msg: { id: crypto.randomUUID(), ...msg }, ws: null, done, said });
  v.flush();
}
function link_note(v, a) {
  if (a.error !== undefined) {
    v.notes.push(a.error);
  }
}
async function post(url, body, auth = {}) {
  const headers = { ...auth, "content-type": "application/json" };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
  const out = res === null ? { error: "Can't reach the server." } : await res.json().catch(() => res.ok ? {} : { error: "HTTP " + res.status });
  return { ...out, ok: res?.ok === true, status: res?.status ?? 0 };
}
function part_due(v, part, before) {
  const last = before === undefined ? NaN : part_window(v, before);
  return part[1] === 1 && part[0] >= v.turn && !Number.isNaN(last) && part_window(v, part) !== last;
}
function part_window(v, [id, n]) {
  const date = n === 1 ? v.whole.get(id)?.date : v.nodes.get(id + "+" + n)?.to;
  return Math.floor(Date.parse(date ?? "") / NOTICE);
}
function part_rows(v, id, n, t, talk) {
  const key = id + "+" + n;
  const entry = v.whole.get(id);
  const half = n / 2;
  if (n === 1 && id >= t && entry !== undefined) {
    const minds = v.minds.get(id) ?? [];
    const after = minds.flatMap((x) => entry_rows(null, "mind", x));
    return [...whole_rows(id, entry), ...after];
  }
  const open = talk && n === 1 && ["user", "unii"].includes(entry?.kind ?? "");
  if (!(v.open.get(key) ?? open)) {
    return sum_rows(id, n, v.nodes.get(key));
  }
  const text = n === 1 ? "fold" : GLYPH.open + " " + n + "x · fold";
  if (n > 1) {
    const rows = [...part_rows(v, id, half, t, talk), ...part_rows(v, id + half, half, t, talk)];
    return [{ $: "Box", id, n, text, rows }];
  }
  const rows = entry === undefined ? [] : whole_rows(id, entry);
  return [{ $: "Box", id, n, text, rows }];
}
var ROWS = new WeakMap;
function whole_rows(id, entry) {
  const rows = ROWS.get(entry) ?? entry_rows(id, entry.kind, entry.text, entry.images);
  ROWS.set(entry, rows);
  return rows;
}
function sum_rows(id, n, node = { text: WAIT, to: "" }) {
  const rows = ROWS.get(node) ?? [{ $: "Sum", id, n, text: md_flat(node.text), call: sum_call(n, node.text) }];
  ROWS.set(node, rows);
  return rows;
}
function page_rows(v, page, from = 0) {
  const head = Cap(agent_shown(page.name) + (v.agents.includes(page.name) ? " · at work" : " · done"));
  return [head, ...(page.log ?? []).slice(from).flatMap((e) => whole_rows(null, e))];
}
function live_push(live, kind, text, fresh = false) {
  const top = live[live.length - 1];
  if (top !== undefined && top.kind === kind && !fresh) {
    top.text += text;
  } else {
    live.push({ kind, text });
  }
}
function live_set(live, now) {
  const goes = live.every((l, k) => now[k]?.kind === l.kind && now[k].text.startsWith(l.text));
  const held = goes ? live : [];
  const next = now.map((l, k) => k < held.length ? Object.assign(held[k], l) : l);
  live.splice(0, live.length, ...next);
}
function sum_call(n, text) {
  const call = n === 1 && text.startsWith(TOOL2) ? call_parse(text.slice(TOOL2.length)) : null;
  return call === null || call.name === "" ? null : call;
}
function entry_rows(id, kind, text, images = []) {
  const call = kind === "tool" ? call_parse(text) : null;
  const report = kind === "work" ? report_read(text) : null;
  const body = call === null ? entry_body(kind, report?.text ?? text) : [];
  const who = report === null ? WHO[kind] ?? "" : agent_shown(report.name);
  return call === null && body.length === 0 && images.length === 0 ? [] : [{ $: "Msg", id, kind, who, text, body, call, images }];
}
function entry_body(kind, text) {
  switch (kind) {
    case "user":
    case "work": {
      return md_plain(text);
    }
    case "echo": {
      return md_output(text);
    }
    default: {
      return md_parse(text);
    }
  }
}
var STAGE_SAID = { impl: "implementando", verif: "verificando", user: "com você", others: "com terceiros", stalled: "parada com o Unii", closed: "encerrada" };
var PR_STATE_SAID = { OPEN: "aberto", MERGED: "mesclado", CLOSED: "fechado" };
var CI_SAID = { ok: "CI ok", failed: "CI falhou", running: "CI rodando", none: "sem CI" };
function span_said(ms) {
  if (!(ms >= 60000)) {
    return "agora";
  }
  if (ms < 3600000) {
    return Math.floor(ms / 60000) + " min";
  }
  return hours_said(ms);
}
function took_said(ms) {
  return ms >= 0 && ms < 60000 ? "menos de 1 min" : span_said(ms);
}
function when_said(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function sevs_said(s) {
  const by = ["high", "medium", "low"].filter((v) => s[v] > 0);
  return by.length === 0 ? "nenhuma" : and_said(by.map((v) => s[v] + " " + SEV_SAID[v][s[v] === 1 ? 0 : 1]));
}
function pr_head_said(p) {
  if (p.head === null || p.live === null || p.live.head === "") {
    return null;
  }
  const same = p.live.head.startsWith(p.head) || p.head.startsWith(p.live.head);
  return same ? { text: "head igual ao verificado (" + p.head.slice(0, 7) + ")", same } : { text: "head mudou: verificado " + p.head.slice(0, 7) + ", agora " + p.live.head.slice(0, 7), same };
}
function pipeline_totals(fronts) {
  const active = fronts.filter((f) => f.stage !== "closed");
  const cycles = fronts.flatMap((f) => f.prs.filter((p) => p.cycles > 0).map((p) => p.cycles));
  const decide = fronts.flatMap((f) => f.decide);
  return {
    active: active.length,
    user: active.filter((f) => f.stage === "user").length,
    stalled: active.filter((f) => f.stage === "stalled").length,
    cycles: median_of(cycles),
    decide: median_of(decide),
    decided: decide.length,
    idle: active.reduce((n, f) => n + f.idle, 0)
  };
}
function median_of(xs) {
  if (xs.length === 0) {
    return null;
  }
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Timer.ts
var AHEAD = 8 * 366;
var DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
var CLOCKS = new Map;
function clock(zone) {
  if (!CLOCKS.has(zone)) {
    try {
      const fields = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" };
      CLOCKS.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", ...fields }));
    } catch {
      return null;
    }
  }
  return CLOCKS.get(zone);
}
function wall(ms, zone) {
  const parts = Object.fromEntries(clock(zone).formatToParts(ms).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, mi: Number(parts.minute), wd: DAYS[parts.weekday] };
}
function wall_show(ms, zone) {
  const w = wall(ms, zone);
  const two = (n) => String(n).padStart(2, "0");
  return w.y + "-" + two(w.mo) + "-" + two(w.d) + " " + two(w.h) + ":" + two(w.mi);
}
function timer_when(t) {
  const next = wall_show(Date.parse(t.at), t.zone) + " " + t.zone;
  return t.cron === null ? "once, " + next : "cron " + t.cron + ", next " + next;
}

// web/src/Html.ts
var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
var TALL = 4000;
var SHORT2 = 8;
var SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
var CHECK = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;
var MARKS2 = { " ": "", "-": "del", "+": "add" };
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}
function act_html(act) {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}
function copy_html(text) {
  return `<button class="copy" data-copy="${esc(text)}" title="Copy">${SHEETS}</button>`;
}
var MADE = new WeakMap;
function row_html(row) {
  const html = MADE.get(row) ?? row_make(row);
  MADE.set(row, html);
  return html;
}
function row_make(row) {
  switch (row.$) {
    case "Sum": {
      const open = act_html({ $: "Open", id: row.id, n: row.n });
      const text = row.call === null ? esc(row.text) : head_html(row.call, call_line(row.call), "");
      return `<div class="block"${open} data-a="${row.id}"><span class="lv">${row.n}x</span><div>${text}</div></div>`;
    }
    case "Box": {
      const shut = act_html({ $: "Shut", id: row.id, n: row.n });
      const one = row.n === 1 ? " one" : "";
      const rows = row.rows.map(row_html).join("");
      return `<div class="open${one}" data-a="${row.id}"><button class="fold"${shut}>${esc(row.text)}</button>${rows}</div>`;
    }
    case "Msg": {
      const at = row.id === null ? "" : ` data-a="${row.id}"`;
      const text = row.call === null ? row.text : call_text(row.call);
      const copy = copy_html(text);
      const body = row.call === null ? row.body.map(block_html).join("") : call_html(row.call);
      const pics = images_html(row.images);
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split(`
`).length > TALL;
      const lines = text.trim().split(`
`).length;
      const long = ["tool", "echo"].includes(row.kind) && lines > SHORT2;
      const fold = tall ? `<div class="clip">${body}</div><details class="more"><summary></summary></details>` : long ? `<div class="clip">${body}</div><details class="more out"><summary data-n="${lines} linhas"></summary></details>` : body;
      const who = row.who === "" ? "" : ` data-who="${esc(row.who)}"`;
      return `<div class="msg ${row.kind}"${at}${who}>${copy}${fold}${pics}</div>`;
    }
    case "Cap": {
      return `<p class="cap">${esc(row.text)}</p>`;
    }
  }
}
function call_html(c) {
  return head_html(c, c.head, c.device) + c.blocks.map(block_html).join("");
}
function head_html(c, text, device) {
  const icon = `<span class="ic">${tool_glyph(c.name)}</span>`;
  const verb = c.name === "" ? "" : `<b>${esc(c.name)}</b> `;
  const where = device === "" ? "" : `<span class="on">· ${esc(device)}</span>`;
  return `<p class="call">${where}${icon}${verb}${esc(text)}</p>`;
}
function images_html(names) {
  const pics = names.map((name) => {
    const url = "/image/" + esc(name);
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${esc(name)}" loading="lazy"></a>`;
  });
  return names.length === 0 ? "" : `<div class="pics">${pics.join("")}</div>`;
}
function pick_html(fold, on, knobs) {
  const parts = knobs.map((k) => [
    `<button title="${esc(k.hint)}" data-knob="${k.move}" popovertarget="pick-${k.move}" aria-haspopup="menu">${esc(k.text)}</button>`,
    `<div id="pick-${k.move}" class="choices" popover role="menu" aria-label="${k.move[0].toUpperCase() + k.move.slice(1)}">${k.choices.map(choice_html).join("")}</div>`
  ]);
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  return [...all, `<span class="rule"></span>`, ...parts.flatMap((part, i) => i === 0 ? part : [`<span class="dot">·</span>`, ...part])];
}
function choice_html(c) {
  const head = c.vendor === null ? "" : `<p>${esc(c.vendor)}</p>`;
  const act = c.here ? " autofocus" : act_html({ $: "Move", move: c.move, to: c.to });
  return `${head}<button role="menuitemradio" aria-checked="${c.here}"${act}>${esc(c.text)}</button>`;
}
function mcp_html(plugs) {
  const one = (p) => {
    const hint = "Its tools are " + (p.on ? "on" : "off") + " in this chat; click to turn them " + (p.on ? "off" : "on") + ".";
    return `<button class="${p.on ? "on" : "off"}" title="${esc(hint)}"${act_html({ $: "Plug", name: p.name })}>${esc(p.name)}<span>${p.on ? "on" : "off"}</span></button>`;
  };
  return plugs.length === 0 ? [] : [`<p>MCP servers</p>`, ...plugs.map(one)];
}
function tabs_html(tabs) {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    const sub = tab.sub === undefined ? "" : ` <small>${esc(tab.sub)}</small>`;
    const title = tab.sub === undefined ? "" : ` title="${esc(tab.sub)}"`;
    return `<button${here}${title}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}${sub}</button>`;
  });
}
function timers_html(timers) {
  return timers.map((t) => {
    const cancel = `<button class="cancel"${act_html({ $: "Unschedule", id: t.id })}>Cancel</button>`;
    return `<li data-id="${esc(t.id)}"><span class="when">${esc(timer_when(t))}</span><span class="text">${esc(t.text)}</span>${cancel}</li>`;
  });
}
function task_when(iso) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function task_head(t) {
  return `<p class="head"><span class="id">${esc(t.id)}</span><span class="title">${esc(t.title)}</span></p>`;
}
function task_origin(t) {
  const said = origin_said(t);
  if (said === "") {
    return [];
  }
  const url = t.origin_url !== null && /^https?:\/\//i.test(t.origin_url) ? t.origin_url : null;
  return [url === null ? `<span class="origin" title="Origem">${esc(said)}</span>` : `<a class="origin" title="Origem" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(said)}</a>`];
}
function task_meta(more) {
  return more.length === 0 ? "" : `<p class="meta">${more.join(" · ")}</p>`;
}
function task_button(t, state, text, cls, answer) {
  return `<button class="${cls}"${act_html({ $: "Task", task: t.id, state, ...answer === undefined ? {} : { answer } })}>${esc(text)}</button>`;
}
function marks_html(t, tasks, now) {
  return task_marks(t, tasks, now).map(([cls, text]) => `<span class="mark ${esc(cls)}">${esc(text)}</span>`);
}
function evidence_html(t) {
  const all = t.evidence ?? [];
  if (all.length === 0) {
    return `<p class="evidence none"><span class="mark unproven">${esc(UNPROVEN_SAID)}</span> Fechada sem evidência registrada. Reabra-a se o problema não foi resolvido.</p>`;
  }
  return `<section class="evidence" aria-label="Evidência"><p class="sub">Evidência</p><ul>${all.map((e) => `<li>${esc(evidence_said(e))}</li>`).join("")}</ul></section>`;
}
function task_detail(t) {
  return t.detail === "" ? "" : `<div class="detail"><div class="md">${md_parse(t.detail).map(block_html).join("")}</div></div>`;
}
function turn_html(t, tasks, now, turn, blocked) {
  const said = task_turn_said(t, tasks, now, turn, blocked);
  return `<p class="turn-line ${esc(said.cls)}"><strong>${esc(said.lead)}</strong> ${esc(said.text)}</p>`;
}
function goto_html(tasks, id) {
  const u = tasks.find((x) => x.id === id);
  const how = u === undefined ? " (fora da lista)" : u.state === "open" ? "" : u.state === "done" ? " (concluída)" : " (descartada)";
  return `<button class="goto" data-desk="${esc(id)}">${esc(id_whose(tasks, id))}${esc(how)}</button>`;
}
function facts_html(t, tasks, now, blocked) {
  const rows = [];
  const add = (label, html) => html !== "" && rows.push([label, html]);
  const when = (iso) => iso == null || Number.isNaN(Date.parse(iso)) ? "" : `<time datetime="${esc(iso)}">${esc(task_when(iso))}</time> <span class="ago">(${esc(ago_said(iso, now))})</span>`;
  add("Situação", esc(task_status_said(t)));
  add("Responsável", esc(t.assignee === "user" ? "Você" : t.assignee === "unii" ? "Unii" : t.assignee));
  add("Agente", t.agent == null ? t.state === "open" && t.assignee !== "user" ? `<span class="agent none">sem agente</span>` : "" : esc(t.agent));
  add("Origem", task_origin(t).join(""));
  add("Frente", t.ref === null ? "" : `<span class="ref">${esc(t.ref)}</span>`);
  add("Tipo", esc(task_kind_said(t)));
  add("Prioridade", esc(task_priority_said(t).replace(/^prioridade /, "")));
  if (t.state === "open") {
    add("Prazo", esc(task_limit_said(t, tasks, now, blocked)));
  }
  add("Ordem recebida", (t.order ?? null) === null ? "" : esc(t.order.answer ?? "sua escolha"));
  add("Próximo passo", esc(t.state === "open" ? t.next_step ?? "" : ""));
  add("Pronto quando", esc(t.done_when ?? ""));
  add("Aguarda (fora da lista)", esc(t.state === "open" ? t.waits_for ?? "" : ""));
  add("Depende de", (t.after ?? []).map((id) => goto_html(tasks, id)).join(" "));
  add("Libera", t.state === "open" ? frees_ids(tasks, t).map((id) => goto_html(tasks, id)).join(" ") : "");
  const pr = (p) => {
    const c = (t.prs ?? []).find((x) => x.url === p.url);
    const said = c === undefined ? "" : ` <span class="verdict ${esc(c.verdict)}">${esc(VERDICT_SAID[c.verdict])}</span> <code>${esc(c.head.slice(0, 7))}</code>`;
    return `<span class="pr-fact"><a class="pr" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.label)}</a>${said}</span>`;
  };
  add(task_prs(t).length === 1 ? "PR" : "PRs", task_prs(t).map(pr).join(""));
  if (t.state === "open" && (t.fields ?? []).length > 0) {
    const left = task_fields_left(t);
    const given = t.fields.filter((f) => Object.hasOwn(t.draft ?? {}, f.id) && !value_empty(t.draft[f.id])).length;
    add("Campos", esc(given + " de " + t.fields.length + " respondidos" + (left.length === 0 ? "" : "; faltam: " + left.map((f) => f.label).join(", "))));
  }
  const thread = t.thread ?? [];
  if (thread.length > 0) {
    const last = thread[thread.length - 1];
    add("Conversa", esc(thread.length + (thread.length === 1 ? " mensagem" : " mensagens") + "; última de " + (last.who === "user" ? "você" : "Unii") + " " + ago_said(last.at, now)));
  }
  add("Criada", when(t.made));
  add("Última mudança", t.changed === t.made ? "" : when(t.changed));
  if (t.state !== "open") {
    add("Resolvida", when(t.closed));
    add("Resposta", esc(t.answer ?? ""));
  }
  add("Comentário", esc(t.note ?? ""));
  return `<aside class="facts" aria-label="Ficha da pendência ${esc(t.id)}"><p class="sub">Ficha</p><dl>${rows.map(([k, v]) => `<div class="fact"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl></aside>`;
}
function task_article(t, cls, tasks, now, turn, marks, main) {
  const blocked = blocked_ids(tasks);
  return `<article class="${esc(cls)}" data-task="${esc(t.id)}">${task_head(t)}${task_meta(marks)}${turn_html(t, tasks, now, turn, blocked)}<div class="cols"><div class="main">${main}</div>${facts_html(t, tasks, now, blocked)}</div></article>`;
}
function task_open_html(t, tasks, now = Date.now(), turn = null) {
  const frees = task_frees_named(tasks, t);
  const mine = t.assignee === "user";
  const blocked = blocked_ids(tasks);
  const late = task_late_said(t, blocked, now);
  const stalled = task_stalled_said(t, blocked, now);
  const prio = task_priority_said(t);
  const said = task_talk_wait_said(t, now, turn, blocked);
  const marks = [
    ...prio === "" ? [] : [`<span class="prio ${esc(priority_of(t))}">${esc(prio)}</span>`],
    ...late === "" ? [] : [`<span class="late">${esc(late)}</span>`],
    ...frees === "" ? [] : [`<span class="frees">${esc(frees)}</span>`],
    ...said === "" ? [] : [`<span class="talk ${esc(talk_cls(said))}">${esc(said)}</span>`],
    ...stalled.text === "" ? [] : [`<span class="${stalled.late ? "late" : "stalled"}">${esc(stalled.text)}</span>`],
    ...marks_html(t, tasks, now),
    ...(t.waits_for ?? null) === null ? [] : [`<span class="waits-for">${esc(task_waits_for_said(t))}</span>`]
  ];
  const cls = "task " + (mine ? "user" : "other " + t.assignee) + (t.talk === null ? "" : " talk-" + t.talk);
  const read = `${task_detail(t)}${task_prs_html(t)}`;
  if (!mine) {
    const asked = t.talk === "unii";
    const why = `chase-why-${esc(t.id)}`;
    const chase = `<button class="chase"${asked ? ` disabled aria-describedby="${why}"` : ""}${act_html({ $: "TaskSay", task: t.id, text: CHASE })}>${asked ? "Cobrado: aguardando o Unii" : "Cobrar agora"}</button>`;
    const ordered = t.state === "open" && (t.order ?? null) !== null;
    const close = ordered ? task_button(t, "dropped", "Cancelar ordem", "drop cancel") : task_button(t, "done", "Pode fechar", "close");
    const hint = asked ? `<span class="hint" id="${why}">Você já cobrou e o Unii ainda não respondeu. “Cobrar agora” volta quando ele responder na conversa.</span>` : "";
    const acts = `<div class="acts unii">${hint}${chase}${close}</div>`;
    return task_article(t, cls, tasks, now, turn, marks, `${read}${acts}${thread_html(t)}`);
  }
  const rec = task_rec(t);
  const opt = (c) => {
    const on = rec_is(rec, c);
    const tagged = (on && !rec_marked(c) ? ` <span class="rec-tag">recomendada</span>` : "") + (act_unii(t, c) ? ` <span class="act-tag">${esc(ACT_SAID)}</span>` : "");
    return `<button class="opt${on ? " rec" : ""}"${act_html({ $: "Task", task: t.id, state: "done", answer: c })}>${esc(c)}${tagged}</button>`;
  };
  const opts = t.choices.length === 0 ? "" : `<div class="opts" role="group" aria-label="Concluir como"><span class="lead">Concluir como:</span>${t.choices.map(opt).join("")}</div>`;
  const note = `<input class="note" type="text" maxlength="1000" placeholder="Comentário (opcional)" aria-label="Comentário sobre ${esc(t.id)}" data-keep="note">`;
  const accept = task_accepts(t) ? `<button class="accept" aria-keyshortcuts="a" title="Atalho: a"${act_html({ $: "TaskAccept", task: t.id })}>${esc(task_accept_said(t))}</button>` : "";
  const orders = t.choices.some((c) => act_unii(t, c));
  const told = `<span class="hint told">${orders ? `As opções marcadas “${esc(ACT_SAID)}” avisam o Unii na hora; as demais, em até 1 min.` : "O Unii é avisado sozinho em até 1 min."}</span>`;
  const acts = `<div class="acts">${told}${accept}${task_button(t, "done", "Concluir", "done")}${task_button(t, "dropped", "Descartar", "drop")}</div>`;
  const decide = `<section class="decide" aria-label="Decisão">${fields_html(t)}${note}${opts}${acts}</section>`;
  return task_article(t, cls, tasks, now, turn, marks, `${read}${decide}${thread_html(t)}`);
}
function task_prs_html(t) {
  const verified = new Set((t.prs ?? []).map((p) => p.url));
  const cards = (t.prs ?? []).length === 0 ? "" : `<section class="checks" aria-label="Verificação">${t.prs.map(check_html).join("")}</section>`;
  const prs = task_prs(t).filter((p) => !verified.has(p.url));
  if (prs.length === 0) {
    return cards;
  }
  return cards + task_links_html(prs);
}
function check_html(p) {
  const notes = p.notes.length === 0 ? "" : `<ul class="notes">${p.notes.map((n) => `<li class="sev ${esc(n.sev)}"><span class="sev-tag">${esc(SEV_SAID[n.sev][0])}</span> ${esc(n.text)}</li>`).join("")}</ul>`;
  const untested = p.untested.length === 0 ? "" : `<p class="untested"><span class="lead">Não testado:</span> ${esc(p.untested.join("; "))}</p>`;
  const by = p.verifier === null ? "" : ` por ${esc(p.verifier)}`;
  return `<div class="check ${esc(p.verdict)}"><p class="check-head"><a class="pr" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(pr_label(p.url))}</a> <span class="lead">head</span> <code class="head">${esc(p.head.slice(0, 12))}</code> <span class="verdict">${esc(VERDICT_SAID[p.verdict])}${by}</span> <span class="count">${esc(pr_notes_said(p))}</span></p>${notes}${untested}</div>`;
}
function task_links_html(prs) {
  const one = (p) => `<a class="pr" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.label)}</a>`;
  return prs.length === 0 ? "" : `<p class="prs"><span class="lead">${prs.length === 1 ? "PR" : "PRs"}:</span> ${prs.map(one).join(" ")}</p>`;
}
function task_closed_html(t, tasks, now = Date.now()) {
  const how = [...t.told ? [] : ["o Unii será avisado em até 1 min"], ...marks_html(t, [], now)];
  const acts = `<div class="acts">${task_button(t, "open", "Reabrir", "reopen")}</div>`;
  const cls = "task closed" + (task_unproven(t) ? " unproven" : "");
  return task_article(t, cls, tasks, now, null, how, `${evidence_html(t)}${task_detail(t)}${task_prs_html(t)}${answers_html(t)}${acts}${thread_read_html(t)}`);
}
function task_waiting_html(t, tasks, now = Date.now()) {
  const cls = "task waiting " + (t.assignee === "user" ? "user" : "other " + t.assignee);
  const frees = task_frees_named(tasks, t);
  const marks = frees === "" ? [] : [`<span class="frees">${esc(frees)}</span>`];
  const why = `<p class="waits">Só pode ser resolvida depois de: ${and_said(waits(tasks, t).map((id) => goto_html(tasks, id)))}.</p>`;
  return task_article(t, cls, tasks, now, null, marks, `${why}${task_detail(t)}${task_prs_html(t)}${thread_read_html(t)}`);
}
function answers_html(t) {
  const fields = t.fields ?? [];
  const values = t.answers ?? {};
  if (t.state !== "done" || fields.length === 0) {
    return "";
  }
  const said = (f) => {
    const v = Object.hasOwn(values, f.id) ? values[f.id] : undefined;
    return v === undefined || v.length === 0 ? "sem resposta" : Array.isArray(v) ? v.join(", ") : v;
  };
  return `<dl class="answers">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(said(f))}</dd>`).join("")}</dl>`;
}
function thread_read_html(t) {
  const thread = t.thread ?? [];
  return thread.length === 0 ? "" : `<section class="thread read"><p class="sub">Conversa (${thread.length})</p><ol>${thread.map(thread_msg_html).join("")}</ol></section>`;
}
function desk_html(tasks, q, ref, sel, now = Date.now(), opts = {}) {
  const groups = desk_list(tasks, q, ref);
  const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
  const blocked = blocked_ids(tasks);
  const turn = opts.turn ?? null;
  const row = (t, g) => {
    const frees = g === "closed" ? "" : task_frees_named(tasks, t);
    const late = task_late_said(t, blocked, now);
    const stalled = g === "others" ? task_stalled_said(t, blocked, now) : { text: "", late: false };
    const agent = g === "closed" ? "" : task_agent_said(t);
    const talk = g === "closed" ? "" : task_talk_wait_said(t, now, turn, blocked);
    const prs = g === "closed" ? [] : task_prs(t);
    const prio = g === "closed" ? "" : task_priority_said(t);
    const outside = g === "closed" ? "" : task_waits_for_said(t);
    const rejected = g === "closed" ? 0 : (t.prs ?? []).filter((p) => p.verdict === "rejected").length;
    const more = [
      ...prio === "" ? [] : [`<span class="prio ${esc(priority_of(t))}">${esc(prio)}</span>`],
      ...late === "" ? [] : [`<span class="late">${esc(late)}</span>`],
      ...t.ref === null ? [] : [`<span class="ref">${esc(t.ref)}</span>`],
      ...prs.length === 0 ? [] : [`<span class="pr">${esc(prs.length === 1 ? "PR " + prs[0].label : prs.length + " PRs")}</span>`],
      ...rejected === 0 ? [] : [`<span class="late">${esc(rejected === 1 ? "1 PR reprovado" : rejected + " PRs reprovados")}</span>`],
      ...outside === "" ? [] : [`<span class="waits-for">${esc(outside)}</span>`],
      ...talk === "" ? [] : [`<span class="talk ${esc(talk_cls(talk))}">${esc(talk)}</span>`],
      ...t.assignee === "user" ? [] : [esc(assignee_said(t))],
      ...agent === "" ? [] : [`<span class="agent${t.agent == null ? " none" : ""}">${esc(agent)}</span>`],
      ...stalled.text === "" ? [] : [`<span class="${stalled.late ? "late" : "stalled"}">${esc(stalled.text)}</span>`],
      ...frees === "" ? [] : [`<span class="frees">${esc(frees)}</span>`],
      ...g === "waiting" ? [esc(task_waits_named(tasks, t))] : [],
      ...g === "closed" ? [t.state === "done" ? "concluída" : "descartada"] : [],
      ...marks_html(t, tasks, now)
    ];
    const on = t.id === sel;
    return `<button class="row ${g}${on ? " sel" : ""}" role="option" aria-selected="${on}" data-desk="${esc(t.id)}"><span class="head"><span class="id">${esc(t.id)}</span><span class="title">${esc(t.title)}</span></span>${more.length === 0 ? "" : `<span class="meta">${more.join(" · ")}</span>`}</button>`;
  };
  const list = groups.flatMap((g) => [`<p class="group ${g.group}" role="presentation">${esc(g.label)} <span class="n">(${g.tasks.length})</span></p>`, ...g.tasks.map((t) => row(t, g.group))]);
  const searched = q.trim() !== "" || ref !== "";
  const none = tasks.length === 0 ? "Nenhuma pendência. Quando o Unii precisar de você, ela aparece aqui." : searched && ids.length === 0 ? "Nenhuma pendência na busca." : "";
  const t = sel === null ? undefined : tasks.find((x) => x.id === sel);
  const back = `<button class="back" type="button" data-desk-back aria-label="Voltar à lista">← Pendências</button>`;
  const after = t === undefined || desk_group(t, blocked) === "now" ? null : desk_next(tasks, t.id, q, ref, opts.order ?? []);
  const next = after === null ? [] : [`<button class="next" type="button" data-desk="${esc(after.id)}">Próxima: <span class="id">${esc(after.id)}</span> ${esc(after.title)} →</button>`];
  const detail = t === undefined ? [`<p class="empty">${tasks.length === 0 ? "Nenhuma pendência." : "Escolha uma pendência na lista (<kbd>j</kbd> e <kbd>k</kbd> navegam)."}</p>`] : [back, t.state !== "open" ? task_closed_html(t, tasks, now) : blocked.has(t.id) ? task_waiting_html(t, tasks, now) : task_open_html(t, tasks, now, turn), ...next];
  return { list: none === "" ? list : [...list, `<p class="none">${esc(none)}</p>`], detail, ids };
}
function fields_html(t) {
  const fields = t.fields ?? [];
  if (fields.length === 0) {
    return "";
  }
  const draft = t.draft ?? {};
  const one = (f) => {
    const v = Object.hasOwn(draft, f.id) ? draft[f.id] : undefined;
    const name = "f-" + t.id + "-" + f.id;
    const req = f.required ? ` <span class="req" title="Obrigatório">*</span>` : "";
    const legend = `<legend>${esc(f.label)}${req}</legend>`;
    const must = f.required ? ` data-required="true"` : "";
    if (f.kind === "text") {
      const rec = field_rec(f);
      const hint = typeof rec === "string" ? `<p class="rec-text"><span class="rec-tag">recomendado</span> ${esc(rec)}</p>` : "";
      return `<fieldset class="field" data-field="${esc(f.id)}" data-kind="text"${must}>${legend}${hint}<textarea rows="2" maxlength="1000" aria-label="${esc(f.label)}" data-keep="f-${esc(f.id)}">${esc(typeof v === "string" ? v : "")}</textarea></fieldset>`;
    }
    const type = f.kind === "multi" ? "checkbox" : "radio";
    const on = (c) => Array.isArray(v) ? v.includes(c) : v === c;
    const rec = field_rec(f);
    const label = (c) => {
      const r = rec_is(rec, c);
      const tagged = r && !rec_marked(c) ? ` <span class="rec-tag">recomendada</span>` : "";
      return `<label${r ? ` class="rec"` : ""}><input type="${type}" name="${esc(name)}" value="${esc(c)}"${on(c) ? " checked" : ""}> ${esc(c)}${tagged}</label>`;
    };
    const boxes = f.choices.map(label).join("");
    return `<fieldset class="field" data-field="${esc(f.id)}" data-kind="${esc(f.kind)}"${must}>${legend}<div class="picks">${boxes}</div></fieldset>`;
  };
  return `<div class="fields">${fields.map(one).join("")}</div>`;
}
function thread_msg_html(m) {
  return m.who === "unii" ? `<li class="unii"><span class="who">Unii</span><div class="md">${md_parse(m.text).map(block_html).join("")}</div></li>` : `<li class="user"><span class="who">Você</span><p>${esc(m.text)}</p></li>`;
}
function thread_html(t) {
  const thread = t.thread ?? [];
  const said = thread.length === 0 ? "Conversar sobre esta pendência" : "Conversa (" + thread.length + ")";
  const box = `<textarea class="say" rows="3" maxlength="4000" placeholder="Escreva sobre esta pendência (não a conclui)" aria-label="Mensagem sobre ${esc(t.id)}" data-keep="say"></textarea>`;
  const send = `<button class="say-send"${act_html({ $: "TaskSay", task: t.id, text: "" })}>Enviar</button>`;
  const msgs = thread.length === 0 ? "" : `<ol>${thread.map(thread_msg_html).join("")}</ol>`;
  return `<section class="thread"><p class="sub">${esc(said)}</p>${msgs}${box}<div class="acts"><span class="hint">Ctrl+Enter envia</span>${send}</div></section>`;
}
function account_html(prompts, notify = null) {
  const item = (what, note, act) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const acts = [
    item("This browser", "Signed in to this server.", `<button class="chip out">Sign out</button>`),
    ...notify === null ? [] : [notify_html(notify)],
    item("Export memory", "The chat and its summaries, in one file.", `<a class="chip" href="/export">Download</a>`)
  ];
  const unread = item("Could not read the prompts.", "", `<button class="chip retry">Try again</button>`);
  const mine = section_html("Prompts", prompts === null ? unread : prompt_html("prompt", prompts.prompt.text, "The user prompt: Unii's system prompt in every turn; its subagents get it too once you change it. Add who you are and how you want work done at its end. prompt.md in the server's folder; empty: the built-in one.") + prompt_html("compact", prompts.compact.text, "The compaction prompt: all a summary of the memory gets, nothing else. compact.md in the server's folder; empty: the built-in one."));
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Settings</h1>` + mine + section_html("This browser", acts.join("")) + `<div class="owned"></div>`;
}
function prompt_html(name, text, note) {
  const area = `<textarea name="${name}" rows="12" spellcheck="false">${esc(text)}</textarea>`;
  return `<form class="prompt"><p class="note">${esc(note)}</p>${area}<div><p class="why"></p><button class="chip">Save</button></div></form>`;
}
function notify_html(notify) {
  const note = {
    off: "Respostas e pendências que precisam de você, neste aparelho, quando o UniiChat não está aberto.",
    on: "Respostas e pendências que precisam de você, neste aparelho, quando o UniiChat não está aberto.",
    blocked: "Bloqueadas nas configurações deste navegador para este site.",
    home: "No iPhone e no iPad: toque em Compartilhar, depois em Adicionar à Tela de Início, e abra o UniiChat por lá."
  }[notify];
  const button = notify === "home" ? "" : `<button class="chip notify"${notify === "blocked" ? " disabled" : ""}>${notify === "on" ? "Desativar" : "Ativar"}</button>`;
  return `<div class="item"><p>Notificações<small>${note}</small></p>${button}</div>`;
}
var SETTING = {
  vendors: ["Vendors", "Whose models the server offers."],
  models: ["Models", "The models offered, of those vendors."],
  pick: ["Default model", "What a chat runs on until it picks another."],
  compactor: ["Compactor model", "What writes the memory's summaries."],
  agents: ["Subagent model", "What subagents run on."],
  site: ["Site", "The server's address, for sign-in links and the installer."],
  apple: ["iOS App ID", "The app's team and bundle ID, whose sign-in links it opens."],
  apns: ["APNs key ID", "The ID of the key the app's pushes are signed with."]
};
var KEY = {
  anthropic: ["Anthropic key", "For claude-api's models."],
  openai: ["OpenAI key", "For openai-api's models and dictation."],
  cursor: ["Cursor key", "For cursor's models, instead of `unii serve cursor`'s sign-in."],
  apns: ["APNs key", "The .p8 key the iOS app's pushes are signed with."]
};
var VENDOR_KEY = { "claude-api": "anthropic", "openai-api": "openai" };
var PICKS = ["pick", "compactor", "agents"];
var GROUPS = [
  ["Models", ["vendors", "models", "pick", "compactor", "agents"]],
  ["Server", ["site", "apple", "apns"]]
];
function settings_html(page) {
  const rows = new Map(page.settings.filter((r) => r.web && r.from !== "env").map((r) => [r.key, r]));
  const group = ([title, keys]) => {
    const shown = keys.flatMap((k) => rows.get(k) ?? []);
    return shown.length === 0 ? "" : section_html(title, shown.map(setting_html).join(""));
  };
  const shown = page.keys.filter((k) => k.from !== "env");
  const keys = shown.length === 0 ? "" : section_html("Keys", `<p class="sub">Kept in keys.json in the server's folder, readable by the server's user only, and never shown again, only their last characters.</p>` + shown.map(key_html).join(""));
  const error = page.error === null ? "" : `<p class="why bad">${esc(page.error)}</p>`;
  const save = `<div class="save"><p class="why"></p><button class="chip go"${page.error === null ? "" : " disabled"}>Save</button></div>`;
  const head = `<p class="sub">The server's settings, in config.json in its folder.</p>`;
  const profiles = page.profiles === null ? "" : section_html("Profiles", `<p class="sub">Ranked models: a chat on a profile runs on the first and falls back to the next when one is out.</p><div class="set profiles" data-key="profiles"><div class="field"></div><p class="err"></p></div>`);
  return head + error + `<form class="settings" autocomplete="off">` + group(GROUPS[0]) + profiles + keys + group(GROUPS[1]) + save + `</form>`;
}
function offered(vendors, models) {
  return Pick.models(VENDORS.filter((v) => vendors.includes(v)), models).map(([v, m]) => v + ":" + m.label);
}
function profiles_html(profiles, offered) {
  const model = (m, i, j) => {
    const [vendor = "", label = m, ...rest] = m.split(":");
    const more = rest.length === 0 ? "" : ` <small>${esc(rest.join(" · "))}</small>`;
    return `<li data-j="${j}"><button type="button" class="grip" data-i="${i}" data-j="${j}" aria-label="Move ${esc(label)}">⠿</button><span>${esc(label)}${more} <small>${esc(vendor)}</small></span><button type="button" class="out" data-i="${i}" data-j="${j}" aria-label="Remove ${esc(label)}">×</button></li>`;
  };
  const add = (list, i) => {
    const left = offered.filter((m) => !list.some((x) => x.split(":").slice(0, 2).join(":") === m));
    const groups = [...new Set(left.map((m) => m.split(":")[0]))].map((v) => `<optgroup label="${esc(v)}">${left.filter((m) => m.startsWith(v + ":")).map((m) => `<option value="${esc(m)}">${esc(m.split(":")[1])}</option>`).join("")}</optgroup>`);
    return left.length === 0 ? "" : `<select class="add" data-i="${i}" aria-label="Add model"><option value="">Add model</option>${groups.join("")}</select>`;
  };
  const one = ([name, list], i) => `<div class="prof" data-i="${i}"><div class="name"><input class="pname" data-i="${i}" value="${esc(name)}" aria-label="Name" placeholder="Enter the profile name here" maxlength="60" spellcheck="false" autocapitalize="off"><button type="button" class="chip red pdel" data-i="${i}">Delete</button></div><ol>${list.map((m, j) => model(m, i, j)).join("")}</ol>${add(list, i)}</div>`;
  return profiles.map(one).join("") + `<button type="button" class="chip pnew">Add profile</button>`;
}
function setting_html(r) {
  const [name, about] = SETTING[r.key] ?? [r.key, ""];
  const id = "set-" + r.key + (PICKS.includes(r.key) ? "-vendor" : "");
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(r.key)}</code></small></label>`;
  return `<div class="set" data-key="${esc(r.key)}">${label}<div class="field">${control_html(r)}</div>${from_html(r)}<p class="err"></p></div>`;
}
function control_html(r) {
  switch (r.key) {
    case "vendors": {
      return checks_html("vendors", VENDORS, list(r.value), () => "") + `<p class="warn"></p>`;
    }
    case "models": {
      return checks_html("models", LABELS, list(r.value), (x) => Pick.models(VENDORS, [x]).map(([vendor]) => vendor).join(" "));
    }
    case "pick":
    case "compactor":
    case "agents": {
      return `<input type="hidden" name="${r.key}" value="${esc(r.value)}"><div class="four"></div>`;
    }
  }
  return `<input id="set-${r.key}" name="${r.key}" value="${esc(r.value)}" placeholder="${esc(r.def)}" spellcheck="false" autocapitalize="off">`;
}
function list(text) {
  return text.split(",").map((x) => x.trim()).filter((x) => x !== "");
}
function list_changed(was, now) {
  const same = was.length === now.length && was.every((x) => now.includes(x)) && now.every((x) => was.includes(x));
  return same ? null : [...was.filter((x) => now.includes(x)), ...now.filter((x) => !was.includes(x))];
}
function checks_html(name, all, on, vendor) {
  const box = (x) => `<label class="opt" data-vendor="${esc(vendor(x))}"><input type="checkbox" name="${name}" value="${esc(x)}"${on.includes(x) ? " checked" : ""}> ${esc(x)}</label>`;
  const odd = on.filter((x) => !all.includes(x));
  return `<div class="opts">${all.map(box).join("")}${odd.map(box).join("")}</div>`;
}
function from_html(r) {
  const from = r.from === "file" ? "From config.json" : "Default";
  const apply = r.apply === "now" ? "applies at once" : "applies on a restart";
  const running = r.running === null ? "" : ` · running on <code>${esc(r.running === "" ? "(none)" : r.running)}</code> till then`;
  const reset = r.from === "file" ? ` <button type="button" class="reset">Use the default</button>` : "";
  return `<p class="from">${from} · ${apply}${running}${reset}</p>`;
}
function key_html(k) {
  const [name, about] = KEY[k.name] ?? [k.name, ""];
  const id = "set-key-" + k.name;
  const field = k.name === "apns" ? `<textarea id="${id}" name="key.${k.name}" rows="3" placeholder="Paste a new key to set it" spellcheck="false"></textarea>` : `<input id="${id}" type="password" name="key.${k.name}" autocomplete="new-password" placeholder="Paste a new key to set it" spellcheck="false" autocapitalize="off">`;
  const tail = k.tail === "" ? "" : `, ending in <code>${esc(k.tail)}</code>`;
  const from = k.from === "file" ? `Set${tail}, in keys.json` : "Not set";
  const reset = k.from === "file" ? ` <button type="button" class="reset">Remove</button>` : "";
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(k.env)}</code></small></label>`;
  return `<div class="set key" data-key="key.${esc(k.name)}">${label}<div class="field">${field}</div><p class="from">${from}${reset}</p><p class="err"></p></div>`;
}
function picks_html(key, vendors, models, value, none, profiles = []) {
  const [vendor = "", model = "", effort = "", speed = ""] = value === "" ? [] : value.split(":");
  const known = VENDORS.includes(vendor);
  const offered = VENDORS.filter((v) => vendors.includes(v));
  const labels = known ? Pick.models([vendor], models).map(([, m]) => m.label) : [];
  const speeds = known ? Pick.model(vendor, model)?.speeds ?? [] : [];
  const select = (part, name, all, on, first) => {
    const opts = [...first === null ? [] : [["", first]], ...all.includes(on) || on === "" && first !== null ? [] : [[on, on + " (not offered)"]], ...all.map((x) => [x, x])];
    const items = opts.map(([v, text]) => `<option value="${esc(v)}"${v === on ? " selected" : ""}>${esc(text)}</option>`).join("");
    return `<select id="set-${key}-${part}" name="${key}.${part}" aria-label="${name}">${items}</select>`;
  };
  const head = select("vendor", "Vendor", [...offered, ...profiles], vendor, none);
  return vendor === "" || profiles.includes(vendor) ? head : head + select("model", "Model", labels, model, null) + select("effort", "Effort", EFFORTS, effort, null) + select("speed", "Speed", speeds, speed, null);
}
function pick_mend(parts, models, profiles = []) {
  const [vendor = "", model = "", effort = "", speed = ""] = parts;
  if (profiles.includes(vendor)) {
    return vendor;
  }
  if (!VENDORS.includes(vendor)) {
    return vendor === "" ? "" : parts.join(":");
  }
  const m = Pick.model(vendor, model) ?? Pick.models([vendor], models)[0]?.[1];
  if (m === undefined) {
    return parts.join(":");
  }
  return [vendor, m.label, effort || "medium", m.speeds.includes(speed) ? speed : m.speeds[0]].join(":");
}
function section_html(title, body) {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}
function block_html(b) {
  switch (b.$) {
    case "Para": {
      return `<p>${b.x.map(spans_html).join("<br>")}</p>`;
    }
    case "Head": {
      const tag = "h" + Math.min(4, b.k + 1);
      return `<${tag}>${spans_html(b.x)}</${tag}>`;
    }
    case "Code": {
      const lang = b.k === "" ? "" : `<span class="lang">${esc(b.k)}</span>`;
      return `<pre>${copy_html(b.x)}${lang}<code>${esc(b.x)}</code></pre>`;
    }
    case "Rule": {
      return "<hr>";
    }
    case "Quot": {
      return `<blockquote>${b.x.map(block_html).join("")}</blockquote>`;
    }
    case "List": {
      const tag = b.k ? "ol" : "ul";
      const start = b.k && b.n !== 1 ? ` start="${b.n}"` : "";
      const items = b.x.map((item) => `<li>${item_html(item, b.t)}</li>`);
      return `<${tag}${start}>${items.join("")}</${tag}>`;
    }
    case "Tabl": {
      const rows = b.x.map((row, i) => {
        const tag = i === 0 ? "th" : "td";
        const cells = row.map((cell) => `<${tag}>${spans_html(cell)}</${tag}>`);
        return `<tr>${cells.join("")}</tr>`;
      });
      return `<table>${rows.join("")}</table>`;
    }
    case "Diff": {
      return diff_html(b.k, b.x);
    }
    case "File": {
      return file_html(b.k, b.n, b.x);
    }
  }
}
function item_html(blocks, tight) {
  return blocks.map((b) => tight && b.$ === "Para" ? b.x.map(spans_html).join("<br>") : block_html(b)).join("");
}
function diff_html(file, hunks) {
  const all = hunks.flat();
  const nw = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const adds = all.filter((l) => l.s === "+").length;
  const dels = all.filter((l) => l.s === "-").length;
  const head = `<span class="lang">${esc(file)} <b class="add">+${adds}</b> <b class="del">-${dels}</b></span>`;
  const line = (l) => `<span class="${MARKS2[l.s]}"><i>${l.n}</i>${l.s} ${esc(l.x)}</span>`;
  const lines = hunks.map((h) => h.map(line).join("")).join(`<span class="gap">⋯</span>`);
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${lines}</code></pre>`;
}
function file_html(shown, from, lines) {
  const nw = String(from + lines.length - 1).length;
  const head = `<span class="lang">${esc(shown)}</span>`;
  const body = lines.map((x, k) => `<span class="file"><i>${from + k}</i>${esc(x)}</span>`).join("");
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${body}</code></pre>`;
}
function spans_html(spans) {
  return spans.map(span_html).join("");
}
function span_html(s) {
  switch (s.$) {
    case "Text": {
      return esc(s.x).replaceAll("UniiChat", `<span class="brand">UniiChat</span>`);
    }
    case "Code": {
      return `<code>${esc(s.x)}</code>`;
    }
    case "Bold": {
      return `<strong>${spans_html(s.x)}</strong>`;
    }
    case "Ital": {
      return `<em>${spans_html(s.x)}</em>`;
    }
    case "Link": {
      return `<a href="${esc(s.k)}" target="_blank" rel="noopener">${spans_html(s.x)}</a>`;
    }
    case "Name": {
      const label = agent_label(s.x);
      const shown = label === undefined ? esc(s.x) : `${esc(label)} <small>${esc(s.x)}</small>`;
      return `<button class="name" title="${esc(s.x)}"${act_html({ $: "Goto", name: s.x })}>[${shown}]</button>`;
    }
  }
}
function pipeline_html(panel, now = Date.now(), why = "", opened = null) {
  const head = `<a class="back" href="/" data-go="/">← Voltar</a><h1>Pipeline</h1>`;
  if (panel === null) {
    return head + `<p class="pipe-none">${esc(why || "Não foi possível ler o painel.")}</p><button type="button" class="chip pipe-reload">Tentar de novo</button>`;
  }
  const t = pipeline_totals(panel.fronts);
  const card = (n, what, note = "") => `<div class="pipe-total"><b>${esc(n)}</b><span>${esc(what)}</span>${note === "" ? "" : `<small>${esc(note)}</small>`}</div>`;
  const totals = `<section class="pipe-totals" aria-label="Resumo">` + card(String(t.active), t.active === 1 ? "frente ativa" : "frentes ativas") + card(String(t.user), "com você") + card(String(t.stalled), t.stalled === 1 ? "parada com o Unii" : "paradas com o Unii") + card(t.cycles === null ? "—" : num_said(t.cycles), "ciclos por PR", "mediana") + card(t.decide === null ? "—" : took_said(t.decide), "até a sua decisão", t.decided === 0 ? "nenhuma decisão registrada" : "mediana de " + t.decided + (t.decided === 1 ? " decisão" : " decisões")) + card(span_said(t.idle), "tempo parado", "frentes ativas, sem agente e sem você") + `</section>`;
  const read = `<p class="pipe-read">Lido às ${esc(when_said(panel.at).slice(6))}${panel.refreshing ? " · lendo o estado dos PRs no GitHub…" : ""} · <button type="button" class="link pipe-reload">Atualizar</button></p>`;
  const active = panel.fronts.filter((f) => f.stage !== "closed");
  const closed = panel.fronts.filter((f) => f.stage === "closed");
  const list = active.length === 0 ? `<p class="pipe-none">Nenhuma frente ativa.</p>` : `<ol class="pipe-fronts">${active.map((f) => `<li>${front_html(f, now, opened === null ? f.stage === "user" || f.stage === "stalled" : opened.has(f.ref))}</li>`).join("")}</ol>`;
  const old = closed.length === 0 ? "" : `<details class="pipe-closed"><summary>Encerradas (${closed.length})</summary><ol class="pipe-fronts">${closed.map((f) => `<li>${front_html(f, now, opened !== null && opened.has(f.ref))}</li>`).join("")}</ol></details>`;
  return head + read + totals + list + old;
}
function num_said(n) {
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}
function front_html(f, now, open) {
  const since = span_said(now - Date.parse(f.since));
  const notes = f.stage === "closed" ? "" : f.fixing ? " · ressalvas em correção" : " · ressalvas abertas: " + sevs_said(f.open);
  const sum = `<summary><b class="pipe-ref">${esc(f.ref)}</b> <span class="pipe-stage ${f.stage}">${esc(STAGE_SAID[f.stage])}</span> <span class="pipe-meta">${f.stage === "closed" ? "desde " + esc(when_said(f.since)) : "há " + esc(since)} · ${f.cycles.length} ${f.cycles.length === 1 ? "ciclo" : "ciclos"}${esc(notes)}</span></summary>`;
  const tasks = f.tasks.length === 0 ? "" : `<h3>Pendências abertas</h3><ul class="pipe-tasks">${f.tasks.map((t) => `<li><button type="button" class="link" data-desk="${esc(t.id)}">${esc(t.id)}</button> <span class="pipe-who">${t.assignee === "user" ? "sua" : "do Unii"}</span> ${esc(t.title)}</li>`).join("")}</ul>`;
  const working = f.runs.filter((r) => r.state === "working");
  const now_ = working.length === 0 ? "" : `<h3>Agentes trabalhando</h3><ul class="pipe-runs">${working.map((r) => `<li>${run_html(r)} · desde ${esc(when_said(r.start))}</li>`).join("")}</ul>`;
  const prs = f.prs.length === 0 ? "" : `<h3>PRs</h3><ul class="pipe-prs">${f.prs.map(pr_html).join("")}</ul>`;
  const cycles = f.cycles.length === 0 ? `<p class="pipe-none">Nenhuma verificação registrada.</p>` : `<h3>Ciclos de verificação</h3><ol class="pipe-cycles">${f.cycles.map((c) => cycle_html(c)).join("")}</ol>`;
  const decide = f.decide.length === 0 ? "nenhuma decisão sua registrada" : "mediana " + took_said(median_of(f.decide)) + ", máximo " + took_said(Math.max(...f.decide)) + " (" + f.decide.length + (f.decide.length === 1 ? " decisão" : " decisões") + ")";
  const verified = f.prs.filter((p) => p.cycles > 0);
  const per = verified.length === 0 ? "nenhum PR verificado" : verified.map((p) => p.key + ": " + p.cycles).join(" · ");
  const metrics = `<h3>Métricas</h3><dl class="pipe-metrics"><dt>Tempo parado</dt><dd>${esc(span_said(f.idle))} <small>sem agente trabalhando e sem pendência sua, desde ${esc(when_said(f.first))}</small></dd><dt>Até a sua decisão</dt><dd>${esc(decide)}</dd><dt>Ciclos por PR</dt><dd>${esc(per)}</dd></dl>`;
  return `<details class="pipe-front" data-ref="${esc(f.ref)}"${open ? " open" : ""}>${sum}<div class="pipe-body">${tasks}${now_}${prs}${cycles}${metrics}</div></details>`;
}
function run_html(r) {
  return `<span class="pipe-agent">${esc(r.name)}</span>${r.label === null ? "" : ` <small class="pipe-label">${esc(r.label)}</small>`}`;
}
function pr_html(p) {
  const name = p.url === null ? `<span class="pipe-pr">${esc(p.key)}</span>` : `<a class="pipe-pr" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.key)}</a>`;
  const live = p.live === null ? `<span class="pipe-tag">${p.url === null ? "sem link: estado desconhecido" : "estado não lido"}</span>` : `<span class="pipe-tag ${p.live.state.toLowerCase()}">${esc(PR_STATE_SAID[p.live.state])}</span>` + (p.live.state === "OPEN" ? ` <span class="pipe-tag ci-${p.live.ci}">${esc(CI_SAID[p.live.ci])}</span>` : "");
  const head = pr_head_said(p);
  const said = head === null ? p.head === null ? "" : ` · verificado em ${esc(p.head.slice(0, 7))}` : ` · <span class="${head.same ? "" : "pipe-warn"}">${esc(head.text)}</span>`;
  const verdict = p.verdict === null ? "" : ` · ${esc(VERDICT_SAID[p.verdict])}`;
  return `<li>${name} ${live}${said} · ${p.cycles} ${p.cycles === 1 ? "ciclo" : "ciclos"}${verdict}</li>`;
}
function cycle_html(c) {
  const r = c.run;
  const verdict = r.state === "working" ? "verificando" : r.state === "cut" ? "interrompida sem veredito" : r.verdict === null ? "veredito não lido do relato" : VERDICT_SAID[r.verdict];
  const notes = r.verdict === null || r.verdict === "approved" ? "" : r.noted ? " · ressalvas: " + sevs_said(r.notes) : " · ressalvas sem gravidade no relato";
  const prs = r.prs.length === 0 ? "" : ` · ${esc(r.prs.map((k) => k + (r.heads[k] === undefined ? "" : " em " + r.heads[k].slice(0, 7))).join(", "))}`;
  const work = c.after.length === 0 ? "" : `<small class="pipe-work">verificou o trabalho de ${c.after.map((w) => esc(w.name) + (w.label === null ? "" : " (" + esc(w.label) + ")")).join(", ")}</small>`;
  const dur = r.state === "working" ? "" : " · " + took_said(Date.parse(r.end) - Date.parse(r.start));
  const cls = r.verdict === "rejected" ? "rejected" : r.verdict === "approved_with_notes" ? "notes" : r.verdict === "approved" ? "approved" : "";
  return `<li class="${cls}"><span class="pipe-n">Ciclo ${c.n}</span> ${esc(when_said(r.start))}${esc(dur)} · ${run_html(r)} · <b class="pipe-verdict">${esc(verdict)}</b>${esc(notes)}${prs}${work}</li>`;
}

// web/src/main.ts
var APP = window.webkit?.messageHandlers?.unii ?? null;
var DESK2 = matchMedia("(hover: hover)");
var NONE = "No Claude or ChatGPT chats in that folder. Choose ~/.claude or ~/.codex.";
var SCENES = `
  <div class="scene"><p>Your entire life.</p><p>One single chat.</p></div>
  <div class="scene"><i class="mark"></i><h1>UniiChat</h1></div>`;
var v = view_new();
var BOX = $("textarea");
var BACK = $("#import [name=back]");
var P = {
  imgs: [],
  rec: null,
  shown: "",
  end: true,
  stick: true,
  y: 0,
  frame: 0,
  rows: true,
  toast: 0,
  found: new Map,
  done: {},
  off: new Set,
  step: "",
  push: null,
  mode: sessionStorage.getItem(kept("mode")) === "desk" ? "desk" : "chat",
  chose: false,
  sel: null,
  q: "",
  ref: "",
  pane: false,
  ids: [],
  order: { sel: null, ids: [] },
  web: null
};
var NARROW = matchMedia("(max-width: 760px)");
function $(sel) {
  return document.querySelector(sel);
}
function kept(fact) {
  return "unii." + fact;
}
async function boot() {
  document.head.insertAdjacentHTML("beforeend", `<style>${theme_css()}</style>`);
  if (APP === null) {
    navigator.serviceWorker?.register("/sw.js").catch(() => {});
    navigator.serviceWorker?.addEventListener("message", (ev) => ev.data?.$ === "mesa" && desk_mode("desk"));
  }
  if (new URLSearchParams(location.search).has("mesa")) {
    sessionStorage.setItem(kept("mode"), "desk");
  }
  history.replaceState(null, "", PAGES.includes(location.pathname) ? "/settings" : location.pathname === PIPE ? PIPE : "/");
  if (await boot_me() === null) {
    solo("Sign in", "This UniiChat server is private. On the computer it runs on, run <code>unii serve link</code> and open the link it prints here.");
    return;
  }
  chat();
  signed();
  route();
  connect();
}
async function boot_me() {
  for (let k = 0;; k++) {
    const res = await fetch("/api/me").catch(() => null);
    if (res?.status === 200 || res?.status === 401) {
      if (k > 0) {
        $("#toast").hidden = true;
      }
      return res.ok ? res.json() : null;
    }
    if (k === 0) {
      toast("Can't reach UniiChat. Reconnecting…", true);
    }
    await new Promise((ok) => setTimeout(ok, RETRY));
  }
}
var PAGES = ["/settings", "/account"];
var PIPE = "/pipeline";
function solo(title, sub) {
  document.body.className = "solo";
  document.body.innerHTML = `<main><h1>${title}</h1><p class="sub">${sub}</p></main>`;
}
function chat() {
  const file = $("input[type=file]");
  BOX.oninput = () => {
    sessionStorage.setItem(kept("draft"), BOX.value);
    if (BOX.offsetParent !== null) {
      const foot = $("footer");
      foot.style.minHeight = foot.offsetHeight + "px";
      BOX.style.height = "auto";
      BOX.style.height = Math.min(BOX.scrollHeight, innerHeight * 0.4) + "px";
      foot.style.minHeight = "";
    }
    draw(true);
  };
  BOX.onkeydown = (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229 && DESK2.matches) {
      ev.preventDefault();
      submit();
    }
  };
  BOX.onpaste = (ev) => attach([...ev.clipboardData?.files ?? []]);
  $("form").onsubmit = (ev) => {
    ev.preventDefault();
    submit();
  };
  $(".attach").onclick = () => file.click();
  $("#pick").onkeydown = roam;
  $("#pick").addEventListener("focusout", left);
  $("#menu .out").onclick = signout;
  $(".mic").onclick = mic;
  file.onchange = () => {
    attach([...file.files ?? []]);
    file.value = "";
  };
  onpopstate = route;
  importer();
  document.ondragover = (ev) => ev.preventDefault();
  document.ondrop = (ev) => {
    ev.preventDefault();
    attach([...ev.dataTransfer?.files ?? []]);
  };
  document.onclick = click;
  for (const root of [$("#desk")]) {
    root.addEventListener("change", task_draft);
    root.addEventListener("keydown", (ev) => {
      const el = ev.target;
      if (el.matches("textarea.say") && ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        task_say(el.closest("[data-task]").dataset.task, root);
      }
    });
  }
  desk_wire();
  visualViewport.onresize = () => {
    if (document.activeElement === BOX && BOX.selectionStart === BOX.value.length) {
      BOX.scrollTop = BOX.scrollHeight;
    }
    draw(true);
  };
  document.onscroll = () => {
    if (at_end()) {
      P.end = true;
    } else if (scrollY < P.y) {
      P.end = false;
    }
    P.y = scrollY;
    mine_show();
  };
  $(".mine").onclick = mine;
  $(".down").onclick = down;
  const keep = new ResizeObserver(() => {
    if (P.end && $("#account").hidden && !at_end()) {
      scrollTo(0, document.documentElement.scrollHeight);
    }
  });
  keep.observe($("#log"));
  keep.observe($("footer"));
  draw(true);
}
function signed() {
  document.body.className = "";
  BOX.placeholder = HINT;
  BOX.value = sessionStorage.getItem(kept("draft")) ?? "";
  BOX.dispatchEvent(new Event("input"));
}
function submit() {
  const text = BOX.value.trim();
  act({ $: "Send", text, images: P.imgs });
  pics([]);
  BOX.value = "";
  BOX.dispatchEvent(new Event("input"));
}
function back(sent, out) {
  if (out.error === undefined) {
    return;
  }
  if (BOX.value.trim() === "" && P.imgs.length === 0) {
    BOX.value = sent.text;
    BOX.dispatchEvent(new Event("input"));
    pics(sent.images ?? []);
  }
  toast(out.error);
}
function attach(files) {
  if (files.length > 0) {
    pics([...P.imgs, ...files]);
  }
}
function pics(imgs) {
  const els = imgs.map((img) => {
    const el = new Image;
    el.src = URL.createObjectURL(img);
    el.title = "Remove";
    el.onclick = () => pics(imgs.filter((x) => x !== img));
    return el;
  });
  P.imgs = imgs;
  $("#pics").replaceChildren(...els);
  draw(true);
}
function act(a) {
  const said = a.$ === "Send" ? a.text.trim() : "";
  P.end = P.end || a.$ === "Send";
  P.rows = true;
  for (const msg of view_act(v, a)) {
    link_send(v, msg, a.$ === "Send" ? (out) => back(a, out) : undefined, said);
  }
  draw(a.$ === "Send");
}
function click(ev) {
  const el = ev.target.closest("[data-act], [data-copy], [data-go], [data-knob], [data-desk], [data-desk-back], .choices > button");
  const sel = getSelection();
  if (el === null || sel !== null && !sel.isCollapsed && el.contains(sel.focusNode)) {
    return;
  }
  if (el.dataset.knob !== undefined) {
    place(el);
    return;
  }
  if (el.dataset.desk !== undefined) {
    if (location.pathname === PIPE) {
      history.pushState(null, "", "/");
    }
    desk_open(el.dataset.desk, true);
    return;
  }
  if (el.dataset.deskBack !== undefined) {
    desk_back();
    return;
  }
  el.closest(".choices")?.hidePopover();
  const { act: a, copy: text, go: path } = el.dataset;
  const menu = el.closest("#menu") !== null;
  if (menu) {
    $("#menu").hidePopover();
  }
  if (path !== undefined || a !== undefined && menu) {
    ev.preventDefault();
    go(path ?? "/");
  }
  if (a !== undefined) {
    const made = JSON.parse(a);
    if (made.$ === "TaskSay" && made.text !== "") {
      act(made);
    } else if (made.$ === "TaskSay") {
      task_say(made.task, $("#desk"));
    } else if (made.$ === "TaskAccept") {
      task_accept2(el, made.task);
    } else if (made.$ === "Task" && made.state === "done" && task_missing(el)) {
      return;
    } else {
      act(task_act(el, made));
    }
  }
  if (text !== undefined) {
    navigator.clipboard.writeText(text).then(() => copied(el), () => toast("Could not copy."));
  }
}
function place(knob) {
  const menu = $("#pick-" + knob.dataset.knob);
  const box = knob.getBoundingClientRect();
  const { clientWidth: w, clientHeight: h } = document.documentElement;
  const right = Math.max(8, w - box.right);
  menu.style.right = right + "px";
  menu.style.bottom = h - box.top + 4 + "px";
  menu.style.maxWidth = w - right - 8 + "px";
  menu.style.maxHeight = box.top - 12 + "px";
}
function roam(ev) {
  const menu = ev.target.closest(".choices");
  if (menu !== null && ev.key === "Tab" && ev.shiftKey && ev.target === menu.querySelector("button")) {
    ev.preventDefault();
    menu.hidePopover();
    menu.previousElementSibling.focus();
    return;
  }
  if (menu === null || !["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) {
    return;
  }
  ev.preventDefault();
  const rows = [...menu.querySelectorAll("button")];
  const n = rows.length;
  const at = rows.indexOf(document.activeElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1 + n, Home: 0, End: n - 1 };
  rows[to[ev.key] % n].focus();
}
function left(ev) {
  const menu = ev.target.closest(".choices:popover-open");
  const to = ev.relatedTarget;
  if (menu !== null && to !== null && !menu.contains(to) && to !== menu.previousElementSibling) {
    menu.hidePopover();
  }
}
function task_act(el, a) {
  const item = el.closest("[data-task]");
  if (a.$ !== "Task" || a.state === "open" || item === null) {
    return a;
  }
  const note = item.querySelector("input.note")?.value ?? "";
  const fields = a.state === "done" ? task_fields(item) : {};
  return { ...a, note, ...Object.keys(fields).length === 0 ? {} : { fields } };
}
function task_accept2(el, id) {
  const item = el.closest("[data-task]");
  const t = v.tasks.find((x) => x.id === id);
  if (item === null || t === undefined) {
    return;
  }
  const fill = task_accept_fill(t, task_fields(item));
  for (const set of item.querySelectorAll("fieldset.field")) {
    const want = fill[set.dataset.field];
    if (want === undefined) {
      continue;
    }
    if (set.dataset.kind === "text") {
      const box = set.querySelector("textarea");
      if (box !== null && box.value.trim() === "") {
        box.value = String(want);
      }
      continue;
    }
    const picks = Array.isArray(want) ? want.map(String) : [String(want)];
    for (const input of set.querySelectorAll("input")) {
      input.checked = picks.includes(input.value);
    }
  }
  if (task_accept_mode(t) === "fill") {
    act({ $: "TaskDraft", task: id, fields: task_fields(item) });
    toast(task_fill_said(t));
    return;
  }
  if (task_missing(el)) {
    return;
  }
  const note = item.querySelector("input.note")?.value ?? "";
  act({ $: "TaskAccept", task: id, ...note.trim() === "" ? {} : { note }, fields: task_fields(item) });
}
function field_value(set) {
  if (set.dataset.kind === "text") {
    return set.querySelector("textarea")?.value ?? "";
  }
  const on = [...set.querySelectorAll("input:checked")].map((i) => i.value);
  return set.dataset.kind === "multi" ? on : on[0] ?? "";
}
function task_fields(item) {
  const out = {};
  for (const set of item.querySelectorAll("fieldset.field")) {
    out[set.dataset.field] = field_value(set);
  }
  return out;
}
function field_invalid(set, on) {
  for (const el of [set, ...set.querySelectorAll("input, textarea, select")]) {
    if (on) {
      el.setAttribute("aria-invalid", "true");
    } else {
      el.removeAttribute("aria-invalid");
    }
  }
}
function task_missing(el) {
  const item = el.closest("[data-task]");
  const sets = item === null ? [] : [...item.querySelectorAll("fieldset.field[data-required]")];
  const empty = (set) => {
    const v = field_value(set);
    return Array.isArray(v) ? v.length === 0 : String(v).trim() === "";
  };
  const missing = sets.filter(empty);
  sets.forEach((set) => field_invalid(set, missing.includes(set)));
  if (missing.length === 0) {
    return false;
  }
  missing[0].scrollIntoView({ block: "center", behavior: "smooth" });
  missing[0].querySelector("input, textarea")?.focus({ preventScroll: true });
  const said = missing.map((set) => "“" + (set.querySelector("legend")?.firstChild?.textContent ?? "").trim() + "”").join(", ");
  toast("Para concluir, responda " + said + ". Nada foi enviado.");
  return true;
}
function task_draft(ev) {
  const set = ev.target.closest("fieldset.field");
  const item = set?.closest("[data-task]");
  if (set === null || set === undefined || item === null || item === undefined) {
    return;
  }
  field_invalid(set, false);
  act({ $: "TaskDraft", task: item.dataset.task, fields: { [set.dataset.field]: field_value(set) } });
}
function task_say(task, root) {
  const box = () => root.querySelector(`[data-task="${CSS.escape(task)}"] textarea.say`);
  const text = box()?.value ?? "";
  for (const msg of view_act(v, { $: "TaskSay", task, text })) {
    const was = box();
    if (was !== null) {
      was.value = "";
    }
    link_send(v, msg, (out) => {
      if (out.error === undefined) {
        return;
      }
      toast(out.error);
      const now = box();
      if (now !== null && now.value.trim() === "") {
        now.value = text;
      }
    });
  }
  draw(false);
}
function keep_take(root) {
  const kept = new Map;
  for (const el of root.querySelectorAll("[data-task] :is(input, textarea)[data-keep]")) {
    const key = el.closest("[data-task]").dataset.task + "/" + el.dataset.keep;
    const box = el instanceof HTMLInputElement && el.type === "checkbox";
    const focus = document.activeElement === el;
    const value = !box && el.value !== el.defaultValue ? el.value : null;
    const checked = box && el.checked !== el.defaultChecked ? el.checked : null;
    if (value !== null || checked !== null || focus) {
      kept.set(key, { el, value, checked, focus, start: box ? null : el.selectionStart, end: box ? null : el.selectionEnd });
    }
  }
  return kept;
}
function keep_put(root, kept) {
  for (const [key, k] of kept) {
    const [task, name] = key.split("/");
    const el = root.querySelector(`[data-task="${CSS.escape(task)}"] [data-keep="${CSS.escape(name)}"]`);
    if (el === null || el === k.el) {
      continue;
    }
    if (k.value !== null) {
      el.value = k.value;
    }
    if (k.checked !== null) {
      el.checked = k.checked;
    }
    if (k.focus) {
      el.focus();
      if (k.start !== null && k.end !== null) {
        el.setSelectionRange(k.start, k.end);
      }
    }
  }
}
var TURN2 = -1;
var TITLE = document.title;
function turn_show(n) {
  if (n === TURN2) {
    return;
  }
  TURN2 = n;
  document.title = turn_title(TITLE, n);
  $(".mode").classList.toggle("turn", n > 0);
  const nav = navigator;
  (n === 0 ? nav.clearAppBadge?.() : nav.setAppBadge?.(n))?.catch(() => {});
}
function desk_wire() {
  const q = $("#desk .q");
  const ref = $("#desk .ref");
  q.oninput = () => {
    P.q = q.value;
    draw(false);
  };
  ref.onchange = () => {
    P.ref = ref.value;
    draw(false);
  };
  $(".mode").onclick = () => desk_mode(P.mode === "desk" ? "chat" : "desk");
  document.addEventListener("keydown", desk_keys);
  setInterval(() => P.mode === "desk" && document.visibilityState === "visible" && draw(false), 60000);
  NARROW.addEventListener("change", () => route());
}
function desk_mode(mode, push = true) {
  sessionStorage.setItem(kept("mode"), mode);
  const st = { mode, sel: P.sel, pane: false };
  if (push) {
    history.pushState(st, "", "/");
  } else {
    history.replaceState(st, "", "/");
  }
  route();
}
function desk_open(id, pane) {
  P.sel = id;
  if (P.mode !== "desk") {
    P.mode = "desk";
  }
  const st = { mode: "desk", sel: id, pane: pane && NARROW.matches };
  if (st.pane && !(history.state?.pane === true)) {
    history.pushState(st, "", "/");
  } else {
    history.replaceState(st, "", "/");
  }
  route();
  if (!NARROW.matches && pane) {
    requestAnimationFrame(() => document.querySelector(`#desk .row[data-desk="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
  }
}
function desk_back() {
  if (history.state?.pane === true) {
    history.back();
    return;
  }
  P.pane = false;
  route();
}
function desk_choose() {
  if (P.chose) {
    return;
  }
  P.chose = true;
  const was = sessionStorage.getItem(kept("mode"));
  const mode = was === "desk" || was === "chat" ? was : desk_turn(v.tasks) ? "desk" : "chat";
  if (mode !== P.mode && PAGES.includes(location.pathname) === false && location.pathname !== PIPE) {
    desk_mode(mode, false);
  }
}
function desk_build() {
  const web = v.web ?? "";
  if (web === "") {
    return;
  }
  if (P.web === null) {
    P.web = web;
  } else if (P.web !== web) {
    P.web = web;
    toast("O UniiChat foi atualizado. Recarregando…", true);
    setTimeout(() => location.reload(), 300);
  }
}
var DESKED = null;
function desk_draw() {
  const refs = desk_refs(v.tasks);
  if (P.ref !== "" && !refs.includes(P.ref)) {
    P.ref = "";
  }
  if (P.chose && P.sel !== null && !v.tasks.some((t) => t.id === P.sel)) {
    P.sel = null;
    P.pane = false;
    document.body.classList.remove("pane");
  }
  const turn = turn_of(v);
  const said = JSON.stringify(turn) + Math.floor(Date.now() / 60000);
  if (DESKED === null || DESKED.of !== v.tasks || DESKED.q !== P.q || DESKED.ref !== P.ref || DESKED.sel !== P.sel || DESKED.said !== said) {
    const groups = desk_list(v.tasks, P.q, P.ref);
    const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
    if (P.sel === null && !NARROW.matches && ids.length > 0) {
      P.sel = ids[0];
    }
    if (P.sel !== null && groups.some((g) => g.group === "now" && g.tasks.some((t) => t.id === P.sel))) {
      P.order = { sel: P.sel, ids };
    }
    const order = P.order.sel === P.sel ? P.order.ids : [];
    DESKED = { of: v.tasks, q: P.q, ref: P.ref, sel: P.sel, said, html: desk_html(v.tasks, P.q, P.ref, P.sel, Date.now(), { order, turn }) };
  }
  const { list, detail, ids } = DESKED.html;
  P.ids = ids;
  const select = $("#desk .ref");
  markup(select, [`<option value="">Todos os projetos</option>`, ...refs.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`)]);
  select.value = P.ref;
  select.hidden = refs.length === 0;
  markup($("#desk .rows"), list);
  const pane = $("#desk .pane");
  const was = keep_take(pane);
  markup(pane, detail);
  keep_put(pane, was);
  const live = $("#desk .live");
  const shown = v.tasks.find((t) => t.id === P.sel);
  const wait = shown !== undefined && shown.state === "open" && shown.talk === "unii" ? shown.id + ": " + task_talk_wait_said(shown, Date.now(), turn) : "";
  if (live.textContent !== wait) {
    live.textContent = wait;
  }
  const untold = view_untold(v).length;
  $("#desk .tell").hidden = untold === 0;
  $("#desk .tell span").textContent = String(untold);
}
function desk_keys(ev) {
  if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || !$("#account").hidden || document.body.classList.contains("guest")) {
    return;
  }
  const el = ev.target;
  const typing = el.matches("input, textarea, select, [contenteditable], [contenteditable] *");
  if (document.querySelector("[popover]:popover-open") !== null) {
    return;
  }
  if (typing) {
    if (ev.key === "Escape" && P.mode === "desk" && el.closest("#desk") !== null) {
      ev.preventDefault();
      el.blur();
    }
    return;
  }
  if (ev.key === "m") {
    ev.preventDefault();
    desk_mode(P.mode === "desk" ? "chat" : "desk");
    return;
  }
  if (P.mode !== "desk") {
    return;
  }
  const by = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 }[ev.key];
  if (by !== undefined && !(NARROW.matches && P.pane)) {
    ev.preventDefault();
    const to = desk_step(P.ids, P.sel, by);
    if (to !== null) {
      desk_open(to, false);
      requestAnimationFrame(() => {
        const row = document.querySelector(`#desk .row[data-desk="${CSS.escape(to)}"]`);
        row?.scrollIntoView({ block: "nearest" });
        row?.focus({ preventScroll: true });
      });
    }
    return;
  }
  if (ev.key === "a" && P.sel !== null) {
    const accept = $("#desk .pane").querySelector("button.accept");
    if (accept !== null) {
      ev.preventDefault();
      accept.click();
    }
    return;
  }
  if ((ev.key === "Enter" || ev.key === "o") && P.sel !== null && (el === document.body || el.closest("#desk .rows") !== null)) {
    ev.preventDefault();
    if (NARROW.matches) {
      desk_open(P.sel, true);
    } else {
      $("#desk .pane").querySelector("input, textarea, button:not(.back)")?.focus();
    }
    return;
  }
  if (ev.key === "/") {
    ev.preventDefault();
    if (NARROW.matches && P.pane) {
      desk_back();
    }
    $("#desk .q").focus();
    return;
  }
  if (ev.key === "Escape") {
    if (NARROW.matches && P.pane) {
      ev.preventDefault();
      desk_back();
    } else if (P.sel !== null) {
      ev.preventDefault();
      document.querySelector(`#desk .row[data-desk="${CSS.escape(P.sel)}"]`)?.focus();
    }
  }
}
function copied(button) {
  button.innerHTML = CHECK;
  setTimeout(() => button.innerHTML = SHEETS, 1200);
}
async function mic() {
  if (P.rec !== null) {
    P.rec.stop();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
  if (stream === null) {
    toast("UniiChat can't use the microphone.");
    return;
  }
  const mimeType = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
  const rec = new MediaRecorder(stream, { mimeType });
  const parts = [];
  rec.ondataavailable = (ev) => parts.push(ev.data);
  rec.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    P.rec = null;
    words(new Blob(parts, { type: rec.mimeType }));
  };
  rec.start();
  P.rec = rec;
  draw(false);
  meter(stream, rec);
}
function meter(stream, rec) {
  const audio = new AudioContext;
  const probe = audio.createAnalyser();
  audio.createMediaStreamSource(stream).connect(probe);
  const buf = new Uint8Array(probe.fftSize);
  const canvas = $(".voice canvas");
  const pen = canvas.getContext("2d");
  const levels = [];
  const start = performance.now();
  const frame = (now) => {
    if (P.rec !== rec) {
      audio.close();
      return;
    }
    probe.getByteTimeDomainData(buf);
    const power = buf.reduce((sum, b) => sum + ((b - 128) / 128) ** 2, 0) / buf.length;
    const level = Math.min(1, Math.sqrt(power) * 5);
    const slot = Math.floor((now - start) / 50);
    levels[slot] = Math.max(levels[slot] ?? 0, level);
    const secs = Math.floor((now - start) / 1000);
    $(".voice span").textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    const dpr = devicePixelRatio;
    const w = canvas.width = canvas.clientWidth * dpr;
    const h = canvas.height = canvas.clientHeight * dpr;
    pen.fillStyle = getComputedStyle(canvas).color;
    const step = 5 * dpr;
    for (let i = 0;i * step < w && slot - i >= 0; i++) {
      const bar = Math.max(2 * dpr, (levels[slot - i] ?? 0) * h);
      pen.fillRect(w - (i + 1) * step, (h - bar) / 2, 3 * dpr, bar);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function words(audio) {
  const act = { $: "voice", type: audio.type, body: () => audio };
  link_send(v, act, heard);
  draw(false);
}
function heard(out) {
  draw(false);
  const text = out.text?.trim() ?? "";
  if (text === "") {
    toast(out.error ?? "No words heard.");
    return;
  }
  const gap = /\S$/.test(BOX.value.slice(0, BOX.selectionStart)) ? " " : "";
  BOX.setRangeText(gap + text, BOX.selectionStart, BOX.selectionEnd, "end");
  BOX.dispatchEvent(new Event("input"));
  BOX.focus();
}
function connect() {
  link_open(v, {
    open: (query) => new WebSocket(location.origin.replace(/^http/, "ws") + "/ws" + query),
    post: (path, body) => fetch(path, { method: "POST", body }),
    hear,
    lost
  });
}
async function lost(up) {
  draw(true);
  const me = up ? null : await fetch("/api/me").catch(() => null);
  if (me !== null && me.status === 401) {
    location.href = "/";
    return false;
  }
  return true;
}
function hear(msg) {
  const was = view_pick(v);
  const agents = v.agents.join() + JSON.stringify(v.labels ?? {});
  for (const out of view_hear(v, msg)) {
    link_send(v, out);
  }
  if (msg.$ === "state") {
    desk_build();
    desk_choose();
  }
  const now = view_pick(v).filter((k) => was.length > 0 && !was.some((w) => w.text === k.text));
  if (now.length > 0) {
    toast("Now " + now.map((k) => k.hint).join("; ") + ".");
  }
  P.rows ||= msg.$ === "state" ? v.agents.join() + JSON.stringify(v.labels ?? {}) !== agents : msg.$ !== "delta" && msg.$ !== "live";
  import_welcome();
  draw(true);
}
function importer() {
  const form = $("#import form");
  const dir = $("#import [name=dir]");
  $(".imp").onclick = () => import_open(false);
  const zip = $("#import [name=zip]");
  $(".pickdir").onclick = () => dir.click();
  for (const src of import_srcs()) {
    src.querySelector(".pickzip").onclick = () => zip.click();
    src.querySelector(".pickzip").title = "From the website: " + EXPORTS[src.dataset.app] + ", which emails you a zip.";
  }
  $(".into").onclick = () => {
    P.step = "";
    import_draw("");
  };
  $("#import").onclick = (ev) => ev.target.closest(".skip") && $("#import").hidePopover();
  $("#import .prog .sub").textContent = MIDWAY;
  $("#import .flow").onclick = import_flow;
  $("#import").ontoggle = (ev) => {
    if (ev.newState === "closed") {
      P.step = P.step === "start" || P.step === "done" ? "" : P.step;
    }
    import_draw("");
  };
  form.oninput = (ev) => {
    const box = ev.target;
    if (box.name === "session") {
      box.checked ? P.off.delete(box.value) : P.off.add(box.value);
    }
    import_draw("");
  };
  dir.onchange = async () => {
    const all = [...dir.files ?? []];
    const files = all.filter((f) => import_file(f.webkitRelativePath));
    const found = [];
    let moved = 0;
    const reading = (k) => "Reading " + k + " of " + files.length + " files…";
    import_draw(reading(1));
    for (const [k, f] of files.entries()) {
      $("#import .guess").textContent = reading(k + 1);
      const s = await import_copy(f).then((b) => import_session(b, "log"), () => {
        return;
      });
      moved += s === undefined ? 1 : 0;
      found.push(...s ? [s] : []);
    }
    dir.value = "";
    import_took(all[0]?.webkitRelativePath.split("/")[0] ?? "", { sessions: found, moved }, found.length > 0 ? "" : NONE);
  };
  zip.onchange = async () => {
    for (const f of zip.files ?? []) {
      import_draw("Reading " + f.name + "…");
      try {
        const found = await import_export(await import_copy(f));
        import_took(f.name, { sessions: found, moved: 0 }, found.length > 0 ? "" : "No chats in " + f.name + ".");
      } catch (e) {
        import_took(f.name, { sessions: [], moved: 0 }, f.name + ": " + e.message);
      }
    }
    zip.value = "";
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    import_send();
  };
}
function import_flow() {
  link_send(v, { $: "go", on: Boolean(v.importing?.why) }, (out) => out.error && toast(out.error));
}
async function import_open(first) {
  $("#menu").hidePopover();
  P.done = await fetch("/api/imported").then((res) => res.json()).catch(() => ({}));
  $("#import form .skip").textContent = first ? "Start fresh" : "Close";
  P.step = first ? "start" : P.step === "done" ? "" : P.step;
  import_draw("");
  $("#import").showPopover();
}
function import_took(name, read, status) {
  P.found.set(name, read);
  BACK.min = "0";
  BACK.value = "0";
  import_draw(status);
}
async function import_welcome() {
  await INTRO;
  const key = kept("welcomed");
  if (localStorage.getItem(key) === null && v.pick !== null && v.parts.length === OPENING && v.importing === null && DESK2.matches) {
    localStorage.setItem(key, "1");
    import_open(true);
  }
}
function import_send() {
  const picked = import_plan2().picked;
  P.step = "send";
  import_draw("");
  const body = async () => new Blob(await Array.fromAsync(import_body(picked), (part) => new Blob([part])));
  link_send(v, { $: "import", body }, import_sent);
}
function import_sent(out) {
  P.step = out.error !== undefined ? "" : out.going ? "run" : "done";
  if (out.error === undefined) {
    P.found.clear();
  }
  import_draw(out.error === undefined ? "" : "Not imported: " + out.error);
  $("#import").showPopover();
}
function import_plan2() {
  const form = new FormData($("#import form"));
  const want = { off: [...P.off], since: import_since(), tools: form.has("tools") };
  const found = [...P.found.values()].flatMap((read) => read.sessions);
  return import_plan(found, want, P.done);
}
function import_since() {
  return BACK.valueAsNumber > Number(BACK.min) ? new Date(BACK.valueAsNumber * 86400000).toISOString().slice(0, 10) : "";
}
function import_bar() {
  const run = v.importing;
  P.step = run !== null ? "seen" : P.step === "seen" ? "done" : P.step;
  const done = P.step === "done";
  const going = ["send", "run", "seen", "done"].includes(P.step);
  const part = run === null ? Number(done) : run.done / Math.max(1, run.total);
  const why = Boolean(run?.why);
  const said = run !== null ? progress_show(run) : done ? DONE : P.step === "send" ? "Sending…" : "Starting…";
  $("#import .start").hidden = P.step !== "start";
  $("#import form").hidden = going || P.step === "start";
  $("#import .prog").hidden = !going;
  $("#import .prog .title").textContent = done ? "Memory tree built" : "Building your memory tree";
  $("#import progress").value = part;
  $(".imping progress").value = part;
  $(".imping").hidden = run === null;
  $(".imping").classList.toggle("why", why);
  $(".imping span").textContent = why ? "Import paused" : "Building memory";
  $(".imping").title = $("#import .pct").textContent = said;
  $("#import .prog .sub").hidden = why || done;
  $("#import .flow").textContent = why ? "Resume" : "Pause";
  $("#import .flow").hidden = run === null;
  return going;
}
function import_draw(status) {
  if (import_bar()) {
    return;
  }
  const reads = [...P.found.values()];
  const sessions = reads.flatMap((read) => read.sessions);
  const plan = import_plan2();
  const msgs = plan.msgs;
  const left = reads.reduce((n, read) => n + read.moved, 0);
  const moved = left === 0 ? "" : " (" + left + (left === 1 ? " file" : " files") + " changed while read: choose the folder again to add them)";
  const found = sessions.length === 0 ? "" : plan.first === "" ? OLD : import_count(msgs, "new ");
  const day = (at) => new Date(at).getUTCDate() + " " + new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  BACK.min = String(Math.floor(Date.parse(plan.first || new Date().toISOString()) / 86400000));
  BACK.max = String(Math.floor(Date.now() / 86400000));
  $("#import .since .from").textContent = day(import_since() || plan.first || Date.now());
  $("#import .since .to").textContent = day(Date.now());
  BACK.style.setProperty("--at", 100 * (BACK.valueAsNumber - Number(BACK.min)) / Math.max(1, Number(BACK.max) - Number(BACK.min)) + "%");
  $("#import .want").hidden = plan.first === "";
  $("#import .tools").hidden = !sessions.some((s) => s.heads.some((m) => m.kind === "tool" || m.kind === "echo"));
  $("#import .found").textContent = found + moved;
  for (const src of import_srcs()) {
    const list = src.querySelector(".sessions");
    const shown = plan.sessions.filter((s) => s.app === src.dataset.app);
    markup(list, shown.map((s) => `<label title="${esc(s.where + ", " + import_count(s.heads.length, ""))}"><input type="checkbox" name="session" value="${esc(import_id(s))}">${import_cells(s).map((c) => `<span>${esc(c)}</span>`).join("")}</label>`));
    list.querySelectorAll("input").forEach((box) => box.checked = !P.off.has(box.value));
    const on = shown.filter((s) => !P.off.has(import_id(s))).length;
    src.querySelector(".pick").hidden = shown.length === 0;
    src.querySelector(".pick summary").textContent = (on < shown.length ? on + " of " : shown.length > 1 ? "All " : "") + shown.length + (shown.length === 1 ? " session" : " sessions") + " picked · choose";
  }
  $("#import .guess").textContent = status;
  const [go, dir] = [$("#import .go"), $(".pickdir")];
  go.hidden = msgs === 0;
  go.disabled = status.startsWith("Reading");
  dir.textContent = msgs > 0 ? "Add a folder" : "Choose folder";
  dir.classList.toggle("alt", msgs > 0);
  dir.disabled = go.disabled;
  import_srcs().forEach((src) => src.querySelector(".pickzip").disabled = dir.disabled);
}
function import_srcs() {
  return [...document.querySelectorAll("#import .src")];
}
async function import_copy(file) {
  const reader = file.stream().getReader();
  const parts = [];
  for (let got = await reader.read();!got.done; got = await reader.read()) {
    parts.push(new Blob([got.value]));
  }
  return new Blob(parts);
}
var MARKUP = new WeakMap;
function markup(el, htmls) {
  const had = new Map;
  for (const child of el.children) {
    const html = MARKUP.get(child);
    const same = had.get(html) ?? [];
    same.push(child);
    had.set(html, same);
  }
  const kids = htmls.map((html) => had.get(html)?.shift() ?? html_parse(html));
  for (const left of had.values()) {
    left.forEach((child) => child.remove());
  }
  let at = el.firstElementChild;
  for (const kid of kids) {
    if (kid === at) {
      at = at.nextElementSibling;
    } else {
      el.insertBefore(kid, at);
    }
  }
}
function html_parse(html) {
  const made = document.createElement("template");
  made.innerHTML = html;
  const child = made.content.firstElementChild;
  MARKUP.set(child, html);
  return child;
}
function draw(stick) {
  P.stick = P.stick && stick;
  if (P.frame === 0) {
    P.frame = requestAnimationFrame(() => {
      paint();
      mine_show();
    });
  }
}
function paint() {
  if (!$("#account").hidden) {
    P.frame = 0;
    bars();
    return;
  }
  if (P.mode === "desk") {
    P.frame = 0;
    bars();
    desk_draw();
    return;
  }
  const doc = document.documentElement;
  const follow = P.stick && P.end;
  const at = P.rows && !follow ? anchor() : null;
  const shown = (v.page === null ? "" : v.page.name) + (v.fold === null ? "" : "/fold");
  P.frame = 0;
  P.stick = true;
  bars();
  if (P.rows) {
    markup($("#log .rows"), view_body(v).map(row_html));
    P.rows = false;
  }
  markup($("#log .tail"), view_tail(v).map(row_html));
  if (shown !== P.shown) {
    P.shown = shown;
    P.end = v.fold === null;
    scrollTo(0, v.fold === null ? doc.scrollHeight : 0);
    return;
  }
  if (follow) {
    scrollTo(0, doc.scrollHeight);
    return;
  }
  if (at === null) {
    return;
  }
  const rows = [...document.querySelectorAll("#log [data-a]")];
  const el = rows.filter((r) => Number(r.dataset.a) <= at.a).pop();
  if (el !== undefined) {
    scrollBy(0, el.getBoundingClientRect().top - at.top);
    P.end = at_end();
  }
}
function at_end() {
  return innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}
function bars() {
  for (const note of v.notes.splice(0)) {
    toast(note);
  }
  const on = view_typing(v);
  const stop = on && v.busy && BOX.value.trim() === "" && P.imgs.length === 0;
  const tabs = view_tabs(v);
  const send = $(".send");
  $(".net").hidden = v.up;
  $(".timers").hidden = v.timers.length === 0;
  $(".timers span").textContent = String(v.timers.length);
  markup($("#timers ul"), timers_html(v.timers));
  if (v.timers.length === 0 && $("#timers").matches(":popover-open")) {
    $("#timers").hidePopover();
  }
  const turn = desk_list(v.tasks).find((g) => g.group === "now")?.tasks.length ?? 0;
  turn_show(turn);
  $(".mode").hidden = false;
  $(".mode").textContent = P.mode === "desk" ? "Conversa" : turn === 0 ? "Mesa" : "Mesa · " + turn;
  $(".mode").setAttribute("aria-label", P.mode === "desk" ? "Voltar à Conversa" : turn === 0 ? "Mesa: nenhuma pendência na sua vez" : "Mesa: " + turn + (turn === 1 ? " pendência" : " pendências") + " na sua vez");
  send.classList.toggle("stop", stop);
  send.disabled = !on;
  BOX.disabled = !on;
  $(".attach").disabled = !on;
  $(".mic").disabled = !on || v.out.some((p) => p.msg.$ === "voice");
  $(".mic").classList.toggle("rec", P.rec !== null);
  $(".composer").classList.toggle("off", !on);
  $(".composer").classList.toggle("rec", P.rec !== null);
  const knob = document.activeElement?.dataset?.knob;
  markup($("#pick"), pick_html(view_fold(v), v.fold === null, view_pick(v)));
  if (knob !== undefined) {
    $("#pick [data-knob=" + knob + "]").focus();
  }
  markup($("#menu .mcp"), mcp_html(v.mcp));
  $("#tabs").hidden = tabs.length < 2;
  markup($("#tabs"), tabs_html(tabs));
  import_bar();
}
function anchor() {
  for (const r of document.querySelectorAll("#log [data-a]")) {
    const box = r.getBoundingClientRect();
    if (box.bottom > 60 && r.querySelector("[data-a]") === null) {
      return box.top < innerHeight ? { a: Number(r.dataset.a), top: box.top } : null;
    }
  }
  return null;
}
function mine() {
  const rows = [...document.querySelectorAll("#log .msg.user")];
  const el = rows.findLast(mine_above);
  if (el !== undefined) {
    P.end = false;
    el.scrollIntoView();
  }
  mine_show();
}
function mine_show() {
  const first = document.querySelector("#log .msg.user");
  $(".mine").hidden = first === null || !mine_above(first);
  $(".down").hidden = P.end || innerHeight + scrollY >= document.documentElement.scrollHeight - 1;
}
function down() {
  scrollTo(0, document.documentElement.scrollHeight);
  P.end = true;
  mine_show();
}
function mine_above(el) {
  return el.getBoundingClientRect().top < $("header").getBoundingClientRect().bottom;
}
function go(path) {
  if (location.pathname !== path) {
    history.pushState(null, "", path);
  }
  route();
}
function route() {
  const pipe = location.pathname === PIPE;
  const page = PAGES.includes(location.pathname) || pipe;
  const st = history.state ?? {};
  if (st.mode === "desk" || st.mode === "chat") {
    P.mode = st.mode;
  }
  if (typeof st.sel === "string") {
    P.sel = st.sel;
  }
  P.pane = st.pane === true && NARROW.matches;
  const desk = !page && P.mode === "desk";
  $("#log").hidden = page || desk;
  $("#desk").hidden = !desk;
  document.body.classList.toggle("account", page);
  document.body.classList.toggle("desk", desk);
  document.body.classList.toggle("pane", desk && P.pane);
  $("#account").hidden = !page;
  P.rows = true;
  P.shown = location.pathname + (desk ? "/mesa" : "");
  $("#account").classList.toggle("pipe", pipe);
  if (pipe) {
    pipeline();
  } else if (page) {
    account();
  }
  draw(false);
}
var PIPE_AGAIN = 4000;
var PIPE_TRIES = 5;
var PIPED = 0;
async function pipeline(tries = 0) {
  const el = $("#account");
  const run = ++PIPED;
  if (tries === 0 && el.querySelector(".pipe-totals") === null) {
    el.innerHTML = `<a class="back" href="/" data-go="/">← Voltar</a><h1>Pipeline</h1><p class="pipe-read">Lendo…</p>`;
  }
  const got = await fetch("/api/pipeline").catch(() => null);
  const panel = got !== null && got.ok ? await got.json().catch(() => null) : null;
  if (run !== PIPED || location.pathname !== PIPE) {
    return;
  }
  const shown = el.querySelectorAll("details.pipe-front");
  const opened = shown.length === 0 ? null : new Set([...shown].filter((d) => d.open).map((d) => d.dataset.ref ?? ""));
  const y = scrollY;
  el.innerHTML = pipeline_html(panel, Date.now(), got === null ? "Sem conexão com o UniiChat." : "Não foi possível ler o painel (" + (got.status || "erro") + ").", opened);
  scrollTo(0, y);
  el.querySelectorAll(".pipe-reload").forEach((b) => b.onclick = () => pipeline());
  if (panel?.refreshing === true && tries < PIPE_TRIES) {
    setTimeout(() => run === PIPED && location.pathname === PIPE && pipeline(tries + 1), PIPE_AGAIN);
  }
}
async function account() {
  const el = $("#account");
  const [got, set] = await Promise.all([fetch("/api/prompts").catch(() => null), fetch("/api/settings").catch(() => null)]);
  const prompts = got !== null && got.ok ? await got.json().catch(() => null) : null;
  const push = await notify_state().catch(() => null);
  el.innerHTML = account_html(prompts, push);
  el.querySelectorAll("form.prompt").forEach((form) => form.onsubmit = (ev) => {
    ev.preventDefault();
    account_prompt(form);
  });
  el.querySelectorAll(".retry").forEach((retry) => retry.onclick = () => account());
  $("#account .out").onclick = signout;
  const bell = document.querySelector("#account .notify");
  bell?.addEventListener("click", () => {
    bell.disabled = true;
    notify(push !== "on");
  });
  const page = set?.ok ? await set.json().catch(() => null) : null;
  if (page === null) {
    $("#account .owned").innerHTML = `<p class="sub">Could not read the server's settings. Try again in a moment.</p>`;
    return;
  }
  settings_draw(page);
}
async function signout() {
  await notify_sub().then((sub) => sub?.unsubscribe()).catch(() => {});
  await post("/api/logout", {});
  location.href = "/";
}
async function account_prompt(form) {
  const area = form.querySelector("textarea");
  const why = form.querySelector(".why");
  const save = form.querySelector("button");
  const sent = area.value;
  save.disabled = true;
  const out = await post("/api/prompts", { [area.name]: sent });
  save.disabled = false;
  if (out.error === undefined && area.value === sent) {
    area.value = out[area.name]?.text ?? sent;
  }
  why.textContent = out.error ?? (area.value === out[area.name]?.text ? "Saved." : "Not saved yet: Save again.");
  form.classList.toggle("bad", out.error !== undefined);
}
async function notify_state() {
  P.push = null;
  if (APP !== null) {
    return null;
  }
  if (navigator.serviceWorker === undefined || !("PushManager" in window) || !("Notification" in window)) {
    return /iPhone|iPad/.test(navigator.userAgent) ? "home" : null;
  }
  if (Notification.permission === "denied") {
    return "blocked";
  }
  const wait = new Promise((ok) => setTimeout(ok, 3000, undefined));
  const reg = await navigator.serviceWorker.getRegistration() ?? await Promise.race([navigator.serviceWorker.ready, wait]);
  const sub = await notify_sub();
  const query = sub === null ? "" : "?endpoint=" + encodeURIComponent(sub.endpoint);
  const res = await fetch("/api/webpush" + query).catch(() => null);
  const out = res?.ok ? await res.json() : null;
  if (reg === undefined || out === null || out.key === null) {
    return null;
  }
  P.push = { reg, key: out.key };
  return out.on && notify_keyed(sub, out.key) ? "on" : "off";
}
function notify_keyed(sub, key) {
  const had = sub?.options.applicationServerKey;
  return had != null && notify_bytes(key).join() === new Uint8Array(had).join();
}
function notify_bytes(key) {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
async function notify_sub() {
  const reg = await navigator.serviceWorker?.getRegistration();
  return await reg?.pushManager.getSubscription() ?? null;
}
async function notify(on) {
  const push = P.push;
  if (push === null) {
    return;
  }
  try {
    const out = on ? await notify_on(push.reg, push.key) : await notify_off(push.reg);
    toast(out.error ?? (on ? "Notificações ativadas." : "Notificações desativadas."));
  } catch (err) {
    const denied = typeof Notification !== "undefined" && Notification.permission === "denied";
    toast(denied ? "As notificações estão bloqueadas nas configurações deste navegador." : (on ? "Não foi possível ativar as notificações: " : "Não foi possível desativar as notificações: ") + (err?.message ?? err));
  }
  account();
}
async function notify_on(reg, key) {
  const bytes = notify_bytes(key);
  const ask = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  const sub = await ask().catch(async (err) => {
    const old = await reg.pushManager.getSubscription();
    if (old === null || err?.name !== "InvalidStateError") {
      throw err;
    }
    await old.unsubscribe();
    return ask();
  });
  return post("/api/webpush", sub.toJSON());
}
async function notify_off(reg) {
  const sub = await reg.pushManager.getSubscription();
  if (sub !== null) {
    const headers = { "content-type": "application/json" };
    await fetch("/api/webpush", { method: "DELETE", headers, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  }
  return {};
}
function settings_draw(page) {
  $("#account .owned").innerHTML = settings_html(page);
  const form = $("#account form.settings");
  const rows = new Map(page.settings.map((r) => [r.key, r]));
  const unset = new Set;
  const profs = Object.entries(page.profiles ?? {});
  const box = form.querySelector(".profiles .field");
  const names = () => profs.map(([name]) => name.trim()).filter((name) => name !== "");
  const listed = (key) => {
    const boxes = [...form.querySelectorAll(`input[name="${key}"]`)];
    return boxes.length === 0 ? list(rows.get(key).value) : boxes.filter((b) => b.checked).map((b) => b.value);
  };
  const picks = () => {
    const vendors = listed("vendors");
    form.querySelectorAll(".opt[data-vendor]:not([data-vendor=''])").forEach((o) => o.hidden = !o.dataset.vendor.split(" ").some((v) => vendors.includes(v)));
    for (const key of PICKS) {
      const value = form.querySelector(`input[name="${key}"]`);
      const four = value?.parentElement.querySelector(".four");
      if (value && four) {
        const focus = document.activeElement?.name;
        four.innerHTML = picks_html(key, vendors, listed("models"), value.value, key === "agents" ? "The chat's pick" : null, names());
        four.querySelector(`select[name="${focus}"]`)?.focus();
      }
    }
    const keyless = vendors.filter((v) => {
      const name = VENDOR_KEY[v];
      const key = page.keys.find((k) => k.name === name);
      const typed = form.querySelector(`[name="key.${name}"]`)?.value.trim() ?? "";
      return key !== undefined && (key.from === "default" || unset.has("key." + name)) && typed === "";
    });
    const warn = form.querySelector(".warn");
    if (warn !== null) {
      warn.textContent = keyless.length === 0 ? "" : keyless.join(" and ") + (keyless.length === 1 ? " has" : " have") + " no key set: its calls will fail till one is.";
    }
  };
  form.oninput = (ev) => {
    const el = ev.target.closest(".set");
    if (el === null) {
      return;
    }
    unset.delete(el.dataset.key);
    el.classList.remove("unset");
    el.querySelector(".err").textContent = "";
    const value = el.querySelector("input[type=hidden]");
    if (value !== null) {
      value.value = pick_mend([...el.querySelectorAll("select")].map((s) => s.value), listed("models"), names());
    }
    picks();
    if (el.dataset.key === "vendors" || el.dataset.key === "models") {
      profs_draw();
    }
  };
  form.onclick = (ev) => {
    const btn = ev.target.closest(".reset");
    if (btn === null) {
      return;
    }
    const el = btn.closest(".set");
    const key = el.dataset.key;
    const r = rows.get(key);
    el.querySelectorAll("input[type=checkbox]").forEach((b) => b.checked = list(r.def).includes(b.value));
    el.querySelectorAll("input:not([type=checkbox]), textarea").forEach((i) => i.value = r?.def ?? "");
    picks();
    unset.add(key);
    el.classList.add("unset");
    btn.hidden = true;
    el.querySelector(".from").insertAdjacentText("beforeend", key.startsWith("key.") ? " · removed once saved" : " · the default once saved");
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    settings_save(form, page, unset, listed, profs);
  };
  const profs_draw = (focus) => {
    if (box !== null) {
      box.innerHTML = profiles_html(profs, offered(listed("vendors"), listed("models")));
      (focus === undefined ? null : box.querySelector(focus) ?? box.querySelector(".pnew"))?.focus();
    }
  };
  const profs_changed = (focus) => {
    profs_draw(focus);
    box.closest(".set").querySelector(".err").textContent = "";
    picks();
  };
  const renamed = (was, now) => {
    for (const key of PICKS) {
      const value = form.querySelector(`input[name="${key}"]`);
      if (value !== null && was.trim() !== "" && now !== "" && value.value === was.trim()) {
        value.value = now;
      }
    }
  };
  box?.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    const [i, j] = [Number(b?.dataset.i), Number(b?.dataset.j)];
    if (b?.classList.contains("pnew")) {
      profs.push(["", []]);
      profs_changed(`.pname[data-i="${profs.length - 1}"]`);
    } else if (b?.classList.contains("pdel")) {
      profs.splice(i, 1);
      profs_changed(".pnew");
    } else if (b?.classList.contains("out")) {
      profs[i][1].splice(j, 1);
      profs_changed(`.add[data-i="${i}"]`);
    }
  });
  box?.addEventListener("change", (ev) => {
    const add = ev.target.closest("select.add");
    if (add !== null && add.value !== "") {
      const i = Number(add.dataset.i);
      profs[i][1].push(add.value);
      profs_changed(`.add[data-i="${i}"]`);
    }
  });
  box?.addEventListener("input", (ev) => {
    const name = ev.target.closest("input.pname");
    if (name !== null) {
      const i = Number(name.dataset.i);
      renamed(profs[i][0], name.value.trim());
      profs[i][0] = name.value;
    }
  });
  box?.addEventListener("keydown", (ev) => {
    const grip = ev.target.closest(".grip");
    if (grip === null || ev.key !== "ArrowUp" && ev.key !== "ArrowDown") {
      return;
    }
    ev.preventDefault();
    const [i, j] = [Number(grip.dataset.i), Number(grip.dataset.j)];
    const k = j + (ev.key === "ArrowUp" ? -1 : 1);
    const list = profs[i][1];
    if (k >= 0 && k < list.length) {
      [list[j], list[k]] = [list[k], list[j]];
      profs_changed(`.grip[data-i="${i}"][data-j="${k}"]`);
    }
  });
  box?.addEventListener("pointerdown", (ev) => {
    const grip = ev.target.closest(".grip");
    if (grip === null || ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    const li = grip.closest("li");
    const ol = li.parentElement;
    const [i, from] = [Number(grip.dataset.i), Number(grip.dataset.j)];
    li.classList.add("drag");
    const move = (e) => {
      const below = [...ol.children].find((c) => c !== li && e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2);
      if (below !== li.nextElementSibling || below === undefined) {
        ol.insertBefore(li, below ?? null);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const to = [...ol.children].indexOf(li);
      const list = profs[i][1];
      list.splice(to, 0, ...list.splice(from, 1));
      profs_changed(`.grip[data-i="${i}"][data-j="${to}"]`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  profs_draw();
  picks();
}
async function settings_save(form, page, unset, listed, profs) {
  const set = {};
  const keys = {};
  for (const r of page.settings) {
    if (form.querySelector(`.set[data-key="${r.key}"]`) === null) {
      continue;
    }
    const field = form.querySelector(`input[name="${r.key}"]`);
    const now = r.key === "vendors" || r.key === "models" ? list_changed(list(r.value), listed(r.key))?.join(",") ?? r.value : field?.value.trim() ?? r.value;
    if (unset.has(r.key)) {
      set[r.key] = null;
    } else if (now !== r.value) {
      set[r.key] = now;
    }
  }
  for (const k of page.keys) {
    const typed = form.querySelector(`[name="key.${k.name}"]`)?.value.trim() ?? "";
    if (unset.has("key." + k.name)) {
      keys[k.name] = null;
    } else if (typed !== "") {
      keys[k.name] = typed;
    }
  }
  const why = form.querySelector(".save .why");
  form.querySelectorAll(".err").forEach((e) => e.textContent = "");
  let profiles;
  if (page.profiles != null) {
    const now = profs.map(([name, list]) => [name.trim(), list]);
    const all = now.map(([name]) => name);
    const bad = all.includes("") ? "Name each profile." : all.some((name, k) => all.indexOf(name) !== k) ? "Two profiles have the same name." : now.some(([, list]) => list.length === 0) ? "Add a model to each profile." : null;
    if (bad !== null) {
      const at = form.querySelector(".profiles");
      at.querySelector(".err").textContent = bad;
      at.scrollIntoView({ block: "center" });
      return;
    }
    const was = JSON.stringify(page.profiles);
    profiles = JSON.stringify(Object.fromEntries(now)) === was ? undefined : Object.fromEntries(now);
  }
  if (Object.keys(set).length === 0 && Object.keys(keys).length === 0 && profiles === undefined) {
    why.textContent = "Nothing changed.";
    return;
  }
  const go = form.querySelector(".go");
  go.disabled = true;
  why.textContent = "";
  const out = await post("/api/settings", { version: page.version, set, keys, ...profiles === undefined ? {} : { profiles } });
  go.disabled = false;
  if (!out.ok) {
    const at = out.key === undefined ? null : form.querySelector(`.set[data-key="${out.key}"]`);
    (at?.querySelector(".err") ?? why).textContent = out.error ?? "Could not save.";
    (at ?? why).scrollIntoView({ block: "center" });
    return;
  }
  const later = out.saved.filter((key) => page.settings.find((r) => r.key === key)?.apply === "restart");
  settings_draw(out);
  toast(later.length === 0 ? "Saved." : "Saved. " + later.join(", ") + " " + (later.length === 1 ? "applies" : "apply") + " once the server restarts.");
}
function toast(text, stay = false) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(P.toast);
  P.toast = stay ? 0 : setTimeout(() => el.hidden = true, 7000);
}
function intro_play() {
  const skip = new URLSearchParams(location.search).has("skip");
  if (localStorage.getItem("unii.intro") !== null || skip) {
    return Promise.resolve();
  }
  localStorage.setItem("unii.intro", "1");
  const el = document.createElement("div");
  return new Promise((gone) => {
    function end() {
      removeEventListener("keydown", end);
      el.classList.add("out");
      el.ontransitionend = () => {
        el.remove();
        gone();
      };
      if (DESK2.matches) {
        BOX.focus();
      }
    }
    el.id = "intro";
    el.innerHTML = SCENES;
    el.onclick = end;
    el.onanimationend = (ev) => {
      if (ev.target === el) {
        end();
      }
    };
    addEventListener("keydown", end);
    document.documentElement.append(el);
  });
}
var INTRO = intro_play();
boot();
