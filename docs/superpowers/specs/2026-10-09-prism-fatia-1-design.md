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
| 3 | Proteções e sessão: somente leitura (com senha para mudar), confirmação antes de comando irreversível, verificação periódica da conexão, encerramento por ociosidade, ambiente e proteções herdados da pasta |
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
  (opcional, até 30) e cor do ambiente (opcional, `#RRGGBB`).
- **RN-CONN-011.** Nome único dentro da mesma pasta: 409 `CONNECTION_ALREADY_EXISTS`.
- **RN-CONN-012.** Portas sugeridas no formulário: PostgreSQL 5432, Db2 50000, Informix 9089.
- **RN-CONN-013.** "Testar conexão" abre, executa a consulta de verificação do banco e fecha,
  sem gravar nada. Ao testar uma conexão já gravada sem redigitar a senha, o pedido leva o `id`
  e a API usa a senha do cofre, com a mesma condição da RN-CONN-004: se o host ou a porta do
  pedido diferem dos gravados, 422 `CONNECTION_INVALID`. Consultas: PostgreSQL `SELECT 1`; Db2 `SELECT 1 FROM SYSIBM.SYSDUMMY1`;
  Informix `SELECT 1 FROM systables WHERE tabid = 1`.
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

- **RN-ARVORE-001.** Níveis: pasta › conexão › banco conectado › esquemas › Tabelas, Visões e
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

### 5.5 Editor e resultado

- **RN-SQL-001.** Executar (botão ou Ctrl+Enter) envia o texto selecionado; sem seleção, envia o
  comando onde está o cursor. Uma execução leva um comando só: se a seleção tiver mais de um
  (pela RN-SQL-002), a tela avisa e não envia. Executar vários em sequência entra na entrega 2.
  Um bloco com `;` no corpo (procedimento, função, gatilho, bloco composto) conta como um
  comando só. No Db2 e no Informix a API repete a conferência e responde 422
  `MULTIPLE_STATEMENTS_NOT_SUPPORTED`, porque o driver da IBM executaria os comandos um a um
  sem parar no erro.
