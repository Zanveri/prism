# Histórico de comandos SQL e auditoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um diário SQLCipher por usuário, com a chave dentro do cofre, que registra toda execução e as ações da conta, e as duas telas que o leem: o Histórico (Ctrl+Shift+H, na barra do editor) e Configurações › Auditoria.

**Architecture:** A API grava, sempre: os handlers que vão ao banco e os de conta e conexões chamam `IJournalRecorder`, que põe o registro numa fila (`Channel`) esvaziada por um único gravador em `JournalService` (`Singleton`, aberto no desbloqueio do cofre e fechado no `Locked`). O nível de perigo é decidido na API por `CommandDanger`, ao lado de `ReadOnlySql`, contra a fixture de ouro `src/test-fixtures/audit/levels.json`, que a tela também lê para manter `protections.ts` alinhado. A tela só manda `origin` e `historyText` com a execução e lê por `api/user/journal`.

**Tech Stack:** C# / ASP.NET Core, `Microsoft.Data.Sqlite` + `SQLitePCLRaw.bundle_e_sqlcipher`, xUnit e NUnit; TypeScript, React 19, TanStack Query 5, Zod 4, CodeMirror 6, Tailwind 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-historico-sql-auditoria-design.md` (regras `RN-DIARIO-*`, `RN-AUDIT-*`, `RN-HIST-*`). Canvas: <https://claude.ai/artifact/BVQx1R1KrnV1JB3Dw77jFE> (`Main`, `Auditoria`, `Cifra`).

## Global Constraints

- Dependências novas: só `Microsoft.Data.Sqlite` e `SQLitePCLRaw.bundle_e_sqlcipher` em `Prism.Infrastructure.csproj` (com `packages.lock.json` atualizado nas quatro plataformas). Nenhuma no `src/client/package.json`.
- Arquivo: `<PRISM_DATA_DIR>/journal/<usuario>.journal.db`; tentativas: `<PRISM_DATA_DIR>/journal/<usuario>.attempts`; ilegível vira `<usuario>.journal.damaged-<aaaammddhhmmss>.db`.
- Chave: 256 bits de `RandomNumberGenerator`, `PRAGMA key = "x'<hex>'"`; `temp_store = MEMORY`, `secure_delete = ON`, `journal_mode = WAL`; `PRAGMA user_version = 1`.
- `VaultDocument` ganha `VaultJournalRecord? Journal = null` no fim, sem subir o formato.
- Texto do comando até 256 KiB (UTF-8), depois a marca `… (cortado: <tamanho> no total)`; mensagem do banco até 16 KiB.
- Guarda: 30, 90 (padrão), 180, 365 dias ou `null` (Sempre), na tabela `settings` do diário.
- Níveis: `Info = 0`, `Warning = 1`, `High = 2`, `Critical = 3`; nomes na tela "Informativo", "Atenção", "Alto", "Crítico", sempre com ícone e texto.
- Origens: `editor`, `script`, `values`, `statement`, `rerun`, `filter`, `auto-refresh`, `other`. Histórico mostra só `editor`, `script`, `values`, `statement`.
- Rotas em `api/user/journal`; códigos novos `JOURNAL_UNAVAILABLE` (503), `JOURNAL_FILTER_INVALID` (422), `JOURNAL_ENTRY_NOT_FOUND` (404), `JOURNAL_SETTINGS_INVALID` (422).
- Atalho do Histórico: Ctrl+Shift+H (Cmd+Shift+H no macOS). Rota da Auditoria: `/settings/audit`, depois de `security`.
- RN-LOG-001: nada do diário no Serilog além de contagens, duração e classe do erro. `ToString()` dos comandos novos devolve só o nome do tipo.
- Valores de variáveis e parâmetros (RN-VAR-036) nunca entram no diário.
- Textos visíveis e comentários em português, em `*.copy.ts`; identificadores em inglês; cores só por tokens de `globals.css`.

## Review Focus

