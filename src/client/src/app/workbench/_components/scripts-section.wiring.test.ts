import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryTab } from "../_lib/workbench-model";

// A seção "Scripts" com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`): o que se confere AQUI é a LIGAÇÃO do script
// genérico (RN-SCRIPT-005). Abrir lê as conectadas deste instante (a sessão da árvore em cache e as abas) para a aba nascer na única conectada, e "Tornar
// genérico" e "Vincular à conexão da aba" mandam o lugar à API e às abas do script. O desenho da árvore é de `scripts-section.test.ts`, as decisões de
// `saved-scripts.ts` (`scriptPlace`, `scriptMenu`), com teste próprio, e as pastas de scripts de `scripts-section.folders.test.ts`; a API e o provedor são de
// mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    tabs: [] as QueryTab[],
    connections: [] as { id: string; name: string }[],
    /** As conexões com a sessão da árvore em cache (a árvore abriu). */
    treeSessions: new Set<string>(),
    workbench: { openScriptTab: vi.fn(), renameScript: vi.fn(), forgetScript: vi.fn(), setScriptPlace: vi.fn() },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    service: { getScript: vi.fn(), changeScriptPlace: vi.fn(), editScriptOrRefuse: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useQueryClient: () => ({
    getQueryData: (key: readonly unknown[]) => (key[0] === "connections" ? rt.connections : key[0] === "database-session" && rt.treeSessions.has(key[1] as string) ? { id: `sessao-${String(key[1])}` } : undefined),
    invalidateQueries: () => Promise.resolve(),
  }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ tabs: rt.tabs, ...rt.workbench }) }));
vi.mock("../_lib/scripts.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/scripts.service")>()), ...rt.service }));

import { elementsOf } from "@/lib/testing/react-tree";

import { scriptsCopy } from "../_lib/scripts.copy";
import type { Script, ScriptSummary } from "../_lib/scripts.schema";
import { ContextMenu } from "@/components/ui";

import { scriptKey, type ScriptTreeRow } from "../_lib/script-tree";
import { EditScriptDialog } from "./script-dialogs";
import { ScriptsSection, ScriptsTreeView } from "./scripts-section";

const generic: ScriptSummary = { id: "s1", name: "Fechamento", connectionID: null, database: null, folderID: null, icon: null, color: null, updatedAt: "2026-10-15T00:00:00Z" };
const bound: ScriptSummary = { ...generic, id: "s2", name: "Pedidos", connectionID: "c1", database: "vendas" };
const full = (summary: ScriptSummary): Script => ({ ...summary, sql: "select 1" });

const rowOf = (script: ScriptSummary): ScriptTreeRow => ({ node: { kind: "script", key: scriptKey(script.id), script, depth: 0, parentKey: null }, expanded: null });

/** A ação de uma linha da árvore, como a seção a recebe: abrir é o Enter da linha; o resto vem do menu dela, aberto pelo botão direito. */
function act(script: ScriptSummary, action: "open" | "edit" | "makeGeneric" | "bind") {
  const view = () => elementsOf(rt.render(() => ScriptsSection())).find((element) => element.type === ScriptsTreeView)!.props as unknown as ComponentProps<typeof ScriptsTreeView>;
  if (action === "open") return view().onRequest(rowOf(script), "enter");

  view().onMenu(rowOf(script), { x: 1, y: 1 }, "menu");
  const menu = elementsOf(rt.render(() => ScriptsSection())).find((element) => element.type === ContextMenu)!.props as unknown as ComponentProps<typeof ContextMenu>;
  const item = menu.groups.flatMap((group) => (Array.isArray(group) ? group : group.items)).find((candidate) => candidate.id === action)!;
  item.onSelect?.();
}

/** Deixa as promessas em andamento chegarem ao fim. */
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  vi.clearAllMocks();
  rt.tabs = [];
  rt.connections = [
    { id: "c1", name: "ERP" },
    { id: "c2", name: "MES" },
  ];
  rt.treeSessions = new Set();
  rt.service.getScript.mockImplementation((id: string) => Promise.resolve({ ok: true, data: full(id === generic.id ? generic : bound) }));
  rt.service.changeScriptPlace.mockImplementation((id: string) => Promise.resolve({ ok: true, data: id === generic.id ? generic : bound }));
});

afterEach(() => rt.unmount());

