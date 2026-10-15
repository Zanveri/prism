import { beforeEach, describe, expect, it, vi } from "vitest";

// O formulário com os ganchos do React simulados (`createHookRuntime`): a gravação que espera a senha é estado, e o vitest deste projeto não tem DOM. A
// mutação é de mentira: `mutate` roda a `mutationFn` e entrega a resposta à `onSuccess` dela, com o que recebeu. Os campos são lidos pelo esquema de verdade,
// com o que o teste põe neles (`parseForm` lê o `FormData`, que aqui não há), os escondidos das Proteções inclusive.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, create: vi.fn(), update: vi.fn(), invalidate: vi.fn(async () => {}), fields: {} as Record<string, string> }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQuery: () => ({ data: undefined }),
  useMutation: (options: { mutationFn: (variables: unknown) => Promise<unknown>; onSuccess?: (result: unknown, variables: unknown) => unknown; onError?: (error: unknown) => void }) => ({
    isPending: false,
    mutate: (variables: unknown) => options.mutationFn(variables).then((result) => options.onSuccess?.(result, variables), options.onError),
  }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));
vi.mock("@/app/drivers/_components/driver-actions", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/app/drivers/_components/driver-actions")>()), useDriverActions: () => ({ install: vi.fn() }) }));
vi.mock("@/lib/utils/form", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/utils/form")>();
  return { ...original, parseForm: (_form: unknown, schema: { safeParse: (data: unknown) => { success: boolean; data?: unknown } }) => ({ ok: true, data: schema.safeParse(mocks.fields).data }) };
});
vi.mock("../_lib/connections.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/connections.service")>()), createConnection: mocks.create, updateConnection: mocks.update, invalidateLists: mocks.invalidate }));

import type { ApiResult } from "@/lib/api/prism-api";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import { newVerification, unprotected, type Connection, type Folder } from "../_lib/connections.schema";
import { ConnectionDialog, type ConnectionDialogRequest } from "./connection-dialog";
import { UserPasswordDialog } from "./user-password-dialog";

const now = "2026-10-15T12:00:00Z";
const fabrica: Folder = { id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f1", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: true, protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: null, confirmCommandsFolderID: null }, createdAt: now, updatedAt: now };
// RN-VERIF-001: a verificação fora do padrão, que o formulário ainda não pergunta e manda como a conexão a tem.
const mes: Connection = {
  id: "7d2f9a10-aaaa-4bbb-8ccc-000000000001",
  folderID: fabrica.id,
  name: "MES Produção",
  engine: 2,
  host: "srv-db2",
  port: 50000,
  database: "MES",
  userName: "mes",
  hasPassword: true,
  environmentName: "Produção",
  environmentColor: "#FF8A7A",
  confirmCommands: null,
  readOnly: false,
  verificationEnabled: false,
  verificationInterval: 120,
  verificationQuery: "SELECT 1 FROM SYSIBM.SYSDUMMY1",
  protections: { readOnly: true, readOnlyFolderID: fabrica.id, confirmCommands: null, confirmCommandsFolderID: null },
  createdAt: now,
  updatedAt: now,
};
const fields = { engine: "2", name: "MES Produção", folderID: fabrica.id, host: "srv-db2", port: "50000", database: "MES", userName: "mes", password: "", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "none", readOnly: "false" };
const asIs = { engine: 2, name: "MES Produção", folderID: fabrica.id, host: "srv-db2", port: 50000, database: "MES", userName: "mes", password: null, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false, verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM SYSIBM.SYSDUMMY1" };

const passwordRequired: ApiResult<Connection> = { ok: false, error: { status: 422, code: "USER_PASSWORD_REQUIRED", title: "Senha do usuário obrigatória.", detail: null, errors: { userPassword: ["Informe a sua senha do Prism."] }, extensions: {} } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Desenha o formulário com o estado que ele já tem, e acha o `<form>` e o diálogo da senha. */
function drawn(request: ConnectionDialogRequest, onSaved: (connection: Connection) => void) {
  const all = elementsOf(rt.render(() => ConnectionDialog({ request, folders: [fabrica], openTabs: () => 0, onClose: vi.fn(), onSaved })));
  return { form: all.find((element) => element.type === "form") as Found, password: all.find((element) => element.type === UserPasswordDialog) };
}

async function save(request: ConnectionDialogRequest, typed: Record<string, string>, onSaved = vi.fn()) {
  mocks.fields = typed;
  (drawn(request, onSaved).form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {}, currentTarget: {} });
  await settle();
  return drawn(request, onSaved);
}

const editing: ConnectionDialogRequest = { mode: "edit", connection: mes };

beforeEach(() => {
  rt.unmount();
  for (const mock of [mocks.toast.success, mocks.toast.error, mocks.create, mocks.update]) mock.mockReset();
});

describe("o que o formulário da conexão grava (RN-CONN-010, RN-PROT-001 a 003, RN-VERIF-001)", () => {
  it("mudar só a confirmação não pede a senha: o PATCH sai na hora, com a conexão por inteiro e a verificação como está", async () => {
    mocks.update.mockResolvedValue({ ok: true, data: { ...mes, confirmCommands: "all" } });
    const onSaved = vi.fn();
    const after = await save(editing, { ...fields, confirmCommands: "all" }, onSaved);

    expect(after.password).toBeUndefined();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(mes.id, { ...asIs, confirmCommands: "all" });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("marcar “Somente leitura” numa conexão que já existe pede a senha antes de gravar, e o PATCH vai com ela", async () => {
    mocks.update.mockResolvedValue({ ok: true, data: { ...mes, readOnly: true } });
    const onSaved = vi.fn();
    const after = await save(editing, { ...fields, readOnly: "true" }, onSaved);

    expect(mocks.update).not.toHaveBeenCalled();
    expect(after.password?.props.change).toBe(connectionsCopy.userPassword.markReadOnly("MES Produção"));

    const result = await (after.password!.props.send as (userPassword: string) => Promise<ApiResult<Connection>>)("senha");
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(mes.id, { ...asIs, readOnly: true }, "senha");

    (after.password!.props.onDone as (result: ApiResult<Connection>) => void)(result);
    await settle();
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(connectionsCopy.toasts.connectionUpdated);
    expect(onSaved).toHaveBeenCalledExactlyOnceWith({ ...mes, readOnly: true });
  });

  it("tirar a conexão da pasta somente leitura: a API pede a senha, e o mesmo pedido vai de novo com ela", async () => {
    mocks.update.mockResolvedValueOnce(passwordRequired).mockResolvedValueOnce({ ok: true, data: { ...mes, folderID: null } });
    const after = await save(editing, { ...fields, folderID: "" });

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(mes.id, { ...asIs, folderID: null });
    expect(after.password?.props.change).toBe(connectionsCopy.userPassword.leaveReadOnly("MES Produção"));

    await (after.password!.props.send as (userPassword: string) => Promise<ApiResult<Connection>>)("senha");
    expect(mocks.update).toHaveBeenLastCalledWith(mes.id, { ...asIs, folderID: null }, "senha");
  });

  it("a conexão nova nasce com a verificação padrão, e já marcada somente leitura não pede a senha (nada do que existe muda)", async () => {
    mocks.create.mockResolvedValue({ ok: true, data: { ...mes, protections: unprotected } });
    const after = await save({ mode: "new", folderID: null }, { ...fields, folderID: "", password: "segredo", readOnly: "true" });

    expect(after.password).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ ...asIs, folderID: null, password: "segredo", readOnly: true, ...newVerification });
  });
});
