import { afterEach, describe, expect, it, vi } from "vitest";

import { focusAfterChange, isLost, navigatorRow, popupOpen, popupTakesFocus, regionOf, stillWithRequester, tabEntries, tabFocus, type FocusChange, type FocusRequest } from "./tab-focus";

// O foco ao abrir, fechar e trocar de aba (RN-ABAS-019), sem DOM: o vitest deste projeto não tem página, e a regra mora em funções que só leem o que o elemento
// diz de si. O elemento de mentira responde a `closest` pelos trechos do seletor que o código pergunta (o seletor dos diálogos, menus e listas é uma lista).
type FakeOptions = { tag?: string; inside?: string[]; connected?: boolean; visible?: boolean | "unknown" };

function fake({ tag = "DIV", inside = [], connected = true, visible = true }: FakeOptions = {}): Element {
  return {
    tagName: tag,
    isConnected: connected,
    closest: (selector: string) => (selector.split(",").some((part) => inside.includes(part.trim())) ? {} : null),
    ...(visible === "unknown" ? {} : { checkVisibility: () => visible }),
  } as unknown as Element;
}

const dialog = '[aria-modal="true"]';
const menu = '[role="menu"]';
const list = '[role="listbox"]';

describe("regionOf: onde o foco está (RN-ABAS-019)", () => {
  it.each([
    ["a faixa", fake({ inside: ["[data-tab-strip]"] }), "strip"],
    ["o conteúdo de uma aba", fake({ inside: ["[data-tab-content]"] }), "content"],
    ["o navegador, a barra de cima: fora das abas", fake(), "outside"],
  ] as const)("%s", (_name, element, region) => {
    expect(regionOf(element)).toBe(region);
  });

  it("nenhum elemento, o corpo da página e o documento não dizem onde a pessoa estava", () => {
    expect(regionOf(null)).toBeNull();
    expect(regionOf(fake({ tag: "BODY" }))).toBeNull();
    expect(regionOf(fake({ tag: "HTML" }))).toBeNull();
  });

  it.each([
    ["um diálogo modal", dialog],
    ["um menu", menu],
    ["uma lista", list],
  ])("o que está dentro de %s não conta, mesmo dentro do conteúdo de uma aba: o diálogo que fecha devolve o foco a quem o tinha", (_name, popup) => {
    expect(regionOf(fake({ inside: [popup, "[data-tab-content]"] }))).toBeNull();
    expect(regionOf(fake({ inside: [popup, "[data-tab-strip]"] }))).toBeNull();
    expect(regionOf(fake({ inside: [popup] }))).toBeNull();
  });
});

describe("isLost: o foco perdido (RN-ABAS-019)", () => {
  const body = fake({ tag: "BODY" });
  const page = { body: body as HTMLElement };

  it("nenhum elemento, o corpo da página, o elemento que saiu da página e o que está num painel escondido", () => {
    expect(isLost(null, page)).toBe(true);
    expect(isLost(body, page)).toBe(true);
    expect(isLost(fake({ connected: false }), page)).toBe(true);
    expect(isLost(fake({ visible: false }), page)).toBe(true);
  });

  it("um elemento vivo e à vista não está perdido, também onde o navegador não tem `checkVisibility`", () => {
    expect(isLost(fake(), page)).toBe(false);
    expect(isLost(fake({ visible: "unknown" }), page)).toBe(false);
  });
});

