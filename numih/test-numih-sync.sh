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
# Processos de remoto pendurado que sobrarem (só os deste teste: duração única
# no argumento). Morte por PID, nunca por padrão de nome (pkill).
mata_sobras() { # duração do sleep
  local p
  for p in $(ps -eo pid=,args= | awk -v a="sleep $1" '{ pid = $1; $1 = ""; sub(/^ /, ""); if ($0 == a) print pid }'); do
    kill -9 "$p" 2>/dev/null || true
  done
}
SOBRAS=()
trap 'jobs -p | xargs -r kill 2>/dev/null || true; for d in "${SOBRAS[@]}"; do mata_sobras "$d"; done; chmod -R u+w "$T" 2>/dev/null; rm -rf "$T"' EXIT
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
# Cada linha termina com o diretório corrente (pwd=) e as variáveis GIT_DIR
# (gitdir=) e GIT_WORK_TREE (worktree=), para que um git rodado dentro de uma
# pasta, sem -C, ou apontado para ela só pelo ambiente, também apareça no
# registro.
REAL_GIT="$(command -v git)"
mkdir -p "$T/shim"
cat > "$T/shim/git" <<EOF
#!/bin/sh
if [ -e /proc/\$\$/fd/9 ]; then fd9=aberto; else fd9=fechado; fi
printf 'prompt=%s askpass=%s ssh=%s fd9=%s args=%s pwd=%s gitdir=%s worktree=%s\\n' "\${GIT_TERMINAL_PROMPT-}" "\${GIT_ASKPASS-}" "\${GIT_SSH_COMMAND-}" "\$fd9" "\$*" "\$PWD" "\${GIT_DIR-}" "\${GIT_WORK_TREE-}" >> "$T/git.log"
if [ -n "\${NUMIH_TESTE_IGNORA_TERM-}" ]; then
  # só a busca da cópia cursor (as outras seguem normais)
  case " \$* " in *"/cursor -c "*" fetch "*) trap '' TERM; exec sleep "\$NUMIH_TESTE_IGNORA_TERM" ;; esac
fi
if [ -n "\${NUMIH_TESTE_CLONE_PARCIAL-}\${NUMIH_TESTE_CLONE_TROCA-}" ]; then
  case " \$* " in *" clone "*)
    for a in "\$@"; do dest="\$a"; done
    if [ -n "\${NUMIH_TESTE_CLONE_TROCA-}" ]; then
      # a pasta do clone é trocada por outra (de outro dono) e o clone falha
      mv "\$dest" "\$dest.movido" && mkdir "\$dest" && echo alheio > "\$dest/alheio"; exit 1
    fi
    # clone pela metade que ignora TERM: só o KILL do --kill-after o derruba
    mkdir -p "\$dest/.git/objects" && echo parcial > "\$dest/.git/parcial"
    trap '' TERM; exec sleep "\$NUMIH_TESTE_CLONE_PARCIAL" ;;
  esac
fi
if [ -n "\${NUMIH_TESTE_FINGE_ANCESTRAL-}" ]; then
  case " \$* " in *" merge-base --is-ancestor "*) exit 0 ;; esac
