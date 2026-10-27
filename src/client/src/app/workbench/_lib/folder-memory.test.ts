import { describe, expect, it, vi } from "vitest";

import { applyFolderChange, createFolderMemoryStore, folderMemoryKey, maxRememberedFolders, noOpenFolders, parseFolderMemory } from "./folder-memory";

/** Identificadores como a API os dá (GUID): o mesmo prefixo, o número no fim. */
const id = (n: number) => `0b1c2d3e-4f50-4a6b-8c7d-${n.toString(16).padStart(12, "0")}`;
const [a, b, c, d] = [id(1), id(2), id(3), id(4)];

describe("parseFolderMemory: o que está gravado pode ser qualquer coisa, e a leitura nunca lança (RN-NAV-014)", () => {
  it("o gravado vale, lista por lista", () => {
    expect(parseFolderMemory(JSON.stringify({ connections: [a, b], scripts: [c] }))).toEqual({ connections: [a, b], scripts: [c] });
    expect(parseFolderMemory(JSON.stringify({ connections: [a] }))).toEqual({ connections: [a], scripts: [] });
  });

  it("nada gravado, JSON quebrado, outra forma ou lista que não é lista: tudo fechado (listas vazias)", () => {
    const none = { connections: [], scripts: [] };
    for (const raw of [null, "", "{", "[]", "1", "null", '"texto"', "{}", '{"connections":"x","scripts":{"a":1}}', '{"connections":null}']) expect(parseFolderMemory(raw)).toEqual(none);
  });

  it("só entra identificador (GUID): o que não é texto, o texto vazio e o que não tem a forma de GUID são ignorados, e o resto fica", () => {
    const raw = JSON.stringify({ connections: [a, 1, null, "", "f1", "abc", `${b}x`, { id: c }, [d], d.toUpperCase()], scripts: ["não"] });

    expect(parseFolderMemory(raw)).toEqual({ connections: [a, d.toUpperCase()], scripts: [] });
  });

  it("sem repetidos: vale a posição mais recente (a última)", () => {
    expect(parseFolderMemory(JSON.stringify({ connections: [a, b, a, c, b] })).connections).toEqual([a, c, b]);
  });

  it("acima de 1.000 por lista ficam os mais recentes (os do fim), em cada lista", () => {
    const many = Array.from({ length: maxRememberedFolders + 5 }, (_, index) => id(index));
    const parsed = parseFolderMemory(JSON.stringify({ connections: many, scripts: many.slice(0, 3) }));

    expect(parsed.connections).toHaveLength(maxRememberedFolders);
    expect(parsed.connections[0]).toBe(many[5]);
    expect(parsed.connections.at(-1)).toBe(many.at(-1));
    expect(parsed.scripts).toEqual(many.slice(0, 3));
  });
});

describe("folderMemoryKey: uma chave por usuário, e a do navegador escondido é outra (RN-NAV-008 e 012)", () => {
  it("o nome como a API o grava, sem espaços nas pontas e em minúsculas, como as chaves vizinhas", () => {
    expect(folderMemoryKey("  Ana.Souza ")).toBe("prism:navigator-folders:ana.souza");
    expect(folderMemoryKey("ana")).not.toBe("prism:navigator:ana");
  });
});

describe("applyFolderChange: abrir, fechar, fechar tudo e podar (RN-NAV-014)", () => {
  const open = new Set([a, b]);

  it("abrir acrescenta as que faltam, no fim (as mais recentes); a que já está aberta não muda nada e devolve o MESMO conjunto", () => {
    expect([...applyFolderChange(open, { open: [c, d] })]).toEqual([a, b, c, d]);
    expect([...applyFolderChange(open, { open: [a, c, c] })]).toEqual([a, b, c]);
    expect(applyFolderChange(open, { open: [a] })).toBe(open);
    expect(applyFolderChange(open, { open: [] })).toBe(open);
  });

  it("fechar tira só as pedidas; a que já está fechada não muda nada e devolve o MESMO conjunto", () => {
    expect([...applyFolderChange(open, { close: [a] })]).toEqual([b]);
    expect([...applyFolderChange(open, { close: [a, c] })]).toEqual([b]);
    expect(applyFolderChange(open, { close: [c] })).toBe(open);
  });

  it("fechar tudo esvazia; com tudo fechado já, é o mesmo conjunto", () => {
    expect(applyFolderChange(open, { closeAll: true }).size).toBe(0);
    expect(applyFolderChange(noOpenFolders, { closeAll: true })).toBe(noOpenFolders);
  });

  it("podar deixa só as que existem; se todas existem, é o mesmo conjunto", () => {
    expect([...applyFolderChange(open, { retain: [b, c] })]).toEqual([b]);
    expect(applyFolderChange(open, { retain: [] }).size).toBe(0);
    expect(applyFolderChange(open, { retain: [a, b, c] })).toBe(open);
  });

  it("passando de 1.000, saem as mais antigas", () => {
    const full = new Set(Array.from({ length: maxRememberedFolders }, (_, index) => id(index)));
    const next = applyFolderChange(full, { open: [id(5000)] });

    expect(next.size).toBe(maxRememberedFolders);
    expect(next.has(id(0))).toBe(false);
    expect(next.has(id(1))).toBe(true);
    expect([...next].at(-1)).toBe(id(5000));
  });
});

