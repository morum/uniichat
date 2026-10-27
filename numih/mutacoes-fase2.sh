#!/usr/bin/env bash
# Mutações da fase 2 (regras da Numih no prompt dos agentes): cada uma altera
# UM trecho de Numih.ts, Tools.ts, Machine.ts, Pipeline.ts ou Config.ts numa
# cópia temporária do repositório e roda Numih.test.ts e Labels.test.ts. Uma
# mutação é «morta» quando o teste falha; «SOBREVIVEU» quando ainda passa.
# Os testes já isolam UNII_DIR, UNII_NUMIH_HOME e NUMIH_HOME (TestSetup.ts):
# nada lê as cópias reais em ~/.unii/numih.
#
# Uso: bash numih/mutacoes-fase2.sh [ID...]     (sem IDs: todas)
# Saída: 0 se todas morreram; 1 se alguma sobreviveu ou não se aplicou.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARALELO="${NUMIH_MUT_PARALELO:-4}"
BASE="$(mktemp -d "${TMPDIR:-/tmp}/numih-mutacoes-fase2.XXXXXX")"
trap 'rm -rf "$BASE"' EXIT
MODULOS="$(readlink -f "$RAIZ/node_modules" 2>/dev/null || true)"
if [ -z "$MODULOS" ] || [ ! -d "$MODULOS" ]; then
  echo "falta node_modules em $RAIZ (rode bun install)" >&2
  exit 1
fi