fi
exec "$REAL_GIT" "\$@"
EOF
chmod 0755 "$T/shim/git"
# Filtro estrito do registro: imprime toda linha que NÃO é exatamente uma
# chamada `git -C` na workspace ou na cursor, isto é, os argumentos começam
# por `-C <home>/workspace` ou `-C <home>/cursor`, seguidos (ou não) das opções
# fixas do script (-c gc.autoDetach=false -c maintenance.autoDetach=false) e
# logo depois de um subcomando de uma lista fechada (os que o check usa); e
# sem GIT_DIR nem GIT_WORK_TREE no ambiente. O git só lê opções globais
# antes do subcomando, então nada entre o -C e o subcomando escapa: um
# segundo -C, um --git-dir, um --work-tree ou qualquer outro -c (como
# core.worktree) que apontem para outra pasta (mod/lib, por exemplo) aparecem.
# Os argumentos depois do subcomando não são conferidos (são do subcomando:
# `rev-parse --git-dir` é legítimo). A única outra linha aceita é a leitura
# global do core.sshCommand que o script faz ao começar (sem -C, fora de
# <home>). Os argumentos são separados por espaço (o git falso grava "$*"),
# então o filtro não distingue um argumento com espaço de dois argumentos; e
# vão até a ÚLTIMA ocorrência de " pwd=" (a que o git falso grava), para que
# um " pwd=" nos argumentos ou no caminho de <home> não os corte antes.
fora_de_ws_cursor() { # NUMIH_HOME [registro; padrão $T/git.log]
  awk -v h="$1" -v fim=" gitdir= worktree=" \
      -v ssh=" args=config --get core.sshCommand pwd=" -v casa="$1/" '
    BEGIN {
      opts = "-c gc.autoDetach=false -c maintenance.autoDetach=false "
      n = split("rev-parse config symbolic-ref status rev-list submodule log merge-base fetch", l, " ")
      for (k = 1; k <= n; k++) permitido[l[k]] = 1
    }
    substr($0, length($0) - length(fim) + 1) != fim { print; next }
    (i = index($0, ssh)) && index(substr($0, i + length(ssh)), casa) != 1 && $0 ~ /^prompt=[^ ]* askpass=[^ ]* ssh=[^ ]* fd9=[^ ]* args=config --get core\.sshCommand pwd=/ { next }
    {
      i = index($0, " args="); if (!i) { print; next }
      j = 0; while ((k = index(substr($0, j + 1), " pwd=")) > 0) j += k
      if (j <= i) { print; next }
      a = substr($0, i + 6, j - i - 6)
      resto = ""
      pw = "-C " h "/workspace "; pc = "-C " h "/cursor "
      if (substr(a, 1, length(pw)) == pw) resto = substr(a, length(pw) + 1)
      else if (substr(a, 1, length(pc)) == pc) resto = substr(a, length(pc) + 1)
      else { print; next }
      if (substr(resto, 1, length(opts)) == opts) resto = substr(resto, length(opts) + 1)
      split(resto, t, " ")
      if (!(t[1] in permitido)) { print; next }
    }' "${2:-$T/git.log}" 2>/dev/null
}
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
so_erros_proprios() { # descrição: toda linha da saída é um erro do numih-sync
  if [ -s "$T/out" ] && ! grep -qv '^numih-sync: erro: ' "$T/out"; then ok "$1"; else falha "$1"; cat "$T/out"; fi
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
for r in cursor lib workspace .oculto ffteste x.git a.git. x. ab12 9z; do
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
for r in workspace cursor; do
  [ "$(git -C "$NUMIH_HOME/$r" config --local submodule.recurse)" = false ] \
    && [ "$(git -C "$NUMIH_HOME/$r" config --local fetch.recurseSubmodules)" = false ] \
    && ok "$r: submodule.recurse e fetch.recurseSubmodules = false no config local" \
    || falha "$r: recursão de submódulos não desligada no config local"
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
# Arquivo não rastreado (dentro de um diretório novo) também reprova a cópia limpa.
mkdir -p "$C/novo-dir"; echo n > "$C/novo-dir/nao-rastreado.txt"
espera_rc "sync recusa arquivo não rastreado" 1 "$SYNC" sync
tem "motivo: alteração local (não rastreado)" "cursor: cópia de referência com alteração local \(1 arquivo\(s\)\)"
tem "lista o arquivo não rastreado" "novo-dir/nao-rastreado\.txt"
espera_rc "check recusa arquivo não rastreado" 1 "$SYNC" check --no-fetch
rm -rf "$C/novo-dir"
# .git/hooks apagado: o sync recria o diretório e os ganchos.
rm -rf "$C/.git/hooks"
espera_rc "sync recria .git/hooks apagado" 0 "$SYNC" sync
[ -x "$C/.git/hooks/pre-commit" ] && [ -x "$C/.git/hooks/pre-push" ] && ok "ganchos recriados" || { falha "ganchos não recriados"; ls -la "$C/.git" | head; }
echo x >> "$C/README.md"
recusado_pelo_gancho "pre-commit recriado recusa commit" git -C "$C" commit -qam "proibido"
git -C "$C" checkout -q -- README.md
# Gancho que é diretório: o sync não põe o arquivo dentro dele; para com erro.
rm -f "$C/.git/hooks/pre-push"; mkdir "$C/.git/hooks/pre-push"
espera_rc "sync recusa gancho que é diretório" 1 "$SYNC" sync
tem "motivo: gancho é diretório" "não consegui trocar o gancho .*/\.git/hooks/pre-push \(é diretório ou não pode ser substituído\)"
[ -z "$(ls -A "$C/.git/hooks/pre-push")" ] && ok "nada posto dentro do diretório do gancho" || { falha "pôs arquivo dentro do diretório do gancho"; ls -la "$C/.git/hooks/pre-push"; }
[ -z "$(ls -A "$C/.git/hooks" | grep '^\.numih-' || true)" ] && ok "sem temporário de gancho sobrando (diretório)" || falha "sobrou temporário de gancho (diretório)"
rmdir "$C/.git/hooks/pre-push"
espera_rc "sync volta a passar sem o diretório" 0 "$SYNC" sync
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
# x.git.git existe no remoto e clonaria sem a regra: a recusa é do sufixo .git.
for n in x.git X.GIT; do
  espera_rc "mod recusa nome terminado em .git ($n)" 1 "$SYNC" mod "$n"
  tem "motivo: sufixo .git ($n)" "nome de repositório inválido: '$n' \(sem o sufixo \.git\)"
done
[ ! -e "$NUMIH_HOME/mod/x.git" ] && ok "nada clonado para x.git" || falha "clonou x.git"
# a.git. existe no remoto (a.git..git) e clonaria sem a regra do ponto final.
espera_rc "mod recusa nome terminado em ponto (a.git.)" 1 "$SYNC" mod "a.git."
tem "motivo: termina em ponto (a.git.)" "^numih-sync: erro: nome de repositório inválido: 'a\.git\.' \(não pode terminar em ponto\)$"
[ ! -e "$NUMIH_HOME/mod/a.git." ] && ok "nada clonado para a.git." || falha "clonou a.git."
# x. existe no remoto (x..git) e não termina em .git.: a recusa é do ponto final.
espera_rc "mod recusa nome terminado em ponto (x.)" 1 "$SYNC" mod "x."
tem "motivo: termina em ponto (x.)" "^numih-sync: erro: nome de repositório inválido: 'x\.' \(não pode terminar em ponto\)$"
[ ! -e "$NUMIH_HOME/mod/x." ] && ok "nada clonado para x." || falha "clonou x."

# Clone que falha: a pasta que ele criou é apagada, mesmo quando o git morre
# por KILL (que ele não tem como limpar). Antes, mod/<nome> ficava pela metade
# e todo sync e check seguintes falhavam. O git falso cria a pasta pela metade e
# ignora TERM: o --kill-after manda KILL 10 s depois do prazo (rc 137).
PARCIAL="$((300000 + RANDOM * 7 + $$ % 7))"; SOBRAS+=("$PARCIAL")
HP="$T/home-parcial"
# Outra cópia ao lado em mod/: a limpeza apaga só a pasta do clone, nunca mod/.
mkdir -p "$HP/mod/vizinha"; echo minha > "$HP/mod/vizinha/marca"
ini=$SECONDS
espera_rc "clone morto por KILL falha" 1 timeout 45 env PATH="$T/shim:$PATH" NUMIH_TESTE_CLONE_PARCIAL="$PARCIAL" NUMIH_HOME="$HP" NUMIH_FETCH_TIMEOUT=1 "$SYNC" mod lib
dur=$((SECONDS - ini))
tem "motivo: prazo no clone morto por KILL (rc 137)" "^numih-sync: erro: lib: o clone passou de 1 s \(NUMIH_FETCH_TIMEOUT\) e foi interrompido$"
tem "informa a pasta parcial removida" "^lib: pasta parcial do clone removida \($HP/mod/lib\)$"
tem "diz que o clone falhou (KILL)" "^numih-sync: erro: lib: falha ao clonar $T/remotos/lib$"
[ "$(cat "$HP/mod/vizinha/marca" 2>/dev/null)" = minha ] && ok "a cópia vizinha em mod/ ficou intacta" || falha "a limpeza do clone apagou a cópia vizinha em mod/"
[ "$dur" -lt 30 ] && ok "clone que ignora TERM foi morto pelo KILL ($dur s)" || falha "clone que ignora TERM levou $dur s"
[ ! -e "$HP/mod/lib" ] && ok "clone morto por KILL não deixa mod/lib pela metade" || { falha "sobrou mod/lib pela metade"; ls -la "$HP/mod/lib"; }
sleep 0.3
ps -eo args= | grep -qx "sleep $PARCIAL" && falha "sobrou o clone que ignora TERM" || ok "nada sobrou do clone que ignora TERM"
espera_rc "mod lib volta a clonar depois do KILL" 0 env NUMIH_HOME="$HP" "$SYNC" mod lib
[ -d "$HP/mod/lib/.git" ] && ok "cópia refeita depois do KILL" || falha "cópia não refeita depois do KILL"
# Clone que falha por erro comum (repositório inexistente): pasta apagada.
espera_rc "mod de repositório inexistente falha" 1 env NUMIH_HOME="$HP" "$SYNC" mod naoexiste
[ ! -e "$HP/mod/naoexiste" ] && ok "clone com erro não deixa pasta" || falha "sobrou mod/naoexiste"
tem "diz que o clone falhou (inexistente)" "^numih-sync: erro: naoexiste: falha ao clonar $T/remotos/naoexiste$"
[ "$(cat "$HP/mod/vizinha/marca" 2>/dev/null)" = minha ] && ok "a cópia vizinha segue intacta (clone com erro)" || falha "o clone com erro apagou a cópia vizinha"
# Corrida: a pasta do clone aparece (de outro dono) entre a checagem de
# ausência e a criação. O mkdir sem -p recusa; com -p o clone usaria a pasta
# alheia como sua e a apagaria ao falhar. Um mkdir falso cria a pasta alheia
# quando o script cria o pai (mod/), logo antes do mkdir da pasta do clone.
HC="$T/home-corrida"; REAL_MKDIR="$(command -v mkdir)"
"$REAL_MKDIR" -p "$T/shim-mkdir"
printf '#!/bin/sh\nif [ -n "${NUMIH_TESTE_CORRIDA-}" ] && [ "$1" = -p ] && [ "$2" = "$NUMIH_TESTE_CORRIDA" ]; then\n  "%s" -p "$2/lib" && echo alheio > "$2/lib/alheio"; exit $?\nfi\nexec "%s" "$@"\n' "$REAL_MKDIR" "$REAL_MKDIR" > "$T/shim-mkdir/mkdir"
chmod 0755 "$T/shim-mkdir/mkdir"
espera_rc "clone recusa pasta criada por outro na corrida" 1 env PATH="$T/shim-mkdir:$PATH" NUMIH_TESTE_CORRIDA="$HC/mod" NUMIH_HOME="$HC" "$SYNC" mod lib
tem "motivo: pasta já existe na corrida" "^numih-sync: erro: lib: não consegui criar $HC/mod/lib \(já existe ou sem permissão\); não clono nele$"
grep -q clonando "$T/out" && falha "clonou na pasta criada por outro" || ok "não clona na pasta criada por outro"
[ "$(cat "$HC/mod/lib/alheio" 2>/dev/null)" = alheio ] && ok "pasta criada por outro intacta" || falha "apagou a pasta criada por outro"
# Pasta trocada durante o clone: não é mais a criada por ele e nunca é apagada.
HX="$T/home-troca"
espera_rc "clone que falha com a pasta trocada" 1 env PATH="$T/shim:$PATH" NUMIH_TESTE_CLONE_TROCA=1 NUMIH_HOME="$HX" "$SYNC" mod lib
tem "motivo: pasta trocada" "^numih-sync: erro: lib: $HX/mod/lib não é mais a pasta criada por este clone; não a apago$"
[ "$(cat "$HX/mod/lib/alheio" 2>/dev/null)" = alheio ] && ok "pasta trocada intacta" || falha "apagou a pasta trocada"
# Pasta preexistente: o sync não clona nela nem a apaga.
mkdir -p "$T/home-pre/mod/lib"; echo meu > "$T/home-pre/mod/lib/meu.txt"
espera_rc "mod com pasta preexistente falha" 1 env NUMIH_HOME="$T/home-pre" "$SYNC" mod lib
grep -q clonando "$T/out" && falha "tentou clonar na pasta preexistente" || ok "não clona na pasta preexistente"
tem "motivo: pasta preexistente não é repositório" "^numih-sync: erro: $T/home-pre/mod/lib existe mas não é repositório git$"
[ "$(cat "$T/home-pre/mod/lib/meu.txt" 2>/dev/null)" = meu ] && ok "pasta preexistente intacta" || falha "mexeu na pasta preexistente"
# Corrida na pasta vazia: ela ganha conteúdo entre a checagem e a remoção. Um
# ls falso que sempre diz «vazia» simula isso; o rmdir (só apaga diretório
# vazio) é a segunda barreira e nada com conteúdo é apagado.
mkdir -p "$T/shim-ls"; printf '#!/bin/sh\nexit 0\n' > "$T/shim-ls/ls"; chmod 0755 "$T/shim-ls/ls"
espera_rc "pasta que deixou de estar vazia não é apagada" 1 env PATH="$T/shim-ls:$PATH" NUMIH_HOME="$T/home-pre" "$SYNC" mod lib
tem "motivo: não conseguiu remover a pasta «vazia»" "^numih-sync: erro: lib: não consegui remover a pasta vazia $T/home-pre/mod/lib \(sobra de um clone interrompido\); apague-a e rode de novo$"
[ "$(cat "$T/home-pre/mod/lib/meu.txt" 2>/dev/null)" = meu ] && ok "pasta com conteúdo intacta (corrida)" || falha "apagou pasta com conteúdo (corrida)"

# apagar_parcial isolado: cada guarda sozinha. O trecho das funções é extraído
# do próprio script (as mutações valem ali) e recebe um id que bate com o
# caminho, para que só a guarda testada possa recusar. Devolve 0 quando a
# pasta não existe mais e 1 quando ela ficou.
FUNCS="$(awk '/^(erro|info)\(\) \{.*\}$/ { print; next } /^(dentro_de_casa|apagar_parcial)\(\) \{$/ { f = 1 } f { print } f && /^\}$/ { f = 0 }' "$SYNC")"
case "$FUNCS" in *"apagar_parcial()"*"dentro_de_casa()"*|*"dentro_de_casa()"*"apagar_parcial()"*) ok "funções da limpeza extraídas do script" ;; *) falha "não consegui extrair apagar_parcial e dentro_de_casa" ;; esac
AH="$(realpath -m "$T/home-ap")"; mkdir -p "$AH" "$T/fora-ap/d"
apagar() { # caminho, id
  bash -c "$FUNCS"'
    NUMIH_HOME="$1"; apagar_parcial lib "$2" "$3"' _ "$AH" "$1" "$2"
}
id_de() { stat -c '%d:%i' -- "$1"; }
# (a) a pasta do próprio clone: apagada, rc 0. Vizinhos com nome parecido
#     (certa.bak, certa2, certa-x) ficam: só a pasta do clone é apagada.
mkdir -p "$AH/certa/.git"; echo x > "$AH/certa/.git/parcial"
for v in certa.bak certa2 certa-x; do mkdir -p "$AH/$v"; echo "$v" > "$AH/$v/marca"; done
espera_rc "apagar_parcial apaga a pasta do clone" 0 apagar "$AH/certa" "$(id_de "$AH/certa")"
tem "apagar_parcial: informa a remoção" "^lib: pasta parcial do clone removida \($AH/certa\)$"
[ ! -e "$AH/certa" ] && ok "apagar_parcial: pasta do clone apagada" || falha "apagar_parcial: pasta do clone ficou"
for v in certa.bak certa2 certa-x; do
  [ "$(cat "$AH/$v/marca" 2>/dev/null)" = "$v" ] && ok "apagar_parcial: vizinho $v intacto" || falha "apagar_parcial: apagou o vizinho $v"
  rm -rf "$AH/$v"
