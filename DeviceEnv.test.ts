// DeviceEnv.test
// ==============
// Names, masking, the file, and applying the list. Values in here are
// fixtures. Nothing is printed on success.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { DeviceEnv, MAX, NAME_MAX, VALUE_MAX } from "./DeviceEnv.ts";
import { Machine } from "./Machine.ts";

const VALOR = "m".repeat(24) + "Zz9q";

function scratch(): string {
  const dir = fs.mkdtempSync("/tmp/unii-env-");
  if (!dir.startsWith("/tmp/")) {
    throw new Error("o teste saiu de /tmp");
  }
  return dir;
}

function post(version: string, set: object): Request {
  return new Request("http://127.0.0.1/api/device-env", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version, set }),
  });
}

test("aceita um nome comum e recusa forma, tamanho, PATH, HOME, Unii e systemd", () => {
  expect(DeviceEnv.why("APP_TOKEN")).toBeNull();
  expect(DeviceEnv.why("_X")).toBeNull();
  expect(DeviceEnv.why("A".repeat(NAME_MAX))).toBeNull();
  for (const name of ["", "1ABC", "A-B", "COM ESPACO", "A".repeat(NAME_MAX + 1)]) {
    expect(DeviceEnv.why(name)).not.toBeNull();
  }
  expect(DeviceEnv.why("PATH")).toContain("PATH");
  expect(DeviceEnv.why("path")).toContain("PATH");
  expect(DeviceEnv.why("Path")).toContain("PATH");
  expect(DeviceEnv.why("HOME")).toContain("HOME");
  expect(DeviceEnv.why("home")).toContain("HOME");
  expect(DeviceEnv.why("UNII_DIR")).toContain("Unii");
  expect(DeviceEnv.why("unii_dir")).toContain("Unii");
  expect(DeviceEnv.why("SYSTEMD_EXEC_PID")).toContain("systemd");
  expect(DeviceEnv.why("LISTEN_FDS")).toContain("systemd");
  expect(DeviceEnv.why("listen_pid")).toContain("systemd");
  for (const name of ["INVOCATION_ID", "JOURNAL_STREAM", "NOTIFY_SOCKET", "USER", "LOGNAME", "SHELL", "XDG_RUNTIME_DIR", "WATCHDOG_PID", "MANAGERPID"]) {
    expect(DeviceEnv.why(name)).toContain("systemd");
  }
});

test("valor vazio passa; nulo e acima do m\u00e1ximo n\u00e3o", () => {
  expect(DeviceEnv.why_value("")).toBeNull();
  expect(DeviceEnv.why_value("a".repeat(VALUE_MAX))).toBeNull();
  expect(DeviceEnv.why_value("a".repeat(VALUE_MAX + 1))).not.toBeNull();
  expect(DeviceEnv.why_value("a\0b")).not.toBeNull();
  expect(DeviceEnv.why_value(1)).not.toBeNull();
  expect(DeviceEnv.why_value("linha1\nlinha2")).toBeNull();
});

test("a m\u00e1scara n\u00e3o devolve o valor", () => {
  expect(DeviceEnv.mask("curto")).toBe("");
  expect(DeviceEnv.mask("m".repeat(19))).toBe("");
  expect(DeviceEnv.mask("m".repeat(20))).toBe("mmmm");
  expect(DeviceEnv.mask(VALOR)).toBe("Zz9q");
  expect(DeviceEnv.mask(VALOR).includes("m".repeat(20))).toBe(false);
});

