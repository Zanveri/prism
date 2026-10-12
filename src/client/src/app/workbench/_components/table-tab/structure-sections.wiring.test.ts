import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A Estrutura com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não tem DOM) e o gancho da orientação
// trocado por um que o teste controla. O teste de marcação (`structure-sections.test.ts`) não roda efeito nem troca estado, e por isso não vê a ligação entre a
// Estrutura e a lista: o `ref` que o gancho observa tem de ser o da lista, e a orientação que o gancho lê tem de chegar a ela. Sem isso a lista nunca seria
// observada (ou nunca receberia a orientação), e o `aria-orientation` e as setas ficariam sempre na vertical, com a faixa de cima já desenhada. O que o gancho faz
// com o elemento está em `use-nav-orientation.test.ts`, e que o CSS troca a direção na largura certa é conferido na tela.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    /** O que o gancho devolve agora e o que ele recebeu em cada renderização. */
    orientation: { value: "vertical" as "vertical" | "horizontal" },
    hookArgs: [] as unknown[],
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks, useId: () => "estrutura-1" }));
vi.mock("./use-nav-orientation", () => ({
  useNavOrientation: (ref: unknown) => {
    rt.hookArgs.push(ref);
    return rt.orientation.value;
  },
}));

import { elementsOf } from "@/lib/testing/react-tree";

import { structureColumns, structureForeignKeys, structureIndexes } from "../../_lib/table-structure";
import { StructureNav, structurePanelId, structureTabId } from "./structure-nav";
import { StructureSections } from "./structure-sections";

const noop = () => {};

const props = {
  section: "indexes" as const,
  onSection: vi.fn(),
  columns: { view: { kind: "ready" as const }, rows: structureColumns([{ name: "id", type: "bigint", isNullable: false, isPrimaryKey: true, position: 1 }], undefined) },
  foreignKeys: { view: { kind: "error" as const, message: "negado", sessionLost: false }, rows: structureForeignKeys([], "loja") },
  indexes: { view: { kind: "loading" as const }, rows: structureIndexes([]) },
  ddl: { kind: "loading" as const },
  onCopyDdl: noop,
  fetching: false,
  onRefresh: noop,
  onOpenDiagram: noop,
  onRetry: noop,
};

/** O que a Estrutura entrega à lista AGORA: as propriedades do elemento `StructureNav` que ela devolve. */
function navProps() {
  const found = elementsOf(rt.render(() => StructureSections(props))).find((element) => element.type === StructureNav)!;
  return found.props as unknown as ComponentProps<typeof StructureNav>;
}

afterEach(() => {
  rt.unmount();
  rt.orientation.value = "vertical";
  rt.hookArgs.length = 0;
  vi.clearAllMocks();
});

describe("StructureSections: o que entrega à lista lateral", () => {
  it("a lista recebe a orientação que o gancho lê: vertical ao lado da seção, horizontal na faixa de cima", () => {
    rt.orientation.value = "vertical";
    expect(navProps().orientation).toBe("vertical");

    rt.orientation.value = "horizontal";
    expect(navProps().orientation).toBe("horizontal");
  });

  it("o gancho observa o `ref` que a lista recebe: o mesmo objeto, a cada renderização", () => {
    const first = navProps();
    const second = navProps();

    expect(first.ref).toBeDefined();
    expect(rt.hookArgs.length).toBeGreaterThan(0);
    for (const seen of rt.hookArgs) expect(seen).toBe(first.ref);
    expect(second.ref).toBe(first.ref);
  });

  it("a seção escolhida, a escolha e o id-base chegam à lista, e o painel é rotulado pela entrada dela", () => {
    const nav = navProps();
    const panel = elementsOf(rt.render(() => StructureSections(props))).find((element) => element.props.role === "tabpanel")!;

    expect(nav.selected).toBe("indexes");
    expect(nav.onSelect).toBe(props.onSection);
    expect(nav.idBase).toBe("estrutura-1");
    expect(panel.props.id).toBe(structurePanelId("estrutura-1"));
    expect(panel.props["aria-labelledby"]).toBe(structureTabId("estrutura-1", "indexes"));
  });

  it("cada entrada leva a marca da lista dela: a contagem, o aviso de quem falhou e nada enquanto carrega ou no DDL", () => {
    expect(navProps().entries).toEqual([
      { id: "columns", label: "Colunas", mark: { kind: "count", count: 1 } },
      { id: "foreignKeys", label: "Chaves estrangeiras", mark: { kind: "failed" } },
      { id: "indexes", label: "Índices", mark: { kind: "none" } },
      { id: "ddl", label: "DDL", mark: { kind: "none" } },
    ]);
  });
});