describe("popupOpen e navigatorRow: o que a página mostra", () => {
  it("há diálogo, menu ou lista abertos quando o seletor acha algo", () => {
    expect(popupOpen({ querySelector: () => null })).toBe(false);
    expect(popupOpen({ querySelector: () => ({}) as Element })).toBe(true);
  });

  describe("popupTakesFocus: o diálogo, o menu e a lista que tomaram o foco", () => {
    // O `closest` da lista diz se ela está dentro de um `.cm-tooltip` (a lista de sugestões do CodeMirror); o seletor dos diálogos e menus é só o que a página responde.
    const listIn = (selector: string | null): Element => ({ closest: (ancestor: string) => (ancestor === selector ? {} : null) }) as unknown as Element;
    const page = ({ dialogOrMenu = false, lists = [] as Element[] } = {}) => ({
      querySelector: (selector: string) => ((dialogOrMenu && selector.includes("aria-modal") ? {} : null) as never),
      querySelectorAll: (selector: string) => (selector === '[role="listbox"]' ? lists : []) as never,
    });

    it.each([
      ["nada aberto", page(), false],
      ["um diálogo ou um menu", page({ dialogOrMenu: true }), true],
      ["uma lista de outro lugar (os seletores, a lista de conexões)", page({ lists: [listIn(null)] }), true],
      ["só a lista de sugestões do editor (um `.cm-tooltip`): ela é do editor que perde o foco, e não bloqueia", page({ lists: [listIn(".cm-tooltip")] }), false],
      ["a lista de sugestões do editor e uma de outro lugar: a de outro lugar bloqueia", page({ lists: [listIn(".cm-tooltip"), listIn(null)] }), true],
      ["a lista de sugestões do editor e um diálogo: o diálogo bloqueia", page({ dialogOrMenu: true, lists: [listIn(".cm-tooltip")] }), true],
    ] as const)("%s", (_name, current, expected) => {
      expect(popupTakesFocus(current as never)).toBe(expected);
    });

    it("o `popupOpen`, dos atalhos da janela, continua contando todas as listas, também a de sugestões do editor", () => {
      expect(popupOpen({ querySelector: (selector: string) => (selector.includes('[role="listbox"]') ? ({} as Element) : null) })).toBe(true);
    });
  });

  it("a linha do navegador é a que o Tab alcança; sem ela, a primeira que não é pulada; escondido (o navegador retrátil), nenhuma", () => {
    const tabbable = fake();
    const other = fake();
    const asked: string[] = [];
    const page = (answers: Record<string, Element | null>) => ({
      querySelector: (selector: string) => {
        asked.push(selector);
        return (answers[selector] ?? null) as never;
      },
    });

    expect(navigatorRow(page({ '[role="tree"] [data-row-toggle][tabindex="0"]': tabbable, '[role="tree"] [data-row-toggle]:not([tabindex="-1"])': other }))).toBe(tabbable);
    expect(navigatorRow(page({ '[role="tree"] [data-row-toggle]:not([tabindex="-1"])': other }))).toBe(other);
    expect(navigatorRow(page({}))).toBeNull();
    expect(navigatorRow(page({ '[role="tree"] [data-row-toggle][tabindex="0"]': fake({ visible: false }) }))).toBeNull();
    expect(asked).toContain('[role="tree"] [data-row-toggle][tabindex="0"]');
  });
});

describe("focusAfterChange: para onde o foco vai (RN-ABAS-019)", () => {
  const base: FocusChange = { request: false, lastRegion: null, lost: false, atRequester: false, hasTabs: true, blocked: false, promised: false };

  it.each([
    // Abrir por um gesto.
    ["o pedido com o foco ainda em quem pediu: a entrada da aba", { request: true, atRequester: true }, "entry"],
    ["o pedido com o foco perdido (o menu e o diálogo que fecharam): a entrada", { request: true, lost: true }, "entry"],
    ["o pedido com o foco em quem pediu e perdido: a entrada", { request: true, lost: true, atRequester: true }, "entry"],
    ["o pedido com o foco que andou para outra linha (o type-ahead): fica onde está", { request: true }, null],
    ["o pedido com o foco que andou para um campo que a pessoa clicou: fica onde está", { request: true, lastRegion: "outside" }, null],
    ["o pedido bloqueado (diálogo, menu, lista, cofre bloqueado, outra tela): nada", { request: true, atRequester: true, blocked: true }, null],
    ["o pedido com o foco prometido por outra regra (o F6): nada", { request: true, atRequester: true, promised: true }, null],
    // Fechar, ou a aba sair da janela.
    ["o foco não está perdido: nada, onde quer que ele estivesse", { lastRegion: "content" }, null],
    ["o foco perdido que estava na faixa: a aba ativa, na faixa", { lost: true, lastRegion: "strip" }, "strip"],
    ["o foco perdido que estava no conteúdo de uma aba: a entrada da aba ativa", { lost: true, lastRegion: "content" }, "entry"],
    ["o foco perdido que estava fora das abas: fica onde está", { lost: true, lastRegion: "outside" }, null],
    ["o foco perdido sem região conhecida: nada", { lost: true }, null],
    ["a última aba, com o foco que estava na faixa: a linha do navegador", { lost: true, lastRegion: "strip", hasTabs: false }, "navigator"],
    ["a última aba, com o foco que estava no conteúdo: a linha do navegador", { lost: true, lastRegion: "content", hasTabs: false }, "navigator"],
    ["a última aba, com o foco que estava fora das abas: fica onde está", { lost: true, lastRegion: "outside", hasTabs: false }, null],
    ["perdido e bloqueado: nada", { lost: true, lastRegion: "content", blocked: true }, null],
    ["perdido e prometido (o F6, a troca do lugar do resultado): nada", { lost: true, lastRegion: "content", promised: true }, null],
  ] as [string, Partial<FocusChange>, string | null][])("%s", (_name, change, destination) => {
    expect(focusAfterChange({ ...base, ...change })).toBe(destination);
  });
});

