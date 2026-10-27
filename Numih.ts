// Numih
// =====
// The Numih rules a subagent of a Numih task gets in its system prompt
// (Tools.ask; the spawn tool's `numih`), whatever its vendor: Claude
// Code's systemPrompt (ClaudeSub.options) and the Cursor CLI's rule
// .cursor/rules/unii.mdc (Cursor.room) both hold Ask.system. Read at
// each call from the reference copy of Numih/cursor that numih-sync keeps
// (config numih_home, else $NUMIH_HOME, else ~/.unii/numih:
// Machine.numih_home, the dir the cursor's skills are read from too;
// numih/README.md): the
// core rules whole, the text the team gets (dist/managed/CLAUDE.md,
// decided with the user in P122), and an index of the rules by path
// (dist/claude-plugin/rules-global), each read whole by the agent before
// it edits a file it matches. A pack above config numih_rules_max bytes
// is not cut: none is injected, and a notice says why and what to read
// instead; so does one for a pack missing. Each call logs the bytes
// injected (Numih.log_line). The cursor's skills reach every task, Numih
// or not, as the device's (Machine.skills).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as config from "./Config.ts";
import { Machine } from "./Machine.ts";

// where the pack is read (the same dir a device's skills are read from:
// Machine.numih_home) and its most bytes; a test points them elsewhere
export const NUMIH = { home: Machine.numih_home(os.homedir(), process.env, config.NUMIH_SET), max: config.NUMIH_RULES_MAX };

// under numih_home: the core rules, the rules by path (the core's own
// file among them is left out: it is CORE, whole), the copy's git dir
export const CORE      = "cursor/dist/managed/CLAUDE.md";
export const BY_PATH   = "cursor/dist/claude-plugin/rules-global";
const CORE_RULE        = "_numih-nucleo.md";
const GIT              = "cursor/.git";

// the rule by path read for every test, whatever file it matches
const TESTS_RULE = "25-isolamento-de-testes";

// what a Numih subagent's system prompt gets: its text (as injected, no
// blank at its ends), its size in bytes (UTF-8, of that text), whether
// it is the rules (else a notice), the cursor's commit ("" unknown), and
// why not, if not
export type Pack = { text: string; bytes: number; injected: boolean; commit: string; why: string };

export namespace Numih {

  // the pack as of now, in `home`, at most `max` bytes
  export function pack(home: string = NUMIH.home, max: number = NUMIH.max): Pack {
    const core = path.join(home, CORE);
    let text = "";
    try {
      text = fs.readFileSync(core, "utf8");
    } catch (err: any) {
      return Numih.missing(home, err?.code === "ENOENT" ? core + " não existe" : core + " não pôde ser lido (" + String(err?.code ?? err?.message ?? err) + ")");
    }
    if (text.trim() === "") {
      return Numih.missing(home, core + " está vazio");
    }
    const commit = Numih.commit(home);
    // as injected (Tools.ask): no blank around it, so `bytes` is the
    // injected text's
    const rules = Numih.head(home, commit) + "\n\n" + Numih.index(home) + "\n\n## Núcleo (sempre ativo)\n\n" + text.trim();
    const bytes = Buffer.byteLength(rules, "utf8");
    if (bytes > max) {
      return Numih.notice(home, commit, "o pacote tem " + bytes + " bytes e passa do teto de " + max + " bytes (configuração numih_rules_max)", true);
    }
    return { text: rules, bytes, injected: true, commit, why: "" };
  }

  export function missing(home: string, why: string): Pack {
    return Numih.notice(home, "", why, false);
  }

  // a notice instead of the rules: why, and what to do. Too big: the
  // files are there, to read whole; missing: no change to a Numih repo
  export function notice(home: string, commit: string, why: string, there: boolean): Pack {
    const core = path.join(home, CORE);
    const rules = path.join(home, BY_PATH);
    const todo = there
      ? "Antes de alterar qualquer repositório da Numih, leia por inteiro " + core + " (o núcleo das regras) e, antes de editar cada arquivo, a regra por caminho que case com ele, em " + rules + "."
      : "Sem elas, não faça commit, push nem PR em repositório da Numih: relate ao Unii que faltam as regras (ele as obtém com `numih-sync sync`, que mantém a cópia em " + home + ").";
    const text = "# Regras da Numih\n\nAs regras da Numih não foram injetadas neste prompt: " + why + ". " + todo;
    return { text, bytes: Buffer.byteLength(text, "utf8"), injected: false, commit, why };
  }

