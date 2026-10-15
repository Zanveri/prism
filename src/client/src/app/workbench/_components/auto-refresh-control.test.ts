import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TimerIcon } from "@/components/ui";
import { buttonLabeled, elementsOf, type Found } from "@/lib/testing/react-tree";

import type { AutoRefreshState } from "../_lib/auto-refresh";
import { autoRefreshCopy } from "../_lib/auto-refresh.copy";
import { AutoRefreshBar, AutoRefreshControl, AutoRefreshDialog, lastTime, onText } from "./auto-refresh-control";

const copy = autoRefreshCopy;
const noop = () => {};
const off: AutoRefreshState = { status: "off", stopped: null };
const on = (over: Partial<Extract<AutoRefreshState, { status: "on" }>> = {}): AutoRefreshState => ({ status: "on", everyMs: 10_000, lastAt: null, running: false, paused: null, ...over });
const at = new Date(2026, 9, 15, 14, 32, 5).getTime();

const bar = (props: Partial<Parameters<typeof AutoRefreshBar>[0]> = {}) => AutoRefreshBar({ state: off, blocker: null, onOpenMenu: noop, onOff: noop, ...props }) as ReactElement<Record<string, unknown>> | null;
const opener = (tree: ReactElement | null) => elementsOf(tree).find((element) => element.props["data-auto-refresh-opener"] !== undefined);
/** O clique de mouse no botão, com a caixa dele (o menu abre embaixo). */
const click = (element: Found | undefined, detail = 1) =>
  (element?.props.onClick as (event: unknown) => void)({ detail, currentTarget: { getBoundingClientRect: () => ({ left: 100, bottom: 40 }), parentElement: null } });

