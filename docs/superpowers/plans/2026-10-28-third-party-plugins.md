# Third-Party Plugin System + `SitDescriptions` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Obsidian + Claude Marketplace style third-party plugin system to Prism (with explicit liability disclaimer / Restricted Mode, Git repository & local folder installation, and a frontend plugin SDK for table structure enrichment) and create the internal Informix `SitDescriptions` plugin in `c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions`.

**Architecture:**
- **Backend (`src/api`)**: Stores plugin consent (`ConsentedAt`) and installed/linked plugin items in `VaultDocument.Plugins` (preserving Vault format 4 compatibility). `PluginSourceClient` in `Prism.Infrastructure/Plugins` reads/validates `manifest.json` and `main.js` from local folders and executes the user's native `git clone --depth 1` / `git pull --ff-only` into `<PRISM_DATA_DIR>/plugins/<id>`. `UserPluginsController` exposes `api/user/plugins` for consent, listing, installing, updating, toggling, removing, and fetching active plugin bundles.
- **Frontend (`src/client`)**: Adds a `Plugins` section in `Settings` with the Restricted Mode disclaimer modal, Git URL / local path installation form, and installed plugin cards. Loads active plugin bundles into a sandboxed `prism` SDK (`prism.db.query(sessionId, sql, params)` + `prism.ui.registerTableStructureEnricher(enricher)`). Integrates enrichment into `StructureView` and `StructureSections` (table description subtitle, extra columns `Formato` & `Descrição`, and an `Inf. do atributo (<colname>)` detail panel when a column row is clicked).
- **`SitDescriptions` Plugin (`c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions`)**: Implements `manifest.json`, `main.js`, and `README.md` querying `systables`/`syscolumns`/`diadic` and `diadii` on Informix sessions.

**Tech Stack:** .NET 10 / ASP.NET Core, CSharpFunctionalExtensions, FluentValidation, xUnit, React 19, TypeScript, TanStack Query, Zod, Tailwind CSS, Vitest.

---

## Task 1: Backend Vault Model & Plugin Infrastructure (`Prism.Infrastructure`)

**Files:**
- Create: `src/api/Prism.Infrastructure/Vault/Models/VaultPluginsRecord.cs`
- Modify: `src/api/Prism.Infrastructure/Vault/Models/VaultDocument.cs`
- Create: `src/api/Prism.Infrastructure/Plugins/Models/EPluginSourceKind.cs`
- Create: `src/api/Prism.Infrastructure/Plugins/Models/EPluginFailure.cs`
- Create: `src/api/Prism.Infrastructure/Plugins/Models/PluginFailure.cs`
- Create: `src/api/Prism.Infrastructure/Plugins/Models/PluginManifest.cs`
- Create: `src/api/Prism.Infrastructure/Plugins/Models/PluginSourceInspection.cs`
- Create: `src/api/Prism.Infrastructure/Plugins/Models/PluginSettings.cs`
- Create: `src/api/Prism.Infrastructure/Plugins/Clients/IPluginSourceClient.cs`
- Create: `src/api/Prism.Infrastructure/Plugins/Clients/PluginSourceClient.cs`
- Modify: `src/api/Prism.Infrastructure/DependencyInjection.cs`

- [ ] **Step 1: Create `VaultPluginsRecord.cs` and update `VaultDocument.cs`**
  - Define `VaultPluginsRecord(DateTimeOffset? ConsentedAt = null, IReadOnlyList<VaultPluginItemRecord>? Items = null)` and `VaultPluginItemRecord(string ID, string Name, string Version, string? Description, string? Author, string SourceKind, string Source, bool Enabled, DateTimeOffset InstalledAt, DateTimeOffset UpdatedAt)`.
  - Append `VaultPluginsRecord? Plugins = null` as the last optional parameter of `VaultDocument`.

- [ ] **Step 2: Create `Prism.Infrastructure/Plugins` models and `PluginSourceClient`**
  - Implement manifest validation (`id` matching `^[a-z0-9][a-z0-9._-]{1,63}$`, non-empty `name`, `version`, `main` relative path inside plugin root without `..` traversal, `main.js` size ≤ 2 MB).
  - Implement Git URL validation (`https://`, `http://`, `git@`, `ssh://`; never starts with `-`).
  - Implement `InstallFromGitAsync`, `UpdateGitAsync`, `InspectLocal`, `ReadBundle`, and `DeleteInstalledFiles` inside `PluginSourceClient` with a single `try`/`catch` in private `Send` helper and zero path/URL leakage in logs (`RN-LOG-001`).
  - Register `PluginSettings` and `IPluginSourceClient` in `Prism.Infrastructure/DependencyInjection.cs`.

---

