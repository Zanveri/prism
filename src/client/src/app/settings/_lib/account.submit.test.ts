import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiRequestError, type ApiError, type ApiResult } from "@/lib/api/prism-api";
import type { FieldErrors, ParsedForm } from "@/lib/utils/form";

import { passwordFields, submitPasswordChange, type ChangePasswordInput, type SubmitPasswordChangeDeps } from "./account";
import type { PasswordChange } from "./account.service";

const apiError = (code: string): ApiError => ({ status: 422, code, title: code, detail: null, errors: null, extensions: {} });
const refused = (code: string): ApiResult<void> => ({ ok: false, error: apiError(code) });
const changed: ApiResult<void> = { ok: true, data: undefined };

const typedPasswords: ChangePasswordInput = { currentPassword: "a-senha-de-agora", newPassword: "uma-senha-nova-1", newPasswordConfirmation: "uma-senha-nova-1" };

/** O que a API recebe: a atual e a nova, sem a confirmação. */
const sentPasswords: PasswordChange = { currentPassword: "a-senha-de-agora", newPassword: "uma-senha-nova-1" };

/** Como a chamada à API termina: com o que a API respondeu, ou com uma falha que lança (o disco, a API fora do ar). */
type Ending = ApiResult<void> | "throws";

/** As peças de mentira de `submitPasswordChange`: cada uma anota a chamada, na ordem, para o teste conferir a ORDEM. */
function setup({ ending = changed, parsed = { ok: true, data: typedPasswords }, pending = false }: { ending?: Ending; parsed?: ParsedForm<ChangePasswordInput>; pending?: boolean } = {}) {
  const order: string[] = [];
  const sent: PasswordChange[] = [];
  const deps: SubmitPasswordChangeDeps = {
    isPending: () => pending,
    parse: () => {
      order.push("parse");
      return parsed;
    },
    showErrors: (errors: FieldErrors) => void order.push(`showErrors:${Object.keys(errors).join(",")}`),
    mutate: (input, options) => {
      order.push("mutate");
      sent.push(input);
      if (ending !== "throws") options.onSuccess(ending);
      options.onSettled();
    },
    clearFields: (names) => void order.push(`clearFields:${names.join(",")}`),
    focusField: (name) => void order.push(`focusField:${name}`),
    release: () => void order.push("release"),
  };
  return { order, sent, deps };
}

describe("submitPasswordChange: a ordem do envio (RN-COFRE-013)", () => {
  it("trocou: confere o formulário, envia, esvazia os três campos e solta as senhas por último", () => {
    const { order, deps } = setup();

    submitPasswordChange(deps);

    expect(order).toEqual(["parse", "showErrors:", "mutate", `clearFields:${passwordFields.join(",")}`, "release"]);
  });

  it("à API vai só a senha atual e a nova: a confirmação fica no formulário", () => {
    const { sent, deps } = setup();

    submitPasswordChange(deps);

    expect(sent).toEqual([sentPasswords]);
    expect(Object.keys(sent[0])).toEqual(["currentPassword", "newPassword"]);
  });

  it.each([
    ["INVALID_PASSWORD", ["showErrors:currentPassword", "clearFields:currentPassword", "focusField:currentPassword"]],
    ["PASSWORD_INVALID", ["showErrors:newPassword", "clearFields:newPassword,newPasswordConfirmation", "focusField:newPassword"]],
    ["PASSWORD_UNCHANGED", ["showErrors:newPassword", "clearFields:newPassword,newPasswordConfirmation", "focusField:newPassword"]],
  ])("recusa %s: a mensagem vai ao campo, a senha recusada se esvazia e SÓ ENTÃO o foco vai a ele (o `focus` da recusa); solta as senhas por último", (code, steps) => {
    const { order, deps } = setup({ ending: refused(code) });

    submitPasswordChange(deps);

    expect(order).toEqual(["parse", "showErrors:", "mutate", ...steps, "release"]);
  });

  it.each(["VAULT_LOCKED", "VAULT_UNAVAILABLE", "QUALQUER_OUTRO"])("outra falha na resposta (%s): o formulário não é tocado, e as senhas são soltas do mesmo jeito", (code) => {
    const { order, deps } = setup({ ending: refused(code) });

    submitPasswordChange(deps);

    expect(order).toEqual(["parse", "showErrors:", "mutate", "release"]);
  });

  it("a chamada que lança (o disco, a API fora do ar): nenhum campo é tocado, mas as senhas são soltas", () => {
    const { order, deps } = setup({ ending: "throws" });

    submitPasswordChange(deps);

    expect(order).toEqual(["parse", "showErrors:", "mutate", "release"]);
  });

  it("o que o esquema recusa fica na tela com as senhas digitadas: nada é enviado, esvaziado ou solto", () => {
    const { order, sent, deps } = setup({ parsed: { ok: false, errors: { newPasswordConfirmation: "As senhas não conferem." } } });

    submitPasswordChange(deps);

    expect(order).toEqual(["parse", "showErrors:newPasswordConfirmation"]);
    expect(sent).toEqual([]);
  });

  it("com uma troca em andamento um segundo envio não faz nada: nem lê o formulário", () => {
    const { order, deps } = setup({ pending: true });

    submitPasswordChange(deps);

    expect(order).toEqual([]);
  });

  it("os campos de senha são os três do formulário, na ordem da tela", () => {
    expect(passwordFields).toEqual(["currentPassword", "newPassword", "newPasswordConfirmation"]);
  });
});