describe("createFolderMemoryStore: as pastas abertas lembradas por usuário (RN-NAV-014)", () => {
  function memoryStorage() {
    const items = new Map<string, string>();
    return { items, storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) } };
  }
  const stored = (items: Map<string, string>, user = "ana") => JSON.parse(items.get(folderMemoryKey(user)) ?? "null") as { connections: string[]; scripts: string[] } | null;

  it("nada gravado: tudo fechado, nas duas árvores, e ler não grava", () => {
    const { items, storage } = memoryStorage();
    const store = createFolderMemoryStore(() => storage);

    expect(store.get("ana", "connections").size).toBe(0);
    expect(store.get("ana", "scripts").size).toBe(0);
    expect(items.size).toBe(0);
  });

  it("abrir grava na chave do usuário, avisa quem olha e devolve que mudou; fechar tira; cada usuário tem a sua", () => {
    const { items, storage } = memoryStorage();
    const store = createFolderMemoryStore(() => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.change("ana", "connections", { open: [a, b] })).toBe(true);
    expect([...store.get("ana", "connections")]).toEqual([a, b]);
    expect(stored(items)).toEqual({ connections: [a, b], scripts: [] });
    expect(listener).toHaveBeenCalledOnce();

    expect(store.change("ana", "connections", { close: [a] })).toBe(true);
    expect(stored(items)).toEqual({ connections: [b], scripts: [] });
    expect(store.get("bruno", "connections").size).toBe(0);
    expect(stored(items, "bruno")).toBeNull();
  });

  it("as duas árvores não se misturam: mexer numa não troca o conjunto da outra nem apaga a lista dela", () => {
    const { items, storage } = memoryStorage();
    const store = createFolderMemoryStore(() => storage);

    store.change("ana", "connections", { open: [a] });
    const connections = store.get("ana", "connections");
    store.change("ana", "scripts", { open: [b] });

    expect(store.get("ana", "connections")).toBe(connections);
    expect([...store.get("ana", "scripts")]).toEqual([b]);
    expect(stored(items)).toEqual({ connections: [a], scripts: [b] });

    store.change("ana", "scripts", { closeAll: true });
    expect(stored(items)).toEqual({ connections: [a], scripts: [] });
  });

  it("Recolher tudo e a poda gravam: é isso que volta na próxima entrada", () => {
    const { items, storage } = memoryStorage();
    const store = createFolderMemoryStore(() => storage);
    store.change("ana", "connections", { open: [a, b, c] });

    store.change("ana", "connections", { retain: [a, c, d] });
    expect(stored(items)?.connections).toEqual([a, c]);

    store.change("ana", "connections", { closeAll: true });
    expect(stored(items)?.connections).toEqual([]);
    expect(createFolderMemoryStore(() => storage).get("ana", "connections").size).toBe(0);
  });

  it("o MESMO conjunto enquanto nada muda (é o que o React compara); a mesma escolha de novo não grava nem avisa", () => {
    const { storage } = memoryStorage();
    const setItem = vi.spyOn(storage, "setItem");
    const store = createFolderMemoryStore(() => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.get("ana", "connections")).toBe(store.get("ana", "connections"));
    store.change("ana", "connections", { open: [a] });
    const open = store.get("ana", "connections");
    setItem.mockClear();
    listener.mockClear();

    expect(store.change("ana", "connections", { open: [a] })).toBe(false);
    expect(store.change("ana", "connections", { close: [b] })).toBe(false);
    expect(store.change("ana", "connections", { retain: [a, b] })).toBe(false);
    expect(store.change("ana", "scripts", { closeAll: true })).toBe(false);
    expect(store.get("ana", "connections")).toBe(open);
    expect(setItem).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a assinatura se desfaz", () => {
    const { storage } = memoryStorage();
    const store = createFolderMemoryStore(() => storage);
    const listener = vi.fn();
    store.subscribe(listener)();

    store.change("ana", "connections", { open: [a] });
    expect(listener).not.toHaveBeenCalled();
  });

  it("duas janelas (dois armazéns, o mesmo armazenamento) não desfazem a escolha uma da outra: cada uma grava a mudança sobre o que está gravado agora", () => {
    const { items, storage } = memoryStorage();
    const first = createFolderMemoryStore(() => storage);
    const second = createFolderMemoryStore(() => storage);
    expect(first.get("ana", "connections").size).toBe(0);
    expect(second.get("ana", "connections").size).toBe(0);

    // A abre X; B, que leu antes, abre Y: o gravado tem as duas.
    first.change("ana", "connections", { open: [a] });
    second.change("ana", "connections", { open: [b] });
    expect(stored(items)?.connections).toEqual([a, b]);

    // A fecha X: Y, que só B conhecia, continua.
    first.change("ana", "connections", { close: [a] });
    expect(stored(items)?.connections).toEqual([b]);
  });

  it("a janela aberta fica como está quando a outra muda; a que abre depois começa como a última escolha de cada pasta", () => {
    const { storage } = memoryStorage();
    const first = createFolderMemoryStore(() => storage);
    const second = createFolderMemoryStore(() => storage);
    second.get("ana", "connections");

    first.change("ana", "connections", { open: [a] });
    second.change("ana", "scripts", { open: [c] });

    expect([...first.get("ana", "connections")]).toEqual([a]);
    expect(first.get("ana", "scripts").size).toBe(0);
    expect(second.get("ana", "connections").size).toBe(0);
    const later = createFolderMemoryStore(() => storage);
    expect([...later.get("ana", "connections")]).toEqual([a]);
    expect([...later.get("ana", "scripts")]).toEqual([c]);
  });

  it("lê o que outra abertura gravou, com a chave do usuário normalizada, e ignora o que não é identificador", () => {
    const { items, storage } = memoryStorage();
    items.set("prism:navigator-folders:ana", JSON.stringify({ connections: [a, "f1"], scripts: [b] }));

    const store = createFolderMemoryStore(() => storage);
    expect([...store.get("  ANA ", "connections")]).toEqual([a]);
    expect([...store.get("ana", "scripts")]).toEqual([b]);
  });

  it("o gravado por outra versão da chave do navegador escondido não é lido nem tocado", () => {
    const { items, storage } = memoryStorage();
    items.set("prism:navigator:ana", '{"hidden":true,"scriptsCollapsed":true}');
    const store = createFolderMemoryStore(() => storage);

    store.change("ana", "connections", { open: [a] });
    expect(items.get("prism:navigator:ana")).toBe('{"hidden":true,"scriptsCollapsed":true}');
  });

  it("sem armazenamento, com ele recusando o acesso ou lançando: a escolha vive na memória da sessão, e nada lança", () => {
    const throwing = () => {
      throw new Error("negado");
    };
    for (const getStorage of [() => null, throwing, () => ({ getItem: throwing, setItem: throwing })]) {
      const store = createFolderMemoryStore(getStorage);
      const listener = vi.fn();
      store.subscribe(listener);

      expect(store.get("ana", "connections").size).toBe(0);
      expect(store.change("ana", "connections", { open: [a, b] })).toBe(true);
      expect([...store.get("ana", "connections")]).toEqual([a, b]);
      store.change("ana", "connections", { close: [a] });
      expect([...store.get("ana", "connections")]).toEqual([b]);
      expect(listener).toHaveBeenCalledTimes(2);
    }
  });

  it("o texto gravado quebrado vale como nada gravado, e a primeira escolha o troca por um texto bom", () => {
    const { items, storage } = memoryStorage();
    items.set(folderMemoryKey("ana"), "{quebrado");
    const store = createFolderMemoryStore(() => storage);

    expect(store.get("ana", "connections").size).toBe(0);
    store.change("ana", "connections", { open: [a] });
    expect(stored(items)).toEqual({ connections: [a], scripts: [] });
  });
});
