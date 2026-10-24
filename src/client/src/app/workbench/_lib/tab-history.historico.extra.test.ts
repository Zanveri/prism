import { describe, expect, it } from "vitest";

import {
  emptyHistory,
  keyHistoryAction,
  maxHistoryEntries,
  mouseHistoryAction,
  pruneHistory,
  recordTab,
  stepHistory,
  type HistoryAction,
  type HistoryFocus,
  type TabHistory,
} from "./tab-history";

/** `t0`, `t1`… : abas de nomes distintos para as sequências longas. */
const tabs = (count: number) => Array.from({ length: count }, (_, position) => `t${position}`);
const open = (...tabIds: string[]) => new Set(tabIds);
const shape = (history: TabHistory) => `${history.entries.join("")}@${history.index}`;
const record = (...tabIds: string[]): TabHistory => tabIds.reduce(recordTab, emptyHistory);

/**
 * Roda uma sequência: `back` e `forward` andam pelo histórico (e devolvem a aba que ativaram, ou `null`); qualquer outro texto é uma aba que ficou
 * ativa por outro caminho (RN-ABAS-018). As abas que a sequência usa têm de estar em `openTabs`.
 */
function play(ops: readonly string[], openTabs: ReadonlySet<string>): { history: TabHistory; tabIds: (string | null)[] } {
  let history: TabHistory = emptyHistory;
  const tabIds: (string | null)[] = [];

  for (const op of ops) {
    if (op === "back" || op === "forward") {
      const step = stepHistory(history, openTabs, op === "back" ? -1 : 1);
      history = step.history;
      tabIds.push(step.tabId);
    } else {
      history = recordTab(history, op);
    }
  }

  return { history, tabIds };
}

describe("sequências longas: ativações com Voltar e Avançar no meio", () => {
  const letters = "abcdefghij".split("");

  it("Voltar e Avançar andam pela ordem; ativar outra aba no meio descarta o que estava à frente; as pontas não fazem nada", () => {
    const ops = [
      ...letters,
      "back",
      "back",
      "back",
      "back",
      "forward",
      "forward",
      "a",
      "back",
      "back",
      "forward",
      "h",
      "forward",
      "forward",
      ...Array<string>(9).fill("back"),
    ];
    const { history, tabIds } = play(ops, open(...letters));

    expect(tabIds).toEqual(["i", "h", "g", "f", "g", "h", "h", "g", "h", "a", null, "h", "g", "f", "e", "d", "c", "b", "a", null]);
    expect(shape(history)).toBe("abcdefgha@0");
  });

  it("com o limite cheio, voltar 10 e ativar outra aba corta as 10 da frente; a mais velha continua saindo", () => {
    const all = tabs(60);
    const { history, tabIds } = play([...all, ...Array<string>(10).fill("back"), "n", "back", "forward", "forward"], open(...all, "n"));

    expect(tabIds.slice(0, 10)).toEqual(["t58", "t57", "t56", "t55", "t54", "t53", "t52", "t51", "t50", "t49"]);
    expect(tabIds.slice(10)).toEqual(["t49", "n", null]);
    expect(history.entries).toHaveLength(41);
    expect(history.entries[0]).toBe("t10");
    expect(history.entries.at(-1)).toBe("n");
    expect(history.index).toBe(40);
  });
});

describe("o limite de 50 entradas na fronteira", () => {
  it.each([
    { name: "exatamente 50 ativações: nenhuma sai", count: 50, first: "t0" },
    { name: "51 ativações: sai a mais velha (t0)", count: 51, first: "t1" },
  ])("$name", ({ count, first }) => {
    expect(maxHistoryEntries).toBe(50);
    const all = tabs(count);
    const { history, tabIds } = play([...all, ...Array<string>(count).fill("back")], open(...all));

    expect(history.entries).toHaveLength(50);
    expect(history.entries[0]).toBe(first);
    // De t49 (ou t50) até a primeira: 49 voltas, e a 50ª não tem para onde ir.
    expect(tabIds[48]).toBe(first);
    expect(tabIds[49]).toBeNull();
  });

  it.each([
    { name: "50 distintas, cada uma repetida na sequência: nenhuma sai", ops: tabs(50).flatMap((id) => [id, id]), first: "t0" },
    { name: "a 51ª distinta: sai a t0, mesmo com as repetições", ops: [...tabs(50).flatMap((id) => [id, id]), "t50"], first: "t1" },
  ])("as repetições seguidas não gastam o limite: $name", ({ ops, first }) => {
    const { history } = play(ops, open(...tabs(51)));

    expect(history.entries).toHaveLength(50);
    expect(history.entries[0]).toBe(first);
    expect(history.index).toBe(49);
  });
});

