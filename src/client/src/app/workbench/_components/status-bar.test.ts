import { describe, expect, it, vi } from "vitest";

import type { QueryTab } from "../_lib/workbench-model";

// A barra de status sem DOM: o provedor e as consultas são de mentira, e o que se confere é o texto que ela monta para a aba ativa.
const rt = vi.hoisted(() => ({ tabs: [] as QueryTab[], activeTabId: null as string | null }));

vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ tabs: rt.tabs, activeTabId: rt.activeTabId }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[0] === "connections") return { data: [{ id: "c1", name: "MES Produção", database: "mes", engine: 1, environmentName: null, environmentColor: null }] };
    return { data: undefined, isSuccess: false };
  },
}));

import { elementsOf } from "@/lib/testing/react-tree";

import { workbenchCopy } from "../_lib/workbench.copy";
import { StatusBar } from "./status-bar";

const copy = workbenchCopy.status;

/** O texto da conexão da aba ativa, como a barra o escreve. */
function placeText(): string {
  const spans = elementsOf(StatusBar()).filter((element) => Array.isArray(element.props.children));
  return spans.map((element) => (element.props.children as unknown[]).filter((part) => typeof part === "string").join("")).find((text) => text.includes("MES")) ?? "";
}

describe("StatusBar: o banco da aba ativa (RN-ARVORE-007)", () => {
  it("mostra o banco da conexão quando a aba roda nele, e o outro banco quando a aba trocou para ele", () => {
    rt.tabs = [{ id: "q1", title: "consulta-1.sql", connectionId: "c1", sessionId: null, sql: "" }];
    rt.activeTabId = "q1";
    expect(placeText()).toContain(copy.place("MES Produção", "mes"));

    rt.tabs = [{ ...rt.tabs[0], database: "vendas" }];
    expect(placeText()).toContain(copy.place("MES Produção", "vendas"));
  });
});