done
espera_rc "apagar_parcial: pasta já ausente, rc 0" 0 apagar "$AH/certa" 0:0
# (b) link simbólico para uma pasta dentro de casa, com o id do próprio link
mkdir -p "$AH/alvo"; echo dado > "$AH/alvo/dado"; ln -s "$AH/alvo" "$AH/link"
espera_rc "apagar_parcial recusa link simbólico" 1 apagar "$AH/link" "$(id_de "$AH/link")"
tem "apagar_parcial: motivo (link)" "^numih-sync: erro: lib: $AH/link não é mais a pasta criada por este clone; não a apago$"
[ -L "$AH/link" ] && [ "$(cat "$AH/alvo/dado")" = dado ] && ok "apagar_parcial: link e alvo intactos" || falha "apagar_parcial: apagou o link ou o alvo"
# (c) arquivo comum (não diretório), com o id dele
echo arq > "$AH/arquivo"
espera_rc "apagar_parcial recusa o que não é diretório" 1 apagar "$AH/arquivo" "$(id_de "$AH/arquivo")"
[ "$(cat "$AH/arquivo" 2>/dev/null)" = arq ] && ok "apagar_parcial: arquivo intacto" || falha "apagar_parcial: apagou um arquivo"
# (d) pasta fora de casa por um pai que é link (mesmo inode, -d verdadeiro)
echo fora > "$T/fora-ap/d/fora"; ln -s "$T/fora-ap" "$AH/mod"
espera_rc "apagar_parcial recusa pasta fora de casa" 1 apagar "$AH/mod/d" "$(id_de "$AH/mod/d")"
[ "$(cat "$T/fora-ap/d/fora" 2>/dev/null)" = fora ] && ok "apagar_parcial: pasta de fora intacta" || falha "apagar_parcial: apagou fora de casa"
# (e) rm que falha (subpasta sem escrita): avisa e devolve 1
mkdir -p "$AH/dura/sub"; echo f > "$AH/dura/sub/f"; chmod 0555 "$AH/dura/sub"
espera_rc "apagar_parcial: rm que falha devolve 1" 1 apagar "$AH/dura" "$(id_de "$AH/dura")"
tem "apagar_parcial: avisa que não conseguiu apagar" "^numih-sync: erro: lib: não consegui apagar a pasta parcial do clone \($AH/dura\); apague-a antes de rodar de novo$"
grep -q "pasta parcial do clone removida" "$T/out" && falha "apagar_parcial: disse «removida» com o rm falhando" || ok "apagar_parcial: não diz «removida» com o rm falhando"
chmod 0755 "$AH/dura/sub"

# guarda_copia isolada com pasta vazia (sobra de clone interrompido): recusa e
# PARA ali, com rc 1 e uma única linha de erro, sem rodar git nela. O git
# falso do teste ($T/shim/git) registra em $T/git.log cada chamada com os
# argumentos (o g() passa a pasta no -C); o controle com um repositório de
# verdade prova que a guarda extraída roda pelo git falso. Funções extraídas
# do próprio script (as mutações valem ali).
FUNCS_G="$(awk '/^(erro|info|g)\(\) \{.*\}$/ { print; next } /^GIT_OPTS=/ { print; next } /^(dentro_de_casa|pasta_vazia|guarda_copia)\(\) \{$/ { f = 1 } f { print } f && /^\}$/ { f = 0 }' "$SYNC")"
case "$FUNCS_G" in *"guarda_copia()"*) case "$FUNCS_G" in *"pasta_vazia()"*) case "$FUNCS_G" in *"GIT_OPTS="*"g()"*) ok "funções da guarda extraídas do script" ;; *) falha "não consegui extrair GIT_OPTS e g" ;; esac ;; *) falha "não consegui extrair pasta_vazia" ;; esac ;; *) falha "não consegui extrair guarda_copia" ;; esac
mkdir -p "$AH/vazia"
guardar() { # caminho
  PATH="$T/shim:$PATH" bash -c "$FUNCS_G"'
    NUMIH_HOME="$1"; guarda_copia lib "$2"' _ "$AH" "$1"
}
git init -q "$AH/repo-ok"
rm -f "$T/git.log"
espera_rc "guarda_copia: controle, repositório de verdade aceito" 0 guardar "$AH/repo-ok"
grep -qF -- "-C $AH/repo-ok " "$T/git.log" 2>/dev/null && ok "guarda_copia: controle, o git falso registra o git da guarda" || { falha "guarda_copia: controle, o git da guarda não passou pelo git falso"; cat "$T/git.log" 2>/dev/null || :; }
rm -rf "$AH/repo-ok" "$T/git.log"
espera_rc "guarda_copia: pasta vazia recusada com rc 1 exato" 1 guardar "$AH/vazia"
tem "guarda_copia: motivo (pasta vazia)" "^numih-sync: erro: lib: $AH/vazia é uma pasta vazia \(sobra de um clone interrompido\); rode: numih-sync sync$"
[ "$(wc -l < "$T/out")" = 1 ] && ok "guarda_copia: para na pasta vazia (uma só linha de saída)" || { falha "guarda_copia: seguiu depois da pasta vazia"; cat "$T/out"; }
if [ -e "$T/git.log" ]; then falha "guarda_copia: rodou git na pasta vazia"; cat "$T/git.log"; else ok "guarda_copia: nenhum git rodou na pasta vazia"; fi
[ -d "$AH/vazia" ] && [ -z "$(ls -A "$AH/vazia")" ] && ok "guarda_copia: pasta vazia intacta" || falha "guarda_copia: mexeu na pasta vazia"
rmdir "$AH/vazia"

# mod/ existente e VAZIA: não há módulo; check e sync não inventam uma cópia
# «*» (o glob mod/*/ sem casamento fica literal e precisa ser descartado).
HV="$T/home-mod-vazia"
espera_rc "mod/ vazia: sync inicial" 0 env NUMIH_HOME="$HV" "$SYNC" sync
mkdir -p "$HV/mod"
espera_rc "mod/ vazia: check --no-fetch em dia" 0 env NUMIH_HOME="$HV" "$SYNC" check --no-fetch
grep -qF "$HV/mod/" "$T/out" && falha "mod/ vazia: check criou entrada falsa em mod/" || ok "mod/ vazia: check sem entrada falsa"
[ "$(grep -c ': HEAD ' "$T/out")" = 2 ] && ok "mod/ vazia: check lista só workspace e cursor" || { falha "mod/ vazia: check não lista exatamente 2 cópias"; cat "$T/out"; }
espera_rc "mod/ vazia: check com busca em dia" 0 env NUMIH_HOME="$HV" "$SYNC" check
grep -qF '*' "$T/out" && falha "mod/ vazia: check (busca) citou «*»" || ok "mod/ vazia: check (busca) sem «*»"
espera_rc "mod/ vazia: sync" 0 env NUMIH_HOME="$HV" "$SYNC" sync
grep -qF "$HV/mod/" "$T/out" && falha "mod/ vazia: sync tentou uma cópia em mod/" || ok "mod/ vazia: sync sem entrada falsa"
[ "$(ls -A "$HV/mod")" = "" ] && ok "mod/ vazia: continua vazia" || { falha "mod/ vazia: ganhou conteúdo"; ls -la "$HV/mod"; }
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
for v in x 0 00 -5 1.5; do
  espera_rc "recusa NUMIH_FETCH_TIMEOUT=$v" 1 env NUMIH_HOME="$T/home-lw" NUMIH_FETCH_TIMEOUT="$v" "$SYNC" check --no-fetch
  tem "motivo: NUMIH_FETCH_TIMEOUT=$v" "NUMIH_FETCH_TIMEOUT precisa ser um número inteiro de segundos maior que zero: $v$"
