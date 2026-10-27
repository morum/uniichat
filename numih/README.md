# Numih — base de referência do Unii (P119, fase 1)

Prepara o Unii para fazer demandas da Numih com visão do ecossistema inteiro
(repositório `Numih/workspace`) e seguindo as regras do repositório
`Numih/cursor`. Esta fase não altera o código do servidor: só cria cópias de
referência, o mapa de módulos e o plano de como as regras chegarão aos agentes.

| Arquivo | O que é |
|---|---|
| `bin/numih-sync` | Mantém as cópias de referência em `~/.unii/numih` (clone, fetch, avanço rápido, checagem). |
| `bin/numih-map.ts` | Gera o mapa de módulos a partir do `.gitmodules` e do catálogo de portas. |
| `MODULOS.md`, `modulos.json` | Mapa gerado (instantâneo; a cópia viva fica em `~/.unii/numih`). |
| `PILOTO-agents.md` | O que o piloto «conexão de MCP de um agente do módulo agents» toca. |
| `FASE2-REGRAS.md` | Plano de como as regras do `cursor` chegarão aos agentes do Unii. |
| `test-numih-sync.sh`, `NumihMap.test.ts` | Testes (remotos locais e fixtures; não usam a rede nem `~/.unii/numih`). |

## Cópias de referência (`~/.unii/numih`)

```
~/.unii/numih/
├── bin/            numih-sync e numih-map.ts instalados
├── workspace/      Numih/workspace na main, SEM submódulos inicializados
├── cursor/         Numih/cursor na main (catalog/ é a fonte das regras)
├── mod/<nome>/     cópias de módulos, sob demanda (numih-sync mod <nome>)
├── modulos.json    mapa gerado
└── MODULOS.md      mapa gerado
```

São **somente leitura**: clone parcial (`--filter=blob:none`, sem `--depth`),
`pushurl` inválida e ganchos que recusam commit, merge, rebase e push. Ninguém
trabalha nelas: o trabalho de uma demanda acontece num clone ou worktree próprio
do submódulo (fase 3). As cópias antigas em `~/repository/numih` não são usadas
nem alteradas.

## Comandos

```bash
numih/bin/numih-sync install        # copia os scripts para ~/.unii/numih/bin
~/.unii/numih/bin/numih-sync sync   # clona o que falta e avança tudo para a origin/main
~/.unii/numih/bin/numih-sync check  # quantos commits cada cópia está atrás (rc 0 em dia, 10 atrás, 1 erro)
~/.unii/numih/bin/numih-sync mod agents   # cópia de referência de Numih/agents
~/.unii/numih/bin/numih-sync map    # regenera modulos.json e MODULOS.md (usa gh api, só GET)
```

O `sync` é idempotente e só avança por fast-forward. Se uma cópia estiver fora
da `main`, com alteração local, com commit local, rasa, com submódulo
inicializado, com a `origin` trocada ou com o histórico reescrito na origin, ele
para com erro e não toca nela. Se a busca falhar (rede, remoto inacessível),
`sync` e `check` saem com erro (1), nunca com «em dia». Recusa `NUMIH_HOME`
relativo, igual ao `HOME` ou dentro de `~/repository`, sem criar nada.

Os ganchos de recusa ficam no `.git/hooks` de cada cópia, e o `core.hooksPath`
é fixado no config **local** da cópia. Um `core.hooksPath` global do usuário
nunca é lido para escrita nem alterado.

Duas execuções simultâneas se serializam por uma trava (`flock` em
`$NUMIH_HOME/.lock`): a segunda espera até `NUMIH_LOCK_WAIT` segundos (padrão
120) e, se a trava não sair, desiste com erro.

## Testes

```bash
bash numih/test-numih-sync.sh   # 68 verificações com remotos git locais num tmp próprio
bun test numih/                 # 8 testes do gerador do mapa (repositório git, fixtures, gh falso)
```

Os testes usam `HOME`, `NUMIH_HOME`, config global do git e `GH_CONFIG_DIR`
temporários. Isso **não** isola as credenciais do `gh`: ele pode achá-las no
chaveiro do sistema (keyring), que não depende do `HOME`. Por isso nenhum teste
chama o `gh` real nem a rede: o `numih-sync` é testado com remotos locais, e o
`numih-map`, com fixtures (`--offline`) ou com um `gh` falso no `PATH`.

O cabeçalho do `MODULOS.md` conta os gitlinks reais da `main` do workspace
(81) e, à parte, as seções do `.gitmodules` (82): `libs/nusip` tem seção, mas
não tem gitlink.
