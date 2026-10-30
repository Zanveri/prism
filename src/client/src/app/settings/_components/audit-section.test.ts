import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";

import { defaultAuditFilters, type AuditFilters } from "../_lib/audit-filters";
import {
  auditEntriesQueryKey,
  auditEntryQueryKey,
  auditFacetsQueryKey,
  auditSettingsQueryKey,
  type AuditEntry,
  type AuditFacets,
  type AuditPage,
} from "../_lib/audit.service";
import { AuditDetail } from "./audit-detail";
import { AuditSection } from "./audit-section";

vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  useToast: () => ({ success() {}, warning() {}, error() {} }),
}));

const sampleFacets: AuditFacets = {
  connections: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "MES Produção",
      deleted: false,
      engine: "postgresql",
      environmentName: "Produção",
      environmentColor: "red",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Legado Antigo",
      deleted: true,
      engine: "informix",
      environmentName: "Homologação",
      environmentColor: "amber",
    },
  ],
  environments: [
    { name: "Produção", color: "red" },
    { name: "Homologação", color: "amber" },
  ],
  count: 48213,
  oldest: "2026-08-01T12:00:00.000Z",
  sizeBytes: 32505856,
  retentionDays: 90,
};

const samplePage: AuditPage = {
  total: 37,
  next: null,
  items: [
    {
      id: 48190,
      startedAt: "2026-10-30T16:48:07.000Z",
      level: "critical",
      kind: "sql",
      action: "DELETE",
      summary: "1.204 linhas · sem WHERE",
      connectionId: "11111111-1111-4111-8111-111111111111",
      connectionName: "MES Produção",
      database: "mes_prod",
      environmentName: "Produção",
      environmentColor: "red",
      outcome: "ok",
      durationMs: 1200,
      rows: 1204,
      scriptRunId: null,
    },
    {
      id: 48189,
      startedAt: "2026-10-30T14:12:44.000Z",
      level: "high",
      kind: "security",
      action: "Senha da conexão revelada",
      summary: "MES Produção",
      connectionId: "22222222-2222-4222-8222-222222222222",
      connectionName: "Legado Antigo",
      database: null,
      environmentName: "Homologação",
      environmentColor: "amber",
      outcome: "ok",
      durationMs: 15,
      rows: null,
      scriptRunId: null,
    },
  ],
};

const sampleEntry: AuditEntry = {
  id: 48190,
  startedAt: "2026-10-30T16:48:07.000Z",
  endedAt: "2026-10-30T16:48:08.200Z",
  durationMs: 1200,
  kind: "sql",
  action: "DELETE",
  level: "critical",
  reason: "DELETE sem WHERE: apaga todas as linhas de producao.apontamento_tmp.",
  summary: "1.204 linhas · sem WHERE",
  outcome: "ok",
  origin: "editor",
  connectionId: "11111111-1111-4111-8111-111111111111",
  connectionName: "MES Produção",
  engine: "postgresql",
  folderPath: "Fábrica",
  environmentName: "Produção",
  environmentColor: "red",
  database: "mes_prod",
  sessionId: "33333333-3333-4333-8333-333333333333",
  scriptRunId: "44444444-4444-4444-8444-444444444444",
  sql: "DELETE FROM producao.apontamento_tmp;\n-- <script>alert(1)</script>",
  historyText: "DELETE FROM producao.apontamento_tmp;\n-- <script>alert(1)</script>",
  rows: 1204,
  errorCode: null,
  sqlState: null,
  errorMessage: null,
  confirmed: true,
  protections: "Confirmar: só irreversíveis · Somente leitura: não",
};

function renderSection(filters: AuditFilters = defaultAuditFilters()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionQuery.queryKey, { unlocked: true, userName: "marina.costa" });
  client.setQueryData(auditFacetsQueryKey, sampleFacets);
  client.setQueryData(auditSettingsQueryKey, { retentionDays: 90 });
  client.setQueryData(auditEntriesQueryKey(filters), {
    pages: [samplePage],
    pageParams: [undefined],
  });
  client.setQueryData(auditEntryQueryKey(48190), sampleEntry);

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryRouter, null, createElement(AuditSection, { anchor: "cfg-auditoria" })),
    ),
  );
}

describe("Configurações › Auditoria (RN-AUDIT-010 a 016)", () => {
  it("mostra o cabeçalho com o usuário do cofre, os contadores, o nível com ícone e nome, o total encontrado e a conexão excluída marcada", () => {
    const html = renderSection();

    expect(html).toContain('id="cfg-auditoria"');
    expect(html).toContain("Tudo o que foi executado e as ações da conta, cifrado no diário de marina.costa.");
    expect(html).toContain("37 registros encontrados");
    // RN-AUDIT-005: nível sempre com ícone e nome (nunca só a cor)
    expect(html).toMatch(/<span aria-hidden="true">◆<\/span><span>Crítico<\/span>/);
    expect(html).toMatch(/<span aria-hidden="true">▲<\/span><span>Alto<\/span>/);
    // RN-AUDIT-011: conexão excluída marcada como "(excluída)"
    expect(html).toContain("Legado Antigo");
    expect(html).toContain("(excluída)");
    // RN-AUDIT-015 e 016: cartão da guarda e botão Apagar registros…
    expect(html).toContain("Guardar os registros por");
    expect(html).toContain("Apagar registros…");
  });

  it("desenha o detalhe do registro com 'Abrir no editor', 'Copiar', motivo, proteções, confirmação e escapa HTML vindo do diário (RN-AUDIT-013 e 014)", () => {
    const html = renderToStaticMarkup(
      createElement(AuditDetail, {
        entry: sampleEntry,
        connectionDeleted: false,
        onClose: () => {},
        onOpenInEditor: () => {},
        onFilterByScriptRun: () => {},
      }),
    );

    expect(html).toContain('aria-label="Detalhe do registro"');
    expect(html).toContain("nº 48.190");
    expect(html).toContain("DELETE sem WHERE: apaga todas as linhas de producao.apontamento_tmp.");
    expect(html).toContain("Confirmar: só irreversíveis · Somente leitura: não");
    expect(html).toContain("Passou pela confirmação");
    expect(html).toContain(">Copiar</button>");
    expect(html).toContain(">Abrir no editor</button>");
    expect(html).toContain("Ver todos deste script");
    // RN-AUDIT-014 / RN-SHELL-002: nunca desenha HTML cru vindo do diário
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
