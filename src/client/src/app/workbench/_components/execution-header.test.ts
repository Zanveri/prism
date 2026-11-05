import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RN-VAR-029: o cabeçalho da aba de execução, com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM). O que se confere aqui é
// o pedido do navegador atendido uma vez, o diálogo cancelado que fecha a aba nascida dele, e o "Executar de novo" que lê o script de novo no cofre.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return {
    ...createHookRuntime(),
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    workbench: { updateExecution: vi.fn(), updateTab: vi.fn(), closeTab: vi.fn(), requestExecution: vi.fn(), openScriptTab: vi.fn() },
    getScript: vi.fn(),
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => ({ getQueryData: () => undefined }) }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => rt.workbench }));
vi.mock("../_lib/scripts.service", () => ({ getScript: rt.getScript }));

import { ExecutionHeader, type ExecutionActions } from "./execution-header";
import { executionTabCopy } from "../_lib/execution-tab.copy";
import type { QueryRunner } from "../_lib/use-query-runner";
import type { ExecutionTarget, QueryTab } from "../_lib/workbench-model";

const scriptId = "0199c3a0-0000-7000-8000-00000000000a";
const values = { x: { type: "number" as const, value: "7" } };

function mount(over: Partial<ExecutionTarget> = {}, tabOver: Partial<QueryTab> = {}) {
  const execution: ExecutionTarget = { scriptId, name: "Pedidos", generic: false, values: null, ranAt: null, pending: null, ...over };
  const actionsRef = { current: null as ExecutionActions | null };
  const runner = { script: { subscribe: () => () => {}, getState: () => null } } as unknown as QueryRunner;
  const props: ComponentProps<typeof ExecutionHeader> = {
    tab: { id: "t1", title: "Pedidos", connectionId: "c1", sessionId: null, sql: "let x: number\nselect @x;", execution, ...tabOver },
    execution,
    runner,
    place: null,
    busy: false,
    cancelling: false,
    onCancel: vi.fn(),
    onRun: vi.fn(),
    actionsRef,
    rerunShortcut: "Alt+X",
    valuesShortcut: "Shift+Alt+X",
  };
  const render = () => rt.render(() => ExecutionHeader(props));
  return { props, actionsRef, render, options: () => vi.mocked(props.onRun).mock.calls.at(-1)![2] };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => vi.clearAllMocks());
afterEach(() => rt.unmount());

describe("o cabeçalho da aba de execução (RN-VAR-029)", () => {
  it("atende o pedido do navegador uma vez, e o limpa; na aba nascida dele, cancelar o diálogo a fecha", () => {
    const view = mount({ pending: { values: null, fresh: true } });
    view.render();
    view.render();

    expect(view.props.onRun).toHaveBeenCalledOnce();
    expect(view.props.onRun).toHaveBeenCalledWith("let x: number\nselect @x;", null, expect.objectContaining({ dialog: false, offerNewTab: false }));
    expect(rt.workbench.updateExecution).toHaveBeenCalledWith("t1", { pending: null });
    view.options().onCancel?.();
    expect(rt.workbench.closeTab).toHaveBeenCalledWith("t1");
  });

  it("a aba sem conexão espera a escolha da faixa; o pedido numa aba que já existia oferece a aba nova, e cancelar não fecha", () => {
    const waiting = mount({ pending: { values: null, fresh: true } }, { connectionId: null });
    waiting.render();
    expect(waiting.props.onRun).not.toHaveBeenCalled();

    rt.unmount();
    const reused = mount({ pending: { values, fresh: false } });
    reused.render();
    expect(reused.options()).toMatchObject({ offerNewTab: true });
    expect(reused.options().onCancel).toBeUndefined();
  });

  it("a resposta grava os valores e a hora; \"Executar numa aba nova\" leva os valores a outra aba, no mesmo lugar", () => {
    const view = mount({ pending: { values: null, fresh: false } }, { database: "mes" });
    view.render();
    view.options().onAnswered(values);
    expect(rt.workbench.updateExecution).toHaveBeenLastCalledWith("t1", { values, ranAt: expect.any(Number) });

    view.options().onNewTab(values);
    expect(rt.workbench.requestExecution).toHaveBeenCalledWith({ id: scriptId, name: "Pedidos", sql: "let x: number\nselect @x;", generic: false }, { connectionId: "c1", database: "mes" }, values, true);
  });

  it("\"Executar de novo\" lê o script gravado agora e executa com os mesmos valores; o script excluído só avisa", async () => {
    const view = mount({ values });
    view.render();

    rt.getScript.mockResolvedValueOnce({ ok: true, data: { id: scriptId, sql: "let x: number\nselect @x, 1;" } });
    view.actionsRef.current!.rerun();
    await settle();
    expect(rt.workbench.updateTab).toHaveBeenCalledWith("t1", { sql: "let x: number\nselect @x, 1;" });
    expect(view.props.onRun).toHaveBeenCalledWith("let x: number\nselect @x, 1;", values, expect.objectContaining({ dialog: false }));

    rt.getScript.mockResolvedValueOnce({ ok: false, error: { code: "SCRIPT_NOT_FOUND", title: "Não encontrado" } });
    view.actionsRef.current!.rerun();
    await settle();
    expect(rt.toast.warning).toHaveBeenCalledWith(executionTabCopy.missing("Pedidos"));
    expect(view.props.onRun).toHaveBeenCalledOnce();
  });

  it("\"Mudar os valores…\" abre o diálogo com os valores da aba, sem ler o cofre", () => {
    const view = mount({ values });
    view.render();
    view.actionsRef.current!.change();
    expect(view.props.onRun).toHaveBeenCalledWith("let x: number\nselect @x;", values, expect.objectContaining({ dialog: true, offerNewTab: true }));
    expect(rt.getScript).not.toHaveBeenCalled();
  });
});
