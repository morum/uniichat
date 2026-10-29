// DeviceEnv.open.stub
// ===================
// The program Mcp.stdio starts in DeviceEnv.open.probe. It records which
// names are in its environment (never a value) and then answers the two
// calls Mcp.open makes, so that start can finish.

import * as fs from "node:fs";

const dump = process.argv[2] ?? "";
const probe = process.argv[3] ?? "";
const own = process.argv[4] ?? "";
const parent = process.argv[5] ?? "";

if (dump === "" || !dump.startsWith("/tmp/")) {
  process.exit(1);
}

const bit = (name: string): string => (process.env[name] === undefined ? "0" : "1");
const ownBit = process.env[own] === "1" ? "1" : "0";
fs.writeFileSync(dump, [
  "pid=" + process.pid,
  "probe=" + bit(probe),
  "own=" + ownBit,
  "parent=" + bit(parent),
  "path=" + (process.env.PATH ? "1" : "0"),
  "home=" + (process.env.HOME ? "1" : "0"),
].join("\n") + "\n");

const dec = new TextDecoder();
let buf = "";
for await (const chunk of Bun.stdin.stream()) {
  buf += dec.decode(chunk);
  let nl = buf.indexOf("\n");
  while (nl >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    nl = buf.indexOf("\n");
    if (line.trim() === "") {
      continue;
    }
    let msg: { id?: unknown; method?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === undefined) {
      continue;
    }
    const result = msg.method === "tools/list"
      ? { tools: [] }
      : { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "p", version: "0" } };
    fs.writeSync(1, JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
  }
}
