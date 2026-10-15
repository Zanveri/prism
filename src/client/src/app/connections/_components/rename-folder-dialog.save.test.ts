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
vi.mock("../_lib/connections.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/connections.service")>()), updateFolder: mocks.update, invalidateLists: mocks.invalidate }));

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import type { Folder } from "../_lib/connections.schema";
import { RenameFolderDialog } from "./rename-folder-dialog";

const now = "2026-10-15T12:00:00Z";
// RN-PASTA-005, 007 e RN-PROT-001 e 002: a pasta com a cor, o ambiente e as duas proteções próprias, dentro de outra.
const fabrica: Folder = {
  id: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f2",
  parentID: "7d2f9a10-aaaa-4bbb-8ccc-0000000000f1",
  name: "Fábrica",
  environmentName: "Produção",
  environmentColor: "#FF8A7A",
  color: "#7DB2FF",
  confirmCommands: "all",
  readOnly: true,
  protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: null },
  createdAt: now,
  updatedAt: now,
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  rt.unmount();
  for (const mock of [mocks.toast.success, mocks.toast.error, mocks.update]) mock.mockReset();
});

describe("Renomear a pasta (F2, RN-NAV-009)", () => {
  it("o PATCH leva a pasta por inteiro, só com o nome novo: a pasta pai, a cor, o ambiente e as proteções vão como estão, e a senha não é pedida (RN-PROT-003)", async () => {
    mocks.update.mockResolvedValue({ ok: true, data: { ...fabrica, name: "Fábrica Sul" } });
    mocks.typed = "Fábrica Sul";
    const onClose = vi.fn();
    const form = elementsOf(rt.render(() => RenameFolderDialog({ folder: fabrica, onClose }))).find((element) => element.type === "form") as Found;

    (form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {}, currentTarget: {} });
    await settle();

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(fabrica.id, { name: "Fábrica Sul", parentID: fabrica.parentID, color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "all", readOnly: true });
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(connectionsCopy.toasts.folderRenamed);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
