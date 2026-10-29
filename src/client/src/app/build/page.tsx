import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BuildFooter } from "@/app/build/_components/build-footer";
import { BuildSidebar } from "@/app/build/_components/build-sidebar";
import { ModelTabs, type OpenModelTab } from "@/app/build/_components/model-tabs";
import { ModelToolbar } from "@/app/build/_components/model-toolbar";
import { ModelsList, type SavedModelEntry } from "@/app/build/_components/models-list";
import { addTable, emptyModel, tableKey } from "@/app/build/_lib/build-model";
import {
  parseModelBody,
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
import { checkModel, type Problem } from "@/app/build/_lib/model-check";
import type { SaveState } from "@/app/build/_lib/model-save";
import { useModelDocument } from "@/app/build/_lib/use-model-document";
import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { TopBar } from "@/components/layout/top-bar";
import { WorkbenchIcon } from "@/components/ui";
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
  editorContent,
  diagramContent,
  ddlOverlay,
  dialogs,
  connectionName,
  connectionEnvironment,
  connectionEnvironmentColor,
  onToggleSidebar,
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
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      {topBar}

      <div className="flex flex-1 flex-wrap">
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
          <div className="flex min-w-0 flex-[999_1_720px] flex-col">
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
          <div className="flex min-w-0 flex-[999_1_720px] flex-col">
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
              <div className="flex flex-1 flex-wrap">
                <section
                  aria-label="Editor do modelo"
                  className="flex min-w-0 flex-[1_1_448px] flex-col border-r border-border bg-panel"
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
                  className="flex min-w-0 flex-[999_1_560px] flex-col bg-canvas"
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
export default function BuildPage() {
  const queryClient = useQueryClient();
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const userName = session.data?.userName ?? "";

  const modelsQuery = useQuery(buildModelsQuery);
  const connections = useQuery(connectionsQuery);

  const [tabsState, setTabsState] = useState<{ open: string[]; active: string | null }>(() =>
    readBuildTabs(userName),
  );
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(
    () => readBuildLayout(userName).sidebarHidden,
  );
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
  const [editorPane, setEditorPane] = useState<BuildEditorPane>("simple");

  useEffect(() => {
    if (userName !== "") {
      setTabsState(readBuildTabs(userName));
      setSidebarHidden(readBuildLayout(userName).sidebarHidden);
    }
  }, [userName]);

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

  useEffect(() => {
    if (doc.history.present && selectedTableKey === null && doc.history.present.tables.length > 0) {
      setSelectedTableKey(tableKey(doc.history.present.tables[0]));
    }
  }, [doc.history.present, selectedTableKey]);

  function updateTabs(next: { open: string[]; active: string | null }) {
    setTabsState(next);
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
    if (!doc.history.present) return;
    const { model: next, key } = addTable(doc.history.present);
    doc.change(next);
    setSelectedTableKey(key);
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

  const connMap = new Map(
    (connections.data?.connections ?? []).map((c) => [c.id, c]),
  );

  return (
    <BuildPageView
      userName={userName}
      sidebarHidden={sidebarHidden}
      savedModels={savedModels}
      openTabs={tabsState.open}
      activeModelId={tabsState.active}
      activeModel={doc.history.present}
      activeModelName={activeDto?.name ?? null}
      selectedTableKey={selectedTableKey}
      editorPane={editorPane}
      canUndo={doc.history.past.length > 0}
      canRedo={doc.history.future.length > 0}
      saveState={doc.state}
      connectionName={(id) => connMap.get(id)?.name ?? null}
      connectionEnvironment={(id) => connMap.get(id)?.environmentName ?? null}
      connectionEnvironmentColor={(id) => connMap.get(id)?.environmentColor ?? null}
      onToggleSidebar={toggleSidebar}
      onSelectTab={handleOpenModel}
      onCloseTab={handleCloseTab}
      onShowModelsList={() => updateTabs({ ...tabsState, active: null })}
      onSelectTable={setSelectedTableKey}
      onAddTable={handleAddTable}
      onChangePane={setEditorPane}
      onUndo={doc.undo}
      onRedo={doc.redo}
      onReloadConflict={() => void doc.reload()}
      onKeepMineConflict={() => void doc.keepMine()}
      onRenameModel={(id, newName) => renameMutation.mutate({ id, newName })}
      onDuplicateModel={(id) => duplicateMutation.mutate(id)}
      onDeleteModel={(id) => deleteMutation.mutate(id)}
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
  );
}
