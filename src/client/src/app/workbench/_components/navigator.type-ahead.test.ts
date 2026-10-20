import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvironmentLookup } from "@/app/connections/_lib/environment";

import { navKey, type NavNode, type NavPath } from "../_lib/navigator-model";

// A árvore do navegador com os ganchos do React simulados (`createHookRuntime`) e a lista virtual de mentira: o que se confere AQUI é o teclado de ir ao item
// pelas primeiras letras (RN-ARVORE-009): a tecla move o foco e a escolha, rola até a linha que a lista ainda não desenhou, e as teclas de antes seguem
// como eram. As decisões (o texto, o tempo, a letra repetida, os acentos) são de `type-ahead.test.ts`; o gancho é de `use-type-ahead.test.ts`. Sem DOM, a
// "rolagem" é um elemento falso que acha só as linhas desenhadas, e o foco é uma lista de índices.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    /** As linhas que a lista virtual desenha (`null`: todas). */
    drawn: null as number[] | null,
    scrollToIndex: vi.fn(),
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => index).filter((index) => rt.drawn === null || rt.drawn.includes(index)).map((index) => ({ index, key: index, start: index * 28 })),
    getTotalSize: () => count * 28,
    scrollToIndex: rt.scrollToIndex,
    measureElement: () => {},
  }),
}));

import { elementsOf } from "@/lib/testing/react-tree";

import { NavigatorList } from "./navigator";
import { NavigatorRow } from "./navigator-row";
import { TypeAheadIndicator } from "./type-ahead-indicator";

const node = (path: NavPath | string, kind: NavNode["kind"], label: string, depth: number, extra: Partial<NavNode> = {}): NavNode => ({ key: typeof path === "string" ? path : navKey(path), kind, label, depth, hasChildren: false, ...extra });
const table = (name: string) => node({ type: "table", connectionId: "c1", schema: "public", table: name }, "table", name, 3);

// stock_manager › usr_migration_stock_manager › Tabelas › as tabelas (o índice de cada linha está no comentário).
const names = ["batch_pallet_items", "batch_pallets", "batch_produced_stock_pallet_items", "batch_products", "customers", "Ética", "orders", "order_items"];
const rows: NavNode[] = [
  node({ type: "connection", connectionId: "c1" }, "connection", "stock_manager", 0, { hasChildren: true }), // 0
  node({ type: "database", connectionId: "c1", database: "usr_migration_stock_manager" }, "database", "usr_migration_stock_manager", 1, { hasChildren: true, badge: "padrão" }), // 1
  node({ type: "objects", connectionId: "c1", database: "usr_migration_stock_manager", schema: "public", objects: "tables" }, "group", "Tabelas", 2, { hasChildren: true, detail: "70" }), // 2
  ...names.map(table), // 3 a 10
];
const row = (name: string) => rows.findIndex((candidate) => candidate.label === name);
const keyOf = (name: string) => rows[row(name)].key;

/** O que o `NavigatorList` recebe: tudo de mentira, menos o que cada teste confere. */
const handlers = () => ({ onSelect: vi.fn(), onToggle: vi.fn(), onOpenTable: vi.fn(), onKeyAction: vi.fn(), onContextMenu: vi.fn(() => true), onRetry: vi.fn() });
let calls = handlers();
let list = rows;

const props = () => ({
  rows: list,
  density: "comfortable" as const,
  open: new Set(rows.slice(0, 3).map((candidate) => candidate.key)),
  connectionById: new Map(),
  environments: { folder: () => null, connection: () => null } as unknown as EnvironmentLookup,
  folderColors: new Map(),
  readOnlyHints: new Map(),
  statuses: new Map(),
  checks: new Map(),
  onCheckFailure: vi.fn(),
  disconnecting: null,
  onRefresh: vi.fn(),
  onNewQuery: vi.fn(),
  onDisconnect: vi.fn(),
  searching: false,
  scrollResetKey: "",
  selectedKey: null,
  reveal: null,
  ...calls,
});

