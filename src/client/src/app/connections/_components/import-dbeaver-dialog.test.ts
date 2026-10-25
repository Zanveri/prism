import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// O diálogo com os ganchos do React simulados (`createHookRuntime`): a origem, o projeto, a prévia e as marcas são estado, e o vitest deste projeto não tem DOM.
// A ponte do processo principal, a contagem e as mutações são de mentira; o cache de verdade e as rotas estão em `dbeaver.service.test.ts`. Tudo sintético.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  reset: vi.fn(),
  sourceFn: vi.fn(),
  releaseFn: vi.fn<(sourceId: string) => Promise<void>>(async () => {}),
  scanFn: vi.fn(),
  previewFn: vi.fn(),
  importFn: vi.fn(),
  invalidate: vi.fn(async () => {}),
  folders: [] as unknown[],
  gcTimes: [] as unknown[],
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQuery: () => ({ data: mocks.folders }),
  useMutation: (options: { mutationFn: (variables: unknown) => Promise<unknown>; onSuccess?: (result: unknown) => unknown; gcTime?: number }) => {
    mocks.gcTimes.push(options.gcTime);
    return {
      isPending: false,
      reset: mocks.reset,
      mutate: (variables: unknown, callbacks: { onSuccess?: (result: unknown) => void; onError?: (error: unknown) => void } = {}) =>
        options.mutationFn(variables).then(
          async (result) => {
            await options.onSuccess?.(result);
            callbacks.onSuccess?.(result);
          },
          (error) => callbacks.onError?.(error),
        ),
    };
  },
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));
vi.mock("@/lib/api/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/bridge")>()),
  requestDbeaverSource: (mode: string) => mocks.sourceFn(mode),
  releaseDbeaverSource: (sourceId: string) => mocks.releaseFn(sourceId),
}));
vi.mock("../_lib/connections.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/connections.service")>()), invalidateLists: mocks.invalidate }));
vi.mock("../_lib/dbeaver.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_lib/dbeaver.service")>();
  const { allowRefusal } = await import("@/lib/api/prism-api");
  return {
    ...actual,
    scanDbeaver: (sourceId: string) => mocks.scanFn(sourceId),
    dbeaverPreviewMutation: { gcTime: 0, mutationFn: async (request: unknown) => allowRefusal(await mocks.previewFn(request), ...actual.dbeaverRefusals) },
    dbeaverImportMutation: () => ({ gcTime: 0, mutationFn: async (request: unknown) => allowRefusal(await mocks.importFn(request), ...actual.dbeaverRefusals) }),
  };
});

import { Button, Dialog, FieldError, Input, Select } from "@/components/ui";
import type { ApiResult } from "@/lib/api/prism-api";
import { buttonLabeled, elementsOf, type Found } from "@/lib/testing/react-tree";

import { unprotected, type Folder } from "../_lib/connections.schema";
import { dbeaverCopy } from "../_lib/dbeaver.copy";
import { dbeaverImportResultSchema, dbeaverPreviewSchema, dbeaverScanSchema, type DbeaverImportResult } from "../_lib/dbeaver.schema";
import type { DbeaverStart } from "../_lib/dbeaver-model";
import { ImportDbeaverDialog } from "./import-dbeaver-dialog";

const copy = dbeaverCopy;
const now = "2026-10-20T12:00:00Z";
const folder = (id: string, parentID: string | null, name: string): Folder => ({ id, parentID, name, environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now });
const sistemas = folder("0199e0a2-0000-7000-8000-0000000000f1", null, "Sistemas");

const sourceId = "0f8fad5b-d9cb-469f-a165-70867728950e";
const otherSourceId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const found = (id = sourceId, where = "standard") => ({ status: "found", sourceId: id, where, projects: 1 });
const project = (name: string, extra: Record<string, unknown> = {}) => ({ name, connections: 4, importable: 3, withPassword: 1, protected: false, nameInvalid: false, credentialsUnreadable: false, credentialsProtected: false, ...extra });
const scanOf = (...projects: ReturnType<typeof project>[]) => ({ ok: true as const, data: dbeaverScanSchema.parse({ where: "standard", projects }) });