1. **Cofre fecha com gravação na fila** (Sair logo depois de um comando): o registro do comando precisa estar no disco na próxima entrada. Teste em Task 3: `Lock_FlushesQueuedEntriesBeforeClosing`.
2. **Troca de usuário no meio de uma execução**: o `Complete` de uma execução do cofre A chega depois que o cofre B abriu; não pode ir para o diário de B. Teste em Task 3: `Complete_AfterGenerationChange_IsDropped` (compara `IVaultService.Generation`).
3. **Busca com `%`, `_` e acento** no Histórico e na Auditoria: `%` digitado é literal, e "funcao" acha "função". Teste em Task 6: `History_SearchTreatsWildcardsLiterally_AndIgnoresAccents`.
4. **Conexão excluída** no filtro e no Shift+Enter: o registro mantém o retrato; a nova aba vai sem conexão. Testes em Task 6 (`AuditFacets_IncludeDeletedConnections_Marked`) e Task 7 (`openFromHistory_withMissingConnection_opensUnboundTab`).
5. **Fuso e horário de verão** no filtro Personalizado: `datetime-local` é hora local; a tela converte para UTC antes de mandar. Teste em Task 8: `toUtcRange_convertsLocalBoundsAcrossDst`.

---

### Task 0: Sonda do SQLCipher nas três plataformas

**Files:**
- Modify: `src/api/Prism.Infrastructure/Prism.Infrastructure.csproj`
- Modify: `src/api/Prism.Infrastructure/packages.lock.json` (e os demais `packages.lock.json` afetados)
- Test: `src/api/tests/Prism.IntegrationTesting/Journal/SqlCipherProbeTests.cs`

**Interfaces:**
- Produces: os pacotes referenciados; `SQLitePCL.Batteries_V2.Init()` chamado uma vez na inicialização da Infrastructure (`DependencyInjection.cs`).

- [ ] **Step 1: Write the failing test** `SqlCipherProbeTests.CreateWriteReopen_WithKey_ReadsBack_AndWithoutKey_Fails`: cria um arquivo temporário com `PRAGMA key = "x'<64 hex>'"`, grava `CREATE TABLE t(v TEXT); INSERT INTO t VALUES('segredo-prism')`, fecha, reabre com a mesma chave e lê `segredo-prism`; reabre sem chave e espera `SqliteException` (código 26, `SQLITE_NOTADB`); lê os bytes do arquivo e do `-wal` e assevera que `"segredo-prism"` e `"SQLite format 3"` não aparecem.
- [ ] **Step 2: Run** `dotnet test src/api/tests/Prism.IntegrationTesting --filter SqlCipherProbeTests` — Expected: FAIL (pacote ausente).
- [ ] **Step 3: Add** `Microsoft.Data.Sqlite.Core` e `SQLitePCLRaw.bundle_e_sqlcipher` (versões estáveis atuais), com comentário no `.csproj` dizendo que é o único binário nativo que vai junto da API (seção 10 da spec). Restaurar com `dotnet restore --locked-mode false` para cada RID da pipeline (`win-x64`, `linux-x64`, `osx-arm64`).
- [ ] **Step 4: Run** o teste — Expected: PASS.
- [ ] **Step 5: Manual probe** `dotnet publish src/api/Prism.Api -r <rid>` nas três, empacotar o Electron e conferir que `e_sqlcipher` está na saída e o app abre. Registrar o resultado no PR. Falhou numa plataforma: parar e levar ao dono (abordagem 2 da spec).
- [ ] **Step 6: Commit** `build(api): adiciona SQLCipher para o diário`

### Task 1: Chave do diário no cofre

**Files:**
- Create: `src/api/Prism.Infrastructure/Vault/Models/VaultJournalRecord.cs`
- Modify: `src/api/Prism.Infrastructure/Vault/Models/VaultDocument.cs`, `src/api/Prism.Infrastructure/Vault/Services/VaultService.cs`, `IVaultService.cs`
- Test: `src/api/tests/Prism.UnitTesting/Vault/VaultJournalKeyTests.cs`

**Interfaces:**
- Produces: `public sealed record VaultJournalRecord(byte[] Key, DateTimeOffset CreatedAt)`; `VaultDocument(..., VaultJournalRecord? Journal = null)`; `IVaultService.Unlocked` (`event Action?`, disparado depois de abrir ou criar); `IVaultService.ChangePasswordAsync` passa a aceitar um passo antes da gravação: `Func<byte[] newJournalKey, CancellationToken, Task<bool>>? beforeSave` e `Func<CancellationToken, Task>? onSaveFailed`.

