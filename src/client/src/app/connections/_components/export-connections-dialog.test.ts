import { beforeEach, describe, expect, it, vi } from "vitest";

// O diálogo com os ganchos do React simulados (`createHookRuntime`): as marcas, as escolhas e as senhas são estado, e o vitest deste projeto não tem DOM. A
// mutação é de mentira: `mutate` roda a `mutationFn` e entrega a resposta às `onSuccess` (a da mutação e a do `mutate`), ou o erro às `onError`, como a de
// verdade; o `reset` é contado, porque é ele que tira as senhas e o arquivo do cache (o cache de verdade está em `transfer.service.test.ts`).
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  reset: vi.fn(),
  exportFn: vi.fn(),
  saveText: vi.fn(),
  invalidate: vi.fn(async () => {}),
  lists: {} as Record<string, unknown>,
  gcTimes: [] as unknown[],
}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQuery: (options: { queryKey: readonly string[] }) => ({ data: mocks.lists[options.queryKey[0]] }),
  useMutation: (options: { mutationFn: (variables: unknown) => Promise<unknown>; onSuccess?: (result: unknown) => void; gcTime?: number }) => {
    mocks.gcTimes.push(options.gcTime);
    return {
      isPending: false,
      reset: mocks.reset,
      mutate: (variables: unknown, callbacks: { onSuccess?: (result: unknown) => void; onError?: (error: unknown) => void } = {}) =>
        options.mutationFn(variables).then(
          (result) => {
            options.onSuccess?.(result);
            callbacks.onSuccess?.(result);
          },
          (error) => callbacks.onError?.(error),
        ),
    };
  },
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));
vi.mock("@/app/workbench/_lib/save-file", () => ({ saveText: mocks.saveText }));
vi.mock("../_lib/connections.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/connections.service")>()), invalidateLists: mocks.invalidate }));
vi.mock("../_lib/transfer.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_lib/transfer.service")>();
  const { allowRefusal } = await import("@/lib/api/prism-api");
  return { ...actual, exportConnections: mocks.exportFn, exportMutation: { gcTime: 0, mutationFn: async (request: unknown) => allowRefusal(await mocks.exportFn(request), ...actual.exportRefusals) } };
});

import { Button, FormMessage, TextField } from "@/components/ui";
import type { ApiResult } from "@/lib/api/prism-api";
import { vaultLock } from "@/lib/api/vault-lock";
import { buttonLabeled, elementsOf, type Found } from "@/lib/testing/react-tree";

import { newVerification, unprotected, type Connection, type Folder } from "../_lib/connections.schema";
import type { ExportOrigin } from "../_lib/export-model";
import { transferCopy } from "../_lib/transfer.copy";
import type { CredentialsChoice, ExportResult } from "../_lib/transfer.schema";
import { ExportConnectionsDialog } from "./export-connections-dialog";
import { UserPasswordDialog } from "./user-password-dialog";

const copy = transferCopy.export;
const now = "2026-10-16T12:00:00Z";
const folder = (id: string, parentID: string | null, name: string): Folder => ({ id, parentID, name, environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now });
const connection = (id: string, folderID: string | null, name: string, userName: string, hasPassword: boolean): Connection => ({
  id,
  folderID,
  name,
  engine: 3,
  host: "informix-prd.exemplo.invalid",
  port: 9089,
  database: "estoque",
  userName,
  hasPassword,
  environmentName: null,
  environmentColor: null,
  confirmCommands: null,
  readOnly: false,
  ...newVerification,
  protections: unprotected,
  createdAt: now,
  updatedAt: now,
});

