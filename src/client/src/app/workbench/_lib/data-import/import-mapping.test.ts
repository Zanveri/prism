import { describe, expect, it } from "vitest";

import {
  autoTargets,
  carryTargets,
  chooseTarget,
  columnBlocker,
  columnMark,
  columnNote,
  columnsSummary,
  deletePreview,
  entriesOf,
  insertPreview,
  mappingWarnings,
  movedText,
  nameKey,
  noneMappedProblem,
  previewSummary,
  previewSummaryText,
  stayingDefaults,
  targetsOf,
} from "./import-mapping";
import { dataImportCopy } from "./data-import.copy";
import type { TableColumn } from "./imports.schema";

const column = (name: string, change: Partial<TableColumn> = {}): TableColumn => ({ name, type: "integer", nullable: true, defaultValue: null, generated: null, class: "number", importable: true, reason: null, ...change });

const table = {
  columns: [
    column("id", { nullable: false, defaultValue: "nextval('pedido_id_seq'::regclass)", generated: "byDefault" }),
    column("cliente_id", { nullable: false }),
    column("loja_id", { nullable: false }),
    column("data_de_criacao", { type: "date", class: "date" }),
    column("total", { type: "numeric(10,2)" }),
    column("qtd", { nullable: false, defaultValue: "0" }),
    column("soma", { generated: "always" }),
    column("faixa", { type: "INTERVAL DAY TO SECOND", class: "other", importable: false, reason: null }),
  ],
};

describe("as marcas e as recusas de cada coluna da tabela (RN-IMPORT-009)", () => {
  it("obrigatória (não aceita nulo, sem padrão e o banco não a preenche), preenchida pelo banco (por padrão) e calculada pelo banco (sempre)", () => {
    expect(table.columns.map(columnMark)).toEqual(["filledByDatabase", "required", "required", null, null, null, "computedByDatabase", null]);
  });

  it("desabilitadas, com o motivo: a calculada pelo banco e a de um tipo que o Prism não importa (a frase da API quando vem); o par binário da cópia", () => {
    expect(columnBlocker(column("soma", { generated: "always" }))).toBe("O banco calcula esta coluna e não aceita valor.");
    expect(columnBlocker(column("faixa", { importable: false }))).toBe("O Prism ainda não importa este tipo neste banco.");
    expect(columnBlocker(column("faixa", { importable: false, reason: "O Prism ainda não importa INTERVAL no Db2." }))).toBe("O Prism ainda não importa INTERVAL no Db2.");
    expect(columnBlocker(column("foto"), "Binário só vai para uma coluna binária.")).toBe("Binário só vai para uma coluna binária.");
    expect(columnBlocker(column("total"))).toBeNull();
  });

  it("a nota do money do PostgreSQL de destino; em outro banco, nada", () => {
    expect(columnNote(column("preco", { type: "money", class: "other" }), 1)).toBe("O banco lê este valor no formato de moeda do servidor.");
    expect(columnNote(column("preco", { type: "MONEY(8,2)" }), 3)).toBeNull();
  });
});

