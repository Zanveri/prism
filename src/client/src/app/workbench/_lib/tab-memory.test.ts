import { beforeEach, describe, expect, it } from "vitest";

import { initialLayout } from "./result-layout";
import { forgetExcept, recall, remember } from "./tab-memory";

// A memória é de módulo: cada teste começa sem nenhuma aba lembrada.
beforeEach(() => forgetExcept(new Set()));

describe("tab-memory: o que a tela de uma aba lembra ao sair e voltar (RN-PAINEL-001, RN-TABELA-004 e 005)", () => {
  it("sem nada guardado, não lembra de nada", () => {
    expect(recall("aba-1", "layout")).toBeUndefined();
    expect(recall("aba-1", "diagram")).toBeUndefined();
    expect(recall("aba-1", "records")).toBeUndefined();
    expect(recall("aba-1", "structure")).toBeUndefined();
  });

  it("devolve o que foi guardado, do jeito que foi guardado", () => {
    const layout = { mode: "collapsed", resultPercent: 35 } as const;
    remember("aba-1", "layout", layout);

    expect(recall("aba-1", "layout")).toBe(layout);
  });

  it("cada aba tem a sua memória: o que uma guarda a outra não vê", () => {
    remember("aba-1", "layout", { mode: "maximized", resultPercent: 40 });
    remember("aba-2", "layout", initialLayout);

    expect(recall("aba-1", "layout")).toEqual({ mode: "maximized", resultPercent: 40 });
    expect(recall("aba-2", "layout")).toEqual(initialLayout);
  });

  it("cada assunto tem o seu espaço: guardar o zoom do diagrama não apaga o tamanho da divisão nem o filtro", () => {
    remember("aba-1", "layout", { mode: "split", resultPercent: 25 });
    remember("aba-1", "records", { draft: "a = 1", query: { where: "a = 1", sort: { column: "a", direction: "desc" } } });
    remember("aba-1", "diagram", { zoom: 0.64, left: 120, top: 40 });
    remember("aba-1", "structure", "indexes");

    expect(recall("aba-1", "layout")).toEqual({ mode: "split", resultPercent: 25 });
    expect(recall("aba-1", "records")).toEqual({ draft: "a = 1", query: { where: "a = 1", sort: { column: "a", direction: "desc" } } });
    expect(recall("aba-1", "diagram")).toEqual({ zoom: 0.64, left: 120, top: 40 });
    expect(recall("aba-1", "structure")).toBe("indexes");
  });

  it("a seção da Estrutura é lembrada por aba (RN-TABELA-009): cada aba de tabela fica na seção que a pessoa escolheu nela", () => {
    remember("aba-1", "structure", "foreignKeys");
    remember("aba-2", "structure", "ddl");

    expect(recall("aba-1", "structure")).toBe("foreignKeys");
    expect(recall("aba-2", "structure")).toBe("ddl");
    expect(recall("aba-3", "structure")).toBeUndefined();

    remember("aba-1", "structure", "columns");
    expect(recall("aba-1", "structure")).toBe("columns");
    expect(recall("aba-2", "structure")).toBe("ddl");
  });

  it("guardar de novo troca o valor", () => {
    remember("aba-1", "diagram", { zoom: 1, left: 0, top: 0 });
    remember("aba-1", "diagram", { zoom: 1.25, left: 10, top: 5 });

    expect(recall("aba-1", "diagram")).toEqual({ zoom: 1.25, left: 10, top: 5 });
  });

  it("a chave é o ID da aba, não o executor dela: o bloqueio troca todos os executores e a aba lembra do mesmo jeito", () => {
    // O que a vista guardou com o executor de antes do bloqueio (o filtro e a ordem, o zoom, a divisão) é achado pelo id, com o executor novo.
    remember("aba-1", "records", { draft: "ativo = 1", query: { where: "ativo = 1", sort: null } });
    remember("aba-1", "diagram", { zoom: 0.5, left: 3, top: 4 });

    expect(recall("aba-1", "records")).toEqual({ draft: "ativo = 1", query: { where: "ativo = 1", sort: null } });
    expect(recall("aba-1", "diagram")).toEqual({ zoom: 0.5, left: 3, top: 4 });
  });
});

describe("forgetExcept: a aba que fecha leva a memória dela", () => {
  it("esquece o que as abas que saíram guardavam e deixa o das que ficaram", () => {
    remember("fica", "layout", initialLayout);
    remember("sai", "layout", initialLayout);
    remember("sai", "records", { draft: "x", query: { where: "x", sort: null } });
    remember("fica", "structure", "indexes");
    remember("sai", "structure", "ddl");

    forgetExcept(new Set(["fica"]));

    expect(recall("fica", "layout")).toEqual(initialLayout);
    expect(recall("fica", "structure")).toBe("indexes");
    expect(recall("sai", "layout")).toBeUndefined();
    expect(recall("sai", "records")).toBeUndefined();
    expect(recall("sai", "structure")).toBeUndefined();
  });

  it("sem nenhuma aba aberta esquece tudo; com todas abertas não esquece nada", () => {
    remember("a", "layout", initialLayout);
    remember("b", "layout", initialLayout);

    forgetExcept(new Set(["a", "b", "c"]));
    expect(recall("a", "layout")).toEqual(initialLayout);
    expect(recall("b", "layout")).toEqual(initialLayout);

    forgetExcept(new Set());
    expect(recall("a", "layout")).toBeUndefined();
    expect(recall("b", "layout")).toBeUndefined();
  });

  it("uma aba nova não herda a memória de uma que saiu (o id não se repete, e o que sobrou foi esquecido)", () => {
    remember("aba-velha", "records", { draft: "segredo = 1", query: { where: "segredo = 1", sort: null } });
    remember("aba-velha", "structure", "ddl");
    forgetExcept(new Set(["aba-nova"]));

    expect(recall("aba-nova", "records")).toBeUndefined();
    expect(recall("aba-nova", "structure")).toBeUndefined();
    expect(recall("aba-velha", "records")).toBeUndefined();
    expect(recall("aba-velha", "structure")).toBeUndefined();
  });

  it("esquecer o que já foi esquecido não faz nada", () => {
    forgetExcept(new Set(["x"]));
    forgetExcept(new Set(["x"]));

    expect(recall("x", "layout")).toBeUndefined();
  });
});
