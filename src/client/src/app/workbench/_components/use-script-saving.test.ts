import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryTab } from "../_lib/workbench-model";

// O Ctrl+S e o "Salvar como" de uma aba de consulta (`useScriptSaving`) com os ganchos do React simulados, como os testes do provedor
// (`workbench-state.*.test.ts`): o que se confere é a LIGAÇÃO do lugar do script (RN-SCRIPT-003 e 005). O que cada chamada à API leva (a conexão e o banco
// da aba, ou o genérico), como a caixa "Script genérico (sem conexão)" nasce no diálogo do nome, e o lugar salvo que a aba guarda. As decisões são de
// `saved-scripts.ts` e o corpo das rotas de `scripts.service.ts`, com teste próprio; a API e o provedor são de mentira. E o campo "Pasta" (RN-SCRIPT-010): a pasta
// que ele traz escolhida, a que vai à API, a recusa da pasta que outra janela excluiu e o aviso que diz onde o script ficou.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    tabs: [] as QueryTab[],
    scripts: [] as unknown[],
    folders: [] as unknown[],
    workbench: { setTabScript: vi.fn(), forgetScript: vi.fn() },
    queryClient: { getQueryData: vi.fn((key: readonly unknown[]) => (key[0] === "script-folders" ? rt.folders : rt.scripts) as unknown), invalidateQueries: vi.fn(() => Promise.resolve()) },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    service: { createScriptOrRefuse: vi.fn(), overwriteScriptOrRefuse: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => rt.queryClient,
  useQuery: (options: { queryKey: readonly unknown[] }) => ({ data: options.queryKey[0] === "script-folders" ? rt.folders : undefined }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ tabs: rt.tabs, ...rt.workbench }) }));
vi.mock("../_lib/scripts.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/scripts.service")>()), ...rt.service }));

import type { ScriptFolder, ScriptSummary } from "../_lib/scripts.schema";
import { scriptsCopy } from "../_lib/scripts.copy";
import { ScriptNameDialog } from "./script-dialogs";
import { useScriptSaving } from "./use-script-saving";

type Dialog = ComponentProps<typeof ScriptNameDialog>;

const summary = (over: Partial<ScriptSummary> = {}): ScriptSummary => ({ id: "s1", name: "Fechamento", connectionID: "c1", database: null, folderID: null, icon: null, color: null, updatedAt: "2026-10-15T00:00:00Z", ...over });
const queryTab = (over: Partial<QueryTab> = {}): QueryTab => ({ id: "q1", title: "consulta-1.sql", connectionId: "c1", sessionId: null, sql: "select 2", ...over });
const folder = (id: string, name: string, parentID: string | null = null): ScriptFolder => ({ id, parentID, name, createdAt: "", updatedAt: "" });

/** O que o gancho entrega agora: `save` e o diálogo do nome, se está aberto. Duas voltas: o efeito da primeira guarda a lista de abas mais recente. */
function show() {
  rt.render(() => useScriptSaving());
  const { save, dialog } = rt.render(() => useScriptSaving());
  const asked = dialog as ReactElement<Dialog> | null;
  return { save, dialog: asked?.type === ScriptNameDialog ? asked.props : null };
}

/** Deixa as promessas em andamento chegarem ao fim. */
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  vi.clearAllMocks();
  rt.tabs = [];
  rt.scripts = [summary()];
  rt.folders = [folder("f1", "Fechamento"), folder("f2", "Mensal", "f1")];
  rt.service.overwriteScriptOrRefuse.mockResolvedValue({ ok: true, data: summary() });
  rt.service.createScriptOrRefuse.mockImplementation((input: { name: string }) => Promise.resolve({ ok: true, data: summary({ id: "s2", name: input.name }) }));
});

afterEach(() => rt.unmount());