/** O que o teclado deixou: os índices que receberam o foco, na ordem. */
let focused: number[] = [];
/** Os quadros de animação pedidos, que o teste roda quando quer. */
let frames: (() => void)[] = [];
/** Quantas vezes a própria árvore recebeu o foco (onde ele espera a linha de um salto longo ser desenhada). */
let treeFocused = 0;
const scrollElement = () => ({
  focus: () => treeFocused++,
  querySelector: (selector: string) => {
    const index = /data-index="(\d+)"\] \[data-row-toggle\]/.exec(selector)?.[1];
    if (index === undefined || (rt.drawn !== null && !rt.drawn.includes(Number(index)))) return null;
    return { focus: () => focused.push(Number(index)) };
  },
});

function mount() {
  const tree = rt.render(() => NavigatorList(props()));
  (elementsOf(tree).find((element) => element.props.role === "tree")!.props as { ref: { current: unknown } }).ref.current = scrollElement();
  return tree;
}

/** Renderiza de novo (o que o React faria depois do `setShown`) e devolve a linha `index` e o indicador. */
function screen() {
  const tree = rt.render(() => NavigatorList(props()));
  const found = elementsOf(tree).filter((element) => element.type === NavigatorRow);
  return { rows: found, indicator: elementsOf(tree).find((element) => element.type === TypeAheadIndicator)!.props.shown as { text: string; found: boolean } | null };
}

const keyEvent = (key: string, modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) => ({
  key,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...modifiers,
  nativeEvent: { isComposing: false },
  preventDefault: vi.fn(),
  currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 40 }) },
});

/** Pressiona a tecla na linha `index` e devolve o evento, para ver se a árvore o consumiu. */
function press(index: number, key: string, modifiers?: Parameters<typeof keyEvent>[1]) {
  const target = screen().rows[index];
  const event = keyEvent(key, modifiers);
  (target.props.onKeyDown as (event: unknown, node: NavNode, index: number) => void)(event, target.props.node as NavNode, index);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  rt.drawn = null;
  rt.scrollToIndex.mockClear();
  calls = handlers();
  list = rows;
  focused = [];
  treeFocused = 0;
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mount();
});

