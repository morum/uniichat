# Piloto: agentes do Unii no MCP da Numih (levantamento da fase 2)

Pedido do usuário na P122 (opção «Outra»): «Há um repositório mcp que expõe
mcp da numih como usuários, deve ser possível utilizar com agentes também».
Esta fase só registra onde está esse repositório e como o Unii ligaria um
agente a ele. Nada foi implementado nem testado contra um servidor real. O
piloto é da fase 6.

Fontes, todas lidas sem rede e sem escrita: `~/.unii/numih/modulos.json`, a
cópia de referência `~/.unii/numih/mod/agents` (`Numih/agents` na `main`), a
cópia antiga `~/repository/numih/mono/ai_assistente` (`88d4862`, de
10/06/2026; pode estar desatualizada) e o `Mcp.ts` do Unii.

## O repositório

| Item | Valor |
|---|---|
| Repositório | `Numih/mcp` (antes `Numih/ai_assistente`; o workspace ainda o chama `modules/ai_assistente`, gitlink `4315647e`). Verificado sem rede em 27/10/2026: o gitlink, com `git ls-tree` na cópia `~/.unii/numih/workspace` (commit `762a30b8`); o nome `Numih/mcp`, só no campo `canonico` de `~/.unii/numih/modulos.json` (gerado pelo `numih-map` a partir do GitHub). O nome não foi confirmado de novo no GitHub. |
| O que é | Servidor MCP (Streamable HTTP, `POST /mcp`) que expõe o ERP a agentes de IA pelo gateway GraphQL. Produto de usuário final. |
| Portas (catálogo) | `ai-assistente-mcp`: 4447 (`docker_stable`), 4448 (`local_dev`). Lidas em `~/.unii/numih/modulos.json`, que o `numih-map` gera a partir do catálogo de portas do `devtools`. O catálogo em si não foi lido: não há cópia local do `devtools`. Não verificado na fonte. |
| Ferramentas | `graphql_listar_operacoes`, `graphql_descrever_tipo`, `graphql_executar_query`, `graphql_executar_mutation` (ligada por padrão: `AI_ASSISTENTE_ALLOW_MUTATIONS=true`), `numih_descobrir_dominios`, `numih_buscar_operacoes`, `numih_descrever_operacao`, `numih_validar_operacao`, `numih_exemplos`, `numih_consultar_glossario` |
| Autenticação | O servidor não autentica. O gateway da Numih autentica (OAuth 2.1 ou sessão), hidrata a identidade e assina os cabeçalhos internos; o RBAC fica nos subgrafos. Chamada direta a `/mcp` só serve para o aperto de mão e a lista de ferramentas. |
| Endereço para clientes | `<origem do ambiente>/api/mcp` (`CAMINHO_MCP` em `agents/client/src/pages/conexoes/clientes-mcp.ts`). As origens de homologação e produção não foram verificadas. |

«Como usuários» quer dizer conexão **delegada**: o cliente entra pelo login
OAuth da Numih e age com as permissões de quem conectou. A conexão de um
agente autônomo com chave de API própria existe só na tela, desabilitada
(NUM-2367, NUM-2368; registro no hub: NUM-2370).

## Como o Unii ligaria um agente

O Unii já repassa aos agentes as ferramentas dos servidores MCP do usuário
(configuração `mcp`, no formato `mcpServers`; ferramentas
`<servidor>__<ferramenta>`), em qualquer fornecedor. O `Mcp.ts` aceita
programa local (stdio), programa num dispositivo ou URL com cabeçalhos fixos.
Ele **não** faz o fluxo OAuth. Três caminhos, nenhum testado:

1. **Ponte OAuth em stdio.** Um programa local que faz o login OAuth no
   navegador uma vez, guarda o token, o renova e expõe o servidor remoto por
   stdio (por exemplo, o pacote `mcp-remote`). Configuração do Unii:
   `"numih": {"command": "npx", "args": ["-y", "mcp-remote", "<origem>/api/mcp"]}`.
   Não muda código do Unii. Risco: a ponte é código de terceiros com acesso
   ao token.
2. **Cliente OAuth no `Mcp.ts`.** Descoberta do servidor de autorização,
   registro do cliente, PKCE, renovação e guarda do token no
   `keys.json`. É código do servidor do Unii, com PR e verificador.
3. **Chave de API de agente autônomo.** URL com cabeçalho fixo, sem login.
   Depende da NUM-2367 e da NUM-2368, ainda não entregues.

Para o E2E local (fase 5): o `ai_assistente` em 4448, atrás do gateway
local do DevTools, com a identidade de desenvolvimento. Sem o gateway, as
chamadas GraphQL são recusadas.

## Riscos e decisões para levar ao usuário

- Na conexão delegada, todo agente do Unii age **como o usuário** (as
  permissões dele), inclusive com `graphql_executar_mutation`. Recomendação:
  começar em homologação e com mutações desligadas para os agentes, ou
  esperar a chave de API com permissões próprias.
- Os servidores da configuração `mcp` valem para o mestre e para todos os
  agentes, Numih ou não. Restringir um servidor só a agentes `numih` é uma
  mudança do servidor do Unii.
- Qual ambiente (homologação ou produção) e qual identidade o piloto usa são
  decisões do usuário.
