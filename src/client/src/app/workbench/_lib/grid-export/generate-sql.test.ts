import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { statementCount } from "../sql-statements";
import { generateInsertInto, generateSql, qualifiedTable, type SqlKind, type SqlTarget } from "./generate-sql";
import { gridExportCopy } from "./grid-export.copy";
import { scriptLiteral } from "./script-literal";
import { chars, column, hostile, hostileValues, randomText, seededRandom, sliceOf } from "./test-fixtures";

const engines: Engine[] = [1, 2, 3];
const kinds: SqlKind[] = ["insert", "update", "delete", "select"];
const target = (keyColumns: string[] | null, engine: Engine = 1): SqlTarget => ({ engine, schema: "public", table: "orders", keyColumns });
const copy = gridExportCopy.sql;
const linesOf = (sql: string) => sql.split("\n");
/** Um valor que NÃO vira literal em banco nenhum: tem um controle que não é quebra de linha, retorno de carro nem tabulação. */
const refused = `ruim${chars(0)}nulo`;

const orders = sliceOf(
  [column("id", "number"), column("name"), column("note")],
  [
    ["1", "Ana", null],
    ["2", "O'Brien", "x"],
  ],
  { rowNumbers: [4, 7] },
);

describe("generateSql: INSERT, UPDATE, DELETE e SELECT (RN-GRADE-006)", () => {
  it("INSERT: um comando por linha, com as colunas do recorte, o nulo como NULL e o número sem aspas", () => {
    expect(generateSql("insert", orders, target(["id"]))).toBe(
      `INSERT INTO "public"."orders" ("id", "name", "note") VALUES (1, 'Ana', NULL);\nINSERT INTO "public"."orders" ("id", "name", "note") VALUES (2, 'O''Brien', 'x');`,
    );
  });

  it("INSERT não depende da chave", () => {
    expect(generateSql("insert", orders, target(null))).toBe(generateSql("insert", orders, target(["id"])));
  });

  it("UPDATE: SET das colunas que não são da chave (o nulo vira NULL), WHERE pela chave", () => {
    expect(generateSql("update", orders, target(["id"]))).toBe(
      `UPDATE "public"."orders" SET "name" = 'Ana', "note" = NULL WHERE "id" = 1;\nUPDATE "public"."orders" SET "name" = 'O''Brien', "note" = 'x' WHERE "id" = 2;`,
    );
  });

  it("DELETE e SELECT *: WHERE pela chave, e só a chave importa", () => {
    expect(generateSql("delete", orders, target(["id"]))).toBe(`DELETE FROM "public"."orders" WHERE "id" = 1;\nDELETE FROM "public"."orders" WHERE "id" = 2;`);
    expect(generateSql("select", orders, target(["id"]))).toBe(`SELECT * FROM "public"."orders" WHERE "id" = 1;\nSELECT * FROM "public"."orders" WHERE "id" = 2;`);
  });

  it("chave composta: todas as colunas da chave no WHERE, juntas por AND, e fora do SET", () => {
    const slice = sliceOf([column("a", "number"), column("b"), column("c")], [["1", "x", "y"]]);

    expect(generateSql("update", slice, target(["a", "b"]))).toBe(`UPDATE "public"."orders" SET "c" = 'y' WHERE "a" = 1 AND "b" = 'x';`);
    expect(generateSql("delete", slice, target(["b", "a"]))).toBe(`DELETE FROM "public"."orders" WHERE "b" = 'x' AND "a" = 1;`);
  });

  it("valor nulo na chave vira IS NULL, e não `= NULL`", () => {
    const slice = sliceOf([column("a"), column("b")], [[null, "y"]]);

    expect(generateSql("delete", slice, target(["a"]))).toBe(`DELETE FROM "public"."orders" WHERE "a" IS NULL;`);
  });

  it("recorte vazio, ou sem colunas: nada", () => {
    for (const kind of kinds) {
      expect(generateSql(kind, sliceOf([column("a")], []), target(["a"]))).toBe("");
      expect(generateSql(kind, sliceOf([], [[], []]), target(["a"]))).toBe("");
    }
  });

  it("uma célula só", () => {
    expect(generateSql("insert", sliceOf([column("a")], [["x"]]), target(null))).toBe(`INSERT INTO "public"."orders" ("a") VALUES ('x');`);
  });

  it("sem esquema, o nome da tabela vai só; o nome do esquema e da tabela vão entre aspas, com a aspa de dentro dobrada", () => {
    expect(qualifiedTable("", "t")).toBe('"t"');
    expect(qualifiedTable('s"x', 'a"b')).toBe('"s""x"."a""b"');
    expect(generateSql("delete", sliceOf([column("a")], [["1"]]), { engine: 1, schema: "", table: "t", keyColumns: ["a"] })).toBe(`DELETE FROM "t" WHERE "a" = '1';`);
  });

  it("nomes de coluna repetidos aparecem como estão (o recorte é o da grade)", () => {
    expect(generateSql("insert", sliceOf([column("x"), column("x")], [["1", "2"]]), target(null))).toBe(`INSERT INTO "public"."orders" ("x", "x") VALUES ('1', '2');`);
  });

  it("a saída não termina em quebra de linha, e as linhas são separadas por \\n", () => {
    const sql = generateSql("insert", orders, target(null));

    expect(sql.endsWith("\n")).toBe(false);
    expect(sql).not.toContain("\r");
  });
});

