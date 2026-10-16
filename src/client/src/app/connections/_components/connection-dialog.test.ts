import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { Driver } from "@/app/drivers/_lib/drivers.schema";
import { driversQuery } from "@/app/drivers/_lib/drivers.service";

import { connectionsCopy } from "../_lib/connections.copy";
import { newVerification, unprotected, type Connection, type Folder } from "../_lib/connections.schema";
import { ConnectionDialog, type ConnectionDialogRequest } from "./connection-dialog";

// O `Dialog` de verdade desenha num portal em `document.body`, que o renderizador de servidor não tem: aqui ele só devolve o que receberia
// (título, descrição, corpo e rodapé). O portal dos avisos e o `ApiGate` do reinício também entram como falsos.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, title, description, footer, children }: { open: boolean; title: string; description?: unknown; footer?: unknown; children?: unknown }) =>
    open ? createElement("section", { role: "dialog" }, createElement("h2", null, title), createElement("p", { "data-description": "" }, description as never), createElement("div", { "data-body": "" }, children as never), createElement("footer", null, footer as never)) : null,
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));
vi.mock("@/app/_components/api-gate", () => ({ useApiRestart: () => async () => {} }));

const now = "2026-10-12T12:00:00Z";
const fabrica: Folder = { id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f1", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const mes: Connection = { id: "7d2f9a10-aaaa-4bbb-8ccc-000000000001", folderID: fabrica.id, name: "MES Produção", engine: 2, host: "srv-db2", port: 50000, database: "MES", userName: "mes", hasPassword: true, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };
const license = { name: "Licença", url: "https://exemplo.local/licenca" };
const catalog: Driver[] = [
  { id: "postgresql", name: "PostgreSQL", vendor: "Npgsql", engines: [1], state: "bundled", version: "10.0.3", sizeBytes: null, license: null, platformNote: null, progress: null, error: null, restartRequired: false },
  { id: "ibm-data-server", name: "IBM Data Server", vendor: "IBM", engines: [2, 3], state: "available", version: "12.1.3", sizeBytes: 1, license, platformNote: null, progress: null, error: null, restartRequired: false },
  { id: "sqlite", name: "SQLite", vendor: "SQLite", engines: [], state: "comingSoon", version: null, sizeBytes: null, license: null, platformNote: null, progress: null, error: null, restartRequired: false },
];

function render(request: ConnectionDialogRequest, folders: Folder[] = [fabrica]) {
  const client = new QueryClient();
  client.setQueryData(driversQuery.queryKey, catalog);
  const dialog = createElement(ConnectionDialog, { request, folders, openTabs: () => 0, onClose: () => {}, onSaved: () => {} });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, dialog)));
}

const footerButtons = (markup: string) => [.../<footer>([\s\S]*?)<\/footer>/.exec(markup)?.[1].matchAll(/<button[^>]*>([^<]*)<\/button>/g) ?? []].map((match) => match[1]);
const settingsBlock = (markup: string) => /<div hidden=""[^>]*>|<div class="flex flex-col gap-5">/.exec(markup)?.[0] ?? "";

