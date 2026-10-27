// Cursor.test
// ===========
// The cursor vendor (Cursor.ts) on a fake Cursor CLI: a shell script that
// answers as the real one does (stream-json lines; "Error: [code] ..."
// and exit 1), told what to do by its message (MODE:...). Runs with the
// sandbox off, and in bwrap where it is installed.

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Cursor, MIDWAY } from "./Cursor.ts";
import { Agent } from "./Agent.ts";
import { AskAI, type Ask, type Event } from "./AskAI.ts";
import { Pick } from "./Pick.ts";
import * as config from "./Config.ts";

const ROOT = fs.mkdtempSync("/tmp/unii-cursor-test-");
const BIN = path.join(ROOT, "bin", "cursor-agent");

const FAKE = String.raw`#!/bin/bash
# a fake Cursor CLI: what it does is in its message (stdin)
msg=$(cat)
sid="sess-1"
resume=""
model=""
while [ $# -gt 0 ]; do
  case "$1" in
    --resume) resume="$2"; shift ;;
    --model) model="$2"; shift ;;
  esac
  shift
done
j() { printf '%s\n' "$1"; }
init() { j '{"type":"system","subtype":"init","session_id":"'$sid'","model":"fake"}'; }
say() { j '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"'"$1"'"}]},"session_id":"'$sid'","timestamp_ms":1}'; j '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"'"$1"'"}]},"session_id":"'$sid'"}'; }
done_() { j '{"type":"result","subtype":"success","is_error":false,"result":"'"$1"'","session_id":"'$sid'","usage":{"inputTokens":3,"outputTokens":5,"cacheReadTokens":7,"cacheWriteTokens":11}}'; }
if [ -n "$resume" ]; then
  init
  text=$(printf '%s' "$msg" | tr -d '\n"' | cut -c1-600)
  # silent again on its session, once asked to go on (MODE:silentagain)
  if [ -f "$PWD/silentagain" ]; then init; sleep 30; exit 0; fi
  say "RESUMED $resume: $text"; done_ "RESUMED $resume: $text"; exit 0
fi
case "$msg" in
  *MODE:ok*)
    init
    j '{"type":"thinking","subtype":"delta","text":"pensando","session_id":"'$sid'"}'
    j '{"type":"thinking","subtype":"completed","session_id":"'$sid'"}'
    say "ola"; done_ "ola $model" ;;
  *MODE:tool*)
    init
    j '{"type":"tool_call","subtype":"started","call_id":"g1","tool_call":{"getMcpToolsToolCall":{"args":{"server":"unii","toolName":"shell"}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"completed","call_id":"g1","tool_call":{"getMcpToolsToolCall":{"args":{"server":"unii","toolName":"shell"},"result":{"success":{"content":"{}"}}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"started","call_id":"t1","tool_call":{"mcpToolCall":{"args":{"name":"unii-shell","args":{"device":"d","command":"ls"},"providerIdentifier":"unii","toolName":"shell"}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"completed","call_id":"t1","tool_call":{"mcpToolCall":{"args":{"name":"unii-shell","args":{"device":"d","command":"ls"},"providerIdentifier":"unii","toolName":"shell"},"result":{"success":{"content":[{"text":{"text":"a.txt"}}],"isError":false}}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"started","call_id":"t2","tool_call":{"readToolCall":{"args":{"path":"/etc/x"}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"completed","call_id":"t2","tool_call":{"readToolCall":{"args":{"path":"/etc/x"},"result":{"error":{"errorMessage":"Permission denied"}}}},"session_id":"'$sid'"}'
    say "feito"; done_ "feito" ;;
  *MODE:limitsoon*)
    # its mark in the call's workspace (its cwd, removed as the call ends)
    if [ -f "$PWD/once" ]; then init; say "depois"; done_ "depois"; exit 0; fi
    touch "$PWD/once"
    echo "Error: [resource_exhausted] You've hit your usage limit. Try again in 1 second." ; exit 1 ;;
  *MODE:limitacted*)
    init
    j '{"type":"tool_call","subtype":"started","call_id":"t1","tool_call":{"mcpToolCall":{"args":{"args":{},"providerIdentifier":"unii","toolName":"shell"}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"completed","call_id":"t1","tool_call":{"mcpToolCall":{"args":{"args":{},"providerIdentifier":"unii","toolName":"shell"},"result":{"success":{"content":[{"text":{"text":"ok"}}]}}}},"session_id":"'$sid'"}'
    echo "Error: [resource_exhausted] You've hit your usage limit. Try again in 1 second." >&2; exit 1 ;;
  *MODE:limit*)
    echo "Error: [resource_exhausted] You've hit your usage limit for Claude models. Resets at 2099-01-01 05:00 UTC"; exit 1 ;;
  *MODE:unsigned*)
    echo "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable." >&2; exit 1 ;;
  *MODE:nomodel*)
    echo "Cannot use this model: x. Available models: auto"; exit 1 ;;
  *MODE:busy*)
    echo "Error: [internal_error] something broke"; exit 1 ;;
  *MODE:silentfirst*)
    sleep 30 ;;
  *MODE:silentagain*)
    touch "$PWD/silentagain"; init; say "comecei"; sleep 30 ;;
  *MODE:argv*)
    init
    a=$(printf '%s ' "$0" "$@" | tr -d '"')
    k=$([ -n "$CURSOR_API_KEY" ] && echo "env:$CURSOR_API_KEY" || echo "env:none")
    say "argv"; done_ "ARGV=$a|KEY=$k" ;;
  *MODE:umask*)
    init
    printf '{}' > "$CURSOR_CONFIG_DIR/rewritten.json"
    m=$(stat -c %a "$CURSOR_CONFIG_DIR/rewritten.json")
    say "umask"; done_ "MODE=$m|UMASK=$(umask)" ;;
  *MODE:jail*)
    init
    ru=$(ls -A /run/user 2>/dev/null | tr '\n' ' ')
    r=$(ls -A /run 2>/dev/null | tr '\n' ' ')
    vl=$(ls -A /var/lib 2>/dev/null | tr '\n' ' ')
    lb=$(ls -A "$HOME/.local/bin" 2>/dev/null | tr '\n' ' ')
    dk=$([ -e /run/docker.sock ] || [ -e /var/run/docker.sock ] && echo seen || echo unseen)
    dns=$([ -r /etc/resolv.conf ] && echo readable || echo unreadable)
    say "jail"; done_ "RUNUSER=[$ru]|RUN=[$r]|VARLIB=[$vl]|LOCALBIN=[$lb]|DOCKER=$dk|DNS=$dns" ;;
  *MODE:silent*)
    init; say "comecei"; sleep 30 ;;
  *MODE:partial*)
    init
    j '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"meia resposta"}]},"session_id":"'$sid'","timestamp_ms":1}'
    sleep 30 ;;
  *MODE:slowtool*)
    init
    j '{"type":"tool_call","subtype":"started","call_id":"t1","tool_call":{"mcpToolCall":{"args":{"args":{},"providerIdentifier":"unii","toolName":"shell"}}},"session_id":"'$sid'"}'
    sleep 2
    j '{"type":"tool_call","subtype":"completed","call_id":"t1","tool_call":{"mcpToolCall":{"args":{"args":{},"providerIdentifier":"unii","toolName":"shell"},"result":{"success":{"content":[{"text":{"text":"ok"}}]}}}},"session_id":"'$sid'"}'
    say "fim"; done_ "fim" ;;
  *MODE:env*)
    init
    names=$(env | cut -d= -f1 | sort | tr '\n' ' ')
    home=$(ls -A "$HOME" 2>/dev/null | tr '\n' ' ')
    rules=$(cat .cursor/rules/unii.mdc | tail -n 1)
    mcp=$(cat .cursor/mcp.json)
    perm=$(cat "$CURSOR_CONFIG_DIR/cli-config.json" | tr -d '\n ')
    up=$(ls /home 2>/dev/null | head -c 0; [ -e "$UNII_SECRET_PROBE" ] && echo seen || echo unseen)
    printf '%s\n' "ENV $names" "HOME [$home]" "RULE $rules" "MCP $mcp" "PERM $perm" "PROMPT $msg" > "$PWD/../env.txt"
    cp "$PWD/../env.txt" /dev/null
    say "env"; done_ "$(printf '%s' "$names" | tr -d '"')|HOME=[$home]|RULE=$rules|PWD=$PWD" ;;
  *MODE:die*)
    exit 3 ;;
  *)
    init; say "?"; done_ "?" ;;
esac
`;

