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
| `mutacoes.sh` | Aplica cada mutação conhecida numa cópia temporária e confere que os testes a pegam. |

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
`sync` e `check` saem com erro (1), nunca com «em dia», e a mensagem diz o que
já tinha sido feito: no `check`, nada; no `sync`, só a configuração local de
proteção e os ganchos, reaplicados antes da busca (HEAD e arquivos intactos).

Recusa, sem criar nada, `NUMIH_HOME` relativo, a raiz em qualquer grafia (`/`,
`//`, `/.`, `/..`), igual ao `HOME` ou acima dele, ou dentro de `~/repository`
(com links simbólicos resolvidos: se o `HOME` ou `~/repository` for link para
outro diretório, o alvo também é recusado). Sem `HOME`, com `HOME` vazio ou
relativo, todo subcomando (menos a ajuda) para com mensagem própria e saída 1,
antes de criar, travar ou buscar qualquer coisa. `NUMIH_HOME` que exista e não seja
diretório, e `.lock` que não seja arquivo comum (diretório, fifo), também são
recusados com mensagem própria e saída 1.

Nada é escrito nem buscado fora de `NUMIH_HOME`. Antes de qualquer busca, em
`sync`, `check` e `map`, cada cópia passa por uma guarda: a cópia, o diretório
git dela e o diretório git comum precisam resolver para dentro de
`NUMIH_HOME`, e o `.git/config` não pode ser link simbólico (o `git config`
escreveria no alvo). Um `.git/hooks` que seja link simbólico é recusado; um
gancho que seja link simbólico é trocado por um arquivo próprio (escrito num
temporário e renomeado, sem tocar no alvo do link). O destino de um clone novo
também precisa resolver para dentro de `NUMIH_HOME`. A trava `.lock` que seja
link simbólico é recusada, e ela é aberta sem truncar (`>>`). `install` recusa
um `bin` que seja link simbólico, e `map` recusa `modulos.json` ou
`MODULOS.md` que sejam links simbólicos.

