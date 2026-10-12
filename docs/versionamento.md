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
seguinte. A `0.2.0` estável reúne tudo desde a estável anterior, e o changelog não repete as betas. Na página de releases do GitHub
um beta aparece marcado como "Pre-release". O Prism instalado só oferece beta a quem ligou "Receber versões beta" em Configurações ›
Atualizações; com a opção desligada, quem está numa beta recebe a próxima estável.

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

Nos ramos `develop` e `main` o campo é a **próxima versão estável**, `X.Y.Z`, sem sufixo. Num beta, a pipeline grava o número do beta
(`X.Y.Z-beta.N`) na cópia de trabalho dela, antes de gerar os pacotes, e não o comita: o app empacotado diz que é aquele beta, e o
`package.json` do repositório continua em `X.Y.Z` ([ci.md](ci.md#empacotar)). Uma versão com sufixo escrita no `package.json` é
recusada.

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

- **As notas de uma versão estável** são a seção dela no `CHANGELOG.md`, seguidas das somas SHA-256 dos pacotes
  (`scripts/ci/release-notes.sh`, que o job `publicar` chama). Uma estável **sem seção** no changelog **não é lançada**: a pipeline
  avisa e não publica.
- **As notas de um beta** são geradas pelo `git-cliff` na hora, com os commits desde a tag de versão anterior (no primeiro beta, o
  histórico inteiro), seguidas das somas, e **não** são gravadas no `CHANGELOG.md`: um commit a cada merge encheria o histórico.
- **A seção da `0.1.0` é escrita à mão**: as mensagens de commit anteriores a ela falam de tarefas internas e não servem de changelog.
  Até o pull request de lançamento, ela fica sob "Não lançado".
- **Da versão seguinte em diante o `git-cliff` gera a seção nova e a acrescenta no topo, sem reescrever o resto** (`--prepend`, passo 3
  da seção 5), com os commits desde a estável anterior.
- Os tipos dos commits viram as categorias do Keep a Changelog em português: `feat` em Adicionado; `perf` e `refactor` em
  Alterado; `fix` em Corrigido; os commits de escopo `security` (`fix(security): ...`) em Segurança; `docs` em Documentação;
  `build` e `ci` em Empacotamento e pipeline; `test` e `chore` em Testes e manutenção. Um `!` depois do tipo leva o commit à
  primeira categoria, "Mudanças que quebram o contrato". O tipo `release` não aparece. Descontinuado e Removido não têm tipo
  de commit: acrescente-os à mão na seção, quando houver.
- Só as tags `vX.Y.Z` contam como versão para o `git-cliff`; as de beta não viram seção.
- O cabeçalho do `cliff.toml` (o título, o parágrafo de abertura e a linha "Não lançado") tem de ser, byte a byte, o começo do
  `CHANGELOG.md`: o `--prepend` o tira do arquivo e o escreve de novo. O `.gitattributes` força fim de linha LF no arquivo, em
  qualquer sistema, para o texto bater.

## 5. Como lançar uma versão

**Lançar é fazer dois merges.** O primeiro leva a seção da versão ao `CHANGELOG.md` da `develop`; o segundo, o pull request de
lançamento `release: vX.Y.Z`, leva a `develop` à `main`. No merge na `main`, a pipeline vê que a versão de `src/client/package.json`
ainda não tem tag e que o changelog tem a seção dela, e faz o resto sozinha: gera os pacotes de todas as plataformas, cria a release
como rascunho, anexa os pacotes e o `SHA256SUMS`, e publica, o que cria a tag `vX.Y.Z` no commit do merge. **Ninguém cria tag à
mão.**

Quem lança precisa ser [mantenedor](../CONTRIBUTING.md#mantenedores): é quem faz o merge na `main`.

**Nenhuma execução da pipeline aconteceu ainda** ([Estado da validação](ci.md#estado-da-validação)). O que segue é o que os workflows
e os roteiros mandam fazer, ensaiado fora do GitHub; não é o que já se viu acontecer.

### Antes da primeira versão

Uma vez só, no GitHub, faça a [lista de conferência do repositório](ci.md#lista-de-conferência-do-repositório) e o
[ensaio](ci.md#ensaio-com-o-repositório-privado). A reescrita do histórico (Tarefa 19) vem antes de o repositório ficar público, e
a primeira versão de verdade sai depois dela.

**A `0.1.0` é diferente das outras num ponto.** O campo `version` já está em `0.1.0`, e essa versão ainda não tem tag. Então, desde o
primeiro merge na `develop`, cada merge publica um beta da `0.1.0` (`v0.1.0-beta.1`, `v0.1.0-beta.2`…), e cada merge na `main` avisa
que falta a seção `## [0.1.0]` (o texto dela está sob "Não lançado"). É o pull request de lançamento que a fecha.

### O passo a passo

1. **Confira que a `develop` está pronta.** Os pull requests que devem entrar já foram mesclados, e a última execução da pipeline na
   `develop` está verde (a página "Actions" do repositório). As auditorias de dependências **travam**: com uma vulnerabilidade alta
   ou crítica numa dependência, nada é empacotado nem lançado até ela ser trocada. Num repositório público, o `leak-guard` também
   trava.

2. **Confira o número.** O campo `version` da `develop` já é a próxima versão estável (é ela que os betas numeram). Veja o que entrou
   desde a última estável: `git log --oneline vX.Y.Z..origin/develop` (na primeira versão, `git log --oneline origin/develop`). Se
   algo quebra o contrato, o número de quebra tem de ter subido (o segundo, enquanto estiver na `0.x`); se só entrou funcionalidade,
   o segundo; se só entrou correção, o terceiro. O `git cliff --bumped-version` sugere o número a partir dos tipos dos commits, mas os
   mantenedores decidem. Se o número precisa mudar, mude o campo num pull request para a `develop` antes de seguir.

3. **Escreva a seção do changelog**, num ramo de trabalho a partir da `develop` atualizada
   (`git switch -c chore/release-X.Y.Z origin/develop`), e abra um pull request para a `develop` com o título `release: vX.Y.Z`. Ele
   altera **só o `CHANGELOG.md`**.

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

4. **Mescle esse pull request na `develop`.** O merge publica mais um beta da versão (as notas dele não usam o changelog).

5. **Confira antes do lançamento.** Na `develop` atualizada, rode:

   ```bash
   bash scripts/ci/check-version.sh main
   ```

   Ele lê a versão, o changelog e as tags do remoto e diz o que o merge na `main` vai fazer: `LANÇA a versão estável vX.Y.Z`, ou o que
   falta (a versão fora do formato, menor que uma já lançada, a seção ausente ou com o título fora do formato exato). Nenhum pull
   request roda a pipeline: é este comando que diz, antes do merge, o que a pipeline vai decidir.

6. **Abra o pull request de lançamento**, da `develop` para a `main`, com o título `release: vX.Y.Z`, e faça o merge com
   **"Create a merge commit"** (o método que as regras da `main` pedem: a `main` recebe a história da `develop` inteira). É neste
   momento que a versão sai. Nenhum outro merge entra na `main` antes de a release aparecer.

7. **A pipeline da `main` trabalha sozinha** ([ci.md](ci.md#a-ordem-das-etapas)): confere a versão e o changelog; verifica, testa e
   audita o código; gera os pacotes de Windows, Linux e macOS, cada um com a API da mesma plataforma e com o endereço onde o app vai
   procurar atualização; cria a release como rascunho, anexa os onze arquivos e publica. **É a publicação que cria a tag `vX.Y.Z`**,
   no commit do merge. O único token que ela usa é o do próprio job.

8. **Confira que deu certo.**
   - Na página de releases: a release "Prism X.Y.Z", marcada como "Latest" e como "Immutable", as notas, o bloco "Somas SHA-256" no
     fim delas e os onze arquivos.
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

9. **Suba a versão na `develop` logo em seguida**, num pull request (`chore: a próxima versão é a X.Y+1.0`, por exemplo): até lá, cada
   merge na `develop` avisa que a versão já tem a estável e não publica beta.

### Se a pipeline falhar

Regra geral: **repita o job que falhou, na mesma execução** ("Re-run failed jobs" na página da execução). O que já foi feito é
conferido e pulado; nada é publicado pela metade (até a publicação, a release é um rascunho, que não é público e não tem tag). O
estado em que as coisas ficam em cada ponto está em [Quando um lançamento falha no meio](ci.md#quando-um-lançamento-falha-no-meio).
Em resumo:

| Onde parou | O que aconteceu | O que fazer |
| --- | --- | --- |
| `Conferir a versão` | a versão está fora do formato, é menor que uma já lançada, ou o título da seção está errado. Nada foi gerado | corrija num pull request |
| testes, auditoria ou um pacote | nada foi publicado | corrija e faça o merge, ou repita o job |
| `Publicar a release`, antes de publicar | um rascunho, talvez com parte dos arquivos; **não há tag**: para o app e para a página de releases, a versão não existe | leia a mensagem do job, conserte a causa e repita o job |
| `Publicar a release` diz que o plano não bate com as tags | outra coisa mudou as tags durante a execução | rode a execução inteira de novo ("Re-run all jobs") |

### Os betas

Não há o que fazer: **cada merge na `develop` publica um beta** da versão do `package.json`, com o número seguinte (`v0.2.0-beta.1`,
`v0.2.0-beta.2`…) e as notas do `git-cliff` desde a tag de versão anterior. As execuções de um ramo correm uma de cada vez, na ordem
dos merges; com a versão já lançada como estável, o merge avisa e não publica (passo 9 acima). Um beta não ganha seção no changelog.

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
ou desligar a verificação ao abrir. No Windows, ele roda o instalador conferido; no Linux e no macOS, deixa o pacote conferido na
pasta de downloads e diz o que fazer. Um Prism gerado sem o endereço (o de desenvolvimento, um pacote gerado à mão) não procura
atualização. A consulta é feita sem credencial: num repositório privado ela não acha nada.

## 7. O que fica para depois

Por depender de assinatura de código ou de infraestrutura que o projeto ainda não tem:

- assinatura e notarização dos pacotes, e assinatura das releases com uma chave do projeto (hoje a garantia de uma atualização é o
  HTTPS do GitHub somado às duas somas e às releases imutáveis);
- aplicar a atualização sozinho no Linux e no macOS, e atualização em segundo plano;
- repositórios apt e rpm;
- automação que abre o pull request de lançamento;
- apagar os betas antigos da página de releases;
- correção de uma versão antiga (um ramo por versão), se um dia for preciso;
- a conferência de versão entre a interface e a API na partida.

## Pesquisa

As fontes e as comparações com outros projetos por trás desta política estão em
os registros internos do projeto.