done
# Inteiro maior que zero, com zero à esquerda: aceito (é o que a mensagem diz).
espera_rc "aceita NUMIH_FETCH_TIMEOUT=05" 0 env NUMIH_FETCH_TIMEOUT=05 "$SYNC" mod lib
# Só com o algarismo 9 (a lista do dígito não nulo precisa ir até o 9).
for v in 9 99 09; do
  espera_rc "aceita NUMIH_FETCH_TIMEOUT=$v" 0 env NUMIH_FETCH_TIMEOUT="$v" "$SYNC" mod lib
done
[ ! -e "$T/home-lw" ] && ok "nada criado com NUMIH_FETCH_TIMEOUT inválido" || falha "criou o NUMIH_HOME com NUMIH_FETCH_TIMEOUT inválido"
# HOME falso dentro de $T: a guarda nunca é exercitada contra o HOME real.
mkdir -p "$T/falso"
espera_rc "recusa NUMIH_HOME = HOME" 1 env HOME="$T/falso" NUMIH_HOME="$T/falso" "$SYNC" check
[ ! -e "$T/falso/.lock" ] && ok "nada criado no HOME" || falha "criou .lock no HOME"
espera_rc "recusa NUMIH_HOME = HOME com barra no fim" 1 env HOME="$T/falso" NUMIH_HOME="$T/falso/" "$SYNC" check
espera_rc "recusa NUMIH_HOME acima do HOME" 1 env HOME="$T/falso" NUMIH_HOME="$T" "$SYNC" check
tem "motivo: NUMIH_HOME acima do HOME" "NUMIH_HOME não pode ser o HOME, um diretório acima dele nem a raiz"
# HOME que é link simbólico para o diretório real: o NUMIH_HOME apontado para o
# alvo (ou acima dele) é o próprio HOME e também é recusado.
mkdir -p "$T/hl/real"; ln -s real "$T/hl/link"
for v in "$T/hl/real" "$T/hl/real/" "$T/hl"; do
  espera_rc "recusa NUMIH_HOME=$v com HOME link para o alvo" 1 env HOME="$T/hl/link" NUMIH_HOME="$v" "$SYNC" check --no-fetch
  tem "motivo: HOME link ($v)" "NUMIH_HOME não pode ser o HOME, um diretório acima dele nem a raiz"
done
[ ! -e "$T/hl/real/.lock" ] && [ ! -e "$T/hl/.lock" ] && [ -z "$(ls -A "$T/hl/real")" ] \
  && ok "nada criado no alvo do HOME link" || { falha "criou algo no alvo do HOME link"; ls -la "$T/hl" "$T/hl/real"; }
# HOME ausente, vazio ou relativo: mensagem própria e saída 1 em todo
# subcomando, sem erro cru do bash nem do realpath, e nada criado.
mkdir -p "$T/cwd-h"
for c in sync check "check --no-fetch" map "mod lib" install; do
  # shellcheck disable=SC2086
  espera_rc "HOME ausente ($c)" 1 env -C "$T/cwd-h" -u HOME NUMIH_HOME="$T/home-semhome" "$SYNC" $c
  tem "motivo: HOME ausente ($c)" "^numih-sync: erro: HOME não está definido; defina-o"
  so_erros_proprios "HOME ausente ($c): só erro próprio"
  # shellcheck disable=SC2086
  espera_rc "HOME e NUMIH_HOME ausentes ($c)" 1 env -C "$T/cwd-h" -u HOME -u NUMIH_HOME "$SYNC" $c
  so_erros_proprios "HOME e NUMIH_HOME ausentes ($c): só erro próprio"
  # shellcheck disable=SC2086
  espera_rc "HOME vazio ($c)" 1 env -C "$T/cwd-h" HOME= NUMIH_HOME="$T/home-semhome" "$SYNC" $c
  tem "motivo: HOME vazio ($c)" "^numih-sync: erro: HOME está vazio; defina-o"
  so_erros_proprios "HOME vazio ($c): só erro próprio"
  # shellcheck disable=SC2086
  espera_rc "HOME vazio, NUMIH_HOME ausente ($c)" 1 env -C "$T/cwd-h" -u NUMIH_HOME HOME= "$SYNC" $c
  so_erros_proprios "HOME vazio, NUMIH_HOME ausente ($c): só erro próprio"
  # shellcheck disable=SC2086
  espera_rc "HOME relativo ($c)" 1 env -C "$T/cwd-h" HOME=rel NUMIH_HOME="$T/home-semhome" "$SYNC" $c
  tem "motivo: HOME relativo ($c)" "^numih-sync: erro: HOME precisa ser absoluto: rel$"
  so_erros_proprios "HOME relativo ($c): só erro próprio"
done
[ ! -e "$T/home-semhome" ] && [ -z "$(ls -A "$T/cwd-h")" ] && ok "nada criado sem HOME" || { falha "criou algo sem HOME"; ls -la "$T/cwd-h"; }
espera_rc "ajuda funciona sem HOME" 0 env -u HOME -u NUMIH_HOME "$SYNC" help
# Nomes e números só em ASCII, qualquer que seja o locale: com en_US.UTF-8,
# [A-Za-z0-9] casaria é e ñ, e [0-9] casaria ٣ (algarismo arábico-índico).
LOCALES=(C)
if locale -a 2>/dev/null | grep -qixE 'en_US\.utf-?8'; then LOCALES+=(en_US.UTF-8)
else echo "AVISO- sem o locale en_US.UTF-8 nesta máquina: as guardas ASCII só foram testadas com LC_ALL=C"; fi
for L in "${LOCALES[@]}"; do
  for n in é ñ "aé" "libñ" ٣ "a٣"; do
    espera_rc "mod recusa '$n' (LC_ALL=$L)" 1 env LC_ALL="$L" "$SYNC" mod "$n"
    tem "motivo: nome não ASCII '$n' (LC_ALL=$L)" "^numih-sync: erro: nome de repositório inválido: '$n'$"
    grep -q "clonando" "$T/out" && falha "tentou clonar '$n' (LC_ALL=$L)" || ok "não tentou clonar '$n' (LC_ALL=$L)"
  done
  espera_rc "mod aceita nome ASCII (LC_ALL=$L)" 0 env LC_ALL="$L" "$SYNC" mod lib
  # dígitos ASCII no meio e no início do nome
  for n in ab12 9z; do
    espera_rc "mod aceita nome com dígitos '$n' (LC_ALL=$L)" 0 env LC_ALL="$L" "$SYNC" mod "$n"
    [ -d "$NUMIH_HOME/mod/$n/.git" ] && ok "cópia de '$n' criada (LC_ALL=$L)" || falha "cópia de '$n' ausente (LC_ALL=$L)"
  done
  espera_rc "recusa NUMIH_LOCK_WAIT=٣ (LC_ALL=$L)" 1 env LC_ALL="$L" NUMIH_HOME="$T/home-lw" NUMIH_LOCK_WAIT=٣ "$SYNC" check --no-fetch
  tem "motivo: NUMIH_LOCK_WAIT=٣ (LC_ALL=$L)" "NUMIH_LOCK_WAIT precisa ser um número de segundos: ٣"
  for v in ٣ "1٣"; do
    espera_rc "recusa NUMIH_FETCH_TIMEOUT=$v (LC_ALL=$L)" 1 env LC_ALL="$L" NUMIH_HOME="$T/home-lw" NUMIH_FETCH_TIMEOUT="$v" "$SYNC" check --no-fetch
    tem "motivo: NUMIH_FETCH_TIMEOUT=$v (LC_ALL=$L)" "NUMIH_FETCH_TIMEOUT precisa ser um número inteiro de segundos maior que zero: $v"
  done
done
[ ! -e "$T/home-lw" ] && ok "nada criado com números não ASCII" || falha "criou o NUMIH_HOME com número não ASCII"
rm -rf "$NUMIH_HOME/mod/ab12" "$NUMIH_HOME/mod/9z"
for n in é ñ "aé" "libñ" ٣ "a٣"; do [ ! -e "$NUMIH_HOME/mod/$n" ] || falha "criou mod/$n"; done
# A raiz em qualquer grafia, em todos os comandos que escrevem ou buscam.
for v in / // /. /.. /// /./ /../..; do
  for c in check sync map "mod lib" install; do
    # shellcheck disable=SC2086
    espera_rc "recusa NUMIH_HOME=$v ($c)" 1 env HOME="$T/falso" NUMIH_HOME="$v" "$SYNC" $c
    tem "motivo: raiz ($v, $c)" "^numih-sync: erro: NUMIH_HOME não pode ser a raiz do sistema \(/\)"
  done
