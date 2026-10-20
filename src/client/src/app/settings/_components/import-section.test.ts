import { beforeEach, describe, expect, it, vi } from "vitest";

// A seção com os ganchos de mentira: a consulta do estado do DBeaver, a navegação e a ponte são trocados, e o componente é chamado como função.
const mocks = vi.hoisted(() => ({ state: undefined as { invitedAt: string | null; lastImportAt: string | null } | undefined, navigate: vi.fn(), available: true }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQuery: () => ({ data: mocks.state }) }));
vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router")>()), useNavigate: () => mocks.navigate }));
vi.mock("@/lib/api/bridge", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/bridge")>()), dbeaverAvailable: () => mocks.available }));

import { transferRequests } from "@/app/workbench/_lib/transfer-requests";
import { buttonLabeled, elementsOf } from "@/lib/testing/react-tree";

import { ImportSection } from "./import-section";

const texts = () => elementsOf(ImportSection({ anchor: "cfg-importar" })).flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : []));
const button = (label: string) => buttonLabeled(ImportSection({ anchor: "cfg-importar" }), label);

beforeEach(() => {
  mocks.state = { invitedAt: null, lastImportAt: null };
  mocks.available = true;
  mocks.navigate.mockReset();
  transferRequests.clear();
});

describe("Configurações › Importar (RN-CONFIG-011)", () => {
  it("tem o título, a frase e os dois botões", () => {
    const tree = elementsOf(ImportSection({ anchor: "cfg-importar" }));

    expect(tree.find((element) => element.props.title === "Importar")).toBeDefined();
    expect(texts()).toContain("Traga as conexões de outro programa.");
    expect(button("Importar do DBeaver…")).toBeDefined();
    expect(button("Importar conexões do Prism…")).toBeDefined();
  });

  it("quem nunca importou lê a frase disso; quem importou, a data, sem inventar uma antes da resposta do cofre", () => {
    expect(texts()).toContain("Você ainda não importou do DBeaver.");

    mocks.state = { invitedAt: "2026-10-20T14:00:00Z", lastImportAt: "2026-10-20T14:32:00Z" };
    expect(texts().some((text) => /^Última importação do DBeaver: \d{2}\/\d{2}\/\d{4}.*\.$/.test(text))).toBe(true);

    mocks.state = undefined;
    expect(texts().some((text) => text.includes("importação do DBeaver") || text.includes("ainda não importou"))).toBe(false);
  });

  it("\"Importar do DBeaver…\" leva à área de trabalho e pede o diálogo da raiz, quantas vezes a pessoa quiser", () => {
    (button("Importar do DBeaver…")?.props.onClick as () => void)();
    (button("Importar do DBeaver…")?.props.onClick as () => void)();

    expect(mocks.navigate).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).toHaveBeenCalledWith("/workbench");
    expect(transferRequests.pending()?.value).toEqual({ type: "dbeaver", targetFolderID: null, start: { type: "find" } });
  });

  it("\"Importar conexões do Prism…\" pede o \"Importar conexões\" na raiz", () => {
    (button("Importar conexões do Prism…")?.props.onClick as () => void)();

    expect(transferRequests.pending()?.value).toEqual({ type: "import", targetFolderID: null });
    expect(mocks.navigate).toHaveBeenCalledWith("/workbench");
  });

  it("fora do app, \"Importar do DBeaver…\" fica desabilitado, com o motivo; o do Prism continua", () => {
    mocks.available = false;

    expect(button("Importar do DBeaver…")?.props.disabled).toBe(true);
    expect(button("Importar conexões do Prism…")?.props.disabled).toBeUndefined();
    expect(texts()).toContain("Importar do DBeaver só funciona no app do Prism.");
  });
});