describe("submitPasswordChange com a mutação de verdade: as senhas saem das `variables` em todo fim", () => {
  /** A mutação como a tela a monta (`gcTime: 0`), com `mutate` e `release` do observador, como `mutation.mutate` e `mutation.reset`. */
  function withMutation(mutationFn: (input: PasswordChange) => Promise<ApiResult<void>>) {
    const observer = new MutationObserver<ApiResult<void>, Error, PasswordChange>(new QueryClient(), { gcTime: 0, mutationFn });
    const unsubscribe = observer.subscribe(() => undefined);
    const order: string[] = [];
    let finish: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const wired: SubmitPasswordChangeDeps = {
      isPending: () => false,
      parse: () => ({ ok: true, data: typedPasswords }),
      showErrors: () => undefined,
      clearFields: (names) => void order.push(`clearFields:${names.length}`),
      focusField: (name) => void order.push(`focusField:${name}`),
      mutate: (input, options) => {
        observer.mutate(input, options).catch(() => undefined);
      },
      release: () => {
        order.push("release");
        observer.reset();
        finish();
      },
    };
    return { observer, wired, order, settled, unsubscribe };
  }

  it.each([
    ["trocou", () => Promise.resolve(changed), ["clearFields:3", "release"]],
    ["recusa de campo", () => Promise.resolve(refused("INVALID_PASSWORD")), ["focusField:currentPassword", "release"]],
    ["falha que lança", () => Promise.reject(new ApiRequestError(apiError("VAULT_UNAVAILABLE"))), ["release"]],
  ])("%s: durante a chamada as variables têm as senhas; quando termina, já não existem", async (_name, mutationFn, expectedEnd) => {
    const { observer, wired, order, settled, unsubscribe } = withMutation(mutationFn);

    submitPasswordChange(wired);
    expect(observer.getCurrentResult().variables).toEqual(sentPasswords);

    await settled;
    expect(observer.getCurrentResult().variables).toBeUndefined();
    expect(observer.getCurrentResult().status).toBe("idle");
    expect(order.slice(-expectedEnd.length)).toEqual(expectedEnd);
    unsubscribe();
  });

  it("o jeito antigo (soltar só no onSuccess do mutate) deixava as senhas vivas depois de uma falha que lança", async () => {
    const observer = new MutationObserver<ApiResult<void>, Error, PasswordChange>(new QueryClient(), { gcTime: 0, mutationFn: () => Promise.reject(new ApiRequestError(apiError("VAULT_UNAVAILABLE"))) });
    const unsubscribe = observer.subscribe(() => undefined);
    const onSuccess = vi.fn(() => observer.reset());

    await observer.mutate(sentPasswords, { onSuccess }).catch(() => undefined);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(observer.getCurrentResult().variables).toEqual(sentPasswords);
    unsubscribe();
  });
});