afterEach(() => {
  rt.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a árvore do navegador: ir ao item pelas primeiras letras (RN-ARVORE-009)", () => {
  it("uma letra leva a escolha e o foco ao próximo item que começa por ela, e a tecla é da árvore", () => {
    const event = press(row("batch_pallet_items"), "c");

    expect(calls.onSelect).toHaveBeenCalledWith(keyOf("customers"));
    expect(focused).toEqual([row("customers")]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("do último que começa pela letra, volta ao primeiro da árvore", () => {
    press(row("batch_products"), "b");

    expect(calls.onSelect).toHaveBeenCalledWith(keyOf("batch_pallet_items"));
    expect(focused).toEqual([row("batch_pallet_items")]);
  });

  it("a letra repetida percorre um a um os itens que começam por ela", () => {
    press(row("customers"), "b");
    press(row("batch_pallet_items"), "b");
    press(row("batch_pallets"), "b");

    expect(calls.onSelect.mock.calls.map(([key]) => key)).toEqual(["batch_pallet_items", "batch_pallets", "batch_produced_stock_pallet_items"].map(keyOf));
  });

  it("as letras seguidas (até 1 s uma da outra) formam o texto, que leva ao item que começa por ele todo", () => {
    let at = row("customers");
    for (const key of [..."batch_pr"]) {
      press(at, key);
      at = focused.at(-1) ?? at;
      vi.advanceTimersByTime(300);
    }

    expect(calls.onSelect).toHaveBeenLastCalledWith(keyOf("batch_produced_stock_pallet_items"));
    expect(focused.at(-1)).toBe(row("batch_produced_stock_pallet_items"));
    expect(screen().indicator).toEqual({ text: "batch_pr", found: true });
  });

  it("passado 1 segundo sem tecla, o texto recomeça e o indicador some", () => {
    press(row("customers"), "o");
    expect(screen().indicator).toEqual({ text: "o", found: true });

    vi.advanceTimersByTime(1000);
    expect(screen().indicator).toBeNull();

    press(focused.at(-1)!, "c");
    expect(screen().indicator).toEqual({ text: "c", found: true });
    expect(focused.at(-1)).toBe(row("customers"));
  });

  it("ignora maiúsculas e acentos: o `e` acha a `Ética`", () => {
    press(row("customers"), "e");

    expect(focused).toEqual([row("Ética")]);
  });

  it("o item de um grupo, de um banco e da conexão também se acha pelo nome que mostram, sem o selo nem a contagem", () => {
    press(row("batch_pallets"), "t");
    vi.advanceTimersByTime(1100);
    press(row("Tabelas"), "u");
    vi.advanceTimersByTime(1100);
    press(row("usr_migration_stock_manager"), "s");

    expect(focused).toEqual([row("Tabelas"), row("usr_migration_stock_manager"), row("stock_manager")]);
  });

  it("sem item que comece pelo texto, o foco e a escolha ficam onde estão, e o indicador diz que não há", () => {
    press(row("customers"), "x");

    expect(focused).toEqual([]);
    expect(calls.onSelect).not.toHaveBeenCalled();
    expect(screen().indicator).toEqual({ text: "x", found: false });
  });

  it("o item fora das linhas desenhadas: a lista rola até ele, a escolha vai já e o foco vem quando a linha existe", () => {
    rt.drawn = [0, 1, 2, 3, 4];

    press(row("batch_pallet_items"), "o");

    expect(calls.onSelect).toHaveBeenCalledWith(keyOf("orders"));
    expect(rt.scrollToIndex).toHaveBeenCalledWith(row("orders"), { align: "auto" });
    expect(focused).toEqual([]);

    // O primeiro quadro ainda não tem a linha: pede a rolagem de novo. No segundo, ela já está na lista.
    frames.shift()!();
    expect(focused).toEqual([]);
    rt.drawn = [8, 9, 10];
    frames.shift()!();
    expect(focused).toEqual([row("orders")]);
    expect(frames).toHaveLength(0);
  });

  it("no salto longo o foco espera na árvore, e a tecla desse intervalo segue o texto a partir do destino, sem se perder", () => {
    rt.drawn = [0, 1, 2, 3, 4];
    press(row("batch_pallet_items"), "o");
    expect(treeFocused).toBe(1);
    expect(focused).toEqual([]);

    // Antes de a linha de `orders` existir, o foco está na árvore, e a segunda letra (`or`: ainda `orders`, o atual incluído) chega a ela.
    const element = scrollElement();
    const event = { ...keyEvent("r"), target: element, currentTarget: element };
    const tree = elementsOf(rt.render(() => NavigatorList(props()))).find((element) => element.props.role === "tree")!;
    (tree.props.onKeyDown as (event: unknown) => void)(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(screen().indicator).toEqual({ text: "or", found: true });
    expect(calls.onSelect).toHaveBeenLastCalledWith(keyOf("orders"));

    rt.drawn = [8, 9, 10];
    frames.shift()!();
    expect(focused).toEqual([row("orders")]);
  });

  it("a linha já desenhada recebe o foco direto: a árvore não o segura, e a tecla dela volta a ser só o menu", () => {
    press(row("batch_pallet_items"), "o");

    expect(treeFocused).toBe(0);
    expect(focused).toEqual([row("orders")]);

    const element = scrollElement();
    const event = { ...keyEvent("d"), target: element, currentTarget: element };
    const tree = elementsOf(rt.render(() => NavigatorList(props()))).find((element) => element.props.role === "tree")!;
    (tree.props.onKeyDown as (event: unknown) => void)(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("o Ctrl, o Alt e o Cmd com a letra não fazem nada: o Ctrl+F e os atalhos seguem como são", () => {
    for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const event = press(row("batch_pallet_items"), "c", modifiers);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }

    expect(calls.onSelect).not.toHaveBeenCalled();
    expect(focused).toEqual([]);
    expect(screen().indicator).toBeNull();
  });

  it("a letra no meio da composição de um acento não vale", () => {
    const target = screen().rows[row("batch_pallet_items")];
    const event = { ...keyEvent("c"), nativeEvent: { isComposing: true } };
    (target.props.onKeyDown as (event: unknown, node: NavNode, index: number) => void)(event, target.props.node as NavNode, row("batch_pallet_items"));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(focused).toEqual([]);
  });

  it("o Espaço sozinho faz o que fazia (a árvore não o toma); no meio do texto, entra nele", () => {
    const alone = press(row("customers"), " ");
    expect(alone.preventDefault).not.toHaveBeenCalled();
    expect(screen().indicator).toBeNull();

    press(row("customers"), "o");
    const inside = press(row("orders"), " ");
    expect(inside.preventDefault).toHaveBeenCalled();
    expect(screen().indicator).toEqual({ text: "o ", found: false });
  });

  it("só os itens à vista contam: com o filtro, o que ele esconde não é achado, e nada abre nem se expande", () => {
    list = rows.filter((candidate) => ["stock_manager", "orders", "order_items"].includes(candidate.label));
    mount();

    press(0, "c");
    expect(screen().indicator).toEqual({ text: "c", found: false });
    vi.advanceTimersByTime(1000);

    press(0, "o");
    expect(calls.onSelect).toHaveBeenCalledWith(keyOf("orders"));
    expect(focused).toEqual([1]);
    expect(calls.onToggle).not.toHaveBeenCalled();
    expect(calls.onOpenTable).not.toHaveBeenCalled();
  });

  it("a linha de Carregando… e a de erro não são itens: a mensagem não se acha pela inicial", () => {
    list = [rows[0], node("e1", "error", "Falha ao conectar", 1), node("l1", "loading", "Carregando…", 1), table("fretes")];
    mount();

    press(0, "f");
    expect(focused).toEqual([3]);
    vi.advanceTimersByTime(1100);
    press(3, "c");
    expect(screen().indicator).toEqual({ text: "c", found: false });
  });

  it("o indicador fica sobre a lista, num elemento à parte, e a árvore continua sendo a árvore", () => {
    const tree = rt.render(() => NavigatorList(props()));
    const all = elementsOf(tree);

    expect(all.filter((element) => element.props.role === "tree")).toHaveLength(1);
    expect(all.filter((element) => element.type === TypeAheadIndicator)).toHaveLength(1);
  });
});

describe("as teclas que a árvore já usava seguem como estão (RN-ARVORE-009)", () => {
  it("as setas para baixo e para cima andam entre as linhas, e não são type-ahead", () => {
    const down = press(row("customers"), "ArrowDown");
    const up = press(row("customers"), "ArrowUp");

    expect(focused).toEqual([row("customers") + 1, row("customers") - 1]);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(up.preventDefault).toHaveBeenCalled();
    expect(screen().indicator).toBeNull();
  });

  it("a seta para a direita abre o nó fechado, e a esquerda fecha o aberto", () => {
    list = [rows[0], node({ type: "connection", connectionId: "c2" }, "connection", "outra", 0, { hasChildren: true })];
    mount();

    press(1, "ArrowRight");
    press(0, "ArrowLeft");

    expect(calls.onToggle.mock.calls.map(([target]) => target.key)).toEqual([list[1].key, rows[0].key]);
  });

  it("Enter abre a tabela, F2 renomeia a conexão e a tecla de menu abre o menu", () => {
    press(row("orders"), "Enter");
    expect(calls.onOpenTable).toHaveBeenCalledWith(rows[row("orders")]);

    press(0, "F2");
    expect(calls.onKeyAction).toHaveBeenCalledWith(rows[0], { type: "renameConnection" });

    press(row("orders"), "ContextMenu");
    press(row("orders"), "F10", { shiftKey: true });
    expect(calls.onContextMenu).toHaveBeenCalledTimes(2);
    expect(screen().indicator).toBeNull();
  });

  it("Home, End, Delete e as teclas de função passam sem o type-ahead tomá-las", () => {
    for (const key of ["Home", "End", "Delete", "F5", "Tab", "Escape"]) expect(press(row("orders"), key).preventDefault).not.toHaveBeenCalled();
    expect(screen().indicator).toBeNull();
  });
});
