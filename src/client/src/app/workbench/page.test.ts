import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { newVerification, unprotected, type Connection } from "@/app/connections/_lib/connections.schema";
import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { dbeaverStateQuery } from "@/app/connections/_lib/dbeaver.service";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { pathsConfig } from "@/config/paths.config";

import { WorkbenchPage } from "./page";

// O que a página monta e não está em teste aqui: cada peça vira um marcador, para a página desenhar sem API, sem provedor das abas e sem DOM.
vi.mock("@/components/layout/top-bar", () => ({ TopBar: () => createElement("header", { "data-top-bar": "" }) }));
vi.mock("./_components/navigator", () => ({ Navigator: () => createElement("div", { "data-navigator": "" }) }));
vi.mock("./_components/scripts-section", () => ({ ScriptsSection: () => createElement("section", { "data-scripts": "" }) }));
vi.mock("./_components/workbench-tabs", () => ({ WorkbenchTabs: () => createElement("div", { "data-tabs": "" }) }));
vi.mock("./_components/status-bar", () => ({ StatusBar: () => createElement("footer", { "data-status-bar": "" }) }));
vi.mock("./_lib/workbench-state", () => ({ useWorkbench: () => ({ tabs: [], activeTabId: null }) }));

const now = "2026-10-15T12:00:00Z";
const connection: Connection = { id: "c1", folderID: null, name: "MES", engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };

type Setup = { connections?: Connection[]; state?: { invitedAt: string | null; lastImportAt: string | null } };

function render({ connections = [connection], state }: Setup = {}) {
  const client = new QueryClient();
  client.setQueryData(sessionQuery.queryKey, { unlocked: true, userName: "ana" });
  client.setQueryData(foldersQuery.queryKey, []);
  client.setQueryData(connectionsQuery.queryKey, connections);
  if (state !== undefined) client.setQueryData(dbeaverStateQuery.queryKey, state);

  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [pathsConfig.workbench] }, createElement(WorkbenchPage))));
}

describe("a área de trabalho na escala de texto do canvas (RN-CONFIG-009)", () => {
  it("a raiz da página é 13/20 (`text-sm`), e o que não tem tamanho próprio herda daí: o navegador, a seção Scripts e as abas", () => {
    const markup = render();
    const root = /^<div class="([^"]*)">/.exec(markup)?.[1] ?? "";

    expect(root.split(" ")).toContain("text-sm");
    for (const part of ["data-top-bar", "data-navigator", "data-scripts", "data-tabs", "data-status-bar"]) expect(markup).toContain(part);
  });
});

// RN-DBEAVER-001: o "Comece por aqui" no lugar do estado vazio, decidido pelo cofre sem conexão e pelo convite do DBeaver por fazer.
describe("o primeiro uso da área de trabalho (RN-NAV-007 e RN-DBEAVER-001)", () => {
  const panel = 'aria-label="Comece por aqui"';
  const empty = "Nenhuma conexão salva";

  it("sem conexão e com o convite por fazer, o \"Comece por aqui\" ocupa o lugar das abas e do estado vazio", () => {
    const markup = render({ connections: [], state: { invitedAt: null, lastImportAt: null } });

    expect(markup).toContain(panel);
    expect(markup).not.toContain(empty);
    expect(markup).not.toContain("data-tabs");
  });

  it("sem conexão e com o convite feito, fica o estado vazio, com os atalhos para importar", () => {
    const markup = render({ connections: [], state: { invitedAt: "2026-10-20T12:00:00Z", lastImportAt: null } });

    expect(markup).toContain(empty);
    expect(markup).not.toContain(panel);
    expect(markup).toContain("Importar conexões…");
    expect(markup).toContain("Importar do DBeaver…");
  });

  it("enquanto o convite não responde, a área fica vazia: o estado vazio não pisca antes do painel", () => {
    const markup = render({ connections: [] });

    expect(markup).not.toContain(panel);
    expect(markup).not.toContain(empty);
    expect(markup).not.toContain("data-tabs");
  });

  it("com alguma conexão são as abas, convite feito ou não", () => {
    for (const invitedAt of [null, "2026-10-20T12:00:00Z"]) {
      const markup = render({ state: { invitedAt, lastImportAt: null } });
      expect(markup).toContain("data-tabs");
      expect(markup).not.toContain(panel);
    }
  });
});
