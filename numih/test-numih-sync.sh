#!/usr/bin/env bash
# Teste do numih-sync com remotos locais num diretório temporário próprio.
# Não toca em ~/.unii/numih nem na rede. Uso: bash numih/test-numih-sync.sh
#
# Isolamento: HOME, NUMIH_HOME, o config global do git e GH_CONFIG_DIR apontam
# para o tmp do teste. Isso NÃO isola as credenciais do gh: ele ainda pode
# achá-las no chaveiro do sistema (keyring), que não depende do HOME. Por isso
# este teste nunca chama o gh nem a rede, e não afirma nada sobre credenciais.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC="$AQUI/bin/numih-sync"
T="$(mktemp -d "${TMPDIR:-/tmp}/numih-sync-teste.XXXXXX")"
trap 'jobs -p | xargs -r kill 2>/dev/null || true; rm -rf "$T"' EXIT
mkdir -p "$T/home-falso" "$T/gh"
export HOME="$T/home-falso" GH_CONFIG_DIR="$T/gh"
unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN
export GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.email teste@example.invalid
git config --global user.name teste
git config --global init.defaultBranch main
git config --global protocol.file.allow always
git config --global uploadpack.allowFilter true
# Como na máquina real (https -> ssh): a URL efetiva difere da gravada.
git config --global url."file://$T/remotos/".insteadOf "$T/remotos/"
# Como em máquinas com core.hooksPath global: um pre-commit do usuário que o
# sync NUNCA pode sobrescrever (antes ele gravava `exit 1` aqui).
mkdir -p "$T/ganchos-do-usuario"
printf '#!/bin/sh\n# gancho do usuário: precisa continuar intacto\nexit 0\n' > "$T/ganchos-do-usuario/pre-commit"
chmod 0755 "$T/ganchos-do-usuario/pre-commit"
cp -p "$T/ganchos-do-usuario/pre-commit" "$T/pre-commit.original"
git config --global core.hooksPath "$T/ganchos-do-usuario"

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
# core.hooksPath global do usuário: intacto; as cópias usam o próprio .git/hooks
cmp -s "$T/ganchos-do-usuario/pre-commit" "$T/pre-commit.original" \
  && ok "pre-commit global do usuário intacto" || falha "sync sobrescreveu o pre-commit global do usuário"
[ "$(ls -A "$T/ganchos-do-usuario")" = pre-commit ] \
  && ok "nada novo no core.hooksPath global" || { falha "sync escreveu no core.hooksPath global"; ls -la "$T/ganchos-do-usuario"; }
[ "$(git config --global core.hooksPath)" = "$T/ganchos-do-usuario" ] \
  && ok "core.hooksPath global inalterado" || falha "core.hooksPath global alterado"
for r in workspace cursor; do
  [ "$(git -C "$NUMIH_HOME/$r" config --local core.hooksPath)" = "$NUMIH_HOME/$r/.git/hooks" ] \
    && ok "$r: core.hooksPath local aponta para o próprio .git/hooks" || falha "$r: core.hooksPath local ausente ou errado"
done
echo y >> "$T/src-lib/README.md"
rc=0; git -C "$T/src-lib" commit -qam "commit fora das cópias" >/dev/null 2>&1 || rc=$?
[ "$rc" = 0 ] && ok "commit em outro repositório continua passando pelo gancho do usuário" || falha "commit em outro repositório quebrou (rc=$rc)"
git -C "$T/src-lib" push -q origin main

espera_rc "check em dia" 0 "$SYNC" check
espera_rc "sync de novo (idempotente)" 0 "$SYNC" sync
grep -q "workspace: em dia" "$T/out" && ok "segunda execução não muda nada" || falha "segunda execução mudou algo"

