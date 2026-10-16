import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// O diálogo com os ganchos do React simulados (`createHookRuntime`): o arquivo lido, a senha, o lugar, a prévia e as marcas são estado, e o vitest deste
// projeto não tem DOM. As mutações são de mentira, como no teste do "Exportar conexões"; o cache de verdade está em `transfer.service.test.ts`.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  reset: vi.fn(),
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
vi.mock("../_lib/connections.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/connections.service")>()), invalidateLists: mocks.invalidate }));
vi.mock("../_lib/transfer.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_lib/transfer.service")>();
  const { allowRefusal } = await import("@/lib/api/prism-api");
  return {
    ...actual,
    previewMutation: { gcTime: 0, mutationFn: async (request: unknown) => allowRefusal(await mocks.previewFn(request), ...actual.importRefusals) },
    importMutation: () => ({
      gcTime: 0,
      mutationFn: async (request: unknown) => allowRefusal(await mocks.importFn(request), ...actual.importRefusals),
      onSuccess: async (result: { ok: boolean }) => {
        if (result.ok) await mocks.invalidate();
      },
    }),
  };
});

import { Button, FieldError, Select, TextField } from "@/components/ui";
import type { ApiResult } from "@/lib/api/prism-api";
import { buttonLabeled, elementsOf, type Found } from "@/lib/testing/react-tree";

import { unprotected, type Folder } from "../_lib/connections.schema";
import { transferCopy } from "../_lib/transfer.copy";
import { importPreviewSchema, type ImportResult } from "../_lib/transfer.schema";
import { ImportConnectionsDialog } from "./import-connections-dialog";

const copy = transferCopy.import;
const now = "2026-10-16T12:00:00Z";
const folder = (id: string, parentID: string | null, name: string): Folder => ({ id, parentID, name, environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now });
const sistemas = folder("0199e0a2-0000-7000-8000-0000000000f1", null, "Sistemas");
const outra = folder("0199e0a2-0000-7000-8000-0000000000f2", null, "Outra");

