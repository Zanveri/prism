import { createElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GridEditing } from "../_lib/grid-editing";
import type { RowsState } from "../_lib/use-query-runner";

// As peças das abas do script (RN-SQL-020 e 021) que dependem dos ganchos do React, simulados (`createHookRuntime`), como o teste do botão de contar: o
// vitest não tem DOM. "Executar este comando", na aba guardada: o botão sai da página quando o comando executado troca os resultados do script, e o foco não
// pode cair no `body`, fora da aba (RN-SQL-006): a área o leva à grade nova; com um comando em andamento, o botão fica, diz por quê e não executa. A aba
// escolhida que vem à vista na faixa, e a marca da aba cujo script espera a pergunta de erro.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/app/settings/_lib/use-preferences", async () => {
  const { defaultPreferences } = await import("@/app/settings/_lib/preferences");
  return { usePreferences: () => ({ preferences: defaultPreferences, update: () => {} }) };
});

import { elementsOf } from "@/lib/testing/react-tree";

import { createScriptRun, finishRun, startEntry, withEntry, type ScriptRun } from "../_lib/script-run";
import { scriptRunCopy } from "../_lib/script-run.copy";
import type { QueryRunner } from "../_lib/use-query-runner";
import { EditBar } from "./edit-bar";
import { ResultGrid } from "./result-grid";
import { ResultPanel } from "./result-panel";
import { KeptResultNote, ScriptTabs, ScriptWaitingMark } from "./script-tabs";

const copy = scriptRunCopy.kept;
const noop = () => {};

const rows: RowsState = {
  status: "rows",
  id: 1,
  target: { sql: "select * from t", offset: 0 },
  columns: [{ name: "id", type: "int4", kind: "number" }],
  rows: [["1"], ["2"]],
  truncated: new Map(),
  hasMore: true,
  totalRows: null,
  elapsedMs: 42,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
};

/** Uma página de mentira: quem tem o foco, e o `body`, onde ele cai quando quem o tinha sai da página. */
function page() {
  const body = { tag: "body" };
  return { body, activeElement: body as unknown };
}

type ButtonProps = { ref: (button: unknown) => (() => void) | undefined; onClick: () => void; "aria-disabled"?: boolean; title?: string; children: unknown };

function button(props: { busy: boolean; onRunAlone: () => void; onFocusLost?: () => void }): ButtonProps {
  const tree = rt.render(() => KeptResultNote(props));
  return elementsOf(tree).find((element) => element.props.children === copy.runAlone)!.props as unknown as ButtonProps;
}

describe("Executar este comando, na aba guardada do script (RN-SQL-020)", () => {
  it("livre, executa; com um comando em andamento na aba, fica à vista, diz por quê e não executa", () => {
    const onRunAlone = vi.fn();

    const free = button({ busy: false, onRunAlone });
    expect(free["aria-disabled"]).toBeUndefined();
    expect(free.title).toBeUndefined();
    free.onClick();
    expect(onRunAlone).toHaveBeenCalledOnce();

    const busy = button({ busy: true, onRunAlone });
    // Não é `disabled`: o botão com o foco não o perde enquanto a aba está ocupada.
    expect(busy["aria-disabled"]).toBe(true);
    expect(busy.title).toBe(copy.runAloneBusy);
    busy.onClick();
    expect(onRunAlone).toHaveBeenCalledOnce();
  });

  it("o botão que sai da página COM o foco avisa (a limpeza da ref); sem o foco, não", () => {
    const onFocusLost = vi.fn();
    const props = button({ busy: false, onRunAlone: noop, onFocusLost });
    const doc = page();
    const element = { ownerDocument: doc };

    doc.activeElement = element;
    props.ref(element)?.();
    expect(onFocusLost).toHaveBeenCalledOnce();

    doc.activeElement = doc.body;
    props.ref(element)?.();
    expect(onFocusLost).toHaveBeenCalledOnce();
  });

  it("a área entrega à nota o resgate do foco, e, avisada, leva o foco à grade: ele não cai no body", () => {
    const doc = page();
    const grid = { focus: vi.fn(() => (doc.activeElement = grid)) };
    const area = { ownerDocument: doc, querySelector: vi.fn(() => grid), focus: vi.fn(() => (doc.activeElement = area)) };
    const props = { state: rows, connected: false, onLoadMore: noop, onCount: noop, onRerun: noop, kept: { busy: false, onRunAlone: noop } };

    const tree = rt.render(() => ResultPanel(props));
    const section = elementsOf(tree).find((element) => element.type === "section")!;
    (section.props.ref as { current: unknown }).current = area;
    const note = elementsOf(tree).find((element) => element.type === KeptResultNote) as ReactElement<{ busy: boolean; onFocusLost: () => void }> | undefined;
    expect(note?.props.busy).toBe(false);

    note!.props.onFocusLost();
    rt.render(() => ResultPanel({ ...props, kept: undefined }));

    expect(grid.focus).toHaveBeenCalledOnce();
    expect(area.focus).not.toHaveBeenCalled();
    rt.unmount();
  });
});