describe("generateSql: sem chave conhecida a condição usa todas as colunas", () => {
  it.each([null, []])("chave %j: comentário no começo, IS NULL para o nulo, e SET de todas as colunas no UPDATE", (keyColumns) => {
    expect(generateSql("delete", orders, target(keyColumns))).toBe(
      [`-- ${copy.noKey}`, `DELETE FROM "public"."orders" WHERE "id" = 1 AND "name" = 'Ana' AND "note" IS NULL;`, `DELETE FROM "public"."orders" WHERE "id" = 2 AND "name" = 'O''Brien' AND "note" = 'x';`].join("\n"),
    );
    expect(generateSql("select", orders, target(keyColumns)).split("\n")[0]).toBe(`-- ${copy.noKey}`);
    expect(generateSql("update", orders, target(keyColumns))).toContain(`UPDATE "public"."orders" SET "id" = 1, "name" = 'Ana', "note" = NULL WHERE "id" = 1 AND "name" = 'Ana' AND "note" IS NULL;`);
  });

  it("o INSERT não leva o comentário: a chave não entra nele", () => {
    expect(generateSql("insert", orders, target(null))).not.toContain("--");
  });

  it("com a chave conhecida não há comentário", () => {
    expect(generateSql("delete", orders, target(["id"]))).not.toContain("--");
  });

  it("recorte vazio sem chave: nada, nem o comentário", () => {
    expect(generateSql("delete", sliceOf([column("a")], []), target(null))).toBe("");
  });
});

describe("generateSql: o que não dá para gerar", () => {
  it("chave conhecida que não está entre as colunas do recorte: não se gera UPDATE, DELETE nem SELECT (adivinhar a linha por outras colunas apagaria mais do que o escolhido)", () => {
    const slice = sliceOf([column("name"), column("note")], [["Ana", null]]);

    for (const kind of ["update", "delete", "select"] as const) expect(generateSql(kind, slice, target(["id"]))).toBe(`-- ${copy.keyNotInSlice}`);
    expect(generateSql("insert", slice, target(["id"]))).toContain("INSERT INTO");
  });

  it("chave composta com uma das colunas fora do recorte também é recusada", () => {
    expect(generateSql("delete", sliceOf([column("a")], [["1"]]), target(["a", "b"]))).toBe(`-- ${copy.keyNotInSlice}`);
  });

  it("UPDATE em que todas as colunas são da chave não tem o que atualizar", () => {
    expect(generateSql("update", sliceOf([column("a"), column("b")], [["1", "2"]]), target(["a", "b"]))).toBe(`-- ${copy.nothingToSet}`);
    expect(generateSql("delete", sliceOf([column("a"), column("b")], [["1", "2"]]), target(["a", "b"]))).toContain("DELETE FROM");
  });
});

