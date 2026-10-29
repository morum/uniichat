// DeviceEnv
// =========
// The device's environment variables, set on the settings page. The
// server stores them in device-env.json (mode 0600) under its data dir
// and never puts them in its own process, a log line, or a page. A
// device keeps a copy beside device.json and applies it to itself as it
// starts, then replaces it with the list the server sends; every process
// it starts inherits that process environment (Machine.job_env). One list
// for every device. Values are secrets: a page shows a tail, or nothing.

import * as fs from "node:fs";
import * as path from "node:path";
import { write_whole } from "./Write.ts";

// Types
// =====

export type Rec = { [key: string]: string };
export type Env = { [key: string]: string | undefined };
// the value a name had before this list set it (undefined: it was absent)
export type Owned = Map<string, string | undefined>;
export type Row = { name: string; tail: string };
export type Public = { version: string; rows: Row[]; error: string | null };
export type Load = { text: string; vars: Rec; error: string | null };
export type SaveOut = { status: number; body: { error?: string; key?: string; device_env?: Public; saved?: string[] }; names: string[] };

// Constants
// =========

export const FILE_NAME = "device-env.json";
export const NAME_MAX  = 128;
export const VALUE_MAX = 4096;
export const MAX       = 64;
const BODY             = 256 * 1024;
const TAIL             = 4;
const MASK             = 20;
const NAME_RE          = /^[A-Za-z_][A-Za-z0-9_]*$/;

// names systemd sets on a service (systemd.exec, pam_systemd), besides
// the SYSTEMD_ and LISTEN_ prefixes. PATH and HOME are named apart.
const SYSTEMD = new Set([
  "USER", "LOGNAME", "SHELL",
  "INVOCATION_ID", "JOURNAL_STREAM",
  "NOTIFY_SOCKET",
  "WATCHDOG_PID", "WATCHDOG_USEC",
  "PIDFILE", "MANAGERPID",
  "MEMORY_PRESSURE_WATCH", "MEMORY_PRESSURE_WRITE",
  "CREDENTIALS_DIRECTORY", "ENCRYPTED_CREDENTIALS_DIRECTORY",
  "STATE_DIRECTORY", "LOGS_DIRECTORY", "CACHE_DIRECTORY",
  "CONFIGURATION_DIRECTORY", "RUNTIME_DIRECTORY",
  "REMOTE_ADDR", "REMOTE_PORT",
  "XDG_RUNTIME_DIR", "XDG_SESSION_ID", "XDG_SESSION_TYPE",
  "XDG_SESSION_CLASS", "XDG_SESSION_DESKTOP", "XDG_SEAT",
]);

const BAD_FILE = "device-env.json não é um objeto de nomes e textos. Corrija no servidor. Nada pode ser salvo aqui até lá.";
const UNREAD   = "device-env.json não pode ser lido. Corrija no servidor. Nada pode ser salvo aqui até lá.";

// DeviceEnv
// =========

export namespace DeviceEnv {

  // why `name` is refused (null: it can be set). PATH and HOME in any
  // case; the Unii's UNII_; systemd's names and prefixes
  export function why(name: string): string | null {
    if (name.length === 0 || name.length > NAME_MAX || !NAME_RE.test(name)) {
      return "O nome precisa começar com letra ou _, ter só letras, dígitos e _, e no máximo " + NAME_MAX + " caracteres.";
    }
    const upper = name.toUpperCase();
    if (upper === "PATH") {
      return "PATH é reservado. O device não aceita esse nome.";
    }
    if (upper === "HOME") {
      return "HOME é reservado. O device não aceita esse nome.";
    }
    if (upper.startsWith("UNII_")) {
      return "Variáveis do Unii (UNII_) são reservadas.";
    }
    if (upper.startsWith("SYSTEMD_") || upper.startsWith("LISTEN_") || SYSTEMD.has(upper)) {
      return "Variáveis do systemd são reservadas.";
    }
    return null;
  }

  // why `value` is refused (null: it can be stored). Empty is allowed
  export function why_value(value: unknown): string | null {
    if (typeof value !== "string" || value.includes("\0") || value.length > VALUE_MAX) {
      return "O valor precisa ser um texto sem o caractere nulo, com no máximo " + VALUE_MAX + " caracteres.";
    }
    return null;
  }

  // the tail a page may show: the last letters and digits, and only when
  // there are enough that they don't give the value away. Never the value
  export function mask(value: string): string {
    const plain = value.replace(/[^A-Za-z0-9]/g, "");
    return plain.length >= MASK ? plain.slice(-TAIL) : "";
  }

  export function digest(text: string): string {
    return new Bun.CryptoHasher("sha256").update(text).digest("hex");
  }

  export function saved_line(names: string[]): string {
    return "unii: device env saved: " + names.join(", ");
  }

