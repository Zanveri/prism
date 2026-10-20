import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScriptFolder, ScriptSummary } from "../_lib/scripts.schema";

// A seção "Scripts" com os ganchos do React simulados (`createHookRuntime`): o que se confere AQUI é a LIGAÇÃO das pastas de scripts (RN-SCRIPT-008 a 010).
// Os menus da pasta, do script e do título; os diálogos de "Nova pasta", "Renomear", "Mover para…" e "Excluir", o que cada um manda à API, as recusas no campo
// e as que vão ao aviso central (com o diálogo aberto); e a linha que fica à vista e escolhida depois. As decisões são de `script-tree.ts` e `saved-scripts.ts`,
// o desenho da árvore de `scripts-section.test.ts`; a API e o provedor são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    scripts: [] as ScriptSummary[],
    folders: [] as ScriptFolder[],
    workbench: { tabs: [], openScriptTab: vi.fn(), renameScript: vi.fn(), forgetScript: vi.fn(), setScriptPlace: vi.fn() },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    invalidated: [] as string[],
    folderService: { createScriptFolderOrRefuse: vi.fn(), renameScriptFolderOrRefuse: vi.fn(), moveScriptFolder: vi.fn(), deleteScriptFolder: vi.fn() },
    scriptService: { moveScript: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: readonly unknown[] }) => ({ data: options.queryKey[0] === "scripts" ? rt.scripts : options.queryKey[0] === "script-folders" ? rt.folders : undefined, isError: false, refetch: vi.fn() }),
  useQueryClient: () => ({
    getQueryData: (key: readonly unknown[]) => (key[0] === "script-folders" ? rt.folders : key[0] === "scripts" ? rt.scripts : undefined),
    invalidateQueries: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      rt.invalidated.push(String(queryKey[0]));
      return Promise.resolve();
    },
  }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => rt.workbench }));
vi.mock("../_lib/script-folders.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/script-folders.service")>()), ...rt.folderService }));
vi.mock("../_lib/scripts.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/scripts.service")>()), ...rt.scriptService }));

import { ConfirmDialog, ContextMenu } from "@/components/ui";
import { ApiRequestError } from "@/lib/api/prism-api";
import { elementsOf } from "@/lib/testing/react-tree";

import { buildScriptTree, folderKey, scriptKey, visibleScriptRows, type ScriptTreeRow } from "../_lib/script-tree";
import { scriptsCopy } from "../_lib/scripts.copy";
import { MoveToFolderDialog, ScriptFolderNameDialog } from "./script-folder-dialogs";
import { ScriptsSection, ScriptsTreeView, scriptRowDomId } from "./scripts-section";

const copy = scriptsCopy.folders;
const folder = (id: string, name: string, parentID: string | null = null): ScriptFolder => ({ id, parentID, name, createdAt: "", updatedAt: "" });
const script = (id: string, name: string, folderID: string | null = null): ScriptSummary => ({ id, name, connectionID: "c1", database: null, folderID, icon: null, color: null, updatedAt: "" });

const tree = () => elementsOf(rt.render(() => ScriptsSection()));
const view = () => tree().find((element) => element.type === ScriptsTreeView)!.props as unknown as ComponentProps<typeof ScriptsTreeView>;
const find = <P,>(type: unknown) => tree().find((element) => element.type === type)?.props as P | undefined;
const nameDialog = () => find<ComponentProps<typeof ScriptFolderNameDialog>>(ScriptFolderNameDialog);
const moveDialog = () => find<ComponentProps<typeof MoveToFolderDialog>>(MoveToFolderDialog);
const confirm = () => find<ComponentProps<typeof ConfirmDialog>>(ConfirmDialog);

/** A linha da árvore com essa chave, como a seção a desenha agora. */
const row = (key: string): ScriptTreeRow => visibleScriptRows(buildScriptTree(rt.folders, rt.scripts), new Set()).find((candidate) => candidate.node.key === key)!;

