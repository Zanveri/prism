import { beforeEach, describe, expect, it, vi } from "vitest";

// O painel com os ganchos do React simulados (`createHookRuntime`): o estado do cartão do DBeaver é estado, e a procura e a contagem são de mentira.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({ sourceFn: vi.fn(), releaseFn: vi.fn<(sourceId: string) => Promise<void>>(async () => {}), scanFn: vi.fn(), available: true }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/lib/api/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/bridge")>()),
  dbeaverAvailable: () => mocks.available,
  requestDbeaverSource: (mode: string) => mocks.sourceFn(mode),
  releaseDbeaverSource: (sourceId: string) => mocks.releaseFn(sourceId),
}));
vi.mock("@/app/connections/_lib/dbeaver.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/app/connections/_lib/dbeaver.service")>()), scanDbeaver: (sourceId: string) => mocks.scanFn(sourceId) }));

import { dbeaverScanSchema } from "@/app/connections/_lib/dbeaver.schema";
import { buttonLabeled, elementsOf, type Found } from "@/lib/testing/react-tree";

import { StartHere } from "./start-here";

const sourceId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const project = (name: string, importable: number) => ({ name, connections: importable + 2, importable, withPassword: 1, protected: false, nameInvalid: false, credentialsUnreadable: false, credentialsProtected: false });
const scan = (...projects: ReturnType<typeof project>[]) => ({ ok: true as const, data: dbeaverScanSchema.parse({ where: "standard", projects }) });
const settle = async () => {
  for (let turn = 0; turn < 4; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const handlers = { onImportDbeaver: vi.fn(), onImportPrism: vi.fn(), onNewConnection: vi.fn(), onDismiss: vi.fn() };
let focusFirst = false;
const drawn = () => {
  const tree = rt.render(() => StartHere({ focusFirst, ...handlers }));
  const all = elementsOf(tree);
  return { tree, all, section: all.find((element) => element.type === "section") as Found, texts: all.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : [])), button: (label: string) => buttonLabeled(tree, label) };
};

beforeEach(() => {
  rt.unmount();
  focusFirst = false;
  mocks.available = true;
  for (const mock of [mocks.sourceFn, mocks.releaseFn, mocks.scanFn, ...Object.values(handlers)]) mock.mockReset();
});

