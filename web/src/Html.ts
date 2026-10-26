// Html
// ====
// What View.ts draws and Md.ts's tokens, as HTML, every text escaped, one
// element per row, knob or tab; and the settings page's parts. A click's
// effect is in the markup: `data-act`, the View.Act it makes;
// `data-copy`, what Copy copies (main.ts).

import type { Vendor } from "../../AskAI.ts";
import * as Call from "../../Call.ts";
import * as Md from "../../Md.ts";
import { EFFORTS, LABELS, Pick, VENDORS } from "../../Pick.ts";
import type { Key, Page, Row } from "../../Settings.ts";
import type { Field, Task } from "../../Tasks.ts";
import type * as Pipeline from "../../Pipeline.ts";
import * as Deps from "../../TaskDeps.ts";
import * as Theme from "../../Theme.ts";
import * as Timer from "../../Timer.ts";
import * as View from "../../View.ts";

// Types
// =====

// this browser's notifications (main.ts notify_state): off, on, blocked
// in its settings, or only once on the Home Screen (an iPhone's Safari)
export type Notify = "off" | "on" | "blocked" | "home";

// Constants
// =========

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

// a user's message past TALL chars (a line counts 80 or more: a paste)
// shows its head; its `details` unfolds it (style.css)
const TALL = 4000;

// a tool's call or result past SHORT lines (a pre's don't wrap) shows
// its first lines, faded; its `details` ("out") unfolds it (style.css)
const SHORT = 8;

// the Copy button's icons: two sheets, and a check once copied
export const SHEETS = `<svg viewBox="0 0 16 16" width="15" height="15"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.5v-.2A1.8 1.8 0 0 0 8.7 1.5H4.3A1.8 1.8 0 0 0 2.5 3.3v4.4a1.8 1.8 0 0 0 1.8 1.8h.2"/></svg>`;
export const CHECK  = `<svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8.5l3.2 3L13 4.5"/></svg>`;

// a diff line's class, by its mark
const MARKS: Record<Md.Line["s"], string> = { " ": "", "-": "del", "+": "add" };

// Show
// ====

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

function act_html(act: View.Act): string {
  return ` data-act="${esc(JSON.stringify(act))}"`;
}

function copy_html(text: string): string {
  return `<button class="copy" data-copy="${esc(text)}" title="Copy">${SHEETS}</button>`;
}

// a row's markup, made once: a known message's rows are kept (View's
// whole_rows)
const MADE = new WeakMap<View.Row, string>();

export function row_html(row: View.Row): string {
  const html = MADE.get(row) ?? row_make(row);
  MADE.set(row, html);
  return html;
}

function row_make(row: View.Row): string {
  switch (row.$) {
    case "Sum": {
      const open = act_html({ $: "Open", id: row.id, n: row.n });
      const text = row.call === null ? esc(row.text) : head_html(row.call, Call.call_line(row.call), "");
      return `<div class="block"${open} data-a="${row.id}"><span class="lv">${row.n}x</span><div>${text}</div></div>`;
    }
    case "Box": { // a message open (1x) looks as it does whole, its "fold" pill beside Copy
      const shut = act_html({ $: "Shut", id: row.id, n: row.n });
      const one  = row.n === 1 ? " one" : "";
      const rows = row.rows.map(row_html).join("");
      return `<div class="open${one}" data-a="${row.id}"><button class="fold"${shut}>${esc(row.text)}</button>${rows}</div>`;
    }
    case "Msg": {
      const at = row.id === null ? "" : ` data-a="${row.id}"`;
      const text = row.call === null ? row.text : Call.call_text(row.call);
      const copy = copy_html(text);
      const body = row.call === null ? row.body.map(block_html).join("") : call_html(row.call);
      const pics = images_html(row.images);
      const tall = ["user", "work"].includes(row.kind) && row.text.length + 80 * row.text.split("\n").length > TALL;
      const lines = text.trim().split("\n").length;
      const long = ["tool", "echo"].includes(row.kind) && lines > SHORT;
      const fold = tall ? `<div class="clip">${body}</div><details class="more"><summary></summary></details>`
        : long ? `<div class="clip">${body}</div><details class="more out"><summary data-n="${lines} linhas"></summary></details>`
        : body;
      const who = row.who === "" ? "" : ` data-who="${esc(row.who)}"`;
      return `<div class="msg ${row.kind}"${at}${who}>${copy}${fold}${pics}</div>`;
    }
    case "Cap": {
      return `<p class="cap">${esc(row.text)}</p>`;
    }
  }
}

// a tool call: its icon, verb, head and device, over a code block for
// each other value
function call_html(c: Call.Call): string {
  return head_html(c, c.head, c.device) + c.blocks.map(block_html).join("");
}

// a call's head: its emoji (Theme.TOOL) and name, then text ("" device:
// none shown)
function head_html(c: Call.Call, text: string, device: string): string {
  const icon  = `<span class="ic">${Theme.tool_glyph(c.name)}</span>`;
  const verb  = c.name === "" ? "" : `<b>${esc(c.name)}</b> `;
  const where = device === "" ? "" : `<span class="on">· ${esc(device)}</span>`;
  return `<p class="call">${where}${icon}${verb}${esc(text)}</p>`;
}

function images_html(names: string[]): string {
  const pics = names.map((name) => {
    const url = "/image/" + esc(name);
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${esc(name)}" loading="lazy"></a>`;
  });
  return names.length === 0 ? "" : `<div class="pics">${pics.join("")}</div>`;
}

// the line over the message box: fold/unfold (none on an agent's page),
// a rule, then the pick's knobs, each opening its menu (the browser's
// popover, placed by main.ts)
export function pick_html(fold: string | null, on: boolean, knobs: View.Knob[]): string[] {
  const parts = knobs.map((k) => [
    `<button title="${esc(k.hint)}" data-knob="${k.move}" popovertarget="pick-${k.move}" aria-haspopup="menu">${esc(k.text)}</button>`,
    `<div id="pick-${k.move}" class="choices" popover role="menu" aria-label="${k.move[0].toUpperCase() + k.move.slice(1)}">${k.choices.map(choice_html).join("")}</div>`,
  ]);
  const all = fold === null ? [] : [`<button class="all"${act_html({ $: "Fold", on })}>${esc(fold)}</button>`];
  return [...all, `<span class="rule"></span>`, ...parts.flatMap((part, i) => (i === 0 ? part : [`<span class="dot">·</span>`, ...part]))];
}

// a menu's row: a model's vendor over its first; the pick's marked and
// focused as the menu opens, its click only closing it
function choice_html(c: View.Choice): string {
  const head = c.vendor === null ? "" : `<p>${esc(c.vendor)}</p>`;
  const act  = c.here ? " autofocus" : act_html({ $: "Move", move: c.move, to: c.to });
  return `${head}<button role="menuitemradio" aria-checked="${c.here}"${act}>${esc(c.text)}</button>`;
}

// the MCP servers in the ☰ menu, each on or off in this chat (a click
// switches it); none: nothing
export function mcp_html(plugs: View.Plug[]): string[] {
  const one = (p: View.Plug) => {
    const hint = "Its tools are " + (p.on ? "on" : "off") + " in this chat; click to turn them " + (p.on ? "off" : "on") + ".";
    return `<button class="${p.on ? "on" : "off"}" title="${esc(hint)}"${act_html({ $: "Plug", name: p.name })}>${esc(p.name)}<span>${p.on ? "on" : "off"}</span></button>`;
  };
  return plugs.length === 0 ? [] : [`<p>MCP servers</p>`, ...plugs.map(one)];
}