  // the cursor copy's commit, short; "" if it can't be read (from the
  // git dir's files: no git runs)
  export function commit(home: string): string {
    const git = path.join(home, GIT);
    try {
      const head = fs.readFileSync(path.join(git, "HEAD"), "utf8").trim();
      const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
      if (ref !== undefined && ref.split("/").includes("..")) {
        return "";
      }
      if (ref === undefined) {
        return /^[0-9a-f]{40,64}$/.test(head) ? head.slice(0, 7) : "";
      }
      let sha = "";
      try {
        sha = fs.readFileSync(path.join(git, ref), "utf8").trim();
      } catch {
        const packed = fs.readFileSync(path.join(git, "packed-refs"), "utf8");
        sha = packed.split("\n").find((l) => l.endsWith(" " + ref))?.split(" ")[0] ?? "";
      }
      return /^[0-9a-f]{40,64}$/.test(sha) ? sha.slice(0, 7) : "";
    } catch {
      return "";
    }
  }

  // what the rules are and how they meet the user's
  export function head(home: string, commit: string): string {
    const from = "do repositório Numih/cursor (" + (commit === "" ? "commit desconhecido" : "commit " + commit) + "), na cópia de referência em " + path.join(home, "cursor");
    return [
      "# Regras da Numih",
      "",
      "Esta tarefa é da Numih: siga as regras abaixo em todo trabalho nos repositórios da Numih (github.com/Numih). Elas vêm " + from + ". O núcleo está inteiro, no mesmo texto que a equipe recebe (" + CORE.replace(/^cursor\//, "") + ").",
      "",
      "Onde as regras citam ferramentas do Claude Code (plugin, ganchos, Read, Edit, Bash) ou a memória claude-mem, use as suas ferramentas e a memória do Unii. As instruções do usuário, depois deste bloco, dizem como o Unii trabalha (PR, merge, Linear): siga as duas e, se uma contrariar a outra, pare e relate ao Unii.",
    ].join("\n");
  }

  // the rules by path, one line each: name, title, path patterns, file
  export function index(home: string): string {
    const dir = path.join(home, BY_PATH);
    const top = "## Regras por caminho\n\nAntes de criar ou editar um arquivo que case com um dos padrões abaixo, leia por inteiro a regra indicada. A " + TESTS_RULE + " vale para todo teste que você criar ou rodar.\n\n";
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== CORE_RULE).sort();
    } catch {
      return top + "Índice indisponível: " + dir + " não pôde ser lido.";
    }
    if (names.length === 0) {
      return top + "Índice indisponível: " + dir + " não tem nenhuma regra.";
    }
    const lines = names.map((name) => {
      const file = path.join(dir, name);
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {}
      const { title, paths } = Numih.rule_head(text);
      const shown = paths.length === 0 ? "sem padrão de caminho" : paths.map((p) => "`" + p.replace(/`/g, "'") + "`").join(", ");
      return "- " + name.replace(/\.md$/, "") + (title === "" ? "" : " (" + title + ")") + ": " + shown + ". Arquivo: " + file;
    });
    return top + lines.join("\n");
  }

  // a rule's title (its first "# " line) and its frontmatter's `paths:`
  // (or `globs:`) list
  export function rule_head(text: string): { title: string; paths: string[] } {
    const lines = text.split(/\r?\n/);
    const paths: string[] = [];
    let body = 0;
    if (lines[0]?.trim() === "---") {
      const end = lines.findIndex((l, k) => k > 0 && l.trim() === "---");
      body = end < 0 ? 0 : end + 1;
      let inside = false;
      for (const line of lines.slice(1, end < 0 ? 1 : end)) {
        if (/^(paths|globs):\s*$/.test(line)) {
          inside = true;
          continue;
        }
        const item = /^\s+-\s+(.*)$/.exec(line);
        if (inside && item !== null) {
          const p = item[1].trim().replace(/^["']|["']$/g, "");
          if (p !== "") {
            paths.push(p);
          }
          continue;
        }
        inside = false;
      }
    }
    const title = lines.slice(body).find((l) => /^# \S/.test(l))?.slice(2).trim() ?? "";
    return { title: title.replace(/\s+/g, " "), paths };
  }

  // the server's log line of a call's pack
  export function log_line(name: string, pack: Pack): string {
    return pack.injected
      ? "unii: regras da Numih para " + name + ": " + pack.bytes + " bytes injetados (cursor " + (pack.commit || "commit desconhecido") + ")"
      : "unii: regras da Numih para " + name + ": não injetadas (" + pack.why + "); aviso de " + pack.bytes + " bytes no lugar";
  }

}