describe("o mapeamento automático (RN-IMPORT-009)", () => {
  it("pelo nome: primeiro o igual letra por letra; sem ele, sem caixa nem acento, com espaço, hífen e sublinhado iguais", () => {
    expect(nameKey("Data de criação")).toBe(nameKey("data_de_criacao"));
    expect(nameKey("data-de-criacao")).toBe("data_de_criacao");
    const { targets, ambiguous } = autoTargets(["Data de criação", "TOTAL", "observação"], table, { byName: true });
    expect(targets).toEqual(["data_de_criacao", "total", null]);
    expect([...ambiguous]).toEqual([]);
  });

  it("duas colunas da tabela que casam só sem caixa (Nome e nome, sem a igual): a do arquivo fica em \"Não importar\", com a dica", () => {
    const quoted = { columns: [column("Nome", { type: "text", class: "text" }), column("nome", { type: "text", class: "text" })] };
    expect(autoTargets(["NOME"], quoted, { byName: true })).toEqual({ targets: [null], ambiguous: new Set([0]) });
    // A igual letra por letra vence a dúvida.
    expect(autoTargets(["nome"], quoted, { byName: true }).targets).toEqual(["nome"]);
  });

  it("duas colunas do arquivo para a mesma da tabela: a primeira fica com ela; a desabilitada nunca é escolhida", () => {
    expect(autoTargets(["total", "Total", "soma", "faixa"], table, { byName: true }).targets).toEqual(["total", null, null, null]);
  });

  it("sem cabeçalho, pela posição: a coluna N do arquivo vai para a N da tabela; a que cairia numa desabilitada fica sem; as que sobram, também", () => {
    const sources = ["Coluna 1", "Coluna 2", "Coluna 3", "Coluna 4", "Coluna 5", "Coluna 6", "Coluna 7", "Coluna 8", "Coluna 9"];
    expect(autoTargets(sources, table, { byName: false }).targets).toEqual(["id", "cliente_id", "loja_id", "data_de_criacao", "total", "qtd", null, null, null]);
  });

  it("o par que a cópia não permite (binário de um lado só) não é escolhido", () => {
    const blocked = (source: number, target: TableColumn) => (source === 0 && target.name === "total" ? "Binário só vai para uma coluna binária." : null);
    expect(autoTargets(["total"], table, { byName: true, blocked }).targets).toEqual([null]);
  });
});

describe("a escolha à mão, o pedido e as voltas", () => {
  it("escolher uma coluna que já recebe outra a tira da outra, que passa a \"Não importar\", e diz quem deixou de receber", () => {
    const { targets, moved } = chooseTarget(["total", null, "qtd"], 1, "total");
    expect(targets).toEqual([null, "total", "qtd"]);
    expect(moved).toEqual({ target: "total", from: 0 });
    expect(movedText(moved ?? { target: "", from: 0 }, ["Total (R$)", "valor", "q"])).toBe("total deixou de receber Total (R$).");
    expect(chooseTarget(["total", null], 0, null)).toEqual({ targets: [null, null], moved: null });
  });

  it("o pedido leva só as mapeadas, na ordem do arquivo; a resposta volta às colunas do arquivo, sem a posição que não existe", () => {
    expect(entriesOf([null, "total", "id"])).toEqual([
      { source: 1, target: "total" },
      { source: 2, target: "id" },
    ]);
    expect(targetsOf([{ source: 2, target: "id" }, { source: 9, target: "x" }], 3)).toEqual([null, null, "id"]);
    expect(noneMappedProblem([null, null])).toBe("Escolha ao menos uma coluna da tabela para receber valores.");
    expect(noneMappedProblem([null, "id"])).toBeNull();
  });

  it("ler de novo: o mapeamento continua nas colunas que continuam lá, pelo nome com cabeçalho e pela posição sem; as que sumiram saem", () => {
    expect(carryTargets(["id", "total", "obs"], ["total", "id"], ["id", "total", null], true)).toEqual(["total", "id"]);
    expect(carryTargets(["Coluna 1", "Coluna 2"], ["Coluna 1"], ["id", "total"], false)).toEqual(["id"]);
    expect(carryTargets(["a", "a"], ["a", "a"], ["id", "total"], true)).toEqual(["id", null]);
  });
});

