import { describe, expect, it, vi } from "vitest";

import { createPreferencesStore, defaultPreferences, gridZoomSteps, parseNullText, parsePreferences, preferenceLimits, preferencesKey, themeModes, type PreferencesStorage } from "./preferences";

/** O `localStorage` de mentira: um mapa em memória, que também mostra o que foi gravado. */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: PreferencesStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
  return { storage, items };
}

const saved = {
  theme: "light",
  ui: { fontFamily: "Noto Sans" },
  editor: { fontFamily: "Consolas", fontSize: 16, tabSize: 2, autocomplete: false, uppercaseKeywords: true },
  results: { nullText: "∅", autoLoadMore: true, showColumnTypes: false, gridZoom: 125 },
  security: { lockEnabled: false, lockAfterMinutes: 45 },
};

describe("o padrão das preferências", () => {
  it("é o do canvas e o combinado com as outras frentes (segunda leva): resultados, segurança e as duas chaves novas do editor", () => {
    expect(defaultPreferences).toEqual({
      theme: "dark",
      ui: { fontFamily: "IBM Plex Sans" },
      editor: { fontFamily: "IBM Plex Mono", fontSize: 13, tabSize: 4, autocomplete: true, uppercaseKeywords: false },
      results: { nullText: "NULL", autoLoadMore: false, showColumnTypes: true, gridZoom: 100 },
      security: { lockEnabled: true, lockAfterMinutes: 10 },
    });
  });

  it("não se altera por engano: o padrão é compartilhado por todo mundo que ainda não escolheu nada", () => {
    expect(Object.isFrozen(defaultPreferences)).toBe(true);
    for (const group of [defaultPreferences.ui, defaultPreferences.editor, defaultPreferences.results, defaultPreferences.security]) expect(Object.isFrozen(group)).toBe(true);
  });
});

