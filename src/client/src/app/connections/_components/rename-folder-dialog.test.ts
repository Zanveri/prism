import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { connectionsCopy } from "../_lib/connections.copy";
import { unprotected, type Folder } from "../_lib/connections.schema";
import { RenameFolderDialog } from "./rename-folder-dialog";

// O `Dialog` de verdade desenha num portal em `document.body`, que o renderizador de servidor não tem: aqui ele só devolve o que receberia.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, title, footer, children }: { open: boolean; title: string; footer?: unknown; children?: unknown }) =>
    open ? createElement("section", { role: "dialog" }, createElement("h2", null, title), createElement("div", { "data-body": "" }, children as never), createElement("footer", null, footer as never)) : null,
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));

const now = "2026-10-15T12:00:00Z";
const fabrica: Folder = { id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f2", parentID: null, name: "Fábrica", environmentName: "Produção", environmentColor: "#FF8A7A", color: "#7DB2FF", confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };

const render = () => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(RenameFolderDialog, { folder: fabrica, onClose: () => {} })));
const footerButtons = (markup: string) => [.../<footer>([\s\S]*?)<\/footer>/.exec(markup)?.[1].matchAll(/<button[^>]*>([^<]*)<\/button>/g) ?? []].map((match) => match[1]);

describe("Renomear pasta (F2, RN-NAV-009)", () => {
  it("é só o nome, como o Renomear da conexão: nem a cor, nem o ambiente, nem a pasta pai", () => {
    const markup = render();

    expect(markup).toContain(`<h2>${connectionsCopy.folder.rename.title}</h2>`);
    expect(markup).toMatch(/<input[^>]*id="rename-folder-name"[^>]*value="Fábrica"/);
    expect(markup.match(/<input/g)).toHaveLength(1);
    expect(markup).not.toContain(connectionsCopy.folder.color);
    expect(markup).not.toContain(connectionsCopy.form.environment.title);
    expect(footerButtons(markup)).toEqual(["Cancelar", "Renomear"]);
  });
});