describe("o \"Comece por aqui\" (RN-DBEAVER-001)", () => {
  it("é uma região com o nome \"Comece por aqui\", com o título, a frase e os três cartões, e \"Agora não\" embaixo", () => {
    mocks.sourceFn.mockResolvedValue({ status: "notFound" });
    const view = drawn();

    expect(view.section.props["aria-label"]).toBe("Comece por aqui");
    expect(view.texts).toEqual(expect.arrayContaining(["Comece por aqui", "Traga as conexões que você já tem, ou crie a primeira.", "Importar do DBeaver", "Importar conexões do Prism", "Um arquivo .prismconexoes que alguém exportou do Prism.", "Nova conexão", "Informe o servidor, a porta e o usuário de um banco."]));
    expect(view.button("Importar conexões…")).toBeDefined();
    expect(view.button("Agora não")).toBeDefined();
  });

  it("ao aparecer, procura o DBeaver; enquanto isso a frase é \"Procurando…\" e o botão espera (aria-disabled, sem sair do Tab)", () => {
    mocks.sourceFn.mockReturnValue(new Promise(() => {}));
    const view = drawn();

    expect(mocks.sourceFn).toHaveBeenCalledExactlyOnceWith("find");
    expect(view.texts).toContain("Procurando o DBeaver neste computador…");
    const waiting = view.button("Importar do DBeaver…");
    expect(waiting?.props["aria-disabled"]).toBe(true);
    (waiting?.props.onClick as () => void)();
    expect(handlers.onImportDbeaver).not.toHaveBeenCalled();
  });

  it("achou: conta as conexões importáveis de todos os projetos e solta a cópia assim que a contagem responde", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "found", sourceId, where: "standard", projects: 2 });
    mocks.scanFn.mockResolvedValue(scan(project("General", 18), project("Vendas", 4)));
    drawn();
    await settle();
    const view = drawn();

    expect(mocks.scanFn).toHaveBeenCalledExactlyOnceWith(sourceId);
    expect(mocks.releaseFn).toHaveBeenCalledExactlyOnceWith(sourceId);
    expect(view.texts).toContain("Encontramos o DBeaver neste computador: 22 conexões.");
    expect(view.button("Importar do DBeaver…")?.props["aria-disabled"]).toBeUndefined();
    expect(view.button("Escolher a pasta do DBeaver…")).toBeDefined();
  });

  it("\"Importar do DBeaver…\" pede o diálogo que procura; o link, o que pede a pasta", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "found", sourceId, where: "standard", projects: 1 });
    mocks.scanFn.mockResolvedValue(scan(project("General", 3)));
    drawn();
    await settle();
    const view = drawn();

    (view.button("Importar do DBeaver…")?.props.onClick as () => void)();
    (view.button("Escolher a pasta do DBeaver…")?.props.onClick as () => void)();
    expect(handlers.onImportDbeaver.mock.calls).toEqual([["find"], ["choose"]]);
  });

  it("achou sem nenhuma que o Prism importe: a frase diz, e o botão é o da pasta", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "found", sourceId, where: "flatpak", projects: 1 });
    mocks.scanFn.mockResolvedValue(scan(project("General", 0)));
    drawn();
    await settle();
    const view = drawn();

    expect(view.texts).toContain("Encontramos o DBeaver neste computador, mas sem conexões de PostgreSQL, Db2 ou Informix.");
    expect(view.button("Importar do DBeaver…")).toBeUndefined();
    (view.button("Escolher a pasta do DBeaver…")?.props.onClick as () => void)();
    expect(handlers.onImportDbeaver).toHaveBeenCalledWith("choose");
  });

  it("não achou: a frase de escolher a pasta, sem \"Tentar de novo\"", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "notFound" });
    drawn();
    await settle();
    const view = drawn();

    expect(view.texts).toContain("Não encontramos o DBeaver nos lugares de sempre. Se ele guarda o workspace noutro lugar, escolha a pasta.");
    expect(view.button("Tentar de novo")).toBeUndefined();
    expect(mocks.scanFn).not.toHaveBeenCalled();
  });

  it("a recusa do processo principal dá a frase dela, com \"Tentar de novo\", que procura de novo", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "noSpace" });
    drawn();
    await settle();
    const view = drawn();
    expect(view.texts).toContain("Não há espaço na pasta de dados do Prism para copiar as conexões do DBeaver.");
    expect(view.button("Escolher a pasta do DBeaver…")).toBeDefined();

    mocks.sourceFn.mockResolvedValue({ status: "notFound" });
    (view.button("Tentar de novo")?.props.onClick as () => void)();
    expect(drawn().texts).toContain("Procurando o DBeaver neste computador…");
    await settle();
    expect(mocks.sourceFn).toHaveBeenCalledTimes(2);
    expect(drawn().texts).toContain("Não encontramos o DBeaver nos lugares de sempre. Se ele guarda o workspace noutro lugar, escolha a pasta.");
  });

  it("a contagem que a API recusa vira a frase da recusa, e a cópia é solta mesmo assim", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "found", sourceId, where: "standard", projects: 1 });
    mocks.scanFn.mockResolvedValue({ ok: false, error: { status: 422, code: "DBEAVER_SOURCE_INVALID", title: "", detail: null, errors: null, extensions: {} } });
    drawn();
    await settle();

    expect(drawn().texts).toContain("O Prism não conseguiu ler as conexões deste DBeaver.");
    expect(mocks.releaseFn).toHaveBeenCalledExactlyOnceWith(sourceId);
  });

  it("a procura que termina depois de o painel sair solta a cópia que fez e não conta nada", async () => {
    let answer: (reply: unknown) => void = () => {};
    mocks.sourceFn.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    drawn();
    rt.unmount();
    answer({ status: "found", sourceId, where: "standard", projects: 1 });
    await settle();

    expect(mocks.releaseFn).toHaveBeenCalledExactlyOnceWith(sourceId);
    expect(mocks.scanFn).not.toHaveBeenCalled();
  });

  it("os outros dois cartões e \"Agora não\" chamam a ação deles", () => {
    mocks.sourceFn.mockResolvedValue({ status: "notFound" });
    const view = drawn();
    (view.button("Importar conexões…")?.props.onClick as () => void)();
    // O botão tem o ícone de mais antes do texto.
    const create = view.all.find((element) => typeof element.props.onClick === "function" && Array.isArray(element.props.children) && element.props.children.includes("Nova conexão"));
    (create?.props.onClick as () => void)();
    (view.button("Agora não")?.props.onClick as () => void)();

    expect([handlers.onImportPrism.mock.calls.length, handlers.onNewConnection.mock.calls.length, handlers.onDismiss.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it("fora do Electron, o primeiro cartão diz que só funciona no app, sem botão e sem procurar", () => {
    mocks.available = false;
    const view = drawn();

    expect(view.texts).toContain("Importar do DBeaver só funciona no app do Prism.");
    expect(view.button("Importar do DBeaver…")).toBeUndefined();
    expect(mocks.sourceFn).not.toHaveBeenCalled();
  });

  it("o Tab anda na ordem em que se lê: o botão do primeiro cartão, o link da pasta, os botões dos outros cartões e \"Agora não\"", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "found", sourceId, where: "standard", projects: 1 });
    mocks.scanFn.mockResolvedValue(scan(project("General", 3)));
    drawn();
    await settle();
    const clickable = drawn().all.filter((element) => typeof element.props.onClick === "function");

    expect(clickable.map((element) => (Array.isArray(element.props.children) ? element.props.children.filter((child: unknown) => typeof child === "string").join("") : element.props.children))).toEqual([
      "Importar do DBeaver…",
      "Escolher a pasta do DBeaver…",
      "Importar conexões…",
      "Nova conexão",
      "Agora não",
    ]);
  });
});
