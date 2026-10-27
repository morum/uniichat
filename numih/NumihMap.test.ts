import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import {
  parseGitmodules, repoDaUrl, categoria, casarPortas, entradasPortas,
  camadas, portaDevYaml, gerar, renderMarkdown,
  segmentoSeguro, nomeCompletoSeguro, caminhoGhSeguro, ghGet,
} from "./bin/numih-map"

const PORTS = {
  modules: [
    { idx: 3, name: "auth", has_frontend: true, depends: [], ports: { be_docker: 9003, be_local: 8103, fe_docker: 10003, fe_local: 11003 } },
    { idx: 4, name: "auth-login", has_frontend: true, has_backend: false, depends: ["auth"], ports: { fe_docker: 10004, fe_local: 11004 } },
    { idx: 45, name: "agents", has_frontend: true, depends: [], ports: { be_docker: 9045, be_local: 8145, fe_docker: 10045, fe_local: 11045 } },
    { idx: 24, name: "edge", has_frontend: true, depends: [], ports: { be_local: 8124 } },
  ],
  gateways: [{ name: "nm-bk-gateway", docker_stable: 8080 }],
  tools: [
    { name: "ai-assistente-mcp", docker_stable: 4447, local_dev: 4448 },
    { name: "seed-demo-server", local_dev: 12002 },
  ],
}

