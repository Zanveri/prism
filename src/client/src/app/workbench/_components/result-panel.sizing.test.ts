import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryColumn } from "../_lib/query.schema";
import type { RowsState, RunnerState } from "../_lib/use-query-runner";

// A área de resultado com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM). A mini-runtime não desce aos filhos:
// as propriedades do elemento `ResultGrid` são o que a grade receberia. O que se confere é quem GUARDA as larguras escolhidas (RN-GRADE-009): a grade é
// refeita a cada execução (`key` por execução), e a área de resultado, não.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks, useId: () => "id" }));
vi.mock("@/app/settings/_lib/use-preferences", async () => {
  const { defaultPreferences } = await import("@/app/settings/_lib/preferences");
  return { usePreferences: () => ({ preferences: defaultPreferences, update: () => {} }) };
});

import { elementsOf } from "@/lib/testing/react-tree";

import { forgetExcept, recall } from "../_lib/tab-memory";
import { ResultGrid } from "./result-grid";
import { ResultPanel } from "./result-panel";

type Props = ComponentProps<typeof ResultPanel>;
const noop = () => {};

const columns: QueryColumn[] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "name", type: "character varying(255)", kind: "text" },
];

function rowsState(over: Partial<RowsState> = {}): RowsState {
  return { status: "rows", id: 1, target: { sql: "select 1", offset: 0 }, columns, rows: [["1", "a"]], truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false, ...over };
}

/** O que a grade recebe da área de resultado desenhada com este estado (`undefined` sem grade na tela). */
function grid(state: RunnerState, over: Partial<Props> = {}) {
  const tree = rt.render(() => ResultPanel({ state, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop, ...over }));
  return elementsOf(tree).find((element) => element.type === ResultGrid)?.props as { widths: Readonly<Record<number, number>>; onResize: (index: number, width: number) => void } | undefined;
}

beforeEach(() => rt.unmount());
afterEach(() => forgetExcept(new Set()));

describe("a área de resultado guarda as larguras escolhidas das colunas (RN-GRADE-009)", () => {
  it("nenhuma de saída; arrastar uma coluna guarda a largura dela, e a grade a recebe", () => {
    expect(grid(rowsState())?.widths).toEqual({});

    grid(rowsState())?.onResize(1, 420);
    expect(grid(rowsState())?.widths).toEqual({ 1: 420 });
  });

  it("sobrevivem a executar de novo com as mesmas colunas, a carregar mais e ao comando que roda por cima das linhas", () => {
    grid(rowsState())?.onResize(1, 420);

    expect(grid(rowsState({ id: 2, rows: [["9", "z"]] }))?.widths).toEqual({ 1: 420 });
    expect(grid(rowsState({ id: 2, rows: [["9", "z"], ["10", "y"]], pages: 2 }))?.widths).toEqual({ 1: 420 });
    expect(grid({ status: "running", cancelling: false, previous: rowsState({ id: 2 }) })?.widths).toEqual({ 1: 420 });
  });

  it("um erro, um cancelamento ou o resultado descartado (o bloqueio) não as apagam: as linhas seguintes, com as mesmas colunas, voltam com elas", () => {
    grid(rowsState())?.onResize(0, 90);

    expect(grid({ status: "error", source: "database", title: "Erro do banco", message: "x", sqlState: "42601", errorAt: null })).toBeUndefined();
    expect(grid({ status: "cancelled" })).toBeUndefined();
    expect(grid({ status: "idle" })).toBeUndefined();
    expect(grid(rowsState({ id: 5 }))?.widths).toEqual({ 0: 90 });
  });

  it("outras colunas voltam ao padrão; e as primeiras, quando voltam depois disso, também", () => {
    grid(rowsState())?.onResize(1, 420);

    const other = rowsState({ id: 2, columns: [columns[0]], rows: [["1"]] });
    expect(grid(other)?.widths).toEqual({});
    expect(grid(rowsState({ id: 3 }))?.widths).toEqual({});
  });

  it("com o id da aba, ficam lembradas: a vista que desmonta e volta (trocar para a Estrutura e voltar aos Registros) as encontra", () => {
    grid(rowsState(), { tabId: "aba-1" })?.onResize(1, 420);
    grid(rowsState(), { tabId: "aba-1" });
    expect(recall("aba-1", "grid")?.widths).toEqual({ 1: 420 });

    rt.unmount();
    expect(grid(rowsState({ id: 7 }), { tabId: "aba-1" })?.widths).toEqual({ 1: 420 });
  });

  it("a aba fechada leva as dela (a memória da aba), e a de outra aba não aparece aqui", () => {
    grid(rowsState(), { tabId: "aba-1" })?.onResize(1, 420);
    grid(rowsState(), { tabId: "aba-1" });
    forgetExcept(new Set());
    rt.unmount();

    expect(grid(rowsState(), { tabId: "aba-1" })?.widths).toEqual({});
    rt.unmount();
    expect(grid(rowsState(), { tabId: "aba-2" })?.widths).toEqual({});
  });

  it("sem o id da aba (a aba de consulta, cuja área nunca desmonta com a aba aberta), ficam só na área", () => {
    grid(rowsState())?.onResize(1, 420);
    grid(rowsState());

    expect(recall("", "grid")).toBeUndefined();
    expect(grid(rowsState({ id: 2 }))?.widths).toEqual({ 1: 420 });
  });
});
