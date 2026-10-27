import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { unprotected, type Folder } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";

import type { QueryRunner } from "../../_lib/use-query-runner";
import type { TableTab, TableView } from "../../_lib/workbench-model";

// A cor do ambiente da aba de uma tabela até a área de resultado dos Registros (RN-AMB-002), com os ganchos do React simulados (o vitest deste projeto não tem
// DOM): o que o painel entrega à vista Registros (`environmentColor`), com o ambiente próprio, o herdado da pasta, o sem cor e o de uma aba sem ambiente.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { elementsOf } from "@/lib/testing/react-tree";

import { RecordsView } from "./records-view";
import { TableTabPanel } from "./table-tab";

const panelOf = (TableTabPanel as unknown as { type: (props: ComponentProps<typeof TableTabPanel>) => ReactNode }).type;

const now = "2026-10-27T12:00:00Z";
const producao: Folder = { id: "producao", parentID: null, name: "Produção", environmentName: "Produção", environmentColor: "#FF8A7A", color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };

/** Desenha a aba `t1` na vista dada, com o ambiente dado, e devolve os elementos que ela monta. */
function show(environment: ShownEnvironment | null, view: TableView = "data") {
  const table = { schema: "loja", name: "pedido", view };
  const tab: TableTab = { id: "t1", title: "loja.pedido", connectionId: "c-1", sessionId: null, sql: "", table };
  return elementsOf(rt.render(() => panelOf({ tab, table, runner: {} as QueryRunner, connection: undefined, environment, visible: true, disconnected: false, onView: vi.fn(), onOpenTable: vi.fn() })));
}

/** A cor que a vista Registros recebe: `undefined` é a vista que nem existe (a Estrutura, o Diagrama). */
const colorOf = (environment: ShownEnvironment | null) => show(environment).find((element) => element.type === RecordsView)?.props.environmentColor;

afterEach(() => rt.unmount());

describe("TableTabPanel: a cor do ambiente chega aos Registros (RN-AMB-002)", () => {
  it("o ambiente próprio, com cor: a cor dele", () => {
    expect(colorOf({ name: "PRD", color: "#FF8A7A", folder: null })).toBe("#FF8A7A");
  });

  it("o ambiente herdado da pasta (RN-PASTA-005): a cor dele também chega", () => {
    expect(colorOf({ name: "Produção", color: "#FF8A7A", folder: producao })).toBe("#FF8A7A");
  });

  it("o ambiente só com o nome, e a aba sem ambiente: nula, e os Registros ficam como no tema", () => {
    expect(colorOf({ name: "PRD", color: null, folder: null })).toBeNull();
    expect(colorOf({ name: "Produção", color: null, folder: producao })).toBeNull();
    expect(colorOf(null)).toBeNull();
  });

  it("outra cor, outra prop: o ambiente que muda (ou a aba que passa a outra conexão) troca a cor que os Registros recebem", () => {
    expect(colorOf({ name: "PRD", color: "#FF8A7A", folder: null })).toBe("#FF8A7A");
    expect(colorOf({ name: "QAS", color: "#F2B644", folder: null })).toBe("#F2B644");
    expect(colorOf(null)).toBeNull();
    expect(colorOf({ name: "PRD", color: "#FF8A7A", folder: null })).toBe("#FF8A7A");
  });

  it("a cor chega como está (o texto da lista de conexões); quem confere o formato é a área de resultado, que é quem põe a variável", () => {
    expect(colorOf({ name: "PRD", color: "vermelho", folder: null })).toBe("vermelho");
  });

  it("só a vista Registros tem área de resultado: a Estrutura e o Diagrama não recebem cor nenhuma (ficam de fora, RN-AMB-002)", () => {
    for (const view of ["structure", "diagram"] as const) {
      const found = show({ name: "PRD", color: "#FF8A7A", folder: null }, view);

      expect(found.some((element) => element.type === RecordsView), view).toBe(false);
      expect(found.some((element) => "environmentColor" in element.props), view).toBe(false);
    }
  });
});
