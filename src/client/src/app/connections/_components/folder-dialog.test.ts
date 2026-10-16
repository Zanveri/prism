import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { connectionsCopy } from "../_lib/connections.copy";
import { newVerification, unprotected, type Connection, type Folder } from "../_lib/connections.schema";
import { connectionsQuery } from "../_lib/connections.service";
import { FolderDialog, type FolderDialogState } from "./folder-dialog";

// O `Dialog` de verdade desenha num portal em `document.body`, que o renderizador de servidor não tem: aqui ele só devolve o que receberia.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, title, footer, children }: { open: boolean; title: string; footer?: unknown; children?: unknown }) =>
    open ? createElement("section", { role: "dialog" }, createElement("h2", null, title), createElement("div", { "data-body": "" }, children as never), createElement("footer", null, footer as never)) : null,
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));

const now = "2026-10-14T12:00:00Z";
const desenvolvimento: Folder = { id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f1", parentID: null, name: "Desenvolvimento", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const fabrica: Folder = { id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f2", parentID: null, name: "Fábrica", environmentName: "Produção", environmentColor: "#FF8A7A", color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const qas: Connection = { id: "7d2f9a10-aaaa-4bbb-8ccc-000000000001", folderID: null, name: "MES QAS", engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName: "QAS", environmentColor: "#F2B644", confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };

function render(state: FolderDialogState, connections: Connection[] = [qas]) {
  const client = new QueryClient();
  client.setQueryData(connectionsQuery.queryKey, connections);
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(FolderDialog, { state, folders: [desenvolvimento, fabrica], onClose: () => {} })));
}

const footerButtons = (markup: string) => [.../<footer>([\s\S]*?)<\/footer>/.exec(markup)?.[1].matchAll(/<button[^>]*>([^<]*)<\/button>/g) ?? []].map((match) => match[1]);

describe("Editar pasta (RN-PASTA-006)", () => {
  it("o diálogo se chama 'Editar pasta' e tem o nome e a seção Ambiente, com o que a pasta já tem", () => {
    const markup = render({ mode: "edit", folder: fabrica });

    expect(markup).toContain("<h2>Editar pasta</h2>");
    expect(markup).toMatch(/<input[^>]*id="folder-name"[^>]*value="Fábrica"/);
    expect(markup).toMatch(/<input[^>]*id="folder-environment-name"[^>]*value="Produção"/);
    expect(markup).toContain(connectionsCopy.form.environment.folderHint);
    // Editar não muda a pasta de lugar: isso é o "Mover".
    expect(markup).not.toContain('id="folder-parent"');
    expect(footerButtons(markup)).toEqual(["Cancelar", "Salvar"]);
  });

  it("uma pasta que já existia, sem ambiente: o campo do ambiente vem vazio, pronto para receber um", () => {
    const markup = render({ mode: "edit", folder: desenvolvimento });

    expect(markup).toMatch(/<input[^>]*id="folder-name"[^>]*value="Desenvolvimento"/);
    expect(markup).toMatch(/<input[^>]*id="folder-environment-name"[^>]*value=""/);
  });

  it("a seção Ambiente mostra os ambientes do usuário (RN-AMB-001), das pastas e das conexões, para reaproveitar", () => {
    const markup = render({ mode: "edit", folder: desenvolvimento });

    expect(markup).toMatch(/<button[^>]*aria-pressed="false"[^>]*>(<[^>]*>)*Produção</);
    expect(markup).toMatch(/<button[^>]*aria-pressed="false"[^>]*>(<[^>]*>)*QAS</);
  });

  it("a cor da pasta (RN-PASTA-007) vem antes da seção Ambiente, com a que a pasta já tem, na nova pasta e no Editar pasta…", () => {
    const edited = render({ mode: "edit", folder: { ...fabrica, color: "#7DB2FF" } });
    const created = render({ mode: "create", parentID: null });

    expect(edited).toContain(`<legend class="mb-2 p-0 text-sm text-muted">${connectionsCopy.folder.color}</legend>`);
    expect(edited).toMatch(/<input type="hidden" name="color" value="#7DB2FF"\/>/);
    expect(edited.indexOf(connectionsCopy.folder.color)).toBeLessThan(edited.indexOf('id="folder-environment-title"'));
    expect(edited).toContain(connectionsCopy.folder.colorHint);
    expect(created).toMatch(/<input type="hidden" name="color" value=""\/>/);
    expect(created).toMatch(/<button[^>]*aria-label="Sem cor"[^>]*aria-pressed="true"/);
    expect(render({ mode: "move", folder: fabrica })).not.toContain(connectionsCopy.folder.color);
  });

  it("as Proteções (RN-PROT-001 a 004) vêm depois do Ambiente, com as escolhas próprias da pasta, na nova pasta e no Editar pasta…; mover não as mostra", () => {
    const edited = render({ mode: "edit", folder: { ...fabrica, confirmCommands: "all", readOnly: true } });
    const created = render({ mode: "create", parentID: null });

    expect(edited.indexOf('id="folder-environment-title"')).toBeLessThan(edited.indexOf('id="folder-protections-title"'));
    expect(edited).toContain('<input type="hidden" name="confirmCommands" value="all"/>');
    expect(edited).toContain('<input type="hidden" name="readOnly" value="true"/>');
    expect(edited).toContain(connectionsCopy.protections.readOnly.folderHint);
    expect(created).toContain('<input type="hidden" name="confirmCommands" value="none"/>');
    expect(created).toContain('<input type="hidden" name="readOnly" value="false"/>');
    expect(render({ mode: "move", folder: fabrica })).not.toContain("folder-protections-title");
  });

  it("a subpasta mostra as proteções da pasta pai marcadas e desabilitadas, com “Herdado da pasta Fábrica” (RN-PROT-004)", () => {
    const protegida: Folder = { ...fabrica, readOnly: true, confirmCommands: "irreversible", protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "irreversible", confirmCommandsFolderID: null } };
    const linha: Folder = { ...desenvolvimento, id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f3", parentID: protegida.id, name: "Linha 1" };
    const markup = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FolderDialog, { state: { mode: "edit", folder: linha }, folders: [protegida, linha], onClose: () => {} })));

    expect(markup).toMatch(/<input id="folder-read-only" type="checkbox"(?=[^>]*checked="")(?=[^>]*disabled="")/);
    expect(markup).toContain(connectionsCopy.protections.inheritedFrom("Fábrica"));
    expect(markup).toMatch(/<input type="radio"(?=[^>]*disabled="")[^>]*value="none"/);
    expect(markup).toMatch(/<input type="radio"(?=[^>]*checked="")[^>]*value="irreversible"/);
    // A herdada não é gravada como própria.
    expect(markup).toContain('<input type="hidden" name="readOnly" value="false"/>');
  });

  it("nova pasta e mover continuam como eram", () => {
    expect(render({ mode: "create", parentID: null })).toContain("<h2>Nova pasta</h2>");
    expect(render({ mode: "move", folder: fabrica })).toContain("<h2>Mover pasta</h2>");
    expect(render({ mode: "move", folder: fabrica })).not.toContain("folder-environment-name");
  });
});