const content = '{"kind":"prism-connections","version":1,"kdf":{},"payload":{}}';
const preview = {
  folders: [{ key: "f1", parentKey: null, name: "Estoque", color: null, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, existing: false, strengthened: null, invalid: null }],
  connections: [
    { key: "c1", folderKey: "f1", name: "DATA FIX", engine: 3, host: "informix-prd.exemplo.invalid", port: 9089, database: "estoque", userName: "datafix", hasPassword: true, verificationEnabled: true, verificationInterval: 30, verificationQuery: null, effective: null, conflict: true, copyName: "DATA FIX (cópia)", strengthened: null, invalid: null },
    { key: "c2", folderKey: "f1", name: "NOMINAL", engine: 3, host: "informix-prd.exemplo.invalid", port: 9089, database: "estoque", userName: "", hasPassword: false, verificationEnabled: true, verificationInterval: 30, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1", effective: null, conflict: false, copyName: null, strengthened: null, invalid: null },
  ],
};
const imported: ImportResult = { folderIDs: ["0199e0a2-0000-7000-8000-0000000000f9"], connectionIDs: ["0199e0a2-0000-7000-8000-000000000001", "0199e0a2-0000-7000-8000-000000000002"], mergedFolders: 0, renamed: 1, skipped: 0 };
const refused = (status: number, code: string): ApiResult<never> => ({ ok: false, error: { status, code, title: `Título de ${code}`, detail: "detalhe da API", errors: null, extensions: {} } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const file = (size = content.length, text: () => Promise<string> = async () => content) => ({ name: "conexoes-prism-2026-10-16.prismconexoes", size, text: vi.fn(text) });

type Props = { targetFolderID: string | null; onImported: Mock<(result: ImportResult, targetFolderID: string | null) => void>; onClose: Mock<() => void> };
let props: Props;

/** Desenha o diálogo com o estado que ele já tem, e acha o que o teste usa. */
function drawn() {
  const tree = rt.render(() => ImportConnectionsDialog(props));
  const all = elementsOf(tree);
  const errorOf = (suffix: string) => all.find((element) => element.type === FieldError && String(element.props.id).endsWith(suffix))?.props.children ?? null;
  const rows = all.filter((element) => element.props.node !== undefined && element.props.state !== undefined);
  return {
    all,
    fileInput: all.find((element) => element.type === "input" && element.props.type === "file") as Found,
    passphrase: all.find((element) => element.type === TextField) as Found,
    destination: all.find((element) => element.type === Select) as Found,
    form: all.find((element) => element.type === "form") as Found,
    submit: all.find((element) => element.type === Button && element.props.type === "submit") as Found,
    counter: all.find((element) => element.props.role === "status" && element.type === "p" && typeof element.props.children === "string" && element.props.children !== copy.refreshing)?.props.children,
    texts: all.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : [])),
    fileError: errorOf("-file-error"),
    destinationError: errorOf("-destination-error"),
    rows,
    row: (key: string) => rows.find((row) => (row.props.node as { key: string }).key === key) as Found,
    radios: all.filter((element) => element.type === "input" && element.props.type === "radio"),
    search: all.find((element) => typeof element.props.onQuery === "function"),
    keepQueries: (all.find((element) => element.type === "label" && Array.isArray(element.props.children) && element.props.children.includes(copy.queries.keep))?.props.children as Found[] | undefined)?.[0],
    fileErrorElement: all.find((element) => element.type === FieldError && String(element.props.id).endsWith("-file-error")) as Found,
    destinationErrorElement: all.find((element) => element.type === FieldError && String(element.props.id).endsWith("-destination-error")) as Found,
  };
}

/** O Enter num elemento do formulário: devolve o `preventDefault` do evento, para conferir se o diálogo o barrou. */
function pressEnter(target: { tagName: string; id: string }) {
  const event = { key: "Enter", target, preventDefault: vi.fn() };
  (drawn().form.props.onKeyDown as (event: unknown) => void)(event);
  return event.preventDefault;
}

async function choose(chosen: ReturnType<typeof file>) {
  await (drawn().fileInput.props.onChange as (event: unknown) => Promise<void>)({ target: { files: [chosen], value: "C:\\fakepath\\x" } });
  return drawn();
}

function typePassphrase(value: string) {
  (drawn().passphrase.props.onChange as (event: unknown) => void)({ target: { value } });
}

async function open() {
  (buttonLabeled(drawn().all, copy.open)?.props.onClick as () => void)();
  await settle();
  return drawn();
}

async function opened() {
  // O serviço de verdade passa a resposta pelo schema: o que chega ao diálogo é a prévia já lida.
  mocks.previewFn.mockResolvedValue({ ok: true, data: importPreviewSchema.parse(preview) });
  await choose(file());
  typePassphrase(" senha-de-exportação\u00A0");
  return open();
}

beforeEach(() => {
  rt.unmount();
  props = { targetFolderID: null, onImported: vi.fn(), onClose: vi.fn() };
  mocks.folders = [sistemas, outra];
  mocks.gcTimes = [];
  for (const mock of [mocks.toast.success, mocks.toast.warning, mocks.toast.error, mocks.reset, mocks.previewFn, mocks.importFn, mocks.invalidate]) mock.mockReset();
});

describe("o diálogo “Importar conexões” (RN-TRANSF-009)", () => {
  it("antes da prévia: a frase que diz como chegar a ela, “Na raiz do navegador” escolhido, e “Importar” desabilitado", () => {
    const view = drawn();

    expect(view.texts).toContain(copy.placeholder);
    expect(view.destination.props.value).toBe("root");
    expect((view.destination.props.options as { label: string }[]).map((option) => option.label)).toEqual([copy.root, "Outra", "Sistemas"]);
    expect(view.submit.props.disabled).toBe(true);
    expect(view.fileInput.props.accept).toBe(".prismconexoes");
  });

  it("aberto por “Importar conexões aqui…”, a pasta de onde veio já vem escolhida", () => {
    props.targetFolderID = sistemas.id;
    expect(drawn().destination.props.value).toBe(sistemas.id);
  });

  it("o arquivo de mais de 5 MiB é recusado no campo antes de ser lido, com a frase dos limites", async () => {
    const big = file(5 * 1024 * 1024 + 1);
    const view = await choose(big);

    expect(big.text).not.toHaveBeenCalled();
    expect(view.fileError).toBe(copy.fileErrors.limits);
  });

  it("o arquivo que o sistema não deixa ler: “Não foi possível ler este arquivo.”", async () => {
    const view = await choose(
      file(10, async () => {
        throw new Error("NotReadableError");
      }),
    );

    expect(view.fileError).toBe(copy.unreadable);
  });

  it("“Abrir arquivo” sem o arquivo ou sem a senha diz no campo o que falta, sem pedir nada à API", async () => {
    const view = await open();

    expect(view.fileError).toBe(copy.fileRequired);
    expect(view.passphrase.props.error).toBe(copy.passphraseErrors.required);
    expect(mocks.previewFn).not.toHaveBeenCalled();
  });
});

describe("a prévia (RN-TRANSF-010 e 011)", () => {
  it("leva o arquivo, a senha sem os espaços das pontas e o lugar; mostra o resumo, o aviso dos servidores e tudo marcado", async () => {
    const view = await opened();

    expect(mocks.previewFn).toHaveBeenCalledExactlyOnceWith({ content, passphrase: "senha-de-exportação", targetFolderID: null });
    expect(view.texts).toEqual(expect.arrayContaining(["O arquivo tem 2 conexões em 1 pasta: 1 com usuário, 1 com a senha.", copy.preview.servers]));
    expect(view.row("f1").props.state).toBe("checked");
    expect(view.counter).toBe("2 conexões e 1 pasta marcadas");
    expect(view.submit.props.disabled).toBe(false);
  });

  it("a mutação não fica no cache: `gcTime: 0` e `reset()` assim que a resposta chega, também da recusa (RN-TRANSF-001)", async () => {
    mocks.previewFn.mockResolvedValue(refused(422, "IMPORT_PASSPHRASE_WRONG"));
    await choose(file());
    typePassphrase("errada");
    await open();

    expect(mocks.gcTimes.every((gcTime) => gcTime === 0)).toBe(true);
    expect(mocks.reset).toHaveBeenCalledOnce();
  });

  it.each([
    ["IMPORT_PASSPHRASE_WRONG", "passphrase", copy.passphraseErrors.wrong],
    ["IMPORT_FILE_INVALID", "file", copy.fileErrors.invalid],
    ["IMPORT_FILE_NEWER", "file", copy.fileErrors.newer],
    ["IMPORT_LIMITS_EXCEEDED", "file", copy.fileErrors.limits],
  ])("%s aparece no campo, com a frase da tela, sem aviso de erro", async (code, field, message) => {
    mocks.previewFn.mockResolvedValue(refused(422, code));
    await choose(file());
    typePassphrase("errada");
    const view = await open();

    expect(field === "file" ? view.fileError : view.passphrase.props.error).toBe(message);
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("a senha recusada fica no campo (não é apagada)", async () => {
    mocks.previewFn.mockResolvedValue(refused(422, "IMPORT_PASSPHRASE_WRONG"));
    await choose(file());
    typePassphrase("senha do colega");
    const view = await open();

    expect(view.passphrase.props.value).toBe("senha do colega");
  });

  it("trocar a senha apaga a prévia, e é preciso abrir de novo", async () => {
    await opened();
    typePassphrase("outra senha");
    const view = drawn();

    expect(view.texts).toContain(copy.placeholder);
    expect(view.submit.props.disabled).toBe(true);
  });

  it("trocar “Onde colocar” com a prévia à vista a refaz sozinho, e as marcas continuam", async () => {
    const view = await opened();
    (view.row("c2").props.onMark as (key: string) => void)("c2");
    (drawn().destination.props.onChange as (value: string) => void)(sistemas.id);
    await settle();
    const after = drawn();

    expect(mocks.previewFn).toHaveBeenLastCalledWith({ content, passphrase: "senha-de-exportação", targetFolderID: sistemas.id });
    expect(after.row("c2").props.state).toBe("unchecked");
    expect(after.counter).toBe("1 conexão e 1 pasta marcadas");
  });

  it("a escolha dos conflitos só aparece com conflito, com “Importar com outro nome” escolhido; a caixa das consultas, desmarcada", async () => {
    const view = await opened();

    expect(view.radios.map((radio) => [radio.props.value, radio.props.checked])).toEqual([
      ["rename", true],
      ["skip", false],
    ]);
    expect(view.texts).toEqual(expect.arrayContaining([copy.conflicts.count(1), copy.queries.hint(1)]));
    const keep = view.all.find((element) => element.type === "input" && element.props.type === "checkbox" && element.props.checked === false && typeof element.props.onChange === "function" && element.props["aria-label"] === undefined);
    expect(keep).toBeDefined();
  });
});

describe("o que é da prévia, e o teclado (RN-TRANSF-009 e 011)", () => {
  it("escolher outro arquivo apaga a prévia, e é preciso abrir de novo", async () => {
    await opened();
    const view = await choose(file());

    expect(view.texts).toContain(copy.placeholder);
    expect(view.rows).toEqual([]);
    expect(view.submit.props.disabled).toBe(true);
  });

  it("outro arquivo não herda a prévia de antes: a busca, as pastas fechadas, a escolha dos conflitos e a caixa das consultas, que volta desmarcada", async () => {
    let view = await opened();
    (view.row("f1").props.onToggleOpen as (key: string) => void)("f1");
    (drawn().keepQueries?.props.onChange as (event: unknown) => void)({ target: { checked: true } });
    (drawn().radios.find((radio) => radio.props.value === "skip")?.props.onChange as () => void)();
    (drawn().search?.props.onQuery as (query: string) => void)("nominal");
    view = drawn();
    expect([view.keepQueries?.props.checked, view.search?.props.query, view.radios.find((radio) => radio.props.checked)?.props.value]).toEqual([true, "nominal", "skip"]);

    // O arquivo de outra pessoa: as chaves `f1`, `c1`… se repetem de um arquivo do Prism para outro.
    await choose(file());
    view = await open();

    expect(view.keepQueries?.props.checked).toBe(false);
    expect(view.search?.props.query).toBe("");
    expect(view.row("f1").props.open).toBe(true);
    expect(view.radios.find((radio) => radio.props.checked)?.props.value).toBe("rename");
    expect(view.destination.props.value).toBe("root");
  });

  it("com a busca, a pasta fechada abre para mostrar o que casou; limpar a busca a devolve fechada (RN-BUSCA-001)", async () => {
    const view = await opened();
    (view.row("f1").props.onToggleOpen as (key: string) => void)("f1");
    expect(drawn().rows.map((row) => (row.props.node as { key: string }).key)).toEqual(["f1"]);

    (drawn().search?.props.onQuery as (query: string) => void)("data fix");
    expect(drawn().rows.map((row) => (row.props.node as { key: string }).key)).toEqual(["f1", "c1"]);
    expect(drawn().row("f1").props.open).toBe(true);

    (drawn().search?.props.onQuery as (query: string) => void)("");
    expect(drawn().row("f1").props.open).toBe(false);
  });

  it("o Enter nunca importa: na busca, numa caixa, num rádio ou na senha com a prévia à vista ele é barrado, e nada vai à API", async () => {
    const view = await opened();
    const search = { tagName: "INPUT", id: String(view.search?.props.id) };

    for (const target of [search, { tagName: "INPUT", id: "" }, { tagName: "INPUT", id: String(view.passphrase.props.id) }]) expect(pressEnter(target)).toHaveBeenCalledOnce();
    await settle();

    expect(mocks.importFn).not.toHaveBeenCalled();
    expect(mocks.previewFn).toHaveBeenCalledOnce();
    // O Enter num botão faz o que é dele (o clique), e não é barrado.
    expect(pressEnter({ tagName: "BUTTON", id: "" })).not.toHaveBeenCalled();
  });

  it("antes da prévia, o Enter na senha de exportação é o “Abrir arquivo”", async () => {
    mocks.previewFn.mockResolvedValue({ ok: true, data: importPreviewSchema.parse(preview) });
    await choose(file());
    typePassphrase("senha-de-exportação");
    expect(pressEnter({ tagName: "INPUT", id: String(drawn().passphrase.props.id) })).toHaveBeenCalledOnce();
    await settle();

    expect(mocks.previewFn).toHaveBeenCalledExactlyOnceWith({ content, passphrase: "senha-de-exportação", targetFolderID: null });
    expect(drawn().row("f1")).toBeDefined();
  });

  it("a troca de lugar durante “Atualizando a prévia…” espera o fim dele e refaz uma vez só, com o último lugar", async () => {
    await opened();
    let release: () => void = () => {};
    mocks.previewFn.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ ok: true, data: importPreviewSchema.parse(preview) }))));

    (drawn().destination.props.onChange as (value: string) => void)(sistemas.id);
    expect(drawn().texts).toContain(copy.refreshing);
    (drawn().destination.props.onChange as (value: string) => void)(outra.id);
    (drawn().destination.props.onChange as (value: string) => void)("root");
    expect(mocks.previewFn).toHaveBeenCalledTimes(2);

    release();
    await settle();
    await settle();

    expect(mocks.previewFn).toHaveBeenCalledTimes(3);
    expect(mocks.previewFn).toHaveBeenLastCalledWith({ content, passphrase: "senha-de-exportação", targetFolderID: null });
    expect(drawn().texts).not.toContain(copy.refreshing);
  });

  it("as recusas do arquivo e do lugar têm papel de alerta, e o resumo da prévia é anunciado quando chega", async () => {
    const before = drawn();
    expect([before.fileErrorElement?.props.role, before.destinationErrorElement?.props.role]).toEqual(["alert", "alert"]);

    const view = await opened();
    const summary = view.all.find((element) => element.props["aria-live"] === "polite") as Found;
    expect(summary.props.children).toBe("O arquivo tem 2 conexões em 1 pasta: 1 com usuário, 1 com a senha.");
  });
});

