# Como contribuir com o Prism

Obrigado por querer ajudar. Este guia diz como o trabalho entra no projeto, como preparar o ambiente, onde estão as convenções, o
que um pull request precisa trazer, o que quem revisa roda na própria máquina e como escrever as mensagens de commit.

A participação segue o [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). **Vulnerabilidade não vai em issue, comentário nem pull request**:
veja o [SECURITY.md](SECURITY.md).

## Fluxo

O fluxo é o da RN-GITHUB-003, decidido pelo dono do projeto:

1. **Issue primeiro.** Todo trabalho começa numa issue: um defeito ou uma sugestão, cada um com o seu formulário. Os mantenedores
   avaliam se ela vira trabalho e dizem quando. Assim ninguém gasta tempo numa direção que o projeto não vai seguir.
2. **Ramos só pelos mantenedores**, com um prefixo do tipo da mudança: `feat/`, `fix/`, `chore/`, `docs/`, `ci/`, `refactor/` e
   `test/` (por exemplo, `fix/separador-de-comandos`). Um ramo nasce da `develop`: `git switch -c fix/assunto origin/develop`.
3. **Pull request para a `develop`**, que é o ramo padrão do repositório. O modelo do pull request traz a lista de conferência, e ele
   cita a issue que resolve.
4. **Quem é de fora contribui por fork**: faça um fork do repositório, crie o ramo no seu fork, com o mesmo prefixo, e abra o pull
   request do seu fork para a `develop` daqui.
5. **De `develop` para `main`, só o pull request de lançamento** (`release: vX.Y.Z`), aberto pelos mantenedores
   ([docs/versionamento.md](docs/versionamento.md)).
6. Responda à revisão com novos commits no mesmo ramo.