describe("as mesmas abas duas vezes seguidas", () => {
  it.each([
    { name: "três iguais seguidas são uma entrada", ops: ["a", "a", "a"], expected: "a@0" },
    { name: "as iguais seguidas dos dois lados", ops: ["a", "a", "b", "b", "a", "a"], expected: "aba@2" },
    { name: "trocar sem parar: cada troca é entrada, as repetições não", ops: ["a", "b", "a", "b"], expected: "abab@3" },
    { name: "repetir a aba de agora depois de voltar não mexe no que está à frente", ops: ["a", "b", "c", "back", "b", "b"], expected: "abc@1" },
  ])("$name", ({ ops, expected }) => {
    const { history } = play(ops, open("a", "b", "c"));
    expect(shape(history)).toBe(expected);
  });

  it("Voltar de uma aba repetida vai à anterior diferente, não à mesma", () => {
    const { history, tabIds } = play(["a", "a", "b", "b", "back"], open("a", "b"));
    expect(tabIds).toEqual(["a"]);
    expect(shape(history)).toBe("ab@0");
  });
});

describe("a mesma aba muito depois dela mesma", () => {
  it("Voltar da volta da aba repetida vai à entrada imediatamente anterior, não à primeira vez dela", () => {
    const all = open("a", "b", "c", "d", "e");
    const { history, tabIds } = play(["a", "b", "c", "d", "e", "a", "back", "back", "forward"], all);

    expect(tabIds).toEqual(["e", "d", "e"]);
    expect(shape(history)).toBe("abcdea@4");
  });

  it.each([
    { name: "a repetida longe dela, com a do meio fechada, continua duas entradas", history: record("a", "b", "a", "c", "a"), now: ["a", "c"], expected: "aca@2" },
    { name: "as duas do meio fecharam: as duas 'a' viram uma", history: record("a", "b", "c", "a"), now: ["a"], expected: "a@0" },
  ])("$name", ({ history, now, expected }) => {
    expect(shape(pruneHistory(history, open(...now)))).toBe(expected);
  });
});

describe("fechar a aba atual", () => {
  const backFromC = stepHistory(record("a", "b", "c"), open("a", "b", "c"), -1).history;

  it.each([
    {
      name: "a atual é a última e a janela ativa a anterior, que já é a entrada de agora: nada entra",
      start: record("a", "b", "c"),
      now: ["a", "b"],
      active: "b",
      expectedShape: "ab@1",
      back: "a",
      forward: null,
    },
    {
      name: "a janela ativa uma aba nova: ela entra no fim, como ativação",
      start: record("a", "b", "c"),
      now: ["a", "b", "d"],
      active: "d",
      expectedShape: "abd@2",
      back: "b",
      forward: null,
    },
    {
      name: "voltou para b, fechou b e a janela ativa c, que estava à frente: c vira a entrada de agora",
      start: backFromC,
      now: ["a", "c"],
      active: "c",
      expectedShape: "ac@1",
      back: "a",
      forward: null,
    },
  ])("$name", ({ start, now, active, expectedShape, back, forward }) => {
    const after = recordTab(pruneHistory(start, open(...now)), active);

    expect(shape(after)).toBe(expectedShape);
    expect(stepHistory(after, open(...now), -1).tabId).toBe(back);
    expect(stepHistory(after, open(...now), 1).tabId).toBe(forward);
  });

  it("fechou a primeira (de onde se voltou), sem entrada antes: Avançar vai à seguinte, Voltar não tem para onde", () => {
    const atFirst = play(["a", "b", "c", "back", "back"], open("a", "b", "c")).history;
    expect(shape(atFirst)).toBe("abc@0");

    const pruned = pruneHistory(atFirst, open("b", "c"));
    expect(shape(pruned)).toBe("bc@-1");
    expect(stepHistory(pruned, open("b", "c"), 1).tabId).toBe("b");
    expect(stepHistory(pruned, open("b", "c"), -1).tabId).toBeNull();
  });
});