export function tabs_html(tabs: View.Tab[]): string[] {
  return tabs.map((tab) => {
    const here = tab.here ? ` class="here"` : "";
    const sub = tab.sub === undefined ? "" : ` <small>${esc(tab.sub)}</small>`;
    const title = tab.sub === undefined ? "" : ` title="${esc(tab.sub)}"`;
    return `<button${here}${title}${act_html({ $: "Goto", name: tab.name })}>${esc(tab.text)}${sub}</button>`;
  });
}

// the chat's schedules (the header's ⏰): each one's time, message and
// Cancel
export function timers_html(timers: Timer.Timer[]): string[] {
  return timers.map((t) => {
    const cancel = `<button class="cancel"${act_html({ $: "Unschedule", id: t.id })}>Cancel</button>`;
    return `<li data-id="${esc(t.id)}"><span class="when">${esc(Timer.timer_when(t))}</span><span class="text">${esc(t.text)}</span>${cancel}</li>`;
  });
}

// Pending tasks (Tasks.ts) on the Mesa
// ====================================
// The pending list shows only on the Mesa (main.ts desk; the Conversa
// keeps only the header's Mesa · N, the notification of the user's
// count). A task shown there, an article: its head (id, title, and a
// line of quick marks: priority, late, kind, what it frees, its
// thread's state, the evidence round's marks), then one line that says
// whose move it is and what's expected (View.task_turn_said), then two
// columns: at the left what to read and decide (its detail, Markdown as
// messages are; its PRs verified, each a card; its fields, the comment,
// its choices, each concluding with it, the one recommended marked;
// "Aceitar as recomendadas"; Concluir and Descartar; one of Unii's,
// only Cobrar agora and Pode fechar; its thread, a box to write in, a
// message there starts a turn, not a conclusion), at the right its
// ficha (facts_html: whose, where it came from, its front, kind and
// limit, dates, what it waits for and frees, PRs, fields left, agent,
// next step, what makes it done). On a narrow screen (a phone) they
// stack, the ficha after the decision. What is typed and not sent
// (data-keep) survives the article made again (main.ts keep).

