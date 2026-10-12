import { describe, expect, it } from "vitest";

import { statementCount } from "./sql-statements";
import { conditionOf, nextSort, quoteIdentifier, recordsRunPlan, recordsSql, selectAllSql, withOrder } from "./table-sql";

const postgres = 1;
const db2 = 2;
const informix = 3;
const engines = [postgres, db2, informix] as const;

const NUL = String.fromCharCode(0);

/**
 * Cada nome, e o texto EXATO que ele tem de virar no comando (RN-TABELA-002): sempre entre aspas duplas, com a
 * aspa de dentro dobrada, nos três bancos. Os pares são escritos à mão, e não calculados pela função: um teste que
 * só contasse comandos aceitaria um nome solto no texto (`a--x` sairia como `FROM a--x.pedido`, um comando só, com
 * o resto da linha em comentário). Nomes hostis: aspa, espaço, ponto, `;`, quebra de linha, barra invertida, NUL,
 * vazio, espaços nas pontas, comentários (`--`, `/*`, `{`), aspas parecidas de outro alfabeto e palavras reservadas.
 */
const exact: [name: string, quoted: string][] = [
  ["mes", '"mes"'],
  ["MES", '"MES"'],
  ["MeuEsquema", '"MeuEsquema"'],
  ["função", '"função"'],
  ['a"b', '"a""b"'],
  ['"', '""""'],
  ['""', '""""""'],
  ["a b", '"a b"'],
  [" a ", '" a "'],
  ["  ", '"  "'],
  ["", '""'],
  ["a.b", '"a.b"'],
  ["a;b", '"a;b"'],
  [";", '";"'],
  ["a\nb", '"a\nb"'],
  ["a\r\nb", '"a\r\nb"'],
  ["a\tb", '"a\tb"'],
  ["a\\b", '"a\\b"'],
  ["\\", '"\\"'],
  ["a\\", '"a\\"'],
  ["a'b", `"a'b"`],
  ["a--b", '"a--b"'],
  ["--", '"--"'],
  ["a/*b", '"a/*b"'],
  ["*/", '"*/"'],
  ["a{b", '"a{b"'],
  ["}", '"}"'],
  ['x"; DROP TABLE y; --', '"x""; DROP TABLE y; --"'],
  ["x'; DROP TABLE y; --", `"x'; DROP TABLE y; --"`],
  ["$$a$$", '"$$a$$"'],
  ["select", '"select"'],
  ["order", '"order"'],
  ["insert", '"insert"'],
  ["update", '"update"'],
  ["“x”", '"“x”"'],
  ["＂", '"＂"'],
  ["ʺ", '"ʺ"'],
  ["″", '"″"'],
  ["emoji 🙂", '"emoji 🙂"'],
  [NUL, `"${NUL}"`],
  [`a${NUL}b`, `"a${NUL}b"`],
  ["x".repeat(10_000), `"${"x".repeat(10_000)}"`],
];

/** Um leitor de identificadores entre aspas duplas escrito aqui, independente da função: `""` dentro é uma aspa, uma `"` sozinha fecha. */
function readIdentifier(text: string, from: number): { value: string; next: number } {
  if (text[from] !== '"') throw new Error(`esperava uma aspa em ${from}: ${JSON.stringify(text.slice(from, from + 20))}`);

  let value = "";
  let position = from + 1;
  for (;;) {
    if (position >= text.length) throw new Error("identificador sem fecho");
    if (text[position] === '"') {
      if (text[position + 1] !== '"') return { value, next: position + 1 };
      value += '"';
      position += 2;
    } else {
      value += text[position++];
    }
  }
}

/** O que o comando diz: o esquema e a tabela de um `SELECT * FROM "esquema"."tabela"`, e o resto do texto. */
function readSelect(sql: string): { schema: string; table: string; rest: string } {
  const prefix = "SELECT * FROM ";
  if (!sql.startsWith(prefix)) throw new Error("não começa por SELECT * FROM");

  const schema = readIdentifier(sql, prefix.length);
  if (sql[schema.next] !== ".") throw new Error("faltou o ponto entre o esquema e a tabela");
  const table = readIdentifier(sql, schema.next + 1);
  return { schema: schema.value, table: table.value, rest: sql.slice(table.next) };
}