/** Abre o menu da linha (ou do título, com `null`) e devolve os itens dele, por id. */
function menuOf(target: ScriptTreeRow | null) {
  if (target === null) {
    const title = tree().find((element) => element.props["aria-controls"] === "navigator-scripts")!;
    (title.props.onContextMenu as (event: unknown) => void)({ preventDefault: vi.fn(), clientX: 1, clientY: 1 });
  } else view().onMenu(target, { x: 1, y: 1 }, "menu");
  const menu = find<ComponentProps<typeof ContextMenu>>(ContextMenu)!;
  return new Map(menu.groups.flatMap((group) => (Array.isArray(group) ? group : group.items)).map((item) => [item.id, item]));
}

/** Deixa as promessas em andamento chegarem ao fim. */
const settle = () => new Promise((done) => setTimeout(done, 0));
const refused = (code: string, detail: string) => new ApiRequestError({ status: 404, code, title: "Pasta não localizada.", detail, errors: null, extensions: {} });

beforeEach(() => {
  vi.clearAllMocks();
  rt.invalidated = [];
  rt.folders = [folder("f1", "Fechamento"), folder("f2", "Mensal", "f1"), folder("f3", "Vazia")];
  rt.scripts = [script("s1", "Abril", "f2"), script("s2", "Solto")];
  rt.folderService.createScriptFolderOrRefuse.mockImplementation((input: { name: string; parentID: string | null }) => Promise.resolve({ ok: true, data: folder("novo", input.name, input.parentID) }));
  rt.folderService.renameScriptFolderOrRefuse.mockImplementation((target: ScriptFolder, name: string) => Promise.resolve({ ok: true, data: { ...target, name } }));
  rt.folderService.moveScriptFolder.mockImplementation((target: ScriptFolder, parentID: string | null) => Promise.resolve({ ok: true, data: { ...target, parentID } }));
  rt.folderService.deleteScriptFolder.mockResolvedValue({ ok: true, data: undefined });
  rt.scriptService.moveScript.mockImplementation((id: string, folderID: string | null) => Promise.resolve({ ok: true, data: { ...script(id, "x"), folderID } }));
});

afterEach(() => rt.unmount());

describe("os menus da seção Scripts (RN-SCRIPT-009)", () => {
  it("o título tem \"Nova pasta\"; a pasta, \"Nova subpasta\", \"Renomear\" (F2), \"Mover para…\" e \"Excluir\" (Delete); o script, \"Mover para…\" logo depois de \"Editar script…\"", () => {
    expect([...menuOf(null).values()].map((item) => item.label)).toEqual([copy.menu.newFolder]);
    expect([...menuOf(row(folderKey("f3"))).values()].map((item) => [item.label, item.shortcut])).toEqual([
      [copy.menu.newSubfolder, undefined],
      [copy.menu.rename, "F2"],
      [copy.menu.move, undefined],
      [copy.menu.delete, "Delete"],
    ]);
    expect([...menuOf(row(scriptKey("s2"))).keys()]).toEqual(["open", "rename", "edit", "move", "copySql", "makeGeneric", "delete"]);
  });

  it("na pasta que tem alguma coisa dentro, \"Excluir\" fica desabilitado, com o motivo; e o Delete nela dá o aviso de erro, sem perguntar", () => {
    const item = menuOf(row(folderKey("f1"))).get("delete")!;
    expect(item).toMatchObject({ disabled: true, hint: copy.notEmpty(1, 0) });

    view().onRequest(row(folderKey("f2")), "delete");

    expect(rt.toast.error).toHaveBeenCalledWith("A pasta tem 1 script: mova ou exclua antes o que está dentro dela.");
    expect(confirm()).toBeUndefined();
  });
});