describe("a leitura tolerante", () => {
  it("sem nada gravado, vale o padrão", () => {
    expect(parsePreferences(null)).toEqual(defaultPreferences);
  });

  it.each(["", "{", "não é JSON", "[]", "null", "42", '"escuro"', "true"])("%j não é um objeto de preferências: vale o padrão, sem lançar", (raw) => {
    expect(parsePreferences(raw)).toEqual(defaultPreferences);
  });

  it("lê o que foi gravado", () => {
    expect(parsePreferences(JSON.stringify(saved))).toEqual(saved);
  });

  it.each(themeModes)("lê o tema %s (os seis do canvas e 'seguir o sistema')", (theme) => {
    expect(parsePreferences(JSON.stringify({ theme })).theme).toBe(theme);
  });

  it("os modos de tema são os seis do canvas e o do sistema, e o padrão é o Prism Escuro", () => {
    expect([...themeModes].sort()).toEqual(["dark", "dracula", "github-light", "light", "monokai", "nord", "system"]);
    expect(defaultPreferences.theme).toBe("dark");
  });

  it("cada campo fora do esquema volta ao padrão dele, e os outros, do mesmo grupo e dos outros, ficam como estão", () => {
    const raw = JSON.stringify({ ...saved, editor: { ...saved.editor, fontFamily: 'Comic Sans"; color: red', fontSize: 99 }, results: { nullText: "x".repeat(13), autoLoadMore: true } });

    expect(parsePreferences(raw)).toEqual({
      ...saved,
      editor: { ...saved.editor, fontFamily: "IBM Plex Mono", fontSize: 13 },
      results: { nullText: "NULL", autoLoadMore: true, showColumnTypes: true, gridZoom: 100 },
    });
  });

  it.each([
    ["tema desconhecido", { theme: "sepia" }, ["theme"]],
    ["tema que não é texto", { theme: 1 }, ["theme"]],
    // RN-CONFIG-008: qualquer fonte instalada vale, mas o nome vira CSS: o que escaparia da `font-family` não passa (fonts.test.ts tem a lista inteira).
    ["fonte do editor com aspas", { editor: { fontFamily: 'Mono", x' } }, ["editor", "fontFamily"]],
    ["fonte do editor com chave", { editor: { fontFamily: "Mono}" } }, ["editor", "fontFamily"]],
    ["fonte do editor vazia", { editor: { fontFamily: "" } }, ["editor", "fontFamily"]],
    ["fonte do editor que não é texto", { editor: { fontFamily: 12 } }, ["editor", "fontFamily"]],
    ["fonte da interface com ponto e vírgula", { ui: { fontFamily: "Inter; color: red" } }, ["ui", "fontFamily"]],
    ["fonte da interface com barra invertida", { ui: { fontFamily: "Inter\\" } }, ["ui", "fontFamily"]],
    ["fonte da interface com quebra de linha", { ui: { fontFamily: "Inter\nX" } }, ["ui", "fontFamily"]],
    ["fonte da interface nula", { ui: { fontFamily: null } }, ["ui", "fontFamily"]],
    ["tamanho de fonte abaixo do mínimo", { editor: { fontSize: 9 } }, ["editor", "fontSize"]],
    ["tamanho de fonte acima do máximo", { editor: { fontSize: 25 } }, ["editor", "fontSize"]],
    ["tamanho de fonte quebrado", { editor: { fontSize: 12.5 } }, ["editor", "fontSize"]],
    ["tamanho de fonte em texto", { editor: { fontSize: "14" } }, ["editor", "fontSize"]],
    ["tamanho de fonte nulo", { editor: { fontSize: null } }, ["editor", "fontSize"]],
    ["tabulação zero", { editor: { tabSize: 0 } }, ["editor", "tabSize"]],
    ["tabulação acima do máximo", { editor: { tabSize: 9 } }, ["editor", "tabSize"]],
    ["tabulação negativa", { editor: { tabSize: -4 } }, ["editor", "tabSize"]],
    ["autocompletar que não é booleano", { editor: { autocomplete: "sim" } }, ["editor", "autocomplete"]],
    ["maiúsculas que não é booleano", { editor: { uppercaseKeywords: 1 } }, ["editor", "uppercaseKeywords"]],
    ["texto do nulo vazio", { results: { nullText: "" } }, ["results", "nullText"]],
    ["texto do nulo só de espaços", { results: { nullText: "   " } }, ["results", "nullText"]],
    ["texto do nulo com 13 caracteres", { results: { nullText: "1234567890123" } }, ["results", "nullText"]],
    ["texto do nulo com quebra de linha", { results: { nullText: "a\nb" } }, ["results", "nullText"]],
    ["texto do nulo com caractere de direção de texto", { results: { nullText: "‮LLUN" } }, ["results", "nullText"]],
    ["texto do nulo que não é texto", { results: { nullText: 0 } }, ["results", "nullText"]],
    ["buscar mais ao rolar que não é booleano", { results: { autoLoadMore: "true" } }, ["results", "autoLoadMore"]],
    ["tipo no cabeçalho que não é booleano", { results: { showColumnTypes: "false" } }, ["results", "showColumnTypes"]],
    ["tipo no cabeçalho nulo", { results: { showColumnTypes: null } }, ["results", "showColumnTypes"]],
    ["zoom da grade fora dos passos", { results: { gridZoom: 68 } }, ["results", "gridZoom"]],
    ["zoom da grade abaixo de 50%", { results: { gridZoom: 25 } }, ["results", "gridZoom"]],
    ["zoom da grade acima de 200%", { results: { gridZoom: 300 } }, ["results", "gridZoom"]],
    ["zoom da grade em texto", { results: { gridZoom: "100" } }, ["results", "gridZoom"]],
    ["zoom da grade como fator", { results: { gridZoom: 1.5 } }, ["results", "gridZoom"]],
    ["bloqueio ligado que não é booleano", { security: { lockEnabled: 0 } }, ["security", "lockEnabled"]],
    ["minutos do bloqueio zero", { security: { lockAfterMinutes: 0 } }, ["security", "lockAfterMinutes"]],
    ["minutos do bloqueio acima de 240", { security: { lockAfterMinutes: 241 } }, ["security", "lockAfterMinutes"]],
    ["minutos do bloqueio quebrados", { security: { lockAfterMinutes: 10.5 } }, ["security", "lockAfterMinutes"]],
    ["minutos do bloqueio em texto", { security: { lockAfterMinutes: "10" } }, ["security", "lockAfterMinutes"]],
  ] as const)("%s volta ao padrão", (_name, value, path) => {
    const read = (preferences: object) => path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], preferences);

    expect(read(parsePreferences(JSON.stringify(value)))).toBe(read(defaultPreferences));
  });

  it("um grupo que não é objeto vale o padrão do grupo inteiro, e os outros grupos seguem", () => {
    for (const bad of [5, "x", null, [], true]) {
      const parsed = parsePreferences(JSON.stringify({ ...saved, results: bad }));

      expect(parsed.results).toEqual(defaultPreferences.results);
      expect(parsed.editor).toEqual(saved.editor);
      expect(parsed.security).toEqual(saved.security);
    }
  });

  it("campo que falta vale o padrão, e o que sobra, dentro dos grupos ou fora deles, é descartado", () => {
    const parsed = parsePreferences(JSON.stringify({ theme: "system", senha: "segredo", extra: { a: 1 }, results: { nullText: "—", token: "x" } }));

    expect(parsed).toEqual({ ...defaultPreferences, theme: "system", results: { ...defaultPreferences.results, nullText: "—" } });
    expect(Object.keys(parsed).sort()).toEqual(["editor", "results", "security", "theme", "ui"]);
    expect(Object.keys(parsed.results).sort()).toEqual(["autoLoadMore", "gridZoom", "nullText", "showColumnTypes"]);
  });

  it("aceita os limites do esquema", () => {
    expect(parsePreferences(JSON.stringify({ editor: { fontSize: 10, tabSize: 1 }, security: { lockAfterMinutes: 1 } }))).toMatchObject({ editor: { fontSize: 10, tabSize: 1 }, security: { lockAfterMinutes: 1 } });
    expect(parsePreferences(JSON.stringify({ editor: { fontSize: 24, tabSize: 8 }, security: { lockAfterMinutes: 240 } }))).toMatchObject({ editor: { fontSize: 24, tabSize: 8 }, security: { lockAfterMinutes: 240 } });
    expect(parsePreferences(JSON.stringify({ results: { nullText: "123456789012" } })).results.nullText).toBe("123456789012");
    expect(parsePreferences(JSON.stringify({ results: { nullText: "[NULL]" } })).results.nullText).toBe("[NULL]");
  });

  it("a fonte é qualquer uma do sistema (RN-CONFIG-008): o nome da lista passa, e a escolha da lista fixa de antes continua valendo", () => {
    for (const name of ["Cascadia Mono", "Consolas", "JetBrains Mono", "Fira Code", "Noto Sans Mono CJK JP"]) expect(parsePreferences(JSON.stringify({ editor: { fontFamily: name } })).editor.fontFamily).toBe(name);
    expect(parsePreferences(JSON.stringify({ ui: { fontFamily: "Ubuntu" } })).ui.fontFamily).toBe("Ubuntu");
  });

  describe("as preferências da primeira versão (campos soltos do editor)", () => {
    it("o que o usuário já tinha escolhido não se perde: editorFontFamily, editorFontSize e editorTabSize viram o grupo editor", () => {
      const legacy = JSON.stringify({ theme: "light", editorFontFamily: "Consolas", editorFontSize: 18, editorTabSize: 2 });

      expect(parsePreferences(legacy)).toEqual({ ...defaultPreferences, theme: "light", editor: { ...defaultPreferences.editor, fontFamily: "Consolas", fontSize: 18, tabSize: 2 } });
    });

    it("cada campo solto fora do esquema volta ao padrão, e os que passam ficam", () => {
      const legacy = JSON.stringify({ editorFontFamily: "Papyrus;", editorFontSize: 16 });

      expect(parsePreferences(legacy).editor).toEqual({ ...defaultPreferences.editor, fontSize: 16 });
    });

    it("com o grupo novo presente, os campos soltos são ignorados", () => {
      const both = JSON.stringify({ editorFontSize: 18, editor: { fontSize: 20 } });

      expect(parsePreferences(both).editor.fontSize).toBe(20);
    });
  });
});

