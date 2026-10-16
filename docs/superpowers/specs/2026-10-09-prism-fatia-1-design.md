# Prism — Fatia 1: cofre, conexões, árvore de objetos e editor SQL

Data: 2026-10-09 · Estado: aprovada pelo usuário em 2026-10-09, com os ajustes dele já incorporados

## 1. O que é e para quem

Prism é um cliente de banco de dados para desktop, no lugar do DBeaver, para quem trabalha
todo dia com Informix, Db2 e PostgreSQL. O critério de sucesso do produto é ser mais rápido
e mais direto que o DBeaver nas mesmas tarefas: abrir, conectar, navegar pelos objetos,
rodar SQL e ver o resultado.

Referência visual: o canvas de design aprovado em
<https://claude.ai/artifact/HUh9vhKrZaeCgrC1ms1MHs> (telas Login, Conexões, Revelar senha e
Área de trabalho). Onde esta especificação e o canvas divergem, vale esta especificação, e a
divergência está escrita na seção 9.

### O que o usuário pediu (não muda sem ele)

- App desktop em Electron, back-end em C#, os dois unidos por API ou conexão TCP.
- Arquitetura conforme as skills zanveri, na interface e no código.
- Conectar em Informix, Db2 e PostgreSQL; executar qualquer SQL; ver bancos, esquemas,
  tabelas, procedimentos, chaves estrangeiras e índices.
- Ao iniciar, pedir login e senha; cifrar todas as conexões, com cifra diferente para cada
  usuário.
- Para ver a senha de uma conexão com o banco, o usuário digita a própria senha antes.
- Resultado de consulta: só as 200 primeiras linhas; o total só é contado quando o usuário
  pede; mais linhas só sob demanda.

### Decisões tomadas na conversa de 2026-10-09

- Interface: **Electron + React (Vite)**, sem Next.js.
- Base do back-end copiada de um projeto de referência interno da Zanveri.
- Entrega em fatias; esta é a primeira.
- Repositório: `github.com/Zanveri/prism` (decisão do dono em 2026-10-12, seção 21; até então
  era um projeto do GitLab, que deixou de ser usado).
- A derivação da chave usa **Argon2id**.
- O Informix dos testes é um **contêiner Docker**, não um servidor da empresa.
- **Banco local:** esta fatia não precisa de um; pastas e conexões cabem no arquivo do cofre.
  Quando uma entrega precisar (histórico de consultas, por exemplo), será SQLite cifrado, com
  credencial aleatória gerada na criação da conta e guardada dentro do cofre, que nem o
  usuário vê. A chave do cofre desta fatia já segue essa regra (RN-COFRE-003).

## 2. Divisão do produto em entregas

Cada entrega tem a sua especificação e o seu plano. Esta especificação cobre só a primeira.

| Entrega | Conteúdo |
| --- | --- |
| **1 (esta)** | Casca Electron + API C#, login e cofre por usuário, pastas e conexões, os três bancos conectando, árvore de objetos, editor SQL com 200 linhas, "Carregar mais" e "Contar total" |
| 2 | Aba de tabela: Registros (200 + rolagem), Estrutura (colunas, FKs, índices, DDL), salto por FK, abrir e salvar `.sql` |
| 3 | Proteções e sessão: somente leitura (com senha para mudar), confirmação antes de comando irreversível, verificação periódica da conexão, encerramento por ociosidade, ambiente e proteções herdados da pasta. Em 2026-10-15 (pedido do dono, seção 32) entraram nesta fatia o somente leitura, a confirmação antes de executar, a verificação periódica e as proteções herdadas da pasta; o ambiente herdado já tinha entrado pela RN-PASTA-005. Fica o encerramento por ociosidade |
| 4 | Diagrama ER, configurações do usuário, temas, troca de senha, bloqueio por inatividade, instalador |

## 3. Arquitetura

```
┌──────────────────────── Electron ────────────────────────┐
│  main (Node)                                             │
│   ├─ cria a janela e o preload                           │
│   └─ inicia e encerra o processo da API                  │
│                                                          │
│  renderer (React)  ── fetch + token ──┐                  │
└───────────────────────────────────────┼──────────────────┘
                                        ▼  HTTP em 127.0.0.1, porta efêmera
                              Prism.Api (ASP.NET Core)
                                        │
                     ┌──────────────────┼──────────────────┐
                     ▼                  ▼                  ▼
              arquivo do cofre     PostgreSQL        Db2 / Informix
              (um por usuário)      (Npgsql)       (Net.IBM.Data.Db2)
```

### 3.1 Transporte

Foram consideradas três formas de unir a tela à API:

1. **HTTP em loopback com token de lançamento (escolhida).** É o formato dos controllers e do
   Mediator das skills zanveri, sem adaptação; a tela usa `fetch`; dá para exercitar com `curl`.
2. Pipe nomeado ou stdio com JSON-RPC. Não abre porta, mas perde o formato dos controllers e
   obriga a escrever um protocolo próprio.
3. gRPC. Bom para fluxo contínuo, que esta fatia não tem; acrescenta ferramentas de geração de
   código dos dois lados.

Como funciona:

- O processo principal do Electron gera 32 bytes aleatórios (o **token de lançamento**) e inicia
  a API com as variáveis `PRISM_API_TOKEN`, `PRISM_DATA_DIR`, `PRISM_ALLOWED_ORIGIN` e
  `PRISM_PARENT_PID`.
- A API escuta só em `http://127.0.0.1:0` (porta escolhida pelo sistema) e escreve uma linha
  `PRISM_API_READY <porta>` na saída padrão. O processo principal lê a porta.
- O preload entrega `{ baseUrl, token }` à tela por `contextBridge`. É a única coisa que ele expõe.
- Toda requisição leva `Authorization: Bearer <token>`.
- A tela tem uma origem de verdade nos dois modos: em desenvolvimento, o servidor do Vite
  (`http://localhost:5173`); no app empacotado, um esquema próprio registrado como privilegiado
  (`app://prism`), e não `file://`, cuja origem é nula. `PRISM_ALLOWED_ORIGIN` recebe essa origem.

### 3.2 Back-end (`src/api`)

Solução `Prism.slnx`, `net10.0`, os quatro projetos das skills zanveri:

| Projeto | Conteúdo nesta fatia |
| --- | --- |
| `Prism.Api` | Controllers, autenticação pelo token de lançamento, barreira do cofre, tratamento global de exceção, Serilog, `Program.cs` |
| `Prism.Application` | Fatias `Users`, `Sessions`, `Folders`, `Connections`, `DatabaseSessions`: domínio, features (command + handler + validator), repositories, queries, erros, DTOs |
| `Prism.Infrastructure` | Integração `Vault/` (arquivo e cifra) e integração `Databases/` (drivers dos três bancos), cada uma com `Clients/`, `Services/` e `Models/` |
| `Prism.Core` | `ApiErrorDto`, `ApiSuccessDto`, `ResultExtensions`, `StringExtensions`, `DomainDto`, copiados do etio |

Testes em `src/api/tests/`: `Prism.UnitTesting` (xUnit), `Prism.IntegrationTesting` (NUnit +
Testcontainers) e `Prism.TestingCore`, como no etio.

Pacotes: `Zanveri.Mediator` e `Zanveri.Mediator.FluentValidation`, `CSharpFunctionalExtensions`,
Serilog, `Npgsql`, `Net.IBM.Data.Db2` e `Konscious.Security.Cryptography.Argon2` (Argon2id em
código gerenciado, sem binário nativo). Sem Dapper: as consultas de catálogo passam pelo mesmo
caminho de leitura das consultas do usuário. `nuget.config` e `Directory.Build.props` (pacotes
travados) copiados do etio.

### 3.3 Interface (`src/client`)

Um pacote pnpm: Electron, Vite, React, TypeScript estrito, Tailwind 4, Zod. `electron-vite`
compila main, preload e renderer; `electron-builder` empacota.

```
src/client/
├── electron/                 main.ts, preload.ts, api-process.ts
└── src/
    ├── app/                  uma pasta por tela
    │   ├── sign-in/          page.tsx, _components/, _lib/
    │   ├── connections/      page.tsx, _components/, _lib/
    │   └── workbench/        page.tsx, _components/, _lib/
    ├── components/ui/        primitivos + index.ts (adaptados do etio)
    ├── components/layout/    barra superior, casca da página
    ├── config/               paths.config.ts
    ├── lib/api/              prism-api.ts, prism-endpoints.ts
    ├── lib/utils/            cn.ts, format.ts
    └── styles/globals.css    tokens do canvas em @theme
```

O que vale das skills zanveri de front-end: colocalização em `_components` e `_lib`; arquivos
`.schema.ts` (Zod), `.service.ts` (uma função por endpoint, resposta sempre validada com
`safeParse`) e `.copy.ts` (textos em pt-BR); arquivos em kebab-case, exports nomeados, alias
`@/*`; tokens em `globals.css`; resultado de ação em toast, estado na página; promover para
`components/` só o que duas telas usam.

Bibliotecas além das citadas: `react-router` (rotas em hash), `@tanstack/react-query` (cache
da árvore e das listas), `@tanstack/react-virtual` (grade e árvore virtualizadas), CodeMirror 6
com `@codemirror/lang-sql` (editor), fontes IBM Plex empacotadas no app (sem Google Fonts).

## 4. Segurança

### 4.1 Quem pode chamar a API

- **RN-API-001.** Requisição sem o token de lançamento, ou com token diferente, responde 401
  `AUTHENTICATION_REQUIRED`. A comparação é em tempo constante. Existe para que outro programa
  ou uma página web aberta na mesma máquina não use a API.
- **RN-API-002.** CORS aceita uma única origem, a de `PRISM_ALLOWED_ORIGIN`. O filtro de host
  aceita só `127.0.0.1`.
- **RN-API-003.** A API não inicia sem `PRISM_API_TOKEN`, `PRISM_DATA_DIR` e
  `PRISM_ALLOWED_ORIGIN`. Não há valor padrão.
- **RN-API-004.** A API encerra quando o processo de `PRISM_PARENT_PID` deixa de existir, para
  não sobrar processo órfão com conexões abertas.
- **RN-API-005.** Rotas `api/user/...` respondem 401 `VAULT_LOCKED` enquanto não houver cofre
  aberto. Rotas `api/public/...` exigem só o token de lançamento.

### 4.2 Cofre por usuário

- **RN-COFRE-001.** Cada usuário tem um arquivo, `<PRISM_DATA_DIR>/vaults/<usuario>.vault.json`.
  Pastas e conexões (inclusive nomes, hosts e senhas) ficam dentro dele, cifradas.
- **RN-COFRE-002.** A senha do usuário não é gravada em lugar nenhum. Dela sai, por Argon2id
  (64 MiB de memória, 3 passadas, paralelismo 4, sal aleatório de 16 bytes por usuário), a
  chave que protege a chave do cofre.
- **RN-COFRE-003.** A chave do cofre é aleatória (256 bits), gerada na criação da conta e trocada
  por outra a cada troca de senha (RN-COFRE-013); nem o usuário a conhece. Fica no cabeçalho do arquivo, cifrada com AES-256-GCM pela chave derivada
  da senha. O conteúdo é cifrado com a chave do cofre, também AES-256-GCM, com nonce aleatório
  novo a cada gravação, e o cabeçalho entra como dado autenticado. Arquivo adulterado não abre.
- **RN-COFRE-004.** O cabeçalho traz versão, algoritmo e parâmetros da derivação, para que uma
  versão futura mude os parâmetros sem perder cofres antigos.
- **RN-COFRE-005.** A gravação é atômica: escreve em arquivo temporário, depois substitui, e
  guarda a versão anterior como `.bak`. Queda de energia no meio não corrompe o cofre. Se o
  arquivo principal sumir e o `.bak` existir, o app volta a usar o `.bak` sozinho, e nunca
  cria um cofre novo por cima dele.
- **RN-COFRE-006.** Usuário inexistente e senha errada dão a mesma resposta, 401
  `INVALID_CREDENTIALS`, e o mesmo trabalho de derivação.
- **RN-COFRE-007.** Um cofre aberto por vez. Entrar com outro usuário fecha o anterior.
- **RN-COFRE-008.** Fechar o cofre (botão Sair, ou o app fechando) encerra todas as sessões
  com bancos e zera a chave na memória. No "Sair" e no fechamento do app, antes de encerrar
  sessões com transação aberta, vale a RN-TX-006.
- **RN-COFRE-009.** Senha esquecida não tem recuperação: o cofre daquele usuário fica ilegível.
  A tela de login avisa isso, como no canvas.
- **RN-COFRE-010.** Nome de usuário: 3 a 32 caracteres, `a-z`, `0-9`, `.`, `_`, `-`, gravado em
  minúsculas. Senha: 8 a 128 caracteres, sem regra de composição (a contagem é em unidades UTF-16, a do
  campo de texto: um emoji conta 2).

### 4.3 Senha das conexões

- **RN-CONN-001.** A senha de uma conexão nunca sai nas respostas de listagem ou detalhe; elas
  trazem só `hasPassword`.
- **RN-CONN-002.** Para ver a senha de uma conexão o usuário digita a própria senha. A API
  deriva a chave de novo e tenta abrir com ela a chave do cofre gravada no cabeçalho. Senha
  errada responde 422 `INVALID_PASSWORD` e não devolve nada.
- **RN-CONN-003.** O quinto erro seguido em RN-CONN-002 fecha o cofre (RN-COFRE-008) e responde
  401 `VAULT_LOCKED` no lugar do 422. Acertar zera a contagem. Com transação aberta, o diálogo
  de senha da RN-CONN-002 avisa que cinco erros seguidos fecham o cofre e desfazem as transações
  abertas (RN-TX-008).
- **RN-CONN-004.** Ao editar uma conexão, senha omitida mantém a senha gravada, desde que o
  host e a porta continuem os mesmos. Mudar o host ou a porta sem informar a senha da conexão
  responde 422 `CONNECTION_INVALID`: a senha gravada só é enviada ao servidor para o qual foi
  gravada. Sem isso, apontar a conexão para outro servidor entregaria a ele a senha que a
  RN-CONN-002 só mostra a quem redigita a senha do Prism.

### 4.4 Janela e logs

- **RN-SHELL-001.** Janela com `contextIsolation`, `sandbox` e sem `nodeIntegration`. Navegação
  para fora do app e abertura de janelas são negadas. A política de conteúdo permite só o
  próprio app e a API em `127.0.0.1`.
- **RN-SHELL-002.** Tudo o que vem de um banco (nomes de objetos, valores, mensagens de erro) é
  desenhado como texto, nunca como HTML.
- **RN-LOG-001.** O log (arquivo em `<PRISM_DATA_DIR>/logs/`, rotação diária, 7 dias) não
  registra senha, string de conexão, texto de SQL nem dados de resultado. Registra sessão,
  duração, quantidade de linhas e a classe do erro.

## 5. Regras de negócio

### 5.1 Pastas

- **RN-PASTA-001.** Pastas aninham sem limite de profundidade. Campos: nome (1 a 60) e pasta
  pai (opcional).
- **RN-PASTA-002.** Nome único entre as irmãs, sem diferenciar maiúsculas: 409
  `FOLDER_ALREADY_EXISTS`.
- **RN-PASTA-003.** Mover uma pasta para dentro dela mesma ou de uma descendente: 409
  `FOLDER_CYCLE`.
- **RN-PASTA-004.** Só pasta vazia (sem subpastas e sem conexões) pode ser excluída: 409
  `FOLDER_NOT_EMPTY`.

### 5.2 Conexões

- **RN-CONN-010.** Campos: nome (1 a 80), pasta (opcional), banco (`PostgreSql` = 1, `Db2` = 2,
  `Informix` = 3), host, porta, nome do banco de dados, usuário, senha, nome do ambiente
  (opcional, até 30) e cor do ambiente (opcional, `#RRGGBB`); as proteções, "Confirmar antes de
  executar" ("Não", o padrão, "Só comandos irreversíveis" ou "Todos os comandos", RN-PROT-001) e
  "Somente leitura" (desmarcada por padrão, RN-PROT-002); e a sessão da conexão, "Verificar a cada N
  segundos" (ligada, 30 segundos, de 5 a 3.600) e a consulta de verificação (opcional, até 1.000
  caracteres, RN-VERIF-001). *Alterada a pedido do dono em 2026-10-15 (seção 32): entraram as
  proteções e a sessão da conexão.*
- **RN-CONN-011.** Nome único dentro da mesma pasta: 409 `CONNECTION_ALREADY_EXISTS`.
- **RN-CONN-012.** Portas sugeridas no formulário: PostgreSQL 5432, Db2 50000, Informix 9089.
- **RN-CONN-013.** "Testar conexão" abre, executa a consulta de verificação do banco e fecha,
  sem gravar nada. Ao testar uma conexão já gravada sem redigitar a senha, o pedido leva o `id`
  e a API usa a senha do cofre, com a mesma condição da RN-CONN-004: se o host ou a porta do
  pedido diferem dos gravados, 422 `CONNECTION_INVALID`. Consultas: PostgreSQL `SELECT 1`; Db2 `SELECT 1 FROM SYSIBM.SYSDUMMY1`;
  Informix `SELECT 1 FROM systables WHERE tabid = 1`. Quando o formulário tem uma consulta de
  verificação própria (RN-VERIF-001), o teste executa a dela no lugar da do banco, com as mesmas
  regras da verificação periódica, e a recusa da consulta é 422 `CONNECTION_INVALID` no campo dela,
  antes de conectar. *Alterada a pedido do dono em 2026-10-15 (seção 32): antes valia só a consulta
  do banco.*
- **RN-CONN-014.** Excluir uma conexão encerra as sessões abertas dela. Antes de encerrar
  sessões com transação aberta, vale a RN-TX-006.
- **RN-CONN-015.** O ambiente aparece como etiqueta colorida ao lado do nome da conexão, na
  lista, na árvore, na aba e na barra de status.

### 5.3 Sessões com o banco

Uma **sessão** é uma conexão aberta com um banco, mantida pela API até ser fechada.

- **RN-SESSAO-001.** Cada conexão expandida na árvore usa uma sessão (a da árvore). Cada aba de
  SQL usa a sua, aberta na primeira execução. Assim uma consulta demorada não trava a árvore
  nem as outras abas.
- **RN-SESSAO-002.** Uma sessão executa um comando por vez. Segundo comando do usuário
  (executar, carregar mais, Commit, Rollback, a troca de modo ou de nível e o "Salvar" das
  edições) enquanto o primeiro roda: 409 `SESSION_BUSY`. No Commit manual a contagem também
  ocupa a sessão (RN-TX-012). As consultas de catálogo da árvore não recusam: esperam a vez na
  sessão, porque a árvore pede vários níveis ao mesmo tempo.
- **RN-SESSAO-003.** Falha ao abrir (host fora do ar, usuário ou senha do banco errados, banco
  inexistente): 422 `DATABASE_CONNECTION_FAILED`, com a mensagem original do banco no detalhe.
- **RN-SESSAO-004.** Sessões fecham ao fechar a aba, ao desconectar a conexão, ao fechar o
  cofre e ao encerrar a API; quando há transação aberta, depois da pergunta da RN-TX-006, nas
  saídas que ela lista.
- **RN-SESSAO-005.** A sessão começa no modo da aba (RN-TX-001). Em Auto-commit, todo comando
  que grava está confirmado no banco quando a resposta chega, e nada que aconteça depois com o
  cursor, a aba ou o app o desfaz. Em Auto-commit a barra de status diz "Auto-commit" e o nível (RN-TX-003). Quando um comando deixa
  uma transação
  aberta e o Prism a desfaz (a rede de segurança depois do comando, ou o cancelamento enquanto
  ele devolvia as linhas), a resposta é 422 `TRANSACTION_CONTROL_NOT_SUPPORTED` com a extensão
  `executed: true`, o cursor está fechado e a tela mostra o erro no lugar do resultado anterior;
  sem a extensão, o comando foi recusado antes de executar e o resultado anterior continua
  (Ruling 135). No Commit manual a rede de segurança não roda, e a extensão `executed` não
  aparece (RN-TX-015).

### 5.4 Árvore de objetos

- **RN-ARVORE-001.** Níveis: pasta › conexão › bancos do servidor (RN-ARVORE-006) › esquemas › Tabelas, Visões e
  Rotinas (procedimentos e funções) › tabela › Colunas, Índices e Chaves estrangeiras.
- **RN-ARVORE-002.** Cada nível é buscado só quando o usuário expande, e fica em memória até ele
  pedir "Atualizar" naquele nó.
- **RN-ARVORE-003.** Coluna mostra nome, tipo, se aceita nulo e se faz parte da chave primária.
  Índice mostra nome, colunas e se é único. Chave estrangeira mostra nome, colunas e a tabela e
  as colunas referenciadas.
- **RN-ARVORE-004.** Esquemas de sistema vêm depois dos demais. No Informix, "esquema" é o dono
  do objeto.
- **RN-ARVORE-005.** Falha ao abrir a conexão aparece no próprio nó, com a mensagem do banco e
  "Tentar de novo".
- **RN-ARVORE-006.** Bancos do servidor (pedido do dono em 2026-10-13, como o DBeaver): ao expandir a
  conexão, a árvore lista os bancos do servidor a que a conta pode se conectar, em ordem de nome, com
  o banco da conexão primeiro e marcado como o padrão. No PostgreSQL são os de `pg_database` que
  aceitam conexão, sem os de modelo e só os em que a conta tem `CONNECT`; no Informix, os de
  `sysmaster:sysdatabases`; no Db2, que conecta num banco só por vez e não tem SQL que liste os outros
  bancos da instância, só o banco da conexão. Expandir um banco abre a sessão dele, com as mesmas
  credenciais e o nome desse banco no lugar do da conexão; o editor, os Registros e o diagrama
  abertos a partir de um banco usam a sessão dele. Desconectar a conexão fecha as sessões de todos os
  bancos dela. A lista fica em memória até "Atualizar" no nó da conexão (RN-ARVORE-002). O menu do
  banco tem "Nova consulta", que abre o editor na sessão dele.

### 5.5 Editor e resultado

- **RN-SQL-001.** Executar (botão ou Ctrl+Enter) envia o texto selecionado; sem seleção, envia o
  comando onde está o cursor, que acaba no `;` e também na linha em branco, nas condições da
  RN-SQL-018 (pedido do dono em 2026-10-15, issue #7). Uma execução leva um comando só: se a seleção tiver mais de um
  (pela RN-SQL-002), a tela avisa e não envia. Executar vários em sequência é o "Executar script" (Alt+X, RN-SQL-019 a
  022), que entrou pela seção 31 (pedido do dono em 2026-10-15; antes ficava para a entrega 2), e o aviso da seleção com
  mais de um comando o aponta, com o atalho.
  Um bloco com `;` no corpo (procedimento, função, gatilho, bloco composto) conta como um
  comando só. No Db2 e no Informix a API repete a conferência e responde 422
  `MULTIPLE_STATEMENTS_NOT_SUPPORTED`, porque o driver da IBM executaria os comandos um a um
  sem parar no erro.
- **RN-SQL-002.** Comandos são separados por `;` fora de texto entre aspas simples, de
  identificador entre aspas duplas, de comentário (`--` e `/* */`) e de `$tag$ ... $tag$` do
  PostgreSQL. Bloco que tem `;` no corpo (procedimento em Db2 ou Informix) é executado
  selecionando o bloco inteiro. Sem seleção, a linha em branco também separa o comando do cursor,
  pela RN-SQL-018 (mudou em 2026-10-15, pedido do dono, issue #7: antes só o `;` separava); a
  seleção continua contada só pelo `;`.
- **RN-SQL-003.** Qualquer comando SQL é aceito e enviado como está ao banco, sem ser dividido
  nem reescrito. Se o banco não aceita mais de um comando por envio, a recusa é a dele. A
  exceção são os comandos de controle de transação (`BEGIN`, `START TRANSACTION`, `COMMIT`,
  `END`, `ROLLBACK`, `ABORT`, `SAVEPOINT`, `RELEASE`, `PREPARE TRANSACTION`), que seguem a
  RN-TX-004: em Auto-commit são recusados com 422 `TRANSACTION_CONTROL_NOT_SUPPORTED`, porque a
  sessão é auto-commit (RN-SESSAO-005); no Commit manual são tratados na forma de cada banco, e
  no PostgreSQL o comando que o banco não aceita dentro de transação é recusado sem ir ao banco
  (422 `COMMAND_NOT_ALLOWED_IN_TRANSACTION`). No Commit manual do PostgreSQL a leitura é
  paginada por um cursor do servidor: o comando vai dentro de uma declaração de cursor, e o que
  o banco recusa ali é executado de novo como está, de modo que a mensagem e a posição do erro
  são as do comando digitado.
- **RN-SQL-004.** Comando de leitura que devolve linhas: a API lê as **200 primeiras** e mantém
  o cursor aberto. A tela mostra "Primeiras 200 linhas" e o tempo.
- **RN-SQL-013.** Comando que grava e devolve linhas (`UPDATE ... RETURNING`, por exemplo) é
  executado até o fim e, em Auto-commit, confirmado antes da resposta; no Commit manual ele é
  executado até o fim e fica pendente na transação. A tela recebe as 200 primeiras linhas e o
  total que o comando devolveu, sem cursor aberto e sem "Carregar mais". Manter cursor aberto
  sobre um comando que grava deixaria a gravação pendente, e fechá-lo a desfaria. No
  PostgreSQL, quem diz se o comando grava é o banco (a leitura é tentada numa transação só de
  leitura); um `WITH` que contém `INSERT`, `UPDATE`, `DELETE` ou `MERGE` vai direto por este
  caminho. No Commit manual do PostgreSQL vai por este caminho o que o banco não aceita como
  cursor (RN-TX-011). Exceção conhecida: efeitos que a transação só de leitura do PostgreSQL
  não recusa (`pg_notify`, `set_config`, travas consultivas) dentro de uma leitura com mais de 200 linhas
  são desfeitos quando o cursor fecha antes do fim. No Db2 e no Informix, onde não há transação
  só de leitura, quem decide é o texto do comando: vai por este caminho todo comando que não é
  uma leitura simples, e, no Db2, também o `SELECT` que usa função de tabela (`TABLE (...)`),
  porque ela pode gravar.
- **RN-SQL-005.** "Carregar mais 200" lê as próximas 200 do mesmo cursor, sem executar de novo.
- **RN-SQL-006.** "Contar total" executa `SELECT COUNT(*)` sobre o último comando da sessão que
  devolveu linhas, como subconsulta e em conexão separada; funciona com o cursor aberto ou já
  fechado. Sem comando desse tipo na sessão: 409 `NO_QUERY_TO_COUNT`. Se o banco recusar a
  subconsulta, a tela mostra o erro do banco. O total nunca é contado sem o usuário pedir. No
  Commit manual vale a RN-TX-012 (a contagem roda na sessão e a ocupa). Depois de contado, o total
  pode ser contado de novo (pedido do dono em 2026-10-15, issue #10; antes o botão sumia e o total
  ficava como estava até a próxima execução): "Contar de novo" é um botão de ícone, com dica, ao
  lado do total e no mesmo lugar do "Contar total", para o foco não sair da aba (o F5 continua
  valendo depois do clique). Enquanto outro comando roda sobre as linhas na tela, o resumo, o
  total e o botão ficam onde estão (o botão desabilitado), com "Executando…" ao lado; e quando o
  botão sai da barra (o resultado novo não tem o que contar), o foco vai para a grade, ou para a
  própria área de resultado, e também não sai da aba. Enquanto conta de novo, o total anterior
  fica à vista, marcado como em recontagem, até chegar o novo; se a contagem falhar ou for
  cancelada, ele fica como estava, e o erro aparece como na primeira contagem. Vale nos Registros
  e no resultado da aba de consulta.
- **RN-SQL-007.** O cursor fecha quando acaba, a cada nova execução na aba, ao fechar a aba e
  após 5 minutos sem leitura, para não segurar recurso no banco. Depois disso "Carregar mais"
  responde 409 `NO_OPEN_CURSOR` e a tela oferece executar de novo. No PostgreSQL, enquanto o
  cursor está aberto em Auto-commit, a sessão fica numa transação só de leitura no banco: a
  tabela lida mantém a trava de leitura até o cursor fechar, e um servidor com
  `idle_in_transaction_session_timeout` menor que 5 minutos pode derrubar a sessão antes; a
  sessão caída é descartada e a aba abre outra ao executar de novo; no Db2 e no Informix o
  cursor fica em auto-commit, sem transação. No Commit manual, o cursor vive dentro da
  transação da aba, e fechá-lo não a encerra (RN-TX-011).
- **RN-SQL-008.** Comando que não devolve linhas mostra "N linhas afetadas" e o tempo.
- **RN-SQL-009.** Erro do banco: 422 `SQL_EXECUTION_FAILED`, com a mensagem original (incluindo
  o detalhe e a dica, quando o banco manda), o SQLSTATE e a posição do erro quando o driver
  informa. O detalhe aparece na área de resultado, e um
  toast de erro avisa que o comando falhou (RN-AVISO-004 e 005).
- **RN-SQL-010.** "Cancelar" interrompe o comando em execução na sessão, inclusive uma contagem
  em andamento. Não afeta um cursor aberto e parado. Um comando que terminou antes de o
  cancelamento chegar é dado como concluído, não como cancelado. Quando o comando termina em
  422 `SQL_EXECUTION_FAILED` depois de um pedido de cancelamento, o corpo do erro diz o desfecho
  na extensão `outcome`: `canceled` quando a API tem prova de que o comando não terminou e nada
  dele ficou (o banco respondeu que cancelou, ou o comando nem chegou a ser enviado); `unknown`
  quando ela não sabe se o comando foi concluído (a sessão caiu sem resposta ao cancelamento);
  `partial` quando o cancelamento chegou enquanto o comando devolvia as linhas e o que ele
  gravou até ali está confirmado. Sem a extensão, é um erro comum do banco (RN-SQL-009). A tela
  diz "Comando cancelado." só com `canceled`; com `unknown` e `partial` mostra o detalhe como
  mostra um erro do banco, com um aviso curto de que o desfecho é incerto ou de que o que foi
  gravado ficou. A tela nunca decide pelo texto da mensagem (Ruling 135). No Commit manual vale
  a RN-TX-010: `partial` quer dizer que o que o comando gravou ficou na transação, sem commit;
  no PostgreSQL o cancelamento deixa a transação com erro.
- **RN-SQL-011.** Cada célula viaja como texto ou nulo, formatada pela API (números e datas sem
  perder precisão). Nulo aparece como `NULL` apagado. Texto acima de 10.000 caracteres e binário
  chegam cortados, e a célula indica o corte.
- **RN-SQL-012.** A grade é virtualizada: só as linhas visíveis existem na página.

### 5.6 Avisos (toasts)

Pedido do usuário em 2026-10-09: avisar por toast os acertos, os alertas e os erros que
acontecem durante o uso.

- **RN-AVISO-001.** O app tem um aviso flutuante (toast) em três tons: sucesso, atenção e
  erro. Todo acontecimento que o usuário precisa saber, e que não é o próprio conteúdo da tela,
  gera um.
- **RN-AVISO-002.** Sucesso, quando uma ação foi concluída: usuário criado; pasta ou conexão
  criada, alterada ou excluída; conexão testada; conexão desconectada; comando que não devolve
  linhas executado ("3 linhas afetadas"). No Commit manual vale a RN-TX-014.
- **RN-AVISO-003.** Atenção, quando algo aconteceu e o usuário pode seguir: cursor fechado por
  ociosidade; valores cortados no resultado; sessão com o banco que caiu e foi reaberta (no Commit
  manual a sessão não é reaberta em silêncio: vale a RN-TX-008); cofre fechado depois de cinco
  erros de senha, ou fechado por qualquer outro motivo que leve ao login.
- **RN-AVISO-004.** Erro, quando a ação não foi feita: falha de conexão com o banco, erro de
  SQL, recusa de regra (pasta não vazia, nome duplicado, ciclo), falha ao gravar o cofre, API
  fora do ar, falha de rede. Toda chamada à API que falha gera toast de erro, menos o erro de
  campo de formulário, que aparece no campo.
- **RN-AVISO-005.** O toast avisa do acontecimento; o detalhe que precisa ficar na tela até ser
  resolvido (erro de SQL com SQLSTATE, erro no nó da árvore, erro de campo) continua na tela.
- **RN-AVISO-006.** Sucesso some em 4 segundos; atenção e erro, em 8. Todos têm botão de
  fechar. No máximo 4 ficam visíveis, e um aviso igual ao último visível não empilha. O de erro
  é anunciado a leitor de tela como alerta.

### 5.7 Marca e inicialização

Pedido do usuário em 2026-10-09. Referência visual: pranchas "Ícone do aplicativo" e "Splash
de inicialização" do canvas (`docs/design/canvas/IconeApp.dc.html` e `Splash.dc.html`).

- **RN-MARCA-001.** A marca do Prism é a ilustração inteira da tela de login: o feixe branco,
  o prisma de vidro com as facetas, as três faixas de cor com brilho e os três bancos. O
  usuário recusou, duas vezes, versões simplificadas ou chapadas: nenhuma tela, ícone ou
  janela usa um desenho reduzido no lugar dela. O ícone do aplicativo é essa ilustração
  recomposta para o quadrado, sobre fundo escuro, e é o mesmo no executável, no atalho, na
  barra de tarefas, na barra de título da janela e na janela do splash; até 32 px o traço
  engrossa, com os mesmos elementos. Na barra superior das telas e ao lado do nome no login,
  a marca é a mesma ilustração em formato largo. O ícone padrão do Electron não aparece em
  lugar nenhum.
- **RN-MARCA-002.** Ao abrir, o app mostra de imediato uma janela de splash de 640×400 em 100%,
  sem moldura e centralizada, com a ilustração do prisma, o nome, a versão, o passo atual e uma
  barra de progresso. Ela cresce com o zoom do programa (RN-ZOOM-001), até caber na área útil da
  tela: a 200%, num monitor de 1366×768, fica perto de 180%, o maior tamanho que cabe.

  Alterada em 2026-10-15 (pedido do dono, issue #14, seção 30): o tamanho acompanha o zoom do
  programa. Antes dizia só "640×400".
- **RN-MARCA-003.** Passos do splash: "Iniciando o serviço local…" (1 de 2), até a API
  anunciar a porta; "Carregando a interface…" (2 de 2), até a janela principal estar pronta
  para aparecer. Então a janela principal aparece e o splash fecha. Não há espera artificial:
  o splash dura o que a inicialização durar.
- **RN-MARCA-004.** Se a API não subir, o splash fecha e a janela principal abre com o aviso
  de erro e "Reiniciar" (seção 7).
- **RN-MARCA-005.** O splash é uma página estática do próprio app: não carrega nada de fora,
  não executa script e não recebe o token.

## 6. Rotas e códigos de erro

Todas exigem o token de lançamento. Erros no formato `ApiErrorDto` (`application/problem+json`).

| Rota | Sucesso | Recusas |
| --- | --- | --- |
| `POST api/public/users` | 201 `{ unlocked, userName }` (cria e já entra) | 409 `USER_ALREADY_EXISTS`; 422 `USERNAME_INVALID`, `PASSWORD_INVALID` |
| `GET api/public/sessions` | 200 `{ unlocked, userName }` | |
| `POST api/public/sessions` | 200 `{ unlocked, userName }` | 401 `INVALID_CREDENTIALS`; 409 `VAULT_FORMAT_UNSUPPORTED` (RN-VERSAO-005) |
| `DELETE api/public/sessions` | 204 | |
| `GET api/user/folders` | 200 lista (cada pasta com as proteções próprias e as que valem, `protections`: seção 32) | |
| `POST api/user/folders` | 201 | 404 `FOLDER_NOT_FOUND` (pai); 409 `FOLDER_ALREADY_EXISTS`; 422 `FOLDER_NAME_INVALID` |
| `PATCH api/user/folders` | 200 | 404 `FOLDER_NOT_FOUND`; 409 `FOLDER_ALREADY_EXISTS`, `FOLDER_CYCLE`; 422 `FOLDER_NAME_INVALID`, `USER_PASSWORD_REQUIRED` e `INVALID_PASSWORD` (a senha do somente leitura, RN-PROT-003); 401 `VAULT_LOCKED` no quinto erro |
| `DELETE api/user/folders/{id}` | 204 | 404 `FOLDER_NOT_FOUND`; 409 `FOLDER_NOT_EMPTY` |
| `GET api/user/script-folders` | 200 lista de `{ id, parentID, name, createdAt, updatedAt }`, as pastas de scripts de todos os níveis (RN-SCRIPT-007, seção 33; as rotas dos scripts estão na seção 23) | |
| `POST api/user/script-folders` `{ name, parentID? }` | 201 a pasta | 404 `SCRIPT_FOLDER_NOT_FOUND` (a pasta pai); 409 `SCRIPT_FOLDER_ALREADY_EXISTS`; 422 `SCRIPT_FOLDER_NAME_INVALID` |
| `PATCH api/user/script-folders` `{ id, name, parentID? }` (a pasta inteira: sem `parentID`, ela vai para a raiz) | 200 a pasta | 404 `SCRIPT_FOLDER_NOT_FOUND` (a pasta ou a pasta pai); 409 `SCRIPT_FOLDER_ALREADY_EXISTS`, `SCRIPT_FOLDER_CYCLE`; 422 `SCRIPT_FOLDER_NAME_INVALID` |
| `DELETE api/user/script-folders/{id}` | 204 | 404 `SCRIPT_FOLDER_NOT_FOUND`; 409 `SCRIPT_FOLDER_NOT_EMPTY` (com `folders` e `scripts`) |
| `GET api/user/connections` | 200 lista (cada conexão com as proteções próprias e as que valem, `protections`, e a verificação: seção 32) | |
| `GET api/user/connections/{id}` | 200 | 404 `CONNECTION_NOT_FOUND` |
| `POST api/user/connections` | 201 | 404 `FOLDER_NOT_FOUND`; 409 `CONNECTION_ALREADY_EXISTS`; 422 `CONNECTION_INVALID` |
| `PATCH api/user/connections` | 200 | as mesmas, mais 404 `CONNECTION_NOT_FOUND`, 422 `USER_PASSWORD_REQUIRED` e `INVALID_PASSWORD` (a senha do somente leitura, RN-PROT-003) e 401 `VAULT_LOCKED` no quinto erro |
| `DELETE api/user/connections/{id}` | 204 | 404 `CONNECTION_NOT_FOUND` |
| `POST api/user/connections/test` | 204 | 404 `CONNECTION_NOT_FOUND` (com `id` e sem senha, quando a conexão não existe); 422 `CONNECTION_INVALID`, `DATABASE_CONNECTION_FAILED`, `DRIVER_NOT_INSTALLED` |
| `POST api/user/connections/{id}/password/reveal` | 200 `{ password }` | 404 `CONNECTION_NOT_FOUND`; 422 `INVALID_PASSWORD`; 401 `VAULT_LOCKED` no quinto erro |
| `POST api/user/connections/{id}/verification` | 200 `{ status, checkedAt, elapsedMs, message, sqlState }` (a verificação periódica, RN-VERIF-002; a falha do banco é `status: failed`, e não um erro) | 404 `CONNECTION_NOT_FOUND` |
| `PUT api/user/password` `{ currentPassword, newPassword }` | 204 (troca a senha e recifra o cofre, RN-COFRE-013) | 422 `INVALID_PASSWORD` (a atual não confere), `PASSWORD_INVALID` (a nova), `PASSWORD_UNCHANGED`; 401 `VAULT_LOCKED` no quinto erro |
| `POST api/user/database-sessions` `{ connectionID, database?, transactionMode?, isolationLevel? }` (`database`: outro banco do mesmo servidor, RN-ARVORE-006) | 201 `{ id, connectionID, engine, database, serverVersion, transaction, transactionsAvailable }` | 404 `CONNECTION_NOT_FOUND`; 422 `DATABASE_NAME_INVALID` (vazio, mais de 128 caracteres ou com caractere de controle), `DATABASE_CONNECTION_FAILED`, `DRIVER_NOT_INSTALLED`, `TRANSACTION_MODE_INVALID`, `ISOLATION_LEVEL_INVALID`, `TRANSACTIONS_NOT_AVAILABLE` (RN-TX-013) |
| `PATCH api/user/database-sessions` `{ id, transactionMode?, isolationLevel? }` | 200 a sessão, com `transaction` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `TRANSACTION_OPEN`; 422 `TRANSACTION_MODE_INVALID`, `ISOLATION_LEVEL_INVALID`, `TRANSACTIONS_NOT_AVAILABLE` |
| `GET api/user/database-sessions/{id}/databases` | 200 lista de `{ name, isCurrent }` (RN-ARVORE-006; espera a vez na sessão, como as consultas de catálogo) | 404 `DATABASE_SESSION_NOT_FOUND`; 422 `SQL_EXECUTION_FAILED` |
| `DELETE api/user/database-sessions/{id}` | 204 | 404 `DATABASE_SESSION_NOT_FOUND` |
| `GET api/user/database-sessions/{id}/schemas` | 200 lista | 404 `DATABASE_SESSION_NOT_FOUND`; 422 `SQL_EXECUTION_FAILED` |
| `GET .../schemas/{schema}/objects?kind=` | 200 lista (`tables`, `views`, `routines`) | as mesmas, mais 422 `OBJECT_KIND_INVALID` |
| `GET .../schemas/{schema}/tables/{table}/columns` | 200 lista | as mesmas |
| `GET .../schemas/{schema}/tables/{table}/indexes` | 200 lista | as mesmas |
| `GET .../schemas/{schema}/tables/{table}/foreign-keys` | 200 lista | as mesmas |
| `GET .../schemas/{schema}/tables/{table}/referenced-by` | 200 lista (RN-CAT-004) | as mesmas |
| `GET .../schemas/{schema}/tables/{table}/checks` | 200 lista (RN-CAT-005) | as mesmas |
| `GET .../schemas/{schema}/views/{view}/definition` | 200 `{ definition }` (RN-CAT-006) | as mesmas |
| `GET .../schemas/{schema}/diagram` | 200 `{ tables, foreignKeys }` (RN-CAT-008) | as mesmas |
| `GET api/user/database-sessions/{id}/properties` | 200 lista de `{ name, value }` (RN-CAT-010) | as mesmas |
| `POST api/user/database-sessions/{id}/queries` `{ sql, pageSize?, filter?, keep? }` (`filter`: RN-GRADE-011; a página leva `filterApplied`; `keep`: os resultados que continuam guardados para a edição, RN-SQL-024) | 200 página ou linhas afetadas | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `TRANSACTION_FAILED`; 422 `QUERY_INVALID` (SQL vazio; `keep` com mais de 20 resultados ou com uma entrada que não é um identificador), `SQL_EXECUTION_FAILED`, `TRANSACTION_CONTROL_NOT_SUPPORTED`, `COMMAND_NOT_ALLOWED_IN_TRANSACTION`, `MULTIPLE_STATEMENTS_NOT_SUPPORTED` (também com filtro e mais de um comando), `FILTER_INVALID` (RN-GRADE-011: `;`, aspas, comentário ou parênteses sem par, mais de uma ordem), `CONNECTION_READ_ONLY` (RN-PROT-002: o comando não é uma leitura) |
| `POST .../queries/next` | 200 página | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_OPEN_CURSOR`, `TRANSACTION_FAILED`; 422 `SQL_EXECUTION_FAILED` |
| `POST .../queries/count` | 200 `{ total }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_QUERY_TO_COUNT`, `TRANSACTION_FAILED`; 422 `SQL_EXECUTION_FAILED` |
| `POST .../queries/cancel` | 204 | 404 `DATABASE_SESSION_NOT_FOUND` |
| `POST api/user/database-sessions/{id}/transaction/commit` | 200 `{ transaction, commands }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_OPEN_TRANSACTION`, `TRANSACTION_FAILED`; 422 `SQL_EXECUTION_FAILED` (com `transactionUndone` quando o banco desfez) |
| `POST api/user/database-sessions/{id}/transaction/rollback` | 200 `{ transaction, commands }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_OPEN_TRANSACTION`; 422 `SQL_EXECUTION_FAILED` (com `transactionUndone`: a conexão caiu, e a transação já estava perdida) |
| `POST .../queries/edit-target` `{ resultID, catalogSessionID? }` (`resultID`: o do resultado atual ou o de um guardado, RN-SQL-024) | 200 `{ tables, columns, rowOperations, oneAtATime }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `RESULT_CHANGED`; 422 `RESULT_NOT_EDITABLE` (com `reason`), `SQL_EXECUTION_FAILED`, `CONNECTION_READ_ONLY` (RN-PROT-002) |
| `POST .../queries/edits` `{ resultID, changes }` (`resultID`: como no `edit-target`) | 200 `{ applied, transaction }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `RESULT_CHANGED`, `TRANSACTION_FAILED`; 422 `RESULT_NOT_EDITABLE`, `EDIT_INVALID` (com `change` e `column`), `EDIT_ROW_MISMATCH` (com `change` e `rowsAffected`), `SQL_EXECUTION_FAILED` (com `change`), `CONNECTION_READ_ONLY` (RN-PROT-002) |
| `POST .../queries/edits/preview` `{ resultID, changes }` (`resultID`: como no `edit-target`) | 200 `{ statements: [{ sql, values }], oneAtATime }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `RESULT_CHANGED`; 422 `RESULT_NOT_EDITABLE`, `EDIT_INVALID`, `CONNECTION_READ_ONLY` (RN-PROT-002) |

Página de resultado: `{ columns: [{ name, type, kind }], rows: string|null [][], hasMore,
elapsedMs, truncatedCells: [linha, coluna][], totalRows }`, com `kind` em `text`, `number`,
`datetime`, `boolean` ou `binary` (serve para alinhar a coluna). `totalRows` só vem preenchido
no caso da RN-SQL-013 (o comando foi executado até o fim e esse é o total de linhas que ele
devolveu); nos demais é nulo. Comando sem linhas: `{ rowsAffected, elapsedMs }`. O resultado
(página ou linhas afetadas) leva também `transaction`, o estado da transação depois do comando
(`{ mode, isolationLevel, open, failed, commands, openedAt }`), e `transactionUndone`; a página
leva `resultID` (muda a cada execução da sessão) e `editable`. Os campos das rotas de transação
e de edição estão nas notas da seção 22.

Extensões do corpo de erro das sessões: `SQL_EXECUTION_FAILED` leva `sqlState` e `position`
quando o driver os informa, e `outcome` (`canceled`, `unknown` ou `partial`) quando o comando
terminou depois de um pedido de cancelamento (RN-SQL-010); `TRANSACTION_CONTROL_NOT_SUPPORTED`
leva `executed: true` quando o comando rodou e o Prism desfez a transação que ele deixou aberta
(RN-SESSAO-005). Com a seção 22: as recusas 422 de comando levam também `transaction`, o estado
da transação depois do comando, ao lado de `outcome` e `executed`; `SQL_EXECUTION_FAILED` do
Commit e do Rollback leva `transactionUndone` quando a transação foi desfeita (RN-TX-014 e
RN-TX-008); e, no Informix sem log, as recusas de `queries/edits` levam `applied`, as alterações
já gravadas antes da que falhou (RN-EDIT-012). Com a seção 32: `CONNECTION_READ_ONLY` é a recusa,
antes de ir ao banco, do que não é leitura numa conexão somente leitura, e não leva `executed` (o
resultado anterior continua); os campos novos das pastas e das conexões estão nas notas dela. Com a
seção 33: `POST .../queries` aceita `keep`, e as três rotas da edição aceitam o `resultID` de um
resultado que o script mantém na tela (RN-SQL-024); `RESULT_CHANGED` passa a dizer que o resultado não
está mais guardado na sessão e, no Db2 e no Informix, é também a recusa da tabela sem esquema depois de
um `SET`, `CALL` ou `EXECUTE` (no Informix, também `DATABASE`); e `SCRIPT_FOLDER_NOT_EMPTY` leva
`folders` e `scripts`, quantas subpastas e quantos scripts a pasta tem.

Falha de disco ao ler ou gravar o cofre responde 503 `VAULT_UNAVAILABLE`, em qualquer rota que
toque o cofre. Qualquer exceção não prevista responde 500 `INTERNAL_SERVER_ERROR` sem detalhe,
e vai inteira para o log.

## 7. Falhas que a tela trata

| Situação | O que a tela faz |
| --- | --- |
| API ainda iniciando | Tela de abertura até chegar `PRISM_API_READY` |
| API caiu | Aviso que ocupa a janela, com "Reiniciar"; ao voltar, pede login de novo |
| 401 `VAULT_LOCKED` | Volta para o login |
| Cofre ilegível ou adulterado | Mesmo erro de credencial inválida; o `.bak` continua no disco |
| Banco fora do ar ou credencial do banco errada | Mensagem do banco no nó da árvore ou na área de resultado |
| Sessão caiu no meio (rede) | Erro do banco na área de resultado; a próxima execução abre sessão nova. No Commit manual, vale a RN-TX-008: a aba diz o que se perdeu, e não repete o comando sozinha |
| Falha ao gravar o cofre (disco) | Toast de erro; o que estava gravado antes continua valendo |

## 8. Decisões que saem do padrão zanveri

Entram no `AGENTS.md` do projeto, para que ninguém as "corrija" depois.

1. **Sem Keycloak, JWT, papéis e políticas.** A senha precisa gerar a chave do cofre, e isso um
   provedor de identidade não entrega. Quem autentica a chamada é o token de lançamento; quem
   libera os dados é o cofre aberto. A família `api/admin` não existe.
2. **Sem banco do produto nesta fatia.** Os dados do Prism são o cofre. Não há
   `IDatabaseFactory`, migrations nem transação de handler; os repositories gravam pelo serviço
   do cofre. Se um banco local entrar depois, é SQLite, na regra da seção 1.
3. **Sessões com os bancos são de vida longa.** O registro de sessões é `Singleton`, porque uma
   conexão aberta atravessa várias requisições. Repositories, queries e services continuam
   `Transient`.
4. **A mensagem de erro do banco chega à tela como veio.** Num cliente de banco ela é o produto.
   A regra "corpo de erro de terceiro não atravessa a integração" não se aplica aos drivers. As
   demais regras de integração valem: um único `try` no `Send` do client, `Result` para fora.
5. **Sem Next.js.** Não há Server Components, Server Actions, BFF, `proxy.ts` nem cookie de
   sessão: no Electron a fronteira de confiança é o preload, não um servidor web.
6. **Interface em `src/client`**, não `src/web`. É a pasta que o usuário criou.
7. **Sem rate limiting, Turnstile, cabeçalhos de proxy e HTTPS.** A API só existe em loopback e
   só para o próprio app.

## 9. Diferenças em relação ao canvas

- O formulário de conexão tem os painéis "Proteções" e "Sessão da conexão" do canvas desde
  2026-10-15 (pedido do dono, seção 32; antes ficavam para a entrega 3), com três diferenças: a
  caixa "Confirmar antes de comandos irreversíveis" vira a escolha "Confirmar antes de executar",
  com "Não", "Só comandos irreversíveis" e "Todos os comandos" (RN-PROT-001); a consulta de
  verificação, que o canvas mostra fixa, vira um campo que a pessoa pode preencher, com a do banco
  como dica (RN-VERIF-001); e "Encerrar a conexão após N minutos sem uso" não aparece, porque o
  encerramento por ociosidade continua fora (seção 13). O diálogo da pasta (`PastaAmbiente`) tem as
  mesmas duas proteções, com a mesma escolha de três no lugar da caixa, e o aviso de confirmação
  (`ConfirmarComando`) ganha "Executar comando?" para "Todos os comandos" e a lista dos comandos no
  script (RN-PROT-001). A barra do navegador ganha "Só as conectadas" (RN-NAV-013), que o canvas
  não tem.
- O campo "Servidor Informix" sai, porque o driver escolhido não usa `INFORMIXSERVER`. Volta se
  a sonda da seção 10 mostrar que é necessário.
- A porta sugerida do Informix é 9089, não 9088.
- A barra do editor não tem Explicar plano nem Formatar, que entram na entrega 2.
- O botão "Conexão e esquema desta aba" da barra do editor é o botão da conexão da aba
  (RN-ARVORE-008), com a sigla do banco, o nome da conexão e o ambiente. O banco fica na lista ao
  lado dele (RN-ARVORE-007), e o esquema não aparece: o canvas escreve os três num botão só.
- O diálogo da pasta do canvas (`PastaAmbiente`) não tem a cor da pasta, e o ícone da pasta na
  árvore do canvas é sempre neutro: no "Editar pasta…" a "Cor da pasta" vem antes da seção
  Ambiente, e pinta o ícone da pasta (RN-PASTA-007). O canvas também não desenha a seção "Scripts",
  nem o ícone e a cor de cada script (RN-SCRIPT-006), nem as pastas de scripts, com a árvore, os menus
  e os diálogos delas (RN-SCRIPT-007 a 010, seção 33).
- A aba de tabela e a aba de diagrama entraram pela seção 18 (o DDL e o salto por chave
  estrangeira ainda não).
- A Estrutura da tabela não empilha cartões como o canvas (`TabelaDetalhe`): mostra uma seção
  por vez, escolhida numa lista lateral, a pedido do dono (RN-TABELA-009).
- O seletor de nível de isolamento da aba usa os nomes de cada banco, e não os nomes ANSI do
  canvas; Configurações mantém os do canvas (RN-ISOL-002 e 006).
- O "Cancelar" de `TabelaDados` é "Descartar", porque "Cancelar" já é interromper um comando
  (RN-SQL-010).
- No Commit manual a edição tem dois passos ("Salvar" e Commit), e não o passo único do canvas
  ("Transação aberta pela edição"), por decisão do dono (RN-EDIT-004).
- A barra dos Registros ganha o seletor de nível de isolamento, que o canvas não tem
  (RN-ISOL-001).
- Configurações › Editor SQL ganha "A linha em branco separa os comandos", que o canvas não tem
  (RN-SQL-018).
- A barra da área de resultado ganha "Contar de novo" ao lado do total (RN-SQL-006) e a
  atualização automática (RN-GRADE-014), que o canvas não tem; nos Registros, a atualização
  automática fica no rodapé, ao lado de "Atualizar".
- Configurações › Aparência ganha o zoom do programa e a densidade do navegador, que o canvas não
  tem; na densidade "Compacta" a árvore tem linhas de 22 px, e não as de 30 px do canvas, que
  continuam sendo o padrão (RN-ZOOM-001 e RN-NAV-011, seção 30). Fora de 100% o splash tem o
  tamanho do zoom, e não os 640×400 do canvas (RN-MARCA-002).
- A barra do editor ganha "Executar script (Alt+X)" ao lado de "Executar", e a área de resultado,
  depois de um script, ganha uma aba por resultado e as Estatísticas no lugar do título
  "Resultado", no mesmo desenho das abas "Resultado", "Mensagens" e "Plano de execução" do canvas
  (RN-SQL-019 e 020, seção 31). O canvas não desenha o script.
- A grade ganha a barra de edição ("Editar célula", "Adicionar linha", "Duplicar linha" e "Excluir
  linha", RN-EDIT-013, seção 33), que o canvas não tem: nos Registros ela entra no rodapé de
  `TabelaDados`, depois de "Exportar CSV"; no resultado da aba de consulta e em cada aba de resultado
  do script, numa linha abaixo da grade. O lápis e as duas folhas não estão entre os ícones do canvas
  e seguem o traço deles (16 px, traço 1,5); o mais e o X são os do canvas. O conjunto de ícones do
  app já tem o lápis e as duas folhas (os do menu do navegador): só o X no tom de erro é novo.
  "Salvar", "Descartar" e "Ver SQL" continuam na faixa sobre a grade (RN-EDIT-004), e não nessa
  barra.

## 10. Riscos e sondas

1. **Informix pelo `Net.IBM.Data.Db2`.** Os outros projetos da casa já usam esse pacote e têm
   uma seção `Informix` nos `appsettings` com `Server` e `Database` no formato dele, o que
   indica um padrão conhecido. Esse caminho exige a porta DRDA do Informix (9089), e as
   consultas de catálogo do Prism ainda não foram exercitadas. Provar as duas coisas é a
   primeira tarefa do plano, contra o contêiner `ibmcom/informix-developer-database`, cuja
   imagem já está nesta máquina. O Db2 é exercitado do mesmo jeito, com a imagem
   `icr.io/db2_community/db2`. Se um dos contêineres não subir aqui, o driver correspondente é
   entregue escrito e não exercitado, e o relatório diz isso.
2. **Tamanho do pacote.** O `Net.IBM.Data.Db2` traz o cliente nativo da IBM e aumenta bastante
   o app empacotado. Aceito nesta fatia.
3. **Feed Zanveri.** Os pacotes estão no cache desta máquina; o primeiro `dotnet restore` mostra
   se o feed responde.

## 11. Testes

- **Unidade (xUnit):** cifra do cofre (ida e volta, senha errada, arquivo adulterado, gravação
  atômica), regras de pasta e conexão, validators, formatação das células.
- **Integração (NUnit, pela API em HTTP):** sem token (401); cofre fechado (401
  `VAULT_LOCKED`); usuários, login, pastas, conexões, revelar senha e o bloqueio no quinto erro;
  dois usuários que não enxergam o cofre um do outro.
- **Drivers:** os três bancos em contêineres Docker pelo Testcontainers (PostgreSQL, Informix
  e Db2), com o mesmo roteiro para cada um: catálogo, paginação, contagem, cancelamento e erro
  repassado.
- **Interface:** `lint`, `typecheck` e testes de função pura (separador de comandos, schemas).
- **Manual:** o roteiro de aceite abaixo, no app aberto.

## 12. Critérios de aceite

1. O app abre na tela de login. Sem cofre aberto, nenhuma rota `api/user` responde dados.
2. Criar usuário entra no app. O arquivo do cofre não contém, em texto legível, nome de
   conexão, host, usuário ou senha.
3. Com dois usuários, as conexões de um não aparecem para o outro, e o cofre de um não abre com
   a senha do outro.
4. Usuário inexistente e senha errada mostram a mesma mensagem.
5. Revelar a senha de uma conexão exige a senha do usuário; com a senha errada nada é revelado;
   no quinto erro seguido o app volta ao login.
6. Pastas: criar, criar subpasta, renomear, mover e excluir vazia funcionam; as recusas de
   RN-PASTA-002 a 004 aparecem com mensagem clara.
7. Conexões: criar, editar, excluir e testar funcionam para PostgreSQL, Db2 e Informix.
8. A árvore mostra esquemas, tabelas, visões, rotinas, colunas (com a chave primária marcada),
   índices e chaves estrangeiras nos três bancos.
9. Um `SELECT` grande mostra as 200 primeiras linhas e o tempo; "Carregar mais 200" traz as
   seguintes sem executar de novo; "Contar total" mostra o total só quando clicado.
10. `INSERT`, `UPDATE`, `DELETE` e DDL mostram as linhas afetadas. Um erro de SQL mostra a
    mensagem original do banco. "Cancelar" interrompe um comando demorado.
11. Uma chamada à API sem o token de lançamento responde 401.
12. Fechar o app encerra o processo da API e as conexões com os bancos.
13. O app empacotado (`electron-builder --dir`) abre e faz login.
14. `dotnet build` sem avisos; testes, `lint` e `typecheck` passando. O que não pôde ser
    exercitado é citado no relatório, nunca dado como passando.

## 13. Fora desta fatia

(Em 2026-10-11 entraram pela seção 18: a aba de registros e de estrutura da tabela, o diagrama
e a tela de configurações, nos limites ditos lá.)

(Em 2026-10-15 entrou pela seção 29 a atualização automática do resultado de um comando,
RN-GRADE-014. A "atualização automática" da lista abaixo, ao lado da assinatura de código, é a do
próprio app, que entrou pela seção 17.)

(Em 2026-10-15 entrou pela seção 31, pedido do dono, executar vários comandos em sequência: o
"Executar script" (Alt+X), RN-SQL-019 a 022.)

(Em 2026-10-15 entraram pela seção 32, pedido do dono: o somente leitura, a confirmação antes de
executar (que vale para o comando irreversível e, se a pessoa quiser, para todos), a verificação
periódica e as proteções herdadas da pasta. O ambiente por pasta já tinha entrado pela RN-PASTA-005.
Da lista abaixo, continua fora o encerramento por ociosidade.)

Aba de registros e de estrutura da tabela, salto por chave estrangeira, diagrama ER, somente
leitura, confirmação de comando irreversível, verificação periódica e encerramento por ociosidade, ambiente por pasta, configurações e temas,
troca de senha, explicar plano, formatar SQL, exportar CSV, salvar e abrir arquivos `.sql`
(o texto das abas se perde ao fechar o app), trocar de banco dentro da mesma conexão,
atualização automática, assinatura de código, roteiro de aceite completo em macOS e Linux
(a seção 14 cobre só a geração dos pacotes), mais de uma janela.

## 14. Código aberto

Pedido do dono em 2026-10-09: o Prism será publicado como projeto de código aberto, sem expor
a infraestrutura da Zanveri, com pacotes para todas as plataformas gerados na pipeline.

- **RN-ABERTO-001.** Licença GNU GPL versão 3 (`GPL-3.0-only`, decisão do dono em 2026-10-13, no lugar
  da Apache-2.0), com a permissão adicional da seção 7 para combinar o Prism com o driver da IBM:
  `LICENSE` e `NOTICE` na raiz e em todo pacote, com os
  textos de licença das fontes e do .NET que vão embutidos. Nenhum driver proprietário vai no
  pacote: o da IBM é baixado pelo usuário, que aceita a licença do fabricante (seção 16).
- **RN-ABERTO-002.** Quem clona o repositório compila e testa só com fontes públicas (nuget.org
  e o registro do npm). Não há registro privado no `nuget.config`. O mediador é do próprio
  Prism, em `Prism.Core`, com os mesmos nomes de interface que os handlers já usam.
- **RN-ABERTO-003.** Nenhum arquivo versionado e nenhuma mensagem de commit cita a
  infraestrutura interna da Zanveri: runner, host, IP, repositório ou projeto interno, caminho
  de máquina, nome de usuário de máquina, segredo. O endereço público do projeto
  (`github.com/Zanveri/prism`) não é infraestrutura interna e pode aparecer nos documentos; o
  código não o escreve: o que o pacote precisa dele (a página do projeto, a origem das
  atualizações) vem da pipeline, na hora de gerar (RN-ATUALIZA-001). Uma verificação na pipeline
  procura os formatos genéricos (caminho de perfil de usuário, URL de registro privado de
  pacotes, IP de rede privada); os termos próprios da empresa entram por um segredo do
  repositório, nunca pelo repositório.
- **RN-ABERTO-004.** Documentos da raiz, em português, com um resumo em inglês no README:
  `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (vulnerabilidade é
  relatada em privado, pelo relato privado de vulnerabilidade do GitHub, nunca por issue),
  `CHANGELOG.md`, e os modelos de issue e de pull request em `.github/`.
- **RN-ABERTO-005.** A pipeline são workflows do GitHub Actions, autônomos: nenhum workflow
  reutilizável nem action de repositório interno, só os runners hospedados pelo GitHub, nenhum
  segredo obrigatório. Toda action é mantida pelo próprio GitHub (`actions/*` e `github/*`) e é
  fixada pelo SHA do commit; o token dos workflows começa sem permissão e cada job pede só o que usa. A pipeline
  roda SÓ quando um merge entra em `develop` ou em `main` (decisão do dono em 2026-10-12): pull
  request, tag e qualquer outro ramo não disparam nada, e nenhum workflow usa
  `pull_request_target` nem `workflow_run`. Etapas: verificação (lint, typecheck e testes da
  interface; build sem avisos e testes de unidade da API; os testes dos roteiros), integração
  (PostgreSQL, Informix e Db2 em contêiner), segurança (a verificação da RN-ABERTO-003, segredos
  e auditoria de dependências) e pacote por plataforma; depois, o lançamento (RN-VERSAO-008). A
  organização dos arquivos está na seção 21.
- **RN-ABERTO-006.** A pipeline gera pacote para todas as plataformas de desktop, cada um com a
  API publicada para a mesma plataforma:
  - Windows x64: instalador e versão portátil (zip).
  - Linux x64: AppImage (roda na maioria das distribuições sem instalar), `.deb`
    (Debian, Ubuntu e derivadas), `.rpm` (Fedora, RHEL, openSUSE e derivadas) e `tar.gz`.
  - macOS: `dmg` e `zip`, para Apple Silicon (arm64) e Intel (x64), as duas arquiteturas
    geradas no runner hospedado de macOS (Apple Silicon), porque o `dmg` só se gera no macOS.
  Nenhum pacote é assinado nesta fatia, e o README diz o que isso implica em cada sistema. Onde
  o driver da IBM não existir para a plataforma, o pacote sai sem Db2 e Informix naquela
  plataforma, e o README e a tela dizem isso; PostgreSQL funciona em todas.
- **RN-ABERTO-007.** Runner próprio: nenhum. O projeto usa só os runners hospedados pelo GitHub,
  e nenhum runner próprio é ligado ao repositório. A proteção que cabe à configuração do
  repositório fica numa lista de conferência em `docs/ci.md`: o token padrão dos workflows só de
  leitura; só actions do GitHub permitidas; regras de ramo em `develop` e `main` (ninguém envia
  direto; pull request obrigatório; sem envio forçado nem exclusão); regra de tag em `v*` (só o
  lançamento cria); releases imutáveis ligadas; relato privado de vulnerabilidade e varredura de
  segredos ligados. Os arquivos da pipeline fazem a parte deles: só o job de lançamento pode
  escrever (cria a release e, com ela, a tag), nenhum job imprime variáveis nem segredos, e o
  segredo com os termos da empresa só chega ao job que o usa.
- **RN-ABERTO-008.** Pasta de dados: `%APPDATA%\Zanveri\Prism` no Windows e a mesma subpasta
  `Zanveri/Prism` na pasta de dados de aplicativo do Linux e do macOS. Em desenvolvimento,
  `Zanveri/Prism-dev`, para o app de desenvolvimento nunca abrir os cofres de verdade.
- **RN-ABERTO-009.** Antes da publicação o histórico é reescrito para tirar de todos os commits
  o que a RN-ABERTO-003 proíbe. É a última etapa, destrutiva, e só é executada com a
  confirmação do dono no momento.

Os pacotes de Linux e de macOS são gerados e, no caso do Linux, abertos sem janela para conferir
que o app sobe e fala com a API; o roteiro de aceite da seção 12 continua sendo feito no
Windows.

## 15. Versionamento e lançamentos

Pedido do dono em 2026-10-09: seguir o que projetos de código aberto parecidos fazem para
versionar, lançar, manter changelog e notas de release. A pesquisa que sustenta esta seção,
com as fontes, está em os registros internos do projeto.

- **RN-VERSAO-001.** A versão do Prism segue o SemVer 2.0.0. A primeira versão é `0.1.0`. A tag
  de uma versão é `vX.Y.Z`; pré-lançamento é `vX.Y.Z-beta.N` (o formato `-rc.N` é aceito, mas não
  é usado nesta entrega). Não há ramo por versão (RN-VERSAO-008).
- **RN-VERSAO-002.** O contrato que o número protege, já que um aplicativo não tem API pública:
  o formato do cofre e a estrutura da pasta de dados, os arquivos de configuração e de
  exportação quando existirem, e os atalhos e comandos documentados. A API HTTP local e a
  aparência ficam fora. Enquanto a versão for `0.x`, uma mudança que quebra esse contrato sobe
  o segundo número; a partir da `1.0.0`, sobe o primeiro. Funcionalidade nova sobe o segundo
  número e correção sobe o terceiro, antes e depois da `1.0.0`. A `1.0.0` sai quando o contrato
  estiver estável e o Prism estiver em uso no dia a dia.
- **RN-VERSAO-003.** A versão mora em um lugar só: o campo `version` de
  `src/client/package.json`. A API recebe o mesmo número na publicação (`-p:Version=`), e
  nenhum `.csproj` declara versão. A tag de uma versão é sempre `v` + esse número, criada pelo lançamento (RN-VERSAO-008); a
  pipeline recusa versão fora do formato da RN-VERSAO-001. O campo só muda para subir a versão de
  propósito (a `0.2.0`, por exemplo): a versão que cada merge lança é calculada pela pipeline
  (RN-VERSAO-008), e um campo menor que a última estável é corrigido com um aviso à vista.
- **RN-VERSAO-004.** A tela de login e o splash mostram a versão do app, para que um relato de
  defeito diga de que versão é. A API escreve a própria versão no log ao iniciar.
- **RN-VERSAO-005.** O formato do cofre tem um número próprio no cabeçalho, independente da
  versão do app, que só muda quando o formato muda. Um cofre de formato mais novo que o
  conhecido não é aberto nem regravado: a resposta é 409 `VAULT_FORMAT_UNSUPPORTED`, com a
  instrução de atualizar o Prism. Um cofre de formato mais antigo é migrado ao abrir, e a
  versão anterior fica no `.bak`. É a única situação em que a entrada diz mais do que
  "credencial inválida": sem isso, quem voltasse a uma versão antiga do app concluiria que
  errou a senha.
- **RN-VERSAO-006.** As mensagens de commit seguem o Conventional Commits 1.0.0, com os tipos
  `feat`, `fix`, `perf`, `refactor`, `docs`, `build`, `ci`, `test` e `chore`, e `!` para mudança
  que quebra o contrato da RN-VERSAO-002. O título do pull request segue o mesmo formato. O
  tipo `release` é reservado ao pull request de lançamento (RN-VERSAO-008) e não aparece no
  changelog.
- **RN-VERSAO-007.** O `CHANGELOG.md` segue o formato Keep a Changelog e é gerado pelo
  `git-cliff` a partir do histórico local (configuração em `cliff.toml`, versionada). As notas
  de uma versão estável são a seção dela no `CHANGELOG.md`, quando existe, ou, sem ela, as do
  `git-cliff` com os commits desde a estável anterior; nos dois casos seguidas das somas SHA-256
  dos pacotes (decisão do dono em 2026-10-12: a estável sai sozinha no merge em `main`). As
  notas de um pré-lançamento são geradas pelo `git-cliff` na hora, com os commits desde a tag
  anterior, seguidas das somas, e NÃO são gravadas no `CHANGELOG.md` (um commit a cada merge na
  `develop` encheria o histórico). Uma versão estável reúne tudo desde a estável anterior.
  **As notas são escritas para quem usa o Prism** (decisão do dono em 2026-10-15): o que o
  `git-cliff` gera só traz o que o usuário percebe (`feat`, `fix`, `perf`, o escopo `security` e
  a quebra de contrato), sem o escopo do commit e sem as referências à especificação; ficam de
  fora `docs`, `build`, `ci`, `test`, `chore`, `refactor` e `feat(api)`, porque a API local fica
  fora do contrato. A seção de uma versão estável no `CHANGELOG.md` é escrita em linguagem de
  quem usa, curta, sem termos internos.
- **RN-VERSAO-008.** Lançar uma versão (decisões do dono em 2026-10-10 e 2026-10-12): os ramos
  de trabalho entram por pull request em `develop`; `develop` entra em `main`. A pipeline só roda
  no merge (RN-ABERTO-005) e faz o lançamento sozinha; ninguém cria tag à mão.
  - **A versão da vez** (decisão do dono em 2026-10-12, "automático"): sem nenhuma estável, é a
    do `package.json`; com estáveis, é a do `package.json` se ela for maior que a última estável,
    e senão a última estável com o terceiro número mais um. Depois da `v0.1.0`, a versão da vez é
    `0.1.1` sem ninguém mexer no `package.json`; subir o campo para `0.2.0` faz a versão da vez
    ser `0.2.0`.
  - **Em `develop`, cada merge lança um pré-lançamento** (decisão do dono em 2026-10-12: "a cada
    merge na develop"): `vX.Y.Z-beta.N` da versão da vez, com `N` um a mais que o maior já
    publicado para ela (o primeiro é 1), marcado como pré-lançamento. `-rc.N` não é usado nesta
    entrega.
  - **Em `main`, cada merge lança a estável** `vX.Y.Z` da versão da vez. Só não lança quando não
    há commit novo desde a última estável (o merge está na história dela): a pipeline verifica e
    empacota, com o aviso "nada novo desde a vX.Y.Z" à vista.
  - Lançar é, nesta ordem: gerar os pacotes de todas as plataformas; criar a release como
    rascunho; anexar cada pacote e o `SHA256SUMS`; publicar (é a publicação que cria a tag, no
    commit do merge). Com as releases imutáveis ligadas (RN-ABERTO-007), um pacote publicado não
    pode ser trocado e a tag não se move; uma tentativa que falha antes de publicar não deixa tag.
  - Não há ramo `release/X.Y.Z` (decisão de 2026-10-12, Ruling 127): correção de uma versão
    antiga, se um dia for preciso, é assunto de quando existir. Só o job de lançamento tem
    permissão de escrita, e só a de criar release; nenhum job envia commit nem ramo.
- **RN-VERSAO-009.** O passo a passo do lançamento e a política acima ficam em
  `docs/versionamento.md`, escritos para quem nunca lançou uma versão.

Fica para depois, por depender de assinatura de código ou de infraestrutura que o projeto ainda
não tem: assinatura e notarização dos pacotes, repositórios apt e rpm, automação que abre o
pull request de lançamento, apagar pré-lançamentos antigos, e a conferência de versão entre a interface e a API na partida. A
verificação e a instalação de atualizações estão na seção 17.

## 16. Drivers sob demanda

Pedido do dono em 2026-10-10: fazer como o DBeaver e o DataGrip — o usuário tem uma lista de
bancos e baixa o driver de cada um quando precisa. Decisões dele: nesta entrega entram o
gerenciador e os três bancos de hoje; os drivers vêm do nuget.org com versão e hash fixos; a
licença é mostrada e o aceite é exigido; o SQLite é o primeiro da fila dos próximos.

- **RN-DRIVER-001.** O pacote do Prism não leva driver nenhum (decisão do dono em 2026-10-12: o
  pacote traz só o programa, e cada pessoa instala o driver do banco que usa; antes o do
  PostgreSQL vinha embutido). Todo driver é baixado pelo usuário, na máquina dele, quando ele
  pede. O Prism não redistribui driver proprietário: quem aceita a licença do fabricante é quem
  baixa.
- **RN-DRIVER-002.** O catálogo de drivers é um arquivo versionado dentro da API: identificador,
  nome, fabricante, bancos atendidos, e, por plataforma, o pacote do nuget.org (nome, versão
  exata e SHA-512 do arquivo do pacote), o tamanho, o nome da licença e o endereço do texto
  oficial dela. Nada é descoberto pela rede. Cada driver tem um estado: `bundled` (embutido),
  `available` (pode ser baixado), `installing`, `installed`, `failed`, `unavailable` (o
  fabricante não publica o driver para esta plataforma) e `comingSoon` (o Prism ainda não
  conecta nesse banco). Nesta entrega: "PostgreSQL" (o Npgsql, de licença permissiva), baixável
  em todas as plataformas — nenhum driver usa o estado `bundled`, que fica no contrato —; "IBM Data Server" para Db2 e
  Informix, baixável no Windows x64, no Linux x64 e no macOS Apple Silicon, e `unavailable` no
  macOS Intel; e, como `comingSoon`, SQLite (o próximo), MySQL, MariaDB, Microsoft SQL Server,
  Oracle, Firebird, DuckDB e ClickHouse.
- **RN-DRIVER-003.** Instalar um driver exige o aceite da licença dele: sem o aceite, 422
  `DRIVER_LICENSE_NOT_ACCEPTED`. A API baixa o pacote só de `api.nuget.org`, por HTTPS, na
  versão exata do catálogo; confere o SHA-512 do arquivo antes de abrir (se não bate, nada é
  extraído e o estado vira `failed` com `DRIVER_INTEGRITY_FAILED`); extrai só as entradas
  esperadas, recusando caminho que saia da pasta de destino; grava em
  `<pasta de drivers>/<id>/<versão>/` (RN-DRIVER-009); e registra ao lado o aceite (licença,
  versão, data). Nada do pacote é executado durante a instalação. A instalação é atômica: uma
  instalação interrompida não deixa driver pela metade dado como instalado.
- **RN-DRIVER-004.** O download pode ser grande (o da IBM tem perto de 45 MB e ocupa mais de 100 MB depois de
  extraído): a tela mostra o
  progresso e permite cancelar. Só uma instalação por driver de cada vez. Falha de rede deixa o
  estado em `failed` com `DRIVER_DOWNLOAD_FAILED` e a causa, e o usuário pode tentar de novo.
- **RN-DRIVER-005.** Um driver instalado pela primeira vez passa a valer na hora, sem reiniciar
  nada: como o driver só é carregado quando é usado (RN-DRIVER-010), nada dele estava em
  memória. O reinício da API só é preciso quando o driver já tinha sido carregado nesta
  execução — reinstalar por cima de um que estava em uso ou que falhou ao carregar, e remover
  um que foi usado —, e `restartRequired` diz quando é o caso. Só nesse caso a tela avisa,
  antes, que o serviço vai reiniciar, que o Prism vai pedir a senha de novo e que as abas de
  SQL abertas serão fechadas; terminada a operação, oferece reiniciar agora ou depois, e
  enquanto o reinício não acontece um lembrete fica à vista. Antes de reiniciar o serviço, vale
  a RN-TX-006. (Até 2026-10-12 toda instalação
  pedia o reinício; com o driver do PostgreSQL também sob demanda, a primeira conexão de quem
  acabou de instalar o Prism não pode custar um reinício.)
- **RN-DRIVER-006.** Abrir sessão ou testar conexão de um banco cujo driver não está instalado
  responde 422 `DRIVER_NOT_INSTALLED`, e a tela oferece "Instalar driver", que leva à tela de
  drivers. Em plataforma sem driver, a resposta é 422 `DATABASE_CONNECTION_FAILED` com a
  mensagem que diz isso.
- **RN-DRIVER-007.** Remover um driver só é aceito sem sessão aberta de um banco que ele atende
  (senão 409 `DRIVER_IN_USE`). A remoção de um driver que não foi carregado nesta execução vale
  na hora; a de um que foi carregado vale no reinício da API (RN-DRIVER-005).
- **RN-DRIVER-008.** Rede: a API só faz chamada de saída para `api.nuget.org`, e só quando o
  usuário manda instalar um driver. Não há telemetria nem download automático; a verificação de
  atualização é do processo principal, nas condições da seção 17. A validação do certificado nunca é desligada: numa rede que intercepta HTTPS, o
  download falha com a causa na tela.
- **RN-DRIVER-009.** A pasta de drivers é da máquina, não do cofre: um driver instalado serve a
  todos os usuários do Prism naquela conta do sistema, e o aceite fica registrado na pasta do
  driver. Quem diz à API onde ela fica é o processo principal (`PRISM_DRIVERS_DIR`; sem a variável,
  `<PRISM_DATA_DIR>/drivers`). No Windows é a pasta local da conta
  (`%LOCALAPPDATA%\Zanveri\Prism\drivers`, e `…\Prism-dev\drivers` em desenvolvimento), e não a
  que acompanha o perfil pela rede: são mais de 100 MB de bibliotecas, que são da máquina. No
  Linux e no macOS, e sempre que a pasta de dados é indicada na linha de comando
  (`--user-data-dir`), ela fica dentro da pasta de dados.
- **RN-DRIVER-010.** Só é carregado o que foi conferido. O catálogo embutido no app traz o
  hash de CADA arquivo que a instalação extrai (gerado do pacote fixado e vigiado por um teste
  contra o pacote de verdade). A cada partida, a API confere todos os arquivos da pasta de cada
  driver instalado contra o catálogo e recusa arquivo trocado, faltando ou a mais (o que o
  próprio driver grava enquanto funciona fica fora da pasta conferida, ou num lugar dela que
  não é de onde se carrega biblioteca). A conferência não atrasa a partida: roda em segundo
  plano, e a lista de drivers, a instalação, a remoção e a abertura de sessão ou o teste de
  conexão de um banco daquele driver esperam por ela. O driver é carregado quando é usado pela
  primeira vez, e não na partida: um driver com problema nunca impede o Prism de abrir nem de
  usar os outros bancos. A carga tira os arquivos da pasta conferida e só dela: nenhuma
  biblioteca de mesmo nome ao lado do executável, no caminho de busca do sistema ou numa
  variável de ambiente ganha da conferida. Driver que não passa na conferência aparece como
  `failed` com `DRIVER_INTEGRITY_FAILED`; o que passa e não carrega, como `failed` com
  `DRIVER_LOAD_FAILED`. Nos dois casos a causa vai para o log e para a tela, abrir sessão ou
  testar conexão responde 422 `DRIVER_NOT_INSTALLED`, e o usuário pode instalar de novo (vale
  na hora ou no reinício, pela RN-DRIVER-005): nunca vira um erro interno que só some reiniciando. A
  conferência é da partida: uma troca de arquivo feita com o Prism aberto, depois dela, só é
  pega na partida seguinte (quem consegue fazê-la já tem a conta do usuário).

Rotas (todas exigem o token e o cofre aberto):

| Rota | Sucesso | Recusas |
| --- | --- | --- |
| `GET api/user/drivers` | 200 lista | |
| `POST api/user/drivers/{id}/install` `{ acceptedLicense: true }` | 202 | 404 `DRIVER_NOT_FOUND`; 409 `DRIVER_ALREADY_INSTALLED`, `DRIVER_INSTALL_IN_PROGRESS`; 422 `DRIVER_LICENSE_NOT_ACCEPTED`, `DRIVER_UNAVAILABLE` |
| `DELETE api/user/drivers/{id}/install` | 204 (cancela a instalação em andamento) | 404 `DRIVER_NOT_FOUND`; 409 `DRIVER_NOT_INSTALLING` |
| `DELETE api/user/drivers/{id}` | 204 (remove no próximo reinício) | 404 `DRIVER_NOT_FOUND`; 409 `DRIVER_IN_USE`, `DRIVER_NOT_INSTALLED` |

Item da lista: `{ id, name, vendor, engines: number[], state, version, sizeBytes, license:
{ name, url }, platformNote, progress: { receivedBytes, totalBytes } | null, error: { code,
detail } | null, restartRequired }`. `engines` usa os números dos bancos (1 PostgreSQL, 2 Db2,
3 Informix); um driver `comingSoon` tem `engines` vazio e `version` nulo. `restartRequired` é
verdadeiro entre o fim de uma instalação ou remoção e o reinício da API.

O que a lista garante, para a tela não ter de adivinhar:

- Toda chave do item vem sempre, com `null` quando não se aplica. `sizeBytes`, `license` e
  `platformNote` podem ser nulos (`license` nunca é nula em `available`, `installing`, `failed` e
  `installed`; o endereço dela é sempre `https://`). `error.detail` pode ser nulo.
- Quando o `POST …/install` responde 202, a lista já mostra o driver como `installing`.
  `progress` é nulo até o primeiro byte chegar; `totalBytes` é o tamanho do catálogo.
- Cancelar a instalação (`DELETE …/install`) devolve o driver a `available`, sem `error`.
- `failed` fica até uma nova tentativa, e o `POST …/install` é aceito a partir de `failed`.
- A lista só responde depois da conferência da partida (RN-DRIVER-010): não existe estado
  "conferindo". O driver que não passou nela, ou que não carregou no primeiro uso, vem como
  `failed` com a causa em `error.detail`, e aceita o `POST …/install` como qualquer `failed`.
- Depois de removido, o driver aparece como `available` com `restartRequired` verdadeiro; as
  sessões que já o usavam continuam até o reinício.
- O 422 `DRIVER_NOT_INSTALLED` traz no detalhe o nome do driver que falta e, como extensão do
  erro, `driverID`.

Fica para depois: instalar um driver a partir de um arquivo que o usuário indica (para redes sem
acesso ao nuget.org), atualizar um driver instalado para uma versão mais nova do catálogo, e os
bancos marcados como `comingSoon`.

## 17. Atualizações

Pedido do dono em 2026-10-10: ao abrir, o Prism procura versão nova no repositório do projeto e
pergunta se o usuário quer atualizar, mostrando o changelog e as notas da versão nova. Decisões
dele: "Atualizar" baixa, confere e instala; a consulta acontece ao abrir, no máximo uma vez por
dia.

- **RN-ATUALIZA-001.** A origem das atualizações é o repositório do GitHub de onde o pacote saiu:
  o endereço da API do GitHub, o endereço do site e o `dono/repositório`, gravados no pacote pela
  pipeline na hora de gerar, a partir do contexto do próprio workflow (nunca de variável ou
  segredo que alguém possa configurar), e não escritos no repositório. Um Prism gerado sem essa
  informação (o de desenvolvimento, um pacote gerado à mão) não procura atualização, e diz isso
  quando o usuário pede para verificar.
- **RN-ATUALIZA-002.** Ao abrir, o Prism consulta a lista pública de releases do repositório, sem
  credencial, no máximo uma vez a cada 24 horas, e considera as releases publicadas mais novas
  que a instalada, pela ordem do SemVer: só as estáveis (`vX.Y.Z`), ou também os pré-lançamentos
  (`vX.Y.Z-beta.N`) quando o canal beta está ligado (RN-ATUALIZA-010). Falha de rede nessa
  consulta não aparece na tela: vai para o log. O usuário pode verificar à mão a qualquer
  momento ("Verificar atualizações", junto da versão), e aí o resultado sempre aparece,
  inclusive "o Prism está atualizado" e a falha.
- **RN-ATUALIZA-003.** Havendo versão nova, um diálogo mostra a versão instalada, a nova, a data,
  e as notas de TODAS as versões mais novas que a instalada, da mais recente para a mais antiga
  (são as seções do `CHANGELOG.md`, que a pipeline põe na release). As ações: "Atualizar agora",
  "Depois", "Pular esta versão" (não avisa de novo até sair outra) e a opção "Não verificar ao
  abrir".
- **RN-ATUALIZA-004.** As notas vêm da rede e são tratadas como texto não confiável: são
  desenhadas por um interpretador pequeno do próprio projeto, que só entende título, lista,
  parágrafo, ênfase e código, e devolve elementos da tela. Nada delas vira HTML, imagem, link
  clicável ou endereço que o app abra.
- **RN-ATUALIZA-005.** "Atualizar agora" baixa o pacote da plataforma e da arquitetura em uso,
  com progresso e cancelamento. O endereço do download é montado pelo Prism a partir da origem
  gravada, da tag e do nome de arquivo que a pipeline usa (o endereço de download de um arquivo
  de release do GitHub); nenhum endereço vindo do conteúdo da release é seguido. Antes de qualquer uso, o SHA-256 do arquivo baixado é conferido contra
  a soma que está nas notas da release E contra a do arquivo `SHA256SUMS` da mesma versão; se
  uma delas falta ou não bate, o arquivo é apagado e a atualização é recusada com a causa.
- **RN-ATUALIZA-006.** Instalar: no Windows, o Prism roda o instalador conferido e se encerra; o
  instalador atualiza a instalação e abre o Prism de novo. No Linux e no macOS, onde instalar
  pede senha de administrador ou assinatura, e no Windows quando o Prism roda da cópia portátil
  (`.zip`, sem instalação), o Prism confere o pacote e, com um clique do usuário, o deixa na
  pasta de downloads e a mostra, dizendo o que fazer. O app só se encerra para instalar depois
  de a API ter terminado. Antes de instalar a atualização, vale a RN-TX-006. No Linux o pacote
  baixado é o do mesmo formato da instalação em uso (AppImage, `deb`, `rpm` ou `tar.gz`).
- **RN-ATUALIZA-007.** As preferências de atualização (não verificar ao abrir, versão pulada, a
  hora da última consulta) ficam num arquivo da pasta de dados, fora do cofre: valem para a
  instalação, não para um usuário.
- **RN-ATUALIZA-008.** Rede: a consulta e o download são feitos pelo processo principal, por
  HTTPS, só para a origem gravada no pacote (e para onde o GitHub redirecionar o download, que
  ele serve de outro domínio; a consulta não segue redirecionamento). A
  validação do certificado nunca é desligada. A tela não ganha nenhuma permissão de rede. A
  consulta não envia identificador do usuário nem da máquina; o servidor vê o que qualquer
  requisição HTTP mostra (o endereço de rede e a versão do Prism).
- **RN-ATUALIZA-009.** Sem assinatura de código (seção 14), a garantia de uma atualização é a do
  HTTPS do GitHub somada às duas somas da RN-ATUALIZA-005 e às releases imutáveis (um pacote
  publicado não pode ser trocado). O README e a tela dizem isso. Assinar as releases com uma
  chave do projeto fica para depois.
- **RN-ATUALIZA-010.** Canal beta (decisão do dono em 2026-10-12): Configurações › Atualizações
  ganha "Receber versões beta", desligado por padrão, guardado com as outras preferências de
  atualização (vale para a instalação, RN-ATUALIZA-007). Ligado, a consulta considera também os
  pré-lançamentos, e o diálogo diz que a versão é beta e que pode ter defeitos. Desligado, só as
  estáveis — inclusive para quem já está numa beta, que recebe a próxima estável mais nova que
  ela (a `0.2.0` depois da `0.2.0-beta.3`). Ligar ou desligar não instala nada sozinho: vale a
  partir da próxima consulta. "Pular esta versão" vale igual nos dois canais.

Com esta seção, a RN-DRIVER-008 passa a valer assim: a API só faz chamada de saída para
`api.nuget.org`, quando o usuário manda instalar um driver; o processo principal só faz chamada
de saída para a origem das atualizações, nas condições acima. Não há telemetria.

Fica para depois: aplicar a atualização sozinho no Linux e no macOS, atualização em segundo
plano, e assinatura das releases.

## 18. Área de trabalho — complemento de 2026-10-11

Prioridade pedida pelo dono em 2026-10-11: o que estava desenhado no canvas e tinha ficado fora da
fatia (seção 13) entra agora, na ordem abaixo. O canvas é a medida de desenho (`Workbench`,
`TabelaDados`, `TabelaDetalhe`, `DiagramaER`, `Configuracoes`); onde o canvas mostra algo que
depende de uma parte da API que ainda não existe, a tela não desenha um controle de mentira.

- **RN-BUSCA-001.** O navegador tem um campo de busca. Ele filtra pelo nome, sem diferenciar
  maiúsculas nem acentos, o que já está carregado na árvore (pastas, conexões, esquemas, tabelas,
  visões, rotinas, colunas); o que casa aparece com os ancestrais abertos, e o trecho que casou
  fica destacado. Limpar o campo devolve a árvore como estava. A busca não abre conexão nem
  carrega nível que o usuário não abriu.
- **RN-MENU-001.** O botão direito (e Shift+F10, e a tecla de menu) sobre um item do navegador
  abre um menu de contexto com o tema do app, com as ações daquele tipo de item. Conexão: conectar
  ou desconectar, nova consulta, atualizar, editar conexão, copiar nome. Esquema: nova consulta,
  atualizar, copiar nome. Tabela e visão: abrir registros, ver estrutura, ver diagrama, gerar
  `SELECT` numa consulta nova, copiar nome e copiar nome qualificado. Rotina, coluna, índice e
  chave: copiar nome. Pasta: as ações que a tela de Conexões já oferece para ela. O menu tem
  papel de menu, anda pelas setas, executa com Enter, fecha com Esc e com clique fora, e devolve o
  foco ao item. Ação que não se aplica no estado atual aparece desabilitada, não some.
- **RN-TABELA-001.** Duplo clique (ou Enter) numa tabela ou visão do navegador abre a aba dela,
  uma por tabela: abrir de novo volta para a aba que já existe. A aba tem a sessão dela, como uma
  aba de consulta (RN-SESSAO-001), e três vistas: Registros, Estrutura e Diagrama.
- **RN-TABELA-002.** Registros: a tela executa `SELECT * FROM` a tabela, com o esquema e o nome
  entre aspas duplas (a aspa dobrada dentro do nome), exatamente como o catálogo os devolve, nos
  três bancos: no Informix o driver abre a sessão com identificadores delimitados (sonda de
  2026-10-09), então a regra é uma só. Nenhum nome vindo do catálogo pode virar um segundo
  comando nem mudar o que é consultado. Valem as regras de resultado da seção de SQL: páginas de
  200, "carregar mais", contar o total, cancelar. Os registros são editáveis pelas RN-EDIT-001 a
  016. *Alterada a pedido do dono em 2026-10-16 (seção 33): entraram a barra de edição e o duplicar
  linha (RN-EDIT-013 a 016).*
- **RN-TABELA-003.** Estrutura: colunas (nome, tipo, nulo, chave; o padrão entra quando a API o devolver), chaves estrangeiras
  (nome, colunas, tabela e colunas referenciadas) e índices (nome, colunas, único), pelas três
  consultas de catálogo que a API já tem. O DDL da tabela fica para depois.
- **RN-TABELA-004.** Diagrama: a tabela e as tabelas que as chaves estrangeiras dela apontam,
  cada uma com as colunas, e uma linha por chave estrangeira ligando as colunas. Dá para rolar e
  ampliar. Duplo clique numa tabela vizinha abre a aba dela. As tabelas que apontam PARA esta
  entram quando a API as devolver.
- **RN-PAINEL-001.** Na aba de consulta, a área de resultado pode ser recolhida (fica só a barra
  dela), restaurada e maximizada (o editor é que fica recolhido), e a divisão entre editor e
  resultado pode ser arrastada. Executar um comando com a área recolhida a restaura. O estado
  vale por aba.
- **RN-CONFIG-001.** Há uma tela de Configurações, alcançada pela barra superior. Ela traz as
  seções do canvas que têm efeito hoje: aparência e editor de SQL (preferências desta instalação,
  guardadas fora do cofre, por usuário), atualizações (verificar ao abrir, versão pulada), drivers
  (atalho), conta (troca de senha, RN-COFRE-013) e sobre (versão, pasta de dados). O que o canvas
  mostra e ainda depende da API (proteções) aparece como "em breve", sem controle que finja
  funcionar. Transações deixa
  de ser "em breve" (RN-CONFIG-007).
- **RN-CONFIG-007.** Configurações › Transações tem "Modo padrão das novas abas" (Auto-commit ou
  Commit manual; vem Auto-commit) e "Nível de isolamento padrão" (RN-ISOL-006), guardados por
  usuário; valem para as abas abertas depois.

Fica para depois: DDL da tabela, o clique numa chave estrangeira que leva ao registro
referenciado, troca de senha e as tabelas que referenciam a tabela do diagrama.

## 19. Complemento de 2026-10-11, segunda leva ("quero tudo isso")

O dono pediu tudo o que a tela de Configurações do canvas mostra e o que tinha ficado como "em
breve", mais o que a aba da tabela do canvas tem e a primeira leva não trouxe. O que depende só da
tela entra já; o que depende da API entra em tarefas próprias, na ordem em que a API puder
recebê-las sem pôr em risco as garantias de transação da seção de SQL.

Só da tela:

- **RN-MARCA-006.** No tema claro a ilustração da marca continua inteira (raio de entrada, prisma
  de vidro, três faixas, três cilindros): onde o fundo claro apagaria o raio ou o vidro, a marca
  é desenhada sobre o próprio palco escuro (o painel da tela de login) ou numa variante com o
  raio e os contornos em tom escuro (a marca pequena da barra). Nunca uma versão simplificada.
- **RN-CONFIG-002.** A entrada de Configurações na barra superior tem ícone e texto.
- **RN-CONFIG-003.** Temas: os seis do canvas. As cores que o canvas não define para um tema são
  derivadas das que ele define, e todo par de texto e fundo do tema passa no contraste (4,5:1
  para texto, 3:1 para texto grande e ícone), conferido por teste.
- **RN-CONFIG-004.** Editor de SQL: autocompletar ao digitar (palavras-chave do banco da aba e os
  nomes já carregados na árvore daquela conexão: esquemas, tabelas, visões e colunas; nunca
  dispara consulta ao banco) e converter palavras-chave para maiúsculas ao digitar. Os dois têm
  chave de ligar e desligar.
- **RN-CONFIG-005.** Resultados: o texto que representa o valor nulo na grade, e "buscar mais
  linhas ao rolar até o fim da grade" (a grade pede a página seguinte sozinha, uma por vez, e
  para se o usuário cancelar; com a atualização automática do resultado ligada, RN-GRADE-014, a
  página seguinte espera o botão "Carregar mais", pelo pedido do dono em 2026-10-15, issue #11).
  "Linhas por busca" depende da API (RN-SQL-016).
- **RN-SEG-001.** Bloqueio por inatividade, ligado por padrão em 10 minutos (de 1 a 240, e pode
  ser desligado). Sem tecla nem ponteiro na janela por esse tempo, e sem comando em andamento em
  nenhuma aba (o tempo conta a partir do fim do último; a execução da atualização automática,
  RN-GRADE-014, não conta como comando em andamento nem como atividade, pedido do dono em
  2026-10-15, issue #11; o script conta enquanto roda, e não enquanto espera a resposta da
  pergunta de erro, RN-SQL-021; a verificação periódica das conexões, RN-VERIF-002, não conta como
  comando em andamento nem como atividade, e não roda com o cofre bloqueado), o Prism avisa 60
  segundos antes (30, quando o tempo configurado é de 1 minuto) e então bloqueia: a API fecha o cofre (RN-COFRE-008, as sessões com os bancos se encerram) e a tela
  mostra o bloqueio, que pede a senha do MESMO usuário. Desbloquear devolve a área de trabalho
  com as abas e o texto de SQL como estavam; os resultados que estavam na tela são descartados
  no bloqueio. O aviso antes do bloqueio diz quantas transações serão desfeitas e quantas
  alterações não salvas serão descartadas, e, ao desbloquear, cada aba diz o que perdeu
  (RN-TX-007). Ao desbloquear, a árvore reabre a sessão das conexões que estavam abertas nela, e
  cada aba só volta a falar com o banco quando é vista ou executada (a aba de tabela à vista
  recarrega os registros; as escondidas esperam ser abertas). As outras telas de dentro do cofre
  (Conexões, Configurações, Drivers) voltam ao estado inicial: um formulário aberto, uma senha
  de conexão revelada ou digitada e não gravada não sobrevivem ao bloqueio. "Sair" na tela de bloqueio encerra de
  verdade (tudo é descartado). Enquanto bloqueado, nada do que estava aberto fica visível nem
  alcançável pelo teclado. Se o serviço não confirmar que fechou o cofre, a tela bloqueia do
  mesmo jeito e tenta de novo com espera crescente (cada tentativa com prazo); enquanto tenta,
  "Desbloquear" espera, e a tela diz o que está acontecendo. Se desistir, avisa que o cofre pode
  continuar aberto no serviço, e o desbloqueio continua conferindo a senha lá.
  *Alterada a pedido do dono em 2026-10-15 (seção 32): entrou a verificação periódica.*
- **RN-TABELA-005.** Registros: um campo de filtro recebe a condição (`WHERE`) que o usuário
  escreve, e clicar no cabeçalho de uma coluna ordena por ela (crescente, decrescente, sem
  ordem). A tela monta o `SELECT` com a condição e a ordem e mostra o comando que executou. A
  condição é texto do usuário, enviado como ele escreveu (RN-SQL-003), sem o `;` do fim, e a
  recusa de mais de um comando vale como em qualquer consulta. A tela só mostra como aplicados o
  filtro e a ordem do comando que foi de fato enviado. Ao lado do filtro, a barra dos Registros
  tem o seletor de nível de isolamento da aba (RN-ISOL-001).
- **RN-TABELA-006.** Registros: "Exportar CSV" grava as linhas carregadas na grade (com o aviso
  de quantas são e de que as não carregadas não entram), em UTF-8 com BOM, separador `;`,
  aspas dobradas, e valor cujo primeiro caractere depois de espaços, tabulação ou retorno de
  carro é `=`, `+`, `-` ou `@` precedido de apóstrofo (para uma planilha não o executar); um
  número simples, inclusive negativo, sai como está. Exportar o total fica para a tarefa da API.
- **RN-TABELA-007.** Chave estrangeira: na grade de registros, o valor de uma coluna que é chave
  estrangeira leva à tabela referenciada, já filtrada por aquele valor (o filtro aparece no
  campo da RN-TABELA-005). O valor entra no filtro como literal do banco: número só se for
  número, o resto entre aspas simples com a aspa dobrada; nulo não tem para onde ir. A barra
  invertida vai como está no Db2 e no Informix, onde dentro de aspas simples ela é caractere comum
  (provado nos dois servidores pelo driver da IBM: Db2 12.1.5 e 11.5.8, modo padrão e vetores ORA e
  MYS da instância; Informix 14.10 pela DRDA); no PostgreSQL o literal com barra vai como `E'...'`,
  com a barra dobrada. Com a
  conexão desconectada o valor não é link (nada reconecta sozinho); e se a aba de destino
  estiver ocupada, o filtro espera até 15 segundos por ela e, passado isso, a tela avisa para
  clicar de novo. Se a aba de destino tem alterações não salvas, o salto pergunta antes
  (RN-EDIT-007).
- **RN-TABELA-008.** Estrutura: "DDL aproximado", um `CREATE TABLE` montado pelo Prism a partir
  do catálogo já carregado (colunas, tipos, nulo, chave primária, chaves estrangeiras, índices),
  com o aviso de que não é o DDL do banco (padrões, restrições de conferência e opções de
  armazenamento não aparecem). Dá para copiar. Para uma visão o Prism não monta DDL: a seção
  diz isso no lugar de um `CREATE TABLE`; quando o tipo do objeto ainda não é conhecido (a
  árvore daquele esquema não foi carregada), o texto avisa que pode ser uma visão.
- **RN-TABELA-009.** A Estrutura mostra uma seção por vez, escolhida numa lista lateral dentro
  da própria aba, como no DBeaver: Colunas, Chaves estrangeiras, Índices e DDL (e as que as
  RN-CAT-004 e 005 acrescentam). Cada entrada da lista diz quantos itens a seção tem; a seção
  escolhida ocupa toda a largura e a altura da aba, sem dividir espaço com outra, e fica
  lembrada enquanto a aba estiver aberta. A lista anda pelas setas e tem papel de abas. Pedido
  do dono em 2026-10-12, no lugar dos cartões lado a lado.

Com a API (tarefas próprias):

- **RN-COFRE-013.** Trocar a senha: `PUT api/user/password` com `{ currentPassword, newPassword }`
  responde 204. A senha atual é conferida pelo mesmo caminho e com a mesma contagem de erros da
  revelação de senha (RN-CONN-002 e 003): errada, 422 `INVALID_PASSWORD` no campo
  `currentPassword` — nunca 401 por estar errada, porque a chamada já está autenticada —, e o
  quinto erro seguido fecha o cofre e responde 401 `VAULT_LOCKED`. Com transação aberta, o
  diálogo de troca avisa que cinco erros seguidos fecham o cofre e desfazem as transações
  abertas (RN-TX-008). A nova segue as regras da
  criação de conta (inválida: 422 `PASSWORD_INVALID` no campo `newPassword`); igual à atual: 422
  `PASSWORD_UNCHANGED`. A troca RECIFRA o cofre: gera uma chave do cofre nova, cifra o conteúdo
  com ela e a embrulha com a chave derivada da senha nova (sal novo; parâmetros de derivação atuais,
  nunca mais fracos que os do arquivo). Assim, quem tem a senha antiga e uma cópia antiga do arquivo não lê nada do que for
  gravado depois. A gravação é a atômica de sempre (RN-COFRE-005), seguida de uma segunda
  gravação do mesmo arquivo, para que a cópia `.bak` também fique com a senha nova (sem ela, a
  senha antiga voltaria a abrir o cofre se o arquivo principal sumisse). A troca de arquivos de
  toda gravação do cofre é tentada de novo algumas vezes, com espera curta, quando outro
  programa segura o arquivo (antivírus, cópia de segurança). E a cada entrada bem-sucedida o
  Prism confere se o `.bak` está embrulhado pela mesma senha do principal; se não está (a
  segunda gravação falhou, ou a energia caiu entre as duas), refaz o `.bak` na hora. O cofre continua aberto
  e as sessões com os bancos não caem. Uma falha na primeira gravação deixa o cofre abrindo com
  a senha antiga e a memória igual ao disco; uma falha só na segunda mantém a troca (204) e vai
  ao log como aviso. A resposta de senha errada custa a mesma derivação que a de uma entrada
  errada. Nada das senhas vai a log.
- **RN-SQL-016.** Linhas por busca: `POST …/queries` aceita `pageSize`, inteiro de 50 a 1000
  (sem ele, 200; fora da faixa, 422 `QUERY_INVALID` no campo). O tamanho vale para a primeira
  página e para as de "carregar mais" daquele cursor (`queries/next` não recebe tamanho), e é
  também o limite de linhas devolvidas no caso da RN-SQL-013. A preferência fica em
  Configurações › Resultados (50, 100, 200, 500 ou 1000), por usuário, vale para as execuções
  seguintes, e os textos que hoje dizem 200 ("Primeiras 200 linhas", "Carregar mais 200")
  passam a dizer o número daquele resultado.
- **RN-CAT-001.** Padrão da coluna: cada coluna traz `defaultValue` (a expressão padrão como o
  banco a descreve, ou nulo) e `generated`: `always` quando é o banco que calcula o valor e não
  aceita outro (identidade "sempre", coluna calculada), `byDefault` quando o banco preenche se
  o valor não for informado (identidade "por padrão", `SERIAL` do Informix), ou nulo. A
  Estrutura mostra a coluna "Padrão" (e diz que a coluna é gerada, quando for o caso).
- **RN-CAT-002.** Regras da chave estrangeira: cada chave traz `onDelete` e `onUpdate`, com
  `noAction`, `restrict`, `cascade`, `setNull` ou `setDefault` (nulo quando o banco não
  informa). A Estrutura mostra "Ao excluir" e "Ao atualizar".
- **RN-CAT-003.** Método do índice: cada índice traz `method`, com o nome que o banco usa
  (`btree`, `hash`, `gin`…), ou nulo quando o banco não informa.
- **RN-CAT-004.** Quem referencia a tabela: `GET …/tables/{table}/referenced-by` devolve as
  chaves estrangeiras de outras tabelas (e da própria, quando ela aponta para si) que apontam
  para esta: nome, esquema e tabela de origem, colunas de origem, colunas referenciadas e as
  duas regras. A Estrutura ganha a seção "Referenciada por", e o Diagrama passa a desenhar
  também essas tabelas, com a linha no sentido de quem referencia para quem é referenciado
  (completa a RN-TABELA-004).
- **RN-CAT-005.** Restrições de conferência: `GET …/tables/{table}/checks` devolve o nome e a
  expressão de cada `CHECK` da tabela, como o banco a descreve. A Estrutura ganha a seção.
- **RN-CAT-006.** Definição da visão: `GET …/views/{view}/definition` devolve
  `{ definition }`, o texto que o banco guarda para a visão (nulo quando ele não devolve nada:
  a visão não existe ou a conta não pode lê-la). Na aba de uma visão, a seção de DDL mostra
  esse texto, que é o do banco.
- **RN-CAT-007.** O DDL da tabela continua montado pelo Prism (RN-TABELA-008), agora com o que
  o catálogo passou a devolver: padrão e coluna gerada, as regras das chaves estrangeiras, o
  método do índice e as restrições de conferência. O aviso passa a dizer o que ainda não
  aparece (opções de armazenamento, partições, gatilhos e comentários). Para montar o DDL o
  Prism só lê o catálogo: não chama utilitário do servidor nem procedimento que grave no banco.
- Transações (commit manual por aba, confirmar e desfazer, nível de isolamento) e edição de
  célula mudam as garantias da seção de SQL (auto-commit, recusa de controle de transação, a
  conferência depois de cada comando) nos três bancos: ganham especificação própria, que o
  dono lê antes de qualquer código. É a seção 22.

## 20. Complemento de 2026-10-12: tudo na área de trabalho, e a grade que seleciona, copia, filtra, gera SQL e exporta

Pedido do dono em 2026-10-12, depois de usar as telas das seções 18 e 19 com um banco de verdade.
A medida é o DBeaver: o que ele faz na árvore e na grade, o Prism faz no mesmo lugar.

Navegação:

- **RN-NAV-001.** A área de trabalho é a única tela principal. A barra superior não tem mais
  "Conexões" nem "Drivers": ficam a marca, Configurações, os lembretes (atualização, reinício
  pendente de driver) e o usuário (bloquear, sair).
- **RN-NAV-002.** O navegador tem uma barra de ações acima da árvore, como a do DBeaver: Nova
  conexão, Nova pasta, Conectar, Desconectar, Atualizar e Recolher tudo. Nova conexão e Nova
  pasta estão SEMPRE habilitadas, qualquer que seja o foco (pedido do dono em 2026-10-12): criam
  dentro da pasta escolhida na árvore, ou na pasta do item escolhido, ou na raiz do navegador
  quando nada está escolhido. Conectar, Desconectar e Atualizar agem sobre o item escolhido na
  árvore; a ação que não se aplica aparece desabilitada, não some. Cada botão tem nome para
  leitor de tela e dica com o atalho, quando há. A barra é da árvore das conexões: "Nova conexão",
  "Nova pasta", "Conectar", "Desconectar", "Atualizar" e "Recolher tudo" não agem sobre a seção
  Scripts, que tem as pastas de scripts e os menus dela (RN-SCRIPT-008 e 009). *Alterada a pedido do
  dono em 2026-10-16 (seção 33): com a árvore da seção Scripts, a barra diz de qual árvore é.*
- **RN-NAV-003.** Tudo o que a tela de Conexões fazia passa a ser feito no navegador, pela barra
  de ações e pelo menu de contexto (RN-MENU-001): criar, renomear, mover e excluir pasta; criar,
  editar, mover e excluir conexão; testar a conexão e revelar a senha (no formulário). As regras
  de pasta e de conexão (seções 5.1 e 5.2) não mudam, e nenhuma capacidade da tela antiga se
  perde. O menu de contexto de uma pasta tem "Nova conexão" e "Nova pasta", que criam dentro
  dela, e o botão direito no espaço vazio do navegador abre um menu com as duas, que criam na
  raiz (pedido do dono em 2026-10-12).
- **RN-NAV-004.** O formulário de conexão, nova e edição, é um DIÁLOGO sobre a área de trabalho,
  como o do DBeaver (pedido do dono em 2026-10-12: "eu não quero mais aquela tela; deixar
  unificado na tela padrão da área de trabalho"). Não existe mais tela de Conexões: o endereço
  antigo leva à área de trabalho, e "Editar conexão" (no menu de contexto da conexão) abre o
  diálogo de edição ali mesmo; o duplo clique na conexão continua conectando. Abas, texto de SQL e
  resultados continuam por baixo, intactos. Salvar fecha o diálogo e deixa a conexão à vista na
  árvore (os ancestrais abertos) e escolhida; cancelar (e Esc; com algo digitado, confirma antes)
  fecha sem mudar nada. Testar a conexão e revelar a senha ficam no diálogo, como na tela antiga,
  com as mesmas regras e mensagens. O bloqueio por inatividade descarta o diálogo (RN-SEG-001).
- **RN-NAV-005.** "Nova conexão" começa pela escolha do banco, como no DBeaver: o diálogo abre numa
  grade com a logo e o nome de cada banco do catálogo de drivers (RN-DRIVER-002), com o estado do
  driver de cada um. O embutido e o instalado são escolhidos direto; o que pode ser baixado e
  ainda não está instalado também pode ser escolhido, e o passo seguinte mostra que o driver
  falta, com "Instalar" (o mesmo aceite de licença, progresso, cancelamento e reinício das
  RN-DRIVER-003 a 005); o indisponível na plataforma e o "em breve" (SQLite, MySQL, MariaDB, SQL
  Server, Oracle e o que mais o catálogo trouxer) aparecem desabilitados, com o motivo. Escolhido o
  banco, o mesmo diálogo passa às configurações da conexão (com Voltar para trocar o banco). Na
  edição, o diálogo abre direto nas configurações, com o banco escolhido à vista e o mesmo Voltar.
  Uma conexão pode ser salva sem o driver instalado; testar ou conectar responde o
  `DRIVER_NOT_INSTALLED` de sempre. As logos são as marcas dos fabricantes, como o DBeaver faz,
  usadas só para identificar o banco, sem alteração do desenho (só o tamanho; onde a logo some no
  tema, ela fica sobre uma ficha de contraste: clara nos temas escuros, escura nos claros, Ruling 140). A Zanveri decidiu usá-las mesmo sem permissão escrita
  dos fabricantes e assume o risco (Ruling 136): cada arquivo tem a origem anotada junto dele, o
  `README.md` da pasta das logos e o `NOTICE` dizem que as marcas são dos seus donos, não estão
  sob a GPLv3 e não indicam apoio nem parceria, e um pedido de retirada de um fabricante é
  atendido (a logo dá lugar à ficha colorida de hoje, PG, DB2, IFX).
- **RN-NAV-006.** A lista de drivers, com tudo o que a tela de Drivers tinha (instalar,
  cancelar, remover, estado, reinício), fica em Configurações › Drivers. O 422
  `DRIVER_NOT_INSTALLED` continua oferecendo "Instalar driver", que leva para lá. O lembrete de
  reinício pendente (RN-DRIVER-005) continua à vista na barra superior.
- **RN-NAV-007.** Sem nenhuma conexão cadastrada, a área de trabalho mostra o estado vazio com
  "Nova conexão".
- **RN-NAV-008.** O navegador pode ser escondido e mostrado: por um botão sempre à vista, por
  `Ctrl+B`, e `Ctrl+Shift+E` o mostra e leva o foco ao campo de busca. Escondido, a área das
  abas ocupa a largura toda, e nada do navegador é alcançável pelo teclado nem lido por leitor
  de tela. A árvore volta como estava (nós abertos, rolagem, item escolhido). A escolha é
  lembrada por usuário.

Grade de resultado (da aba de consulta e dos Registros da tabela):

- **RN-GRADE-001.** Seleção. A grade tem uma célula ativa e uma seleção. Clique escolhe a
  célula; Shift+clique, Shift+setas e arrastar estendem um retângulo; o número da linha escolhe
  a linha inteira (Shift estende, Ctrl acrescenta ou tira); Ctrl+A escolhe todas as linhas
  carregadas; Esc limpa. Setas, Home, End, PageUp e PageDown movem a célula ativa, e a grade
  rola para mantê-la à vista. A grade tem papel de grade e uma parada de tabulação só. A
  seleção atravessa a rolagem e o "carregar mais", e é esquecida numa nova execução.
- **RN-GRADE-002.** Copiar. Ctrl+C copia a seleção como texto: células separadas por tabulação
  e linhas por quebra de linha (o que uma planilha cola); uma célula só é copiada como o valor
  puro. Nulo vai vazio. A célula que chegou cortada (RN-SQL-011) é copiada com o valor completo
  (RN-SQL-017); a tela avisa só quando algum valor não pôde vir inteiro.
- **RN-GRADE-003.** Copiar avançado (Ctrl+Shift+C, como no DBeaver): um diálogo escolhe o que
  copiar (a seleção, as linhas inteiras da seleção ou todas as carregadas) e como: texto
  delimitado (delimitador, cabeçalho, número da linha, aspas, como escrever o nulo), JSON,
  Markdown, HTML ou comandos `INSERT`. As escolhas são lembradas por usuário.
- **RN-GRADE-004.** Menu de contexto da grade (botão direito, Shift+F10, tecla de menu), nas
  mesmas regras do menu do navegador (RN-MENU-001): Copiar, Copiar com cabeçalho, Copiar
  avançado, Copiar nome da coluna, Filtrar, Ordenar, Gerar SQL, Exportar e, numa chave
  estrangeira, Ir para o registro referenciado. O clique direito numa célula fora da seleção a
  escolhe antes. O menu ganha também os itens da edição de célula (RN-EDIT-001): Editar célula,
  Definir como nulo, Desfazer alteração, Adicionar linha, Duplicar linha e Excluir linha. *Alterada a
  pedido do dono em 2026-10-16 (seção 33): "Linha nova" passou a se chamar "Adicionar linha", e entrou
  "Duplicar linha" (RN-EDIT-016).*
- **RN-GRADE-005.** Filtrar pelo valor (Registros), como no DBeaver: sobre uma célula, o menu
  oferece igual ao valor (`=`), diferente (`<>`), maior (`>`), menor (`<`), contém (`LIKE`, em
  colunas de texto), "É nulo", "Não é nulo" e "Remover filtro". A condição escolhida entra no
  campo de filtro (RN-TABELA-005 e 010) — junta por `AND`, entre parênteses, ao que já estava
  lá — e é executada. O valor vira literal pela regra da RN-TABELA-007; célula cortada ou
  binária só oferece as opções de nulo. "Ordenar" oferece crescente, decrescente e sem ordem
  para a coluna da célula, pelo mesmo caminho do cabeçalho.
- **RN-GRADE-006.** Gerar SQL, das linhas escolhidas: `INSERT` (uma linha por comando, com as
  colunas do resultado), `UPDATE` (as colunas que não são da chave, com a condição pela chave),
  `DELETE` e `SELECT` (pela chave). A chave é a mesma da edição (RN-EDIT-002): a primária, ou
  uma restrição ou índice único de colunas não nulas. Nos Registros a tabela e a chave são
  conhecidas; sem nenhuma chave a condição usa todas as colunas (com `IS NULL` para nulo), e um
  comentário no começo diz isso. Na aba de consulta, quando o resultado de uma tabela só é
  editável, a tabela e a chave são conhecidas, e "Gerar SQL" oferece também `UPDATE`, `DELETE`
  e `SELECT`; nos demais casos a tabela não é conhecida: só `INSERT`, e a tela pede o nome da
  tabela. O resultado abre numa aba de consulta nova da mesma conexão; nada é
  executado. Nomes entre aspas (RN-TABELA-002) e valores como literais do banco; linha com
  célula cortada ou binária numa coluna necessária não é gerada, e um comentário diz quais
  ficaram de fora.
- **RN-GRADE-007.** Exportar: um diálogo escolhe o que exportar (a seleção ou as linhas
  carregadas; o aviso de que as não carregadas não entram continua) e o formato: CSV, TSV, JSON,
  XLSX, HTML, Markdown, XML ou comandos `INSERT`. CSV e TSV seguem a RN-TABELA-006, inclusive o
  apóstrofo contra fórmula. JSON: uma lista de objetos, com número e booleano como tais quando
  o valor é representável sem perda, e nulo como `null`. XLSX: uma planilha com o cabeçalho,
  número como número quando cabe sem perder precisão (senão texto), data como texto, e texto
  sempre como texto — nunca fórmula. HTML, Markdown e XML escapam o que o formato exige. O
  último formato usado é lembrado por usuário.
- **RN-GRADE-008.** Exportar o resultado inteiro (todas as linhas, e não só as carregadas),
  executando o comando de novo numa sessão própria e gravando à medida que as linhas chegam,
  com progresso e cancelamento, é a tarefa seguinte a esta. No Commit manual, exportar o
  resultado inteiro avisa que o arquivo não terá o que a aba ainda não confirmou, porque a
  exportação roda em sessão própria.
- **RN-GRADE-009.** Largura das colunas: a divisa à direita do cabeçalho de cada coluna pode ser
  arrastada para alargar ou estreitar a coluna, e o duplo clique nela ajusta a coluna ao maior
  valor entre as linhas carregadas (até um teto). Pelo teclado, a divisa recebe foco e as setas
  mudam a largura. As larguras valem por aba enquanto ela estiver aberta: sobrevivem a executar
  de novo com as mesmas colunas, a filtrar, a ordenar e a "carregar mais", e voltam ao padrão
  quando as colunas mudam. Um valor que não cabe continua com reticências; alargar mostra o
  resto.
- **RN-GRADE-010.** Zoom da grade: de 50% a 200%, em passos, onde 100% é o tamanho de hoje. Os
  controles ficam na barra do resultado (diminuir, o valor atual — que volta a 100% ao ser
  clicado — e aumentar), e Ctrl+roda do mouse sobre a grade faz o mesmo. O zoom muda juntos o
  tamanho do texto, a altura das linhas e a largura das colunas; a rolagem e a lista virtual
  continuam certas em qualquer valor. Vale para as grades da aba de consulta e dos Registros, e
  é lembrado por usuário.
- **RN-CONFIG-006.** Configurações › Resultados ganha "Mostrar o tipo de dado no cabeçalho das
  colunas", ligado por padrão. Desligado, o cabeçalho mostra só o nome da coluna.
- **RN-TABELA-010.** A ordem faz parte do campo de filtro dos Registros. O campo recebe o que
  vem depois do nome da tabela: uma condição, uma ordem (`ORDER BY …`) ou as duas. Clicar no
  cabeçalho de uma coluna escreve ou troca o `ORDER BY` no próprio campo e executa, de modo que
  a ordem fica à vista e pode ser editada ou apagada ali. "Limpar" fica habilitado sempre que
  há filtro ou ordem, aplicados ou só digitados, e limpa os dois de uma vez. O ciclo do
  cabeçalho (crescente, decrescente, sem ordem) continua, e a seta do cabeçalho aparece quando
  a ordem aplicada é de uma coluna só. O seletor de nível de isolamento da aba (RN-ISOL-001)
  fica na mesma barra, ao lado do campo. Completa a RN-TABELA-005.

Aba do esquema e aba do banco (pedido do dono em 2026-10-12: "quando eu aperto 2x no banco de dados
ou 2x no schema, não me aparece as informações deles ou o diagrama inteiro, assim como o DBeaver
faz"):

- **RN-ESQUEMA-001.** Duplo clique (ou Enter) num esquema do navegador abre a aba dele, uma por
  esquema (abrir de novo volta para a que existe); o menu de contexto do esquema ganha "Abrir
  esquema" e "Ver diagrama do esquema". Abrir e fechar o nó na árvore continua pela seta, pelas
  setas do teclado e pelo clique na seta. A aba tem quatro vistas: Tabelas, Visões, Rotinas e
  Diagrama.
- **RN-ESQUEMA-002.** Tabelas, Visões e Rotinas listam os objetos do esquema com o que o
  catálogo informa: nome, tipo e, para tabela, a estimativa de linhas e o comentário, quando o
  banco os tem (RN-CAT-009). A lista tem um campo de filtro pelo nome, e o duplo clique numa
  tabela ou visão abre a aba dela.
- **RN-ESQUEMA-003.** Diagrama do esquema: todas as tabelas do esquema e as chaves estrangeiras
  entre elas, numa disposição automática; a tabela de outro esquema que uma chave aponta aparece
  como referência externa. Cada tabela mostra o nome e as colunas de chave (primária e
  estrangeira), com a opção de mostrar todas as colunas. Dá para rolar, ampliar, buscar uma
  tabela pelo nome (o diagrama a centraliza e a destaca) e destacar as relações da tabela
  escolhida; o duplo clique abre a aba da tabela. O diagrama é montado de UMA chamada à API
  (RN-CAT-008), não de uma por tabela. Num esquema grande demais para desenhar de uma vez, a
  tela diz quantas tabelas há e pede um filtro, em vez de travar.
- **RN-BANCO-001.** Duplo clique (ou Enter) no banco conectado abre a aba do banco: o nome da
  conexão, o banco, a versão do servidor, o endereço e o usuário da conexão (nunca a senha), as
  propriedades que o servidor informa (RN-CAT-010) e a lista dos esquemas com a contagem de
  tabelas, visões e rotinas. O duplo clique num esquema da lista abre a aba dele. O duplo
  clique na CONEXÃO continua conectando e abrindo o nó.
- **RN-CAT-008.** Diagrama do esquema: `GET …/schemas/{schema}/diagram` devolve
  `{ tables, foreignKeys }` — cada tabela com o nome e as colunas (nome, tipo, nulo, chave
  primária), e cada chave estrangeira com o nome, a tabela e as colunas de origem, o esquema, a
  tabela e as colunas referenciadas e as duas regras —, em consultas de catálogo por esquema, e
  não uma por tabela.
- **RN-CAT-009.** A lista de objetos (`…/objects?kind=tables`) ganha `estimatedRows` (a
  estimativa que o próprio banco guarda nas estatísticas, sem contar nada) e `comment`; os dois
  nulos quando o banco não informa.
- **RN-CAT-010.** Propriedades do banco: `GET api/user/database-sessions/{id}/properties`
  devolve uma lista de `{ name, value }` com o que cada servidor informa de útil sobre o banco
  conectado (no PostgreSQL, a codificação, a ordenação e o tamanho; no Informix, o modo de log e
  a localidade; no Db2, a página de código e o território), e `…/schemas` ganha, por esquema,
  a contagem de tabelas, visões e rotinas.

Marca (pedido do dono em 2026-10-12):

- **RN-MARCA-007.** O logotipo do Prism tem um desenho só: o do splash e da tela de login, de
  traço fino, exatamente como está. Ele mora em `assets/`, na raiz do repositório, em SVG e em
  PNG (gerados do SVG por um roteiro), e é desse arquivo que o cliente tira a marca em todos os
  lugares e tamanhos, escalada por igual: a barra superior, a tela de abertura, o bloqueio, o
  login e o splash. Não existe variante de traço mais grosso para tamanho pequeno, nem traço
  que não acompanha a escala. A variante para fundo claro (RN-MARCA-006) tem a mesma geometria
  e as mesmas grossuras: só mudam as cores que sumiriam no claro. Substitui o desenho de traço
  grosso que o canvas tinha para a barra. Na barra superior a marca tem 40 px de altura (decisão
  do dono, Ruling 137: abaixo disso o traço fino quase some); a barra cresce o que for preciso
  para ela caber, e os outros controles da barra não mudam de tamanho.
- **RN-MARCA-008.** "powered by Zanveri": o Prism é um produto da Zanveri, e isso aparece no
  splash (o texto "powered by" e o wordmark da Zanveri) e na barra superior do app (o texto, o
  monograma e o nome), que é também a barra da janela (RN-JANELA-001). Os arquivos da marca da Zanveri ficam em
  `assets/zanveri/`, como a empresa os entregou, sem redesenho nem recoloração: a versão clara
  sobre fundo escuro e a escura sobre fundo claro. O nome do processo e o do instalador não
  mudam.

Janela e zoom (pedido do dono em 2026-10-12):

- **RN-JANELA-001.** A janela principal não usa a barra de título do sistema: a barra superior
  do app é a barra da janela, como no VS Code. Ela arrasta a janela (menos sobre os controles e
  as entradas, que continuam clicáveis), o duplo clique nela maximiza e restaura, e os botões
  de minimizar, maximizar e fechar são os do próprio sistema, no lugar e com o comportamento de
  cada plataforma, nas cores do tema em uso. Vale em todas as telas da janela principal —
  abertura, login, bloqueio e área de trabalho —: em nenhuma delas a janela fica sem como ser
  arrastada, minimizada ou fechada. O título da janela continua "Prism" (é o que a barra de
  tarefas e o Alt+Tab mostram). Numa plataforma em que o sistema não ofereça os botões
  sobrepostos, a janela mantém a barra nativa.
- **RN-ZOOM-001.** Zoom do programa inteiro, como no VS Code e no Postman: `Ctrl +` (também
  `Ctrl =` e o `+` do teclado numérico), `Ctrl −` e `Ctrl 0` (Cmd no macOS), e um controle em
  Configurações › Aparência que mostra o valor de agora, com − e + e "Restaurar 100%". Os passos são
  os do zoom da grade: 50, 67, 75, 80, 90, 100, 110, 125, 150, 175 e 200%; 100% é o tamanho do canvas
  (RN-CONFIG-009), e nos limites o passo que não anda mais não faz nada.
  - Vale para todas as janelas do app, também as que abrem depois (RN-ABAS-002), e desde a
    abertura: o splash e o login já aparecem no zoom escolhido. O splash, que não tem moldura
    para ser arrastado, cresce só até caber na área útil da tela (RN-MARCA-002).
  - É lembrado nesta instalação, e não por usuário: a escolha mora com o processo principal, fora
    do cofre, porque o splash e o login vêm antes de se saber quem entra.
  - Os atalhos valem em qualquer tela e com o foco em qualquer lugar, inclusive no editor SQL e na
    grade, sem depender de menu (o app empacotado do Windows e do Linux não tem menu).
  - Quando a barra da janela for a do app (RN-JANELA-001), ela e os botões do sistema continuam
    alinhados em qualquer valor.
  - É independente do zoom da grade (RN-GRADE-010): Ctrl+roda do mouse sobre a grade continua
    sendo o zoom dela.

  Alterada em 2026-10-15, quando foi feita (pedido do dono, issue #14, seção 30): os passos, todas
  as janelas e o splash (até caber na tela), o "Restaurar 100%" e onde a escolha fica. Antes dizia
  "de 50% a 200%" e "todas as telas da janela principal".

## 21. O projeto no GitHub (decisões do dono em 2026-10-12)

O dono decidiu manter o repositório principal no GitHub ("por ele ser mais famoso") e trocar a
pipeline do GitLab pelo GitHub Actions; o GitLab sai de vez. No mesmo dia ele já tinha decidido
que a pipeline só roda quando um merge entra em `develop` ou em `main`, e que os arquivos de CI
ficam divididos por assunto. Respondendo às perguntas da migração, decidiu também que cada merge
na `develop` publica um beta e que o atualizador oferece o canal beta já nesta fatia. As regras
das seções 14, 15 e 17 que falavam do GitLab foram reescritas para o GitHub; esta seção junta o
que é novo.

- **RN-GITHUB-001.** O repositório principal é `github.com/Zanveri/prism`. Nada do GitLab fica no
  repositório: saem `.gitlab-ci.yml` e `.gitlab/`, e os documentos deixam de falar de GitLab (os
  registros de execução e esta especificação guardam a história; a limpeza deles é da Tarefa 19).
  O site de documentação (Tarefa 25) passa a ser publicado no GitHub Pages.
- **RN-GITHUB-002.** Organização da pipeline. O GitHub só lê workflows direto em
  `.github/workflows/`, sem subpastas; a divisão por assunto que o dono pediu fica assim: um
  workflow de entrada, disparado pelo merge em `develop` e em `main`, que chama workflows
  reutilizáveis, um por assunto (verificar, integrar, segurança, empacotar e lançar), e os passos
  repetidos (preparar o .NET, o Node e o pnpm) em actions compostas em `.github/actions/<nome>/`.
  Os roteiros continuam em `scripts/ci/`, com os testes ao lado. O que cada arquivo faz e a ordem
  das etapas ficam em `docs/ci.md`.
- **RN-GITHUB-003.** Contribuição (pedido do dono de 2026-10-11): issue primeiro, e o dono avalia
  se vira trabalho; ramos só criados por mantenedores, com os prefixos `feat/`, `fix/`, `chore/`,
  `docs/`, `ci/`, `refactor/` e `test/`; pull request para `develop`, que é o ramo padrão do
  repositório; de `develop` para `main` só pelo pull request de lançamento. Quem é de fora
  contribui por fork. Nenhum pull request roda pipeline (RN-ABERTO-005): quem revisa roda as
  verificações na própria máquina, com os comandos que o `CONTRIBUTING.md` lista, e a pipeline
  confirma depois do merge.
- **RN-GITHUB-004.** Custo. Cada merge na `develop` empacota as três plataformas e publica um beta
  (decisão do dono, sabendo do custo). Enquanto o repositório for privado, os minutos de runner
  contam no plano da organização, e os de Windows e de macOS valem mais que os de Linux; num
  repositório público, os runners hospedados padrão não cobram. A página de releases acumula um
  beta por merge; apagar os antigos fica para depois.
- **RN-GITHUB-005.** Origem gravada no pacote (RN-ATUALIZA-001): na hora de empacotar, a pipeline
  passa ao `pnpm dist` `PRISM_UPDATE_API` (o endereço da API do GitHub), `PRISM_UPDATE_SITE` (o
  do site), `PRISM_UPDATE_REPOSITORY` (`dono/repositório`) e `PRISM_HOMEPAGE` (a página do
  projeto), tirados do contexto do workflow. Os nomes dos pacotes, o `SHA256SUMS` e o bloco
  `### Somas SHA-256` das notas continuam sendo o contrato entre a pipeline e o app.

## 22. Transação manual, nível de isolamento e edição de célula

Pedido do dono em 2026-10-11 ("quero tudo isso") e em 2026-10-12, quando ele pediu para editar os registros à mão "tanto na
tab dos registros quanto no select que me volta através de script", como o DBeaver faz; as oito escolhas de comportamento são
dele (Ruling 138). Muda garantias das seções 5.3 e 5.5: até aqui toda sessão era auto-commit, os comandos de controle de
transação eram recusados e nada na tela gravava no banco sem um comando digitado. Princípio que atravessa tudo: **o Prism
nunca confirma uma transação sem a pessoa pedir, e quando ela é desfeita ou estragada sem pedido — pelo banco, pela queda da
sessão, pelo cofre que fecha — a tela diz.**

As marcas S-… são sondas da Tarefa 28-0, que as registra com cada resposta em `docs/superpowers/notes/2026-10-12-sondas-t28.md`;
até lá, o que depende delas está a provar.

### Transação

- **RN-TX-001.** A aba de consulta tem um modo de transação, escolhido na barra do editor ("Transação"): **Auto-commit**, em
  que cada comando é confirmado quando termina, como hoje, ou **Commit manual**. Uma aba nova começa no modo padrão de
  Configurações › Transações, que vem Auto-commit (RN-CONFIG-007). A aba de uma tabela é sempre Auto-commit. O modo é da aba:
  trocar de aba não muda o das outras.
- **RN-TX-002.** No Commit manual, nada do que a aba executa é confirmado no banco antes de a pessoa pedir. O primeiro comando
  executado — ou o primeiro "Salvar" de edições — abre a transação na sessão da aba, com o nível de isolamento da aba
  (RN-ISOL-001); os seguintes rodam nela. **Commit** confirma tudo o que está pendente; **Rollback** desfaz tudo. Depois de
  qualquer um dos dois não há transação aberta até o próximo comando. Um comando que só lê também abre a transação.
- **RN-TX-003.** O estado fica à vista. Com transação aberta, "Commit" e "Rollback" ficam habilitados na barra do editor (sem
  ela, desabilitados), e a barra de status diz o modo, o nível, quantos comandos estão sem commit e há quanto tempo a
  transação está aberta ("Commit manual · Read committed · 3 comandos sem commit · há 4 min"). Sem transação: "Commit manual ·
  <nível> · sem transação aberta"; em Auto-commit: "Auto-commit · <nível>". Com "Padrão do banco" o nível aparece assim,
  "Padrão do banco". **Transação com erro** (PostgreSQL, RN-TX-009): "Commit manual · <nível> · transação com erro: só resta o
  Rollback", no tom de erro, com "Commit" desabilitado (a dica diz por quê) e "Rollback" habilitado. Cada execução e cada
  alteração salva contam um comando. Passados 10 minutos com a transação aberta, o texto passa ao tom de atenção, porque as
  travas dela seguram outras sessões. Abrir, fechar e estragar a transação é anunciado a leitor de tela.
- **RN-TX-004.** Comandos de controle de transação digitados. **Em Auto-commit** continuam recusados (422
  `TRANSACTION_CONTROL_NOT_SUPPORTED`), e a mensagem passa a dizer que eles valem no Commit manual. **No Commit manual**, na
  forma de cada banco:
  - `COMMIT` e `ROLLBACK` (com `WORK` opcional; no PostgreSQL também `TRANSACTION`, `END` e `ABORT`) fazem exatamente o que os
    botões fazem; a resposta é a de um comando sem linhas, com o estado da transação. Numa transação com erro, o `COMMIT`
    digitado é recusado como o botão (RN-TX-009);
  - os pontos de salvamento digitados vão ao banco e valem dentro da transação: no PostgreSQL `SAVEPOINT`, `ROLLBACK TO` e
    `RELEASE`; no Db2 `SAVEPOINT ... ON ROLLBACK RETAIN CURSORS`, `ROLLBACK TO SAVEPOINT` e `RELEASE SAVEPOINT`; no Informix
    `SAVEPOINT`, `ROLLBACK WORK TO SAVEPOINT` e `RELEASE SAVEPOINT`. No PostgreSQL, o `ROLLBACK TO` digitado tira a transação do
    estado de erro, como o banco faz, e a barra volta ao normal;
  - `BEGIN`, `START TRANSACTION` e `BEGIN WORK` são recusados com a explicação de que o Prism já abre a transação no primeiro
    comando;
  - `COMMIT AND CHAIN`, `ROLLBACK AND CHAIN`, `PREPARE TRANSACTION`, `COMMIT PREPARED` e `ROLLBACK PREPARED` continuam recusados
    nos dois modos;
  - o comando que o banco não aceita dentro de transação: no PostgreSQL (`VACUUM`, `CREATE DATABASE`, `DROP DATABASE`, `CREATE`
    e `DROP TABLESPACE`, `ALTER SYSTEM`, `CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `REINDEX ... CONCURRENTLY`), o
    Prism recusa sem enviar (422 `COMMAND_NOT_ALLOWED_IN_TRANSACTION`), com a dica de executá-lo numa aba em Auto-commit, porque
    a recusa do banco estragaria a transação (RN-TX-009); o que a lista não conhecer chega ao banco e segue a RN-TX-009. No
    Informix (`DATABASE`, `CREATE DATABASE`) a recusa é do banco, e a transação continua.
- **RN-TX-005.** Trocar de Auto-commit para Commit manual vale a qualquer momento sem comando em andamento. Trocar de Commit
  manual para Auto-commit, com transação aberta, pergunta antes: Commit, Rollback ou Cancelar (com transação com erro, só
  Rollback ou Cancelar); sem transação, troca direto.
- **RN-TX-006.** **Saídas com transação aberta perguntam antes.** Fechar a aba, desconectar a conexão, excluir a conexão
  (RN-CONN-014), "Sair", fechar a janela ou o app, reiniciar o serviço (RN-DRIVER-005) e instalar uma atualização
  (RN-ATUALIZA-006): se alguma aba atingida tem transação aberta que gravou algo, um diálogo lista cada uma (conexão, comandos
  sem commit, há quanto tempo) e oferece "Commit", "Rollback" e "Cancelar"; a escolha vale para todas as listadas, e a
  transação com erro só pode ser desfeita. Se o banco recusar um Commit, a saída para ali: aquela aba mostra o erro, e o que
  ainda não foi feito fica como estava. "Cancelar" não faz nada. A transação em que tudo foi leitura não pergunta: é desfeita
  ao sair, porque não há o que confirmar; no PostgreSQL quem diz que nada foi gravado é o banco, e no Db2 e no Informix o
  Prism, pelo texto dos comandos — qualquer comando que não seja uma leitura simples, inclusive chamar uma rotina, conta como
  gravação. Alterações não salvas (RN-EDIT-007) são tratadas primeiro. O app que morre sem passar por aqui nunca confirma: o
  banco desfaz a transação ao perder a conexão. Ao fechar uma sessão com transação aberta por qualquer caminho, o Prism manda
  Rollback antes de fechar a conexão.
- **RN-TX-007.** O bloqueio por inatividade **desfaz** as transações abertas: o cofre fecha e as sessões caem (RN-COFRE-008). O
  aviso de 60 segundos diz quantas transações serão desfeitas e quantas alterações não salvas serão descartadas. Transação
  aberta sem comando em andamento não segura a contagem do bloqueio. Ao desbloquear, cada aba atingida diz, em tom de atenção,
  que a transação foi desfeita e quantos comandos não foram confirmados. No raro caso em que o serviço não responde ao bloqueio
  (RN-SEG-001: a tela desiste depois de um minuto), as transações ficam abertas no banco até o serviço fechar o cofre ou
  encerrar, e a tela de bloqueio diz isso.
- **RN-TX-008.** **Transação perdida sem pedido.** Quando a sessão cai (rede, banco reiniciado, servidor que encerra sessão
  parada em transação, serviço do Prism que caiu ou reiniciou) ou o cofre fecha por qualquer motivo (bloqueio, quinto erro
  seguido de senha ao revelar a de uma conexão ou ao trocar a própria, entrar com outro usuário, "Sair"), o banco ou o Prism
  desfazem a transação. A aba diz isso, em tom de atenção, com o número de comandos do último estado que recebeu. **No Commit
  manual a sessão perdida não é reaberta em silêncio, e o comando que descobriu a perda não é repetido:** a aba diz o que se
  perdeu, e a pessoa executa de novo, numa sessão e transação novas. Com transação aberta, os diálogos de senha (revelar e
  trocar) dizem que cinco erros seguidos fecham o cofre e desfazem as N transações abertas.
- **RN-TX-009.** **Erro dentro da transação: vale o que o banco faz**, e a tela diz em que pé a transação ficou:
  - **PostgreSQL**: qualquer erro de um comando — também o cancelamento (RN-TX-010), o impasse entre sessões e a falha de
    serialização — deixa a **transação inteira com erro**, como o banco faz; o Prism não marca ponto de salvamento por comando.
    A mensagem do banco aparece como hoje (RN-SQL-009), e a barra passa a "transação com erro: só resta o Rollback"
    (RN-TX-003). Até o Rollback, o Prism recusa sem enviar ao banco os comandos novos, o "Salvar", a contagem e o Commit (409
    `TRANSACTION_FAILED`, "a transação tem um erro: desfaça com Rollback"); o `ROLLBACK` digitado e o `ROLLBACK TO` de um ponto
    de salvamento que a pessoa criou valem (RN-TX-004). Fechar o cursor e ler as linhas que já estão na tela continuam valendo.
  - **Db2**: o banco desfaz só o comando que falhou, e a transação continua com o que estava pendente; a barra não muda. No
    SQLSTATE da classe 40 (impasse, tempo de trava esgotado: SQL0911N) o banco desfaz a transação inteira: a aba diz "o banco
    desfez a transação: N comandos não foram confirmados" e fica sem transação aberta.
  - **Informix**: o banco desfaz só o comando que falhou; depois de toda falha o Prism pergunta ao banco se a transação
    continua aberta, e, se não continua (transação longa, e o que a sonda S-IFX-4 mostrar), a aba diz que o banco a desfez,
    como no Db2.
- **RN-TX-010.** **Cancelar dentro da transação** (completa a RN-SQL-010, com as extensões da Ruling 135):
  - **PostgreSQL**: o comando cancelado responde `outcome: canceled`, e a transação fica com erro (RN-TX-009). Por isso, com
    transação aberta, o "Cancelar" de uma aba do PostgreSQL pergunta antes: "Cancelar deixa a transação com erro, e só restará
    o Rollback (N comandos sem commit)". Cancelar um "carregar mais" tem o mesmo efeito; fechar o cursor, não (RN-TX-011).
  - **Db2 e Informix**: cancelado durante a execução, `outcome: canceled`, e só aquele comando é desfeito (se a sonda S-DB2-4
    mostrar que o Db2 desfaz a transação inteira, a resposta diz isso e o "Cancelar" com transação aberta pergunta antes, como
    no PostgreSQL); cancelado enquanto devolvia as linhas, `outcome: partial`, e o que ele gravou até ali **ficou na transação,
    sem commit** — a tela diz isso, e não "está confirmado", que é o texto do Auto-commit.
  - Nos três, `outcome: unknown` (a sessão caiu sem resposta ao cancelamento) é a perda da RN-TX-008. A extensão `executed:
    true` de `TRANSACTION_CONTROL_NOT_SUPPORTED` não aparece no Commit manual (RN-TX-015). A tela decide pelo `outcome` e pelo
    estado `transaction` da resposta, nunca pelo texto.
- **RN-TX-011.** **Cursor dentro da transação.** As primeiras linhas, "carregar mais" (com o `pageSize` da RN-SQL-016) e o
  fechamento do cursor (no fim, num comando novo, ao fechar a aba, depois de 5 minutos sem leitura) valem como hoje, e **nem
  fechar o cursor antes do fim, nem o fim de um comando encerram ou confirmam a transação**. No PostgreSQL a leitura é paginada
  por um cursor do servidor, fechado sem cancelar; o que o banco não aceita como cursor (`SHOW`, `EXPLAIN`, `SELECT ... INTO`,
  `WITH` que grava) roda até o fim, sem "carregar mais", e fica pendente. Uma leitura que chama uma função que grava grava à
  medida que as linhas são lidas, e o que ela gravou fica pendente. O comando que grava e devolve linhas roda até o fim, como
  na RN-SQL-013, e fica pendente.
- **RN-TX-012.** **Contar total numa transação manual conta dentro dela**: o total inclui o que a aba gravou e ainda não
  confirmou, e a própria contagem nunca deixa gravação nem estraga a transação: no PostgreSQL ela roda num ponto de salvamento
  só dela, desfeito no fim, inclusive quando ela falha ou é cancelada. Enquanto conta, a aba fica ocupada: "carregar mais" e
  executar ficam indisponíveis até o fim da contagem (a API os recusa com 409 `SESSION_BUSY`, RN-SESSAO-002), e "Cancelar"
  interrompe só a contagem, sem fechar o cursor. No Db2 e no Informix isso
  depende da sonda S-IBM-3; se o driver não permitir, a contagem roda em outra conexão, como hoje, e a tela diz "o total não
  inclui o que esta aba ainda não confirmou".
- **RN-TX-013.** **Informix sem log** não tem transação: "Commit manual" aparece desabilitado na aba com o motivo ("este banco
  não tem log de transação"). A aba que estava no Commit manual descobre isso ao abrir a sessão, **antes** de executar: o
  comando que a pessoa mandou não é executado; a aba passa a Auto-commit, diz isso, e a pessoa executa de novo se quiser. A
  edição nesse banco segue a RN-EDIT-012.
- **RN-TX-014.** Avisos no Commit manual (completa RN-AVISO-002): o sucesso de um comando diz que ficou sem commit ("3 linhas
  afetadas, sem commit"); "Commit" avisa "Transação confirmada: N comandos"; "Rollback", "Transação desfeita: N comandos". Se o
  banco recusar o Commit, a mensagem é a dele, e a tela diz se a transação foi desfeita. O Prism nunca anuncia como confirmada
  uma transação que o banco desfez: no PostgreSQL ele nunca manda Commit numa transação com erro, e se o banco responder um
  Commit como desfeito, a tela diz "desfeita".
- **RN-TX-015.** A rede de segurança da RN-SESSAO-005 e as respostas que desfazem a transação depois de um cancelamento valem
  só em Auto-commit. No Commit manual do Informix, depois de cada comando o Prism pergunta ao banco se a transação continua
  aberta; se uma rotina a encerrou por dentro (um `COMMIT WORK` no corpo dela), a aba diz que o comando encerrou a transação e
  que o Prism não sabe se ela foi confirmada ou desfeita. No Db2 o mesmo caso depende da sonda S-DB2-6. No PostgreSQL ele não
  acontece (o banco recusa).
- **RN-TX-016.** O registro (log) ganha abrir, confirmar, desfazer, estragar e perder uma transação, com a sessão, o número de
  comandos e a duração, e nunca o SQL nem dados (RN-LOG-001).

### Nível de isolamento

- **RN-ISOL-001.** Cada aba — de consulta ou de tabela — tem um nível de isolamento. **Padrão do banco** quer dizer que o
  Prism não envia nada e vale o que o banco, o usuário do banco e a conexão já usam; a barra de status escreve "Padrão do
  banco". Uma aba nova começa no nível padrão de Configurações › Transações (RN-CONFIG-007). Na aba de consulta o nível se
  escolhe na barra do editor, ao lado do modo; na aba de uma tabela, na barra dos Registros, ao lado do filtro. O nível vale
  nos dois modos, no Db2 e no Informix conforme as sondas S-DB2-2 e S-IFX-2: o nível que não chegar ao banco num modo não
  aparece no seletor daquele modo.
- **RN-ISOL-002.** As opções de cada banco têm o nome que o banco usa:
  - **PostgreSQL**: Read committed, Repeatable read, Serializable. Read uncommitted não aparece: o PostgreSQL o trata como Read
    committed. Repeatable read e Serializable podem recusar um comando (40001) quando outra sessão mudou as mesmas linhas,
    também em Auto-commit.
  - **Db2**: Uncommitted Read, Cursor Stability, Read Stability, Repeatable Read. No banco com "currently committed" ligado (o
    padrão dos bancos criados a partir da versão 9.7), Cursor Stability já não espera pelas linhas que outra sessão está
    alterando: lê o último valor confirmado; Uncommitted Read lê o valor ainda não confirmado.
  - **Informix**: o driver leva quatro níveis, e é o servidor quem decide em qual nível do Informix cada um cai. A lista e os
    nomes saem da sonda S-IFX-2; o esperado, pela equivalência que a IBM documenta para `SET TRANSACTION`, é Dirty Read,
    Committed Read e Repeatable Read. Committed Read Last Committed só entra se a sonda provar que chega. Até a sonda, nenhum
    nível do Informix é "o padrão" na tela além de "Padrão do banco".
- **RN-ISOL-003.** O nível só muda sem transação aberta, sem comando em andamento e sem alterações não salvas. Com transação
  aberta o seletor fica desabilitado, com o motivo ("termine a transação com Commit ou Rollback para trocar o nível"). O nível
  novo vale a partir do próximo comando; nos Registros, a tabela é lida de novo com ele. No Informix trocar o nível reabre a
  sessão da aba: o cursor fecha, e o que foi configurado nela por comando (como `SET LOCK MODE TO WAIT` e tabelas temporárias)
  se perde; na aba de consulta a troca avisa antes; nos Registros, onde a sessão só roda o que o Prism monta, não há o que
  perder além do cursor.
- **RN-ISOL-004.** O nível chega ao banco pelo caminho que o banco respeita:
  - **PostgreSQL**: em cada transação que o Prism abre — a só de leitura das leituras paginadas, a do Commit manual e a de cada
    "Salvar" em Auto-commit —, e, em Auto-commit, o comando executado até o fim roda numa transação com o nível, confirmada
    antes da resposta (a mesma garantia da RN-SQL-013). O comando que o banco não aceita dentro de transação (25001) roda fora
    dela, no padrão do banco, e a resposta diz isso. Com "Padrão do banco" as transações abrem sem nível.
  - **Db2**: pelo registro de isolamento da sessão, que o Prism ajusta quando o nível muda (S-DB2-2), sem reabrir a sessão.
  - **Informix**: pelo driver, na abertura da sessão (S-IFX-2). Por este driver o comando `SET ISOLATION` não muda o nível
    (provado em 2026-10-12 para Dirty Read e Last Committed).

  Conferido com duas sessões, com uma linha alterada e não confirmada pela outra: no Informix, a aba em Dirty Read lê o valor
  não confirmado, e no padrão recebe a recusa de trava como hoje; no Db2, Uncommitted Read lê o valor não confirmado, e Cursor
  Stability lê o confirmado sem esperar (com "currently committed" ligado); no PostgreSQL, numa transação Repeatable read, o
  segundo `SELECT` não vê o que a outra sessão confirmou depois do primeiro.
- **RN-ISOL-005.** Comandos de nível digitados continuam indo ao banco como estão (RN-SQL-003), e a resposta diz o que eles
  fizeram: no Db2, `SET CURRENT ISOLATION` muda o nível de verdade, e o seletor passa a mostrar o que ele pôs; no PostgreSQL,
  `SET SESSION CHARACTERISTICS ...` e `SET default_transaction_isolation` mudam só o "Padrão do banco" desta sessão (o nível
  escolhido no seletor continua valendo em cada transação que o Prism abre); no Informix, `SET ISOLATION` e `SET TRANSACTION
  ISOLATION LEVEL` não mudam o nível por este driver, e o aviso diz para usar o seletor.
- **RN-ISOL-006.** Configurações › Transações usa os nomes do canvas, e cada aba os traduz para o banco dela:

  | Configurações | PostgreSQL | Db2 | Informix (S-IFX-2) |
  | --- | --- | --- | --- |
  | Padrão do banco | nada é enviado | nada é enviado | nada é enviado |
  | Read uncommitted | Read committed (o PostgreSQL não lê dado não confirmado) | Uncommitted Read | Dirty Read |
  | Read committed | Read committed | Cursor Stability | Committed Read |
  | Repeatable read | Repeatable read | Read Stability | Repeatable Read |
  | Serializable | Serializable | Repeatable Read | Repeatable Read |

### Edição de célula

- **RN-EDIT-001.** **Onde e como.** Na grade dos Registros de uma tabela, na grade do resultado de um comando da aba de
  consulta e na de cada aba de resultado do "Executar script" (RN-SQL-020 e 023), quando o resultado é editável (RN-EDIT-002).
  A edição parte da célula ativa da grade (RN-GRADE-001): F2, Enter, duplo clique, ou começar a digitar (o que substitui o
  valor). O campo de edição fica na própria célula, com "Confirmar edição (Enter)" e "Cancelar edição (Esc)", como no canvas;
  Tab e Shift+Tab confirmam e passam para a próxima célula editável. O menu de contexto (RN-GRADE-004) ganha "Editar célula"
  (F2), "Definir como nulo", "Desfazer alteração", "Adicionar linha" (Alt+Insert), "Duplicar linha" (Ctrl+Alt+Insert,
  RN-EDIT-016) e "Excluir linha" (Alt+Delete, na linha da célula ativa; e também Delete, com linhas inteiras escolhidas pelo
  número da linha). A barra de edição (RN-EDIT-013) deixa à vista "Editar célula", "Adicionar linha", "Duplicar linha" e
  "Excluir linha", com os mesmos atalhos (RN-EDIT-015). O que não se aplica aparece desabilitado, com o motivo. *Alterada a
  pedido do dono em 2026-10-16 (seção 33): "Linha nova" passou a se chamar "Adicionar linha" (as marcas da linha nova na grade
  continuam), e entraram "Duplicar linha", o Alt+Delete, a barra de edição e as abas do script.*
- **RN-EDIT-002.** **Quando um resultado é editável.** A edição vale **coluna por coluna, na tabela de onde a coluna veio**,
  também num resultado de junção.

  O **resultado inteiro** é só leitura quando o comando não é um `SELECT` só, ou tem `UNION`, `INTERSECT`, `EXCEPT` ou `MINUS`,
  `DISTINCT`, `GROUP BY`, `HAVING`, `FOR UPDATE`, `WITH`, ou subconsulta no `FROM`; quando ele gravou e devolveu linhas
  (RN-SQL-013); quando o Prism não consegue saber de onde vêm as colunas (RN-EDIT-003); ou quando a conexão é somente leitura
  (RN-PROT-002, pedido do dono em 2026-10-15). `WHERE` (com subconsultas dentro),
  `ORDER BY`, os limites de linhas de cada banco e as junções (`JOIN`, `LEFT`, `RIGHT` e `FULL JOIN`, `CROSS JOIN`, vírgula no
  `FROM`; no Informix também a forma `, OUTER tabela`) são permitidos.

  Cada **tabela do `FROM`** é uma tabela que se edita quando: é uma tabela, e não uma visão, visão materializada ou tabela
  estrangeira; aparece uma vez só no `FROM` (a mesma tabela duas vezes, ou duas tabelas de mesmo nome em esquemas diferentes,
  ficam só leitura); tem uma chave — chave primária, ou restrição única, ou índice único sem condição e só de colunas, com todas
  as colunas não nulas; e **essa chave está inteira no resultado**, como colunas daquela tabela (com qualquer apelido).

  Uma **coluna** do resultado é editável quando vem de uma tabela que se edita, e não é: calculada no comando (expressão,
  função, constante); gerada sempre pelo banco (identidade "sempre", coluna calculada da tabela; RN-CAT-001); binária; de um
  tipo que o Prism ainda não converte naquele banco (RN-EDIT-006); ou, num resultado de junção, uma coluna da chave. Uma
  **célula** é só leitura quando foi cortada (RN-SQL-011), quando a chave da tabela dela tem valor cortado ou binário naquela
  linha, e, numa junção externa, quando a tabela dela não tem linha ali (a chave veio nula).

  Num resultado de **uma tabela só**, valem também "Adicionar linha", "Duplicar linha" e "Excluir linha", e as colunas da
  chave são editáveis. Num resultado de **junção**, só se alteram células: uma linha de uma tabela que aparece repetida no
  resultado (a mesma chave em várias linhas da grade) muda em todas elas de uma vez, e conta como uma alteração.

  Os motivos ficam à vista: os do resultado inteiro na barra do resultado ("Somente leitura: união de consultas", "DISTINCT",
  "agrupamento", "SELECT ... FOR UPDATE", "subconsulta ou WITH no FROM", "o comando gravou e devolveu linhas", "o Prism não
  conseguiu saber de onde vêm as colunas", "a conexão é somente leitura"), sabidos sem consultar o banco; os de tabela e de coluna na faixa da grade quando a
  pessoa tenta editar e na dica do cabeçalho da coluna ("<tabela> é uma visão", "<tabela> aparece mais de uma vez no
  comando", "a chave de <tabela> não está inteira no resultado: faltam <colunas>", "<tabela> não tem chave primária nem chave
  única de colunas não nulas", "coluna calculada", "gerada pelo banco", "coluna da chave numa junção", "o Prism ainda não
  edita este tipo neste banco"). *Alterada a pedido do dono em 2026-10-16 (seção 33): entrou "Duplicar linha", e "Linha nova"
  passou a se chamar "Adicionar linha".*
- **RN-EDIT-003.** **De onde vem cada coluna.** No **PostgreSQL**, o próprio banco diz, na resposta do comando, de que tabela e
  de que coluna vem cada coluna do resultado (e que ela é calculada, quando não vem de nenhuma); o Prism só guarda isso, e
  descobre os nomes, a chave e o tipo de cada tabela no catálogo (RN-EDIT-010). A leitura do texto do comando entra só para as
  regras do resultado inteiro e para achar a tabela que aparece mais de uma vez. No **Db2 e no Informix**, que não dizem isso
  sem custo, o Prism lê o texto do comando:
  - o `FROM`: cada tabela, `[esquema.]tabela [[AS] apelido]`, ligada às outras por `JOIN ... ON`, `CROSS JOIN`, vírgula ou, no
    Informix, `, OUTER tabela`; o `OUTER (...)` com parênteses do Informix, `NATURAL JOIN` e `JOIN ... USING` com `*` deixam o
    resultado inteiro só leitura;
  - a lista do `SELECT`: `*`, `tabela.*` ou `apelido.*`, e `[tabela.]coluna [[AS] nome]`; o que for outra coisa é coluna
    calculada. O `*` vale as colunas de cada tabela na ordem do catálogo, tabela por tabela, na ordem do `FROM`; a coluna sem
    tabela é da única tabela do `FROM` que tem uma coluna com esse nome;
  - o resultado tem de bater com essa leitura: o número de colunas e o nome de cada uma, como o banco os devolve (no Db2, o
    nome sem aspas em maiúsculas; no Informix, em minúsculas). Se não bater, o resultado inteiro é só leitura, com o motivo
    "o Prism não conseguiu saber de onde vêm as colunas";
  - a tabela sem esquema é a do esquema atual da sessão da aba (Db2) ou a do dono que o banco resolver (Informix). O "Salvar"
    confere isso na própria sessão da aba antes do primeiro comando; se o esquema atual mudou desde a consulta, nada é
    executado e a tela diz por quê. Numa aba do script que não é a do último comando, outros comandos já rodaram na sessão
    depois da leitura: o que pode trocar o esquema atual (`SET`, `CALL`, `EXECUTE` e, no Informix, `DATABASE`), executado
    depois dela, tranca a edição da tabela sem esquema (RN-SQL-024).

  Um sinônimo ou apelido de tabela do Db2 e do Informix no `FROM` não é reconhecido como tabela, e as colunas dele ficam só
  leitura ("não é uma tabela"). *Alterada a pedido do dono em 2026-10-16 (seção 33): entrou a tabela sem esquema nas abas do
  script que se editam.*
- **RN-EDIT-004.** **Pendências** (dois passos: "Salvar" e, no Commit manual, Commit). Editar, definir nulo, criar linha,
  duplicar linha e excluir linha não vão ao banco: ficam pendentes na tela e destacados — a célula alterada mostra o valor lido
  riscado ao lado do novo (como no canvas), a linha nova (também a duplicada, RN-EDIT-016) é marcada no número da linha, e a
  linha excluída aparece riscada. Uma faixa sobre a grade diz quantas alterações há ("3 alterações não salvas") e tem "Ver
  SQL", "Descartar" e "Salvar" (Ctrl+S com o foco na grade). "Descartar" joga fora só o que não foi salvo, sem mexer na
  transação. "Desfazer alteração" tira uma pendência. As pendências atravessam a rolagem e o "carregar mais". A barra de edição
  (RN-EDIT-013) só cria e tira pendências: "Salvar", "Descartar" e "Ver SQL" ficam nesta faixa, que não muda. *Alterada a
  pedido do dono em 2026-10-16 (seção 33): entraram o duplicar e a barra de edição.*
- **RN-EDIT-005.** **Salvar** executa todas as pendências **numa transação só**, na sessão da aba: primeiro as exclusões,
  depois as alterações, depois as linhas novas, cada grupo na ordem em que foi feito. Cada alteração e cada exclusão é um
  comando pela chave da tabela dela (RN-EDIT-002), com os valores que a grade leu, e tem de afetar **exatamente uma linha**; se
  afetar zero ou mais de uma, ou se o banco recusar, tudo o que este "Salvar" fez é desfeito, e a tela diz qual linha falhou (e
  a destaca), quantas linhas o comando afetou ("a linha não existe mais, ou a chave dela mudou" para zero) e a mensagem do
  banco, como veio. A linha nova leva só as colunas que a pessoa preencheu (a duplicada, também as que a duplicação copiou,
  RN-EDIT-016); as outras ficam com o padrão da tabela. Os valores vão ao banco como parâmetros, nunca dentro do texto, e os
  nomes entre aspas duplas (RN-TABELA-002). Antes do primeiro comando o Prism confere no catálogo, dentro da mesma transação,
  que cada chave é a da tabela e que as colunas alteradas são editáveis; se uma tabela mudou, nada é executado e a tela diz por
  quê. *Alterada a pedido do dono em 2026-10-16 (seção 33): entrou a linha duplicada.*
  - **Em Auto-commit** (e na aba de uma tabela, sempre), o "Salvar" é uma transação própria, confirmada quando a resposta chega,
    e a falha desfaz tudo o que ele fez.
  - **No Commit manual**, o "Salvar" entra na transação da aba e fica pendente até o Commit. Para que a falha de um "Salvar"
    desfaça só o que ele fez, sem estragar a transação nem desfazer o que já estava pendente, o Prism o envolve num ponto de
    salvamento só dele (é o único, com o da contagem, RN-TX-012; os comandos digitados não ganham ponto de salvamento,
    RN-TX-009).
  - **No Informix sem log**, vale a RN-EDIT-012.
- **RN-EDIT-006.** **Conversão do valor digitado.** A célula viaja como texto (RN-SQL-011) e volta como texto. No PostgreSQL
  quem converte é o banco, como converteria um literal escrito na sessão (com o formato de data e o fuso dela): todo tipo que o
  banco escreve em texto e lê de volta é editável. No Db2 e no Informix quem converte é o Prism, do mesmo formato em que ele
  escreveu a célula, nunca dependendo do `DBDATE` nem da localidade do servidor: número com ponto; data `aaaa-mm-dd`; data e
  hora com as casas de fração que a coluna tem (de 0 a 12 no Db2; seis no `DATETIME` do Informix); hora sem fração; booleano
  do Informix como `0` ou `1`. Só os tipos que a sonda S-IBM-4 provar são editáveis: texto, inteiros, decimais, ponto
  flutuante, data, data e hora, hora e booleano. Os demais (intervalo, objetos grandes, coleções, tipos do usuário, XML) são só
  leitura. Texto que não converte é recusado antes de qualquer comando ir ao banco, apontando a célula.
- **RN-EDIT-007.** **Com alterações pendentes**, executar outro comando na aba, executar de novo ou "Atualizar", filtrar,
  ordenar (pelo cabeçalho, pelo menu ou pelo campo de filtro), filtrar pelo valor, chegar à aba por uma chave estrangeira
  (RN-TABELA-007, que filtra a aba de destino), trocar o modo ou o nível, Commit, Rollback, fechar a aba, trocar de aba de
  resultado do script (RN-SQL-023), levar a aba para outra janela (RN-ABAS-002 e 003), desconectar, excluir a conexão, "Sair"
  e fechar o app perguntam antes: "Há N alterações não salvas" com "Salvar", "Descartar" e "Cancelar" (nas saídas que atingem
  várias abas, só "Descartar" e "Cancelar"). Rolar, "carregar mais", copiar e exportar não perguntam; copiar leva o que está
  na tela, e exportar avisa que há alterações não salvas. O bloqueio por inatividade as descarta (RN-TX-007). *Alterada a
  pedido do dono em 2026-10-16 (seção 33): entrou a troca de aba de resultado do script, e a lista passou a dizer o levar a aba
  para outra janela, que já perguntava.*
- **RN-EDIT-008.** **Ver SQL** mostra, na ordem em que serão executados, os comandos que o "Salvar" vai executar, com os
  valores escritos como literais do banco para leitura; o valor que não tem literal (caractere de controle) aparece como `?`,
  com o valor ao lado. Diz que na execução os valores vão como parâmetros e, no Informix sem log, que cada comando é gravado
  sozinho (RN-EDIT-012). Dá para copiar. Não executa nada.
- **RN-EDIT-009.** **Depois de salvar**, a grade continua com as linhas que tinha, com os valores salvos (numa junção, em todas
  as linhas que mostram a mesma linha da tabela); as excluídas saem; a linha nova mostra o que foi digitado e, nas colunas que
  o banco preenche, "gerado pelo banco — execute de novo para ver". O cursor aberto fecha (salvar é um comando na sessão), e
  "carregar mais" dá lugar ao "executar de novo" da RN-SQL-007. Numa aba do script que não é a do último comando, o cursor que
  fecha é o do último, e é a aba dele que passa ao "executar de novo" (RN-SQL-023). O aviso diz "N alterações salvas"
  (Auto-commit) ou "N alterações salvas, sem commit" (Commit manual). *Alterada a pedido do dono em 2026-10-16 (seção 33):
  entrou o "Salvar" das abas do script.*
- **RN-EDIT-010.** **Custo.** Executar um comando não custa nenhuma consulta a mais ao banco por causa da edição: no PostgreSQL
  a origem das colunas vem na própria resposta, e no Db2 e no Informix o Prism lê o texto do comando. A primeira tentativa de
  editar um resultado consulta o catálogo uma vez, para todas as tabelas do `FROM` juntas — na sessão da árvore daquela
  conexão, quando ela está aberta, ou numa conexão à parte, com prazo de espera de trava — e a resposta vale para aquele
  resultado; cada "Salvar" consulta de novo, dentro da própria transação (RN-EDIT-005).
- **RN-EDIT-011.** **Concorrência:** o "Salvar" altera pela chave, sem conferir se outra pessoa mudou a linha depois da leitura,
  como o DBeaver. No Commit manual a linha alterada fica travada pelo banco até o Commit ou o Rollback.
- **RN-EDIT-012.** **Informix sem log** (sem transação): a edição vale, e o "Salvar" grava **uma alteração por vez**, na mesma
  ordem da RN-EDIT-005, cada uma confirmada sozinha quando termina, **sem tudo ou nada**. Enquanto houver pendências nesse
  banco, a faixa diz: "Este banco não tem log de transação: cada alteração é gravada sozinha, na hora. Se uma falhar, as
  anteriores já estão gravadas." O "Salvar" para na primeira alteração que falhar (o banco recusou, ou ela afetou zero
  linhas): as anteriores ficam gravadas e saem das pendências; a que falhou fica destacada, com a mensagem do banco; ela e as
  seguintes continuam pendentes. A tela diz quantas foram gravadas, qual falhou e quantas continuam pendentes ("2 alterações
  gravadas; a da linha 7 falhou; 3 continuam pendentes"). Se uma alteração afetar mais de uma linha (o que a chave conferida
  no catálogo não deixa acontecer), ela já está gravada e não há como desfazê-la: a tela diz quantas linhas ela alterou, e o
  "Salvar" para ali.

### Rotas e respostas

Novas, no padrão da seção 6:

| Rota | Sucesso | Recusas |
| --- | --- | --- |
| `PATCH api/user/database-sessions` `{ id, transactionMode?, isolationLevel? }` | 200 a sessão, com `transaction` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `TRANSACTION_OPEN`; 422 `TRANSACTION_MODE_INVALID`, `ISOLATION_LEVEL_INVALID`, `TRANSACTIONS_NOT_AVAILABLE` |
| `POST api/user/database-sessions/{id}/transaction/commit` | 200 `{ transaction, commands }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_OPEN_TRANSACTION`, `TRANSACTION_FAILED`; 422 `SQL_EXECUTION_FAILED` (com `transactionUndone` quando o banco desfez) |
| `POST api/user/database-sessions/{id}/transaction/rollback` | 200 `{ transaction, commands }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_OPEN_TRANSACTION`; 422 `SQL_EXECUTION_FAILED` (com `transactionUndone`: a conexão caiu, e a transação já estava perdida) |
| `POST .../queries/edit-target` `{ resultID, catalogSessionID? }` (`resultID`: seção 33, RN-SQL-024) | 200 `{ tables, columns, rowOperations, oneAtATime }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `RESULT_CHANGED`; 422 `RESULT_NOT_EDITABLE` (com `reason`), `SQL_EXECUTION_FAILED` |
| `POST .../queries/edits` `{ resultID, changes }` (`resultID`: seção 33, RN-SQL-024) | 200 `{ applied, transaction }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `RESULT_CHANGED`, `TRANSACTION_FAILED`; 422 `RESULT_NOT_EDITABLE`, `EDIT_INVALID` (com `change` e `column`), `EDIT_ROW_MISMATCH` (com `change` e `rowsAffected`), `SQL_EXECUTION_FAILED` (com `change`) |
| `POST .../queries/edits/preview` `{ resultID, changes }` (`resultID`: seção 33, RN-SQL-024) | 200 `{ statements: [{ sql, values }], oneAtATime }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `RESULT_CHANGED`; 422 `RESULT_NOT_EDITABLE`, `EDIT_INVALID` |

Notas:

- `edit-target` devolve `tables` (cada tabela do `FROM`: `{ schema, name, key: [coluna do resultado], editable, reason }`),
  `columns` (cada coluna do resultado: `{ table, baseColumn, editable, reason, nullable, generated }`, com `table` nulo na
  coluna calculada, e `generated` `always`, `byDefault` ou nulo; no PostgreSQL, a coluna cujo padrão é `nextval(...)`, o
  `serial`, também é `byDefault`, seção 33, RN-EDIT-016), `rowOperations` (verdadeiro só no resultado de uma tabela:
  "Adicionar linha", "Duplicar linha" e "Excluir linha") e `oneAtATime` (Informix sem log, RN-EDIT-012).
- `catalogSessionID` é a sessão da árvore da mesma conexão, que só a tela conhece; a API a usa se ela existe, é da mesma
  conexão e do mesmo cofre, e espera a vez nela como qualquer consulta de catálogo. Sem ela (ausente, inexistente, de outra
  conexão), a consulta vai numa conexão à parte, com prazo de espera de trava; não há recusa a mais.
- `changes`: lista de `{ kind: "update", table, key, set: [{ column, value }] }`, `{ kind: "delete", table, key }` e
  `{ kind: "insert", table, values: [{ column, value }] }`, com `table` pela posição em `tables`, `column` pela posição no
  resultado, `key` com os textos que a grade leu nas colunas da chave e `value` texto ou nulo. `delete` e `insert` só com
  `rowOperations`.
- No Informix sem log, as recusas de `edits` levam também `applied` (as alterações já gravadas antes da que falhou), e a
  resposta de sucesso é a de todas gravadas.
- `POST api/user/database-sessions` aceita `transactionMode` e `isolationLevel` (opcionais, com as recusas 422 do `PATCH`); no
  Informix sem log, `transactionMode: manual` é recusado com `TRANSACTIONS_NOT_AVAILABLE` antes de qualquer comando
  (RN-TX-013). A resposta ganha `transaction` e `transactionsAvailable`.
- O resultado (página ou linhas afetadas, o mesmo DTO) ganha `transaction` (`{ mode, isolationLevel, open, failed, commands,
  openedAt }`, o estado depois do comando) e `transactionUndone`. A página ganha `resultID` (muda a cada execução da sessão) e
  `editable` (`{ known: false }` enquanto só o catálogo sabe, ou `{ known: true, reason }` quando já se sabe que o resultado
  inteiro é só leitura, sem consultar o banco). As recusas 422 de comando levam `transaction` também, ao lado do `outcome` e
  do `executed` da Ruling 135. O `COMMIT` e o `ROLLBACK` digitados no Commit manual respondem como comando sem linhas
  (`rowsAffected` 0), com `transaction`.
- `TRANSACTION_FAILED` (409): no PostgreSQL, a transação tem um erro, e o Prism só aceita Rollback (RN-TX-009).
  `COMMAND_NOT_ALLOWED_IN_TRANSACTION` (422): comando que o banco não aceita dentro de transação, recusado sem ir ao banco
  (RN-TX-004).
- `transactionMode`: `autoCommit` ou `manual`. `isolationLevel`: `default` ou o código do nível do banco da sessão
  (PostgreSQL `readCommitted`, `repeatableRead`, `serializable`; Db2 `uncommittedRead`, `cursorStability`, `readStability`,
  `repeatableRead`; Informix, os da S-IFX-2).
- `TRANSACTION_CONTROL_NOT_SUPPORTED` passa a valer para: controle de transação em Auto-commit; `BEGIN` no Commit manual; e as
  formas que nunca valem (RN-TX-004).

### O que muda nas regras existentes

Cada mudança está escrita, inteira, na própria regra; aqui fica só a lista.

- **Seção 2**: a linha da entrega 2 perde a edição na célula, a transação manual e os níveis de isolamento, que entram por
  esta seção.
- **RN-SESSAO-002**: Commit, Rollback, a troca de modo ou de nível e o "Salvar" também recusam com `SESSION_BUSY`; no Commit
  manual a contagem ocupa a sessão.
- **RN-SESSAO-004**: com transação aberta, a sessão fecha depois da pergunta da RN-TX-006.
- **RN-SESSAO-005**: a sessão começa no modo da aba; a rede de segurança e a extensão `executed` são só do Auto-commit.
- **RN-SQL-003**: o controle de transação segue a RN-TX-004, com a recusa do que não roda em transação; no Commit manual do
  PostgreSQL, a leitura por cursor do servidor.
- **RN-SQL-006**: no Commit manual a contagem roda na sessão e a ocupa (RN-TX-012).
- **RN-SQL-007**: a transação só de leitura do cursor é do PostgreSQL em Auto-commit; no Commit manual, fechar o cursor não
  encerra a transação.
- **RN-SQL-010**: no Commit manual, `partial` fica na transação sem commit, e no PostgreSQL o cancelamento deixa a transação com
  erro.
- **RN-SQL-013**: "confirmado antes da resposta" só em Auto-commit; no Commit manual fica pendente.
- **RN-TABELA-002**: os registros passam a ser editáveis.
- **RN-TABELA-005**: o seletor de nível de isolamento na barra dos Registros.
- **RN-TABELA-007**: o salto para uma aba com alterações não salvas pergunta antes.
- **RN-TABELA-010**: o seletor de nível ao lado do campo de filtro e ordem.
- **RN-GRADE-004**: o menu ganha os itens da edição.
- **RN-GRADE-006**: a chave do SQL gerado é a da edição, e a aba de consulta gera também `UPDATE`, `DELETE` e `SELECT` quando
  o resultado de uma tabela só é editável.
- **RN-GRADE-008**: no Commit manual, exportar o resultado inteiro avisa que o arquivo não terá o que está sem commit.
- **RN-SEG-001**: o aviso antes do bloqueio diz o que será desfeito e descartado, e cada aba diz o que perdeu.
- **RN-CONN-002 e 003**: com transação aberta, o diálogo de revelar a senha avisa que cinco erros desfazem as transações (a
  frase fica na RN-CONN-003).
- **RN-CONN-014**: antes de encerrar sessões com transação aberta, vale a RN-TX-006.
- **RN-COFRE-008**: no "Sair" e no fechamento do app, vale a RN-TX-006.
- **RN-COFRE-013**: o mesmo aviso dos cinco erros, no diálogo de troca de senha.
- **RN-CONFIG-001**: Transações deixa de ser "em breve".
- **RN-CONFIG-007** (nova): o modo e o nível de isolamento padrão das novas abas.
- **RN-DRIVER-005**: antes de reiniciar o serviço, vale a RN-TX-006.
- **RN-ATUALIZA-006**: antes de instalar a atualização, vale a RN-TX-006.
- **RN-AVISO-002**: no Commit manual, os avisos da RN-TX-014.
- **Seção 6**: as rotas novas, os campos novos da sessão e do resultado, os códigos `TRANSACTION_FAILED` e
  `COMMAND_NOT_ALLOWED_IN_TRANSACTION` e as extensões `transaction`, `transactionUndone` e `applied`.
- **Seção 7**: a sessão que cai no Commit manual não é reaberta nem repete o comando sozinha (RN-TX-008).
- **Seção 9**: as diferenças do canvas no seletor de nível, no "Descartar", nos dois passos da edição e na barra dos Registros.
- **Seção 13** e o "fica para depois" da **seção 18**: saem a edição de célula e a transação manual.

### Por banco

| | PostgreSQL | Db2 | Informix |
| --- | --- | --- | --- |
| Como a transação manual abre | o Prism a abre, com o nível (ou sem, no "Padrão do banco"), antes do primeiro comando | o driver sai do auto-commit; `COMMIT` digitado não muda o driver, e por isso o Prism o intercepta | `BEGIN WORK` (o driver não fecha a transação aberta assim) ou a transação do driver, conforme a S-IFX-1 |
| Erro dentro da transação | a transação inteira fica com erro; só resta o Rollback | desfaz só o comando, menos a classe 40, que desfaz tudo | desfaz só o comando; a pergunta depois da falha diz se a transação acabou (S-IFX-4) |
| Cancelar | `canceled`, e a transação fica com erro (pergunta antes) | `canceled`, só o comando (S-DB2-4); `partial`, o gravado fica na transação | `canceled`, só o comando (S-IFX-3); `partial`, o gravado fica na transação |
| Fechar o cursor antes do fim | cursor do servidor, fechado sem cancelar | o leitor fecha sem cancelar (S-DB2-5) | o leitor fecha sem cancelar (S-IFX-9) |
| Contar total na transação manual | na sessão, num ponto de salvamento só da contagem | S-IBM-3 | S-IBM-3 |
| Falha de um "Salvar" no Commit manual | desfeita pelo ponto de salvamento do "Salvar" | idem (S-DB2-7) | idem (S-IFX-5) |
| Níveis | Read committed, Repeatable read, Serializable | Uncommitted Read, Cursor Stability, Read Stability, Repeatable Read | os quatro do driver, no que o servidor os traduzir (S-IFX-2) |
| Por onde o nível entra | em cada transação que o Prism abre | pelo registro de isolamento da sessão (S-DB2-2) | pelo driver, na abertura da sessão; trocar reabre a sessão |
| Leitura de linha que outra sessão está alterando, no padrão | não espera (o PostgreSQL nunca espera para ler) | não espera, com "currently committed" ligado | recusa na hora ("record is locked"), com o modo de trava padrão |
| Banco sem transação | — | — | sem log: sem Commit manual; a edição grava uma alteração por vez (RN-EDIT-012) |
| Quem converte o valor editado | o banco | o Prism | o Prism, sem `DBDATE` |
| De onde vem cada coluna | o banco informa, na resposta, a tabela e a coluna; o catálogo diz os nomes e a chave | a leitura do `FROM` e da lista do `SELECT` pelo Prism, contra o catálogo (S-IBM-6) | a leitura do `FROM` e da lista do `SELECT` pelo Prism, contra o catálogo (S-IBM-6) |
| Rotina que encerra a transação por dentro | não acontece (o banco recusa) | S-DB2-6 | a pergunta depois de cada comando detecta (RN-TX-015) |

### Fica para depois

- **Adicionar, duplicar e excluir linha num resultado de junção** (qual tabela recebe a linha, e o que fazer com as outras), e
  **"Gerar SQL" de `UPDATE` e `DELETE` por tabela** num resultado de junção.
- **A mesma tabela duas vezes** (auto-junção) editável, com cada ocorrência separada pelo apelido.
- **Subconsulta e `WITH` no `FROM`**, `NATURAL JOIN` e `USING` com `*` no Db2 e no Informix, o `OUTER (...)` com parênteses do
  Informix, e sinônimos e apelidos de tabela: hoje deixam só leitura. No PostgreSQL a origem dos dois primeiros já viria do
  banco; no Db2 e no Informix exigem uma leitura do comando mais funda.
- **`SELECT ... FOR UPDATE` editável.** Hoje o Prism o executa como comando que grava (nos três bancos) e ele não tem cursor;
  editar exige separá-lo do comando que grava nos dois modos.
- **Tabela sem chave nenhuma**, usando todas as colunas como chave, como o DBeaver oferece: duas linhas iguais não se separam,
  e o "exatamente uma linha" as recusaria.
- **Visão atualizável** e tabela estrangeira: só leitura até a leitura de "pode ser atualizada" de cada banco ser provada.
- **Colar em várias células**, preencher para baixo e editar valores binários ou maiores que o corte, por arquivo.
- **Mostrar o valor que o banco gerou** numa linha nova sem executar de novo (no PostgreSQL, `RETURNING`).
- **Manter o "carregar mais" depois de salvar.** Salvar é um comando na sessão e fecha o cursor (RN-EDIT-009).
- **Conferir o valor lido ao salvar** e **Commit manual na aba de uma tabela**, se o dono quiser depois.
- **Pontos de salvamento com botão**, "commit inteligente" (passar sozinho ao manual quando um comando grava), confirmação em
  duas fases e transação que atravessa um script de vários comandos. A execução de script entrou pela seção 31 (pedido do dono
  em 2026-10-15) e segue o modo da aba comando a comando, como se cada um fosse executado sozinho (RN-SQL-019); o script que é uma
  transação só, confirmada ou desfeita no fim, continua para depois.
- **Proteções** da entrega 3: entraram pela seção 32 (pedido do dono em 2026-10-15). A restrição da edição é a da RN-PROT-002
  (nenhuma edição na conexão somente leitura) e a da RN-PROT-001 (o "Salvar" pergunta em "Todos os comandos").

## 23. Complemento de 2026-10-13: abas que se movem, janelas e scripts salvos

Pedidos do dono em 2026-10-13: "poder mexer as tabs de lugar e até criar uma nova guia, como no
Chrome, pra caso eu queira utilizar em outra tela, assim como o DBeaver", e "salvar essas
consultas SQL, criptografadas, para que apenas o usuário consiga ver o que é aquele script".
Substitui, na seção 13, o "mais de uma janela" que ficava para depois.

### Abas e janelas

- **RN-ABAS-001.** As abas mudam de lugar arrastando-as ao longo da barra de abas; pelo teclado,
  Ctrl+Shift+PageUp e Ctrl+Shift+PageDown movem a aba ativa uma posição. A ordem vale enquanto a
  janela está aberta.
- **RN-ABAS-002.** Uma aba vai para uma janela nova arrastando-a para fora da janela (a janela nova
  abre onde ela foi solta) ou por "Mover para nova janela" no menu da aba. A janela nova é a área
  de trabalho inteira, com navegador e barra de abas próprios, e recebe a aba como ela estava: o
  texto do editor, o resultado na tela, o cursor aberto e a sessão com o banco, sem executar nada
  de novo.
- **RN-ABAS-003.** Uma aba passa de uma janela para outra arrastando-a até a barra de abas da outra,
  ou por "Mover para a janela…" no menu da aba, que lista as outras janelas abertas. A janela que
  fica sem abas continua aberta.
- **RN-ABAS-004.** Todas as janelas usam a mesma API, o mesmo cofre e as mesmas preferências: o
  bloqueio por inatividade e o "Sair" valem para todas, e o login libera todas. Fechar uma janela
  fecha as abas dela, com as mesmas perguntas de fechar cada aba; fechar a última encerra o app,
  como hoje.
- **RN-ABAS-005.** Só o processo principal cria janelas e passa abas entre elas; a tela pede pelo
  preload, por canais com o conteúdo validado (RN-SHELL-001), e nenhuma janela fala com outra
  diretamente.
- **RN-ABAS-008.** A aba de tabela mostra na barra só o nome da tabela enquanto as tabelas abertas na
  janela são todas de um esquema só (pedido de 2026-10-14). Com tabelas de mais de um esquema abertas
  (o mesmo esquema noutra conexão ou noutro banco conta como outro), todas mostram `esquema.tabela`.
  Com tabelas de mais de um banco, a de um banco que não é o da conexão mostra também o banco. O nome
  inteiro fica na dica da aba e na lista de abas.

### Scripts salvos

- **RN-SCRIPT-001.** Ctrl+S numa aba de consulta salva o SQL dela como script: na primeira vez pede
  o nome (sugerido "Script 1", "Script 2"…); depois grava por cima. "Salvar como" (Ctrl+Shift+S)
  grava com outro nome. O diálogo do nome, na primeira vez e no "Salvar como", tem o campo "Pasta"
  (RN-SCRIPT-010) e a caixa "Script genérico (sem conexão)" (RN-SCRIPT-005). A aba mostra o nome do
  script, e um ponto enquanto há mudança não salva; fechá-la assim pergunta se salva. *Alterada a
  pedido do dono em 2026-10-15, issue #9: entrou a caixa do script genérico; e em 2026-10-16 (seção
  33): entrou o campo "Pasta".*
- **RN-SCRIPT-002.** Os scripts são do usuário e moram no cofre dele, cifrados como o resto do cofre
  (RN-COFRE): só quem tem a senha do usuário os lê, nada vai em texto aberto para o disco, e o log
  nunca leva o texto do SQL. Acrescentar os scripts ao cofre subiu o número do formato dele (para o
  2), a área de trabalho o subiu para o 3 (RN-ABAS-006) e as pastas de scripts o sobem para o 4
  (RN-SCRIPT-011); um cofre antigo é migrado ao abrir (RN-VERSAO-005). *Alterada a pedido do dono
  em 2026-10-16 (seção 33): entraram as pastas de scripts.*
- **RN-SCRIPT-003.** O navegador tem a seção "Scripts", com as pastas de scripts e os scripts do
  usuário numa árvore (RN-SCRIPT-007 e 008): em cada pasta, e na raiz, as subpastas e depois os
  scripts, cada grupo em ordem de nome. Cada script se abre (duplo clique ou Enter), se renomeia, vai
  para outra pasta ("Mover para…", RN-SCRIPT-009), se exclui (com confirmação), tem "Copiar SQL" e,
  conforme o script, "Tornar genérico" ou "Vincular à conexão da aba" (RN-SCRIPT-005). O script
  lembra a conexão e o banco da aba em que foi salvo, menos o genérico, que não lembra nenhum
  (RN-SCRIPT-005); aberto, vira uma aba de consulta já nessa conexão e nesse banco. Se a conexão
  não existe mais, a aba abre sem conexão e pede para escolher uma.
  - Mudança não salva é o texto, a conexão (RN-ARVORE-008) ou o banco (RN-ARVORE-007) da aba
    diferente do que o script tem gravado. O Ctrl+S grava a conexão e o banco da aba junto com o
    texto. No script genérico só o texto conta.
  - As abas que voltam na próxima entrada (RN-ABAS-006) guardam essa marca, e a aba do script volta
    lembrando a conexão com que ele está gravado.
  - *Alterada a pedido do dono em 2026-10-15, issue #9: antes todo script lembrava uma conexão, e a
    mudança não salva era só o texto e o banco.*
  - *Alterada a pedido do dono em 2026-10-16 (seção 33): a lista virou a árvore das pastas de
    scripts, e o script ganhou "Mover para…".*
- **RN-SCRIPT-004.** Nome de 1 a 200 caracteres, sem caractere de controle e único por usuário
  (sem diferenciar maiúsculas); SQL de até 1 MB.

Rotas (todas exigem o cofre aberto; 401 `VAULT_LOCKED` e 503 `VAULT_UNAVAILABLE` como as demais):

| Rota | Sucesso | Recusas |
| --- | --- | --- |
| `GET api/user/scripts` | 200 lista de `{ id, name, connectionID, database, folderID, icon, color, updatedAt }`, sem o SQL (`icon` e `color`: RN-SCRIPT-006; `folderID`, nulo na raiz: RN-SCRIPT-007) | |
| `GET api/user/scripts/{id}` | 200 `{ id, name, connectionID, database, folderID, icon, color, sql, updatedAt }` | 404 `SCRIPT_NOT_FOUND` |
| `POST api/user/scripts` `{ name, sql, connectionID?, database?, folderID? }` (`folderID` ausente ou nulo: a raiz) | 201 | 404 `SCRIPT_FOLDER_NOT_FOUND`; 409 `SCRIPT_ALREADY_EXISTS`; 422 `SCRIPT_NAME_INVALID`, `SCRIPT_TOO_LARGE` |
| `PATCH api/user/scripts` `{ id, name?, sql?, connectionID?, database?, generic?, icon?, color?, folderID?, root? }` (`generic`: RN-SCRIPT-005; `icon` e `color`: RN-SCRIPT-006; `folderID` e `root`: RN-SCRIPT-009, seção 33) | 200 | 404 `SCRIPT_NOT_FOUND`, `SCRIPT_FOLDER_NOT_FOUND`; 409 `SCRIPT_ALREADY_EXISTS`; 422 `SCRIPT_NAME_INVALID`, `SCRIPT_TOO_LARGE`, `SCRIPT_PLACE_INVALID` (`generic` com `connectionID` ou `database`, ou `root: true` com um `folderID` não nulo), `SCRIPT_ICON_INVALID` (ícone fora da lista, cor fora de `#RRGGBB`) |
| `DELETE api/user/scripts/{id}` | 204 | 404 `SCRIPT_NOT_FOUND` |

### Ir do editor para a tabela

- **RN-LINK-001.** No editor SQL, com Ctrl apertado (⌘ no macOS), o nome de uma tabela ou visão sob o
  ponteiro fica azul e sublinhado, com o cursor de mão, e Ctrl+clique nele abre a aba da tabela nos
  Registros (RN-TABELA-001), na conexão e no banco da aba do editor. Vira link só o nome que o
  catálogo daquele banco conhece: com o esquema (`esquema.tabela`) ou sem ele (o esquema padrão da
  sessão), com ou sem aspas, nas regras de nome de cada banco. Fora de texto entre aspas simples e de
  comentário. Soltar o Ctrl ou tirar o ponteiro do nome desfaz o destaque.

### Renomear e duplicar no navegador

Pedido do dono em 2026-10-13: "F2 para renomear pastas e conexões, além da possibilidade de
duplicar a conexão" pelo botão direito.

- **RN-NAV-009.** No navegador, F2 na linha de uma pasta ou de uma conexão abre o "Renomear"
  dela: um diálogo só com o nome, que grava pelo `PATCH` (`api/user/folders` ou
  `api/user/connections`) sem mudar mais nada; na conexão, a senha incluída, e na pasta, a cor
  (RN-PASTA-007) e o ambiente. As recusas são as de sempre (nome repetido, nome inválido), no
  próprio diálogo. O menu de contexto da pasta e o da conexão têm "Renomear" (F2); o diálogo
  inteiro é o "Editar pasta…" (RN-PASTA-006) e o "Editar conexão". *Alterada a pedido do dono em
  2026-10-15, issue #8: a pasta usava o diálogo de "Renomear" que já existia, que virou o "Editar
  pasta…" (F2) com a RN-PASTA-006; agora ela tem o diálogo só com o nome, como a conexão.*
- **RN-CONN-016.** "Duplicar conexão" no menu de contexto da conexão cria, na mesma pasta, uma
  cópia com todos os campos e a senha salva. A senha é copiada dentro do cofre e não passa pela
  tela. O nome da cópia é "<nome> (cópia)"; se esse já existir, "(cópia 2)", "(cópia 3)" e assim
  por diante, cortando o nome original para caber no limite do nome. A cópia nasce desconectada e
  aparece selecionada no navegador, e nada abre sozinho. Rota:
  `POST api/user/connections/{id}/duplicate` → 201 com a conexão nova, no formato do
  `GET api/user/connections/{id}`; 404 `CONNECTION_NOT_FOUND`. O log registra os IDs, nunca a senha.

## 24. Complemento de 2026-10-13: fontes, troca de banco na aba e abas que voltam

Pedidos: do dono, "permita o usuário utilizar as fontes do sistema na aplicação geral e outra fonte
para o editor SQL"; e das issues 1 e 2 do repositório público: "ter uma opção de trocar o database
conectado para executar as queries" e "ter histórico caso o programa feche ou a conexão seja
fechada, assim, ao reabrir já retorna as queries feitas".

### Fontes

- **RN-CONFIG-008.** Configurações › Aparência ganha "Fonte da interface" e "Fonte do editor SQL".
  - Cada uma oferece a fonte que o app traz, que é o padrão (IBM Plex Sans na interface, IBM Plex
    Mono no editor), e as fontes instaladas no sistema, em ordem de nome e com busca pelo nome. A
    do editor mostra as monoespaçadas primeiro.
  - A escolha vale na hora, em todas as janelas, e fica nas preferências desta instalação, por
    usuário (RN-CONFIG-001).
  - A fonte da interface vale para todo o texto do app fora do código. A do editor vale para o
    editor SQL e para os campos de SQL que usam o mesmo editor (o filtro dos Registros, o "Ver SQL").
  - Uma fonte escolhida que não está mais instalada volta à do app, sem erro.
  - A lista é lida na máquina, sem rede, de preferência sem dependência nova (a API de fontes locais
    do Chromium ou o processo principal). Se a lista não puder ser lida, o campo aceita o nome
    digitado.

### Trocar o banco da aba de consulta

- **RN-ARVORE-007.** A barra do editor da aba de consulta mostra o banco em que a aba roda e deixa
  trocá-lo.
  - A lista traz os bancos do servidor, a mesma da RN-ARVORE-006. No Db2, só o banco da conexão, e
    a lista fica desabilitada com o motivo.
  - Trocar passa a aba para a sessão daquele banco, a mesma que a árvore abre (RN-ARVORE-006), sem
    executar nada. O texto do editor fica; o resultado e o filtro dele (RN-GRADE-011) saem, e o
    filtro não volta a ser aplicado no banco novo (corrigido em 2026-10-15; vale também para a troca
    da conexão, RN-ARVORE-008, e para o bloqueio, RN-SEG-001).
  - Com alterações não salvas na grade (RN-EDIT-007) ou com transação aberta, a troca pergunta
    antes, como ao executar outro comando.
  - O script salvo guarda o banco da aba (RN-SCRIPT-001).

### Abas que voltam na próxima entrada

- **RN-ABAS-006.** O Prism grava no cofre do usuário, cifradas como os scripts (RN-SCRIPT-002), as
  abas abertas de todas as janelas:
  - de cada aba de consulta: o texto do editor, a conexão, o banco, o script de onde veio (se veio)
    e se tem mudança não salva;
  - de cada aba de tabela: a conexão, o banco, o esquema, a tabela e a vista;
  - a ordem das abas e qual estava ativa.

  Quando grava:
  - alguns segundos depois de cada mudança, para um fechamento inesperado perder no máximo esses
    segundos;
  - ao fechar uma aba;
  - antes de o cofre fechar (sair, bloqueio por inatividade, fechar o app).

  O que volta:
  - Na próxima entrada do mesmo usuário, as abas voltam na janela principal, na ordem em que
    estavam.
  - Voltam desconectadas: nada conecta nem executa sozinho.
  - O resultado, o cursor e as alterações não salvas da grade não voltam.
  - A aba de consulta cuja conexão foi excluída volta sem conexão, como um script sem conexão. A aba
    de tabela cuja conexão foi excluída não volta, e a entrada avisa.
  - O texto de cada aba vai até 1 MB (RN-SCRIPT-004). O que passa disso não é gravado, e a aba volta
    vazia, com o aviso.
  - Fechar uma aba a tira do que volta.

- **RN-ABAS-007.** Fechar o app (a última janela) pergunta só pelo que não volta: as alterações
  não salvas da grade (RN-EDIT-007). O texto das abas de consulta e os scripts com mudança não
  salva voltam na próxima entrada (RN-ABAS-006), então não há pergunta por eles. Fechar uma aba,
  várias abas ou uma janela que não é a última pergunta como antes, porque o que fecha não volta,
  e a pergunta diz isso.

| Rota | Sucesso | Erros |
| --- | --- | --- |
| `GET api/user/workspace` | 200 `{ tabs, activeIndex }` (lista vazia e `activeIndex` nulo quando nada foi gravado) | |
| `PUT api/user/workspace` `{ tabs, activeIndex }` | 204 | 422 `WORKSPACE_INVALID` (formato, índice fora da lista), `WORKSPACE_TOO_LARGE` (texto de uma aba acima de 1 MB) |

O log dessas rotas registra só a contagem de abas, nunca o SQL nem os nomes.

## 25. Complemento de 2026-10-13, versão 0.3.0: o instalador do Windows como o do DBeaver

Pedido do dono: "o DBeaver, quando eu baixava, executava um .exe e pedia permissão de admin do
Windows; quando eu negava, ele continuava e instalava normalmente". Entra na 0.3.0, depois da 0.2.0
estável.

- **RN-INSTALA-001.** Ao abrir, o instalador do Windows (`Prism-<versão>-win-x64.exe`) pede a
  permissão de administrador, pelo pedido do próprio Windows.
  - Com a permissão, instala para todos os usuários da máquina, na pasta de programas do sistema.
  - Sem ela (o pedido negado, ou uma conta sem administrador), segue sem erro e instala só para o
    usuário, na pasta de programas do perfil, como hoje.
  - Nos dois modos, cada usuário guarda os próprios dados (os cofres) no perfil dele
    (`%APPDATA%\Zanveri\Prism`), e o app é o mesmo.
- **RN-INSTALA-002.** Nunca ficam duas instalações. O instalador reconhece a que já existe e a
  atualiza no mesmo modo, sem pedir a permissão quando ela é só do usuário. Quem quiser trocar de
  modo desinstala antes.
- **RN-INSTALA-003.** A atualização de dentro do app (RN-ATUALIZA-006) continua: o Prism confere o
  instalador, se encerra, o instalador atualiza e o Prism abre de novo.
  - Na instalação só do usuário, nada muda: sem pergunta e sem janela.
  - Na instalação para todos, o Windows pede a permissão de administrador a cada atualização. Se ela
    for negada, nada é instalado, o Prism abre de novo na versão que estava e avisa.
- **RN-INSTALA-004.** O instalador silencioso aceita escolher o modo pela linha de comando, para
  quem instala em várias máquinas: `/S /allusers` ou `/S /currentuser`.
### Valor completo das células cortadas

Defeito relatado pelo dono em 2026-10-13: copiar uma célula `CLOB` do Informix (um JSON longo) com
Ctrl+C ou "Copiar valor" levou o texto cortado. Num cliente de banco a cópia tem de ser o valor
inteiro.

- **RN-SQL-017.** A grade continua mostrando o valor cortado (RN-SQL-011). Copiar (Ctrl+C,
  "Copiar valor", copiar avançado) e exportar levam o valor completo, como veio do banco.
  - A API guarda, em memória e só no processo dela, o valor completo de cada célula que cortou,
    nas páginas que já entregou do resultado atual. Nunca grava em disco, nunca no log.
  - Ela guarda até 256 MB por sessão. Passando disso, as células seguintes ficam sem valor
    completo, e a página diz quais.
  - Larga tudo quando a aba executa outro comando, quando o resultado é descartado e quando a
    sessão fecha.
  - Copiar ou exportar uma célula sem valor completo leva o valor cortado e avisa quantas foram.
  - O texto vai inteiro. O binário vai como a grade o escreve (hexadecimal), inteiro.

| Rota | Sucesso | Erros |
| --- | --- | --- |
| `POST api/user/database-sessions/{id}/results/{resultID}/cells` `{ cells: [{ row, column }] }` (até 10.000 células por pedido) | 200 `{ values: [{ row, column, value }] }`, na ordem pedida; `value` nulo quando a célula não tem valor completo | 404 `DATABASE_SESSION_NOT_FOUND`, `RESULT_NOT_FOUND` (outro comando já rodou); 422 `CELLS_INVALID` (lista vazia, acima do limite, linha ou coluna fora do resultado) |

O log dessa rota registra só a contagem de células, nunca o valor.

### Ambiente da pasta e o seletor de cor

Pedidos do dono em 2026-10-13: "as pastas terem seus ambientes também, por exemplo uma pasta só de
production, outra só de QAS, outra de develop"; e o seletor de "Outra cor" abria ao clicar em
qualquer ponto da linha dele, e deve virar uma bolinha ao lado das outras, com o ícone de
conta-gotas. Antecipa da entrega 3 o "ambiente herdado da pasta"; as proteções herdadas continuavam
lá, e entraram pela seção 32 (pedido do dono em 2026-10-15).

- **RN-PASTA-005.** A pasta pode ter um ambiente, com nome e cor, nas mesmas regras do ambiente da
  conexão (RN-CONN-010: nome opcional de até 30 caracteres, cor `#RRGGBB`). Só o nome faz um
  ambiente: pasta ou conexão só com cor herda o de cima, e a subpasta sem ambiente não mostra o da
  pasta de cima.
  - O diálogo de nova pasta e o "Editar pasta…" (RN-PASTA-006) ganham a seção Ambiente, a mesma do
    formulário da conexão. *Alterada a pedido do dono em 2026-10-15, issue #8: era o diálogo de
    renomear, pelo F2, que agora muda só o nome (RN-NAV-009).*
  - O ambiente da pasta aparece como etiqueta colorida ao lado do nome dela na árvore.
  - A conexão sem ambiente próprio herda o da pasta mais próxima acima dela que tenha um. Ela mostra
    o herdado em todo lugar onde mostraria o próprio (RN-CONN-015: lista, árvore, aba e barra de
    status). O ambiente próprio da conexão sempre ganha.
  - Mover a conexão ou a pasta muda o que ela herda. O formulário da conexão sem ambiente próprio
    diz qual ela herda e de qual pasta.
  - As rotas de pastas (`GET`, `POST` e `PATCH api/user/folders`) recebem e devolvem
    `environmentName` e `environmentColor`, opcionais, com as recusas do ambiente da conexão em
    `FOLDER_NAME_INVALID` ou num código próprio, como a conexão já faz.
  - A pasta tem também as proteções da conexão, "Confirmar antes de executar" e "Somente leitura"
    (RN-PROT-001 e 002), no diálogo de nova pasta e no "Editar pasta…", depois da seção Ambiente.
    Ao contrário do ambiente, elas valem para tudo o que está dentro da pasta, a qualquer
    profundidade, e a conexão não as afrouxa (RN-PROT-004). *Alterada a pedido do dono em
    2026-10-15 (seção 32): entraram as proteções da pasta.*
- **RN-CONN-017.** O seletor de cor do ambiente (da conexão e da pasta) é uma fileira de bolinhas.
  - A última bolinha é "Outra cor", com o ícone de conta-gotas. Só ela abre o seletor de cor do
    sistema; clicar em outro ponto da fileira ou da seção não abre nada.
  - Com uma cor escolhida por ela, a bolinha fica com essa cor, a marca de escolhida das outras e o
    conta-gotas ainda à vista, em contraste. O código `#RRGGBB` aparece na dica e no nome acessível.
  - A linha "Outra cor #RRGGBB" de baixo sai.
  - Pelo teclado: cada bolinha é um botão, e Enter ou Espaço na última abre o seletor.

### Filtrar como no DBeaver, e o autocompletar do filtro

Pedidos do dono em 2026-10-14: "adiciona os filtros do DBeaver exatamente como ele faz, atalho em
F11, exibe os possíveis filtros pra coluna, isso tanto no resultado de um script SQL quanto nos
registros"; e de um colega: "o filtro na tabela não recomenda as colunas". Substitui a RN-GRADE-005,
que valia só nos Registros e nunca chegou à tela.

- **RN-GRADE-013.** O menu de contexto da grade ganha "Filtrar" (F11), nos Registros e no
  resultado da aba de consulta. F11 abre o submenu na célula ativa, e Ctrl+F11 abre direto
  "Filtrar por valor…". Os itens do submenu:
  - "Filtrar por valor…" (Ctrl+F11): um diálogo com os valores distintos da coluna nas linhas já
    carregadas, cada um com quantas vezes aparece, em ordem de quantidade, com busca e caixas de
    marcar. Confirmar monta `coluna IN (…)` (`=` com um valor só), e o nulo marcado entra como
    `coluna IS NULL`, junto por `OR`.
  - "Valor da célula": `coluna = valor`, `coluna <> valor`, `coluna > valor` e `coluna < valor`;
    em coluna de texto, também `coluna LIKE '%valor%'`; e "É nulo" e "Não é nulo".
  - "Personalizado": `coluna = …`, `<> …`, `> …` e `< …`, que pedem o valor num campo pequeno, sobre
    a grade.
  - "Remover todos os filtros e ordenações".

  O valor vira literal pela RN-TABELA-007, e o rótulo mostra a condição como ela vai entrar. A
  célula cortada ou binária só oferece as opções de nulo e o "Personalizado". A condição entra no
  campo de filtro, junta por `AND` e entre parênteses ao que já estava (o `mergeCondition` de
  `_lib/grid-export`), e é executada. Quando não dá para juntar com segurança, o item fica
  desabilitado, com o motivo.
- **RN-GRADE-011.** O resultado da aba de consulta ganha o campo de filtro dos Registros, acima da
  grade, com o mesmo texto de ajuda ("Insira uma expressão SQL para filtrar os resultados (use
  Ctrl+Espaço)").
  - O texto do editor não muda. Ao aplicar, a aba executa de novo o mesmo comando com o filtro, e
    a API junta o filtro ao comando: a condição entra no `WHERE` por `AND`, e a ordem troca o
    `ORDER BY` do comando.
  - Quando o comando não é um `SELECT` só que a API saiba ler, ela o embrulha
    (`SELECT * FROM (<comando>) … WHERE …`). Nesse caso, o resultado fica só leitura e diz por
    quê.
  - Executar o comando do editor de novo limpa o filtro.
  - Rota: `POST api/user/database-sessions/{id}/queries` ganha `filter`, opcional: o texto do campo
    (condição, ordem ou as duas, como na RN-TABELA-010).
  - A resposta diz como o filtro entrou, em `filterApplied`: `merged` ou `wrapped`.
  - O filtro com terminador de comando, com comentário aberto ou com aspas abertas é recusado com
    422 `FILTER_INVALID`.
- **RN-TABELA-011.** O campo de filtro (dos Registros e do resultado) completa os nomes das colunas
  e as palavras do filtro: `AND`, `OR`, `NOT`, `IS NULL`, `IS NOT NULL`, `LIKE`, `IN`, `BETWEEN`,
  `ORDER BY`, `ASC` e `DESC`.
  - Ao digitar, segue a chave do autocompletar do editor (RN-CONFIG-004). Com Ctrl+Espaço,
    completa sempre.
  - Nos Registros, as colunas são as da tabela. No resultado, as do resultado.
  - O nome é escrito como o banco pede (com aspas, quando precisa).
- **RN-GRADE-012.** F5 atualiza, como no DBeaver (pedido de 2026-10-14: "F5 não atualiza os dados").
  - Nos Registros, F5 lê a tabela de novo, com o filtro e a ordem do campo: é o "Atualizar".
  - Na aba de consulta, F5 executa de novo o comando do resultado, com o filtro: é o "Executar de
    novo".
  - Na Estrutura e no Diagrama, F5 recarrega a vista.
  - No navegador, F5 atualiza o nó escolhido, como o "Atualizar" do menu dele.
  - Com alterações não salvas na grade, F5 pergunta antes, como executar outro comando. Com um
    comando em andamento, não faz nada.
  - Vale com o foco em qualquer ponto da aba, menos no campo de edição de uma célula.
  - O menu da grade mostra "Atualizar" (F5).
  - F5 e Ctrl+R nunca recarregam a janela do app.
- **Fica para depois:** "Localizar e Substituir" na grade, salvar o filtro como padrão da tabela,
  voltar ao filtro padrão e o diálogo "Personalizar filtros…".

### Editar pasta, ambientes reaproveitados e o filtro por ambiente

Pedido do dono em 2026-10-14: "não dá pra editar pasta: queria pôr o ambiente numa pasta que já
existia e não tem a opção no botão direito"; "depois de criar o ambiente, salve para que ele possa
ser reutilizado; assim dá pra agrupar tudo e até criar um filtro no navegador que busca só pelo
ambiente".

- **RN-PASTA-006.** O menu da pasta tem "Editar pasta…", sem atalho, que abre o diálogo "Editar
  pasta", com o nome, a cor da pasta (RN-PASTA-007) e a seção Ambiente (RN-PASTA-005). O
  "Renomear" (F2) fica ao lado dele e muda só o nome (RN-NAV-009). *Alterada a pedido do dono em
  2026-10-15, issue #8: antes o "Renomear" tinha virado o "Editar pasta…", com o F2, e o diálogo
  não tinha a cor da pasta.*
- **RN-AMB-001.** Os ambientes do usuário são os que as pastas e as conexões dele já usam: cada nome
  distinto (sem diferenciar maiúsculas), com a cor da pasta ou conexão alterada por último. Nada é
  gravado à parte; o ambiente some da lista quando ninguém mais o usa.
  - A seção Ambiente (da conexão e da pasta) mostra, acima do campo do nome, os ambientes do
    usuário como etiquetas coloridas. Escolher uma preenche o nome e a cor, que continuam
    editáveis.
  - O campo do nome também completa com eles ao digitar.
- **RN-NAV-010.** O navegador ganha, ao lado do campo de filtro, um seletor de ambiente: "Todos os
  ambientes" (o padrão), cada ambiente do usuário (RN-AMB-001) e "Sem ambiente".
  - Com um ambiente escolhido, a árvore mostra só as conexões cujo ambiente (próprio ou herdado da
    pasta, RN-PASTA-005) é esse, e as pastas no caminho até elas.
  - Ele se combina com o campo de filtro de objetos.
  - A escolha vale enquanto a janela está aberta.
  - O seletor mostra a etiqueta colorida do ambiente escolhido, e "Limpar" volta a "Todos".

## 26. Complemento de 2026-10-15, versão 0.4.0: a linha em branco separa os comandos (issue #7)

Pedido da issue 7 do repositório público, aprovado pelo dono em 2026-10-15 ("Faça todas issues, todas
elas parecem boas mesmo"): "ctrl + enter no script executar apenas a query separada por enter". Quem
vem do DBeaver separa os comandos com uma linha em branco, sem selecionar o texto e sem terminar cada
um com `;`; no Prism, dois `SELECT` separados só por uma linha em branco iam juntos, e o banco
respondia erro de sintaxe. Muda a RN-SQL-002, e a RN-SQL-001 passa a citar esta regra.

- **RN-SQL-018.** Sem seleção, a linha em branco (só espaços e tabulações) também termina o comando
  do cursor, como o "Smart" do DBeaver, porém com mais cuidado, porque o Prism ainda não confirma
  comando irreversível (seção 13): na dúvida, não separa, e o banco recusa o texto inteiro em vez
  de executar a metade dele.
  - Nunca separa dentro de texto entre aspas simples, de identificador entre aspas duplas, de
    comentário, de `$tag$ ... $tag$`, nem dentro de um bloco com `;` no corpo (rotina, gatilho,
    bloco composto: os da RN-SQL-001), que continua sendo executado selecionando-o. No Db2, depois
    que o bloco começa (`CREATE PROCEDURE`, `FUNCTION`, `TRIGGER` ou `BEGIN`), não separa até o fim
    do texto, a mesma conta da RN-SQL-001; o `BEGIN` vale também fora do começo do comando: depois
    de uma linha em branco, que ele não separa (com `SELECT …`, a linha em branco e `BEGIN … END`,
    nenhuma linha em branco do bloco separa), de um rótulo (`nome: BEGIN`) ou de outro comando. No
    Informix, até o `END PROCEDURE` ou o `END FUNCTION`.
    `CREATE TRIGGER` e `CREATE SCHEMA` também não se separam antes do `;`, nos três bancos: o
    `CREATE SCHEMA` traz os objetos dele (`CREATE TABLE`, `CREATE VIEW`, `CREATE INDEX`, `GRANT` e,
    no Db2, `COMMENT ON`) sem `;` entre eles, e separar ali criaria o esquema sozinho e depois a
    tabela fora dele.
  - Separa só quando o texto depois da linha em branco (e dos comentários que vierem) começa um
    comando: `SELECT`, `WITH nome [ ( … ) ] AS (`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `VALUES`,
    `CREATE`, `ALTER` e `DROP` seguidos do tipo do objeto (`TABLE`, `VIEW`, `INDEX`…), `TRUNCATE`,
    `GRANT`, `REVOKE`, `CALL`, `EXECUTE`, `EXPLAIN`, `COMMENT ON`, `ANALYZE`, `VACUUM`,
    `LOCK TABLE`, `SHOW`, `COPY`, `DECLARE`, `REFRESH`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` e `DO`
    seguido do corpo. `SET` não começa comando aqui (`UPDATE t`, a linha em branco e `SET …` são um
    comando só), nem `BEGIN` (abre bloco), nem o `WITH UR|CS|RS|RR` do Db2. Dentro de um `ALTER`,
    `ALTER`, `DROP`, `GRANT` e `REVOKE` também não começam outro, porque podem ser cláusulas dele.
  - E só quando o texto antes dela está fechado: os parênteses equilibrados; não termina em
    vírgula, em operador nem em palavra que pede continuação (`WHERE`, `AND`, `OR`, `NOT`, `ON`,
    `JOIN`, `FROM`, `SELECT`, `SET`, `BY`, `UNION`, `ALL`, `INTERSECT`, `EXCEPT`, `MINUS`, `THEN`,
    `ELSE`, `WHEN`, `CASE`, `AS`, `IN`, `INTO`, `VALUES`, `LIKE`, `BETWEEN`, `IS`, `ON COMMIT`…); e
    não é o começo de um comando que ainda espera o corpo: o `INSERT` antes do `VALUES` ou do
    `SELECT`, o `WITH` antes do comando principal, o `EXPLAIN` antes do comando.
  - Assim, `DELETE FROM t`, a linha em branco e `WHERE id = 1` são um comando só, e
    `INSERT INTO t (a)`, a linha em branco e `SELECT a FROM s` também.
  - O comentário logo acima do comando de baixo vai com ele, como no `;`.
  - Com o cursor numa das linhas em branco que terminaram o comando de cima por esta regra (também
    com um comentário solto entre ele e o de baixo), executa o de cima, como no DBeaver. Na linha em
    branco sem comando nenhum acima dela no texto (no começo do texto, ou só com comentários acima),
    nada é executado ("Não há comando para executar."), mesmo que haja um abaixo. Nas outras
    linhas em branco fora de comando, as que vêm depois de um comando terminado no `;`, vale a regra
    de antes (RN-SQL-001): o comando seguinte. Assim o `;` não muda de resposta: com
    `DELETE FROM t WHERE id = 1;`, a linha em branco e `SELECT * FROM t;`, o cursor na linha em
    branco executa o `SELECT`, como antes, e não o `DELETE` de novo.
  - O `;` continua separando como antes (RN-SQL-002), e o comando do cursor entre dois comandos
    separados pelo `;` é o mesmo de antes. A seleção continua indo como está, e a conta da seleção
    (RN-SQL-001) continua só pelo `;`: a linha em branco não divide a seleção.
  - Configurações › Editor SQL ganha "A linha em branco separa os comandos", ligada por padrão e
    guardada com as outras preferências do editor (RN-CONFIG-001). Desligada, vale só o `;`, como
    antes.
  - Ao executar sem seleção, o editor destaca por um instante o trecho enviado, para a pessoa ver
    qual comando rodou. O destaque segue o tema, some sozinho e não muda o texto, o cursor nem a
    seleção; com "reduzir movimento" no sistema, aparece sem animação. Só destaca o que vai mesmo
    ao banco: com um comando em andamento na aba, com a aba sem conexão (RN-SCRIPT-003) ou com a
    pergunta das alterações não salvas da grade (RN-EDIT-007) cancelada, nada é enviado e nada é
    destacado; respondida a pergunta, o destaque vem depois dela.
  - A API não muda: continua recebendo um comando por execução.

## 27. Complemento de 2026-10-15, versão 0.4.0: a conexão da aba de consulta e os scripts genéricos (issue #9)

Issue #9 do repositório público, relatada na 0.2.0-beta.13 com Informix: "Scripts não abrem conexão
com o banco salvo e não lista em qual servidor será executado". Quem reabre um script salvo não sabe
em qual servidor ele vai rodar, porque a barra do editor mostra só o banco. O autor quer também
scripts que não fiquem presos a uma conexão, "genéricos": abertos, rodam na conexão que está aberta;
com mais de uma aberta, o Prism pergunta qual. O dono aprovou a proposta em 2026-10-15 ("Faça todas
issues, todas elas parecem boas mesmo"). Altera a RN-SCRIPT-001 e a RN-SCRIPT-003, e a barra do
editor ganha o botão da conexão que o canvas já desenhava (seção 9).

- **RN-ARVORE-008.** A barra do editor da aba de consulta mostra, antes da lista dos bancos
  (RN-ARVORE-007), o botão da conexão da aba: a sigla do banco (PG, DB2, IFX), o nome da conexão e
  a etiqueta do ambiente dela, próprio ou herdado da pasta (RN-PASTA-005). A dica do botão traz o
  servidor (`host:porta`) e o usuário.
  - O clique no botão, ou Ctrl+9 com o foco em qualquer ponto da aba (como no DBeaver), abre a
    lista das conexões do usuário, com busca pelo nome, pela pasta e pelo servidor. As conectadas
    vêm primeiro, e cada conexão mostra o caminho de pastas dela.
  - Escolher outra conexão troca a conexão DESTA aba, sem executar nada, e o texto do editor fica.
    Com alterações não salvas na grade (RN-EDIT-007), pergunta antes, como ao executar outro
    comando.
  - Na troca, a sessão anterior da aba fecha e a aba passa ao banco padrão da nova conexão. O
    resultado que estava na tela sai, como na troca do banco. A barra de status e a etiqueta da aba
    acompanham.
  - Com comando em andamento a troca espera: a lista abre, mas as conexões ficam desabilitadas,
    com o motivo. A execução da atualização automática (RN-GRADE-014) não conta como comando em
    andamento: a troca acontece e a desliga.
  - A lista tem também "Mostrar no navegador", que revela e escolhe a conexão da aba na árvore: as
    pastas acima dela abrem, e o navegador escondido aparece.
  - Na aba sem conexão o botão diz "Sem conexão", e a lista dá a ela a conexão escolhida.
  - A aba de uma tabela não troca de conexão: ela é a tabela daquela conexão.
- **RN-SCRIPT-005.** O script genérico é o que não fica preso a uma conexão.
  - O diálogo do nome do primeiro Ctrl+S e do "Salvar como" tem a caixa "Script genérico (sem
    conexão)". Na aba sem conexão ela vem marcada e não se desmarca. No "Salvar como" de um script
    genérico ela vem marcada.
  - O menu do script na seção "Scripts" tem "Tornar genérico" no script com conexão, e "Vincular
    à conexão da aba" no genérico. Vincular grava a conexão e o banco da aba em que o script está
    aberto; sem aba aberta com conexão, o item fica desabilitado, com o motivo.
  - O script genérico tem uma marca discreta na lista.
  - O script genérico não guarda conexão nem banco. Aberto, com exatamente uma conexão conectada a
    aba já abre nela, e o botão da conexão (RN-ARVORE-008) a mostra. Com mais de uma conectada, a
    aba abre sem conexão e a faixa de escolher a conexão pergunta, com as conectadas primeiro. Com
    nenhuma, a faixa pede qualquer conexão. O script nunca executa sozinho.
  - Salvar um script genérico o mantém genérico: trocar a conexão ou o banco da aba dele não é
    mudança não salva, e só o texto conta.
  - Rota: o `PATCH api/user/scripts` ganha `generic`. Com `generic: true`, a conexão e o banco do
    script são apagados; junto com `connectionID` ou `database`, a recusa é 422
    `SCRIPT_PLACE_INVALID`. Sem ele vale a regra de antes, em que o ausente fica como está. No
    `POST`, o script sem `connectionID` já nasce genérico. O cofre não muda de formato: o script já
    guardava a conexão como opcional.

## 28. Complemento de 2026-10-15, versão 0.4.0: cor da pasta, Renomear e Editar pasta, ícone e cor do script (issue #8)

Issue #8 do repositório público, "Mudar ícone e cor de scripts e pastas": "ao editar uma pasta, ter
a opção de editar a cor dela; hoje deixa colocar um badge, mas se permitisse os 2 ficaria mais
limpo e bonito"; "para entrar nessa edição é 'Renomear', poderia mudar a opção para editar e
manter o renomear apenas para renomear com o atalho do F2"; e "nos scripts seria legal poder mudar
o ícone, com ícones pré-definidos no mesmo estilo já existente, e personalizar sua cor também". O
dono aprovou a proposta em 2026-10-15 ("Faça todas issues, todas elas parecem boas mesmo"). Altera
a RN-PASTA-006 e a RN-NAV-009 (e, por elas, o diálogo da seção Ambiente na RN-PASTA-005).

- **RN-PASTA-007.** A pasta pode ter uma cor, opcional, que pinta o ícone dela na árvore, aberta ou
  fechada. Sem cor, o ícone é o neutro de sempre.
  - A cor da pasta não é o ambiente: uma pasta pode ter as duas, a cor no ícone e a etiqueta do
    ambiente ao lado do nome (RN-PASTA-005). A cor não passa às subpastas nem às conexões, e não
    conta no filtro por ambiente (RN-NAV-010) nem nos ambientes do usuário (RN-AMB-001).
  - Escolhe-se em "Cor da pasta", no diálogo de nova pasta e no "Editar pasta…" (RN-PASTA-006),
    antes da seção Ambiente: "Sem cor", as seis cores do canvas e "Outra cor", com o conta-gotas,
    nas regras da RN-CONN-017. O "Renomear" (F2) e o "Mover" não a mudam.
  - O ícone colorido, da pasta e do script (RN-SCRIPT-006), passa no contraste de ícone da
    RN-CONFIG-003 (3:1) sobre as superfícies de todos os temas, os claros inclusive. Quando a cor
    escolhida não chega a 3:1 (as seis do canvas são claras, feitas para os temas escuros), o ícone
    é pintado com a variante mais próxima dela que chega: escurecida nos temas claros, clareada nos
    escuros. A cor gravada, e a das bolinhas, é a que a pessoa escolheu.
  - As rotas de pastas (`GET`, `POST` e `PATCH api/user/folders`) recebem e devolvem `color`,
    opcional, no formato da cor do ambiente (`#RRGGBB`); a recusa é 422 `FOLDER_NAME_INVALID`, no
    campo. O `PATCH` grava a pasta por inteiro, como já faz com o ambiente: sem `color`, a pasta
    fica sem cor. O cofre não muda de formato: a pasta gravada antes abre sem cor.
- **RN-SCRIPT-006.** Cada script tem um ícone e, opcional, uma cor, que aparecem na seção "Scripts"
  do navegador e na aba do script, no lugar do ícone de documento.
  - O ícone sai de uma lista fechada, no traço dos ícones do app: documento (o padrão, o de hoje),
    código, banco de dados, tabela, gráfico, relógio, raio, inseto, chave inglesa, estrela e
    bandeira (`document`, `code`, `database`, `table`, `chart`, `clock`, `lightning`, `bug`,
    `wrench`, `star` e `flag`). A tela e a API conhecem a mesma lista.
  - A cor se escolhe como a da pasta ("Sem cor", as seis cores e "Outra cor"), com a mesma regra de
    contraste (RN-PASTA-007). Sem cor, o ícone é o neutro de sempre.
  - O menu do script na seção "Scripts" ganha "Editar script…", com o nome, o ícone e a cor. O F2 e
    o "Renomear" continuam mudando só o nome. O script novo (Ctrl+S, "Salvar como") nasce com o
    ícone padrão e sem cor.
  - Rota: o `PATCH api/user/scripts` ganha `icon` e `color`, e a lista e o item os devolvem (nulos
    no ícone padrão e no script sem cor). O `PATCH` continua parcial: ausente ou nulo fica como
    está; `color` vazio tira a cor, e `icon` vazio ou `document` volta ao ícone padrão. O ícone
    fora da lista e a cor fora de `#RRGGBB` são 422 `SCRIPT_ICON_INVALID`, no campo. O cofre não
    muda de formato: o script gravado antes abre com o ícone padrão e sem cor.

## 29. Complemento de 2026-10-15, versão 0.4.0: contar de novo e atualização automática (issues #10 e #11)

Pedidos das issues 10 e 11 do repositório público, que o dono aprovou em 2026-10-15 ("Faça todas
issues, todas elas parecem boas mesmo"): "A contagem de linhas não pode ser recontada, poderia
manter o botão para permitir refazer as contagens" (das quatro coisas da issue 10, era a que
faltava: o texto de ajuda do filtro, o autocompletar das colunas e o F5 entraram pela RN-TABELA-011
e pela RN-GRADE-012); e "Ter uma opção que executa a query de x em x tempos, para fazer um refresh
nos dados que estão sendo acompanhados".

- **Contar de novo** (issue #10): está na própria RN-SQL-006, alterada no lugar. O total contado
  deixa de ser definitivo: "Contar de novo" conta outra vez, e o total anterior fica à vista até
  chegar o novo, ou fica de vez se a contagem falhar ou for cancelada.
- **RN-GRADE-014.** Atualizar automaticamente: o resultado de uma leitura é executado de novo
  sozinho, a cada intervalo, para acompanhar dados que mudam (issue #11).
  - Onde: no menu de contexto da grade, logo depois de "Atualizar" (F5), como submenu
    (RN-MENU-001), e ao lado de "Atualizar": nos Registros, no rodapé, logo depois do botão
    "Atualizar"; no resultado da aba de consulta, que não tem esse botão (o F5 e "Executar" fazem
    a vez dele), na barra da área de resultado, que fica à vista também com a área recolhida. O
    botão está sempre lá, com ou sem linhas na tela: quando não se aplica, desabilitado, com o
    motivo. Os intervalos: 5 s, 10 s, 30 s, 1 min e 5 min; "Personalizado…", um diálogo pequeno
    que pede os segundos (de 2 a 3.600, inteiros); e "Desligar". O intervalo em uso aparece
    marcado.
  - Ligada, o controle mostra "Atualiza a cada 10 s" com a hora da última atualização, e um
    clique no X ao lado desliga. O texto abre os intervalos, para trocar. Desligada no meio de uma
    execução automática, a execução é abandonada na hora, como quando a pessoa executa um comando
    (abaixo): nada dela aparece, e o resultado de antes fica, com o cursor fechado (RN-SQL-007).
  - Cada execução é a do F5 (RN-GRADE-012): o mesmo comando, com o mesmo filtro, lendo de novo a
    primeira página. A seleção da grade se perde, como em qualquer execução nova (RN-GRADE-001); a
    rolagem fica, quando as colunas são as mesmas. O total (RN-SQL-006) não é contado de novo
    sozinho. A grade não esmaece enquanto a execução automática roda: o controle diz
    "atualizando…". Ligada, a grade não busca a página seguinte sozinha ao rolar até o fim
    (RN-CONFIG-005): cada execução volta à primeira página, e a busca sozinha leria de novo a cada
    intervalo; "Carregar mais" continua no botão.
  - A execução automática não toma a aba da pessoa (correção da revisão de 2026-10-15): os botões e
    as teclas ficam como estão enquanto ela roda ("Executar" e "Atualizar" não viram "Cancelar",
    nada se desabilita), e o que a pessoa pede nesse meio-tempo é atendido, e não perdido.
    Executar um comando, o F5, "Atualizar", aplicar o filtro e ordenar pela coluna abandonam a
    execução automática (a API recebe o cancelamento dela, e nada dela aparece: nem resultado, nem
    aviso, nem nota) e executam o que a pessoa pediu, que a aba mostra rodando desde o clique.
    "Carregar mais" e "Contar total" esperam a execução automática terminar e seguem sobre o
    resultado novo. Só a edição de uma célula não começa enquanto ela roda: as linhas vão mudar,
    e a faixa diz isso.
  - A próxima execução só é marcada quando a anterior termina, e o tempo conta do fim dela: nunca
    duas ao mesmo tempo. Vale para qualquer comando da aba: depois de "Carregar mais", de "Contar
    total" e do F5, o tempo recomeça.
  - Só para leitura: liga sobre o resultado que a API leu por cursor (RN-SQL-004). O comando que
    grava e devolve linhas (RN-SQL-013: `INSERT`, `UPDATE`, `DELETE` ou `MERGE` com `RETURNING`, o
    procedimento, a leitura que o banco recusou numa transação só de leitura) não se atualiza
    sozinho, e o que não devolve linhas (DDL, `CALL`, linhas afetadas) não tem o que atualizar.
    Quem diz se o comando grava é a regra da RN-SQL-013, e a tela não lê o texto de novo. Também
    não liga com a aba ocupada nem desconectada. O que não se aplica aparece desabilitado, com o
    motivo.
  - Na conexão com "Confirmar antes de executar" em "Todos os comandos" (RN-PROT-001), ligar pergunta
    uma vez, e nunca a cada intervalo: confirmada, ela roda até ser desligada, e trocar só o
    intervalo não pergunta de novo. *Alterada a pedido do dono em 2026-10-15 (seção 32).*
  - Fica em pausa (não executa) enquanto há alteração não salva na grade (RN-EDIT-007), uma célula
    em edição ou um menu ou diálogo da grade aberto, e enquanto a aba não está à vista (outra aba à
    frente, a vista Estrutura ou Diagrama, ou a área de trabalho atrás de Conexões, Drivers ou
    Configurações): só a aba à vista fala com o banco sozinha. Ao sair da pausa, se o prazo já
    passou, executa na hora; senão, espera o que falta. A pausa da grade vale desde o começo da
    ação que abre a célula ou o menu, exclui, cola, acrescenta ou duplica uma linha (pelo menu, pela
    barra de edição ou pelo atalho, RN-EDIT-013 a 016; a ação antes pergunta à API o que se edita), e
    não só depois: a ação nunca cai em outra linha. Se as linhas mudam mesmo assim (a execução que
    já rodava quando o menu abriu), o menu fecha, e a escolha sobre a célula não age. *Alterada a
    pedido do dono em 2026-10-16 (seção 33): entraram o duplicar e a barra de edição.*
  - Para sozinha quando uma execução não traz um resultado de leitura novo: o erro do banco aparece
    uma vez, como sempre (RN-SQL-009), e o controle diz numa nota curta que a atualização
    automática parou e por quê (o erro, o cancelamento, o comando que não pôde ser executado, o
    comando que gravou, a sessão com o banco que caiu). A nota fica até a próxima execução ou até
    a pessoa ligar de novo. A execução automática não repete aviso: o de valores cortados
    (RN-AVISO-003) não sai nela (nem no "Carregar mais" que vem depois dela, quando o resultado
    já avisou), e as células cortadas continuam marcadas.
  - Desliga quando a aba desconecta, fecha, troca de banco (RN-ARVORE-007) ou de conexão (RN-ARVORE-008), ou vai para outra janela
    (RN-ABAS-002 e 003), quando o cofre bloqueia (RN-SEG-001) e quando a pessoa executa outro
    comando na aba (outro texto, outro filtro, outra ordem). Também quando a sessão da aba cai (a
    API já não a conhece, ao carregar mais, ao contar ou na própria execução automática), com a
    nota: a execução automática não abre sessão nova, porque nada reconecta sozinho
    (RN-SESSAO-004). Levar a aba para outra janela a suspende desde o começo da mudança, e a
    execução que estava em andamento termina antes de a aba ir: a outra janela recebe a sessão
    livre, com o resultado e o cursor que a aba mostra; se a aba não vai, ela continua. Executar
    de novo o mesmo comando (F5, "Atualizar", "Executar de novo") a mantém ligada e recomeça o
    tempo.
  - A execução automática não é atividade da pessoa nem comando em andamento para o bloqueio por
    inatividade (RN-SEG-001): com ela ligada, o Prism bloqueia no prazo, e o bloqueio a desliga.
  - Não é gravada com as abas (RN-ABAS-006): as abas voltam com ela desligada.
- **Fica para depois:** uma marca na faixa de abas para a aba com a atualização automática ligada.

## 30. Complemento de 2026-10-15, versão 0.4.0: a área de trabalho mais enxuta (issue #14)

Pedido da issue 14 do repositório público, "Adiciona configuração para deixar a visualização mais
enxuta das conexões na sidebar": perto da árvore do DBeaver, a do navegador ocupa espaço demais, e
quem a abriu quer uma configuração com menos espaçamento e letras menores, para ver mais itens. O
dono aprovou a proposta inteira em 2026-10-15 ("Faça todas issues, todas elas parecem boas
mesmo"): o texto da área de trabalho na escala do canvas, o zoom do programa inteiro, a densidade
do navegador e a seção Scripts que lembra se ficou recolhida. As letras menores vêm das duas
primeiras: a área de trabalho passa de 14 px a 13 px, e quem quer menos ainda usa o zoom.

- **RN-CONFIG-009.** O texto da área de trabalho é o do canvas (`Workbench.dc.html`): 13 px em
  linha de 20 px.
  - Vale para tudo o que ela mostra sem tamanho próprio: a árvore do navegador, o campo de busca e
    as mensagens dele, a seção Scripts, a barra de abas, as barras e os painéis das abas
    (Registros, Estrutura, Diagrama, resultado). Até aqui a árvore, a busca, as mensagens e a barra
    de abas herdavam o 14/22 dos formulários. A barra superior (13 px) e a barra de status (12 px)
    já seguiam o canvas e não mudam.
  - Formulários e diálogos, também os que abrem sobre a área de trabalho, e as telas de fora dela
    (login, Configurações) continuam em 14/22, como o canvas os desenha.
  - O editor SQL (o tamanho em Configurações › Editor SQL) e a grade (o zoom dela, RN-GRADE-010)
    têm tamanho próprio e não mudam.
- **RN-ZOOM-001** passa a existir no app, como a seção 20 a descreve, com os detalhes acertados
  agora (os passos, todas as janelas e o splash, o "Restaurar 100%" e onde a escolha fica). O
  splash cresce com o zoom só até caber na área útil da tela, e a RN-MARCA-002 deixa de ter o
  tamanho fixo: 640×400 é o de 100%.
  - O `Ctrl 0` continua sendo o 100% do programa inteiro, como o dono o pediu em 2026-10-12 (seção
    20, "Janela e zoom"): o `Ctrl 0` do DBeaver, que escolhe o esquema ativo, não vira atalho da
    lista dos bancos da aba (RN-ARVORE-007), que continua sem atalho próprio.
- **RN-NAV-011.** "Densidade do navegador", em Configurações › Aparência: "Confortável" e
  "Compacta".
  - "Confortável" é o padrão e o desenho do canvas: linhas de 30 px e 16 px de recuo a cada nível.
  - "Compacta" tem linhas de 22 px e 12 px de recuo a cada nível, para caber mais itens na mesma
    altura, como no DBeaver. O texto continua 13/20 (RN-CONFIG-009), e os botões de ação da linha,
    o ponto de estado, a etiqueta do banco, a do ambiente e as marcas (PK) cabem sem corte.
  - Vale para a árvore e para a da seção Scripts, que tem pastas (RN-SCRIPT-008), com o mesmo
    recuo a cada nível. A linha de erro de um nó continua da altura que a mensagem pede. *Alterada a
    pedido do dono em 2026-10-16 (seção 33): a lista dos scripts virou árvore.*
  - A escolha vale na hora, em todas as janelas, sem fechar os nós abertos nem perder o item
    escolhido, e fica nas preferências desta instalação, por usuário (RN-CONFIG-001), como o tema e
    as fontes.
- **RN-NAV-012.** A seção Scripts do navegador lembra se ficou recolhida ou aberta: volta assim ao
  entrar de novo e ao abrir o app, por usuário, como o navegador escondido (RN-NAV-008). Aberta é o
  padrão. A janela que abre depois começa como a última escolha.

## 31. Complemento de 2026-10-15, versão 0.4.0: executar script (Alt+X), como no DBeaver

Pedido do dono em 2026-10-15: "Crie uma nova funcionalidade igual a do dbeaver do alt + x que
executava scripts, sabe?". No DBeaver, "Executar script" (Alt+X) executa os comandos do editor um
depois do outro, abre uma aba para cada resultado e uma de estatísticas, e pergunta o que fazer
quando um comando falha. No Prism uma execução levava um comando só (RN-SQL-001), e o script ficava
para a entrega 2 (seção 13). Entra agora, com as regras do Prism para cada comando. Muda a
RN-SQL-001, a seção 13 e o "fica para depois" da seção 22, que citam o script, e a RN-SEG-001 (o
script parado na pergunta de erro não segura o bloqueio); a seção 9 diz o que o canvas não desenha.
A API não muda: continua recebendo um comando por execução (a seção 33 acrescenta a ele o `keep`,
RN-SQL-024, para as abas do script se editarem).

- **RN-SQL-019.** Executar script.
  - Onde: Alt+X no editor e com o foco em qualquer ponto da aba de consulta (a barra, o resultado, o
    campo de filtro), menos no campo de edição de uma célula, que fica com as teclas dele; e o botão
    "Executar script" na barra do editor, logo depois de "Executar", com o atalho escrito nele. No
    macOS a tecla é Cmd+Option+X: lá o Option+X escreve um caractere (`≈` no teclado americano, outros
    em outros teclados), e o atalho o tiraria do editor. Nenhum outro atalho do Prism, do menu do
    Electron ou do editor usa essas teclas; no Windows e no Linux o AltGr+X continua escrevendo o que
    escreve. A área de resultado vazia ensina o atalho ao lado do Ctrl+Enter, e o aviso da seleção com
    mais de um comando (RN-SQL-001) também.
  - O que vai: a seleção, quando há; sem seleção, o texto inteiro do editor. O texto é dividido em
    comandos pelas regras do Ctrl+Enter, com o mesmo leitor: o `;` fora de texto, de nome entre aspas,
    de comentário e de `$tag$` (RN-SQL-002) e, com "A linha em branco separa os comandos" ligada, a
    linha em branco, nas condições da RN-SQL-018. No script a linha em branco divide também a seleção,
    porque dividir é o que o script faz com o texto; no Ctrl+Enter a seleção continua indo inteira,
    como um comando só. O bloco com `;` no corpo (procedimento, função, gatilho, bloco composto: os da
    RN-SQL-001) e o `CREATE SCHEMA` com os objetos dele são um comando só. No Db2 o bloco vai até o fim
    do texto, como na RN-SQL-001: o que vem depois dele vai junto, e para executar um bloco e depois
    outros comandos a pessoa seleciona as partes. Trecho só com espaços, `;` ou comentários não é
    comando e não aparece. Um comando só também é script: roda, e aparece como um script de um comando.
  - Como roda: um comando por vez, na ordem, na sessão da aba, pelo caminho de "Executar" (cada um é
    um `POST …/queries`, com o texto como está, RN-SQL-003). Valem as regras de uma execução: com
    alterações não salvas na grade, a pergunta da RN-EDIT-007 vem antes; a atualização automática
    desliga (RN-GRADE-014); o filtro do resultado sai (RN-GRADE-011); a área de resultado recolhida
    volta (RN-PAINEL-001). Com um comando em andamento na aba, ou com a aba sem conexão
    (RN-SCRIPT-003), nada roda, como no Ctrl+Enter. Na conexão que confirma antes de executar
    (RN-PROT-001), a pergunta vem uma vez, antes do primeiro comando, com a lista dos comandos que a
    pedem, e cancelada nada roda; na conexão somente leitura (RN-PROT-002), o comando que não é uma
    leitura é recusado pela API, e a recusa é o erro dele (RN-SQL-021). *Alterada a pedido do dono em
    2026-10-15 (seção 32).*
  - Enquanto roda: o editor marca o comando em execução, com o acento do tema, até o seguinte começar,
    e traz o comando à vista quando ele está fora dela; a marca some no fim. Se o texto foi editado
    depois de o script começar, a marca não aparece, porque o lugar já não é o mesmo. A barra da área
    de resultado diz "Executando 3 de 12…", em qualquer aba dela e também com ela recolhida.
    "Executar" vira "Cancelar", como num comando, e a aba fica ocupada para tudo o que espera um
    comando acabar: trocar o banco ou a conexão (RN-ARVORE-007 e 008), levar a aba para outra janela
    (RN-ABAS-002), o bloqueio por inatividade (RN-SEG-001).
  - Transação: cada comando segue o modo da aba como se fosse executado sozinho. Hoje a aba de
    consulta só tem o Auto-commit na tela: cada comando é confirmado quando termina, e um comando de
    controle de transação no script (`BEGIN`, `COMMIT`, `ROLLBACK`…) é recusado como no Ctrl+Enter
    (RN-SQL-003 e RN-TX-004), com o erro dele (RN-SQL-021). Quando o Commit manual (RN-TX-001)
    chegar à aba de consulta, o script roda dentro da transação da aba, comando a comando, sem
    confirmar nada sozinho, e o controle de transação digitado vale como na RN-TX-004.
  - Não é gravado com as abas (RN-ABAS-006): elas voltam com o texto, sem os resultados do script.
- **RN-SQL-020.** Os resultados do script, como as abas de resultado e as estatísticas do DBeaver.
  - A área de resultado ganha abas no lugar do título "Resultado": uma para cada comando que devolveu
    linhas, com o número dele no script e o começo do texto ("3 · SELECT * FROM pedido…", com o texto
    inteiro na dica), e, por último, "Estatísticas". O comando que não devolve linhas (linhas
    afetadas, DDL) aparece só nas Estatísticas. As abas andam com as setas, Home e End, como uma lista
    de abas, e só a escolhida entra no Tab. As dos resultados rolam na horizontal quando não cabem, e a
    escolhida (também a que vem à frente sozinha) é sempre trazida à vista; "Estatísticas" fica fixa na
    ponta direita, fora da rolagem.
  - Enquanto o script roda, as Estatísticas ficam à frente e se preenchem. No fim, se o último comando
    executado devolveu linhas, a aba dele vem à frente; senão, ficam as Estatísticas. A aba que a
    pessoa escolheu durante o script continua escolhida; o script seguinte volta às Estatísticas, também
    depois de a aba trocar de banco ou de conexão ou passar pelo bloqueio por inatividade.
  - Só o resultado do último comando executado tem o cursor aberto: a sessão tem um cursor só, e cada
    comando novo fecha o anterior (RN-SQL-007). Nele vale tudo o que vale no resultado de um comando:
    "Carregar mais", "Contar total", o filtro do resultado (RN-GRADE-011), a edição das células (seção
    22), a atualização automática (RN-GRADE-014) e o F5, com a aba dele à frente; com outra aba do
    script à frente, a atualização automática espera, como com outra aba do Prism à frente. As abas dos
    outros comandos guardam as linhas que já tinham sido lidas (as primeiras 200, RN-SQL-004) e se
    editam como a do último, com o menu da célula e a barra de edição (seção 22 e RN-SQL-023), mas
    dizem por que o resto não vale ali: o cursor delas fechou quando o comando seguinte rodou, e
    "Carregar mais", "Contar total", o filtro e a atualização automática ficam no resultado do último
    comando. Elas oferecem "Executar este comando", que executa só aquele comando, como o Ctrl+Enter
    nele (com a pergunta da RN-EDIT-007 antes, quando há alterações não salvas). Com um comando em
    andamento na aba, o botão fica à vista, não executa e diz por quê, sem perguntar nem mexer na área;
    quando o comando executado troca os resultados do script, o foco vai à grade do resultado novo, e
    não se perde (como na RN-SQL-006).
  - O script guarda as abas dos 20 primeiros comandos que devolvem linhas, para um script longo não
    encher a memória de grades; a do último comando executado fica sempre, quando ele devolve linhas,
    porque é a do cursor aberto. Os outros aparecem só nas Estatísticas, com as linhas que devolveram,
    e elas dizem quantos resultados não foram guardados.
  - As Estatísticas são uma tabela com cabeçalho: o número do comando, o começo do texto (inteiro na
    dica), a situação ("na fila", "executando", "ok", "erro", "pulado", "cancelado" ou "não
    executado"), as linhas (lidas ou devolvidas, ou afetadas) e o tempo. O erro de um comando vem na
    linha logo abaixo dele, como o banco o deu (RN-SQL-009), com o SQLSTATE. Abaixo da tabela, os
    totais: comandos executados (os que deram certo, de quantos o script tem), linhas alteradas (a
    soma das linhas afetadas; o comando para o qual o banco não conta linhas não soma, nem o que grava
    e devolve linhas, como o `INSERT ... RETURNING` (RN-SQL-013): dele a API diz quantas linhas
    devolveu, e não quantas alterou, e as duas contas só coincidem no `INSERT`, no `UPDATE` e no
    `DELETE` com `RETURNING` sozinhos; o total diz quantos ficaram de fora, "Linhas alteradas: 12 (sem
    contar 1 comando que gravou e devolveu linhas)") e o tempo total (a soma dos tempos dos comandos,
    sem o tempo das perguntas). Enquanto o script roda, a tabela
    mostra os 50 comandos em volta do que está em execução, com ele perto do alto, e duas linhas dizem
    quantos ficaram antes ("1.995 comandos antes destes, que aparecem quando o script terminar.") e
    quantos estão na fila ("Mais 955 comandos na fila."); os totais são do script inteiro. Enquanto ele
    roda, ela se atualiza no máximo quatro vezes por segundo (quem diz o comando em execução a cada um é
    a barra da área); a pergunta de erro e o fim aparecem na hora. No fim, ela mostra todos. Assim um
    script de milhares de comandos (uma carga de `INSERT`) leva o mesmo com as Estatísticas à frente e
    com outra aba à frente, e não fica mais lento a cada comando: refazer a tabela inteira a cada um
    fazia o tempo crescer com o quadrado do tamanho.
  - Uma execução nova na aba substitui os resultados do script, como substitui o resultado de um
    comando: o Ctrl+Enter, "Executar este comando" e outro script. O F5, "Executar de novo", o filtro
    e a atualização automática do resultado do último comando mudam só ele, e as outras abas ficam,
    e continuam se editando (RN-SQL-024).
    Como antes, o que está na tela só sai quando a API aceita um comando novo: se o script não chega a
    executar comando nenhum (a conexão não abre, a sessão está ocupada, o cancelamento antes do
    primeiro), a área fica como estava. Trocar o banco ou a conexão da aba e o bloqueio por
    inatividade tiram os resultados do script, como tiram o resultado. Levar a aba para outra janela
    leva o resultado do último comando, como hoje; as outras abas e as Estatísticas não vão (e a
    alteração não salva numa delas faz a mudança perguntar antes, RN-SQL-023).
  - Avisos: um no fim, e não um por comando, com o nome da aba, porque o script de uma aba que não
    está à vista também termina. "Script executado na aba consulta-1.sql: 12 comandos." (sucesso);
    "Script executado na aba consulta-1.sql com 2 erros: 10 de 12 comandos executados." (atenção);
    "Script parado na aba consulta-1.sql: 4 de 12 comandos executados." e "Script cancelado na aba
    consulta-1.sql: 4 de 12 comandos executados." (atenção). O nome é o da aba no fim do script (ela
    pode ter sido renomeada, ou salva como script, enquanto ele rodava). O aviso de valores cortados
    (RN-AVISO-003) sai uma vez por script, e o de sessão reaberta, como sempre.
  - *Alterada a pedido do dono em 2026-10-16 (seção 33): as abas dos outros comandos, que eram só
    para leitura e sem o menu da grade, passaram a se editar (RN-SQL-023 e 024).*
- **RN-SQL-021.** Erro num comando do script, como o diálogo de erro do DBeaver.
  - O script para, e um diálogo mostra o comando (o número e o texto) e o erro como veio (RN-SQL-009),
    com o SQLSTATE, e pergunta: "Parar" (o padrão, com o foco, e também o Esc), "Tentar de novo"
    (executa o mesmo comando outra vez), "Pular" (segue com o próximo) e "Pular todos os erros" (segue,
    e o resto do script pula os comandos que falharem sem perguntar). O foco volta, quando o diálogo
    fecha, para onde estava: o editor, de onde o script saiu.
  - O diálogo só aparece na aba à vista: a ativa, com a área de trabalho na tela (como a atualização
    automática, RN-GRADE-014). O script de outra aba, ou o da área de trabalho escondida por baixo de
    Configurações, Conexões ou Drivers, espera a resposta sem cobrir a tela nem tirar o foco de quem
    está digitando em outro lugar; a aba dele leva, na faixa de abas, um ponto vermelho ("O script
    parou num erro e espera a resposta", também para o leitor de tela), e o diálogo aparece quando a
    pessoa vai até ela. Assim dois scripts parados em abas diferentes nunca abrem dois diálogos.
  - É erro do comando o que o banco respondeu (`SQL_EXECUTION_FAILED`) e a recusa da API para aquele
    comando (`TRANSACTION_CONTROL_NOT_SUPPORTED`, `COMMAND_NOT_ALLOWED_IN_TRANSACTION`,
    `MULTIPLE_STATEMENTS_NOT_SUPPORTED` e, na conexão somente leitura, `CONNECTION_READ_ONLY`,
    RN-PROT-002). O que não é do comando (a conexão que não abre, a sessão
    ocupada, a API fora do ar ou com erro interno, a sessão que caiu) para o script sem perguntar: o
    aviso central diz o que houve (RN-AVISO-004), o comando fica como "erro" e os seguintes, como "não
    executado". A sessão que cai no primeiro comando é reaberta uma vez, como no Ctrl+Enter (seção 7);
    a que cai depois dele não é, porque o que os comandos de antes deixaram nela (uma tabela
    temporária, um `SET`) se perdeu: as Estatísticas dizem isso, e a pessoa executa o script de novo.
    *Alterada a pedido do dono em 2026-10-15 (seção 32): entrou a recusa do somente leitura.*
  - O editor marca a posição do erro, quando o banco a dá, no texto inteiro: no lugar do comando
    dentro do texto do editor, como faz com o comando do Ctrl+Enter (RN-SQL-009). Se o texto foi
    editado depois de o script começar, a marca não aparece.
  - "Parar" deixa nos resultados e nas Estatísticas o que já rodou; o comando que falhou fica como
    "erro", e os seguintes, como "não executado". Pulado, o comando fica como "pulado", com o erro.
  - Enquanto o diálogo espera a resposta, o script não é comando em andamento para o bloqueio por
    inatividade (RN-SEG-001): passado o prazo, o Prism bloqueia, e o bloqueio para o script e tira os
    resultados dele, como tira o resultado de um comando.
- **RN-SQL-022.** Cancelar o script: "Cancelar", na barra do editor, interrompe o comando em andamento
  (RN-SQL-010) e para o script. O comando cancelado fica como "cancelado"; o que terminou antes de o
  cancelamento chegar fica como "ok", e o script para mesmo assim; com o desfecho incerto ou parcial
  da RN-SQL-010, fica como "erro", com a frase da API. Os seguintes ficam como "não executado", e o
  que já rodou fica nos resultados e nas Estatísticas. "Desconectar" também para o script: a sessão
  fecha com o comando em andamento, que fica como "cancelado".
- **Fica para depois:** um script que é uma transação só (seção 22); continuar o script a partir de um
  comando escolhido; e levar para outra janela as abas dos outros resultados e as Estatísticas.

## 32. Complemento de 2026-10-15, versão 0.4.0: proteções da conexão e da pasta, verificação periódica e o filtro das conectadas

Pedidos do dono em 2026-10-15: "Falta adicionar aquelas coisas que te pedi no começo de ter uma
configuração pra abrir um modal pedindo confirmação do usuário antes de executar qualquer comando em
uma conexão ou pasta que o usuário desejar, inclusive, ter outra configuração que permite que uma
conexão seja apenas readonly, ou seja, permite apenas select"; e "aquele negócio de validar a conexão
fazendo o select 1 ou o usuário se informar qual select ele quer fazer pra confirmar o healthcheck da
conexão". E o de um colega, que o dono repassou: "podia ter um filtro de conexões abertas né / não dá
pra saber se tenho conexões em aberto". É a entrega 3 da seção 2, menos o encerramento por
ociosidade, que o dono não pediu e continua na seção 13 (o ambiente herdado da pasta já tinha
entrado pela RN-PASTA-005). O canvas desenha os painéis "Proteções" e "Sessão da conexão" do
formulário da conexão (`Conexoes.dc.html`), as proteções do diálogo da pasta (`PastaAmbiente.dc.html`)
e o aviso de confirmação (`ConfirmarComando.dc.html`); a seção 9 diz onde esta seção se afasta deles.
Muda a RN-CONN-010, a RN-CONN-013, a RN-PASTA-005, a RN-EDIT-002, a RN-GRADE-014, a RN-SQL-019, a
RN-SQL-021 e a RN-SEG-001, e as seções 2, 6, 9, 13 e 22.

Quem impõe o somente leitura é a API: ela recusa, antes de qualquer coisa ir ao banco, o comando que
não é uma leitura. A confirmação é da tela, que pergunta antes de enviar; a API guarda a escolha e
diz, de cada conexão e de cada pasta, as proteções que valem e de onde elas vêm.

### Proteções

- **RN-PROT-001.** Confirmar antes de executar. A conexão e a pasta têm a escolha "Confirmar antes
  de executar", com três valores: "Não" (o padrão), "Só comandos irreversíveis" e "Todos os
  comandos". Vale a mais forte entre a da conexão e as das pastas acima dela (RN-PROT-004).
  - Irreversível é o comando que apaga o que não volta: `DROP` (de qualquer objeto, também o de
    dentro de um `ALTER`, como `ALTER TABLE ... DROP COLUMN`), `TRUNCATE`, e `DELETE` e `UPDATE` sem
    `WHERE` no nível de fora (também quando vêm depois de um `WITH`). A tela lê o comando com o
    leitor da RN-SQL-002 (texto, nomes entre aspas, comentários e `$tag$` não contam) e, na dúvida,
    pergunta.
  - A pergunta é um aviso que ocupa a janela (o `ConfirmarComando` do canvas), antes de o comando
    sair da tela. No topo, o ambiente da conexão (próprio ou herdado, RN-PASTA-005), com a cor
    dele, e a conexão e o banco da aba. Depois o título ("Executar comando irreversível?" ou, em
    "Todos os comandos", "Executar comando?"); o que o comando faz, quando a tela sabe dizer ("Este
    DELETE não tem WHERE: ele apaga todas as linhas de producao.apontamento."); o comando, em
    código; e por que o aviso aparece ("Você vê este aviso porque a conexão MES Produção herda da
    pasta Fábrica a proteção "Só comandos irreversíveis"", ou "porque a conexão MES Produção tem a
    proteção ..."). Os botões são "Executar mesmo assim" e "Cancelar". O foco começa em
    "Cancelar", Esc cancela, e nada é executado sem "Executar mesmo assim". Cancelar deixa a aba
    como estava, com o resultado de antes.
  - Onde vale:
    - "Executar" (o botão e o Ctrl+Enter), e o "Executar este comando" das abas do script
      (RN-SQL-020), que é o Ctrl+Enter naquele comando;
    - o "Executar script" (Alt+X, RN-SQL-019): a pergunta vem uma vez, antes do primeiro comando,
      com a lista dos comandos que pedem confirmação (cada um com o número dele no script; em "Todos
      os comandos", todos) e "Executar script" no lugar de "Executar mesmo assim". Confirmado, o
      script roda sem perguntar de novo; cancelado, nada roda;
    - o "Salvar" das edições (RN-EDIT-005): em "Todos os comandos" pergunta uma vez por "Salvar",
      com quantas alterações vão e o "Ver SQL" (RN-EDIT-008) no próprio aviso; em "Só comandos
      irreversíveis" não pergunta, porque cada comando dele é pela chave da linha, com `WHERE`;
    - na aba de consulta, o que executa de novo o comando do resultado: o F5 e o "Executar de novo"
      (RN-GRADE-012), aplicar o filtro e ordenar pela coluna (RN-GRADE-011), que perguntam pelo
      comando que vai ao banco, como qualquer execução;
    - a atualização automática (RN-GRADE-014), que só pergunta ao ser ligada, uma vez, e nunca a
      cada intervalo.
  - Não perguntam: o que o Prism monta sozinho para mostrar o que a pessoa abriu (a árvore e o
    catálogo, os Registros de uma tabela, com o filtro e a ordem do campo deles, a Estrutura, os
    diagramas, a aba do banco), "Carregar mais", "Contar total" e a verificação periódica
    (RN-VERIF-002).
  - Numa conexão somente leitura (RN-PROT-002), "Só comandos irreversíveis" não pergunta nada: todo
    comando irreversível é recusado pela API antes de chegar ao banco. "Todos os comandos" continua
    perguntando.
  - Mudar a escolha não pede senha: a senha é só do somente leitura (RN-PROT-003).
- **RN-PROT-002.** Somente leitura. A conexão e a pasta têm a opção "Somente leitura". Na conexão
  somente leitura (pela opção dela ou de uma pasta acima, RN-PROT-004) só as leituras são
  executadas (RN-PROT-005), e todo o resto é recusado: `INSERT`, `UPDATE`, `DELETE`, `MERGE`,
  `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `GRANT`, `REVOKE`, `COMMENT`, `CALL`, `EXECUTE`, `DO`, `SET`,
  `RESET`, `LOCK`, os de transação (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`…) e o
  `SELECT ... INTO`, entre outros.
  - Quem recusa é a API, antes de qualquer coisa ir ao banco: 422 `CONNECTION_READ_ONLY`, com o
    motivo no detalhe ("A conexão é somente leitura, e só leituras são executadas nela: um DELETE
    não é leitura. Nada foi enviado ao banco."). A recusa não fecha o cursor nem tira o resultado
    anterior da aba, como a recusa do controle de transação sem `executed` (RN-SESSAO-005), e não
    conta como leitura: o cursor aberto fecha aos 5 minutos da última leitura, como fecharia sem ela
    (RN-SQL-007).
  - Vale em toda rota que executa um comando na conexão: `queries`, em que, com o filtro do
    resultado, é o comando montado que se confere (RN-GRADE-011), e por ela cada comando do script
    (RN-SQL-019), em que a recusa é o erro daquele comando (RN-SQL-021); e as da edição,
    `queries/edit-target`, `queries/edits` e `queries/edits/preview`: a edição de registros não
    existe numa conexão somente leitura, e a página do resultado já vem com `editable: { known:
    true, reason: "a conexão é somente leitura" }`, o motivo que a grade mostra (RN-EDIT-002).
    "Carregar mais", "Contar total", "Cancelar", o valor completo das células, o catálogo, abrir a
    sessão e "Testar conexão" continuam valendo: leem o que a pessoa já executou ou o catálogo, e a
    contagem só executa de novo uma leitura (RN-SQL-006).
  - No PostgreSQL o banco também recusa. Toda leitura de uma conexão somente leitura roda na
    transação só de leitura da RN-SQL-013, e o que o banco recusa ali por gravar (uma função que
    grava chamada pelo `SELECT`, um `nextval`) é a resposta, como erro do banco (422
    `SQL_EXECUTION_FAILED`, SQLSTATE 25006, com a mensagem dele): nada é gravado, e o comando nunca
    é executado de novo fora da transação, como seria numa conexão comum. O mesmo vale para a
    recusa que só aparece no "Carregar mais", que não sugere executar de novo. A sessão fica também
    no modo só de leitura do banco (RN-PROT-006). O que a transação só de leitura do PostgreSQL
    deixa passar continua passando: `set_config`, `pg_notify`, as travas consultivas, encerrar ou
    cancelar outra sessão (`pg_terminate_backend`, `pg_cancel_backend`) e o que uma função faz fora
    do banco (dblink, tabela estrangeira).
  - No Db2 e no Informix quem impõe é só o texto (RN-PROT-005). O driver da IBM não tem conexão só
    de leitura: o `Net.IBM.Data.Db2` 10.0.0.300 não tem esse dado na string de conexão nem na
    conexão, e o modo de acesso da CLI da IBM é só uma dica, que o Db2 não impõe. O Db2 não tem
    transação só de leitura, e a do Informix (`SET TRANSACTION READ ONLY`) só existe dentro de uma
    transação, que a sessão em auto-commit não abre e o banco sem log nem tem. O que o texto não
    mostra, o banco recusa: no Db2 a função escalar criada com `MODIFIES SQL DATA` não pode ser
    chamada por um `SELECT` (SQL0740N), e no Informix a rotina que grava chamada de dentro de um
    `SELECT` é recusada (-675, como na RN-SQL-013).
  - A proteção que o banco garante para qualquer cliente continua sendo a do usuário do banco: para
    produção, o mais seguro é uma conta só com `SELECT`. O somente leitura do Prism protege de um
    engano no Prism, e não de quem tem a senha do banco.
  - A tela mostra o cadeado do canvas ao lado do nome da conexão na árvore, na lista do botão da
    conexão da aba (RN-ARVORE-008) e na barra de status, e a dica diz de onde ele vem ("Somente
    leitura, herdado da pasta Fábrica"). A grade de uma conexão somente leitura não oferece a edição
    de células: os itens do menu e os botões da barra de edição ficam desabilitados, com o motivo
    (RN-EDIT-001 e 014). *Alterada a pedido do dono em 2026-10-16 (seção 33): entrou a barra de
    edição.*
- **RN-PROT-003.** A senha do somente leitura. Marcar ou desmarcar "Somente leitura" numa conexão ou
  numa pasta que já existe pede a senha do usuário (a do Prism), como revelar a senha de uma conexão
  (RN-CONN-002). Também pede a senha a mudança que tira de uma conexão que já existe o somente
  leitura herdado: mover a conexão, ou uma pasta acima dela, para fora de uma pasta somente leitura.
  - A conferência e a contagem de erros são as de revelar a senha e de trocar a senha (RN-CONN-003 e
    RN-COFRE-013). A senha errada responde 422 `INVALID_PASSWORD` no campo `userPassword`, e o quinto
    erro seguido, somando os das três, fecha o cofre e responde 401 `VAULT_LOCKED`. Sem a senha,
    quando ela é pedida, a resposta é 422 `USER_PASSWORD_REQUIRED` no mesmo campo, sem conferir nada
    e sem contar erro. A senha que vem sem ser pedida não é conferida.
  - Não pedem a senha: criar uma conexão ou uma pasta já marcada (nada do que existe muda), duplicar
    uma conexão (a cópia nasce com as proteções dela, RN-CONN-016), mover para dentro de uma pasta
    somente leitura (a proteção só aumenta), excluir, e mudar a confirmação (RN-PROT-001) ou a
    verificação (RN-VERIF-001).
  - A conferência da senha e a gravação são uma operação só do cofre: quem decide se a senha é
    pedida é o documento mais recente, e não o que a tela leu antes.
  - A tela pede a senha ao salvar (o formulário da conexão, o "Editar pasta…", o "Mover" e o
    arrastar na árvore), num diálogo como o de revelar a senha: ele diz o que muda ("Desmarcar
    "Somente leitura" de MES Produção"), avisa que cinco erros seguidos fecham o cofre (e, com
    transação aberta, que desfazem as transações, RN-TX-008) e mostra o erro no campo. A senha não
    fica guardada depois da resposta.
- **RN-PROT-004.** Herdadas da pasta. As proteções da pasta valem para tudo o que está dentro dela,
  a qualquer profundidade (as subpastas e as conexões delas), ao contrário do ambiente
  (RN-PASTA-005), que a subpasta não mostra. Vale a mais forte: a conexão é somente leitura quando
  ela ou alguma pasta acima dela é; e a confirmação é a mais alta entre a dela e as das pastas acima
  ("Todos os comandos", depois "Só comandos irreversíveis", depois "Não"). A conexão não afrouxa o
  que uma pasta acima impõe.
  - A API devolve, em cada conexão e em cada pasta, além das escolhas próprias, as que valem
    (`protections`) e de onde cada uma vem: a pasta mais próxima acima que impõe o valor que vale,
    ou nulo quando ele é o próprio, ou quando não há proteção.
  - O formulário mostra a proteção herdada marcada e desabilitada, com "Herdado da pasta Fábrica"
    ao lado; na confirmação, as escolhas abaixo da herdada ficam desabilitadas, com o mesmo texto. O
    diálogo da pasta faz o mesmo com as pastas acima dela.
  - Mover uma conexão ou uma pasta muda o que ela herda; para tirar um somente leitura herdado, vale
    a RN-PROT-003.
- **RN-PROT-005.** O que é leitura. O comando é lido como a API já lê o texto de cada banco
  (RN-SQL-002 e 003): texto entre aspas, nomes entre aspas, comentários (os de cada banco, também o
  entre chaves do Informix e o aninhado do Db2, este nas duas leituras, a do banco e a do driver) e
  o `$tag$` do PostgreSQL não contam. Cada comando separado por `;` tem de ser uma leitura (o envio
  com mais de um continua recusado pela RN-SQL-001). O texto sem comando nenhum (só comentários)
  não é recusado aqui: quem responde é o banco.
  - É leitura o comando que começa, depois dos parênteses de abertura, por `SELECT`, `WITH` ou
    `VALUES` e não tem, como palavra inteira: `INSERT`, `UPDATE`, `DELETE` ou `MERGE` (o `WITH` que
    grava, no PostgreSQL, e o `FROM FINAL TABLE (UPDATE ...)` do Db2); `INTO` (o `SELECT ... INTO`
    cria uma tabela no PostgreSQL, e o `INTO TEMP` e o `INTO EXTERNAL` do Informix gravam); a trava
    de linha (`FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`), que é para alterar;
    nem o próximo valor de uma sequência (`NEXT VALUE FOR`, `NEXTVAL`), que não volta atrás.
  - No PostgreSQL são leitura também `TABLE`, `SHOW` e `EXPLAIN` sem `ANALYZE` (sem `ANALYZE` o
    `EXPLAIN` não executa o comando, nem o de um `DELETE`).
  - No Db2 não é leitura o comando com função de tabela (`TABLE (...)`, com qualquer espaço ou
    comentário entre as duas partes), porque a função criada com `MODIFIES SQL DATA` grava sem que o
    texto mostre (a mesma regra da RN-SQL-013), nem o `EXPLAIN`, que grava nas tabelas de
    explicação.
  - Na dúvida, não é leitura: uma coluna chamada `update` sem aspas faz a leitura ser recusada (com
    aspas, ela passa). E o `SET` é recusado também quando só muda o esquema ou o caminho de busca da
    sessão: para ler outro esquema, escreva o nome dele no comando (`esquema.tabela`).
- **RN-PROT-006.** As sessões abertas. Mudar as proteções (na conexão, numa pasta acima, ou movendo
  uma das duas) não fecha nenhuma sessão: o comando seguinte de cada sessão já segue a regra nova,
  porque a API lê as proteções do cofre a cada comando. O cursor aberto continua sendo lido
  ("Carregar mais"): ele é de uma leitura que já rodou. O resultado que já está na grade fica com a
  edição que tinha quando foi executado: a recusa da edição (RN-PROT-002) vem da proteção do momento
  do pedido, e o resultado novo, executado depois da mudança, já sai com ela. A sessão de uma conexão
  que acabou de ser excluída, e que ainda não fechou (RN-CONN-014), responde como a sessão que não
  existe (404 `DATABASE_SESSION_NOT_FOUND`).
  - No PostgreSQL, antes de cada comando da pessoa e de cada "Salvar", a sessão é posta no modo da
    conexão daquele momento: `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` quando ela é
    somente leitura, e `... READ WRITE` quando deixa de ser. O `SET` só vai ao banco quando o modo
    muda: no primeiro comando de uma sessão somente leitura, e quando a proteção muda com a sessão
    aberta. A sessão de uma conexão que nunca foi somente leitura não recebe nada, e vale o que o
    banco e o usuário dele já usam.
  - O que a própria sessão mudar no modo (um `set_config` num `SELECT`) não abre a porta: a leitura
    roda na transação só de leitura que o Prism abre, e a recusa do banco é a resposta (RN-PROT-002).

### Verificação periódica

- **RN-VERIF-001.** "Sessão da conexão", no formulário da conexão, como no canvas: "Verificar a
  cada [N] segundos", ligada por padrão, com 30 segundos (de 5 a 3.600, inteiros); e "Consulta de
  verificação", opcional, com a consulta do banco como dica do campo (a da RN-CONN-013: PostgreSQL
  `SELECT 1`; Db2 `SELECT 1 FROM SYSIBM.SYSDUMMY1`; Informix `SELECT 1 FROM systables WHERE tabid =
  1`). Em branco, vale a do banco.
  - A consulta própria tem até 1.000 caracteres e é uma leitura só, pela regra da RN-PROT-005 no
    banco da conexão: um comando só (o `;` do fim não conta). A API recusa o resto com 422
    `CONNECTION_INVALID` no campo `verificationQuery`, com o motivo ("A consulta de verificação tem
    de ser uma leitura só: um UPDATE não é leitura."). Ela é lida até o fim a cada verificação: a
    que devolve muitas linhas custa isso a cada intervalo, e o texto de ajuda do campo pede uma que
    devolva uma linha. No PostgreSQL ela roda numa transação só de leitura: nem uma função chamada
    por ela grava.
  - "Testar conexão" (RN-CONN-013) usa a consulta do formulário, quando há uma.
  - O intervalo e a consulta são da conexão; a pasta não os tem, e a cópia da conexão (RN-CONN-016)
    os leva.
- **RN-VERIF-002.** Enquanto a conexão está conectada (a sessão da árvore ou a de alguma aba, a
  mesma conta da lista do botão da conexão da aba, RN-ARVORE-008), a tela pede a verificação a cada
  intervalo, `POST api/user/connections/{id}/verification`, um pedido por vez: o intervalo conta do
  fim do anterior. A API:
  - roda a consulta numa sessão da conexão que já está aberta (de qualquer banco dela), nunca numa
    nova: sem nenhuma sessão aberta no cofre aberto, responde `notConnected`, e não há o que
    verificar;
  - nunca numa sessão com cursor aberto, que a consulta fecharia (RN-SQL-007), nem numa com comando
    em andamento: escolhe primeiro a sessão sem resultado (a da árvore, que só faz catálogo) e depois
    a de uma aba sem cursor aberto, e, quando todas estão ocupadas, responde `busy` na hora, sem
    esperar a vez ("ocupada, verificada na próxima");
  - responde `ok`, com o tempo da consulta, ou `failed`, com a mensagem do banco como veio e o
    SQLSTATE quando o driver o informa. A sessão cuja conexão caiu sai do registro, como depois de
    qualquer falha, e a verificação seguinte responde `notConnected` se não sobrou outra;
  - usa o prazo do driver para a consulta, como o catálogo;
  - registra no log a verificação que falhou, e a que deu certo só em nível de depuração (seria uma
    linha a cada intervalo de cada conexão).
  - A verificação não conta como atividade da pessoa nem como comando em andamento para o bloqueio
    por inatividade (RN-SEG-001), e não contará para o encerramento por ociosidade, quando ele vier
    (seção 13). Ela não roda com a verificação desligada, nem com o cofre bloqueado.
  - A verificação também não deixa a sessão ocupada para a pessoa: o comando ou o "Salvar" que
    chega durante ela espera o fim dela (no máximo o prazo do driver), em vez de responder
    `SESSION_BUSY` (RN-SESSAO-002), e o "Cancelar" pedido nessa espera faz o comando desistir na
    hora, sem esperar o fim dela e sem ir ao banco, como cancelado (RN-SQL-010); a verificação em si
    não é interrompida.
- **RN-VERIF-003.** O indicador, ao lado do nome da conexão conectada na árvore (no lugar do ponto de
  conectada) e na barra de status da aba dela:
  - "Respondeu na última verificação", o ponto do canvas, com a hora e o tempo na dica ("Respondeu
    às 14:32:05, em 3 ms");
  - "Não respondeu", no tom de erro, com a mensagem do banco na dica e num clique, como o erro de um
    nó da árvore (RN-ARVORE-005);
  - a resposta `busy` deixa o indicador como estava, com "Ocupada: verificada na próxima" na dica;
  - com `notConnected` a tela para de verificar a conexão, e o indicador diz "Sem sessão aberta"; a
    próxima ação na árvore ou na aba abre a sessão de novo, como hoje (RN-AVISO-003). Até lá ela não
    conta como conectada (RN-NAV-013).
  - Quando a conexão passa de responder a não responder, um aviso de atenção diz isso uma vez ("MES
    Produção não respondeu à verificação"), e não se repete enquanto ela continuar sem responder;
    quando ela volta a responder, um aviso de sucesso diz isso.
  - Com a verificação desligada não há indicador: fica o ponto de conectada de sempre.

### Só as conectadas

- **RN-NAV-013.** A barra do navegador ganha "Só as conectadas", um botão de alternar ao lado do
  seletor de ambiente (RN-NAV-010), que mostra quantas conexões estão conectadas ("3 conectadas"),
  ligado ou não: é o que o colega pediu, saber se há conexões abertas.
  - Conectada é a conexão com a sessão da árvore aberta ou com uma aba conectada, a mesma conta da
    lista do botão da conexão da aba (RN-ARVORE-008) e do script genérico (RN-SCRIPT-005).
  - A conexão cuja verificação respondeu que a API não tem sessão aberta com ela (o "Sem sessão
    aberta" da RN-VERIF-003) não conta como conectada, na conta, no filtro e na lista do botão da
    conexão, até uma sessão nova abrir (a próxima ação na árvore ou na aba): o indicador e a conta
    dizem o mesmo. O "Desconectar" do menu continua valendo para ela, e na árvore e na barra de
    status quem diz o estado dela é o indicador.
  - Ligado, a árvore mostra só as conexões conectadas e as pastas no caminho até elas. Combina com o
    campo de filtro e com o seletor de ambiente, como os dois entre si.
  - A conexão que desconecta sai da árvore filtrada na hora, e a que conecta (pela árvore, por uma
    aba, por um script) entra.
  - Sem nenhuma conectada, o botão diz "Nenhuma conectada", e, ligado, a árvore diz "Nenhuma conexão
    conectada." com "Mostrar todas", que o desliga.
  - A escolha vale enquanto a janela está aberta, como a do ambiente.
  - A API não muda: a tela já sabe quais conexões estão conectadas, e a verificação diz quais
    perderam a sessão.

### Rotas e respostas

| Rota | Sucesso | Recusas |
| --- | --- | --- |
| `GET api/user/folders` | 200 lista; cada pasta ganha `confirmCommands`, `readOnly` e `protections` | |
| `POST api/user/folders` `{ ..., confirmCommands?, readOnly? }` | 201 a pasta, com `protections` | as de antes, com `FOLDER_NAME_INVALID` também no campo `confirmCommands` |
| `PATCH api/user/folders` `{ ..., confirmCommands?, readOnly?, userPassword? }` | 200 a pasta, com `protections` | as de antes; 422 `USER_PASSWORD_REQUIRED`, `INVALID_PASSWORD` (no campo `userPassword`, RN-PROT-003); 401 `VAULT_LOCKED` no quinto erro seguido |
| `GET api/user/connections` e `GET api/user/connections/{id}` | 200; cada conexão ganha `confirmCommands`, `readOnly`, `verificationEnabled`, `verificationInterval`, `verificationQuery` e `protections` | as de antes |
| `POST api/user/connections` `{ ..., confirmCommands?, readOnly?, verificationEnabled?, verificationInterval?, verificationQuery? }` | 201 a conexão, com `protections` | as de antes, com `CONNECTION_INVALID` também nos campos novos |
| `PATCH api/user/connections` `{ ..., os mesmos, userPassword? }` | 200 a conexão, com `protections` | as de antes; 422 `USER_PASSWORD_REQUIRED`, `INVALID_PASSWORD` (no campo `userPassword`); 401 `VAULT_LOCKED` no quinto erro seguido |
| `POST api/user/connections/{id}/duplicate` | 201 a cópia, com as proteções e a verificação da origem | as de antes |
| `POST api/user/connections/test` `{ ..., verificationQuery? }` | 204 | as de antes, com `CONNECTION_INVALID` também no campo `verificationQuery` |
| `POST api/user/connections/{id}/verification` (sem corpo) | 200 `{ status, checkedAt, elapsedMs, message, sqlState }` | 404 `CONNECTION_NOT_FOUND` |
| `POST .../queries` | como antes; na conexão somente leitura a página leva `editable: { known: true, reason: "a conexão é somente leitura" }` | as de antes, mais 422 `CONNECTION_READ_ONLY` |
| `POST .../queries/edit-target`, `.../queries/edits` e `.../queries/edits/preview` | como antes | as de antes, mais 422 `CONNECTION_READ_ONLY` |

Notas:

- `confirmCommands`: `none`, `irreversible` ou `all`. Ausente, nulo, vazio ou `none` é "Não", e a
  resposta o devolve nulo, como o ícone padrão do script (RN-SCRIPT-006). Fora da lista: 422 no
  campo ("Escolha não confirmar, só os comandos irreversíveis ou todos os comandos.").
- `readOnly`: booleano; ausente é falso.
- O `PATCH` grava a pasta e a conexão por inteiro, como já faz com o ambiente e a cor: sem
  `confirmCommands`, a confirmação volta a "Não"; sem `readOnly`, a opção própria sai (e, se estava
  marcada, a senha é pedida, RN-PROT-003); sem os campos da verificação, ela volta ao padrão. Quem
  só renomeia ou move manda o que a conexão ou a pasta já têm.
- `verificationEnabled`: ausente ou nulo, verdadeiro. `verificationInterval`: os segundos, de 5 a
  3.600; ausente ou nulo, 30 (texto e número com casas são o 400 do MVC, como na porta).
  `verificationQuery`: até 1.000 caracteres depois de aparada, uma leitura só (RN-VERIF-001); em
  branco é nula, e vale a do banco. A resposta devolve os três como valem (`true`, `30` e nulo no
  padrão).
- `protections`: `{ readOnly, readOnlyFolderID, confirmCommands, confirmCommandsFolderID }`, as que
  valem (RN-PROT-004). `readOnlyFolderID` e `confirmCommandsFolderID` são a pasta acima que impõe o
  valor, e nulos quando ele é o próprio ou quando não há proteção; `confirmCommands` nulo é "Não".
  Na pasta, o mesmo, com as pastas acima dela.
- `userPassword`: a senha do usuário do Prism, só quando a RN-PROT-003 a pede; nunca vai a log nem
  volta numa resposta.
- `verification`: `status` é `ok`, `failed`, `busy` ou `notConnected`; `checkedAt` é o instante da
  resposta (UTC); `elapsedMs`, o tempo da consulta (só em `ok` e `failed`); `message` e `sqlState`,
  só em `failed`, com a mensagem do banco como veio e o SQLSTATE quando o driver o informa. A falha
  do banco é resposta 200, e não erro: a tela a mostra no indicador, sem o aviso de erro de toda
  chamada que falha (RN-AVISO-004). O cofre fechado é o 401 de sempre. A rota não olha
  `verificationEnabled`: quem decide se pede é a tela, e a consulta é a gravada na conexão.
- `CONNECTION_READ_ONLY` (422): o comando não é uma leitura numa conexão somente leitura, ou a rota é
  da edição; nada foi ao banco, e o resultado anterior continua (a recusa não leva `executed`).

### O que muda nas regras existentes

Cada mudança está escrita na própria regra; aqui fica só a lista.

- **Seção 2**: a entrega 3 diz o que entrou por esta seção e o que fica.
- **RN-CONN-010**: as proteções e a sessão da conexão.
- **RN-CONN-013**: o teste usa a consulta de verificação do formulário, quando há uma.
- **RN-PASTA-005**: a pasta tem também as proteções, que valem para tudo o que está dentro dela.
- **RN-EDIT-002**: o resultado inteiro é só leitura na conexão somente leitura.
- **RN-GRADE-014**: ligar a atualização automática pergunta uma vez em "Todos os comandos".
- **RN-SQL-019**: a confirmação vem uma vez, antes do primeiro comando do script, e na conexão
  somente leitura cada comando passa pela recusa da API.
- **RN-SQL-021**: a recusa do somente leitura (`CONNECTION_READ_ONLY`) é erro do comando, e o script
  pergunta o que fazer, como no erro do banco.
- **Seções 6, 9 e 13**: as rotas e os códigos novos; o que o formulário, o diálogo da pasta, o aviso e
  o navegador fazem diferente do canvas; o que entrou e o que continua fora.
- O "fica para depois" da seção 22 citava as proteções "que vão restringir a edição": a restrição é a
  da RN-PROT-002 (nenhuma edição na conexão somente leitura) e a da RN-PROT-001 (o "Salvar" pergunta
  em "Todos os comandos").
- **RN-SEG-001**: a verificação periódica não é atividade nem comando em andamento (RN-VERIF-002).

### Fica para depois

- O encerramento por ociosidade ("Encerrar a conexão após N minutos sem uso", do canvas), que o dono
  não pediu agora (seção 13).
- Proteções por esquema ou por tabela, e a lista de comandos irreversíveis escolhida pela pessoa.
- A verificação de cada banco aberto da conexão (RN-ARVORE-006): hoje uma sessão qualquer da conexão
  responde por ela.

## 33. Complemento de 2026-10-16, versão 0.4.0: a barra de edição da grade, duplicar linha, as abas do script que se editam e as pastas de scripts

Pedidos do dono em 2026-10-16: "editar célula, adicionar linha, duplicar linha e excluir linha nos
resultados de scripts sql e na tab dos registros de uma tabela", como a barra de baixo do resultado do
DBeaver (quatro botões com ícones: o lápis, o mais, as duas folhas e o X vermelho); e "nos scripts de
SQL também, adicione a possibilidade de criar pastas para mantê-los organizados". O dono escolheu
entregar o que pediu naquele dia em partes, e esta é a primeira; exportar e importar conexões, exportar
os dados em vários formatos e importar dados terão complementos próprios.

A edição já existia (seção 22), mas sem botões à vista e sem duplicar; no "Executar script" (seção 31)
só a aba do último comando se editava, porque a API guardava um resultado só por sessão; e a seção
Scripts era uma lista. A seleção de várias linhas da grade (RN-GRADE-001) continua especificada e por
construir: os botões agem na linha da célula ativa. Muda a RN-EDIT-001, 002, 003, 004, 005, 007 e 009,
a RN-GRADE-004 e 014, a RN-SQL-020, a RN-SCRIPT-001, 002 e 003, a RN-TABELA-002, a RN-PROT-002, a
RN-NAV-002 e 011, e as seções 6, 9, 22, 23 e 31. O canvas não desenha a barra de edição nem as pastas
de scripts (seção 9). O cofre passa ao formato 4 (RN-SCRIPT-011).

### Barra de edição

- **RN-EDIT-013.** A barra de edição, como a de baixo do resultado do DBeaver.
  - Onde:
    - nos Registros de uma tabela, no rodapé que já existe, logo depois de "Exportar CSV" (antes da
      contagem das linhas carregadas e do "Carregar mais");
    - no resultado da aba de consulta e em cada aba de resultado do "Executar script" (RN-SQL-020),
      numa linha própria dentro da área de resultado, alinhada à esquerda, entre a grade e os rodapés
      dela ("Carregar mais"; "O cursor foi fechado" com "Executar de novo"; a nota da aba de um resultado
      guardado, RN-SQL-023).
  - Só com a grade na tela: não aparece nas Estatísticas do script, nem sem grade (antes do primeiro
    resultado, com "Executando…" no lugar dela, nas linhas afetadas, no erro, na Estrutura e no
    Diagrama da aba de tabela), nem com a área de resultado recolhida (RN-PAINEL-001), que esconde o
    corpo dela. O resultado sem nenhuma linha tem grade (as colunas), e a barra aparece: é onde
    "Adicionar linha" mais serve.
  - É um grupo com papel de barra de ferramentas e o nome "Edição da grade", com quatro botões, nesta
    ordem, cada um com ícone e texto, no desenho dos botões da área de resultado ("Atualizar",
    "Exportar CSV": 28 px de altura e ícone de 16 px, no traço 1,5 do canvas):
    1. o lápis, "Editar célula", com a dica "Editar célula (F2)";
    2. o mais, "Adicionar linha", com a dica "Adicionar linha (Alt+Insert)";
    3. as duas folhas, "Duplicar linha", com a dica "Duplicar linha (Ctrl+Alt+Insert)";
    4. o X, no tom de erro do tema, "Excluir linha", com a dica "Excluir linha (Alt+Delete)".
  - Cada botão declara o atalho para o leitor de tela (`aria-keyshortcuts`), o da plataforma (no
    macOS, os da RN-EDIT-015, que a dica também escreve).
  - A barra é uma parada só do Tab, como a barra de ações do navegador: o Tab chega ao botão que teve
    o foco por último (de começo, "Editar célula"), e as setas para os lados, Home e End andam entre
    os quatro.
  - O botão que não se aplica fica à vista e desabilitado sem sair do caminho das setas (`aria-disabled`,
    como o "Contar total"): não age, e diz por quê na dica e para o leitor de tela (por
    `aria-describedby`, num texto só para ele, como o "Exportar CSV"). A dica é a do botão seguida do
    motivo, o mesmo que o item do menu da célula mostra: "Adicionar linha (Alt+Insert). Somente
    leitura: num resultado de junção só se alteram células."
  - Os botões só criam e tiram pendências (RN-EDIT-004): nada vai ao banco, e nenhum pergunta nada (a
    confirmação da RN-PROT-001 continua só no "Salvar"). "Salvar", "Descartar" e "Ver SQL" continuam
    na faixa de pendências sobre a grade, que não muda.
  - Com o campo de edição de uma célula aberto, clicar num botão confirma antes o que foi digitado (o
    campo confirma ao perder o foco, como hoje), e só então o botão age.
- **RN-EDIT-014.** Quando cada botão vale, e o que acontece depois dele.
  - Cada botão faz o que o item de mesmo nome do menu da célula faz sobre a célula ativa
    (RN-GRADE-001), e só sobre ela: "Editar célula" abre o campo de edição nela, com o valor, como o
    F2; "Adicionar linha" cria uma linha nova em branco; "Duplicar linha" duplica a linha da célula
    ativa (RN-EDIT-016); "Excluir linha" marca para exclusão a linha da célula ativa, que fica riscada,
    ou, quando ela é uma linha nova, a tira da grade.
  - Habilitar não custa consulta (RN-EDIT-010): enquanto o Prism não perguntou ao catálogo o que se
    edita naquele resultado, os botões ficam habilitados, e a primeira tentativa pergunta. Se a ação não
    vale, a faixa diz o motivo, como o menu e o Alt+Insert já fazem, e dali em diante o botão fica
    desabilitado com ele.
  - Ficam desabilitados desde o começo, com o motivo, quando ele já é sabido:
    - os quatro, quando o resultado inteiro é só leitura pelo que a página do resultado já diz
      (RN-EDIT-002, e a conexão somente leitura, RN-PROT-002), com o motivo da barra do resultado;
    - os quatro, com a aba ocupada (um comando, o "Salvar", o script rodando ou parado na pergunta de
      erro, RN-SQL-021): "há um comando em andamento na aba"; e enquanto a atualização automática lê
      as linhas de novo: "a atualização automática está lendo as linhas de novo; tente outra vez em um
      instante" (RN-GRADE-014);
    - "Adicionar linha", "Duplicar linha" e "Excluir linha", quando o catálogo já respondeu que o
      resultado não aceita linha nova nem exclusão (`rowOperations` falso): numa junção, "num
      resultado de junção só se alteram células"; senão, o motivo da tabela, ou "este resultado não
      aceita linha nova nem exclusão";
    - "Editar célula", pelo que vale na célula ativa (RN-EDIT-002): a tabela da coluna que não se
      edita, com o motivo da tabela ("<tabela> é uma visão" e os outros), e a coluna que não se edita,
      com o motivo da coluna (essas duas, quando o catálogo já disse); a linha marcada para exclusão; a
      célula cortada; a chave da linha cortada ou gerada pelo banco; a tabela sem linha ali numa
      junção externa (a chave dela veio nula); a célula que o banco preencheu numa linha nova salva
      (RN-EDIT-009);
    - "Excluir linha", na linha cuja chave não se sabe (cortada, ou gerada pelo banco numa linha nova
      salva) e na linha que já está marcada para exclusão: "a linha já está marcada para exclusão;
      Desfazer alteração a devolve" (o item do menu também);
    - sem célula ativa, "Editar célula" diz "Escolha uma célula na grade.", e "Duplicar linha" e
      "Excluir linha" dizem "Escolha uma linha na grade."; na grade sem nenhuma linha (nem lida, nem
      nova), os três dizem "O resultado não tem linhas.", e "Adicionar linha" continua valendo.
  - Quando mais de um motivo vale, a dica, o leitor de tela e a faixa dizem só o primeiro, na ordem da
    lista acima (e, dentro de um item, na ordem em que ele os escreve). Os motivos entram na frase
    "Somente leitura: <motivo>." como os de hoje, também o da aba ocupada e o da linha marcada para
    exclusão; os três da falta de célula ou de linha não são de só leitura e vêm sozinhos: "Editar
    célula (F2). Escolha uma célula na grade."
  - Depois do botão, o foco volta à grade, como volta quando o botão que o tinha sai da tela
    (RN-SQL-006), menos no "Editar célula", em que ele vai para o campo de edição e volta à grade
    quando o campo confirma ou cancela.
    - "Adicionar linha" e "Duplicar linha" põem a linha nova no fim da grade, depois das lidas e das
      novas de antes, como o Alt+Insert faz hoje; a grade rola até ela, e a célula ativa vai para ela,
      na primeira coluna editável (na duplicada que copiou a chave, na coluna da chave mais à
      esquerda na grade, RN-EDIT-016).
    - "Excluir linha" deixa a célula ativa na mesma linha, riscada. Tirada uma linha nova, a célula
      ativa passa à linha que ficou no lugar dela, ou à de cima, quando ela era a última; sem linha
      nenhuma, não há célula ativa.
  - A atualização automática fica em pausa desde o começo da ação, como no menu, e a ação cujo
    resultado mudou no meio não age (RN-GRADE-014).
- **RN-EDIT-015.** Os atalhos, com o foco na grade (e não no campo de edição de uma célula, que fica
  com as teclas dele).
  - F2 (e Enter) edita a célula ativa; Alt+Insert adiciona uma linha; Ctrl+Alt+Insert duplica a linha
    da célula ativa; Alt+Delete exclui a linha da célula ativa, como no DBeaver. O menu da célula e as
    dicas da barra escrevem os mesmos atalhos.
  - Os modificadores são exatos: Alt+Insert sem Ctrl, Shift nem Cmd; Ctrl+Alt+Insert sem Shift;
    Alt+Delete sem Ctrl, Shift nem Cmd. A grade confere o Ctrl+Alt+Insert antes do Alt+Insert, que
    está dentro dele (hoje o Alt+Insert também casa com o Ctrl+Alt+Insert e com o Shift+Alt+Insert).
    Com Shift nada acontece: o Shift+Alt+Insert e o Ctrl+Shift+Alt+Insert que o DBeaver ganhou na
    26.1 (a linha nova e a duplicada antes da atual) ficam para depois.
  - O Delete sozinho não exclui a linha da célula ativa: o dele é o da RN-EDIT-001, o das linhas
    inteiras escolhidas pelo número da linha, que espera a seleção de linhas da RN-GRADE-001.
  - No Windows, o Alt da direita do teclado ABNT2 (e dos outros teclados que têm AltGr) é o AltGr, e
    chega como Ctrl+Alt: com ele, Insert duplica, e Delete não faz nada. Os atalhos valem com o Alt da
    esquerda; os botões e o menu cobrem o resto. O Insert não escreve caractere, e por isso o
    Ctrl+Alt+Insert não deixa o AltGr de fora, como o Alt+X deixa (RN-SQL-019).
  - No macOS, como nos outros atalhos da grade (o Cmd+S, o Cmd+C), o Option faz o papel do Alt e o Cmd
    o do Ctrl: Option+Insert, Cmd+Option+Insert e Option+Delete, e a dica e o menu os escrevem assim.
    Control+Option+Insert, o do DBeaver no macOS, também duplica (sem Shift nem Cmd).
    Ao contrário do Alt+X do script (RN-SQL-019), nenhum deles escreve caractere (o foco está na
    grade, não num campo de texto, e o Insert e o Delete não são teclas de caractere), então não há
    troca de tecla. A tecla "delete" do Mac é a de apagar para trás: Option+delete exclui a linha, e
    Option+fn+delete (apagar para a frente) também. O teclado do Mac não tem Insert: ali "Adicionar
    linha" e "Duplicar linha" ficam na barra e no menu, e o atalho vale para quem usa um teclado que
    tem a tecla.

### Duplicar linha

- **RN-EDIT-016.** "Duplicar linha" cria uma linha nova pendente com os valores da linha da célula
  ativa.
  - Vale onde "Adicionar linha" vale: no resultado de uma tabela só que aceita linha nova e exclusão
    (`rowOperations`, RN-EDIT-002). Numa junção fica desabilitado, com o motivo de hoje ("num
    resultado de junção só se alteram células").
  - A linha de origem pode ser uma lida (com alterações pendentes ou sem elas), uma marcada para
    exclusão (copia os valores lidos), uma nova pendente (copia o que foi preenchido nela, também numa
    duplicada) ou uma nova já salva na aba de consulta (RN-EDIT-009).
  - A cópia vai para o fim da grade, como a linha de "Adicionar linha" (RN-EDIT-014): as linhas novas
    vêm sempre depois das lidas. Pôr a cópia logo abaixo da linha de origem, como o DBeaver, fica para
    depois.
  - O que copia: o valor que a tela mostra (com a pendência, quando há; o nulo, como nulo), como o
    copiar (RN-EDIT-007), de cada coluna do resultado que se edita na tabela. Não copia, e essas
    colunas ficam com o padrão da tabela, como na linha em branco:
    - as que o banco gera, "sempre" e "por padrão", para ele gerar o valor da linha nova: a
      identidade (as duas formas, no PostgreSQL e no Db2), o `SERIAL`, o `SERIAL8` e o `BIGSERIAL` do
      Informix e, no PostgreSQL, a coluna cujo padrão é o próximo valor de uma sequência
      (`nextval(...)`: o `serial` e o `bigserial`). Para isso, o `edit-target` diz
      `generated: "byDefault"` também nessa coluna do PostgreSQL; o catálogo continua a mostrá-la como
      padrão, e não como coluna gerada (RN-CAT-001 não muda);
    - as que não se editam: a calculada, a binária, a de um tipo que o Prism não converte
      (RN-EDIT-006);
    - numa linha nova já salva, as que o banco preencheu ("gerado pelo banco — execute de novo para
      ver", RN-EDIT-009), cujo valor a tela não sabe.

    As colunas da tabela que o comando não trouxe também ficam com o padrão dela.
  - A célula cortada (RN-SQL-011) de uma coluna que se copia vai com o valor completo, que a tela busca
    antes na API (RN-SQL-017), como o copiar e o exportar: enquanto busca, a faixa diz "Buscando os
    valores completos…", com "Cancelar". Se um valor não vem inteiro (passou do teto de 256 MB, é o
    resultado de uma aba guardada do script, que não guarda valor completo, RN-SQL-024, ou a sessão
    mudou ou caiu), nada é duplicado, e a faixa diz: "A linha não foi duplicada: o valor completo de
    <coluna> não pôde vir. Execute o comando de novo para duplicá-la." Nos Registros, que não têm
    comando: "A linha não foi duplicada: o valor completo de <coluna> não pôde vir. Atualize os
    registros para duplicá-la." Cancelada a busca: "A linha não foi duplicada: a busca dos valores
    completos foi cancelada."
  - A chave: quando todas as colunas da chave da tabela (a da RN-EDIT-002) foram copiadas, a faixa
    avisa "A linha duplicada copiou a chave de <tabela> (<colunas>): troque-a antes de salvar, ou o
    banco vai recusar a linha repetida.", e a célula ativa vai para a coluna da chave mais à esquerda
    na grade. A chave com uma coluna gerada pelo banco não é copiada inteira e não pede o aviso. Salvar
    sem trocar a chave dá a recusa do banco, como veio (RN-EDIT-005).
  - Quando uma coluna da tabela que está no resultado não foi copiada, a faixa diz quais: "Não
    copiadas (ficam com o padrão da tabela): id, foto." (com uma só, "Não copiada (fica com o padrão
    da tabela): id."). Na linha nova de origem, as colunas que ela não tinha preenchido não entram na
    lista: já estavam com o padrão. As duas frases podem vir juntas, e ficam até a próxima ação de
    edição, o "Salvar" ou o "Descartar".
  - A linha duplicada é uma linha nova (RN-EDIT-004): tem as marcas dela ("Linha nova" no número da
    linha, "linha nova N" na faixa), conta como uma alteração, e entra no "Ver SQL" e no "Salvar" como
    um `INSERT` com as colunas copiadas e as que a pessoa preencheu depois (RN-EDIT-005). "Excluir
    linha" a tira da grade; "Desfazer alteração" numa célula dela tira o valor daquela célula, que
    volta ao padrão da tabela, como numa linha em branco.
  - A duplicada sem nenhuma coluna copiada é a linha em branco: se nada for preenchido, o "Salvar"
    recusa como recusa a linha em branco ("A linha nova não tem nenhuma coluna preenchida.").

### As abas do script que se editam

- **RN-SQL-023.** Toda aba de resultado que o script mantém se edita.
  - As abas dos outros comandos que o script guarda (RN-SQL-020: as dos 20 primeiros que devolvem
    linhas, além da do último) se editam como a do último comando: valem as regras de edição da seção 22
    inteiras (RN-EDIT-001 a 012), a barra de edição e o duplicar (RN-EDIT-013 a 016), e o menu da
    célula, com copiar (também o Ctrl+C), colar, editar, definir como nulo, desfazer, adicionar,
    duplicar e excluir linha. "Filtrar" (F11), "Atualizar" (F5) e "Atualizar automaticamente" não
    estão no menu delas: são do resultado do último comando, que tem o cursor e executa de novo.
  - Continuam só leitura, com o motivo na faixa e nos botões, as que a RN-EDIT-002 tranca, como antes:
    a do comando que gravou e devolveu linhas, a de união, de `DISTINCT`, de agrupamento e as demais, e
    todas as de uma conexão somente leitura (RN-PROT-002).
  - A nota da aba de um resultado guardado passa a dizer: "O cursor deste resultado fechou quando o
    comando seguinte rodou. Carregar mais, Contar total, o filtro e a atualização automática valem no
    resultado do último comando." "Executar este comando" continua nela, como antes: executa só aquele
    comando e substitui os resultados do script.
  - Copiar uma célula cortada numa aba guardada leva o valor cortado, com o aviso de quantos vieram
    cortados (RN-GRADE-002, RN-SQL-017): o valor completo fica só com o resultado do último comando.
    Duplicar uma linha que precisa dele não acontece (RN-EDIT-016).
  - As pendências são de uma aba por vez. Trocar de aba de resultado (clique, setas, Home, End,
    também para as Estatísticas) com alterações não salvas pergunta antes: "Há N alterações não
    salvas", com "Salvar", "Descartar" e "Cancelar" (RN-EDIT-007). "Salvar" grava e então troca de aba;
    se o "Salvar" falha, a aba fica, com a falha na faixa. "Descartar" joga fora e troca. "Cancelar"
    fica onde estava, sem mudar nada. O resto da RN-EDIT-007 vale em qualquer aba do script como na do
    último comando.
  - Enquanto o script roda, ou espera a resposta da pergunta de erro (RN-SQL-021), a aba está ocupada
    para a edição em todas as abas de resultado: os botões e os itens de edição ficam desabilitados,
    com "há um comando em andamento na aba" (RN-EDIT-014).
  - Salvar numa aba que não é a do último comando é um comando na sessão (RN-EDIT-009): fecha o
    cursor aberto do último (RN-SQL-007). Se a aba do último ainda tinha linhas a ler, o "Carregar
    mais" dela dá lugar a "O cursor foi fechado", com "Executar de novo", como depois de salvar nela
    mesma. Ela continua se editando, o "Contar total" dela continua valendo (RN-SQL-006), e os valores
    completos das células cortadas dela continuam na API (RN-SQL-017).
  - Depois de salvar, a aba guardada segue a RN-EDIT-009: as linhas com os valores salvos, as
    excluídas fora, e a linha nova com "gerado pelo banco — execute de novo para ver" nas colunas que o
    banco preencheu. Executar de novo, ali, é o "Executar este comando".
  - As Estatísticas não contam as alterações salvas à mão, que não são comandos do script: as linhas
    de cada comando continuam as que ele leu, devolveu ou afetou, e "Linhas alteradas" continua a soma
    dos comandos.
  - A sessão que cai depois do script leva com ela o que a API guardava: as abas continuam na tela, com
    as linhas, e a primeira tentativa de editar (ou o "Salvar") responde como no resultado do último
    comando, com "Não foi possível saber o que se edita neste resultado." e o motivo da API na faixa (a
    sessão com o banco não existe mais). Nada reabre sozinho (seção 7 e RN-SQL-021): "Executar este
    comando" executa de novo numa sessão nova.
  - Levar a aba para outra janela leva só o resultado do último comando (RN-SQL-020). Com alterações
    não salvas numa aba guardada, a mudança pergunta antes, como a de qualquer aba com alterações não
    salvas, porque essa aba não vai. A API esquece os guardados no primeiro comando da aba na outra
    janela (RN-SQL-024).
- **RN-SQL-024.** O que a API guarda dos resultados do script.
  - A sessão guarda, além do resultado atual (o do último comando, com o cursor), o que a edição
    precisa de cada resultado que a tela pede para guardar, pelo `resultID` dele: as colunas (o nome, o
    tipo e, no PostgreSQL, a origem, RN-EDIT-003, que o "Salvar" e a conversão da RN-EDIT-006 usam), a
    leitura do texto do comando (Db2 e Informix) e o alvo da edição, quando já foi perguntado
    (RN-EDIT-010). Nunca as linhas, nem cursor, nem os valores completos das células cortadas: os
    256 MB da RN-SQL-017 continuam só do resultado atual, e a rota das células responde 404
    `RESULT_NOT_FOUND` para um guardado. O que fica é pouco (não tem linhas) e morre com a sessão:
    ao fechar, ao cair e no bloqueio do cofre.
  - `POST …/queries` ganha `keep`, opcional: os `resultID` que a aba continua mostrando, e editando,
    depois deste comando, até 20 (o teto da RN-SQL-020). Mais que isso, ou uma entrada que não é um
    identificador (nula, texto qualquer, número), é 422 `QUERY_INVALID` no campo `keep`, como o
    `pageSize` fora da forma, e nada vai ao banco. Quando o comando vai ao banco (dê certo ou não,
    também quando é desfeito com `executed`, RN-SESSAO-005), a API guarda, entre o resultado atual e
    os já guardados, os da lista, e esquece os outros; um `resultID` que ela não conhece é ignorado, e
    o repetido conta uma vez. Sem `keep`, ou com a lista vazia, ela esquece todos. A recusa antes de ir
    ao banco (as do texto e do filtro, a do somente leitura, a sessão ocupada: as que não levam
    `executed`) não muda nada: o resultado atual continua o atual, e os guardados continuam guardados.
  - Quem manda o quê:
    - cada comando do script manda os `resultID` das abas de resultado que o script já tem (a do
      comando anterior inclusive, quando ele ganhou aba), e o "Tentar de novo" (RN-SQL-021) manda a
      mesma lista;
    - o F5, "Executar de novo", aplicar o filtro, ordenar pela coluna e a atualização automática do
      resultado do último comando mandam os das outras abas do script, que ficam (RN-SQL-020) e
      continuam se editando;
    - o Ctrl+Enter, "Executar este comando", o primeiro comando de outro script e toda execução de uma
      aba sem abas de script não mandam nenhum, e a API esquece os guardados.
  - `edit-target`, `edits` e `edits/preview` aceitam o `resultID` do resultado atual ou o de um
    guardado. Outro `resultID` é 409 `RESULT_CHANGED`, agora com o detalhe "O resultado não está mais
    guardado na sessão: outro comando foi executado nela depois dele. Execute o comando de novo para
    editar."
  - O "Salvar" de um guardado toma a vez da sessão como qualquer "Salvar" (409 `SESSION_BUSY`) e fecha
    o cursor do resultado atual (RN-EDIT-009). O resultado atual continua o atual, com o `resultID` e os
    valores completos dele, e os guardados continuam guardados.
  - A tabela sem esquema no Db2 e no Informix (RN-EDIT-003). O texto de um guardado diz a tabela como
    foi escrita, e quem a resolve, na hora de editar, é a sessão: pelo esquema atual dela (Db2) ou pelo
    usuário dela (Informix) naquele momento, e não no da leitura. O driver da IBM não diz o esquema
    atual sem uma consulta (o `CurrentSchema` dele é só o da abertura da conexão), e perguntá-lo a cada
    comando seria a consulta a mais que a RN-EDIT-010 proíbe. Por isso a API conta, na sessão, os
    comandos executados que podem mudar essa resolução: os que começam, depois dos comentários e dos
    parênteses de abertura (o leitor da RN-PROT-005), por `SET` (`SET SCHEMA`, `SET CURRENT SCHEMA`,
    `SET CURRENT SQLID`, `SET SESSION AUTHORIZATION`…), `CALL` ou `EXECUTE` (a rotina pode mudá-la por
    dentro) e, no Informix, `DATABASE`. O guardado que tem uma tabela sem esquema no `FROM` deixa de se
    editar quando um deles foi executado depois dele: `edit-target`, `edits/preview` e `edits` respondem
    409 `RESULT_CHANGED`, sem executar nada, com o detalhe "Um comando executado depois deste resultado
    (como um SET ou um CALL) pode ter trocado o esquema atual da sessão, e <tabela>, escrita sem
    esquema, pode ser outra tabela agora. Nada foi gravado; escreva o esquema no comando
    (esquema.tabela), ou execute-o de novo." A tabela com o esquema escrito não depende disso. Na
    dúvida, recusa: o script que troca o esquema e volta ao de antes também tranca as abas de antes. O
    resultado atual nunca tem comando depois dele (o comando seguinte o substitui), e o "Salvar" dele
    continua conferindo o esquema na própria sessão (RN-EDIT-003).
  - No PostgreSQL a origem de cada coluna é a tabela pelo identificador interno dela (o OID), que vem
    na resposta do comando, e não pelo nome: o que um guardado edita é sempre a tabela que ele leu. Se o
    nome escrito sem esquema leva agora a outra tabela (um `SET search_path` depois dele), ou se a
    tabela foi apagada e criada de novo (o OID é outro), as colunas dele ficam só leitura, e nada vai
    para a outra tabela. Isso vale na primeira pergunta do alvo; quando o alvo já tinha sido perguntado
    antes da mudança, quem a descobre é a conferência de dentro da transação do "Salvar" (RN-EDIT-005):
    409 `RESULT_CHANGED`, com o detalhe da tabela que mudou ("A tabela <nome> mudou desde a
    consulta…"), e nada é gravado.
  - No Db2 e no Informix, a tabela recriada com o mesmo nome, a mesma chave e as mesmas colunas e tipos
    passa pela conferência do "Salvar" (RN-EDIT-005), e a alteração vai à tabela nova pela chave, como
    iria se outra sessão a tivesse recriado (RN-EDIT-011).

### Pastas de scripts

- **RN-SCRIPT-007.** Pastas de scripts.
  - São da seção Scripts, e não as pastas de conexões (RN-PASTA-001 a 007): não têm cor, ambiente nem
    proteções, não aparecem na árvore das conexões, as de conexões não aparecem entre elas, e nada
    herda delas. Campos: o nome, a pasta pai (opcional: sem ela, a pasta fica na raiz da seção
    Scripts) e as datas de criação e de alteração.
  - Aninham sem limite de profundidade. O nome tem de 1 a 60 caracteres, contados depois de
    normalizado como o da pasta de conexões (os espaços das pontas tirados, os de dentro juntados num
    só); não tem caractere de controle no texto que veio, conferido antes de normalizar (a
    normalização trocaria a tabulação e a quebra de linha por espaço), como o nome do script
    (RN-SCRIPT-004); e é único entre as irmãs, sem diferenciar maiúsculas (409
    `SCRIPT_FOLDER_ALREADY_EXISTS`), sem contar a própria pasta: mudar só as maiúsculas do nome dela
    não é repetição. Uma pasta e um script podem ter o mesmo nome no mesmo lugar.
  - Mover uma pasta para dentro dela mesma ou de uma descendente é recusado (409
    `SCRIPT_FOLDER_CYCLE`). Só a pasta vazia, sem subpastas e sem scripts, se exclui (409
    `SCRIPT_FOLDER_NOT_EMPTY`, que diz quantas subpastas e quantos scripts ela tem). A pasta, ou a
    pasta pai, que não existe é 404 `SCRIPT_FOLDER_NOT_FOUND`.
  - Cada script tem uma pasta, opcional: sem ela, ele fica na raiz da seção. O nome do script continua
    único entre todos os scripts do usuário, de qualquer pasta (a RN-SCRIPT-004 não muda), porque a aba
    mostra só o nome; mover um script não confere nome.
  - Mover não muda mais nada: o script leva a conexão, o banco, o genérico, o ícone e a cor
    (RN-SCRIPT-005 e 006), e as abas abertas com ele continuam, com o mesmo nome; a pasta leva o que tem
    dentro.
  - As conferências (o nome, o ciclo, a pasta vazia, a pasta que existe) são feitas na própria gravação
    do cofre, contra o documento mais recente: duas janelas não criam duas pastas irmãs de mesmo nome,
    nem uma exclui a pasta em que a outra acabou de pôr um script.
- **RN-SCRIPT-008.** A seção Scripts é uma árvore.
  - Com papel de árvore e o nome "Scripts salvos", com as pastas e os scripts como itens dela, cada um
    com o nível dele, e a pasta dizendo se está aberta. Em cada nível vêm primeiro as subpastas e depois
    os scripts, cada grupo por nome (na ordem do português, sem diferenciar maiúsculas), como as pastas
    e as conexões do navegador. A pasta tem o ícone de pasta, neutro, aberto ou fechado; o script, o
    ícone e a cor dele (RN-SCRIPT-006) e a marca do genérico (RN-SCRIPT-005), com as dicas de hoje. A
    pasta vazia não tem a seta de abrir.
  - Uma linha só fica na ordem do Tab, a escolhida. As setas para cima e para baixo andam pelas linhas à
    vista; Home e End vão à primeira e à última. A seta para a direita abre a pasta fechada e, na
    aberta, vai à primeira linha dentro dela. A seta para a esquerda fecha a pasta aberta e, na fechada
    ou num script, vai à pasta pai (na raiz, não faz nada). Enter e o duplo clique abrem e fecham a
    pasta, e abrem o script, como hoje. F2 renomeia a pasta ou o script; Delete exclui (RN-SCRIPT-009);
    Shift+F10 e a tecla de menu abrem o menu.
  - As pastas começam abertas, e abrir e fechar vale enquanto a janela está aberta, como as pastas de
    conexões: não se grava. Recolher a seção inteira continua lembrado (RN-NAV-012).
  - A densidade do navegador vale para ela (RN-NAV-011): as linhas de 30 ou de 22 px, e o recuo de 16
    ou de 12 px a cada nível.
  - Sem pasta e sem script, a seção diz o que diz hoje ("Nenhum script salvo. Ctrl+S numa aba de
    consulta salva o SQL dela aqui."). Com pastas e sem script, mostra as pastas.
  - A pasta ou o script cuja pasta não está na lista (outra janela a excluiu entre duas leituras)
    aparece na raiz, até a leitura seguinte.
  - Depois de criar, renomear ou mover uma pasta ou um script pela seção, ele fica à vista (as pastas
    acima dele abrem) e escolhido, com o foco.
- **RN-SCRIPT-009.** Os menus e os diálogos das pastas de scripts.
  - O botão direito no título da seção ou no espaço vazio dela, e Shift+F10 ou a tecla de menu com o
    foco no título, abrem um menu com "Nova pasta", que cria na raiz.
  - O menu de uma pasta tem "Nova subpasta"; "Renomear" (F2) e "Mover para…"; e "Excluir" (Delete).
  - O menu de um script é o de hoje (RN-SCRIPT-003, 005 e 006), com "Mover para…" logo depois de
    "Editar script…".
  - "Nova pasta" e "Nova subpasta" abrem um diálogo com o título "Nova pasta" ou "Nova subpasta", o
    campo "Nome da pasta" e onde ela vai ficar ("Na raiz da seção Scripts." ou "Dentro de Fechamento /
    Mensal.", o caminho da pasta pai), com "Cancelar" e "Criar pasta" ("Criando…"). O aviso: "Pasta
    criada."
  - O "Renomear" (F2) da pasta abre o diálogo "Renomear pasta", só com o nome, e "Renomear"
    ("Renomeando…"); o nome igual ao de antes (depois de normalizado, e com as mesmas maiúsculas)
    fecha sem gravar, e mudar só as maiúsculas grava. O aviso: "Pasta renomeada."
  - As recusas do nome ficam no campo, sem aviso de erro (RN-AVISO-004): "Dê um nome à pasta.", "O
    nome pode ter até 60 caracteres.", "O nome não pode ter tabulação, quebra de linha nem outro
    caractere de controle." e "Já existe uma pasta com este nome aqui." A pasta pai que outra janela
    excluiu no meio (404 `SCRIPT_FOLDER_NOT_FOUND`) não é do campo: vai ao aviso de erro
    (RN-AVISO-004), com o detalhe da API ("A pasta pai não existe mais."), o diálogo fica aberto, e a
    lista é lida de novo.
  - "Mover para…", da pasta e do script, abre o diálogo "Mover pasta" ou "Mover script", com "Escolha a
    pasta de destino de <nome>." e o campo "Pasta": "Sem pasta" (a raiz) e as pastas de scripts, cada
    uma com o caminho inteiro ("Fechamento / Mensal"), na ordem da árvore, com a de agora já escolhida.
    Para uma pasta, a lista não traz ela mesma nem as subpastas dela. "Cancelar" e "Mover"
    ("Movendo…"); o destino igual ao de agora fecha sem gravar. As recusas da API são de regra, e não
    do campo: vão ao aviso de erro (RN-AVISO-004), com o detalhe dela, e o diálogo fica aberto, como no
    "Mover" das conexões: "Já existe uma pasta chamada <nome> em <destino>." (o nome repetido entre as
    irmãs do destino); "A pasta de destino não existe mais."; e, quando outra janela mexeu nas pastas
    no meio, "Uma pasta não pode ir para dentro dela mesma nem de uma subpasta dela." Depois de cada
    recusa a lista é lida de novo. Os avisos: "Pasta movida." e "Script movido."
  - "Excluir" na pasta vazia (e o Delete nela) pergunta "Excluir a pasta <nome>?", com "A pasta está
    vazia e sai da seção Scripts.", "Cancelar" (o foco começa nele) e "Excluir pasta", no tom de perigo.
    O aviso: "Pasta excluída."
  - Na pasta que tem alguma coisa dentro, "Excluir" fica desabilitado no menu, com o motivo ("a pasta
    tem 2 subpastas e 3 scripts: mova ou exclua antes o que está dentro dela", no singular "1 subpasta"
    e "1 script", e só com a parte que existe), e o Delete nela não abre a pergunta: um aviso de erro
    (RN-AVISO-004) diz o mesmo. A recusa 409 `SCRIPT_FOLDER_NOT_EMPTY` da API (outra janela pôs algo
    nela depois da leitura) fecha a pergunta e vai ao aviso de erro, com o detalhe dela ("A pasta
    <nome> tem 1 script. Só uma pasta vazia pode ser excluída: mova ou exclua antes o que está dentro
    dela."), e a lista é lida de novo, como no "Excluir" das pastas de conexões.
  - Arrastar e soltar não existe no navegador: mover é pelo diálogo, como o "Mover" das conexões
    (RN-NAV-003).
- **RN-SCRIPT-010.** A pasta ao salvar.
  - O diálogo do nome do primeiro Ctrl+S e do "Salvar como" (RN-SCRIPT-001) ganha o campo "Pasta",
    depois do nome e antes da caixa do script genérico, com as escolhas do "Mover para…" ("Sem pasta" e
    as pastas, com o caminho). No "Salvar como", vem escolhida a pasta em que o script de onde a aba
    veio está na lista. No Ctrl+S do script que outra janela excluiu, que pede o nome de novo, o script
    não está mais na lista, e vem a pasta que ele tinha quando a aba o abriu ou o gravou pela última
    vez, que a aba lembra sem gravar no cofre (a aba que voltou numa entrada nova, RN-ABAS-006, não a
    sabe). Vem "Sem pasta" na aba que não veio de um script, quando a pasta não é sabida, ou quando
    ela não existe mais.
  - O Ctrl+S que grava por cima, o "Renomear", o "Editar script…", "Tornar genérico" e "Vincular à
    conexão da aba" não mudam a pasta.
  - A pasta escolhida que outra janela excluiu antes de gravar é recusada no campo ("A pasta escolhida
    não existe mais."), a lista é lida de novo, e o script não é gravado.
  - O aviso diz onde o script ficou: "Script <nome> salvo em Fechamento / Mensal." (na raiz, "Script
    <nome> salvo.", como hoje). O Ctrl+S que grava por cima continua dizendo "Script <nome> salvo.",
    em qualquer pasta. A árvore não abre a pasta sozinha nem tira o foco do editor.
- **RN-SCRIPT-011.** O cofre no formato 4.
  - O documento do cofre ganha a lista das pastas de scripts, e o registro do script ganha a pasta (no
    fim dele, nula na raiz). A lista nova sobe o formato do cofre de 3 para 4 (RN-VERSAO-005), como os
    scripts o subiram para o 2 e a área de trabalho para o 3 (RN-SCRIPT-002, RN-ABAS-006).
  - O cofre do formato 3 (e o do 1 e o do 2, passo a passo, em ordem) é migrado ao abrir: a lista de
    pastas de scripts vem vazia, e todo script fica na raiz; o resto passa como está. O arquivo de antes
    fica no `.bak` (RN-COFRE-005), e a falha do disco na migração não impede a entrada, como nos
    formatos 2 e 3.
  - Uma amostra do formato 3, gravada pelo código do formato 3 antes desta mudança (dados inventados,
    a mesma senha fictícia das amostras do 1 e do 2), fica no repositório e não se regera. O teste a abre
    e prova a migração (tudo o que ela tem continua, as pastas de scripts vêm vazias, os scripts ficam na
    raiz, o `.bak` é o arquivo de antes), a entrada seguinte sem regravar e a primeira pasta gravada
    depois. Os testes das amostras do 1 e do 2, que fixam `VaultCrypto.Version` em 3, passam a 4, e o
    documento esperado deles ganha a lista vazia; os que fingem um formato mais novo usam
    `VaultCrypto.Version + 1` e passam sozinhos ao 5.
  - O Prism anterior (a 0.3.0, e os pré-lançamentos da 0.4.0 de antes desta mudança) recusa o cofre do
    formato 4 com 409 `VAULT_FORMAT_UNSUPPORTED`, com a instrução de atualizar (RN-VERSAO-005). O
    formato do cofre é contrato (RN-VERSAO-002), e a 0.4.0 já sobe o segundo número. A seção da 0.4.0
    no `CHANGELOG.md` (RN-VERSAO-007) traz, como a da 0.3.0, o "Antes de atualizar": na primeira
    entrada o Prism converte o cofre para um formato novo, a versão anterior não o abre mais, e quem
    quiser poder voltar copia antes a pasta de dados do Prism.

### Rotas e respostas

| Rota | Sucesso | Recusas |
| --- | --- | --- |
| `POST .../queries` `{ sql, pageSize?, filter?, keep? }` | como antes | as de antes; 422 `QUERY_INVALID` também com `keep` de mais de 20 resultados ou com uma entrada que não é um identificador |
| `POST .../queries/edit-target`, `.../queries/edits` e `.../queries/edits/preview` `{ resultID, ... }` | como antes; `resultID` é o do resultado atual ou o de um guardado | as de antes; 409 `RESULT_CHANGED` com o detalhe novo, e também, no Db2 e no Informix, na tabela sem esquema de um guardado depois de um `SET`, `CALL` ou `EXECUTE` (no Informix, também `DATABASE`) |
| `GET api/user/script-folders` | 200 lista de `{ id, parentID, name, createdAt, updatedAt }`, as pastas de todos os níveis | |
| `POST api/user/script-folders` `{ name, parentID? }` | 201 a pasta | 404 `SCRIPT_FOLDER_NOT_FOUND` (a pasta pai); 409 `SCRIPT_FOLDER_ALREADY_EXISTS`; 422 `SCRIPT_FOLDER_NAME_INVALID` |
| `PATCH api/user/script-folders` `{ id, name, parentID? }` | 200 a pasta | 404 `SCRIPT_FOLDER_NOT_FOUND` (a pasta ou a pasta pai); 409 `SCRIPT_FOLDER_ALREADY_EXISTS`, `SCRIPT_FOLDER_CYCLE`; 422 `SCRIPT_FOLDER_NAME_INVALID` |
| `DELETE api/user/script-folders/{id}` | 204 | 404 `SCRIPT_FOLDER_NOT_FOUND`; 409 `SCRIPT_FOLDER_NOT_EMPTY` (com `folders` e `scripts`) |
| `GET api/user/scripts` e `GET api/user/scripts/{id}` | como antes; cada script ganha `folderID` | as de antes |
| `POST api/user/scripts` `{ ..., folderID? }` | 201 | as de antes; 404 `SCRIPT_FOLDER_NOT_FOUND` |
| `PATCH api/user/scripts` `{ ..., folderID?, root? }` | 200 | as de antes; 404 `SCRIPT_FOLDER_NOT_FOUND`; 422 `SCRIPT_PLACE_INVALID` também com `root: true` e um `folderID` não nulo |

Notas:

- `keep`: lista de `resultID` (RN-SQL-024). Ausente, nula ou vazia, a API esquece os resultados
  guardados quando o comando vai ao banco. Uma entrada que não é um identificador é 422
  `QUERY_INVALID` no campo `keep`.
- `parentID` ausente ou nulo é a raiz. O `PATCH` das pastas de scripts grava a pasta por inteiro, o nome
  e a pasta pai, como o das pastas de conexões: sem `parentID`, ela vai para a raiz, e quem só renomeia
  manda a pasta pai que ela já tem. Consequência aceita, a mesma das pastas de conexões: a janela com a
  lista velha que só renomeia manda a pasta pai que leu, e desfaz o "Mover" que outra janela fez no
  meio; a lista lida de novo depois da gravação mostra onde a pasta ficou.
- `folderID` do script: nulo na raiz. No `POST`, ausente ou nulo é a raiz. O `PATCH` dos scripts
  continua parcial (o ausente fica como está, RN-SCRIPT-005): `folderID` move o script para a pasta, e
  `root: true` o leva para a raiz, porque o nulo não diz nada: `folderID: null` conta como ausente, e
  `root: false`, ou ausente, não faz nada. `root: true` com um `folderID` não nulo é 422
  `SCRIPT_PLACE_INVALID`.
- `SCRIPT_FOLDER_NAME_INVALID` vai no campo `name`. `SCRIPT_FOLDER_NOT_EMPTY` leva `folders` e
  `scripts`, quantas subpastas e quantos scripts a pasta tem, e o detalhe diz o mesmo em palavras.
- Todas exigem o cofre aberto (401 `VAULT_LOCKED` e 503 `VAULT_UNAVAILABLE`, como as demais). O log das
  rotas das pastas de scripts registra os IDs e as contagens, nunca o nome nem o SQL (RN-LOG-001).

### O que muda nas regras existentes

Cada mudança está escrita, inteira, na própria regra; aqui fica só a lista.

- **RN-EDIT-001**: "Linha nova" passa a se chamar "Adicionar linha" (as marcas da linha nova na grade
  continuam), e entram "Duplicar linha" (Ctrl+Alt+Insert), o Alt+Delete do "Excluir linha", a barra de
  edição e as abas do script.
- **RN-EDIT-002**: "Adicionar linha", "Duplicar linha" e "Excluir linha" no resultado de uma tabela só.
- **RN-EDIT-003**: a tabela sem esquema numa aba do script que não é a do último comando segue a guarda
  da RN-SQL-024.
- **RN-EDIT-004**: duplicar linha também é pendência; a barra de edição só cria e tira pendências, e
  "Salvar", "Descartar" e "Ver SQL" ficam na faixa.
- **RN-EDIT-005**: a linha duplicada leva as colunas copiadas e as preenchidas.
- **RN-EDIT-007**: trocar de aba de resultado do script com alterações não salvas pergunta antes, e a
  lista diz o levar a aba para outra janela, que já perguntava.
- **RN-EDIT-009**: o "Salvar" numa aba do script que não é a do último comando fecha o cursor do último.
- **RN-GRADE-004**: os itens de edição do menu da grade, com os nomes novos.
- **RN-GRADE-014**: a pausa vale também desde o começo do duplicar e dos botões da barra.
- **RN-SQL-020**: as abas dos outros comandos se editam, com o menu da célula e a barra; a nota delas
  muda; o F5, o filtro e a atualização automática do último as mantêm editáveis.
- **RN-TABELA-002**: os registros se editam pelas RN-EDIT-001 a 016.
- **RN-PROT-002**: na conexão somente leitura, os botões da barra de edição também ficam
  desabilitados.
- **RN-SCRIPT-001**: o campo "Pasta" no diálogo do nome.
- **RN-SCRIPT-002**: as pastas de scripts sobem o formato do cofre para o 4.
- **RN-SCRIPT-003**: a seção é uma árvore de pastas, e o menu do script ganha "Mover para…".
- **RN-NAV-002**: a barra de ações do navegador é da árvore das conexões e não age sobre a seção
  Scripts.
- **RN-NAV-011**: a densidade vale para a árvore da seção Scripts, com o recuo a cada nível.
- **Seção 6**: o `keep` das consultas, o `resultID` dos guardados nas rotas da edição, o detalhe novo de
  `RESULT_CHANGED`, e as rotas e os códigos das pastas de scripts.
- **Seção 9**: a barra de edição e as pastas de scripts não estão no canvas.
- **Seção 22**: o `resultID` das três rotas da edição, a nota do `edit-target` (`generated: "byDefault"`
  na coluna do PostgreSQL cujo padrão é `nextval(...)`, e os nomes novos em `rowOperations`), e o
  primeiro item do "fica para depois", com o duplicar.
- **Seção 23**: as rotas dos scripts ganham `folderID` e, no `PATCH`, `root`.
- **Seção 31**: a introdução diz que a seção 33 acrescenta o `keep` ao pedido de execução.

### Fica para depois

- Pôr a linha nova e a duplicada logo abaixo da linha atual (ou acima dela, o Shift+Alt+Insert e o
  Ctrl+Shift+Alt+Insert da 26.1 do DBeaver), em vez do fim da grade.
- Duplicar e excluir várias linhas de uma vez, e o Delete com as linhas escolhidas pelo número da linha:
  dependem da seleção de várias linhas (RN-GRADE-001), que vem com a exportação da seleção.
- Duplicar copiando no próprio banco o binário e o valor maior que o corte (um `INSERT ... SELECT` pela
  chave da linha de origem), em vez de pelo que a grade tem.
- "Editar célula" num editor à parte, para o valor grande (o Shift+Enter do DBeaver), e copiar o valor
  da linha de cima (o Ctrl+D dele).
- Guardar as pendências de várias abas do script ao mesmo tempo, e o valor completo das células cortadas
  nas abas guardadas.
- Saber o esquema atual em que cada resultado do Db2 e do Informix foi lido, se o driver um dia o disser
  sem consulta, no lugar da guarda dos comandos que podem trocá-lo (RN-SQL-024).
- Na seção Scripts: arrastar e soltar, busca e filtro, lembrar as pastas abertas, a cor e o ícone da
  pasta, e as pastas por conexão que o DBeaver pode criar sozinho.