// O exemplo do dono: Estoque › Production PRD e Desenvolvimento DEV, com a DATA FIX (o usuário que o time divide) e a NOMINAL; a API_USER veio de uma
// importação sem usuário e senha; e uma pasta vazia.
const folders = [folder("estoque", null, "Estoque"), folder("prd", "estoque", "Production PRD"), folder("dev", "estoque", "Desenvolvimento DEV"), folder("vazia", null, "Arquivo morto")];
const connections = [
  connection("prd-fix", "prd", "DATA FIX", "datafix", true),
  connection("prd-nominal", "prd", "NOMINAL", "nominal", true),
  connection("dev-fix", "dev", "DATA FIX", "datafix", true),
  connection("sem-tudo", "dev", "API_USER", "", false),
];
const exported: ExportResult = { content: '{"kind":"prism-connections","version":1,"payload":"…"}', folders: 2, connections: 1, withUser: 1, withPassword: 0 };
const refused = (status: number, code: string, errors: Record<string, string[]> | null = null): ApiResult<ExportResult> => ({ ok: false, error: { status, code, title: `Título de ${code}`, detail: null, errors, extensions: {} } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const passphrase = "senha-de-exportação";

type Drawn = ReturnType<typeof drawn>;

/** Desenha o diálogo com o estado que ele já tem, e acha o que o teste usa. */
function drawn(origin: ExportOrigin, onClose = vi.fn()) {
  const tree = rt.render(() => ExportConnectionsDialog({ origin, onClose }));
  const all = elementsOf(tree);
  const field = (suffix: string) => all.find((element) => element.type === TextField && String(element.props.id).endsWith(suffix)) as Found;
  const rows = all.filter((element) => element.props.node !== undefined && element.props.state !== undefined);
  return {
    all,
    form: all.find((element) => element.type === "form") as Found,
    passphrase: field("-passphrase"),
    passphraseAgain: field("-passphrase-again"),
    rows,
    row: (key: string) => rows.find((row) => (row.props.node as { key: string }).key === key) as Found,
    counter: all.find((element) => element.props.role === "status")?.props.children,
    submit: all.find((element) => element.type === Button && element.props.type === "submit") as Found,
    messages: all.filter((element) => element.type === FormMessage).map((element) => element.props.children),
    password: all.find((element) => element.type === UserPasswordDialog),
    bulkGroup: all.find((element) => element.props.role === "group"),
  };
}

function type(view: Drawn, value: string, again = value) {
  (view.passphrase.props.onChange as (event: unknown) => void)({ target: { value } });
  (view.passphraseAgain.props.onChange as (event: unknown) => void)({ target: { value: again } });
}

async function submit(origin: ExportOrigin, onClose = vi.fn()) {
  (drawn(origin, onClose).form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} });
  await settle();
  return drawn(origin, onClose);
}

const choose = (view: Drawn, id: string, choice: CredentialsChoice) => (view.row(id).props.onChoice as (id: string, choice: CredentialsChoice) => void)(id, choice);

beforeEach(() => {
  rt.unmount();
  mocks.lists = { folders, connections };
  mocks.gcTimes = [];
  for (const mock of [mocks.toast.success, mocks.toast.warning, mocks.toast.error, mocks.reset, mocks.exportFn, mocks.saveText, mocks.invalidate]) mock.mockReset();
});

describe("o diálogo “Exportar conexões” (RN-TRANSF-002)", () => {
  it("a árvore é a do cofre inteiro, na ordem do navegador; aberto pela pasta, ela e tudo o que está dentro vêm marcados", () => {
    const view = drawn({ type: "folder", id: "estoque" });

    expect(view.rows.map((row) => (row.props.node as { key: string }).key)).toEqual(["vazia", "estoque", "dev", "sem-tudo", "dev-fix", "prd", "prd-fix", "prd-nominal"]);
    expect(view.row("estoque").props.state).toBe("checked");
    expect(view.row("vazia").props.state).toBe("unchecked");
    expect(view.counter).toBe("4 conexões marcadas · 3 pastas no arquivo");
    expect(view.submit.props.disabled).toBe(false);
  });

  it("aberto pela conexão, só ela; pelo espaço vazio, nada, e “Exportar…” fica desabilitado com a dica", () => {
    expect(drawn({ type: "connection", id: "prd-fix" }).counter).toBe("1 conexão marcada · 2 pastas no arquivo");

    rt.unmount();
    const empty = drawn({ type: "all" });
    expect(empty.counter).toBe("Nada marcado");
    expect(empty.submit.props).toMatchObject({ disabled: true, title: "Marque ao menos uma conexão ou pasta." });
  });

  it("a escolha do que vai: só o que a conexão tem, desabilitada quando a conexão está desmarcada ou não tem usuário", () => {
    const view = drawn({ type: "connection", id: "prd-fix" });

    expect(view.row("prd-fix").props).toMatchObject({ choice: "none", state: "checked" });
    expect(view.row("dev-fix").props.state).toBe("unchecked");
    expect(view.row("sem-tudo").props.connection).toMatchObject({ userName: "" });
  });

  it("“Para as marcadas:” põe a escolha em todas as marcadas, e o aviso das senhas aparece acima dos botões (RN-TRANSF-003)", () => {
    const view = drawn({ type: "folder", id: "estoque" });
    (buttonLabeled(view.all, copy.credentials.userAndPassword)?.props.onClick as () => void)();
    const after = drawn({ type: "folder", id: "estoque" });

    expect(after.row("prd-fix").props.choice).toBe("userAndPassword");
    // A conexão sem usuário fica com o mais perto que ela tem.
    expect(after.row("sem-tudo").props.choice).toBe("none");
    expect(after.counter).toBe("4 conexões marcadas, 3 com a senha · 3 pastas no arquivo");
    expect(after.messages).toContain(copy.passwordsWarning(3));
  });

  it("com a busca, o texto dos botões muda e eles agem só nas marcadas que ela mostra", () => {
    const search = (view: Drawn, query: string) => (view.all.find((element) => typeof element.props.onQuery === "function")?.props.onQuery as (query: string) => void)(query);
    search(drawn({ type: "folder", id: "estoque" }), "data fix");
    const searching = drawn({ type: "folder", id: "estoque" });
    expect(searching.bulkGroup?.props["aria-label"]).toBe(copy.credentials.bulkSearching);
    expect(searching.rows.map((row) => (row.props.node as { key: string }).key)).toEqual(["estoque", "dev", "dev-fix", "prd", "prd-fix"]);

    (buttonLabeled(searching.all, copy.credentials.userAndPassword)?.props.onClick as () => void)();
    search(drawn({ type: "folder", id: "estoque" }), "");
    const after = drawn({ type: "folder", id: "estoque" });
    expect(after.bulkGroup?.props["aria-label"]).toBe(copy.credentials.bulk);
    expect(after.row("prd-fix").props.choice).toBe("userAndPassword");
    expect(after.row("dev-fix").props.choice).toBe("userAndPassword");
    expect(after.row("prd-nominal").props.choice).toBe("none");
  });
});