describe("parseNullText (o que o campo do texto do nulo aceita)", () => {
  it.each(["NULL", "∅", "—", "[NULL]", "nulo", "<null>", "123456789012", "a b"])("aceita %j", (text) => {
    expect(parseNullText(text)).toBe(text);
  });

  it.each(["", " ", "   ", "1234567890123", "a\nb", "a\tb", "‮LLUN", "​"])("recusa %j", (text) => {
    expect(parseNullText(text)).toBeNull();
  });

  // O campo de texto (`maxLength`) e a grade (a largura da coluna) contam unidades UTF-16. O `.max()` do zod conta pontos de código: um emoji valia um aqui e
  // dois no campo, e de 7 a 12 emoji passavam por aqui sem o campo conseguir escrevê-los.
  const emoji = String.fromCodePoint(0x1f600);

  it("conta como o campo de texto, em unidades UTF-16: seis emoji cabem (12 unidades), sete não (14)", () => {
    expect(parseNullText(emoji.repeat(6))).toBe(emoji.repeat(6));
    expect(parseNullText(emoji.repeat(7))).toBeNull();
    expect(parseNullText(emoji.repeat(12))).toBeNull();
    expect(parsePreferences(JSON.stringify({ results: { nullText: emoji.repeat(7) } })).results.nullText).toBe(defaultPreferences.results.nullText);
  });

  it.each(["a", "é", "∅", emoji, `a${emoji}`])("aceita %j se e só se cabe no maxLength do campo, de 1 a 14 repetições", (unit) => {
    for (let count = 1; count <= 14; count++) {
      const text = unit.repeat(count);

      expect(parseNullText(text) !== null, `${count} × ${unit} (${text.length} unidades)`).toBe(text.length <= preferenceLimits.nullText.max);
    }
  });
});