describe("generateSql: a linha cuja coluna necessária não vira literal fica de fora, e um comentário no fim diz quais", () => {
  const cols = [column("id", "number"), column("name"), column("foto", "binary")];

  it("valor cortado numa coluna necessária: o INSERT e o UPDATE pulam a linha; o DELETE pela chave não precisa dela", () => {
    const slice = sliceOf(cols.slice(0, 2), [["1", "ok"], ["2", "cortado…"], ["3", "ok"]], { truncated: [[1, 1]], rowNumbers: [10, 11, 12] });

    for (const kind of ["insert", "update"] as const) {
      const lines = linesOf(generateSql(kind, slice, target(["id"])));
      expect(lines).toHaveLength(3);
      expect(lines.at(-1)).toBe(`-- ${copy.skipped.truncated}: 11.`);
    }
    expect(generateSql("delete", slice, target(["id"]))).toBe(`DELETE FROM "public"."orders" WHERE "id" = 1;\nDELETE FROM "public"."orders" WHERE "id" = 2;\nDELETE FROM "public"."orders" WHERE "id" = 3;`);
  });

  it("valor cortado na chave: nem o DELETE nem o SELECT geram a linha", () => {
    const slice = sliceOf(cols.slice(0, 2), [["1", "ok"], ["2", "ok"]], { truncated: [[0, 0]], rowNumbers: [5, 6] });

    expect(linesOf(generateSql("delete", slice, target(["id"]))).at(-1)).toBe(`-- ${copy.skipped.truncated}: 5.`);
    expect(generateSql("select", slice, target(["id"]))).toBe(`SELECT * FROM "public"."orders" WHERE "id" = 2;\n-- ${copy.skipped.truncated}: 5.`);
  });

  it("coluna binária com valor: a linha não é gerada; com nulo ela é gerada (NULL é exato)", () => {
    const slice = sliceOf(cols, [["1", "a", "0x00ff"], ["2", "b", null]], { rowNumbers: [1, 2] });

    expect(generateSql("insert", slice, target(["id"]))).toBe(`INSERT INTO "public"."orders" ("id", "name", "foto") VALUES (2, 'b', NULL);\n-- ${copy.skipped.binary}: 1.`);
    // Com a chave conhecida, o DELETE não olha a coluna binária.
    expect(generateSql("delete", slice, target(["id"]))).not.toContain("--");
    // Sem chave, a binária entra na condição e a linha com valor fica de fora.
    expect(generateSql("delete", slice, target(null))).toContain(`-- ${copy.skipped.binary}: 1.`);
  });

  it("valor com outro caractere de controle (o nulo, o escape, o DEL…): a linha fica de fora, com quebra de linha ou sem", () => {
    const slice = sliceOf([column("a")], [["ok"], [refused], [hostile.controls], [`com${chars(27)}esc\nquebra`], ["ok2"]], { rowNumbers: [1, 2, 3, 4, 5] });
    const lines = linesOf(generateSql("insert", slice, target(null)));

    expect(lines).toHaveLength(3);
    expect(lines.at(-1)).toBe(`-- ${copy.skipped.literal}: 2-4.`);
  });

  it("a barra invertida vira literal nos três bancos (RN-TABELA-007): no PostgreSQL E'...' com ela dobrada, no Db2 e no Informix como está", () => {
    const slice = sliceOf([column("a")], [["a\\b"]], { rowNumbers: [9] });

    expect(generateSql("insert", slice, target(null, 1))).toBe(`INSERT INTO "public"."orders" ("a") VALUES (E'a\\\\b');`);
    expect(generateSql("insert", slice, target(null, 2))).toBe(`INSERT INTO "public"."orders" ("a") VALUES ('a\\b');`);
    expect(generateSql("insert", slice, target(null, 3))).toBe(`INSERT INTO "public"."orders" ("a") VALUES ('a\\b');`);
  });

  it("os números das linhas são os da grade, e as consecutivas viram faixa (de três em diante)", () => {
    const slice = sliceOf([column("a")], [[refused], [refused], ["ok"], [refused], [refused], [refused], [refused], [refused]], { rowNumbers: [3, 4, 5, 20, 21, 22, 23, 40] });

    expect(linesOf(generateSql("insert", slice, target(null))).at(-1)).toBe(`-- ${copy.skipped.literal}: 3, 4, 20-23, 40.`);
  });

  it("uma linha com dois motivos aparece nos dois comentários; a saída termina no último comentário", () => {
    const slice = sliceOf([column("a"), column("f", "binary")], [[refused, "0x01"], ["ok", null]], { rowNumbers: [8, 9] });
    const lines = linesOf(generateSql("insert", slice, target(null)));

    expect(lines).toEqual([`INSERT INTO "public"."orders" ("a", "f") VALUES ('ok', NULL);`, `-- ${copy.skipped.binary}: 8.`, `-- ${copy.skipped.literal}: 8.`]);
  });

  it("sem chave, as linhas de fora vêm depois do comentário do começo e dos comandos", () => {
    const slice = sliceOf([column("a")], [["x"], [refused]], { rowNumbers: [1, 2] });

    expect(generateSql("delete", slice, target(null))).toBe([`-- ${copy.noKey}`, `DELETE FROM "public"."orders" WHERE "a" = 'x';`, `-- ${copy.skipped.literal}: 2.`].join("\n"));
  });

  it("nenhuma linha gerada: só comentários, e o contador de comandos do projeto lê zero", () => {
    const sql = generateSql("insert", sliceOf([column("a")], [[refused]]), target(null));

    expect(sql).toBe(`-- ${copy.skipped.literal}: 1.`);
    expect(statementCount(sql, 1)).toBe(0);
  });
});

