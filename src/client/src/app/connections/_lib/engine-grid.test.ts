import { describe, expect, it } from "vitest";

import { gridKeyTarget, gridTabStop } from "./engine-grid";

describe("gridKeyTarget: as setas nas duas direções da grade de bancos (RN-NAV-005)", () => {
  // Uma grade de 11 bancos em 4 colunas: 0 1 2 3 / 4 5 6 7 / 8 9 10.
  const at = (key: string, from: number) => gridKeyTarget(key, from, 11, 4);

  it("esquerda e direita andam um, e dão a volta nas pontas", () => {
    expect(at("ArrowRight", 0)).toBe(1);
    expect(at("ArrowLeft", 5)).toBe(4);
    expect(at("ArrowRight", 10)).toBe(0);
    expect(at("ArrowLeft", 0)).toBe(10);
  });

  it("para cima e para baixo andam uma linha, na mesma coluna; fora da grade, ficam onde estão", () => {
    expect(at("ArrowDown", 1)).toBe(5);
    expect(at("ArrowUp", 6)).toBe(2);
    expect(at("ArrowUp", 2)).toBe(2);
    expect(at("ArrowDown", 9)).toBe(9);
  });

  it("para baixo da penúltima linha, numa coluna que a última não tem, vai ao último banco", () => {
    expect(at("ArrowDown", 7)).toBe(10);
    expect(gridKeyTarget("ArrowDown", 6, 9, 4)).toBe(8);
  });

  it("Home e End vão ao primeiro e ao último", () => {
    expect(at("Home", 7)).toBe(0);
    expect(at("End", 2)).toBe(10);
  });

  it("uma coluna só (a grade estreita) é uma lista: para baixo e para cima andam um", () => {
    expect(gridKeyTarget("ArrowDown", 0, 3, 1)).toBe(1);
    expect(gridKeyTarget("ArrowUp", 2, 3, 1)).toBe(1);
  });

  it("outra tecla não é da grade", () => {
    for (const key of ["Enter", " ", "Tab", "a"]) expect(at(key, 3)).toBeNull();
  });

  it("sem bancos, nada", () => {
    expect(gridKeyTarget("ArrowRight", 0, 0, 4)).toBeNull();
  });
});

describe("gridTabStop: a parada de tabulação da grade (uma só)", () => {
  const choices = [{ disabled: false }, { disabled: false }, { disabled: true }];

  it("o banco escolhido", () => {
    expect(gridTabStop(choices, 1)).toBe(1);
  });

  it("sem escolha, o primeiro que se pode escolher", () => {
    expect(gridTabStop(choices, -1)).toBe(0);
    expect(gridTabStop([{ disabled: true }, { disabled: false }], -1)).toBe(1);
  });

  it("o escolhido desabilitado (a conexão gravada de um banco que esta máquina não atende) continua sendo a parada", () => {
    expect(gridTabStop(choices, 2)).toBe(2);
  });

  it("nenhum que se possa escolher: o primeiro, para a pessoa ler o motivo", () => {
    expect(gridTabStop([{ disabled: true }], -1)).toBe(0);
  });
});