// Todas as combinações das entradas da decisão (4 regiões x 6 booleanos = 256): o que nenhuma combinação pode produzir, em vez de só os casos escolhidos acima.
describe("focusAfterChange: o que nenhuma combinação produz", () => {
  const regions: FocusChange["lastRegion"][] = [null, "strip", "content", "outside"];
  const flags = [false, true];
  const all: FocusChange[] = regions.flatMap((lastRegion) =>
    flags.flatMap((request) => flags.flatMap((lost) => flags.flatMap((atRequester) => flags.flatMap((hasTabs) => flags.flatMap((blocked) => flags.map((promised) => ({ request, lastRegion, lost, atRequester, hasTabs, blocked, promised }))))))),
  );

  it("cobre as 256 combinações", () => {
    expect(all).toHaveLength(256);
  });

  it("bloqueado, ou com o foco prometido por outra regra, nunca move o foco", () => {
    for (const change of all.filter((current) => current.blocked || current.promised)) expect(focusAfterChange(change), JSON.stringify(change)).toBeNull();
  });

  it("sem pedido e com o foco vivo (a pessoa o pôs onde está), nunca move o foco", () => {
    for (const change of all.filter((current) => !current.request && !current.lost)) expect(focusAfterChange(change), JSON.stringify(change)).toBeNull();
  });

  it("o foco que saiu de quem pediu para outro lugar vivo (o type-ahead, um campo clicado) nunca é tomado", () => {
    for (const change of all.filter((current) => current.request && !current.lost && !current.atRequester)) expect(focusAfterChange(change), JSON.stringify(change)).toBeNull();
  });

  it("com pedido, não bloqueado, e o foco em quem pediu ou perdido, vai sempre à entrada da aba, onde quer que o foco tenha estado", () => {
    for (const change of all.filter((current) => current.request && (current.lost || current.atRequester) && !current.blocked && !current.promised)) expect(focusAfterChange(change), JSON.stringify(change)).toBe("entry");
  });

  it("o navegador só recebe o foco sem nenhuma aba, e a faixa só o de quem estava na faixa", () => {
    for (const change of all) {
      const destination = focusAfterChange(change);
      if (destination === "navigator") expect(change.hasTabs, JSON.stringify(change)).toBe(false);
      if (destination === "strip") expect([change.lastRegion, change.lost, change.request], JSON.stringify(change)).toEqual(["strip", true, false]);
    }
  });

  it("o foco que estava fora das abas, perdido e sem pedido, fica onde está, com aba ou sem ela", () => {
    for (const change of all.filter((current) => !current.request && current.lost && (current.lastRegion === "outside" || current.lastRegion === null))) expect(focusAfterChange(change), JSON.stringify(change)).toBeNull();
  });
});

describe("stillWithRequester: quem pediu a aba", () => {
  const row = fake();
  const request = (over: Partial<FocusRequest> = {}): FocusRequest => ({ tabId: "a", from: row, fromPopup: false, ...over });

  it("o foco no mesmo elemento de quando a aba foi pedida", () => {
    expect(stillWithRequester(request(), row)).toBe(true);
    expect(stillWithRequester(request(), fake())).toBe(false);
    expect(stillWithRequester(request({ from: null }), null)).toBe(true);
  });

  it("o menu e o diálogo que abriram a aba fecham e devolvem o foco ao item: quem pediu morreu com eles, e o foco que chega não é 'outro lugar vivo'", () => {
    expect(stillWithRequester(request({ fromPopup: true }), fake())).toBe(true);
  });
});

