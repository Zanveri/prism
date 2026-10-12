import { describe, expect, it } from "vitest";

import { statementCount } from "./sql-statements";
import { equalsCondition, orderOf, recordsRunPlan, recordsSql, sqlLiteral, withOrder } from "./table-sql";

const postgres = 1;
const db2 = 2;
const informix = 3;
const engines = [postgres, db2, informix] as const;

const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);

/** Lê de volta o literal que a função escreveu, como o banco o leria. Escrito aqui, à parte dela. `escapes`: a barra invertida escapa (só no `E'...'` do PostgreSQL). */
function readLiteral(text: string, { escapes, prefix }: { escapes: boolean; prefix: "" | "E" }): string {
  if (!text.startsWith(`${prefix}'`)) throw new Error(`não começa como um literal: ${text.slice(0, 20)}`);

  let value = "";
  for (let at = prefix.length + 1; at < text.length; at++) {
    const char = text[at];
    if (char === "'") {
      if (text[at + 1] === "'") {
        value += "'";
        at++;
        continue;
      }
      if (at !== text.length - 1) throw new Error(`o literal fecha antes do fim: sobra ${text.slice(at + 1, at + 20)}`);
      return value;
    }
    if (escapes && char === "\\") {
      const next = text[++at];
      if (next !== "\\" && next !== "'") throw new Error(`escape que a função não escreve: \\${next}`);
      value += next;
      continue;
    }
    value += char;
  }
  throw new Error("o literal não fecha");
}

/**
 * Como cada banco lê o literal (RN-TABELA-007, Ruling 133): no PostgreSQL a barra só escapa dentro de `E'...'`; no Db2 e no Informix ela é um
 * caractere comum dentro de aspas simples (provado nos dois servidores pelo driver da IBM, que é o caminho do Prism).
 */
const readers = {
  [postgres]: (text: string) => readLiteral(text, { escapes: text.startsWith("E'"), prefix: text.startsWith("E'") ? "E" : "" }),
  [db2]: (text: string) => readLiteral(text, { escapes: false, prefix: "" }),
  [informix]: (text: string) => readLiteral(text, { escapes: false, prefix: "" }),
} as const;

const hostileValues = [
  "",
  " ",
  "  a  ",
  "O'Brien",
  "'",
  "''",
  "'''",
  "a''b",
  "\\",
  "\\\\",
  "a\\b",
  "x\\",
  "\\'",
  "'\\",
  "\\\\'",
  "a\\'; DROP TABLE x; --",
  "'; DROP TABLE x; --",
  "'; SELECT 1; --",
  "a;b",
  ";",
  "--",
  "-- comentário",
  "/* x */",
  "/*",
  "*/",
  "{",
  "}",
  "{ comentário do Informix }",
  "$$",
  "$a$ b $a$",
  'a"b',
  '"',
  "’",
  "‘a’",
  "´",
  "｀",
  "ʼ",
  "ＳＥＬＥＣＴ",
  "１２３",
  "٣",
  "0x1F",
  "1e5",
  "1E+10",
  "-5",
  "+5",
  ".5",
  "5.",
  "1,5",
  "1_000",
  "00012",
  "1 or 1=1",
  "1; DROP TABLE x",
  "NaN",
  "Infinity",
  "select",
  "NULL",
  "null",
  "true",
  "😀",
  "‏עברית‎",
  "a".repeat(10_000),
  "'".repeat(1_000),
];

