#!/usr/bin/env bun
// numih-map: gera o mapa de módulos da Numih a partir da cópia de referência
// do workspace (.gitmodules + gitlinks) e do catálogo de portas do devtools
// (infra/ports.yaml, lido no commit que o workspace aponta).
//
// Só lê: git local da cópia de referência e a API do GitHub (gh api, GET).
// Escreve apenas os dois arquivos de saída indicados em --out.
//
// Uso: bun numih-map.ts --workspace <dir> --out <dir> [--offline <dir-fixtures>]

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export type Categoria =
  | "módulo" | "serviço" | "frontend" | "lib" | "infra"
  | "ferramenta" | "action" | "template" | "org"

export interface Submodulo { caminho: string; url: string }

export interface RepoRef { owner: string; nome: string; url: string }

export interface Portas {
  idx?: number
  be_docker?: number
  be_local?: number
  fe_docker?: number
  fe_local?: number
  docker_stable?: number
  local_dev?: number
}

export interface EntradaPortas {
  nome: string
  secao: "modules" | "gateways" | "tools"
  descricao?: string
  depende?: string[]
  has_frontend?: boolean
  has_backend?: boolean
  portas: Portas
}

export interface Modulo {
  nome: string
  caminho: string
  categoria: Categoria
  camadas: string[]
  repo: RepoRef & {
    canonico?: string
    renomeado?: boolean
    arquivado?: boolean
    linguagem?: string | null
    descricao?: string | null
  }
  gitlink: string | null
  portas: EntradaPortas[]
  dev_yaml?: { porta_backend_local: number | null; diverge: boolean } | null
}

// Nome no catálogo de portas que não coincide com o nome do repositório.
export const ALIAS_PORTAS: Record<string, string> = {
  "nm-bk-gateway": "gateway",
  "dev-portal": "devtools",
  "devtools-daemon": "devtools",
  "mcp-http": "devtools",
  "storybook": "components",
  "storybook-test-server": "components",
}

export function parseGitmodules(configList: string): Submodulo[] {
  // Entrada: saída de `git config -f .gitmodules --list`.
  const porNome = new Map<string, Partial<Submodulo>>()
  for (const linha of configList.split("\n")) {
    const m = /^submodule\.(.+)\.(path|url)=(.*)$/.exec(linha.trim())
    if (!m) continue
    const [, nome, chave, valor] = m
    const s = porNome.get(nome) ?? {}
    if (chave === "path") s.caminho = valor
    else s.url = valor
    porNome.set(nome, s)
  }
  const saida: Submodulo[] = []
  for (const s of porNome.values()) {
    if (s.caminho && s.url) saida.push({ caminho: s.caminho, url: s.url })
  }
  return saida.sort((a, b) => a.caminho.localeCompare(b.caminho))
}

export function repoDaUrl(url: string): RepoRef | null {
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m) return null
  return { owner: m[1], nome: m[2], url: `https://github.com/${m[1]}/${m[2]}` }
}

export function categoria(caminho: string): Categoria {
  const topo = caminho.split("/")[0]
  switch (topo) {
    case "modules": return "módulo"
    case "services": return "serviço"
    case "frontend": return "frontend"
    case "libs": return "lib"
    case "infra": return "infra"
    case "tools": return "ferramenta"
    case "actions": return "action"
    case "templates": return "template"
    default: return "org"
  }
}

const base = (caminho: string) => caminho.split("/").pop()!
const norm = (s: string) => s.toLowerCase().replace(/_/g, "-")

export function entradasPortas(doc: any): EntradaPortas[] {
  const saida: EntradaPortas[] = []
  for (const m of doc?.modules ?? []) {
    saida.push({
      nome: m.name, secao: "modules", descricao: m.description,
      depende: m.depends ?? [], has_frontend: m.has_frontend,
      has_backend: m.has_backend,
      portas: { idx: m.idx, ...(m.ports ?? {}) },
    })
  }
  for (const secao of ["gateways", "tools"] as const) {
    for (const t of doc?.[secao] ?? []) {
      const portas: Portas = {}
      if (t.docker_stable != null) portas.docker_stable = t.docker_stable
      if (t.local_dev != null) portas.local_dev = t.local_dev
      saida.push({ nome: t.name, secao, descricao: t.description, portas })
    }
  }
  return saida
}

