# Fase 2: como as regras do `cursor` chegam aos agentes do Unii

## Estado: implementado na branch `feat/numih-fase2`

Decisões do usuário (P122): núcleo **inteiro** no prompt; skills do `cursor`
em **todas** as tarefas; piloto «Outra» (ver `PILOTO-mcp-agentes.md`).
A tabela abaixo descreve o estado atual. As seções depois de «Plano
original» registram o plano anterior à implementação e estão superadas onde
divergem desta tabela.

| Item do plano | Como ficou |
|---|---|
| Tarefa Numih | O Unii marca no `spawn`: `numih: true`. A marca fica na nota do agente («subagent … with the Numih rules, labeled …»), então sobrevive a um reinício. |
| Núcleo no prompt | `Numih.ts` lê, a cada chamada, `cursor/dist/managed/CLAUDE.md` da cópia de referência (`Machine.numih_home`: a configuração `numih_home`; sem ela, `$NUMIH_HOME` se for caminho absoluto; senão, `~/.unii/numih`) e o põe **inteiro** no prompt do sistema, depois do texto do Unii e antes das instruções do usuário. Vale para qualquer fornecedor: o Claude Code recebe o texto como `systemPrompt`; o Cursor CLI, como a regra `alwaysApply` `.cursor/rules/unii.mdc`. |
| Índice das regras por caminho | Gerado na hora a partir de `cursor/dist/claude-plugin/rules-global` (25 regras; o `_numih-nucleo.md`, que repete o núcleo, fica fora): nome, título, padrões de caminho e arquivo. A instrução manda ler a regra inteira antes de criar ou editar arquivo que case com o padrão; a `25-isolamento-de-testes` vale para todo teste. |
| Teto | `numih_rules_max` (padrão 131072 bytes). Acima dele o pacote **não** é cortado: nada é injetado e um aviso diz o tamanho, o teto e quais arquivos ler por inteiro. |
| Pacote ausente | Aviso no lugar: as regras faltam, o agente não faz commit, push nem PR em repositório da Numih e relata ao Unii (que roda `numih-sync sync`). |
| Log | Cada chamada registra «unii: regras da Numih para <agente>: N bytes injetados (cursor <commit>)», ou por que não. N é o tamanho em bytes do texto exatamente como entra no prompt, sem espaço nem quebra de linha nas pontas. |
| Skills | `Machine.skills` inclui `cursor/dist/claude-plugin/skills` (49 skills; `claude-mem-memory` fica fora, P118) em **todas** as tarefas, depois das do usuário e do projeto (nome repetido: vale o do usuário). Cinco delas têm cabeçalho que o YAML estrito recusa («Numih: sobe a stack…»); o cabeçalho recusado agora é lido linha a linha, com blocos dobrados (`>`) e literais (`|`) e continuação de valor simples; um valor que essa leitura não entende (aspas sem fechar, lista, mapa, âncora, alias, rótulo) deixa a skill de fora, como o YAML estrito deixava. As skills vêm do mesmo diretório que as regras: o servidor envia a configuração `numih_home` nos trabalhos `skills` e `skill` do dispositivo, e o dispositivo a lê pela mesma regra (`Machine.numih_home`). |

Não feito nesta fase: o script `numih-regras` (o pacote é montado na hora,
sem arquivo intermediário); as regras «promovidas» além do núcleo
(`25-isolamento-de-testes` só é citada no índice); o gate
`numih-guard-scan.mjs` antes do push (fase 3); `.cursor/rules` do `cursor`
materializado no worktree da tarefa (o Cursor CLI já recebe tudo pela
`unii.mdc`); o teste ponta a ponta com um agente real (fase 5 ou piloto).

## Plano original (superado)

Registro do plano anterior à implementação. Onde ele diverge da tabela de
estado acima, vale a tabela. Plano, sem código nesta fase. Fonte: `~/.unii/numih/cursor` na `main`
(`76183bd`). Decisões do usuário já tomadas (P118): a regra
`10-claude-mem-memory` não vale para o Unii; E2E local no DevTools em Docker
(fase 5); o Unii abre o PR, o usuário revisa e, depois da aprovação dele, o Unii
mescla como administrador; infraestrutura, só o usuário mescla e aplica.

