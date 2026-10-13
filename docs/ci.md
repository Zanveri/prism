# Pipeline (CI)

Este documento explica a pipeline do Prism no GitHub Actions: o que cada arquivo faz, quando ela roda, a ordem das etapas na
`develop` e na `main`, o que cada merge publica, o que fazer quando um lançamento para no meio, a **lista de conferência do
repositório** (o que a configuração do GitHub tem de fechar, porque nenhum arquivo fecha sozinho) e o **ensaio com o repositório
privado**. O passo a passo de quem lança uma versão está em [versionamento.md](versionamento.md).

A pipeline já rodou no GitHub e publicou o primeiro beta (`v0.1.0-beta.1`), mas as provas detalhadas daqui foram feitas **antes**,
fora dele, com os mesmos roteiros, as mesmas imagens e um `gh` de mentira ([Estado da validação](#estado-da-validação)). As
afirmações que dependem do GitHub citam a página da documentação dele; o que não foi confirmado lá está marcado **a confirmar**.

## Os arquivos

O GitHub só lê workflows direto em `.github/workflows/`, sem subpastas
([sintaxe de workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)). A divisão por
assunto (RN-GITHUB-002) é: um workflow de **entrada**, que diz quando a pipeline roda, chamando um workflow **reutilizável** por
assunto; os passos repetidos em **actions compostas**; e o trabalho de verdade nos **roteiros** de `scripts/ci/`, um por passo, que
rodam igual na sua máquina.

| Arquivo | O que faz |
| --- | --- |
| [`.github/workflows/pipeline.yml`](../.github/workflows/pipeline.yml) | A entrada. Roda só no `push` em `develop` e em `main`; uma execução por vez em cada ramo, na ordem em que chegaram; chama os seis abaixo (o das páginas só na `develop`) e passa o plano do lançamento de um para o outro. |
| [`.github/workflows/verificar.yml`](../.github/workflows/verificar.yml) | Interface (lint, typecheck e testes), API (build sem avisos e testes de unidade), os testes dos roteiros e as regras dos workflows (com o actionlint), e a **decisão do que o merge lança** (job `versao`). |
| [`.github/workflows/integrar.yml`](../.github/workflows/integrar.yml) | Os testes de integração da API contra PostgreSQL, Informix e Db2 em contêiner. |
| [`.github/workflows/seguranca.yml`](../.github/workflows/seguranca.yml) | O `leak-guard` (RN-ABERTO-003), a auditoria das dependências da interface e da API, e o CodeQL (só com o repositório público). |
| [`.github/workflows/empacotar.yml`](../.github/workflows/empacotar.yml) | A API publicada para as quatro plataformas e os pacotes de Windows, Linux e macOS (RN-ABERTO-006), com a origem das atualizações gravada (RN-GITHUB-005). |
| [`.github/workflows/lancar.yml`](../.github/workflows/lancar.yml) | A release do GitHub: rascunho, anexos e publicação, que cria a tag (RN-VERSAO-008). O único job com escrita no conteúdo. |
| [`.github/workflows/paginas.yml`](../.github/workflows/paginas.yml) | O site de `site/` no GitHub Pages: um job junta os arquivos e outro os publica. Só na `develop`, sem esperar o empacotamento. Não chama roteiro: só usa actions do GitHub. O único com `pages: write` e `id-token: write`. |
| [`.github/actions/preparar-node/`](../.github/actions/preparar-node/action.yml) | O Node 22.23.2 e o pnpm do `packageManager` de `src/client/package.json`, com o hash conferido pelo `corepack`. |
| [`.github/actions/preparar-dotnet/`](../.github/actions/preparar-dotnet/action.yml) | O SDK do .NET 10.0.401, fixado por um `global.json` só da cópia de trabalho do runner. |
| [`scripts/ci/`](../scripts/ci) | Os roteiros (um por passo) e os testes deles (`*.test.sh`, que o `test-scripts.sh` roda). |
| [`site/`](../site) | O site de documentação (HTML e CSS escritos à mão, sem build nem dependência): o que o `paginas.yml` publica em <https://zanveri.github.io/prism/>. |

Os roteiros, por assunto:

| Roteiro | Passo |
| --- | --- |
| `check-version.sh` (e `version.sh`, a decisão) | o job `versao`: o que o merge lança, e o plano para os jobs seguintes |
| `verify-client.sh`, `verify-api.sh` | os jobs `interface` e `api` do verificar |
| `test-scripts.sh`, `check-workflows.sh`, `actionlint.sh` | o job `roteiros` |
| `integration-api.sh` | o integrar |
| `leak-guard.sh` (`leak-guard.awk`, `leak-guard.allow`), `audit-deps.sh` | o seguranca |
| `set-build-version.sh`, `publish-api.sh`, `package-desktop.sh` (`packages.sh`, `packages.txt`) | o empacotar |
| `publish-release.sh`, `release-notes.sh`, `git-cliff.sh` | o lancar |
| `check-tools.sh` | o segundo passo das actions compostas |
| `actions.sh` | os avisos à vista (anotação e resumo do job), que vários roteiros usam |
| `fake-project.sh`, `fake-gh.py` | só dos testes: o repositório de mentira e o `gh` de mentira |

O `paginas.yml` não chama roteiro: os passos dele são só `uses:` de actions do GitHub.

## Quando a pipeline roda

**Só no merge em `develop` e em `main`** (RN-ABERTO-005; decisão do dono em 2026-10-12). O único gatilho é `push` nesses dois ramos,
e as regras de ramo (lista de conferência, item 5) só deixam o push acontecer pelo merge de um pull request. Pull request, tag,
outro ramo e qualquer outro evento não disparam nada.

- **Nenhum `pull_request`, `pull_request_target`, `workflow_run`, `schedule` nem `workflow_dispatch`.** O `workflow_dispatch` ficou
  de fora de propósito: com ele, quem tem escrita rodaria a pipeline (o job que publica inclusive) a partir de um ramo escolhido na
  hora, que não passou por merge ([eventos](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
  O `check-workflows.sh` reprova qualquer um deles.
- **A tag que o lançamento cria não dispara outra execução**: ela é criada com o `GITHUB_TOKEN`, e "events triggered by the
  `GITHUB_TOKEN` will not create a new workflow run", com exceção de `workflow_dispatch` e `repository_dispatch`
  ([GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)). A pipeline também não tem gatilho de tag.
- **Um merge de cada vez em cada ramo, sem cancelar o que está rodando.** A execução de um merge na `develop` decide no começo o
  número do beta e o grava dentro dos pacotes (o app empacotado diz que é aquele beta); por isso a execução seguinte do mesmo ramo só
  começa quando a anterior termina. O `concurrency` do workflow de entrada tem `cancel-in-progress: false` e `queue: max`: sem o
  `queue`, uma execução que espera é **cancelada** quando chega outra ("any existing pending job or workflow in the same concurrency
  group will be canceled"); com `queue: max`, até 100 esperam, na ordem em que começaram a esperar
  ([concorrência](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency); o `queue` existe desde 2026-05). A
  `develop` e a `main` são filas separadas.
- **O que os arquivos daqui não controlam.** Num `pull_request`, o GitHub roda os workflows do **commit de merge do próprio pull
  request** ([eventos](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), `GITHUB_SHA`
  do `pull_request`): um pull request que **acrescente** um workflow com gatilho de pull request roda esse workflow, mesmo que os
  daqui não tenham gatilho nenhum. O que cerca isso é a configuração (lista de conferência, itens 2 e 4: token padrão só de leitura,
  aprovação para quem é de fora, workflows de fork desligados no privado) e o que o GitHub já faz com fork (token só de leitura, sem
  segredos). E quem tem escrita pode enviar um ramo com um workflow novo de gatilho `push` nesse ramo: é por isso que ramo só é criado
  por mantenedor (item 7).

## A ordem das etapas

A mesma nos dois ramos. O que muda entre a `develop` e a `main` é o que o job `versao` decide e o que o `lancar` publica.

```
pipeline.yml (push em develop ou main; uma execução por vez em cada ramo)
├── verificar ─ versao (o plano) · interface · api · roteiros
├── integrar ── api (PostgreSQL, Informix e Db2)
├── seguranca ─ leak-guard · auditoria-interface · auditoria-api · codeql (só público)
│        (os três em paralelo)
├── empacotar ─ api (as quatro APIs) ─┬─ windows
│   (espera os três)                  ├─ linux (contêiner do electron-builder)
│                                     └─ macos (arm64 e x64)
├── lancar ──── publicar (só quando o plano diz que lança; espera o empacotar)
└── paginas ─── montar · publicar (só na develop; não espera ninguém, e ninguém o espera)
```

Um job que falha para os que dependem dele: com a versão errada (job `versao`), um teste vermelho, um achado do `leak-guard` num
repositório público ou uma vulnerabilidade alta ou crítica, **nenhum pacote é gerado e nada é publicado**.

### Os jobs

<!-- tabela-de-jobs:inicio -->
| Arquivo | Job | Na tela | Runner | Espera | Permissões |
| --- | --- | --- | --- | --- | --- |
| `pipeline.yml` | `verificar` | Verificar | (chama `verificar.yml`) | — | `contents: read` |
| `pipeline.yml` | `integrar` | Integrar | (chama `integrar.yml`) | — | `contents: read` |
| `pipeline.yml` | `seguranca` | Segurança | (chama `seguranca.yml`) | — | `contents: read`, `security-events: write` (só o CodeQL a usa) |
| `pipeline.yml` | `empacotar` | Empacotar | (chama `empacotar.yml`) | verificar, seguranca | `contents: read` |
| `pipeline.yml` | `lancar` | Lançar | (chama `lancar.yml`) | verificar, empacotar; só com o plano `lanca` | `contents: write` |
| `pipeline.yml` | `paginas` | Páginas | (chama `paginas.yml`); só na `develop` | — | `contents: read`, `pages: write`, `id-token: write` (só o `publicar` as usa) |
| `verificar.yml` | `versao` | Conferir a versão | `ubuntu-24.04` | — | `contents: read` |
| `verificar.yml` | `interface` | Interface | `ubuntu-24.04` | — | `contents: read` |
| `verificar.yml` | `api` | API | `ubuntu-24.04` | — | `contents: read` |
| `verificar.yml` | `roteiros` | Roteiros e workflows | `ubuntu-24.04` | — | `contents: read` |
| `integrar.yml` | `api` | API com PostgreSQL, Informix e Db2 | `ubuntu-24.04` | — | `contents: read` |
| `seguranca.yml` | `leak-guard` | leak-guard | `ubuntu-24.04` | — | `contents: read` |
| `seguranca.yml` | `auditoria-interface` | Auditoria das dependências da interface | `ubuntu-24.04` | — | `contents: read` |
| `seguranca.yml` | `auditoria-api` | Auditoria das dependências da API | `ubuntu-24.04` | — | `contents: read` |
| `seguranca.yml` | `codeql` | CodeQL (csharp e javascript-typescript) | `ubuntu-24.04` | só com o repositório público | `contents: read`, `security-events: write` |
| `empacotar.yml` | `api` | API das quatro plataformas | `ubuntu-24.04` | — | `contents: read` |
| `empacotar.yml` | `windows` | Pacote de Windows | `windows-2025` | `api` | `contents: read` |
| `empacotar.yml` | `linux` | Pacote de Linux | `ubuntu-24.04`, no contêiner `electronuserland/builder` | `api` | `contents: read` |
| `empacotar.yml` | `macos` | Pacote de macOS (arm64 e x64) | `macos-26` | `api` | `contents: read` |
| `lancar.yml` | `publicar` | Publicar a release | `ubuntu-24.04` | — | `contents: write` |
| `paginas.yml` | `montar` | Montar o site | `ubuntu-24.04` | — | `contents: read`, `pages: read` |
| `paginas.yml` | `publicar` | Publicar no GitHub Pages | `ubuntu-24.04` | `montar` | `pages: write`, `id-token: write` |
<!-- tabela-de-jobs:fim -->

Esta tabela é conferida pelo `check-workflows.sh`: um job que não está nela, ou uma linha que não é job, reprova o job `roteiros`.
Todo job tem `timeout-minutes`, e nenhum usa cache entre execuções (um cache compartilhado é um caminho para um arquivo plantado
chegar ao pacote de uma release; raciocínio nosso, não da documentação).

### Verificar

- **`versao`** (`check-version.sh`, com a decisão de `version.sh`): lê o campo `version` de `src/client/package.json` e as tags do
  remoto (pelo nome exato) e diz o que o merge lança ([O que cada merge publica](#o-que-cada-merge-publica)). Falha, e nada é
  empacotado, com a versão fora do formato da RN-VERSAO-001 ou com sufixo (o sufixo `-beta.N` quem põe é a pipeline), com a versão
  que regrediu, com um título do `CHANGELOG.md` que cita a versão fora do formato exato (só na `main`) e com o remoto que não
  responde. O "não lança" **não** é falha: o job fica verde e o aviso aparece à vista (abaixo). O plano sai nos outputs do job
  (`lanca`, `tag` e `versao`, a versão com que os pacotes são gerados).
- **`interface`** (`verify-client.sh`): `pnpm install --frozen-lockfile`, `lint`, `typecheck` e `test` de `src/client`.
- **`api`** (`verify-api.sh`): `dotnet restore --locked-mode`, build em `Release` com `-warnaserror` e os testes de unidade. A
  auditoria do NuGet fica desligada aqui; quem olha vulnerabilidade é a `auditoria-api`.
- **`roteiros`**: os testes dos roteiros (`test-scripts.sh`), as regras dos workflows (`check-workflows.sh`) e o actionlint
  (`actionlint.sh`). O `check-workflows.sh` reprova: gatilho que não é `push` em `develop` e `main` (ou `workflow_call`, nos
  reutilizáveis); `uses:` que não é local nem `actions/*`/`github/*` fixada pelo SHA de 40 caracteres com o comentário da versão;
  workflow sem `permissions: {}` no topo; escrita fora do job de lançamento (e do `security-events` do CodeQL, e do `pages` e do
  `id-token` do job que publica as páginas); segredo fora do passo
  do leak-guard; `run:` que não é **uma** chamada a um roteiro de `scripts/ci/` que existe, ou que tem uma expressão `${{ }}` dentro
  (o valor de fora entra por `env:`); runner fora dos três rótulos escolhidos; contêiner sem digest; checkout sem
  `persist-credentials: false`; job sem `timeout-minutes`; concorrência que cancela; e a tabela acima fora de dia. O actionlint
  1.7.12 é o binário da release dele, conferido por um SHA-256 escrito no roteiro; ele ainda não conhece a chave `queue` do
  `concurrency`, e essa é a única mensagem ignorada.

**O aviso à vista.** No GitHub Actions não existe job "laranja": ele passa ou falha. O que não lança (e as ressalvas, como a release
que não saiu imutável) sai como uma anotação `::warning` e uma seção no resumo do job
([comandos de workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)), que aparecem na
página da execução mesmo com tudo verde (`scripts/ci/actions.sh`).

### Integrar

A integração não segura o empacotamento nem o lançamento (decisão do dono): ela roda junto, o resultado fica à vista na
execução, e o beta sai mesmo com uma falha dela.

**`api`** (`integration-api.sh`): os testes de integração da API, que sobem PostgreSQL, Informix e Db2 em contêiner pelo Docker do
runner. O Db2 só sobe privilegiado; o runner hospedado aceita (o job define `PRISM_CI_PRIVILEGED`). O driver da IBM dos testes é
instalado pelo próprio gerenciador de drivers do Prism, a partir do pacote que o `dotnet restore` deixa no cache do NuGet do runner
(`src/api/AGENTS.md`, "Testes"); no Linux ele precisa da `libxml2`, que o primeiro passo instala pelo `apt-get` se faltar. A
categoria `Publish` (quatro publicações completas da API) fica de fora: quem publica a API, e confere que ela sai sem arquivo da IBM,
é o empacotar. As imagens do Db2 e do Informix passam de 6 GB juntas, e o runner de repositório privado promete 14 GB de disco
([runners hospedados](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)): o passo de preparo escreve o espaço
livre no log. **A confirmar** na primeira execução: se o espaço dá.

### Segurança

- **`leak-guard`** (`leak-guard.sh`): a verificação da RN-ABERTO-003, nos arquivos versionados (sem binários nem lock files), nos
  nomes de arquivo e nas **mensagens dos commits deste envio** (do `before` ao `after` do push). Procura caminho de perfil de usuário,
  caminho de rede (UNC), endereço de API de registro privado de pacotes com grupo ou projeto pelo número (`/api/v4/projects/<número>`),
  IP de rede privada (IPv4 e IPv6) e cada termo do segredo `LEAK_GUARD_EXTRA` (palavra inteira, sem diferenciar maiúsculas nem
  acentos). O log diz arquivo, linha e padrão, **nunca o texto achado** (o log de um repositório público é público).
  - **Público ou privado.** Num repositório **público**, achado reprova, e nenhum pacote sai. Num **privado**, achado vira aviso à
    vista e não segura os pacotes: a árvore de hoje tem achados nos documentos de orientação e de execução, que só a Tarefa 19 limpa,
    e sem isso o ensaio com o repositório privado não sairia do lugar. A visibilidade vem do evento do push
    (`github.event.repository.private`); se ela faltar, vale a regra do público.
  - **O segredo `LEAK_GUARD_EXTRA`** só chega ao passo do leak-guard (o workflow de entrada o repassa pelo nome ao `seguranca.yml`, e
    lá ele entra no `env` desse passo só). Um segredo não cadastrado chega vazio: o leak-guard roda só com os padrões genéricos e
    avisa à vista.
  - O que evita o vazamento de verdade é rodar na máquina, antes de enviar:
    `LEAK_GUARD_EXTRA=/caminho/dos/termos bash scripts/ci/leak-guard.sh --history` (todos os commits, autores, tags e nomes de arquivo
    que já existiram; ignora o arquivo de exceções). É também a conferência de antes de publicar o repositório (RN-ABERTO-009).
  - As exceções ficam em `scripts/ci/leak-guard.allow` (`arquivo|padrão|justificativa`): um padrão genérico em um arquivo, nunca o
    termo extra, nunca pasta. Mudar o `leak-guard.allow`, `scripts/ci/` ou `.github/` pede revisão de um mantenedor: o verificador
    verde de uma mudança que mexe nele não prova nada.
- **`auditoria-interface`** e **`auditoria-api`** (`audit-deps.sh`): `pnpm audit` e `dotnet list package --vulnerable
  --include-transitive`. Alta ou crítica reprova; moderada e baixa só aparecem na lista. Como a pipeline só roda no merge, de onde sai
  um lançamento, a auditoria trava o empacotamento; o preço é que uma vulnerabilidade publicada depois do merge deixa a pipeline
  vermelha até a dependência ser trocada.
- **`codeql`**: o CodeQL do GitHub para C# e JavaScript/TypeScript, sem build (`build-mode: none`), **só com o repositório público**.
  Num repositório privado de organização, a varredura de código e o CodeQL pedem o GitHub Code Security, que é pago
  ([disponibilidade do CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-cli),
  [da varredura](https://docs.github.com/en/code-security/concepts/code-scanning/tool-status-page)); o job fica com o status
  "skipped" (condição `github.event.repository.visibility == 'public'`). Ele pede `security-events: write` (a action exige; os achados
  vão para a aba de segurança) e `contents: read`
  ([README do codeql-action](https://github.com/github/codeql-action#workflow-permissions)). Um achado não reprova o job.
- **Segredos**: a varredura de segredos com bloqueio de envio é do GitHub, não da pipeline (lista de conferência, item 11).

### Empacotar

- **`api`** (`publish-api.sh`): grava a versão do plano na cópia de trabalho (`set-build-version.sh`: num beta, `X.Y.Z-beta.N`, que só
  é aceita se a parte `X.Y.Z` for a do `package.json`), publica a API autocontida para `win-x64`, `linux-x64`, `osx-arm64` e `osx-x64`
  (os parâmetros moram em `src/client/scripts/publish-api.mjs`, que põe a versão na API) e **falha se alguma pasta publicada tiver um
  arquivo do driver da IBM** (RN-ABERTO-001; os mesmos nomes que o `PublishTests` da API procura) ou se o `deps.json` o citar. Cada
  API vai num `tar`, com os avisos de licença do .NET: o artefato do GitHub perde o bit de execução dos arquivos, e o `tar` o guarda
  ([upload-artifact, "Permission Loss"](https://github.com/actions/upload-artifact#permission-loss)).
- **`windows`**, **`linux`** e **`macos`** (`package-desktop.sh`): cada um busca a API da sua plataforma, grava a mesma versão do plano
  e roda `pnpm dist -- <plataforma>` de `src/client`. Windows no `windows-2025` (instalador `nsis` e zip); Linux no contêiner
  `electronuserland/builder:24-05.26`, fixado por digest (AppImage, deb, rpm e tar.gz); macOS no `macos-26`, Apple Silicon, uma
  arquitetura por job (dmg e zip de `arm64`, e de `x64` pelo `--x64` do electron-builder), porque o dmg só se gera no macOS. O script
  confere no fim que todos os arquivos de `scripts/ci/packages.txt` saíram.
- **A origem das atualizações** (RN-ATUALIZA-001 e RN-GITHUB-005). O passo de empacotar recebe `PRISM_UPDATE_API`
  (`github.api_url`), `PRISM_UPDATE_SITE` (`github.server_url`), `PRISM_UPDATE_REPOSITORY` (`github.repository`) e `PRISM_HOMEPAGE`
  (`github.server_url/github.repository`), **do contexto do próprio workflow**, nunca de uma variável (`vars.`) ou de um segredo que
  alguém configure. Num workflow reutilizável, o contexto `github` é o do workflow que chamou
  ([reutilizáveis](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations), "`github`
  context"). O `package-desktop.sh` confere, antes de empacotar, que as quatro são as do repositório do workflow (as `GITHUB_*`, que
  ninguém sobrescreve: "You can't overwrite the value of the default environment variables named `GITHUB_*`",
  [variáveis](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)), e, depois, que o `app.asar` gerado traz os
  três valores gravados (procura cada valor como texto JSON completo, sem depender do nome da chave que o `dist` usa).
- **O contrato com o `dist`** (o lado do app é da Tarefa 40): o `pnpm dist` lê as três `PRISM_UPDATE_*` juntas (nenhuma ou as três,
  cada uma validada) e as grava no `package.json` de dentro do pacote (`src/client/scripts/dist-plan.mjs`); o lado da pipeline são os
  três nomes acima, a `PRISM_HOMEPAGE` e os nomes de arquivo de `packages.txt`.
- **Os nomes dos pacotes são contrato com o atualizador do app** (RN-ATUALIZA-005): `scripts/ci/packages.txt` e
  `src/client/electron/update/packages.ts` têm a mesma lista, e um teste de cada lado a fixa.
- **Os artefatos duram pouco**: a API, um dia; os pacotes, dois. Eles só levam os arquivos ao job seguinte da mesma execução, e o
  armazenamento conta na cota do plano enquanto o repositório for privado (no GitHub Free de organização, 500 MB;
  [cotas](https://docs.github.com/en/billing/reference/product-usage-included)). Repetir o job `publicar` depois de dois dias pede uma
  execução nova.

### Páginas

O site de documentação, `site/`, publicado no GitHub Pages em <https://zanveri.github.io/prism/>. É HTML e CSS escritos à mão: não
há build, dependência nem roteiro, e os passos são só actions do GitHub (`paginas.yml`, chamado só na `develop`).

- **`montar`**: clona o repositório (sem guardar o token), roda o `configure-pages` e o `upload-pages-artifact` com `path: site`. O
  `configure-pages` lê a configuração do Pages e **falha dizendo o que ligar** quando a fonte não é "GitHub Actions" (item 13 da
  [lista de conferência](#lista-de-conferência-do-repositório)). Permissões: `contents: read` e `pages: read`; a documentação das
  permissões dos tokens de instalação lista a leitura do Pages (`GET /repos/{dono}/{repo}/pages`) como `pages: read`
  ([permissões](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps#repository-permissions-for-pages)).
  Arquivo e pasta com nome começado por ponto não entram no artefato (o padrão do `upload-pages-artifact`).
- **`publicar`**: o `deploy-pages`, no ambiente `github-pages`, com `pages: write` (criar a publicação) e `id-token: write` (o GitHub
  confere de que execução e de que ramo o artefato veio, pelo token OIDC do job; [deploy-pages](https://github.com/actions/deploy-pages#security-considerations)).
  Ele não clona o código. É o **único** job com essas duas escritas, e o `check-workflows.sh` as reprova em qualquer outro.
- **Não espera nem é esperado.** O job do workflow de entrada tem `if: github.ref_name == 'develop'` e nenhum `needs`: o site sobe em
  paralelo com a verificação, e nem um teste vermelho segura o site, nem uma falha do Pages (a fonte ainda não ligada, por exemplo)
  segura os pacotes (o `lancar` não depende dele). A falha fica à vista na execução, como a da integração. Na `main` o job não roda, e
  o ambiente `github-pages` só deixaria publicar a partir do ramo padrão.
- **Uma publicação por vez.** O `concurrency` do workflow de entrada já faz uma execução de cada vez por ramo, então duas
  publicações da `develop` nunca se sobrepõem.

## O que cada merge publica

A decisão é uma só (`version.sh`, `decide_release`), tomada no job `versao` e refeita no `publicar` com o estado do remoto de agora.
Nos dois ramos o campo `version` de `src/client/package.json` é a **próxima versão estável**, `X.Y.Z`, sem sufixo (RN-VERSAO-003).

**Na `develop`, um beta a cada merge** (RN-VERSAO-008; decisão do dono em 2026-10-12):

| Estado do remoto | O merge |
| --- | --- |
| a tag estável `vX.Y.Z` já existe | **não lança**, com o aviso de que a versão precisa subir (o beta seria mais velho que a estável) |
| um beta `vX.Y.Z-beta.K` já aponta para este commit | nada a publicar (execução repetida) |
| o último beta saiu de um commit que este não contém | **não lança**, com o aviso (execução repetida ou fora de ordem) |
| senão | publica `vX.Y.Z-beta.N`, **pré-lançamento**, com `N` um a mais que o maior já publicado para `X.Y.Z` (o primeiro é 1) |

O número do beta é procurado pelo **nome exato** de cada tag (`vX.Y.Z-beta.N`, com `N` sem zero à esquerda): uma tag-isca como
`x/refs/tags/v0.1.0-beta.9`, um ramo chamado `refs/tags/v0.1.0-beta.9` ou `v0.1.0-beta.09` não contam. **Os pacotes de um beta levam a
versão do beta** (`Prism-0.2.0-beta.3-win-x64.exe`, e o app instalado diz `0.2.0-beta.3`): é com esse número que o atualizador compara
as versões. As notas do beta são as do `git-cliff`, desde a tag de versão anterior que está na história do commit (no primeiro beta, o
histórico inteiro), seguidas das somas, e **não** são gravadas no `CHANGELOG.md` (RN-VERSAO-007).

**O site, na `develop`.** Todo merge na `develop` também publica o site de `site/` no GitHub Pages ([Páginas](#páginas)), em paralelo
com o resto: ele não espera o empacotamento nem a decisão do `versao`, e um merge que não lança nada ainda atualiza o site. Na `main`
o site não é publicado.

**Na `main`, a estável:**

| Estado | O merge |
| --- | --- |
| a tag `vX.Y.Z` aponta para este commit | nada a publicar (execução repetida) |
| a tag `vX.Y.Z` aponta para outro commit | **não lança**, com o aviso (merge na `main` sem versão nova) |
| sem a tag e sem a seção `## [X.Y.Z] - AAAA-MM-DD` no `CHANGELOG.md` | **não lança**, com o aviso |
| sem a tag e com a seção | publica `vX.Y.Z`, marcada como a release mais recente; as notas são a seção do changelog e as somas |

Em qualquer ramo, **reprova** (e nada é empacotado): a versão fora do formato ou com sufixo, a versão que regrediu (o que seria lançado
não é maior que toda tag de versão que já existe, na ordem do SemVer) e, na `main`, um título do changelog que cita a versão fora do
formato exato. Com a versão de uma estável já lançada, todo merge na `develop` avisa até a versão subir: suba-a logo depois da estável
([versionamento.md](versionamento.md)).

## Lançar: rascunho, anexos, publicação

O job `publicar` (`publish-release.sh`), na ordem que a documentação de releases imutáveis recomenda ("Create the release as a draft.
Attach all associated assets to the draft release. Publish the draft release.",
[releases imutáveis](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)):

1. **As conferências de antes de escrever**: a decisão de agora é a mesma do plano (senão, os pacotes desta execução são de outra
   versão, e nada é publicado); os dez pacotes estão lá, com a versão da tag; o `SHA256SUMS`; as notas (`release-notes.sh`); e o commit
   não acrescenta nem muda arquivo de `.github/workflows/` em relação ao **ramo padrão**. Esta última existe porque a API de releases diz
   que, nesse caso, criar ou publicar a release com o `GITHUB_TOKEN` responde 404: "The `GITHUB_TOKEN` available to GitHub Actions
   cannot be authorized for this" ([API de releases](https://docs.github.com/en/rest/releases/releases), "Create a release" e "Update a
   release"). É também por isso que a `develop` tem de ser o ramo padrão antes do primeiro envio dos workflows (lista de conferência,
   item 1).
2. **O rascunho**: um rascunho com a mesma tag e este commit, deixado por uma tentativa que parou no meio, é retomado; um rascunho com
   a mesma tag e outro commit é apagado (não é público e não tem tag); senão, um rascunho novo (`draft: true`, `target_commitish` = o
   commit do merge, `prerelease` no beta). Um rascunho não cria a tag.
3. **Os anexos**: cada pacote e o `SHA256SUMS`. O que já está no rascunho com a mesma soma é pulado; o que está pela metade (a API diz
   que um envio que falha "may leave an empty asset with a state of `starter`") ou com outros bytes é apagado e enviado de novo
   ([API de anexos](https://docs.github.com/en/rest/releases/assets)). Depois, o rascunho é relido: os onze nomes, todos completos, cada
   soma (`digest`) igual à do arquivo. Sem a soma, o tamanho, com um aviso.
4. **A publicação** (`draft: false`; `make_latest` só na estável), que é o que cria a tag `vX.Y.Z` (ou `vX.Y.Z-beta.N`) no commit do
   merge. Logo antes, a tag é procurada no remoto pelo nome exato: se ela apareceu, nada é publicado.
5. **A conferência**: a tag aponta para o commit do merge e a release publicada tem os onze anexos. Se a release não saiu imutável, o
   aviso fica à vista: a garantia que o README dá (RN-ATUALIZA-009) conta com as releases imutáveis ligadas.

**O bloco das somas nas notas é contrato com o atualizador do app** (RN-ATUALIZA-005): o **último** título `### Somas SHA-256`, uma
linha em branco, uma cerca de três crases sem linguagem, as linhas do `SHA256SUMS` (64 dígitos hexadecimais, dois espaços, o nome),
a cerca que fecha, e nada depois. O caso "CONTRATO" do `release-notes.test.sh` fixa o arquivo byte a byte, no beta e na estável. Com
as releases imutáveis, o título e as notas de uma release publicada **ainda podem ser editados**
([releases imutáveis](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)): editar as notas pode
quebrar o bloco, e aí o app recusa a atualização. Se for preciso corrigir o texto, mexa só acima do título das somas.

### Quando um lançamento falha no meio

Regra geral: **repita o job `publicar` na mesma execução** ("Re-run failed jobs"). A repetição usa o mesmo commit e os mesmos pacotes
(artefatos da execução), e o privilégio de quem disparou a execução, não o de quem repete
([repetir](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)). Nenhum pedido que cria, muda ou
apaga é repetido pelo roteiro; só as leituras, até três vezes.

| Onde parou | Como as coisas ficam | Como retomar |
| --- | --- | --- |
| `versao` (versão fora do formato, regredida, título errado) | nada foi gerado | corrija num pull request; o merge seguinte decide de novo |
| um teste, a auditoria, o leak-guard (público) ou um pacote | nada foi publicado | corrija e faça o merge; ou repita o job, se a falha foi passageira |
| `publicar`, antes do rascunho | nada no GitHub | repita o job |
| `publicar`, no meio dos anexos | um rascunho (não público) com parte dos anexos; sem tag | repita o job: ele retoma o rascunho e pula o que já subiu com a mesma soma |
| `publicar`, publicação recusada (403) | o rascunho completo; sem tag | veja a permissão (`contents: write`) e a regra de tag (item 6); repita o job |
| `publicar`, a publicação respondeu com erro | a release pode ter saído | repita o job: ele confere a tag e a release antes de fazer qualquer coisa |
| "o plano … e o estado das tags de agora pede …" | nada foi publicado | rode a execução inteira de novo ("Re-run all jobs"): o plano e os pacotes saem de novo |
| os artefatos expiraram (dois dias) | o job repetido não acha os pacotes | rode a execução inteira de novo |

Uma execução da `develop` que parou no meio e não foi repetida não impede a seguinte: a execução do merge seguinte apaga o rascunho
velho (de outro commit) e publica o mesmo número a partir do commit novo. Uma execução velha repetida depois disso não publica nada (o
último beta saiu de um commit à frente dela).

## Por onde o token passa

O único token é o `GITHUB_TOKEN` de cada job, com as permissões da [tabela](#os-jobs). O repositório todo começa com `permissions: {}`.

- **Checkout sem guardar o token**: todo `actions/checkout` tem `persist-credentials: false` (o padrão grava o token no `.git/config`
  do runner, onde qualquer passo seguinte o leria).
- **Páginas**: o `montar` tem `contents: read` e `pages: read`, e o `publicar` só `pages: write` e `id-token: write` (a segunda é o
  token OIDC que o `deploy-pages` pede ao GitHub para provar de que execução veio o artefato). O `publicar` não clona o código, e o
  `check-workflows.sh` reprova essas duas escritas em qualquer outro job.
- **`gh`** (só no `publicar`): recebe o token por `GH_TOKEN`, com uma pasta de configuração própria e vazia (`GH_CONFIG_DIR`), sem
  `GH_DEBUG`, `DEBUG` nem token de outro servidor no ambiente, sem perguntar nada e sem paginador. Ele só manda o token ao servidor do
  pedido e não o leva a um redirecionamento para outro servidor (o código do `gh`, `AddAuthTokenHeader`). O token nunca vai em
  argumento, em URL nem em arquivo.
- **`git`** (o `versao` e o `publicar` leem as tags do remoto, que é privado no ensaio): o endereço é `$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git`,
  sem usuário nem senha; quando o servidor pede, um auxiliar de credencial responde `x-access-token` e o token, lido do ambiente
  naquela hora, e **só ao servidor do repositório**. É a forma que a documentação dá para o token de instalação de um app, que é o que o
  `GITHUB_TOKEN` é ([token de instalação](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
  [GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)). A configuração global e a do sistema do runner
  não são lidas, e as variáveis de rastreio que mostrariam o cabeçalho HTTP são tiradas.
- **Texto de fora no log**: as notas (mensagens de commit) vão ao log entre `::stop-commands::` e o fim, com uma senha sorteada, para uma
  linha que comece com `::` não virar comando ([comandos de workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)).
- **Nenhum `${{ }}` dentro de um `run:`**: todo valor de fora (a versão do plano, o `before` do push, a visibilidade) entra por
  `env:`, e o roteiro o valida.
- O que disso foi provado está em [Estado da validação](#estado-da-validação).

## Variáveis e segredos

| Nome | Onde | O que é |
| --- | --- | --- |
| `LEAK_GUARD_EXTRA` | segredo do repositório; só o passo do leak-guard | os termos próprios de quem publica, um por linha |
| `GH_TOKEN` | o `env` do `versao` e do `publicar` | o `github.token` do job |
| `PRISM_UPDATE_API`, `PRISM_UPDATE_SITE`, `PRISM_UPDATE_REPOSITORY`, `PRISM_HOMEPAGE` | o passo de empacotar | do contexto `github`; conferidas contra as `GITHUB_*` |
| `PRISM_BUILD_VERSION` | os passos do `set-build-version.sh` | a versão do plano (output `versao`) |
| `PRISM_PLANNED_TAG` | o passo do `publicar` | a tag do plano (output `tag`) |
| `PRISM_CI_PRIVILEGED` | o job de integração | liga os testes do Db2 |
| `PRISM_API_RIDS`, `PRISM_CI_TOOLS`, `PRISM_CI_RETRY_DELAY` | só na sua máquina e nos testes | os identificadores a publicar; a pasta das ferramentas baixadas; a espera entre as leituras repetidas |

Nenhuma variável de repositório (`vars.`) é lida, e nenhum outro segredo existe.

## Runners: quais e por quê

Só os **runners hospedados pelo GitHub**, com o **rótulo de imagem fixo** (nenhum `-latest`, que muda de sistema sozinho), e nenhum
runner próprio ligado ao repositório (RN-ABERTO-007). Os rótulos existem hoje na lista da documentação
([runners hospedados](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)) e no README das imagens
([actions/runner-images](https://github.com/actions/runner-images), lido em 2026-10-12):

| Rótulo | Por quê |
| --- | --- |
| `ubuntu-24.04` | o Ubuntu LTS que é o `ubuntu-latest` de hoje; das imagens de Linux x64 em uso geral (22.04, 24.04 e 26.04), é a que tem a frente mais longa sem ser a mais nova. Tem Docker, `gh`, `jq`, Ruby e o Bash 5 |
| `windows-2025` | o Windows Server mais novo (o `windows-latest` de hoje); o `windows-2022` é o próximo a sair |
| `macos-26` | o macOS Apple Silicon mais novo (o `macos-latest` de hoje). O `macos-14` já está marcado como **deprecated** no README das imagens, e o `macos-15` é o próximo da fila |

A política das imagens: no máximo duas em uso geral e uma em teste por sistema, e a mais velha entra em descontinuação quando a nova
sai do teste, com um anúncio e uma data ([actions/runner-images](https://github.com/actions/runner-images), "Image Deprecation
Policy"). **Até quando cada rótulo vale não está escrito** em nenhuma das duas páginas: acompanhe os anúncios do repositório das
imagens. Para trocar um rótulo, mude os workflows e a lista do `check-workflows.sh` no mesmo pull request.

O runner de repositório **privado** é menor que o de público: Linux e Windows com 2 núcleos e 8 GB (o de público tem 4 e 16), macOS
Apple Silicon com 3 núcleos e 7 GB; 14 GB de disco em todos.

### Custo (RN-GITHUB-004)

"GitHub Actions usage is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners"
([cobrança](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). Num repositório **privado**, os minutos saem
da cota do plano da organização (2.000 por mês no GitHub Free e 3.000 no Team) e, passado ela, são cobrados por minuto: Linux
US$ 0,006, Windows US$ 0,010 e macOS US$ 0,062 ([preços](https://docs.github.com/en/billing/reference/actions-runner-pricing),
[cotas](https://docs.github.com/en/billing/reference/product-usage-included)). Sem forma de pagamento cadastrada, o uso é bloqueado
quando a cota acaba. Cada merge na `develop` roda os três sistemas: dois jobs de macOS (o mais caro) e um de Windows, além dos de
Linux. **Os tempos de cada job no GitHub não foram medidos** (nenhuma execução rodou); os da máquina da prova estão em
[Estado da validação](#estado-da-validação). A página de releases acumula um beta por merge; apagar os antigos fica para depois.

## Lista de conferência do repositório

O que a configuração do repositório tem de fechar (RN-ABERTO-007). **Nenhum arquivo da pipeline faz isto por você.** Os caminhos são
os da tela de configurações do repositório (Settings); onde a documentação não confirmou o nome exato, está marcado. Faça na ordem: o
item 1 vem **antes** do primeiro envio dos workflows.

1. **`develop` como ramo padrão.** *Onde:* Settings › General › Default branch (exige papel de administrador e mais de um ramo;
   [ramo padrão](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/changing-the-default-branch)).
   *O que fecha:* pull request nasce para a `develop` (RN-GITHUB-003); os modelos de issue valem do ramo padrão; e a API de releases
   compara os workflows do commit com os do ramo padrão (seção [Lançar](#lançar-rascunho-anexos-publicação)): com a `main` (sem os
   workflows) como padrão, o primeiro beta da `develop` falharia. *Conferir:* a página do repositório abre na `develop`.
2. **Token padrão só de leitura.** *Onde:* Settings › Actions › General › Workflow permissions: "Read repository contents and packages
   permissions"; e **desmarque** "Allow GitHub Actions to create and approve pull requests"
   ([configurações de Actions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)).
   *O que fecha:* um workflow que não declare `permissions` (um que alguém traga num ramo) recebe só leitura. Os daqui já declaram tudo.
   Numa organização, o padrão vem da configuração da organização, e a mais restrita vale. *Conferir:* a opção marcada na tela; no log de
   qualquer job, o grupo "GITHUB_TOKEN Permissions" lista o que o job recebeu (**a confirmar** o nome do grupo na primeira execução).
3. **Só actions do GitHub, e fixadas pelo SHA.** *Onde:* Settings › Actions › General › Actions permissions: "Allow *Zanveri*, and
   select non-*Zanveri*, actions and reusable workflows", com **"Allow actions created by GitHub"** marcado, nenhum outro, e **"Require
   actions to be pinned to a full-length commit SHA"** ([configurações de Actions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository),
   "Allowing select actions and reusable workflows to run"). *O que fecha:* uma action de fora, ou uma por tag, não roda. A opção deixa
   passar também as actions da própria organização: a regra "só `actions/*` e `github/*`" é do `check-workflows.sh`. *Conferir:* a tela;
   e um workflow de teste num ramo descartável com uma action de fora tem de falhar ao começar (**a confirmar**).
4. **Pull request de fork não roda workflow.** *Onde:* Settings › Actions › General. Com o repositório **privado**, em "Fork pull
   request workflows", deixe **desmarcado** "Run workflows from fork pull requests" (e, com ele, as opções de token de escrita e de
   segredos). Com o repositório **público**, em "Approval for running fork pull request workflows from contributors", escolha **"Require
   approval for all external contributors"** ([configurações de Actions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)).
   *O que fecha:* os workflows daqui não têm gatilho de pull request, mas um pull request que traga um workflow novo rodaria esse
   workflow ([Quando a pipeline roda](#quando-a-pipeline-roda)); com a aprovação, ele só roda depois de um mantenedor ler e aprovar. A
   documentação avisa que as duas opções de "primeira contribuição" deixam passar quem já teve qualquer commit aceito. *Conferir:* a
   tela.
5. **Regras de ramo em `develop` e `main`.** *Onde:* Settings › Rules › Rulesets › New ruleset › New branch ruleset, alvo os ramos
   `develop` e `main`, "Enforcement status" ativo, e as regras: **Restrict deletions**, **Block force pushes** e **Require a pull request
   before merging** (com o número de aprovações que o time aguenta; com um mantenedor só, zero) e, na `main`, o método de merge
   **merge** (um commit de merge: a `main` precisa receber a história da `develop`, e as notas dos betas e o changelog dependem dela).
   A lista de bypass fica **vazia** ([regras disponíveis](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
   [criar](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)).
   *O que fecha:* ninguém envia direto, ninguém força, ninguém apaga; o único jeito de um commit chegar à `develop` ou à `main` (e de a
   pipeline rodar) é o merge de um pull request. *Plano:* num repositório **privado**, regras de ramo pedem GitHub Pro, Team ou
   Enterprise; no Free, só no público ([rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
   *Conferir:* `git push origin HEAD:develop` de um ramo local tem de ser recusado; a aba Rules › Insights mostra a tentativa.
6. **Regra de tag em `v*`.** *Onde:* Settings › Rules › Rulesets › New tag ruleset, alvo `v*`, com **Restrict creations**, **Restrict
   updates** e **Restrict deletions**. *O que fecha:* só quem tem bypass cria, move ou apaga uma tag de versão. *O que falta confirmar:*
   quem cria a tag é a publicação da release pelo `GITHUB_TOKEN` (o app GitHub Actions), e a documentação lista "GitHub Apps" entre os
   que podem ter bypass sem dizer se o app GitHub Actions aparece na busca do "Add bypass" (**a confirmar**). Se ele aparecer,
   ponha-o, e só ele. Se não aparecer, deixe **Restrict creations** desmarcado (fica só a escrita do repositório: quem tem escrita pode
   criar uma tag à mão) e mantenha as outras duas: a pipeline recusa publicar sobre uma tag que já existe, e as releases imutáveis
   travam a tag de uma release publicada. *Conferir:* no ensaio, a primeira publicação (se a regra bloquear, o `publicar` falha com
   403 e o rascunho fica completo); e `git push origin v9.9.9-teste` de uma máquina tem de ser recusado com a criação restrita.
7. **Quem cria ramo.** Ramo só é criado por mantenedor (RN-GITHUB-003). *Onde:* o acesso de escrita ao repositório só para os
   mantenedores (Settings › Collaborators and teams); quem não tem escrita não envia ramo nenhum. Para conter também quem tem escrita, um
   branch ruleset com alvo "All branches", **Restrict creations** e bypass para o papel **Maintain** e **Admin**
   ([bypass](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)).
   *O que fecha:* um ramo com um workflow novo de gatilho `push` nele rodaria esse workflow. *Conferir:* um usuário só com escrita não
   consegue `git push origin HEAD:refs/heads/teste`.
8. **Forks.** *Onde:* Settings › General › Features › **Allow forking** (num repositório privado de organização, a organização tem de
   permitir antes; [forks](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-forking-policy-for-your-repository)).
   *O que fecha:* enquanto privado, deixe desmarcado (o código não sai em fork de ninguém antes da reescrita do histórico). Público, todo
   mundo pode fazer fork, e é por fork que quem é de fora contribui. *Conferir:* o botão Fork some para quem não é da organização.
9. **Releases imutáveis.** *Onde:* Settings › General › Releases › **Enable release immutability**; vale só para as releases
   publicadas depois de ligado ([prevenir mudanças](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes)).
   *O que fecha:* depois de publicada, a tag não se move nem é apagada enquanto a release existir, e os anexos não mudam; apagada a
   release, o nome da tag **não pode ser usado de novo**, nem recriando o repositório
   ([releases imutáveis](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)). **Ligue só depois
   do ensaio e da limpeza dele, se o ensaio for neste repositório** ([Ensaio](#ensaio-com-o-repositório-privado)). *Conferir:* a release
   mostra "Immutable" abaixo do título; o `publicar` avisa à vista quando a release sai mutável.
10. **Relato privado de vulnerabilidade.** *Onde:* Settings › Advanced Security › Private vulnerability reporting › **Enable**
    ([relato privado](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)).
    *Só existe em repositório público.* *O que fecha:* o [SECURITY.md](../SECURITY.md) manda relatar por ali, nunca por issue.
    *Conferir:* a aba Security mostra "Report a vulnerability" para quem não é mantenedor.
11. **Varredura de segredos com bloqueio de envio.** *Onde:* Settings › Advanced Security › Secret Protection › **Enable**, e, na mesma
    seção, **Push protection** › **Enable** ([bloqueio de envio](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection)).
    Num repositório público ela roda de graça; num privado de organização, pede o GitHub Secret Protection, que é pago
    ([varredura](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)). *O que fecha:* um envio com um
    segredo reconhecido é recusado. *Conferir:* a tela; um envio de teste com um token de exemplo do próprio GitHub tem de ser recusado
    (**a confirmar** qual exemplo a documentação dá).
12. **O segredo `LEAK_GUARD_EXTRA`.** *Onde:* Settings › Secrets and variables › Actions › **New repository secret**, nome
    `LEAK_GUARD_EXTRA`, um termo por linha. *O que fecha:* os termos próprios da empresa ficam fora do repositório e só chegam ao passo
    do leak-guard. *Conferir:* o log do leak-guard diz "N termo(s) extra(s) carregado(s)" (sem o segredo, o aviso "Sem os termos
    extras").
13. **GitHub Pages por Actions.** *Onde:* Settings › Pages › Build and deployment › Source: **GitHub Actions**
    ([publicar com um workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)).
    *O que fecha:* sem isso, o job `montar` do `paginas.yml` falha no `configure-pages` ("Get Pages site failed") e o site não sobe;
    com a fonte por Actions, o GitHub cria o ambiente `github-pages`, que limita a publicação ao ramo padrão (a `develop`; **a
    confirmar** a regra exata em Settings › Environments › `github-pages`). O endereço do site é `https://zanveri.github.io/prism/`.
    *Conferir:* depois do primeiro merge na `develop` com o `paginas.yml`, a execução mostra "Publicar no GitHub Pages" verde com o
    endereço, e a página abre. O site de um repositório **público** não tem custo no plano gratuito.
14. *(Opcional, código de conduta.)* Settings › Moderation options › Reported content: com o repositório público de organização, quem
    contribui pode relatar um comentário aos mantenedores sem expor o relato
    ([conteúdo relatado](https://docs.github.com/en/communities/moderating-comments-and-conversations/managing-how-contributors-report-abuse-in-your-organizations-repository)).

## Ensaio com o repositório privado

O dono quer ver a pipeline rodar com o repositório ainda privado, antes de torná-lo público. **Recomendação: ensaie num repositório
privado à parte**, uma cópia descartável (por exemplo, `Zanveri/prism-ensaio`), e não no `Zanveri/prism`. Os motivos, os três da
documentação do GitHub:

- **Pull request não se apaga.** O ensaio passa por pull requests (é o único jeito de um merge chegar à `develop` com as regras
  ligadas), e cada um guarda uma referência só de leitura (`refs/pull/<n>/head`) aos commits dele. A reescrita do histórico da
  Tarefa 19 não alcança essas referências: só o suporte do GitHub as remove, e "GitHub Support won't remove non-sensitive data, and
  will only assist in the removal of sensitive data in cases where we determine that the risk can't be mitigated by rotating affected
  credentials" ([remover dados sensíveis](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)).
  O que a RN-ABERTO-003 proíbe (caminho de máquina, nome interno) não é credencial: um pull request aberto no `Zanveri/prism` antes da
  reescrita deixaria o histórico antigo visível pelo pull request quando o repositório ficar público.
- **Release imutável queima o nome da tag** daquele repositório para sempre, mesmo apagando a release e recriando o repositório
  ([releases imutáveis](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)). No repositório de
  ensaio isso não importa: a `v0.1.0` e os betas do ensaio só se queimam lá, e as releases imutáveis podem ficar **ligadas** desde o
  começo, o que ensaia também elas.
- **Tudo se apaga de uma vez**: apagar o repositório de ensaio leva as releases, as tags, os pull requests, os artefatos e os logs.

### O que configurar antes

1. Criar o repositório privado de ensaio na organização e enviar a ele os ramos (`git push <ensaio> feature/fatia-1:refs/heads/main`
   e `…:refs/heads/develop`, ou os ramos que estiverem no ponto).
2. Os itens da [lista de conferência](#lista-de-conferência-do-repositório) que existem num repositório privado: 1 (develop padrão,
   **antes** de enviar o ramo com `.github/workflows/`), 2, 3, 4 (a opção de privado), 5, 6, 7 e 8 (se o plano da organização tiver
   regras de ramo em repositório privado; no GitHub Free, não tem), 9 (ligado, no repositório de ensaio) e 12. Os itens 10 e 11 só
   existem com o repositório público (o 11, num privado, só pago).
3. O ramo com a pipeline e com o atualizador nas releases do GitHub (a Tarefa 40, o `dist` que lê `PRISM_UPDATE_SITE` e
   `PRISM_UPDATE_REPOSITORY`): os dois já estão juntos na `feature/fatia-1`.
4. A cota: a organização com forma de pagamento ou cota de minutos e de armazenamento sobrando ([Custo](#custo-rn-github-004)).

### O primeiro merge na develop

Um pull request qualquer (de um ramo `chore/…`) para a `develop`, e o merge. O que ele exercita, e que nada aqui provou: os gatilhos
(o pull request **não** pode ter rodado nada; o merge roda uma execução); a fila do `concurrency`; os workflows reutilizáveis com as
permissões e o segredo; as actions compostas no Linux, no Windows e no macOS; o actionlint baixado; os testes de integração com o Db2 e
o Informix no runner; o leak-guard em modo privado (avisos à vista com os achados de hoje); o contêiner do electron-builder; os pacotes
de Windows e de macOS gerados de verdade; os artefatos entre os jobs; e o lançamento inteiro: o rascunho, os onze anexos, a publicação
pelo `GITHUB_TOKEN` e a tag. Com a versão `0.1.0` no `package.json` e nenhuma tag, ele publica **`v0.1.0-beta.1`**, pré-lançamento,
com as notas do `git-cliff` do histórico inteiro (é o primeiro). Confira: a página de releases; `git ls-remote --tags <ensaio>`; o
"Immutable" da release; o `SHA256SUMS` contra um pacote baixado (`sha256sum`); e o resumo da execução (os avisos à vista). Um segundo
merge publica o `v0.1.0-beta.2`.

### A estável, no ensaio

No repositório de ensaio, a `0.1.0` pode ser queimada: o pull request `release: v0.1.0` para a `develop` fecha a seção da `0.1.0` no
`CHANGELOG.md`, e o pull request da `develop` para a `main` (método **merge**) lança a `v0.1.0`
([versionamento.md](versionamento.md)). Depois, o merge seguinte na `develop` tem de avisar que a versão precisa subir, e o pull request
que sobe a versão para `0.2.0` volta a publicar betas (`v0.2.0-beta.1`).

**Se o ensaio for no próprio `Zanveri/prism`** (contra a recomendação): deixe as releases imutáveis **desligadas** durante todo o ensaio
(com elas, `v0.1.0` e cada beta do ensaio ficariam queimados para sempre neste repositório, e a numeração dos betas de verdade, que conta
as tags que existem, voltaria a pedir um nome já queimado); ensaie a estável com a `0.1.0` mesmo, porque sem a imutabilidade o nome
volta a ficar livre depois de apagar a release e a tag; e ligue a imutabilidade só depois da limpeza abaixo. Os pull requests do
ensaio continuam lá para sempre.

### O que apagar depois do ensaio, antes da reescrita da Tarefa 19

No repositório de ensaio: **apague o repositório** (Settings › General › Danger Zone). Se o ensaio foi no `Zanveri/prism`: as releases
do ensaio (`gh release delete <tag>` ou a página de releases), as tags (`git push origin --delete <tag>`, uma por uma), os ramos de
trabalho do ensaio, os artefatos e as execuções de workflow (os logs têm mensagens de commit e os achados do leak-guard; a página de
cada execução tem "Delete workflow run"). Releases e tags do ensaio apontam para os commits de antes da reescrita e os manteriam
alcançáveis. Os pull requests não se apagam ([acima](#ensaio-com-o-repositório-privado)).

### O que o ensaio privado não prova

- **O CodeQL**: num privado ele pede o GitHub Code Security (pago); o job fica "skipped".
- **O relato privado de vulnerabilidade**, a **varredura de segredos com bloqueio de envio** e o **leak-guard reprovando**: o primeiro
  só existe em público, o segundo é pago no privado, e o terceiro só reprova em público.
- **O custo zero de runner**: só existe em repositório público.
- **O que um visitante vê**, e **o atualizador do app**: o Prism instalado consulta a lista de releases **sem credencial**
  (RN-ATUALIZA-002), e a API do GitHub não mostra as releases de um repositório privado a quem não está autenticado. O atualizador não
  acha nada num repositório privado; ele só se ensaia de verdade com o repositório público (ou contra o servidor de mentira da Tarefa
  40).
- **As regras de ramo e de tag**, se o plano da organização não as tiver em repositório privado.

## Rodar na própria máquina

Cada passo é uma chamada a um arquivo de `scripts/ci/`; rode o arquivo. Para conferir como o runner o rodaria, use uma cópia limpa
(`git archive HEAD | tar -x -C /tmp/prism-copia`), e não a árvore de trabalho, que tem `node_modules` e `obj` do seu sistema.

| Passo | Comando | Pede na máquina |
| --- | --- | --- |
| `versao` | `bash scripts/ci/check-version.sh develop` ou `… main` (o ramo de destino) | bash, git, sed, awk; lê as tags do `origin` com a credencial que o seu git já tem. Rode-o no ramo do pull request de lançamento: ele diz se o merge vai lançar |
| `interface` | `bash scripts/ci/verify-client.sh` | Node 22 com `corepack` |
| `api` (verificar) | `bash scripts/ci/verify-api.sh` | SDK do .NET 10 |
| `roteiros` | `bash scripts/ci/test-scripts.sh`, `bash scripts/ci/check-workflows.sh` e `bash scripts/ci/actionlint.sh` | bash, git, awk, `jq`, `python3`, `ruby`; o actionlint baixa o binário fixado (Linux x64) |
| `api` (integrar) | `bash scripts/ci/integration-api.sh` | SDK do .NET 10 e Docker; com `PRISM_CI_PRIVILEGED=1`, o Db2 também |
| `leak-guard` | `bash scripts/ci/leak-guard.sh` (ou `--history`, `--messages BASE..PONTA`, `-v`); antes de enviar: `LEAK_GUARD_EXTRA=/caminho/dos/termos bash scripts/ci/leak-guard.sh --history` | bash, git, awk, sed e xargs do GNU |
| auditorias | `bash scripts/ci/audit-deps.sh client` e `… api` | Node com `corepack`, SDK do .NET, rede |
| `api` (empacotar) | `bash scripts/ci/publish-api.sh` (com `PRISM_API_RIDS=linux-x64` para uma só) | SDK do .NET 10 e Node |
| pacotes | `PRISM_HOMEPAGE=https://… bash scripts/ci/package-desktop.sh linux` (ou `win`, `mac arm64`, `mac x64`) | o resultado do `publish-api.sh`; **apaga** `src/client/release` e `src/client/resources/api` |
| as notas | `bash scripts/ci/release-notes.sh --sums <arquivo> 0.1.0`, ou `… --beta --since v0.1.0-beta.1 0.1.0-beta.2` | o `CHANGELOG.md`; no beta, o Docker (`git-cliff.sh`) |
| `publicar` | só na pipeline (escreve no GitHub). O ensaio dele, com um `gh` de mentira, é `bash scripts/ci/release.test.sh` | bash, git, jq, python3 |
| `paginas` | só na pipeline (publica no GitHub Pages). Para ver o site antes: `python3 -m http.server --directory site 8000` e abrir `http://127.0.0.1:8000/` | python3 (o site é HTML e CSS estáticos: não há build) |

## O que a pipeline não faz

- **Configurar o repositório**: a lista de conferência acima é manual (inclusive ligar o GitHub Pages por Actions, o item 13).
- **Assinatura de código e notarização**: nenhum pacote é assinado. O README diz o que isso implica em cada sistema.
- **Publicação em loja** e **repositórios apt e rpm**.
- **Atualizar o app de alguém**: ela publica o que o atualizador lê (a release, as notas com as somas, os pacotes e o `SHA256SUMS`);
  quem procura, mostra, baixa, confere e instala é o app, quando o usuário manda.
- **Escrever o changelog, mudar a versão ou abrir o pull request de lançamento**: é trabalho de quem lança
  ([versionamento.md](versionamento.md)). Nenhum job envia commit nem ramo; a tag quem cria é a publicação da release.
- **Apagar um lançamento** ou os betas antigos.
- **Cache entre execuções**, de propósito.
- **Rodar em pull request**: quem revisa roda as verificações na própria máquina ([CONTRIBUTING.md](../CONTRIBUTING.md)).

## Atualizar as versões fixadas

Uma vez por mês, e num pull request só:

1. **As actions**: para cada `uses:`, a versão nova em `github.com/<dono>/<repo>/releases` e o commit dela:
   `git ls-remote https://github.com/<dono>/<repo>.git 'refs/tags/vX.Y.Z' 'refs/tags/vX.Y.Z^{}'` (a linha com `^{}` é o commit, numa
   tag anotada). Troque o SHA e o comentário da versão **juntos**, em todo lugar onde a action aparece (`grep -rn 'uses:' .github`).
   Prefira uma versão com algumas semanas.
2. **Os rótulos de runner**: os da lista da documentação e do README das imagens; troque nos workflows e na lista `runners` do
   `check-workflows.sh`.
3. **A imagem do electron-builder** (`empacotar.yml`) e a do **git-cliff** (`scripts/ci/git-cliff.sh`): tag e digest juntos
   (`docker pull <imagem>:<tag>` e `docker inspect --format '{{index .RepoDigests 0}}' <imagem>:<tag>`).
4. **O actionlint** (`scripts/ci/actionlint.sh`): a versão e a linha `linux_amd64` do `checksums.txt` dela. Quando ele passar a
   conhecer a chave `queue`, tire a exceção.
5. **O Node e o .NET**: as entradas `node` e `sdk` das actions compostas. **O pnpm**: só o campo `packageManager` de
   `src/client/package.json` (com o hash) e o `pnpm-lock.yaml`; nada na pipeline muda.
6. Rode as provas ([Rodar na própria máquina](#rodar-na-própria-máquina)).
