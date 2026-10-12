import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { Column, ForeignKey, TableIndex } from "../../_lib/database-sessions.schema";
import { structureSections, type StructureSection } from "../../_lib/structure-sections";

// A vista Estrutura com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não tem DOM). O que se confere
// AQUI é a ligação, que o teste de `StructureSections` (só de propriedades) não alcança: a seção que a vista abre e entrega à lista, o que ela guarda na memória da
// aba quando a pessoa escolhe outra, e que a escolha não mexe nas consultas, porque a contagem de cada entrada e o DDL dependem das três listas.
//
// A mini-runtime não desce aos filhos: as propriedades do elemento `StructureSections` que a vista devolve são o que ele receberia. A memória das abas
// (`tab-memory.ts`) e o modelo das seções são os de verdade; `useQuery` devolve o que o teste puser em `catalog`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    /** O catálogo: o que cada consulta devolve (`undefined` enquanto não chegou) e o que a vista pediu a `useQuery` em cada renderização. */
    catalog: { columns: undefined as Column[] | undefined, foreignKeys: undefined as ForeignKey[] | undefined, indexes: undefined as TableIndex[] | undefined },
    asked: [] as { queryKey: readonly unknown[]; enabled?: boolean }[],
    queryClient: {},
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    rt.asked.push(options);
    const level = options.queryKey[0] === "table-structure" ? (options.queryKey[4] as "columns" | "foreignKeys" | "indexes") : null;
    return { data: level === null ? undefined : rt.catalog[level], error: null, isError: false, isFetching: false };
  },
  useQueryClient: () => rt.queryClient,
}));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));

import { elementsOf } from "@/lib/testing/react-tree";

import { forgetExcept, recall, remember } from "../../_lib/tab-memory";
import { StructureSections } from "./structure-sections";
import { StructureView } from "./structure-view";

/** PostgreSQL, como a API numera os bancos. */
const pg: Engine = 1;

type Over = { tabId?: string; visible?: boolean };

/** A vista de `loja.pedidos` na conexão `c1`, à vista, na aba `t1` (salvo o que `over` disser). */
function mount(over: Over = {}) {
  const props = { tabId: "t1", connectionId: "c1", engine: pg as Engine | undefined, schema: "loja", name: "pedidos", visible: true, onOpenDiagram: vi.fn(), ...over };

  /** O que a vista entrega AGORA à lista e ao painel: as propriedades de `StructureSections`. Duas voltas, como em `records-view.test.ts`: os efeitos da primeira mexem na memória, e a segunda é o redesenho. */
  function show(change: Over = {}) {
    Object.assign(props, change);
    rt.render(() => StructureView(props));
    const found = elementsOf(rt.render(() => StructureView(props))).find((element) => element.type === StructureSections)!;
    return found.props as unknown as ComponentProps<typeof StructureSections>;
  }

  /** A pessoa escolhe a seção, e a vista se redesenha com ela: é nesse redesenho que o efeito guarda a escolha na memória da aba. */
  function choose(section: StructureSection) {
    show().onSection(section);
    return show();
  }

  return { show, choose };
}

beforeEach(() => {
  rt.catalog.columns = undefined;
  rt.catalog.foreignKeys = undefined;
  rt.catalog.indexes = undefined;
  rt.asked.length = 0;
  // A memória das abas é de módulo: cada teste começa sem nada lembrado.
  forgetExcept(new Set());
});

afterEach(() => rt.unmount());