## Ponto de partida: por que nada chega hoje

1. O agente do Unii (fornecedor `claude-sub`, `ClaudeSub.ts`) roda o Claude Code
   com `settingSources: []`, `plugins: []`, `skills: []` e `systemPrompt` do
   próprio Unii. Nem `CLAUDE.md`, nem `.claude/rules`, nem o plugin `erp@numih`
   são carregados. As regras `numih-*` que existem em
   `~/.unii-arteeh/claude-sub/rules` ficam lá sem efeito.
2. As ferramentas do agente são as do Unii (shell, read, write, edit pelo MCP do
   Unii), não `Read`/`Edit`/`Bash` do Claude Code. Por isso, mesmo ligando o
   plugin, as regras por caminho (`paths:`) e o gancho `numih-guard.mjs`
   (`PreToolUse` em `Edit|Write|Bash`) **não disparariam**. O canal tem de ser do
   próprio Unii, e vale igual para qualquer fornecedor (Cursor, P115, incluído).

## O repositório `cursor` já classifica as regras

Cada `catalog/rules/*.mdc` declara `claudeChannel`. O plano segue essa
classificação, que é a mesma usada para gerar `dist/managed/CLAUDE.md` e o
plugin, em vez de inventar outra:

| Canal | Regras | Como chega ao agente do Unii |
|---|---|---|
| `nucleo` (sempre ativo) | `10-branch-pr-conventions`, `10-naming-conventions`, `20-arquitetura-geral`, `20-ports-catalog`, `25-limites-agente`, `25-validacao-vencimento` | **Texto integral no prompt do sistema** de toda tarefa Numih, lido de `dist/managed/CLAUDE.md` (gerado, ~71 KB, ~18 mil tokens; o cache de prompt reduz o custo nas chamadas seguintes). |
| `rule` (por caminho) | 25 regras com `paths:`/`globs` (frontend, GraphQL, goose, multi-tenancy, RLS, testes…) | **Índice no prompt** (nome, descrição, padrões de caminho e o arquivo em `~/.unii/numih/cursor/dist/claude-plugin/rules-global/`). Instrução: antes de criar ou editar arquivo que case com o padrão, ler a regra inteira. O verificador confere. |
| `skill` (sob demanda) | `30-postgres-*`, `30-date-system`, `30-usar-go-doc…`, `50-rollout-process` e as 41 skills de `catalog/skills` | **Skills do Unii** (`Machine.skills`). Superado: estão em todas as tarefas (P122), lidas de `dist/claude-plugin/skills`. |
| `dissolve` | `00-index`, `00-mdc-standards`, `00-skill-standards`, `30-postgres` | Fora. Valem só para quem edita o próprio repositório `cursor`. |

## O que se aplica, o que se ignora e por quê

**Obrigatório em toda tarefa Numih** (núcleo, mais estas, promovidas pelo Unii):

- **Branch e PR** (`10-branch-pr-conventions`): `{tipo}/{descricao_breve}_{num-xx}`,
  título conventional com `(NUM-xx)`, corpo `Fixes NUM-xx`, push pelo nome da
  branch, nunca `HEAD`; `--force-with-lease=branch:sha` se precisar; commit e PR
  só **dentro do submódulo**, nunca no workspace; ponteiro do workspace nunca à
  mão.
- **Limites do agente** (`25-limites-agente`): não executa destruição de dados
  nem migration que remove tabela ou coluna; decisão de produto para, comenta na
  issue e vai para «Aguardando decisão»; **sem PR enquanto houver pendência**;
  não altera regras que o restringem (só propõe).
- **Isolamento de testes** (`25-isolamento-de-testes`): canal `rule`, mas o Unii
  o trata como obrigatório, porque todo agente roda testes.
- **Portas** (`20-ports-catalog`, regra 7): o agente usa a banda
  `9000+idx`/`10000+idx` e o supergraph `4100`; nunca a banda humana
  (`8100+idx`, `11000+idx`, `4000`). Base do E2E da fase 5.
- **Migrations**: além de `20-goose-migrations`, a instrução da organização:
  migration que já está na `main` nunca se edita (cria-se outra); a que ainda não
  foi mesclada se edita em vez de corrigir com outra.