describe("generateSql: texto com quebra de linha, retorno de carro ou tabulação vira comando (RN-GRADE-006)", () => {
  const [LF, CR, TAB] = [chars(10), chars(13), chars(9)];
  const notes = sliceOf(
    [column("id", "number"), column("note")],
    [
      ["1", `linha1${LF}linha2`],
      ["2", `a${CR}${LF}b${TAB}c`],
      ["3", null],
      ["4", "simples"],
    ],
    { rowNumbers: [10, 11, 12, 13] },
  );
  const insertInto = (values: string[]) => values.map((value) => `INSERT INTO "public"."orders" ("id", "note") VALUES (${value});`).join("\n");

  it.each([1, 2] as const)("banco %i: a quebra de linha e a tabulação vão dentro das aspas, como estão; o retorno de carro por CHR(13); nenhuma linha fica de fora", (engine) => {
    expect(generateSql("insert", notes, target(["id"], engine))).toBe(insertInto([`1, 'linha1${LF}linha2'`, `2, 'a' || CHR(13) || '${LF}b${TAB}c'`, "3, NULL", "4, 'simples'"]));
  });

  it.each(engines)("banco %i: o script de cada tipo de comando atravessa o editor da aba de consulta (CodeMirror) sem mudar, e o valor com CR, CRLF e CR no fim é lido de volta (RN-GRADE-006)", (engine) => {
    const values = [`a${CR}b`, `a${CR}${LF}b`, `fim${CR}`, `${CR}`, `x${CR}${LF}${CR}${LF}`, `${LF}${CR}${TAB}${CR}${LF}`];
    const slice = sliceOf([column("k"), column("v")], values.map((value, index) => [`k${index}${CR}${LF}`, value]), { rowNumbers: values.map((_, index) => index + 1) });

    for (const kind of kinds) {
      for (const keyColumns of [["k"], null]) {
        const sql = generateSql(kind, slice, target(keyColumns, engine));

        expect(sql, `${kind} ${keyColumns}`).not.toContain(CR);
        expect(EditorState.create({ doc: sql }).doc.toString(), `${kind} ${keyColumns}`).toBe(sql);
        expect(statementCount(sql, engine), `${kind} ${keyColumns}`).toBe(values.length);
      }
    }
  });

  it("Informix: o texto entre aspas é partido nas quebras e as partes se unem por || com CHR(10), CHR(13) e CHR(9)", () => {
    expect(generateSql("insert", notes, target(["id"], 3))).toBe(insertInto(["1, 'linha1' || CHR(10) || 'linha2'", "2, 'a' || CHR(13) || CHR(10) || 'b' || CHR(9) || 'c'", "3, NULL", "4, 'simples'"]));
  });

  it.each(engines)("banco %i: o UPDATE leva o valor de várias linhas no SET, o DELETE e o SELECT na chave", (engine) => {
    const textOf = (value: string) => scriptLiteral(engine, value, "text") ?? "";
    const first = `linha1${LF}linha2`;
    const keyed = sliceOf([column("code"), column("note")], [[first, `x${LF}y`]], { rowNumbers: [1] });

    expect(generateSql("update", keyed, { engine, schema: "s", table: "t", keyColumns: ["code"] })).toBe(`UPDATE "s"."t" SET "note" = ${textOf(`x${LF}y`)} WHERE "code" = ${textOf(first)};`);
    expect(generateSql("delete", keyed, { engine, schema: "s", table: "t", keyColumns: ["code"] })).toBe(`DELETE FROM "s"."t" WHERE "code" = ${textOf(first)};`);
    expect(generateSql("select", keyed, { engine, schema: "s", table: "t", keyColumns: ["code"] })).toBe(`SELECT * FROM "s"."t" WHERE "code" = ${textOf(first)};`);
  });

  it("Informix, sem chave: a condição de todas as colunas leva o valor de várias linhas, e o nulo segue como IS NULL", () => {
    expect(generateSql("delete", notes, target(null, 3)).split("\n")).toEqual([
      `-- ${copy.noKey}`,
      `DELETE FROM "public"."orders" WHERE "id" = 1 AND "note" = 'linha1' || CHR(10) || 'linha2';`,
      `DELETE FROM "public"."orders" WHERE "id" = 2 AND "note" = 'a' || CHR(13) || CHR(10) || 'b' || CHR(9) || 'c';`,
      `DELETE FROM "public"."orders" WHERE "id" = 3 AND "note" IS NULL;`,
      `DELETE FROM "public"."orders" WHERE "id" = 4 AND "note" = 'simples';`,
    ]);
  });

  it("barra invertida e quebra de linha: no PostgreSQL E'...' com a barra dobrada e a quebra como está; no Db2 as duas como estão; no Informix a barra como está e a quebra em CHR", () => {
    const slice = sliceOf([column("a")], [[`c:\\dir${LF}x`]], { rowNumbers: [6] });

    expect(generateSql("insert", slice, target(null, 1))).toBe(`INSERT INTO "public"."orders" ("a") VALUES (E'c:\\\\dir${LF}x');`);
    expect(generateSql("insert", slice, target(null, 2))).toBe(`INSERT INTO "public"."orders" ("a") VALUES ('c:\\dir${LF}x');`);
    expect(generateSql("insert", slice, target(null, 3))).toBe(`INSERT INTO "public"."orders" ("a") VALUES ('c:\\dir' || CHR(10) || 'x');`);
  });

  it.each(engines)("banco %i: com outro controle junto da quebra de linha a linha fica de fora, e as outras saem", (engine) => {
    const slice = sliceOf([column("a")], [[`um${LF}dois`], [`um${LF}${chars(0)}dois`], [`um${TAB}${chars(27)}`], ["ok"]], { rowNumbers: [1, 2, 3, 4] });
    const sql = generateSql("insert", slice, target(null, engine));

    expect(linesOf(sql).at(-1)).toBe(`-- ${copy.skipped.literal}: 2, 3.`);
    expect(statementCount(sql, engine)).toBe(2);
  });

  it("o comentário do que ficou de fora nomeia a exceção: o controle que NÃO seja quebra de linha, retorno de carro nem tabulação; a barra invertida não é mais exceção em banco nenhum", () => {
    expect(copy.skipped.literal).toMatch(/controle que não seja quebra de linha, retorno de carro nem tabulação/);
    expect(copy.skipped.literal).not.toMatch(/Db2|barra invertida/);
  });

  it.each(engines)("banco %i: uma linha gerada é exatamente um comando, com valores de várias linhas em todas as colunas e cada tipo de comando", (engine) => {
    const multi = [`a${LF}b`, `${LF}`, `${CR}${LF}${TAB}`, `x'${LF}'; DROP TABLE t; --${LF}y`, `${LF}-- comentário${LF}`, `{${LF}}`, `/*${LF}*/`, `$$${LF}$$`, `fim${LF}`];
    const slice = sliceOf([column("k"), column("v1"), column("v2")], multi.map((value, index) => [`k${index}${LF}`, value, index % 3 === 0 ? null : value]), { rowNumbers: multi.map((_, index) => index + 1) });

    for (const kind of kinds) {
      const sql = generateSql(kind, slice, { engine, schema: "s", table: "t", keyColumns: ["k"] });

      // No PostgreSQL e no Db2 o valor de várias linhas ocupa várias linhas do texto: o comando se conta pelo leitor do projeto, e não pelas quebras.
      expect(statementCount(sql, engine), `${kind} no banco ${engine}`).toBe(multi.length);
      expect(sql, kind).not.toContain(copy.skipped.literal);
      expect(sql, kind).not.toContain(copy.noKey);
    }
  });
});

