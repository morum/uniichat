#!/usr/bin/env bash
# Mutações do numih-sync, do numih-map e do filtro estrito do próprio teste
# (fora_de_ws_cursor, IDs FW, FA, FB e FP): cada uma altera UMA linha numa
# cópia temporária de numih/ e roda o teste que deveria pegá-la. Uma mutação é
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
B4p	bin/numih-sync	sync	RE_NUM_POS='^[0123456789]*[123456789][0123456789]*$'	RE_NUM_POS='^[0-9]*[1-9][0-9]*$'
B5u	bin/numih-sync	sync	if [ -z "${HOME+x}" ]; then	if false; then
B5v	bin/numih-sync	sync	if [ -z "$HOME" ]; then	if false; then
B5r	bin/numih-sync	sync	case "$HOME" in	case "/$HOME" in
T07	bin/numih-map.ts	map	c.startsWith("`") || c.endsWith("`")	c.startsWith("`")
B6o	bin/numih-map.ts	map	if (typeof s === "object") {	if (false) {
B6c	bin/numih-map.ts	map	let c = bruto(s).replace	let c = String(s ?? "").replace
B6t	bin/numih-map.ts	map	return bruto(s).replace(	return String(s ?? "").replace(
M01	bin/numih-sync	sync	    [ "$PPID" = "$pai" ] || exit 143\n	
M02	bin/numih-sync	sync	    [ -z "$sinal" ] || exit 143\n	
M03	bin/numih-sync	sync	    [ -z "$sinal" ] || kill -TERM "$p" 2>/dev/null\n	
M04	bin/numih-sync	sync	kill -0 "$p" 2>/dev/null || break	break
M11	bin/numih-sync	sync	if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then\n    erro "$nome: o clone	if [ "$rc" = 124 ]; then\n    erro "$nome: o clone
M11b	bin/numih-sync	sync	if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then\n    erro "$nome: a busca	if [ "$rc" = 124 ]; then\n    erro "$nome: a busca
M13	bin/numih-sync	sync	ASCII_ALNUM='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'	ASCII_ALNUM='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
C5a	bin/numih-sync	sync	  apagar_parcial "$nome" "$dir" "$id" || :\n	
C5b	bin/numih-sync	sync	 || [ "$(stat -c '%d:%i' -- "$dir" 2>/dev/null)" != "$id" ]	
N1	bin/numih-sync	sync	if [[ "$nome" == *. ]]; then	if false; then
N1m	bin/numih-map.ts	map	 && !s.endsWith(".")	
F1	bin/numih-sync	sync	RE_NUM_POS='^[0123456789]*[123456789][0123456789]*$'	RE_NUM_POS='^[123456789][0123456789]*$'
F2	bin/numih-sync	sync	RE_NUM_POS='^[0123456789]*[123456789][0123456789]*$'	RE_NUM_POS='^[0123456789]+$'
V1	bin/numih-sync	sync	  if [ -L "$dir" ] || [ ! -d "$dir" ] || [ "$(stat	  if [ ! -d "$dir" ] || [ "$(stat
V2	bin/numih-sync	sync	" != "$id" ] || ! dentro_de_casa "$dir"; then	" != "$id" ]; then
V3	bin/numih-sync	sync	 || [ ! -d "$dir" ] || [ "$(stat	 || [ "$(stat
V4	bin/numih-sync	sync	if ! mkdir -- "$dir" 2>/dev/null; then	if ! mkdir -p -- "$dir" 2>/dev/null; then
V6	bin/numih-sync	sync	if rm -rf -- "$dir"; then	if rm -rf -- "$NUMIH_HOME/mod"; then
V7	bin/numih-sync	sync	if [[ "$nome" == *. ]]; then	if [[ "$nome" == *.git. ]]; then
V13	bin/numih-sync	sync	clone --quiet --filter=blob:none --no-recurse-submodules	clone --quiet --no-recurse-submodules
V16	bin/numih-sync	sync	RE_NUM_POS='^[0123456789]*[123456789][0123456789]*$'	RE_NUM_POS='^[0123456789]*[12345678][0123456789]*$'
V18a	bin/numih-sync	sync	não a apago"; return 1	não a apago"; return 0
V18b	bin/numih-sync	sync	apague-a antes de rodar de novo"; return 1	apague-a antes de rodar de novo"
V20	bin/numih-sync	sync	    erro "$nome: não consegui apagar a pasta parcial do clone ($dir); apague-a antes de rodar de novo"; return 1	    return 1
V21	bin/numih-sync	sync	|| :\n  return "$rc"	|| :\n  return 0
E1	bin/numih-sync	sync	  [ ! -L "$1" ] || return 1\n	
E2	bin/numih-sync	sync	  dentro_de_casa "$1" || return 1\n	
E3	bin/numih-sync	sync	  [ -z "$c" ]\n}	  true\n}
E4	bin/numih-sync	sync	  if pasta_vazia "$dir"; then\n    if ! rmdir	  if false; then\n    if ! rmdir
E5	bin/numih-sync	sync	  if pasta_vazia "$dir"; then\n    erro	  if false; then\n    erro
E6	bin/numih-sync	sync	if ! rmdir -- "$dir" 2>/dev/null; then	if ! rm -rf -- "$dir" 2>/dev/null; then
P5	bin/numih-sync	sync	      [ -d "$r" ] || continue\n	
P6	bin/numih-sync	sync	clone interrompido); rode: numih-sync sync"; return 1	clone interrompido); rode: numih-sync sync"; return 0
P12	bin/numih-sync	sync	if rm -rf -- "$dir"; then	if rm -rf -- "$dir" "$dir.bak"; then
G1	bin/numih-sync	sync	  if pasta_vazia "$dir"; then\n    erro	  g "$dir" rev-parse --git-dir >/dev/null 2>&1 || :\n  if pasta_vazia "$dir"; then\n    erro
G2	bin/numih-sync	sync	  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]	  g "$dir" rev-parse --git-dir >/dev/null 2>&1 || :\n  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]
G3	bin/numih-sync	sync	  if pasta_vazia "$dir"; then\n    erro	  (cd -- "$dir" && git rev-parse --git-dir >/dev/null 2>&1 9>&-) || :\n  if pasta_vazia "$dir"; then\n    erro
X7	bin/numih-sync	sync	  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]	  GIT_DIR="$dir/.git" git rev-parse --git-dir >/dev/null 2>&1 9>&- || :\n  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]
X7w	bin/numih-sync	sync	  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]	  GIT_WORK_TREE="$dir" g "$NUMIH_HOME/workspace" status --porcelain >/dev/null 2>&1 || :\n  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]
X7h	bin/numih-sync	sync	  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]	  g "$NUMIH_HOME" rev-parse --git-dir >/dev/null 2>&1 || :\n  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]
M1	bin/numih-sync	sync	  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]	  git -C "$NUMIH_HOME/workspace" -C ../mod/lib rev-parse --git-dir >/dev/null 2>&1 9>&- || :\n  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]
M2	bin/numih-sync	sync	  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]	  git -C "$NUMIH_HOME/workspace" --git-dir=../mod/lib/.git rev-parse --git-dir >/dev/null 2>&1 9>&- || :\n  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]
M3	bin/numih-sync	sync	  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]	  git -C "$NUMIH_HOME/workspace" -c core.worktree=../mod/lib status --porcelain >/dev/null 2>&1 9>&- || :\n  integra "$nome" "$dir" || return 1\n  if [ "$fetch" = 1 ]
FW	test-numih-sync.sh	sync	substr($0, length($0) - length(fim) + 1) != fim { print; next }	$0 !~ / gitdir= worktree=[^ ]*$/ { print; next }
FA	test-numih-sync.sh	sync	if (substr(a, 1, length(pw)) == pw) resto	if (index(a, pw)) resto
FB	test-numih-sync.sh	sync	if (substr(a, 1, length(pw)) == pw) resto = substr(a, length(pw) + 1)	if ((q = index(a, pw))) resto = substr(a, q + length(pw))
FP	test-numih-sync.sh	sync	j = 0; while ((k = index(substr($0, j + 1), " pwd=")) > 0) j += k	j = index($0, " pwd=")
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