const BASE: Ask = { vendor: "cursor", model: "claude-sonnet-5-5", effort: "high", speed: "slow", system: "SISTEMA-X", blocks: [{ text: "", mark: false }], searches: 0, server: "http://127.0.0.1:1/mcp/SEGREDO" };

function ask(text: string, more: Partial<Ask> = {}): Ask {
  return { ...BASE, blocks: [{ text: "contexto", mark: true }, { text, mark: false }], ...more };
}

// a call run to its end: its End and the events it told
async function call(a: Ask, during?: (t: ReturnType<typeof Cursor.ask>) => void) {
  const evs: Event[] = [];
  const t = Cursor.ask(a, (ev) => evs.push(ev));
  during?.(t);
  const end = await t.done;
  return { end, evs };
}

const has_bwrap = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"].some((f) => fs.existsSync(f));

// a /run of its own, faked (unshare -Urm: a user and mount namespace, a
// tmpfs on /run), to run bwrap in as on a system whose resolv.conf is
// right in /run; why it can't here, if it can't (the test then skipped,
// saying so)
const NEST_SKIP = !has_bwrap
  ? "sem bwrap instalado"
  : Bun.spawnSync(["unshare", "-Urm", "sh", "-c", "mount -t tmpfs tmpfs /run"]).exitCode !== 0
    ? "unshare -Urm (namespace de usuário e de montagem) indisponível aqui"
    : "";
if (NEST_SKIP !== "") {
  console.warn("Cursor.test: o teste do resolv.conf direto em /run foi pulado: " + NEST_SKIP);
}

beforeAll(() => {
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  fs.writeFileSync(BIN, FAKE, { mode: 0o755 });
});

afterAll(() => {
  Cursor.set({ bin: "", sandbox: "bwrap", first: 300e3, idle: 600e3, grace: 5e3 });
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  Cursor.set({ bin: BIN, sandbox: "off", first: 300e3, idle: 600e3, grace: 500, resolved: null });
  Cursor.forget();
});