done
# NUMIH_HOME que é arquivo, .lock que é diretório ou fifo: mensagem própria, rc 1.
printf 'arquivo\n' > "$T/home-arquivo"
espera_rc "recusa NUMIH_HOME que é arquivo" 1 env NUMIH_HOME="$T/home-arquivo" "$SYNC" check --no-fetch
tem "motivo: NUMIH_HOME não é diretório" "NUMIH_HOME existe e não é diretório: $T/home-arquivo"
so_erros_proprios "NUMIH_HOME arquivo: só erro próprio, sem erro cru do bash"
[ "$(cat "$T/home-arquivo")" = arquivo ] && ok "arquivo do NUMIH_HOME intacto" || falha "mexeu no arquivo do NUMIH_HOME"
mkdir -p "$T/home-lockdir/.lock"
espera_rc "recusa .lock que é diretório" 1 env NUMIH_HOME="$T/home-lockdir" "$SYNC" check --no-fetch
tem "motivo: .lock diretório" "home-lockdir/\.lock existe e não é arquivo comum"
so_erros_proprios ".lock diretório: só erro próprio, sem erro cru do bash"
mkdir -p "$T/home-lockfifo"; mkfifo "$T/home-lockfifo/.lock"
espera_rc "recusa .lock que é fifo (sem pendurar)" 1 timeout 20 env NUMIH_HOME="$T/home-lockfifo" "$SYNC" check --no-fetch
tem "motivo: .lock fifo" "home-lockfifo/\.lock existe e não é arquivo comum"
# map sem a cópia do workspace: «ausente», como o check.
espera_rc "map sem workspace" 1 env NUMIH_HOME="$T/home-sem-ws" "$SYNC" map
tem "motivo: workspace ausente (map)" "^numih-sync: erro: workspace: ausente em $T/home-sem-ws/workspace \(rode: numih-sync sync\)$"
grep -q "não é repositório git" "$T/out" && falha "map ainda diz «não é repositório git» sem o diretório" || ok "map não diz «não é repositório git» sem o diretório"
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
# (a2) link para um irmão cujo nome começa com o do NUMIH_HOME (home-link-mau):
#      um teste de prefixo sem a barra deixaria passar.
mkdir -p "$HL-mau"; git clone -q "$T/remotos/workspace.git" "$HL-mau/workspace" 2>/dev/null
git -C "$HL-mau/workspace" reset -q --hard HEAD~1
git -C "$HL-mau/workspace" update-ref refs/remotes/origin/main HEAD
irmao_om="$(git -C "$HL-mau/workspace" rev-parse refs/remotes/origin/main)"
rm "$HL/workspace"; ln -s "$HL-mau/workspace" "$HL/workspace"
espera_rc "check recusa link para irmão com o mesmo prefixo" 1 env NUMIH_HOME="$HL" "$SYNC" check
tem "motivo: irmão com o mesmo prefixo" "workspace: $HL/workspace resolve para fora de $HL \($HL-mau/workspace\)"
espera_rc "sync recusa link para irmão com o mesmo prefixo" 1 env NUMIH_HOME="$HL" "$SYNC" sync
[ "$(git -C "$HL-mau/workspace" rev-parse refs/remotes/origin/main)" = "$irmao_om" ] && [ "$(git -C "$HL-mau/workspace" rev-parse HEAD)" = "$irmao_om" ] \
  && [ ! -e "$HL-mau/workspace/.git/hooks/pre-commit" ] \
  && ok "irmão com o mesmo prefixo intacto" || falha "check/sync mexeu no irmão com o mesmo prefixo"
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
# (g) Pasta vazia só conta como sobra de clone interrompido (e é removida) se
#     for diretório de verdade dentro de casa. mod/ é link para fora com uma
#     pasta vazia lá: recusada, e a pasta de fora fica.
mkdir -p "$T/home-link3" "$T/fora-mod3/lib"; ln -s "$T/fora-mod3" "$T/home-link3/mod"
espera_rc "mod recusa pasta vazia fora de casa" 1 env NUMIH_HOME="$T/home-link3" "$SYNC" mod lib
tem "motivo: pasta vazia fora de casa" "lib: $T/home-link3/mod/lib resolve para fora de $T/home-link3"
[ -d "$T/fora-mod3/lib" ] && ok "pasta vazia de fora não foi removida" || falha "removeu a pasta vazia de fora de casa"
# (h) mod/lib é link simbólico (dentro de casa) para uma pasta vazia: não é
#     sobra de clone; nem o link nem o alvo são tocados.
mkdir -p "$T/home-link4/mod" "$T/home-link4/vazia"; ln -s "$T/home-link4/vazia" "$T/home-link4/mod/lib"
espera_rc "mod recusa link para pasta vazia" 1 env NUMIH_HOME="$T/home-link4" "$SYNC" mod lib
tem "motivo: link para pasta vazia não é repositório" "^numih-sync: erro: $T/home-link4/mod/lib existe mas não é repositório git$"
[ -L "$T/home-link4/mod/lib" ] && [ -d "$T/home-link4/vazia" ] && ok "link e pasta vazia intactos" || falha "mexeu no link ou na pasta vazia"

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
# Clone e busca nunca recursam em submódulos (estrutural: o clone ignora o
# submodule.recurse, e a busca só recursaria em submódulo inicializado, que a
# cópia do workspace recusa; por isso a opção é conferida na linha de comando).
for op in fetch clone; do
  if grep -q " $op " "$T/git.log" && ! grep " $op " "$T/git.log" | grep -v -- "--no-recurse-submodules" >/dev/null; then
    ok "$op: sempre com --no-recurse-submodules"
  else falha "$op sem --no-recurse-submodules"; grep " $op " "$T/git.log" | head -3; fi
done
# Clone parcial (--filter=blob:none): com remotos locais o resultado é o mesmo
# com ou sem a opção (só muda o que é baixado), então também é estrutural.
if grep -q " clone " "$T/git.log" && ! grep " clone " "$T/git.log" | grep -v -- "--filter=blob:none" >/dev/null; then
  ok "clone: sempre parcial (--filter=blob:none)"
else falha "clone sem --filter=blob:none"; grep " clone " "$T/git.log" | head -3; fi
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
# kill -9 no numih-sync no meio da busca: a busca não fica órfã (o vigia do
# com_prazo recebe TERM pelo setpriv --pdeathsig, repassa ao timeout e, quando
# ele termina, derruba o grupo do git com KILL).
PENDURA2="$((PENDURA + 1))"; SOBRAS+=("$PENDURA" "$PENDURA2")
git config --global url."ext::sh -c sleep% $PENDURA2 ".insteadOf "pendura2://x/"
git -C "$NUMIH_HOME/cursor" config remote.origin.url "pendura2://x/cursor.git"
NUMIH_REMOTE_BASE=pendura2://x NUMIH_FETCH_TIMEOUT=200 "$SYNC" check >"$T/out-k9" 2>&1 & pk9=$!
vivo() { ps -eo args= | grep -qx "sleep $1"; }
for _ in $(seq 200); do vivo "$PENDURA2" && break; sleep 0.05; done
if vivo "$PENDURA2"; then
  kill -9 "$pk9"; wait "$pk9" 2>/dev/null || true
  for _ in $(seq 100); do vivo "$PENDURA2" || break; sleep 0.05; done
  vivo "$PENDURA2" && falha "kill -9 no numih-sync deixou a busca órfã" || ok "kill -9 no numih-sync não deixa a busca órfã"
else falha "a busca pendurada (kill -9) não começou"; cat "$T/out-k9"; kill -9 "$pk9" 2>/dev/null || true; fi
mata_sobras "$PENDURA2"
git -C "$NUMIH_HOME/cursor" config remote.origin.url "$T/remotos/cursor.git"
git config --global --unset url."ext::sh -c sleep% $PENDURA2 ".insteadOf
git config --global --unset url."ext::sh -c sleep% $PENDURA ".insteadOf
# git que ignora TERM: o --kill-after manda KILL 10 s depois do prazo.
PENDURA3="$((PENDURA + 2))"; SOBRAS+=("$PENDURA3")
ini=$SECONDS
espera_rc "busca que ignora TERM é morta pelo KILL" 1 timeout 45 env PATH="$T/shim:$PATH" NUMIH_TESTE_IGNORA_TERM="$PENDURA3" NUMIH_FETCH_TIMEOUT=1 "$SYNC" check
dur=$((SECONDS - ini))
tem "motivo: prazo (TERM ignorado)" "cursor: a busca na origin .* passou de 1 s \(NUMIH_FETCH_TIMEOUT\) e foi interrompida"
[ "$dur" -lt 30 ] && ok "o KILL veio depois do TERM ignorado ($dur s)" || falha "a busca que ignora TERM levou $dur s"
sleep 0.3
vivo "$PENDURA3" && falha "sobrou a busca que ignora TERM" || ok "nada sobrou da busca que ignora TERM"
mata_sobras "$PENDURA3"
# Filho do git que ignora TERM (ssh falso: trap '' TERM e um sleep filho). O
# git respeita o TERM e morre; o timeout termina junto, e só o vigia do
# com_prazo derruba o que sobrou no grupo (o ssh e o sleep).
PENDURA4="$((PENDURA + 3))"; SOBRAS+=("$PENDURA4")
printf '#!/bin/sh\ntrap "" TERM\nsleep %s\nexit 1\n' "$PENDURA4" > "$T/ssh-ignora-term"; chmod 0755 "$T/ssh-ignora-term"
ssh_vivo() { ps -eo args= | grep -q "^/bin/sh $T/ssh-ignora-term "; }
git -C "$NUMIH_HOME/cursor" config remote.origin.url "ssh://x/cursor.git"
# (a) prazo estourado, sem kill -9
espera_rc "busca com ssh que ignora TERM: prazo" 1 timeout 45 env GIT_SSH_COMMAND="$T/ssh-ignora-term" NUMIH_REMOTE_BASE=ssh://x NUMIH_FETCH_TIMEOUT=1 "$SYNC" check
tem "motivo: prazo (ssh que ignora TERM)" "cursor: a busca na origin \(ssh://x/cursor\.git\) passou de 1 s"
for _ in $(seq 20); do vivo "$PENDURA4" || ssh_vivo || break; sleep 0.05; done
vivo "$PENDURA4" || ssh_vivo && falha "prazo: o ssh que ignora TERM (ou o sleep dele) ficou órfão" || ok "prazo: nada sobrou do ssh que ignora TERM"
mata_sobras "$PENDURA4"
# (b) kill -9 no numih-sync no meio da busca
GIT_SSH_COMMAND="$T/ssh-ignora-term" NUMIH_REMOTE_BASE=ssh://x NUMIH_FETCH_TIMEOUT=200 "$SYNC" check >"$T/out-k9b" 2>&1 & pk9=$!
for _ in $(seq 200); do vivo "$PENDURA4" && break; sleep 0.05; done
if vivo "$PENDURA4" && ssh_vivo; then
  kill -9 "$pk9"; wait "$pk9" 2>/dev/null || true
  ini=$SECONDS
  # O --kill-after (10 s) não ajuda aqui (o git já morreu); 15 s de folga.
  for _ in $(seq 300); do vivo "$PENDURA4" || ssh_vivo || break; sleep 0.05; done
  dur=$((SECONDS - ini))
  if vivo "$PENDURA4" || ssh_vivo; then falha "kill -9 com ssh que ignora TERM: o ssh (ou o sleep dele) ficou órfão"
  else ok "kill -9 com ssh que ignora TERM: nada sobrou ($dur s)"; fi
