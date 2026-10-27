# Mapa de módulos da Numih

> Gerado por `numih-map` — não edite à mão. Regenere com `numih-sync map`.

- workspace: `762a30b8e6e57694732ed4910127d1ad9443558f` (Numih/workspace, main)
- catálogo de portas: `Numih/devtools@0e28e46240a5:infra/ports.yaml`
- submódulos (gitlinks na main do workspace): 81
- seções no `.gitmodules`: 82 (sem gitlink: `libs/nusip`)
- módulos no mapa: 82 (seções do `.gitmodules` menos as descartadas)

Portas: BE local (humano) = 8100+idx · BE Docker / agente = 9000+idx · FE Docker / agente = 10000+idx · FE local (humano) = 11000+idx (regra `20-ports-catalog`).

## Módulo (31)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `modules/acervo` | [Numih/acervo](https://github.com/Numih/acervo) | backend, frontend | 37 | acervo: be_docker 9037, be_local 8137, fe_docker 10037, fe_local 11037 |  |
| `modules/agents` | [numih/agents](https://github.com/numih/agents) | backend, frontend | 45 | agents: be_docker 9045, be_local 8145, fe_docker 10045, fe_local 11045 |  |
| `modules/ai_assistente` | [Numih/mcp](https://github.com/Numih/mcp) (URL antiga: Numih/ai_assistente) |  |  | ai-assistente-mcp: docker_stable 4447, local_dev 4448 |  |
| `modules/analitica` | [Numih/analitica](https://github.com/Numih/analitica) | backend, frontend | 40 | analitica: be_docker 9040, be_local 8140, fe_docker 10040, fe_local 11040<br>analitica-cube: docker_stable 12070<br>analitica-cube-sql: docker_stable 12071 |  |
| `modules/apoio` | [numih/apoio](https://github.com/numih/apoio) | backend, frontend | 8 | apoio: be_docker 9008, be_local 8108, fe_docker 10008, fe_local 11008 | sistema, conta-corrente, arquivos |
| `modules/auth` | [numih/auth](https://github.com/numih/auth) | backend, frontend | 3 | auth: be_docker 9003, be_local 8103, fe_docker 10003, fe_local 11003<br>auth-login: fe_docker 10004, fe_local 11004 |  |
| `modules/avaliacoes` | [numih/avaliacoes](https://github.com/numih/avaliacoes) | backend, frontend | 15 | avaliacoes: be_docker 9015, be_local 8115, fe_docker 10015, fe_local 11015 |  |
| `modules/bilhetagem` | [numih/bilhetagem](https://github.com/numih/bilhetagem) | backend, frontend | 34 | bilhetagem: be_docker 9034, be_local 8134, fe_docker 10034, fe_local 11034 |  |
| `modules/checklist` | [Numih/checklist](https://github.com/Numih/checklist) | backend, frontend | 14 | checklist: be_docker 9014, be_local 8114, fe_docker 10014, fe_local 11014 |  |
| `modules/clinicas` | [Numih/clinicas](https://github.com/Numih/clinicas) | backend, frontend | 44 | clinicas: be_docker 9044, be_local 8144, fe_docker 10044, fe_local 11044 | apoio |
| `modules/condominio` | [Numih/condominio](https://github.com/Numih/condominio) | backend, frontend | 33 | condominio: be_docker 9033, be_local 8133, fe_docker 10033, fe_local 11033 | imoveis |
| `modules/conta-corrente` | [Numih/conta-corrente](https://github.com/Numih/conta-corrente) | backend, frontend | 6 | conta-corrente: be_docker 9006, be_local 8106, fe_docker 10006, fe_local 11006 | auth |
| `modules/contratos` | [Numih/contratos](https://github.com/Numih/contratos) | backend, frontend | 11 | contratos: be_docker 9011, be_local 8111, fe_docker 10011, fe_local 11011 | auth |
| `modules/core` | [numih/core](https://github.com/numih/core) | backend, frontend | 4 | core: be_docker 9004, be_local 8104, fe_docker 10007, fe_local 11007 |  |
| `modules/crm` | [Numih/crm](https://github.com/Numih/crm) |  |  |  |  |
| `modules/financeiro` | [numih/financeiro](https://github.com/numih/financeiro) | backend, frontend | 9 | financeiro: be_docker 9009, be_local 8109, fe_docker 10009, fe_local 11009 | conta-corrente |
| `modules/glossario` | [Numih/glossario](https://github.com/Numih/glossario) | backend, frontend | 23 | glossario: be_docker 9023, be_local 8123, fe_docker 10023, fe_local 11023 |  |
| `modules/hospitalar` | [Numih/hospitalar](https://github.com/Numih/hospitalar) | backend, frontend | 17 | hospitalar: be_docker 9017, be_local 8117, fe_docker 10017, fe_local 11017 |  |
| `modules/imoveis` | [Numih/imoveis](https://github.com/Numih/imoveis) | backend, frontend | 20 | imoveis: be_docker 9020, be_local 8120, fe_docker 10020, fe_local 11020 |  |
| `modules/logs` | [Numih/logs](https://github.com/Numih/logs) | backend, frontend | 2 | logs: be_docker 9002, be_local 8102, fe_docker 10002, fe_local 11002 |  |
| `modules/notas-fiscais` | [numih/notas-fiscais](https://github.com/numih/notas-fiscais) | backend, frontend | 18 | notas-fiscais: be_docker 9018, be_local 8118, fe_docker 10018, fe_local 11018 |  |
| `modules/pabx` | [Numih/pabx](https://github.com/Numih/pabx) | backend, frontend | 19 | pabx: be_docker 9019, be_local 8119, fe_docker 10019, fe_local 11019 |  |
| `modules/planejamento` | [Numih/planejamento](https://github.com/Numih/planejamento) | backend, frontend | 12 | planejamento: be_docker 9012, be_local 8112, fe_docker 10012, fe_local 11012 |  |
| `modules/portaldohospital` | [Numih/portaldohospital](https://github.com/Numih/portaldohospital) | backend, frontend | 42 | portaldohospital: be_docker 9042, be_local 8142, fe_docker 10042, fe_local 11042<br>portaldohospital-login: fe_docker 10043, fe_local 11043 | hospitalar, avaliacoes, auth |
| `modules/protocolos` | [Numih/protocolos](https://github.com/Numih/protocolos) | backend, frontend | 21 | protocolos: be_docker 9021, be_local 8121, fe_docker 10021, fe_local 11021 |  |
| `modules/relacionamento` | [Numih/relacionamento](https://github.com/Numih/relacionamento) | backend, frontend | 26 | relacionamento: be_docker 9026, be_local 8126, fe_docker 10026, fe_local 11026 | auth, sistema |
| `modules/rpa` | [Numih/rpa](https://github.com/Numih/rpa) | backend | 22 | rpa: be_docker 9022, be_local 8122 | arquivos, hospitalar |
| `modules/scheduler` | [numih/scheduler](https://github.com/numih/scheduler) | backend, frontend | 36 | scheduler: be_docker 9036, be_local 8136, fe_docker 10036, fe_local 11036 |  |
| `modules/sistema` | [numih/sistema](https://github.com/numih/sistema) | backend, frontend | 5 | sistema: be_docker 9005, be_local 8105, fe_docker 10005, fe_local 11005 |  |
| `modules/suprimentos` | [numih/suprimentos](https://github.com/numih/suprimentos) | backend, frontend | 10 | suprimentos: be_docker 9010, be_local 8110, fe_docker 10010, fe_local 11010 |  |
| `modules/tarefas` | [numih/tarefas](https://github.com/numih/tarefas) | backend, frontend | 13 | tarefas: be_docker 9013, be_local 8113, fe_docker 10013, fe_local 11013 |  |

## Serviço (8)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `services/arquivos` | [Numih/arquivos](https://github.com/Numih/arquivos) | backend | 7 | arquivos: be_docker 9007, be_local 8107 |  |
| `services/busca` | [Numih/busca](https://github.com/Numih/busca) | backend | 32 | busca: be_docker 9032, be_local 8132 | apoio, conta-corrente |
| `services/documentos` | [Numih/documentos](https://github.com/Numih/documentos) | backend | 35 | documentos: be_docker 9035, be_local 8135 | arquivos |
| `services/gateway` | [Numih/gateway](https://github.com/Numih/gateway) | backend |  | nm-bk-gateway: docker_stable 8080 |  |
| `services/nm-bk-assinaturas` | [Numih/nm-bk-assinaturas](https://github.com/Numih/nm-bk-assinaturas) | backend |  |  |  |
| `services/nm-bk-graphql-gateway` | [numih/nm-bk-graphql-gateway](https://github.com/numih/nm-bk-graphql-gateway) | backend |  | nm-bk-graphql-gateway: docker_stable 4000 |  |
| `services/nm-graphql-registry` | [numih/nm-graphql-registry](https://github.com/numih/nm-graphql-registry) | backend |  |  |  |
| `services/notificacoes` | [numih/notificacoes](https://github.com/numih/notificacoes) | backend, frontend | 16 | notificacoes: be_docker 9016, be_local 8116, fe_docker 10016, fe_local 11016 |  |

## Frontend (3)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `frontend/components` | [Numih/components](https://github.com/Numih/components) | frontend |  | storybook: local_dev 6006<br>storybook-test-server: local_dev 6007 |  |
| `frontend/landing-page` | [Numih/numih.com](https://github.com/Numih/numih.com) | frontend |  |  |  |
| `frontend/nm-ft-root` | [numih/nm-ft-root](https://github.com/numih/nm-ft-root) | frontend |  | nm-ft-root: docker_stable 3000 |  |

## Lib (17)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `libs/cfg` | [Numih/cfg](https://github.com/Numih/cfg) | backend |  |  |  |
| `libs/dp-bk-calculo-financeiro` | [Numih/dp-bk-calculo-financeiro](https://github.com/Numih/dp-bk-calculo-financeiro) | backend |  |  |  |
| `libs/dp-bk-crud` | [numih/dp-bk-crud](https://github.com/numih/dp-bk-crud) | backend |  |  |  |
| `libs/dp-bk-dinheiro` | [Numih/dp-bk-dinheiro](https://github.com/Numih/dp-bk-dinheiro) | backend |  |  |  |
| `libs/dp-bk-graphql` | [numih/dp-bk-graphql](https://github.com/numih/dp-bk-graphql) | backend |  |  |  |
| `libs/dp-bk-http` | [numih/dp-bk-http](https://github.com/numih/dp-bk-http) | backend |  |  |  |
| `libs/dp-bk-indexador-calc` | [Numih/dp-bk-indexador-calc](https://github.com/Numih/dp-bk-indexador-calc) | backend |  |  |  |
| `libs/dp-bk-llm` | [Numih/dp-bk-llm](https://github.com/Numih/dp-bk-llm) | backend |  |  |  |
| `libs/dp-bk-logger` | [Numih/dp-bk-logger](https://github.com/Numih/dp-bk-logger) | backend |  |  |  |
| `libs/dp-bk-messaging` | [Numih/dp-bk-messaging](https://github.com/Numih/dp-bk-messaging) | backend |  |  |  |
| `libs/dp-bk-otel` | [numih/dp-bk-otel](https://github.com/numih/dp-bk-otel) | backend |  |  |  |
| `libs/dp-bk-postgres` | [numih/dp-bk-postgres](https://github.com/numih/dp-bk-postgres) | backend |  |  |  |
| `libs/dp-bk-rabbitmq` | [Numih-archive/dp-bk-rabbitmq](https://github.com/Numih-archive/dp-bk-rabbitmq) (URL antiga: numih/dp-bk-rabbitmq) | backend |  |  |  |
| `libs/dp-bk-redis` | [numih/dp-bk-redis](https://github.com/numih/dp-bk-redis) | backend |  |  |  |
| `libs/dp-ft-labels` | [numih/dp-ft-labels](https://github.com/numih/dp-ft-labels) | frontend |  |  |  |
| `libs/fractal` | [Numih/fractal](https://github.com/Numih/fractal) | backend |  |  |  |
| `libs/nusip` | [Numih/nusip](https://github.com/Numih/nusip) | backend |  |  |  |

## Infra (4)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `infra/infra-tf-numih` | [numih/infra-tf-numih](https://github.com/numih/infra-tf-numih) |  |  |  |  |
| `infra/nm-config-hom` | [Numih/nm-config-hom](https://github.com/Numih/nm-config-hom) |  |  |  |  |
| `infra/nm-config-prod` | [Numih/nm-config-prod](https://github.com/Numih/nm-config-prod) |  |  |  |  |
| `infra/terraform-numih-ecs-app` | [Numih/terraform-numih-ecs-app](https://github.com/Numih/terraform-numih-ecs-app) |  |  |  |  |

## Ferramenta (7)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `tools/cursor` | [Numih/cursor](https://github.com/Numih/cursor) |  |  |  |  |
| `tools/devtools` | [numih/devtools](https://github.com/numih/devtools) |  |  | dev-portal: docker_stable 3001, local_dev 3002<br>devtools-daemon: docker_stable 17280<br>mcp-http: docker_stable 4445, local_dev 4446 |  |
| `tools/expr` | [numih/expr](https://github.com/numih/expr) |  |  |  |  |
| `tools/roadmap` | [Numih/roadmap](https://github.com/Numih/roadmap) |  |  |  |  |
| `tools/seed` | [Numih/seed](https://github.com/Numih/seed) | backend, frontend | 25 | seed: be_docker 9025, be_local 8125, fe_docker 10025, fe_local 11025 |  |
| `tools/seed-demo` | [numih-ai/seed-demo](https://github.com/numih-ai/seed-demo) (URL antiga: Numih/seed-demo) |  |  | seed-demo-server: local_dev 12002<br>seed-demo-web: local_dev 12003 |  |
| `tools/setup` | [numih/setup](https://github.com/numih/setup) |  |  |  |  |

## Action (9)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `actions/act-analyse-dependencies` | [Numih/act-analyse-dependencies](https://github.com/Numih/act-analyse-dependencies) |  |  |  |  |
| `actions/act-create-issue` | [Numih/act-create-issue](https://github.com/Numih/act-create-issue) |  |  |  |  |
| `actions/act-create-pull-request` | [Numih/act-create-pull-request](https://github.com/Numih/act-create-pull-request) |  |  |  |  |
| `actions/act-generate-graphql-schema` | [Numih/act-generate-graphql-schema](https://github.com/Numih/act-generate-graphql-schema) |  |  |  |  |
| `actions/act-pnpm-build` | [Numih/act-pnpm-build](https://github.com/Numih/act-pnpm-build) |  |  |  |  |
| `actions/act-pr-comment` | [Numih/act-pr-comment](https://github.com/Numih/act-pr-comment) |  |  |  |  |
| `actions/act-publish-graphql-schema` | [Numih/act-publish-graphql-schema](https://github.com/Numih/act-publish-graphql-schema) |  |  |  |  |
| `actions/act-remove-stale-branches` | [Numih/act-remove-stale-branches](https://github.com/Numih/act-remove-stale-branches) |  |  |  |  |
| `actions/act-yarn-build` | [Numih/act-yarn-build](https://github.com/Numih/act-yarn-build) |  |  |  |  |

## Template (1)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `templates/nm-fs-template` | [Numih/nm-fs-template](https://github.com/Numih/nm-fs-template) |  |  |  |  |

## Org (2)

| Caminho | Repositório | Camadas | idx | Portas | Depende de |
|---|---|---|---|---|---|
| `.dotfiles` | [Numih/.dotfiles](https://github.com/Numih/.dotfiles) |  |  |  |  |
| `.github` | [Numih/.github](https://github.com/Numih/.github) |  |  |  |  |

## No catálogo de portas, sem submódulo no workspace

- `edge` (modules): idx 24, be_docker 9024, be_local 8124, fe_docker 10024, fe_local 11024
- `analise-documental` (modules): idx 27, be_docker 9027, be_local 8127, fe_docker 10027, fe_local 11027
- `cobranca` (modules): idx 28, be_docker 9028, be_local 8128, fe_docker 10028, fe_local 11028
- `vendas` (modules): idx 29, be_docker 9029, be_local 8129, fe_docker 10029, fe_local 11029
- `locacoes` (modules): idx 30, be_docker 9030, be_local 8130, fe_docker 10030, fe_local 11030
- `analise-legal` (modules): idx 31, be_docker 9031, be_local 8131, fe_docker 10031, fe_local 11031
- `threads` (modules): idx 38, be_docker 9038, be_local 8138, fe_docker 10038, fe_local 11038
- `provisioner` (modules): idx 39, be_docker 9039, be_local 8139, fe_docker 10039, fe_local 11039
- `sip-tester` (modules): idx 41, be_docker 9041, be_local 8141, fe_docker 10041, fe_local 11041
- `event-bus` (gateways): docker_stable 8681
- `galeria-shadcn-io` (tools): local_dev 6008
- `pgadmin` (tools): docker_stable 12000
- `redis-commander` (tools): docker_stable 12001
- `fake-gcs-server` (tools): docker_stable 4443

## Avisos

- `frontend/landing-page`: caminho difere do nome do repositório (Numih/numih.com).
- `libs/dp-bk-rabbitmq` aponta para numih/dp-bk-rabbitmq, movido para Numih-archive/dp-bk-rabbitmq (o README manda remover do workspace o repositório arquivado).
- `libs/nusip` está no .gitmodules mas não tem gitlink na main do workspace.
- `modules/acervo`: module.dev.yaml usa a porta 8134, mas o catálogo dá be_local 8137 (idx 37). O catálogo é a fonte da verdade.
- `modules/agents`: module.dev.yaml usa a porta 8140, mas o catálogo dá be_local 8145 (idx 45). O catálogo é a fonte da verdade.
- `modules/ai_assistente` aponta para Numih/ai_assistente, que hoje é Numih/mcp (renomeado ou movido; o README exige caminho e URL com o nome atual).
- `services/notificacoes`: module.dev.yaml usa a porta 8090, mas o catálogo dá be_local 8116 (idx 16). O catálogo é a fonte da verdade.
- `tools/seed-demo` aponta para Numih/seed-demo, que hoje é numih-ai/seed-demo (renomeado ou movido; o README exige caminho e URL com o nome atual).
