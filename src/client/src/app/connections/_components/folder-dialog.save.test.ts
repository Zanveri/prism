import { beforeEach, describe, expect, it, vi } from "vitest";

// O diálogo com os ganchos do React simulados (`createHookRuntime`): a gravação que espera a senha é estado, e o vitest deste projeto não tem DOM. A mutação
// é de mentira: `mutate` roda a `mutationFn` e entrega a resposta à `onSuccess` dela, com o que recebeu. Os campos são lidos pelo esquema de verdade de cada
// modo, com o que o teste põe neles (`parseForm` lê o `FormData`, que aqui não há).
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, create: vi.fn(), update: vi.fn(), invalidate: vi.fn(async () => {}), fields: {} as Record<string, string> }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQuery: () => ({ data: [] }),
  useMutation: (options: { mutationFn: (variables: unknown) => Promise<unknown>; onSuccess?: (result: unknown, variables: unknown) => unknown; onError?: (error: unknown) => void }) => ({
    isPending: false,
    mutate: (variables: unknown) => options.mutationFn(variables).then((result) => options.onSuccess?.(result, variables), options.onError),
  }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));
vi.mock("@/lib/utils/form", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/utils/form")>();
  return { ...original, parseForm: (_form: unknown, schema: { safeParse: (data: unknown) => { success: boolean; data?: unknown } }) => ({ ok: true, data: schema.safeParse(mocks.fields).data }) };
});
vi.mock("../_lib/connections.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/connections.service")>()), createFolder: mocks.create, updateFolder: mocks.update, invalidateLists: mocks.invalidate }));

import type { ApiResult } from "@/lib/api/prism-api";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import { unprotected, type Folder } from "../_lib/connections.schema";
import { FolderDialog, type FolderDialogState } from "./folder-dialog";
import { UserPasswordDialog } from "./user-password-dialog";

const now = "2026-10-15T12:00:00Z";
const raiz: Folder = { id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f1", parentID: null, name: "Produção", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: true, protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: null, confirmCommandsFolderID: null }, createdAt: now, updatedAt: now };
// RN-PASTA-005, 007 e RN-PROT-001: a pasta com a cor, o ambiente e a confirmação própria, dentro de uma pasta somente leitura.
const fabrica: Folder = {
  id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f2",
  parentID: raiz.id,
  name: "Fábrica",
  environmentName: "Produção",
  environmentColor: "#FF8A7A",
  color: "#7DB2FF",
  confirmCommands: "irreversible",
  readOnly: false,
  protections: { readOnly: true, readOnlyFolderID: raiz.id, confirmCommands: "irreversible", confirmCommandsFolderID: null },
  createdAt: now,
  updatedAt: now,
};
const asIs = { name: "Fábrica", parentID: raiz.id, color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "irreversible", readOnly: false };
const editFields = { name: "Fábrica", color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "irreversible", readOnly: "false" };

const passwordRequired: ApiResult<Folder> = { ok: false, error: { status: 422, code: "USER_PASSWORD_REQUIRED", title: "Senha do usuário obrigatória.", detail: null, errors: { userPassword: ["Informe a sua senha do Prism."] }, extensions: {} } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Desenha o diálogo com o estado que ele já tem, e acha o formulário e o diálogo da senha. */
function drawn(state: FolderDialogState, onClose: () => void) {
  const all = elementsOf(rt.render(() => FolderDialog({ state, folders: [raiz, fabrica, { ...raiz, id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f3", name: "QAS", readOnly: false, protections: unprotected }], onClose })));
  return { form: all.find((element) => element.type === "form") as Found, password: all.find((element) => element.type === UserPasswordDialog) };
}

async function submit(state: FolderDialogState, fields: Record<string, string>, onClose = vi.fn()) {
  mocks.fields = fields;
  (drawn(state, onClose).form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {}, currentTarget: {} });
  await settle();
  return drawn(state, onClose);
}

beforeEach(() => {
  rt.unmount();
  for (const mock of [mocks.toast.success, mocks.toast.error, mocks.create, mocks.update]) mock.mockReset();
});

describe("o que o diálogo da pasta grava (RN-PASTA-006, RN-PROT-001 a 003)", () => {
  it("Editar pasta… que só muda a confirmação não pede a senha: o PATCH sai na hora, com a pasta por inteiro", async () => {
    mocks.update.mockResolvedValue({ ok: true, data: fabrica });
    const onClose = vi.fn();
    const after = await submit({ mode: "edit", folder: fabrica }, { ...editFields, confirmCommands: "all" }, onClose);

    expect(after.password).toBeUndefined();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(fabrica.id, { ...asIs, confirmCommands: "all" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Editar pasta… que marca “Somente leitura” pede a senha antes de gravar, e o PATCH vai com ela e com a pasta por inteiro", async () => {
    mocks.update.mockResolvedValue({ ok: true, data: { ...fabrica, readOnly: true } });
    const onClose = vi.fn();
    const after = await submit({ mode: "edit", folder: fabrica }, { ...editFields, readOnly: "true" }, onClose);

    expect(mocks.update).not.toHaveBeenCalled();
    expect(after.password?.props.change).toBe(connectionsCopy.userPassword.markReadOnly("Fábrica"));

    const result = await (after.password!.props.send as (userPassword: string) => Promise<ApiResult<Folder>>)("senha");
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(fabrica.id, { ...asIs, readOnly: true }, "senha");

    (after.password!.props.onDone as (result: ApiResult<Folder>) => void)(result);
    await settle();
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(connectionsCopy.toasts.folderUpdated);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Mover leva o nome, a cor, o ambiente e as proteções como estão; para fora da pasta somente leitura a API pede a senha, e o mesmo pedido vai com ela", async () => {
    mocks.update.mockResolvedValueOnce(passwordRequired).mockResolvedValueOnce({ ok: true, data: { ...fabrica, parentID: null } });
    const onClose = vi.fn();
    const after = await submit({ mode: "move", folder: fabrica }, { parentID: "" }, onClose);

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(fabrica.id, { ...asIs, parentID: null });
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(after.password?.props.change).toBe(connectionsCopy.userPassword.leaveReadOnly("Fábrica"));

    const result = await (after.password!.props.send as (userPassword: string) => Promise<ApiResult<Folder>>)("senha");
    expect(mocks.update).toHaveBeenLastCalledWith(fabrica.id, { ...asIs, parentID: null }, "senha");

    (after.password!.props.onDone as (result: ApiResult<Folder>) => void)(result);
    await settle();
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(connectionsCopy.toasts.folderMoved);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("criar uma pasta já marcada não pede a senha (nada do que existe muda)", async () => {
    mocks.create.mockResolvedValue({ ok: true, data: fabrica });
    const after = await submit({ mode: "create", parentID: null }, { name: "QAS", parentID: "", color: "", environmentName: "", environmentColor: "", confirmCommands: "none", readOnly: "true" });

    expect(after.password).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ name: "QAS", parentID: null, color: null, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: true });
  });
});
