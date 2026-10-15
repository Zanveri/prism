import { describe, expect, it, vi } from "vitest";

import { createNavigatorLayoutStore, hideFocusTarget, rememberedTreeScroll, navigatorLayoutKey, navigatorShortcut, navigatorShortcutLabels, parseNavigatorLayout } from "./navigator-layout";

const shown = { hidden: false, scriptsCollapsed: false };

describe("parseNavigatorLayout: o que está gravado pode ser qualquer coisa, e a leitura nunca lança", () => {
  it("o gravado vale", () => {
    expect(parseNavigatorLayout('{"hidden":true,"scriptsCollapsed":false}')).toEqual({ hidden: true, scriptsCollapsed: false });
    expect(parseNavigatorLayout('{"hidden":false,"scriptsCollapsed":true}')).toEqual({ hidden: false, scriptsCollapsed: true });
    expect(parseNavigatorLayout('{"hidden":true,"scriptsCollapsed":true}')).toEqual({ hidden: true, scriptsCollapsed: true });
  });

  it("o gravado antes da seção Scripts lembrar (só `hidden`) continua valendo, com a seção aberta", () => {
    expect(parseNavigatorLayout('{"hidden":true}')).toEqual({ hidden: true, scriptsCollapsed: false });
    expect(parseNavigatorLayout('{"hidden":false}')).toEqual(shown);
  });

  it("nada gravado, JSON quebrado, outra forma ou valor fora do esperado: o padrão (à mostra, a seção Scripts aberta), campo a campo", () => {
    for (const raw of [null, "", "{", "[]", "1", '{"hidden":"sim"}', '{"outro":true}', "null", '{"scriptsCollapsed":1}', '{"scriptsCollapsed":"true"}']) expect(parseNavigatorLayout(raw)).toEqual(shown);
    expect(parseNavigatorLayout('{"hidden":"sim","scriptsCollapsed":true}')).toEqual({ hidden: false, scriptsCollapsed: true });
  });
});

describe("navigatorLayoutKey: uma chave por usuário, só dele (o arquivo de preferências é de outra frente)", () => {
  it("o nome como a API o grava, sem espaços nas pontas e em minúsculas", () => {
    expect(navigatorLayoutKey("  Ana.Souza ")).toBe("prism:navigator:ana.souza");
  });
});

