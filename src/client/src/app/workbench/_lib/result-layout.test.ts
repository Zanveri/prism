import { describe, expect, it } from "vitest";

import { commandWillRun, controlsOf, defaultResultPercent, initialLayout, layoutReducer, maxResultPercent, minResultPercent, paneFlex, percentFromPointer, splitterKeyAction, type PaneLayout } from "./result-layout";

const split = (resultPercent = defaultResultPercent): PaneLayout => ({ mode: "split", resultPercent });

describe("layoutReducer: recolher, restaurar e maximizar a área de resultado (RN-PAINEL-001)", () => {
  it("a aba nasce dividida, com o resultado em 60% (o 2:3 de antes)", () => {
    expect(initialLayout).toEqual({ mode: "split", resultPercent: 60 });
  });

  it("recolher e restaurar voltam ao tamanho que a divisão tinha", () => {
    const resized = layoutReducer(initialLayout, { type: "resize", percent: 35 });
    const collapsed = layoutReducer(resized, { type: "collapse" });

    expect(collapsed).toEqual({ mode: "collapsed", resultPercent: 35 });
    expect(layoutReducer(collapsed, { type: "restore" })).toEqual({ mode: "split", resultPercent: 35 });
  });

  it("maximizar guarda o tamanho da divisão, e restaurar volta a ele", () => {
    const maximized = layoutReducer(split(40), { type: "maximize" });

    expect(maximized).toEqual({ mode: "maximized", resultPercent: 40 });
    expect(layoutReducer(maximized, { type: "restore" })).toEqual(split(40));
  });

  it("recolher a área maximizada devolve o editor (a área fica só na barra); maximizar a recolhida a abre inteira", () => {
    expect(layoutReducer({ mode: "maximized", resultPercent: 40 }, { type: "collapse" })).toEqual({ mode: "collapsed", resultPercent: 40 });
    expect(layoutReducer({ mode: "collapsed", resultPercent: 40 }, { type: "maximize" })).toEqual({ mode: "maximized", resultPercent: 40 });
  });

  it("executar com a área recolhida a restaura; dividida ou maximizada, fica como está", () => {
    expect(layoutReducer({ mode: "collapsed", resultPercent: 40 }, { type: "run" })).toEqual(split(40));
    expect(layoutReducer(split(40), { type: "run" })).toEqual(split(40));
    expect(layoutReducer({ mode: "maximized", resultPercent: 40 }, { type: "run" })).toEqual({ mode: "maximized", resultPercent: 40 });
  });

  it("o estado devolvido é o mesmo objeto quando nada muda (o React não redesenha)", () => {
    const layout = split(40);

    expect(layoutReducer(layout, { type: "run" })).toBe(layout);
    expect(layoutReducer(layout, { type: "restore" })).toBe(layout);
    expect(layoutReducer(layout, { type: "resize", percent: 40 })).toBe(layout);
  });

  it("arrastar a divisória fica entre os limites, e só vale com a divisão à mostra", () => {
    expect(layoutReducer(split(), { type: "resize", percent: 5 }).resultPercent).toBe(minResultPercent);
    expect(layoutReducer(split(), { type: "resize", percent: 99 }).resultPercent).toBe(maxResultPercent);
    expect(layoutReducer({ mode: "collapsed", resultPercent: 40 }, { type: "resize", percent: 70 })).toEqual({ mode: "collapsed", resultPercent: 40 });
    expect(layoutReducer({ mode: "maximized", resultPercent: 40 }, { type: "resize", percent: 70 })).toEqual({ mode: "maximized", resultPercent: 40 });
  });

  it("setas: para cima o resultado cresce 5 pontos, para baixo encolhe; Home e End vão aos limites", () => {
    expect(layoutReducer(split(60), { type: "nudge", direction: 1 }).resultPercent).toBe(65);
    expect(layoutReducer(split(60), { type: "nudge", direction: -1 }).resultPercent).toBe(55);
    expect(layoutReducer(split(maxResultPercent), { type: "nudge", direction: 1 }).resultPercent).toBe(maxResultPercent);
    expect(layoutReducer(split(minResultPercent), { type: "nudge", direction: -1 }).resultPercent).toBe(minResultPercent);
    expect(layoutReducer(split(60), { type: "extreme", end: "min" }).resultPercent).toBe(minResultPercent);
    expect(layoutReducer(split(60), { type: "extreme", end: "max" }).resultPercent).toBe(maxResultPercent);
  });

  it("um passo de seta arredonda um tamanho que veio de arrasto, para os números ficarem limpos", () => {
    expect(layoutReducer(split(41.37), { type: "nudge", direction: 1 }).resultPercent).toBe(46);
  });
});

describe("percentFromPointer", () => {
  const area = { top: 100, height: 400 };

  it("é a parte da altura que fica abaixo do ponteiro", () => {
    expect(percentFromPointer(260, area)).toBe(60);
    expect(percentFromPointer(360, area)).toBe(35);
  });

  it("não sai dos limites, nem com o ponteiro fora da área", () => {
    expect(percentFromPointer(0, area)).toBe(maxResultPercent);
    expect(percentFromPointer(9000, area)).toBe(minResultPercent);
  });

  it("uma área sem altura (escondida) não divide por zero", () => {
    expect(percentFromPointer(10, { top: 0, height: 0 })).toBe(defaultResultPercent);
  });
});