describe("a aba guardada do script se edita (seção 33, RN-SQL-023)", () => {
  it("a área entrega a edição à grade e mostra a faixa da edição sobre ela, a barra de edição embaixo (RN-EDIT-013) e, depois dela, a nota com “Executar este comando”", () => {
    const bar = { buttons: [], onAction: noop };
    const editing = { bar } as unknown as GridEditing;
    const banner = createElement("div", { "data-banner": true });

    const tree = rt.render(() => ResultPanel({ state: rows, connected: false, onLoadMore: noop, onCount: noop, onRerun: noop, kept: { busy: false, onRunAlone: noop }, editing, banner }));
    const found = elementsOf(tree);
    const at = (type: unknown) => found.findIndex((element) => element.type === type);

    expect(found.find((element) => element.type === ResultGrid)?.props.editing).toBe(editing);
    expect(found.some((element) => element.props["data-banner"] === true)).toBe(true);
    expect(found.find((element) => element.type === EditBar)?.props).toMatchObject({ buttons: bar.buttons, onAction: bar.onAction });
    expect(at(EditBar)).toBeGreaterThan(at(ResultGrid));
    expect(at(KeptResultNote)).toBeGreaterThan(at(EditBar));
    rt.unmount();
  });

  it("a nota diz que o que é do cursor fica no resultado do último comando, e não fala mais de menu nem de edição", () => {
    expect(copy.note).toBe("O cursor deste resultado fechou quando o comando seguinte rodou. Carregar mais, Contar total, o filtro e a atualização automática valem no resultado do último comando.");
  });
});