describe("StructureView: a seção da lista lateral (RN-TABELA-009)", () => {
  it("abre em Colunas quando a aba não lembra de nada", () => {
    expect(mount().show().section).toBe("columns");
  });

  it("abre na seção que a aba lembrava", () => {
    remember("t1", "structure", "foreignKeys");

    expect(mount().show().section).toBe("foreignKeys");
  });

  it("escolher uma seção a troca na hora e a guarda para a aba (pelo id dela)", () => {
    const view = mount();
    expect(view.show().section).toBe("columns");
    expect(recall("t1", "structure")).toBe("columns");

    expect(view.choose("indexes").section).toBe("indexes");
    expect(recall("t1", "structure")).toBe("indexes");
  });

  it("ir a Registros ou ao Diagrama e voltar (a vista desmonta e monta de novo) traz a seção de volta", () => {
    mount().choose("ddl");
    rt.unmount();

    expect(mount().show().section).toBe("ddl");
  });

  it("o bloqueio por inatividade troca os executores, não a memória: uma vista nova da mesma aba abre onde a pessoa estava", () => {
    mount().choose("foreignKeys");
    rt.unmount();

    // O desbloqueio monta a vista de novo, sem tocar na memória (`forgetExcept` só roda quando a LISTA de abas muda).
    expect(mount().show().section).toBe("foreignKeys");
  });

  it("cada aba tem a sua seção: a escolha de uma não vale para a outra", () => {
    mount({ tabId: "a" }).choose("indexes");
    rt.unmount();
    mount({ tabId: "b" }).choose("ddl");
    rt.unmount();

    expect(mount({ tabId: "a" }).show().section).toBe("indexes");
    rt.unmount();
    expect(mount({ tabId: "b" }).show().section).toBe("ddl");
    rt.unmount();
    expect(mount({ tabId: "c" }).show().section).toBe("columns");
  });

  it("fechar a aba esquece a seção: uma aba que abre depois, de outra tabela, começa em Colunas", () => {
    mount({ tabId: "fecha" }).choose("ddl");
    rt.unmount();

    // O provedor chama `forgetExcept` com as abas que sobraram (`workbench-state.tsx`).
    forgetExcept(new Set(["outra"]));

    expect(mount({ tabId: "fecha" }).show().section).toBe("columns");
  });
});

describe("StructureView: escolher a seção não mexe nas consultas", () => {
  const levelsAsked = () => rt.asked.filter((options) => options.queryKey[0] === "table-structure").map((options) => ({ level: options.queryKey[4], enabled: options.enabled }));

  it.each(structureSections)("com %s à frente as três listas do catálogo são pedidas: a contagem das entradas e o DDL dependem das três", (section) => {
    remember("t1", "structure", section);

    mount().show();

    const asked = levelsAsked();
    expect([...new Set(asked.map((options) => options.level))].sort()).toEqual(["columns", "foreignKeys", "indexes"]);
    expect(asked.every((options) => options.enabled === true)).toBe(true);
  });

  it("a aba escondida não pede nada, qualquer que seja a seção (RN-SEG-001)", () => {
    remember("t1", "structure", "foreignKeys");

    mount({ visible: false }).show();

    expect(levelsAsked().length).toBeGreaterThan(0);
    expect(levelsAsked().every((options) => options.enabled === false)).toBe(true);
  });
});

describe("StructureView: o que entrega à lista", () => {
  const column = (name: string, position: number): Column => ({ name, type: "int4", isNullable: false, isPrimaryKey: position === 1, position });

  it("as linhas e o estado de cada seção vêm da própria lista: carregando enquanto não chegou, e a contagem do que chegou", () => {
    const loading = mount().show();
    expect([loading.columns.view.kind, loading.foreignKeys.view.kind, loading.indexes.view.kind]).toEqual(["loading", "loading", "loading"]);

    rt.catalog.columns = [column("id", 1), column("cliente_id", 2)];
    rt.catalog.foreignKeys = [];
    rt.catalog.indexes = [{ name: "pedidos_pkey", columns: ["id"], isUnique: true }];
    const arrived = mount().show();

    expect(arrived.columns.rows.map((row) => row.name)).toEqual(["id", "cliente_id"]);
    expect([arrived.columns.view.kind, arrived.foreignKeys.view.kind, arrived.indexes.view.kind]).toEqual(["ready", "empty", "ready"]);
    expect(arrived.foreignKeys.rows).toEqual([]);
    expect(arrived.indexes.rows).toEqual([{ name: "pedidos_pkey", columns: "id", unique: true }]);
  });
});