  // the file as stored (missing: an empty list). A bad file names no
  // value. `text` is the bytes the version is of ("": none yet)
  export function load(file: string): Load {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return { text: "", vars: blank(), error: null };
      }
      return { text: "", vars: blank(), error: UNREAD };
    }
    const parsed = DeviceEnv.parse(text);
    return { text, vars: parsed.vars, error: parsed.error };
  }

  export function parse(text: string): { vars: Rec; error: string | null } {
    if (text.trim() === "") {
      return { vars: blank(), error: null };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { vars: blank(), error: BAD_FILE };
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return { vars: blank(), error: BAD_FILE };
    }
    const vars = blank();
    for (const name of Object.keys(data)) {
      const value = (data as { [key: string]: unknown })[name];
      const why = DeviceEnv.why(name) ?? DeviceEnv.why_value(value);
      if (why !== null) {
        return { vars: blank(), error: "A variável " + name + " no arquivo está inválida. Corrija no servidor. Nada pode ser salvo aqui até lá." };
      }
      put(vars, name, value as string);
    }
    return { vars, error: null };
  }

  export function store(file: string, vars: Rec): void {
    const sorted = blank();
    for (const name of Object.keys(vars).sort()) {
      put(sorted, name, vars[name]);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    write_whole(file, JSON.stringify(sorted, null, 2) + "\n", 0o600);
  }

  // the page's list: names and tails, never values
  export function shown(file: string): Public {
    const got = DeviceEnv.load(file);
    const rows = Object.keys(got.vars).sort().map((name): Row => ({ name, tail: DeviceEnv.mask(got.vars[name]) }));
    return { version: DeviceEnv.digest(got.text), rows, error: got.error };
  }

  // a POST (the owner already checked). Nothing is written if it is
  // refused. `names` are the names that changed, never a value
  export async function save(req: Request, file: string): Promise<SaveOut> {
    const refuse = (status: number, error: string, key?: string): SaveOut => ({ status, body: { error, key }, names: [] });
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
      return refuse(415, "As variáveis são salvas como JSON.");
    }
    if (Number(req.headers.get("content-length") ?? 0) > BODY) {
      return refuse(413, "O pedido é grande demais.");
    }
    const text = await req.text();
    if (text.length > BODY) {
      return refuse(413, "O pedido é grande demais.");
    }
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(400, "O pedido não é JSON.");
    }
    if (body?.set === null || typeof body?.set !== "object" || Array.isArray(body.set)) {
      return refuse(400, "Envie set, um objeto de nomes para textos ou null.");
    }
    const got = DeviceEnv.load(file);
    if (got.error !== null) {
      return refuse(409, got.error);
    }
    if (body.version !== DeviceEnv.digest(got.text)) {
      return refuse(409, "As variáveis do device mudaram desde que esta página as leu. Recarregue e salve de novo.");
    }
    const next = blank();
    for (const name of Object.keys(got.vars)) {
      put(next, name, got.vars[name]);
    }
    const names: string[] = [];
    for (const name of Object.keys(body.set as object)) {
      const value = (body.set as { [key: string]: unknown })[name];
      if (value === null) {
        if (Object.hasOwn(next, name)) {
          delete next[name];
          names.push(name);
        }
        continue;
      }
      const why = DeviceEnv.why(name) ?? DeviceEnv.why_value(value);
      if (why !== null) {
        return refuse(400, why, "env." + name);
      }
      if (next[name] === value) {
        continue;
      }
      put(next, name, value as string);
      names.push(name);
    }
    if (Object.keys(next).length > MAX) {
      return refuse(400, "No máximo " + MAX + " variáveis.", "env-new");
    }
    names.sort();
    if (names.length > 0) {
      try {
        DeviceEnv.store(file, next);
      } catch {
        return refuse(500, "Não foi possível gravar as variáveis do device.");
      }
    }
    return { status: 200, body: { device_env: DeviceEnv.shown(file), saved: names }, names };
  }

  // the names the server may send (anything else dropped, no throw)
  export function only(incoming: unknown): Rec {
    const out = blank();
    if (incoming === null || typeof incoming !== "object" || Array.isArray(incoming)) {
      return out;
    }
    for (const name of Object.keys(incoming as object)) {
      const value = (incoming as { [key: string]: unknown })[name];
      if (DeviceEnv.why(name) !== null || DeviceEnv.why_value(value) !== null) {
        continue;
      }
      put(out, name, value as string);
    }
    return out;
  }

  // `next` replaces what `owned` set. A name this list did not set is
  // left as it was. A reserved name is never set and never deleted
  export function apply(env: Env, next: Rec, owned: Owned): void {
    for (const name of [...owned.keys()]) {
      if (Object.hasOwn(next, name)) {
        continue;
      }
      const prev = owned.get(name);
      if (prev === undefined) delete env[name];
      else put(env, name, prev);
      owned.delete(name);
    }
    for (const name of Object.keys(next)) {
      if (DeviceEnv.why(name) !== null || DeviceEnv.why_value(next[name]) !== null) {
        continue;
      }
      if (!owned.has(name)) {
        owned.set(name, Object.hasOwn(env, name) ? env[name] : undefined);
      }
      put(env, name, next[name]);
    }
  }

  // the copy on disk, as the device starts. A bad file applies nothing
  export function boot(env: Env, file: string, owned: Owned): void {
    const got = DeviceEnv.load(file);
    if (got.error !== null) {
      return;
    }
    DeviceEnv.apply(env, got.vars, owned);
  }

  // the server's list, applied and stored. Never throws and never logs
  export function take(env: Env, incoming: unknown, owned: Owned, file: string): void {
    const vars = DeviceEnv.only(incoming);
    DeviceEnv.apply(env, vars, owned);
    try {
      DeviceEnv.store(file, vars);
    } catch {
      // the process has the list; the next start may not. No value here.
    }
  }

  // the socket message, or null when the file must not replace a device's
  // copy (it can't be read as a list)
  export function wire(file: string): { $: "env"; vars: Rec } | null {
    const got = DeviceEnv.load(file);
    if (got.error !== null) {
      return null;
    }
    return { $: "env", vars: got.vars };
  }

}

function blank(): Rec {
  return Object.create(null);
}

// an own property, so the name __proto__ stays a name
function put(obj: { [key: string]: string | undefined }, name: string, value: string): void {
  Object.defineProperty(obj, name, { value, enumerable: true, writable: true, configurable: true });
}
