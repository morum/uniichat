// DeviceEnv.e2e.test
// ==================
// A server on its own port and a device with HOME and XDG in /tmp.
// The real server on 8788 and the real device are not touched.
// Fixtures are not printed.

import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import { DeviceEnv } from "./DeviceEnv.ts";

const ROOT = import.meta.dir;
const SEGREDO = "s3g-" + crypto.randomUUID();
const OUTRO = "s3g2-" + crypto.randomUUID();
let server: Bun.Subprocess | null = null;
let device: Bun.Subprocess | null = null;
const logs: Buffer[] = [];
const deviceLogs: Buffer[] = [];

function stop(proc: Bun.Subprocess | null): void {
  if (proc === null) {
    return;
  }
  try {
    process.kill(proc.pid, "SIGTERM");
  } catch {
    // already gone
  }
}

afterAll(() => {
  stop(device);
  stop(server);
});

function pump(stream: ReadableStream<Uint8Array> | null, into: Buffer[]): void {
  if (stream === null) {
    return;
  }
  const reader = stream.getReader();
  void (async () => {
    try {
      for (;;) {
        const got = await reader.read();
        if (got.done) {
          return;
        }
        into.push(Buffer.from(got.value));
      }
    } catch {
      // the process ended
    }
  })();
}

function joined(parts: Buffer[]): Buffer {
  return Buffer.concat(parts);
}

async function until(pred: () => boolean, ms = 12000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) {
      return true;
    }
    await Bun.sleep(50);
  }
  return false;
}

test("ponta a ponta: API mascarada, device aplica, o servidor n\u00e3o", async () => {
  const root = fs.mkdtempSync("/tmp/unii-env-e2e-");
  const home = root + "/home";
  const xdg = root + "/xdg";
  const data = root + "/data";
  const tmp = root + "/tmp";
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(xdg, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  expect(port).not.toBe(8788);
  expect(port).toBeGreaterThan(0);
  const url = "http://127.0.0.1:" + port;
  const base = {
    HOME: home,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    LANG: "C.UTF-8",
    TMPDIR: tmp,
    SHELL: "/bin/sh",
  };
  try {
    server = Bun.spawn([process.execPath, "Server.ts", String(port)], {
      cwd: ROOT,
      env: { ...base, UNII_DIR: data },
      stdout: "pipe",
      stderr: "pipe",
    });
    pump(server.stdout, logs);
    pump(server.stderr, logs);
    let heard = false;
    for (let i = 0; i < 80; i++) {
      const res = await fetch(url).catch(() => null);
      if (res !== null) {
        heard = true;
        break;
      }
      await Bun.sleep(50);
    }
    expect(heard).toBe(true);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    const dbPath = data + "/unii.db";
    const ready = await until(() => fs.existsSync(dbPath));
    expect(ready).toBe(true);
    const db = new Database(dbPath);
    db.exec("pragma busy_timeout = 5000");
    db.run("insert into sessions (hash, what, at) values (?, 'e2e', ?)", [hash, Date.now()]);
    db.close();
    const auth = { authorization: "Bearer " + token };
    const anon = await fetch(url + "/api/device-env");
    expect(anon.status).toBe(401);
    const empty = await fetch(url + "/api/device-env", { headers: auth });
    expect(empty.status).toBe(200);
    const emptyBody = await empty.json();
    const created = await fetch(url + "/api/device-env", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ version: emptyBody.version, set: { APP_TOKEN: SEGREDO } }),
    });
    const createdText = await created.text();
    expect(created.status).toBe(200);
    expect(createdText.includes(SEGREDO)).toBe(false);
    expect(createdText).toContain("APP_TOKEN");
    const refused = await fetch(url + "/api/device-env", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ version: JSON.parse(createdText).device_env.version, set: { PATH: OUTRO } }),
    });
    const refusedText = await refused.text();
    expect(refused.status).toBe(400);
    expect(refusedText.includes(OUTRO)).toBe(false);
    expect(refusedText).toContain("PATH");
    const confDir = xdg + "/unii";
    fs.mkdirSync(confDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(confDir + "/device.json", JSON.stringify({ url, token, name: "e2e", work: root + "/work" }, null, 2) + "\n", { mode: 0o600 });
    device = Bun.spawn([process.execPath, "Cli.ts", "device", url], {
      cwd: ROOT,
      env: { ...base, XDG_CONFIG_HOME: xdg },
      stdout: "pipe",
      stderr: "pipe",
    });
    pump(device.stdout, deviceLogs);
    pump(device.stderr, deviceLogs);
    const cache = confDir + "/" + DeviceEnv.FILE_NAME;
    const applied = await until(() => {
      try {
        return fs.readFileSync(cache).includes(Buffer.from(SEGREDO));
      } catch {
        return false;
      }
    });
    expect(applied).toBe(true);
    expect(fs.readFileSync(cache).includes(Buffer.from(SEGREDO))).toBe(true);
    const serverEnv = fs.readFileSync("/proc/" + server.pid + "/environ");
    expect(serverEnv.includes(Buffer.from(SEGREDO))).toBe(false);
    expect(serverEnv.includes(Buffer.from(OUTRO))).toBe(false);
    const deviceEnv = fs.readFileSync("/proc/" + device.pid + "/environ");
    expect(deviceEnv.includes(Buffer.from("HOME=" + home))).toBe(true);
    const real = process.env.HOME ?? "";
    if (real !== "" && real !== home) {
      expect(deviceEnv.includes(Buffer.from("HOME=" + real))).toBe(false);
    }
    expect(deviceEnv.includes(Buffer.from("PATH=" + OUTRO))).toBe(false);
    const listed = await (await fetch(url + "/api/device-env", { headers: auth })).text();
    expect(listed.includes(SEGREDO)).toBe(false);
    const version = JSON.parse(listed).version as string;
    const changed = await fetch(url + "/api/device-env", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ version, set: { APP_TOKEN: null, OUTRA: OUTRO } }),
    });
    expect(changed.status).toBe(200);
    const live = await until(() => {
      try {
        const now = fs.readFileSync(cache);
        return now.includes(Buffer.from(OUTRO)) && !now.includes(Buffer.from(SEGREDO));
      } catch {
        return false;
      }
    });
    expect(live).toBe(true);
    const log = joined(logs);
    expect(log.includes(Buffer.from(SEGREDO))).toBe(false);
    expect(log.includes(Buffer.from(OUTRO))).toBe(false);
    const dlog = joined(deviceLogs);
    expect(dlog.includes(Buffer.from(SEGREDO))).toBe(false);
    expect(dlog.includes(Buffer.from(OUTRO))).toBe(false);
    expect(String(port)).not.toBe("8788");
  } finally {
    stop(device);
    stop(server);
    device = null;
    server = null;
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60000);