describe("a chave é por usuário do cofre", () => {
  it("usa o nome como a API o grava: sem espaços nas pontas e em minúsculas", () => {
    expect(preferencesKey("Marina.Costa ")).toBe("prism:preferences:marina.costa");
    expect(preferencesKey("marina.costa")).toBe(preferencesKey(" MARINA.COSTA"));
  });

  it("dois usuários não dividem preferências", () => {
    expect(preferencesKey("ana")).not.toBe(preferencesKey("bia"));
  });
});

describe("o armazenamento das preferências", () => {
  it("o que outra janela gravou (RN-ABAS-004) vale aqui: a chave dela sai do que estava guardado, e quem ouve lê de novo", () => {
    const { storage, items } = fakeStorage();
    const store = createPreferencesStore(() => storage);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.get("ana").theme).toBe(defaultPreferences.theme);

    items.set("prism:preferences:ana", JSON.stringify({ ...defaultPreferences, theme: "light" }));
    store.refresh("prism:preferences:ana");
    expect(listener).toHaveBeenCalledOnce();
    expect(store.get("ana").theme).toBe("light");

    store.refresh("outra-coisa");
    expect(listener).toHaveBeenCalledOnce();

    items.clear();
    store.refresh(null);
    expect(store.get("ana")).toEqual(defaultPreferences);
  });

  it("um usuário sem nada gravado recebe o padrão, sempre o mesmo objeto (o gancho depende disso para não redesenhar)", () => {
    const { storage } = fakeStorage();
    const store = createPreferencesStore(() => storage);

    expect(store.get("ana")).toEqual(defaultPreferences);
    expect(store.get("ana")).toBe(store.get("ana"));
  });

  it("grava em JSON sob a chave do usuário e guarda só o que o esquema conhece", () => {
    const { storage, items } = fakeStorage();
    const store = createPreferencesStore(() => storage);

    store.set("ana", { theme: "light", editor: { fontSize: 18 } });

    expect(JSON.parse(items.get("prism:preferences:ana")!)).toEqual({ ...defaultPreferences, theme: "light", editor: { ...defaultPreferences.editor, fontSize: 18 } });
    expect(store.get("ana")).toMatchObject({ theme: "light", editor: { fontSize: 18 } });
  });

  it("uma mudança dentro de um grupo não mexe nos outros campos do grupo nem nos outros grupos", () => {
    const { storage } = fakeStorage();
    const store = createPreferencesStore(() => storage);
    store.set("ana", { results: { nullText: "∅" }, security: { lockAfterMinutes: 30 } });

    store.set("ana", { results: { autoLoadMore: true } });

    expect(store.get("ana").results).toEqual({ ...defaultPreferences.results, nullText: "∅", autoLoadMore: true });
    expect(store.get("ana").security).toEqual({ lockEnabled: true, lockAfterMinutes: 30 });
    expect(store.get("ana").editor).toEqual(defaultPreferences.editor);
  });

  it("uma abertura nova do app lê o que a anterior gravou", () => {
    const { storage } = fakeStorage();
    createPreferencesStore(() => storage).set("ana", { editor: { tabSize: 2 }, security: { lockEnabled: false } });

    const reopened = createPreferencesStore(() => storage).get("ana");

    expect(reopened.editor.tabSize).toBe(2);
    expect(reopened.security.lockEnabled).toBe(false);
  });

  it("o que um usuário muda não aparece para o outro", () => {
    const { storage } = fakeStorage();
    const store = createPreferencesStore(() => storage);

    store.set("ana", { theme: "light", security: { lockAfterMinutes: 5 } });

    expect(store.get("ana").theme).toBe("light");
    expect(store.get("bia").theme).toBe("dark");
    expect(store.get("bia").security.lockAfterMinutes).toBe(10);
    expect(createPreferencesStore(() => storage).get("bia")).toEqual(defaultPreferences);
  });

  it("o nome escrito de outro jeito (caixa, espaços) é o mesmo usuário", () => {
    const { storage } = fakeStorage();
    const store = createPreferencesStore(() => storage);

    store.set("Ana ", { theme: "system" });

    expect(store.get("ana").theme).toBe("system");
  });

  it("um valor que o esquema recusa não é gravado e não muda nada, nem o que veio junto no mesmo pedido", () => {
    const { storage, items } = fakeStorage();
    const store = createPreferencesStore(() => storage);
    store.set("ana", { editor: { fontSize: 20 } });
    const before = items.get("prism:preferences:ana");

    // A tela valida antes, mas o armazenamento não confia nela.
    store.set("ana", { editor: { fontSize: 400 } });
    store.set("ana", { security: { lockAfterMinutes: 0 }, theme: "light" });
    store.set("ana", { results: { nullText: "" } });
    // @ts-expect-error: o tipo já recusa, e o esquema também.
    store.set("ana", { theme: "sepia" });

    expect(store.get("ana").editor.fontSize).toBe(20);
    expect(store.get("ana").theme).toBe("dark");
    expect(store.get("ana").security.lockAfterMinutes).toBe(10);
    expect(store.get("ana").results.nullText).toBe("NULL");
    expect(items.get("prism:preferences:ana")).toBe(before);
  });

  it("a fonte com nome que escaparia do CSS não é gravada (RN-CONFIG-008), e a que pode virar CSS é", () => {
    const { storage, items } = fakeStorage();
    const store = createPreferencesStore(() => storage);

    store.set("ana", { ui: { fontFamily: 'Inter"; } body { display: none } x {"' } });
    store.set("ana", { editor: { fontFamily: "Mono\\" } });
    expect(items.has("prism:preferences:ana")).toBe(false);

    store.set("ana", { ui: { fontFamily: "Inter" }, editor: { fontFamily: "Fira Code" } });
    expect(JSON.parse(items.get("prism:preferences:ana")!)).toMatchObject({ ui: { fontFamily: "Inter" }, editor: { fontFamily: "Fira Code" } });
  });

  it("o que está gravado e é lixo vale o padrão, e a próxima gravação o conserta", () => {
    const { storage, items } = fakeStorage({ "prism:preferences:ana": "{ isso não é json" });
    const store = createPreferencesStore(() => storage);

    expect(store.get("ana")).toEqual(defaultPreferences);

    store.set("ana", { editor: { fontSize: 15 } });

    expect(JSON.parse(items.get("prism:preferences:ana")!)).toMatchObject({ editor: { fontSize: 15 } });
  });

  it("o que a primeira versão gravou (campos soltos) é lido, e a próxima gravação passa para o formato novo", () => {
    const { storage, items } = fakeStorage({ "prism:preferences:ana": JSON.stringify({ theme: "light", editorFontSize: 18, editorTabSize: 2 }) });
    const store = createPreferencesStore(() => storage);

    expect(store.get("ana")).toMatchObject({ theme: "light", editor: { fontSize: 18, tabSize: 2 } });

    store.set("ana", { results: { autoLoadMore: true } });

    expect(JSON.parse(items.get("prism:preferences:ana")!)).toEqual({ ...defaultPreferences, theme: "light", editor: { ...defaultPreferences.editor, fontSize: 18, tabSize: 2 }, results: { ...defaultPreferences.results, autoLoadMore: true } });
  });

  it("avisa quem assinou a cada mudança, e só enquanto assina", () => {
    const { storage } = fakeStorage();
    const store = createPreferencesStore(() => storage);
    const listener = vi.fn();

    const stop = store.subscribe(listener);
    store.set("ana", { theme: "light" });
    store.set("ana", { editor: { tabSize: 8 } });
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    store.set("ana", { editor: { tabSize: 2 } });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("não avisa nem muda o objeto quando o valor gravado é o que já estava", () => {
    const { storage } = fakeStorage();
    const store = createPreferencesStore(() => storage);
    store.set("ana", { editor: { fontSize: 14 } });
    const before = store.get("ana");
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("ana", { editor: { fontSize: 14 } });
    store.set("ana", { editor: {} });
    store.set("ana", {});

    expect(listener).not.toHaveBeenCalled();
    expect(store.get("ana")).toBe(before);
  });

  it("sem armazenamento (sem localStorage, ou ele recusa o acesso) as preferências vivem na memória da sessão", () => {
    for (const getStorage of [() => null, () => { throw new Error("SecurityError"); }]) {
      const store = createPreferencesStore(getStorage);

      expect(store.get("ana")).toEqual(defaultPreferences);
      store.set("ana", { editor: { fontSize: 20 } });
      expect(store.get("ana").editor.fontSize).toBe(20);
    }
  });

  it("um armazenamento que falha ao ler ou ao gravar (cota, bloqueio) não derruba a tela", () => {
    const broken: PreferencesStorage = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("cota excedida");
      },
    };
    const store = createPreferencesStore(() => broken);

    expect(() => store.get("ana")).not.toThrow();
    expect(() => store.set("ana", { theme: "light" })).not.toThrow();
    expect(store.get("ana").theme).toBe("light");
  });
});

