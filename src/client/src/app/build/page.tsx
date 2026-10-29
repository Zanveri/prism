import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BaseMenu } from "@/app/build/_components/base-menu";
import { BuildDiagram } from "@/app/build/_components/build-diagram";
import { BuildFooter } from "@/app/build/_components/build-footer";
import { BuildSidebar } from "@/app/build/_components/build-sidebar";
import { ConnectionChoiceDialog } from "@/app/build/_components/connection-choice-dialog";
import { DdlView } from "@/app/build/_components/ddl-view";
import { ImportTablesDialog } from "@/app/build/_components/import-tables-dialog";
import { ModelTabs, type OpenModelTab } from "@/app/build/_components/model-tabs";
import { ModelToolbar } from "@/app/build/_components/model-toolbar";
import { ModelsList, type SavedModelEntry } from "@/app/build/_components/models-list";
import {
  NewModelDialog,
  type NewModelSubmitPayload,
} from "@/app/build/_components/new-model-dialog";
import { ScopeDialog } from "@/app/build/_components/scope-dialog";
import { SimpleEditor } from "@/app/build/_components/simple-editor";
import { TextPane } from "@/app/build/_components/text-pane";
import {
  fileNameOf,
  modelFromFile,
  needsScopeQuestion,
} from "@/app/build/_lib/build-files";
import { addTable, emptyModel, tableKey } from "@/app/build/_lib/build-model";
import {
  parseModelBody,
  serializeModelBody,
  type BuildModel,
} from "@/app/build/_lib/build-model.schema";
import {
  buildModelsQuery,
  createBuildModel,
  deleteBuildModel,
  updateBuildModel,
} from "@/app/build/_lib/build-models.service";
import {
  readBuildLayout,
  readBuildTabs,
  writeBuildLayout,
  writeBuildTabs,
} from "@/app/build/_lib/build-tabs";
import { buildCopy } from "@/app/build/_lib/build.copy";
import {
  addCatalogTables,
  modelFromCatalog,
  readCatalog,
  rereadModel,
  type CatalogSelection,
} from "@/app/build/_lib/catalog-import";
import { supportedConnections } from "@/app/build/_lib/catalog-tree";
import { writeDbml } from "@/app/build/_lib/dbml";
import { checkModel, type Problem } from "@/app/build/_lib/model-check";
import { modelDiagram } from "@/app/build/_lib/model-layout";
import type { SaveState } from "@/app/build/_lib/model-save";
import { writeModelSql } from "@/app/build/_lib/sql-model";
import { useModelDocument } from "@/app/build/_lib/use-model-document";
import { workbenchTarget } from "@/app/build/_lib/workbench-target";
import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import {
  closeDatabaseSession,
  getDatabases,
  getObjectNames,
  openDatabaseSession,
} from "@/app/workbench/_lib/database-sessions.service";
import {
  exportDiagramPng,
  resolveDiagramStyle,
} from "@/app/workbench/_lib/diagram-export";
import { saveText } from "@/app/workbench/_lib/save-file";
import { useWorkbench } from "@/app/workbench/_lib/workbench-state";
import { TopBar } from "@/components/layout/top-bar";
import { WorkbenchIcon } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { cn } from "@/lib/utils/cn";

export type BuildEditorPane = "simple" | "sql" | "dbml";

export type BuildPageViewProps = {
  userName: string;
  sidebarHidden: boolean;
  savedModels: readonly SavedModelEntry[];
  openTabs: readonly string[];
  activeModelId: string | null;
  activeModel?: BuildModel | null;
  activeModelName?: string | null;
  selectedTableKey?: string | null;
  editorPane?: BuildEditorPane;
  canUndo?: boolean;
  canRedo?: boolean;
  saveState?: SaveState;
  problems?: readonly Problem[];
  topBar?: ReactNode;
  baseMenuSlot?: ReactNode;
  editorContent?: ReactNode;
  diagramContent?: ReactNode;
  ddlOverlay?: ReactNode;
  dialogs?: ReactNode;
  connectionName: (id: string) => string | null;
  connectionEnvironment?: (id: string) => string | null;
  connectionEnvironmentColor?: (id: string) => string | null;
  onToggleSidebar?: () => void;
  onSelectTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onNewModel?: () => void;
  onOpenFile?: () => void;
  onShowModelsList?: () => void;
  onSelectTable?: (tableKey: string) => void;
  onAddTable?: () => void;
  onImportTables?: () => void;
  onChangePane?: (pane: BuildEditorPane) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onReread?: () => void;
  onChangeBase?: () => void;
  onReloadConflict?: () => void;
  onKeepMineConflict?: () => void;
  onExport?: (kind: "dbml" | "sql" | "png") => void;
  onGenerateDdl?: () => void;
  onRenameModel?: (id: string, newName: string) => void;
  onDuplicateModel?: (id: string) => void;
  onExportModel?: (id: string, kind: "dbml" | "sql" | "png") => void;
  onDeleteModel?: (id: string) => void;
};

