import type { BuildModel, BuildModelDto } from "@/app/build/_lib/build-model.schema";
import type { ApiResult } from "@/lib/api/prism-api";
import { workspaceFlushTimeoutMs } from "@/lib/api/workspace-sync";

export type SaveState = {
  status: "saved" | "pending" | "saving" | "failed" | "conflict";
  savedAt: number | null;
  message: string | null;
};

export const autosaveDelayMs = 1000;

const activeFlushes = new Map<string, () => Promise<void>>();
let autoIdCounter = 0;

export const buildModelSync = {
  register(id: string, flush: () => Promise<void>): () => void {
    activeFlushes.set(id, flush);
    return () => {
      if (activeFlushes.get(id) === flush) {
        activeFlushes.delete(id);
      }
    };
  },

  async flush(timeoutMs: number = workspaceFlushTimeoutMs): Promise<void> {
    const flushes = Array.from(activeFlushes.values());
    if (flushes.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(flushes.map((fn) => fn())),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  },
};

export function createSaveScheduler(deps: {
  id?: string;
  initialUpdatedAt?: string;
  save: (
    model: BuildModel,
    expectedUpdatedAt: string,
  ) => Promise<ApiResult<BuildModelDto>>;
  now: () => number;
  setTimer: (ms: number, run: () => void) => () => void;
  onSaved?: (dto: BuildModelDto) => void;
  onStateChange?: (state: SaveState) => void;
}): {
  change(model: BuildModel): void;
  flush(): Promise<void>;
  state(): SaveState;
  setExpectedUpdatedAt(updatedAt: string): void;
  dispose(): void;
} {
  const registrationId = deps.id ?? `build-save-${++autoIdCounter}`;
  let expectedUpdatedAt = deps.initialUpdatedAt ?? "";
  let pendingModel: BuildModel | null = null;
  let cancelTimer: (() => void) | null = null;
  let inFlight: Promise<void> | null = null;
  let currentState: SaveState = {
    status: "saved",
    savedAt: null,
    message: null,
  };

  function updateState(next: SaveState) {
    currentState = next;
    deps.onStateChange?.(next);
  }

  async function runSaveLoop(): Promise<void> {
    while (pendingModel !== null) {
      const modelToSave = pendingModel;
      pendingModel = null;

      updateState({
        status: "saving",
        savedAt: currentState.savedAt,
        message: null,
      });

      try {
        const result = await deps.save(modelToSave, expectedUpdatedAt);
        if (result.ok) {
          expectedUpdatedAt = result.data.updatedAt;
          deps.onSaved?.(result.data);
          if (pendingModel === null) {
            updateState({
              status: "saved",
              savedAt: deps.now(),
              message: null,
            });
          }
        } else {
          const isConflict =
            result.error.status === 409 ||
            result.error.code === "BUILD_MODEL_CONFLICT" ||
            result.error.code === "BUILD_MODEL_CHANGED";
          updateState({
            status: isConflict ? "conflict" : "failed",
            savedAt: currentState.savedAt,
            message: result.error.detail ?? result.error.title,
          });
          break;
        }
      } catch (err) {
        updateState({
          status: "failed",
          savedAt: currentState.savedAt,
          message: err instanceof Error ? err.message : "Falha ao salvar modelo.",
        });
        break;
      }
    }
  }

  function flush(): Promise<void> {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
    if (inFlight) {
      return inFlight;
    }
    if (pendingModel === null) {
      return Promise.resolve();
    }
    inFlight = runSaveLoop().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  const unregister = buildModelSync.register(registrationId, flush);

  function change(model: BuildModel): void {
    if (cancelTimer) {
      cancelTimer();
      cancelTimer = null;
    }
    pendingModel = model;
    updateState({
      status: "pending",
      savedAt: currentState.savedAt,
      message: null,
    });
    cancelTimer = deps.setTimer(autosaveDelayMs, () => {
      cancelTimer = null;
      void flush();
    });
  }

  return {
    change,
    flush,
    state: () => currentState,
    setExpectedUpdatedAt(updatedAt: string) {
      expectedUpdatedAt = updatedAt;
    },
    dispose() {
      if (cancelTimer) {
        cancelTimer();
        cancelTimer = null;
      }
      unregister();
    },
  };
}