const connection = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  folderKey: "f1",
  name: `CONEXAO ${key}`,
  engine: 1,
  host: "pg-dev.exemplo.invalid",
  port: 5432,
  database: "pedidos",
  userName: "fulano",
  hasPassword: true,
  verificationQuery: null,
  effective: null,
  conflict: false,
  copyName: null,
  strengthened: null,
  invalid: null,
  server: null,
  dbeaverType: "dev",
  existing: null,
  overwrite: null,
  leftOut: [],
  ...extra,
});
const informix = (key: string, extra: Record<string, unknown> = {}) => connection(key, { engine: 3, host: "ifx-dev.exemplo.invalid", port: 55080, database: "estoque", server: "ifx_dev_tcp", ...extra });
const existing = (id: number, name: string, connected = false) => ({ connectionID: `0199e0a2-0000-7000-8000-${String(id).padStart(12, "0")}`, name, path: "Estoque", connected });
const flags = (extra: Record<string, unknown> = {}) => ({ name: false, engine: false, host: false, port: false, database: false, userName: false, password: false, environment: false, keepsName: false, dropsPassword: false, ...extra });
const previewOf = (connections: Record<string, unknown>[], notes: Record<string, unknown> | null = null) => ({
  ok: true as const,
  data: dbeaverPreviewSchema.parse({ folders: [{ key: "f1", parentKey: null, name: "Estoque", existing: false, strengthened: null, invalid: null, nameCut: false }], connections, notes }),
});
const imported = (extra: Partial<DbeaverImportResult> = {}): DbeaverImportResult =>
  dbeaverImportResultSchema.parse({ folderIDs: ["0199e0a2-0000-7000-8000-0000000000f9"], connectionIDs: ["0199e0a2-0000-7000-8000-000000000001"], mergedFolders: 0, renamed: 0, skipped: 0, updatedIDs: [], ...extra });
const refused = (status: number, code: string): ApiResult<never> => ({ ok: false, error: { status, code, title: `Título de ${code}`, detail: null, errors: null, extensions: {} } });
const settle = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
};

type Props = { targetFolderID: string | null; start: DbeaverStart; invite: boolean; onImported: Mock<(result: DbeaverImportResult, targetFolderID: string | null) => void>; onClose: Mock<(outcome: "imported" | "dismissed") => void> };
let props: Props;

/** Desenha o diálogo com o estado que ele já tem, e acha o que o teste usa. */
function drawn() {
  const tree = rt.render(() => ImportDbeaverDialog(props));
  const all = elementsOf(tree);
  const rows = all.filter((element) => element.props.node !== undefined && element.props.state !== undefined);
  const dialog = all.find((element) => element.type === Dialog) as Found;
  return {
    all,
    dialog,
    title: dialog.props.title,
    description: dialog.props.description,
    form: all.find((element) => element.type === "form") as Found | undefined,
    submit: all.find((element) => element.type === Button && element.props.type === "submit") as Found | undefined,
    selects: all.filter((element) => element.type === Select),
    project: all.find((element) => element.type === Select && String(element.props.id).endsWith("-project")),
    destination: all.find((element) => element.type === Select && String(element.props.id).endsWith("-destination")) as Found | undefined,
    texts: all.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : [])),
    origin: all.find((element) => String(element.props.id).endsWith("-origin"))?.props.children,
    ports: all.filter((element) => element.type === Input && String(element.props.id).includes("-drda-")),
    rows,
    row: (key: string) => rows.find((row) => (row.props.node as { key: string }).key === key) as Found,
    errorOf: (suffix: string) => all.find((element) => element.type === FieldError && String(element.props.id).endsWith(suffix))?.props.children ?? null,
    counter: all.find((element) => element.props.role === "status" && element.type === "p" && typeof element.props.children === "string")?.props.children,
    passwords: all.find((element) => element.type === "input" && element.props.type === "checkbox" && String(element.props["aria-describedby"]).endsWith("-passwords-help")),
    radios: all.filter((element) => element.type === "input" && element.props.type === "radio"),
    button: (label: string) => buttonLabeled(all, label),
  };
}

const click = (label: string) => (buttonLabeled(drawn().all, label)?.props.onClick as () => void)();

/** Abre o diálogo e espera a procura, a contagem e a primeira prévia. */
async function opened(preview: ReturnType<typeof previewOf> = previewOf([connection("c1"), connection("c2", { hasPassword: false })]), scan = scanOf(project("General"))) {
  mocks.sourceFn.mockResolvedValue(found());
  mocks.scanFn.mockResolvedValue(scan);
  mocks.previewFn.mockResolvedValue(preview);
  drawn();
  await settle();
  return drawn();
}