function task_when(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function task_head(t: Task): string {
  return `<p class="head"><span class="id">${esc(t.id)}</span><span class="title">${esc(t.title)}</span></p>`;
}

// where a task came from, a badge (a link to its source, if it has one)
function task_origin(t: Task): string[] {
  const said = View.origin_said(t);
  if (said === "") {
    return [];
  }
  const url = t.origin_url !== null && /^https?:\/\//i.test(t.origin_url) ? t.origin_url : null;
  return [url === null ? `<span class="origin" title="Origem">${esc(said)}</span>` : `<a class="origin" title="Origem" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(said)}</a>`];
}

// a line of marks ("" for none)
function task_meta(more: string[]): string {
  return more.length === 0 ? "" : `<p class="meta">${more.join(" · ")}</p>`;
}

function task_button(t: Task, state: Task["state"], text: string, cls: string, answer?: string): string {
  return `<button class="${cls}"${act_html({ $: "Task", task: t.id, state, ...(answer === undefined ? {} : { answer }) })}>${esc(text)}</button>`;
}

// a task's marks of the evidence round (View.task_marks), each a badge
function marks_html(t: Task, tasks: Task[], now: number): string[] {
  return View.task_marks(t, tasks, now).map(([cls, text]) => `<span class="mark ${esc(cls)}">${esc(text)}</span>`);
}

// what closed a task, each evidence a line; none: "sem evidência",
// said with what to do
function evidence_html(t: Task): string {
  const all = t.evidence ?? [];
  if (all.length === 0) {
    return `<p class="evidence none"><span class="mark unproven">${esc(View.UNPROVEN_SAID)}</span> Fechada sem evidência registrada. Reabra-a se o problema não foi resolvido.</p>`;
  }
  return `<section class="evidence" aria-label="Evidência"><p class="sub">Evidência</p><ul>${all.map((e) => `<li>${esc(View.evidence_said(e))}</li>`).join("")}</ul></section>`;
}

// a task's detail, Markdown ("" for none)
function task_detail(t: Task): string {
  return t.detail === "" ? "" : `<div class="detail"><div class="md">${Md.md_parse(t.detail).map(block_html).join("")}</div></div>`;
}

// whose move it is and what's expected, the line under the head
function turn_html(t: Task, tasks: Task[], now: number, turn: View.Turn | null, blocked: Set<string>): string {
  const said = View.task_turn_said(t, tasks, now, turn, blocked);
  return `<p class="turn-line ${esc(said.cls)}"><strong>${esc(said.lead)}</strong> ${esc(said.text)}</p>`;
}

// a link to another task on the Mesa, with whose it is and, closed, how
function goto_html(tasks: Task[], id: string): string {
  const u = tasks.find((x) => x.id === id);
  const how = u === undefined ? " (fora da lista)" : u.state === "open" ? "" : u.state === "done" ? " (concluída)" : " (descartada)";
  return `<button class="goto" data-desk="${esc(id)}">${esc(View.id_whose(tasks, id))}${esc(how)}</button>`;
}

// The ficha: a task's facts, a list of label and value (each value made
// safe here), only those it has
function facts_html(t: Task, tasks: Task[], now: number, blocked: Set<string>): string {
  const rows: [string, string][] = [];
  const add = (label: string, html: string) => html !== "" && rows.push([label, html]);
  const when = (iso: string | null | undefined) => (iso == null || Number.isNaN(Date.parse(iso)) ? "" : `<time datetime="${esc(iso)}">${esc(task_when(iso))}</time> <span class="ago">(${esc(View.ago_said(iso, now))})</span>`);
  add("Situação", esc(View.task_status_said(t)));
  add("Responsável", esc(t.assignee === "user" ? "Você" : t.assignee === "unii" ? "Unii" : t.assignee));
  add("Agente", t.agent == null ? (t.state === "open" && t.assignee !== "user" ? `<span class="agent none">sem agente</span>` : "") : esc(t.agent));
  add("Origem", task_origin(t).join(""));
  add("Frente", t.ref === null ? "" : `<span class="ref">${esc(t.ref)}</span>`);
  add("Tipo", esc(View.task_kind_said(t)));
  add("Prioridade", esc(View.task_priority_said(t).replace(/^prioridade /, "")));
  if (t.state === "open") {
    add("Prazo", esc(View.task_limit_said(t, tasks, now, blocked)));
  }
  add("Ordem recebida", (t.order ?? null) === null ? "" : esc(t.order!.answer ?? "sua escolha"));
  add("Próximo passo", esc(t.state === "open" ? (t.next_step ?? "") : ""));
  add("Pronto quando", esc(t.done_when ?? ""));
  add("Aguarda (fora da lista)", esc(t.state === "open" ? (t.waits_for ?? "") : ""));
  add("Depende de", (t.after ?? []).map((id) => goto_html(tasks, id)).join(" "));
  add("Libera", t.state === "open" ? Deps.frees_ids(tasks, t).map((id) => goto_html(tasks, id)).join(" ") : "");
  const pr = (p: { url: string; label: string }) => {
    const c = (t.prs ?? []).find((x) => x.url === p.url);
    const said = c === undefined ? "" : ` <span class="verdict ${esc(c.verdict)}">${esc(View.VERDICT_SAID[c.verdict])}</span> <code>${esc(c.head.slice(0, 7))}</code>`;
    return `<span class="pr-fact"><a class="pr" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.label)}</a>${said}</span>`;
  };
  add(View.task_prs(t).length === 1 ? "PR" : "PRs", View.task_prs(t).map(pr).join(""));
  if (t.state === "open" && (t.fields ?? []).length > 0) {
    const left = View.task_fields_left(t);
    const given = t.fields.filter((f) => Object.hasOwn(t.draft ?? {}, f.id) && !View.value_empty(t.draft[f.id])).length;
    add("Campos", esc(given + " de " + t.fields.length + " respondidos" + (left.length === 0 ? "" : "; faltam: " + left.map((f) => f.label).join(", "))));
  }
  const thread = t.thread ?? [];
  if (thread.length > 0) {
    const last = thread[thread.length - 1];
    add("Conversa", esc(thread.length + (thread.length === 1 ? " mensagem" : " mensagens") + "; última de " + (last.who === "user" ? "você" : "Unii") + " " + View.ago_said(last.at, now)));
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

// a task shown on the Mesa: its head, whose move it is, then the two
// columns (main: what to read and decide; the ficha)
function task_article(t: Task, cls: string, tasks: Task[], now: number, turn: View.Turn | null, marks: string[], main: string): string {
  const blocked = Deps.blocked_ids(tasks);
  return `<article class="${esc(cls)}" data-task="${esc(t.id)}">${task_head(t)}${task_meta(marks)}${turn_html(t, tasks, now, turn, blocked)}<div class="cols"><div class="main">${main}</div>${facts_html(t, tasks, now, blocked)}</div></article>`;
}

// an open task free to resolve (with how late it is, how long it
// stalled, and, the user wrote in its thread, how long it waits for
// Unii and why, by its turn)
function task_open_html(t: Task, tasks: Task[], now = Date.now(), turn: View.Turn | null = null): string {
  const frees = View.task_frees_named(tasks, t);
  const mine = t.assignee === "user";
  const blocked = Deps.blocked_ids(tasks);
  const late = View.task_late_said(t, blocked, now);
  const stalled = View.task_stalled_said(t, blocked, now);
  const prio = View.task_priority_said(t);
  const said = View.task_talk_wait_said(t, now, turn, blocked);
  const marks = [
    ...(prio === "" ? [] : [`<span class="prio ${esc(Deps.priority_of(t))}">${esc(prio)}</span>`]),
    ...(late === "" ? [] : [`<span class="late">${esc(late)}</span>`]),
    ...(frees === "" ? [] : [`<span class="frees">${esc(frees)}</span>`]),
    ...(said === "" ? [] : [`<span class="talk ${esc(View.talk_cls(said))}">${esc(said)}</span>`]),
    ...(stalled.text === "" ? [] : [`<span class="${stalled.late ? "late" : "stalled"}">${esc(stalled.text)}</span>`]),
    ...marks_html(t, tasks, now),
    ...((t.waits_for ?? null) === null ? [] : [`<span class="waits-for">${esc(View.task_waits_for_said(t))}</span>`]),
  ];
  const cls = "task " + (mine ? "user" : "other " + t.assignee) + (t.talk === null ? "" : " talk-" + t.talk);
  const read = `${task_detail(t)}${task_prs_html(t)}`;
  // a task of Unii's (P6): only "Cobrar agora" (a message in its thread,
  // a turn) and "Pode fechar" (done; Unii told as of any resolution)
  if (!mine) {
    // already asked, not replied: Cobrar disabled, why said in the hint
    // (visible, and the button's description), not in a title alone
    const asked = t.talk === "unii";
    const why = `chase-why-${esc(t.id)}`;
    const chase = `<button class="chase"${asked ? ` disabled aria-describedby="${why}"` : ""}${act_html({ $: "TaskSay", task: t.id, text: View.CHASE })}>${asked ? "Cobrado: aguardando o Unii" : "Cobrar agora"}</button>`;
    // an order received closes only with the evidence of its execution:
    // the user may cancel it, not close it (the evidence round)
    const ordered = t.state === "open" && (t.order ?? null) !== null;
    const close = ordered ? task_button(t, "dropped", "Cancelar ordem", "drop cancel") : task_button(t, "done", "Pode fechar", "close");
    const hint = asked ? `<span class="hint" id="${why}">Você já cobrou e o Unii ainda não respondeu. “Cobrar agora” volta quando ele responder na conversa.</span>` : "";
    const acts = `<div class="acts unii">${hint}${chase}${close}</div>`;
    return task_article(t, cls, tasks, now, turn, marks, `${read}${acts}${thread_html(t)}`);
  }
  // a choice concludes the task at once (with the comment typed): said;
  // the one recommended marked (View.task_rec)
  const rec = View.task_rec(t);
  const opt = (c: string) => {
    const on = View.rec_is(rec, c);
    const tagged = (on && !View.rec_marked(c) ? ` <span class="rec-tag">recomendada</span>` : "") + (View.act_unii(t, c) ? ` <span class="act-tag">${esc(View.ACT_SAID)}</span>` : "");
    return `<button class="opt${on ? " rec" : ""}"${act_html({ $: "Task", task: t.id, state: "done", answer: c })}>${esc(c)}${tagged}</button>`;
  };
  const opts = t.choices.length === 0 ? "" : `<div class="opts" role="group" aria-label="Concluir como"><span class="lead">Concluir como:</span>${t.choices.map(opt).join("")}</div>`;
  const note = `<input class="note" type="text" maxlength="1000" placeholder="Comentário (opcional)" aria-label="Comentário sobre ${esc(t.id)}" data-keep="note">`;
  // "Aceitar as recomendadas" (View.task_accept): one act, key a
  const accept = View.task_accepts(t) ? `<button class="accept" aria-keyshortcuts="a" title="Atalho: a"${act_html({ $: "TaskAccept", task: t.id })}>${esc(View.task_accept_said(t))}</button>` : "";
  const orders = t.choices.some((c) => View.act_unii(t, c));
  const told = `<span class="hint told">${orders ? `As opções marcadas “${esc(View.ACT_SAID)}” avisam o Unii na hora; as demais, em até 1 min.` : "O Unii é avisado sozinho em até 1 min."}</span>`;
  const acts = `<div class="acts">${told}${accept}${task_button(t, "done", "Concluir", "done")}${task_button(t, "dropped", "Descartar", "drop")}</div>`;
  const decide = `<section class="decide" aria-label="Decisão">${fields_html(t)}${note}${opts}${acts}</section>`;
  return task_article(t, cls, tasks, now, turn, marks, `${read}${decide}${thread_html(t)}`);
}

// the pull requests a task points to: those verified (prs, R5) each a
// card (its link, head, verdict, verifier, notes by severity, what wasn't
// tested), then the other links (View.task_prs) each by its "repo#n";
// "" for none
function task_prs_html(t: Task): string {
  const verified = new Set((t.prs ?? []).map((p) => p.url));
  const cards = (t.prs ?? []).length === 0 ? "" : `<section class="checks" aria-label="Verificação">${t.prs.map(check_html).join("")}</section>`;
  const prs = View.task_prs(t).filter((p) => !verified.has(p.url));
  if (prs.length === 0) {
    return cards;
  }
  return cards + task_links_html(prs);
}

// a pull request as verified, a card
function check_html(p: NonNullable<Task["prs"]>[number]): string {
  const notes = p.notes.length === 0 ? "" : `<ul class="notes">${p.notes.map((n) => `<li class="sev ${esc(n.sev)}"><span class="sev-tag">${esc(View.SEV_SAID[n.sev][0])}</span> ${esc(n.text)}</li>`).join("")}</ul>`;
  const untested = p.untested.length === 0 ? "" : `<p class="untested"><span class="lead">Não testado:</span> ${esc(p.untested.join("; "))}</p>`;
  const by = p.verifier === null ? "" : ` por ${esc(p.verifier)}`;
  return `<div class="check ${esc(p.verdict)}"><p class="check-head"><a class="pr" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(View.pr_label(p.url))}</a> <span class="lead">head</span> <code class="head">${esc(p.head.slice(0, 12))}</code> <span class="verdict">${esc(View.VERDICT_SAID[p.verdict])}${by}</span> <span class="count">${esc(View.pr_notes_said(p))}</span></p>${notes}${untested}</div>`;
}

// links to pull requests, each by its "repo#n"
function task_links_html(prs: { url: string; label: string }[]): string {
  const one = (p: { url: string; label: string }) => `<a class="pr" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.label)}</a>`;
  return prs.length === 0 ? "" : `<p class="prs"><span class="lead">${prs.length === 1 ? "PR" : "PRs"}:</span> ${prs.map(one).join(" ")}</p>`;
}

// a task closed lately: how, its evidence, its detail, its answers and
// its thread, to read, and Reabrir
function task_closed_html(t: Task, tasks: Task[], now = Date.now()): string {
  const how = [...(t.told ? [] : ["o Unii será avisado em até 1 min"]), ...marks_html(t, [], now)];
  const acts = `<div class="acts">${task_button(t, "open", "Reabrir", "reopen")}</div>`;
  const cls = "task closed" + (View.task_unproven(t) ? " unproven" : "");
  return task_article(t, cls, tasks, now, null, how, `${evidence_html(t)}${task_detail(t)}${task_prs_html(t)}${answers_html(t)}${acts}${thread_read_html(t)}`);
}

// a task waiting for others: what it waits for, each a link to it on the
// Mesa, with its pull requests, its detail and its thread, to read
function task_waiting_html(t: Task, tasks: Task[], now = Date.now()): string {
  const cls = "task waiting " + (t.assignee === "user" ? "user" : "other " + t.assignee);
  const frees = View.task_frees_named(tasks, t);
  const marks = frees === "" ? [] : [`<span class="frees">${esc(frees)}</span>`];
  const why = `<p class="waits">Só pode ser resolvida depois de: ${View.and_said(Deps.waits(tasks, t).map((id) => goto_html(tasks, id)))}.</p>`;
  return task_article(t, cls, tasks, now, null, marks, `${why}${task_detail(t)}${task_prs_html(t)}${thread_read_html(t)}`);
}

// a task concluded with fields: each one's answer
function answers_html(t: Task): string {
  const fields = t.fields ?? [];
  const values = t.answers ?? {};
  if (t.state !== "done" || fields.length === 0) {
    return "";
  }
  const said = (f: Field) => {
    const v = Object.hasOwn(values, f.id) ? values[f.id] : undefined;
    return v === undefined || v.length === 0 ? "sem resposta" : Array.isArray(v) ? v.join(", ") : v;
  };
  return `<dl class="answers">${fields.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(said(f))}</dd>`).join("")}</dl>`;
}

// a closed or waiting task's thread, to read only ("" for none)
function thread_read_html(t: Task): string {
  const thread = t.thread ?? [];
  return thread.length === 0 ? "" : `<section class="thread read"><p class="sub">Conversa (${thread.length})</p><ol>${thread.map(thread_msg_html).join("")}</ol></section>`;
}

// The Mesa (main.ts): the list at the left, its groups (View.desk_list)
// each under its heading, a task a row (its id, title, and a line of
// its project, whose turn, assignee, what it frees or waits for; sel:
// the one shown, aria-selected); the detail at the right, the task
// shown whole (task_open_html, task_closed_html, task_waiting_html) or,
// none, a note (detail: its elements, the first ← back, for a phone).
// ids: the rows' order (j and k go down and up them). order: the rows'
// order while the one shown was still in "now" (main.ts keeps it), so
// "Próxima" goes on from where it was (View.desk_next); turn: Unii's
// turn as the view knows it (View.turn_of), to say why a task waits
// for Unii
export type DeskOpts = { order?: string[]; turn?: View.Turn | null };
export function desk_html(tasks: Task[], q: string, ref: string, sel: string | null, now = Date.now(), opts: DeskOpts = {}): { list: string[]; detail: string[]; ids: string[] } {
  const groups = View.desk_list(tasks, q, ref);
  const ids = groups.flatMap((g) => g.tasks.map((t) => t.id));
  const blocked = Deps.blocked_ids(tasks);
  const turn = opts.turn ?? null;
  const row = (t: Task, g: View.Desk) => {
    const frees = g === "closed" ? "" : View.task_frees_named(tasks, t);
    const late = View.task_late_said(t, blocked, now);
    const stalled = g === "others" ? View.task_stalled_said(t, blocked, now) : { text: "", late: false };
    const agent = g === "closed" ? "" : View.task_agent_said(t);
    const talk = g === "closed" ? "" : View.task_talk_wait_said(t, now, turn, blocked);
    const prs = g === "closed" ? [] : View.task_prs(t);
    const prio = g === "closed" ? "" : View.task_priority_said(t);
    const outside = g === "closed" ? "" : View.task_waits_for_said(t);
    const rejected = g === "closed" ? 0 : (t.prs ?? []).filter((p) => p.verdict === "rejected").length;
    const more = [
      ...(prio === "" ? [] : [`<span class="prio ${esc(Deps.priority_of(t))}">${esc(prio)}</span>`]),
      ...(late === "" ? [] : [`<span class="late">${esc(late)}</span>`]),
      ...(t.ref === null ? [] : [`<span class="ref">${esc(t.ref)}</span>`]),
      ...(prs.length === 0 ? [] : [`<span class="pr">${esc(prs.length === 1 ? "PR " + prs[0].label : prs.length + " PRs")}</span>`]),
      ...(rejected === 0 ? [] : [`<span class="late">${esc(rejected === 1 ? "1 PR reprovado" : rejected + " PRs reprovados")}</span>`]),
      ...(outside === "" ? [] : [`<span class="waits-for">${esc(outside)}</span>`]),
      ...(talk === "" ? [] : [`<span class="talk ${esc(View.talk_cls(talk))}">${esc(talk)}</span>`]),
      ...(t.assignee === "user" ? [] : [esc(View.assignee_said(t))]),
      ...(agent === "" ? [] : [`<span class="agent${t.agent == null ? " none" : ""}">${esc(agent)}</span>`]),
      ...(stalled.text === "" ? [] : [`<span class="${stalled.late ? "late" : "stalled"}">${esc(stalled.text)}</span>`]),
      ...(frees === "" ? [] : [`<span class="frees">${esc(frees)}</span>`]),
      ...(g === "waiting" ? [esc(View.task_waits_named(tasks, t))] : []),
      ...(g === "closed" ? [t.state === "done" ? "concluída" : "descartada"] : []),
      ...marks_html(t, tasks, now),
    ];
    const on = t.id === sel;
    return `<button class="row ${g}${on ? " sel" : ""}" role="option" aria-selected="${on}" data-desk="${esc(t.id)}"><span class="head"><span class="id">${esc(t.id)}</span><span class="title">${esc(t.title)}</span></span>${more.length === 0 ? "" : `<span class="meta">${more.join(" · ")}</span>`}</button>`;
  };
  const list = groups.flatMap((g) => [`<p class="group ${g.group}" role="presentation">${esc(g.label)} <span class="n">(${g.tasks.length})</span></p>`, ...g.tasks.map((t) => row(t, g.group))]);
  const searched = q.trim() !== "" || ref !== "";
  const none = tasks.length === 0 ? "Nenhuma pendência. Quando o Unii precisar de você, ela aparece aqui." : searched && ids.length === 0 ? "Nenhuma pendência na busca." : "";
  const t = sel === null ? undefined : tasks.find((x) => x.id === sel);
  const back = `<button class="back" type="button" data-desk-back aria-label="Voltar à lista">← Pendências</button>`;
  // resolved, or waiting: the next one of "now", a click away
  const after = t === undefined || View.desk_group(t, blocked) === "now" ? null : View.desk_next(tasks, t.id, q, ref, opts.order ?? []);
  const next = after === null ? [] : [`<button class="next" type="button" data-desk="${esc(after.id)}">Próxima: <span class="id">${esc(after.id)}</span> ${esc(after.title)} →</button>`];
  const detail = t === undefined
    ? [`<p class="empty">${tasks.length === 0 ? "Nenhuma pendência." : "Escolha uma pendência na lista (<kbd>j</kbd> e <kbd>k</kbd> navegam)."}</p>`]
    : [back, t.state !== "open" ? task_closed_html(t, tasks, now) : blocked.has(t.id) ? task_waiting_html(t, tasks, now) : task_open_html(t, tasks, now, turn), ...next];
  return { list: none === "" ? list : [...list, `<p class="none">${esc(none)}</p>`], detail, ids };
}

// a task's fields, each a fieldset: a choice and yes or no as radios,
// many as checkboxes, a text as a textarea; its draft answer checked or
// in it. "" for none
function fields_html(t: Task): string {
  const fields = t.fields ?? [];
  if (fields.length === 0) {
    return "";
  }
  const draft = t.draft ?? {};
  const one = (f: Field) => {
    const v = Object.hasOwn(draft, f.id) ? draft[f.id] : undefined;
    const name = "f-" + t.id + "-" + f.id;
    const req = f.required ? ` <span class="req" title="Obrigatório">*</span>` : "";
    const legend = `<legend>${esc(f.label)}${req}</legend>`;
    const must = f.required ? ` data-required="true"` : "";
    if (f.kind === "text") {
      const rec = View.field_rec(f);
      const hint = typeof rec === "string" ? `<p class="rec-text"><span class="rec-tag">recomendado</span> ${esc(rec)}</p>` : "";
      return `<fieldset class="field" data-field="${esc(f.id)}" data-kind="text"${must}>${legend}${hint}<textarea rows="2" maxlength="1000" aria-label="${esc(f.label)}" data-keep="f-${esc(f.id)}">${esc(typeof v === "string" ? v : "")}</textarea></fieldset>`;
    }
    const type = f.kind === "multi" ? "checkbox" : "radio";
    const on = (c: string) => (Array.isArray(v) ? v.includes(c) : v === c);
    const rec = View.field_rec(f);
    const label = (c: string) => {
      const r = View.rec_is(rec, c);
      const tagged = r && !View.rec_marked(c) ? ` <span class="rec-tag">recomendada</span>` : "";
      return `<label${r ? ` class="rec"` : ""}><input type="${type}" name="${esc(name)}" value="${esc(c)}"${on(c) ? " checked" : ""}> ${esc(c)}${tagged}</label>`;
    };
    const boxes = f.choices.map(label).join("");
    return `<fieldset class="field" data-field="${esc(f.id)}" data-kind="${esc(f.kind)}"${must}>${legend}<div class="picks">${boxes}</div></fieldset>`;
  };
  return `<div class="fields">${fields.map(one).join("")}</div>`;
}

function thread_msg_html(m: Task["thread"][number]): string {
  return m.who === "unii"
    ? `<li class="unii"><span class="who">Unii</span><div class="md">${Md.md_parse(m.text).map(block_html).join("")}</div></li>`
    : `<li class="user"><span class="who">Você</span><p>${esc(m.text)}</p></li>`;
}

// a task's thread: its messages (Unii's as Markdown, as messages are;
// the user's as typed), a box and Enviar (main.ts: the box's text, as a
// TaskSay), a section
function thread_html(t: Task): string {
  const thread = t.thread ?? [];
  const said = thread.length === 0 ? "Conversar sobre esta pendência" : "Conversa (" + thread.length + ")";
  const box = `<textarea class="say" rows="3" maxlength="4000" placeholder="Escreva sobre esta pendência (não a conclui)" aria-label="Mensagem sobre ${esc(t.id)}" data-keep="say"></textarea>`;
  const send = `<button class="say-send"${act_html({ $: "TaskSay", task: t.id, text: "" })}>Enviar</button>`;
  const msgs = thread.length === 0 ? "" : `<ol>${thread.map(thread_msg_html).join("")}</ol>`;
  return `<section class="thread"><p class="sub">${esc(said)}</p>${msgs}${box}<div class="acts"><span class="hint">Ctrl+Enter envia</span>${send}</div></section>`;
}

// Settings page
// =============

// the settings page (/settings, or /account): the prompts (null, unread:
// a retry); this browser's own acts (notify: its notifications, null:
// none to offer); then the server's settings (main.ts fills .owned)
export function account_html(prompts: View.Prompts | null, notify: Notify | null = null): string {
  const item    = (what: string, note: string, act: string) => `<div class="item"><p>${what}${note === "" ? "" : `<small>${note}</small>`}</p>${act}</div>`;
  const acts    = [
    item("This browser", "Signed in to this server.", `<button class="chip out">Sign out</button>`),
    ...(notify === null ? [] : [notify_html(notify)]),
    item("Export memory", "The chat and its summaries, in one file.", `<a class="chip" href="/export">Download</a>`),
  ];
  const unread  = item("Could not read the prompts.", "", `<button class="chip retry">Try again</button>`);
  const mine    = section_html("Prompts", prompts === null ? unread : prompt_html("prompt", prompts.prompt.text, "The user prompt: Unii's system prompt in every turn; its subagents get it too once you change it. Add who you are and how you want work done at its end. prompt.md in the server's folder; empty: the built-in one.")
    + prompt_html("compact", prompts.compact.text, "The compaction prompt: all a summary of the memory gets, nothing else. compact.md in the server's folder; empty: the built-in one."));
  return `<a class="back" href="/" data-go="/">← Chat</a><h1>Settings</h1>` + mine + section_html("This browser", acts.join("")) + `<div class="owned"></div>`;
}

// a prompt's editor: its note, its text (name: what /api/prompts sets), Save
function prompt_html(name: string, text: string, note: string): string {
  const area = `<textarea name="${name}" rows="12" spellcheck="false">${esc(text)}</textarea>`;
  return `<form class="prompt"><p class="note">${esc(note)}</p>${area}<div><p class="why"></p><button class="chip">Save</button></div></form>`;
}

// the account page's notifications item: its note, and its button
function notify_html(notify: Notify): string {
  const note = {
    off     : "Respostas e pendências que precisam de você, neste aparelho, quando o UniiChat não está aberto.",
    on      : "Respostas e pendências que precisam de você, neste aparelho, quando o UniiChat não está aberto.",
    blocked : "Bloqueadas nas configurações deste navegador para este site.",
    home    : "No iPhone e no iPad: toque em Compartilhar, depois em Adicionar à Tela de Início, e abra o UniiChat por lá.",
  }[notify];
  const button = notify === "home" ? "" : `<button class="chip notify"${notify === "blocked" ? " disabled" : ""}>${notify === "on" ? "Desativar" : "Ativar"}</button>`;
  return `<div class="item"><p>Notificações<small>${note}</small></p>${button}</div>`;
}

// Settings
// ========
// The owner's part of the settings page (the server's settings:
// Settings.ts), at its bottom: a row a setting or a key the page may
// change, each its control (named by its key; a key's "key.<name>"),
// where its value comes from and when a change applies, a button back
// to the default (a key: out) if config.json sets it, and a place for
// why a save was refused. One the page may not change (set by the
// environment, or a server path or command) isn't shown. main.ts reads
// the form and fills the picks' lists (picks_html).

// what each setting is, as the page says it: its name, a line about it
const SETTING: Record<string, [string, string]> = {
  vendors   : ["Vendors", "Whose models the server offers."],
  models    : ["Models", "The models offered, of those vendors."],
  pick      : ["Default model", "What a chat runs on until it picks another."],
  compactor : ["Compactor model", "What writes the memory's summaries."],
  agents    : ["Subagent model", "What subagents run on."],
  site      : ["Site", "The server's address, for sign-in links and the installer."],
  apple     : ["iOS App ID", "The app's team and bundle ID, whose sign-in links it opens."],
  apns      : ["APNs key ID", "The ID of the key the app's pushes are signed with."],
};

const KEY: Record<string, [string, string]> = {
  anthropic : ["Anthropic key", "For claude-api's models."],
  openai    : ["OpenAI key", "For openai-api's models and dictation."],
  cursor    : ["Chave do Cursor", "Para os modelos do cursor, em vez da autenticação feita por `unii serve cursor`."],
  apns      : ["APNs key", "The .p8 key the iOS app's pushes are signed with."],
};

// each vendor's key
export const VENDOR_KEY: Record<string, string> = { "claude-api": "anthropic", "openai-api": "openai" };

// the settings whose value is a pick (four lists: picks_html)
export const PICKS = ["pick", "compactor", "agents"];

const GROUPS: Array<[string, string[]]> = [
  ["Models", ["vendors", "models", "pick", "compactor", "agents"]],
  ["Server", ["site", "apple", "apns"]],
];

export function settings_html(page: Page): string {
  const rows = new Map(page.settings.filter((r) => r.web && r.from !== "env").map((r) => [r.key, r]));
  const group = ([title, keys]: [string, string[]]) => {
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

// the models the vendors and models checked offer, as "vendor:model"
export function offered(vendors: string[], models: string[]): string[] {
  return Pick.models(VENDORS.filter((v) => vendors.includes(v)), models).map(([v, m]) => v + ":" + m.label);
}

// the profile editor (main.ts fills .profiles .field and keeps the
// list): each profile its name, Delete, its models in order (each a
// handle to drag, or move by arrow keys, and Remove) and a list to add
// one of `offered` ("vendor:model", the vendors' and models checked);
// then Add profile
export function profiles_html(profiles: Array<[string, string[]]>, offered: string[]): string {
  const model = (m: string, i: number, j: number) => {
    const [vendor = "", label = m, ...rest] = m.split(":");
    const more = rest.length === 0 ? "" : ` <small>${esc(rest.join(" · "))}</small>`;
    return `<li data-j="${j}"><button type="button" class="grip" data-i="${i}" data-j="${j}" aria-label="Move ${esc(label)}">⠿</button><span>${esc(label)}${more} <small>${esc(vendor)}</small></span><button type="button" class="out" data-i="${i}" data-j="${j}" aria-label="Remove ${esc(label)}">×</button></li>`;
  };
  const add = (list: string[], i: number) => {
    const left = offered.filter((m) => !list.some((x) => x.split(":").slice(0, 2).join(":") === m));
    const groups = [...new Set(left.map((m) => m.split(":")[0]))].map((v) => `<optgroup label="${esc(v)}">${left.filter((m) => m.startsWith(v + ":")).map((m) => `<option value="${esc(m)}">${esc(m.split(":")[1])}</option>`).join("")}</optgroup>`);
    return left.length === 0 ? "" : `<select class="add" data-i="${i}" aria-label="Add model"><option value="">Add model</option>${groups.join("")}</select>`;
  };
  const one = ([name, list]: [string, string[]], i: number) =>
    `<div class="prof" data-i="${i}"><div class="name"><input class="pname" data-i="${i}" value="${esc(name)}" aria-label="Name" placeholder="Enter the profile name here" maxlength="60" spellcheck="false" autocapitalize="off"><button type="button" class="chip red pdel" data-i="${i}">Delete</button></div><ol>${list.map((m, j) => model(m, i, j)).join("")}</ol>${add(list, i)}</div>`;
  return profiles.map(one).join("") + `<button type="button" class="chip pnew">Add profile</button>`;
}

function setting_html(r: Row): string {
  const [name, about] = SETTING[r.key] ?? [r.key, ""];
  const id = "set-" + r.key + (PICKS.includes(r.key) ? "-vendor" : "");
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(r.key)}</code></small></label>`;
  return `<div class="set" data-key="${esc(r.key)}">${label}<div class="field">${control_html(r)}</div>${from_html(r)}<p class="err"></p></div>`;
}

function control_html(r: Row): string {
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

// a list setting's items
export function list(text: string): string[] {
  return text.split(",").map((x) => x.trim()).filter((x) => x !== "");
}

// a list as saved (`was`) and its items checked now (`now`, in the boxes'
// order): null if the same items (in any order: no change); else the
// items kept, in their order, then those added, in the boxes'
export function list_changed(was: string[], now: string[]): string[] | null {
  const same = was.length === now.length && was.every((x) => now.includes(x)) && now.every((x) => was.includes(x));
  return same ? null : [...was.filter((x) => now.includes(x)), ...now.filter((x) => !was.includes(x))];
}

// a box per item; a model's names the vendors that offer it
// (`data-vendor`, space-separated: main.ts shows it while one is checked)
function checks_html(name: string, all: string[], on: string[], vendor: (x: string) => string): string {
  const box = (x: string) => `<label class="opt" data-vendor="${esc(vendor(x))}"><input type="checkbox" name="${name}" value="${esc(x)}"${on.includes(x) ? " checked" : ""}> ${esc(x)}</label>`;
  const odd = on.filter((x) => !all.includes(x));
  return `<div class="opts">${all.map(box).join("")}${odd.map(box).join("")}</div>`;
}

// where a value comes from, when a change applies, and the button back
// to the default
function from_html(r: Row): string {
  const from = r.from === "file" ? "From config.json" : "Default";
  const apply = r.apply === "now" ? "applies at once" : "applies on a restart";
  const running = r.running === null ? "" : ` · running on <code>${esc(r.running === "" ? "(none)" : r.running)}</code> till then`;
  const reset = r.from === "file" ? ` <button type="button" class="reset">Use the default</button>` : "";
  return `<p class="from">${from} · ${apply}${running}${reset}</p>`;
}

function key_html(k: Key): string {
  const [name, about] = KEY[k.name] ?? [k.name, ""];
  const id = "set-key-" + k.name;
  const field = k.name === "apns" ? `<textarea id="${id}" name="key.${k.name}" rows="3" placeholder="Paste a new key to set it" spellcheck="false"></textarea>` : `<input id="${id}" type="password" name="key.${k.name}" autocomplete="new-password" placeholder="Paste a new key to set it" spellcheck="false" autocapitalize="off">`;
  const tail = k.tail === "" ? "" : `, ending in <code>${esc(k.tail)}</code>`;
  const from = k.from === "file" ? `Set${tail}, in keys.json` : "Not set";
  const reset = k.from === "file" ? ` <button type="button" class="reset">Remove</button>` : "";
  const label = `<label for="${id}">${esc(name)}<small>${esc(about)} <code>${esc(k.env)}</code></small></label>`;
  return `<div class="set key" data-key="key.${esc(k.name)}">${label}<div class="field">${field}</div><p class="from">${from}${reset}</p><p class="err"></p></div>`;
}

// a pick setting's four lists, vendor, model, effort and speed, for
// `value` (vendor:model:effort:speed): the vendors and the models checked
// (`vendors`, `models`), the vendor's models, the model's speeds; first
// `none` (agents: the chat's pick, value ""), which shows the vendor's
// list only. A part they don't offer shows, said. The profiles' names
// (`profiles`) follow the vendors in the first list; one picked is
// the whole value, so no other list shows.
export function picks_html(key: string, vendors: string[], models: string[], value: string, none: string | null, profiles: string[] = []): string {
  const [vendor = "", model = "", effort = "", speed = ""] = value === "" ? [] : value.split(":");
  const known = (VENDORS as string[]).includes(vendor);
  const offered = (VENDORS as string[]).filter((v) => vendors.includes(v));
  const labels = known ? Pick.models([vendor as Vendor], models).map(([, m]) => m.label) : [];
  const speeds = known ? Pick.model(vendor as Vendor, model)?.speeds ?? [] : [];
  const select = (part: string, name: string, all: string[], on: string, first: string | null) => {
    const opts: Array<[string, string]> = [...(first === null ? [] : [["", first] as [string, string]]), ...(all.includes(on) || (on === "" && first !== null) ? [] : [[on, on + " (not offered)"] as [string, string]]), ...all.map((x): [string, string] => [x, x])];
    const items = opts.map(([v, text]) => `<option value="${esc(v)}"${v === on ? " selected" : ""}>${esc(text)}</option>`).join("");
    return `<select id="set-${key}-${part}" name="${key}.${part}" aria-label="${name}">${items}</select>`;
  };
  const head = select("vendor", "Vendor", [...offered, ...profiles], vendor, none);
  return vendor === "" || profiles.includes(vendor) ? head : head + select("model", "Model", labels, model, null) + select("effort", "Effort", EFFORTS, effort, null) + select("speed", "Speed", speeds, speed, null);
}

// a pick of its four parts as chosen: a model its vendor lacks gives way
// to the vendor's first checked, a speed the model lacks to its first, no
// effort to medium; no vendor: none (""); a profile (`profiles`): its name
export function pick_mend(parts: string[], models: string[], profiles: string[] = []): string {
  const [vendor = "", model = "", effort = "", speed = ""] = parts;
  if (profiles.includes(vendor)) {
    return vendor;
  }
  if (!(VENDORS as string[]).includes(vendor)) {
    return vendor === "" ? "" : parts.join(":");
  }
  const m = Pick.model(vendor as Vendor, model) ?? Pick.models([vendor as Vendor], models)[0]?.[1];
  if (m === undefined) {
    return parts.join(":");
  }
  return [vendor, m.label, effort || "medium", m.speeds.includes(speed) ? speed : m.speeds[0]].join(":");
}

// a section of the settings page: its title, then its markup
function section_html(title: string, body: string): string {
  return `<section><h2>${esc(title)}</h2>${body}</section>`;
}

export function block_html(b: Md.Block): string {
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

// a list item's blocks; in a tight list its paragraphs bare (lines, not
// paragraphs spaced apart)
function item_html(blocks: Md.Block[], tight: boolean): string {
  return blocks.map((b) => (tight && b.$ === "Para" ? b.x.map(spans_html).join("<br>") : block_html(b))).join("");
}

// a diff: its file and its lines added and dropped over its lines, each
// its number, its mark and its text (style.css hangs a wrap after the
// number); a ⋯ between hunks
function diff_html(file: string, hunks: Md.Line[][]): string {
  const all   = hunks.flat();
  const nw    = all.reduce((w, l) => Math.max(w, String(l.n).length), 0);
  const adds  = all.filter((l) => l.s === "+").length;
  const dels  = all.filter((l) => l.s === "-").length;
  const head  = `<span class="lang">${esc(file)} <b class="add">+${adds}</b> <b class="del">-${dels}</b></span>`;
  const line  = (l: Md.Line) => `<span class="${MARKS[l.s]}"><i>${l.n}</i>${l.s} ${esc(l.x)}</span>`;
  const lines = hunks.map((h) => h.map(line).join("")).join(`<span class="gap">⋯</span>`);
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${lines}</code></pre>`;
}

// a read's lines: framed as a diff is, the lines shown over them, each
// its number and its text
function file_html(shown: string, from: number, lines: string[]): string {
  const nw   = String(from + lines.length - 1).length;
  const head = `<span class="lang">${esc(shown)}</span>`;
  const body = lines.map((x, k) => `<span class="file"><i>${from + k}</i>${esc(x)}</span>`).join("");
  return `<pre class="diff" style="--nw:${nw}ch">${head}<code>${body}</code></pre>`;
}

function spans_html(spans: Md.Span[]): string {
  return spans.map(span_html).join("");
}

function span_html(s: Md.Span): string {
  switch (s.$) {
    case "Text": { // the name, in the brand's font
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
      const label = View.agent_label(s.x);
      const shown = label === undefined ? esc(s.x) : `${esc(label)} <small>${esc(s.x)}</small>`;
      return `<button class="name" title="${esc(s.x)}"${act_html({ $: "Goto", name: s.x })}>[${shown}]</button>`;
    }
  }
}

// The pipeline's panel (R6)
// =========================
// The page /pipeline (main.ts pipeline): each front (a task's ref) where
// it is and since when, its cycles of verification, the notes still
// open, its PRs live, and its metrics (Pipeline.ts reads them; View.ts
// says them). panel null: not read (why says so); refreshing: PRs are
// being read, the page asks again; opened: the fronts shown open (null:
// those with the user or stalled, as the page opens)

export function pipeline_html(panel: Pipeline.Panel | null, now = Date.now(), why = "", opened: Set<string> | null = null): string {
  const head = `<a class="back" href="/" data-go="/">← Voltar</a><h1>Pipeline</h1>`;
  if (panel === null) {
    return head + `<p class="pipe-none">${esc(why || "Não foi possível ler o painel.")}</p><button type="button" class="chip pipe-reload">Tentar de novo</button>`;
  }
  const t = View.pipeline_totals(panel.fronts);
  const card = (n: string, what: string, note = "") => `<div class="pipe-total"><b>${esc(n)}</b><span>${esc(what)}</span>${note === "" ? "" : `<small>${esc(note)}</small>`}</div>`;
  const totals = `<section class="pipe-totals" aria-label="Resumo">`
    + card(String(t.active), t.active === 1 ? "frente ativa" : "frentes ativas")
    + card(String(t.user), "com você")
    + card(String(t.stalled), t.stalled === 1 ? "parada com o Unii" : "paradas com o Unii")
    + card(t.cycles === null ? "—" : num_said(t.cycles), "ciclos por PR", "mediana")
    + card(t.decide === null ? "—" : View.took_said(t.decide), "até a sua decisão", t.decided === 0 ? "nenhuma decisão registrada" : "mediana de " + t.decided + (t.decided === 1 ? " decisão" : " decisões"))
    + card(View.span_said(t.idle), "tempo parado", "frentes ativas, sem agente e sem você")
    + `</section>`;
  const read = `<p class="pipe-read">Lido às ${esc(View.when_said(panel.at).slice(6))}${panel.refreshing ? " · lendo o estado dos PRs no GitHub…" : ""} · <button type="button" class="link pipe-reload">Atualizar</button></p>`;
  const active = panel.fronts.filter((f) => f.stage !== "closed");
  const closed = panel.fronts.filter((f) => f.stage === "closed");
  const list = active.length === 0 ? `<p class="pipe-none">Nenhuma frente ativa.</p>` : `<ol class="pipe-fronts">${active.map((f) => `<li>${front_html(f, now, opened === null ? f.stage === "user" || f.stage === "stalled" : opened.has(f.ref))}</li>`).join("")}</ol>`;
  const old = closed.length === 0 ? "" : `<details class="pipe-closed"><summary>Encerradas (${closed.length})</summary><ol class="pipe-fronts">${closed.map((f) => `<li>${front_html(f, now, opened !== null && opened.has(f.ref))}</li>`).join("")}</ol></details>`;
  return head + read + totals + list + old;
}

// a number said in pt-BR: "2", "2,5"
function num_said(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(".", ",");
}

// a front: its summary (ref, stage and since when, cycles, notes open),
// then its tasks open, PRs, cycles and metrics
function front_html(f: Pipeline.Front, now: number, open: boolean): string {
  const since = View.span_said(now - Date.parse(f.since));
  const notes = f.stage === "closed" ? "" : f.fixing ? " · ressalvas em correção" : " · ressalvas abertas: " + View.sevs_said(f.open);
  const sum = `<summary><b class="pipe-ref">${esc(f.ref)}</b> <span class="pipe-stage ${f.stage}">${esc(View.STAGE_SAID[f.stage])}</span> <span class="pipe-meta">${f.stage === "closed" ? "desde " + esc(View.when_said(f.since)) : "há " + esc(since)} · ${f.cycles.length} ${f.cycles.length === 1 ? "ciclo" : "ciclos"}${esc(notes)}</span></summary>`;
  const tasks = f.tasks.length === 0 ? "" : `<h3>Pendências abertas</h3><ul class="pipe-tasks">${f.tasks.map((t) => `<li><button type="button" class="link" data-desk="${esc(t.id)}">${esc(t.id)}</button> <span class="pipe-who">${t.assignee === "user" ? "sua" : "do Unii"}</span> ${esc(t.title)}</li>`).join("")}</ul>`;
  const working = f.runs.filter((r) => r.state === "working");
  const now_ = working.length === 0 ? "" : `<h3>Agentes trabalhando</h3><ul class="pipe-runs">${working.map((r) => `<li>${run_html(r)} · desde ${esc(View.when_said(r.start))}</li>`).join("")}</ul>`;
  const prs = f.prs.length === 0 ? "" : `<h3>PRs</h3><ul class="pipe-prs">${f.prs.map(pr_html).join("")}</ul>`;
  const cycles = f.cycles.length === 0 ? `<p class="pipe-none">Nenhuma verificação registrada.</p>` : `<h3>Ciclos de verificação</h3><ol class="pipe-cycles">${f.cycles.map((c) => cycle_html(c)).join("")}</ol>`;
  const decide = f.decide.length === 0 ? "nenhuma decisão sua registrada" : "mediana " + View.took_said(View.median_of(f.decide)!) + ", máximo " + View.took_said(Math.max(...f.decide)) + " (" + f.decide.length + (f.decide.length === 1 ? " decisão" : " decisões") + ")";
  const verified = f.prs.filter((p) => p.cycles > 0);
  const per = verified.length === 0 ? "nenhum PR verificado" : verified.map((p) => p.key + ": " + p.cycles).join(" · ");
  const metrics = `<h3>Métricas</h3><dl class="pipe-metrics"><dt>Tempo parado</dt><dd>${esc(View.span_said(f.idle))} <small>sem agente trabalhando e sem pendência sua, desde ${esc(View.when_said(f.first))}</small></dd><dt>Até a sua decisão</dt><dd>${esc(decide)}</dd><dt>Ciclos por PR</dt><dd>${esc(per)}</dd></dl>`;
  return `<details class="pipe-front" data-ref="${esc(f.ref)}"${open ? " open" : ""}>${sum}<div class="pipe-body">${tasks}${now_}${prs}${cycles}${metrics}</div></details>`;
}

// an agent's run: its name, and its label after it
function run_html(r: Pipeline.Run): string {
  return `<span class="pipe-agent">${esc(r.name)}</span>${r.label === null ? "" : ` <small class="pipe-label">${esc(r.label)}</small>`}`;
}

// a PR: its link (or key), state and checks live, the head verified
// against the head now, cycles and last verdict
function pr_html(p: Pipeline.FrontPr): string {
  const name = p.url === null ? `<span class="pipe-pr">${esc(p.key)}</span>` : `<a class="pipe-pr" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.key)}</a>`;
  const live = p.live === null ? `<span class="pipe-tag">${p.url === null ? "sem link: estado desconhecido" : "estado não lido"}</span>`
    : `<span class="pipe-tag ${p.live.state.toLowerCase()}">${esc(View.PR_STATE_SAID[p.live.state])}</span>` + (p.live.state === "OPEN" ? ` <span class="pipe-tag ci-${p.live.ci}">${esc(View.CI_SAID[p.live.ci])}</span>` : "");
  const head = View.pr_head_said(p);
  const said = head === null ? (p.head === null ? "" : ` · verificado em ${esc(p.head.slice(0, 7))}`) : ` · <span class="${head.same ? "" : "pipe-warn"}">${esc(head.text)}</span>`;
  const verdict = p.verdict === null ? "" : ` · ${esc(View.VERDICT_SAID[p.verdict])}`;
  return `<li>${name} ${live}${said} · ${p.cycles} ${p.cycles === 1 ? "ciclo" : "ciclos"}${verdict}</li>`;
}

// a cycle: its number, when, the verifier, verdict and notes, the PRs
// it checked at their heads, the work it checked
function cycle_html(c: Pipeline.Cycle): string {
  const r = c.run;
  const verdict = r.state === "working" ? "verificando" : r.state === "cut" ? "interrompida sem veredito" : r.verdict === null ? "veredito não lido do relato" : View.VERDICT_SAID[r.verdict];
  const notes = r.verdict === null || r.verdict === "approved" ? "" : r.noted ? " · ressalvas: " + View.sevs_said(r.notes) : " · ressalvas sem gravidade no relato";
  const prs = r.prs.length === 0 ? "" : ` · ${esc(r.prs.map((k) => k + (r.heads[k] === undefined ? "" : " em " + r.heads[k].slice(0, 7))).join(", "))}`;
  const work = c.after.length === 0 ? "" : `<small class="pipe-work">verificou o trabalho de ${c.after.map((w) => esc(w.name) + (w.label === null ? "" : " (" + esc(w.label) + ")")).join(", ")}</small>`;
  const dur = r.state === "working" ? "" : " · " + View.took_said(Date.parse(r.end) - Date.parse(r.start));
  const cls = r.verdict === "rejected" ? "rejected" : r.verdict === "approved_with_notes" ? "notes" : r.verdict === "approved" ? "approved" : "";
  return `<li class="${cls}"><span class="pipe-n">Ciclo ${c.n}</span> ${esc(View.when_said(r.start))}${esc(dur)} · ${run_html(r)} · <b class="pipe-verdict">${esc(verdict)}</b>${esc(notes)}${prs}${work}</li>`;
}