- **Issues só no Linear** (README do workspace, skill `criar-issue-linear`).
- **Português do Brasil correto** em todo texto de interface (instrução da
  organização).

**Ignorado, com motivo:**

| Item | Motivo |
|---|---|
| `10-claude-mem-memory` (claude-mem, MemPalace, aviso «[memória]») | Decisão do usuário (P118): o Unii tem memória própria. |
| Plugin `erp@numih`, managed settings, `setup-claude.sh`, `setup-cursor-rules.sh` (descontinuado), gancho `sync-global-rules.mjs`, `make claude-setup` | Mecanismos do Claude Code interativo; não disparam com as ferramentas do Unii (item 2 acima). `make claude-setup` ainda escreveria nos submódulos. |
| `00-mdc-standards`, `00-skill-standards` (loop de melhoria contínua) | Só para quem edita o repositório `cursor`; o Unii não abre PR lá sem ordem. |
| `30-go-tool-distribution` | Fica no índice (canal `rule`), mas só se aplica a ferramentas Go publicadas pelo próprio `cursor`. |

**Adaptado:**

| Item | Adaptação |
|---|---|
| Skill `resolver-issues-linear-mcp` | Pressupõe MCP do Linear (o Unii ainda não tem: P113), Chrome MCP e os painéis `tmux` **do usuário**. O Unii não lê nem escreve nos painéis do usuário; a validação ao vivo usa o próprio ambiente do agente (fase 5). Sem Linear, a demanda vem do chat e os comentários de issue ficam pendentes. |
| «Confirme a branch com o usuário» | O Unii cria a branch pela convenção e informa; não trabalha em branch de outra pessoa. |
| Merge | Política do usuário (P118), não a da skill: PR aberto pelo Unii, revisão do usuário, merge pelo Unii como administrador após a aprovação dele; infraestrutura, só o usuário. |
| Gancho `numih-guard` | Sem gancho no Unii, o **gate de CI** roda antes do push: `node ~/.unii/numih/cursor/scripts/ci/numih-guard-scan.mjs` no worktree do submódulo (checagens `block`: migration imutável, etc.). Falhou, não há push. |
| Fornecedor Cursor (P115) | Além do prompt, `adapters/cursor-cli/sync.mjs sync` materializa `.cursor/rules` no worktree da tarefa (fora do git via `.git/info/exclude`), porque o `cursor-agent` lê regras de projeto. |

## Entregas previstas no plano (superadas)

O que o plano previa, com o que foi feito em cada item:

1. `numih-regras` (script, sob `numih/bin`): gera, a partir de
   `~/.unii/numih/cursor`, o `~/.unii/numih/regras/prompt.md` (núcleo +
   promovidas + índice das regras por caminho + políticas do usuário), com o
   commit do `cursor` no cabeçalho. Determinístico e testado. Não feito: o
   pacote é montado na hora por `Numih.ts`, sem arquivo intermediário.
2. Servidor: tarefa marcada como Numih (rótulo ou `ref`) recebe esse texto no
   prompt do sistema, para qualquer fornecedor. É código do servidor: PR próprio,
   com verificador não autor. Feito: a marca é `numih: true` no `spawn`.
3. Skills: `Machine.skills` passa a incluir `~/.unii/numih/cursor/catalog/skills`
   só em tarefas Numih. Feito de outro modo: `dist/claude-plugin/skills`, em
   todas as tarefas (P122).
4. Teste ponta a ponta: um agente de teste numa tarefa Numih responde, sem ler
   arquivo nenhum, qual o nome de branch para a NUM-37 e qual porta usar para o
   `agents`; e lê a regra certa antes de editar um `*_test.go`. Não feito:
   fica para a fase 5 ou para o piloto.

## Decisões levadas ao usuário (resolvidas na P122)

1. Injetar o núcleo **integral** (~18 mil tokens por tarefa Numih) ou um resumo
   com leitura obrigatória do texto completo? Recomendação: integral, porque é o
   mesmo texto que a equipe recebe e o cache de prompt reduz o custo; resumo é
   onde a regra se perde. Resposta do usuário: integral.
2. Skills da Numih visíveis só em tarefas Numih (recomendado) ou em todas.
   Resposta do usuário: em todas.