# Avanço no remoto: check acusa, sync avança
echo mais >> "$T/src-cursor/README.md"; git -C "$T/src-cursor" commit -qam "avanço"; git -C "$T/src-cursor" push -q origin main
espera_rc "check acusa 1 atrás" 10 "$SYNC" check
grep -q "cursor: .* 1 commit(s) atrás" "$T/out" && ok "contagem de atraso" || { falha "contagem de atraso"; cat "$T/out"; }
espera_rc "sync avança" 0 "$SYNC" sync
grep -q "cursor: .* -> .* (1 commit(s))" "$T/out" && ok "sync relata o avanço" || falha "sync não relatou o avanço"

# Origin inacessível (rede): erro e saída não zero, nunca «em dia»
mv "$T/remotos/cursor.git" "$T/remotos/cursor.git.fora"
espera_rc "sync com origin inacessível falha" 1 "$SYNC" sync
grep -q "^cursor: em dia" "$T/out" && falha "sync disse «em dia» sem conseguir buscar" || ok "sync não diz «em dia» sem buscar"
grep -q "cursor: falha ao buscar a origin" "$T/out" && ok "motivo: falha ao buscar" || { falha "motivo da falha de busca não informado"; cat "$T/out"; }
espera_rc "check com origin inacessível falha" 1 "$SYNC" check
grep -q "^cursor: HEAD .* commit(s) atrás" "$T/out" && falha "check contou atraso sem conseguir buscar" || ok "check não conta atraso sem buscar"
grep -q "cursor: falha ao buscar a origin" "$T/out" && ok "check informa a falha de busca" || falha "check não informou a falha de busca"
espera_rc "check --no-fetch não precisa da rede" 0 "$SYNC" check --no-fetch
mv "$T/remotos/cursor.git.fora" "$T/remotos/cursor.git"

# Origin trocada por um fork à frente: recusa sem avançar para o fork
git clone -q --bare "$T/remotos/cursor.git" "$T/remotos/cursor-fork.git"
git clone -q "$T/remotos/cursor-fork.git" "$T/src-fork" 2>/dev/null
echo fork >> "$T/src-fork/README.md"; git -C "$T/src-fork" commit -qam "do fork"; git -C "$T/src-fork" push -q origin main
git -C "$NUMIH_HOME/cursor" config remote.origin.url "$T/remotos/cursor-fork.git"
antes="$(git -C "$NUMIH_HOME/cursor" rev-parse HEAD)"
espera_rc "sync recusa origin trocada" 1 "$SYNC" sync
grep -q "cursor: origin é '$T/remotos/cursor-fork.git', esperado" "$T/out" && ok "motivo: origin trocada" || { falha "motivo da origin trocada não informado"; cat "$T/out"; }
[ "$(git -C "$NUMIH_HOME/cursor" rev-parse HEAD)" = "$antes" ] && ok "cópia não avançou para o fork" || falha "cópia avançou para o fork"
espera_rc "check recusa origin trocada" 1 "$SYNC" check
# origin sem o sufixo .git é a mesma origin
git -C "$NUMIH_HOME/cursor" config remote.origin.url "$T/remotos/cursor"
espera_rc "sync aceita origin sem .git" 0 "$SYNC" sync
git -C "$NUMIH_HOME/cursor" config remote.origin.url "$T/remotos/cursor.git"

