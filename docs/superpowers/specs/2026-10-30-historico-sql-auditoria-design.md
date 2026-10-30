# Histórico de comandos SQL e logs de auditoria — Design

**Data:** 2026-10-30
**Escopo:** um diário cifrado por usuário, onde o Prism anota tudo o que executa nos bancos e as ações de segurança da conta. Dele saem duas telas: o **Histórico** (o botão na barra do editor, como no DBeaver, para achar e reaproveitar um comando já executado) e a **Auditoria** (Configurações › Auditoria, com filtros por conexão, ambiente, data e hora, nível de perigo, tipo e resultado).
**Canvas:** `Histórico SQL e Auditoria` (<https://claude.ai/artifact/BVQx1R1KrnV1JB3Dw77jFE>): telas `Main` (Histórico na área de trabalho), `Auditoria` (Configurações › Auditoria) e `Cifra` (as chaves e o que fica no disco). Depois de aprovadas, entram em `docs/design/canvas/`. Onde esta especificação e o canvas divergirem, vale a especificação (seção 9 da especificação da fatia 1).

---

## 1. Intenção e motivação

Pedido do dono em 2026-10-30: "um botão que nem no DBeaver que fosse exibido o histórico de comandos SQL executados de forma rápida e de fácil acesso, criptografados também"; "os logs de auditoria devem ficar nas configurações do Prism e podem ser filtrados por conexões, ambientes, data e hora, nível de perigo"; "tudo muito bem criptografado para que quem tenha acesso ao PC do usuário não consiga ver sem precisar entrar com a conta no Prism".

Hoje o comando executado some quando a aba fecha, e não há como saber depois o que rodou em produção, quando, com que resultado e se passou pela confirmação. O log em texto (RN-LOG-001) não serve: ele não pode ter SQL, porque fica em claro no disco.

## 2. Objetivos, não-objetivos e anti-objetivos

**Objetivos**
- Um diário por usuário, cifrado com uma chave que só sai do cofre aberto (RN-DIARIO-001 a 004).
- Toda execução de comando do usuário e toda ação de segurança vira um registro, com o retrato da conexão naquele momento (nome, pasta, ambiente e cor, banco) e um nível de perigo (RN-AUDIT-001 a 004).
- O Histórico abre em um clique ou um atalho, na barra do editor, e reaproveita o comando sem executá-lo (RN-HIST-001 a 008).
- A Auditoria filtra por período, conexão, ambiente, nível, tipo, resultado e texto, e mostra o registro inteiro (RN-AUDIT-010 a 016).

**Não-objetivos desta entrega**
- Exportar a auditoria (CSV ou JSON). Fica para depois (seção 12).
- Auditoria de vários usuários ou central: cada usuário vê só o próprio diário, na própria máquina.
- Detectar que o arquivo do diário inteiro foi apagado ou trocado por um antigo (seção 12). A cifra garante sigilo e que uma página adulterada não abre; não garante que o arquivo continue lá.

**Anti-objetivos**
- Nada do diário vai para o log em texto, para a tela de login nem para fora do processo da API sem o cofre aberto.
- O Histórico nunca executa nada sozinho: o comando volta ao editor, e lá valem as proteções de sempre (RN-PROT-001 e 002).
- Os valores das variáveis e dos parâmetros (RN-VAR-036) não entram no diário.

## 3. Restrições

- Seção 1 da especificação da fatia 1, decisão já tomada pelo dono: "Quando uma entrega precisar (histórico de consultas, por exemplo), será SQLite cifrado, com credencial aleatória gerada na criação da conta e guardada dentro do cofre, que nem o usuário vê." Esta entrega segue essa decisão.
- Decisão 2 do `AGENTS.md`: sem banco do produto até aqui; o diário é o primeiro, e é SQLite cifrado.
- RN-ABERTO-002: compila só com fontes públicas. O SQLCipher entra pelo `SQLitePCLRaw.bundle_e_sqlcipher` (código aberto, binário nativo por plataforma) e pelo `Microsoft.Data.Sqlite`.
- A gravação do diário não pode atrasar a execução: o comando vai ao banco sem esperar o disco.

## 4. Relação com o que já existe

| O que existe | Como esta entrega usa |
| --- | --- |
| Cofre (RN-COFRE-001 a 013) | Guarda a chave do diário (`VaultDocument.Journal`, no fim, nulo por padrão, sem subir o formato, como `BuildModels`). |
| `IVaultService.Locked` (RN-COFRE-008) | Fecha o diário e zera a chave. |
| Troca de senha (RN-COFRE-013) | Troca também a chave do diário (RN-DIARIO-004). |
| Leitor de leitura da API (`ReadOnlySql`, RN-PROT-005) | Decide o nível Informativo (leitura). |
| Comando irreversível (RN-PROT-001, `connections/_lib/protections.ts`) | A mesma definição dá o nível Crítico; a API ganha a mesma leitura, e uma fixture de ouro mantém os dois lados iguais. |
| Ambiente próprio ou herdado (RN-PASTA-005, RN-CONN-010) | Entra no retrato do registro. |
| Contagem de erros de senha (RN-CONN-003) | O "Apagar registros…" conta junto. |
| Configurações por página (RN-CONFIG-001) | Nova seção `audit`, em `/settings/audit`. |
| `highlighted-sql.tsx` | Desenha o comando no Histórico e no detalhe da Auditoria. |

## 5. Abordagens consideradas

1. **SQLite cifrado (SQLCipher), escolhida.** É a decisão da seção 1 da fatia 1. Filtro, ordem e paginação por índice saem prontos; o arquivo inteiro (páginas, WAL e temporários) é cifrado e autenticado por página.
2. **Arquivo só de acréscimo, cada registro com AES-256-GCM do próprio .NET.** Sem binário nativo, mas cada filtro decifraria tudo; com 90 dias de uso pesado (centenas de milhares de registros) a Auditoria ficaria lenta, e um índice em memória seria código a mais para manter. Descartada.
3. **Guardar no próprio cofre.** O cofre é regravado inteiro a cada mudança (RN-COFRE-005); com um registro por execução isso não escala. Descartada.

## 6. Regras

### 6.1. O diário

- **RN-DIARIO-001.** Arquivo e cifra. Cada usuário tem `<PRISM_DATA_DIR>/journal/<usuario>.journal.db`, um banco SQLCipher 4 (AES-256 em cada página, HMAC-SHA512 por página). A chave entra crua (`PRAGMA key = "x'…'"`), sem a derivação do SQLCipher, porque já é aleatória. O WAL é cifrado como o banco; `temp_store = MEMORY` (nada temporário em claro no disco) e `secure_delete = ON` (o que se apaga é zerado). Sem a chave, o arquivo não se distingue de bytes aleatórios: nem os nomes das tabelas aparecem.
- **RN-DIARIO-002.** A chave. São 256 bits aleatórios, gerados na primeira vez que o cofre abre sem chave do diário (conta nova, ou conta de antes desta versão) e gravados no cofre, em `VaultDocument.Journal` (`VaultJournalRecord(byte[] Key, DateTimeOffset CreatedAt)`). Ninguém os vê: nem a tela, nem o usuário, nem o log. Sem a senha do Prism não há cofre aberto, e sem cofre aberto não há chave.
- **RN-DIARIO-003.** Abrir e fechar. O diário abre logo depois do cofre e fecha com ele, por qualquer caminho (RN-COFRE-008: Sair, troca de usuário, quinto erro de senha, bloqueio por inatividade, app fechando). Ao fechar: espera a fila de gravação esvaziar (até 2 s), fecha a conexão, limpa o pool (`SqliteConnection.ClearPool`) e zera a chave na memória (`CryptographicOperations.ZeroMemory`). Com o cofre fechado, toda rota do diário responde 401 `VAULT_LOCKED`.
- **RN-DIARIO-004.** Troca de senha. Como o cofre (RN-COFRE-013), o diário troca de chave a cada troca de senha, para que quem guardou uma cópia antiga do cofre e a senha antiga não leia o que for gravado depois. A ordem: gera a chave nova, `PRAGMA rekey` no diário, grava o cofre com ela. Se a gravação do cofre falhar, o diário volta à chave antiga (`rekey` de novo) e a troca de senha falha como hoje (`Unavailable`). Se o `rekey` falhar, a troca de senha não acontece.
- **RN-DIARIO-005.** Diário que não abre. Se a chave do cofre não abre o arquivo (adulterado, ou de outro cofre), a API o renomeia para `<usuario>.journal.damaged-<aaaammddhhmmss>.db`, cria outro vazio e grava nele o primeiro registro: "Diário ilegível substituído", nível Crítico. A entrada no cofre nunca é impedida pelo diário. Se o arquivo não pode ser criado (disco cheio, permissão), o cofre abre do mesmo jeito, as execuções seguem, e a tela mostra, uma vez por entrada, o aviso "O histórico e a auditoria estão desligados: o diário não pôde ser aberto." As rotas do diário respondem 503 `JOURNAL_UNAVAILABLE`.
- **RN-DIARIO-006.** Gravar sem atrasar. Os registros vão para uma fila em memória, com um único gravador, que agrupa até 200 por transação. Uma execução grava um registro ao sair para o banco (resultado "Em andamento") e o completa ao terminar. Na próxima abertura, os que ficaram "Em andamento" (o app caiu) viram "Interrompido". Falha de gravação vai ao log com a classe do erro e mostra, uma vez por entrada, o aviso da RN-DIARIO-005.
- **RN-DIARIO-007.** Tamanho. O texto do comando é guardado até 256 KiB (UTF-8); acima disso, os primeiros 256 KiB e a marca "… (cortado: 1,2 MB no total)". A mensagem de erro do banco vai inteira até 16 KiB (decisão 4 do `AGENTS.md`: ela é o produto).
- **RN-DIARIO-008.** Por quanto tempo. Configurações › Auditoria tem "Guardar os registros por": 30 dias, 90 dias (o padrão), 180 dias, 1 ano ou Sempre. A escolha fica **dentro do diário** (tabela `settings`), e não nas preferências da instalação, para ninguém sem a conta encurtar a guarda. A limpeza roda ao abrir o diário e a cada 24 h com ele aberto. Mudar a escolha grava um registro, nível Alto quando encurta, Informativo quando alonga.
- **RN-DIARIO-009.** O log em texto não muda (RN-LOG-001). Do diário ele registra só contagens (registros gravados, apagados pela guarda), a duração e a classe do erro. Nunca o comando, um nome, um caminho, um filtro da Auditoria nem o texto da busca.

### 6.2. O que vira registro

- **RN-AUDIT-001.** Cada registro tem: número (crescente), data e hora de início e de fim (UTC, mostradas na hora local), duração, tipo, ação, nível, motivo do nível, resultado, origem, o retrato da conexão (ID, nome, mecanismo, caminho das pastas, nome e cor do ambiente próprio ou herdado, banco), a sessão, o comando enviado, o texto do editor (RN-HIST-002), linhas lidas ou afetadas, a classe do erro com o SQLSTATE, a mensagem do banco, se passou pela confirmação (RN-PROT-001) e as proteções valendo naquele momento (confirmar e somente leitura). O retrato fica como estava: renomear, mover ou excluir a conexão depois não muda o registro.
- **RN-AUDIT-002.** Execuções (tipo **SQL**), pela API, no caminho que vai ao banco:
  - `ExecuteQuery`, com a origem que a tela manda: `editor` (Executar e Ctrl+Enter), `script` (Alt+X, um registro por comando, com o mesmo identificador de execução), `values` (Executar com valores…), `statement` (Executar este comando, RN-SQL-020), `rerun` (F5 e Executar de novo), `filter` (filtro e ordem da grade), `auto-refresh` (só a primeira execução e quando o comando muda, nunca a cada intervalo). Sem origem, `other`.
  - `ApplyEdits` (tipo **Edição**): um registro por "Salvar", com os comandos gerados e quantas linhas cada um afetou.
  - `EndTransaction` (tipo **Transação**): Commit e Rollback, e o Rollback automático de quando o cofre fecha (RN-TX-006).
  - Exportação de dados, importação de dados e cópia para outro banco (tipo **Dados**, seções 35 e 36): um registro por trabalho, com o comando de origem, o destino e as contagens. O nome do arquivo não entra (RN-EXPORT-016).
  - Comando recusado pelo somente leitura (RN-PROT-002): resultado "Recusado", sem ir ao banco.
- **RN-AUDIT-003.** Não viram registro o que o Prism monta sozinho para mostrar o que a pessoa abriu e não muda nada: árvore e catálogo, Registros e Estrutura de uma tabela, diagramas, autocompletar, "Carregar mais", "Contar total", a verificação periódica (RN-VERIF-002). É a mesma lista que não pergunta na RN-PROT-001, menos a exportação de dados, que entra (os dados saem do Prism).
- **RN-AUDIT-004.** Ações da conta e das conexões (tipos **Segurança** e **Conexões**):
  - entrada no cofre, saída, bloqueio por inatividade, conta criada, troca de senha;
  - entradas com senha errada: o cofre está fechado e não há chave, então a API conta à parte, em `<PRISM_DATA_DIR>/journal/<usuario>.attempts` (só a quantidade e as horas, sem mais nada), e na próxima entrada certa grava um registro "3 entradas com senha errada desde a última (30/10 14:02, 14:03, 14:05)" e zera o arquivo;
  - senha da conexão revelada (RN-CONN-002), com acerto ou erro; senha errada nas outras conferências da RN-CONN-003; o quinto erro, gravado antes de o cofre fechar;
  - conexão e pasta criadas, editadas, movidas e excluídas; proteções mudadas (RN-PROT-001 a 004);
  - exportar conexões, com ou sem as senhas (RN-TRANSF-005), importar conexões e importar do DBeaver (seção 40);
  - a guarda mudada (RN-DIARIO-008) e registros apagados (RN-AUDIT-016).

### 6.3. Nível de perigo

- **RN-AUDIT-005.** Quatro níveis, sempre com ícone e nome (nunca só a cor):

| Nível | Execuções | Outras ações |
| --- | --- | --- |
| **Informativo** | Leitura (RN-PROT-005) | Entrada, saída, bloqueio, conta criada, conexão criada ou editada, proteção ligada, guarda alongada |
| **Atenção** | `INSERT`; `UPDATE`, `DELETE` e `MERGE` com `WHERE`; `CALL`/`EXECUTE`; Salvar edições; Commit; Rollback; importação; exportação de dados | Conexão ou pasta excluída, importar conexões, senha errada numa conferência, comando recusado pelo somente leitura |
| **Alto** | DDL que não destrói: `CREATE`, `ALTER` sem `DROP`, `RENAME`, `GRANT`, `REVOKE`, `COMMENT`; Salvar da coluna inteira (RN-EDIT-019) | Senha da conexão revelada, somente leitura desligado, confirmação afrouxada, troca de senha, exportar conexões com as senhas, entradas com senha errada, guarda encurtada |
| **Crítico** | Irreversível (RN-PROT-001): `DROP` (também dentro de `ALTER`), `TRUNCATE`, `DELETE` e `UPDATE` sem `WHERE` no nível de fora (também depois de `WITH`); importação que esvazia a tabela antes | Quinto erro de senha, registros apagados, diário ilegível substituído |

- **RN-AUDIT-006.** Quem decide é a API, pelo texto que foi ao banco, com o leitor da RN-PROT-005 (`EditableSql.Lex`: texto, nomes entre aspas, comentários e `$tag$` não contam). O que o leitor não entende sobe para Atenção, no mínimo; o que pode ser irreversível e o leitor não tem certeza é Crítico, como a confirmação, que "na dúvida, pergunta". Um comando com vários `;` fica com o nível do mais perigoso.
- **RN-AUDIT-007.** O motivo do nível vai junto e aparece no detalhe, no mesmo texto da confirmação quando há: "DELETE sem WHERE: apaga todas as linhas de producao.apontamento.", "DROP COLUMN dentro de ALTER TABLE.", "Leitura."
- **RN-AUDIT-008.** Os níveis estão numa fixture de ouro escrita à mão, `src/test-fixtures/audit/levels.json` (comando, banco, nível, motivo), lida pelos testes da API e da tela. A tela confere a parte do Crítico contra o seu leitor de irreversível (`protections.ts`), para a confirmação e a auditoria nunca discordarem. Mudar uma regra é mudar a fixture; nunca se regera a partir do código.

### 6.4. Histórico (área de trabalho)

- **RN-HIST-001.** O botão. A barra do editor (`EditorToolbar`) ganha "Histórico" (ícone de relógio com a seta de voltar, e o texto), depois de "Executar script" e antes da conexão. O atalho é **Ctrl+Shift+H** (Cmd+Shift+H no macOS), que não está em uso no Prism; o Ctrl+H fica livre para o substituir do editor. O botão mostra o atalho na dica e em `aria-keyshortcuts`. O mesmo atalho fecha o painel.
- **RN-HIST-002.** O que aparece. Só as execuções que a pessoa pediu no editor: as origens `editor`, `script`, `values` e `statement` (RN-AUDIT-002). O texto mostrado é o do editor, com as variáveis `@nome` como estavam (seção 41), e não o comando já com os marcadores; a tela o manda à API em `historyText`, ao lado do `sql`. O mesmo comando executado em seguida na mesma conexão e no mesmo banco aparece uma vez, com "×3" e a hora da última.
- **RN-HIST-003.** O painel. Abre à direita do editor, na altura da área de trabalho, com 420 px, sem cobrir o resultado: o editor encolhe. No topo, a busca (foco começa nela) e o escopo, "Esta conexão" (o padrão: a conexão da aba) ou "Todas as conexões". A lista vem da mais recente para a mais antiga, agrupada por dia ("Hoje", "Ontem", "28 de out."), 100 por vez, e carrega mais ao rolar.
- **RN-HIST-004.** Cada item mostra a hora, o resultado (ícone e nome acessível: concluído, erro, cancelado, interrompido), a duração, as linhas, as três primeiras linhas do comando em código colorido (`highlighted-sql.tsx`) e, em "Todas as conexões", a conexão e o banco com a etiqueta do ambiente. Embaixo da lista, o item escolhido inteiro, com a mensagem do erro quando houve.
- **RN-HIST-005.** Reaproveitar. Enter ou duplo clique **insere** o comando no editor, no cursor, separado por uma linha em branco do que já está lá (seção 26: a linha em branco separa os comandos), e fecha o painel com o foco no editor. Shift+Enter abre o comando numa aba nova de consulta da conexão e do banco do registro (se a conexão ainda existe; se não, na aba sem conexão, RN-ARVORE-008). Ctrl+C copia o texto. Nada executa a partir do Histórico.
- **RN-HIST-006.** A busca filtra pelo texto do comando, sem diferenciar maiúsculas nem acentos, enquanto se digita (150 ms depois da última tecla). Setas sobem e descem na lista; Esc limpa a busca e, vazia, fecha o painel e devolve o foco ao editor.
- **RN-HIST-007.** Tirar do Histórico. Delete no item, ou "Remover do histórico" no menu dele, tira o item do Histórico; "Limpar o histórico desta conexão" (no menu do painel, com confirmação) tira todos os da conexão. Os dois só escondem: o registro continua na Auditoria, que é a única que apaga (RN-AUDIT-016).
- **RN-HIST-008.** Rápido. A primeira página aparece em até 100 ms com 200 mil registros no diário (índice por conexão e data), conferido por sonda (seção 10).

### 6.5. Auditoria (Configurações)

- **RN-AUDIT-010.** A página. Configurações ganha "Auditoria" (ícone de escudo com a marca de conferido), depois de Segurança, em `/settings/audit` (RN-CONFIG-001). O topo diz "Tudo o que foi executado e as ações da conta, cifrado no diário de marina.costa. Só quem entra com esta conta vê.", com a quantidade de registros, a data do mais antigo e a guarda.
- **RN-AUDIT-011.** Os filtros, numa barra que quebra linha em janela estreita:
  - **Período**: Última hora, Hoje, 7 dias (o padrão), 30 dias, Tudo, Personalizado (de e até, data e hora, `input type="datetime-local"`).
  - **Conexões**: escolha múltipla com busca, com as conexões que aparecem no diário, inclusive as já excluídas (marcadas "excluída").
  - **Ambientes**: escolha múltipla, com a cor de cada um; os nomes vêm do diário, e "Sem ambiente" é uma opção.
  - **Nível**: os quatro, cada um ligável; "Alto e Crítico" é um atalho.
  - **Tipo**: SQL, Edição, Transação, Dados, Segurança, Conexões.
  - **Resultado**: Concluído, Erro, Recusado, Cancelado, Interrompido.
  - **Busca**: no comando, na mensagem do banco, no nome da conexão e no motivo.
  - "Limpar filtros" volta ao padrão. Os filtros ficam enquanto a janela está aberta e voltam ao padrão na próxima entrada.
- **RN-AUDIT-012.** A tabela: Data e hora (`30/10/2026 14:05:12`), Nível, Evento (a ação e um resumo: "DELETE · 1.204 linhas", "Senha da conexão revelada"), Conexão, Ambiente (etiqueta com a cor), Banco, Resultado, Duração. Da mais recente para a mais antiga, 200 por vez, carregando ao rolar; o cabeçalho fica fixo e diz quantos registros o filtro achou.
- **RN-AUDIT-013.** O detalhe. Clicar numa linha (ou Enter nela) abre um painel à direita com tudo da RN-AUDIT-001: o comando inteiro em código colorido com "Copiar" e "Abrir no editor" (como o Shift+Enter da RN-HIST-005), o motivo do nível, as proteções daquele momento, se passou pela confirmação, a mensagem do banco e o identificador da execução do script, que filtra a tabela pelos comandos do mesmo script. Esc fecha.
- **RN-AUDIT-014.** Tudo o que vem do diário é desenhado como texto, nunca como HTML (RN-SHELL-002).
- **RN-AUDIT-015.** O cartão "Guarda" tem a escolha da RN-DIARIO-008 e o tamanho do arquivo.
- **RN-AUDIT-016.** Apagar. "Apagar registros…" pede uma data ("Apagar tudo antes de") e a senha do Prism, que entra na contagem da RN-CONN-003 (senha errada responde 422 `INVALID_PASSWORD`; o quinto erro fecha o cofre). Confirmado, apaga os registros antes da data e grava um registro Crítico "N registros apagados, anteriores a 01/09/2026", que só sai na próxima limpeza que o alcançar.

## 7. API

Controller novo, `UserJournalController`, em `api/user/journal`. Todas exigem o cofre aberto (RN-API-005).

| Método e rota | O que faz | Erros |
| --- | --- | --- |
| `GET history?connectionId&q&before&limit` | Histórico (RN-HIST-002 a 006). `connectionId` ausente = todas. `before` é o cursor (número do registro). `limit` 1 a 200, padrão 100. | 422 `JOURNAL_FILTER_INVALID` |
| `DELETE history/{id}` | Esconde do Histórico (RN-HIST-007). | 404 `JOURNAL_ENTRY_NOT_FOUND` |
| `DELETE history?connectionId` | Esconde todos os da conexão. | 422 `JOURNAL_FILTER_INVALID` |
| `GET audit?from&to&connectionId&environment&level&kind&outcome&q&before&limit` | Auditoria (RN-AUDIT-011 e 012). Os de escolha múltipla se repetem na consulta. `limit` 1 a 500, padrão 200. Devolve também `total` do filtro. | 422 `JOURNAL_FILTER_INVALID` |
| `GET audit/{id}` | O registro inteiro (RN-AUDIT-013). | 404 `JOURNAL_ENTRY_NOT_FOUND` |
| `GET audit/facets` | Conexões e ambientes que aparecem no diário, para os filtros; quantidade, data do mais antigo e tamanho. | — |
| `GET settings` · `PUT settings` | A guarda (RN-DIARIO-008). | 422 `JOURNAL_SETTINGS_INVALID` |
| `POST audit/purge` `{ before, password }` | Apaga (RN-AUDIT-016). | 422 `INVALID_PASSWORD`, 401 `VAULT_LOCKED` no quinto erro |

Qualquer rota com o diário desligado: 503 `JOURNAL_UNAVAILABLE` (RN-DIARIO-005).

`ExecuteQueryCommand` ganha `Origin` (texto da lista da RN-AUDIT-002; outro valor é `QUERY_INVALID` no campo), `HistoryText` (até 256 KiB, opcional) e `Confirmed` (verdadeiro quando a pergunta da RN-PROT-001 foi aceita). O `Origin` e o `HistoryText`, como o `Sql`, ficam fora do `ToString()` (RN-LOG-001).

Camadas:
- `Prism.Infrastructure/Journal/`: `Clients/JournalDatabaseClient` (abre o SQLCipher com a chave, cria o esquema, um único `try` em volta do driver), `Services/JournalService` (`Singleton`, como o registro de sessões: a fila, o gravador, a abertura no desbloqueio e o fechamento no `Locked`), `Models/`.
- `Prism.Infrastructure/Databases/Clients/CommandDanger.cs`: o nível (RN-AUDIT-005 a 007), ao lado de `ReadOnlySql`, reaproveitando `EditableSql.Lex`.
- `Prism.Application/Journal/Features/*`: uma pasta por rota, como `Scripts`.
- Os handlers da RN-AUDIT-002 e 004 chamam `IJournalRecorder.Begin(...)`/`Complete(...)`; quem grava é sempre a API, nunca a tela.

Esquema (versão 1, `PRAGMA user_version`): `entries` (as colunas da RN-AUDIT-001, mais `hidden_in_history`), índices por `(started_at DESC)`, `(connection_id, started_at DESC)`, `(environment_name)`, `(level)`; `settings`.

## 8. Cliente

- `src/client/src/app/workbench/_components/history-panel.tsx` e `_lib/history.*` (serviço, copy, agrupamento por dia, junção dos repetidos). O botão em `editor-toolbar.tsx`; o atalho onde já moram os outros da área de trabalho.
- `src/client/src/app/settings/_components/audit-section.tsx` e `_lib/audit.*` (serviço, filtros, copy). Entrada `audit` em `sections.ts` e ícone em `settings-nav.tsx`.
- As execuções mandam `origin` e `historyText` por onde já sai o `ExecuteQuery`.
- Cores só pelos tokens de `globals.css`; os quatro níveis ganham tokens (`--level-info`, `--level-warn`, `--level-high`, `--level-critical`) nos seis temas, conferidos pelo teste de contraste (RN-CONFIG-003).

## 9. Fixtures de ouro

`src/test-fixtures/audit/levels.json`: cerca de 60 casos nos três bancos (leitura, escrita com e sem `WHERE`, `WITH ... DELETE`, `ALTER TABLE ... DROP COLUMN`, `DROP` dentro de texto e de comentário, `$tag$`, vários comandos com `;`, o que o leitor não entende), cada um com o nível e o motivo. Escrita à mão; uma linha nova no `AGENTS.md`, na tabela "Onde está o quê".

## 10. Riscos e sondas

1. **Binário nativo do SQLCipher.** É o primeiro binário nativo que vai junto da API (o Argon2 é gerenciado, e o driver da IBM é baixado à parte, seção 16). Sonda antes de tudo: publicar a API para `win-x64`, `linux-x64` e `osx-arm64` com `bundle_e_sqlcipher`, empacotar no Electron e abrir, gravar e reabrir um diário em cada uma. Se falhar numa plataforma, a decisão volta ao dono com a abordagem 2 da seção 5.
2. **`rekey` em diário grande.** Ele regrava o arquivo inteiro. Sonda: 200 mil registros, medir a troca de senha; acima de 10 s, a tela mostra o progresso.
3. **Velocidade do Histórico** (RN-HIST-008) e da Auditoria com todos os filtros, com 200 mil registros.
4. **Nada em claro no disco.** Sonda: depois de uma sessão com comandos de texto conhecido, procurar esse texto (e o nome da conexão) em todo `<PRISM_DATA_DIR>`, no WAL e nos temporários do sistema. Nada pode aparecer.

## 11. Critérios de aceite

- Executar um `SELECT` e um `DELETE` sem `WHERE` (confirmado) em produção; Ctrl+Shift+H mostra os dois no topo, e Enter insere o `DELETE` no editor sem executar.
- Na Auditoria, filtrar por ambiente "Produção" e nível Crítico mostra só o `DELETE`, com "DELETE sem WHERE" no motivo e "passou pela confirmação".
- Copiar `<PRISM_DATA_DIR>` para outra máquina: sem a senha, nenhum comando, nome de conexão ou data aparece no arquivo; com o Prism e a senha certa, o histórico volta inteiro.
- Trocar a senha; uma cópia do cofre e do diário feita antes, aberta com a senha antiga, não mostra o que foi executado depois.
- Errar a senha de entrada três vezes e entrar: a Auditoria mostra o registro das três tentativas.
- Fechar o app no meio de um comando longo: na volta, o registro aparece como "Interrompido".
- `levels.json` passa nos testes da API e da tela.

## 12. Fica para depois

- Exportar a auditoria filtrada (CSV e JSON, pelo assistente da seção 35 ou um próprio).
- Saber que o diário inteiro sumiu ou foi trocado por um antigo: o cofre guardaria o último número e um elo de verificação, conferidos na entrada.
- Favoritar comandos do Histórico e dar nome a eles (os scripts salvos, seção 23, já cobrem o comando que se quer guardar).
- Pedir a senha de novo para abrir a Auditoria; hoje vale o bloqueio por inatividade (RN-SEG-001).

## 13. O que muda nas regras existentes

- **RN-COFRE-008**: fechar o cofre também fecha o diário e zera a chave dele (RN-DIARIO-003).
- **RN-COFRE-013**: a troca de senha troca também a chave do diário (RN-DIARIO-004).
- **RN-CONN-003**: a contagem de erros seguidos ganha o "Apagar registros…" (RN-AUDIT-016).
- **RN-CONFIG-001**: entra a seção Auditoria, depois de Segurança.
- **RN-LOG-001**: não muda; ganha a frase da RN-DIARIO-009.
- **RN-SQL-001**: o pedido de execução leva `origin`, `historyText` e `confirmed`.
- `VaultDocument`: ganha `Journal` no fim, nulo por padrão, sem subir o formato.
- Decisão 2 do `AGENTS.md`: "Sem banco do produto nesta fatia" passa a "O único banco do produto é o diário (SQLite cifrado com SQLCipher), seção 1 da especificação da fatia 1."

## 14. Decisões

1. Um diário, duas telas: o Histórico é um recorte da Auditoria, e não um segundo arquivo. Uma só guarda, um só gravador.
2. Quem grava é a API, no caminho que vai ao banco; a tela só informa a origem e o texto do editor.
3. A guarda mora dentro do diário, e não nas preferências da instalação.
4. Esconder do Histórico não apaga; só a Auditoria apaga, com a senha, e deixa um registro.
5. Atalho Ctrl+Shift+H.