export function BuildPageView({
  userName,
  sidebarHidden,
  savedModels,
  openTabs,
  activeModelId,
  activeModel: activeModelProp,
  activeModelName: activeModelNameProp,
  selectedTableKey = null,
  editorPane = "simple",
  canUndo = false,
  canRedo = false,
  saveState,
  problems: problemsProp,
  topBar,
  baseMenuSlot,
  editorContent,
  diagramContent,
  ddlOverlay,
  dialogs,
  connectionName,
  connectionEnvironment,
  connectionEnvironmentColor,
  onSelectTab,
  onCloseTab,
  onNewModel,
  onOpenFile,
  onShowModelsList,
  onSelectTable,
  onAddTable,
  onImportTables,
  onChangePane,
  onUndo,
  onRedo,
  onReread,
  onChangeBase,
  onReloadConflict,
  onKeepMineConflict,
  onExport,
  onGenerateDdl,
  onRenameModel,
  onDuplicateModel,
  onExportModel,
  onDeleteModel,
}: BuildPageViewProps) {
  const activeEntry =
    activeModelId !== null
      ? (savedModels.find((m) => m.id === activeModelId) ?? null)
      : null;
  const activeModel =
    activeModelProp !== undefined ? activeModelProp : (activeEntry?.model ?? null);
  const activeModelName =
    activeModelNameProp !== undefined ? activeModelNameProp : (activeEntry?.name ?? null);

  const baseConnId = activeModel?.base?.connectionId ?? null;
  const baseConnName = baseConnId ? connectionName(baseConnId) : null;
  const baseLabel =
    activeModel?.base !== null && activeModel?.base !== undefined
      ? `${baseConnName ?? activeModel.base.connectionId} / ${activeModel.base.database}`
      : null;

  const problems =
    problemsProp ??
    (activeModel
      ? checkModel(activeModel, {
          scope: activeModel.ddl.scope ?? "changes",
          baseLabel,
          baseEnvironment: baseConnId ? (connectionEnvironment?.(baseConnId) ?? null) : null,
          notes: [],
        })
      : []);

  const tabItems: OpenModelTab[] = openTabs
    .map((id) => savedModels.find((m) => m.id === id))
    .filter((entry): entry is SavedModelEntry => entry !== undefined)
    .map((entry) => {
      const entryConnId = entry.model.base?.connectionId ?? null;
      return {
        id: entry.id,
        name: entry.name,
        environmentName: entryConnId ? (connectionEnvironment?.(entryConnId) ?? null) : null,
        environmentColor: entryConnId
          ? (connectionEnvironmentColor?.(entryConnId) ?? null)
          : null,
      };
    });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-sm text-ink">
      {topBar}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!sidebarHidden && (
          <BuildSidebar
            model={activeModel}
            selectedTableKey={selectedTableKey}
            problems={problems}
            onSelectTable={onSelectTable}
            onAddTable={onAddTable}
            onImportTables={onImportTables}
            onOpenDdlView={onGenerateDdl}
          />
        )}

        {activeModel === null ? (
          <div className="flex min-h-0 min-w-0 flex-[999_1_720px] flex-col overflow-y-auto">
            {tabItems.length > 0 && (
              <ModelTabs
                tabs={tabItems}
                activeModelId={null}
                onSelectTab={(id) => onSelectTab?.(id)}
                onCloseTab={(id) => onCloseTab?.(id)}
                onNewModel={() => onNewModel?.()}
                onShowModelsList={() => onShowModelsList?.()}
              />
            )}
            <ModelsList
              models={savedModels}
              connectionName={connectionName}
              onOpenModel={onSelectTab}
              onNewModel={onNewModel}
              onOpenFile={onOpenFile}
              onRenameModel={onRenameModel}
              onDuplicateModel={onDuplicateModel}
              onExportModel={onExportModel}
              onDeleteModel={onDeleteModel}
            />
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-[999_1_720px] flex-col overflow-hidden">
            <ModelTabs
              tabs={tabItems}
              activeModelId={activeModelId}
              onSelectTab={(id) => onSelectTab?.(id)}
              onCloseTab={(id) => onCloseTab?.(id)}
              onNewModel={() => onNewModel?.()}
              onShowModelsList={() => onShowModelsList?.()}
            />

            <ModelToolbar
              model={activeModel}
              baseLabel={baseLabel}
              baseEnvironmentName={
                baseConnId ? (connectionEnvironment?.(baseConnId) ?? null) : null
              }
              baseEnvironmentColor={
                baseConnId ? (connectionEnvironmentColor?.(baseConnId) ?? null) : null
              }
              baseMenuSlot={baseMenuSlot}
              canUndo={canUndo}
              canRedo={canRedo}
              saveState={saveState}
              onUndo={onUndo}
              onRedo={onRedo}
              onReread={onReread}
              onChangeBase={onChangeBase}
              onReloadConflict={onReloadConflict}
              onKeepMineConflict={onKeepMineConflict}
              onExport={onExport}
              onGenerateDdl={onGenerateDdl}
            />

            {ddlOverlay ?? (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <section
                  aria-label="Editor do modelo"
                  className="flex min-h-0 min-w-0 flex-[1_1_448px] flex-col overflow-hidden border-r border-border bg-panel"
                >
                  <div
                    role="group"
                    aria-label={buildCopy.editorGroupLabel}
                    className="flex items-center gap-1 border-b border-border px-3"
                  >
                    {(
                      [
                        ["simple", buildCopy.paneSimple],
                        ["sql", buildCopy.paneSql],
                        ["dbml", buildCopy.paneDbml],
                      ] as const
                    ).map(([paneKey, label]) => {
                      const active = editorPane === paneKey;
                      return (
                        <button
                          key={paneKey}
                          type="button"
                          aria-pressed={active}
                          onClick={() => onChangePane?.(paneKey)}
                          className={cn(
                            "h-9 cursor-pointer border-0 border-b-2 bg-transparent px-2.5",
                            active
                              ? "border-accent font-semibold text-ink"
                              : "border-transparent font-normal text-muted hover:text-ink",
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                    <span className="ml-auto text-xs text-subtle">
                      {buildCopy.paneSameModelHint}
                    </span>
                  </div>

                  {editorContent}
                </section>

                <section
                  aria-label="Diagrama do modelo"
                  className="flex min-h-0 min-w-0 flex-[999_1_560px] flex-col overflow-hidden bg-background"
                >
                  {diagramContent}
                </section>
              </div>
            )}
          </div>
        )}
      </div>

      <BuildFooter
        userName={userName}
        savedModelsCount={savedModels.length}
        model={activeModel}
        modelName={activeModelName}
        connectionName={connectionName}
        problems={problems}
        onOpenDdlView={onGenerateDdl}
      />

      {dialogs}
    </div>
  );
}

/** Página do modo Construir (RN-CONSTRUIR-001). */
export function BuildPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openQueryTab } = useWorkbench();
  const { preferences } = usePreferences();
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const userName = session.data?.userName ?? "";

  const modelsQuery = useQuery(buildModelsQuery);
  const connections = useQuery(connectionsQuery);

  const [loadedUser, setLoadedUser] = useState(userName);
  const [tabsState, setTabsState] = useState<{ open: string[]; active: string | null }>(() =>
    readBuildTabs(userName),
  );
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(
    () => readBuildLayout(userName).sidebarHidden,
  );
  if (loadedUser !== userName) {
    setLoadedUser(userName);
    if (userName !== "") {
      setTabsState(readBuildTabs(userName));
      setSidebarHidden(readBuildLayout(userName).sidebarHidden);
    }
  }
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
  const [editorPane, setEditorPane] = useState<BuildEditorPane>("simple");
  const [ddlViewOpen, setDdlViewOpen] = useState(false);
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
  const [newModelOpen, setNewModelOpen] = useState(false);
  const [importTablesOpen, setImportTablesOpen] = useState(false);
  const [pendingWorkbenchSql, setPendingWorkbenchSql] = useState<string | null>(null);
  const [rereadNotes, setRereadNotes] = useState<{ code: "W8" | "W13"; message: string }[]>([]);
  const [catalogSchemas, setCatalogSchemas] = useState<
    { schema: string; tables: string[] }[]
  >([]);
  const [catalogDatabases, setCatalogDatabases] = useState<string[]>([]);
  const [selectedCatalogConnId, setSelectedCatalogConnId] = useState<string | null>(null);
  const [readingProgress, setReadingProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readingAbortRef = useRef<AbortController | null>(null);

  const savedModels: SavedModelEntry[] = (modelsQuery.data ?? []).map((dto) => {
    const parsed = parseModelBody(dto.body) ?? emptyModel("postgresql", "public", false);
    return {
      id: dto.id,
      name: dto.name,
      engine: parsed.engine,
      model: parsed,
      updatedAt: dto.updatedAt,
    };
  });

  const activeDto =
    tabsState.active !== null
      ? ((modelsQuery.data ?? []).find((m) => m.id === tabsState.active) ?? null)
      : null;

  const doc = useModelDocument(activeDto);
  const activeModel = doc.history.present;
  const activeModelName = activeDto?.name ?? "modelo";

  const connectionsList = connections.data ?? [];
  const connMap = new Map(connectionsList.map((c) => [c.id, c]));

  const baseConnId = activeModel?.base?.connectionId ?? null;
  const baseConn = baseConnId ? (connMap.get(baseConnId) ?? null) : null;
  const baseLabel =
    activeModel?.base !== null && activeModel?.base !== undefined
      ? `${baseConn?.name ?? activeModel.base.connectionId} / ${activeModel.base.database ?? ""}`
      : null;

  const problems = activeModel
    ? checkModel(activeModel, {
        scope: activeModel.ddl.scope ?? "changes",
        baseLabel,
        baseEnvironment: baseConn?.environmentName ?? null,
        notes: rereadNotes,
      })
    : [];

  const effectiveSelectedTableKey =
    selectedTableKey ??
    (activeModel && activeModel.tables.length > 0 ? tableKey(activeModel.tables[0]) : null);

  function updateTabs(next: { open: string[]; active: string | null }) {
    setTabsState(next);
    setDdlViewOpen(false);
    if (userName !== "") writeBuildTabs(userName, next);
  }

  function toggleSidebar() {
    setSidebarHidden((prev) => {
      const next = !prev;
      if (userName !== "") writeBuildLayout(userName, { sidebarHidden: next });
      return next;
    });
  }

  function handleOpenModel(id: string) {
    const open = tabsState.open.includes(id) ? tabsState.open : [...tabsState.open, id];
    updateTabs({ open, active: id });
  }

  function handleCloseTab(id: string) {
    const open = tabsState.open.filter((t) => t !== id);
    const active =
      tabsState.active === id ? (open[open.length - 1] ?? null) : tabsState.active;
    updateTabs({ open, active });
  }

  function handleAddTable() {
    if (!activeModel) return;
    const { model: next, key } = addTable(activeModel);
    doc.change(next);
    setSelectedTableKey(key);
  }

  function handleGenerateDdl() {
    if (!activeModel) return;
    if (needsScopeQuestion(activeModel)) {
      setScopeDialogOpen(true);
    } else {
      setDdlViewOpen(true);
    }
  }

  function handleExportModelContent(
    model: BuildModel,
    modelName: string,
    kind: "dbml" | "sql" | "png",
  ) {
    if (kind === "dbml") {
      saveText(fileNameOf(modelName, "dbml"), writeDbml(model), "text/plain;charset=utf-8");
      return;
    }
    if (kind === "sql") {
      saveText(fileNameOf(modelName, "sql"), writeModelSql(model), "text/sql;charset=utf-8");
      return;
    }
    const modelProblems = checkModel(model, {
      scope: model.ddl.scope ?? "changes",
      baseLabel: null,
      baseEnvironment: null,
      notes: [],
    });
    const layout = modelDiagram(model, modelProblems);
    void exportDiagramPng(modelName, layout, resolveDiagramStyle(preferences));
  }

  function handleOpenInWorkbench(sql: string) {
    if (!activeModel) return;
    const target = workbenchTarget(activeModel);
    if (target.kind === "base") {
      openQueryTab(target.connectionId, sql, target.database ?? undefined);
      void navigate(pathsConfig.workbench);
      return;
    }
    setPendingWorkbenchSql(sql);
  }

  async function loadCatalogPreview(connectionId: string, database?: string) {
    setSelectedCatalogConnId(connectionId);
    setCatalogError(null);
    const sessionRes = await openDatabaseSession(connectionId, database);
    if (!sessionRes.ok) {
      setCatalogError(sessionRes.error.detail ?? sessionRes.error.title);
      return;
    }
    const sessionId = sessionRes.data.id;
    try {
      const namesRes = await getObjectNames(sessionId);
      if (!namesRes.ok) {
        setCatalogError(namesRes.error.detail ?? namesRes.error.title);
        return;
      }
      setCatalogSchemas(
        namesRes.data.schemas
          .filter((s) => !s.isSystem)
          .map((s) => ({ schema: s.name, tables: [...s.tables] })),
      );
      if (database === undefined) {
        const dbsRes = await getDatabases(sessionId);
        if (dbsRes.ok && dbsRes.data.length > 0) {
          setCatalogDatabases(dbsRes.data.map((d) => d.name));
        }
      }
    } finally {
      await closeDatabaseSession(sessionId);
    }
  }

  async function handleNewModelSubmit(payload: NewModelSubmitPayload) {
    setCatalogError(null);
    if (payload.mode === "zero") {
      const initial = emptyModel(
        payload.engine,
        payload.defaultSchema,
        payload.createSchema,
      );
      const res = await createBuildModel({
        name: payload.name,
        body: serializeModelBody(initial),
      });
      if (!res.ok) {
        setCatalogError(res.error.detail ?? res.error.title);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey });
      setNewModelOpen(false);
      handleOpenModel(res.data.id);
      return;
    }

    const sessionRes = await openDatabaseSession(payload.connectionId, payload.database);
    if (!sessionRes.ok) {
      setCatalogError(sessionRes.error.detail ?? sessionRes.error.title);
      return;
    }
    const sessionId = sessionRes.data.id;
    const abort = new AbortController();
    readingAbortRef.current = abort;
    try {
      const { snapshot } = await readCatalog(sessionId, payload.selection, {
        signal: abort.signal,
        onProgress: (done, total) => setReadingProgress({ done, total }),
      });
      const built = modelFromCatalog({
        engine: payload.engine,
        defaultSchema: payload.defaultSchema,
        createSchema: payload.createSchema,
        base: { connectionId: payload.connectionId, database: payload.database },
        snapshot,
        readAt: "agora",
      });
      const res = await createBuildModel({
        name: payload.name,
        body: serializeModelBody(built),
      });
      if (!res.ok) {
        setCatalogError(res.error.detail ?? res.error.title);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey });
      setNewModelOpen(false);
      handleOpenModel(res.data.id);
    } finally {
      readingAbortRef.current = null;
      setReadingProgress(null);
      await closeDatabaseSession(sessionId);
    }
  }

  async function handleImportTablesSubmit(payload: {
    connectionId: string;
    database: string;
    selection: CatalogSelection;
  }) {
    if (!activeModel) return;
    setCatalogError(null);
    const sessionRes = await openDatabaseSession(payload.connectionId, payload.database);
    if (!sessionRes.ok) {
      setCatalogError(sessionRes.error.detail ?? sessionRes.error.title);
      return;
    }
    const sessionId = sessionRes.data.id;
    const abort = new AbortController();
    readingAbortRef.current = abort;
    try {
      const { snapshot } = await readCatalog(sessionId, payload.selection, {
        signal: abort.signal,
        onProgress: (done, total) => setReadingProgress({ done, total }),
      });
      const baseAttached: BuildModel =
        activeModel.base !== null
          ? activeModel
          : {
              ...activeModel,
              base: {
                connectionId: payload.connectionId,
                database: payload.database,
                readAt: "agora",
                knownSchemas: [...snapshot.schemas],
                knownTables: [...snapshot.knownTables],
              },
            };
      const updated = addCatalogTables(baseAttached, snapshot, "agora");
      doc.change(updated);
      setImportTablesOpen(false);
    } finally {
      readingAbortRef.current = null;
      setReadingProgress(null);
      await closeDatabaseSession(sessionId);
    }
  }

  async function handleReread(overrideBase?: {
    connectionId: string;
    database: string | null;
  }) {
    if (!activeModel) return;
    const targetBase = overrideBase ?? activeModel.base;
    if (!targetBase) return;

    const bySchema = new Map<string, string[]>();
    for (const table of activeModel.tables) {
      if (table.origin === null) continue;
      const list = bySchema.get(table.origin.schema) ?? [];
      if (!list.includes(table.origin.name)) list.push(table.origin.name);
      bySchema.set(table.origin.schema, list);
    }
    const selection: CatalogSelection = Array.from(bySchema.entries()).map(
      ([schema, tables]) => ({ schema, tables }),
    );

    const sessionRes = await openDatabaseSession(
      targetBase.connectionId,
      targetBase.database ?? undefined,
    );
    if (!sessionRes.ok) return;
    const sessionId = sessionRes.data.id;
    try {
      const { snapshot } = await readCatalog(sessionId, selection);
      const baseModel: BuildModel = overrideBase
        ? {
            ...activeModel,
            base: {
              connectionId: overrideBase.connectionId,
              database: overrideBase.database,
              readAt: "agora",
              knownSchemas: activeModel.base?.knownSchemas ?? [],
              knownTables: activeModel.base?.knownTables ?? [],
            },
          }
        : activeModel;
      const { model: nextModel, notes } = rereadModel(baseModel, snapshot, "agora");
      setRereadNotes(notes.map((message) => ({ code: "W8" as const, message })));
      doc.change(nextModel);
    } finally {
      await closeDatabaseSession(sessionId);
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text();
    const parsed = modelFromFile(file.name, text, "postgresql");
    if (!parsed.ok) return;
    const res = await createBuildModel({
      name: parsed.name,
      body: serializeModelBody(parsed.model),
    });
    if (!res.ok) return;
    await queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey });
    handleOpenModel(res.data.id);
  }

  const renameMutation = useMutation({
    mutationFn: async ({ id, newName }: { id: string; newName: string }) => {
      const entry = (modelsQuery.data ?? []).find((m) => m.id === id);
      if (!entry) return;
      await updateBuildModel(id, {
        name: newName,
        expectedUpdatedAt: entry.updatedAt,
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => {
      const entry = (modelsQuery.data ?? []).find((m) => m.id === id);
      if (!entry) return;
      await createBuildModel({
        name: `${entry.name}-copia`,
        body: entry.body,
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteBuildModel(id);
      return id;
    },
    onSuccess: (deletedId) => {
      handleCloseTab(deletedId);
      void queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey });
    },
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "F5" && activeModel) {
        e.preventDefault();
        handleGenerateDdl();
        return;
      }
      if (e.key === "Escape" && ddlViewOpen) {
        e.preventDefault();
        setDdlViewOpen(false);
        return;
      }
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "s") {
        e.preventDefault();
        void doc.saveNow();
        return;
      }
      if (e.altKey && key === "n") {
        e.preventDefault();
        handleAddTable();
        return;
      }
      const target = e.target as HTMLElement | null;
      const inTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable ||
        target?.closest(".cm-editor") !== null;
      if (!inTextInput && (e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) doc.redo();
        else doc.undo();
      } else if (!inTextInput && (e.ctrlKey || e.metaKey) && key === "y") {
        e.preventDefault();
        doc.redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const ddlContext = {
    modelName: activeModelName,
    prismVersion: "0.6.0",
    generatedAt: "hoje",
    baseLabel,
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".sql,.dbml"
        className="hidden"
        onChange={(e) => void handleFileSelected(e)}
      />
      <BuildPageView
        userName={userName}
        sidebarHidden={sidebarHidden}
        savedModels={savedModels}
        openTabs={tabsState.open}
        activeModelId={tabsState.active}
        activeModel={activeModel}
        activeModelName={activeDto?.name ?? null}
        selectedTableKey={effectiveSelectedTableKey}
        editorPane={editorPane}
        canUndo={doc.history.past.length > 0}
        canRedo={doc.history.future.length > 0}
        saveState={doc.state}
        problems={problems}
        connectionName={(id) => connMap.get(id)?.name ?? null}
        connectionEnvironment={(id) => connMap.get(id)?.environmentName ?? null}
        connectionEnvironmentColor={(id) => connMap.get(id)?.environmentColor ?? null}
        onToggleSidebar={toggleSidebar}
        onSelectTab={handleOpenModel}
        onCloseTab={handleCloseTab}
        onNewModel={() => {
          setCatalogError(null);
          setCatalogSchemas([]);
          setCatalogDatabases([]);
          setNewModelOpen(true);
          const firstConn = supportedConnections(connectionsList)[0];
          if (firstConn) {
            void loadCatalogPreview(firstConn.id);
          }
        }}
        onOpenFile={() => fileInputRef.current?.click()}
        onShowModelsList={() => updateTabs({ ...tabsState, active: null })}
        onSelectTable={setSelectedTableKey}
        onAddTable={handleAddTable}
        onImportTables={() => {
          setCatalogError(null);
          setCatalogSchemas([]);
          setCatalogDatabases([]);
          setImportTablesOpen(true);
          const firstConnId =
            activeModel?.base?.connectionId ??
            supportedConnections(connectionsList, activeModel?.engine)[0]?.id;
          const initialDb = activeModel?.base?.database ?? undefined;
          if (firstConnId) {
            void loadCatalogPreview(firstConnId, initialDb);
          }
        }}
        onChangePane={setEditorPane}
        onUndo={doc.undo}
        onRedo={doc.redo}
        onReread={() => void handleReread()}
        onReloadConflict={() => void doc.reload()}
        onKeepMineConflict={() => void doc.keepMine()}
        onExport={(kind) => {
          if (activeModel) {
            handleExportModelContent(activeModel, activeModelName, kind);
          }
        }}
        onGenerateDdl={handleGenerateDdl}
        onRenameModel={(id, newName) => renameMutation.mutate({ id, newName })}
        onDuplicateModel={(id) => duplicateMutation.mutate(id)}
        onExportModel={(id, kind) => {
          const found = savedModels.find((m) => m.id === id);
          if (found) handleExportModelContent(found.model, found.name, kind);
        }}
        onDeleteModel={(id) => deleteMutation.mutate(id)}
        baseMenuSlot={
          activeModel?.base ? (
            <BaseMenu
              model={activeModel}
              connections={connectionsList}
              baseLabel={baseLabel}
              baseEnvironmentName={baseConn?.environmentName ?? null}
              baseEnvironmentColor={baseConn?.environmentColor ?? null}
              onChangeBase={(target) => void handleReread(target)}
            />
          ) : null
        }
        editorContent={
          activeModel ? (
            editorPane === "simple" ? (
              <SimpleEditor
                model={activeModel}
                tableKey={effectiveSelectedTableKey}
                baseLabel={baseLabel}
                ddlContext={ddlContext}
                onChange={(next, nextKey) => {
                  doc.change(next);
                  if (nextKey !== undefined) setSelectedTableKey(nextKey);
                }}
              />
            ) : (
              <TextPane
                key={`${tabsState.active ?? "none"}-${editorPane}`}
                model={activeModel}
                format={editorPane}
                onChange={(next) => doc.change(next)}
              />
            )
          ) : null
        }
        diagramContent={
          activeModel ? (
            <BuildDiagram
              model={activeModel}
              problems={problems}
              selectedTableKey={effectiveSelectedTableKey}
              onSelectTable={setSelectedTableKey}
              onChange={doc.change}
            />
          ) : null
        }
        ddlOverlay={
          ddlViewOpen && activeModel ? (
            <DdlView
              model={activeModel}
              modelName={activeModelName}
              baseLabel={baseLabel}
              baseEnvironment={baseConn?.environmentName ?? null}
              notes={rereadNotes}
              onBackToDiagram={() => setDdlViewOpen(false)}
              onChangeModel={doc.change}
              onCopy={(sql) => {
                void navigator.clipboard?.writeText(sql);
              }}
              onSaveSql={(sql) =>
                saveText(
                  fileNameOf(activeModelName, "sql"),
                  sql,
                  "text/sql;charset=utf-8",
                )
              }
              onOpenInWorkbench={(sql) => handleOpenInWorkbench(sql)}
              onGoToColumn={(table) => {
                setSelectedTableKey(table);
                setDdlViewOpen(false);
                setEditorPane("simple");
              }}
              onReread={() => void handleReread()}
            />
          ) : undefined
        }
        dialogs={
          <>
            {newModelOpen && (
              <NewModelDialog
                connections={connectionsList}
                databases={catalogDatabases.length > 0 ? catalogDatabases : undefined}
                schemas={catalogSchemas}
                readingProgress={readingProgress}
                errorMessage={catalogError}
                onSelectConnection={(connId) => {
                  setCatalogDatabases([]);
                  setCatalogSchemas([]);
                  void loadCatalogPreview(connId);
                }}
                onSelectDatabase={(db) => {
                  const connId =
                    selectedCatalogConnId ??
                    supportedConnections(connectionsList)[0]?.id;
                  if (connId) {
                    setCatalogSchemas([]);
                    void loadCatalogPreview(connId, db);
                  }
                }}
                onCancel={() => setNewModelOpen(false)}
                onCancelReading={() => readingAbortRef.current?.abort()}
                onSubmit={(payload) => void handleNewModelSubmit(payload)}
              />
            )}
            {importTablesOpen && activeModel && (
              <ImportTablesDialog
                model={activeModel}
                connections={connectionsList}
                databases={catalogDatabases.length > 0 ? catalogDatabases : undefined}
                schemas={catalogSchemas}
                readingProgress={readingProgress}
                errorMessage={catalogError}
                onSelectConnection={(connId) => {
                  setCatalogDatabases([]);
                  setCatalogSchemas([]);
                  void loadCatalogPreview(connId);
                }}
                onSelectDatabase={(db) => {
                  const connId =
                    selectedCatalogConnId ??
                    activeModel.base?.connectionId ??
                    supportedConnections(connectionsList, activeModel.engine)[0]?.id;
                  if (connId) {
                    setCatalogSchemas([]);
                    void loadCatalogPreview(connId, db);
                  }
                }}
                onCancel={() => setImportTablesOpen(false)}
                onCancelReading={() => readingAbortRef.current?.abort()}
                onSubmit={(payload) => void handleImportTablesSubmit(payload)}
              />
            )}
            {scopeDialogOpen && activeModel && (
              <ScopeDialog
                model={activeModel}
                modelName={activeModelName}
                baseLabel={baseLabel ?? ""}
                onCancel={() => setScopeDialogOpen(false)}
                onConfirm={(scope) => {
                  doc.change({
                    ...activeModel,
                    ddl: { ...activeModel.ddl, scope },
                  });
                  setScopeDialogOpen(false);
                  setDdlViewOpen(true);
                }}
              />
            )}
            {pendingWorkbenchSql !== null && activeModel && (
              <ConnectionChoiceDialog
                engine={activeModel.engine}
                connections={connectionsList}
                baseConnectionId={activeModel.base?.connectionId ?? null}
                onCancel={() => setPendingWorkbenchSql(null)}
                onConfirm={(target) => {
                  openQueryTab(
                    target.connectionId,
                    pendingWorkbenchSql,
                    target.database ?? undefined,
                  );
                  setPendingWorkbenchSql(null);
                  void navigate(pathsConfig.workbench);
                }}
              />
            )}
          </>
        }
        topBar={
          <TopBar
            leading={
              <button
                type="button"
                aria-label={
                  sidebarHidden ? buildCopy.showSidebarLabel : buildCopy.hideSidebarLabel
                }
                aria-pressed={!sidebarHidden}
                onClick={toggleSidebar}
                className={cn(
                  "flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border-0",
                  !sidebarHidden
                    ? "bg-selected text-ink"
                    : "bg-transparent text-muted hover:bg-selected hover:text-ink",
                )}
              >
                <WorkbenchIcon />
              </button>
            }
          />
        }
      />
    </>
  );
}

export default BuildPage;
