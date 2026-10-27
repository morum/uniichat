# Piloto: «Possibilitar conexão de MCP de um agente do módulo agents»

Levantamento só de leitura, feito em `~/.unii/numih/mod/agents` (Numih/agents na
`main`, `f7a900e`), no `.gitmodules` do workspace (`762a30b`), no catálogo de
portas (`Numih/devtools@0e28e46`) e nos repositórios `Numih/mcp` e
`Numih/gateway` via `gh api`. Nenhuma issue do Linear foi lida: o Unii ainda não
tem acesso ao Linear (P113).

## Como é hoje

- **Agente da Numih → MCP (cliente).** O runner do `agents` abre, a cada turno,
  uma sessão MCP contra **um único** servidor: o do `mcp` (ex-`ai_assistente`),
  cujo endereço vem da variável global `NUMIH_AI_ASSISTENTE_MCP_URL`
  (`server/internal/config/config.go`, `server/cmd/server/server.go:280`). Vazia,
  o agente roda sem ferramentas. A identidade do agente segue assinada pelo
  `SigningTransport` (`dp-bk-http/security`) e quem autoriza é o gateway GraphQL.
  Não há cadastro de servidores MCP por agente.
- **Agente externo → Numih (servidor).** A página «Conexões externas»
  (`client/src/pages/conexoes`) ensina a ligar Claude, ChatGPT, Claude Code,
  Cursor e VS Code ao `/api/mcp` do gateway pelo login OAuth de uma pessoa
  (conexão delegada). A opção «Chave de API (agente autônomo)» está
  **desabilitada** («NUM-2367/NUM-2368»), e o registro de conexões no hub espera
  a NUM-2370. O teste de conexão (`conexaoMcpValidacaoIniciar`/`conexaoMcpValidar`,
  erros AGT060–AGT062) já existe.

## Duas leituras do pedido — decisão de produto, não do agente

O título cabe nas duas direções. Pela regra `25-limites-agente`, escolher entre
elas é decisão de produto: o Unii pergunta ao usuário (ou lê a issue no Linear)
antes de escrever código.

| | A. O agente da Numih se conecta a outros servidores MCP | B. Um agente externo se conecta como agente autônomo (chave de API) |
|---|---|---|
| O que muda | Cadastro de servidores MCP por agente (URL, credencial no `cofre`, ferramentas permitidas); o runner junta as ferramentas de várias fontes | Emissão de chave para agente autônomo; o gateway aceita a chave no `/api/mcp` e hidrata a identidade do agente; a tela habilita «Chave de API» |
| Rastro no código | `mcpclient.NovaFonte` (uma URL fixa), `cofre` (já guarda segredos das fontes de crédito), P110 / `agents#53` (renomeia a variável do MCP) | `clientes-mcp.ts` (`CHAVE_API` desabilitada), NUM-2367/2368/2370, `gateway` (`/mcp/*path`, OAuth `allowedClientIds`) |

## Módulos que o piloto toca

| Submódulo (workspace) | Repositório | Leitura A | Leitura B | Por quê |
|---|---|---|---|---|
| `modules/agents` | Numih/agents | sim (server e client) | sim (client; talvez server) | entidade, migration, GraphQL, runner/`mcpclient`, tela |
| `modules/ai_assistente` | Numih/mcp (renomeado) | talvez | sim | servidor MCP do ERP; recebe a identidade pelo gateway |
| `services/gateway` | Numih/gateway | não | sim | rota `/mcp/*path`, OAuth, autenticação por chave |
| `modules/auth` | Numih/auth | sim (roles `agents:*`) | sim (identidade e chave do agente) | RBAC; identidade cunhada do agente |
| `services/nm-bk-graphql-gateway` | Numih/nm-bk-graphql-gateway | sim | talvez | supergraph (skill `atualizar-schema-gateway`) |
| `libs/dp-bk-llm` | Numih/dp-bk-llm | talvez | não | `agent.Loop` consome as ferramentas |
| `libs/dp-bk-http` | numih/dp-bk-http | talvez | sim | assinatura interna da identidade |
| `tools/devtools` | Numih/devtools | E2E | E2E | stack local (fase 5) e catálogo de portas |
| `infra/infra-tf-numih` | numih/infra-tf-numih | se houver variável nova | se houver segredo novo | infraestrutura: só o usuário mescla e aplica |

Dependências do `agents` no `go.mod`: `arquivos`, `auth`, `bilhetagem`, `core`,
`notificacoes`, `pabx` (servidores) e `dp-bk-crud`, `dp-bk-graphql`,
`dp-bk-http`, `dp-bk-llm`, `dp-bk-logger`, `dp-bk-messaging`, `dp-bk-otel`,
`dp-bk-postgres`. RPC em uso: `arquivos`, `auth`, `core`, `pabx`.

## Achados que afetam o piloto

1. **Porta do `agents` diverge do catálogo.** `ports.yaml` dá idx 45
   (`be_local` 8145, `be_docker` 9045, `fe_local` 11045), mas o
   `module.dev.yaml` e o README do `agents` usam 8140/11040 — que são as portas
   do `analitica` (idx 40). O catálogo é a fonte da verdade (`20-ports-catalog`);
   o E2E local (fase 5) colide se o `analitica` subir junto. Há divergência
   também em `acervo` (8134, que é do `bilhetagem`, × 8137) e `notificacoes`
   (8090 × 8116). Ver `MODULOS.md`.
2. **Banda do agente de IA.** Pela regra 7 do `20-ports-catalog`, o agente usa
   `9000+idx` / `10000+idx` e supergraph próprio na `4100`; nunca a banda
   humana (`8100+idx`, `11000+idx`, `4000`).
3. **`agents#53` está aberto** («`NUMIH_MCP_URL` para o servidor MCP
   renomeado (NUM-2730)») e mexe justamente na variável do MCP; a issue de
   remoção da variável antiga (P110) não foi criada por falta de acesso ao
   Linear. A leitura A mexe no mesmo código: o ideal é o `agents#53` entrar
   antes, para o piloto partir dele.
4. **Workspace com nome antigo.** O caminho `modules/ai_assistente` aponta para
   um repositório que hoje se chama `Numih/mcp`; o README do workspace exige
   caminho e URL com o nome atual.