else falha "a busca com ssh que ignora TERM (kill -9) não começou"; cat "$T/out-k9b"; kill -9 "$pk9" 2>/dev/null || true; fi
mata_sobras "$PENDURA4"
git -C "$NUMIH_HOME/cursor" config remote.origin.url "$T/remotos/cursor.git"

# Filtro estrito (fora_de_ws_cursor) testado sozinho, com chamadas reais pelo
# git falso num NUMIH_HOME próprio com workspace, cursor e mod/lib. Os casos
# que apontam o git para mod/lib a partir de `-C <home>/workspace` (segundo -C,
# --git-dir, --work-tree, -c core.worktree) precisam ser pegos; o controle
# confere com o git real que o segundo -C, o --git-dir e o --work-tree chegam
# mesmo a mod/lib (o filtro antigo, que só olhava o começo da linha, os
# aceitava). As chamadas legítimas do check precisam passar.
HF="$T/home-filtro"
for r in workspace cursor mod/lib; do git init -q "$HF/$r"; done
filtro_caso() { # descrição, pega|passa, pasta corrente, argumentos do git...
  local d="$1" e="$2" p="$3" f; shift 3
  rm -f "$T/git.log"
  (cd "$p" && PATH="$T/shim:$PATH" git "$@" >/dev/null 2>&1 9>&-) || :
  if [ ! -s "$T/git.log" ]; then falha "filtro: $d: o git falso não registrou a chamada"; return; fi
  f="$(fora_de_ws_cursor "$HF")"
  if [ "$e" = pega ]; then
    [ -n "$f" ] && ok "filtro: $d: pego" || { falha "filtro: $d: aceito, devia ser pego"; cat "$T/git.log"; }
  else
    [ -z "$f" ] && ok "filtro: $d: aceito" || { falha "filtro: $d: pego, devia ser aceito"; printf '%s\n' "$f"; }
  fi
}
# controle: os três casos de fato apontam o git para mod/lib (o git real)
[ "$(git -C "$HF/workspace" -C ../mod/lib rev-parse --show-toplevel 2>/dev/null)" = "$HF/mod/lib" ] \
  && ok "filtro: controle, segundo -C chega a mod/lib" || falha "filtro: controle, segundo -C não chega a mod/lib"
[ "$(git -C "$HF/workspace" --git-dir=../mod/lib/.git rev-parse --absolute-git-dir 2>/dev/null)" = "$HF/mod/lib/.git" ] \
  && ok "filtro: controle, --git-dir chega a mod/lib" || falha "filtro: controle, --git-dir não chega a mod/lib"
# Sem controle para o -c core.worktree: no git testado (2.56) ele é ignorado
# na linha de comando quando o git acha o repositório sozinho (o --work-tree
# não é). O filtro o pega mesmo assim, como qualquer -c fora das opções fixas.
OPTS_G=(-c gc.autoDetach=false -c maintenance.autoDetach=false)
filtro_caso "git -C workspace rev-parse (controle legítimo)" passa "$T" -C "$HF/workspace" rev-parse --git-dir
filtro_caso "git -C workspace com as opções do script, rev-parse" passa "$T" -C "$HF/workspace" "${OPTS_G[@]}" rev-parse --absolute-git-dir
filtro_caso "git -C cursor com as opções do script, status" passa "$T" -C "$HF/cursor" "${OPTS_G[@]}" status --porcelain=v1 --untracked-files=all --ignore-submodules=none
filtro_caso "git -C cursor com as opções do script, log com espaço no formato" passa "$T" -C "$HF/cursor" "${OPTS_G[@]}" log -1 --format=%cd "--date=format:%Y-%m-%d %H:%M"
filtro_caso "leitura global do core.sshCommand fora de casa" passa "$T" config --get core.sshCommand
filtro_caso "leitura do core.sshCommand dentro de casa" pega "$HF/mod/lib" config --get core.sshCommand
filtro_caso "M1: git -C workspace -C ../mod/lib rev-parse" pega "$T" -C "$HF/workspace" -C ../mod/lib rev-parse --git-dir
filtro_caso "M1: segundo -C depois das opções do script" pega "$T" -C "$HF/workspace" "${OPTS_G[@]}" -C ../mod/lib rev-parse --git-dir
filtro_caso "M2: git -C workspace --git-dir=../mod/lib/.git rev-parse" pega "$T" -C "$HF/workspace" --git-dir=../mod/lib/.git rev-parse --git-dir
filtro_caso "M2: --git-dir separado depois das opções do script" pega "$T" -C "$HF/workspace" "${OPTS_G[@]}" --git-dir ../mod/lib/.git rev-parse --git-dir
[ "$(git -C "$HF/workspace" --work-tree=../mod/lib rev-parse --show-toplevel 2>/dev/null)" = "$HF/mod/lib" ] \
  && ok "filtro: controle, --work-tree chega a mod/lib" || falha "filtro: controle, --work-tree não chega a mod/lib"
filtro_caso "M2: --work-tree=../mod/lib" pega "$T" -C "$HF/workspace" "${OPTS_G[@]}" --work-tree=../mod/lib status --porcelain
filtro_caso "M3: git -C workspace -c core.worktree=../mod/lib status" pega "$T" -C "$HF/workspace" -c core.worktree=../mod/lib status --porcelain
filtro_caso "M3: -c core.worktree=../../mod/lib depois das opções do script" pega "$T" -C "$HF/workspace" "${OPTS_G[@]}" -c core.worktree=../../mod/lib status --porcelain
filtro_caso "argumento --git-dir do rev-parse (depois do subcomando)" passa "$T" -C "$HF/cursor" "${OPTS_G[@]}" rev-parse --git-dir
filtro_caso "subcomando fora da lista fechada" pega "$T" -C "$HF/workspace" "${OPTS_G[@]}" worktree list
filtro_caso "git -C na própria mod/lib" pega "$T" -C "$HF/mod/lib" "${OPTS_G[@]}" rev-parse --git-dir
filtro_caso "git -C em <home>/workspace2 (prefixo parecido)" pega "$T" -C "$HF/workspace2" "${OPTS_G[@]}" rev-parse --git-dir
GIT_DIR="$HF/mod/lib/.git" filtro_caso "git -C workspace com GIT_DIR no ambiente" pega "$T" -C "$HF/workspace" rev-parse --git-dir
# GIT_WORK_TREE no ambiente (mutação FW): o controle confere com o git real
# que ele leva a árvore de trabalho a mod/lib mesmo com -C workspace.
[ "$(GIT_WORK_TREE="$HF/mod/lib" git -C "$HF/workspace" rev-parse --show-toplevel 2>/dev/null)" = "$HF/mod/lib" ] \
  && ok "filtro: controle, GIT_WORK_TREE chega a mod/lib" || falha "filtro: controle, GIT_WORK_TREE não chega a mod/lib"