- [ ] **Step 1: Tests:** `Unlock_VaultWithoutJournal_CreatesKeyOnce` (abre duas vezes: mesma chave, 32 bytes); `OldFormatVault_DeserializesWithNullJournal`; `ChangePassword_RotatesJournalKey_AndCallsBeforeSaveWithNewKey`; `ChangePassword_WhenBeforeSaveFails_KeepsOldKeyAndFails`; `ChangePassword_WhenSaveFails_CallsOnSaveFailed`.
- [ ] **Step 2: Run** `dotnet test src/api/tests/Prism.UnitTesting --filter VaultJournalKeyTests` — Expected: FAIL.
- [ ] **Step 3: Implement.** A chave é criada dentro do semáforo do `UnlockAsync`/`CreateAsync` e gravada com o `SaveAsync` de sempre; `ToString()` do record não imprime a chave.
- [ ] **Step 4: Run** — Expected: PASS, e a suíte `Vault` inteira passa.
- [ ] **Step 5: Commit** `feat(api): chave do diário no cofre (RN-DIARIO-002 e 004)`

### Task 2: Nível de perigo e a fixture de ouro

**Files:**
- Create: `src/test-fixtures/audit/levels.json`
- Create: `src/api/Prism.Infrastructure/Databases/Clients/CommandDanger.cs`
- Create: `src/api/Prism.Infrastructure/Journal/Models/EJournalLevel.cs`
- Test: `src/api/tests/Prism.UnitTesting/Databases/CommandDangerTests.cs`, `src/client/src/app/connections/_lib/protections.levels.test.ts`
- Modify: `AGENTS.md` (linha nova em "Onde está o quê")

**Interfaces:**
- Produces: `public enum EJournalLevel { Info = 0, Warning = 1, High = 2, Critical = 3 }`; `public static (EJournalLevel Level, string Reason, string Action) CommandDanger.Classify(string sql, EDatabaseEngine engine)`. `Action` é a primeira palavra do comando em maiúsculas (`DELETE`, `ALTER TABLE`, `DROP INDEX`).
- Fixture: array de `{ "sql", "engine": "postgresql"|"db2"|"informix", "level": "info"|"warning"|"high"|"critical", "reason", "action" }`; motivos exatamente como a RN-AUDIT-007 (`"Leitura."`, `"DELETE sem WHERE: apaga todas as linhas de <tabela>."`, `"DROP COLUMN dentro de ALTER TABLE."`).

- [ ] **Step 1: Write the fixture by hand**, cerca de 60 casos da seção 9 da spec, nos três bancos. Nunca gerar a partir do código.
- [ ] **Step 2: Tests:** `CommandDangerTests.MatchesGoldenFixture` (`[Theory]` lendo `levels.json` relativo à raiz do repositório, como os testes de `markers.json`); `protections.levels.test.ts` › `"o leitor de irreversível concorda com a fixture no nível crítico"`: para cada caso, `isIrreversible(sql, engine) === (level === "critical")`, exceto os marcados `"clientSkip": true` (eventos que não são texto).
- [ ] **Step 3: Run** `dotnet test --filter CommandDangerTests` e `npm --prefix src/client test -- protections.levels` — Expected: FAIL.
- [ ] **Step 4: Implement** `Classify` sobre `EditableSql.Lex` e `ReadOnlySql` (leitura → Info); cada comando separado por `;` é classificado e vale o maior; não reconhecido → Warning; dúvida de irreversível → Critical. Ajustar `protections.ts` só se a fixture mostrar divergência real, e então avisar no PR.
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Commit** `feat(api): nível de perigo dos comandos (RN-AUDIT-005 a 008)`

### Task 3: O diário (abrir, gravar, fechar, guarda)