describe("fechar todas as abas", () => {
  it("o histórico zera; Voltar e Avançar não fazem nada; a próxima ativação começa outro histórico", () => {
    const start = play(["a", "b", "c", "back"], open("a", "b", "c")).history;
    expect(shape(start)).toBe("abc@1");

    const none = pruneHistory(start, open());
    expect(shape(none)).toBe("@-1");
    expect(stepHistory(none, open(), -1).tabId).toBeNull();
    expect(stepHistory(none, open(), 1).tabId).toBeNull();
    expect(shape(recordTab(none, "d"))).toBe("d@0");
  });
});

describe("uma aba que foi para outra janela", () => {
  it("sai do histórico como uma fechada: Voltar e Avançar a pulam", () => {
    const at = play(["a", "b", "c", "d", "back"], open("a", "b", "c", "d")).history;
    expect(shape(at)).toBe("abcd@2");

    const moved = pruneHistory(at, open("a", "c", "d"));
    expect(shape(moved)).toBe("acd@1");

    const toA = stepHistory(moved, open("a", "c", "d"), -1);
    expect(toA.tabId).toBe("a");
    const toC = stepHistory(toA.history, open("a", "c", "d"), 1);
    expect(toC.tabId).toBe("c");
    const toD = stepHistory(toC.history, open("a", "c", "d"), 1);
    expect(toD.tabId).toBe("d");
  });
});

describe("ativar outra aba depois de voltar descarta as entradas à frente", () => {
  it.each([
    { name: "uma aba nova", ops: ["a", "b", "c", "d", "e", "back", "back", "back", "f"], expectedShape: "abf@2", back: "b" },
    { name: "a aba que estava à frente: ela volta como entrada nova no fim", ops: ["a", "b", "c", "back", "c"], expectedShape: "abc@2", back: "b" },
    { name: "voltou ao começo e ativou outra: o resto some", ops: ["a", "b", "c", "back", "back", "z"], expectedShape: "az@1", back: "a" },
  ])("$name", ({ ops, expectedShape, back }) => {
    const { history } = play(ops, open("a", "b", "c", "d", "e", "f", "z"));
    const all = open("a", "b", "c", "d", "e", "f", "z");

    expect(shape(history)).toBe(expectedShape);
    expect(stepHistory(history, all, -1).tabId).toBe(back);
    expect(stepHistory(history, all, 1).tabId).toBeNull();
  });
});

describe("Voltar no começo e Avançar na ponta não fazem nada", () => {
  it.each([
    { name: "Voltar repetido no começo: a primeira é a última que anda", ops: ["a", "b", "c", "back", "back", "back", "back"], tabIds: ["b", "a", null, null], expectedShape: "abc@0" },
    { name: "Avançar repetido na ponta", ops: ["a", "b", "c", "forward", "forward"], tabIds: [null, null], expectedShape: "abc@2" },
    { name: "com uma aba só, nem Voltar nem Avançar", ops: ["a", "back", "forward"], tabIds: [null, null], expectedShape: "a@0" },
    { name: "sem nenhuma entrada", ops: ["back", "forward"], tabIds: [null, null], expectedShape: "@-1" },
  ])("$name", ({ ops, tabIds, expectedShape }) => {
    const result = play(ops, open("a", "b", "c"));

    expect(result.tabIds).toEqual(tabIds);
    expect(shape(result.history)).toBe(expectedShape);
  });
});

describe("mouseHistoryAction: os botões 0, 1 e 2 não fazem nada (e 3 e 4 são os únicos com ação)", () => {
  it.each([
    { name: "botão principal (esquerdo)", button: 0, expected: null },
    { name: "botão do meio (a roda)", button: 1, expected: null },
    { name: "botão direito", button: 2, expected: null },
    { name: "o botão 'voltar' (o 4 de quem numera de 1)", button: 3, expected: "back" as HistoryAction },
    { name: "o botão 'avançar' (o 5 de quem numera de 1)", button: 4, expected: "forward" as HistoryAction },
    { name: "o sexto botão não tem ação", button: 5, expected: null },
  ])("$name", ({ button, expected }) => {
    expect(mouseHistoryAction(button)).toBe(expected);
  });
});

type Mods = { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean };
type KeyCase = { name: string; key: string; mods?: Mods; focus: HistoryFocus; expected: HistoryAction | null };

const keyOf = ({ key, mods = {} }: Pick<KeyCase, "key" | "mods">) => ({
  key,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
});