describe("Pick", () => {
  test("cursor is a vendor with Claude's twins and its own models", () => {
    expect(Pick.model("cursor", "opus-5.5")?.id).toBe("claude-opus-5-5");
    expect(Pick.model("cursor", "sonnet-5.5")?.speeds).toEqual(["slow"]);
    expect(Pick.model("cursor", "grok-4.7")?.speeds).toEqual(["slow", "fast"]);
    expect(Pick.twin("cursor", "sonnet-5.5", ["claude-sub", "cursor"])).toBe(true);
  });

  test("a spawn's model may name its vendor: cursor:sonnet-5.5", () => {
    const offer = { vendors: ["claude-sub", "cursor"] as any, models: ["opus-5.5", "sonnet-5.5"] };
    const base = { vendor: "claude-sub" as const, model: "opus-5.5", effort: "high", speed: "slow" };
    expect(Pick.to_model(base, "sonnet-5.5", offer.vendors, offer)?.vendor).toBe("claude-sub");
    expect(Pick.to_model(base, "cursor:sonnet-5.5", offer.vendors, offer)).toEqual({ vendor: "cursor", model: "sonnet-5.5", effort: "high", speed: "slow" });
    expect(Pick.to_model(base, "cursor:haiku-5.5", offer.vendors, offer)).toBeNull();
    expect(Pick.names(offer.vendors, offer.models)).toEqual(["opus-5.5", "sonnet-5.5", "claude-sub:opus-5.5", "claude-sub:sonnet-5.5", "cursor:opus-5.5", "cursor:sonnet-5.5"]);
  });

  test("a pick on cursor reads and moves as the others do", () => {
    const offer = { vendors: ["claude-api", "cursor"] as any, models: ["opus-5.5", "grok-4.7"] };
    const pick = Pick.read({ vendor: "cursor", model: "grok-4.7", effort: "max", speed: "fast" }, offer);
    expect(pick).toEqual({ vendor: "cursor", model: "grok-4.7", effort: "max", speed: "fast" });
    expect(Pick.move(pick!, "model", offer, "cursor:opus-5.5")).toEqual({ vendor: "cursor", model: "opus-5.5", effort: "max", speed: "fast" });
    expect(Pick.ask(pick!).model).toBe("grok-4.7");
    expect(Pick.named({ ...pick!, model: "grok-4.7" }).model).toBe("grok-4.7");
  });
});

describe("Cursor.variant", () => {
  test("the CLI's model at an effort and speed", () => {
    expect(Cursor.variant("claude-opus-5-5", "xhigh", "fast")).toBe("claude-opus-5-5-xhigh-fast");
    expect(Cursor.variant("claude-opus-5-5", "low", "slow")).toBe("claude-opus-5-5-low");
    expect(Cursor.variant("claude-sonnet-5-5", "max", "fast")).toBe("claude-sonnet-5-5-max");
    expect(Cursor.variant("claude-haiku-5-5", "medium", "slow")).toBe("claude-haiku-5-5-thinking-medium");
    expect(Cursor.variant("grok-4.7", "max", "slow")).toBe("grok-4.7-xhigh");
    expect(Cursor.variant("composer-2.5", "high", "fast")).toBe("composer-2.5-fast");
    expect(Cursor.variant("outro", "high", "slow")).toBe("outro");
  });

  test("a reset as its message tells it", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(Cursor.reset("Resets at 2026-10-27 05:00 UTC", now)).toBe(Date.parse("2026-10-27T05:00:00Z"));
    expect(Cursor.reset("Try again in 3 hours.", now)).toBe(now + 3 * 3600e3);
    expect(Cursor.reset("try again in 90 seconds", now)).toBe(now + 90e3);
    expect(Cursor.reset("Resets at 2020-01-01 00:00 UTC", now)).toBeNull();
    expect(Cursor.reset("no time here", now)).toBeNull();
  });

  test("failures: a limit, a sign-in, every call's, this one's", () => {
    expect(Cursor.failure("Error: [resource_exhausted] slow down").limit).toBeDefined();
    expect(Cursor.failure("Error: Authentication required. Please run 'agent login' first").text).toContain("unii serve cursor");
    expect(Cursor.failure("\x1b[33m⚠ Warning: The provided API key is invalid.\x1b[0m").text).toContain("não está autenticado");
    expect(Cursor.failure("Cannot use this model: x").off).toBe(true);
    const busy = Cursor.failure("Error: [internal_error] boom");
    expect([busy.stop, busy.off]).toEqual(["down", false]);
  });

  // what failure() logs to the operator (console.error), each line it printed
  const logged = (f: () => void): string[] => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      f();
      return spy.mock.calls.map((c) => c.map(String).join(" "));
    } finally {
      spy.mockRestore();
    }
  };

  test("a failure with no words: said in Portuguese, logged as one", () => {
    let got: ReturnType<typeof Cursor.failure> | undefined;
    const lines = logged(() => (got = Cursor.failure("  \x1b[0m \n")));
    expect(got!.stop).toBe("down");
    expect(lines).toEqual(["cursor: falha: o Cursor CLI terminou sem responder"]);
  });

  test("a failure's log clipped never between a surrogate pair's halves: an emoji at char 300", () => {
    const odd = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
    // the emoji's high half is code unit 300 (index 299): a plain slice(0, 300) would split it
    const why = "x".repeat(299) + "😀" + "y".repeat(50);
    expect(odd(why.slice(0, 300))).toBe(true);
    const lines = logged(() => Cursor.failure(why));
    expect(lines.length).toBe(1);
    expect(odd(lines[0])).toBe(false);
    expect(lines[0]).toBe("cursor: falha: " + "x".repeat(299) + "…");
    // an emoji wholly inside the limit kept
    const kept = logged(() => Cursor.failure("x".repeat(298) + "😀" + "y".repeat(50)));
    expect(kept[0]).toBe("cursor: falha: " + "x".repeat(298) + "😀…");
  });

  test("the operator's log lines in Portuguese: a silence stopped, what the runs spent", () => {
    expect(Cursor.quiet("claude-opus-5-5-high", 240e3)).toBe("cursor: claude-opus-5-5-high: nenhuma palavra em 240 s: interrompido");
    expect(Cursor.spent("m", { runs: 1, input: 3, output: 5, read: 7, write: 11 })).toBe("cursor: m: 1 execução; tokens: entrada 3, saída 5, cache lido 7, cache gravado 11");
    expect(Cursor.spent("m", { runs: 2, input: 6, output: 10, read: 14, write: 22 })).toBe("cursor: m: 2 execuções; tokens: entrada 6, saída 10, cache lido 14, cache gravado 22");
  });
});