GIT_WORK_TREE="$HF/mod/lib" filtro_caso "git -C workspace com GIT_WORK_TREE no ambiente" pega "$T" -C "$HF/workspace" status --porcelain
# O prefixo aceito (-C <home>/workspace) depois de outra coisa não vale: o
# filtro o ancora no começo dos argumentos (mutações FA e FB).
filtro_caso "-C mod/lib antes de -C workspace" pega "$T" -C "$HF/mod/lib" -C "$HF/workspace" rev-parse --git-dir
[ "$(git --git-dir="$HF/mod/lib/.git" -C "$HF/workspace" rev-parse --absolute-git-dir 2>/dev/null)" = "$HF/mod/lib/.git" ] \
  && ok "filtro: controle, --git-dir absoluto antes de -C workspace chega a mod/lib" || falha "filtro: controle, --git-dir absoluto antes de -C workspace não chega a mod/lib"
filtro_caso "--git-dir de mod/lib antes de -C workspace" pega "$T" --git-dir="$HF/mod/lib/.git" -C "$HF/workspace" rev-parse --git-dir
# git rodado em mod/lib, com -C workspace só nos argumentos do subcomando;
# «mod/lib/.» tem o comprimento de «workspace», então um filtro que achasse
# o prefixo em qualquer ponto e cortasse no comprimento dele cairia em
# «rev-parse» e aceitaria a linha.
filtro_caso "git -C mod/lib/. com -C workspace nos argumentos do subcomando" pega "$T" -C "$HF/mod/lib/." rev-parse --git-dir -C "$HF/workspace" status
# NUMIH_HOME com « pwd=» no caminho (mutação FP): o filtro separa os
# argumentos na ÚLTIMA ocorrência de « pwd=» (a do diretório corrente que o
# git falso grava), então a chamada legítima continua aceita.
HP="$T/home pwd=filtro"
for r in workspace mod/lib; do git init -q "$HP/$r"; done
HF="$HP" filtro_caso "NUMIH_HOME com « pwd=» no caminho, git -C workspace" passa "$T" -C "$HP/workspace" "${OPTS_G[@]}" rev-parse --git-dir
HF="$HP" filtro_caso "NUMIH_HOME com « pwd=» no caminho, git -C mod/lib" pega "$T" -C "$HP/mod/lib" "${OPTS_G[@]}" rev-parse --git-dir
rm -rf "$HF" "$HP" "$T/git.log"

# Sinal no próprio numih-sync durante um clone lento (remoto que pendura).
# TERM, HUP e KILL por PID matam o script na hora; o vigia (avisado pelo
# setpriv --pdeathsig) interrompe o git, que limpa o que baixou, mas a pasta
# criada pelo script fica, vazia. Antes, sync, check e mod falhavam nela
# («existe mas não é repositório git») até alguém apagá-la à mão. Agora o
# check aponta a pasta vazia e o sync (ou o mod) a remove e clona de novo.
PENDURA5="$((PENDURA + 4))"; SOBRAS+=("$PENDURA5")
git config --global url."ext::sh -c sleep% $PENDURA5 ".insteadOf "pendura5://x/"
# algum processo (fora o próprio grep) com o caminho nos argumentos
com_caminho() { ps -eo args= | grep -F -- "$1" | grep -qv '^grep '; }
for sig in TERM HUP KILL; do
  HS="$T/home-sinal-$sig"
  NUMIH_HOME="$HS" NUMIH_REMOTE_BASE=pendura5://x NUMIH_FETCH_TIMEOUT=200 "$SYNC" mod lib >"$T/out-sinal" 2>&1 & ps5=$!
  for _ in $(seq 200); do vivo "$PENDURA5" && break; sleep 0.05; done
  if vivo "$PENDURA5"; then
    kill -"$sig" "$ps5"; rcs=0; wait "$ps5" || rcs=$?
    # o git termina a própria limpeza e o vigia derruba o grupo
    for _ in $(seq 300); do com_caminho "$HS/mod/lib" || vivo "$PENDURA5" || break; sleep 0.05; done
    case "$sig" in TERM) esp=143 ;; HUP) esp=129 ;; KILL) esp=137 ;; esac
    [ "$rcs" = "$esp" ] && ok "$sig no numih-sync durante o clone: morreu pelo sinal (rc $rcs)" || falha "$sig no numih-sync: rc $rcs, esperado $esp"
    if vivo "$PENDURA5" || com_caminho "$HS/mod/lib"; then falha "$sig: o clone ficou órfão"; else ok "$sig: nada sobrou do clone"; fi
    [ -d "$HS/mod/lib" ] && [ ! -L "$HS/mod/lib" ] && [ -z "$(ls -A "$HS/mod/lib")" ] \
      && ok "$sig: sobra reproduzida (mod/lib vazia)" || { falha "$sig: mod/lib não ficou como pasta vazia"; ls -la "$HS/mod" "$HS/mod/lib"; }
    rm -f "$T/git.log"
    espera_rc "$sig: check aponta a pasta vazia" 1 env PATH="$T/shim:$PATH" NUMIH_HOME="$HS" NUMIH_REMOTE_BASE="$T/remotos" "$SYNC" check --no-fetch
    tem "$sig: motivo no check" "^numih-sync: erro: lib: $HS/mod/lib é uma pasta vazia \(sobra de um clone interrompido\); rode: numih-sync sync$"
    grep -q "não é repositório git" "$T/out" && falha "$sig: check ainda diz «não é repositório git»" || ok "$sig: check não diz «não é repositório git»"
    # o check para na pasta vazia: nenhum git roda nela (o git falso registra
    # cada chamada; o controle prova que o git do check passa por ele, e o
    # check final, com a cópia refeita, prova que o mesmo grep acha o git
    # que roda nela) e só uma linha a cita
    [ -s "$T/git.log" ] && ok "$sig: controle, o git falso registra o git do check" || falha "$sig: controle, o git do check não passou pelo git falso"
    grep -qF -- "$HS/mod/lib" "$T/git.log" 2>/dev/null && { falha "$sig: check rodou git na pasta vazia"; grep -F -- "$HS/mod/lib" "$T/git.log"; } || ok "$sig: check não roda git na pasta vazia"
    # e, mais estrito (filtro fora_de_ws_cursor): toda chamada do check é
    # `git -C` na workspace ou na cursor com um subcomando da lista fechada,
    # sem segundo -C, -c fora das opções fixas, --git-dir ou --work-tree e sem GIT_DIR nem
    # GIT_WORK_TREE no ambiente (um git apontado para a pasta vazia por uma
    # dessas vias, ou rodado fora das duas cópias, aparece aqui)
    fora="$(fora_de_ws_cursor "$HS")"
    [ -s "$T/git.log" ] && [ -z "$fora" ] && ok "$sig: check só roda git -C na workspace e na cursor, com subcomando da lista, sem segundo -C, outro -c, --git-dir, --work-tree, GIT_DIR ou GIT_WORK_TREE" || { falha "$sig: check rodou git fora do filtro estrito (outra pasta, segundo -C, -c, --git-dir, --work-tree, GIT_DIR ou GIT_WORK_TREE)"; printf '%s\n' "$fora" | head -5; }
    [ "$(grep -cF "$HS/mod/lib" "$T/out")" = 1 ] && ok "$sig: check cita a pasta vazia uma só vez" || { falha "$sig: check cita a pasta vazia mais de uma vez"; cat "$T/out"; }
    if [ "$sig" = KILL ]; then
      espera_rc "$sig: mod lib seguinte funciona" 0 env NUMIH_HOME="$HS" NUMIH_REMOTE_BASE="$T/remotos" "$SYNC" mod lib
    else
      espera_rc "$sig: sync seguinte funciona" 0 env NUMIH_HOME="$HS" NUMIH_REMOTE_BASE="$T/remotos" "$SYNC" sync
    fi
    tem "$sig: informa a pasta vazia removida" "^lib: pasta vazia de um clone interrompido removida \($HS/mod/lib\); clonando de novo$"
    copia_limpa_na_main "$sig: mod/lib clonado de novo, na main" "$HS/mod/lib"
    espera_rc "$sig: sync depois" 0 env NUMIH_HOME="$HS" NUMIH_REMOTE_BASE="$T/remotos" "$SYNC" sync
    rm -f "$T/git.log"
    espera_rc "$sig: check em dia depois" 0 env PATH="$T/shim:$PATH" NUMIH_HOME="$HS" NUMIH_REMOTE_BASE="$T/remotos" "$SYNC" check
    grep -qF -- "-C $HS/mod/lib " "$T/git.log" 2>/dev/null && ok "$sig: controle, o git do check na cópia refeita aparece no registro" || { falha "$sig: controle, o git do check na cópia refeita não aparece no registro"; cat "$T/git.log" 2>/dev/null || :; }
    fora="$(fora_de_ws_cursor "$HS")"
    grep -qF -- "args=-C $HS/mod/lib " <<<"$fora" && ok "$sig: controle, o filtro estrito acha o git do check na cópia refeita" || { falha "$sig: controle, o filtro estrito não acha o git do check na cópia refeita"; printf '%s\n' "$fora" | head -5; }
    # e as chamadas legítimas do mesmo check (workspace e cursor) passam por ele
    grep -qF -- "args=-C $HS/workspace " "$T/git.log" && grep -qF -- "args=-C $HS/cursor " "$T/git.log" \
      && ! grep -qF -e "args=-C $HS/workspace " -e "args=-C $HS/cursor " <<<"$fora" \
      && ok "$sig: controle, o filtro estrito aceita o git do check na workspace e na cursor" \
      || { falha "$sig: controle, o filtro estrito recusa (ou não viu) o git do check na workspace e na cursor"; printf '%s\n' "$fora" | grep -F -e "-C $HS/workspace " -e "-C $HS/cursor " | head -5 || :; }
  else falha "$sig: o clone lento não começou"; cat "$T/out-sinal"; kill -9 "$ps5" 2>/dev/null || true; fi
  mata_sobras "$PENDURA5"