**Files:**
- Create: `src/api/Prism.Infrastructure/Journal/Clients/JournalDatabaseClient.cs`, `IJournalDatabaseClient.cs`
- Create: `src/api/Prism.Infrastructure/Journal/Services/JournalService.cs`, `IJournalService.cs`, `IJournalRecorder.cs`
- Create: `src/api/Prism.Infrastructure/Journal/Models/JournalEntry.cs`, `JournalConnectionSnapshot.cs`, `EJournalKind.cs`, `EJournalOutcome.cs`, `JournalQuery.cs`
- Modify: `src/api/Prism.Infrastructure/DependencyInjection.cs`
- Test: `src/api/tests/Prism.IntegrationTesting/Journal/JournalServiceTests.cs`

**Interfaces:**
- Consumes: `IVaultService.Unlocked`, `Locked`, `Generation`, `Read()` (Task 1); `EJournalLevel` (Task 2).
- Produces:
  - `enum EJournalKind { Sql, Edit, Transaction, Data, Security, Connections }`; `enum EJournalOutcome { InProgress, Ok, Error, Refused, Cancelled, Interrupted }`.
  - `record JournalConnectionSnapshot(Guid? ConnectionId, string? Name, string? Engine, string? FolderPath, string? EnvironmentName, string? EnvironmentColor, string? Database)`.
  - `IJournalRecorder.Begin(JournalEntryStart start) : long` (devolve o número; `-1` se o diário está desligado) e `Complete(long id, JournalEntryEnd end)`; `Record(JournalEntryStart start, JournalEntryEnd end)` para eventos de uma vez.
  - `IJournalService.IsAvailable`, `QueryAsync(JournalQuery, CancellationToken) : Task<JournalPage>`, `GetAsync(long id, ...)`, `HideAsync(long id)`, `HideConnectionAsync(Guid)`, `FacetsAsync()`, `GetRetentionAsync()`, `SetRetentionAsync(int? days)`, `PurgeBeforeAsync(DateTimeOffset)`, `RekeyAsync(byte[] newKey)`.
  - `JournalQuery(DateTimeOffset? From, DateTimeOffset? To, IReadOnlyList<Guid> ConnectionIds, IReadOnlyList<string?> Environments, IReadOnlyList<EJournalLevel> Levels, IReadOnlyList<EJournalKind> Kinds, IReadOnlyList<EJournalOutcome> Outcomes, string? Text, bool HistoryOnly, long? Before, int Limit)`.

- [ ] **Step 1: Tests:** `Unlock_OpensJournal_Lock_ClosesAndZeroesKey`; `Lock_FlushesQueuedEntriesBeforeClosing`; `Complete_AfterGenerationChange_IsDropped`; `Reopen_MarksInProgressAsInterrupted`; `WrongKey_RenamesDamagedFile_AndRecordsCritical`; `CannotCreate_ServiceUnavailable_VaultStillOpen`; `LongSql_IsTruncatedAt256KiB_WithMark`; `Retention_DeletesOlderEntries_OnOpen`; `Rekey_NewKeyOpens_OldKeyFails`; `NoPlaintextOnDisk` (procura o texto do comando e o nome da conexão nos bytes de `journal/`).
- [ ] **Step 2: Run** `dotnet test src/api/tests/Prism.IntegrationTesting --filter JournalServiceTests` — Expected: FAIL.
- [ ] **Step 3: Implement.** Esquema da seção 7 da spec; gravador único lendo um `Channel<JournalWork>` sem limite, em lotes de até 200 por transação; `Lock` espera a fila até 2 s; `ClearPool` e `CryptographicOperations.ZeroMemory` no fechamento; limpeza da guarda ao abrir e por `PeriodicTimer` de 24 h; a busca usa `LIKE ... ESCAPE '\'` sobre uma coluna `search_text` gravada sem acento e em minúsculas.
- [ ] **Step 4: Wire** a troca de senha: `ChangePasswordAsync(beforeSave: RekeyAsync, onSaveFailed: rekey de volta)`.
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Commit** `feat(api): diário cifrado por usuário (RN-DIARIO-001 a 009)`

### Task 4: Gravar as execuções