describe("o que fica com o padrão e os avisos (RN-IMPORT-009)", () => {
  it("as colunas que não recebem valor, com o padrão do catálogo, a marca ou nulo", () => {
    expect(stayingDefaults(table, ["total", null])).toEqual([
      { name: "id", value: "preenchida pelo banco" },
      { name: "cliente_id", value: "nulo" },
      { name: "loja_id", value: "nulo" },
      { name: "data_de_criacao", value: "nulo" },
      { name: "qtd", value: "0" },
      { name: "soma", value: "calculada pelo banco" },
      { name: "faixa", value: "nulo" },
    ]);
  });

  it("a obrigatória sem valor (uma frase para todas), a preenchida pelo banco com valor (fora do Informix) e a que não aceita nulo com padrão", () => {
    const warnings = mappingWarnings(table, ["id", "qtd", "cliente_id"], { engine: 1, copy: false });
    expect(warnings).toEqual([
      "loja_id é obrigatória (não aceita nulo e não tem padrão) e não recebe valor: o banco vai recusar as linhas, a não ser que um gatilho da tabela a preencha.",
      "id é preenchida pelo banco quando fica sem valor. Com os valores do arquivo, o contador do banco não anda, e as linhas criadas depois sem id podem repetir um valor importado.",
      "qtd não aceita nulo e tem padrão (0): um valor vazio ou ausente do arquivo vai como nulo, e não como o padrão, e o banco recusa a linha.",
    ]);
    expect(mappingWarnings(table, ["total"], { engine: 3, copy: true })).toEqual([
      "As colunas cliente_id e loja_id são obrigatórias (não aceitam nulo e não têm padrão), e não recebem valor: o banco vai recusar as linhas, a não ser que um gatilho da tabela as preencha.",
    ]);
    expect(mappingWarnings(table, ["id", "qtd", "cliente_id", "loja_id"], { engine: 3, copy: true })).toEqual([
      "qtd não aceita nulo e tem padrão (0): um nulo da origem vai como nulo, e não como o padrão, e o banco recusa a linha.",
    ]);
  });
});

describe("a prévia convertida, o resumo e os comandos do aviso", () => {
  it("o resumo conta os valores que não convertem (o problema da linha conta um) e diz a linha em que a importação para; a linha completada não é problema", () => {
    const rows = [
      { line: 2, problem: null, short: true, cells: [{ value: "1", problem: null }] },
      { line: 3, problem: null, short: false, cells: [{ value: "12a", problem: "«12a» não é um número inteiro." }, { value: "x", problem: "y" }] },
      { line: 5, problem: "A linha 5 tem 7 valores, e o cabeçalho tem 5.", short: false, cells: [] },
    ];
    expect(previewSummary(rows)).toEqual({ rows: 3, problems: 3, stopLine: 3 });
    expect(previewSummaryText(previewSummary(rows))).toBe("3 valores das 3 primeiras linhas não convertem: a importação vai parar na linha 3 do arquivo.");
    expect(previewSummaryText(previewSummary(rows.slice(0, 1)))).toBe("A primeira linha converte.");
    expect(previewSummaryText({ rows: 20, problems: 0, stopLine: null })).toBe("As 20 primeiras linhas convertem.");
    expect(previewSummaryText({ rows: 20, problems: 1, stopLine: 1234 })).toBe("1 valor das 20 primeiras linhas não converte: a importação vai parar na linha 1.234 do arquivo.");
  });

  it("\"Colunas\" da Confirmação, com os pares na dica", () => {
    expect(columnsSummary(["Nome", "Total", "x"], ["nome", "total", null], 12, false)).toEqual({ text: "2 de 3 colunas do arquivo, em 2 das 12 colunas da tabela", pairs: "Nome → nome, Total → total" });
    expect(columnsSummary(["id"], ["id"], 1, true).text).toBe("1 de 1 coluna da origem, em 1 da 1 coluna da tabela");
  });

  it("os comandos do aviso: os nomes entre aspas duplas, com a aspa de dentro dobrada, e só as colunas mapeadas", () => {
    expect(insertPreview("estoque", 'pe"dido', ["id", null, "cliente"])).toBe('INSERT INTO "estoque"."pe""dido" ("id", "cliente") VALUES (…)');
    expect(deletePreview("estoque", "pedido")).toBe('DELETE FROM "estoque"."pedido"');
  });
});

describe("o aviso da prévia na Confirmação (RN-IMPORT-013)", () => {
  it("no singular e no plural das linhas: \"Na primeira linha\", \"Nas 20 primeiras linhas\"", () => {
    expect(dataImportCopy.confirmation.previewProblems(1, 1, 2)).toBe("Na primeira linha, 1 valor não converte: a importação vai parar na linha 2 do arquivo.");
    expect(dataImportCopy.confirmation.previewProblems(3, 20, 5)).toBe("Nas 20 primeiras linhas, 3 valores não convertem: a importação vai parar na linha 5 do arquivo.");
  });
});