describe("a busca e o teclado (RN-TRANSF-002)", () => {
  const origin: ExportOrigin = { type: "folder", id: "estoque" };
  const search = (query: string) => (drawn(origin).all.find((element) => typeof element.props.onQuery === "function")?.props.onQuery as (query: string) => void)(query);
  const shown = () => drawn(origin).rows.map((row) => (row.props.node as { key: string }).key);

  it("com a busca, a pasta fechada antes dela abre para mostrar o que casou, e limpar a busca a devolve fechada (RN-BUSCA-001)", () => {
    (drawn(origin).row("estoque").props.onToggleOpen as (key: string) => void)("estoque");
    expect(shown()).toEqual(["vazia", "estoque"]);

    search("data fix");
    expect(shown()).toEqual(["estoque", "dev", "dev-fix", "prd", "prd-fix"]);
    expect(drawn(origin).row("estoque").props.open).toBe(true);

    search("");
    expect(shown()).toEqual(["vazia", "estoque"]);
    expect(drawn(origin).row("estoque").props.open).toBe(false);
  });

  it("o Enter só exporta nos dois campos da senha: na busca, numa caixa ou em “Mostrar senha” ele é barrado, e nada vai à API", async () => {
    const view = drawn(origin);
    type(view, passphrase);
    const press = (target: { tagName: string; id: string }) => {
      const event = { key: "Enter", target, preventDefault: vi.fn() };
      (drawn(origin).form.props.onKeyDown as (event: unknown) => void)(event);
      return event.preventDefault;
    };
    const searchID = String(view.all.find((element) => typeof element.props.onQuery === "function")?.props.id);

    expect(press({ tagName: "INPUT", id: searchID })).toHaveBeenCalledOnce();
    expect(press({ tagName: "INPUT", id: "" })).toHaveBeenCalledOnce();
    expect(press({ tagName: "INPUT", id: String(view.passphrase.props.id) })).not.toHaveBeenCalled();
    expect(press({ tagName: "INPUT", id: String(view.passphraseAgain.props.id) })).not.toHaveBeenCalled();
    expect(press({ tagName: "BUTTON", id: "" })).not.toHaveBeenCalled();
    await settle();
    expect(mocks.exportFn).not.toHaveBeenCalled();
  });
});