describe("a atualização automática na barra do resultado (RN-GRADE-014)", () => {
  it("desligada, com linhas na tela: o botão do relógio, com o nome e a dica, que abre os intervalos embaixo dele", () => {
    const onOpenMenu = vi.fn();
    const button = opener(bar({ onOpenMenu }));

    expect(button?.props).toMatchObject({ "aria-label": copy.bar.button, title: copy.bar.button, "aria-haspopup": "menu" });
    expect(button?.props["aria-disabled"]).toBeUndefined();
    click(button);
    click(button, 0);

    expect(onOpenMenu.mock.calls).toEqual([
      [{ x: 100, y: 42 }, false],
      [{ x: 100, y: 42 }, true],
    ]);
  });

  it("no rodapé dos Registros (`opensUp`), o menu abre a partir de logo acima do botão", () => {
    const onOpenMenu = vi.fn();
    const button = opener(bar({ onOpenMenu, opensUp: true }));

    (button?.props.onClick as (event: unknown) => void)({ detail: 1, currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 300, bottom: 328 }) } });

    expect(onOpenMenu).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 298 }, false);
  });

  it("desligada e sem como ligar: o botão fica, desabilitado por aria-disabled, com o motivo no nome e na dica, e o clique não abre nada", () => {
    const onOpenMenu = vi.fn();
    const button = opener(bar({ blocker: "writes", onOpenMenu }));

    expect(button?.props).toMatchObject({ "aria-disabled": true, "aria-label": copy.bar.unavailable(copy.reasons.writes), title: copy.bar.unavailable(copy.reasons.writes) });
    click(button);
    expect(onOpenMenu).not.toHaveBeenCalled();
  });

  it("o botão está sempre lá: depois de um DDL ou de um UPDATE (o comando que grava) e sem linhas na tela, desabilitado, com o motivo", () => {
    for (const blocker of ["writes", "noRows", "busy", "disconnected"] as const) {
      expect(opener(bar({ blocker }))?.props).toMatchObject({ "aria-disabled": true, "aria-label": copy.bar.unavailable(copy.reasons[blocker]) });
    }
  });

  it("com a nota de quando parou: a nota, e o botão depois dela", () => {
    const markup = renderToStaticMarkup(createElement(AutoRefreshBar, { state: { status: "off", stopped: "failed" }, blocker: "noRows", onOpenMenu: noop, onOff: noop }));

    expect(markup).toContain(copy.stopped.failed);
    expect(markup.indexOf(copy.stopped.failed)).toBeLessThan(markup.indexOf("data-auto-refresh-opener"));
    expect(markup).toContain(`aria-label="${copy.bar.unavailable(copy.reasons.noRows)}"`);
  });

  it("ligada: o intervalo e a hora da última atualização no mesmo botão, que troca o intervalo, e o X, que desliga e devolve o foco a ele", () => {
    const onOff = vi.fn();
    const focus = vi.fn();
    const tree = bar({ state: on({ lastAt: at }), onOff });
    const button = opener(tree);

    expect(tree?.props).toMatchObject({ role: "group", "aria-label": copy.bar.group });
    expect(button?.props).toMatchObject({ title: copy.bar.change });
    expect(button?.props["aria-label"]).toBeUndefined();
    expect(renderToStaticMarkup(createElement(AutoRefreshBar, { state: on({ lastAt: at }), blocker: "busy", onOpenMenu: noop, onOff: noop }))).toContain(`Atualiza a cada 10 s · última às ${lastTime(at)}`);

    const close = elementsOf(tree).find((element) => element.props["aria-label"] === copy.bar.off);
    (close?.props.onClick as (event: unknown) => void)({ currentTarget: { parentElement: { querySelector: () => ({ focus }) } } });
    expect(onOff).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("o X que sai da página COM o foco sem clique (ela parou sozinha: o erro, a sessão que caiu) passa o foco ao relógio; sem o foco, não mexe", () => {
    const xOf = (tree: ReactElement | null) => elementsOf(tree).find((element) => element.props["aria-label"] === copy.bar.off) as Found;
    const body = { tag: "body" };
    const page = { activeElement: body as unknown };
    const clock = { focus: vi.fn(() => (page.activeElement = clock)) };
    const button = { ownerDocument: page, parentElement: { querySelector: (selector: string) => (selector === "[data-auto-refresh-opener]" ? clock : null) } };
    const ref = xOf(bar({ state: on() })).props.ref as (element: unknown) => (() => void) | undefined;

    // A ref é a mesma a cada renderização: o React só a chama quando o X entra e quando sai (e não a cada atualização, com o X focado).
    expect(xOf(bar({ state: on({ lastAt: at, running: true }) })).props.ref).toBe(ref);

    page.activeElement = button;
    ref(button)?.();
    expect(clock.focus).toHaveBeenCalledOnce();
    expect(page.activeElement).toBe(clock);

    page.activeElement = body;
    ref(button)?.();
    expect(clock.focus).toHaveBeenCalledOnce();
    expect(ref(null)).toBeUndefined();
  });

  it("o botão do relógio é o mesmo elemento, no mesmo lugar, ligada ou não: escolher um intervalo não tira o foco da aba", () => {
    const place = (tree: ReactElement<Record<string, unknown>> | null) => (tree?.props.children as unknown[]).findIndex((child) => child !== null && (child as Found).props?.["data-auto-refresh-opener"] !== undefined);
    const offTree = bar();
    const onTree = bar({ state: on() });

    expect(offTree?.type).toBe(onTree?.type);
    expect(place(offTree)).toBe(place(onTree));
    expect(opener(offTree)?.type).toBe("button");
    expect(opener(onTree)?.type).toBe("button");
    expect(elementsOf(onTree).some((element) => element.type === TimerIcon)).toBe(true);
  });

  it("onText: o intervalo, e depois a execução em andamento, a pausa da edição ou a hora da última; sem nenhuma, só o intervalo", () => {
    expect(onText(on() as Extract<AutoRefreshState, { status: "on" }>)).toBe("Atualiza a cada 10 s");
    expect(onText(on({ lastAt: at }) as Extract<AutoRefreshState, { status: "on" }>)).toBe(`Atualiza a cada 10 s · última às ${lastTime(at)}`);
    expect(onText(on({ lastAt: at, running: true }) as Extract<AutoRefreshState, { status: "on" }>)).toBe(`Atualiza a cada 10 s · ${copy.bar.running}`);
    expect(onText(on({ everyMs: 60_000, paused: "editing" }) as Extract<AutoRefreshState, { status: "on" }>)).toBe(`Atualiza a cada 1 min · ${copy.bar.paused}`);
    // Fora de vista ninguém a vê: a barra segue com a hora da última.
    expect(onText(on({ lastAt: at, paused: "hidden" }) as Extract<AutoRefreshState, { status: "on" }>)).toBe(`Atualiza a cada 10 s · última às ${lastTime(at)}`);
    expect(lastTime(at)).toBe("14:32:05");
  });

  it("o controle completo nasce sem o menu aberto", () => {
    const markup = renderToStaticMarkup(createElement(AutoRefreshControl, { state: off, blocker: null, onChoose: noop }));

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('role="menu"');
  });
});

describe("o \"Personalizado…\" (RN-GRADE-014)", () => {
  const dialog = (over: Partial<Parameters<typeof AutoRefreshDialog>[0]> = {}) => AutoRefreshDialog({ everyMs: null, error: null, onSubmit: noop, onCancel: noop, ...over });

  it("o campo dos segundos nasce vazio desligada e com o intervalo em uso ligada, e mostra a recusa", () => {
    const field = (tree: ReturnType<typeof dialog>) => elementsOf(tree).find((element) => element.props.name === "seconds");

    expect(field(dialog())?.props).toMatchObject({ defaultValue: "", label: copy.dialog.seconds, inputMode: "numeric", autoFocus: true });
    expect(field(dialog({ everyMs: 45_000, error: copy.dialog.invalid }))?.props).toMatchObject({ defaultValue: "45", error: copy.dialog.invalid });
  });

  it("enviar entrega o texto digitado, como está (quem confere é quem chama); cancelar fecha", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const tree = dialog({ onSubmit, onCancel });
    const form = elementsOf(tree).find((element) => element.type === "form");
    const preventDefault = vi.fn();

    (form?.props.onSubmit as (event: unknown) => void)({ preventDefault, currentTarget: { elements: { namedItem: () => ({ value: " 45 " }) } } });
    (buttonLabeled(tree, copy.dialog.cancel)?.props.onClick as () => void)();

    expect(preventDefault).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(" 45 ");
    expect(onCancel).toHaveBeenCalledOnce();
    expect((tree as ReactElement<Record<string, unknown>>).props).toMatchObject({ title: copy.dialog.title, description: copy.dialog.description });
  });
});