// Associa cada entrada do catálogo a um submódulo: nome igual, alias explícito
// ou o maior prefixo «<repo>-» (auth-login -> auth; seed-demo-server -> seed-demo).
export function casarPortas(subs: Submodulo[], entradas: EntradaPortas[]) {
  const porSub = new Map<string, EntradaPortas[]>()
  const sobras: EntradaPortas[] = []
  const nomes = subs.map(s => ({ caminho: s.caminho, n: norm(base(s.caminho)) }))
  for (const e of entradas) {
    const alvo = norm(ALIAS_PORTAS[e.nome] ?? e.nome)
    let melhor: { caminho: string; n: string } | undefined
    for (const c of nomes) {
      if (c.n === alvo || alvo.startsWith(c.n + "-")) {
        if (!melhor || c.n.length > melhor.n.length) melhor = c
      }
    }
    if (!melhor) { sobras.push(e); continue }
    const lista = porSub.get(melhor.caminho) ?? []
    lista.push(e)
    porSub.set(melhor.caminho, lista)
  }
  return { porSub, sobras }
}

export function camadas(cat: Categoria, portas: EntradaPortas[], nome: string): string[] {
  const mod = portas.find(p => p.secao === "modules" && norm(p.nome) === norm(nome))
  if (mod) {
    const c: string[] = []
    if (mod.has_backend !== false) c.push("backend")
    if (mod.has_frontend) c.push("frontend")
    return c
  }
  if (cat === "lib") return [/^dp-ft-/.test(nome) ? "frontend" : "backend"]
  if (cat === "frontend") return ["frontend"]
  if (cat === "serviço") return ["backend"]
  return []
}

// Porta do backend local declarada no module.dev.yaml do módulo.
export function portaDevYaml(doc: any): number | null {
  const v = doc?.backend?.graphql?.localPort
    ?? doc?.routing?.portMappings?.[0]?.localPort
  return typeof v === "number" ? v : null
}

export function renderMarkdown(mapa: any): string {
  const l: string[] = []
  l.push("# Mapa de módulos da Numih")
  l.push("")
  l.push("> Gerado por `numih-map` — não edite à mão. Regenere com `numih-sync map`.")
  l.push("")
  l.push(`- workspace: \`${mapa.workspace_sha}\` (Numih/workspace, main)`)
  l.push(`- catálogo de portas: \`${mapa.fonte_portas}\``)
  l.push(`- submódulos: ${mapa.modulos.length}`)
  l.push("")
  l.push("Portas: BE local (humano) = 8100+idx · BE Docker / agente = 9000+idx · FE Docker / agente = 10000+idx · FE local (humano) = 11000+idx (regra `20-ports-catalog`).")
  l.push("")
  const cats: Categoria[] = ["módulo", "serviço", "frontend", "lib", "infra", "ferramenta", "action", "template", "org"]
  for (const c of cats) {
    const lista = mapa.modulos.filter((m: Modulo) => m.categoria === c)
    if (!lista.length) continue
    l.push(`## ${c[0].toUpperCase() + c.slice(1)} (${lista.length})`)
    l.push("")
    l.push("| Caminho | Repositório | Camadas | idx | Portas | Depende de |")
    l.push("|---|---|---|---|---|---|")
    for (const m of lista as Modulo[]) {
      const repo = m.repo.renomeado ? `[${m.repo.canonico}](https://github.com/${m.repo.canonico}) (URL antiga: ${m.repo.owner}/${m.repo.nome})` : `[${m.repo.owner}/${m.repo.nome}](${m.repo.url})`
      const arq = m.repo.arquivado ? " **(arquivado)**" : ""
      const idx = m.portas.find(p => p.portas.idx != null)?.portas.idx ?? ""
      const portas = m.portas.map(p => {
        const q = p.portas
        const partes = Object.entries(q).filter(([k]) => k !== "idx").map(([k, v]) => `${k} ${v}`)
        return `${p.nome}: ${partes.join(", ")}`
      }).join("<br>")
      // Dependências de todas as entradas do submódulo, sem ele mesmo
      // (auth-login depende de auth, mas ambos são o submódulo auth).
      const dep = [...new Set(m.portas.flatMap(p => p.depende ?? []))]
        .filter(d => norm(d) !== norm(m.nome)).join(", ")
      l.push(`| \`${m.caminho}\` | ${repo}${arq} | ${m.camadas.join(", ")} | ${idx} | ${portas} | ${dep} |`)
    }
    l.push("")
  }
  if (mapa.portas_sem_submodulo.length) {
    l.push("## No catálogo de portas, sem submódulo no workspace")
    l.push("")
    for (const e of mapa.portas_sem_submodulo as EntradaPortas[]) {
      const q = Object.entries(e.portas).map(([k, v]) => `${k} ${v}`).join(", ")
      l.push(`- \`${e.nome}\` (${e.secao}): ${q}`)
    }
    l.push("")
  }
  l.push("## Avisos")
  l.push("")
  if (!mapa.avisos.length) l.push("Nenhum.")
  for (const a of mapa.avisos) l.push(`- ${a}`)
  l.push("")
  return l.join("\n")
}

