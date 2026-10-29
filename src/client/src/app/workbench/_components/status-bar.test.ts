import { describe, expect, it, vi } from "vitest";

import type { QueryTab } from "../_lib/workbench-model";

// A barra de status sem DOM: o provedor e as consultas são de mentira, e o que se confere é o texto que ela monta para a aba ativa.
const rt = vi.hoisted(() => ({
  tabs: [] as QueryTab[],
  activeTabId: null as string | null,
  // RN-PROT-002: as proteções que valem para a conexão `c1`, e as pastas de onde elas vêm.
  protections: { readOnly: false, readOnlyFolderID: null, confirmCommands: null, confirmCommandsFolderID: null } as { readOnly: boolean; readOnlyFolderID: string | null; confirmCommands: null; confirmCommandsFolderID: null },
  folders: [] as { id: string; name: string }[],
}));

// RN-TX-003: o executor da aba só é entregue ao `TransactionStatus`, que este teste não desenha.
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ tabs: rt.tabs, activeTabId: rt.activeTabId, runnerOf: () => ({}) }) }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (queryKey[0] === "connections") return { data: [{ id: "c1", name: "MES Produção", database: "mes", engine: 1, environmentName: null, environmentColor: null, protections: rt.protections }] };
    if (queryKey[0] === "folders") return { data: rt.folders };
    return { data: undefined, isSuccess: false };
  },
}));

import { elementsOf } from "@/lib/testing/react-tree";

import { workbenchCopy } from "../_lib/workbench.copy";
import { StatusBar, StatusConnectionState } from "./status-bar";

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

describe("StatusBar: o cadeado da conexão somente leitura (RN-PROT-002)", () => {
  it("a conexão somente leitura mostra “Somente leitura”, com a dica de onde vem; a outra, nada", () => {
    rt.tabs = [{ id: "q1", title: "consulta-1.sql", connectionId: "c1", sessionId: null, sql: "" }];
    rt.activeTabId = "q1";
    const mark = () => elementsOf(StatusBar()).find((element) => typeof element.props.title === "string" && elementsOf(element.props.children as never).some((child) => child.props.children === copy.readOnly));

    expect(mark()).toBeUndefined();

    rt.protections = { readOnly: true, readOnlyFolderID: "f1", confirmCommands: null, confirmCommandsFolderID: null };
    rt.folders = [{ id: "f1", name: "Fábrica" }];
    expect(mark()?.props.title).toBe("Somente leitura, herdado da pasta Fábrica");

    rt.protections = { readOnly: true, readOnlyFolderID: null, confirmCommands: null, confirmCommandsFolderID: null };
    expect(mark()?.props.title).toBe("Somente leitura");
  });
});

describe("StatusBar: a conexão conectada da aba (RN-VERIF-003)", () => {
  it("conectada, o estado é o da verificação (o indicador dela ou, sem ela, o ponto e “Conectada”); desconectada, “Desconectada”", () => {
    rt.tabs = [{ id: "q1", title: "consulta-1.sql", connectionId: "c1", sessionId: "s1", sql: "" }];
    rt.activeTabId = "q1";
    expect(elementsOf(StatusBar()).find((element) => element.type === StatusConnectionState)?.props).toEqual({ connectionId: "c1", name: "MES Produção" });

    rt.tabs = [{ ...rt.tabs[0], sessionId: null }];
    const found = elementsOf(StatusBar());
    expect(found.some((element) => element.type === StatusConnectionState)).toBe(false);
    expect(found.some((element) => element.props.children === copy.disconnected)).toBe(true);
  });
});
