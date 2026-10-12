import { describe, expect, it } from "vitest";

import { guardState } from "./vault-guard";

const unlocked = { unlocked: true, userName: "marina" };
const locked = { unlocked: false, userName: null };

describe("guardState", () => {
  it("carregando: ainda não sabe", () => {
    expect(guardState({ data: undefined, isError: false })).toBe("checking");
  });

  it("erro sem dados: a consulta falhou e não há o que mostrar", () => {
    expect(guardState({ data: undefined, isError: true })).toBe("failed");
  });

  it("unlocked: false manda para o login", () => {
    expect(guardState({ data: locked, isError: false })).toBe("locked");
  });

  it("unlocked: true libera", () => {
    expect(guardState({ data: unlocked, isError: false })).toBe("open");
  });

  it("erro com dados anteriores unlocked: true continua liberado", () => {
    // Uma reconsulta que falha não pode desmontar a área de trabalho, e com ela o texto das abas.
    expect(guardState({ data: unlocked, isError: true })).toBe("open");
  });
});