Clone e busca nunca pedem senha (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=false`;
sem `GIT_SSH_COMMAND`, `GIT_SSH` ou `core.sshCommand` do usuário, o ssh roda
com `BatchMode=yes`) e têm prazo: `NUMIH_FETCH_TIMEOUT` segundos (padrão 300).
Estourado o prazo, o git é interrompido (TERM e, 10 s depois, KILL), a
mensagem diz isso e a saída é 1.

Um clone que falha (por prazo, por erro ou morto por KILL, que o git não tem
como limpar) tem a pasta apagada, para que o `sync` e o `check` seguintes não
fiquem presos numa cópia pela metade. Só a pasta criada por esse clone: o
`numih-sync` a cria (sem `-p`, então falha se ela já existir), o git clona
nela vazia e, antes de apagar, confere que ela ainda é o mesmo diretório
(dispositivo e inode), não é link simbólico e fica dentro de `NUMIH_HOME`.
Uma pasta preexistente nunca recebe o clone nem é apagada. Não coberto: se o
próprio `numih-sync` morrer por `kill -9` no meio do clone, a pasta pela
metade fica, e o `sync` e o `check` seguintes falham nela até ela ser apagada
à mão.

O que é garantido sobre processos que sobram: o git roda num grupo de
processos próprio (o do `timeout`), e um vigia espera o `timeout` terminar e
então manda KILL ao grupo inteiro. Assim, um filho do git que ignore TERM (um
`ssh`, por exemplo) não sobra quando o git morre, nem no prazo nem por sinal.
Se o próprio `numih-sync` morrer no meio (inclusive por `kill -9`), o
`setpriv --pdeathsig` avisa o vigia com TERM; ele repassa o TERM ao grupo (com
KILL 10 s depois, se o próprio git o ignorar) e derruba com KILL o que sobrar
assim que o git terminar. O que **não** é garantido: um descendente que saia
do grupo (`setsid`, como um `ssh` com `ControlPersist` que vira daemon) escapa;
sem o `setpriv` (util-linux), o vigia não fica sabendo da morte do
`numih-sync`, e a busca segue até o prazo, quando o grupo é derrubado do mesmo
jeito; um `kill -9` no próprio vigia deixa o `timeout` sozinho, que ainda
respeita o prazo, mas sem a limpeza final do grupo.

Nomes de módulo (`mod <nome>`) e os números de `NUMIH_LOCK_WAIT` e
`NUMIH_FETCH_TIMEOUT` são validados com listas ASCII explícitas, que não
dependem do locale (com `en_US.UTF-8`, `[A-Za-z0-9]` casaria `é` e `ñ`, e
`[0-9]` casaria `٣`). `NUMIH_FETCH_TIMEOUT` é um número inteiro de segundos
maior que zero (zero à esquerda é aceito: `05`; `0`, `00` e `1.5`, não).

Todo git roda com a trava (fd 9) fechada e com `gc.autoDetach=false`, então
nenhum processo deixado em segundo plano herda a trava.

A busca não usa `--prune`: com um único refspec explícito
(`+refs/heads/main:refs/remotes/origin/main`) ele só poderia podar a própria
`origin/main`, e se a `main` sumir da origin a busca já falha. O avanço usa
`merge --ff-only` mesmo depois de conferir que o HEAD é ancestral da
`origin/main`: é uma segunda barreira (o teste a exercita fingindo que a
primeira passou) e garante que nunca fica merge pela metade.

`mod <nome>` recusa nome que comece com ponto, termine em `.git` (o sufixo é
da URL, não do nome) ou termine em ponto (`a.git.`, `x.`); o `numih-map`
também descarta URL cujo nome seja `.git`, termine em `.git` depois de tirado
o sufixo ou termine em ponto. Dígitos ASCII são aceitos em qualquer posição
(`ab12`, `9z`).

`numih-sync help` (ou sem argumentos) mostra a ajuda sem guarda, trava nem
escrita; comando desconhecido sai com 2.

Os ganchos de recusa ficam no `.git/hooks` de cada cópia, e o `core.hooksPath`
é fixado no config **local** da cópia. Um `core.hooksPath` global do usuário
nunca é lido para escrita nem alterado.

Duas execuções simultâneas se serializam por uma trava (`flock` em
`$NUMIH_HOME/.lock`): a segunda espera até `NUMIH_LOCK_WAIT` segundos (padrão
120) e, se a trava não sair, desiste com erro.

## Testes

```bash
bash numih/test-numih-sync.sh   # 473 verificações com remotos git locais num tmp próprio
bun test numih/                 # 14 testes do gerador do mapa (repositório git, fixtures, gh falso)
bash numih/mutacoes.sh          # 45 mutações (IDs A1, S22…S44, B1…B6, V01, T07, M01…M04, M11, M11b, M13, C5a/C5b, N1/N1m, F1/F2); todas precisam morrer
```

Algumas verificações são estruturais, porque o comportamento não muda sem a
opção: o clone ignora `submodule.recurse` e a busca só recursaria em submódulo
inicializado (que a cópia do workspace recusa), então o teste confere
`--no-recurse-submodules` na linha de comando do git e `submodule.recurse` /
`fetch.recurseSubmodules` = `false` no config local.

Os testes usam `HOME`, `NUMIH_HOME`, config global do git e `GH_CONFIG_DIR`
temporários. Isso **não** isola as credenciais do `gh`: ele pode achá-las no
chaveiro do sistema (keyring), que não depende do `HOME`. Por isso nenhum teste
chama o `gh` real nem a rede: o `numih-sync` é testado com remotos locais, e o
`numih-map`, com fixtures (`--offline`) ou com um `gh` falso no `PATH`.

O teste do `numih-sync` também usa um `git` falso no `PATH` (que registra o
ambiente de cada chamada e se a trava fd 9 estava aberta) e um remoto que
pendura (transporte `ext::` com `sleep`), para provar o prazo da busca e do
clone, o KILL de uma busca que ignora TERM e que um `kill -9` no `numih-sync`
não deixa a busca órfã. Um `ssh` falso que ignora TERM (com um `sleep` filho)
prova que nem ele nem o `sleep` sobram, no prazo e depois de `kill -9` no
`numih-sync`. As guardas ASCII são testadas com `LC_ALL=C` e
`LC_ALL=en_US.UTF-8` (se esse locale existir na máquina). Cada gancho de recusa é exercitado pela sua operação (commit, merge,
rebase, `git am` e push com URL explícita).

O git falso também simula um clone pela metade que ignora TERM (só o KILL do
`--kill-after` o derruba, rc 137): o teste confere a mensagem de prazo, que a
pasta parcial foi apagada e que o `mod` seguinte clona de novo; e um clone
cuja pasta é trocada no meio (outro inode), que não pode ser apagada.

O vigia do `com_prazo` é testado isolado: o trecho dele é extraído do próprio
script (as mutações valem ali) e rodado com pai certo e errado (pai errado:
sai 143 sem executar o comando). Para o TERM chegar num ponto exato, um
`BASH_ENV` com `trap … DEBUG` manda TERM ao vigia uma única vez, logo antes de
um comando escolhido: antes do `timeout` (sai 143 e o `timeout` nem começa) e
logo depois dele, antes de `p=$!` (o vigia repassa o TERM assim que sabe o
PID). Um git falso que trata TERM e só grava o marcador de limpeza 1 s depois
prova que o vigia espera o `timeout` terminar antes do KILL ao grupo.

O cabeçalho do `MODULOS.md` conta os gitlinks reais da `main` do workspace
(81) e, à parte, as seções do `.gitmodules` (82): `libs/nusip` tem seção, mas
não tem gitlink. Seções com URL não reconhecida (fora do GitHub, ou com
owner/nome inseguros) ficam fora do mapa e são listadas em
`secoes_descartadas` e no cabeçalho; vale sempre
`total_secoes_gitmodules = módulos no mapa + secoes_descartadas` (hoje 82 = 82 + 0).
Caminhos, nomes de porta e dependências vindos do `.gitmodules` e do catálogo
entram no Markdown escapados (`|`, crase, `[`, `<`, `\` e quebras de linha),
para não quebrar a tabela nem abrir código, link ou HTML; vale também para
`be_local` e `idx` no aviso de divergência do `module.dev.yaml`. Um valor que
seja objeto ou lista (onde se espera número) sai como JSON compacto, escapado
do mesmo jeito, nunca como `[object Object]`; um valor que nem o JSON
representa sai como «(valor não serializável)».

O instantâneo `MODULOS.md`/`modulos.json` desta pasta foi regenerado sem rede, a
partir do `modulos.json` anterior (só ganhou `secoes_descartadas` e a linha
«módulos no mapa»); o `map` com o GitHub real não foi rodado de novo.
