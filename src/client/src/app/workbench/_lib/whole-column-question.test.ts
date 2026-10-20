import { describe, expect, it } from "vitest";

import { multiEditCopy } from "./multi-edit.copy";
import { wholeColumnQuestion, type WholeColumnFacts } from "./whole-column-question";

// A pergunta do "Salvar" com a coluna inteira (RN-EDIT-019): os textos dela, de cima para baixo, prontos para o aviso desenhar.

const copy = multiEditCopy.question;

const facts = (over: Partial<WholeColumnFacts> = {}): WholeColumnFacts => ({
  columns: ["preco"],
  assignments: ["preco = 10.00"],
  rows: 1234,
  table: "estoque.pedido",
  total: null,
  loaded: 200,
  kept: false,
  limited: false,
  others: 0,
  subject: "result",
  oneAtATime: false,
  preview: {
    statements: [
      { sql: 'SELECT COUNT(*) FROM "estoque"."pedido"', values: [], note: "A contagem confere, antes do UPDATE, que o comando ainda devolve as linhas confirmadas." },
      { sql: 'UPDATE "estoque"."pedido" SET "preco" = 10.00', values: [], note: null },
      { sql: 'UPDATE "estoque"."pedido" SET "status" = \'A\' WHERE "id" = 1', values: [] },
    ],
    oneAtATime: false,
  },
  ...over,
});

describe("a pergunta da coluna inteira (RN-EDIT-019)", () => {
  it("o título, a primeira frase com uma linha por coluna, os gatilhos sempre, o que vem depois, o UPDATE do preview e o botão", () => {
    expect(wholeColumnQuestion(facts())).toEqual({
      kind: "wholeColumn",
      title: "Alterar preco em 1.234 linhas de estoque.pedido?",
      lead: copy.goesTo,
      assignments: ["preco = 10.00"],
      warnings: [copy.triggers],
      others: null,
      after: copy.after.result,
      oneAtATime: null,
      command: { sql: 'UPDATE "estoque"."pedido" SET "preco" = 10.00', note: null },
      confirm: "Alterar 1.234 linhas",
      rows: 1234,
    });
  });

  it("com duas colunas, os dois nomes; com mais, quantas; com uma linha, \"em 1 linha\"", () => {
    expect(wholeColumnQuestion(facts({ columns: ["preco", "status"] })).title).toBe("Alterar preco e status em 1.234 linhas de estoque.pedido?");
    expect(wholeColumnQuestion(facts({ columns: ["a", "b", "c"] })).title).toBe("Alterar 3 colunas em 1.234 linhas de estoque.pedido?");
    const one = wholeColumnQuestion(facts({ rows: 1, loaded: 1 }));
    expect([one.title, one.confirm]).toEqual(["Alterar preco em 1 linha de estoque.pedido?", "Alterar 1 linha"]);
  });

  it("com zero linhas: \"Nenhuma linha de estoque.pedido será alterada\", a frase de que não muda nada, e o botão \"Salvar\"", () => {
    const none = wholeColumnQuestion(facts({ rows: 0, loaded: 0 }));
    expect([none.title, none.lead, none.confirm]).toEqual(["Nenhuma linha de estoque.pedido será alterada", copy.noRows, "Salvar"]);
  });

  it("as linhas de atenção, na ordem: o resultado mudou desde que foi lido, a aba guardada do script, o limite com ordem e os gatilhos", () => {
    expect(wholeColumnQuestion(facts({ total: 200, kept: true, limited: true })).warnings).toEqual([
      "A grade tem 200 linhas, e o comando devolve 1.234 agora: o resultado mudou desde que foi lido.",
      copy.kept,
      copy.ties,
      copy.triggers,
    ]);
    // Sem o total, a contagem menor que as linhas que a grade tem também diz que o resultado mudou.
    expect(wholeColumnQuestion(facts({ rows: 150 })).warnings[0]).toBe("A grade tem 200 linhas, e o comando devolve 150 agora: o resultado mudou desde que foi lido.");
    expect(wholeColumnQuestion(facts({ total: 1234 })).warnings).toEqual([copy.triggers]);
  });

  it("as outras pendências, o que vem depois (Registros, resultado, aba guardada) e o aviso do banco sem log", () => {
    expect(wholeColumnQuestion(facts({ others: 3 })).others).toBe("O Salvar grava também as outras 3 alterações não salvas.");
    expect(wholeColumnQuestion(facts({ others: 1 })).others).toBe("O Salvar grava também a outra alteração não salva.");
    expect(wholeColumnQuestion(facts({ subject: "table" })).after).toBe("Depois, os registros são lidos de novo.");
    expect(wholeColumnQuestion(facts({ kept: true })).after).toBe(copy.after.kept);
    expect(wholeColumnQuestion(facts({ oneAtATime: true })).oneAtATime).toBe(copy.oneAtATime);
  });

  it("o comando é o UPDATE da coluna inteira (o segundo do preview), com a nota dele quando vem", () => {
    const batches = facts({ preview: { statements: [{ sql: "SELECT id FROM t", values: [], note: "a" }, { sql: 'UPDATE t SET "c" = ? WHERE "id" IN (?, ?, …)', values: [], note: "As chaves vão em lotes de até 1.000." }], oneAtATime: false } });
    expect(wholeColumnQuestion(batches).command).toEqual({ sql: 'UPDATE t SET "c" = ? WHERE "id" IN (?, ?, …)', note: "As chaves vão em lotes de até 1.000." });
    expect(wholeColumnQuestion(facts({ preview: { statements: [], oneAtATime: false } })).command).toBeNull();
  });
});
