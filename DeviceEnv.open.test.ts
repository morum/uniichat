// DeviceEnv.open.test
// ===================
// Mcp.open is how the server starts a program. The list stays out of
// that process. UNII_DIR and SYSTEMD_EXEC_PID are on the parent and on
// the control list; neither reaches the child. PATH and HOME stay.
// Values here are fixtures. Nothing is printed on success.
// The real server on 8788 and the real device are not touched.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { DeviceEnv } from "./DeviceEnv.ts";

const ROOT = import.meta.dir;
const PROBE = "APP_OPEN_P160";
const OWN = "APP_OPEN_OWN_P160";
const PARENT = "APP_OPEN_PARENT_P160";
const UNII = "UNII_DIR";
const SYSTEMD = "SYSTEMD_EXEC_PID";

function scratch(): string {
  const dir = fs.mkdtempSync("/tmp/unii-env-");
  if (!dir.startsWith("/tmp/")) {
    throw new Error("o teste saiu de /tmp");
  }
  return dir;
}

function stopDump(file: string): void {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const pid = Number(text.match(/^pid=(\d+)$/m)?.[1] ?? "0");
  if (!Number.isInteger(pid) || pid < 2 || pid === process.pid) {
    return;
  }
  let cmd = "";
  try {
    cmd = fs.readFileSync("/proc/" + pid + "/cmdline", "utf8");
  } catch {
    return;
  }
  if (!cmd.includes("DeviceEnv.open.stub.ts") || !cmd.includes("/tmp/unii-env-")) {
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

test("Mcp.open deixa device-env.json fora do processo", async () => {
  const dir = scratch();
  const home = dir + "/home";
  const xdg = dir + "/xdg";
  const data = dir + "/unii";
  const secret = "opn-" + crypto.randomUUID();
  const body = JSON.stringify({ [PROBE]: secret }) + "\n";
  const files = [
    xdg + "/unii/" + DeviceEnv.FILE_NAME,
    data + "/" + DeviceEnv.FILE_NAME,
    home + "/.unii/" + DeviceEnv.FILE_NAME,
    home + "/.config/unii/" + DeviceEnv.FILE_NAME,
  ];
  const status = dir + "/status.txt";
  const openDump = dir + "/open.txt";
  const controlDump = dir + "/control.txt";
  const secretFile = dir + "/secret.txt";
  try {
    for (const file of files) {
      fs.mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, body, { mode: 0o600 });
    }
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    const proc = Bun.spawn([
      process.execPath,
      ROOT + "/DeviceEnv.open.probe.ts",
      status,
      openDump,
      controlDump,
      ROOT + "/DeviceEnv.open.stub.ts",
      secretFile,
      OWN,
      PARENT,
      PROBE,
      UNII,
      SYSTEMD,
    ], {
      cwd: ROOT,
      env: {
        HOME: home,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C.UTF-8",
        TMPDIR: "/tmp",
        SHELL: "/bin/sh",
        USER: "probe",
        XDG_CONFIG_HOME: xdg,
        UNII_DIR: data,
        [PARENT]: "1",
        [SYSTEMD]: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const killer = setTimeout(() => {
      try {
        process.kill(proc.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }, 20000);
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(killer);
    const text = fs.existsSync(status) ? fs.readFileSync(status, "utf8") : "";
    const hide = (got: string) => got.split(secret).join("[valor]");
    expect(secret.length).toBeGreaterThan(8);
    expect(text.includes(secret)).toBe(false);
    expect(stdout.includes(secret)).toBe(false);
    expect(stderr.includes(secret)).toBe(false);
    expect(hide(text) + "\ncode=" + code + "\nerr=" + hide(stderr).slice(0, 400)).toBe([
      "fixture=ok",
      "control=ok",
      "probe=absent",
      "own=ok",
      "parent=absent",
      "path=ok",
      "home=ok",
      "unii=absent",
      "systemd=absent",
      "open=ok",
      "",
      "code=0",
      "err=",
    ].join("\n"));
  } finally {
    stopDump(openDump);
    stopDump(controlDump);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