describe("numih-map", () => {
  test("lê .gitmodules nos três formatos de URL", () => {
    const subs = parseGitmodules([
      "submodule.modules/auth.path=modules/auth",
      "submodule.modules/auth.url=git@github.com:numih/auth.git",
      "submodule.services/gateway.path=services/gateway",
      "submodule.services/gateway.url=https://github.com/Numih/gateway.git",
      "submodule.modules/crm.path=modules/crm",
      "submodule.modules/crm.url=ssh://git@github.com/Numih/crm",
      "submodule.modules/crm.branch=main",
    ].join("\n"))
    expect(subs.map(s => s.caminho)).toEqual(["modules/auth", "modules/crm", "services/gateway"])
    expect(subs.map(s => repoDaUrl(s.url)?.nome)).toEqual(["auth", "crm", "gateway"])
    expect(repoDaUrl("ssh://git@github.com/Numih/numih.com.git")?.nome).toBe("numih.com")
    expect(repoDaUrl("https://gitlab.com/x/y")).toBeNull()
  })

  test("recusa owner/nome com caracteres fora de [A-Za-z0-9._-]", () => {
    for (const url of [
      "git@github.com:Numih/x?ref=1.git",
      "https://github.com/Numih/a#b",
      "https://github.com/Num ih/x",
      "https://github.com/Numih/..",
      "https://github.com/./x",
      "git@github.com:Numih/x%2F..",
      "ssh://git@github.com/Numih/a;b",
      "https://github.com/Numih/a\nb",
    ]) expect(repoDaUrl(url)).toBeNull()
    expect(repoDaUrl("git@github.com:Numih/a_b-c.d.git")).toEqual({ owner: "Numih", nome: "a_b-c.d", url: "https://github.com/Numih/a_b-c.d" })
    expect(segmentoSeguro("..")).toBe(false)
    expect(segmentoSeguro(".")).toBe(false)
    expect(segmentoSeguro("a..b")).toBe(true)
    expect(nomeCompletoSeguro("Numih/mcp")).toEqual(["Numih", "mcp"])
    for (const f of ["Numih/x?y", "Numih", "a/b/c", "Numih/..", "", null, 3]) expect(nomeCompletoSeguro(f)).toBeNull()
    const D = "d".repeat(40)
    expect(caminhoGhSeguro("repos/Numih/agents")).toBe(true)
    expect(caminhoGhSeguro(`repos/Numih/devtools/contents/infra/ports.yaml?ref=${D}`)).toBe(true)
    for (const p of ["repos/Numih/a?x=1", "repos/Numih/..", "repos/Numih/a/contents/../x?ref=" + D,
      "repos/Numih/a/contents/x?ref=main", "user", "repos/Numih/a/collaborators"]) expect(caminhoGhSeguro(p)).toBe(false)
    // a barreira vale dentro do ghGet, antes de qualquer leitura (inclusive offline)
    expect(() => ghGet("repos/Numih/a?x=1", tmpdir())).toThrow("caminho do gh api recusado")
    expect(ghGet("repos/Numih/inexistente-numih-map-teste", tmpdir())).toBeNull()
  })

  test("modo online: URL hostil nunca chega ao gh, e full_name hostil é recusado", () => {
    const t = mkdtempSync(join(tmpdir(), "numih-map-gh-"))
    const PATH = process.env.PATH, GHC = process.env.GH_CONFIG_DIR
    try {
      const ws = join(t, "ws"), bin = join(t, "bin"), log = join(t, "gh.log")
      mkdirSync(ws); mkdirSync(bin)
      // gh falso: registra os argumentos; nunca usa o gh nem as credenciais reais.
      writeFileSync(join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in *repos/Numih/bom) printf '{"full_name":"Numih/x?ref=mau","archived":false}';; *) exit 1;; esac\n`)
      chmodSync(join(bin, "gh"), 0o755)
      const env = { ...process.env, GIT_CONFIG_GLOBAL: join(t, "gc"), GIT_CONFIG_NOSYSTEM: "1" }
      const git = (...a: string[]) => {
        const r = spawnSync("git", ["-C", ws, ...a], { encoding: "utf8", env })
        if (r.status !== 0) throw new Error(r.stderr)
      }
      git("init", "-q", "-b", "main")
      writeFileSync(join(ws, ".gitmodules"), [
        '[submodule "modules/mau"]', "\tpath = modules/mau", "\turl = https://github.com/Numih/x?ref=1",
        '[submodule "modules/bom"]', "\tpath = modules/bom", "\turl = https://github.com/Numih/bom.git",
      ].join("\n") + "\n")
      git("add", ".gitmodules")
      git("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-qm", "ws")
      process.env.PATH = `${bin}:${PATH}`
      process.env.GH_CONFIG_DIR = join(t, "gh")
      const mapa = gerar(ws)
      const chamadas = existsSync(log) ? readFileSync(log, "utf8") : ""
      expect(chamadas).toBe("api -X GET repos/Numih/bom\n")
      expect(mapa.modulos.map(m => m.caminho)).toEqual(["modules/bom"])
      expect(mapa.modulos[0].repo.canonico).toBeUndefined()
      const avisos = mapa.avisos.join("\n")
      expect(avisos).toContain("URL não reconhecida em `modules/mau`")
      expect(avisos).toContain('`modules/bom`: nome devolvido pelo GitHub recusado ("Numih/x?ref=mau")')
    } finally {
      process.env.PATH = PATH
      if (GHC === undefined) delete process.env.GH_CONFIG_DIR; else process.env.GH_CONFIG_DIR = GHC
      rmSync(t, { recursive: true, force: true })
    }
  })

  test("categoria pelo diretório de topo", () => {
    expect(categoria("modules/agents")).toBe("módulo")
    expect(categoria("libs/dp-bk-http")).toBe("lib")
    expect(categoria(".github")).toBe("org")
    expect(categoria("tools/devtools")).toBe("ferramenta")
  })

  test("casa portas por nome, alias, prefixo e sobra o que não tem submódulo", () => {
    const subs = ["modules/auth", "modules/agents", "services/gateway", "modules/ai_assistente", "tools/seed", "tools/seed-demo"]
      .map(caminho => ({ caminho, url: "" }))
    const { porSub, sobras } = casarPortas(subs, entradasPortas(PORTS))
    expect(porSub.get("modules/auth")!.map(e => e.nome)).toEqual(["auth", "auth-login"])
    expect(porSub.get("services/gateway")!.map(e => e.nome)).toEqual(["nm-bk-gateway"])
    expect(porSub.get("modules/ai_assistente")!.map(e => e.nome)).toEqual(["ai-assistente-mcp"])
    // maior prefixo: seed-demo-server é do seed-demo, não do seed
    expect(porSub.get("tools/seed-demo")!.map(e => e.nome)).toEqual(["seed-demo-server"])
    expect(porSub.get("tools/seed")).toBeUndefined()
    expect(sobras.map(e => e.nome)).toEqual(["edge"])
  })

  test("camadas vêm do catálogo; sem catálogo, da categoria", () => {
    const e = entradasPortas(PORTS)
    expect(camadas("módulo", e.filter(x => x.nome.startsWith("auth")), "auth")).toEqual(["backend", "frontend"])
    expect(camadas("lib", [], "dp-ft-labels")).toEqual(["frontend"])
    expect(camadas("lib", [], "dp-bk-http")).toEqual(["backend"])
  })

  test("porta do module.dev.yaml", () => {
    expect(portaDevYaml({ backend: { graphql: { localPort: 8140 } } })).toBe(8140)
    expect(portaDevYaml({ routing: { portMappings: [{ localPort: 8116 }] } })).toBe(8116)
    expect(portaDevYaml({})).toBeNull()
  })

  test("gera mapa ponta a ponta com repositório git e fixtures, e acusa divergências", () => {
    const t = mkdtempSync(join(tmpdir(), "numih-map-"))
    try {
      const ws = join(t, "ws")
      const fx = join(t, "fx")
      mkdirSync(ws); mkdirSync(fx)
      const git = (...a: string[]) => {
        const r = spawnSync("git", ["-C", ws, ...a], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: join(t, "gc"), GIT_CONFIG_NOSYSTEM: "1" } })
        if (r.status !== 0) throw new Error(r.stderr)
        return r.stdout
      }
      git("init", "-q", "-b", "main")
      writeFileSync(join(ws, ".gitmodules"), [
        '[submodule "modules/agents"]', "\tpath = modules/agents", "\turl = git@github.com:numih/agents.git",
        '[submodule "tools/devtools"]', "\tpath = tools/devtools", "\turl = https://github.com/Numih/devtools.git",
        '[submodule "modules/ai_assistente"]', "\tpath = modules/ai_assistente", "\turl = git@github.com:Numih/ai_assistente.git",
        '[submodule "libs/nusip"]', "\tpath = libs/nusip", "\turl = git@github.com:Numih/nusip.git",
      ].join("\n") + "\n")
      const A = "a".repeat(40), D = "d".repeat(40), M = "e".repeat(40)
      git("add", ".gitmodules")
      git("update-index", "--add", "--cacheinfo", `160000,${A},modules/agents`)
      git("update-index", "--add", "--cacheinfo", `160000,${D},tools/devtools`)
      git("update-index", "--add", "--cacheinfo", `160000,${M},modules/ai_assistente`)
      git("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-qm", "ws")
      const fixture = (path: string, data: unknown) =>
        writeFileSync(join(fx, path.replace(/[^A-Za-z0-9._-]+/g, "_") + ".json"), JSON.stringify(data))
      const b64 = (s: string) => Buffer.from(s).toString("base64")
      fixture(`repos/Numih/devtools/contents/infra/ports.yaml?ref=${D}`, { content: b64(JSON.stringify(PORTS)) })
      fixture("repos/numih/agents", { full_name: "Numih/agents", archived: false, language: "Go", description: null })
      fixture("repos/Numih/devtools", { full_name: "Numih/devtools", archived: false })
      fixture("repos/Numih/ai_assistente", { full_name: "Numih/mcp", archived: false })
      fixture(`repos/Numih/agents/contents/module.dev.yaml?ref=${A}`, { content: b64("backend:\n  graphql:\n    localPort: 8140\n") })
      const mapa = gerar(ws, fx)
      expect(mapa.modulos.map(m => m.caminho)).toEqual(["libs/nusip", "modules/agents", "modules/ai_assistente", "tools/devtools"])
      const agents = mapa.modulos.find(m => m.nome === "agents")!
      expect(agents.gitlink).toBe(A)
      expect(agents.dev_yaml).toEqual({ porta_backend_local: 8140, diverge: true })
      expect(mapa.modulos.find(m => m.nome === "ai_assistente")!.repo.renomeado).toBe(true)
      const avisos = mapa.avisos.join("\n")
      expect(avisos).toContain("`modules/agents`: module.dev.yaml usa a porta 8140, mas o catálogo dá be_local 8145")
      expect(avisos).toContain("hoje é Numih/mcp")
      expect(avisos).toContain("`libs/nusip` está no .gitmodules mas não tem gitlink")
      // Cabeçalho: gitlinks reais (3) e seções do .gitmodules (4, libs/nusip sem gitlink)
      expect(mapa.total_gitlinks).toBe(3)
      expect(mapa.total_secoes_gitmodules).toBe(4)
      const md = renderMarkdown(mapa)
      expect(md).toContain("- submódulos (gitlinks na main do workspace): 3\n")
      expect(md).toContain("- seções no `.gitmodules`: 4 (sem gitlink: `libs/nusip`)\n")
      expect(md).toContain("| `modules/agents` | [numih/agents](https://github.com/numih/agents) | backend, frontend | 45 |")
      expect(md).toContain("- `edge` (modules)")
      // auth-login depende de auth, mas o submódulo auth não depende de si mesmo
      const auth = renderMarkdown({ ...mapa, modulos: [{ nome: "auth", caminho: "modules/auth", categoria: "módulo", camadas: [], repo: { owner: "numih", nome: "auth", url: "u" }, gitlink: null, portas: entradasPortas(PORTS).filter(e => e.nome.startsWith("auth")) }] })
      expect(auth).toMatch(/\| `modules\/auth` .* \| 3 \| .* \|  \|/)
      // determinístico: duas gerações iguais
      expect(JSON.stringify(gerar(ws, fx))).toBe(JSON.stringify(mapa))
      // gitlink sem seção no .gitmodules: conta como gitlink e gera aviso
      git("update-index", "--add", "--cacheinfo", `160000,${"f".repeat(40)},modules/orfao`)
      git("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-qm", "órfão")
      const m2 = gerar(ws, fx)
      expect(m2.total_gitlinks).toBe(4)
      expect(m2.total_secoes_gitmodules).toBe(4)
      expect(m2.avisos.join("\n")).toContain("`modules/orfao` tem gitlink na main mas não está no .gitmodules.")
    } finally {
      rmSync(t, { recursive: true, force: true })
    }
  })
})