beforeEach(() => {
  rt.unmount();
  props = { targetFolderID: null, start: { type: "find" }, invite: false, onImported: vi.fn(), onClose: vi.fn() };
  mocks.folders = [sistemas];
  mocks.gcTimes = [];
  for (const mock of [mocks.toast.success, mocks.toast.warning, mocks.toast.error, mocks.reset, mocks.sourceFn, mocks.releaseFn, mocks.scanFn, mocks.previewFn, mocks.importFn, mocks.invalidate]) mock.mockReset();
});

afterEach(() => vi.useRealTimers());

describe("a origem (RN-DBEAVER-014)", () => {
  it("ao abrir, procura o DBeaver sozinho (\"find\"), conta o que achou e mostra a prévia sem botão para abri-la", async () => {
    mocks.sourceFn.mockResolvedValue(found());
    mocks.scanFn.mockResolvedValue(scanOf(project("General")));
    mocks.previewFn.mockResolvedValue(previewOf([connection("c1")]));

    const first = drawn();
    expect(first.title).toBe("Importar do DBeaver");
    expect(first.origin).toBe("Procurando o DBeaver neste computador…");
    expect(first.submit?.props.disabled).toBe(true);
    await settle();
    const view = drawn();

    expect(mocks.sourceFn).toHaveBeenCalledExactlyOnceWith("find");
    expect(mocks.scanFn).toHaveBeenCalledExactlyOnceWith(sourceId);
    expect(view.origin).toBe("DBeaver neste computador");
    expect(view.button("Abrir arquivo")).toBeUndefined();
    expect(view.texts).toContain("O DBeaver tem 1 conexão em 1 pasta; o Prism importa 1: 1 com usuário, 1 com a senha.");
    expect(view.submit?.props.disabled).toBe(false);
  });

  it("a prévia leva a cópia, o lugar (a raiz) e \"Levar as senhas\"; sem o projeto nem as portas DRDA", async () => {
    await opened();

    expect(mocks.previewFn).toHaveBeenCalledExactlyOnceWith({ sourceId, project: null, targetFolderID: null, withPasswords: true, drdaPorts: [] });
    expect(mocks.gcTimes.every((gcTime) => gcTime === 0)).toBe(true);
    expect(mocks.reset).toHaveBeenCalled();
  });

  it("a cópia do convite não é procurada: a contagem a lê, e a prévia vem já carregada", async () => {
    props.start = { type: "copy", sourceId, where: "flatpak" };
    mocks.scanFn.mockResolvedValue(scanOf(project("General")));
    mocks.previewFn.mockResolvedValue(previewOf([connection("c1")]));
    drawn();
    await settle();

    expect(mocks.sourceFn).not.toHaveBeenCalled();
    expect(drawn().origin).toBe("DBeaver (Flatpak) neste computador");
    expect(mocks.previewFn).toHaveBeenCalledOnce();
  });

  it("não achou (notFound): a frase, \"Escolher a pasta do DBeaver…\" e nenhum aviso de erro", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "notFound" });
    drawn();
    await settle();
    const view = drawn();

    expect(view.origin).toBe("Não encontramos o DBeaver nos lugares de sempre.");
    expect(view.button("Escolher a pasta do DBeaver…")).toBeDefined();
    expect(view.button("Tentar de novo")).toBeUndefined();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.scanFn).not.toHaveBeenCalled();
  });

  it("as outras recusas do processo principal dizem a frase delas e oferecem \"Tentar de novo\", que procura de novo", async () => {
    mocks.sourceFn.mockResolvedValue({ status: "unreadable", message: "Não foi possível ler os arquivos do DBeaver: o disco deu erro de leitura." });
    drawn();
    await settle();
    expect(drawn().origin).toBe("Não foi possível ler os arquivos do DBeaver: o disco deu erro de leitura.");

    mocks.sourceFn.mockResolvedValue(found());
    mocks.scanFn.mockResolvedValue(scanOf(project("General")));
    mocks.previewFn.mockResolvedValue(previewOf([connection("c1")]));
    click("Tentar de novo");
    await settle();

    expect(mocks.sourceFn).toHaveBeenLastCalledWith("find");
    expect(drawn().origin).toBe("DBeaver neste computador");
  });

  it("\"Escolher a pasta do DBeaver…\" pede o `choose`; desistir deixa tudo como estava, e a pasta que não é do DBeaver apaga a prévia com a frase", async () => {
    await opened();
    mocks.sourceFn.mockResolvedValue({ status: "canceled" });
    click("Escolher a pasta do DBeaver…");
    await settle();
    expect(mocks.sourceFn).toHaveBeenLastCalledWith("choose");
    expect(drawn().origin).toBe("DBeaver neste computador");
    expect(drawn().rows.length).toBeGreaterThan(0);

    mocks.sourceFn.mockResolvedValue({ status: "notDbeaver" });
    click("Escolher a pasta do DBeaver…");
    await settle();
    const view = drawn();
    expect(view.origin).toBe("Esta pasta não tem conexões do DBeaver. Escolha a pasta DBeaverData, o workspace ou um projeto.");
    expect(view.rows).toEqual([]);
    expect(view.submit?.props.disabled).toBe(true);
  });

  it("a pasta escolhida mostra \"Pasta escolhida\" e a frase de conferir os servidores; a do DBeaver deste computador, não", async () => {
    const standard = await opened();
    expect(standard.texts).not.toContain(copy.preview.servers);

    mocks.sourceFn.mockResolvedValue(found(otherSourceId, "chosen"));
    click("Escolher a pasta do DBeaver…");
    await settle();
    const view = drawn();

    expect(view.origin).toBe("Pasta escolhida");
    expect(view.all.some((element) => element.props.children === copy.preview.servers)).toBe(true);
    expect(mocks.scanFn).toHaveBeenLastCalledWith(otherSourceId);
  });

  it("a contagem que a API recusa (cópia que sumiu, nada que se leia) vai para o campo, com a frase da tela", async () => {
    mocks.sourceFn.mockResolvedValue(found());
    mocks.scanFn.mockResolvedValue(refused(404, "DBEAVER_SOURCE_MISSING"));
    drawn();
    await settle();
    expect(drawn().origin).toBe("A cópia do DBeaver não existe mais. Procure o DBeaver de novo.");

    mocks.scanFn.mockResolvedValue(refused(422, "DBEAVER_SOURCE_INVALID"));
    click("Tentar de novo");
    await settle();
    expect(drawn().origin).toBe("O Prism não conseguiu ler as conexões deste DBeaver.");
  });

  it("fechar solta a cópia; a resposta que chega depois de fechar não deixa cópia nenhuma", async () => {
    await opened();
    rt.unmount();
    expect(mocks.releaseFn).toHaveBeenCalledExactlyOnceWith(sourceId);

    mocks.releaseFn.mockClear();
    let answer: (reply: unknown) => void = () => undefined;
    mocks.sourceFn.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    drawn();
    rt.unmount();
    answer(found(otherSourceId));
    await settle();

    expect(mocks.scanFn).toHaveBeenCalledTimes(1);
  });
});