describe("Nova pasta e Nova subpasta (RN-SCRIPT-009)", () => {
  it("\"Nova pasta\" do título cria na raiz: o diálogo diz onde, grava o nome normalizado, avisa, e a pasta nova fica escolhida", async () => {
    menuOf(null).get("newFolder")!.onSelect!();
    expect(nameDialog()).toMatchObject({ title: copy.create.title, place: copy.create.atRoot, submitLabel: copy.create.submit, initialName: "" });

    nameDialog()!.onSubmit("  Relatórios  semanais ");
    await settle();

    expect(rt.folderService.createScriptFolderOrRefuse).toHaveBeenCalledWith({ name: "Relatórios semanais", parentID: null });
    expect(rt.toast.success).toHaveBeenCalledWith(copy.toasts.created);
    expect(nameDialog()).toBeUndefined();
    expect(view().selectedKey).toBe(folderKey("novo"));
    expect(rt.invalidated).toEqual(expect.arrayContaining(["script-folders", "scripts"]));
  });

  it("\"Nova subpasta\" cria dentro da pasta, e o diálogo diz o caminho dela", async () => {
    menuOf(row(folderKey("f2"))).get("newSubfolder")!.onSelect!();
    expect(nameDialog()).toMatchObject({ title: copy.create.titleSub, place: copy.create.inside("Fechamento / Mensal") });

    nameDialog()!.onSubmit("Abril");
    await settle();

    expect(rt.folderService.createScriptFolderOrRefuse).toHaveBeenCalledWith({ name: "Abril", parentID: "f2" });
  });

  it("as recusas do nome ficam no campo, sem chamar a API ou com a frase da tela para a da API; a pasta pai que sumiu vai ao aviso central e o diálogo fica", async () => {
    menuOf(null).get("newFolder")!.onSelect!();
    nameDialog()!.onSubmit("fechamento");
    expect(nameDialog()?.error).toBe(copy.errors.taken);
    nameDialog()!.onSubmit("Fecha\tmento");
    expect(nameDialog()?.error).toBe(copy.errors.control);
    expect(rt.folderService.createScriptFolderOrRefuse).not.toHaveBeenCalled();

    rt.folderService.createScriptFolderOrRefuse.mockResolvedValueOnce({ ok: false, error: { code: "SCRIPT_FOLDER_ALREADY_EXISTS", title: "Pasta já existe.", status: 409, detail: null, errors: null, extensions: {} } });
    nameDialog()!.onSubmit("Outra");
    await settle();
    expect(nameDialog()).toMatchObject({ pending: false, error: copy.errors.taken });

    rt.folderService.createScriptFolderOrRefuse.mockRejectedValueOnce(refused("SCRIPT_FOLDER_NOT_FOUND", "A pasta pai não existe mais."));
    nameDialog()!.onSubmit("Outra");
    await settle();
    expect(nameDialog()).toMatchObject({ pending: false, error: null });
    expect(rt.toast.success).not.toHaveBeenCalled();
    expect(rt.invalidated).toContain("script-folders");
  });
});

describe("Renomear a pasta (RN-SCRIPT-009)", () => {
  it("o F2 abre o diálogo com o nome; o mesmo nome fecha sem gravar; mudar só as maiúsculas grava, com a pasta pai que ela tem", async () => {
    view().onRequest(row(folderKey("f2")), "rename");
    expect(nameDialog()).toMatchObject({ title: copy.rename.title, initialName: "Mensal", place: undefined });

    nameDialog()!.onSubmit(" Mensal ");
    expect(nameDialog()).toBeUndefined();
    expect(rt.folderService.renameScriptFolderOrRefuse).not.toHaveBeenCalled();

    view().onRequest(row(folderKey("f2")), "rename");
    nameDialog()!.onSubmit("MENSAL");
    await settle();

    expect(rt.folderService.renameScriptFolderOrRefuse).toHaveBeenCalledWith(rt.folders[1], "MENSAL");
    expect(rt.toast.success).toHaveBeenCalledWith(copy.toasts.renamed);
    expect(view().selectedKey).toBe(folderKey("f2"));
  });
});