done
# INT: o bash, esperando um comando em primeiro plano, só decide sobre o INT
# quando o comando termina, e só morre se o comando também morreu por INT.
# (a) Ctrl-C (INT ao grupo do numih-sync): o vigia recebe o INT e interrompe o
#     clone; o script segue, o clone conta como falho e a pasta é apagada na
#     hora. (b) INT só no PID do script: o clone segue até o prazo, e a pasta
#     também é apagada. Em segundo plano sem controle de tarefas o bash nasce
#     ignorando INT; o env --default-signal devolve o comportamento normal.
for modo in grupo pid; do
  HS="$T/home-sinal-INT-$modo"; ini=$SECONDS
  if [ "$modo" = grupo ]; then prazo5=200; else prazo5=2; fi
  setsid env --default-signal=INT NUMIH_HOME="$HS" NUMIH_REMOTE_BASE=pendura5://x NUMIH_FETCH_TIMEOUT="$prazo5" "$SYNC" mod lib >"$T/out" 2>&1 & ps5=$!
  for _ in $(seq 200); do vivo "$PENDURA5" && break; sleep 0.05; done
  if vivo "$PENDURA5"; then
    if [ "$modo" = grupo ]; then kill -INT -- "-$ps5"; else kill -INT "$ps5"; fi
    rcs=0; wait "$ps5" || rcs=$?; dur=$((SECONDS - ini))
    [ "$rcs" = 1 ] && ok "INT ($modo): o clone conta como falho (rc 1, $dur s)" || { falha "INT ($modo): rc $rcs"; cat "$T/out"; }
    [ "$dur" -lt 20 ] && ok "INT ($modo): terminou em $dur s" || falha "INT ($modo): levou $dur s"
    tem "INT ($modo): pasta apagada na hora" "^lib: pasta parcial do clone removida \($HS/mod/lib\)$"
    [ ! -e "$HS/mod/lib" ] && ok "INT ($modo): não sobra mod/lib" || falha "INT ($modo): sobrou mod/lib"
    for _ in $(seq 100); do vivo "$PENDURA5" || break; sleep 0.05; done
    vivo "$PENDURA5" && falha "INT ($modo): o clone ficou órfão" || ok "INT ($modo): nada sobrou do clone"
    espera_rc "INT ($modo): mod lib seguinte funciona" 0 env NUMIH_HOME="$HS" NUMIH_REMOTE_BASE="$T/remotos" "$SYNC" mod lib
  else falha "INT ($modo): o clone lento não começou"; kill -9 "$ps5" 2>/dev/null || true; fi
  mata_sobras "$PENDURA5"
done
git config --global --unset url."ext::sh -c sleep% $PENDURA5 ".insteadOf

# O vigia do com_prazo, isolado: o trecho entre «bash -c '» e «' numih-sync-prazo»
# é extraído do próprio script (as mutações valem aqui) e rodado com os
# argumentos que o com_prazo passa: pai, prazo, comando.
VIGIA="$(awk '/^  "\$\{PRAZO_PAI\[@\]\}" bash -c '"'"'$/ { f = 1; next } f && /^  '"'"' numih-sync-prazo / { exit } f' "$SYNC")"
case "$VIGIA" in *"timeout --kill-after"*) ok "trecho do vigia extraído do script" ;; *) falha "não consegui extrair o trecho do vigia" ;; esac
EU="$BASHPID"   # pai certo: este shell, que roda o vigia como filho direto
V="$T/vigia"; mkdir -p "$V"
# Injeção de falha determinística: um BASH_ENV com trap DEBUG registra cada
# comando do vigia e, uma única vez, manda TERM ao próprio vigia logo antes do
# comando cujo texto começa por $NUMIH_TESTE_GATILHO (o trap TERM do vigia já
# está armado nesse ponto).
cat > "$T/vigia-env.sh" <<'ENV'
trap 'case $BASH_COMMAND in "$NUMIH_TESTE_GATILHO"*) if [ -z "${_numih_disparou-}" ]; then _numih_disparou=1; printf "gatilho: %s\n" "$BASH_COMMAND" >> "$NUMIH_TESTE_LOG"; kill -TERM $$; fi ;; esac; printf "%s\n" "$BASH_COMMAND" >> "$NUMIH_TESTE_LOG"' DEBUG
ENV
# (M01) pai errado (o numih-sync morreu antes de o setpriv armar o aviso): sai
#       143 sem executar o comando. Controle: com o pai certo, executa.
rm -f "$V"/*
espera_rc "vigia com o pai certo executa o comando" 0 bash -c "$VIGIA" numih-sync-prazo "$EU" 30 sh -c ": > '$V/rodou'"
[ -e "$V/rodou" ] && ok "vigia com o pai certo: comando executado" || falha "vigia com o pai certo não executou o comando"
rm -f "$V"/*
espera_rc "vigia com o pai errado sai 143" 143 bash -c "$VIGIA" numih-sync-prazo 1 30 sh -c ": > '$V/rodou'"
[ ! -e "$V/rodou" ] && ok "vigia com o pai errado não executa o comando" || falha "vigia com o pai errado executou o comando"
# (M02) TERM depois de armado o trap e antes do timeout: sai 143 e o timeout
#       nem começa.
rm -f "$V"/*
espera_rc "vigia: TERM antes do timeout sai 143" 143 env BASH_ENV="$T/vigia-env.sh" NUMIH_TESTE_LOG="$V/log" NUMIH_TESTE_GATILHO='[ "$PPID"' \
  bash -c "$VIGIA" numih-sync-prazo "$EU" 30 sh -c ": > '$V/rodou'"
grep -q '^gatilho: \[ "\$PPID" = "\$pai" \]$' "$V/log" && ok "vigia: o TERM chegou antes do timeout" || { falha "vigia: o gatilho antes do timeout não disparou"; cat "$V/log"; }
grep -q '^timeout ' "$V/log" && falha "vigia: iniciou o timeout depois do TERM" || ok "vigia: não inicia o timeout depois do TERM"
[ ! -e "$V/rodou" ] && ok "vigia: TERM antes do timeout, comando não executado" || falha "vigia: executou o comando depois do TERM"
# (M03) TERM logo depois de iniciado o timeout, antes de o vigia saber o PID
#       dele (o trap ainda não tem a quem repassar): o vigia repassa o TERM
#       assim que sabe, e o comando não vai até o fim.
rm -f "$V"/*
ini=$SECONDS
espera_rc "vigia: TERM logo depois do timeout sai 143" 143 env BASH_ENV="$T/vigia-env.sh" NUMIH_TESTE_LOG="$V/log" NUMIH_TESTE_GATILHO='p=$!' \
  bash -c "$VIGIA" numih-sync-prazo "$EU" 30 sh -c "sleep 3; : > '$V/rodou'"
dur=$((SECONDS - ini))
grep -q '^gatilho: p=\$!$' "$V/log" && ok "vigia: o TERM chegou antes de p=\$!" || { falha "vigia: o gatilho p=\$! não disparou"; cat "$V/log"; }
[ "$dur" -lt 3 ] && [ ! -e "$V/rodou" ] && ok "vigia: o TERM foi repassado ao timeout ($dur s)" || falha "vigia: o comando foi até o fim depois do TERM ($dur s)"
# (M04) TERM no meio: o vigia repassa ao timeout, que repassa ao git, e espera
#       o timeout terminar antes do KILL ao grupo, dando ao git o tempo de se
#       limpar. O git falso trata TERM e só grava o marcador de limpeza 1 s
#       depois; um KILL logo após o TERM o impediria.
LIMPA="$((PENDURA + 4))"; SOBRAS+=("$LIMPA")
cat > "$T/git-limpa" <<GIT
#!/bin/sh
trap 'sleep 1; : > "$V/limpo"; exit 143' TERM
: > "$V/comecou"
sleep $LIMPA &
wait
GIT
chmod 0755 "$T/git-limpa"
rm -f "$V"/*
bash -c "$VIGIA" numih-sync-prazo "$EU" 30 "$T/git-limpa" & pv=$!
for _ in $(seq 200); do [ -e "$V/comecou" ] && break; sleep 0.05; done
if [ -e "$V/comecou" ]; then
  kill -TERM "$pv"; rcv=0; wait "$pv" || rcv=$?
  [ "$rcv" = 143 ] && ok "vigia: TERM no meio sai 143" || falha "vigia: TERM no meio saiu $rcv"
  [ -e "$V/limpo" ] && ok "vigia: o git terminou a própria limpeza antes do KILL ao grupo" || falha "vigia: KILL ao grupo antes de o git se limpar"
else falha "o git falso do vigia não começou"; kill -9 "$pv" 2>/dev/null || true; fi
sleep 0.3
ps -eo args= | grep -qx "sleep $LIMPA" && falha "vigia: sobrou processo do git falso" || ok "vigia: nada sobrou do git falso"
mata_sobras "$LIMPA"

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