- **RN-SQL-002.** Comandos são separados por `;` fora de texto entre aspas simples, de
  identificador entre aspas duplas, de comentário (`--` e `/* */`) e de `$tag$ ... $tag$` do
  PostgreSQL. Bloco que tem `;` no corpo (procedimento em Db2 ou Informix) é executado
  selecionando o bloco inteiro.
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
  Commit manual vale a RN-TX-012 (a contagem roda na sessão e a ocupa).
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
- **RN-MARCA-002.** Ao abrir, o app mostra de imediato uma janela de splash de 640×400, sem
  moldura e centralizada, com a ilustração do prisma, o nome, a versão, o passo atual e uma
  barra de progresso.
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
| `GET api/user/folders` | 200 lista | |
| `POST api/user/folders` | 201 | 404 `FOLDER_NOT_FOUND` (pai); 409 `FOLDER_ALREADY_EXISTS`; 422 `FOLDER_NAME_INVALID` |
| `PATCH api/user/folders` | 200 | 404 `FOLDER_NOT_FOUND`; 409 `FOLDER_ALREADY_EXISTS`, `FOLDER_CYCLE`; 422 `FOLDER_NAME_INVALID` |
| `DELETE api/user/folders/{id}` | 204 | 404 `FOLDER_NOT_FOUND`; 409 `FOLDER_NOT_EMPTY` |
| `GET api/user/connections` | 200 lista | |
| `GET api/user/connections/{id}` | 200 | 404 `CONNECTION_NOT_FOUND` |
| `POST api/user/connections` | 201 | 404 `FOLDER_NOT_FOUND`; 409 `CONNECTION_ALREADY_EXISTS`; 422 `CONNECTION_INVALID` |
| `PATCH api/user/connections` | 200 | as mesmas, mais 404 `CONNECTION_NOT_FOUND` |
| `DELETE api/user/connections/{id}` | 204 | 404 `CONNECTION_NOT_FOUND` |
| `POST api/user/connections/test` | 204 | 404 `CONNECTION_NOT_FOUND` (com `id` e sem senha, quando a conexão não existe); 422 `CONNECTION_INVALID`, `DATABASE_CONNECTION_FAILED`, `DRIVER_NOT_INSTALLED` |
| `POST api/user/connections/{id}/password/reveal` | 200 `{ password }` | 404 `CONNECTION_NOT_FOUND`; 422 `INVALID_PASSWORD`; 401 `VAULT_LOCKED` no quinto erro |
| `PUT api/user/password` `{ currentPassword, newPassword }` | 204 (troca a senha e recifra o cofre, RN-COFRE-013) | 422 `INVALID_PASSWORD` (a atual não confere), `PASSWORD_INVALID` (a nova), `PASSWORD_UNCHANGED`; 401 `VAULT_LOCKED` no quinto erro |
| `POST api/user/database-sessions` `{ connectionID, transactionMode?, isolationLevel? }` | 201 `{ id, connectionID, engine, database, serverVersion, transaction, transactionsAvailable }` | 404 `CONNECTION_NOT_FOUND`; 422 `DATABASE_CONNECTION_FAILED`, `DRIVER_NOT_INSTALLED`, `TRANSACTION_MODE_INVALID`, `ISOLATION_LEVEL_INVALID`, `TRANSACTIONS_NOT_AVAILABLE` (RN-TX-013) |
| `PATCH api/user/database-sessions` `{ id, transactionMode?, isolationLevel? }` | 200 a sessão, com `transaction` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `TRANSACTION_OPEN`; 422 `TRANSACTION_MODE_INVALID`, `ISOLATION_LEVEL_INVALID`, `TRANSACTIONS_NOT_AVAILABLE` |
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
| `POST api/user/database-sessions/{id}/queries` `{ sql, pageSize? }` | 200 página ou linhas afetadas | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `TRANSACTION_FAILED`; 422 `QUERY_INVALID` (SQL vazio), `SQL_EXECUTION_FAILED`, `TRANSACTION_CONTROL_NOT_SUPPORTED`, `COMMAND_NOT_ALLOWED_IN_TRANSACTION`, `MULTIPLE_STATEMENTS_NOT_SUPPORTED` |
| `POST .../queries/next` | 200 página | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_OPEN_CURSOR`, `TRANSACTION_FAILED`; 422 `SQL_EXECUTION_FAILED` |
| `POST .../queries/count` | 200 `{ total }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_QUERY_TO_COUNT`, `TRANSACTION_FAILED`; 422 `SQL_EXECUTION_FAILED` |
| `POST .../queries/cancel` | 204 | 404 `DATABASE_SESSION_NOT_FOUND` |
| `POST api/user/database-sessions/{id}/transaction/commit` | 200 `{ transaction, commands }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_OPEN_TRANSACTION`, `TRANSACTION_FAILED`; 422 `SQL_EXECUTION_FAILED` (com `transactionUndone` quando o banco desfez) |
| `POST api/user/database-sessions/{id}/transaction/rollback` | 200 `{ transaction, commands }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `NO_OPEN_TRANSACTION`; 422 `SQL_EXECUTION_FAILED` (com `transactionUndone`: a conexão caiu, e a transação já estava perdida) |
| `POST .../queries/edit-target` `{ resultID, catalogSessionID? }` | 200 `{ tables, columns, rowOperations, oneAtATime }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `RESULT_CHANGED`; 422 `RESULT_NOT_EDITABLE` (com `reason`), `SQL_EXECUTION_FAILED` |
| `POST .../queries/edits` `{ resultID, changes }` | 200 `{ applied, transaction }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `RESULT_CHANGED`, `TRANSACTION_FAILED`; 422 `RESULT_NOT_EDITABLE`, `EDIT_INVALID` (com `change` e `column`), `EDIT_ROW_MISMATCH` (com `change` e `rowsAffected`), `SQL_EXECUTION_FAILED` (com `change`) |
| `POST .../queries/edits/preview` `{ resultID, changes }` | 200 `{ statements: [{ sql, values }], oneAtATime }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `RESULT_CHANGED`; 422 `RESULT_NOT_EDITABLE`, `EDIT_INVALID` |

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
já gravadas antes da que falhou (RN-EDIT-012).

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

- O formulário de conexão desta fatia não tem os painéis "Sessão da conexão" e "Proteções";
  eles entram na entrega 3, junto com o que fazem.
- O campo "Servidor Informix" sai, porque o driver escolhido não usa `INFORMIXSERVER`. Volta se
  a sonda da seção 10 mostrar que é necessário.
- A porta sugerida do Informix é 9089, não 9088.
- A barra do editor não tem Explicar plano nem Formatar, que entram na entrega 2.
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

Aba de registros e de estrutura da tabela, salto por chave estrangeira, diagrama ER, somente
leitura, confirmação de comando irreversível, verificação periódica e encerramento por ociosidade, ambiente por pasta, configurações e temas,
troca de senha, explicar plano, formatar SQL, exportar CSV, executar vários comandos em
sequência (script), salvar e abrir arquivos `.sql`
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
  012.
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
  para se o usuário cancelar). "Linhas por busca" depende da API (RN-SQL-016).
- **RN-SEG-001.** Bloqueio por inatividade, ligado por padrão em 10 minutos (de 1 a 240, e pode
  ser desligado). Sem tecla nem ponteiro na janela por esse tempo, e sem comando em andamento em
  nenhuma aba (o tempo conta a partir do fim do último), o Prism avisa 60 segundos antes (30, quando o
  tempo configurado é de 1 minuto) e então bloqueia: a API fecha o cofre (RN-COFRE-008, as sessões com os bancos se encerram) e a tela
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
  leitor de tela e dica com o atalho, quando há.
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
  puro. Nulo vai vazio. Se alguma célula copiada estava cortada (RN-SQL-011), a tela avisa.
- **RN-GRADE-003.** Copiar avançado (Ctrl+Shift+C, como no DBeaver): um diálogo escolhe o que
  copiar (a seleção, as linhas inteiras da seleção ou todas as carregadas) e como: texto
  delimitado (delimitador, cabeçalho, número da linha, aspas, como escrever o nulo), JSON,
  Markdown, HTML ou comandos `INSERT`. As escolhas são lembradas por usuário.
- **RN-GRADE-004.** Menu de contexto da grade (botão direito, Shift+F10, tecla de menu), nas
  mesmas regras do menu do navegador (RN-MENU-001): Copiar, Copiar com cabeçalho, Copiar
  avançado, Copiar nome da coluna, Filtrar, Ordenar, Gerar SQL, Exportar e, numa chave
  estrangeira, Ir para o registro referenciado. O clique direito numa célula fora da seleção a
  escolhe antes. O menu ganha também os itens da edição de célula (RN-EDIT-001): Editar célula,
  Definir como nulo, Linha nova, Excluir linha e Desfazer alteração.
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
- **RN-ZOOM-001.** Zoom do programa inteiro, como no VS Code e no Postman: `Ctrl +`, `Ctrl −` e
  `Ctrl 0` (Cmd no macOS), e um controle em Configurações › Aparência, de 50% a 200%; 100% é o
  tamanho de hoje. Vale para todas as telas da janela principal, desde a abertura, é lembrado
  nesta instalação, e a barra da janela e os botões do sistema continuam alinhados em qualquer
  valor. É independente do zoom da grade (RN-GRADE-010).

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

- **RN-EDIT-001.** **Onde e como.** Na grade dos Registros de uma tabela e na grade do resultado de um comando da aba de
  consulta, quando o resultado é editável (RN-EDIT-002). A edição parte da célula ativa da grade (RN-GRADE-001): F2, Enter,
  duplo clique, ou começar a digitar (o que substitui o valor). O campo de edição fica na própria célula, com "Confirmar edição
  (Enter)" e "Cancelar edição (Esc)", como no canvas; Tab e Shift+Tab confirmam e passam para a próxima célula editável. O
  menu de contexto (RN-GRADE-004) ganha "Editar célula" (F2), "Definir como nulo", "Linha nova" (Alt+Insert), "Excluir linha"
  (também Delete, com linhas inteiras escolhidas pelo número da linha) e "Desfazer alteração". O que não se aplica aparece
  desabilitado, com o motivo.
- **RN-EDIT-002.** **Quando um resultado é editável.** A edição vale **coluna por coluna, na tabela de onde a coluna veio**,
  também num resultado de junção.

  O **resultado inteiro** é só leitura quando o comando não é um `SELECT` só, ou tem `UNION`, `INTERSECT`, `EXCEPT` ou `MINUS`,
  `DISTINCT`, `GROUP BY`, `HAVING`, `FOR UPDATE`, `WITH`, ou subconsulta no `FROM`; quando ele gravou e devolveu linhas
  (RN-SQL-013); ou quando o Prism não consegue saber de onde vêm as colunas (RN-EDIT-003). `WHERE` (com subconsultas dentro),
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

  Num resultado de **uma tabela só**, valem também "Linha nova" e "Excluir linha", e as colunas da chave são editáveis. Num
  resultado de **junção**, só se alteram células: uma linha de uma tabela que aparece repetida no resultado (a mesma chave em
  várias linhas da grade) muda em todas elas de uma vez, e conta como uma alteração.

  Os motivos ficam à vista: os do resultado inteiro na barra do resultado ("Somente leitura: união de consultas", "DISTINCT",
  "agrupamento", "SELECT ... FOR UPDATE", "subconsulta ou WITH no FROM", "o comando gravou e devolveu linhas", "o Prism não
  conseguiu saber de onde vêm as colunas"), sabidos sem consultar o banco; os de tabela e de coluna na faixa da grade quando a
  pessoa tenta editar e na dica do cabeçalho da coluna ("<tabela> é uma visão", "<tabela> aparece mais de uma vez no
  comando", "a chave de <tabela> não está inteira no resultado: faltam <colunas>", "<tabela> não tem chave primária nem chave
  única de colunas não nulas", "coluna calculada", "gerada pelo banco", "coluna da chave numa junção", "o Prism ainda não
  edita este tipo neste banco").
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
    executado e a tela diz por quê.

  Um sinônimo ou apelido de tabela do Db2 e do Informix no `FROM` não é reconhecido como tabela, e as colunas dele ficam só
  leitura ("não é uma tabela").
- **RN-EDIT-004.** **Pendências** (dois passos: "Salvar" e, no Commit manual, Commit). Editar, definir nulo, criar linha e
  excluir linha não vão ao banco: ficam pendentes na tela e destacados — a célula alterada mostra o valor lido riscado ao lado
  do novo (como no canvas), a linha nova é marcada no número da linha, e a linha excluída aparece riscada. Uma faixa sobre a
  grade diz quantas alterações há ("3 alterações não salvas") e tem "Ver SQL", "Descartar" e "Salvar" (Ctrl+S com o foco na
  grade). "Descartar" joga fora só o que não foi salvo, sem mexer na transação. "Desfazer alteração" tira uma pendência. As
  pendências atravessam a rolagem e o "carregar mais".
- **RN-EDIT-005.** **Salvar** executa todas as pendências **numa transação só**, na sessão da aba: primeiro as exclusões,
  depois as alterações, depois as linhas novas, cada grupo na ordem em que foi feito. Cada alteração e cada exclusão é um
  comando pela chave da tabela dela (RN-EDIT-002), com os valores que a grade leu, e tem de afetar **exatamente uma linha**; se
  afetar zero ou mais de uma, ou se o banco recusar, tudo o que este "Salvar" fez é desfeito, e a tela diz qual linha falhou (e
  a destaca), quantas linhas o comando afetou ("a linha não existe mais, ou a chave dela mudou" para zero) e a mensagem do
  banco, como veio. A linha nova leva só as colunas que a pessoa preencheu; as outras ficam com o padrão da tabela. Os valores
  vão ao banco como parâmetros, nunca dentro do texto, e os nomes entre aspas duplas (RN-TABELA-002). Antes do primeiro
  comando o Prism confere no catálogo, dentro da mesma transação, que cada chave é a da tabela e que as colunas alteradas são
  editáveis; se uma tabela mudou, nada é executado e a tela diz por quê.
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
  (RN-TABELA-007, que filtra a aba de destino), trocar o modo ou o nível, Commit, Rollback, fechar a aba, desconectar, excluir a
  conexão, "Sair" e fechar o app perguntam antes: "Há N alterações não salvas" com "Salvar", "Descartar" e "Cancelar" (nas
  saídas que atingem várias abas, só "Descartar" e "Cancelar"). Rolar, "carregar mais", copiar e exportar não perguntam;
  copiar leva o que está na tela, e exportar avisa que há alterações não salvas. O bloqueio por inatividade as descarta
  (RN-TX-007).
- **RN-EDIT-008.** **Ver SQL** mostra, na ordem em que serão executados, os comandos que o "Salvar" vai executar, com os
  valores escritos como literais do banco para leitura; o valor que não tem literal (caractere de controle) aparece como `?`,
  com o valor ao lado. Diz que na execução os valores vão como parâmetros e, no Informix sem log, que cada comando é gravado
  sozinho (RN-EDIT-012). Dá para copiar. Não executa nada.
- **RN-EDIT-009.** **Depois de salvar**, a grade continua com as linhas que tinha, com os valores salvos (numa junção, em todas
  as linhas que mostram a mesma linha da tabela); as excluídas saem; a linha nova mostra o que foi digitado e, nas colunas que
  o banco preenche, "gerado pelo banco — execute de novo para ver". O cursor aberto fecha (salvar é um comando na sessão), e
  "carregar mais" dá lugar ao "executar de novo" da RN-SQL-007. O aviso diz "N alterações salvas" (Auto-commit) ou "N
  alterações salvas, sem commit" (Commit manual).
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
| `POST .../queries/edit-target` `{ resultID, catalogSessionID? }` | 200 `{ tables, columns, rowOperations, oneAtATime }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `RESULT_CHANGED`; 422 `RESULT_NOT_EDITABLE` (com `reason`), `SQL_EXECUTION_FAILED` |
| `POST .../queries/edits` `{ resultID, changes }` | 200 `{ applied, transaction }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `SESSION_BUSY`, `RESULT_CHANGED`, `TRANSACTION_FAILED`; 422 `RESULT_NOT_EDITABLE`, `EDIT_INVALID` (com `change` e `column`), `EDIT_ROW_MISMATCH` (com `change` e `rowsAffected`), `SQL_EXECUTION_FAILED` (com `change`) |
| `POST .../queries/edits/preview` `{ resultID, changes }` | 200 `{ statements: [{ sql, values }], oneAtATime }` | 404 `DATABASE_SESSION_NOT_FOUND`; 409 `RESULT_CHANGED`; 422 `RESULT_NOT_EDITABLE`, `EDIT_INVALID` |

Notas:

- `edit-target` devolve `tables` (cada tabela do `FROM`: `{ schema, name, key: [coluna do resultado], editable, reason }`),
  `columns` (cada coluna do resultado: `{ table, baseColumn, editable, reason, nullable, generated }`, com `table` nulo na
  coluna calculada), `rowOperations` (verdadeiro só no resultado de uma tabela: "Linha nova" e "Excluir linha") e `oneAtATime`
  (Informix sem log, RN-EDIT-012).
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

- **Linha nova e excluir linha num resultado de junção** (qual tabela recebe a linha, e o que fazer com as outras), e
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
  duas fases e transação que atravessa um script de vários comandos (a execução de script ainda é da entrega 2).
- **Proteções** da entrega 3 (somente leitura com senha, confirmar comando irreversível), que vão restringir a edição.