describe("a linha que fica à vista e com o foco (RN-SCRIPT-008)", () => {
  it("a linha que já está na página ganha o foco na hora: sem nada a abrir, não há renderização a esperar, e o pedido não fica armado para depois", async () => {
    const focused = { focus: vi.fn() };
    const getElementById = vi.fn((id: string) => (id === scriptRowDomId(folderKey("f3")) ? focused : null));
    vi.stubGlobal("document", { getElementById });
    try {
      // "Vazia" está na raiz, já escolhida: renomeá-la não muda estado nenhum da seção.
      view().onSelect(folderKey("f3"));
      view().onRequest(row(folderKey("f3")), "rename");
      nameDialog()!.onSubmit("Vazia 2");
      await settle();

      // Na hora, sem outra renderização.
      expect(focused.focus).toHaveBeenCalledOnce();
      // A renderização seguinte (uma aba que mudou, a primeira tecla no editor) não leva o foco de novo à árvore.
      tree();
      tree();
      expect(focused.focus).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Mover para… (RN-SCRIPT-009)", () => {
  it("o da pasta lista Sem pasta e as pastas com o caminho, sem ela e as subpastas dela, com a de agora escolhida; o mesmo destino fecha sem gravar", async () => {
    menuOf(row(folderKey("f2"))).get("move")!.onSelect!();
    expect(moveDialog()).toMatchObject({ title: copy.move.titleFolder, name: "Mensal", value: "f1" });
    expect(moveDialog()!.options.map((option) => option.label)).toEqual(["Fechamento", "Vazia"]);

    moveDialog()!.onSubmit();
    expect(moveDialog()).toBeUndefined();
    expect(rt.folderService.moveScriptFolder).not.toHaveBeenCalled();

    menuOf(row(folderKey("f2"))).get("move")!.onSelect!();
    moveDialog()!.onChange("");
    moveDialog()!.onSubmit();
    await settle();

    expect(rt.folderService.moveScriptFolder).toHaveBeenCalledWith(rt.folders[1], null);
    expect(rt.toast.success).toHaveBeenCalledWith(copy.toasts.moved);
  });

  it("o do script manda a pasta escolhida, avisa, e o script fica escolhido; a recusa da API vai ao aviso central e o diálogo fica aberto", async () => {
    menuOf(row(scriptKey("s2"))).get("move")!.onSelect!();
    expect(moveDialog()).toMatchObject({ title: copy.move.titleScript, name: "Solto", value: "" });
    expect(moveDialog()!.options.map((option) => option.label)).toEqual(["Fechamento", "Fechamento / Mensal", "Vazia"]);

    rt.scriptService.moveScript.mockRejectedValueOnce(refused("SCRIPT_FOLDER_NOT_FOUND", "A pasta de destino não existe mais."));
    moveDialog()!.onChange("f3");
    moveDialog()!.onSubmit();
    await settle();
    expect(moveDialog()).toMatchObject({ pending: false, value: "f3" });
    expect(rt.invalidated).toEqual(expect.arrayContaining(["script-folders", "scripts"]));

    moveDialog()!.onSubmit();
    await settle();
    expect(rt.scriptService.moveScript).toHaveBeenLastCalledWith("s2", "f3");
    expect(rt.toast.success).toHaveBeenCalledWith(scriptsCopy.toasts.moved);
    expect(moveDialog()).toBeUndefined();
    expect(view().selectedKey).toBe(scriptKey("s2"));
  });
});

describe("Mover para… e Renomear depois de outra janela mexer nas pastas (RN-SCRIPT-009)", () => {
  it("o destino que outra janela excluiu: a recusa vai ao aviso central, a lista é lida de novo, o campo volta a Sem pasta, e o Mover seguinte faz o que ele diz", async () => {
    menuOf(row(scriptKey("s2"))).get("move")!.onSelect!();
    moveDialog()!.onChange("f3");
    rt.scriptService.moveScript.mockImplementationOnce(() => {
      rt.folders = rt.folders.filter((candidate) => candidate.id !== "f3");
      return Promise.reject(refused("SCRIPT_FOLDER_NOT_FOUND", "A pasta de destino não existe mais."));
    });

    moveDialog()!.onSubmit();
    await settle();
    expect(moveDialog()).toMatchObject({ pending: false, value: "" });
    expect(moveDialog()!.options.map((option) => option.value)).toEqual(["f1", "f2"]);

    // O script já está na raiz: "Sem pasta" é o lugar de agora, e o diálogo fecha sem gravar, em vez de mandar de novo a pasta que não existe.
    moveDialog()!.onSubmit();
    expect(moveDialog()).toBeUndefined();
    expect(rt.scriptService.moveScript).toHaveBeenCalledOnce();
  });

  it("a pasta que outra janela excluiu: renomeá-la ou movê-la dá a recusa, e o diálogo fecha com a lista lida de novo; a pasta pai que sumiu deixa o de criar aberto", async () => {
    view().onRequest(row(folderKey("f3")), "rename");
    rt.folderService.renameScriptFolderOrRefuse.mockImplementationOnce(() => {
      rt.folders = rt.folders.filter((candidate) => candidate.id !== "f3");
      return Promise.reject(refused("SCRIPT_FOLDER_NOT_FOUND", "Não existe uma pasta de scripts com o ID f3."));
    });
    nameDialog()!.onSubmit("Outra");
    await settle();
    expect(nameDialog()).toBeUndefined();

    rt.folders = [...rt.folders, folder("f4", "Anual")];
    menuOf(row(folderKey("f4"))).get("move")!.onSelect!();
    moveDialog()!.onChange("f1");
    rt.folderService.moveScriptFolder.mockImplementationOnce(() => {
      rt.folders = rt.folders.filter((candidate) => candidate.id !== "f4");
      return Promise.reject(refused("SCRIPT_FOLDER_NOT_FOUND", "Não existe uma pasta de scripts com o ID f4."));
    });
    moveDialog()!.onSubmit();
    await settle();
    expect(moveDialog()).toBeUndefined();

    menuOf(row(folderKey("f2"))).get("newSubfolder")!.onSelect!();
    rt.folderService.createScriptFolderOrRefuse.mockRejectedValueOnce(refused("SCRIPT_FOLDER_NOT_FOUND", "A pasta pai não existe mais."));
    nameDialog()!.onSubmit("Abril");
    await settle();
    expect(nameDialog()).toMatchObject({ pending: false });
  });

  it("renomear manda a pasta pai que a lista mais recente diz, e não a de quando o diálogo abriu: não desfaz o Mover que outra janela fez", async () => {
    view().onRequest(row(folderKey("f2")), "rename");
    // A lista lida de novo enquanto o diálogo estava aberto: outra janela moveu "Mensal" para "Vazia".
    rt.folders = rt.folders.map((candidate) => (candidate.id === "f2" ? { ...candidate, parentID: "f3" } : candidate));

    nameDialog()!.onSubmit("Mensal 2");
    await settle();

    expect(rt.folderService.renameScriptFolderOrRefuse).toHaveBeenCalledWith(expect.objectContaining({ id: "f2", parentID: "f3" }), "Mensal 2");
  });
});

describe("Excluir a pasta (RN-SCRIPT-009)", () => {
  it("a vazia pergunta, no tom de perigo; confirmar exclui e avisa", async () => {
    view().onRequest(row(folderKey("f3")), "delete");
    expect(confirm()).toMatchObject({ title: copy.remove.title("Vazia"), description: copy.remove.description, confirmLabel: copy.remove.submit, tone: "danger" });

    confirm()!.onConfirm();
    await settle();

    expect(rt.folderService.deleteScriptFolder).toHaveBeenCalledWith("f3");
    expect(rt.toast.success).toHaveBeenCalledWith(copy.toasts.deleted);
    expect(confirm()).toBeUndefined();
  });

  it("a recusa da API (outra janela pôs algo na pasta) fecha a pergunta, sem aviso de sucesso, e as listas são lidas de novo", async () => {
    rt.folderService.deleteScriptFolder.mockRejectedValueOnce(refused("SCRIPT_FOLDER_NOT_EMPTY", "A pasta Vazia tem 1 script."));
    view().onRequest(row(folderKey("f3")), "delete");

    confirm()!.onConfirm();
    await settle();

    expect(confirm()).toBeUndefined();
    expect(rt.toast.success).not.toHaveBeenCalled();
    expect(rt.invalidated).toEqual(expect.arrayContaining(["script-folders", "scripts"]));
  });
});

describe("a árvore abre e fecha as pastas (RN-SCRIPT-008)", () => {
  it("o Enter abre e fecha a pasta com alguma coisa dentro, nesta janela; na vazia, nada", () => {
    view().onRequest(row(folderKey("f1")), "enter");
    expect(view().rows!.map((candidate) => candidate.node.key)).toEqual([folderKey("f1"), folderKey("f3"), scriptKey("s2")]);

    view().onRequest(row(folderKey("f1")), "enter");
    view().onRequest(row(folderKey("f3")), "enter");
    expect(view().rows).toHaveLength(5);
  });
});
