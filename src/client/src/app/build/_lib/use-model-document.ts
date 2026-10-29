import { useEffect, useRef, useState } from "react";
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
  const parsedInitial = initialDto
    ? (parseModelBody(initialDto.body) ?? emptyModel("postgresql", "public", false))
    : null;

  const [name, setName] = useState<string>(initialDto?.name ?? "modelo");
  const [history, setHistory] = useState<History | null>(() =>
    parsedInitial ? startHistory(parsedInitial) : null,
  );
  const [state, setState] = useState<SaveState>({
    status: "saved",
    savedAt: null,
    message: null,
  });

  const nameRef = useRef(name);
  nameRef.current = name;
  const historyRef = useRef(history);
  historyRef.current = history;

  const schedulerRef = useRef<ReturnType<typeof createSaveScheduler> | null>(
    null,
  );

  useEffect(() => {
    schedulerRef.current?.dispose();
    if (!initialDto) {
      schedulerRef.current = null;
      setHistory(null);
      historyRef.current = null;
      setState({ status: "saved", savedAt: null, message: null });
      return;
    }

    const nextModel =
      parseModelBody(initialDto.body) ?? emptyModel("postgresql", "public", false);
    const nextHistory = startHistory(nextModel);
    setName(initialDto.name);
    nameRef.current = initialDto.name;
    setHistory(nextHistory);
    historyRef.current = nextHistory;
    setState({ status: "saved", savedAt: null, message: null });

    const scheduler = createSaveScheduler({
      id: initialDto.id,
      initialUpdatedAt: initialDto.updatedAt,
      now: () => Date.now(),
      setTimer: (ms, run) => {
        const handle = setTimeout(run, ms);
        return () => clearTimeout(handle);
      },
      save: (model, expectedUpdatedAt) =>
        updateBuildModel(initialDto.id, {
          name: nameRef.current,
          body: serializeModel(model),
          expectedUpdatedAt,
        }),
      onSaved: (dto) => {
        setName(dto.name);
        void queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey });
      },
      onStateChange: setState,
    });
    schedulerRef.current = scheduler;

    return () => {
      scheduler.dispose();
    };
  }, [initialDto?.id, queryClient]);

  function applyModel(nextHistory: History) {
    setHistory(nextHistory);
    historyRef.current = nextHistory;
    schedulerRef.current?.change(nextHistory.present);
  }

  return {
    name,
    history: history ?? { past: [], present: null, future: [] },
    state,
    change(next: BuildModel) {
      if (!historyRef.current) return;
      applyModel(commit(historyRef.current, next));
    },
    undo() {
      if (!historyRef.current) return;
      const next = undoHistory(historyRef.current);
      if (next !== historyRef.current) {
        applyModel(next);
      }
    },
    redo() {
      if (!historyRef.current) return;
      const next = redoHistory(historyRef.current);
      if (next !== historyRef.current) {
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
          setName(res.data.name);
          const freshModel =
            parseModelBody(res.data.body) ?? emptyModel("postgresql", "public", false);
          const freshHistory = startHistory(freshModel);
          setHistory(freshHistory);
          historyRef.current = freshHistory;
          schedulerRef.current?.setExpectedUpdatedAt(res.data.updatedAt);
          setState({ status: "saved", savedAt: Date.now(), message: null });
          void queryClient.invalidateQueries({ queryKey: buildModelsQuery.queryKey });
        }
      })();
    },
    keepMine() {
      if (!id || !historyRef.current) return;
      void (async () => {
        const res = await getBuildModel(id);
        if (res.ok && historyRef.current) {
          schedulerRef.current?.setExpectedUpdatedAt(res.data.updatedAt);
          schedulerRef.current?.change(historyRef.current.present);
          void schedulerRef.current?.flush();
        }
      })();
    },
  };
}