## Task 2: Backend Application Features & Controller (`Prism.Application` & `Prism.Api`)

**Files:**
- Create: `src/api/Prism.Application/Plugins/Models/PluginErrors.cs`
- Create: `src/api/Prism.Application/Plugins/Models/Dtos/PluginsStateDto.cs`
- Create: `src/api/Prism.Application/Plugins/Models/Dtos/PluginItemDto.cs`
- Create: `src/api/Prism.Application/Plugins/Models/Dtos/PluginBundleDto.cs`
- Create: `src/api/Prism.Application/Plugins/Repositories/IPluginRepository.cs`
- Create: `src/api/Prism.Application/Plugins/Repositories/PluginRepository.cs`
- Create: `src/api/Prism.Application/Plugins/Queries/IPluginQueries.cs`
- Create: `src/api/Prism.Application/Plugins/Queries/PluginQueries.cs`
- Create: `src/api/Prism.Application/Plugins/Features/GetPlugins/GetPlugins.cs`
- Create: `src/api/Prism.Application/Plugins/Features/GetPluginBundles/GetPluginBundles.cs`
- Create: `src/api/Prism.Application/Plugins/Features/SetPluginConsent/SetPluginConsent.cs`
- Create: `src/api/Prism.Application/Plugins/Features/InstallPlugin/InstallPlugin.cs`
- Create: `src/api/Prism.Application/Plugins/Features/InstallPlugin/InstallPluginValidator.cs`
- Create: `src/api/Prism.Application/Plugins/Features/UpdatePlugin/UpdatePlugin.cs`
- Create: `src/api/Prism.Application/Plugins/Features/SetPluginEnabled/SetPluginEnabled.cs`
- Create: `src/api/Prism.Application/Plugins/Features/RemovePlugin/RemovePlugin.cs`
- Create: `src/api/Prism.Api/Controllers/UserPluginsController.cs`
- Modify: `src/api/Prism.Application/DependencyInjection.cs`

- [ ] **Step 1: Create DTOs, `PluginErrors`, `PluginRepository`, and `PluginQueries`**
  - Map all error codes (`PLUGIN_CONSENT_REQUIRED`, `PLUGIN_NOT_FOUND`, `PLUGIN_ALREADY_INSTALLED`, `PLUGIN_SOURCE_INVALID`, `PLUGIN_MANIFEST_INVALID`, `PLUGIN_GIT_FAILED`, `PLUGIN_BUNDLE_UNAVAILABLE`).
  - Ensure revoking consent (`Accepted = false`) disables all installed plugins in the vault atomically.

- [ ] **Step 2: Create MediatR/Prism Mediator handlers and validators**
  - Override `ToString() => nameof(...)` on commands carrying URLs or paths (`InstallPluginCommand`, etc.).
  - Enforce `PLUGIN_CONSENT_REQUIRED` when attempting to install, update, or enable a plugin without consent.

- [ ] **Step 3: Create `UserPluginsController` and register DI**
  - Expose `GET /api/user/plugins`, `GET /api/user/plugins/bundles`, `PUT /api/user/plugins/consent`, `POST /api/user/plugins/install`, `POST /api/user/plugins/{id}/update`, `PUT /api/user/plugins/{id}/enabled`, `DELETE /api/user/plugins/{id}`.

---

## Task 3: Backend Unit & Integration Tests (`Prism.UnitTesting` & `Prism.IntegrationTesting`)

**Files:**
- Create: `src/api/tests/Prism.UnitTesting/Plugins/PluginSourceClientTests.cs`
- Create: `src/api/tests/Prism.IntegrationTesting/Api/PluginsTests.cs`

- [ ] **Step 1: Write unit tests for manifest & source validation**
  - Test valid local plugin, missing `manifest.json`, invalid plugin ID, path traversal in `main`, and Git cloning from a local bare/non-bare repo.
- [ ] **Step 2: Write integration tests for `api/user/plugins`**
  - Test consent flow, refusal without consent (`422 PLUGIN_CONSENT_REQUIRED`), installing local plugin, fetching active bundles, disabling/enabling, revoking consent disables active plugins, and removing plugin.
- [ ] **Step 3: Run `dotnet build` and `dotnet test`**
  - Verify 0 warnings and 100% passing tests.

---

## Task 4: Frontend Plugin SDK & Settings Section (`src/client`)

**Files:**
- Modify: `src/client/src/lib/api/prism-endpoints.ts`
- Create: `src/client/src/lib/plugins/plugins.schema.ts`
- Create: `src/client/src/lib/plugins/plugins.service.ts`
- Create: `src/client/src/lib/plugins/plugin-runtime.ts`
- Create: `src/client/src/lib/plugins/plugin-runtime.test.ts`
- Modify: `src/client/src/app/settings/_lib/sections.ts`
- Modify: `src/client/src/app/settings/_lib/settings.copy.ts`
- Create: `src/client/src/app/settings/_components/plugins-section.tsx`
- Modify: `src/client/src/app/settings/page.tsx`