describe("a senha de exportação (RN-TRANSF-004)", () => {
  it("as recusas aparecem no campo, conferidas antes do pedido; nada vai à API", async () => {
    type(drawn({ type: "connection", id: "prd-fix" }), "curta");
    let after = await submit({ type: "connection", id: "prd-fix" });
    expect(after.passphrase.props.error).toBe(copy.passphraseErrors.tooShort);

    type(after, passphrase, `${passphrase}x`);
    after = await submit({ type: "connection", id: "prd-fix" });
    expect(after.passphrase.props.error).toBeUndefined();
    expect(after.passphraseAgain.props.error).toBe(copy.passphraseErrors.mismatch);
    expect(mocks.exportFn).not.toHaveBeenCalled();
  });

  it("as duas senhas se comparam na forma NFC, e a que vai à API é a NFC", async () => {
    mocks.exportFn.mockResolvedValue({ ok: true, data: exported });
    type(drawn({ type: "connection", id: "prd-fix" }), "senha-de-exportação", "senha-de-exportação");
    await submit({ type: "connection", id: "prd-fix" });

    expect(mocks.exportFn).toHaveBeenCalledExactlyOnceWith({ folderIDs: [], connections: [{ id: "prd-fix", credentials: "none" }], passphrase: "senha-de-exportação" });
  });
});

describe("exportar sem senha de banco (RN-TRANSF-005 a 008)", () => {
  it("não pede a senha do Prism: o arquivo vai ao diálogo de salvar, com o nome do dia e o tipo binário, o aviso diz o que foi, e o diálogo fecha", async () => {
    mocks.exportFn.mockResolvedValue({ ok: true, data: exported });
    const onClose = vi.fn();
    const view = drawn({ type: "connection", id: "prd-fix" }, onClose);
    choose(view, "prd-fix", "user");
    type(drawn({ type: "connection", id: "prd-fix" }, onClose), passphrase);
    const after = await submit({ type: "connection", id: "prd-fix" }, onClose);

    expect(after.password).toBeUndefined();
    expect(mocks.exportFn).toHaveBeenCalledExactlyOnceWith({ folderIDs: [], connections: [{ id: "prd-fix", credentials: "user" }], passphrase });
    expect(mocks.exportFn.mock.calls[0][0]).not.toHaveProperty("userPassword");
    expect(mocks.saveText).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^conexoes-prism-\d{4}-\d{2}-\d{2}\.prismconexoes$/), exported.content, "application/octet-stream");
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith("1 conexão exportada.");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a mutação não fica no cache: `gcTime: 0`, e `reset()` assim que a resposta chega, também da recusa (RN-TRANSF-001)", async () => {
    mocks.exportFn.mockResolvedValue(refused(422, "EXPORT_LIMITS_EXCEEDED"));
    type(drawn({ type: "connection", id: "prd-fix" }), passphrase);
    const after = await submit({ type: "connection", id: "prd-fix" });

    expect(mocks.gcTimes.every((gcTime) => gcTime === 0)).toBe(true);
    expect(mocks.reset).toHaveBeenCalledOnce();
    // A recusa dos limites aparece acima dos botões, com a frase de um código só.
    expect(after.messages).toContain(copy.limits);
    expect(mocks.saveText).not.toHaveBeenCalled();
  });

  it("a falha que vai ao aviso central também esvazia a mutação", async () => {
    mocks.exportFn.mockRejectedValue(new Error("rede"));
    type(drawn({ type: "connection", id: "prd-fix" }), passphrase);
    await submit({ type: "connection", id: "prd-fix" });

    expect(mocks.reset).toHaveBeenCalledOnce();
  });

  it("o item marcado que outra janela excluiu: as listas são lidas de novo, o aviso diz o que fazer, e o diálogo fica aberto", async () => {
    mocks.exportFn.mockResolvedValue(refused(404, "CONNECTION_NOT_FOUND"));
    const onClose = vi.fn();
    type(drawn({ type: "connection", id: "prd-fix" }, onClose), passphrase);
    await submit({ type: "connection", id: "prd-fix" }, onClose);

    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.toast.error).toHaveBeenCalledExactlyOnceWith(copy.gone);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("o item que outra janela excluiu sai da árvore com a marca quando a lista volta", () => {
    drawn({ type: "connection", id: "prd-fix" });
    mocks.lists = { folders, connections: connections.filter((item) => item.id !== "prd-fix") };

    expect(drawn({ type: "connection", id: "prd-fix" }).counter).toBe("Nada marcado");
  });

  it("os limites que a tela sabe conferir (32 níveis da raiz) vêm antes de tudo, sem pedir nada à API nem a senha do Prism", async () => {
    const chain = Array.from({ length: 33 }, (_, at) => folder(`n${at}`, at === 0 ? null : `n${at - 1}`, `Nível ${at + 1}`));
    mocks.lists = { folders: chain, connections: [connection("fundo", "n32", "Fundo", "datafix", true)] };
    const view = drawn({ type: "connection", id: "fundo" });
    choose(view, "fundo", "userAndPassword");
    type(drawn({ type: "connection", id: "fundo" }), passphrase);
    const after = await submit({ type: "connection", id: "fundo" });

    expect(after.messages).toContain(copy.limits);
    expect(after.password).toBeUndefined();
    expect(mocks.exportFn).not.toHaveBeenCalled();
  });

  it("a resposta que chega depois de o cofre fechar é descartada: o arquivo não vai ao diálogo de salvar", async () => {
    let answer!: (result: ApiResult<ExportResult>) => void;
    mocks.exportFn.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    type(drawn({ type: "connection", id: "prd-fix" }), passphrase);
    (drawn({ type: "connection", id: "prd-fix" }).form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} });

    vaultLock.lock();
    vaultLock.unlock();
    answer({ ok: true, data: exported });
    await settle();

    expect(mocks.saveText).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.reset).toHaveBeenCalledOnce();
  });
});

