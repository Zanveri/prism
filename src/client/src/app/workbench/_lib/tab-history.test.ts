import { describe, expect, it } from "vitest";

import { emptyHistory, keyHistoryAction, maxHistoryEntries, mouseHistoryAction, pruneHistory, recordTab, stepHistory, type TabHistory } from "./tab-history";

const record = (...tabIds: string[]): TabHistory => tabIds.reduce(recordTab, emptyHistory);
const open = (...tabIds: string[]) => new Set(tabIds);
const shape = (history: TabHistory) => `${history.entries.join("")}@${history.index}`;

describe("recordTab: uma entrada a cada vez que a aba ativa muda (RN-ABAS-018)", () => {
  it.each([
    { name: "a primeira aba", tabs: ["a"], expected: "a@0" },
    { name: "abas diferentes ficam na ordem", tabs: ["a", "b", "c"], expected: "abc@2" },
    { name: "a mesma aba duas vezes seguidas é uma entrada só", tabs: ["a", "a", "b", "b", "b"], expected: "ab@1" },
    { name: "voltar a uma aba que não é a anterior é outra entrada", tabs: ["a", "b", "a"], expected: "aba@2" },
  ])("$name", ({ tabs, expected }) => {
    expect(shape(record(...tabs))).toBe(expected);
  });

  it("devolve o mesmo objeto quando a aba já é a entrada de agora", () => {
    const history = record("a", "b");
    expect(recordTab(history, "b")).toBe(history);
  });

  it("guarda no máximo 50 entradas: sai a mais velha", () => {
    const ids = Array.from({ length: maxHistoryEntries + 5 }, (_, position) => `t${position}`);
    const history = record(...ids);

    expect(history.entries).toHaveLength(maxHistoryEntries);
    expect(history.entries[0]).toBe("t5");
    expect(history.entries[maxHistoryEntries - 1]).toBe(`t${maxHistoryEntries + 4}`);
    expect(history.index).toBe(maxHistoryEntries - 1);
  });

  it("ativar outra aba depois de voltar descarta as entradas à frente", () => {
    const back = stepHistory(record("a", "b", "c"), open("a", "b", "c"), -1).history;
    expect(shape(back)).toBe("abc@1");

    expect(shape(recordTab(back, "d"))).toBe("abd@2");
  });

  it("ativar a aba da entrada à frente também descarta o resto (é uma ativação nova, e não o Avançar)", () => {
    const all = open("a", "b", "c", "d");
    const back = stepHistory(stepHistory(record("a", "b", "c", "d"), all, -1).history, all, -1).history;
    expect(shape(back)).toBe("abcd@1");
    expect(shape(recordTab(back, "c"))).toBe("abc@2");
  });

  it("depois de voltar, a observação da aba que o Voltar ativou não muda nada", () => {
    const { history, tabId } = stepHistory(record("a", "b", "c"), open("a", "b", "c"), -1);
    expect(tabId).toBe("b");
    expect(recordTab(history, "b")).toBe(history);
  });
});

describe("pruneHistory: a aba que fechou ou foi para outra janela sai", () => {
  it.each([
    { name: "nada mudou", history: record("a", "b", "c"), now: ["a", "b", "c"], expected: "abc@2" },
    { name: "sai uma do meio", history: record("a", "b", "c"), now: ["a", "c"], expected: "ac@1" },
    { name: "as iguais que ficam lado a lado viram uma", history: record("a", "b", "a", "b"), now: ["a"], expected: "a@0" },
    { name: "a entrada de agora saiu: a de agora é a anterior que ficou", history: record("a", "b", "c"), now: ["a", "b"], expected: "ab@1" },
    { name: "a atual e as de trás saíram: antes da primeira", history: record("a", "b", "c"), now: [], expected: "@-1" },
    { name: "sai a primeira e a atual é a última", history: record("a", "b", "c"), now: ["b", "c"], expected: "bc@1" },
  ])("$name", ({ history, now, expected }) => {
    expect(shape(pruneHistory(history, open(...now)))).toBe(expected);
  });

  it("depois de voltar, as entradas à frente também são podadas, e a de agora continua sendo a de agora", () => {
    const back = stepHistory(record("a", "b", "c", "d"), open("a", "b", "c", "d"), -1).history;
    expect(shape(back)).toBe("abcd@2");
    expect(shape(pruneHistory(back, open("a", "c", "d")))).toBe("acd@1");
    expect(shape(pruneHistory(back, open("a", "b", "d")))).toBe("abd@1");
  });

  it("sem a entrada de agora nem as de trás, a seguinte observada vira a primeira", () => {
    const pruned = pruneHistory(record("a", "b", "c"), open("c"));
    expect(shape(pruned)).toBe("c@0");
  });

  it("devolve o mesmo objeto quando nada muda", () => {
    const history = record("a", "b");
    expect(pruneHistory(history, open("a", "b", "z"))).toBe(history);
    expect(pruneHistory(emptyHistory, open())).toBe(emptyHistory);
  });
});

