import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createUserSchema, sessionSchema, signInSchema } from "./sign-in.schema";

const valid = { userName: "marina.costa", password: "demonstracao", passwordConfirmation: "demonstracao" };

/** As mensagens por campo da recusa, ou `{}` quando o schema aceitou. */
function fieldErrors(input: unknown) {
  const result = createUserSchema.safeParse(input);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
}

describe("createUserSchema (RN-COFRE-010)", () => {
  it("aceita nome, senha e confirmação válidos", () => {
    expect(createUserSchema.safeParse(valid).success).toBe(true);
  });

  it("recusa nome com 2 caracteres", () => {
    expect(fieldErrors({ ...valid, userName: "ma" })).toHaveProperty("userName");
  });

  it("recusa nome com espaço", () => {
    expect(fieldErrors({ ...valid, userName: "marina costa" })).toHaveProperty("userName");
  });

  it("recusa nome com /", () => {
    expect(fieldErrors({ ...valid, userName: "marina/costa" })).toHaveProperty("userName");
  });

  it("grava o nome em minúsculas", () => {
    const result = createUserSchema.safeParse({ ...valid, userName: "Marina.Costa" });

    expect(result.success && result.data.userName).toBe("marina.costa");
  });

  it("recusa senha com 7 caracteres", () => {
    expect(fieldErrors({ ...valid, password: "1234567", passwordConfirmation: "1234567" })).toHaveProperty("password");
  });

  it("aceita senha com 8 caracteres", () => {
    expect(createUserSchema.safeParse({ ...valid, password: "12345678", passwordConfirmation: "12345678" }).success).toBe(true);
  });

  it("recusa confirmação diferente da senha, com a mensagem no campo de confirmação", () => {
    const errors = fieldErrors({ ...valid, passwordConfirmation: "outra-senha" });

    expect(errors.passwordConfirmation).toEqual(["As senhas não conferem."]);
    expect(errors).not.toHaveProperty("password");
  });
});

describe("signInSchema", () => {
  it("usuário digitado com maiúsculas e espaços nas pontas entra normalizado", () => {
    const result = signInSchema.safeParse({ userName: " Marina.Costa ", password: "demonstracao" });

    expect(result.success && result.data.userName).toBe("marina.costa");
  });

  it("não impõe as regras de criação: quem decide se a senha serve é a API", () => {
    expect(signInSchema.safeParse({ userName: "ma", password: "curta" }).success).toBe(true);
  });

  it("recusa campos vazios, cada um com a mensagem no próprio campo", () => {
    const result = signInSchema.safeParse({ userName: "", password: "" });

    expect(!result.success && Object.keys(z.flattenError(result.error).fieldErrors)).toEqual(["userName", "password"]);
  });
});

describe("sessionSchema", () => {
  it("aceita cofre aberto e fechado", () => {
    expect(sessionSchema.safeParse({ unlocked: true, userName: "marina.costa" }).success).toBe(true);
    expect(sessionSchema.safeParse({ unlocked: false, userName: null }).success).toBe(true);
  });

  it("recusa resposta sem unlocked", () => {
    expect(sessionSchema.safeParse({ userName: "marina.costa" }).success).toBe(false);
  });
});
