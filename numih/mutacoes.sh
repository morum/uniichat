#!/usr/bin/env bash
# Mutações do numih-sync e do numih-map: cada uma altera UMA linha numa cópia
# temporária de numih/ e roda o teste que deveria pegá-la. Uma mutação é
# «morta» quando o teste falha; «SOBREVIVEU» quando o teste ainda passa.
# Nada roda fora do tmp: os testes já isolam HOME, NUMIH_HOME, GH_CONFIG_DIR e
# o config global do git.
#
# Uso: bash numih/mutacoes.sh [ID...]     (sem IDs: todas)
# Saída: 0 se todas morreram; 1 se alguma sobreviveu ou não se aplicou.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARALELO="${NUMIH_MUT_PARALELO:-4}"
BASE="$(mktemp -d "${TMPDIR:-/tmp}/numih-mutacoes.XXXXXX")"
trap 'rm -rf "$BASE"' EXIT

# ID <TAB> arquivo (relativo a numih/) <TAB> teste (sync|map) <TAB> trecho original <TAB> trecho mutado
# \n nos trechos vira quebra de linha.
# A tabela vem de um heredoc literal (sem expansão), então os trechos podem
# ter aspas simples.
MUTACOES="$(cat <<'TABELA'
A1	bin/numih-sync	sync	if [ "$NUMIH_HOME" = / ]; then	if false; then
S22	bin/numih-sync	sync	"$NUMIH_HOME"/?*) return 0	"$NUMIH_HOME"?*) return 0
S28	bin/numih-sync	sync	if ! mv -fT "$tmp" "$alvo"	if ! mv -f "$tmp" "$alvo"
S29	bin/numih-sync	sync	timeout --kill-after=10 "$t"	timeout "$t"
S33	bin/numih-sync	sync	--no-recurse-submodules --single-branch	--single-branch
S34	bin/numih-sync	sync	fetch --quiet --no-recurse-submodules origin	fetch --quiet origin
S37	bin/numih-sync	sync	  mkdir -p "$hooks" || return 1\n	
S43	bin/numih-sync	sync	--untracked-files=all	--untracked-files=no
S44	bin/numih-sync	sync	  g "$dir" config --local submodule.recurse false || return 1\n	
B3	bin/numih-sync	sync	then PRAZO_PAI=(setpriv --pdeathsig TERM); fi	then PRAZO_PAI=(); fi
B4	bin/numih-sync	sync	  if [ ! -e "$dir" ]; then erro "$nome: ausente em $dir (rode: numih-sync sync)"; return 1; fi\n	
B5a	bin/numih-sync	sync	if [ -e "$NUMIH_HOME" ] && [ ! -d "$NUMIH_HOME" ]; then	if false; then
B5b	bin/numih-sync	sync	if [ -e "$NUMIH_HOME/.lock" ] && [ ! -f "$NUMIH_HOME/.lock" ]; then	if false; then
B6s	bin/numih-sync	sync	if [[ "${nome,,}" == *.git ]]; then	if false; then
B2b	bin/numih-map.ts	map	be_local ${texto(portaMod.portas.be_local)}	be_local ${portaMod.portas.be_local}
B2i	bin/numih-map.ts	map	(idx ${texto(portaMod.portas.idx)})	(idx ${portaMod.portas.idx})
B6u	bin/numih-map.ts	map	!segmentoSeguro(owner) || !nomeDeRepoSeguro(nome)	!segmentoSeguro(owner) || !segmentoSeguro(nome)
B6f	bin/numih-map.ts	map	!segmentoSeguro(partes[0]) || !nomeDeRepoSeguro(partes[1])	!segmentoSeguro(partes[0]) || !segmentoSeguro(partes[1])
B6n	bin/numih-map.ts	map	&& !s.toLowerCase().endsWith(".git")	&& !s.endsWith(".git")
V01	bin/numih-sync	sync	HOME_REAL="$(realpath -m "$HOME")"	HOME_REAL="$HOME"
B1k	bin/numih-sync	sync	    kill -KILL -- "-$p" 2>/dev/null\n	
B1t	bin/numih-sync	sync	 TERM HUP INT	 HUP INT
B4n	bin/numih-sync	sync	RE_NOME="^[$ASCII_ALNUM][$ASCII_ALNUM._-]*\$"	RE_NOME='^[A-Za-z0-9][A-Za-z0-9._-]*$'
B4d	bin/numih-sync	sync	RE_NUM='^[0123456789]+$'	RE_NUM='^[0-9]+$'
B4p	bin/numih-sync	sync	RE_NUM_POS='^[123456789][0123456789]*$'	RE_NUM_POS='^[1-9][0-9]*$'
B5u	bin/numih-sync	sync	if [ -z "${HOME+x}" ]; then	if false; then
B5v	bin/numih-sync	sync	if [ -z "$HOME" ]; then	if false; then
B5r	bin/numih-sync	sync	case "$HOME" in	case "/$HOME" in
T07	bin/numih-map.ts	map	c.startsWith("`") || c.endsWith("`")	c.startsWith("`")
B6o	bin/numih-map.ts	map	if (typeof s === "object") {	if (false) {
B6c	bin/numih-map.ts	map	let c = bruto(s).replace	let c = String(s ?? "").replace
B6t	bin/numih-map.ts	map	return bruto(s).replace(	return String(s ?? "").replace(
TABELA
)"

um() { # linha da tabela
  local id arq teste de para
  IFS=$'\t' read -r id arq teste de para <<<"$1"
  local d="$BASE/$id"
  mkdir -p "$d"
  cp -a "$AQUI" "$d/numih"
  if ! ID="$id" DE="$de" PARA="$para" python3 -I - "$d/numih/$arq" <<'PY'
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
  if [ "$teste" = sync ]; then
    bash "$d/numih/test-numih-sync.sh" >"$d/saida.log" 2>&1 || rc=$?
  else
    (cd "$d/numih" && bun test ./NumihMap.test.ts) >"$d/saida.log" 2>&1 || rc=$?
  fi
  if [ "$rc" != 0 ]; then
    printf '%s\tmorta\t%s\n' "$id" "$(grep -m1 -E '^FALHA|\(fail\)' "$d/saida.log" | cut -c1-150)"
  else
    printf '%s\tSOBREVIVEU\n' "$id"
  fi
}
export -f um
export AQUI BASE

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
