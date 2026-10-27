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

# git observado: um git falso no PATH (só quando o teste pede) registra o
# ambiente de cada chamada (pedido de senha, ssh, trava fd 9 aberta) e, se
# NUMIH_TESTE_FINGE_ANCESTRAL=1, finge que `merge-base --is-ancestor` passou.
REAL_GIT="$(command -v git)"
mkdir -p "$T/shim"
cat > "$T/shim/git" <<EOF
#!/bin/sh
if [ -e /proc/\$\$/fd/9 ]; then fd9=aberto; else fd9=fechado; fi
printf 'prompt=%s askpass=%s ssh=%s fd9=%s args=%s\\n' "\${GIT_TERMINAL_PROMPT-}" "\${GIT_ASKPASS-}" "\${GIT_SSH_COMMAND-}" "\$fd9" "\$*" >> "$T/git.log"
if [ -n "\${NUMIH_TESTE_FINGE_ANCESTRAL-}" ]; then
  case " \$* " in *" merge-base --is-ancestor "*) exit 0 ;; esac
fi
exec "$REAL_GIT" "\$@"
EOF
chmod 0755 "$T/shim/git"
# gh falso: nenhum teste usa o gh real.
mkdir -p "$T/gh-falso"; printf '#!/bin/sh\nexit 1\n' > "$T/gh-falso/gh"; chmod 0755 "$T/gh-falso/gh"

falhas=0
ok()    { printf 'ok   - %s\n' "$1"; }
falha() { printf 'FALHA- %s\n' "$1"; falhas=$((falhas + 1)); }
espera_rc() { # descrição, rc esperado, comando...
  local d="$1" e="$2"; shift 2
  local rc=0; "$@" >"$T/out" 2>&1 || rc=$?
  if [ "$rc" = "$e" ]; then ok "$d (rc=$rc)"; else falha "$d: rc=$rc, esperado $e"; cat "$T/out"; fi
}
tem() { # descrição, padrão (grep -E) que precisa estar em $T/out
  if grep -qE -- "$2" "$T/out"; then ok "$1"; else falha "$1 (sem «$2»)"; cat "$T/out"; fi
}
recusado_pelo_gancho() { # descrição, comando...
  local d="$1"; shift
  local rc=0; "$@" >"$T/out" 2>&1 || rc=$?
  if [ "$rc" != 0 ] && grep -q "Cópia de referência da Numih (somente leitura)" "$T/out"; then ok "$d"
  else falha "$d (rc=$rc)"; cat "$T/out"; fi
}
copia_limpa_na_main() { # descrição, dir
  if [ "$(git -C "$2" rev-parse HEAD)" = "$(git -C "$2" rev-parse origin/main)" ] \
     && [ -z "$(git -C "$2" status --porcelain)" ] && [ "$(git -C "$2" symbolic-ref --short HEAD)" = main ] \
     && [ ! -e "$2/.git/MERGE_HEAD" ] && [ ! -d "$2/.git/rebase-apply" ]; then ok "$1"
  else falha "$1"; git -C "$2" status; fi
}

# Remotos: workspace (com um submódulo registrado) e cursor
mkdir -p "$T/remotos"
for r in cursor lib workspace .oculto ffteste; do
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
tem "sync diz o que já foi feito antes da busca" "cursor: falha ao buscar a origin .*; o HEAD e os arquivos da cópia não foram alterados \(só a configuração local de proteção e os ganchos foram reaplicados antes da busca\)"
grep -q "nada foi alterado" "$T/out" && falha "sync ainda diz «nada foi alterado»" || ok "sync não diz «nada foi alterado»"
espera_rc "check com origin inacessível falha" 1 "$SYNC" check
grep -q "^cursor: HEAD .* commit(s) atrás" "$T/out" && falha "check contou atraso sem conseguir buscar" || ok "check não conta atraso sem buscar"
grep -q "cursor: falha ao buscar a origin" "$T/out" && ok "check informa a falha de busca" || falha "check não informou a falha de busca"
tem "check: nada foi alterado na cópia" "cursor: falha ao buscar a origin .*; nada foi alterado na cópia$"
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