describe("o tipo de dado no cabeçalho das colunas (RN-CONFIG-006)", () => {
  it("é ligado por padrão, e quem nunca escolheu (o que foi gravado antes desta preferência existir) o vê ligado", () => {
    expect(defaultPreferences.results.showColumnTypes).toBe(true);
    expect(parsePreferences(JSON.stringify({ results: { nullText: "∅", autoLoadMore: true } })).results).toEqual({ ...defaultPreferences.results, nullText: "∅", autoLoadMore: true });
  });

  it("desligado, fica desligado ao abrir de novo, sem mexer no resto do grupo", () => {
    const { storage } = fakeStorage();
    const store = createPreferencesStore(() => storage);
    store.set("ana", { results: { nullText: "∅" } });

    store.set("ana", { results: { showColumnTypes: false } });

    expect(createPreferencesStore(() => storage).get("ana").results).toEqual({ ...defaultPreferences.results, nullText: "∅", showColumnTypes: false });
  });
});

describe("o zoom da grade (RN-GRADE-010)", () => {
  it("é 100% por padrão (o tamanho de antes), e quem nunca escolheu fica em 100%", () => {
    expect(defaultPreferences.results.gridZoom).toBe(100);
    expect(parsePreferences(JSON.stringify({ results: { nullText: "∅" } })).results.gridZoom).toBe(100);
  });

  it.each(gridZoomSteps)("lê o passo %i%%", (zoom) => {
    expect(parsePreferences(JSON.stringify({ results: { gridZoom: zoom } })).results.gridZoom).toBe(zoom);
  });

  it("é um só para o usuário, lembrado ao abrir de novo, e um valor fora dos passos não é gravado", () => {
    const { storage } = fakeStorage();
    const store = createPreferencesStore(() => storage);

    store.set("ana", { results: { gridZoom: 150 } });
    // @ts-expect-error: o tipo já recusa, e o esquema também.
    store.set("ana", { results: { gridZoom: 151 } });

    expect(createPreferencesStore(() => storage).get("ana").results.gridZoom).toBe(150);
    expect(store.get("bia").results.gridZoom).toBe(100);
  });
});