describe("o diálogo de conexão sobre a área de trabalho (RN-NAV-004 e 005)", () => {
  it("nova conexão: abre na grade de bancos, com a explicação do passo; Avançar espera um banco escolhido", () => {
    const markup = render({ mode: "new", folderID: null });

    expect(markup).toMatch(/<h2>Nova conexão<\/h2>/);
    expect(markup).toContain("Escolha o banco de dados. Depois vêm os dados de acesso.");
    expect(markup).toMatch(/role="radiogroup"[^>]*aria-label="Banco de dados"/);
    expect(footerButtons(markup)).toEqual(["Cancelar", "Avançar"]);
    expect(/<button[^>]*disabled=""[^>]*>Avançar<\/button>/.test(markup)).toBe(true);
  });

  it("os campos já estão montados, escondidos, na grade: voltar para trocar o banco não perde o que foi digitado", () => {
    const markup = render({ mode: "new", folderID: null });

    expect(settingsBlock(markup)).toBe('<div hidden="">');
    expect(markup).toMatch(/<input [^>]*name="name"/);
  });

  it("nova numa pasta (a escolhida no navegador): a pasta já vem no campo", () => {
    expect(render({ mode: "new", folderID: fabrica.id })).toContain(`<input type="hidden" name="folderID" value="${fabrica.id}"/>`);
  });

  it("os 'em breve' do catálogo aparecem na grade, e a nota diz o que são", () => {
    const markup = render({ mode: "new", folderID: null });

    expect(markup).toContain(">SQLite<");
    expect(markup).toContain("Os bancos marcados “Em breve” estão no catálogo, e o Prism ainda não conecta neles.");
  });

  it("edição: abre direto nas configurações, com o nome no título, o banco escolhido à vista, a senha gravada mantida e o rodapé completo", () => {
    const markup = render({ mode: "edit", connection: mes });

    expect(markup).toMatch(/<h2>MES Produção<\/h2>/);
    expect(markup).toContain("Conexão Db2 salva no seu cofre.");
    expect(markup).not.toContain('role="radiogroup"');
    expect(settingsBlock(markup)).toBe('<div class="flex flex-col gap-5">');
    expect(markup).toMatch(/>DB2<\/span>[\s\S]*?>Db2<\/span>[\s\S]*?>Driver não instalado<\/span>/);
    expect(markup).toContain('<input type="hidden" name="engine" value="2"/>');
    expect(markup).toMatch(/<input [^>]*name="port"[^>]*value="50000"/);
    expect(markup).toContain('placeholder="Deixe vazio para manter"');
    expect(footerButtons(markup)).toEqual(["Voltar", "Excluir", "Testar conexão", "Cancelar", "Salvar"]);
  });

  it("o driver do banco escolhido falta: o passo das configurações diz ali mesmo, com 'Instalar driver' (RN-NAV-005)", () => {
    const markup = render({ mode: "edit", connection: mes });

    expect(markup).toContain("O driver IBM Data Server, que atende este banco, não está instalado.");
    expect(markup).toMatch(/<button[^>]*>Instalar driver<\/button>/);
  });

  it("Salvar envia o formulário do diálogo (o botão do rodapé aponta para ele)", () => {
    const markup = render({ mode: "edit", connection: mes });
    const formId = /<form id="([^"]+)"/.exec(markup)?.[1];

    expect(formId).toBeDefined();
    const save = /<button [^>]*>Salvar<\/button>/.exec(markup)?.[0] ?? "";
    expect(save).toContain('type="submit"');
    expect(save).toContain(`form="${formId}"`);
  });

  it("as Proteções (RN-PROT-001 e 002) vêm depois do Ambiente, com as escolhas próprias da conexão nos campos escondidos", () => {
    const markup = render({ mode: "edit", connection: { ...mes, confirmCommands: "irreversible", readOnly: true } });

    expect(markup.indexOf('id="cx-environment-title"')).toBeLessThan(markup.indexOf('id="cx-protections-title"'));
    expect(markup).toContain('<input type="hidden" name="confirmCommands" value="irreversible"/>');
    expect(markup).toContain('<input type="hidden" name="readOnly" value="true"/>');
    expect(markup).toMatch(/<input id="cx-read-only" type="checkbox"(?=[^>]*checked="")/);
    expect(markup).toContain(connectionsCopy.protections.readOnly.connectionHint);
  });

  it("a Sessão da conexão (RN-VERIF-001) vem logo depois dos campos e antes do Ambiente, como na leitura do canvas, com a verificação gravada", () => {
    const markup = render({ mode: "edit", connection: { ...mes, verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT COUNT(*) FROM SYSCAT.TABLES" } });

    expect(markup.indexOf('id="cx-password"')).toBeLessThan(markup.indexOf('id="cx-session-title"'));
    expect(markup.indexOf('id="cx-session-title"')).toBeLessThan(markup.indexOf('id="cx-environment-title"'));
    expect(markup).toContain('<input type="hidden" name="verificationEnabled" value="false"/>');
    expect(markup).toMatch(/<input id="cx-verification-interval"[^>]*name="verificationInterval" value="120"/);
    expect(markup).toMatch(/<textarea id="cx-verification-query" name="verificationQuery"[^>]*placeholder="SELECT 1 FROM SYSIBM.SYSDUMMY1"[^>]*>SELECT COUNT\(\*\) FROM SYSCAT.TABLES<\/textarea>/);
    expect(markup).not.toContain("Encerrar a conexão");
  });

  it("a conexão nova nasce verificando a cada 30 segundos, com a consulta do banco", () => {
    const markup = render({ mode: "new", folderID: null });

    expect(markup).toContain('<input type="hidden" name="verificationEnabled" value="true"/>');
    expect(markup).toMatch(/<input id="cx-verify" type="checkbox"(?=[^>]*checked="")/);
    expect(markup).toMatch(/<input id="cx-verification-interval"[^>]*name="verificationInterval" value="30"/);
  });

  it("na pasta que impõe as proteções, elas aparecem marcadas e desabilitadas, com “Herdado da pasta Fábrica”, e a nova conexão nasce sem as próprias (RN-PROT-004)", () => {
    const protegida: Folder = { ...fabrica, readOnly: true, confirmCommands: "all", protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: null } };
    const markup = render({ mode: "new", folderID: protegida.id }, [protegida]);

    expect(markup).toMatch(/<input id="cx-read-only" type="checkbox"(?=[^>]*checked="")(?=[^>]*disabled="")/);
    expect(markup).toMatch(/<input type="radio"(?=[^>]*checked="")[^>]*value="all"/);
    expect(markup).toMatch(/<input type="radio"(?=[^>]*disabled="")[^>]*value="irreversible"/);
    expect(markup).toContain(connectionsCopy.protections.inheritedFrom("Fábrica"));
    expect(markup).toContain('<input type="hidden" name="confirmCommands" value="none"/>');
    expect(markup).toContain('<input type="hidden" name="readOnly" value="false"/>');
  });
});