describe("a call", () => {
  test("a turn: thoughts, a reply, logged; its model at the pick's effort", async () => {
    const { end, evs } = await call(ask("MODE:ok", { model: "claude-opus-5-5", effort: "xhigh", speed: "fast" }));
    expect(end.ok).toBe(true);
    expect(end.text).toBe("ola claude-opus-5-5-xhigh-fast");
    expect(evs.filter((e) => e.$ === "Entry").map((e: any) => e.kind + ":" + e.text)).toEqual(["mind:pensando", "unii:ola"]);
    expect(evs.some((e) => e.$ === "Delta" && e.kind === "unii" && e.text === "ola")).toBe(true);
    expect(end.acted).toBe(false);
  });

  test("a tool of ours logged as Claude Code names it, its result; ours marks it acted, the CLI's own doesn't; its schema lookups unlogged", async () => {
    const { end, evs } = await call(ask("MODE:tool"));
    expect(end.ok).toBe(true);
    const entries = evs.filter((e) => e.$ === "Entry") as any[];
    expect(entries.some((e) => /getMcpTools/.test(e.text) || e.of === "g1")).toBe(false);
    expect(entries.slice(0, 4).map((e) => [e.kind, e.text, e.of])).toEqual([
      ["tool", 'mcp__unii__shell {"device":"d","command":"ls"}', "t1"],
      ["echo", "a.txt", "t1"],
      ["tool", "read /etc/x", "t2"],
      ["echo", "error: Permission denied", "t2"],
    ]);
    expect(end.acted).toBe(true);
  });

  test("the call's dir: our prompt as a rule, our MCP server, the CLI's tools denied; removed as it ends", async () => {
    const { end } = await call(ask("MODE:env", { searches: 3 }));
    expect(end.ok).toBe(true);
    expect(end.text).toContain("RULE=SISTEMA-X");
    expect(end.text).toContain("CURSOR_CONFIG_DIR");
    expect(end.text).not.toContain("UNII_DIR");
    expect(end.text).toContain("HOME=[]");
    const runs = path.join(config.CURSOR_SUB, "runs");
    expect(fs.readdirSync(runs)).toEqual([]);
  });

  test("not signed in: ends as one its vendor can't be asked for (no stop), saying how", async () => {
    const { end } = await call(ask("MODE:unsigned"));
    expect(end.ok).toBe(false);
    expect(end.stop).toBeUndefined();
    expect(end.text).toContain("unii serve cursor");
  });

  test("no such model: every call's (off), so a fallback goes on", async () => {
    const { end } = await call(ask("MODE:nomodel"));
    expect([end.ok, end.stop, end.off]).toEqual([false, "down", true]);
  });

  test("an error of its own: the vendor's, not off", async () => {
    const { end } = await call(ask("MODE:busy"));
    expect([end.ok, end.stop, end.off]).toEqual([false, "down", false]);
  });

  test("a CLI gone without a word is asked once more, then fails", async () => {
    const { end } = await call(ask("MODE:die"));
    expect(end.ok).toBe(false);
    expect(end.text).toContain("o Cursor CLI terminou sem responder (código de saída 3)");
  });

  test("a CLI that can't be spawned: said in Portuguese, with why", async () => {
    const used = { input: 0, output: 0, read: 0, write: 0 };
    const cmd = { file: path.join(ROOT, "nao-existe"), args: [], env: {}, cwd: ROOT };
    const end = await Cursor.turn(cmd, "oi", () => {}, () => {}, new AbortController().signal, { v: false }, () => {}, used);
    expect(end?.text).toStartWith("o Cursor CLI não foi encontrado ou não pôde ser executado: ");
    expect(end?.text).toContain("ENOENT");
  });

  test("a CLI the shell can't run (exit 127, as /bin/sh -c exec runs it; 126 not executable): not found, in Portuguese, not retried", async () => {
    const used = { input: 0, output: 0, read: 0, write: 0 };
    const turn = (file: string) => Cursor.turn(Cursor.umasked({ file, args: [], env: {}, cwd: ROOT }), "oi", () => {}, () => {}, new AbortController().signal, { v: false }, () => {}, used);
    const gone = await turn(path.join(ROOT, "nao-existe"));
    expect(gone?.text).toStartWith("o Cursor CLI não foi encontrado ou não pôde ser executado (código de saída 127): ");
    expect(gone?.died).toBeUndefined();
    const plain = path.join(ROOT, "sem-x");
    fs.writeFileSync(plain, "", { mode: 0o644 });
    expect((await turn(plain))?.text).toStartWith("o Cursor CLI não foi encontrado ou não pôde ser executado (código de saída 126)");
    // a whole call: an installed launcher whose interpreter is gone
    const broken = path.join(ROOT, "bin", "quebrado");
    fs.writeFileSync(broken, "#!/nao/existe/node\n", { mode: 0o755 });
    Cursor.set({ bin: broken });
    const { end } = await call(ask("MODE:ok"));
    expect(end.ok).toBe(false);
    expect(end.stop).toBeUndefined();
    // (bash says 126, "bad interpreter"; other shells, 127)
    expect(end.text).toMatch(/^o Cursor CLI não foi encontrado ou não pôde ser executado \(código de saída 12[67]\): /);
  });

  test("a long usage limit with a fallback and no tool run ends (off) for it, naming the reset", async () => {
    const { end } = await call(ask("MODE:limit", { fallback: true }));
    expect([end.ok, end.stop, end.off, end.acted]).toEqual([false, "down", true, false]);
    expect(end.text).toContain("usage limit on cursor");
    expect(end.until).toBe(Date.parse("2099-01-01T05:00:00Z"));
    expect(Agent.under(["cursor claude-sonnet-5-5"], false)).toBe(Date.parse("2099-01-01T05:00:00Z"));
    // another model's calls aren't held by it
    expect(Agent.under(["cursor claude-opus-5-5"], false)).toBeNull();
  });

  test("under a limit remembered, a call with a fallback ends before asking", async () => {
    Agent.note("cursor claude-sonnet-5-5", Date.now() + 3600e3);
    const { end } = await call(ask("MODE:ok", { fallback: true }));
    expect([end.ok, end.off]).toEqual([false, true]);
    expect(end.text).toContain("usage limit on cursor");
  });

  test("a short usage limit is waited out, then asked anew", async () => {
    const { end, evs } = await call(ask("MODE:limitsoon"));
    expect(end.ok).toBe(true);
    expect(end.text).toBe("depois");
    expect(evs.some((e) => e.$ === "Entry" && e.kind === "mind" && /busy/.test(e.text))).toBe(true);
  });

  test("a usage limit after a tool of ours: its session resumed at the reset, told to go on", async () => {
    const { end } = await call(ask("MODE:limitacted"));
    expect(end.ok).toBe(true);
    expect(end.text).toContain("RESUMED sess-1: (The AI service's usage limit cut your last step short");
    expect(end.acted).toBe(true);
  });

  test("a message sent mid-run goes in as the session resumed", async () => {
    const { end, evs } = await call(ask("MODE:slowtool"), (t) => setTimeout(() => t.send({ text: "mais uma coisa", imgs: [] }), 300));
    expect(end.ok).toBe(true);
    // its end: the first reply, then the resumed one, told not to repeat it
    expect(end.text).toBe("fim\n\nRESUMED sess-1: " + MIDWAY.replace(/"/g, "") + "mais uma coisa");
    expect(evs.some((e) => e.$ === "Entry" && e.kind === "user" && e.text === "mais uma coisa")).toBe(true);
    // the first reply logged once
    expect(evs.filter((e) => e.$ === "Entry" && e.kind === "unii" && e.text === "fim").length).toBe(1);
    expect(end.left).toEqual([]);
  });

  test("silent again after its resume: the call ends (off), resumed once only", async () => {
    Cursor.set({ bin: BIN, sandbox: "off", first: 400, idle: 400, grace: 200 });
    const { end, evs } = await call(ask("MODE:silentagain"));
    expect([end.ok, end.stop, end.off]).toEqual([false, "down", true]);
    expect(end.text).toBe("o serviço de IA está ocupado ou indisponível no momento: o Cursor CLI ficou em silêncio e foi interrompido");
    expect(evs.filter((e) => e.$ === "Entry" && e.kind === "mind" && e.text === "O serviço de IA ficou em silêncio: vou pedir que continue.").length).toBe(1);
  }, 10000);

  test("a short usage limit's mark is the call's: none left in the repo's folder", async () => {
    await call(ask("MODE:limitsoon"));
    expect(fs.existsSync(path.join(import.meta.dir, "once"))).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), "once"))).toBe(false);
  });

  test("a stop ends the call at once, its CLI killed, its dir removed", async () => {
    const t0 = Date.now();
    const { end, evs } = await call(ask("MODE:silent"), (t) => setTimeout(() => t.stop(), 500));
    expect(end.ok).toBe(false);
    expect(end.text).toBe("interrompido");
    expect(evs.some((e) => e.$ === "Entry" && /stopped|cut off/.test((e as any).text))).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(fs.readdirSync(path.join(config.CURSOR_SUB, "runs"))).toEqual([]);
  });

  test("a stop mid-reply: what it had shown logged, marked as cut short in Portuguese", async () => {
    const { end, evs } = await call(ask("MODE:partial"), (t) => setTimeout(() => t.stop(), 500));
    expect(end.text).toBe("interrompido");
    expect(evs.filter((e) => e.$ === "Entry").map((e: any) => e.kind + ":" + e.text)).toEqual(["unii:meia resposta\n[interrompido]"]);
  });

  test("silent past its idle with no tool running: stopped, resumed once, then the call ends (off)", async () => {
    Cursor.set({ bin: BIN, sandbox: "off", first: 400, idle: 400, grace: 200 });
    const { end, evs } = await call(ask("MODE:silent"));
    // resumed once: the fake answers a resume at once
    expect(end.ok).toBe(true);
    expect(end.text).toContain("RESUMED sess-1: (Your last step was cut short");
    expect(evs.some((e) => e.$ === "Entry" && e.kind === "mind" && e.text === "O serviço de IA ficou em silêncio: vou pedir que continue.")).toBe(true);
  });

  test("silent from the start, twice: the service is down (off)", async () => {
    Cursor.set({ bin: BIN, sandbox: "off", first: 300, idle: 300, grace: 200 });
    const { end } = await call(ask("MODE:silentfirst"));
    expect([end.ok, end.stop, end.off]).toEqual([false, "down", true]);
    expect(end.text).toContain("ficou em silêncio");
    expect(end.text).not.toMatch(/busy|silent|unavailable/);
  });

  test("a tool of ours running holds no idle watch", async () => {
    Cursor.set({ bin: BIN, sandbox: "off", first: 600, idle: 600, grace: 200 });
    const { end } = await call(ask("MODE:slowtool"));
    expect(end.ok).toBe(true);
    expect(end.text).toBe("fim");
  });

  test("no CLI: an error saying how to install it (no stop: a fallback goes on)", async () => {
    Cursor.set({ bin: path.join(ROOT, "nada") });
    const { end } = await call(ask("MODE:ok"));
    expect(end.ok).toBe(false);
    expect(end.stop).toBeUndefined();
    expect(end.text).toContain("Cursor CLI");
  });

  test("AskAI routes cursor to it", async () => {
    const t = AskAI.start(ask("MODE:ok"), () => {});
    expect((await t.done).text).toBe("ola claude-sonnet-5-5-high");
  });
});

