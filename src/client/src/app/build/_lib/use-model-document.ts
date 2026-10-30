import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  commit,
  emptyModel,
  type History,
  redo as redoHistory,
  startHistory,
  undo as undoHistory,
} from "@/app/build/_lib/build-model";
import {
  type BuildModel,
  type BuildModelDto,
  parseModelBody,
  serializeModel,
} from "@/app/build/_lib/build-model.schema";
import {
  buildModelsQuery,
  getBuildModel,
  updateBuildModel,
} from "@/app/build/_lib/build-models.service";
import {
  createSaveScheduler,
  type SaveState,
} from "@/app/build/_lib/model-save";

export function useModelDocument(initialDto: BuildModelDto | null): {
  name: string;
  history: {
    past: BuildModel[];
    present: BuildModel | null;
    future: BuildModel[];
  };
  state: SaveState;
  change(next: BuildModel): void;
  undo(): void;
  redo(): void;
  saveNow(): void;
  reload(): void;
  keepMine(): void;
} {
  const queryClient = useQueryClient();
  const id = initialDto?.id ?? "";
  const initialUpdatedAt = initialDto?.updatedAt ?? "";

  const [docState, setDocState] = useState<{
    id: string;
    name: string;
    history: History | null;
    state: SaveState;
  }>(() => {
    const parsedInitial = initialDto
      ? (parseModelBody(initialDto.body) ?? emptyModel("postgresql", "public", false))
      : null;
    return {
      id,
      name: initialDto?.name ?? "modelo",
      history: parsedInitial ? startHistory(parsedInitial) : null,
      state: { status: "saved", savedAt: null, message: null },
    };
  });

  if (docState.id !== id) {
    const parsedInitial = initialDto
      ? (parseModelBody(initialDto.body) ?? emptyModel("postgresql", "public", false))
      : null;
    setDocState({
      id,
      name: initialDto?.name ?? "modelo",
      history: parsedInitial ? startHistory(parsedInitial) : null,
      state: { status: "saved", savedAt: null, message: null },
    });
  }

  const schedulerRef = useRef<ReturnType<typeof createSaveScheduler> | null>(
    null,
  );
  const namesByIdRef = useRef<Map<string, string>>(new Map());
  if (id) {
    namesByIdRef.current.set(id, initialDto?.name ?? docState.name);
  }
  const historyRef = useRef<History | null>(docState.history);
  historyRef.current = docState.history;

  const performSave = useEffectEvent(
    (docId: string, model: BuildModel, expectedUpdatedAt: string) =>
      updateBuildModel(docId, {
        name: namesByIdRef.current.get(docId) ?? "modelo",
        body: serializeModel(model),
        expectedUpdatedAt,
      }),
  );

  const handleSaved = useEffectEvent((dto: BuildModelDto) => {
    namesByIdRef.current.set(dto.id, dto.name);
    setDocState((prev) =>
      prev.id === dto.id ? { ...prev, name: dto.name } : prev,
    );
    queryClient.setQueryData<readonly BuildModelDto[]>(
      buildModelsQuery.queryKey,
      (old) => (old ? old.map((m) => (m.id === dto.id ? dto : m)) : [dto]),
    );
  });

  const handleStateChange = useEffectEvent(
    (docId: string, nextState: SaveState) => {
      setDocState((prev) =>
        prev.id === docId ? { ...prev, state: nextState } : prev,
      );
    },
  );

  useEffect(() => {
    schedulerRef.current?.dispose();
    if (!id) {
      schedulerRef.current = null;
      return;
    }

    const scheduler = createSaveScheduler({
      id,
      initialUpdatedAt,
      now: () => Date.now(),
      setTimer: (ms, run) => {
        const handle = setTimeout(run, ms);
        return () => clearTimeout(handle);
      },
      save: (model, expectedUpdatedAt) =>
        performSave(id, model, expectedUpdatedAt),
      onSaved: handleSaved,
      onStateChange: (nextState) => handleStateChange(id, nextState),
    });
    schedulerRef.current = scheduler;

    return () => {
      scheduler.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initialUpdatedAt` é lido apenas na abertura do modelo; o agendador atualiza `expectedUpdatedAt` a cada gravação
  }, [id]);

  function applyModel(nextHistory: History) {
    historyRef.current = nextHistory;
    setDocState((prev) => ({ ...prev, history: nextHistory }));
    schedulerRef.current?.change(nextHistory.present);
  }

  return {
    name: docState.name,
    history: docState.history ?? { past: [], present: null, future: [] },
    state: docState.state,
    change(next: BuildModel) {
      const current = historyRef.current;
      if (!current) return;
      applyModel(commit(current, next));
    },
    undo() {
      const current = historyRef.current;
      if (!current) return;
      const next = undoHistory(current);
      if (next !== current) {
        applyModel(next);
      }
    },
    redo() {
      const current = historyRef.current;
      if (!current) return;
      const next = redoHistory(current);
      if (next !== current) {
        applyModel(next);
      }
    },
    saveNow() {
      void schedulerRef.current?.flush();
    },
    reload() {
      if (!id) return;
      void (async () => {
        const res = await getBuildModel(id);
        if (res.ok) {
          const freshModel =
            parseModelBody(res.data.body) ?? emptyModel("postgresql", "public", false);
          const freshHistory = startHistory(freshModel);
          setDocState((prev) => ({
            ...prev,
            name: res.data.name,
            history: freshHistory,
            state: { status: "saved", savedAt: Date.now(), message: null },
          }));
          schedulerRef.current?.setExpectedUpdatedAt(res.data.updatedAt);
          void queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey });
        }
      })();
    },
    keepMine() {
      const currentHistory = docState.history;
      if (!id || !currentHistory) return;
      void (async () => {
        const res = await getBuildModel(id);
        if (res.ok) {
          schedulerRef.current?.setExpectedUpdatedAt(res.data.updatedAt);
          schedulerRef.current?.change(currentHistory.present);
          void schedulerRef.current?.flush();
        }
      })();
    },
  };
}
