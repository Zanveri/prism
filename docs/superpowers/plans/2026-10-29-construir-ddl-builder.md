# Construir (modelar tabelas e gerar DDL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao Prism o modo Construir: seletor de modo na barra superior, modelos de tabelas salvos no cofre, edição por formulário, SQL e DBML, diagrama, leitura de tabelas existentes de um banco e geração do DDL completo ou só das diferenças para PostgreSQL, Db2 e Informix.

**Architecture:** O modelo (`BuildModel`, JSON validado com Zod) é a fonte da verdade e mora no cofre como texto opaco, pelas rotas `api/user/build-models` (espelho de `Scripts`). Tudo o que decide regra é TypeScript puro em `src/client/src/app/build/_lib/` — operações do modelo, comparação com a `origin` das tabelas existentes, validação, geradores de DDL completo e de diferenças, leitores e escritores de SQL e DBML, leitura e releitura do catálogo —, testado contra fixtures de ouro escritas à mão em `src/test-fixtures/build/`. A página `/build` fica viva como a Área de trabalho (uma vaga que esconde em vez de desmontar) e reusa `TopBar`, `ContextMenu`, `DiagramCanvas`, o leitor de `sql-statements.ts` e o `openQueryTab` da Área de trabalho.

**Tech Stack:** TypeScript, React 19, React Router 8, TanStack Query 5, Zod 4, CodeMirror 6, Tailwind 4, Vitest; C# / ASP.NET Core, xUnit (projetos `Prism.UnitTesting` e `Prism.IntegrationTesting`).

**Spec:** `docs/superpowers/specs/2026-10-29-construir-ddl-builder-design.md` (regras `RN-CONSTRUIR-*`). Canvas: `docs/design/canvas/Construir*.dc.html`.

## Global Constraints

- Zero dependências novas em `src/client/package.json` e nos `.csproj`.
- Destinos: só `postgresql` (engine 1), `db2` (2) e `informix` (3).
- Textos visíveis e comentários em português, em `*.copy.ts`; identificadores em inglês; cores só por tokens de `globals.css`.
- Testes do cliente sem DOM: regras em `_lib/*.ts`; componentes testados pela marcação (`renderToStaticMarkup` e `stripTags` de `@/lib/testing/text`, como `top-bar.test.ts`).
- Fixtures de `src/test-fixtures/build/` são escritas à mão e nunca regeradas a partir do código; a data e a versão do cabeçalho do DDL chegam já formatadas (`DdlContext`).
- Cofre: `VaultDocument` ganha `BuildModels` no fim, nulo por padrão, sem subir o formato. Nome do modelo de 1 a 200 caracteres, sem controle, único sem diferenciar maiúsculas; corpo até 4 MB (UTF-8) e objeto JSON.
- Rotas: cliente `/build`; API `api/user/build-models`; chaves de `localStorage` `prism:build-tabs:<usuário>` e `prism:build-layout:<usuário>`.
- O Construir nunca executa SQL: só lê o catálogo e abre uma aba de consulta.

## Review Focus

- Renomear uma coluna de tabela existente pelo Simplificado e depois "Reler do banco": o DDL de diferenças continua com `RENAME COLUMN`, não com `DROP` + `ADD` (teste na Task 12).
- Apagar uma linha de coluna de uma tabela existente no texto DBML: a coluna vira removida, o DDL de diferenças traz `DROP COLUMN` e o problema W10 aparece (teste na Task 10).
- Nome de tabela do Db2 lido do catálogo em minúsculas (criado com aspas): sai sempre entre aspas, e `sameName` não o confunde com o mesmo nome digitado sem aspas (teste na Task 5).
- Bloqueio por inatividade 300 ms depois de uma edição: o salvamento pendente é gravado antes de o cofre fechar (teste na Task 13).
- Modelo com base e nenhuma mudança: "Só as diferenças" mostra "Nada mudou em relação a …" e as ações ficam desabilitadas (fixture na Task 9, teste na Task 18).

---

### Task 1: Ícone, rota e seletor de modo na barra superior

**Files:**
- Modify: `src/client/src/components/ui/icons.tsx`, `src/client/src/components/ui/index.ts`
- Modify: `src/client/src/config/paths.config.ts`
- Create: `src/client/src/components/layout/mode-menu.tsx`, `src/client/src/components/layout/mode-menu.copy.ts`
- Modify: `src/client/src/components/layout/top-bar.tsx:102-106`
- Modify: `src/client/src/components/ui/context-menu.tsx:140` (o visto depois do texto quando o item marcado tem ícone)
- Test: `src/client/src/components/layout/mode-menu.test.ts`, `src/client/src/components/layout/top-bar.test.ts`

**Interfaces:**
- Produces:
  - `export function BuildIcon(props: ComponentProps<"svg">): JSX.Element` — paths do canvas: `M7.5 2.5l3.5 3.5 1.25-1.25-3.5-3.5z`, `M9.25 4.25L4.75 8.75`, `M2 10h10.5v1.25c-1.3 0-2.25.6-2.25 1.5H11V14H5.5v-1.25h.75c0-.9-.95-1.5-2.25-1.5-1 0-1.7-.45-2-1.25z`.
  - `pathsConfig.build = "/build"`.
  - `export type AppMode = "workbench" | "build"`; `export function modeOf(pathname: string, last: AppMode): AppMode`; `export function modeMenuGroups(current: AppMode): ContextMenuGroup[]` em `mode-menu.tsx`; `export function ModeMenu(): JSX.Element`.

- [ ] **Step 1: Escrever os testes**

Em `mode-menu.test.ts`:
```ts
describe("o seletor de modo (RN-CONSTRUIR-001)", () => {
  it("o modo vem da rota; fora das duas, fica o último", () => {
    expect(modeOf("/workbench", "build")).toBe("workbench");
    expect(modeOf("/build", "workbench")).toBe("build");
    expect(modeOf("/settings", "build")).toBe("build");
  });
  it("o menu tem os dois modos, com dica, e marca o atual", () => {
    const [group] = modeMenuGroups("build");
    expect(group.items.map((item) => [item.label, item.hint, item.checked])).toEqual([
      ["Área de trabalho", "Navegar nos bancos, rodar SQL e editar dados", false],
      ["Construir", "Desenhar tabelas, relações e índices e gerar o DDL", true],
    ]);
  });
});
```
Em `top-bar.test.ts`, trocar a asserção de `[["/workbench","Área de trabalho"],["/settings","Configurações"]]` (linhas 46-49) por: o único `<a>` é `/settings`, e há um `<button aria-haspopup="menu" aria-expanded="false">` com "Área de trabalho" antes de "Configurações"; a lista de itens `h-9` (linhas 103-108) passa a `button, a, a, span, button` (seletor, lembrete, Configurações, usuário, Sair).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix src/client test -- src/components/layout/mode-menu.test.ts src/components/layout/top-bar.test.ts`
Expected: FAIL (`modeOf` não existe; a barra ainda tem o `NavLink`).

- [ ] **Step 3: Implementar**

`ModeMenu` segue `result-place-button.tsx:55-98`: `<button aria-haspopup="menu" aria-expanded>` com a classe `itemClassName` da `TopBar` (ativo quando a rota é `/workbench` ou `/build`), ícone e nome do modo de `modeOf`, seta; abre `ContextMenu` em `rect.left, rect.bottom + 2`, com `initialFocus="first"` quando aberto pelo teclado; escolher navega com `useNavigate`. O último modo fica num `useRef` do componente (a `TopBar` de cada página monta o seu). No `ContextMenu`, quando `item.icon` existe e `item.checked === true`, desenhar `CheckIcon` depois do texto. Textos em `mode-menu.copy.ts`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix src/client test -- src/components/layout src/components/ui/context-menu.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/src/components src/client/src/config/paths.config.ts
git commit -m "feat(build): add mode menu with Área de trabalho and Construir to the top bar"
```

---

### Task 2: A página `/build` que fica viva