describe("o projeto e as senhas (RN-DBEAVER-014)", () => {
  const several = scanOf(project("General", { importable: 18 }), project("Vendas", { importable: 1 }), project("Fechado", { protected: true }));

  it("o campo Projeto só aparece com mais de um projeto, com \"Todos os projetos\" escolhido", async () => {
    expect((await opened()).project).toBeUndefined();
    rt.unmount();
    const view = await opened(undefined, several);

    expect(view.project?.props.value).toBe("all");
    expect((view.project?.props.options as { label: string }[]).map((option) => option.label)).toEqual(["Todos os projetos", "General, 18 conexões", "Vendas, 1 conexão", "Fechado"]);
  });

  it("trocar o projeto pede a prévia dele (nome inteiro), e as marcas continuam: o item que já estava desmarcado fica, e o que a árvore não tinha chega marcado", async () => {
    const view = await opened(undefined, several);
    (view.row("c1").props.onMark as (key: string) => void)("c1");
    expect(drawn().row("c1").props.state).toBe("unchecked");

    mocks.previewFn.mockResolvedValue(previewOf([connection("c1"), connection("c9")]));
    (view.project?.props.onChange as (value: string) => void)("project-1");
    await settle();
    const after = drawn();

    expect(mocks.previewFn).toHaveBeenLastCalledWith({ sourceId, project: "Vendas", targetFolderID: null, withPasswords: true, drdaPorts: [] });
    expect(after.row("c1").props.state).toBe("unchecked");
    expect(after.row("c9").props.state).toBe("checked");

    // De volta a "Todos os projetos": o que o projeto não tinha chega marcado, e a marca tirada de antes continua tirada.
    mocks.previewFn.mockResolvedValue(previewOf([connection("c1"), connection("c2", { hasPassword: false }), connection("c9")]));
    (after.project?.props.onChange as (value: string) => void)("all");
    await settle();
    const back = drawn();

    expect(back.row("c1").props.state).toBe("unchecked");
    expect(back.row("c2").props.state).toBe("checked");
    expect(back.row("c9").props.state).toBe("checked");
  });

  it("o projeto protegido não se escolhe", async () => {
    const view = await opened(undefined, several);
    (view.project?.props.onChange as (value: string) => void)("project-2");
    await settle();

    expect(mocks.previewFn).toHaveBeenCalledOnce();
    expect(drawn().project?.props.value).toBe("all");
  });

  it("\"Levar as senhas\" só aparece quando alguma conexão tem senha; desligada, a prévia se refaz sem elas e as marcas continuam", async () => {
    expect((await opened(undefined, scanOf(project("General", { withPassword: 0 })))).passwords).toBeUndefined();
    rt.unmount();

    const view = await opened();
    (view.row("c2").props.onMark as (key: string) => void)("c2");
    expect(view.passwords?.props.checked).toBe(true);
    (view.passwords?.props.onChange as (event: unknown) => void)({ target: { checked: false } });
    await settle();
    const after = drawn();

    expect(mocks.previewFn).toHaveBeenLastCalledWith({ sourceId, project: null, targetFolderID: null, withPasswords: false, drdaPorts: [] });
    expect(after.row("c2").props.state).toBe("unchecked");
    expect(after.passwords?.props.checked).toBe(false);
  });

  it("trocar \"Onde colocar\" refaz a prévia com o lugar", async () => {
    const view = await opened();
    (view.destination?.props.onChange as (value: string) => void)(sistemas.id);
    await settle();

    expect(mocks.previewFn).toHaveBeenLastCalledWith({ sourceId, project: null, targetFolderID: sistemas.id, withPasswords: true, drdaPorts: [] });
  });
});

