// DeviceEnv.open.probe
// ====================
// A fresh process whose HOME, XDG_CONFIG_HOME and UNII_DIR are under
// /tmp (set by DeviceEnv.open.test before this file loads). The list is
// on disk. Mcp.stdio with that list must show it. Mcp.open, the server's
// start, must not: it passes no list.

import * as fs from "node:fs";
import * as Client from "./Client.ts";
import { DeviceEnv } from "./DeviceEnv.ts";
import { Mcp } from "./Mcp.ts";

const status = process.argv[2] ?? "";
const openDump = process.argv[3] ?? "";
const controlDump = process.argv[4] ?? "";
const stub = process.argv[5] ?? "";
const secretFile = process.argv[6] ?? "";
const ownName = process.argv[7] ?? "";
const parentName = process.argv[8] ?? "";
const probeName = process.argv[9] ?? "";

function note(text: string): void {
  if (status.startsWith("/tmp/")) {
    fs.writeFileSync(status, text.endsWith("\n") ? text : text + "\n");
  }
}

function underTmp(path: string): boolean {
  return path === "/tmp" || path.startsWith("/tmp/");
}

function child(dump: string): { name: string; device: string; command: string; args: string[]; env: Record<string, string>; cwd: string; url: string; headers: Record<string, string>; timeout: number } {
  return {
    name: "probe",
    device: "",
    command: process.execPath,
    args: [stub, dump, probeName, ownName, parentName],
    env: { [ownName]: "1" },
    cwd: process.env.HOME ?? "/tmp",
    url: "",
    headers: {},
    timeout: 30,
  };
}

async function waitDump(file: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, "utf8");
      if (text.includes("pid=")) {
        return text;
      }
    }
    await Bun.sleep(20);
  }
  return "";
}

function field(text: string, key: string): string {
  const match = text.match(new RegExp("^" + key + "=([01])$", "m"));
  return match?.[1] ?? "";
}

async function main(): Promise<number> {
  const paths = [status, openDump, controlDump, secretFile, process.env.HOME ?? "", process.env.UNII_DIR ?? "", Client.DIR];
  if (paths.some((path) => !underTmp(path)) || !stub.endsWith("/DeviceEnv.open.stub.ts") || !fs.existsSync(stub)) {
    note("fixture=bad\nfora=dir\n");
    return 1;
  }
  const secret = fs.readFileSync(secretFile, "utf8");
  const files = [
    Client.DIR + "/" + DeviceEnv.FILE_NAME,
    (process.env.UNII_DIR ?? "") + "/" + DeviceEnv.FILE_NAME,
    (process.env.HOME ?? "") + "/.unii/" + DeviceEnv.FILE_NAME,
    (process.env.HOME ?? "") + "/.config/unii/" + DeviceEnv.FILE_NAME,
  ];
  if (!files.every((file) => underTmp(file) && DeviceEnv.cached(file)[probeName] === secret)) {
    note("fixture=bad\n");
    return 1;
  }
  const control = Mcp.stdio(child(controlDump), () => {}, () => {}, DeviceEnv.cached(files[0]));
  const controlText = await waitDump(controlDump);
  control.close();
  if (field(controlText, "probe") !== "1" || field(controlText, "own") !== "1" || field(controlText, "parent") !== "0") {
    note("fixture=ok\ncontrol=bad\n");
    return 1;
  }
  const servers = Mcp.servers(() => {}, [child(openDump)], async () => ({ text: "", fail: true }), () => false);
  const started = servers.all.get("probe");
  if (started === undefined) {
    note("fixture=ok\ncontrol=ok\nopen=bad\n");
    return 1;
  }
  let open = "bad";
  try {
    const got = await Promise.race([
      Mcp.open(servers, started),
      Bun.sleep(10000).then(() => "demorou"),
    ]);
    open = typeof got === "string" ? "bad" : "ok";
  } finally {
    started.link?.close();
  }
  const openText = fs.existsSync(openDump) ? fs.readFileSync(openDump, "utf8") : "";
  const text = [
    "fixture=ok",
    "control=ok",
    "probe=" + (field(openText, "probe") === "0" ? "absent" : "present"),
    "own=" + (field(openText, "own") === "1" ? "ok" : "bad"),
    "parent=" + (field(openText, "parent") === "0" ? "absent" : "present"),
    "path=" + (field(openText, "path") === "1" ? "ok" : "bad"),
    "home=" + (field(openText, "home") === "1" ? "ok" : "bad"),
    "open=" + open,
  ].join("\n") + "\n";
  if (text.includes(secret)) {
    note("fixture=bad\n");
    return 1;
  }
  note(text);
  const ok = text.includes("probe=absent\n") && text.includes("own=ok\n") && text.includes("parent=absent\n") && text.includes("path=ok\n") && text.includes("home=ok\n") && text.includes("open=ok\n");
  return ok ? 0 : 1;
}

process.exit(await main());
