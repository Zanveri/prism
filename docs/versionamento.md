# Versionamento e lançamentos

Este documento diz como o Prism numera as versões e como se lança uma. Foi escrito para quem nunca lançou uma
versão de nada: cada termo é explicado quando aparece.

Os passos que dependem da pipeline citam o nome do job e do script; o que cada um faz está em [ci.md](ci.md).

## 1. O que é cada número

A versão do Prism segue o [Versionamento Semântico 2.0.0](https://semver.org/lang/pt-BR/) (SemVer). Ela tem três
números separados por ponto:

```
MAJOR.MINOR.PATCH        por exemplo: 0.3.2
```

- **MAJOR** (o primeiro): sobe quando uma mudança **quebra o contrato** descrito na próxima seção. Quem atualiza
  precisa ler as notas antes.
- **MINOR** (o segundo): sobe quando entra funcionalidade nova que não quebra nada.
- **PATCH** (o terceiro): sobe quando só se corrigem defeitos.

Quando um número sobe, os da direita voltam a zero: depois da `0.3.2`, uma funcionalidade nova leva à `0.4.0`.

A primeira versão do Prism é a **`0.1.0`**. Enquanto o primeiro número for `0`, o projeto está em desenvolvimento
inicial: o contrato ainda pode mudar. Nessa fase, uma mudança que quebra o contrato sobe o **segundo** número, e
não o primeiro; funcionalidade nova também sobe o segundo, e correção sobe o terceiro. A **`1.0.0`** sai quando o
contrato estiver estável e o Prism estiver em uso no dia a dia. Dali em diante, quebra de contrato sobe o primeiro
número.

### O contrato que o número protege

Um aplicativo não tem uma API pública, como uma biblioteca tem. O que o número do Prism protege é o que o usuário
(ou um script dele) pode ter passado a depender:

- o **formato do cofre** e a estrutura da pasta de dados;
- os **arquivos de configuração e de exportação**, quando existirem;
- os **atalhos e comandos documentados**.

Ficam fora do contrato: a API HTTP local (ela só conversa com o próprio app, e os dois saem sempre no mesmo
pacote) e a aparência da interface.

### Pré-lançamento

Uma versão que ainda não é a final leva um sufixo depois de um hífen: `0.2.0-beta.1`, `0.2.0-beta.2`. `beta` é uma versão para
experimentar. Na ordem de precedência do SemVer, `0.2.0-beta.1` vem antes de `0.2.0-beta.2`, que vem antes de `0.2.0-beta.10` (o
número é comparado como número), que vem antes da `0.2.0`. O formato `-rc.N` (release candidate, a candidata a final) é aceito pela
regra, mas não é usado nesta entrega.

No Prism, **cada merge na `develop` publica um beta** (decisão do dono em 2026-10-12): ninguém escolhe o número, a pipeline põe o
seguinte (o primeiro de cada versão é o `beta.1`). A `0.2.0` estável reúne tudo desde a estável anterior, e o changelog não repete as betas. Na página de releases do GitHub
um beta aparece marcado como "Pre-release". O Prism instalado só oferece beta a quem ligou "Receber versões beta" em Configurações ›
Atualizações; com a opção desligada, quem está numa beta recebe a próxima estável.

**Um beta sai para Windows e Linux; o macOS só tem pacote nas estáveis** (decisão do dono em 2026-10-20, para economizar os minutos da
pipeline: o de macOS é o mais caro). As notas de todo beta dizem isso, e no macOS o Prism não oferece beta (a opção "Receber versões
beta" continua lá, com a dica de que ali ela não muda nada): quem usa macOS atualiza pelas estáveis.

### O número do formato do cofre

O cofre tem um número de formato próprio no cabeçalho do arquivo, **independente da versão do app**. Ele só muda
quando o formato muda, nunca por causa de uma release.

- Um cofre de formato **mais novo** que o que o app conhece não é aberto nem regravado. A resposta é o erro
  `VAULT_FORMAT_UNSUPPORTED`, com a instrução de atualizar o Prism. Sem isso, quem voltasse a uma versão antiga
  concluiria que errou a senha.
- Um cofre de formato **mais antigo** é migrado ao abrir, e a versão anterior fica no arquivo `.bak`.

Hoje só existe um formato. A recusa do formato mais novo, a migração do formato mais antigo e a mensagem na tela
estão em desenvolvimento.

## 2. Onde a versão mora

A versão mora em **um lugar só**: o campo `version` de `src/client/package.json`. A API recebe o mesmo número na publicação
(`-p:Version=<versão>`, posto por `src/client/scripts/publish-api.mjs`), e nenhum `.csproj` declara versão. É desse campo que a
pipeline tira tudo: o nome da tag (`v` + a versão), o dos pacotes e o título da release.

Nos ramos `develop` e `main` o campo é a versão estável que o dono **quer**, `X.Y.Z`, sem sufixo (uma versão com sufixo escrita nele
é recusada, e o formato inválido também). O que a pipeline lança é a **versão da vez**, que ela mesma calcula a partir das tags
estáveis do repositório ("automático", decisão do dono em 2026-10-12):

| O campo `version` | A versão da vez |
| --- | --- |
| não há tag estável nenhuma (a primeira versão) | a do campo |
| é **maior** que a maior tag estável | a do campo |
| é **igual** à maior tag estável (a versão já saiu) | a maior estável com o **patch + 1** |
| é **menor** que a maior tag estável | a maior estável com o **patch + 1**, e um **aviso** (o campo ficou para trás) |

Assim, depois da `v0.1.0` a versão da vez é a `0.1.1` sozinha, sem mexer em arquivo nenhum: o próximo beta é o `v0.1.1-beta.1`, e a
próxima estável, a `v0.1.1`. Quem quer outra (a `0.2.0`, por exemplo) muda o campo, num pull request para a `develop`; vale enquanto
o campo for maior que a maior estável. `bash scripts/ci/check-version.sh main` (ou `develop`) diz qual é a versão da vez.

Nos pacotes de um lançamento a pipeline grava a versão da vez (`X.Y.Z-beta.N` num beta, `X.Y.Z` numa estável) na cópia de trabalho
dela, antes de gerar os pacotes, e não a comita: o app empacotado diz que é aquela versão, e o `package.json` do repositório continua
como está ([ci.md](ci.md#empacotar)).

## 3. Commits, tags e ramos

As mensagens de commit e o título do pull request seguem o Conventional Commits, descrito no
[CONTRIBUTING.md](../CONTRIBUTING.md#mensagens-de-commit). É esse histórico que alimenta o changelog e as notas dos betas.

A **tag** é um nome fixo para um commit. A de uma versão se chama `vX.Y.Z` (por exemplo, `v0.1.0`) e a de um beta, `vX.Y.Z-beta.N`.
**Ninguém cria tag à mão: quem a cria é a pipeline**, ao publicar a release (seção 5). Com as releases imutáveis ligadas no
repositório, a tag de uma release publicada não se move nem se apaga enquanto a release existir, e o nome dela não volta a ser usado
nem apagando a release ([ci.md](ci.md#lista-de-conferência-do-repositório), item 9).

Os ramos: `develop` é o ramo padrão, onde entra todo pull request; `main` recebe a `develop` só pelo pull request de lançamento; e os
ramos de trabalho (`feat/…`, `fix/…`, `chore/…`, `docs/…`, `ci/…`, `refactor/…`, `test/…`) são criados pelos mantenedores
([CONTRIBUTING.md](../CONTRIBUTING.md#fluxo)). **Não há ramo por versão** (`release/X.Y.Z`): a correção de uma versão antiga, se um dia
for preciso, é assunto de quando existir.

## 4. O changelog

O [CHANGELOG.md](../CHANGELOG.md) segue o formato [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): é escrito para pessoas,
com as mudanças de cada versão agrupadas por categoria (adicionado, alterado, corrigido e assim por diante) e a data no formato
`AAAA-MM-DD`. Ele é gerado pelo [`git-cliff`](https://git-cliff.org/docs/) a partir do histórico do git, com a configuração versionada
no próprio repositório, o [`cliff.toml`](../cliff.toml).

- **As notas de uma versão estável** são a seção dela no `CHANGELOG.md`, **se ela existir** (título exato `## [X.Y.Z] - AAAA-MM-DD`
  e com texto), seguidas das somas SHA-256 dos pacotes (`scripts/ci/release-notes.sh`, que o job `publicar` chama). **Sem a seção, a
  estável sai do mesmo jeito**, com as notas geradas pelo `git-cliff` na hora, como as de um beta: os commits desde a estável
  anterior (na primeira, o histórico inteiro). Essas notas não são gravadas no `CHANGELOG.md`. Escrever a seção é opcional, para quem
  quer notas curadas; **mas um título que cita a versão da vez fora do formato exato** (`## [0.1.1]`, `## 0.1.1 - 2026-10-12`) **reprova a
  conferência na `main`**, para o texto escrito não ser trocado, sem ninguém ver, pelo do `git-cliff`.
- **As notas de um beta** são geradas pelo `git-cliff` na hora, com os commits desde a tag de versão anterior (no primeiro beta, o
  histórico inteiro), seguidas das somas, e **não** são gravadas no `CHANGELOG.md`: um commit a cada merge encheria o histórico.
  Um beta só de documentação, testes ou pipeline sai com a frase "Nenhuma mudança que apareça para quem usa o Prism".
- **As notas são para quem usa o Prism** (decisão do dono em 2026-10-15): elas aparecem na página da release e na tela do app que
  oferece a atualização. O `git-cliff` só põe nelas o que o usuário percebe, cada item com a descrição do commit, sem o escopo
  (`client:`, `api:`) e sem as referências à especificação (`(RN-…)`, `(seção N)`). A seção de uma estável escrita à mão segue a
  mesma ideia: curta, na língua de quem usa, sem nome de rota, de arquivo, de regra nem de componente.
- **A seção da `0.1.0` é escrita à mão**: as mensagens de commit anteriores a ela falam de tarefas internas e não servem de changelog,
  e por isso vale escrevê-la e fechá-la antes de lançar a `0.1.0`. Até lá, ela fica sob "Não lançado".
- **Quem quiser a seção de uma versão no arquivo** (e não só nas notas da release) pede ao `git-cliff` que a gere e a acrescente no topo,
  sem reescrever o resto (`--prepend`, passo 3 da seção 5), com os commits desde a estável anterior.
- Os tipos dos commits viram as categorias do Keep a Changelog em português: `feat` em Adicionado; `perf` em Alterado; `fix` em
  Corrigido; os commits de escopo `security` (`fix(security): ...`) em Segurança. Um `!` depois do tipo leva o commit à primeira
  categoria, "Mudanças que quebram o contrato", qualquer que seja o tipo. **Não entram**: `docs`, `build`, `ci`, `test`, `chore`,
  `refactor` e os escopos `ci`, `build`, `spec` e `deps`, que não mudam o que o usuário vê, e `feat(api)`, porque a API local só
  conversa com o próprio app (o que o usuário vê de uma funcionalidade nova vem no commit da interface); uma correção da API entra.
  O tipo `release` não aparece. Descontinuado e Removido não têm tipo de commit: acrescente-os à mão na seção, quando houver.
- Só as tags `vX.Y.Z` contam como versão para o `git-cliff`; as de beta não viram seção.
- O cabeçalho do `cliff.toml` (o título, o parágrafo de abertura e a linha "Não lançado") tem de ser, byte a byte, o começo do
  `CHANGELOG.md`: o `--prepend` o tira do arquivo e o escreve de novo. O `.gitattributes` força fim de linha LF no arquivo, em
  qualquer sistema, para o texto bater.

## 5. Como lançar uma versão

**Lançar é fazer um merge**: o pull request de lançamento, `release: vX.Y.Z`, que leva a `develop` à `main`. No merge na `main`, a
pipeline calcula a versão da vez (seção 2), vê que há commit novo desde a última estável, e faz o resto sozinha: gera os pacotes das
quatro plataformas (Windows, Linux e os dois macOS: o macOS só sai nas estáveis), cria a release como rascunho, anexa os pacotes das
plataformas que vieram inteiras e o `SHA256SUMS`, e publica, o que cria a tag `vX.Y.Z` no commit do merge. As notas são a seção `## [X.Y.Z]` do `CHANGELOG.md`, se você a levou à `develop` antes (um merge a mais, opcional); senão, o
`git-cliff` as gera dos commits. **Ninguém cria tag à mão.** Um merge na `main` sem commit novo desde a última estável não lança nada:
a pipeline avisa "nada novo desde a vX.Y.Z".

Quem lança precisa ser [mantenedor](../CONTRIBUTING.md#mantenedores): é quem faz o merge na `main`.

O que segue é o que os workflows e os roteiros fazem.

### Antes da primeira versão

Uma vez só, no GitHub, faça a [lista de conferência do repositório](ci.md#lista-de-conferência-do-repositório) e o
[ensaio](ci.md#ensaio-com-o-repositório-privado). A reescrita do histórico (Tarefa 19) vem antes de o repositório ficar público, e
a primeira versão de verdade sai depois dela.

**A `0.1.0` é a única sem estável anterior.** O campo `version` já está em `0.1.0`, e não há tag estável, então a versão da vez é a
`0.1.0`. Desde o primeiro merge na `develop`, cada merge publica um beta dela (`v0.1.0-beta.1`, `v0.1.0-beta.2`…). O merge na `main`
lança a `v0.1.0`; as notas são a seção `## [0.1.0]` se ela estiver fechada no `CHANGELOG.md` (o texto dela está sob "Não lançado") e,
senão, o `git-cliff` com o histórico inteiro, que fala de tarefas internas: feche a seção antes (passo 3).

### O passo a passo

1. **Confira que a `develop` está pronta.** Os pull requests que devem entrar já foram mesclados, e a última execução da pipeline na
   `develop` está verde (a página "Actions" do repositório). As auditorias de dependências **travam**: com uma vulnerabilidade alta
   ou crítica numa dependência, nada é empacotado nem lançado até ela ser trocada. Num repositório público, o `leak-guard` também
   trava.

2. **Confira o número.** A versão da vez é a do campo `version` da `develop` se ela for maior que a última estável; senão, é a última
   estável com o patch + 1 (seção 2; `bash scripts/ci/check-version.sh main` diz qual). Veja o que entrou desde a última estável:
   `git log --oneline vX.Y.Z..origin/develop` (na primeira versão, `git log --oneline origin/develop`). Se algo quebra o contrato, o
   número de quebra tem de ter subido (o segundo, enquanto estiver na `0.x`); se só entrou funcionalidade, o segundo; se só entrou
   correção, o terceiro. O `git cliff --bumped-version` sugere o número a partir dos tipos dos commits, mas os mantenedores decidem.
   O patch + 1 vem sozinho; **para outro número, mude o campo** num pull request para a `develop` antes de seguir.

3. **(Recomendado) Escreva a seção do changelog**, para as notas serem curtas e na língua de quem usa em vez das geradas na hora
   pelo `git-cliff` (que repetem as mensagens dos commits, uma por linha), num ramo de
   trabalho a partir da `develop` atualizada (`git switch -c chore/release-X.Y.Z origin/develop`), e abra um pull request para a
   `develop` com o título `release: vX.Y.Z`. Ele altera **só o `CHANGELOG.md`**, e o título da seção é exatamente
   `## [X.Y.Z] - AAAA-MM-DD`, com a versão da vez. Sem este passo, vá ao 5.

   **Na `0.1.0`** a seção já está escrita à mão no arquivo, sob o título "Não lançado", e o pull request só a fecha: troque esse título
   por `## [0.1.0] - AAAA-MM-DD` (a data do lançamento) e deixe, no topo, um `## Não lançado` vazio, como o cabeçalho do `cliff.toml`
   espera:

   ```markdown
   ## Não lançado

   ## [0.1.0] - AAAA-MM-DD

   ### Adicionado

   - Cofre cifrado por usuário, com pastas e conexões.
   - Árvore de objetos e editor SQL para o PostgreSQL.
   ```

   **Das versões seguintes em diante** quem gera a seção é o `git-cliff`, com os commits desde a estável anterior, e ela entra no topo,
   logo abaixo de "Não lançado", sem tocar nas anteriores:

   ```bash
   git fetch --tags origin
   bash scripts/ci/git-cliff.sh --unreleased --tag vX.Y.Z --prepend CHANGELOG.md vANTERIOR..HEAD
   ```

   (`vANTERIOR` é a estável anterior, por exemplo `v0.1.0`; o intervalo é o que separa os commits dela dos novos, porque a tag da
   estável fica no commit de merge da `main`, que não está na história da `develop`. O `--unreleased --tag` gera a seção como se a tag
   já existisse; a tag mesma quem cria é a pipeline.) O `git-cliff.sh` roda a imagem do `git-cliff` fixada por tag e digest, com o
   Docker; a pipeline usa a mesma imagem para as notas dos betas.

   Leia o resultado: o `git-cliff` resume mensagens de commit, e quem lança pode (e deve) melhorar o texto. Não use `-o` no lugar do
   `--prepend`, que reescreveria o arquivo inteiro. **O texto da seção é o que vai aparecer na página da release e na tela do app**,
   quando ele oferecer a atualização: escreva para quem usa.

4. **Mescle esse pull request na `develop`** (se o escreveu). O merge publica mais um beta da versão (as notas dele não usam o
   changelog).

5. **Confira antes do lançamento.** Na `develop` atualizada, rode:

   ```bash
   bash scripts/ci/check-version.sh main
   ```

   Ele lê a versão, o changelog, as tags do remoto e o histórico, e diz o que o merge na `main` vai fazer: `LANÇA a versão estável
   vX.Y.Z`, com a origem das notas (a seção do changelog ou o `git-cliff`); `nada novo desde a vX.Y.Z`, se não há commit novo; ou o que
   reprova (a versão fora do formato, um beta de versão maior já publicado, o título da seção fora do formato exato). Se a versão do
   campo ficou para trás, avisa qual é a da vez. Nenhum pull request roda a pipeline: é este comando que diz, antes do merge, o que a
   pipeline vai decidir.

6. **Abra o pull request de lançamento**, da `develop` para a `main`, com o título `release: vX.Y.Z`, e faça o merge com
   **"Create a merge commit"** (o método que as regras da `main` pedem: a `main` recebe a história da `develop` inteira). É neste
   momento que a versão sai. Nenhum outro merge entra na `main` antes de a release aparecer.

7. **A pipeline da `main` trabalha sozinha** ([ci.md](ci.md#a-ordem-das-etapas)): confere a versão e o changelog; verifica, testa e
   audita o código; gera os pacotes de Windows, Linux e macOS, cada um com a API da mesma plataforma e com o endereço onde o app vai
   procurar atualização; cria a release como rascunho, anexa os onze arquivos (os de cada plataforma que veio inteira) e publica. **É a publicação que cria a tag `vX.Y.Z`**,
   no commit do merge. O único token que ela usa é o do próprio job.

8. **Confira que deu certo.**
   - Na página de releases: a release "Prism X.Y.Z", marcada como "Latest" e como "Immutable", as notas, o bloco "Somas SHA-256" no
     fim delas e os onze arquivos. **Se faltar o pacote de uma plataforma** (a execução da `main` mostra o aviso "Plataforma sem pacote",
     com o job verde), as notas dizem no começo qual, e a plataforma volta na próxima versão: a release publicada não recebe arquivo
     depois, então, se a falta for grave, lance a versão seguinte.
   - A tag, no commit do merge: `git fetch --tags origin` e `git rev-parse "vX.Y.Z^{commit}"`.
   - Um pacote: baixe-o, calcule o SHA-256 e compare com a linha dele no `SHA256SUMS` **e** nas notas da release:

     ```powershell
     Get-FileHash -Algorithm SHA256 .\NOME-DO-ARQUIVO
     ```

     ```bash
     sha256sum NOME-DO-ARQUIVO
     ```

     O primeiro é o comando do Windows (PowerShell) e o segundo, o do Linux. No macOS, use `shasum -a 256 NOME-DO-ARQUIVO`.
   - Num Prism de uma versão anterior, "Verificar atualizações" (ao lado da versão) deve mostrar a versão nova e as notas.

9. **Não há versão a subir depois.** O próximo beta da `develop` já é o da versão seguinte (`v0.1.1-beta.1`, com o número voltando a
   1), e a próxima estável sai com o patch + 1. O campo `version` só muda quando você quer outro número (um MINOR ou um MAJOR).

### Se a pipeline falhar

Regra geral: **repita o job que falhou, na mesma execução** ("Re-run failed jobs" na página da execução). O que já foi feito é
conferido e pulado; nada é publicado pela metade (até a publicação, a release é um rascunho, que não é público e não tem tag). O
estado em que as coisas ficam em cada ponto está em [Quando um lançamento falha no meio](ci.md#quando-um-lançamento-falha-no-meio).
Em resumo:

| Onde parou | O que aconteceu | O que fazer |
| --- | --- | --- |
| `Conferir a versão` | a versão está fora do formato, a versão da vez não é maior que um beta já publicado, ou o título da seção do changelog cita a versão da vez fora do formato. Nada foi gerado | corrija num pull request |
| testes ou auditoria | nada foi publicado | corrija e faça o merge, ou repita o job |
| o pacote de uma plataforma (falhou, foi cancelado ou ficou sem runner) | **a versão sai com as outras plataformas**: o job `Publicar a release` termina verde, com um aviso à vista, e as notas dizem quem ficou sem o pacote | nada a fazer: a plataforma volta na próxima versão (uma release publicada não recebe arquivo depois) |
| `Publicar a release`, antes de publicar | um rascunho, talvez com parte dos arquivos; **não há tag**: para o app e para a página de releases, a versão não existe | leia a mensagem do job, conserte a causa e repita o job |
| `Publicar a release` diz que o plano não bate com as tags | outra coisa mudou as tags durante a execução (uma estável saiu enquanto um beta era empacotado, por exemplo: a versão da vez mudou) | rode a execução inteira de novo ("Re-run all jobs") |

### Os betas

Não há o que fazer: **cada merge na `develop` publica um beta** da versão da vez (seção 2), com o número seguinte (`v0.2.0-beta.1`,
`v0.2.0-beta.2`…) e as notas do `git-cliff` desde a tag de versão anterior. O número conta só os betas da versão da vez: depois de uma
estável, o primeiro beta da seguinte é o `beta.1` (`v0.1.1-beta.1`). As execuções de um ramo correm uma de cada vez, na ordem dos
merges. Um beta não ganha seção no changelog. Ele sai com os pacotes de Windows e Linux: se o de uma delas falhar, o beta sai mesmo
assim com a outra, e as notas dizem qual plataforma ficou sem pacote.

### Se a versão saiu errada

**Nunca reaproveite o número** de uma versão publicada, nem mude ou apague a tag dela; com as releases imutáveis o GitHub nem deixa
mover a tag nem trocar um arquivo. Isso é a cláusula 3 do [SemVer](https://semver.org/lang/pt-BR/): "uma vez que um pacote
versionado foi lançado, o conteúdo desta versão não deve ser modificado". Corrija o problema e lance a **próxima** versão com a
correção; anote o que houve no `CHANGELOG.md` e marque a versão com defeito como `[YANKED]`.

O FAQ do SemVer trata do caso de um **lançamento incompatível publicado por engano** (por exemplo, uma mudança que quebra o
cofre numa versão que subiu só o terceiro número): conserte o problema e lance uma nova versão que o corrige e restaura a
compatibilidade, nunca altere a versão já lançada e, se for o caso, documente a versão problemática e avise quem a usa (a
[pesquisa](pesquisas/2026-10-09-versionamento.md) cita o trecho).

**Cuidado ao editar as notas de uma release na página do GitHub** (o título e as notas de uma release imutável ainda se editam). O
bloco "Somas SHA-256" do fim das notas é lido pelo atualizador do app, que confere o pacote baixado contra as somas dele e contra as
do `SHA256SUMS`. Se o título do bloco mudar, se a cerca ganhar uma linguagem ou se entrar qualquer texto depois dele, o app deixa de
achar as somas e **recusa a atualização** daquela versão. Para corrigir um erro de texto, mexa só no que vem antes do título
"Somas SHA-256".

## 6. Atualizações no app

A pipeline publica; quem atualiza é o app. Ao abrir, e no máximo uma vez por dia, o Prism consulta as releases do repositório de onde
o pacote saiu (o endereço é gravado no pacote pela pipeline, a partir do próprio workflow). Havendo versão mais nova no canal
escolhido (só as estáveis, ou também as betas, com "Receber versões beta" ligado), ele mostra as notas e pergunta; **só baixa se o
usuário mandar**, confere o pacote com as duas somas (a das notas e a do `SHA256SUMS`) antes de instalar, e permite pular uma versão
ou desligar a verificação ao abrir. **Uma versão que saiu sem o pacote do sistema da pessoa não é oferecida a ela**: o Prism procura a
mais nova que tem o pacote (o nome do arquivo precisa estar nas somas das notas), e as notas que mostra vão até essa versão; sem
nenhuma, ele diz que está atualizado. (As versões instaladas até a `0.5.0-beta.2` não têm essa regra: nelas a versão sem o pacote
aparece, e a atualização é recusada.) No Windows, ele roda o instalador conferido; no Linux e no macOS, deixa o pacote conferido na
pasta de downloads e diz o que fazer. Um Prism gerado sem o endereço (o de desenvolvimento, um pacote gerado à mão) não procura
atualização. A consulta é feita sem credencial: num repositório privado ela não acha nada.

## 7. O que fica para depois

Por depender de assinatura de código ou de infraestrutura que o projeto ainda não tem:

- assinatura com Developer ID e notarização dos pacotes (o de macOS já sai com a assinatura ad hoc, sem nenhuma das duas), e
  assinatura das releases com uma chave do projeto (hoje a garantia de uma atualização é o HTTPS do GitHub somado às duas somas e às
  releases imutáveis);
- aplicar a atualização sozinho no Linux e no macOS, e atualização em segundo plano;
- repositórios apt e rpm;
- automação que abre o pull request de lançamento;
- apagar os betas antigos da página de releases;
- correção de uma versão antiga (um ramo por versão), se um dia for preciso;
- a conferência de versão entre a interface e a API na partida.

## Pesquisa

As fontes e as comparações com outros projetos por trás desta política estão em
os registros internos do projeto.
