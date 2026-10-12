import { describe, expect, it } from "vitest";

import { ApiRequestError, type ApiError } from "@/lib/api/prism-api";

import { errorCodeOf, errorDriverIdOf, isSessionLost } from "./database-sessions.service";

function apiError(code: string, status = 404): ApiRequestError {
  const error: ApiError = { status, code, title: "Sessão não encontrada.", detail: null, errors: null, extensions: {} };
  return new ApiRequestError(error);
}

describe("isSessionLost", () => {
  it("DATABASE_SESSION_NOT_FOUND num nível da árvore: a sessão caiu, e repetir com o mesmo id não adianta", () => {
    expect(isSessionLost(apiError("DATABASE_SESSION_NOT_FOUND"))).toBe(true);
  });

  it("qualquer outra recusa do banco ou da API é só uma falha do nível", () => {
    expect(isSessionLost(apiError("SQL_EXECUTION_FAILED", 422))).toBe(false);
    expect(isSessionLost(apiError("CONNECTION_NOT_FOUND"))).toBe(false);
    expect(isSessionLost(apiError("NETWORK_ERROR", 0))).toBe(false);
  });

  it("o que não é um erro da API, ou nenhum erro, não é sessão perdida", () => {
    expect(isSessionLost(new Error("DATABASE_SESSION_NOT_FOUND"))).toBe(false);
    expect(isSessionLost(null)).toBe(false);
    expect(isSessionLost(undefined)).toBe(false);
  });
});

describe("errorDriverIdOf", () => {
  it("o `driverID` que a API pôs como extensão do erro", () => {
    const error = new ApiRequestError({ status: 422, code: "DRIVER_NOT_INSTALLED", title: "Driver não instalado.", detail: null, errors: null, extensions: { driverID: "ibm-data-server" } });

    expect(errorDriverIdOf(error)).toBe("ibm-data-server");
  });

  it("sem a extensão, ou sem erro da API, não há driver a apontar", () => {
    expect(errorDriverIdOf(apiError("DRIVER_NOT_INSTALLED", 422))).toBeUndefined();
    expect(errorDriverIdOf(new Error("x"))).toBeUndefined();
    expect(errorDriverIdOf(null)).toBeUndefined();
  });
});

describe("errorCodeOf", () => {
  it("o código que a API deu à falha do nível, para a árvore escolher o que oferecer", () => {
    expect(errorCodeOf(apiError("DRIVER_NOT_INSTALLED", 422))).toBe("DRIVER_NOT_INSTALLED");
    expect(errorCodeOf(apiError("DATABASE_CONNECTION_FAILED", 422))).toBe("DATABASE_CONNECTION_FAILED");
  });

  it("o que não é um erro da API não tem código", () => {
    expect(errorCodeOf(new Error("DRIVER_NOT_INSTALLED"))).toBeUndefined();
    expect(errorCodeOf(null)).toBeUndefined();
  });
});