# Histórico reescrito na origin: recusa (check e sync), sem tocar na cópia
git -C "$T/src-cursor" commit -q --amend -m "avanço reescrito"
git -C "$T/src-cursor" push -q --force origin main
antes="$(git -C "$NUMIH_HOME/cursor" rev-parse HEAD)"
espera_rc "check recusa origin reescrita" 1 "$SYNC" check
grep -q "cursor: HEAD .* não é ancestral de origin/main" "$T/out" && ok "check: motivo histórico reescrito" || { falha "check: motivo do histórico reescrito não informado"; cat "$T/out"; }
# o check já buscou; volta a origin/main local ao HEAD para o sync ver o mesmo cenário
git -C "$NUMIH_HOME/cursor" update-ref refs/remotes/origin/main "$antes"
espera_rc "sync recusa origin reescrita" 1 "$SYNC" sync
grep -q "cursor: HEAD .* não é ancestral de origin/main" "$T/out" && ok "sync: motivo histórico reescrito" || { falha "sync: motivo do histórico reescrito não informado"; cat "$T/out"; }
[ "$(git -C "$NUMIH_HOME/cursor" rev-parse HEAD)" = "$antes" ] && ok "cópia intacta com origin reescrita" || falha "cópia alterada com origin reescrita"
rm -rf "$NUMIH_HOME/cursor"
espera_rc "sync reclona a cópia removida" 0 "$SYNC" sync

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
mkdir -p "$T/cwd"
espera_rc "recusa NUMIH_HOME relativo" 1 env -C "$T/cwd" NUMIH_HOME=rel "$SYNC" check
grep -q "NUMIH_HOME precisa ser absoluto: rel" "$T/out" && ok "motivo: NUMIH_HOME relativo" || { falha "motivo do NUMIH_HOME relativo não informado"; cat "$T/out"; }
[ -z "$(ls -A "$T/cwd")" ] && ok "nada criado no diretório atual" || { falha "criou algo no diretório atual"; ls -la "$T/cwd"; }
espera_rc "recusa NUMIH_LOCK_WAIT inválido" 1 env NUMIH_LOCK_WAIT=x "$SYNC" check --no-fetch
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

# Trava (flock): com a trava ocupada, a segunda execução espera; se o prazo
# acabar, desiste com erro sem tocar em nada.
( flock -x 8; touch "$T/segurando"; sleep 3; touch "$T/liberou" ) 8>"$NUMIH_HOME/.lock" &
segurador=$!
for _ in $(seq 100); do [ -e "$T/segurando" ] && break; sleep 0.05; done
espera_rc "desiste com a trava ocupada" 1 env NUMIH_LOCK_WAIT=1 "$SYNC" sync
grep -q "outra execução do numih-sync segura a trava há 1 s" "$T/out" && ok "motivo: trava ocupada" || { falha "motivo da trava não informado"; cat "$T/out"; }
[ ! -e "$T/liberou" ] || falha "a trava foi liberada cedo demais para o teste valer"
espera_rc "espera a trava e segue" 0 env NUMIH_LOCK_WAIT=30 "$SYNC" sync
[ -e "$T/liberou" ] && ok "só rodou depois de a trava ser liberada" || falha "rodou com a trava ocupada"
wait "$segurador"
# Duas execuções simultâneas num NUMIH_HOME vazio: serializam e ambas terminam bem
rc1=0; rc2=0
NUMIH_HOME="$T/home2" "$SYNC" sync >"$T/out1" 2>&1 & p1=$!
NUMIH_HOME="$T/home2" "$SYNC" sync >"$T/out2" 2>&1 & p2=$!
wait "$p1" || rc1=$?; wait "$p2" || rc2=$?
[ "$rc1" = 0 ] && [ "$rc2" = 0 ] && ok "duas execuções simultâneas terminam bem" || { falha "execuções simultâneas: rc $rc1 e $rc2"; cat "$T/out1" "$T/out2"; }
[ "$(cat "$T/out1" "$T/out2" | grep -c '^clonando')" = 2 ] && ok "cada cópia clonada uma só vez" || { falha "clonagem repetida ou ausente"; cat "$T/out1" "$T/out2"; }

# install é idempotente
espera_rc "install" 0 "$SYNC" install
espera_rc "install de novo" 0 "$SYNC" install
grep -q "já instalado: .*numih-sync" "$T/out" && ok "install idempotente" || falha "install reinstalou"

# O gancho do usuário segue intacto depois de tudo
cmp -s "$T/ganchos-do-usuario/pre-commit" "$T/pre-commit.original" \
  && ok "pre-commit global do usuário intacto no fim" || falha "pre-commit global do usuário alterado"

if [ "$falhas" = 0 ]; then echo "TODOS OK"; else echo "$falhas FALHA(S)"; exit 1; fi
