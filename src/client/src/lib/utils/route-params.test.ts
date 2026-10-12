import { describe, expect, it } from "vitest";

import { spendParam } from "./route-params";

const params = (query: string) => new URLSearchParams(query);

describe("spendParam (a tela gasta o parâmetro da rota que leu ao chegar)", () => {
  it("devolve os parâmetros sem ele, e os outros ficam como estavam", () => {
    expect(spendParam(params("connection=abc&aba=2"), "connection")?.toString()).toBe("aba=2");
    expect(spendParam(params("aba=2&connection=abc&x=y"), "connection")?.toString()).toBe("aba=2&x=y");
  });

  it("era o único: a busca fica vazia", () => {
    expect(spendParam(params("driver=ibm-data-server"), "driver")?.toString()).toBe("");
  });

  it("todas as ocorrências saem (o `get` só lê a primeira, e as outras reabririam o que a tela já abriu)", () => {
    expect(spendParam(params("connection=a&y=2&connection=b"), "connection")?.toString()).toBe("y=2");
  });

  it("o que não está na URL não tem o que limpar: `null`, e nenhuma navegação à toa", () => {
    expect(spendParam(params(""), "connection")).toBeNull();
    expect(spendParam(params("aba=2"), "connection")).toBeNull();
  });

  it("a tela que ainda não pôde usá-lo (a lista a que ele aponta não chegou) o deixa na URL: `null`", () => {
    expect(spendParam(params("connection=abc"), "connection", false)).toBeNull();
    expect(spendParam(params("connection=abc"), "connection", true)?.toString()).toBe("");
  });

  it("um valor que a tela vai ignorar (conexão que não existe) também é gasto: ela já o leu e decidiu", () => {
    expect(spendParam(params("connection=nao-existe"), "connection")?.toString()).toBe("");
  });

  it("o nome vale como está escrito: outro parâmetro com o mesmo começo, ou com outra caixa, não é ele", () => {
    expect(spendParam(params("connections=a"), "connection")).toBeNull();
    expect(spendParam(params("Connection=a"), "connection")).toBeNull();
  });

  it("não altera o que recebeu (o roteador guarda esse objeto)", () => {
    const original = params("connection=abc&aba=2");
    spendParam(original, "connection");

    expect(original.toString()).toBe("connection=abc&aba=2");
  });
});