describe("generateSql: o lógico e a data e hora no Informix saem como o servidor os aceita (Tarefa 33a, rodada 1)", () => {
  const slice = sliceOf(
    [column("id", "number"), column("ativo", "boolean"), column("criado_em", "datetime"), column("dia", "datetime")],
    [
      ["1", "true", "2024-01-02 03:04:05.000000", "2024-01-02"],
      ["2", "false", "1999-12-31 23:59:59.123450", "1999-12-31"],
      ["3", "true", "2024-01-02 03:04:05.123456", "2024-01-02"],
      ["4", null, null, null],
    ],
    { rowNumbers: [10, 11, 12, 13] },
  );
  const stamp = (text: string) => `DATETIME (${text}) YEAR TO FRACTION(5)`;

  it("INSERT: 't' e 'f', o literal tipado com cinco casas e a data entre aspas; a linha com um sexto dígito diferente de zero fica de fora, com o comentário", () => {
    expect(generateSql("insert", slice, target(["id"], 3)).split("\n")).toEqual([
      `INSERT INTO "public"."orders" ("id", "ativo", "criado_em", "dia") VALUES (1, 't', ${stamp("2024-01-02 03:04:05.00000")}, '2024-01-02');`,
      `INSERT INTO "public"."orders" ("id", "ativo", "criado_em", "dia") VALUES (2, 'f', ${stamp("1999-12-31 23:59:59.12345")}, '1999-12-31');`,
      `INSERT INTO "public"."orders" ("id", "ativo", "criado_em", "dia") VALUES (4, NULL, NULL, NULL);`,
      `-- ${copy.skipped.literal}: 12.`,
    ]);
  });

  it("UPDATE, DELETE e SELECT sem chave levam o mesmo literal na condição", () => {
    const sql = generateSql("delete", slice, target(null, 3)).split("\n");

    expect(sql[1]).toBe(`DELETE FROM "public"."orders" WHERE "id" = 1 AND "ativo" = 't' AND "criado_em" = ${stamp("2024-01-02 03:04:05.00000")} AND "dia" = '2024-01-02';`);
    expect(generateSql("update", slice, target(["id"], 3)).split("\n")[0]).toBe(`UPDATE "public"."orders" SET "ativo" = 't', "criado_em" = ${stamp("2024-01-02 03:04:05.00000")}, "dia" = '2024-01-02' WHERE "id" = 1;`);
  });

  it("o PostgreSQL e o Db2 seguem como estavam: o texto entre aspas, sem linha de fora", () => {
    for (const engine of [1, 2] as const) {
      const lines = generateSql("insert", slice, target(["id"], engine)).split("\n");

      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe(`INSERT INTO "public"."orders" ("id", "ativo", "criado_em", "dia") VALUES (1, 'true', '2024-01-02 03:04:05.000000', '2024-01-02');`);
    }
  });

  it("um comando por linha gerada, nos três bancos (o DELETE e o SELECT pela chave não olham as outras colunas)", () => {
    for (const engine of engines) for (const kind of kinds) expect(statementCount(generateSql(kind, slice, target(["id"], engine)), engine), `${kind} ${engine}`).toBe(engine === 3 && (kind === "insert" || kind === "update") ? 3 : 4);
  });
});