describe("createNavigatorLayoutStore: a escolha lembrada por usuário (RN-NAV-008)", () => {
  function memoryStorage() {
    const items = new Map<string, string>();
    return { items, storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) } };
  }

  it("cada usuário tem a sua; gravar avisa quem olha e devolve outro objeto", () => {
    const { items, storage } = memoryStorage();
    const store = createNavigatorLayoutStore(() => storage);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.get("ana");

    store.set("ana", { hidden: true });

    expect(store.get("ana")).toEqual({ hidden: true, scriptsCollapsed: false });
    expect(store.get("bruno")).toEqual(shown);
    expect(store.get("ana")).not.toBe(before);
    expect(items.get("prism:navigator:ana")).toBe('{"hidden":true,"scriptsCollapsed":false}');
    expect(listener).toHaveBeenCalledOnce();
  });

  it("a seção Scripts recolhida (RN-NAV-012) mora na mesma chave: mudar um campo não mexe no outro", () => {
    const { items, storage } = memoryStorage();
    const store = createNavigatorLayoutStore(() => storage);

    store.set("ana", { hidden: true });
    store.set("ana", { scriptsCollapsed: true });
    expect(store.get("ana")).toEqual({ hidden: true, scriptsCollapsed: true });

    store.set("ana", { hidden: false });
    expect(store.get("ana")).toEqual({ hidden: false, scriptsCollapsed: true });
    expect(items.get("prism:navigator:ana")).toBe('{"hidden":false,"scriptsCollapsed":true}');

    // A próxima entrada (outro armazém, o mesmo armazenamento) abre a seção como ficou.
    expect(createNavigatorLayoutStore(() => storage).get("ana").scriptsCollapsed).toBe(true);
  });

  it("duas janelas (dois armazéns, o mesmo armazenamento) não desfazem a escolha uma da outra: cada uma grava o seu campo sobre o que está gravado agora", () => {
    const windows = () => {
      const { items, storage } = memoryStorage();
      const first = createNavigatorLayoutStore(() => storage);
      const second = createNavigatorLayoutStore(() => storage);
      expect(first.get("ana")).toEqual(shown);
      expect(second.get("ana")).toEqual(shown);
      return { stored: () => items.get("prism:navigator:ana"), first, second };
    };

    // A primeira recolhe a seção Scripts; a segunda, que leu antes, esconde o navegador (Ctrl+B): a seção continua recolhida.
    const one = windows();
    one.first.set("ana", { scriptsCollapsed: true });
    one.second.set("ana", { hidden: true });
    expect(one.stored()).toBe('{"hidden":true,"scriptsCollapsed":true}');

    // Ao contrário: a primeira esconde o navegador; a segunda recolhe a seção e a abre de novo: o navegador continua escondido.
    const other = windows();
    other.first.set("ana", { hidden: true });
    other.second.set("ana", { scriptsCollapsed: true });
    expect(other.stored()).toBe('{"hidden":true,"scriptsCollapsed":true}');
    other.second.set("ana", { scriptsCollapsed: false });
    expect(other.stored()).toBe('{"hidden":true,"scriptsCollapsed":false}');
  });

  it("a janela aberta fica como está quando a outra muda; a que abre depois começa como a última escolha de cada campo (RN-NAV-012)", () => {
    const { storage } = memoryStorage();
    const first = createNavigatorLayoutStore(() => storage);
    const second = createNavigatorLayoutStore(() => storage);
    second.get("ana");

    first.set("ana", { scriptsCollapsed: true });
    second.set("ana", { hidden: true });

    expect(first.get("ana")).toEqual({ hidden: false, scriptsCollapsed: true });
    expect(second.get("ana")).toEqual({ hidden: true, scriptsCollapsed: false });
    expect(createNavigatorLayoutStore(() => storage).get("ana")).toEqual({ hidden: true, scriptsCollapsed: true });
  });

  it("o MESMO objeto enquanto nada muda (é o que o React compara); gravar o mesmo valor não avisa", () => {
    const { storage } = memoryStorage();
    const store = createNavigatorLayoutStore(() => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.get("ana")).toBe(store.get("ana"));
    store.set("ana", { hidden: false });
    store.set("ana", { scriptsCollapsed: false });
    store.set("ana", {});
    expect(listener).not.toHaveBeenCalled();
  });

  it("lê o que outra abertura gravou", () => {
    const { items, storage } = memoryStorage();
    items.set("prism:navigator:ana", '{"hidden":true}');

    expect(createNavigatorLayoutStore(() => storage).get("Ana")).toEqual({ hidden: true, scriptsCollapsed: false });
  });

  it("sem armazenamento, com ele recusando o acesso ou lançando ao gravar: a escolha vive na memória da sessão, e nada lança", () => {
    for (const getStorage of [() => null, () => { throw new Error("negado"); }, () => ({ getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("cheio"); } })]) {
      const store = createNavigatorLayoutStore(getStorage);

      expect(store.get("ana")).toEqual(shown);
      store.set("ana", { hidden: true, scriptsCollapsed: true });
      expect(store.get("ana")).toEqual({ hidden: true, scriptsCollapsed: true });
    }
  });
});