**Files:**
- Modify: `src/api/Prism.Application/DatabaseSessions/Features/ExecuteQuery/ExecuteQuery.cs`, `ExecuteQueryValidator.cs`, `ApplyEdits/ApplyEdits.cs`, `EndTransaction/EndTransaction.cs`
- Modify: `src/api/Prism.Application/Transfers/Features/StartExport/StartExport.cs` e os handlers de importação e cópia em `Transfers/`
- Modify: o registro de sessões onde a recusa do somente leitura acontece (`IDatabaseSessionService`)
- Create: `src/api/Prism.Application/Journal/JournalSnapshots.cs` (monta o `JournalConnectionSnapshot` com o ambiente próprio ou herdado, RN-PASTA-005)
- Test: `src/api/tests/Prism.UnitTesting/DatabaseSessions/ExecuteQueryJournalTests.cs`, `.../ApplyEditsJournalTests.cs`, `src/api/tests/Prism.UnitTesting/Transfers/TransferJournalTests.cs`

**Interfaces:**
- Consumes: `IJournalRecorder` (Task 3), `CommandDanger.Classify` (Task 2).
- Produces: `ExecuteQueryCommand.Origin` (`string?`) e `HistoryText` (`string?`); validator recusa origem fora da lista com `QUERY_INVALID` no campo `origin` e `historyText` acima de 256 KiB.

- [ ] **Step 1: Tests:** `Execute_RecordsBeginThenComplete_WithLevelReasonAndSnapshot`; `Execute_InheritedEnvironment_IsSnapshotted`; `Execute_ReadOnlyRefusal_RecordsRefused`; `Execute_Error_RecordsSqlStateAndMessage`; `Execute_Params_ValuesNeverRecorded`; `Validator_UnknownOrigin_IsQueryInvalid`; `AutoRefresh_RecordsOnlyFirstAndChanged`; `ApplyEdits_OneEntryPerSave_WholeColumnIsHigh`; `Export_RecordsWithoutFileName`; `Import_EmptyingTableFirst_IsCritical`; `ToString_DoesNotLeakSql`.
- [ ] **Step 2: Run** `dotnet test src/api/tests/Prism.UnitTesting --filter "ExecuteQueryJournalTests|ApplyEditsJournalTests|TransferJournalTests"` — Expected: FAIL.
- [ ] **Step 3: Implement.** `Begin` antes de ir ao banco e `Complete` no fim, também no cancelamento; o campo "passou pela confirmação" vem de `confirmed: bool` no corpo, mandado pela tela quando a pergunta da RN-PROT-001 foi aceita.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): execuções no diário (RN-AUDIT-001 a 003)`

### Task 5: Gravar as ações da conta e das conexões

**Files:**
- Create: `src/api/Prism.Infrastructure/Journal/Clients/SignInAttemptsFile.cs`
- Modify: handlers de `Users/` (entrar, criar conta, sair, trocar senha), `Connections/` (criar, editar, mover, excluir, revelar senha, proteções), `Folders/`, `ConnectionTransfers/`, `DbeaverImports/`
- Test: `src/api/tests/Prism.UnitTesting/Journal/AccountJournalTests.cs`, `SignInAttemptsFileTests.cs`

**Interfaces:**
- Consumes: `IJournalRecorder.Record` (Task 3).
- Produces: `SignInAttemptsFile.Add(string userName, DateTimeOffset at)`, `Take(string userName) : IReadOnlyList<DateTimeOffset>` (lê e zera).

- [ ] **Step 1: Tests:** `WrongSignIns_AreSummarizedOnNextSuccess_AsHigh` (texto "3 entradas com senha errada desde a última (30/10 14:02, 14:03, 14:05)"); `AttemptsFile_HoldsOnlyTimes`; `RevealPassword_RecordsHigh_OkAndError`; `FifthWrongPassword_RecordedBeforeLock_AsCritical`; `ReadOnlyTurnedOff_IsHigh_TurnedOn_IsInfo`; `ConfirmationLoosened_IsHigh`; `ExportConnectionsWithPasswords_IsHigh`; `ConnectionDeleted_IsWarning`.
- [ ] **Step 2: Run** `dotnet test --filter "AccountJournalTests|SignInAttemptsFileTests"` — Expected: FAIL.
- [ ] **Step 3: Implement** os registros com os níveis da tabela da RN-AUDIT-005.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): ações da conta e das conexões no diário (RN-AUDIT-004)`

### Task 6: Rotas do diário