describe("stepHistory: Voltar e Avançar", () => {
  const all = open("a", "b", "c");

  it("Voltar ativa a entrada anterior; Avançar, a seguinte", () => {
    const first = stepHistory(record("a", "b", "c"), all, -1);
    expect([first.tabId, shape(first.history)]).toEqual(["b", "abc@1"]);

    const second = stepHistory(first.history, all, -1);
    expect([second.tabId, shape(second.history)]).toEqual(["a", "abc@0"]);

    const forward = stepHistory(second.history, all, 1);
    expect([forward.tabId, shape(forward.history)]).toEqual(["b", "abc@1"]);
  });

  it("sem entrada para onde ir, nada acontece", () => {
    expect(stepHistory(record("a", "b", "c"), all, 1).tabId).toBeNull();
    expect(stepHistory(record("a"), all, -1).tabId).toBeNull();
    expect(stepHistory(emptyHistory, open(), -1).tabId).toBeNull();
    expect(stepHistory(emptyHistory, open(), 1).tabId).toBeNull();
  });

  it("a aba que fechou é pulada", () => {
    const { tabId, history } = stepHistory(record("a", "b", "c"), open("a", "c"), -1);
    expect(tabId).toBe("a");
    expect(shape(history)).toBe("ac@0");
  });

  it("as duplicadas que a poda junta não fazem o Voltar ficar na mesma aba", () => {
    const { tabId } = stepHistory(record("a", "b", "a"), open("a"), -1);
    expect(tabId).toBeNull();
  });

  it("não altera o histórico recebido", () => {
    const history = record("a", "b", "c");
    stepHistory(history, all, -1);
    expect(shape(history)).toBe("abc@2");
  });
});

describe("mouseHistoryAction: os botões do mouse", () => {
  it.each([
    [0, null],
    [1, null],
    [2, null],
    [3, "back"],
    [4, "forward"],
    [5, null],
    [-1, null],
  ])("o botão %s", (button, expected) => {
    expect(mouseHistoryAction(button)).toBe(expected);
  });
});

describe("keyHistoryAction: as teclas", () => {
  const keys = (key: string, modifiers: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...modifiers });

  it.each([
    { name: "Alt+← volta", event: keys("ArrowLeft", { altKey: true }), focus: "other", expected: "back" },
    { name: "Alt+→ avança", event: keys("ArrowRight", { altKey: true }), focus: "other", expected: "forward" },
    { name: "vale no editor de SQL, no lugar do Alt+← do CodeMirror", event: keys("ArrowLeft", { altKey: true }), focus: "editor", expected: "back" },
    { name: "não vale num campo de texto", event: keys("ArrowLeft", { altKey: true }), focus: "text", expected: null },
    { name: "a seta sozinha não", event: keys("ArrowLeft"), focus: "other", expected: null },
    { name: "Ctrl+Alt+← (o AltGr do Windows) não", event: keys("ArrowLeft", { altKey: true, ctrlKey: true }), focus: "other", expected: null },
    { name: "Shift+Alt+← (estende a seleção) não", event: keys("ArrowLeft", { altKey: true, shiftKey: true }), focus: "other", expected: null },
    { name: "Cmd+Alt+← não", event: keys("ArrowLeft", { altKey: true, metaKey: true }), focus: "other", expected: null },
    { name: "Alt+↑ não", event: keys("ArrowUp", { altKey: true }), focus: "other", expected: null },
    { name: "Cmd+[ não vale fora do macOS", event: keys("[", { metaKey: true }), focus: "other", expected: null },
  ])("Windows e Linux: $name", ({ event, focus, expected }) => {
    expect(keyHistoryAction(event, { mac: false, focus: focus as "other" })).toBe(expected);
  });

  it.each([
    { name: "Cmd+[ volta", event: keys("[", { metaKey: true }), focus: "other", expected: "back" },
    { name: "Cmd+] avança", event: keys("]", { metaKey: true }), focus: "other", expected: "forward" },
    { name: "no editor de SQL continuam sendo o recuo", event: keys("[", { metaKey: true }), focus: "editor", expected: null },
    { name: "num campo de texto não valem", event: keys("]", { metaKey: true }), focus: "text", expected: null },
    { name: "o colchete sem o Cmd não", event: keys("[", {}), focus: "other", expected: null },
    { name: "Cmd+Shift+[ (a aba anterior do sistema) não", event: keys("[", { metaKey: true, shiftKey: true }), focus: "other", expected: null },
    { name: "Cmd+Option+[ não", event: keys("[", { metaKey: true, altKey: true }), focus: "other", expected: null },
    { name: "Ctrl+Cmd+[ não", event: keys("[", { metaKey: true, ctrlKey: true }), focus: "other", expected: null },
    { name: "Alt+← não vale no macOS (é andar pela palavra)", event: keys("ArrowLeft", { altKey: true }), focus: "other", expected: null },
    { name: "Cmd+← não", event: keys("ArrowLeft", { metaKey: true }), focus: "other", expected: null },
  ])("macOS: $name", ({ event, focus, expected }) => {
    expect(keyHistoryAction(event, { mac: true, focus: focus as "other" })).toBe(expected);
  });
});