# ID <TAB> arquivo (relativo à raiz) <TAB> trecho original <TAB> trecho mutado
MUTACOES="$(cat <<'TABELA'
R1	Tools.ts	    if (agent.role.numih) {	    if (false) {
R2	Tools.ts	+ pack.text;	+ "";
R3	Tools.ts	      console.log(Numih.log_line(agent.name, pack));	      Numih.log_line(agent.name, pack);
R4	Tools.ts	(role.numih ? SUB_NUMIH : "")	("")
R5	Tools.ts	numih: sub[3] !== undefined	numih: false
R6	Tools.ts	labels, args.numih === true)	labels, args.numih !== undefined)
R7	Tools.ts	own === "" ? sub : sub + 	own === "" ? sub : SUB + 
R8	Tools.ts	if (args.numih !== undefined && typeof args.numih !== "boolean") {	if (false) {
R9	Tools.ts	label: Tools.label_clean(sub[4] ?? "")	label: Tools.label_clean(sub[3] ?? "")
P1	Numih.ts	    if (bytes > max) {	    if (bytes >= max) {
P2	Numih.ts	n.endsWith(".md") && n !== CORE_RULE	n.endsWith(".md")
P3	Numih.ts	+ text.trim();	+ text.trim().slice(0, 40);
P4	Numih.ts	    const bytes = Buffer.byteLength(rules, "utf8");	    const bytes = rules.length;
P5	Numih.ts	    if (text.trim() === "") {	    if (false) {
P6	Numih.ts	l.endsWith(" " + ref)	l.endsWith(" " + ref + "x")
P7	Numih.ts	ref.split("/").includes("..")	false
P8	Numih.ts	.replace(/^["']|["']$/g, "")	.trim()
P9	Numih.ts	(configuração numih_rules_max)", true);	(configuração numih_rules_max)", false);
P10	Numih.ts	return top + "Índice indisponível: " + dir + " não pôde ser lido.";	return top;
M1	Machine.ts	[home + "/.agents/skills", dir + "/.agents/skills", numih]	[home + "/.agents/skills", dir + "/.agents/skills"]
M2	Machine.ts	(NUMIH_SKILLS_OFF.includes(name) || NUMIH_SKILLS_OFF.includes(head?.name))	NUMIH_SKILLS_OFF.includes(name)
M3	Machine.ts	const off = root === numih && (	const off = (
M4	Machine.ts	    return skill_head_lines(m[1]);	    return null;
M5	Machine.ts	: var_.startsWith("/") ? var_	: var_ !== "" ? var_
M6	Machine.ts	? whole.slice(1, -1) : null	? whole : null
M7	Machine.ts	if (v !== null && !(kv[1] in out)) {	if (v !== null) {
M8	Machine.ts	[home + "/.agents/skills", dir + "/.agents/skills", numih]	[numih, home + "/.agents/skills", dir + "/.agents/skills"]
L1	Pipeline.ts	(?: with the Numih rules)?	
C1	Config.ts	Number.isSafeInteger(n) && n > 0 ? n	Number.isSafeInteger(n) && n >= 0 ? n
A3	Numih.ts	n !== CORE_RULE).sort();	n !== CORE_RULE);
A11	Numih.ts	p.replace(/`/g, "'")	p
A12a	Numih.ts	{40,64}$/.test(head)	{39,64}$/.test(head)
A12b	Numih.ts	{40,64}$/.test(head)	{40,}$/.test(head)
A12c	Numih.ts	{40,64}$/.test(sha)	{39,64}$/.test(sha)
A12d	Numih.ts	{40,64}$/.test(sha)	{40,65}$/.test(sha)
A18	Numih.ts	const TESTS_RULE = "25-isolamento-de-testes";	const TESTS_RULE = "25-isolamento";
B2	Numih.ts	se uma contrariar a outra, pare e relate ao Unii	em caso de dúvida, siga o usuário
B10	Numih.ts	/^# \S/.test(l)	/^#\s*\S/.test(l)
B12	Numih.ts	if (lines[0]?.trim() === "---") {	if (true) {
B16	Machine.ts	.slice(0, 1024)	.slice(0, 1025)
B18	Tools.ts	typeof args.numih !== "boolean") {	typeof args.numih !== "boolean" && args.numih !== "true") {
N1	Numih.ts	+ text.trim();	+ text.trim() + String.fromCharCode(10);
N2	Numih.ts	+ todo;	+ todo + String.fromCharCode(10);
H1	Tools.ts	input: { numih: config.NUMIH_SET }, cwd	input: {}, cwd
H2	Tools.ts	String(args.name), numih: config.NUMIH_SET }	String(args.name) }
H3	Machine.ts	cwd, Machine.numih_skills(os.homedir(), process.env, input.numih))), fail	cwd)), fail
H4	Machine.ts	String(input.name), Machine.numih_skills(os.homedir(), process.env, input.numih));	String(input.name));
H5	Numih.ts	Machine.numih_home(os.homedir(), process.env, config.NUMIH_SET)	Machine.numih_home(os.homedir(), process.env, "")
H6	Machine.ts	own.startsWith("~/") ? home + own.slice(1)	own.startsWith("~/") ? own
H7	Machine.ts	typeof set === "string" ? set.trim() : ""	typeof set === "string" ? set : ""
H8	Machine.ts	return root.replace(/(.)\/+$/, "$1");	return root;
S1	Machine.ts	if (block[1] === "|") {	if (block[1] !== "|") {
S2	Machine.ts	const cut = Math.min(	const cut = 0 * Math.min(
S3	Machine.ts	.filter((l) => l !== "")].join(" ");	.filter((l) => l !== "")].slice(0, 1).join(" ");
S4	Machine.ts	if (/^[\[{&*!%@`]/.test(first)) {	if (false) {
S5	Machine.ts	? whole.slice(1, -1) : null	? whole.slice(1, -1) : whole
S6	Machine.ts	(/^[ \t]/.test(lines[k + 1]) || lines[k + 1].trim() === "")	/^[ \t]/.test(lines[k + 1])
S7	Machine.ts	[+-]?(?:[ \t]+#.*)?$/.exec(first)	[+-]?$/.exec(first)
S8	Machine.ts	&*!%@`]/.test(first)	&*!%@]/.test(first)
S9	Machine.ts	if (kv === null) {\n      continue;\n    }	if (kv === null) {\n    }
S10	Machine.ts	/^([A-Za-z][\w-]*):	/^[ \t]*([A-Za-z][\w-]*):
S11	Machine.ts	):[ \t]+(\S.*)$/.exec(lines[k])	):[ \t]*(\S.*)$/.exec(lines[k])
S12	Machine.ts	skill_value(kv[2].trim(), under)	skill_value(kv[2], under)
TABELA
)"

um() { # linha da tabela
  local id arq de para
  IFS=$'\t' read -r id arq de para <<<"$1"
  local d="$BASE/$id"
  mkdir -p "$d/r"
  tar -C "$RAIZ" --exclude=./.git --exclude=./node_modules -cf - . | tar -C "$d/r" -xf -
  ln -s "$MODULOS" "$d/r/node_modules"
  if ! ID="$id" DE="$de" PARA="$para" python3 -I - "$d/r/$arq" <<'PY'
import os, sys
p = sys.argv[1]
de = os.environ["DE"].replace("\\n", "\n")
para = os.environ["PARA"].replace("\\n", "\n")
s = open(p, encoding="utf-8").read()
if s.count(de) != 1:
    sys.exit(f"{os.environ['ID']}: trecho original aparece {s.count(de)} vez(es) em {p}")
open(p, "w", encoding="utf-8").write(s.replace(de, para))
PY
  then printf '%s\tNÃO APLICADA\n' "$id"; return 0; fi
  local rc=0
  (cd "$d/r" && env -u UNII_DIR -u UNII_NUMIH_HOME -u NUMIH_HOME bun test ./Numih.test.ts ./Labels.test.ts) >"$d/saida.log" 2>&1 || rc=$?
  if [ "$rc" != 0 ]; then
    printf '%s\tmorta\t%s\n' "$id" "$(grep -m1 -E '^\(fail\)|error:' "$d/saida.log" | cut -c1-150)"
  else
    printf '%s\tSOBREVIVEU\n' "$id"
  fi
}
export -f um
export RAIZ BASE MODULOS

# controle: sem mutação, os mesmos testes passam na mesma cópia; senão,
# uma «morta» não provaria nada
mkdir -p "$BASE/controle/r"
tar -C "$RAIZ" --exclude=./.git --exclude=./node_modules -cf - . | tar -C "$BASE/controle/r" -xf -
ln -s "$MODULOS" "$BASE/controle/r/node_modules"
if ! (cd "$BASE/controle/r" && env -u UNII_DIR -u UNII_NUMIH_HOME -u NUMIH_HOME bun test ./Numih.test.ts ./Labels.test.ts) >"$BASE/controle/saida.log" 2>&1; then
  echo "controle: os testes falham sem mutação; nada a medir" >&2
  tail -20 "$BASE/controle/saida.log" >&2
  exit 1
fi
echo "controle: $(grep -E '^ *[0-9]+ pass' "$BASE/controle/saida.log" | tr -s ' '), $(grep -E '^ *[0-9]+ fail' "$BASE/controle/saida.log" | tr -s ' ')"

if [ "$#" -gt 0 ]; then
  sel="$(printf '%s\n' "$MUTACOES" | awk -F'\t' -v ids=" $* " 'index(ids, " " $1 " ")')"
else
  sel="$MUTACOES"
fi
res="$(printf '%s\n' "$sel" | tr '\n' '\0' | xargs -0 -P "$PARALELO" -I{} bash -c 'um "$1"' _ {})"
printf '%s\n' "$res" | sort
total="$(printf '%s\n' "$res" | grep -c . || true)"
mortas="$(printf '%s\n' "$res" | grep -c $'\tmorta' || true)"
echo "mutações: $mortas de $total mortas"
[ "$mortas" = "$total" ]
