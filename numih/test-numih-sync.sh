#!/usr/bin/env bash
# Teste do numih-sync com remotos locais num diretório temporário próprio.
# Não toca em ~/.unii/numih nem na rede. Uso: bash numih/test-numih-sync.sh
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC="$AQUI/bin/numih-sync"
T="$(mktemp -d "${TMPDIR:-/tmp}/numih-sync-teste.XXXXXX")"
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.email teste@example.invalid
git config --global user.name teste
git config --global init.defaultBranch main
git config --global protocol.file.allow always
git config --global uploadpack.allowFilter true
# Como na máquina real (https -> ssh): a URL efetiva difere da gravada.
git config --global url."file://$T/remotos/".insteadOf "$T/remotos/"

falhas=0
ok()    { printf 'ok   - %s\n' "$1"; }
falha() { printf 'FALHA- %s\n' "$1"; falhas=$((falhas + 1)); }
espera_rc() { # descrição, rc esperado, comando...
  local d="$1" e="$2"; shift 2
  local rc=0; "$@" >"$T/out" 2>&1 || rc=$?
  if [ "$rc" = "$e" ]; then ok "$d (rc=$rc)"; else falha "$d: rc=$rc, esperado $e"; cat "$T/out"; fi
}

# Remotos: workspace (com um submódulo registrado) e cursor
mkdir -p "$T/remotos"
for r in cursor lib workspace; do
  git init -q --bare "$T/remotos/$r.git"
  git clone -q "$T/remotos/$r.git" "$T/src-$r" 2>/dev/null
  echo "$r" > "$T/src-$r/README.md"
  git -C "$T/src-$r" add README.md
  git -C "$T/src-$r" commit -qm "início $r"
  [ "$r" = workspace ] || git -C "$T/src-$r" push -q origin main
done
git -C "$T/src-workspace" -c protocol.file.allow=always submodule add -q "$T/remotos/lib.git" libs/lib
git -C "$T/src-workspace" commit -qm "submódulo"
git -C "$T/src-workspace" push -q origin main

export NUMIH_HOME="$T/home" NUMIH_REMOTE_BASE="$T/remotos"

espera_rc "sync inicial clona" 0 "$SYNC" sync
grep -q "clonando" "$T/out" && ok "saída menciona clonagem" || falha "saída sem clonagem"
[ -z "$(git -C "$NUMIH_HOME/workspace/libs/lib" rev-parse --show-toplevel 2>/dev/null | grep libs/lib || true)" ] \
  && ok "submódulo não inicializado" || falha "submódulo foi inicializado"
espera_rc "check em dia" 0 "$SYNC" check
espera_rc "sync de novo (idempotente)" 0 "$SYNC" sync
grep -q "workspace: em dia" "$T/out" && ok "segunda execução não muda nada" || falha "segunda execução mudou algo"

# Avanço no remoto: check acusa, sync avança
echo mais >> "$T/src-cursor/README.md"; git -C "$T/src-cursor" commit -qam "avanço"; git -C "$T/src-cursor" push -q origin main
espera_rc "check acusa 1 atrás" 10 "$SYNC" check
grep -q "cursor: .* 1 commit(s) atrás" "$T/out" && ok "contagem de atraso" || { falha "contagem de atraso"; cat "$T/out"; }
espera_rc "sync avança" 0 "$SYNC" sync
grep -q "cursor: .* -> .* (1 commit(s))" "$T/out" && ok "sync relata o avanço" || falha "sync não relatou o avanço"

# Proteções: commit local e push recusados
echo x >> "$NUMIH_HOME/cursor/README.md"
rc=0; git -C "$NUMIH_HOME/cursor" commit -qam "proibido" >/dev/null 2>&1 || rc=$?
[ "$rc" != 0 ] && ok "hook recusa commit local" || falha "commit local passou"
espera_rc "sync recusa cópia alterada" 1 "$SYNC" sync
espera_rc "check recusa cópia alterada" 1 "$SYNC" check --no-fetch
git -C "$NUMIH_HOME/cursor" checkout -q -- README.md
rc=0; git -C "$NUMIH_HOME/cursor" push origin main >/dev/null 2>&1 || rc=$?
[ "$rc" != 0 ] && ok "push recusado" || falha "push passou"
[ "$(git -C "$NUMIH_HOME/cursor" config remote.origin.pushurl)" = "no-push://copia-de-referencia-somente-leitura" ] \
  && ok "pushurl inválida configurada" || falha "pushurl não configurada"

