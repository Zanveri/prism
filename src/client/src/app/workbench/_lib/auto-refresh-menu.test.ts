import { describe, expect, it } from "vitest";

import type { AutoRefreshState } from "./auto-refresh";
import { autoRefreshGroups, autoRefreshMenuItem, intervalOf, isAutoRefreshAction, type AutoRefreshAction } from "./auto-refresh-menu";
import { autoRefreshCopy } from "./auto-refresh.copy";
import type { CellMenuItem } from "./cell-menu";

const copy = autoRefreshCopy;
const off: AutoRefreshState = { status: "off", stopped: null };
const on = (everyMs: number): AutoRefreshState => ({ status: "on", everyMs, lastAt: null, running: false, paused: null });
const itemsOf = (groups: ReturnType<typeof autoRefreshGroups>) => groups.map((group) => (Array.isArray(group) ? group : group.items));

describe("o submenu \"Atualizar automaticamente\" (RN-GRADE-014)", () => {
  it("os intervalos 1 s (o primeiro, seção 39), 5 s, 10 s, 30 s, 1 min e 5 min, o \"Personalizado…\" e, depois do separador, \"Desligar\"", () => {
    const [choices, last] = itemsOf(autoRefreshGroups(off));

    expect(choices.map((item) => item.label)).toEqual(["A cada 1 s", "A cada 5 s", "A cada 10 s", "A cada 30 s", "A cada 1 min", "A cada 5 min", copy.menu.custom]);
    expect(choices.map((item) => item.id)).toEqual(["autoRefresh:every:1000", "autoRefresh:every:5000", "autoRefresh:every:10000", "autoRefresh:every:30000", "autoRefresh:every:60000", "autoRefresh:every:300000", "autoRefresh:custom"]);
    expect(last).toEqual([{ id: "autoRefresh:off", label: copy.menu.off, disabled: true }]);
  });

  it("desligada, nenhum intervalo vem marcado, mas todos são escolhas de um grupo (`checked` falso); \"Desligar\" não se aplica", () => {
    const [choices, [stop]] = itemsOf(autoRefreshGroups(off));

    expect(choices.every((item) => item.checked === false && item.disabled === false)).toBe(true);
    expect(stop.disabled).toBe(true);
  });

  it("ligada, o intervalo em uso vem marcado, e \"Desligar\" vale", () => {
    const [choices, [stop]] = itemsOf(autoRefreshGroups(on(30_000)));

    expect(choices.filter((item) => item.checked).map((item) => item.id)).toEqual(["autoRefresh:every:30000"]);
    expect(stop.disabled).toBe(false);
  });

  it("com um intervalo que não é do menu, o \"Personalizado…\" vem marcado e diz qual", () => {
    const [choices] = itemsOf(autoRefreshGroups(on(45_000)));
    const custom = choices.at(-1) as CellMenuItem;

    expect(custom).toMatchObject({ id: "autoRefresh:custom", label: copy.menu.customChosen("45 s"), checked: true });
    expect(choices.filter((item) => item.checked)).toHaveLength(1);
  });

  it("o item do menu da célula: desligada e sem como ligar, desabilitado com o motivo embaixo; ligada, vale sempre (trocar o intervalo, desligar)", () => {
    expect(autoRefreshMenuItem(off, null)).toMatchObject({ id: "autoRefresh", label: copy.menu.label, disabled: false, submenu: { label: copy.menu.label } });
    expect(autoRefreshMenuItem(off, "writes")).toMatchObject({ disabled: true, hint: `Não se aplica: ${copy.reasons.writes}.` });
    expect(autoRefreshMenuItem(off, "busy")).toMatchObject({ disabled: true, hint: `Não se aplica: ${copy.reasons.busy}.` });
    expect(autoRefreshMenuItem(on(5_000), "busy")).toMatchObject({ disabled: false });
    expect(autoRefreshMenuItem(on(5_000), "busy").hint).toBeUndefined();
  });

  it("as ações: o intervalo sai da ação; as outras não têm intervalo", () => {
    const actions: AutoRefreshAction[] = ["autoRefresh:every:10000", "autoRefresh:custom", "autoRefresh:off"];

    expect(actions.map(intervalOf)).toEqual([10_000, null, null]);
    expect(intervalOf("autoRefresh:every:1000")).toBe(1_000);
    expect(intervalOf("autoRefresh:every:abc" as AutoRefreshAction)).toBeNull();
    expect(actions.every(isAutoRefreshAction)).toBe(true);
    expect(isAutoRefreshAction("refresh")).toBe(false);
    expect(isAutoRefreshAction("filter:clear")).toBe(false);
  });
});