**Files:**
- Create: `src/api/Prism.Api/Controllers/UserJournalController.cs`
- Create: `src/api/Prism.Application/Journal/Features/{GetHistory,HideHistoryEntry,HideConnectionHistory,GetAuditEntries,GetAuditEntry,GetAuditFacets,GetJournalSettings,UpdateJournalSettings,PurgeAudit}/*.cs` (comando, handler, validator)
- Create: `src/api/Prism.Application/Journal/Models/JournalErrors.cs`, `Models/Dtos/*.cs`
- Test: `src/api/tests/Prism.IntegrationTesting/Journal/UserJournalControllerTests.cs`

**Interfaces:**
- Consumes: `IJournalService` (Task 3); `IVaultService.ReadIfPasswordMatchesAsync` para o `purge` (contagem da RN-CONN-003).
- Produces (JSON, camelCase): `HistoryItemDto { id, startedAt, durationMs, outcome, rows, connectionId, connectionName, database, environmentName, environmentColor, text, errorMessage, repeat, lastAt }`; `AuditItemDto { id, startedAt, level, kind, action, summary, connectionName, database, environmentName, environmentColor, outcome, durationMs }`; `AuditEntryDto` (tudo da RN-AUDIT-001); `AuditPageDto { items, total, next }`; `AuditFacetsDto { connections: [{ id, name, deleted }], environments: [{ name, color }], count, oldest, sizeBytes }`; `JournalSettingsDto { retentionDays: 30|90|180|365|null }`.