// ---------------------------------------------------------------- execução

function run(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 << 20 })
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.status === 0 ? "" : r.stderr ?? "") }
}

// Leitura do GitHub, só GET. Em --offline lê fixtures <dir>/<chave>.json.
function ghGet(path: string, offline?: string): any | null {
  if (offline) {
    const f = join(offline, path.replace(/[^A-Za-z0-9._-]+/g, "_") + ".json")
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null
  }
  const r = run("gh", ["api", "-X", "GET", path])
  if (!r.ok) return null
  try { return JSON.parse(r.out) } catch { return null }
}

function conteudo(owner: string, nome: string, arquivo: string, ref: string, offline?: string): string | null {
  const j = ghGet(`repos/${owner}/${nome}/contents/${arquivo}?ref=${ref}`, offline)
  if (!j?.content) return null
  return Buffer.from(j.content, "base64").toString("utf8")
}

export function gerar(workspace: string, offline?: string) {
  const avisos: string[] = []
  const wsSha = run("git", ["rev-parse", "HEAD"], workspace).out.trim()
  const subs = parseGitmodules(run("git", ["config", "-f", ".gitmodules", "--list"], workspace).out)
  const gitlinks = new Map<string, string>()
  for (const linha of run("git", ["ls-tree", "-r", "HEAD"], workspace).out.split("\n")) {
    const m = /^160000 commit ([0-9a-f]+)\t(.+)$/.exec(linha)
    if (m) gitlinks.set(m[2], m[1])
  }

  const devtools = gitlinks.get("tools/devtools")
  let doc: any = null
  let fonte = "indisponível"
  if (devtools) {
    const txt = conteudo("Numih", "devtools", "infra/ports.yaml", devtools, offline)
    if (txt) { doc = Bun.YAML.parse(txt); fonte = `Numih/devtools@${devtools.slice(0, 12)}:infra/ports.yaml` }
  }
  if (!doc) avisos.push("Catálogo de portas não lido (sem gitlink de tools/devtools ou sem acesso ao GitHub).")

  const entradas = entradasPortas(doc)
  const { porSub, sobras } = casarPortas(subs, entradas)

  const modulos: Modulo[] = []
  for (const s of subs) {
    const ref = repoDaUrl(s.url)
    const nome = base(s.caminho)
    if (!ref) { avisos.push(`URL não reconhecida em \`${s.caminho}\`: ${s.url}`); continue }
    const gl = gitlinks.get(s.caminho) ?? null
    if (!gl) avisos.push(`\`${s.caminho}\` está no .gitmodules mas não tem gitlink na main do workspace.`)
    const meta = ghGet(`repos/${ref.owner}/${ref.nome}`, offline)
    const repo: Modulo["repo"] = { ...ref }
    if (meta) {
      repo.canonico = meta.full_name
      repo.renomeado = meta.full_name.toLowerCase() !== `${ref.owner}/${ref.nome}`.toLowerCase()
      repo.arquivado = !!meta.archived
      repo.linguagem = meta.language ?? null
      repo.descricao = meta.description ?? null
      if (repo.renomeado && /^numih-archive\//i.test(meta.full_name)) {
        avisos.push(`\`${s.caminho}\` aponta para ${ref.owner}/${ref.nome}, movido para ${meta.full_name} (o README manda remover do workspace o repositório arquivado).`)
      } else if (repo.renomeado) {
        avisos.push(`\`${s.caminho}\` aponta para ${ref.owner}/${ref.nome}, que hoje é ${meta.full_name} (renomeado ou movido; o README exige caminho e URL com o nome atual).`)
      }
      if (repo.arquivado) avisos.push(`\`${s.caminho}\` aponta para repositório arquivado (${meta.full_name}).`)
    } else {
      avisos.push(`Sem metadados do GitHub para ${ref.owner}/${ref.nome}.`)
    }
    if (norm(nome) !== norm(ref.nome) && !repo.renomeado) {
      avisos.push(`\`${s.caminho}\`: caminho difere do nome do repositório (${ref.owner}/${ref.nome}).`)
    }
    const cat = categoria(s.caminho)
    const portas = porSub.get(s.caminho) ?? []
    const m: Modulo = {
      nome, caminho: s.caminho, categoria: cat,
      camadas: camadas(cat, portas, nome), repo, gitlink: gl, portas,
    }
    const portaMod = portas.find(p => p.secao === "modules" && norm(p.nome) === norm(nome))
    if (portaMod?.portas.be_local != null && gl) {
      const owner = repo.canonico?.split("/")[0] ?? ref.owner
      const rnome = repo.canonico?.split("/")[1] ?? ref.nome
      const txt = conteudo(owner, rnome, "module.dev.yaml", gl, offline)
      if (txt) {
        let p: number | null = null
        try { p = portaDevYaml(Bun.YAML.parse(txt)) } catch { avisos.push(`\`${s.caminho}\`: module.dev.yaml inválido.`) }
        const diverge = p != null && p !== portaMod.portas.be_local
        m.dev_yaml = { porta_backend_local: p, diverge }
        if (diverge) avisos.push(`\`${s.caminho}\`: module.dev.yaml usa a porta ${p}, mas o catálogo dá be_local ${portaMod.portas.be_local} (idx ${portaMod.portas.idx}). O catálogo é a fonte da verdade.`)
      } else {
        m.dev_yaml = null
      }
    }
    modulos.push(m)
  }

  return {
    workspace_sha: wsSha,
    fonte_portas: fonte,
    modulos,
    portas_sem_submodulo: sobras,
    avisos,
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
  const workspace = opt("--workspace")
  const out = opt("--out")
  if (!workspace || !out) {
    console.error("uso: numih-map.ts --workspace <dir> --out <dir> [--offline <dir>]")
    process.exit(2)
  }
  const mapa = gerar(workspace, opt("--offline"))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, "modulos.json"), JSON.stringify(mapa, null, 2) + "\n")
  writeFileSync(join(out, "MODULOS.md"), renderMarkdown(mapa))
  console.log(`mapa: ${mapa.modulos.length} submódulos, ${mapa.portas_sem_submodulo.length} entradas de porta sem submódulo, ${mapa.avisos.length} avisos -> ${out}`)
}