describe("generateSql: um comando por linha gerada, com nomes e valores hostis, nos três bancos", () => {
  const hostileNames = ['a"b', "x;y", "--z", "n\nl", "back\\slash", "/*c*/", "{b}", "$$", "'q'", "tab\there", "`", ""];

  it.each(engines)("banco %i: cada linha gerada é exatamente um comando, e o comentário final não conta", (engine) => {
    const columns = hostileNames.map((name) => column(name));
    const rows = hostileValues.map((value, rowIndex) => hostileNames.map((_, index) => (rowIndex % 3 === 0 && index % 2 === 0 ? null : value)));
    const slice = sliceOf(columns, rows);

    for (const kind of kinds) {
      const sql = generateSql(kind, slice, { engine, schema: 'sch"ema;--', table: "ta'ble\n{x}", keyColumns: kind === "insert" || kind === "update" ? [hostileNames[1]] : hostileNames.slice(0, 2) });
      // Quantas linhas têm TODAS as colunas necessárias com literal. No UPDATE e no INSERT são todas; no DELETE e no SELECT, as duas da chave.
      const needed = kind === "insert" || kind === "update" ? hostileNames.map((_, index) => index) : [0, 1];
      const generated = rows.filter((row) => needed.every((index) => row[index] === null || scriptLiteral(engine, row[index], "text") !== null)).length;

      expect(statementCount(sql, engine), `${kind} no banco ${engine}`).toBe(generated);
      expect(generated).toBeGreaterThan(0);
    }
  });

  it.each(engines)("banco %i: o sorteio de semente fixa (valores, nomes de coluna, esquema e tabela) nunca muda a contagem de comandos", (engine) => {
    const random = seededRandom(33 + engine);
    let generatedTotal = 0;

    for (let round = 0; round < 150; round++) {
      const kindsOfColumns = [random() < 0.3 ? "number" : "text", random() < 0.3 ? "number" : "text", "text"] as const;
      const names = [randomText(random), randomText(random), randomText(random)];
      const rows = Array.from({ length: 4 }, () => names.map(() => (random() < 0.2 ? null : randomText(random))));
      const slice = sliceOf(names.map((name, index) => column(name, kindsOfColumns[index])), rows);

      for (const kind of kinds) {
        const sql = generateSql(kind, slice, { engine, schema: randomText(random), table: randomText(random), keyColumns: kind === "insert" ? null : [names[0]] });
        // O INSERT e o UPDATE precisam de todas as colunas; o DELETE e o SELECT, só da chave (a primeira coluna, que `findIndex` acha primeiro).
        const needed = kind === "delete" || kind === "select" ? [0] : [0, 1, 2];
        const generated = rows.filter((row) => needed.every((index) => row[index] === null || scriptLiteral(engine, row[index], kindsOfColumns[index]) !== null)).length;

        expect(statementCount(sql, engine), JSON.stringify({ kind, sql })).toBe(generated);
        generatedTotal += generated;
      }
    }
    // O sorteio gera comando de verdade (não é uma conta de zero igual a zero).
    expect(generatedTotal).toBeGreaterThan(100);
  });

  it("o comentário nunca leva nome nem valor do banco: a quebra de linha de um nome não encerra um comentário e solta código", () => {
    const evil = `evil\n); DROP TABLE x; --${chars(0x2028)}`;
    const slice = sliceOf(
      [column("id", "number"), column(evil), column("f", "binary")],
      [
        ["1", "ok", null],
        ["2", refused, null],
        ["3", "cortado", "0x01"],
      ],
      { truncated: [[2, 1]], rowNumbers: [1, 2, 3] },
    );

    // A chave do DELETE e do SELECT inclui a coluna binária, para que algo fique de fora também neles.
    const keys = { insert: null, update: ["id"], delete: ["id", "f"], select: ["id", "f"] };
    const generated = { insert: 1, update: 1, delete: 2, select: 2 };

    for (const engine of engines) {
      for (const kind of kinds) {
        const sql = generateSql(kind, slice, target(keys[kind], engine));
        const comments = sql.split("\n").filter((line) => line.startsWith("--"));

        expect(comments.length).toBeGreaterThan(0);
        // Só as frases fixas e os números: letras, espaços, vírgula, ponto e vírgula, dois pontos, parênteses, dígitos e o hífen da faixa.
        for (const line of comments) expect(line, line).toMatch(/^-- [\p{L}0-9 ,;:()-]+\.?$/u);
        // O nome hostil só aparece entre aspas, dentro de um comando; um comando por linha gerada.
        expect(statementCount(sql, engine), `${kind} no banco ${engine}`).toBe(generated[kind]);
      }
    }
  });

  it("os valores são os literais do banco (sqlLiteral) com o tipo da coluna: o número sem aspas só na coluna numérica", () => {
    const slice = sliceOf([column("n", "number"), column("t")], [["007", "007"], ["-1.5e3", "1"], ["abc", "'; --"]]);

    expect(generateSql("insert", slice, target(null))).toBe(
      [`INSERT INTO "public"."orders" ("n", "t") VALUES (007, '007');`, `INSERT INTO "public"."orders" ("n", "t") VALUES (-1.5e3, '1');`, `INSERT INTO "public"."orders" ("n", "t") VALUES ('abc', '''; --');`].join("\n"),
    );
  });
});