**Nenhum pull request roda a pipeline** (RN-ABERTO-005): ela só roda depois do merge, na `develop` e na `main`. Quem revisa roda as
verificações na própria máquina, com os comandos de [O que quem revisa roda](#o-que-quem-revisa-roda), e a pipeline confirma depois do
merge. Cada merge na `develop` publica um beta: um merge é uma entrega, e por isso o pull request precisa chegar verificado.

## Preparar o ambiente

Os pré-requisitos e os comandos de desenvolvimento estão no [README](README.md#pré-requisitos): .NET SDK 10, Node.js 22, pnpm 10
(a versão exata está no campo `packageManager` de `src/client/package.json`) e, para os testes de integração da API, Docker. Em
resumo:

```bash
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client dev
```

Os cofres do app em desenvolvimento ficam em `Zanveri/Prism-dev`, na pasta de dados de aplicativo do sistema, e nunca se misturam
com os do app empacotado (veja [Onde ficam os dados](README.md#onde-ficam-os-dados)).

## Testar e empacotar na sua máquina

### Testes

```bash
dotnet build src/api/Prism.slnx          # zero avisos
dotnet test src/api/Prism.slnx           # unitários e de integração (Docker ligado)
pnpm --dir src/client lint
pnpm --dir src/client typecheck
pnpm --dir src/client test
```

### Empacotar

O pacote de uma plataforma leva a API publicada para a mesma plataforma, e há uma só API em `src/client/resources/api`: publique
a API e depois gere o pacote.

```bash
pnpm --dir src/client build:api -- win-x64      # ou linux-x64, osx-arm64, osx-x64; sem argumento, o da máquina
pnpm --dir src/client dist -- win               # win, linux ou mac (mac aceita arm64 ou x64 depois: dist -- mac arm64)
pnpm --dir src/client dist:dir                  # só a pasta do app, sem instalador: src/client/release/win-unpacked/Prism.exe
```

Os pacotes saem em `src/client/release/`, como `Prism-<versão>-<sistema>-<arquitetura>.<extensão>`. Cada um leva a API em
`resources/api` e não precisa de .NET nem de Node na máquina; não há assinatura de código. O `dist` falha se a API da
plataforma não foi publicada antes. No macOS, uma arquitetura por vez: `build:api -- osx-arm64` e `dist -- mac arm64`, depois
`osx-x64` e `mac x64`. O deb e o rpm exigem a URL do projeto (`PRISM_HOMEPAGE`, que na pipeline é a página do repositório do
workflow); o resto está em [docs/ci.md](docs/ci.md).

O `build:api` mexe nos `packages.lock.json` da API: acrescenta o alvo vazio `net10.0/<identificador>` (por exemplo,
`net10.0/win-x64`). Provisório: depois de publicar, olhe `git diff -- "src/api/*/packages.lock.json"` e desfaça
(`git checkout -- "src/api/*/packages.lock.json"`) só se a única diferença for esse alvo.

### Onde ficam os dados

Os cofres e o log da API ficam na pasta de dados do app:

- Windows, app empacotado: `%APPDATA%\Zanveri\Prism`
- Linux e macOS, app empacotado: a subpasta `Zanveri/Prism` da pasta de dados de aplicativo do sistema
- em desenvolvimento (`pnpm dev`): `Zanveri/Prism-dev` no mesmo lugar, para o app de desenvolvimento nunca abrir os
  cofres de verdade

Dentro dela: `vaults/`, com um arquivo cifrado por usuário (`<usuário>.vault.json`), `logs/` e os arquivos de perfil do
Chromium que o Electron grava ali.

`--user-data-dir=<pasta>` na linha de comando troca a pasta nos dois casos (use uma pasta de teste para conferir o
app empacotado sem tocar nos dados de ninguém). O log do processo principal traz a linha
`[prism] pasta de dados: ...`.

### Estrutura do repositório

| Caminho | O que é |
| --- | --- |
| `src/client/` | A interface: Electron, React e Vite. Orientação em [src/client/AGENTS.md](src/client/AGENTS.md). |
| `src/api/` | A API em C# (.NET 10) e os testes. Orientação em [src/api/AGENTS.md](src/api/AGENTS.md). |
| `docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md` | Especificação da primeira entrega: regras `RN-*`, rotas, códigos de erro e critérios de aceite. |
| `docs/design/canvas/` | Canvas de design aprovado: a medida de cores, espaçamentos e textos. |
| `site/` | O site de documentação (HTML e CSS estáticos, em português), publicado no GitHub Pages pela pipeline em <https://zanveri.github.io/prism/>. |
| `docs/versionamento.md` | Como o Prism é versionado e como se lança uma versão (o pull request de lançamento da `develop` para a `main`). |
| `docs/ci.md` | A pipeline: o que cada workflow e cada job faz, o que cada merge publica, como rodar na máquina, os runners, a lista de conferência do repositório no GitHub e o ensaio com o repositório privado. |
| `.github/workflows/`, `.github/actions/`, `scripts/ci/` | A pipeline (GitHub Actions: o workflow de entrada, os reutilizáveis e as actions compostas) e os roteiros que ela chama, um por passo, com os testes deles. |
| `cliff.toml` | A configuração do `git-cliff`, que gera o changelog e as notas das releases. |
| `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | Os formulários de issue (defeito e sugestão) e o modelo de pull request. |
| [AGENTS.md](AGENTS.md) | Orientação para quem programa, na raiz. |

## Onde estão as convenções

- [AGENTS.md](AGENTS.md), na raiz: o que vale para o projeto inteiro.
- [src/api/AGENTS.md](src/api/AGENTS.md): a API em C#.
- [src/client/AGENTS.md](src/client/AGENTS.md): a interface.
- [Especificação](docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md): a fonte dos requisitos. As regras têm código
  (`RN-COFRE-003`, por exemplo) e, quando o código implementa uma, o comentário cita a regra. Não mude o comportamento de uma regra
  por conta própria: abra uma issue.
- [Canvas de design](docs/design/canvas/): a medida de cores, espaçamentos e textos da interface.
- [docs/ci.md](docs/ci.md): a pipeline, para quem mexe em `.github/` ou em `scripts/ci/`.

Idioma: os nomes no código (tipos, funções, arquivos) são em inglês; os textos de tela, as mensagens de erro e os comentários são em
português.

## O que um pull request precisa trazer

- **Testes** para o comportamento que muda: unitários e, quando houver HTTP ou banco no caminho, de integração.
- **Build da API sem avisos**, a suíte da API e a da interface passando, e os roteiros da pipeline, se você mexeu neles (os comandos
  estão logo abaixo).
- **Pacotes travados:** se você mudou um `PackageReference`, rode `dotnet restore src/api/Prism.slnx --force-evaluate` e inclua os
  `packages.lock.json` no mesmo commit. Na interface, o `pnpm-lock.yaml` entra junto com a mudança no `package.json`.
- **Documentação** atualizada quando a mudança altera um comando, uma pasta ou uma regra.
- **Título do pull request** no formato dos commits (veja abaixo).

## O que quem revisa roda

A pipeline não roda no pull request; quem revisa roda isto na própria máquina, no ramo do pull request (`gh pr checkout <número>`, ou
`git fetch origin pull/<número>/head:pr-<número>` e `git switch pr-<número>`). **Leia o código antes de rodá-lo**: é código de outra
pessoa rodando na sua máquina.

```bash
# A interface
pnpm --dir src/client install --frozen-lockfile
pnpm --dir src/client lint
pnpm --dir src/client typecheck
pnpm --dir src/client test

# A API (os testes de integração precisam do Docker ligado)
dotnet build src/api/Prism.slnx            # zero avisos
dotnet test src/api/Prism.slnx

# Os roteiros e os workflows, quando o pull request mexe em scripts/ci/ ou em .github/
bash scripts/ci/test-scripts.sh
bash scripts/ci/check-workflows.sh
bash scripts/ci/actionlint.sh              # baixa o actionlint fixado (Linux x64)

# O que não pode entrar no repositório (RN-ABERTO-003); com os termos da empresa, num arquivo fora do repositório
bash scripts/ci/leak-guard.sh
LEAK_GUARD_EXTRA=/caminho/dos/termos bash scripts/ci/leak-guard.sh --messages origin/develop..HEAD

# As dependências (alta ou crítica reprova)
bash scripts/ci/audit-deps.sh client
bash scripts/ci/audit-deps.sh api

# O que o merge vai lançar: develop (o beta) ou, no pull request de lançamento, main (a estável)
bash scripts/ci/check-version.sh develop
```

O que a pipeline faz depois do merge, e o que cada comando acima confere, está em [docs/ci.md](docs/ci.md).

## Mensagens de commit

O Prism segue o [Conventional Commits 1.0.0](https://www.conventionalcommits.org/pt-br/v1.0.0/). A mensagem é em português:

```
tipo(escopo): descrição curta
```

O escopo é opcional e, hoje, costuma ser `api` ou `client`. Os tipos aceitos:

| Tipo | Quando usar |
| --- | --- |
| `feat` | funcionalidade nova |
| `fix` | correção de defeito |
| `perf` | ganho de desempenho |
| `refactor` | mudança de código que não altera o comportamento |
| `docs` | só documentação |
| `build` | empacotamento, dependências e scripts de build |
| `ci` | a pipeline |
| `test` | só testes |
| `chore` | o que não cabe nos outros |

Um `!` depois do tipo (ou do escopo) marca uma mudança que quebra o contrato que o número da versão protege: o formato do cofre e a
estrutura da pasta de dados, os arquivos de configuração e de exportação, os atalhos e comandos documentados. Veja
[docs/versionamento.md](docs/versionamento.md).

Exemplos, no estilo do histórico deste repositório:

```
feat(client): editor SQL com resultado paginado
fix(client): "executar de novo" repete o comando do resultado que está na tela
build: empacotamento do app com o electron-builder
```

O **título do pull request** segue o mesmo formato. Se o pull request for mesclado com squash, é o título que entra no histórico. As
notas de cada beta e o `CHANGELOG.md` saem do histórico, por isso a convenção importa: uma mensagem fora do formato não aparece nelas.

O tipo `release` não está na tabela acima: ele é reservado ao pull request de lançamento (`release: vX.Y.Z`), aberto pelos
[mantenedores](#mantenedores), e não aparece no changelog. **Mesclar na `main` o pull request de lançamento é lançar a versão**: a
pipeline publica os pacotes e a release, e a publicação cria a tag `vX.Y.Z`. Ninguém cria tag de versão à mão, e um pull request
comum não muda o campo `version` de `src/client/package.json` (quem o muda é o pull request que sobe a versão depois de uma estável).

## Mantenedores

Neste projeto, **mantenedores** são as pessoas com o papel **Maintain** ou **Admin** no repositório do GitHub. São elas que criam
ramos, revisam e mesclam pull requests, lançam versões, tratam os relatos de segurança e aplicam o
[código de conduta](CODE_OF_CONDUCT.md). Os relatos de vulnerabilidade seguem o [SECURITY.md](SECURITY.md); o passo a passo de um
lançamento está em [docs/versionamento.md](docs/versionamento.md).

## Licença das contribuições

O Prism é distribuído sob a [GNU GPL versão 3](LICENSE) (`GPL-3.0-only`), com a permissão adicional da seção 7 para o driver da
IBM descrita no [NOTICE](NOTICE). Ao enviar uma contribuição, você a oferece sob essa mesma licença e com essa mesma permissão.

## O que não entra no repositório

- **Segredos:** senha, token, chave de API, chave privada, string de conexão com senha, arquivo de cofre de verdade. Para testar,
  gere valores de teste.
- **Dados de cliente:** dump de banco, resultado de consulta, captura de tela ou log com dado real. Use dados inventados.
- **Dados da sua máquina ou da sua rede:** caminho de perfil de usuário, nome de usuário do sistema, nome de runner, host ou IP de
  rede interna, endereço ou identificador de um servidor de código ou de pacotes interno, nome de projeto interno de uma empresa. Vale
  também para mensagens de commit. É a regra RN-ABERTO-003 da [especificação](docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md),
  e o `leak-guard` a confere.
- **Arquivos gerados:** `bin/`, `obj/`, `node_modules/`, `out/`, `release/`, a API publicada em `src/client/resources/api/` e as
  saídas dos roteiros da pipeline (`api-bundles/`, `release-notes.md`).
- **Dependências com licença incompatível** com a GPLv3, ou com termos de redistribuição que o projeto não conferiu. O driver da
  IBM, por exemplo, é proprietário e só pode ser referenciado, nunca copiado para o repositório.