describe("navigatorShortcut: Ctrl+B e Ctrl+Shift+E (RN-NAV-008)", () => {
  const key = (overrides: Partial<Parameters<typeof navigatorShortcut>[0]>) => ({ key: "b", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, ...overrides });
  const here = { onScreen: true, modalOpen: false, locked: false };

  it("Ctrl+B esconde e mostra; Ctrl+Shift+E mostra e leva à busca; Cmd no macOS faz o mesmo", () => {
    expect(navigatorShortcut(key({}), here)).toBe("toggle");
    expect(navigatorShortcut(key({ key: "B" }), here)).toBe("toggle");
    expect(navigatorShortcut(key({ key: "E", shiftKey: true }), here)).toBe("reveal");
    expect(navigatorShortcut(key({ ctrlKey: false, metaKey: true }), here)).toBe("toggle");
  });

  it("valem com o foco em qualquer lugar da área de trabalho, inclusive no editor de SQL (o editor não trata essas teclas: chegam aqui sem `defaultPrevented`)", () => {
    expect(navigatorShortcut(key({}), here)).toBe("toggle");
  });

  it("NÃO valem nas outras telas, com um diálogo aberto nem com o Prism bloqueado", () => {
    expect(navigatorShortcut(key({}), { ...here, onScreen: false })).toBeNull();
    expect(navigatorShortcut(key({}), { ...here, modalOpen: true })).toBeNull();
    expect(navigatorShortcut(key({}), { ...here, locked: true })).toBeNull();
  });

  it("quem já tratou a tecla fica com ela; com Alt, sem Ctrl, com Shift no B, ou compondo um acento, é outra coisa", () => {
    for (const other of [key({ defaultPrevented: true }), key({ altKey: true }), key({ ctrlKey: false }), key({ shiftKey: true }), key({ key: "e" }), key({ isComposing: true }), key({ key: "x" })]) expect(navigatorShortcut(other, here)).toBeNull();
  });
});

describe("hideFocusTarget: o foco que estava no navegador vai para um lugar que faça sentido", () => {
  it("pelo botão da barra de ações: o botão que o traz de volta, na barra superior", () => {
    expect(hideFocusTarget("toolbar", { focusInside: true, hasActiveTab: true })).toBe("toggle");
  });

  it("pelo Ctrl+B com o foco no navegador: o trabalho da aba ativa; sem aba, o botão que o traz de volta", () => {
    expect(hideFocusTarget("shortcut", { focusInside: true, hasActiveTab: true })).toBe("workArea");
    expect(hideFocusTarget("shortcut", { focusInside: true, hasActiveTab: false })).toBe("toggle");
  });

  it("com o foco fora do navegador (no editor, no botão da barra superior), ele fica onde está", () => {
    expect(hideFocusTarget("shortcut", { focusInside: false, hasActiveTab: true })).toBeNull();
    expect(hideFocusTarget("toggle", { focusInside: false, hasActiveTab: true })).toBeNull();
  });
});

describe("navigatorShortcutLabels: os atalhos como a plataforma os escreve, nas dicas", () => {
  it("Ctrl nas outras, Cmd no macOS", () => {
    expect(navigatorShortcutLabels("Win32")).toEqual({ toggle: "Ctrl+B", reveal: "Ctrl+Shift+E" });
    expect(navigatorShortcutLabels("MacIntel")).toEqual({ toggle: "Cmd+B", reveal: "Cmd+Shift+E" });
  });
});

describe("rememberedTreeScroll: a rolagem da árvore que a busca devolve ao ser limpa", () => {
  it("com a árvore à mostra e sem busca, a rolagem lida é a guardada", () => {
    expect(rememberedTreeScroll(120, { scrollTop: 600, clientHeight: 717, searching: false })).toBe(600);
  });

  it("durante a busca, a lista é outra: fica a de antes", () => {
    expect(rememberedTreeScroll(600, { scrollTop: 0, clientHeight: 717, searching: true })).toBe(600);
  });

  it("o aviso de rolagem que chega com a lista sem caixa (rolou e escondeu o navegador no mesmo instante, ou foi a outra tela) não é posição: fica a de antes", () => {
    expect(rememberedTreeScroll(885, { scrollTop: 0, clientHeight: 0, searching: false })).toBe(885);
  });
});