describe("useScriptSaving: o Ctrl+S da aba de um script grava por cima, com o lugar (RN-SCRIPT-003 e 005)", () => {
  it("o script com conexão grava a conexão e o banco da aba, e a aba guarda esse lugar como o salvo", async () => {
    rt.tabs = [queryTab({ connectionId: "c2", database: "vendas", script: { id: "s1", name: "Fechamento", savedSql: "select 1", savedConnectionId: "c1", dirty: true } })];

    expect(await show().save("q1", "save")).toBe(true);

    expect(rt.service.overwriteScriptOrRefuse).toHaveBeenCalledWith({ id: "s1", sql: "select 2", connectionID: "c2", database: "vendas" });
    expect(rt.workbench.setTabScript).toHaveBeenCalledWith("q1", { id: "s1", name: "Fechamento" }, "select 2", { savedConnectionId: "c2", savedDatabase: "vendas" });
    expect(rt.toast.success).toHaveBeenCalledWith(scriptsCopy.toasts.saved("Fechamento"));
  });

  it("o genérico grava só o texto e continua genérico, qualquer que seja a conexão da aba: nada da conexão vai, e ele não volta a ficar preso a ela", async () => {
    rt.tabs = [queryTab({ connectionId: "c2", database: "vendas", script: { id: "s1", name: "Fechamento", savedSql: "select 1", generic: true, dirty: true } })];

    expect(await show().save("q1", "save")).toBe(true);

    const sent = rt.service.overwriteScriptOrRefuse.mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toEqual({ id: "s1", sql: "select 2", generic: true });
    expect(sent).not.toHaveProperty("connectionID");
    expect(rt.workbench.setTabScript).toHaveBeenCalledWith("q1", { id: "s1", name: "Fechamento" }, "select 2", { generic: true });
  });
});

describe("useScriptSaving: o diálogo do nome e a caixa do script genérico (RN-SCRIPT-001 e 005)", () => {
  it("na primeira vez numa aba com conexão, a caixa nasce desmarcada e solta; no \"Salvar como\" de um script com conexão, também", () => {
    rt.tabs = [queryTab(), queryTab({ id: "q2", script: { id: "s1", name: "Fechamento", savedSql: "select 1", savedConnectionId: "c1", dirty: false } })];

    void show().save("q1", "save");
    expect(show().dialog).toMatchObject({ title: scriptsCopy.save.title, initialName: "Script 1", generic: { initial: false, locked: false } });
    show().dialog!.onCancel();

    void show().save("q2", "saveAs");
    expect(show().dialog).toMatchObject({ title: scriptsCopy.save.titleAs, initialName: "Fechamento (2)", generic: { initial: false, locked: false } });
    expect(rt.service.overwriteScriptOrRefuse).not.toHaveBeenCalled();
  });

  it("na aba sem conexão, a caixa vem marcada e presa", () => {
    rt.tabs = [queryTab({ connectionId: null })];

    void show().save("q1", "save");

    expect(show().dialog?.generic).toEqual({ initial: false, locked: true });
  });

  it("no \"Salvar como\" de um script genérico, a caixa nasce marcada, e a cópia pode deixar de ser genérica", () => {
    rt.tabs = [queryTab({ script: { id: "s1", name: "Fechamento", savedSql: "select 1", generic: true, dirty: false } })];

    void show().save("q1", "saveAs");

    expect(show().dialog?.generic).toEqual({ initial: true, locked: false });
  });

  it("com a caixa marcada, o script nasce sem conexão nem banco, e a aba guarda o genérico; o save responde que gravou", async () => {
    rt.tabs = [queryTab({ database: "vendas" })];

    const saved = show().save("q1", "save");
    show().dialog!.onSubmit("Relatório", true);
    await settle();

    expect(rt.service.createScriptOrRefuse).toHaveBeenCalledWith({ name: "Relatório", sql: "select 2", connectionID: null, database: null, folderID: null });
    expect(rt.workbench.setTabScript).toHaveBeenCalledWith("q1", { id: "s2", name: "Relatório" }, "select 2", { generic: true });
    expect(await saved).toBe(true);
    expect(show().dialog).toBeNull();
  });

  it("com a caixa desmarcada, o script nasce na conexão e no banco da aba, e a aba guarda esse lugar", async () => {
    rt.tabs = [queryTab({ database: "vendas" })];

    void show().save("q1", "save");
    show().dialog!.onSubmit("Relatório", false);
    await settle();

    expect(rt.service.createScriptOrRefuse).toHaveBeenCalledWith({ name: "Relatório", sql: "select 2", connectionID: "c1", database: "vendas", folderID: null });
    expect(rt.workbench.setTabScript).toHaveBeenCalledWith("q1", { id: "s2", name: "Relatório" }, "select 2", { savedConnectionId: "c1", savedDatabase: "vendas" });
  });

  it("a aba sem conexão grava o genérico mesmo que a resposta do diálogo venha sem a caixa", async () => {
    rt.tabs = [queryTab({ connectionId: null })];

    void show().save("q1", "save");
    show().dialog!.onSubmit("Relatório", false);
    await settle();

    expect(rt.service.createScriptOrRefuse).toHaveBeenCalledWith({ name: "Relatório", sql: "select 2", connectionID: null, database: null, folderID: null });
    expect(rt.workbench.setTabScript).toHaveBeenCalledWith("q1", { id: "s2", name: "Relatório" }, "select 2", { generic: true });
  });
});
