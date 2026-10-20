import { beforeEach, describe, expect, it, vi } from "vitest";

// O diálogo com os ganchos do React simulados (`createHookRuntime`), e o vitest deste projeto não tem DOM. A mutação é de mentira: `mutate` roda a
// `mutationFn` e entrega a resposta à `onSuccess` dela. O campo é lido pelo esquema de verdade, com o nome que o teste dá (`parseForm` lê o `FormData`).
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, update: vi.fn(), invalidate: vi.fn(async () => {}), typed: "" }));
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
vi.mock("@/lib/utils/form", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/utils/form")>();
  return { ...original, parseForm: (_form: unknown, schema: { safeParse: (data: unknown) => { success: boolean; data?: unknown } }) => ({ ok: true, data: schema.safeParse({ name: mocks.typed }).data }) };
});
vi.mock("../_lib/connections.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/connections.service")>()), updateConnection: mocks.update, invalidateLists: mocks.invalidate }));

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import type { Connection } from "../_lib/connections.schema";
import { RenameConnectionDialog } from "./rename-connection-dialog";

const now = "2026-10-15T12:00:00Z";
// RN-PROT-001, 002 e RN-VERIF-001: a conexão com as duas proteções próprias e a verificação fora do padrão.
const mes: Connection = {
  id: "7d2f9a10-aaaa-4bbb-8ccc-000000000001",
  folderID: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f1",
  name: "MES Produção",
  engine: 3,
  host: "srv-ifx",
  port: 9089,
  database: "mes",
  userName: "informix",
  hasPassword: true,
  environmentName: "Produção",
  environmentColor: "#FF8A7A",
  confirmCommands: "irreversible",
  readOnly: true,
  verificationEnabled: true,
  verificationInterval: 5,
  verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1",
  protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f1" },
  createdAt: now,
  updatedAt: now,
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  rt.unmount();
  for (const mock of [mocks.toast.success, mocks.toast.error, mocks.update]) mock.mockReset();
});

describe("Renomear a conexão pelo navegador (F2, RN-NAV-009)", () => {
  it("o PATCH leva a conexão por inteiro, só com o nome novo: as proteções próprias e a verificação vão como estão, e a senha não é pedida (RN-PROT-003)", async () => {
    mocks.update.mockResolvedValue({ ok: true, data: { ...mes, name: "MES Norte" } });
    mocks.typed = "  MES Norte  ";
    const onClose = vi.fn();
    const form = elementsOf(rt.render(() => RenameConnectionDialog({ connection: mes, onClose }))).find((element) => element.type === "form") as Found;

    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {}, currentTarget: {} });
    await settle();

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(mes.id, {
      name: "MES Norte",
      folderID: mes.folderID,
      engine: 3,
      host: "srv-ifx",
      port: 9089,
      database: "mes",
      userName: "informix",
      password: null,
      environmentName: "Produção",
      environmentColor: "#FF8A7A",
      confirmCommands: "irreversible",
      readOnly: true,
      verificationEnabled: true,
      verificationInterval: 5,
      verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1",
    });
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(connectionsCopy.toasts.connectionRenamed);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