describe("importar (RN-TRANSF-012 a 014)", () => {
  it("manda o arquivo, a senha, o lugar, as chaves marcadas, a escolha dos conflitos e a caixa das consultas; avisa, fecha e mostra o que entrou", async () => {
    mocks.importFn.mockResolvedValue({ ok: true, data: imported });
    const view = await opened();
    (view.radios.find((radio) => radio.props.value === "skip")?.props.onChange as () => void)();
    (drawn().form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} });
    await settle();

    expect(mocks.importFn).toHaveBeenCalledExactlyOnceWith({ content, passphrase: "senha-de-exportação", targetFolderID: null, items: ["c1", "c2"], onConflict: "skip", keepVerificationQueries: false });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith("2 conexões e 1 pasta importadas, 1 com outro nome.");
    expect(props.onImported).toHaveBeenCalledExactlyOnceWith(imported, null);
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(mocks.reset).toHaveBeenCalledTimes(2);
  });

  it("o “Não importar” que deixou conexões de fora dá o aviso de atenção", async () => {
    mocks.importFn.mockResolvedValue({ ok: true, data: { ...imported, renamed: 0, skipped: 1, connectionIDs: imported.connectionIDs.slice(0, 1) } });
    await opened();
    (drawn().form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} });
    await settle();

    expect(mocks.toast.warning).toHaveBeenCalledExactlyOnceWith("1 conexão e 1 pasta importadas. 1 conexão não importada: já existia no lugar escolhido.");
  });

  it("nada marcado: “Importar” desabilitado, e nada vai à API", async () => {
    const view = await opened();
    (view.all.find((element) => typeof element.props.onUnmarkAll === "function")?.props.onUnmarkAll as () => void)();
    const after = drawn();
    (after.form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} });

    expect(after.submit.props.disabled).toBe(true);
    expect(after.counter).toBe("Nada marcado");
    expect(mocks.importFn).not.toHaveBeenCalled();
  });

  it("o lugar que outra janela excluiu: as listas vêm de novo, e “Onde colocar” fica sem escolha, com a frase", async () => {
    mocks.importFn.mockResolvedValue(refused(404, "FOLDER_NOT_FOUND"));
    props.targetFolderID = sistemas.id;
    await opened();
    (drawn().form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} });
    await settle();
    const view = drawn();

    expect(view.destinationError).toBe(copy.destinationGone);
    expect(view.destination.props.value).toBe("none");
    expect(view.submit.props.disabled).toBe(true);
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("a pasta escolhida que some da lista deixa “Onde colocar” sem escolha, com a frase", () => {
    props.targetFolderID = sistemas.id;
    drawn();
    mocks.folders = [outra];

    expect(drawn().destinationError).toBe(copy.destinationGone);
  });
});