const windowsAndLinux: KeyCase[] = [
  { name: "Alt+→ avança", key: "ArrowRight", mods: { alt: true }, focus: "other", expected: "forward" },
  { name: "Alt+→ no editor de SQL avança (no lugar do CodeMirror)", key: "ArrowRight", mods: { alt: true }, focus: "editor", expected: "forward" },
  { name: "Alt+→ num campo de texto segue para o campo", key: "ArrowRight", mods: { alt: true }, focus: "text", expected: null },
  { name: "Alt+→ com Shift não", key: "ArrowRight", mods: { alt: true, shift: true }, focus: "other", expected: null },
  { name: "Alt+→ com Ctrl não (o AltGr)", key: "ArrowRight", mods: { alt: true, ctrl: true }, focus: "other", expected: null },
  { name: "Alt+→ com Cmd (Meta) não", key: "ArrowRight", mods: { alt: true, meta: true }, focus: "other", expected: null },
  { name: "Alt+← com Ctrl, Shift e Cmd juntos não", key: "ArrowLeft", mods: { alt: true, ctrl: true, shift: true, meta: true }, focus: "other", expected: null },
  { name: "Alt+→ com Ctrl, Shift e Cmd juntos não", key: "ArrowRight", mods: { alt: true, ctrl: true, shift: true, meta: true }, focus: "other", expected: null },
  { name: "Alt+Shift+← no editor de SQL não (é estender a seleção)", key: "ArrowLeft", mods: { alt: true, shift: true }, focus: "editor", expected: null },
  { name: "Alt+Shift+→ no editor de SQL não", key: "ArrowRight", mods: { alt: true, shift: true }, focus: "editor", expected: null },
  { name: "Alt+↓ não", key: "ArrowDown", mods: { alt: true }, focus: "other", expected: null },
  { name: "Alt+[ não", key: "[", mods: { alt: true }, focus: "other", expected: null },
  { name: "Alt+] não", key: "]", mods: { alt: true }, focus: "other", expected: null },
  { name: "Ctrl+[ não", key: "[", mods: { ctrl: true }, focus: "other", expected: null },
  { name: "Ctrl+] não", key: "]", mods: { ctrl: true }, focus: "other", expected: null },
  { name: "Cmd+] não vale fora do macOS", key: "]", mods: { meta: true }, focus: "other", expected: null },
  { name: "a tecla Alt sozinha (o keydown dela) não", key: "Alt", mods: { alt: true }, focus: "other", expected: null },
  { name: "a seta sozinha num campo de texto não", key: "ArrowLeft", focus: "text", expected: null },
];

const macOS: KeyCase[] = [
  { name: "Cmd+] avança", key: "]", mods: { meta: true }, focus: "other", expected: "forward" },
  { name: "Cmd+[ no editor de SQL continua sendo o recuo", key: "[", mods: { meta: true }, focus: "editor", expected: null },
  { name: "Cmd+] no editor de SQL continua sendo o avanço do recuo", key: "]", mods: { meta: true }, focus: "editor", expected: null },
  { name: "Cmd+[ num campo de texto não vale", key: "[", mods: { meta: true }, focus: "text", expected: null },
  { name: "Cmd+Shift+] não", key: "]", mods: { meta: true, shift: true }, focus: "other", expected: null },
  { name: "Cmd+Option+] não", key: "]", mods: { meta: true, alt: true }, focus: "other", expected: null },
  { name: "Cmd+Ctrl+] não", key: "]", mods: { meta: true, ctrl: true }, focus: "other", expected: null },
  { name: "Option+[ sem Cmd não", key: "[", mods: { alt: true }, focus: "other", expected: null },
  { name: "Ctrl+[ sem Cmd não", key: "[", mods: { ctrl: true }, focus: "other", expected: null },
  { name: "Option+→ não vale (é andar pela palavra)", key: "ArrowRight", mods: { alt: true }, focus: "other", expected: null },
  { name: "Cmd+→ não", key: "ArrowRight", mods: { meta: true }, focus: "other", expected: null },
  { name: "Cmd+Option+← não", key: "ArrowLeft", mods: { meta: true, alt: true }, focus: "other", expected: null },
  { name: "a tecla Cmd sozinha não", key: "Meta", mods: { meta: true }, focus: "other", expected: null },
];

describe("keyHistoryAction: Windows e Linux", () => {
  it.each(windowsAndLinux)("$name", ({ key, mods, focus, expected }) => {
    expect(keyHistoryAction(keyOf({ key, mods }), { mac: false, focus })).toBe(expected);
  });
});

describe("keyHistoryAction: macOS", () => {
  it.each(macOS)("$name", ({ key, mods, focus, expected }) => {
    expect(keyHistoryAction(keyOf({ key, mods }), { mac: true, focus })).toBe(expected);
  });
});