describe("paneFlex: como o editor e o resultado dividem a altura", () => {
  it("dividida: os dois crescem na proporção, sem tamanho de base", () => {
    expect(paneFlex(split(60))).toEqual({ editor: "40 1 0px", result: "60 1 0px" });
    expect(paneFlex(split(25))).toEqual({ editor: "75 1 0px", result: "25 1 0px" });
  });

  it("recolhida: o resultado é só a barra e o editor fica com o resto", () => {
    expect(paneFlex({ mode: "collapsed", resultPercent: 60 })).toEqual({ editor: "1 1 0px", result: "none" });
  });

  it("maximizada: o resultado ocupa tudo e o editor não tem altura", () => {
    expect(paneFlex({ mode: "maximized", resultPercent: 60 })).toEqual({ editor: "none", result: "1 1 0px" });
  });
});

describe("controlsOf: o que cada botão da barra faz em cada estado", () => {
  it("dividida: recolher e maximizar", () => {
    expect(controlsOf("split")).toEqual({ collapse: { action: "collapse", label: "Recolher a área de resultado" }, maximize: { action: "maximize", label: "Maximizar a área de resultado" } });
  });

  it("recolhida: o primeiro botão restaura; maximizar segue valendo", () => {
    expect(controlsOf("collapsed")).toEqual({ collapse: { action: "restore", label: "Restaurar a área de resultado" }, maximize: { action: "maximize", label: "Maximizar a área de resultado" } });
  });

  it("maximizada: recolher segue valendo; o segundo botão restaura", () => {
    expect(controlsOf("maximized")).toEqual({ collapse: { action: "collapse", label: "Recolher a área de resultado" }, maximize: { action: "restore", label: "Restaurar a área de resultado" } });
  });
});

describe("commandWillRun: a área recolhida só volta quando o executor vai enviar o comando (RN-PAINEL-001, RN-SQL-001)", () => {
  it("um comando só, com a aba livre: vai", () => {
    expect(commandWillRun({ sql: "SELECT 1" }, false)).toBe(true);
    expect(commandWillRun({ sql: "SELECT 1;", engine: 1 }, false)).toBe(true);
    expect(commandWillRun({ sql: "  -- antes\nSELECT 1 /* depois */ ;  ", engine: 3 }, false)).toBe(true);
  });

  it("sem nada para enviar (vazio, só espaço, só comentário, só ponto e vírgula): não vai", () => {
    for (const sql of ["", "   \n\t ", "-- só um comentário", "/* só um comentário */", ";", " ; ;"]) expect(commandWillRun({ sql }, false), JSON.stringify(sql)).toBe(false);
  });

  it("mais de um comando na seleção: não vai", () => {
    expect(commandWillRun({ sql: "SELECT 1; SELECT 2" }, false)).toBe(false);
    expect(commandWillRun({ sql: "DELETE FROM t;\nSELECT 1;" }, false)).toBe(false);
  });

  it("com a aba ocupada (um comando, 'carregar mais' ou a contagem em andamento): não vai", () => {
    expect(commandWillRun({ sql: "SELECT 1" }, true)).toBe(false);
  });

  it("conta os comandos pelo dialeto do banco da aba, como o executor", () => {
    // Entre aspas de dólar, só o PostgreSQL esconde o ponto e vírgula; no Db2 são dois comandos.
    const sql = "SELECT $$a;b$$";

    expect(commandWillRun({ sql, engine: 1 }, false)).toBe(true);
    expect(commandWillRun({ sql, engine: 2 }, false)).toBe(false);
  });
});

describe("splitterKeyAction: o teclado da divisória (RN-PAINEL-001)", () => {
  it("seta para cima aumenta o resultado, seta para baixo diminui", () => {
    expect(splitterKeyAction("ArrowUp")).toEqual({ type: "nudge", direction: 1 });
    expect(splitterKeyAction("ArrowDown")).toEqual({ type: "nudge", direction: -1 });
  });

  it("Home vai ao menor tamanho do resultado, End ao maior", () => {
    expect(splitterKeyAction("Home")).toEqual({ type: "extreme", end: "min" });
    expect(splitterKeyAction("End")).toEqual({ type: "extreme", end: "max" });
  });

  it("qualquer outra tecla segue o caminho dela: as setas laterais, o Tab, o Enter, o Espaço, as letras", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Tab", "Enter", " ", "Escape", "PageUp", "PageDown", "a", "Home ", ""]) expect(splitterKeyAction(key), JSON.stringify(key)).toBeNull();
  });

  it("aplicadas ao estado, as teclas movem a divisão de 5 em 5 pontos e param nos limites", () => {
    let layout = split(60);
    for (const key of ["ArrowUp", "ArrowUp", "ArrowDown"]) layout = layoutReducer(layout, splitterKeyAction(key)!);
    expect(layout.resultPercent).toBe(65);

    expect(layoutReducer(layout, splitterKeyAction("Home")!).resultPercent).toBe(minResultPercent);
    expect(layoutReducer(layout, splitterKeyAction("End")!).resultPercent).toBe(maxResultPercent);
  });
});