- [ ] **Step 1: Tests:** `History_DefaultsToConnection_LimitAndCursor`; `History_CollapsesConsecutiveRepeats`; `History_SearchTreatsWildcardsLiterally_AndIgnoresAccents`; `History_OnlyUserOrigins`; `Hide_RemovesFromHistory_KeepsInAudit`; `Audit_AllFilters_AndTotal`; `Audit_LimitAbove500_IsFilterInvalid`; `AuditFacets_IncludeDeletedConnections_Marked`; `Settings_InvalidRetention_IsSettingsInvalid`; `Settings_Shorten_RecordsHigh`; `Purge_WrongPassword_422_CountsTowardFive`; `Purge_DeletesBefore_AndRecordsCritical`; `LockedVault_401`; `UnavailableJournal_503`.
- [ ] **Step 2: Run** `dotnet test src/api/tests/Prism.IntegrationTesting --filter UserJournalControllerTests` — Expected: FAIL.
- [ ] **Step 3: Implement** seguindo `UserScriptsController` e a pasta `Scripts/` (uma feature por rota, `Result` para fora).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): rotas do histórico e da auditoria`

### Task 7: Painel do Histórico

**Files:**
- Create: `src/client/src/app/workbench/_lib/history.service.ts`, `history.copy.ts`, `history.ts` (agrupar por dia, juntar o texto inserido), `history.test.ts`
- Create: `src/client/src/app/workbench/_components/history-panel.tsx`, `history-panel.test.ts`
- Create: ícone `HistoryIcon` em `src/client/src/components/ui`
- Modify: `editor-toolbar.tsx` (botão depois de "Executar script"), `query-tab.tsx` (painel à direita do editor, 420 px), o lugar dos atalhos da área de trabalho (Ctrl+Shift+H), o caminho que chama `ExecuteQuery` (mandar `origin`, `historyText`, `confirmed`)

**Interfaces:**
- Consumes: `GET/DELETE api/user/journal/history` (Task 6).
- Produces: `groupByDay(items: HistoryItem[], now: Date): { day: string; items: HistoryItem[] }[]` ("Hoje", "Ontem", "28 de out."); `insertAtCursor(doc: string, cursor: number, text: string): { doc: string; cursor: number }` (separa por uma linha em branco, seção 26); `openFromHistory(item, connections): OpenQueryTabInput`.

- [ ] **Step 1: Tests:** `groupByDay` nos limites da meia-noite; `insertAtCursor` com documento vazio, no meio de um comando e no fim (uma linha em branco antes e depois, nunca duas); `openFromHistory_withMissingConnection_opensUnboundTab`; marcação do painel: busca com foco, escopo "Esta conexão" marcado, item com resultado escrito (não só cor), botão com `aria-keyshortcuts="Control+Shift+H"`; o texto vindo do diário escapado (RN-SHELL-002).
- [ ] **Step 2: Run** `npm --prefix src/client test -- history` — Expected: FAIL.
- [ ] **Step 3: Implement** com `useInfiniteQuery` (100 por página), busca com 150 ms de espera, setas, Enter, Shift+Enter, Ctrl+C, Delete, Esc da RN-HIST-005 a 007; `highlighted-sql.tsx` para o código.
- [ ] **Step 4: Run** `npm --prefix src/client test`, `npm --prefix src/client run typecheck`, `npm --prefix src/client run lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): painel do histórico de comandos (RN-HIST-001 a 008)`

### Task 8: Configurações › Auditoria

**Files:**
- Create: `src/client/src/app/settings/_lib/audit.service.ts`, `audit.copy.ts`, `audit-filters.ts`, `audit-filters.test.ts`
- Create: `src/client/src/app/settings/_components/audit-section.tsx`, `audit-detail.tsx`, `audit-purge-dialog.tsx`, `audit-section.test.ts`
- Create: ícone `ShieldCheckIcon` em `src/client/src/components/ui`
- Modify: `settings/_lib/sections.ts` (`"audit"`, `anchor: "cfg-auditoria"`, depois de `security`), `settings.copy.ts`, `settings-nav.tsx`, `src/client/src/styles/globals.css` (tokens `--level-info`, `--level-warn`, `--level-high`, `--level-critical` nos seis temas)

**Interfaces:**
- Consumes: `GET audit`, `GET audit/{id}`, `GET audit/facets`, `GET/PUT settings`, `POST audit/purge` (Task 6).
- Produces: `defaultAuditFilters(): AuditFilters` (7 dias, tudo o mais vazio); `toUtcRange(period, custom, now): { from?: string; to?: string }`; `toAuditQuery(filters): URLSearchParams` (repete as chaves de escolha múltipla).

- [ ] **Step 1: Tests:** `toUtcRange_convertsLocalBoundsAcrossDst`; `toAuditQuery` com cada filtro e "Sem ambiente"; "Alto e Crítico" liga os dois níveis; `sections.test.ts` com a ordem nova; marcação: nível com ícone e nome, total encontrado, conexão excluída marcada, detalhe com "Abrir no editor"; contraste dos quatro tokens nos seis temas (o teste da RN-CONFIG-003).
- [ ] **Step 2: Run** `npm --prefix src/client test -- audit sections themes` — Expected: FAIL.
- [ ] **Step 3: Implement** a página do canvas `Auditoria`: barra de filtros que quebra linha, tabela com cabeçalho fixo e 200 por página, detalhe à direita (Esc fecha), cartão da guarda e "Apagar registros…" (data e senha; o 401 do quinto erro leva à tela de entrada como as outras conferências).
- [ ] **Step 4: Run** `npm --prefix src/client test`, `typecheck` e `lint` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): Configurações › Auditoria (RN-AUDIT-010 a 016)`

### Task 9: Spec da fatia 1, sondas e aceite

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-prism-fatia-1-design.md` (as mudanças da seção 13 da spec nova em RN-COFRE-008, RN-COFRE-013, RN-CONN-003, RN-CONFIG-001, RN-LOG-001 e RN-SQL-001, com a marca "*Alterada a pedido do dono em 2026-10-30*")
- Modify: `AGENTS.md` (decisão 2)
- Copy: os três `.dc.html` aprovados para `docs/design/canvas/` e as entradas no `canvas.json` de lá
- Test: `src/api/tests/Prism.IntegrationTesting/Journal/JournalPerformanceProbe.cs` (`[Explicit]`)

- [ ] **Step 1: Probe** com 200 mil registros: primeira página do Histórico ≤ 100 ms (RN-HIST-008), Auditoria com todos os filtros, `rekey` (acima de 10 s: abrir tarefa para o progresso na troca de senha).
- [ ] **Step 2: Run** os critérios de aceite da seção 11 da spec no app empacotado, um por um, e anotar o resultado no PR.
- [ ] **Step 3: Run** `dotnet test src/api/Prism.slnx` e `npm --prefix src/client test` — Expected: PASS.
- [ ] **Step 4: Commit** `docs: histórico e auditoria na especificação da fatia 1`
