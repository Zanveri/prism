import { describe, expect, it } from "vitest";

import type { ApiResult } from "@/lib/api/prism-api";

import { passwordAsked, readOnlyChange, userPasswordRefusals } from "./user-password";

const refused = (code: string): ApiResult<void> => ({ ok: false, error: { status: 422, code, title: `Título de ${code}`, detail: null, errors: null, extensions: {} } });

describe("a senha do somente leitura (RN-PROT-003)", () => {
  it("marcar ou desmarcar “Somente leitura” numa conexão ou pasta que já existe pede a senha, e a frase diz o que muda", () => {
    expect(readOnlyChange("MES Produção", false, true)).toBe("Marcar “Somente leitura” em MES Produção");
    expect(readOnlyChange("MES Produção", true, false)).toBe("Desmarcar “Somente leitura” de MES Produção");
  });

  it("sem mudança no somente leitura próprio, a tela não pede a senha", () => {
    expect(readOnlyChange("MES Produção", true, true)).toBeNull();
    expect(readOnlyChange("MES Produção", false, false)).toBeNull();
  });

  it("a API que pede a senha sem a tela prever (mover para fora de uma pasta somente leitura) abre o diálogo; as outras recusas e o sucesso, não", () => {
    expect(passwordAsked(refused("USER_PASSWORD_REQUIRED"), "MES Produção")).toBe("Tirar MES Produção de uma pasta somente leitura");
    expect(passwordAsked(refused("CONNECTION_INVALID"), "MES Produção")).toBeNull();
    expect(passwordAsked({ ok: true, data: undefined }, "MES Produção")).toBeNull();
  });

  it("o diálogo da senha mostra no campo a senha errada e a que faltou, e o quinto erro seguido fecha o cofre (as três voltam como valor)", () => {
    expect([...userPasswordRefusals]).toEqual(["INVALID_PASSWORD", "USER_PASSWORD_REQUIRED", "VAULT_LOCKED"]);
  });
});