# Proteções: cada gancho recusa a sua operação (o teste exercita o gancho em
# si, inclusive o pre-push, com URL explícita que não passa pela pushurl).
C="$NUMIH_HOME/cursor"
echo x >> "$C/README.md"
recusado_pelo_gancho "pre-commit recusa commit local" git -C "$C" commit -qam "proibido"
git -C "$C" checkout -q -- README.md
git -C "$C" checkout -q -b tmp-lateral
echo lateral > "$C/lateral.txt"; git -C "$C" add lateral.txt
git -C "$C" commit -q --no-verify -m "lateral"
git -C "$C" checkout -q main
recusado_pelo_gancho "pre-merge-commit recusa merge" git -C "$C" merge --no-ff --no-edit tmp-lateral
git -C "$C" merge --abort 2>/dev/null || true
recusado_pelo_gancho "pre-rebase recusa rebase" git -C "$C" rebase -f HEAD~1
rm -rf "$T/patch"; git -C "$C" format-patch -q -1 tmp-lateral -o "$T/patch"
recusado_pelo_gancho "pre-applypatch recusa git am" git -C "$C" am "$T/patch"/*.patch
git -C "$C" am --abort 2>/dev/null || true
recusado_pelo_gancho "pre-push recusa push (o gancho em si)" git -C "$C" push "$T/remotos/cursor.git" tmp-lateral:refs/heads/tmp-lateral
git -C "$T/remotos/cursor.git" rev-parse -q --verify refs/heads/tmp-lateral >/dev/null \
  && falha "o push chegou ao remoto" || ok "nada chegou ao remoto"
git -C "$C" branch -q -D tmp-lateral
copia_limpa_na_main "cópia intacta depois das recusas dos ganchos" "$C"
echo x >> "$C/README.md"
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
tem "motivo: nome inválido (../fora)" "nome de repositório inválido: '\.\./fora'"
# .oculto existe no remoto e clonaria sem a regra do nome: a recusa é da regra.
espera_rc "mod recusa nome que começa com ponto" 1 "$SYNC" mod ".oculto"
tem "motivo: nome inválido (.oculto)" "nome de repositório inválido: '\.oculto'"
[ ! -e "$NUMIH_HOME/mod/.oculto" ] && ok "nada clonado para .oculto" || falha "clonou .oculto"
espera_rc "sync inclui mod/" 0 "$SYNC" sync
grep -q "^lib: em dia" "$T/out" && ok "mod/lib sincronizado no sync" || falha "mod/lib fora do sync"

# Ajuda e comando desconhecido: nenhuma guarda, trava ou escrita.
espera_rc "help" 0 env NUMIH_HOME="$T/home-ajuda" "$SYNC" help
tem "help mostra os comandos" "numih-sync check --no-fetch"
tem "help mostra NUMIH_FETCH_TIMEOUT" "NUMIH_FETCH_TIMEOUT"
espera_rc "sem argumentos mostra a ajuda" 0 env NUMIH_HOME="$T/home-ajuda" "$SYNC"
espera_rc "comando desconhecido" 2 env NUMIH_HOME="$T/home-ajuda" "$SYNC" xyz
[ ! -e "$T/home-ajuda" ] && ok "ajuda não cria nem trava o NUMIH_HOME" || falha "ajuda criou o NUMIH_HOME"

# Guardas de caminho
mkdir -p "$T/cwd"
espera_rc "recusa NUMIH_HOME relativo" 1 env -C "$T/cwd" NUMIH_HOME=rel "$SYNC" check
grep -q "NUMIH_HOME precisa ser absoluto: rel" "$T/out" && ok "motivo: NUMIH_HOME relativo" || { falha "motivo do NUMIH_HOME relativo não informado"; cat "$T/out"; }
[ -z "$(ls -A "$T/cwd")" ] && ok "nada criado no diretório atual" || { falha "criou algo no diretório atual"; ls -la "$T/cwd"; }
espera_rc "recusa NUMIH_LOCK_WAIT inválido" 1 env NUMIH_HOME="$T/home-lw" NUMIH_LOCK_WAIT=x "$SYNC" check --no-fetch
tem "motivo: NUMIH_LOCK_WAIT não numérico" "NUMIH_LOCK_WAIT precisa ser um número de segundos: x"
[ ! -e "$T/home-lw" ] && ok "nada criado com NUMIH_LOCK_WAIT inválido" || falha "criou o NUMIH_HOME com NUMIH_LOCK_WAIT inválido"
for v in x 0 -5; do
  espera_rc "recusa NUMIH_FETCH_TIMEOUT=$v" 1 env NUMIH_HOME="$T/home-lw" NUMIH_FETCH_TIMEOUT="$v" "$SYNC" check --no-fetch
  tem "motivo: NUMIH_FETCH_TIMEOUT=$v" "NUMIH_FETCH_TIMEOUT precisa ser um número de segundos maior que zero: $v"
done
[ ! -e "$T/home-lw" ] && ok "nada criado com NUMIH_FETCH_TIMEOUT inválido" || falha "criou o NUMIH_HOME com NUMIH_FETCH_TIMEOUT inválido"
# HOME falso dentro de $T: a guarda nunca é exercitada contra o HOME real.
mkdir -p "$T/falso"
espera_rc "recusa NUMIH_HOME = HOME" 1 env HOME="$T/falso" NUMIH_HOME="$T/falso" "$SYNC" check
[ ! -e "$T/falso/.lock" ] && ok "nada criado no HOME" || falha "criou .lock no HOME"
espera_rc "recusa NUMIH_HOME = HOME com barra no fim" 1 env HOME="$T/falso" NUMIH_HOME="$T/falso/" "$SYNC" check
espera_rc "recusa NUMIH_HOME acima do HOME" 1 env HOME="$T/falso" NUMIH_HOME="$T" "$SYNC" check
tem "motivo: NUMIH_HOME acima do HOME" "NUMIH_HOME não pode ser o HOME, um diretório acima dele nem a raiz"
espera_rc "recusa NUMIH_HOME = /" 1 env HOME="$T/falso" NUMIH_HOME=/ "$SYNC" check
espera_rc "recusa NUMIH_HOME em ~/repository" 1 env HOME="$T/falso" NUMIH_HOME="$T/falso/repository/numih" "$SYNC" check
[ ! -e "$T/falso/repository" ] && ok "nada criado em ~/repository" || falha "criou algo em ~/repository"
# Com «..» no caminho: só o realpath do NUMIH_HOME reconhece ~/repository.
espera_rc "recusa NUMIH_HOME em ~/repository via «..»" 1 env HOME="$T/falso" NUMIH_HOME="$T/falso/x/../repository/numih" "$SYNC" check
tem "motivo: dentro de ~/repository (via ..)" "recuso operar dentro de $T/falso/repository"
[ ! -e "$T/falso/repository" ] && [ ! -e "$T/falso/x" ] && ok "nada criado (via ..)" || falha "criou algo (via ..)"
# ~/repository é link simbólico para dados/: o alvo também é protegido.
mkdir -p "$T/h1/dados"; ln -s dados "$T/h1/repository"
espera_rc "recusa ~/repository/nh com ~/repository link simbólico" 1 env HOME="$T/h1" NUMIH_HOME="$T/h1/repository/nh" "$SYNC" check
tem "motivo: dentro de ~/repository (link)" "recuso operar dentro de $T/h1/dados"
espera_rc "recusa o alvo físico de ~/repository" 1 env HOME="$T/h1" NUMIH_HOME="$T/h1/dados/nh" "$SYNC" check
[ -z "$(ls -A "$T/h1/dados")" ] && ok "nada criado no alvo de ~/repository" || { falha "criou algo no alvo de ~/repository"; ls -la "$T/h1/dados"; }

# Clone raso de verdade, com a origin certa: a recusa é por ser raso.
mkdir -p "$T/home-raso/mod"
git clone -q --depth 1 "file://$T/remotos/cursor.git" "$T/home-raso/mod/cursor" 2>/dev/null
git -C "$T/home-raso/mod/cursor" remote set-url origin "$T/remotos/cursor.git"
[ "$(git -C "$T/home-raso/mod/cursor" rev-parse --is-shallow-repository)" = true ] && ok "clone de teste é raso" || falha "clone de teste não é raso"
espera_rc "mod recusa clone raso" 1 env NUMIH_HOME="$T/home-raso" "$SYNC" mod cursor
tem "motivo: clone raso" "cursor: clone raso \(--depth\)"

# Check sem origin/main na cópia: motivo próprio (não «não é ancestral»).
git -C "$NUMIH_HOME/cursor" update-ref -d refs/remotes/origin/main
espera_rc "check --no-fetch sem origin/main falha" 1 "$SYNC" check --no-fetch
tem "motivo: sem origin/main" "cursor: sem origin/main na cópia \(rode: numih-sync sync\)"
espera_rc "sync recria a origin/main" 0 "$SYNC" sync

# Ganchos que são links simbólicos: trocados por arquivos, sem escrever no alvo.
H="$NUMIH_HOME/cursor/.git/hooks"
printf 'alvo de fora\n' > "$T/alvo-gancho"; chmod 0644 "$T/alvo-gancho"
rm -f "$H/pre-push"; ln -s "$T/alvo-gancho" "$H/pre-push"
cp -p "$H/pre-commit" "$T/alvo-igual"            # mesmo conteúdo do gancho
rm -f "$H/pre-rebase"; ln -s "$T/alvo-igual" "$H/pre-rebase"
espera_rc "sync troca ganchos que são links simbólicos" 0 "$SYNC" sync
[ "$(cat "$T/alvo-gancho")" = "alvo de fora" ] && [ "$(stat -c %a "$T/alvo-gancho")" = 644 ] \
  && ok "alvo do link do gancho intacto (conteúdo e modo)" || falha "sync escreveu no alvo do link do gancho"
[ ! -L "$H/pre-push" ] && [ ! -L "$H/pre-rebase" ] && cmp -s "$H/pre-push" "$H/pre-commit" && cmp -s "$H/pre-rebase" "$H/pre-commit" \
  && ok "ganchos viraram arquivos próprios" || { falha "gancho continua link ou com outro conteúdo"; ls -la "$H"; }
[ -z "$(ls -A "$H" | grep '^\.numih-' || true)" ] && ok "sem temporário de gancho sobrando" || falha "sobrou temporário de gancho"
# .git/hooks que é link simbólico: recusado, nada escrito no alvo.
mv "$H" "$T/hooks-guardados"; mkdir "$T/fora-hooks"; ln -s "$T/fora-hooks" "$H"
espera_rc "sync recusa .git/hooks link simbólico" 1 "$SYNC" sync
tem "motivo: .git/hooks link simbólico" "cursor/\.git/hooks é link simbólico; não escrevo ganchos através dele"
[ -z "$(ls -A "$T/fora-hooks")" ] && ok "nada escrito no alvo de .git/hooks" || { falha "escreveu ganchos fora"; ls -la "$T/fora-hooks"; }
rm "$H"; mv "$T/hooks-guardados" "$H"
# .git/config que é link simbólico: recusado antes de qualquer git config.
cp "$NUMIH_HOME/cursor/.git/config" "$T/fora-config"
git config -f "$T/fora-config" --unset remote.origin.pushurl
cp "$T/fora-config" "$T/fora-config.orig"
mv "$NUMIH_HOME/cursor/.git/config" "$T/config-guardado"; ln -s "$T/fora-config" "$NUMIH_HOME/cursor/.git/config"
espera_rc "sync recusa .git/config link simbólico" 1 "$SYNC" sync
tem "motivo: config link simbólico" "cursor: \.git/config é link simbólico"
cmp -s "$T/fora-config" "$T/fora-config.orig" && ok "alvo do config intacto" || falha "sync escreveu no alvo do config"
rm "$NUMIH_HOME/cursor/.git/config"; mv "$T/config-guardado" "$NUMIH_HOME/cursor/.git/config"
espera_rc "sync volta a passar" 0 "$SYNC" sync

# Guarda de cópia (vale para check e sync): nada fora de $NUMIH_HOME.
HL="$T/home-link"
espera_rc "sync em home-link" 0 env NUMIH_HOME="$HL" "$SYNC" sync
git clone -q "$T/remotos/workspace.git" "$T/fora-ws" 2>/dev/null
git -C "$T/fora-ws" reset -q --hard HEAD~1
git -C "$T/fora-ws" update-ref refs/remotes/origin/main HEAD
fora_om="$(git -C "$T/fora-ws" rev-parse refs/remotes/origin/main)"
fora_conf="$(cat "$T/fora-ws/.git/config")"
# (a) a cópia é link simbólico para um clone de fora (atrás da origin)
rm -rf "$HL/workspace"; ln -s "$T/fora-ws" "$HL/workspace"
espera_rc "check recusa cópia que é link para fora" 1 env NUMIH_HOME="$HL" "$SYNC" check
tem "motivo: cópia fora (check)" "workspace: $HL/workspace resolve para fora de $HL \($T/fora-ws\)"
espera_rc "sync recusa cópia que é link para fora" 1 env NUMIH_HOME="$HL" "$SYNC" sync
[ "$(git -C "$T/fora-ws" rev-parse refs/remotes/origin/main)" = "$fora_om" ] && [ "$(git -C "$T/fora-ws" rev-parse HEAD)" = "$fora_om" ] \
  && ok "clone de fora não foi buscado nem avançado" || falha "check/sync mexeu no clone de fora"
[ "$(cat "$T/fora-ws/.git/config")" = "$fora_conf" ] && [ ! -e "$T/fora-ws/.git/hooks/pre-commit" ] \
  && ok "config e ganchos do clone de fora intactos" || falha "sync escreveu config ou ganchos no clone de fora"
# (b) .git é arquivo que aponta para um diretório git de fora
rm "$HL/workspace"; mkdir "$HL/workspace"; printf 'gitdir: %s\n' "$T/fora-ws/.git" > "$HL/workspace/.git"
espera_rc "check recusa .git que aponta para fora" 1 env NUMIH_HOME="$HL" "$SYNC" check
tem "motivo: diretório git fora" "workspace: diretório git fora de $HL \($T/fora-ws/\.git\)"
[ "$(git -C "$T/fora-ws" rev-parse refs/remotes/origin/main)" = "$fora_om" ] && ok "clone de fora não foi buscado (.git arquivo)" || falha "buscou no clone de fora (.git arquivo)"
rm -rf "$HL/workspace"
espera_rc "sync reclona o workspace" 0 env NUMIH_HOME="$HL" "$SYNC" sync
# (c) diretório git dentro, mas o comum (objetos, refs, config) fora
git -C "$T/fora-ws" worktree add -q --detach "$HL/mod/workspace"
mv "$T/fora-ws/.git/worktrees/workspace" "$HL/wt-gitdir"
printf '%s\n' "$T/fora-ws/.git" > "$HL/wt-gitdir/commondir"
printf 'gitdir: %s\n' "$HL/wt-gitdir" > "$HL/mod/workspace/.git"
espera_rc "check recusa diretório git comum fora" 1 env NUMIH_HOME="$HL" "$SYNC" check
tem "motivo: diretório git comum fora" "workspace: diretório git fora de $HL \($T/fora-ws/\.git\)"
rm -rf "$HL/mod/workspace" "$HL/wt-gitdir"
# (d) diretório git fora, comum dentro (worktree de uma cópia, com o gitdir movido para fora)
git -C "$HL/cursor" worktree add -q --detach "$HL/mod/cursor"
mv "$HL/cursor/.git/worktrees/cursor" "$T/fora-wtgit"
printf '%s\n' "$HL/cursor/.git" > "$T/fora-wtgit/commondir"
printf 'gitdir: %s\n' "$T/fora-wtgit" > "$HL/mod/cursor/.git"
espera_rc "check recusa diretório git fora com comum dentro" 1 env NUMIH_HOME="$HL" "$SYNC" check
tem "motivo: diretório git do worktree fora" "cursor: diretório git fora de $HL \($T/fora-wtgit\)"
rm -rf "$HL/mod/cursor" "$T/fora-wtgit"; git -C "$HL/cursor" worktree prune
# (e) árvore de trabalho fora, diretório git e comum dentro: o avanço rápido
#     escreveria os arquivos fora. Origin um commit à frente.
echo wt >> "$T/src-cursor/README.md"; git -C "$T/src-cursor" commit -qam "para o worktree"; git -C "$T/src-cursor" push -q origin main
git -C "$HL/cursor" worktree add -q -f "$T/fora-wt" main
ln -s "$T/fora-wt" "$HL/mod/cursor"
fora_wt="$(git -C "$T/fora-wt" rev-parse HEAD)"
espera_rc "mod recusa árvore de trabalho fora" 1 env NUMIH_HOME="$HL" "$SYNC" mod cursor
tem "motivo: árvore de trabalho fora" "cursor: $HL/mod/cursor resolve para fora de $HL"
[ "$(git -C "$T/fora-wt" rev-parse HEAD)" = "$fora_wt" ] && [ -z "$(git -C "$T/fora-wt" status --porcelain)" ] \
  && ok "árvore de trabalho de fora intacta" || falha "avançou a árvore de trabalho de fora"
rm "$HL/mod/cursor"; git -C "$HL/cursor" worktree remove --force "$T/fora-wt"
# (f) mod/ é link para fora: não clona lá
mkdir -p "$T/home-link2" "$T/fora-mod"; ln -s "$T/fora-mod" "$T/home-link2/mod"
espera_rc "mod recusa clonar através de link para fora" 1 env NUMIH_HOME="$T/home-link2" "$SYNC" mod lib
tem "motivo: destino do clone fora" "lib: $T/home-link2/mod/lib resolve para fora de $T/home-link2"
[ -z "$(ls -A "$T/fora-mod")" ] && ok "nada clonado fora" || { falha "clonou fora"; ls -la "$T/fora-mod"; }

# .lock: link simbólico recusado; link físico nunca truncado.
mkdir -p "$T/home-lock"
printf 'importante\n' > "$T/alvo-lock"; ln -s "$T/alvo-lock" "$T/home-lock/.lock"
espera_rc "recusa .lock link simbólico" 1 env NUMIH_HOME="$T/home-lock" "$SYNC" check --no-fetch
tem "motivo: .lock link simbólico" "home-lock/\.lock é um link simbólico; recuso usá-lo como trava"
[ "$(cat "$T/alvo-lock")" = importante ] && ok "alvo do .lock intacto" || falha "truncou o alvo do .lock"
rm "$T/home-lock/.lock"; printf 'importante\n' > "$T/alvo-hard"; ln "$T/alvo-hard" "$T/home-lock/.lock"
env NUMIH_HOME="$T/home-lock" "$SYNC" check --no-fetch >/dev/null 2>&1 || true
[ "$(cat "$T/alvo-hard")" = importante ] && ok ".lock link físico não é truncado" || falha "truncou o .lock (link físico)"

# Rede sem interação e trava fechada nos filhos: git observado pelo shim.
rm -f "$T/git.log"
espera_rc "sync com git observado" 0 env PATH="$T/shim:$PATH" "$SYNC" sync
espera_rc "clone com git observado" 0 env PATH="$T/shim:$PATH" NUMIH_HOME="$T/home-shim" "$SYNC" sync
if [ -s "$T/git.log" ] && ! grep -v '^prompt=0 askpass=false .* fd9=fechado ' "$T/git.log" >/dev/null; then
  ok "todo git roda com GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=false e a trava fechada"
else falha "algum git rodou com prompt, askpass ou a trava (fd 9) aberta"; grep -v '^prompt=0 askpass=false .* fd9=fechado ' "$T/git.log" | head; fi
for op in fetch clone; do
  if grep -q " $op " "$T/git.log" && ! grep " $op " "$T/git.log" | grep -v "ssh=ssh -o BatchMode=yes fd9=fechado args=.*gc.autoDetach=false" >/dev/null; then
    ok "$op: ssh em BatchMode e gc em primeiro plano"
  else falha "$op sem BatchMode, sem gc.autoDetach=false ou ausente"; grep " $op " "$T/git.log" | head -3; fi
done
# ssh configurado pelo usuário é respeitado
git config --global core.sshCommand "ssh -F /dev/null"
rm -f "$T/git.log"
espera_rc "check com core.sshCommand do usuário" 0 env PATH="$T/shim:$PATH" "$SYNC" check
grep " fetch " "$T/git.log" | grep -q "ssh= fd9" && ok "não sobrepõe o core.sshCommand do usuário" || { falha "sobrepôs o core.sshCommand do usuário"; grep " fetch " "$T/git.log" | head -2; }
git config --global --unset core.sshCommand

# Remoto que pendura: a busca e o clone têm prazo (NUMIH_FETCH_TIMEOUT). O
# timeout 60 de fora só garante que o teste falhe (rc 124) em vez de pendurar.
git config --global protocol.ext.allow always
# Duração única por execução: o teste reconhece só os próprios processos.
PENDURA="$((100000 + RANDOM * 7 + $$ % 7))"
git config --global url."ext::sh -c sleep% $PENDURA ".insteadOf "pendura://x/"
git -C "$NUMIH_HOME/cursor" config remote.origin.url "pendura://x/cursor.git"
ini=$SECONDS
espera_rc "check com remoto que pendura" 1 timeout 60 env NUMIH_REMOTE_BASE=pendura://x NUMIH_FETCH_TIMEOUT=2 "$SYNC" check
dur=$((SECONDS - ini))
tem "motivo: busca passou do prazo" "cursor: a busca na origin \(pendura://x/cursor\.git\) passou de 2 s \(NUMIH_FETCH_TIMEOUT\) e foi interrompida; nada foi alterado na cópia"
[ "$dur" -lt 20 ] && ok "a busca pendurada foi cortada ($dur s)" || falha "a busca pendurada levou $dur s"
git -C "$NUMIH_HOME/cursor" config remote.origin.url "$T/remotos/cursor.git"
ini=$SECONDS
espera_rc "clone com remoto que pendura" 1 timeout 60 env NUMIH_HOME="$T/home-pendura" NUMIH_REMOTE_BASE=pendura://x NUMIH_FETCH_TIMEOUT=2 "$SYNC" mod lib
dur=$((SECONDS - ini))
tem "motivo: clone passou do prazo" "lib: o clone passou de 2 s \(NUMIH_FETCH_TIMEOUT\) e foi interrompido"
[ "$dur" -lt 20 ] && ok "o clone pendurado foi cortado ($dur s)" || falha "o clone pendurado levou $dur s"
[ ! -e "$T/home-pendura/mod/lib" ] && ok "clone interrompido não deixa cópia pela metade" || falha "sobrou cópia pela metade"
sleep 0.3
ps -eo args= | grep -qx "sleep $PENDURA" && falha "sobrou processo do remoto pendurado" || ok "nenhum processo do remoto pendurado sobrou"
git config --global --unset url."ext::sh -c sleep% $PENDURA ".insteadOf

# Avanço rápido estrito: mesmo que a checagem de ancestral fosse burlada
# (shim finge que passou), o merge --ff-only recusa e não deixa merge pela metade.
# Dois commits, e o segundo é reescrito na origin: há base comum, então um
# merge sem --ff-only criaria um merge de verdade (não «históricos sem relação»).
echo dois >> "$T/src-ffteste/README.md"; git -C "$T/src-ffteste" commit -qam "dois"; git -C "$T/src-ffteste" push -q origin main
espera_rc "mod ffteste" 0 "$SYNC" mod ffteste
FF="$NUMIH_HOME/mod/ffteste"
git -C "$T/src-ffteste" reset -q --hard HEAD~1
echo outro > "$T/src-ffteste/outro.txt"; git -C "$T/src-ffteste" add outro.txt
git -C "$T/src-ffteste" commit -qm "dois reescrito"; git -C "$T/src-ffteste" push -q --force origin main
antes="$(git -C "$FF" rev-parse HEAD)"
espera_rc "sync recusa avanço não rápido (ancestral burlado)" 1 env PATH="$T/shim:$PATH" NUMIH_TESTE_FINGE_ANCESTRAL=1 "$SYNC" mod ffteste
tem "motivo: avanço rápido falhou" "ffteste: o avanço rápido para origin/main falhou"
[ "$(git -C "$FF" rev-parse HEAD)" = "$antes" ] && [ -z "$(git -C "$FF" status --porcelain)" ] && [ ! -e "$FF/.git/MERGE_HEAD" ] \
  && ok "nenhum merge pela metade" || { falha "ficou merge pela metade ou HEAD mudou"; git -C "$FF" status; }
rm -rf "$FF"

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
mkdir -p "$T/home-inst" "$T/fora-bin"; ln -s "$T/fora-bin" "$T/home-inst/bin"
espera_rc "install recusa bin link simbólico" 1 env NUMIH_HOME="$T/home-inst" "$SYNC" install
[ -z "$(ls -A "$T/fora-bin")" ] && ok "nada instalado fora" || falha "instalou fora"

# map (gh falso: nenhum acesso ao GitHub) e saídas que são links simbólicos
REAL_BUN="$(command -v bun)"
mkdir -p "$T/bun-shim"
printf '#!/bin/sh\nif [ -e /proc/$$/fd/9 ]; then echo aberto; else echo fechado; fi > "%s"\nexec "%s" "$@"\n' "$T/bun-fd9" "$REAL_BUN" > "$T/bun-shim/bun"
chmod 0755 "$T/bun-shim/bun"
espera_rc "map gera o mapa" 0 env PATH="$T/gh-falso:$T/bun-shim:$PATH" "$SYNC" map
[ "$(cat "$T/bun-fd9" 2>/dev/null)" = fechado ] && ok "map roda o bun com a trava fechada" || falha "map rodou o bun com a trava (fd 9) aberta"
[ -s "$NUMIH_HOME/modulos.json" ] && grep -q "Mapa de módulos" "$NUMIH_HOME/MODULOS.md" && ok "map escreveu as saídas" || falha "map não escreveu as saídas"
rm "$NUMIH_HOME/modulos.json"; printf 'original\n' > "$T/alvo-mapa"; ln -s "$T/alvo-mapa" "$NUMIH_HOME/modulos.json"
espera_rc "map recusa saída link simbólico" 1 env PATH="$T/gh-falso:$PATH" "$SYNC" map
[ "$(cat "$T/alvo-mapa")" = original ] && ok "alvo da saída do map intacto" || falha "map escreveu no alvo do link"
rm "$NUMIH_HOME/modulos.json"

# O gancho do usuário segue intacto depois de tudo
cmp -s "$T/ganchos-do-usuario/pre-commit" "$T/pre-commit.original" \
  && ok "pre-commit global do usuário intacto no fim" || falha "pre-commit global do usuário alterado"

if [ "$falhas" = 0 ]; then echo "TODOS OK"; else echo "$falhas FALHA(S)"; exit 1; fi