# Divergência: commit local forçado (sem hooks) faz sync falhar sem tocar
git -C "$NUMIH_HOME/cursor" -c core.hooksPath=/dev/null commit -q --allow-empty -m "divergente"
antes="$(git -C "$NUMIH_HOME/cursor" rev-parse HEAD)"
espera_rc "sync recusa cópia divergente" 1 "$SYNC" sync
grep -q "commit(s) local(is) fora da origin/main" "$T/out" && ok "motivo: commit local" || falha "motivo da divergência não informado"
[ "$(git -C "$NUMIH_HOME/cursor" rev-parse HEAD)" = "$antes" ] && ok "cópia divergente intacta" || falha "cópia divergente foi alterada"
git -C "$NUMIH_HOME/cursor" -c core.hooksPath=/dev/null reset -q --hard origin/main

# Fora da main
git -C "$NUMIH_HOME/cursor" checkout -q -b outra
espera_rc "sync recusa branch fora da main" 1 "$SYNC" sync
git -C "$NUMIH_HOME/cursor" checkout -q main

# Submódulo inicializado no workspace é recusado
git -C "$NUMIH_HOME/workspace" -c protocol.file.allow=always submodule -q update --init libs/lib 2>/dev/null || true
if git -C "$NUMIH_HOME/workspace" submodule status | grep -q '^ '; then
  espera_rc "sync recusa submódulo inicializado" 1 "$SYNC" sync
  git -C "$NUMIH_HOME/workspace" submodule -q deinit -f libs/lib
fi

# mod <nome>
espera_rc "mod clona módulo" 0 "$SYNC" mod lib
[ -d "$NUMIH_HOME/mod/lib/.git" ] && ok "cópia do módulo criada" || falha "cópia do módulo ausente"
espera_rc "mod recusa nome inválido" 1 "$SYNC" mod "../fora"
espera_rc "sync inclui mod/" 0 "$SYNC" sync
grep -q "^lib: em dia" "$T/out" && ok "mod/lib sincronizado no sync" || falha "mod/lib fora do sync"

# Guardas de caminho
espera_rc "recusa NUMIH_HOME relativo" 1 env NUMIH_HOME=rel "$SYNC" check
# HOME falso dentro de $T: a guarda nunca é exercitada contra o HOME real.
mkdir -p "$T/falso"
espera_rc "recusa NUMIH_HOME = HOME" 1 env HOME="$T/falso" NUMIH_HOME="$T/falso" "$SYNC" check
[ ! -e "$T/falso/.lock" ] && ok "nada criado no HOME" || falha "criou .lock no HOME"
espera_rc "recusa NUMIH_HOME em ~/repository" 1 env HOME="$T/falso" NUMIH_HOME="$T/falso/repository/numih" "$SYNC" check
[ ! -e "$T/falso/repository" ] && ok "nada criado em ~/repository" || falha "criou algo em ~/repository"

# Clone raso é recusado
git clone -q --depth 1 "file://$T/remotos/lib.git" "$NUMIH_HOME/mod/raso" 2>/dev/null
git -C "$NUMIH_HOME/mod/raso" remote set-url origin "$T/remotos/raso"
espera_rc "sync recusa clone raso" 1 "$SYNC" sync
rm -rf "$NUMIH_HOME/mod/raso"

# install é idempotente
espera_rc "install" 0 "$SYNC" install
espera_rc "install de novo" 0 "$SYNC" install
grep -q "já instalado: .*numih-sync" "$T/out" && ok "install idempotente" || falha "install reinstalou"

# Nada escrito fora de $T
if [ "$falhas" = 0 ]; then echo "TODOS OK"; else echo "$falhas FALHA(S)"; exit 1; fi