**Files:**
- Modify: `src/client/src/app/_components/workbench-slot.tsx` (vira `KeepAliveSlot({ path, children })`; `WorkbenchSlot` passa a ser `KeepAliveSlot` com `pathsConfig.workbench`)
- Modify: `src/client/src/app/routes.tsx`
- Create: `src/client/src/app/build/page.tsx`, `src/client/src/app/build/_lib/build.copy.ts`
- Test: `src/client/src/app/routes.test.ts`, `src/client/src/app/routes-lock.test.ts` (sem mudar o que afirma), `src/client/src/app/_components/workbench-slot.test.ts`

**Interfaces:**
- Consumes: `TopBar` (Task 1).
- Produces: `export function KeepAliveSlot({ path, mountOnFirstVisit, children }: { path: string; mountOnFirstVisit?: boolean; children: ReactNode }): JSX.Element`; `export function BuildPage(): JSX.Element` (por enquanto: `TopBar` e o estado vazio da barra lateral, "Nenhum modelo aberto.").

- [ ] **Step 1: Escrever os testes**

Em `routes.test.ts`: a rota sem elemento `/build` existe ao lado de `/workbench`; dentro do `WorkbenchProvider`, há `KeepAliveSlot path="/workbench"` com `WorkbenchPage` e `KeepAliveSlot path="/build" mountOnFirstVisit` com `BuildPage`, ambos fora do `RemountOnLock`. Em `workbench-slot.test.ts`: com `mountOnFirstVisit`, nada é desenhado antes da primeira visita; depois de visitar, sair da rota deixa `hidden` e `inert`. `routes-lock.test.ts` não muda e tem de continuar passando.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm --prefix src/client test -- src/app/routes.test.ts src/app/routes-lock.test.ts src/app/_components/workbench-slot.test.ts`
Expected: FAIL em `routes.test.ts` e `workbench-slot.test.ts`.

- [ ] **Step 3: Implementar**

Generalizar o corpo de `WorkbenchSlot` para receber `path`; `mountOnFirstVisit` guarda num `useRef` se a rota já foi visitada. Em `routes.tsx`, acrescentar o `KeepAliveSlot` do Construir logo depois do da Área de trabalho e a rota `{ path: pathsConfig.build }` sem elemento.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm --prefix src/client test -- src/app`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app
git commit -m "feat(build): keep the /build page mounted like the workbench"
```

---

### Task 3: API — modelos no cofre

**Files:**
- Create: `src/api/Prism.Infrastructure/Vault/Models/VaultBuildModelRecord.cs`
- Modify: `src/api/Prism.Infrastructure/Vault/Models/VaultDocument.cs` (último parâmetro `IReadOnlyList<VaultBuildModelRecord>? BuildModels = null`)
- Create: `src/api/Prism.Application/BuildModels/Models/{BuildModelRules.cs,BuildModelErrors.cs,Dtos/BuildModelDto.cs}`, `src/api/Prism.Application/BuildModels/Repositories/{IBuildModelRepository.cs,BuildModelRepository.cs}`, `src/api/Prism.Application/BuildModels/Features/{GetBuildModels,GetBuildModel,CreateBuildModel,UpdateBuildModel,DeleteBuildModel}/*.cs` (comando, handler e, em `Create` e `Update`, validador)
- Create: `src/api/Prism.Api/Controllers/UserBuildModelsController.cs`
- Modify: o registro de DI da aplicação onde `ScriptRepository` é registrado
- Test: `src/api/tests/Prism.UnitTesting/BuildModels/{BuildModelRepositoryTests.cs,BuildModelValidatorsTests.cs,BuildModelHandlersTests.cs}`, `src/api/tests/Prism.IntegrationTesting/Api/BuildModelsTests.cs`

**Interfaces:**
- Produces: `GET/POST api/user/build-models`, `GET/PATCH/DELETE api/user/build-models/{id}`; `BuildModelDto(Guid ID, string Name, string Body, DateTime CreatedAt, DateTime UpdatedAt)` serializado como `{ id, name, body, createdAt, updatedAt }`; PATCH `{ name?, body?, expectedUpdatedAt }`.
- `BuildModelRules`: `MaxNameLength = 200`, `MaxBodyBytes = 4 * 1024 * 1024`, `IsValidName(string?)`, `FitsTheLimit(string?)`, `IsJsonObject(string?)`.

- [ ] **Step 1: Escrever os testes de unidade**, espelhando `ScriptRepositoryTests` e `ScriptHandlersTests`:
  - `Create_WithNameOfAnotherModelInOtherCase_Fails409BuildModelAlreadyExists`
  - `Update_WithStaleExpectedUpdatedAt_Fails409BuildModelChanged` (e não grava)
  - `Update_WithCurrentExpectedUpdatedAt_SavesBodyAndBumpsUpdatedAt`
  - `Validator_RejectsEmptyName_201Characters_ControlCharacter_WithBuildModelNameInvalid`
  - `Validator_RejectsBodyAbove4MB_WithBuildModelTooLarge`
  - `Validator_RejectsBodyThatIsNotAJsonObject_WithBuildModelBodyInvalid` (`"[]"`, `"1"`, `"{"`)
  - `ReadVaultWithoutBuildModels_ListsNone` (documento sem o campo, como antes do formato ter `Plugins`)
- [ ] **Step 2: Escrever o teste de integração** `BuildModelsTests`, espelhando `ScriptsTests`: criar, listar com o corpo, ler por id, renomear, PATCH com data velha → 409 `BUILD_MODEL_CHANGED`, excluir → 204 e depois 404 `BUILD_MODEL_NOT_FOUND`; com o cofre bloqueado → 401 `VAULT_LOCKED`; o log não contém o corpo (como `ScriptsLogTests`).
- [ ] **Step 3: Rodar e ver falhar**

Run: `dotnet test src/api/tests/Prism.UnitTesting --filter "FullyQualifiedName~BuildModel"` e `dotnet test src/api/tests/Prism.IntegrationTesting --filter "FullyQualifiedName~BuildModels"`
Expected: FAIL (não compila: tipos inexistentes).

- [ ] **Step 4: Implementar** espelhando `Scripts`, com as mensagens da seção 7 da spec. O `BuildModelRepository` grava por `VaultSaves.SaveOrRefuse`; o conflito compara `expectedUpdatedAt` com o `UpdatedAt` do registro dentro do mesmo `SaveAsync`.
- [ ] **Step 5: Rodar e ver passar** (os dois comandos do Step 3). Expected: PASS
- [ ] **Step 6: Commit**

```bash
git add src/api
git commit -m "feat(api): store Construir models in the vault under api/user/build-models"
```

---

### Task 4: Cliente — formato do modelo e serviço

**Files:**
- Create: `src/client/src/app/build/_lib/build-model.schema.ts`, `src/client/src/app/build/_lib/build-models.service.ts`
- Modify: `src/client/src/lib/api/prism-endpoints.ts` (`userBuildModels`, `userBuildModel(id)`, `userDatabaseSessionChecks(id, schema, table)` ao lado de `userDatabaseSessionColumns`)
- Test: `src/client/src/app/build/_lib/build-model.schema.test.ts`, `src/client/src/app/build/_lib/build-models.service.test.ts`

**Interfaces:**
- Produces (exatamente os tipos de RN-CONSTRUIR-010): `BuildEngine`, `buildEngines`, `FkAction`, `fkActions`, `Identity`, `TableShape`, `ModelTable`, `ModelColumn`, `ModelForeignKey = TableShape["foreignKeys"][number]`, `ModelIndex = TableShape["indexes"][number]`, `BuildModel`, `buildModelSchema`;
  `export function parseModelBody(body: string): BuildModel | null`; `export function serializeModel(model: BuildModel): string`;
  `export function engineIdOf(engine: BuildEngine): 1 | 2 | 3`; `export function buildEngineOf(engineId: number): BuildEngine | null`;
  `buildModelDtoSchema`, `type BuildModelDto = { id: string; name: string; body: string; createdAt: string; updatedAt: string }`;
  `listBuildModels(signal?)`, `buildModelsQuery` (chave `["build-models"]`), `getBuildModel(id, signal?)`, `createBuildModel(input: { name: string; body: string })`, `updateBuildModel(id: string, input: { name?: string; body?: string; expectedUpdatedAt: string })`, `deleteBuildModel(id: string)` — todos `Promise<ApiResult<…>>`, com `allowRefusal` para `BUILD_MODEL_ALREADY_EXISTS`, `BUILD_MODEL_NAME_INVALID`, `BUILD_MODEL_TOO_LARGE` e `BUILD_MODEL_CHANGED`.

- [ ] **Step 1: Escrever os testes**
```ts
it("lê o modelo do canvas e recusa versão desconhecida", () => {
  expect(parseModelBody(serializeModel(canvasModel))).toEqual(canvasModel);
  expect(parseModelBody(JSON.stringify({ ...canvasModel, version: 2 }))).toBeNull();
  expect(parseModelBody("não é json")).toBeNull();
});
it("motor do Prism ↔ destino", () => {
  expect(buildEngines.map(engineIdOf)).toEqual([1, 2, 3]);
  expect(buildEngineOf(4)).toBeNull();
});
```
`canvasModel` é o modelo `manutencao` do canvas (3 novas, 3 existentes, `maquina` com `ultima_revisao_em` acrescentada), em `src/test-fixtures/build/models/manutencao.json`, escrito à mão. No serviço, como `scripts.service.test.ts`: o PATCH manda `expectedUpdatedAt` e um 409 `BUILD_MODEL_CHANGED` volta como recusa, não como exceção.
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/build-model.schema.test.ts src/app/build/_lib/build-models.service.test.ts` → FAIL
- [ ] **Step 3: Implementar** com Zod 4; `identity` aceita `"always" | "byDefault" | null`; `exactName` com `.default(false)`.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): model schema and build-models service"`

---

### Task 5: Regras por destino

**Files:**
- Create: `src/client/src/app/build/_lib/build-engines.ts`
- Test: `src/client/src/app/build/_lib/build-engines.test.ts`

**Interfaces:**
- Produces:
```ts
export type EngineRules = {
  label: string; tag: "PG" | "DB2" | "IFX";
  identifierLimit: number; limitInBytes: boolean; hasSchemas: boolean;
  plainName: RegExp; fold: "lower" | "upper";
  reserved: ReadonlySet<string>; types: readonly string[];
  deleteActions: readonly FkAction[]; updateActions: readonly FkAction[];
};
export const engineRules: Record<BuildEngine, EngineRules>;
export function needsQuotes(engine: BuildEngine, name: string, exactName: boolean): boolean;
export function quoteName(engine: BuildEngine, name: string, exactName: boolean): string;
export function sameName(engine: BuildEngine, a: { name: string; exactName: boolean }, b: { name: string; exactName: boolean }): boolean;
export function exactNameFromCatalog(engine: BuildEngine, name: string): boolean;
export type NormalizedType = { family: "integer" | "decimal" | "float" | "text" | "datetime" | "boolean" | "binary" | "other"; base: string; args: number[] };
export function normalizeType(engine: BuildEngine, type: string): NormalizedType;
export function typeNarrows(engine: BuildEngine, from: string, to: string): boolean;
export function closestType(engine: BuildEngine, type: string): string | null;
```

- [ ] **Step 1: Escrever os testes** com os valores da spec:
```ts
expect(engineRules.postgresql.identifierLimit).toBe(63);
expect([engineRules.db2.identifierLimit, engineRules.informix.identifierLimit]).toEqual([128, 128]);
expect(engineRules.informix.deleteActions).toEqual(["noAction", "cascade"]);
expect(engineRules.db2.updateActions).toEqual(["noAction", "restrict"]);
expect(quoteName("postgresql", "OrdemX", false)).toBe('"OrdemX"');
expect(quoteName("db2", "ordem_manutencao", false)).toBe("ordem_manutencao");
expect(exactNameFromCatalog("db2", "ordem")).toBe(true);           // minúsculas no catálogo do Db2 = criado com aspas
expect(quoteName("db2", "ordem", true)).toBe('"ordem"');
expect(sameName("db2", { name: "ORDEM", exactName: false }, { name: "ordem", exactName: false })).toBe(true);
expect(sameName("db2", { name: "ordem", exactName: true }, { name: "ordem", exactName: false })).toBe(false);
expect(normalizeType("postgresql", "int8")).toEqual({ family: "integer", base: "bigint", args: [] });
expect(typeNarrows("postgresql", "varchar(20)", "varchar(12)")).toBe(true);
expect(typeNarrows("postgresql", "varchar(12)", "varchar(20)")).toBe(false);
expect(typeNarrows("informix", "integer", "varchar(10)")).toBe(true);  // troca de família
expect(closestType("postgresql", "timestampz")).toBe("timestamptz");
```
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/build-engines.test.ts` → FAIL
- [ ] **Step 3: Implementar.** Catálogos de tipos: os de RN-CONSTRUIR-031 (sugestões); `closestType` pela distância de edição ≤ 2 sobre `types`. Palavras reservadas: as do SQL padrão mais as próprias de cada banco, numa lista por destino neste arquivo.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): per-engine naming, quoting and type rules"`

---

### Task 6: Operações do modelo, comparação com a origem e histórico

**Files:**
- Create: `src/client/src/app/build/_lib/build-model.ts`
- Test: `src/client/src/app/build/_lib/build-model.test.ts`

**Interfaces:**
- Consumes: Task 4 (tipos), Task 5 (`sameName`).
- Produces:
```ts
export const tableKey = (table: { schema: string; name: string }) => `${table.schema}.${table.name}`;
export function emptyModel(engine: BuildEngine, defaultSchema: string, createSchema: boolean): BuildModel;
export function addTable(model: BuildModel, schema: string): { model: BuildModel; key: string };   // tabela_1, tabela_2…
export function renameTable(model: BuildModel, key: string, name: string): BuildModel;            // cascata: FKs que chegam e layout
export function moveTableToSchema(model: BuildModel, key: string, schema: string): BuildModel;    // só nova; existente: devolve o mesmo modelo
export function removeTable(model: BuildModel, key: string): BuildModel;                          // nova: exclui; existente: tira do modelo
export function setDropInDatabase(model: BuildModel, key: string, drop: boolean): BuildModel;
export function copyAsNewTable(model: BuildModel, key: string, schema: string): BuildModel;
export function revertTable(model: BuildModel, key: string): BuildModel;
export function addColumn(model: BuildModel, key: string, column?: Partial<ModelColumn>): BuildModel;
export function updateColumn(model: BuildModel, key: string, name: string, patch: Partial<Pick<ModelColumn, "type" | "nullable" | "default" | "identity" | "comment">>): BuildModel;
export function renameColumn(model: BuildModel, key: string, from: string, to: string): BuildModel;
export function moveColumn(model: BuildModel, key: string, name: string, toIndex: number): BuildModel;
export function removeColumn(model: BuildModel, key: string, name: string): { model: BuildModel; droppedForeignKeys: number };
export function restoreColumn(model: BuildModel, key: string, originName: string): BuildModel;
export function revertColumn(model: BuildModel, key: string, name: string): BuildModel;
export function togglePrimaryKey(model: BuildModel, key: string, column: string): BuildModel;     // liga NN
export function toggleUnique(model: BuildModel, key: string, column: string): BuildModel;
export function addForeignKey(model: BuildModel, key: string, fk: ModelForeignKey): BuildModel;
export function updateForeignKey(model: BuildModel, key: string, index: number, fk: ModelForeignKey): BuildModel;
export function removeForeignKey(model: BuildModel, key: string, index: number): BuildModel;
export function addIndex(model: BuildModel, key: string, columns: string[]): BuildModel;          // nome ix_<tabela>_<colunas>
export function updateIndex(model: BuildModel, key: string, index: number, value: ModelIndex): BuildModel;
export function removeIndex(model: BuildModel, key: string, index: number): BuildModel;
export function replaceTables(model: BuildModel, tables: ModelTable[], schemas: string[]): BuildModel; // mantém layout por chave

export type ColumnChange = { name: string; originName: string; renamed: boolean; type: boolean; nullable: boolean; default: boolean; comment: boolean };
export type TableChanges = {
  kind: "new" | "same" | "changed" | "dropped";
  renamedFrom: string | null;
  addedColumns: string[]; removedColumns: string[]; changedColumns: ColumnChange[];
  addedUniques: TableShape["uniques"]; removedUniques: TableShape["uniques"];
  addedChecks: TableShape["checks"]; removedChecks: TableShape["checks"];
  addedForeignKeys: ModelForeignKey[]; removedForeignKeys: ModelForeignKey[];
  addedIndexes: ModelIndex[]; removedIndexes: ModelIndex[];
  commentChanged: boolean;
  forbidden: ("primaryKey" | "identity" | "schema")[];
};
export function tableChanges(engine: BuildEngine, table: ModelTable): TableChanges;

export type History = { past: BuildModel[]; present: BuildModel; future: BuildModel[] };
export function startHistory(model: BuildModel): History;
export function commit(history: History, next: BuildModel): History;   // até 100 em `past`; limpa `future`
export function undo(history: History): History;
export function redo(history: History): History;
```

- [ ] **Step 1: Escrever os testes** (sobre `manutencao.json` da Task 4):
  - `renameColumn` em `producao.maquina` de `tag` para `tag_patrimonio` mantém `originName: "tag"` e `tableChanges` dá `changedColumns: [{ name: "tag_patrimonio", originName: "tag", renamed: true, type: false, … }]`;
  - `renameTable` de `plano_manutencao` atualiza a FK de `ordem_manutencao.plano_id` e move a chave do `layout`;
  - `removeColumn("producao.maquina", "modelo")` → `removedColumns: ["modelo"]`; `restoreColumn(…, "modelo")` volta a `kind: "changed"` só com `ultima_revisao_em` em `addedColumns`;
  - `removeColumn` de `ordem_manutencao.maquina_id` devolve `droppedForeignKeys: 1`;
  - `togglePrimaryKey` liga `nullable: false`;
  - mesma restrição com outra definição aparece em `removed…` e em `added…`;
  - PK trocada numa existente → `forbidden: ["primaryKey"]`;
  - `revertTable` → `kind: "same"`; `setDropInDatabase(…, true)` → `kind: "dropped"`;
  - `commit` 101 vezes guarda 100 em `past`; `undo` e `redo` andam um passo.
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/build-model.test.ts` → FAIL
- [ ] **Step 3: Implementar** funções puras que devolvem modelo novo (sem mutar). Restrições casam por `name` (com `sameName`); as sem nome em `TableShape` atual são sempre "acrescentadas".
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): model operations, origin comparison and undo history"`

---

### Task 7: Validação e correções

**Files:**
- Create: `src/client/src/app/build/_lib/model-check.ts`, `src/test-fixtures/build/checks/*.json` (um arquivo por código de RN-CONSTRUIR-061)
- Test: `src/client/src/app/build/_lib/model-check.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces:
```ts
export type ProblemCode = "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "E8" | "E9" | "E10" | "E11" | "E12" | "E13" | "E14"
  | "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7" | "W8" | "W10" | "W11" | "W12" | "W13" | "W14" | "I1" | "I2" | "I3";
export type ProblemFix =
  | { kind: "removeForeignKey"; table: string; index: number }
  | { kind: "createUnique"; table: string; columns: string[] }
  | { kind: "useFkAction"; table: string; index: number; onDelete: FkAction; onUpdate: FkAction }
  | { kind: "useType"; table: string; column: string; type: string }
  | { kind: "createIdColumn"; table: string }
  | { kind: "createIndexes"; items: { table: string; columns: string[] }[] }
  | { kind: "restore"; table: string; column: string | null }
  | { kind: "revert"; table: string; column: string | null }
  | { kind: "removeReferencingForeignKeys"; table: string }
  | { kind: "giveDefault"; table: string; column: string }
  | { kind: "useIdentity"; table: string; column: string }
  | { kind: "reread" };
export type Problem = { code: ProblemCode; severity: "error" | "warning" | "info"; table: string | null; column: string | null; message: string; fix: ProblemFix | null; key: string };
export type CheckContext = { scope: "changes" | "full"; baseLabel: string | null; baseEnvironment: string | null; notes: { code: "W8" | "W13"; message: string }[] };
export function checkModel(model: BuildModel, context: CheckContext): Problem[];   // sem os de `ignoredWarnings`
export function applyFix(model: BuildModel, fix: ProblemFix): BuildModel;          // "reread" não muda o modelo: a tela trata
export function problemCounts(problems: readonly Problem[]): { errors: number; warnings: number };
```
`key` = `"<código>:<tabela>[.<coluna>]"`, igual ao que vai para `ignoredWarnings`.

- [ ] **Step 1: Escrever as fixtures e o teste**

Cada `checks/<código>.json` é `{ "model": …, "scope": "changes" | "full", "problems": [{ "code", "severity", "table", "column" }] }`. O teste percorre a pasta:
```ts
for (const [file, fixture] of readFixtures("build/checks")) {
  it(file, () => {
    const problems = checkModel(fixture.model, { scope: fixture.scope, baseLabel: "MES Produção / mes", baseEnvironment: "Produção", notes: [] });
    expect(problems.map(({ code, severity, table, column }) => ({ code, severity, table, column }))).toEqual(fixture.problems);
  });
}
```
Casos que precisam estar nas fixtures: o modelo do canvas dá exatamente W2 (`peca_trocada.produto_id`), um W3 com 5 colunas em 3 tabelas, I1 e I2; W3 não aparece no Informix; W10 para `DROP COLUMN` e para `varchar(20)` → `varchar(12)`; W11 para coluna nova `NOT NULL` sem padrão numa existente; W12 e I3 só com `scope: "full"`; E13 com uma tabela marcada para excluir e referenciada; E14 com PK trocada numa existente; um aviso em `ignoredWarnings` não aparece. `applyFix({ kind: "useType", table: "manutencao.peca_trocada", column: "produto_id", type: "bigint" })` some com W2. `readFixtures` fica em `src/client/src/app/build/_lib/fixtures.ts` (lê `src/test-fixtures/` como os testes de exportação já fazem).
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/model-check.test.ts` → FAIL
- [ ] **Step 3: Implementar.** As mensagens em `build.copy.ts`, dizendo o efeito no banco (ex.: W2 "Um id acima de 2.147.483.647 não caberia.").
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): model validation with errors, warnings and one-click fixes"`

---

### Task 8: DDL completo

**Files:**
- Create: `src/client/src/app/build/_lib/ddl-write.ts` (escrita compartilhada), `src/client/src/app/build/_lib/ddl-full.ts`, `src/test-fixtures/build/ddl-full/*.json`
- Test: `src/client/src/app/build/_lib/ddl-full.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces:
```ts
// ddl-write.ts
export function qualifiedName(engine: BuildEngine, schema: string, name: string, exactName: boolean): string;
export function columnDefinition(engine: BuildEngine, column: ModelColumn, options: { inlinePrimaryKey: boolean; inlineReference: ModelForeignKey | null }): string;
export function constraintClause(engine: BuildEngine, name: string | null, body: string): string;   // Informix: nome depois
export function resolvedConstraintNames(model: BuildModel): Map<string, string>;                  // RN-CONSTRUIR-074; chave "<tabela>#<tipo>#<índice>"
export function dependencyOrder(tables: readonly ModelTable[]): { order: ModelTable[]; deferred: ReadonlySet<string> }; // "<tabela>#fk#<índice>"
// ddl-full.ts
export type DdlContext = { modelName: string; prismVersion: string; generatedAt: string; baseLabel: string | null };
export type DdlResult = { text: string; statements: number; lineOf: Record<string, number> }; // "<tabela>" e "<tabela>.<coluna>" → linha (1-base)
export function generateFullDdl(model: BuildModel, context: DdlContext): DdlResult;
```

- [ ] **Step 1: Escrever as fixtures e o teste**

`ddl-full/<caso>.json` = `{ "model": …, "context": { "modelName", "prismVersion": "0.6.0", "generatedAt": "29/10/2026 14:32", "baseLabel" }, "expected": "<DDL exato>" }`. Casos: `manutencao-postgresql` (o "Tudo" do canvas, `ConstruirDDL.dc.html` com o escopo "Tudo"), `manutencao-db2`, `manutencao-informix`, `ciclo-de-fk` (A→B→A: as duas FKs em `ALTER TABLE` no fim), `nomes-com-aspas` (PostgreSQL com maiúscula; Db2 com `exactName`), `informix-serial-lvarchar` (AI em `integer` e `bigint`, `PRIMARY KEY (id) CONSTRAINT pk_x`, sem `CREATE SCHEMA`, comentários como `--`), `drop-das-novas`, `sem-nomes-de-restricao`. Teste:
```ts
for (const [file, { model, context, expected }] of readFixtures("build/ddl-full")) {
  it(file, () => expect(generateFullDdl(model, context).text).toBe(expected));
}
it("diz em que linha está cada coluna", () => {
  const { expected } = fixture("build/ddl-full/manutencao-postgresql.json");
  const line = expected.split("\n").findIndex((text) => text.includes("produto_id integer")) + 1;
  expect(generateFullDdl(manutencao, context).lineOf["manutencao.peca_trocada.produto_id"]).toBe(line);
});
```
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/ddl-full.test.ts` → FAIL
- [ ] **Step 3: Implementar** na ordem de RN-CONSTRUIR-072 com a tabela de RN-CONSTRUIR-075. `dependencyOrder`: Kahn estável (empate por esquema e nome); arestas que sobram num ciclo vão para `deferred`.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): full DDL generator for PostgreSQL, Db2 and Informix"`

---

### Task 9: DDL de diferenças

**Files:**
- Create: `src/client/src/app/build/_lib/ddl-changes.ts`, `src/test-fixtures/build/ddl-changes/*.json`
- Test: `src/client/src/app/build/_lib/ddl-changes.test.ts`

**Interfaces:**
- Consumes: Task 6 (`tableChanges`), Task 8 (`ddl-write.ts`, `DdlContext`, `DdlResult`).
- Produces:
```ts
export function generateChangesDdl(model: BuildModel, context: DdlContext): DdlResult;       // statements 0 quando nada mudou
export function tableChangesDdl(model: BuildModel, key: string, context: DdlContext): string; // só os comandos dessa tabela, sem cabeçalho
export function generateDdl(model: BuildModel, context: DdlContext): DdlResult;               // base && scope === "changes" ? diferenças : completo
```

- [ ] **Step 1: Escrever as fixtures e o teste**, no mesmo formato da Task 8. Casos, nos três destinos quando a sintaxe difere: `manutencao-postgresql` (o "Só as diferenças" do canvas: `CREATE SCHEMA manutencao;`, `ALTER TABLE producao.maquina ADD COLUMN ultima_revisao_em date;`, as três `CREATE TABLE`, os índices e os comentários; cabeçalho citando "producao.operador e producao.produto"), `maquina-existente-<destino>` (o exemplo de `ConstruirExistente.dc.html`: `RENAME COLUMN tag TO tag_patrimonio`, troca para `varchar(20)`, `DROP COLUMN modelo`, `ADD COLUMN ultima_revisao_em date`, `CREATE INDEX ix_maquina_revisao`; no Informix, `RENAME COLUMN producao.maquina.tag TO tag_patrimonio` e um só `MODIFY`), `db2-reorg` (o `CALL SYSPROC.ADMIN_CMD('REORG TABLE …')` depois de `DROP COLUMN` e `SET DATA TYPE`), `fk-e-indice-em-existente` (FK removida, alterada e nova; índice idem, na ordem de RN-CONSTRUIR-073), `existente-excluida` (`DROP TABLE` depois do `DROP CONSTRAINT` das FKs dela), `sem-mudanca` (só o cabeçalho e `-- Nada mudou em relação a MES Produção / mes.`, `statements: 0`). Mais:
```ts
it("generateDdl segue a escolha do modelo", () => {
  expect(generateDdl({ ...manutencao, ddl: { ...manutencao.ddl, scope: "full" } }, context).text).toBe(fullExpected);
  expect(generateDdl({ ...manutencao, base: null }, context).text).toBe(generateFullDdl({ ...manutencao, base: null }, context).text);
});
```
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/ddl-changes.test.ts` → FAIL
- [ ] **Step 3: Implementar** na ordem de RN-CONSTRUIR-073 com a tabela de RN-CONSTRUIR-076; `USING c::x` no PostgreSQL só quando `normalizeType(...).family` muda.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): changes-only DDL with ALTER and DROP per engine"`

---

### Task 10: DBML — escrever, ler e manter o que o formato não escreve

**Files:**
- Create: `src/client/src/app/build/_lib/text-merge.ts`, `src/client/src/app/build/_lib/dbml.ts`, `src/test-fixtures/build/dbml/*.json`
- Test: `src/client/src/app/build/_lib/dbml.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces:
```ts
// text-merge.ts
export type TextError = { line: number; column: number; message: string };
export type TextWarning = { line: number; message: string };
export type TextRead = { ok: true; tables: ModelTable[]; schemas: string[]; warnings: TextWarning[] } | { ok: false; error: TextError };
export function mergeTextTables(read: ModelTable[], before: BuildModel, format: "sql" | "dbml"): ModelTable[]; // RN-CONSTRUIR-042
export function applyTextRead(model: BuildModel, read: Extract<TextRead, { ok: true }>): BuildModel;
// dbml.ts
export function printDbml(model: BuildModel): string;
export function readDbml(text: string, before: BuildModel): TextRead;   // já passa por mergeTextTables
```

- [ ] **Step 1: Escrever as fixtures e o teste.** `dbml/<caso>.json` = `{ "dbml", "before", "model", "warnings" }`. Casos: o DBML do canvas (`Construir.dc.html`, aba DBML) lido sobre `manutencao.json` dá o mesmo modelo; `Ref name: …` mantém o nome; `checks { … }` vira check de tabela; `<>` dá erro na linha com "muitos-para-muitos não vira FK; crie a tabela de ligação"; `Enum` e `TableGroup` dão W8; `increment` mantém `byDefault` de antes; índice único com as mesmas colunas de um único de antes continua único. Mais o caso do Review Focus:
```ts
it("apagar a linha de uma coluna de existente a torna removida", () => {
  const text = printDbml(manutencao).replace("  modelo varchar(60)\n", "");
  const read = readDbml(text, manutencao);
  if (!read.ok) throw new Error(read.error.message);
  const maquina = applyTextRead(manutencao, read).tables.find((t) => tableKey(t) === "producao.maquina")!;
  expect(tableChanges("postgresql", maquina).removedColumns).toEqual(["modelo"]);
  expect(generateChangesDdl(applyTextRead(manutencao, read), context).text).toContain("ALTER TABLE producao.maquina DROP COLUMN modelo;");
});
it("ida e volta", () => expect(readDbml(printDbml(manutencao), manutencao)).toMatchObject({ ok: true, tables: manutencao.tables }));
```
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/dbml.test.ts` → FAIL
- [ ] **Step 3: Implementar** um leitor por linhas e blocos (`{ }`, `[ ]`, strings `'…'`, crases), com linha e coluna nos erros.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): read and print DBML keeping what the format cannot carry"`

---

### Task 11: SQL do editor — escrever e ler

**Files:**
- Create: `src/client/src/app/build/_lib/sql-model.ts`, `src/test-fixtures/build/sql/*.json`
- Test: `src/client/src/app/build/_lib/sql-model.test.ts`

**Interfaces:**
- Consumes: Task 8 (`ddl-write.ts`), Task 10 (`TextRead`, `mergeTextTables`), `sqlTokens` e `splitStatements` de `src/client/src/app/workbench/_lib/sql-statements.ts` (com o `Engine` 1, 2 ou 3).
- Produces: `export function printModelSql(model: BuildModel): string` (RN-CONSTRUIR-040) e `export function readModelSql(text: string, before: BuildModel): TextRead`.

- [ ] **Step 1: Escrever as fixtures e o teste.** `sql/<caso>.json` = `{ "engine", "sql", "before", "model", "warnings" }`. Casos: o SQL do canvas (aba SQL, com a vírgula da linha 13) lido sobre `manutencao.json`; o mesmo sem a vírgula dá `{ ok: false, error: { line: 14, … } }` com "esperava , ou ) antes de fechada_em"; `GENERATED BY DEFAULT AS IDENTITY` → `byDefault`; `bigserial` → `bigint` + `byDefault`; Informix `PRIMARY KEY (id) CONSTRAINT pk_x` e comentários mantidos de antes; `CREATE VIEW` no meio dá W8 "linha N: CREATE VIEW ignorado" e o resto aplica; `ON UPDATE CASCADE` no Db2 é lido (vira E11 na validação, não erro de leitura). Ida e volta: `readModelSql(printModelSql(m), m)` dá as mesmas tabelas.
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/sql-model.test.ts` → FAIL
- [ ] **Step 3: Implementar** sobre os comandos de `splitStatements`, reconhecendo só a gramática de RN-CONSTRUIR-043.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): read and print the model as SQL of the target engine"`

---

### Task 12: Ler o catálogo, importar e reler

**Files:**
- Create: `src/client/src/app/build/_lib/catalog-import.ts`, `src/test-fixtures/build/reread/*.json`
- Modify: `src/client/src/app/workbench/_lib/database-sessions.schema.ts:73` (`defaultValue: z.string().nullish().catch(null)` no `columnSchema`), o serviço de sessões (função `getTableChecks(sessionId, schema, table, signal?)` com `checkSchema = z.object({ name: z.string(), expression: z.string() })`)
- Test: `src/client/src/app/build/_lib/catalog-import.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6; as funções de catálogo já existentes do serviço de sessões (diagrama, objetos, colunas, índices) e `getTableChecks`.
- Produces:
```ts
export type CatalogTable = {
  schema: string; name: string; comment: string | null;
  columns: { name: string; type: string; isNullable: boolean; isPrimaryKey: boolean; defaultValue: string | null; generated: "always" | "byDefault" | null }[];
  foreignKeys: { name: string; columns: string[]; referencedSchema: string; referencedTable: string; referencedColumns: string[]; onDelete: string | null; onUpdate: string | null }[];
  indexes: { name: string; columns: string[]; isUnique: boolean }[];
  checks: { name: string; expression: string }[];
};
export type CatalogSnapshot = { schemas: string[]; knownTables: string[]; tables: CatalogTable[] };
export type CatalogSelection = { schema: string; tables: string[] }[];
export function readCatalog(sessionId: string, selection: CatalogSelection, options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<{ snapshot: CatalogSnapshot; failures: { table: string; message: string }[] }>; // até 4 pedidos ao mesmo tempo
export function tableFromCatalog(engine: BuildEngine, table: CatalogTable): ModelTable;      // origin = atual
export function modelFromCatalog(input: { engine: BuildEngine; defaultSchema: string; createSchema: boolean; base: { connectionId: string; database: string | null }; snapshot: CatalogSnapshot; readAt: string }): BuildModel;
export function addCatalogTables(model: BuildModel, snapshot: CatalogSnapshot, readAt: string): BuildModel;
export function rereadModel(model: BuildModel, snapshot: CatalogSnapshot, readAt: string): { model: BuildModel; notes: string[] };
```

- [ ] **Step 1: Escrever as fixtures e o teste.** `tableFromCatalog`: o índice único com exatamente as colunas da PK não entra em `indexes`; `serial` do Informix → `integer` + `byDefault`; nome do Db2 em minúsculas → `exactName: true`; `nextval(...)` do PostgreSQL fica no `default` com `identity: null`. `readCatalog` com um `fetch` falso: a tabela que falha entra em `failures` e as outras chegam; `onProgress` vai de `(0, n)` a `(n, n)`. `reread/<caso>.json` = `{ "model", "catalog", "readAt", "expected", "notes" }`, com os casos de RN-CONSTRUIR-058 (coluna mexida que mudou no banco acompanha o banco; coluna nova no banco entra; coluna e tabela que sumiram viram novas; cada um com a nota W13). Mais o caso do Review Focus:
```ts
it("a renomeação feita no modelo sobrevive à releitura", () => {
  const renamed = renameColumn(manutencao, "producao.maquina", "tag", "tag_patrimonio");
  const { model } = rereadModel(renamed, catalogComTagIgual, "29/10/2026 15:00");
  expect(generateChangesDdl(model, context).text).toContain("RENAME COLUMN tag TO tag_patrimonio");
  expect(generateChangesDdl(model, context).text).not.toContain("DROP COLUMN tag");
});
```
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/catalog-import.test.ts` → FAIL
- [ ] **Step 3: Implementar** com as rotas de RN-CONSTRUIR-056; `knownTables` vem de `objects?kind=tables` de cada esquema.
- [ ] **Step 4: Rodar e ver passar**, e também `npm --prefix src/client test -- src/app/workbench` (o `columnSchema` mudou). Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): read existing tables from the catalog and reread them"`

---

### Task 13: A página — abas, barra, lista de modelos e salvamento

**Files:**
- Create: `src/client/src/app/build/_lib/build-tabs.ts` (`readBuildTabs`/`writeBuildTabs` e `readBuildLayout`/`writeBuildLayout`), `src/client/src/app/build/_lib/model-summary.ts`, `src/client/src/app/build/_lib/model-save.ts`, `src/client/src/app/build/_lib/use-model-document.ts`, `src/client/src/app/build/_components/{build-sidebar.tsx,model-tabs.tsx,model-toolbar.tsx,build-footer.tsx,models-list.tsx}`
- Modify: `src/client/src/app/build/page.tsx`, `src/client/src/components/layout/top-bar.tsx:64` e `src/client/src/app/_components/vault-lock.tsx:85` (gravar os modelos pendentes junto com `workspaceSync.flush()`)
- Test: `src/client/src/app/build/_lib/{build-tabs,model-summary,model-save}.test.ts`, `src/client/src/app/build/page.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 6, 7.
- Produces:
```ts
// build-tabs.ts
export function readBuildTabs(user: string, storage?: Storage): { open: string[]; active: string | null };
export function writeBuildTabs(user: string, tabs: { open: string[]; active: string | null }, storage?: Storage): void;
// model-summary.ts
export function modelSummary(model: BuildModel, connectionName: (id: string) => string | null): { newTables: number; existing: number; changed: number; start: string; label: string };
// "3 novas · 3 existentes, 1 alterada"; start "Do zero" | "<conexão> / <banco> · <esquemas>" | "Arquivo <nome>"
// model-save.ts
export type SaveState = { status: "saved" | "pending" | "saving" | "failed" | "conflict"; savedAt: number | null; message: string | null };
export const autosaveDelayMs = 1000;
export function createSaveScheduler(deps: { save: (model: BuildModel, expectedUpdatedAt: string) => Promise<ApiResult<BuildModelDto>>; now: () => number; setTimer: (ms: number, run: () => void) => () => void }): { change(model: BuildModel): void; flush(): Promise<void>; state(): SaveState };
export const buildModelSync: { register(id: string, flush: () => Promise<void>): () => void; flush(): Promise<void> }; // com o prazo de workspaceFlushTimeoutMs
// build-layout: a barra lateral escondida ou não, como `navigator-layout.ts`
export function readBuildLayout(user: string, storage?: Storage): { sidebarHidden: boolean };
export function writeBuildLayout(user: string, layout: { sidebarHidden: boolean }, storage?: Storage): void;
// use-model-document.ts
export function useModelDocument(id: string): { history: History; state: SaveState; change(next: BuildModel): void; undo(): void; redo(): void; saveNow(): void; reload(): void; keepMine(): void };
```

- [ ] **Step 1: Escrever os testes.** `build-tabs`: chave `prism:build-tabs:marina.costa`, ida e volta, valor inválido dá `{ open: [], active: null }`; `prism:build-layout:marina.costa` guarda `sidebarHidden`. `model-summary`: o modelo do canvas dá `"3 novas · 3 existentes, 1 alterada"`. `model-save` (relógio falso): uma mudança agenda o salvamento para 1000 ms; outra mudança antes empurra; 409 vira `status: "conflict"`; e o do Review Focus:
```ts
it("o salvamento pendente é gravado antes de o cofre fechar", async () => {
  const save = vi.fn().mockResolvedValue(okResult);
  const doc = createSaveScheduler({ save, now: clock.now, setTimer: clock.setTimer });
  doc.change(edited);
  clock.advance(300);
  await buildModelSync.flush();
  expect(save).toHaveBeenCalledTimes(1);
});
```
(`createSaveScheduler` é o núcleo puro de `model-save.ts` que o hook usa.) `page.test.ts`: sem modelo aberto, a lista "Modelos" com "Novo modelo" e "Abrir arquivo .sql ou .dbml"; com o modelo do canvas aberto, a barra lateral tem os grupos `manutencao` ("novo esquema") e `producao` ("existente"), `maquina` com "alterada", e o rodapé "3 novas · 3 existentes, 1 alterada · 6 relações · 2 índices".
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build` → FAIL
- [ ] **Step 3: Implementar** a página no desenho de `Construir.dc.html` e `ConstruirModelos.dc.html`, com o editor e o diagrama ainda vazios (Tasks 14 e 15). Ctrl+S chama `saveNow`; Ctrl+Z e Ctrl+Shift+Z (ou Ctrl+Y) fora de editor de texto chamam `undo`/`redo`; Ctrl+B esconde e mostra a barra lateral (chave `prism:build-layout:<usuário>`, `readBuildLayout`/`writeBuildLayout` em `build-tabs.ts`); Alt+N cria uma tabela nova (`addTable`) e a seleciona. A lista de modelos tem o menu de RN-CONSTRUIR-082 (Renomear e Duplicar por `createBuildModel`/`updateBuildModel`, "Excluir modelo…" com `ConfirmDialog` pelo nome, fechando a aba aberta); as exportações do menu entram na Task 18. `vault-lock.tsx` e `top-bar.tsx` passam a esperar `Promise.all([workspaceSync.flush(), buildModelSync.flush()])`.
- [ ] **Step 4: Rodar e ver passar** — `npm --prefix src/client test -- src/app/build src/components/layout src/app/_components`. Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): build page shell, open model tabs and autosave"`

---

### Task 14: Simplificado

**Files:**
- Create: `src/client/src/app/build/_lib/editor-rows.ts`, `src/client/src/app/build/_components/{simple-editor.tsx,column-row.tsx,foreign-keys-section.tsx,indexes-section.tsx,existing-table-banner.tsx,table-commands.tsx}`
- Test: `src/client/src/app/build/_lib/editor-rows.test.ts`, `src/client/src/app/build/_components/simple-editor.test.ts`

**Interfaces:**
- Consumes: Task 6 (operações e `tableChanges`), Task 5 (`engineRules[...].types`, `deleteActions`), Task 9 (`tableChangesDdl`).
- Produces:
```ts
export type RowState = { marker: "none" | "changed" | "new"; before: string | null; locks: { primaryKey: boolean; identity: boolean } };
export function columnRowState(engine: BuildEngine, table: ModelTable, column: ModelColumn): RowState; // before: "tag varchar(12)"
export function removedColumns(table: ModelTable): ModelColumn[];                                    // as de origin sem par
export function fkActionOptions(engine: BuildEngine): { onDelete: FkAction[]; onUpdate: FkAction[] };
```

- [ ] **Step 1: Escrever os testes.** `columnRowState` em `producao.maquina` com `tag` renomeada e trocada para `varchar(20)`: `{ marker: "changed", before: "tag varchar(12)", locks: { primaryKey: true, identity: true } }`; coluna nova numa existente: `marker: "new"`, PK e AI travados; em tabela nova: nada travado. Marcação de `simple-editor` com a tabela `ordem_manutencao` do canvas: oito linhas, os botões `aria-pressed` PK/NN/UQ/AI, a marca "FK" em `maquina_id`, `plano_id` e `aberta_por`, "Ao excluir: anular" marcado em `plano_id`; com `producao.maquina` do exemplo: "Existe em MES Produção / mes", "Era tag varchar(12)", `modelo` riscada com "Restaurar", "NOVA" em `ultima_revisao_em`, e "O que esta tabela vai gerar" com o texto de `tableChangesDdl`. No Informix, "Ao excluir" só oferece "impedir" e "cascata".
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/editor-rows.test.ts src/app/build/_components/simple-editor.test.ts` → FAIL
- [ ] **Step 3: Implementar** no desenho do canvas; cada ação chama uma operação da Task 6 e `change()` da Task 13; "Excluir no banco…" usa o `ConfirmDialog` com o nome da tabela.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): simplified table editor for new and existing tables"`

---

### Task 15: Diagrama

**Files:**
- Create: `src/client/src/app/build/_lib/model-layout.ts`, `src/client/src/app/build/_components/build-diagram.tsx`
- Modify: `src/client/src/app/workbench/_lib/table-diagram.ts:29-45` (campos opcionais: `DiagramBox.variant?: "new" | "existing"`, `badge?: string`, `dropped?: boolean`, `warning?: "error" | "warning"`; `DiagramColumn.state?: "added" | "removed"`), `src/client/src/app/workbench/_components/table-tab/diagram-canvas.tsx` (props opcionais `selectedKey`, `onSelect(key)`, `onMoveTable(key, x, y)`, `onConnect(fromKey, column, toKey)`, e o desenho dos campos novos)
- Test: `src/client/src/app/build/_lib/model-layout.test.ts`, `src/client/src/app/workbench/_components/table-tab/diagram-canvas.test.ts` (o que já existe continua passando)

**Interfaces:**
- Consumes: Tasks 6, 7; `layoutSchemaDiagram` de `schema-diagram.ts`.
- Produces:
```ts
export function modelDiagram(model: BuildModel, problems: readonly Problem[]): DiagramLayout;  // posições do layout; sem posição → layoutSchemaDiagram
export function organize(model: BuildModel): BuildModel;                                        // reposiciona só as não fixadas
export function moveTable(model: BuildModel, key: string, x: number, y: number): BuildModel;    // pinned: true
export function connectColumn(model: BuildModel, fromKey: string, column: string, toKey: string): { model: BuildModel } | { needsDialog: ModelForeignKey };
```

- [ ] **Step 1: Escrever os testes.** `modelDiagram` do canvas: seis caixas; `producao.maquina` com `variant: "existing"`, `badge: "alterada"` e `ultima_revisao_em` com `state: "added"`; seis arestas, de `fromColumn` para `toColumn`; caixas com aviso marcam `warning: "warning"`. `organize` não move uma tabela `pinned`. `connectColumn` para uma tabela de PK simples cria a FK; para PK composta devolve `needsDialog` preenchido. Os testes de `diagram-canvas` existentes passam sem as props novas.
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/model-layout.test.ts src/app/workbench` → FAIL
- [ ] **Step 3: Implementar.** Arrastar caixa: `pointerdown`/`pointermove`/`pointerup` no cabeçalho da caixa (o arrasto do fundo continua sendo rolagem); arrastar coluna: no nome da coluna, soltando sobre outra caixa. Delete com a caixa de tabela nova selecionada chama `removeTable` (com a notificação "Desfazer").
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): editable model diagram with drag to move and to link"`

---

### Task 16: Abas SQL e DBML

**Files:**
- Create: `src/client/src/app/build/_lib/text-apply.ts`, `src/client/src/app/build/_lib/dbml-language.ts`, `src/client/src/app/build/_components/text-pane.tsx`
- Test: `src/client/src/app/build/_lib/text-apply.test.ts`

**Interfaces:**
- Consumes: Tasks 10 e 11; o `SqlEditor` (`src/client/src/app/workbench/_components/sql-editor.tsx`) ou as mesmas extensões do CodeMirror que ele monta.
- Produces:
```ts
export const textApplyDelayMs = 400;
export type TextStatus = { kind: "applied"; warnings: TextWarning[] } | { kind: "error"; error: TextError };
export function printText(model: BuildModel, format: "sql" | "dbml"): string;
export function applyText(model: BuildModel, format: "sql" | "dbml", text: string): { model: BuildModel | null; status: TextStatus };
export const dbmlLanguage: StreamLanguage<unknown>;
```

- [ ] **Step 1: Escrever os testes.** `applyText` com texto válido devolve o modelo novo e `applied`; com erro devolve `model: null` e o erro com a linha; os avisos W8 chegam em `status.warnings`. As posições do `layout` se mantêm para as mesmas chaves.
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/text-apply.test.ts` → FAIL
- [ ] **Step 3: Implementar** `text-pane.tsx`: o texto nasce de `printText` ao abrir a aba e não é reescrito enquanto ela está aberta; `applyText` roda `textApplyDelayMs` depois da última tecla; aplicado, chama `change()` (um passo de histórico); a barra de baixo mostra "Aplicado ao modelo." ou "Linha N: …" com "Ir para a linha", e no DBML a frase do canvas sobre o texto refeito ao trocar de aba. Realce: DBML por `dbmlLanguage`; SQL como no editor de consultas.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): live SQL and DBML panes over the model"`

---

### Task 17: Novo modelo, importar, reler e trocar a base

**Files:**
- Create: `src/client/src/app/build/_lib/catalog-tree.ts`, `src/client/src/app/build/_components/{new-model-dialog.tsx,import-tables-dialog.tsx,base-menu.tsx}`
- Test: `src/client/src/app/build/_lib/catalog-tree.test.ts`, `src/client/src/app/build/_components/new-model-dialog.test.ts`

**Interfaces:**
- Consumes: Task 12; `CheckTreeView` (`src/client/src/app/connections/_components/check-tree-view.tsx`) e `check-tree.ts`; o caminho de conectar do navegador (`useWorkbench()`).
- Produces: `export function catalogTreeItems(schemas: { schema: string; tables: string[] }[]): CheckItem[]` (os esquemas como `kind: "folder"` e as tabelas como `kind: "connection"` do `check-tree.ts`; se o nome do `kind` atrapalhar a leitura, acrescentar `"schema" | "table"` ao tipo dele) e `export function selectionOf(tree: CheckTree, checked: ReadonlySet<string>, model: BuildModel | null): { selection: CatalogSelection; counts: { checked: number; total: number }; alreadyInModel: string[] }`.

- [ ] **Step 1: Escrever os testes.** `selectionOf` com 3 de 8 marcadas dá `counts: { checked: 3, total: 8 }`; tabela que já está no modelo vem em `alreadyInModel` e não em `selection`. Marcação de `new-model-dialog`: "Do zero" mostra os três destinos; "A partir de um banco" mostra conexão, banco, a árvore, a frase "As tabelas marcadas entram como existentes…" e "O Prism só lê o catálogo. Nada muda no banco."; conexões de outros motores não aparecem; "Criar o esquema no DDL" vem ligado quando o esquema digitado não está nos esquemas da base.
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/catalog-tree.test.ts src/app/build/_components/new-model-dialog.test.ts` → FAIL
- [ ] **Step 3: Implementar** no desenho de `ConstruirNovoModelo.dc.html`: criar chama `readCatalog` (progresso e cancelar), `modelFromCatalog` (ou `emptyModel`) e `createBuildModel`, e abre a aba. "Importar tabelas de um banco" num modelo aberto usa `import-tables-dialog.tsx`, travado na base. `base-menu.tsx` tem "Trocar a base…"; "Reler do banco" chama `readCatalog` e `rereadModel` e passa as notas W13 para `CheckContext.notes`.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): new model, import, reread and change base"`

---

### Task 18: Vista do DDL, escolha do escopo, problemas e arquivos

**Files:**
- Create: `src/client/src/app/build/_lib/build-files.ts`, `src/client/src/app/build/_components/{scope-dialog.tsx,ddl-view.tsx,problems-list.tsx}`
- Test: `src/client/src/app/build/_lib/build-files.test.ts`, `src/client/src/app/build/_components/ddl-view.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 9, 10, 11, 13.
- Produces:
```ts
export function needsScopeQuestion(model: BuildModel): boolean;            // base !== null && ddl.scope === null
export function fileNameOf(modelName: string, kind: "dbml" | "sql" | "png"): string;
export function modelFromFile(fileName: string, text: string, engine: BuildEngine | null): { ok: true; name: string; model: BuildModel } | { ok: false; error: TextError } | { ok: false; needsEngine: true };
```

- [ ] **Step 1: Escrever os testes.** `needsScopeQuestion` só com base e `scope` nulo. `modelFromFile("estoque.dbml", dbmlComProjectPostgres, null)` cria com `engine: "postgresql"` e nome `estoque`; `.sql` sem destino devolve `needsEngine`. Marcação de `ddl-view` com o modelo do canvas: a escolha "Só as diferenças | Tudo" com a marcada certa, as caixas `CREATE SCHEMA` `manutencao` (marcada) e `producao` (desmarcada), "2 avisos · nenhum erro"; com um erro, "Copiar", "Salvar .sql" e "Abrir na Área de trabalho" desabilitados com a dica dele; e o do Review Focus: modelo com base sem mudança e `scope: "changes"` mostra "Nada mudou em relação a MES Produção / mes." e as três ações desabilitadas.
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/build-files.test.ts src/app/build/_components/ddl-view.test.ts` → FAIL
- [ ] **Step 3: Implementar** no desenho de `ConstruirEscopo.dc.html` e `ConstruirDDL.dc.html`: "Gerar DDL" abre `scope-dialog` quando `needsScopeQuestion`; a vista usa `generateDdl` e mostra `checkModel`; cada problema com `fix` chama `applyFix` e `change()`; "Ignorar neste modelo" acrescenta a `key` em `ignoredWarnings`. Exportar e "Salvar .sql" pelo mesmo caminho de salvar arquivo das exportações do Prism; PNG por `exportDiagramPng` com o layout de `modelDiagram`. "Abrir arquivo .sql ou .dbml" na lista usa `modelFromFile`.
- [ ] **Step 4: Rodar e ver passar.** Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(build): DDL view with scope choice, problems and file export"`

---

### Task 19: Levar à Área de trabalho e documentação

**Files:**
- Create: `src/client/src/app/build/_lib/workbench-target.ts`, `src/client/src/app/build/_components/connection-choice-dialog.tsx`
- Modify: `AGENTS.md` (linha de `src/test-fixtures/build/` na tabela "Onde está o quê", como as de `export/` e `variables/`), `src/client/AGENTS.md` (seção "Construir": rota, vaga viva, onde estão as regras e as fixtures)
- Test: `src/client/src/app/build/_lib/workbench-target.test.ts`

**Interfaces:**
- Consumes: `useWorkbench().openQueryTab(connectionId, sql, database)`; Task 9 (`generateDdl`).
- Produces: `export function workbenchTarget(model: BuildModel): { kind: "base"; connectionId: string; database: string | null } | { kind: "ask"; engine: BuildEngine; baseConnectionId: string | null }`.

- [ ] **Step 1: Escrever o teste.** Com base e `scope: "changes"` → `kind: "base"`; com `scope: "full"` → `kind: "ask"` com `baseConnectionId` da base; sem base → `kind: "ask"` com `baseConnectionId: null`.
- [ ] **Step 2: Rodar e ver falhar** — `npm --prefix src/client test -- src/app/build/_lib/workbench-target.test.ts` → FAIL
- [ ] **Step 3: Implementar.** "Abrir na Área de trabalho": `kind: "base"` chama `openQueryTab` e `navigate(pathsConfig.workbench)`; `kind: "ask"` abre `connection-choice-dialog` só com as conexões do motor do destino, a base marcada "as existentes já estão aqui". Atualizar os dois `AGENTS.md`.
- [ ] **Step 4: Rodar a suíte do cliente inteira e o lint**

Run: `npm --prefix src/client test` e `npm --prefix src/client run lint`
Expected: PASS, sem avisos novos.

- [ ] **Step 5: Commit** — `git commit -m "feat(build): open the DDL in a workbench query tab; document Construir"`
