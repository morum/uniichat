// DeviceEnv.ui.test
// =================
// The settings markup lists a name and a tail, never a stored value.

import { expect, test } from "bun:test";
import { settings_html } from "./web/src/Html.ts";
import type { Page } from "./Settings.ts";

const VALOR = "m".repeat(24) + "Zz9q";

test("a p\u00e1gina mostra o nome e a cauda, n\u00e3o o valor", () => {
  const page = {
    version: "v",
    settings: [],
    keys: [],
    profiles: {},
    error: null,
    device_env: { version: "e", rows: [{ name: "APP_TOKEN", tail: "Zz9q" }], error: null },
  } as Page;
  const html = settings_html(page);
  expect(html).toContain("Vari\u00e1veis do device");
  expect(html).toContain("APP_TOKEN");
  expect(html).toContain("type=\"password\"");
  expect(html).toContain("Zz9q");
  expect(html.includes(VALOR)).toBe(false);
  expect(html).toContain("Nova vari\u00e1vel");
  expect(html).toContain("Remover");
});

test("erro de arquivo n\u00e3o traz valor", () => {
  const page = {
    version: "v",
    settings: [],
    keys: [],
    profiles: null,
    error: null,
    device_env: { version: "e", rows: [], error: "device-env.json n\u00e3o pode ser lido. Corrija no servidor. Nada pode ser salvo aqui at\u00e9 l\u00e1." },
  } as Page;
  const html = settings_html(page);
  expect(html).toContain("n\u00e3o pode ser lido");
  expect(html.includes("env_new_name")).toBe(false);
});