describe("selectAllSql: o texto exato, nos três bancos (RN-TABELA-002)", () => {
  it.each(engines)("esquema e tabela sempre entre aspas duplas, com a aspa dobrada, exatamente como o catálogo os devolve (banco %s)", (engine) => {
    expect(selectAllSql(engine, "mes", "apontamento")).toBe('SELECT * FROM "mes"."apontamento"');
    expect(selectAllSql(engine, "MES", "APONTAMENTO")).toBe('SELECT * FROM "MES"."APONTAMENTO"');
    expect(selectAllSql(engine, 'es"q', 'ta"b')).toBe('SELECT * FROM "es""q"."ta""b"');
    expect(selectAllSql(engine, "Meu Esquema", "Tabela.Nova ção")).toBe('SELECT * FROM "Meu Esquema"."Tabela.Nova ção"');
  });

  it("o texto é o mesmo nos três bancos: não há regra por banco", () => {
    for (const [name] of exact) {
      expect(selectAllSql(db2, name, name)).toBe(selectAllSql(postgres, name, name));
      expect(selectAllSql(informix, name, name)).toBe(selectAllSql(postgres, name, name));
    }
  });

  it.each(engines)("cada nome hostil vira exatamente o texto esperado, no esquema e na tabela (banco %s)", (engine) => {
    for (const [name, quoted] of exact) {
      expect(selectAllSql(engine, name, "t") === `SELECT * FROM ${quoted}."t"`, `esquema ${JSON.stringify(name.slice(0, 30))}`).toBe(true);
      expect(selectAllSql(engine, "s", name) === `SELECT * FROM "s".${quoted}`, `tabela ${JSON.stringify(name.slice(0, 30))}`).toBe(true);
    }
  });

  it.each(engines)("e continua um comando só: nenhum nome o separa nem o corta com comentário (banco %s)", (engine) => {
    for (const [name] of exact) {
      expect(statementCount(selectAllSql(engine, name, name), engine), JSON.stringify(name.slice(0, 30))).toBe(1);
    }
  });

  it.each(engines)("a ida e volta por um leitor de identificadores devolve os dois nomes de partida, e não sobra nada depois (banco %s)", (engine) => {
    for (const [name] of exact) {
      const read = readSelect(selectAllSql(engine, name, `${name}!`));

      expect(read.schema === name, `esquema ${JSON.stringify(name.slice(0, 30))}`).toBe(true);
      expect(read.table === `${name}!`, `tabela ${JSON.stringify(name.slice(0, 30))}`).toBe(true);
      expect(read.rest).toBe("");
    }
  });

  it("a ida e volta vale também para nomes sorteados (semente fixa), de qualquer caractere", () => {
    let seed = 20_261_011;
    const next = () => (seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
    const alphabet = ['"', "'", "\\", ";", "-", "/", "*", "{", "}", " ", "\n", "\r", ".", "a", "Z", "ç", "“", "”", NUL, "$"];

    for (let round = 0; round < 500; round++) {
      const make = () => Array.from({ length: Math.floor(next() * 12) }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
      const [schema, table] = [make(), make()];
      const sql = selectAllSql(informix, schema, table);
      const read = readSelect(sql);

      expect(read.schema === schema && read.table === table && read.rest === "", JSON.stringify([schema, table])).toBe(true);
      expect(statementCount(sql, informix)).toBe(1);
    }
  });
});

describe("quoteIdentifier: o nome de uma coluna no texto do comando", () => {
  it("entre aspas, com a aspa dobrada, e só isso", () => {
    expect(quoteIdentifier("refugo")).toBe('"refugo"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
    expect(quoteIdentifier("Meu Nome")).toBe('"Meu Nome"');
  });
});

describe("recordsSql: o comando dos registros com o texto do filtro (RN-TABELA-005 e 010)", () => {
  it.each(engines)("sem filtro nem ordem é o `selectAllSql`, no banco %s", (engine) => {
    expect(recordsSql(engine, "mes", "apontamento", "")).toBe(selectAllSql(engine, "mes", "apontamento"));
  });

  it("a condição entra depois do `WHERE`, numa linha só dela, como o usuário escreveu", () => {
    expect(recordsSql(postgres, "mes", "apontamento", "refugo > 0 AND maquina_id = 4")).toBe('SELECT * FROM "mes"."apontamento"\nWHERE refugo > 0 AND maquina_id = 4');
  });

  it("a ordem que o cabeçalho escreve vai depois da tabela, com a coluna entre aspas, nos três bancos", () => {
    for (const engine of engines) {
      expect(recordsSql(engine, "mes", "apontamento", withOrder("", { column: "registrado em", direction: "desc" }, engine))).toBe('SELECT * FROM "mes"."apontamento"\nORDER BY "registrado em" DESC');
      expect(recordsSql(engine, "dono", "t", withOrder("", { column: "refugo", direction: "asc" }, engine))).toBe('SELECT * FROM "dono"."t"\nORDER BY "refugo" ASC');
    }
  });

  it("condição e ordem juntas: o texto do campo, inteiro, depois do `WHERE`", () => {
    expect(recordsSql(db2, "MES", "T", withOrder("ID = 1", { column: "ID", direction: "asc" }, db2))).toBe('SELECT * FROM "MES"."T"\nWHERE ID = 1 ORDER BY "ID" ASC');
  });

  it("espaço nas pontas do filtro sai; filtro só de espaço (ou de quebra de linha) não é filtro", () => {
    expect(recordsSql(postgres, "s", "t", "  a = 1  \n")).toBe('SELECT * FROM "s"."t"\nWHERE a = 1');
    expect(recordsSql(postgres, "s", "t", " \n\t ")).toBe('SELECT * FROM "s"."t"');
  });

  it("um filtro que termina em comentário `--` não engole a ordem do cabeçalho: ela entra antes do comentário", () => {
    const sql = recordsSql(postgres, "s", "t", withOrder("a = 1 -- só os ativos", { column: "a", direction: "asc" }, postgres));

    expect(sql.split("\n")).toEqual(['SELECT * FROM "s"."t"', 'WHERE a = 1 ORDER BY "a" ASC -- só os ativos']);
  });

  it("o nome da coluna da ordem é hostil e vira exatamente o texto esperado, num comando só", () => {
    for (const [column, quoted] of exact) {
      for (const engine of engines) {
        const sql = recordsSql(engine, "s", "t", withOrder("", { column, direction: "asc" }, engine));

        expect(sql === `SELECT * FROM "s"."t"\nORDER BY ${quoted} ASC`, `${engine} ${JSON.stringify(column.slice(0, 30))}`).toBe(true);
        expect(statementCount(sql, engine), `${engine} ${JSON.stringify(column.slice(0, 30))}`).toBe(1);
      }
    }
  });
});

describe("conditionOf e recordsSql: o `;` do fim do filtro não vai no comando (RN-TABELA-005)", () => {
  it("tira os `;` e os espaços do FIM, e só do fim", () => {
    expect(conditionOf("ativo = 1;")).toBe("ativo = 1");
    expect(conditionOf("  ativo = 1 ;  ; \n")).toBe("ativo = 1");
    expect(conditionOf(";")).toBe("");
    expect(conditionOf(" ; ;")).toBe("");
    expect(conditionOf("a = 1; b = 2")).toBe("a = 1; b = 2");
    expect(conditionOf("a = ';'")).toBe("a = ';'");
    expect(conditionOf(";a = 1")).toBe(";a = 1");
    expect(conditionOf('ORDER BY "c" ASC ; ')).toBe('ORDER BY "c" ASC');
  });

  it("com ordem, o `;` final não faz dois comandos nos três bancos: o texto não leva o `;`", () => {
    for (const engine of engines) {
      const sql = recordsSql(engine, "s", "t", withOrder("ativo = 1;", { column: "c", direction: "asc" }, engine));

      expect(sql, `${engine}`).toBe('SELECT * FROM "s"."t"\nWHERE ativo = 1 ORDER BY "c" ASC');
      expect(statementCount(sql, engine), `${engine}`).toBe(1);
    }
  });

  it("sem ordem também sai sem o `;`, e um filtro que era só `;` não é filtro", () => {
    expect(recordsSql(postgres, "s", "t", "ativo = 1 ; ")).toBe('SELECT * FROM "s"."t"\nWHERE ativo = 1');
    expect(recordsSql(postgres, "s", "t", " ; ")).toBe('SELECT * FROM "s"."t"');
  });

  it("um `;` no MEIO continua sendo dois comandos: o texto o mantém, e a conferência o recusa", () => {
    for (const engine of engines) {
      const sql = recordsSql(engine, "s", "t", 'a = 1; b = 2 ORDER BY "c" ASC');

      expect(sql, `${engine}`).toContain("WHERE a = 1; b = 2 ");
      expect(statementCount(sql, engine), `${engine}`).toBe(2);
      expect(recordsRunPlan(engine, "s", "t", "a = 1; b = 2", false), `${engine}`).toEqual({ kind: "several" });
    }
  });
});

describe("recordsRunPlan: o que 'aplicar' e o clique no cabeçalho fazem com o filtro pedido (RN-TABELA-005 e 010)", () => {
  const sort = { column: "c", direction: "asc" } as const;
  const kindOf = (engine: 1 | 2 | 3, filter: string) => recordsRunPlan(engine, "s", "t", filter, false).kind;

  it("um comando só, a aba livre: envia, e o filtro que passa a valer é o texto sem o espaço das pontas e sem o `;` do fim, como vai no comando", () => {
    expect(recordsRunPlan(postgres, "s", "t", '  ativo = 1 ORDER BY "c" ASC ; ', false)).toEqual({ kind: "send", filter: 'ativo = 1 ORDER BY "c" ASC', sql: 'SELECT * FROM "s"."t"\nWHERE ativo = 1 ORDER BY "c" ASC' });
    expect(recordsRunPlan(informix, "s", "t", "", false)).toEqual({ kind: "send", filter: "", sql: 'SELECT * FROM "s"."t"' });
  });

  it("a aba ocupada: o executor recusaria, e nada muda", () => {
    expect(recordsRunPlan(postgres, "s", "t", "a = 1", true)).toEqual({ kind: "busy" });
  });

  it("um comando só: `;` dentro de texto entre aspas, de nome entre aspas ou de comentário não conta, e o `;` final é só o fim do comando", () => {
    for (const filter of ["refugo > 0 AND maquina_id = 4", "", "nome = 'a;b'", 'nome = "x;y"', "a = 1 -- tchau; até", "a = 1 /* x; y */", "a = 1;", "ativo = 1 ;  ;", "ativo = 1 -- nota;"]) expect(kindOf(postgres, filter), filter).toBe("send");
  });

  it("o comando que não vai: mais de um deles. Nada é aplicado (a tela não mostra um filtro nem uma ordem que não foram enviados)", () => {
    for (const engine of engines) {
      expect(kindOf(engine, "a = 1; DROP TABLE x"), `${engine}`).toBe("several");
      expect(kindOf(engine, "a = 1; delete from t"), `${engine}`).toBe("several");
      expect(kindOf(engine, 'a = 1; b = 2 ORDER BY "c" ASC'), `${engine}`).toBe("several");
      expect(kindOf(engine, "ORDER BY c; delete from t"), `${engine}`).toBe("several");
    }
  });

  it("o `;` seguido só de comentário é um comando só, e continua sendo depois do clique no cabeçalho: a ordem entra antes do `;`", () => {
    for (const engine of engines) {
      for (const filter of ["ativo = 1; -- nota", "ativo = 1; /* nota */"]) {
        expect(kindOf(engine, filter), `${engine} ${filter}`).toBe("send");
        expect(kindOf(engine, withOrder(filter, sort, engine)), `${engine} ${filter} com ordem`).toBe("send");
      }
    }
  });
});

describe("nextSort: clicar no cabeçalho (RN-TABELA-005)", () => {
  it("sem ordem, crescente; crescente, decrescente; decrescente, sem ordem", () => {
    const asc = nextSort(null, "refugo");
    const desc = nextSort(asc, "refugo");

    expect(asc).toEqual({ column: "refugo", direction: "asc" });
    expect(desc).toEqual({ column: "refugo", direction: "desc" });
    expect(nextSort(desc, "refugo")).toBeNull();
  });

  it("clicar em outra coluna começa crescente nela", () => {
    expect(nextSort({ column: "refugo", direction: "desc" }, "quantidade")).toEqual({ column: "quantidade", direction: "asc" });
  });
});