describe("ScriptsSection: abrir o script genérico (RN-SCRIPT-005)", () => {
  it("com exatamente uma conexão conectada (a sessão da árvore em cache), a aba nasce nela, e o lugar salvo é o genérico", async () => {
    rt.treeSessions = new Set(["c2"]);

    act(generic, "open");
    await settle();

    expect(rt.workbench.openScriptTab).toHaveBeenCalledWith(full(generic), { connectionId: "c2", saved: { generic: true } });
    expect(rt.toast.warning).not.toHaveBeenCalled();
  });

  it("a sessão de uma aba também conta: com uma na árvore e outra numa aba, a aba nasce sem conexão, e a faixa pergunta", async () => {
    rt.treeSessions = new Set(["c2"]);
    rt.tabs = [{ id: "q9", title: "consulta-9.sql", connectionId: "c1", sessionId: "sessao-aba", sql: "" }];

    act(generic, "open");
    await settle();

    expect(rt.workbench.openScriptTab).toHaveBeenCalledWith(full(generic), { connectionId: null, saved: { generic: true } });
  });

  it("sem nenhuma conectada, a aba nasce sem conexão; a aba aberta sem sessão não conta como conectada", async () => {
    rt.tabs = [{ id: "q9", title: "consulta-9.sql", connectionId: "c1", sessionId: null, sql: "" }];

    act(generic, "open");
    await settle();

    expect(rt.workbench.openScriptTab).toHaveBeenCalledWith(full(generic), { connectionId: null, saved: { generic: true } });
  });

  it("o script com conexão abre nela e no banco dele, mesmo com outra conectada (RN-SCRIPT-003)", async () => {
    rt.treeSessions = new Set(["c2"]);

    act(bound, "open");
    await settle();

    expect(rt.workbench.openScriptTab).toHaveBeenCalledWith(full(bound), { connectionId: "c1", database: "vendas", saved: { savedConnectionId: "c1", savedDatabase: "vendas" } });
  });
});

describe("ScriptsSection: \"Tornar genérico\" e \"Vincular à conexão da aba\" (RN-SCRIPT-005)", () => {
  it("\"Tornar genérico\" manda o genérico à API e às abas do script, e avisa", async () => {
    rt.tabs = [{ id: "q1", title: "Pedidos", connectionId: "c1", database: "vendas", sessionId: null, sql: "", script: { id: "s2", name: "Pedidos", savedSql: "", savedConnectionId: "c1", savedDatabase: "vendas", dirty: false } }];

    act(bound, "makeGeneric");
    await settle();

    expect(rt.service.changeScriptPlace).toHaveBeenCalledWith("s2", { generic: true });
    expect(rt.workbench.setScriptPlace).toHaveBeenCalledWith("s2", { generic: true });
    expect(rt.toast.success).toHaveBeenCalledWith(scriptsCopy.toasts.madeGeneric("Pedidos"));
  });

  it("\"Vincular à conexão da aba\" grava a conexão e o banco da aba aberta do script, e as abas guardam esse lugar", async () => {
    rt.tabs = [{ id: "q1", title: "Fechamento", connectionId: "c2", database: "producao", sessionId: null, sql: "", script: { id: "s1", name: "Fechamento", savedSql: "", generic: true, dirty: false } }];

    act(generic, "bind");
    await settle();

    expect(rt.service.changeScriptPlace).toHaveBeenCalledWith("s1", { connectionID: "c2", database: "producao" });
    expect(rt.workbench.setScriptPlace).toHaveBeenCalledWith("s1", { savedConnectionId: "c2", savedDatabase: "producao" });
    expect(rt.toast.success).toHaveBeenCalledWith(scriptsCopy.toasts.bound("Fechamento", "MES"));
  });

  it("sem aba do script com conexão, vincular não chama a API; e a recusa da API não muda o lugar das abas", async () => {
    rt.tabs = [{ id: "q1", title: "Fechamento", connectionId: null, sessionId: null, sql: "", script: { id: "s1", name: "Fechamento", savedSql: "", generic: true, dirty: false } }];
    act(generic, "bind");
    await settle();
    expect(rt.service.changeScriptPlace).not.toHaveBeenCalled();

    rt.service.changeScriptPlace.mockResolvedValueOnce({ ok: false, error: { code: "SCRIPT_NOT_FOUND", title: "O script não existe mais.", status: 404 } });
    act(bound, "makeGeneric");
    await settle();
    expect(rt.service.changeScriptPlace).toHaveBeenCalledOnce();
    expect(rt.workbench.setScriptPlace).not.toHaveBeenCalled();
    expect(rt.toast.success).not.toHaveBeenCalled();
  });
});

describe("ScriptsSection: a recusa do \"Editar script…\" fica no campo dela (RN-SCRIPT-006)", () => {
  /** O diálogo aberto, como a seção o desenha agora. */
  const dialog = () => elementsOf(rt.render(() => ScriptsSection())).find((element) => element.type === EditScriptDialog)?.props as unknown as ComponentProps<typeof EditScriptDialog> | undefined;

  it.each([
    ["o ícone", { icon: ["Escolha um dos ícones da lista."] }, { icon: "Escolha um dos ícones da lista." }],
    ["a cor", { color: ["Use uma cor no formato #RRGGBB."] }, { color: "Use uma cor no formato #RRGGBB." }],
  ])("o 422 SCRIPT_ICON_INVALID d%s leva a frase da API ao lugar dele, e não o título genérico", async (_name, errors, shown) => {
    rt.service.editScriptOrRefuse.mockResolvedValueOnce({ ok: false, error: { code: "SCRIPT_ICON_INVALID", title: "Um ou mais campos são inválidos.", status: 422, detail: null, errors, extensions: {} } });

    act(bound, "edit");
    dialog()!.onSubmit({ name: "Pedidos", icon: "star", color: "#ABCDEF" });
    await settle();

    expect(rt.service.editScriptOrRefuse).toHaveBeenCalledWith("s2", { name: "Pedidos", icon: "star", color: "#ABCDEF" });
    expect(dialog()).toMatchObject({ pending: false, errors: shown });
    expect(rt.toast.success).not.toHaveBeenCalled();
  });
});