describe("tabFocus: o pedido de foco de uma aba", () => {
  afterEach(() => tabFocus.forgetExcept(new Set()));

  it("o pedido leva quem tinha o foco, e é levado uma vez só, pela aba dele", () => {
    const row = fake();
    tabFocus.request("a", row);

    expect(tabFocus.take("a")).toEqual({ tabId: "a", from: row, fromPopup: false });
    expect(tabFocus.take("a")).toBeNull();
  });

  it("quem tinha o foco dentro de um menu, de um diálogo ou de uma lista é marcado: eles fecham logo depois do pedido", () => {
    tabFocus.request("a", fake({ inside: [menu] }));
    expect(tabFocus.take("a")?.fromPopup).toBe(true);
    tabFocus.request("a", fake({ inside: [dialog] }));
    expect(tabFocus.take("a")?.fromPopup).toBe(true);
    tabFocus.request("a", fake());
    expect(tabFocus.take("a")?.fromPopup).toBe(false);
    tabFocus.request("a", null);
    expect(tabFocus.take("a")).toMatchObject({ from: null, fromPopup: false });
  });

  it("um pedido por vez: o seguinte troca o de antes", () => {
    tabFocus.request("a", null);
    tabFocus.request("b", null);

    expect(tabFocus.take("a")).toBeNull();
    expect(tabFocus.take("b")).not.toBeNull();
  });

  it("o pedido de outra aba, que ainda não é a ativa, espera: levar o de uma aba não leva o de outra", () => {
    tabFocus.request("b", null);

    expect(tabFocus.take("a")).toBeNull();
    expect(tabFocus.take("b")).not.toBeNull();
  });

  it("a aba que saiu leva o pedido dela; o das que continuam fica", () => {
    tabFocus.request("a", null);
    tabFocus.forgetExcept(new Set(["b"]));
    expect(tabFocus.take("a")).toBeNull();

    tabFocus.request("b", null);
    tabFocus.forgetExcept(new Set(["b", "c"]));
    expect(tabFocus.take("b")).not.toBeNull();
  });

  it("cada pedido muda a versão e avisa quem assinou, para a área das abas refazer o efeito quando a aba pedida já é a ativa; levar e esquecer não avisam", () => {
    const listener = vi.fn();
    const stop = tabFocus.subscribe(listener);
    const before = tabFocus.version();

    tabFocus.request("a", null);
    tabFocus.request("a", null);
    expect(tabFocus.version()).toBe(before + 2);
    expect(listener).toHaveBeenCalledTimes(2);

    tabFocus.take("a");
    tabFocus.forgetExcept(new Set());
    expect(tabFocus.version()).toBe(before + 2);
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    tabFocus.request("a", null);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("tabEntries: como cada aba se foca", () => {
  it("o painel registra a entrada, a área das abas a chama, e desregistrar a tira", () => {
    const focus = vi.fn();
    const unregister = tabEntries.register("a", focus);

    expect(tabEntries.focus("a")).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    unregister();
    expect(tabEntries.focus("a")).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
  });

  it("sem entrada registrada, ou quando ela diz que o foco não chegou, devolve falso", () => {
    expect(tabEntries.focus("sem-entrada")).toBe(false);

    const unregister = tabEntries.register("b", () => false);
    expect(tabEntries.focus("b")).toBe(false);
    unregister();
  });

  it("uma entrada que não devolve nada vale como foco que chegou", () => {
    const unregister = tabEntries.register("c", () => {});
    expect(tabEntries.focus("c")).toBe(true);
    unregister();
  });

  describe("o foco que se perde logo depois de chegar (o `StrictMode`, em desenvolvimento, recria o editor do painel que acabou de nascer)", () => {
    // O `body` e o elemento focado de agora, como a página os tem; sem `document` (os testes de outros arquivos), a entrada não confere nada.
    const body = fake({ tag: "BODY" });
    const page = { body, activeElement: body as Element | null };
    afterEach(() => vi.unstubAllGlobals());

    it("no fim da tarefa, com o foco perdido, a entrada o leva de novo, uma vez", async () => {
      vi.stubGlobal("document", page);
      const editor = fake();
      const entry = vi.fn(() => void (page.activeElement = editor));
      const unregister = tabEntries.register("e", entry);

      expect(tabEntries.focus("e")).toBe(true);
      page.activeElement = body;
      await Promise.resolve();

      expect(entry).toHaveBeenCalledTimes(2);
      expect(page.activeElement).toBe(editor);
      await Promise.resolve();
      expect(entry).toHaveBeenCalledTimes(2);
      unregister();
    });

    it("com o foco no elemento que a entrada pôs, ela não é chamada de novo", async () => {
      vi.stubGlobal("document", page);
      const editor = fake();
      const entry = vi.fn(() => void (page.activeElement = editor));
      const unregister = tabEntries.register("f", entry);

      tabEntries.focus("f");
      await Promise.resolve();

      expect(entry).toHaveBeenCalledOnce();
      unregister();
    });

    it("a aba que fechou até lá (a entrada saiu do registro) não é focada, e a que diz que o foco não chegou não repete", async () => {
      vi.stubGlobal("document", page);
      page.activeElement = body;
      const entry = vi.fn();
      const unregister = tabEntries.register("g", entry);
      tabEntries.focus("g");
      unregister();
      await Promise.resolve();
      expect(entry).toHaveBeenCalledOnce();

      const refusing = vi.fn(() => false);
      const unregisterRefusing = tabEntries.register("h", refusing);
      expect(tabEntries.focus("h")).toBe(false);
      await Promise.resolve();
      expect(refusing).toHaveBeenCalledOnce();
      unregisterRefusing();
    });
  });

  it("o painel que monta de novo (o mesmo id) registra a entrada nova, e a limpeza da antiga não tira a nova", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = tabEntries.register("d", first);
    const unregisterSecond = tabEntries.register("d", second);

    unregisterFirst();
    expect(tabEntries.focus("d")).toBe(true);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();

    unregisterSecond();
    expect(tabEntries.focus("d")).toBe(false);
  });
});
