import { describe, expect, it, vi } from "vitest";
import { emptyModel } from "@/app/build/_lib/build-model";
import type { BuildModelDto } from "@/app/build/_lib/build-model.schema";
import {
  autosaveDelayMs,
  buildModelSync,
  createSaveScheduler,
} from "@/app/build/_lib/model-save";
import type { ApiResult } from "@/lib/api/prism-api";

function createFakeClock() {
  let current = 1000;
  const timers = new Set<{ due: number; run: () => void }>();

  return {
    now: () => current,
    setTimer: (ms: number, run: () => void) => {
      const entry = { due: current + ms, run };
      timers.add(entry);
      return () => {
        timers.delete(entry);
      };
    },
    advance: (ms: number) => {
      current += ms;
      for (const entry of [...timers]) {
        if (entry.due <= current) {
          timers.delete(entry);
          entry.run();
        }
      }
    },
  };
}

const edited = emptyModel("postgresql", "manutencao", true);
const okResult: ApiResult<BuildModelDto> = {
  ok: true,
  data: {
    id: "0199c3a0-0000-7000-8000-000000000001",
    name: "manutencao",
    body: JSON.stringify(edited),
    createdAt: "2026-10-29T14:30:00.0000000Z",
    updatedAt: "2026-10-29T14:35:00.0000000Z",
  },
};

describe("model-save", () => {
  it("agenda o salvamento para 1000 ms e outra mudança antes empurra o prazo", async () => {
    const clock = createFakeClock();
    const save = vi.fn().mockResolvedValue(okResult);
    const doc = createSaveScheduler({
      save,
      now: clock.now,
      setTimer: clock.setTimer,
    });

    doc.change(edited);
    expect(doc.state().status).toBe("pending");

    clock.advance(600);
    expect(save).not.toHaveBeenCalled();

    doc.change(edited);
    clock.advance(600);
    expect(save).not.toHaveBeenCalled();

    clock.advance(autosaveDelayMs - 600);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(doc.state().status).toBe("saved");
  });

  it("409 vira status conflict", async () => {
    const clock = createFakeClock();
    const conflictResult: ApiResult<BuildModelDto> = {
      ok: false,
      error: {
        code: "BUILD_MODEL_CONFLICT",
        title: "Conflito",
        detail: "Este modelo mudou em outra janela.",
        status: 409,
        errors: null,
        extensions: {},
      },
    };
    const save = vi.fn().mockResolvedValue(conflictResult);
    const doc = createSaveScheduler({
      save,
      now: clock.now,
      setTimer: clock.setTimer,
    });

    doc.change(edited);
    await doc.flush();

    expect(doc.state().status).toBe("conflict");
    expect(doc.state().message).toContain("outra janela");
  });

  it("o salvamento pendente é gravado antes de o cofre fechar", async () => {
    const clock = createFakeClock();
    const save = vi.fn().mockResolvedValue(okResult);
    const doc = createSaveScheduler({
      save,
      now: clock.now,
      setTimer: clock.setTimer,
    });
    doc.change(edited);
    clock.advance(300);
    await buildModelSync.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