test("grava, mascara, modo 0600, e a resposta n\u00e3o traz o valor", async () => {
  const dir = scratch();
  const file = dir + "/device-env.json";
  try {
    const first = DeviceEnv.shown(file);
    const out = await DeviceEnv.save(post(first.version, { APP_TOKEN: VALOR, OUTRO: "curto", COM_ESPACO: "  x  " }), file);
    expect(out.status).toBe(200);
    const body = JSON.stringify(out.body);
    expect(body.includes(VALOR)).toBe(false);
    expect(body.includes("m".repeat(24))).toBe(false);
    const row = out.body.device_env!.rows.find((r) => r.name === "APP_TOKEN")!;
    expect(Object.keys(row).sort()).toEqual(["name", "tail"]);
    expect(row.tail).toBe("Zz9q");
    expect(out.body.device_env!.rows.find((r) => r.name === "OUTRO")!.tail).toBe("");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(DeviceEnv.load(file).vars.COM_ESPACO).toBe("  x  ");
    expect(DeviceEnv.load(file).vars.APP_TOKEN).toBe(VALOR);
    expect(DeviceEnv.saved_line(out.names)).toBe("unii: device env saved: APP_TOKEN, COM_ESPACO, OUTRO");
    expect(DeviceEnv.saved_line(out.names).includes(VALOR)).toBe(false);
    const again = await DeviceEnv.save(post(first.version, { APP_TOKEN: "dois" }), file);
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body).includes("dois")).toBe(false);
    expect(DeviceEnv.load(file).vars.APP_TOKEN).toBe(VALOR);
    const gone = await DeviceEnv.save(post(out.body.device_env!.version, { APP_TOKEN: null }), file);
    expect(gone.status).toBe(200);
    expect(Object.hasOwn(DeviceEnv.load(file).vars, "APP_TOKEN")).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("arquivo com nome reservado n\u00e3o vaza o valor e bloqueia o save", async () => {
  const dir = scratch();
  const file = dir + "/device-env.json";
  try {
    fs.writeFileSync(file, JSON.stringify({ PATH: VALOR }) + "\n");
    const shown = DeviceEnv.shown(file);
    expect(shown.error).not.toBeNull();
    expect(shown.rows).toEqual([]);
    expect(JSON.stringify(shown).includes(VALOR)).toBe(false);
    const out = await DeviceEnv.save(post(shown.version, { APP_TOKEN: "x" }), file);
    expect(out.status).toBe(409);
    expect(JSON.stringify(out.body).includes(VALOR)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no m\u00e1ximo 64 vari\u00e1veis", async () => {
  const dir = scratch();
  const file = dir + "/device-env.json";
  try {
    const set: Record<string, string> = {};
    for (let i = 0; i < MAX; i++) {
      set["N" + i] = "a";
    }
    const version = DeviceEnv.shown(file).version;
    const out = await DeviceEnv.save(post(version, set), file);
    expect(out.status).toBe(200);
    const more = await DeviceEnv.save(post(out.body.device_env!.version, { EXTRA: "b" }), file);
    expect(more.status).toBe(400);
    expect(more.body.error).toContain("m\u00e1ximo");
    expect(Object.hasOwn(DeviceEnv.load(file).vars, "EXTRA")).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("__proto__ fica no arquivo e n\u00e3o no prot\u00f3tipo", async () => {
  const dir = scratch();
  const file = dir + "/device-env.json";
  try {
    const version = DeviceEnv.shown(file).version;
    const set = JSON.parse('{"__proto__":"abc"}');
    const out = await DeviceEnv.save(post(version, set), file);
    expect(out.status).toBe(200);
    const vars = DeviceEnv.load(file).vars;
    expect(vars["__proto__"]).toBe("abc");
    expect(({} as { abc?: string }).abc).toBeUndefined();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("aplica no processo, restaura o anterior e n\u00e3o mexe em PATH nem HOME", () => {
  const env: DeviceEnv.Env = { PATH: "/usr/bin", HOME: "/tmp/casa", FOO: "velho" };
  const owned: DeviceEnv.Owned = new Map();
  DeviceEnv.apply(env, { FOO: "1", PATH: "/evil", HOME: "/evil" }, owned);
  DeviceEnv.apply(env, { FOO: "2", PATH: "/evil", HOME: "/evil" }, owned);
  expect(env.PATH).toBe("/usr/bin");
  expect(env.HOME).toBe("/tmp/casa");
  expect(env.FOO).toBe("2");
  DeviceEnv.apply(env, {}, owned);
  expect(env.FOO).toBe("velho");
  expect(env.PATH).toBe("/usr/bin");
  const fresh: DeviceEnv.Env = { PATH: "/bin" };
  const owned2: DeviceEnv.Owned = new Map();
  DeviceEnv.apply(fresh, { BAR: "1" }, owned2);
  expect(fresh.BAR).toBe("1");
  DeviceEnv.apply(fresh, {}, owned2);
  expect(Object.hasOwn(fresh, "BAR")).toBe(false);
  expect(fresh.PATH).toBe("/bin");
});

test("na partida l\u00ea o arquivo; arquivo ruim n\u00e3o aplica", () => {
  const dir = scratch();
  const file = dir + "/device-env.json";
  try {
    DeviceEnv.store(file, Object.assign(Object.create(null), { APP_TOKEN: VALOR }));
    const env: DeviceEnv.Env = { PATH: "/bin" };
    const owned: DeviceEnv.Owned = new Map();
    DeviceEnv.boot(env, file, owned);
    expect(env.APP_TOKEN).toBe(VALOR);
    fs.writeFileSync(file, "{");
    const env2: DeviceEnv.Env = { PATH: "/bin" };
    DeviceEnv.boot(env2, file, new Map());
    expect(env2.APP_TOKEN).toBeUndefined();
    expect(DeviceEnv.wire(file)).toBeNull();
    expect(JSON.stringify(DeviceEnv.shown(file)).includes(VALOR)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("take grava a lista e descarta PATH", () => {
  const dir = scratch();
  const file = dir + "/device-env.json";
  try {
    const env: DeviceEnv.Env = { PATH: "/bin" };
    DeviceEnv.take(env, { APP_TOKEN: VALOR, PATH: "/evil" }, new Map(), file);
    expect(env.APP_TOKEN).toBe(VALOR);
    expect(env.PATH).toBe("/bin");
    const raw = fs.readFileSync(file, "utf8");
    expect(raw.includes(VALOR)).toBe(true);
    expect(raw.includes("PATH")).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("o filho herda a vari\u00e1vel e o PATH", async () => {
  const base: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: "/tmp/casa-teste" };
  DeviceEnv.apply(base, { APP_TOKEN: VALOR }, new Map());
  const env = Machine.job_env("Agente", base);
  expect(env.APP_TOKEN).toBe(VALOR);
  expect(env.PATH).toBe("/usr/bin:/bin");
  expect(env.HOME).toBe("/tmp/casa-teste");
  expect(env.UNII_AGENT).toBe("Agente");
  expect((env.UNII_RUN ?? "").length > 0).toBe(true);
  const proc = Bun.spawn(["/bin/sh", "-c", "printf %s \"$APP_TOKEN\""], { env, stdout: "pipe" });
  const text = await new Response(proc.stdout).text();
  expect(text).toBe(VALOR);
});

test("o c\u00f3digo novo n\u00e3o cita service.env", () => {
  for (const name of ["DeviceEnv.ts", "Device.ts", "Server.ts", "Settings.ts", "web/src/main.ts", "web/src/Html.ts"]) {
    expect(fs.readFileSync(name, "utf8").includes("service.env")).toBe(false);
  }
});
