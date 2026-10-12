import { describe, expect, it } from "vitest";

import { changePasswordSchema, refusalFields } from "./account";

const valid = { currentPassword: "a-senha-de-agora", newPassword: "uma-senha-nova-1", newPasswordConfirmation: "uma-senha-nova-1" };

/** O que `parseForm` entrega ao esquema: os campos do formulário pelo `name`, como `Object.fromEntries(new FormData(form))`. */
const parse = (values: Record<string, string>) => changePasswordSchema.safeParse(values);

describe("o formulário de trocar a senha (RN-COFRE-013)", () => {
  it("aceita as três senhas quando a nova tem de 8 a 128 caracteres e a confirmação confere", () => {
    expect(parse(valid).success).toBe(true);
    expect(parse({ ...valid, newPassword: "x".repeat(8), newPasswordConfirmation: "x".repeat(8) }).success).toBe(true);
    expect(parse({ ...valid, newPassword: "x".repeat(128), newPasswordConfirmation: "x".repeat(128) }).success).toBe(true);
  });

  it("a nova senha fora de 8 a 128 caracteres é recusada no campo dela, com a mensagem de cada lado", () => {
    const short = parse({ ...valid, newPassword: "x".repeat(7), newPasswordConfirmation: "x".repeat(7) });
    const long = parse({ ...valid, newPassword: "x".repeat(129), newPasswordConfirmation: "x".repeat(129) });

    expect(!short.success && short.error.issues.map((issue) => [issue.path[0], issue.message])).toEqual([["newPassword", "A nova senha precisa ter ao menos 8 caracteres."]]);
    expect(!long.success && long.error.issues.map((issue) => [issue.path[0], issue.message])).toEqual([["newPassword", "A nova senha pode ter no máximo 128 caracteres."]]);
  });

  it("a confirmação que não confere é recusada no campo dela (e só na tela: a API recebe a senha atual e a nova)", () => {
    const result = parse({ ...valid, newPasswordConfirmation: "uma-senha-nova-2" });

    expect(!result.success && result.error.issues.map((issue) => [issue.path[0], issue.message])).toEqual([["newPasswordConfirmation", "As senhas não conferem."]]);
  });

  it("a senha atual vazia pede a senha atual; qualquer outro texto vale como senha atual, que só a API sabe se confere", () => {
    const empty = parse({ ...valid, currentPassword: "" });
    expect(!empty.success && empty.error.issues.map((issue) => [issue.path[0], issue.message])).toEqual([["currentPassword", "Informe a senha atual."]]);

    expect(parse({ ...valid, currentPassword: "a" }).success).toBe(true);
    expect(parse({ ...valid, currentPassword: "x".repeat(500) }).success).toBe(true);
  });

  it("as senhas não são aparadas nem alteradas: o espaço nas pontas faz parte delas", () => {
    const result = parse({ currentPassword: "  atual  ", newPassword: "  nova-senha  ", newPasswordConfirmation: "  nova-senha  " });

    expect(result.success && result.data).toEqual({ currentPassword: "  atual  ", newPassword: "  nova-senha  ", newPasswordConfirmation: "  nova-senha  " });
  });

  it("a ordem dos erros é a dos campos na tela, para o foco ir ao primeiro: atual, nova, confirmação", () => {
    const result = parse({ currentPassword: "", newPassword: "curta", newPasswordConfirmation: "outra" });

    expect(!result.success && [...new Set(result.error.issues.map((issue) => issue.path[0]))]).toEqual(["currentPassword", "newPassword", "newPasswordConfirmation"]);
  });
});

describe("as recusas da API que o formulário mostra no próprio lugar", () => {
  it("senha atual errada (INVALID_PASSWORD, o mesmo código da revelação de senha): no campo da senha atual, que volta vazio; as novas ficam", () => {
    expect(refusalFields("INVALID_PASSWORD")).toEqual({ errors: { currentPassword: "A senha atual não confere." }, clear: ["currentPassword"], focus: "currentPassword" });
  });

  it("nova senha inválida (PASSWORD_INVALID): no campo da nova senha, e a nova e a confirmação voltam vazias; a atual fica", () => {
    expect(refusalFields("PASSWORD_INVALID")).toEqual({ errors: { newPassword: "A nova senha precisa ter de 8 a 128 caracteres." }, clear: ["newPassword", "newPasswordConfirmation"], focus: "newPassword" });
  });

  it("nova igual à atual (PASSWORD_UNCHANGED): no campo da nova senha, com a mensagem própria", () => {
    expect(refusalFields("PASSWORD_UNCHANGED")).toEqual({ errors: { newPassword: "A nova senha precisa ser diferente da atual." }, clear: ["newPassword", "newPasswordConfirmation"], focus: "newPassword" });
  });

  it.each(["VAULT_LOCKED", "VAULT_UNAVAILABLE", "NETWORK_ERROR", "RESPONSE_INVALID", "QUALQUER_OUTRO"])("%s não é uma recusa de campo: não há o que mostrar no formulário", (code) => {
    expect(refusalFields(code)).toBeNull();
  });
});