describe("generateInsertInto: a aba de consulta, em que a tabela não é conhecida", () => {
  const slice = sliceOf([column("id", "number"), column("name")], [["1", "Ana"], ["2", null]]);

  it("usa o nome da tabela como o usuário escreveu, sem aspas nem escape", () => {
    expect(generateInsertInto(slice, 1, "public.clientes")).toBe(`INSERT INTO public.clientes ("id", "name") VALUES (1, 'Ana');\nINSERT INTO public.clientes ("id", "name") VALUES (2, NULL);`);
    expect(generateInsertInto(slice, 3, '"Meu Esquema".tabela')).toContain('INSERT INTO "Meu Esquema".tabela ("id", "name")');
  });

  it("só tira os espaços das pontas do que o usuário escreveu", () => {
    expect(generateInsertInto(slice, 1, "  t  ").startsWith('INSERT INTO t ("id"')).toBe(true);
  });

  it("sem nome, o comentário pede o nome; recorte vazio dá nada", () => {
    expect(generateInsertInto(slice, 1, "   ")).toBe(`-- ${copy.tableNameMissing}`);
    expect(generateInsertInto(sliceOf([column("a")], []), 1, "t")).toBe("");
  });

  it("as linhas de fora seguem a mesma regra do INSERT da tabela conhecida", () => {
    const sql = generateInsertInto(sliceOf([column("a")], [["x"], [refused]], { rowNumbers: [3, 4] }), 1, "t");

    expect(sql).toBe(`INSERT INTO t ("a") VALUES ('x');\n-- ${copy.skipped.literal}: 4.`);
  });

  it("o INSERT da tabela conhecida é este com o nome qualificado entre aspas", () => {
    expect(generateInsertInto(orders, 1, qualifiedTable("public", "orders"))).toBe(generateSql("insert", orders, target(null)));
  });
});