describe("sqlLiteral: o valor de uma célula como literal do banco (RN-TABELA-007)", () => {
  it("número só se for número E a coluna for numérica", () => {
    for (const engine of engines) {
      for (const value of ["42", "0", "-1", "103.500", "-0.5", ".5", "5.", "1e5", "1E+10", "-1.5e-3", "00012", "9007199254740993", "123456789012345678901234567890"]) {
        expect(sqlLiteral(engine, value, "number"), `${engine} ${value}`).toBe(value);
      }
    }
  });

  it("texto que parece número, numa coluna de texto, vai entre aspas; e o que não é número, numa coluna numérica, também", () => {
    for (const engine of engines) {
      expect(sqlLiteral(engine, "42", "text")).toBe("'42'");
      expect(sqlLiteral(engine, "1e5", "text")).toBe("'1e5'");
      for (const value of ["abc", "NaN", "Infinity", "+5", "1,5", " 12", "12 ", "1 2", "0x1F", "1e", "e5", "--5", "1.2.3", "١٢٣", "１２３", "1 or 1=1", "1; DROP TABLE x"]) {
        expect(sqlLiteral(engine, value, "number"), `${engine} ${JSON.stringify(value)}`).toBe(`'${value.replaceAll("'", "''")}'`);
      }
    }
  });

  it("os outros tipos (data e hora, lógico, binário) também vão entre aspas, mesmo parecendo número", () => {
    for (const kind of ["datetime", "boolean", "binary"] as const) expect(sqlLiteral(postgres, "20261011", kind)).toBe("'20261011'");
  });

  it("a aspa é dobrada, nos três bancos", () => {
    for (const engine of engines) {
      expect(sqlLiteral(engine, "O'Brien", "text")).toBe("'O''Brien'");
      expect(sqlLiteral(engine, "'", "text")).toBe("''''");
      expect(sqlLiteral(engine, "a''b", "text")).toBe("'a''''b'");
    }
  });

  it("a barra invertida no PostgreSQL: o literal que a tem é E'...', com ela dobrada; sem ela, o literal comum", () => {
    expect(sqlLiteral(postgres, "a\\b", "text")).toBe("E'a\\\\b'");
    expect(sqlLiteral(postgres, "\\'", "text")).toBe("E'\\\\'''");
    expect(sqlLiteral(postgres, "sem barra", "text")).toBe("'sem barra'");
  });

  it.each([db2, informix] as const)("banco %i (Db2 e Informix): a barra invertida vai como está, entre aspas simples, só com a aspa dobrada (Ruling 133)", (engine) => {
    expect(sqlLiteral(engine, "a\\b", "text")).toBe("'a\\b'");
    expect(sqlLiteral(engine, "x\\", "text")).toBe("'x\\'");
    expect(sqlLiteral(engine, "\\\\", "text")).toBe("'\\\\'");
    expect(sqlLiteral(engine, "C:\\temp\\novo", "text")).toBe("'C:\\temp\\novo'");
    expect(sqlLiteral(engine, "O'Brien\\", "text")).toBe("'O''Brien\\'");
    expect(sqlLiteral(engine, "\\'; DROP TABLE x; --", "text")).toBe("'\\''; DROP TABLE x; --'");
    expect(sqlLiteral(engine, "1\\2", "number")).toBe("'1\\2'");
  });

  it.each([db2, informix] as const)("banco %i (Db2 e Informix): o contador de comandos lê a barra como o servidor (caractere comum), e o literal do valor hostil fica um comando só", (engine) => {
    // A premissa da regra: o servidor fecha o texto na aspa depois da barra, e o contador da tela também (o driver da IBM divide este envio em dois).
    expect(statementCount("SELECT 'a\\'; SELECT 'b'", engine)).toBe(2);
    expect(statementCount(`SELECT ${sqlLiteral(engine, "a\\'; SELECT 'b", "text")}`, engine)).toBe(1);
    expect(statementCount(recordsSql(engine, "s", "t", equalsCondition(engine, "c", "\\'; DROP TABLE x; --", "text") as string), engine)).toBe(1);
  });

  it.each([db2, informix] as const)("banco %i (Db2 e Informix): o literal de texto é sempre o valor entre aspas simples com a aspa dobrada, e nada mais", (engine) => {
    for (const value of hostileValues) expect(sqlLiteral(engine, value, "text") === `'${value.replaceAll("'", "''")}'`, JSON.stringify(value.slice(0, 40))).toBe(true);
    expect(sqlLiteral(engine, "a;b", "text")).toBe("'a;b'");
    expect(sqlLiteral(engine, "42", "number")).toBe("42");
  });

  it("quebra de linha, tabulação e os demais caracteres de controle não cabem no filtro de uma linha: nenhum literal", () => {
    for (const engine of engines) {
      for (const value of ["a\nb", "a\r\nb", "a\rb", "a\tb", `a${NUL}b`, `${ESC}[0m`, DEL, "\n"]) {
        expect(sqlLiteral(engine, value, "text"), `${engine} ${JSON.stringify(value)}`).toBeNull();
        expect(sqlLiteral(engine, value, "number"), `${engine} ${JSON.stringify(value)}`).toBeNull();
      }
    }
  });

  it("cada literal lido de volta pelo banco (um leitor escrito à parte) devolve o valor de partida, nos três bancos", () => {
    for (const engine of engines) {
      for (const value of hostileValues) {
        const literal = sqlLiteral(engine, value, "text");
        expect(literal, `${engine} ${JSON.stringify(value.slice(0, 40))}`).not.toBeNull();
        expect(readers[engine](literal as string) === value, `${engine} ${JSON.stringify(value.slice(0, 40))}`).toBe(true);
      }
    }
  });

  it("o comando inteiro é UM comando em cada banco, com o valor hostil no filtro, sozinho e com a ordem do cabeçalho depois dele (statementCount e recordsRunPlan)", () => {
    for (const engine of engines) {
      for (const kind of ["text", "number"] as const) {
        for (const value of hostileValues) {
          const where = equalsCondition(engine, "codigo", value, kind);
          // Nenhum valor desta lista tem caractere de controle: todos viram condição, os com barra invertida inclusive, nos três bancos.
          expect(where, `${engine} ${kind} ${JSON.stringify(value.slice(0, 40))}`).not.toBeNull();
          if (where === null) continue;

          const sql = recordsSql(engine, "producao", "pedido", where);
          expect(statementCount(sql, engine), `${engine} ${kind} ${JSON.stringify(value.slice(0, 40))}`).toBe(1);
          expect(recordsRunPlan(engine, "producao", "pedido", where, false).kind, `${engine} ${kind} ${JSON.stringify(value.slice(0, 40))}`).toBe("send");

          // O clique no cabeçalho escreve a ordem DEPOIS do literal, por hostil que ele seja: nada no valor a engole nem a puxa para dentro dele (RN-TABELA-010).
          const ordered = withOrder(where, { column: "codigo", direction: "desc" }, engine);
          expect(ordered === `${where} ORDER BY "codigo" DESC`, `${engine} ${kind} ${JSON.stringify(value.slice(0, 40))}`).toBe(true);
          expect(orderOf(ordered, engine), `${engine} ${kind} ${JSON.stringify(value.slice(0, 40))}`).toBe('ORDER BY "codigo" DESC');
          expect(recordsRunPlan(engine, "producao", "pedido", ordered, false).kind, `${engine} ${kind} ${JSON.stringify(value.slice(0, 40))}`).toBe("send");
        }
      }
    }
  });

  it("sorteio de semente fixa: 3.000 valores de caracteres perigosos por banco, sempre um comando só e sempre lidos de volta", () => {
    let state = 20_261_011;
    const rand = () => (state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
    const alphabet = ["'", "'", "\\", "\\", '"', ";", "-", "-", "/", "*", " ", "a", "1", "$", "E", "{", "}", "’", "e", "."];

    for (const engine of engines) {
      for (let sample = 0; sample < 3_000; sample++) {
        const value = Array.from({ length: Math.floor(rand() * 14) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
        const where = equalsCondition(engine, "c", value, sample % 2 === 0 ? "text" : "number");
        // Neste alfabeto não há caractere de controle: todo valor vira literal, nos três bancos.
        expect(where, `${engine} #${sample} ${JSON.stringify(value)}`).not.toBeNull();
        if (where === null) continue;

        expect(statementCount(recordsSql(engine, "s", "t", where), engine), `${engine} #${sample} ${JSON.stringify(value)}`).toBe(1);
        if (sample % 2 === 0) expect(readers[engine](where.slice('"c" = '.length)) === value, `${engine} #${sample} ${JSON.stringify(value)}`).toBe(true);
      }
    }
  });
});

describe("sqlLiteral no Informix: o lógico e a data e hora são literais que o servidor aceita (Tarefa 33a, rodada 1)", () => {
  // Provado contra o Informix 14.10 pelo driver da IBM (DRDA), o caminho do app: `'true'` no `BOOLEAN` dá -1260 e o texto das células de data e hora (seis casas de
  // segundo) dá -1264 em toda coluna com fração; só o literal tipado `DATETIME (...) YEAR TO FRACTION(5)` vale em todo qualificador de `YEAR TO ...`.
  it("o lógico `true` e `false` vira 't' e 'f'; qualquer outro texto numa coluna lógica não vira literal", () => {
    expect(sqlLiteral(informix, "true", "boolean")).toBe("'t'");
    expect(sqlLiteral(informix, "false", "boolean")).toBe("'f'");
    for (const value of ["1", "0", "t", "f", "TRUE", "False", "", " true", "true ", "sim", "tru"]) expect(sqlLiteral(informix, value, "boolean"), JSON.stringify(value)).toBeNull();
  });

  it("a data (`DATE` e `DATETIME YEAR TO DAY`) e a hora (`DATETIME HOUR TO SECOND`) vão entre aspas, como o servidor as lê", () => {
    expect(sqlLiteral(informix, "2024-01-02", "datetime")).toBe("'2024-01-02'");
    expect(sqlLiteral(informix, "0001-01-01", "datetime")).toBe("'0001-01-01'");
    expect(sqlLiteral(informix, "03:04:05", "datetime")).toBe("'03:04:05'");
  });

  it("a data e hora do texto da célula (seis casas de segundo) vira DATETIME (...) YEAR TO FRACTION(5): só zeros saem da fração", () => {
    expect(sqlLiteral(informix, "2024-01-02 03:04:05.000000", "datetime")).toBe("DATETIME (2024-01-02 03:04:05.00000) YEAR TO FRACTION(5)");
    expect(sqlLiteral(informix, "2024-01-02 03:04:05.123000", "datetime")).toBe("DATETIME (2024-01-02 03:04:05.12300) YEAR TO FRACTION(5)");
    expect(sqlLiteral(informix, "2024-01-02 03:04:05.123450", "datetime")).toBe("DATETIME (2024-01-02 03:04:05.12345) YEAR TO FRACTION(5)");
    expect(sqlLiteral(informix, "1999-12-31 23:59:59.100000", "datetime")).toBe("DATETIME (1999-12-31 23:59:59.10000) YEAR TO FRACTION(5)");
  });

  it("menos casas de segundo, ou nenhuma, completam com zeros; mais de cinco só se as que passam são zeros", () => {
    expect(sqlLiteral(informix, "2024-01-02 03:04:05", "datetime")).toBe("DATETIME (2024-01-02 03:04:05.00000) YEAR TO FRACTION(5)");
    expect(sqlLiteral(informix, "2024-01-02 03:04:05.5", "datetime")).toBe("DATETIME (2024-01-02 03:04:05.50000) YEAR TO FRACTION(5)");
    expect(sqlLiteral(informix, "2024-01-02 03:04:05.12345", "datetime")).toBe("DATETIME (2024-01-02 03:04:05.12345) YEAR TO FRACTION(5)");
  });

  it("uma fração que perderia um dígito diferente de zero não vira literal, e o que não é data nem hora também não", () => {
    for (const value of ["2024-01-02 03:04:05.123456", "2024-01-02 03:04:05.000001", "2024-01-02 03:04:05.1234501", "hoje", "", "2024-1-2", "20261011", "2024-01-02T03:04:05", "2024-01-02 03:04", "03:04:05.1230000", "2024-01-02'; DROP TABLE x; --", "2024-01-02 03:04:05.000000)"]) {
      expect(sqlLiteral(informix, value, "datetime"), JSON.stringify(value)).toBeNull();
    }
  });

  it("o PostgreSQL e o Db2 seguem como estavam: o texto entre aspas, qualquer que seja a forma", () => {
    for (const engine of [postgres, db2] as const) {
      expect(sqlLiteral(engine, "true", "boolean")).toBe("'true'");
      expect(sqlLiteral(engine, "false", "boolean")).toBe("'false'");
      expect(sqlLiteral(engine, "2024-01-02 03:04:05.123456", "datetime")).toBe("'2024-01-02 03:04:05.123456'");
      expect(sqlLiteral(engine, "2024-01-02", "datetime")).toBe("'2024-01-02'");
      expect(sqlLiteral(engine, "hoje", "datetime")).toBe("'hoje'");
    }
  });

  it("no Informix o texto, o número e o binário não mudam, e o lógico ou a data e hora com caractere de controle seguem sem literal", () => {
    expect(sqlLiteral(informix, "true", "text")).toBe("'true'");
    expect(sqlLiteral(informix, "2024-01-02 03:04:05.123456", "text")).toBe("'2024-01-02 03:04:05.123456'");
    expect(sqlLiteral(informix, "1", "number")).toBe("1");
    expect(sqlLiteral(informix, "true\n", "boolean")).toBeNull();
    expect(sqlLiteral(informix, "2024-01-02\n", "datetime")).toBeNull();
  });

  it("a condição da chave estrangeira com data e hora é UM comando, com o literal tipado, e a ordem do cabeçalho vai depois dele", () => {
    const where = equalsCondition(informix, "criado_em", "2024-01-02 03:04:05.000000", "datetime");

    expect(where).toBe('"criado_em" = DATETIME (2024-01-02 03:04:05.00000) YEAR TO FRACTION(5)');
    expect(statementCount(recordsSql(informix, "s", "t", where ?? ""), informix)).toBe(1);
    expect(withOrder(where ?? "", { column: "criado_em", direction: "desc" }, informix)).toBe('"criado_em" = DATETIME (2024-01-02 03:04:05.00000) YEAR TO FRACTION(5) ORDER BY "criado_em" DESC');
    expect(equalsCondition(informix, "criado_em", "2024-01-02 03:04:05.123456", "datetime")).toBeNull();
    expect(equalsCondition(informix, "ativo", "true", "boolean")).toBe("\"ativo\" = 't'");
  });
});

describe("equalsCondition: a condição que o clique na chave estrangeira escreve no filtro (RN-TABELA-007)", () => {
  it("a coluna referenciada entre aspas duplas, o sinal de igual e o literal", () => {
    expect(equalsCondition(postgres, "id", "42", "number")).toBe('"id" = 42');
    expect(equalsCondition(postgres, "codigo", "AB-1", "text")).toBe("\"codigo\" = 'AB-1'");
    expect(equalsCondition(informix, "Código", "O'Brien", "text")).toBe("\"Código\" = 'O''Brien'");
  });

  it("o nome da coluna segue a regra única das aspas: a aspa de dentro é dobrada", () => {
    expect(equalsCondition(db2, 'a"b', "1", "number")).toBe('"a""b" = 1');
  });

  it("sem condição quando o valor não cabe no filtro", () => {
    expect(equalsCondition(postgres, "id", "a\nb", "text")).toBeNull();
  });
});