describe("a prévia (RN-DBEAVER-015)", () => {
  it("os avisos ficam acima da árvore, e a conta do rodapé diz quantas já existem no Prism", async () => {
    const view = await opened(
      previewOf([connection("c1", { existing: existing(1, "CONEXAO c1") }), connection("c2")], { protectedProjects: ["Vendas"], withoutSavedPassword: 8 }),
    );

    expect(view.texts).toContain("O projeto Vendas está protegido por senha de projeto e não foi lido.");
    expect(view.texts).toContain("8 conexões estão sem “Salvar senha” no DBeaver e vêm só com o usuário.");
    expect(view.counter).toBe("2 conexões e 1 pasta marcadas, 1 já existe no Prism");
  });

  it("a recusa da prévia vai ao campo a que se refere, sem aviso de erro", async () => {
    mocks.sourceFn.mockResolvedValue(found());
    mocks.scanFn.mockResolvedValue(scanOf(project("General")));
    mocks.previewFn.mockResolvedValue(refused(422, "DBEAVER_LIMITS_EXCEEDED"));
    drawn();
    await settle();
    expect(drawn().errorOf("-origin-error")).toBe("O DBeaver tem mais do que o Prism importa de uma vez: até 2.000 conexões, 2.000 pastas e 32 níveis de pastas.");

    mocks.previewFn.mockResolvedValue(refused(404, "FOLDER_NOT_FOUND"));
    click("Escolher a pasta do DBeaver…");
    mocks.sourceFn.mockResolvedValue(found(otherSourceId));
    await settle();
    expect(drawn().errorOf("-destination-error")).toBe("A pasta escolhida não existe mais. Escolha outro lugar.");
    expect(drawn().destination?.props.value).toBe("none");
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("os conflitos de nome têm a escolha única da seção 34, e a caixa das consultas não existe", async () => {
    const view = await opened(previewOf([connection("c1", { conflict: true, copyName: "CONEXAO c1 (cópia)" })]));

    expect(view.radios.map((radio) => radio.props.value)).toEqual(["rename", "skip"]);
    expect(view.all.some((element) => element.props.children === "Manter as consultas de verificação do arquivo")).toBe(false);
  });
});

describe("as portas DRDA do Informix (RN-DBEAVER-010 e 015)", () => {
  const withInformix = () => previewOf([informix("c1"), informix("c2", { name: "OUTRA" }), connection("c3")]);

  it("uma linha por servidor do DBeaver com Informix marcado, e nenhuma tabela sem Informix", async () => {
    const view = await opened(withInformix());
    expect(view.ports).toHaveLength(1);
    expect(view.all.some((element) => element.type === "table")).toBe(true);

    rt.unmount();
    expect((await opened(previewOf([connection("c3")]))).ports).toEqual([]);
  });

  it("a porta digitada refaz a prévia quando a pessoa para de digitar, e vai à API com o servidor como a prévia o deu", async () => {
    vi.useFakeTimers();
    mocks.sourceFn.mockResolvedValue(found());
    mocks.scanFn.mockResolvedValue(scanOf(project("General")));
    mocks.previewFn.mockResolvedValue(withInformix());
    drawn();
    await vi.advanceTimersByTimeAsync(0);
    const view = drawn();
    const field = view.ports[0];

    (field.props.onChange as (event: unknown) => void)({ target: { value: "9089" } });
    drawn();
    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.previewFn).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect(mocks.previewFn).toHaveBeenLastCalledWith({
      sourceId,
      project: null,
      targetFolderID: null,
      withPasswords: true,
      drdaPorts: [{ host: "ifx-dev.exemplo.invalid", port: 55080, server: "ifx_dev_tcp", drdaPort: 9089 }],
    });
  });

  it("a porta que não é uma porta mostra o erro e não vai à API", async () => {
    vi.useFakeTimers();
    mocks.sourceFn.mockResolvedValue(found());
    mocks.scanFn.mockResolvedValue(scanOf(project("General")));
    mocks.previewFn.mockResolvedValue(withInformix());
    drawn();
    await vi.advanceTimersByTimeAsync(0);

    (drawn().ports[0].props.onChange as (event: unknown) => void)({ target: { value: "70000" } });
    const view = drawn();
    await vi.advanceTimersByTimeAsync(2000);

    expect(view.ports[0].props["aria-invalid"]).toBe(true);
    expect(view.all.some((element) => element.type === FieldError && element.props.children === copy.drda.invalid)).toBe(true);
    expect(mocks.previewFn).toHaveBeenCalledOnce();
  });

  it("a segunda linha da conexão mostra a porta digitada, e a marca \"porta do DBeaver\" sai", async () => {
    vi.useFakeTimers();
    mocks.sourceFn.mockResolvedValue(found());
    mocks.scanFn.mockResolvedValue(scanOf(project("General")));
    mocks.previewFn.mockResolvedValue(withInformix());
    drawn();
    await vi.advanceTimersByTimeAsync(0);
    const before = drawn();
    expect(before.row("c1").props.drdaPort).toBeNull();
    expect(before.row("c1").props.tags).toEqual(expect.arrayContaining([expect.objectContaining({ label: "porta do DBeaver" })]));

    (before.ports[0].props.onChange as (event: unknown) => void)({ target: { value: "9089" } });
    const after = drawn();

    // Os dois Informix são do mesmo servidor: a porta vale para os dois, e a marca sai deles; o PostgreSQL não muda.
    expect(after.row("c1").props.drdaPort).toBe(9089);
    expect(after.row("c2").props.drdaPort).toBe(9089);
    expect(after.row("c1").props.tags).toEqual([]);
    expect(after.row("c3").props.drdaPort).toBeNull();
  });

  it("\"Importar\" com uma porta ainda não vista pela prévia: a prévia se refaz primeiro e a importação segue com ela", async () => {
    mocks.importFn.mockResolvedValue({ ok: true, data: imported() });
    const view = await opened(withInformix());
    (view.ports[0].props.onChange as (event: unknown) => void)({ target: { value: "9089" } });
    const typed = drawn();

    (typed.form?.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
    // O React desenha "Atualizando a prévia…" antes de a resposta chegar; só então o fim dela dispara a importação.
    expect(drawn().texts).toContain(copy.dialog.refreshing);
    await settle();
    expect(mocks.previewFn).toHaveBeenCalledTimes(2);
    drawn();
    await settle();

    expect(mocks.importFn).toHaveBeenCalledOnce();
    expect(mocks.importFn.mock.calls[0][0]).toMatchObject({ drdaPorts: [{ host: "ifx-dev.exemplo.invalid", port: 55080, server: "ifx_dev_tcp", drdaPort: 9089 }], overwrite: [] });
  });
});

describe("importar (RN-DBEAVER-016)", () => {
  const submit = () => (drawn().form?.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });

  it("sem nenhuma que já existe, grava direto: leva as chaves marcadas, o aviso diz o que entrou e o diálogo fecha", async () => {
    mocks.importFn.mockResolvedValue({ ok: true, data: imported({ renamed: 1 }) });
    const view = await opened();
    (view.row("c2").props.onMark as (key: string) => void)("c2");
    submit();
    await settle();

    expect(mocks.importFn).toHaveBeenCalledExactlyOnceWith({ sourceId, project: null, targetFolderID: null, withPasswords: true, drdaPorts: [], items: ["c1"], onConflict: "rename", overwrite: [] });
    expect(mocks.toast.success).toHaveBeenCalledWith("1 conexão e 1 pasta importadas do DBeaver, 1 com outro nome.");
    expect(props.onImported).toHaveBeenCalledWith(expect.objectContaining({ renamed: 1 }), null);
    expect(props.onClose).toHaveBeenCalledWith("imported");
  });

  it("\"Importar\" fica desabilitado sem prévia e sem nada marcado; o Enter nunca importa", async () => {
    const view = await opened();
    (view.row("c1").props.onMark as (key: string) => void)("c1");
    (drawn().row("c2").props.onMark as (key: string) => void)("c2");
    expect(drawn().submit?.props.disabled).toBe(true);

    const event = { key: "Enter", target: { tagName: "INPUT", id: "busca" }, preventDefault: vi.fn() };
    (drawn().form?.props.onKeyDown as (event: unknown) => void)(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.importFn).not.toHaveBeenCalled();
  });

  it("a recusa da importação deixa o diálogo aberto com a origem, a prévia e as marcas; só a cópia que sumiu pede a origem de novo", async () => {
    const view = await opened();
    (view.row("c2").props.onMark as (key: string) => void)("c2");

    mocks.importFn.mockResolvedValue(refused(404, "FOLDER_NOT_FOUND"));
    submit();
    await settle();
    let after = drawn();
    expect(after.errorOf("-destination-error")).toBe("A pasta escolhida não existe mais. Escolha outro lugar.");
    expect(after.row("c2").props.state).toBe("unchecked");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(mocks.releaseFn).not.toHaveBeenCalled();

    mocks.importFn.mockResolvedValue(refused(404, "DBEAVER_SOURCE_MISSING"));
    (drawn().destination?.props.onChange as (value: string) => void)("root");
    await settle();
    submit();
    await settle();
    after = drawn();
    expect(after.origin).toBe("A cópia do DBeaver não existe mais. Procure o DBeaver de novo.");
    expect(after.rows).toEqual([]);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("\"Cancelar\" fecha sem importar, e como convite o botão é \"Agora não\"", async () => {
    await opened();
    click("Cancelar");
    expect(props.onClose).toHaveBeenCalledWith("dismissed");

    rt.unmount();
    props.invite = true;
    await opened();
    expect(drawn().button("Cancelar")).toBeUndefined();
    click("Agora não");
    expect(props.onClose).toHaveBeenLastCalledWith("dismissed");
  });

  it("Esc e o X chamam o fechar do diálogo, que fecha como \"dismissed\"", async () => {
    const view = await opened();
    (view.dialog.props.onClose as () => void)();
    expect(props.onClose).toHaveBeenCalledWith("dismissed");
  });
});

describe("sobrescrever (RN-DBEAVER-017)", () => {
  const submit = () => (drawn().form?.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
  const withExisting = () =>
    previewOf([
      connection("c1", { existing: existing(1, "DATA FIX", true), overwrite: flags({ host: true, password: true }), host: "pg-hml.exemplo.invalid" }),
      connection("c2", { existing: existing(2, "NOMINAL"), overwrite: flags() }),
      connection("c3"),
    ]);

  it("com alguma marcada que já existe, \"Importar\" abre a pergunta em vez de gravar, com a conta e os quatro botões", async () => {
    await opened(withExisting());
    submit();
    const view = drawn();

    expect(mocks.importFn).not.toHaveBeenCalled();
    expect(view.title).toBe("Sobrescrever?");
    expect(view.description).toBe("2 conexões do DBeaver já existem no Prism. Sobrescrever?");
    expect(view.all.some((element) => element.props.children === copy.overwrite.connected(1))).toBe(true);
    for (const label of ["Cancelar", "Não sobrescrever nenhuma", "Escolher quais…", "Sobrescrever todas"]) expect(view.button(label), label).toBeDefined();
    // A pergunta ocupa a janela: o formulário não está na tela, e o foco começa em "Cancelar".
    expect(view.form).toBeUndefined();
    expect(view.button("Cancelar")?.props.autoFocus).toBe(true);
  });

  it("\"Sobrescrever todas\" manda as chaves das que já existem; \"Não sobrescrever nenhuma\", nenhuma, e as duas levam todas as marcadas", async () => {
    mocks.importFn.mockResolvedValue({ ok: true, data: imported({ updatedIDs: ["0199e0a2-0000-7000-8000-000000000001"] }) });
    await opened(withExisting());
    submit();
    click("Sobrescrever todas");
    await settle();
    expect(mocks.importFn.mock.calls[0][0]).toMatchObject({ items: ["c1", "c2", "c3"], overwrite: ["c1", "c2"] });
    expect(mocks.toast.success).toHaveBeenCalledWith("1 conexão e 1 pasta importadas do DBeaver, 1 atualizada.");

    rt.unmount();
    mocks.importFn.mockClear();
    await opened(withExisting());
    submit();
    click("Não sobrescrever nenhuma");
    await settle();
    expect(mocks.importFn.mock.calls[0][0]).toMatchObject({ items: ["c1", "c2", "c3"], overwrite: [] });
  });

  it("\"Escolher quais…\" lista as que já existem, todas marcadas, com o que muda; desmarcar é manter a do Prism", async () => {
    mocks.importFn.mockResolvedValue({ ok: true, data: imported() });
    await opened(withExisting());
    submit();
    click("Escolher quais…");
    const view = drawn();

    const list = view.all.find((element) => element.type === "ul" && element.props["aria-label"] === copy.overwrite.list) as Found;
    const items = elementsOf(list).filter((element) => element.type === "li");
    expect(items).toHaveLength(2);
    const text = (element: Found) => elementsOf(element).flatMap((child) => (typeof child.props.children === "string" ? [child.props.children] : []));
    expect(text(items[0])).toEqual(expect.arrayContaining(["DATA FIX", "Estoque", "host; senha", copy.overwrite.rowConnected]));
    expect(text(items[1])).toEqual(expect.arrayContaining(["NOMINAL", "nada muda"]));
    expect(view.button("Importar e sobrescrever as marcadas")).toBeDefined();

    const boxes = view.all.filter((element) => element.type === "input" && element.props.type === "checkbox");
    expect(boxes.map((box) => box.props.checked)).toEqual([true, true]);
    (boxes[0].props.onChange as (event: unknown) => void)({ target: { checked: false } });
    click("Importar e sobrescrever as marcadas");
    await settle();

    expect(mocks.importFn.mock.calls[0][0]).toMatchObject({ overwrite: ["c2"] });
  });

  it("\"Cancelar\" e Esc voltam ao diálogo, sem gravar", async () => {
    await opened(withExisting());
    submit();
    click("Cancelar");
    expect(drawn().form).toBeDefined();
    expect(drawn().row("c1").props.state).toBe("checked");

    submit();
    (drawn().dialog.props.onClose as () => void)();
    expect(drawn().form).toBeDefined();
    expect(mocks.importFn).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("a conexão que já existe mas foi desmarcada não pergunta nada", async () => {
    mocks.importFn.mockResolvedValue({ ok: true, data: imported() });
    const view = await opened(withExisting());
    (view.row("c1").props.onMark as (key: string) => void)("c1");
    (drawn().row("c2").props.onMark as (key: string) => void)("c2");
    submit();
    await settle();

    expect(mocks.importFn).toHaveBeenCalledOnce();
    expect(mocks.importFn.mock.calls[0][0]).toMatchObject({ items: ["c3"], overwrite: [] });
  });
});