describe("isolation", () => {
  test("the call's dir: the CLI's tools denied but ours, as written; its files and dirs its owner's alone", () => {
    const room = Cursor.room(ask("x", { searches: 2 }));
    try {
      const conf = JSON.parse(fs.readFileSync(path.join(room.conf, "cli-config.json"), "utf8"));
      expect(conf.permissions.deny).toEqual(["Shell(*)", "Read(**)", "Write(**)", "Delete(**)", "WebFetch(*)"]);
      expect(conf.permissions.allow).toEqual(["Mcp(unii:*)"]);
      expect(conf.autoAcceptWebSearch).toBe(true);
      const mode = (f: string) => fs.statSync(f).mode & 0o777;
      const mcp = path.join(room.work, ".cursor", "mcp.json");
      expect(JSON.parse(fs.readFileSync(mcp, "utf8"))).toEqual({ mcpServers: { unii: { url: BASE.server } } });
      expect(mode(mcp)).toBe(0o600);
      expect(mode(path.join(room.conf, "cli-config.json"))).toBe(0o600);
      expect(mode(path.join(room.work, ".cursor", "rules", "unii.mdc"))).toBe(0o600);
      expect(mode(room.dir)).toBe(0o700);
    } finally {
      fs.rmSync(room.dir, { recursive: true, force: true });
    }
  });

  test("a Cursor key goes in its environment alone, never on a command line", async () => {
    const was = config.KEYS.cursor;
    config.KEYS.cursor = "CHAVE-SECRETA-123";
    const room = Cursor.room(ask("x"));
    try {
      for (const jail of [null, "/usr/bin/bwrap"]) {
        const cmd = Cursor.command(BIN, jail, room, "m", "sess-9");
        expect(cmd.env.CURSOR_API_KEY).toBe("CHAVE-SECRETA-123");
        expect(JSON.stringify([cmd.file, ...cmd.args])).not.toContain("CHAVE-SECRETA");
        expect(cmd.args.some((a) => /api-key/i.test(a))).toBe(false);
      }
      // and run: the CLI sees it in its environment, not in its argv
      const { end } = await call(ask("MODE:argv"));
      expect(end.ok).toBe(true);
      expect(end.text).toContain("KEY=env:CHAVE-SECRETA-123");
      expect(end.text.split("|KEY=")[0]).not.toContain("CHAVE-SECRETA");
    } finally {
      fs.rmSync(room.dir, { recursive: true, force: true });
      if (was === undefined) {
        delete config.KEYS.cursor;
      } else {
        config.KEYS.cursor = was;
      }
    }
    // none set: none in its environment
    const bare = Cursor.room(ask("x"));
    const saved = config.KEYS.cursor;
    config.KEYS.cursor = "";
    expect(Cursor.command(BIN, null, bare, "m", null).env.CURSOR_API_KEY).toBeUndefined();
    config.KEYS.cursor = saved;
    fs.rmSync(bare.dir, { recursive: true, force: true });
  });

  test("bwrap's arguments: its own pid and ipc, /run and /var/lib hidden, the CLI's version dir alone, under umask 077", () => {
    const room = Cursor.room(ask("x"));
    try {
      const cmd = Cursor.command(BIN, "/usr/bin/bwrap", room, "m", null);
      expect([cmd.file, cmd.args[0], cmd.args[1], cmd.args[2]]).toEqual(["/bin/sh", "-c", 'umask 077 && exec "$0" "$@"', "/usr/bin/bwrap"]);
      const a = cmd.args.slice(3);
      expect(a).toContain("--unshare-pid");
      expect(a).toContain("--unshare-ipc");
      expect(a).toContain("--die-with-parent");
      const pairs = a.map((x, i) => x + " " + (a[i + 1] ?? ""));
      const at = (p: string) => pairs.indexOf(p);
      expect(at("--ro-bind /")).toBeGreaterThanOrEqual(0);
      for (const d of Cursor.hidden()) {
        // after the root, before the home and the binds
        expect(at("--tmpfs " + d)).toBeGreaterThan(at("--ro-bind /"));
        expect(at("--tmpfs " + d)).toBeLessThan(at("--bind " + room.dir));
      }
      if (fs.existsSync("/run")) {
        expect(Cursor.hidden()).toContain("/run");
      }
      // the CLI: the fake is a lone file, so the file alone
      expect(at("--ro-bind " + BIN)).toBeGreaterThan(at("--tmpfs " + os.homedir()));
      expect(a.some((x) => x === path.join(os.homedir(), ".local", "bin"))).toBe(false);
      expect(a[a.indexOf("--chdir") + 2]).toBe(BIN);
    } finally {
      fs.rmSync(room.dir, { recursive: true, force: true });
    }
  });

  test("the installer's CLI: its version's dir mounted, run by its real path; not ~/.local/bin", () => {
    const home = path.join(ROOT, "inst");
    const ver = path.join(home, "share", "cursor-agent", "versions", "1.0");
    fs.mkdirSync(ver, { recursive: true });
    fs.mkdirSync(path.join(home, "bin"), { recursive: true });
    fs.writeFileSync(path.join(ver, "cursor-agent"), "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(path.join(ver, "node"), "", { mode: 0o755 });
    fs.writeFileSync(path.join(home, "bin", "outro"), "", { mode: 0o755 });
    const link = path.join(home, "bin", "cursor-agent");
    fs.symlinkSync(path.join(ver, "cursor-agent"), link);
    expect(Cursor.cli_files(link)).toEqual({ run: fs.realpathSync(path.join(ver, "cursor-agent")), mounts: [fs.realpathSync(ver)] });
    // a lone executable: itself alone, not its dir
    expect(Cursor.cli_files(path.join(home, "bin", "outro"))).toEqual({ run: fs.realpathSync(path.join(home, "bin", "outro")), mounts: [fs.realpathSync(path.join(home, "bin", "outro"))] });
  });

  test("what it writes (as the CLI config it rewrites) is its owner's alone: umask 077", async () => {
    const { end } = await call(ask("MODE:umask"));
    expect(end.ok).toBe(true);
    expect(end.text).toBe("MODE=600|UMASK=0077");
  });

  test("of /run, its DNS's dir alone; a resolv.conf right in /run, that file alone (not /run, undoing its tmpfs)", () => {
    expect(Cursor.resolver_of("/run/systemd/resolve/stub-resolv.conf")).toEqual(["/run/systemd/resolve"]);
    expect(Cursor.resolver_of("/run/resolv.conf")).toEqual(["/run/resolv.conf"]);
    expect(Cursor.resolver_of("/etc/resolv.conf")).toEqual([]);
    expect(Cursor.resolver_of("/runx/resolv.conf")).toEqual([]);
  });

  test("a tool's error null: no TypeError, logged as such", () => {
    expect(Cursor.back({ error: null })).toBe("error: null");
    expect(Cursor.back({ error: { errorMessage: null } })).toBe('error: {"errorMessage":null}');
  });

  test("a tool of ours that answered nothing: said in Portuguese", () => {
    expect(Cursor.back({ success: { content: [] } })).toBe("(sem saída)");
    expect(Cursor.back({ success: { content: [], isError: true } })).toBe("error: (sem saída)");
  });

  test("clipped never between a surrogate pair's halves: an emoji at char 200 kept whole or cut whole", () => {
    const odd = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
    // the emoji's high half is code unit 200 (index 199): a plain slice(0, 200) would split it
    const long = "x".repeat(199) + "😀" + "y".repeat(50);
    expect(odd(long.slice(0, 200))).toBe(true);
    const shell = Cursor.called("shell", { args: { command: long } });
    expect(odd(shell)).toBe(false);
    expect(shell).toBe("shell " + "x".repeat(199) + "…");
    // ('{"d":"' is 6 code units: the emoji's high half again at index 199)
    const back = Cursor.back({ error: { d: "x".repeat(193) + "😀" + "y".repeat(50) } });
    expect(odd(JSON.stringify({ d: "x".repeat(193) + "😀" }).slice(0, 200))).toBe(true);
    expect(odd(back)).toBe(false);
    expect(back.endsWith("…")).toBe(true);
    expect(Cursor.clip("ab😀", 3)).toBe("ab…");
    expect(Cursor.clip("ab😀c", 4)).toBe("ab😀…");
    expect(Cursor.clip("ab😀", 4)).toBe("ab😀");
    const big = Cursor.back({ success: { v: "x".repeat(1993) + "😀" + "y".repeat(50) } });
    expect(odd(big)).toBe(false);
    expect(big.length).toBe(1999 + 1);
  });

  test("a tool's error without its message logged clipped, as a call is", () => {
    const back = Cursor.back({ error: { detail: "x".repeat(5000) } });
    expect(back.startsWith('error: {"detail":"xxx')).toBe(true);
    expect(back.length).toBeLessThanOrEqual("error: ".length + 200 + 1);
    expect(back.endsWith("…")).toBe(true);
    expect(Cursor.back({ error: { code: 1 } })).toBe('error: {"code":1}');
    expect(Cursor.back({ error: { errorMessage: "negado" } })).toBe("error: negado");
  });

  test("a call of the CLI's own tools logged by what it was to run, clipped; ours whole", () => {
    const long = "cat /etc/hostname " + "x".repeat(500);
    const shell = Cursor.called("shell", { args: { command: long, conversationId: "c-1", parsingResult: { a: 1 }, adminCommandDenylist: ["rm"] } });
    expect(shell.startsWith("shell cat /etc/hostname x")).toBe(true);
    expect(shell.length).toBeLessThan(220);
    expect(shell).not.toContain("conversationId");
    expect(shell.endsWith("…")).toBe(true);
    expect(Cursor.called("read", { args: { path: "/home/x/.ssh/config" } })).toBe("read /home/x/.ssh/config");
    expect(Cursor.called("edit", { args: { other: 1 } })).toBe("edit");
    expect(Cursor.called("mcp__unii__date", { args: { args: { id: 0 } } })).toBe('mcp__unii__date {"id":0}');
  });
});

describe.skipIf(!has_bwrap)("in bwrap", () => {
  test("/run (the session's sockets, docker.sock) and /var/lib hidden, ~/.local/bin unseen, DNS still read", async () => {
    Cursor.set({ bin: BIN, sandbox: "bwrap" });
    const { end } = await call(ask("MODE:jail"));
    expect(end.ok).toBe(true);
    expect(end.text).toContain("RUNUSER=[]");
    expect(end.text).toContain("VARLIB=[]");
    expect(end.text).toContain("LOCALBIN=[]");
    expect(end.text).toContain("DOCKER=unseen");
    expect(end.text).toContain("DNS=readable");
    // of /run, only what its DNS needs
    const run = /RUN=\[([^\]]*)\]/.exec(end.text)![1].trim();
    expect(run === "" ? [] : run.split(" ")).toEqual(Cursor.resolver().map((d) => d.split("/")[2]));
  });

  test("an empty home, no variable of ours, the call's dir writable, the call's dir removed", async () => {
    process.env.UNII_TEST_SECRET = "nao-deve-vazar";
    Cursor.set({ bin: BIN, sandbox: "bwrap" });
    const { end } = await call(ask("MODE:env"));
    delete process.env.UNII_TEST_SECRET;
    expect(end.ok).toBe(true);
    // the home holds the CLI alone (.local/share/cursor-agent, read-only)
    expect(end.text).toMatch(/HOME=\[(\.local )?\]/);
    expect(end.text).not.toContain("UNII_TEST_SECRET");
    expect(end.text).toContain("RULE=SISTEMA-X");
    expect(fs.readdirSync(path.join(config.CURSOR_SUB, "runs"))).toEqual([]);
  });

  // B4 (FrostyEel): resolver_of's list alone proved nothing run. Here a
  // "bwrap" first on the PATH runs the real one in a namespace whose /run
  // is a tmpfs holding resolv.conf, a session's /run/user/1000/bus and a
  // docker.sock: the call, run whole, must see of /run only resolv.conf
  test.skipIf(NEST_SKIP !== "")("a resolv.conf right in /run: that file alone back in the sandbox, not /run/user nor docker.sock (skipped without bwrap or unshare -Urm)", async () => {
    const real = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"].find((f) => fs.existsSync(f))!;
    const dir = path.join(ROOT, "nest");
    fs.mkdirSync(dir, { recursive: true });
    const fake_run = "mount -t tmpfs tmpfs /run && mkdir -p /run/user/1000 && : > /run/user/1000/bus && : > /run/docker.sock && echo 'nameserver 127.0.0.53' > /run/resolv.conf && exec \"$0\" \"$@\"";
    fs.writeFileSync(path.join(dir, "bwrap"), "#!/bin/sh\nexec unshare -Urm /bin/sh -c '" + fake_run.replace(/'/g, "'\\''") + "' " + real + ' "$@"\n', { mode: 0o755 });
    const path_was = process.env.PATH;
    process.env.PATH = dir + ":" + (path_was ?? "");
    Cursor.set({ bin: BIN, sandbox: "bwrap", resolved: "/run/resolv.conf" });
    try {
      expect(Cursor.bwrap()).toBe(path.join(dir, "bwrap"));
      expect(Cursor.resolver()).toEqual(["/run/resolv.conf"]);
      const { end } = await call(ask("MODE:jail"));
      expect(end.ok).toBe(true);
      expect(end.text).toContain("RUN=[resolv.conf ]");
      expect(end.text).toContain("RUNUSER=[]");
      expect(end.text).toContain("DOCKER=unseen");
    } finally {
      process.env.PATH = path_was;
      Cursor.set({ resolved: null });
    }
  });

  test("a CLI bwrap can't run (its execvp failing, exit 1): not found, in Portuguese", async () => {
    const broken = path.join(ROOT, "bin", "quebrado-bwrap");
    fs.writeFileSync(broken, "#!/nao/existe/node\n", { mode: 0o755 });
    Cursor.set({ bin: broken, sandbox: "bwrap" });
    const { end } = await call(ask("MODE:ok"));
    expect(end.ok).toBe(false);
    expect(end.stop).toBeUndefined();
    expect(end.text).toStartWith("o Cursor CLI não foi encontrado ou não pôde ser executado (código de saída 1): bwrap: execvp ");
  });

  test("a stop kills the sandbox and what runs in it", async () => {
    Cursor.set({ bin: BIN, sandbox: "bwrap", grace: 300 });
    const { end } = await call(ask("MODE:silent"), (t) => setTimeout(() => t.stop(), 500));
    expect(end.text).toBe("interrompido");
    await Bun.sleep(800);
    const left = Bun.spawnSync(["pgrep", "-f", BIN]).stdout.toString().trim();
    expect(left).toBe("");
  });
});