describe("a faixa das abas do script (RN-SQL-020)", () => {
  /** Um script de 12 comandos que devolveram linhas, todos com aba. */
  function twelve(): ScriptRun {
    let run = createScriptRun(1, Array.from({ length: 12 }, (_, index) => ({ sql: `select ${index + 1} as n${index + 1}`, offset: index * 30 })));
    for (let index = 0; index < 12; index++) run = withEntry(run, index, { status: "ok", rows: { read: 1, more: false, total: null }, kept: true });
    return { ...finishRun(run, "done"), results: Array.from({ length: 12 }, (_, entry) => ({ entry, rows })), live: 11 };
  }

  it("as setas levam o foco à aba escolhida, e não quando a troca espera a pergunta das alterações não salvas (RN-SQL-023)", () => {
    const chosen = { focus: vi.fn() };
    const choose = vi.fn((): boolean => true);
    const tree = rt.render(() => ScriptTabs({ run: twelve(), shown: 0, idPrefix: "t", panelId: "t-panel", onChoose: choose }));
    const list = elementsOf(tree).find((element) => element.props.role === "tablist")!;
    (list.props.ref as { current: unknown }).current = { querySelector: vi.fn(() => chosen) };
    const press = () => (list.props.onKeyDown as (event: unknown) => void)({ key: "ArrowRight", preventDefault: vi.fn() });

    press();
    expect(choose).toHaveBeenLastCalledWith(1);
    expect(chosen.focus).toHaveBeenCalledOnce();

    choose.mockReturnValue(false);
    press();
    expect(choose).toHaveBeenCalledTimes(2);
    expect(chosen.focus).toHaveBeenCalledOnce();
    rt.unmount();
  });

  it("a troca pelo teclado que esperou a pergunta leva o foco à aba escolhida quando a pergunta troca de aba; Cancelar, ou outra escolha no meio, não (RN-SQL-023)", () => {
    const chosen = { focus: vi.fn() };
    const choose = vi.fn((): boolean => false);
    const props = { run: twelve(), shown: 0 as number | "statistics", idPrefix: "t", panelId: "t-panel", onChoose: choose };
    const listOf = () => elementsOf(rt.render(() => ScriptTabs(props))).find((element) => element.props.role === "tablist")!;
    const list = listOf();
    const selector = vi.fn((selector: string) => (selector.startsWith("[data-script-tab=") ? chosen : null));
    (list.props.ref as { current: unknown }).current = { querySelector: selector };
    const press = (key: string) => (listOf().props.onKeyDown as (event: unknown) => void)({ key, preventDefault: vi.fn() });

    // "Descartar" (ou o "Salvar" que gravou): a aba troca para a escolhida, e o foco vai a ela.
    press("ArrowRight");
    expect(chosen.focus).not.toHaveBeenCalled();
    props.shown = 1;
    listOf();
    expect(selector).toHaveBeenLastCalledWith('[data-script-tab="1"]');
    expect(chosen.focus).toHaveBeenCalledOnce();

    // "Cancelar": a aba fica; a escolha seguinte, pelo clique, esquece a que esperava, e a troca para outra aba não leva o foco.
    press("ArrowRight");
    const statistics = elementsOf(rt.render(() => ScriptTabs(props))).find((element) => element.props["data-script-tab"] === "statistics")!;
    (statistics.props.onClick as () => void)();
    props.shown = 2;
    listOf();
    expect(chosen.focus).toHaveBeenCalledOnce();
    rt.unmount();
  });

  it("as abas dos resultados rolam, e as Estatísticas ficam fixas na ponta, fora da rolagem", () => {
    const tree = rt.render(() => ScriptTabs({ run: twelve(), shown: 11, idPrefix: "t", panelId: "t-panel", onChoose: noop }));
    const list = elementsOf(tree).find((element) => element.props.role === "tablist")!;
    const [scroller, statistics] = list.props.children as ReactElement<{ className?: string; children?: unknown; "data-script-tab"?: unknown }>[];

    expect(scroller.props.className).toContain("overflow-x-auto");
    expect((scroller.props.children as unknown[]).length).toBe(12);
    expect(statistics.props["data-script-tab"]).toBe("statistics");
    rt.unmount();
  });

  it("as abas têm 28 px contando a borda de 2 px, 8 px de cada lado e até 256 px de largura (RN-ABAS-009)", () => {
    const tree = rt.render(() => ScriptTabs({ run: twelve(), shown: 0, idPrefix: "t", panelId: "t-panel", onChoose: noop }));
    const tabs = elementsOf(tree).filter((element) => element.props.role === "tab");

    expect(tabs).toHaveLength(13);
    for (const tab of tabs) expect(String(tab.props.className).split(" ")).toEqual(expect.arrayContaining(["h-7", "px-2", "max-w-64", "border-b-2"]));
    rt.unmount();
  });

  it("a aba escolhida vem à vista: a do último comando, que vem à frente sozinha no fim, não fica fora da faixa", () => {
    const props = { run: twelve(), shown: 0 as number | "statistics", idPrefix: "t", panelId: "t-panel", onChoose: noop };
    const tree = rt.render(() => ScriptTabs(props));
    const scroller = elementsOf(tree).find((element) => typeof element.props.className === "string" && element.props.className.includes("overflow-x-auto"))!;
    // A faixa: 794 px à vista de 1.586; a aba 12 começa em 1.430.
    const strip = { clientWidth: 794, scrollWidth: 1_586, scrollLeft: 0, querySelector: vi.fn(() => ({ offsetLeft: 1_430, offsetWidth: 144 })) };
    (scroller.props.ref as { current: unknown }).current = strip;

    props.shown = 11;
    rt.render(() => ScriptTabs(props));

    expect(strip.querySelector).toHaveBeenCalledWith('[role="tab"][aria-selected="true"]');
    expect(strip.scrollLeft).toBe(1_586 - 794);
    rt.unmount();
  });
});

describe("a marca da aba cujo script espera a pergunta de erro (RN-SQL-021)", () => {
  const runnerWith = (script: ScriptRun | null) => ({ script: { subscribe: () => () => {}, getState: () => script, decide: noop } }) as unknown as QueryRunner;
  const paused = (): ScriptRun => ({ ...withEntry(createScriptRun(1, [{ sql: "select 1", offset: 0 }]), 0, { status: "error" }), phase: "paused", current: 0 });

  it("o ponto e, para o leitor de tela, o texto, só com o script parado na pergunta", () => {
    const marked = elementsOf(rt.render(() => ScriptWaitingMark({ runner: runnerWith(paused()) })));

    expect(marked.some((element) => element.props["data-script-waiting"] === true && element.props.title === scriptRunCopy.error.waiting)).toBe(true);
    // RN-ABAS-009: na faixa, o ponto tem 6 px.
    expect(marked.find((element) => element.props["data-script-waiting"] === true)?.props.className).toContain("size-1.5");
    expect(marked.some((element) => element.props.className === "sr-only" && element.props.children === scriptRunCopy.error.waiting)).toBe(true);

    for (const script of [null, startEntry(createScriptRun(1, [{ sql: "select 1", offset: 0 }]), 0), finishRun(paused(), "stopped")]) {
      expect(rt.render(() => ScriptWaitingMark({ runner: runnerWith(script) }))).toBeNull();
    }
    rt.unmount();
  });
});
