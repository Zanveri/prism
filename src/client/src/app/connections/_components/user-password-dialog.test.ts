import { beforeEach, describe, expect, it, vi } from "vitest";

// O diálogo com os ganchos do React simulados (`createHookRuntime`): o erro do campo é estado, e o vitest deste projeto não tem DOM. A mutação é de mentira:
// `mutate` roda a `mutationFn` e entrega a resposta às duas `onSuccess` (a da mutação e a do `mutate`), ou o erro às `onError`, como a de verdade.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, reset: vi.fn(), typed: "senha" }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useMutation: (options: { mutationFn: (variables: unknown) => Promise<unknown>; onSuccess?: (result: unknown) => void; gcTime?: number }) => ({
    isPending: false,
    gcTime: options.gcTime,
    reset: mocks.reset,
    mutate: (variables: unknown, callbacks: { onSuccess?: (result: unknown) => void; onError?: (error: unknown) => void } = {}) =>
      options.mutationFn(variables).then(
        (result) => {
          options.onSuccess?.(result);
          callbacks.onSuccess?.(result);
        },
        (error) => callbacks.onError?.(error),
      ),
  }),
}));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => mocks.toast }));
vi.mock("@/lib/utils/form", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/utils/form")>()), parseForm: () => (mocks.typed === "" ? { ok: false, errors: { password: "Informe a sua senha do Prism." } } : { ok: true, data: { password: mocks.typed } }) }));

import type { ApiResult } from "@/lib/api/prism-api";
import { TextField } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import { UserPasswordDialog, type UserPasswordDialogProps } from "./user-password-dialog";

const copy = connectionsCopy.userPassword;
const refused = (status: number, code: string, errors: Record<string, string[]> | null = null): ApiResult<string> => ({ ok: false, error: { status, code, title: `Título de ${code}`, detail: null, errors, extensions: {} } });

/** Desenha o diálogo com o estado que ele já tem, e acha o campo da senha e o formulário. */
function drawn(props: UserPasswordDialogProps<string>) {
  const all = elementsOf(rt.render(() => UserPasswordDialog(props)));
  return { all, field: all.find((element) => element.type === TextField) as Found, form: all.find((element) => element.type === "form") as Found };
}

async function submit(props: UserPasswordDialogProps<string>) {
  (drawn(props).form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {}, currentTarget: {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return drawn(props);
}

beforeEach(() => {
  rt.unmount();
  mocks.typed = "senha";
  for (const mock of [mocks.toast.success, mocks.toast.warning, mocks.toast.error, mocks.reset]) mock.mockReset();
});

describe("o diálogo da senha do somente leitura (RN-PROT-003)", () => {
  it("diz o que muda, pede a senha do Prism e avisa que cinco erros seguidos fecham o cofre", () => {
    const texts = drawn({ change: "Desmarcar “Somente leitura” de MES Produção", send: vi.fn(), onDone: vi.fn(), onClose: vi.fn() }).all.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : []));

    expect(texts).toEqual(expect.arrayContaining(["Desmarcar “Somente leitura” de MES Produção", copy.attempts]));
  });

  it("grava de novo com a senha digitada, e o que gravou volta a quem abriu; a senha não fica na mutação", async () => {
    const send = vi.fn(async (): Promise<ApiResult<string>> => ({ ok: true, data: "gravada" }));
    const onDone = vi.fn();
    await submit({ change: "x", send, onDone, onClose: vi.fn() });

    expect(send).toHaveBeenCalledExactlyOnceWith("senha");
    expect(onDone).toHaveBeenCalledExactlyOnceWith({ ok: true, data: "gravada" });
    expect(mocks.reset).toHaveBeenCalled();
  });

  it("a senha errada fica no campo, que volta vazio (outra chave), e nada volta a quem abriu", async () => {
    const onDone = vi.fn();
    const before = drawn({ change: "x", send: vi.fn(), onDone, onClose: vi.fn() }).field.key;
    const after = await submit({ change: "x", send: async () => refused(422, "INVALID_PASSWORD", { userPassword: ["A senha informada não é a do seu usuário no Prism."] }), onDone, onClose: vi.fn() });

    expect(after.field.props.error).toBe(copy.invalidPassword);
    expect(after.field.key).not.toBe(before);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a senha que faltou (USER_PASSWORD_REQUIRED) fica no campo, com a frase da API", async () => {
    const after = await submit({ change: "x", send: async () => refused(422, "USER_PASSWORD_REQUIRED", { userPassword: ["Para marcar ou desmarcar “Somente leitura”, informe a sua senha do Prism."] }), onDone: vi.fn(), onClose: vi.fn() });

    expect(after.field.props.error).toBe("Para marcar ou desmarcar “Somente leitura”, informe a sua senha do Prism.");
  });

  it("o quinto erro seguido fecha o cofre (401 VAULT_LOCKED): o aviso de atenção diz por quê, e o VaultGuard leva ao login", async () => {
    const onDone = vi.fn();
    await submit({ change: "x", send: async () => refused(401, "VAULT_LOCKED"), onDone, onClose: vi.fn() });

    expect(mocks.toast.warning).toHaveBeenCalledExactlyOnceWith(connectionsCopy.toasts.vaultLockedAfterFiveAttempts);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a recusa que quem abriu mostra no lugar volta a ele como valor; a que não é de ninguém vai ao aviso central, e volta nula", async () => {
    const onDone = vi.fn();
    await submit({ change: "x", send: async () => refused(422, "CONNECTION_INVALID", { name: ["Informe o nome."] }), refusals: ["CONNECTION_INVALID"], onDone, onClose: vi.fn() });
    expect(onDone).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "CONNECTION_INVALID" }) }));

    rt.unmount();
    await submit({ change: "x", send: async () => refused(409, "CONNECTION_ALREADY_EXISTS"), refusals: ["CONNECTION_INVALID"], onDone, onClose: vi.fn() });
    expect(onDone).toHaveBeenLastCalledWith(null);
  });

  it("sem senha digitada, nada vai à API e o campo diz o que falta", async () => {
    mocks.typed = "";
    const send = vi.fn();
    const after = await submit({ change: "x", send, onDone: vi.fn(), onClose: vi.fn() });

    expect(send).not.toHaveBeenCalled();
    expect(after.field.props.error).toBe("Informe a sua senha do Prism.");
  });
});
