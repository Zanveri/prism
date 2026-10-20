import { beforeEach, describe, expect, it, vi } from "vitest";

// O diálogo com os ganchos do React simulados (`createHookRuntime`): a pasta escolhida e a gravação que espera a senha são estado, e o vitest deste projeto
// não tem DOM. A mutação é de mentira: `mutate` roda a `mutationFn` e entrega a resposta à `onSuccess` dela, com o que recebeu, como a de verdade.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, update: vi.fn(), invalidate: vi.fn(async () => {}) }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useMutation: (options: { mutationFn: (variables: unknown) => Promise<unknown>; onSuccess?: (result: unknown, variables: unknown) => unknown; onError?: (error: unknown) => void }) => ({
    isPending: false,
    mutate: (variables: unknown) => options.mutationFn(variables).then((result) => options.onSuccess?.(result, variables), options.onError),
  }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));
vi.mock("../_lib/connections.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/connections.service")>()), updateConnection: mocks.update, invalidateLists: mocks.invalidate }));

import { Select } from "@/components/ui";
import type { ApiResult } from "@/lib/api/prism-api";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import { unprotected, type Connection, type Folder } from "../_lib/connections.schema";
import { MoveConnectionDialog } from "./move-connection-dialog";
import { UserPasswordDialog } from "./user-password-dialog";

const now = "2026-10-15T12:00:00Z";
const fabrica: Folder = { id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f1", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: true, protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: null, confirmCommandsFolderID: null }, createdAt: now, updatedAt: now };
const qas: Folder = { ...fabrica, id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f2", name: "QAS", readOnly: false, protections: unprotected };
// RN-PROT-001, 002 e RN-VERIF-001: a conexão com a confirmação própria e a verificação fora do padrão, dentro de uma pasta somente leitura.
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
  confirmCommands: "all",
  readOnly: false,
  verificationEnabled: false,
  verificationInterval: 120,
  verificationQuery: "SELECT 1 FROM SYSIBM.SYSDUMMY1",
  protections: { readOnly: true, readOnlyFolderID: fabrica.id, confirmCommands: "all", confirmCommandsFolderID: null },
  createdAt: now,
  updatedAt: now,
};
const sent = { name: "MES Produção", engine: 2, host: "srv-db2", port: 50000, database: "MES", userName: "mes", password: null, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "all", readOnly: false, verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM SYSIBM.SYSDUMMY1" };

const passwordRequired: ApiResult<Connection> = { ok: false, error: { status: 422, code: "USER_PASSWORD_REQUIRED", title: "Senha do usuário obrigatória.", detail: null, errors: { userPassword: ["Informe a sua senha do Prism."] }, extensions: {} } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Desenha o diálogo com o estado que ele já tem, e acha a pasta, o formulário e o diálogo da senha. */
function drawn(onClose = vi.fn()) {
  const all = elementsOf(rt.render(() => MoveConnectionDialog({ connection: mes, folders: [fabrica, qas], onClose })));
  return { folder: all.find((element) => element.type === Select) as Found, form: all.find((element) => element.type === "form") as Found, password: all.find((element) => element.type === UserPasswordDialog) };
}

async function moveTo(folderID: string, onClose = vi.fn()) {
  (drawn(onClose).folder.props.onChange as (value: string) => void)(folderID);
  (drawn(onClose).form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {} });
  await settle();
  return drawn(onClose);
}

beforeEach(() => {
  rt.unmount();
  for (const mock of [mocks.toast.success, mocks.toast.warning, mocks.toast.error, mocks.update]) mock.mockReset();
});

describe("Mover a conexão pelo navegador (RN-NAV-003, RN-PROT-003)", () => {
  it("o PATCH leva a conexão por inteiro, com a pasta nova, as proteções próprias e a verificação como estão, sem a senha", async () => {
    mocks.update.mockResolvedValue({ ok: true, data: { ...mes, folderID: qas.id } });
    const onClose = vi.fn();
    await moveTo(qas.id, onClose);

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(mes.id, { ...sent, folderID: qas.id });
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(connectionsCopy.toasts.connectionMoved);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sair da pasta somente leitura: a API pede a senha, o diálogo dela diz o que muda, e o mesmo pedido vai de novo com a senha", async () => {
    mocks.update.mockResolvedValueOnce(passwordRequired).mockResolvedValueOnce({ ok: true, data: { ...mes, folderID: null } });
    const onClose = vi.fn();
    const after = await moveTo("", onClose);

    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(after.password?.props.change).toBe(connectionsCopy.userPassword.leaveReadOnly("MES Produção"));

    const result = await (after.password!.props.send as (userPassword: string) => Promise<ApiResult<Connection>>)("senha");
    expect(mocks.update).toHaveBeenLastCalledWith(mes.id, { ...sent, folderID: null }, "senha");

    (after.password!.props.onDone as (result: ApiResult<Connection>) => void)(result);
    await settle();
    expect(drawn(onClose).password).toBeUndefined();
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(connectionsCopy.toasts.connectionMoved);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("cancelar a senha não grava nada, e o diálogo de mover fica aberto", async () => {
    mocks.update.mockResolvedValueOnce(passwordRequired);
    const onClose = vi.fn();
    const after = await moveTo("", onClose);

    (after.password!.props.onClose as () => void)();
    expect(drawn(onClose).password).toBeUndefined();
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
