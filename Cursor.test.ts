// Cursor.test
// ===========
// The cursor vendor (Cursor.ts) on a fake Cursor CLI: a shell script that
// answers as the real one does (stream-json lines; "Error: [code] ..."
// and exit 1), told what to do by its message (MODE:...). Runs with the
// sandbox off, and in bwrap where it is installed.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Cursor } from "./Cursor.ts";
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
  text=$(printf '%s' "$msg" | tr -d '\n"' | cut -c1-120)
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
    j '{"type":"tool_call","subtype":"started","call_id":"t1","tool_call":{"mcpToolCall":{"args":{"name":"unii-shell","args":{"device":"d","command":"ls"},"providerIdentifier":"unii","toolName":"shell"}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"completed","call_id":"t1","tool_call":{"mcpToolCall":{"args":{"name":"unii-shell","args":{"device":"d","command":"ls"},"providerIdentifier":"unii","toolName":"shell"},"result":{"success":{"content":[{"text":{"text":"a.txt"}}],"isError":false}}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"started","call_id":"t2","tool_call":{"readToolCall":{"args":{"path":"/etc/x"}}},"session_id":"'$sid'"}'
    j '{"type":"tool_call","subtype":"completed","call_id":"t2","tool_call":{"readToolCall":{"args":{"path":"/etc/x"},"result":{"error":{"errorMessage":"Permission denied"}}}},"session_id":"'$sid'"}'
    say "feito"; done_ "feito" ;;
  *MODE:limitsoon*)
    if [ -f once ]; then init; say "depois"; done_ "depois"; exit 0; fi
    touch once
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
  *MODE:silent*)
    init; say "comecei"; sleep 30 ;;
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

beforeAll(() => {
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  fs.writeFileSync(BIN, FAKE, { mode: 0o755 });
});

afterAll(() => {
  Cursor.set({ bin: "", sandbox: "bwrap", first: 300e3, idle: 600e3, grace: 5e3 });
  fs.rmSync(ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  Cursor.set({ bin: BIN, sandbox: "off", first: 300e3, idle: 600e3, grace: 500 });
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
    expect(Cursor.failure("\x1b[33m⚠ Warning: The provided API key is invalid.\x1b[0m").text).toContain("not signed in");
    expect(Cursor.failure("Cannot use this model: x").off).toBe(true);
    const busy = Cursor.failure("Error: [internal_error] boom");
    expect([busy.stop, busy.off]).toEqual(["down", false]);
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

  test("a tool of ours logged as Claude Code names it, its result; ours marks it acted, the CLI's own doesn't", async () => {
    const { end, evs } = await call(ask("MODE:tool"));
    expect(end.ok).toBe(true);
    const entries = evs.filter((e) => e.$ === "Entry") as any[];
    expect(entries.slice(0, 4).map((e) => [e.kind, e.text, e.of])).toEqual([
      ["tool", 'mcp__unii__shell {"device":"d","command":"ls"}', "t1"],
      ["echo", "a.txt", "t1"],
      ["tool", 'read {"path":"/etc/x"}', "t2"],
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
    expect(end.text).toContain("exit 3");
  });

  test("a long usage limit with a fallback and no tool run ends (off) for it, naming the reset", async () => {
    const { end } = await call(ask("MODE:limit", { fallback: true }));
    expect([end.ok, end.stop, end.off, end.acted]).toEqual([false, "down", true, false]);
    expect(end.text).toContain("usage limit on cursor");
    expect(end.until).toBe(Date.parse("2099-01-01T05:00:00Z"));
    expect(Agent.under(["cursor"], false)).toBe(Date.parse("2099-01-01T05:00:00Z"));
  });

  test("under a limit remembered, a call with a fallback ends before asking", async () => {
    Agent.note("cursor", Date.now() + 3600e3);
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
    expect(end.text).toBe("RESUMED sess-1: mais uma coisa");
    expect(evs.some((e) => e.$ === "Entry" && e.kind === "user" && e.text === "mais uma coisa")).toBe(true);
    expect(end.left).toEqual([]);
  });

  test("a stop ends the call at once, its CLI killed, its dir removed", async () => {
    const t0 = Date.now();
    const { end } = await call(ask("MODE:silent"), (t) => setTimeout(() => t.stop(), 500));
    expect(end.ok).toBe(false);
    expect(end.text).toBe("stopped");
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(fs.readdirSync(path.join(config.CURSOR_SUB, "runs"))).toEqual([]);
  });

  test("silent past its idle with no tool running: stopped, resumed once, then the call ends (off)", async () => {
    Cursor.set({ bin: BIN, sandbox: "off", first: 400, idle: 400, grace: 200 });
    const { end, evs } = await call(ask("MODE:silent"));
    // resumed once: the fake answers a resume at once
    expect(end.ok).toBe(true);
    expect(end.text).toContain("RESUMED sess-1: (Your last step was cut short");
    expect(evs.some((e) => e.$ === "Entry" && e.kind === "mind" && /went silent/.test(e.text))).toBe(true);
  });

  test("silent from the start, twice: the service is down (off)", async () => {
    Cursor.set({ bin: BIN, sandbox: "off", first: 300, idle: 300, grace: 200 });
    const { end } = await call(ask("MODE:silentfirst"));
    expect([end.ok, end.stop, end.off]).toEqual([false, "down", true]);
    expect(end.text).toContain("went silent");
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

describe.skipIf(!has_bwrap)("in bwrap", () => {
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

  test("a stop kills the sandbox and what runs in it", async () => {
    Cursor.set({ bin: BIN, sandbox: "bwrap", grace: 300 });
    const { end } = await call(ask("MODE:silent"), (t) => setTimeout(() => t.stop(), 500));
    expect(end.text).toBe("stopped");
    await Bun.sleep(800);
    const left = Bun.spawnSync(["pgrep", "-f", BIN]).stdout.toString().trim();
    expect(left).toBe("");
  });
});