- [ ] **Step 1: Add endpoints, schemas, and service functions**
  - Add `userPlugins`, `userPluginsBundles`, `userPluginsConsent`, `userPluginsInstall`, `userPlugin`, `userPluginEnabled`, `userPluginUpdate` to `prism-endpoints.ts`.
  - Create Zod schemas and TanStack Query options (`pluginsQuery`, `pluginBundlesQuery`).

- [ ] **Step 2: Implement `plugin-runtime.ts` (SDK & Enricher Registry)**
  - Execute active plugin `code` bundles with `new Function("prism", code)(sdk)`.
  - Provide `prism.db.query(sessionId, sql, params)` using `executeQuery` (`POST api/user/database-sessions/{id}/queries`) and transforming rows into key-value records + raw rows.
  - Provide `prism.ui.registerTableStructureEnricher(enricher)` and `runTableStructureEnrichers(context)` that merges `tableDescription`, `extraColumns`, and `columnDetails` across active plugins with error isolation.

- [ ] **Step 3: Build `PluginsSection` in Settings**
  - Add `"plugins"` to `SETTINGS_SECTIONS` in `sections.ts`.
  - Render Restricted Mode banner and explicit consent modal (Obsidian style disclaimer) when `consented === false`.
  - Render Git URL / Local Folder installation bar (with native directory picker button via `window.prism.pickDirectory` when sourceKind is `local`) and installed plugins list with toggle, update, and remove controls.

---

## Task 5: Frontend Table Structure Enrichment UI (`StructureView` & `StructureSections`)

**Files:**
- Create: `src/client/src/app/workbench/_lib/use-table-structure-enrichment.ts`
- Modify: `src/client/src/app/workbench/_components/table-tab/structure-sections.tsx`
- Modify: `src/client/src/app/workbench/_components/table-tab/structure-view.tsx`
- Create: `src/client/src/app/workbench/_components/table-tab/structure-enrichment.test.tsx`

- [ ] **Step 1: Create `useTableStructureEnrichment` hook**
  - Uses `pluginBundlesQuery` to load and activate enabled plugin bundles.
  - Runs registered enrichers for `{ connectionId, sessionId, engine, database, schema, table, columns }` cached under `["table-structure", connectionId, ...databaseMark(database), schema, table, "enrichment", bundleSignature]` so `refreshStructure` ("Atualizar") automatically refreshes plugin descriptions too.

- [ ] **Step 2: Update `StructureSections` and `StructureView`**
  - Show `enrichment.tableDescription` next to the table title in the header of `StructureView`.
  - Render any `enrichment.extraColumns` (e.g., `Formato`, `Descrição`) as extra `<th>`/`<td>` cells in `ColumnsTable`.
  - Support clicking a column row when `enrichment.columnDetails` has an entry for that column, displaying the side panel `Inf. do atributo (<colname>)` with the full description and metadata, matching the user's screenshot.

- [ ] **Step 3: Write Vitest tests for plugin runtime & table structure enrichment**
  - Verify enricher execution, extra columns rendering, table description header, and attribute details panel on column click.

---

## Task 6: Create the `SitDescriptions` Plugin (`c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions`)

**Files:**
- Create: `c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions\manifest.json`
- Create: `c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions\main.js`
- Create: `c:\Projetos\Automação Industrial\PrismPlugins\SitDescriptions\README.md`

- [ ] **Step 1: Write `manifest.json`**
  - `id: "sit-descriptions"`, `name: "SIT — Descrições de Tabelas e Atributos"`, `version: "1.0.0"`, `engines: ["informix"]`.

- [ ] **Step 2: Write `main.js`**
  - Derive `sissist` from `table.slice(0, 2).toUpperCase()`.
  - Query `systables` + `syscolumns` + `diadic` for `def_format` using the user's query.
  - Query `diadii` for the table description (`diccod = tabname`, `sissist = prefix` UNION ALL `sissist = ''`, `diiidioma = 'P'`) and column descriptions (`diccod` for the table's columns, prioritizing `sissist = prefix` over `sissist = ''`).
  - Return `tableDescription`, `extraColumns` (`Formato` and `Descrição`), and `columnDetails` (formatted multi-line attribute info with type, length, format, and full description from `diadii`).

- [ ] **Step 3: Write `README.md`**
  - Document how to install via Git URL (HTTPS/SSH) or local path in Prism, and how the `diadic` / `diadii` lookup works.