describe("exportar com senha de banco: a senha do Prism (RN-TRANSF-005)", () => {
  async function asked() {
    const view = drawn({ type: "connection", id: "prd-fix" });
    choose(view, "prd-fix", "userAndPassword");
    type(drawn({ type: "connection", id: "prd-fix" }), passphrase);
    return submit({ type: "connection", id: "prd-fix" });
  }

  it("abre o “Confirme a sua senha” depois do “Exportar…”, com o que vai acontecer, o texto e o botão da exportação; nada sai antes", async () => {
    const view = await asked();

    expect(mocks.exportFn).not.toHaveBeenCalled();
    expect(view.password?.props).toMatchObject({ change: "Exportar DATA FIX com a senha", description: copy.userPassword.description, submitLabel: copy.userPassword.submit });
  });

  it("o pedido vai com a senha do Prism, e o arquivo sai da resposta dele", async () => {
    mocks.exportFn.mockResolvedValue({ ok: true, data: { ...exported, withPassword: 1 } });
    const view = await asked();
    const send = view.password?.props.send as (userPassword: string) => Promise<ApiResult<ExportResult>>;
    const result = await send("senha do prism");

    expect(mocks.exportFn).toHaveBeenCalledExactlyOnceWith({ folderIDs: [], connections: [{ id: "prd-fix", credentials: "userAndPassword" }], passphrase, userPassword: "senha do prism" });
    (view.password?.props.onDone as (result: unknown) => void)(result);
    expect(mocks.saveText).toHaveBeenCalledOnce();
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith("1 conexão exportada, com a senha.");
    expect(drawn({ type: "connection", id: "prd-fix" }).password).toBeUndefined();
  });

  it("a senha de exportação igual à do Prism fecha o “Confirme a sua senha” e aparece no campo da senha de exportação", async () => {
    const view = await asked();
    (view.password?.props.onDone as (result: unknown) => void)(refused(422, "EXPORT_PASSPHRASE_INVALID", { passphrase: ["Use uma senha de exportação diferente da sua senha do Prism."] }));
    const after = drawn({ type: "connection", id: "prd-fix" });

    expect(after.password).toBeUndefined();
    expect(after.passphrase.props.error).toBe(copy.passphraseErrors.samePrismPassword);
    expect(mocks.saveText).not.toHaveBeenCalled();
  });

  it("as recusas que não são da senha do Prism voltam ao “Exportar conexões”; as da senha ele mostra no campo dele", async () => {
    const view = await asked();

    expect(view.password?.props.refusals).toEqual(["EXPORT_PASSPHRASE_INVALID", "EXPORT_LIMITS_EXCEEDED", "FOLDER_NOT_FOUND", "CONNECTION_NOT_FOUND"]);
  });

  it("Cancelar volta ao “Exportar conexões” como estava", async () => {
    const view = await asked();
    (view.password?.props.onClose as () => void)();
    const after = drawn({ type: "connection", id: "prd-fix" });

    expect(after.password).toBeUndefined();
    expect(after.row("prd-fix").props.choice).toBe("userAndPassword");
    expect(after.passphrase.props.value).toBe(passphrase);
  });

  it("a API que pede a senha do Prism sem a tela prever (a conexão ganhou senha noutra janela) abre o “Confirme a sua senha”", async () => {
    mocks.exportFn.mockResolvedValue(refused(422, "USER_PASSWORD_REQUIRED", { userPassword: ["Para exportar senhas de banco, informe a sua senha do Prism."] }));
    type(drawn({ type: "connection", id: "prd-fix" }), passphrase);
    const after = await submit({ type: "connection", id: "prd-fix" });

    expect(after.password).toBeDefined();
  });
});
