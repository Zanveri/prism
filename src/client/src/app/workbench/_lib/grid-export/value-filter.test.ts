import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import type { QueryColumn } from "../query.schema";
import { isInsideComment, statementCount } from "../sql-statements";
import { equalsCondition } from "../table-sql";
import { chars, column, hostile, hostileValues, randomText, seededRandom } from "./test-fixtures";
import { likeEscape, likePattern, mergeCondition, valueFilterOptions, type ValueFilterId, type ValueFilterOption } from "./value-filter";

const engines: Engine[] = [1, 2, 3];
const ids: ValueFilterId[] = ["eq", "ne", "gt", "lt", "like", "isNull", "isNotNull"];
const optionsOf = (value: string | null, col: QueryColumn = column("nome"), truncated = false, engine: Engine = 1) => valueFilterOptions(engine, col, value, truncated);
const conditionsOf = (options: ValueFilterOption[]) => Object.fromEntries(options.map((option) => [option.id, option.condition]));

describe("valueFilterOptions: as opções da RN-GRADE-005 para uma célula", () => {
  it("são sempre as mesmas sete, na mesma ordem, para a tela desabilitar as que não se aplicam em vez de fazê-las sumir", () => {
    for (const options of [optionsOf("x"), optionsOf(null), optionsOf("x", column("n", "number")), optionsOf("x", column("b", "binary")), optionsOf("x", column("t"), true)]) expect(options.map((option) => option.id)).toEqual(ids);
  });

  it("célula de texto: igual, diferente, maior, menor, contém e os dois de nulo; nome entre aspas e valor como literal do banco", () => {
    expect(conditionsOf(optionsOf("Extrusão A"))).toEqual({
      eq: `"nome" = 'Extrusão A'`,
      ne: `"nome" <> 'Extrusão A'`,
      gt: `"nome" > 'Extrusão A'`,
      lt: `"nome" < 'Extrusão A'`,
      like: `"nome" LIKE '%Extrusão A%' ESCAPE '!'`,
      isNull: `"nome" IS NULL`,
      isNotNull: `"nome" IS NOT NULL`,
    });
  });

  it("os rótulos são a condição como ela entra no campo (RN-GRADE-010 do Filtrar): o nome entre aspas e o literal do banco", () => {
    expect(optionsOf("Extrusão A").map((option) => option.label)).toEqual([`"nome" = 'Extrusão A'`, `"nome" <> 'Extrusão A'`, `"nome" > 'Extrusão A'`, `"nome" < 'Extrusão A'`, `"nome" LIKE '%Extrusão A%'`, `"nome" IS NULL`, `"nome" IS NOT NULL`]);
    expect(optionsOf("42", column("qtd", "number")).map((option) => option.label).slice(0, 4)).toEqual([`"qtd" = 42`, `"qtd" <> 42`, `"qtd" > 42`, `"qtd" < 42`]);
    // Fora o `ESCAPE '!'` do `contém`, o rótulo é a condição inteira.
    for (const option of optionsOf("11.901")) expect(option.condition?.replace(` ESCAPE '!'`, ""), option.id).toBe(option.label);
  });

  it("célula numérica: o número vai sem aspas, e `contém` não se aplica", () => {
    expect(conditionsOf(optionsOf("42", column("qtd", "number")))).toEqual({
      eq: `"qtd" = 42`,
      ne: `"qtd" <> 42`,
      gt: `"qtd" > 42`,
      lt: `"qtd" < 42`,
      like: null,
      isNull: `"qtd" IS NULL`,
      isNotNull: `"qtd" IS NOT NULL`,
    });
  });

  it("`contém` só em coluna de texto: data, booleano e número não o têm", () => {
    for (const kind of ["datetime", "boolean", "number"] as const) expect(conditionsOf(optionsOf("1", column("c", kind))).like, kind).toBeNull();
    expect(conditionsOf(optionsOf("1", column("c", "text"))).like).not.toBeNull();
  });

  it("`contém` com valor vazio não se aplica (casaria tudo); `igual` a vazio continua", () => {
    const conditions = conditionsOf(optionsOf(""));

    expect(conditions.like).toBeNull();
    expect(conditions.eq).toBe(`"nome" = ''`);
  });

  it("célula nula: só as de nulo; as outras mostram o operador com o lugar do valor, e dizem por quê", () => {
    const options = optionsOf(null);

    expect(conditionsOf(options)).toEqual({ eq: null, ne: null, gt: null, lt: null, like: null, isNull: `"nome" IS NULL`, isNotNull: `"nome" IS NOT NULL` });
    expect(options.map((option) => option.label)).toEqual([`"nome" = (valor da célula)`, `"nome" <> (valor da célula)`, `"nome" > (valor da célula)`, `"nome" < (valor da célula)`, `"nome" LIKE (valor da célula)`, `"nome" IS NULL`, `"nome" IS NOT NULL`]);
    expect(options.map((option) => option.reason)).toEqual(["a célula é nula", "a célula é nula", "a célula é nula", "a célula é nula", "a célula é nula", null, null]);
  });

  it("cada opção que não se aplica diz o motivo, e a que se aplica não tem motivo", () => {
    const reasonOf = (value: string | null, col: QueryColumn = column("nome"), truncated = false, engine: Engine = 1) => Object.fromEntries(valueFilterOptions(engine, col, value, truncated).map((option) => [option.id, option.reason]));

    expect(reasonOf("x")).toEqual({ eq: null, ne: null, gt: null, lt: null, like: null, isNull: null, isNotNull: null });
    expect(reasonOf("x", column("nome"), true).eq).toBe("o valor chegou cortado, e a tela não o tem inteiro");
    expect(reasonOf("0x00", column("foto", "binary")).eq).toBe("a coluna é binária");
    expect(reasonOf(hostile.lf).eq).toBe("o valor tem quebra de linha, tabulação ou outro caractere de controle");
    expect(reasonOf("sim", column("ativo", "boolean"), false, 3).eq).toBe("o Informix não aceita este valor como literal");
    expect(reasonOf("true", column("ativo", "boolean"), false, 3)).toMatchObject({ eq: null, gt: "o Informix não ordena valores lógicos", lt: "o Informix não ordena valores lógicos" });
    expect(reasonOf("").like).toBe("o valor é vazio, e “contém” casaria tudo");
    expect(reasonOf("1", column("n", "number")).like).toBe("só vale em coluna de texto");
    for (const options of [optionsOf(null), optionsOf("x", column("t"), true), optionsOf(hostile.tab)]) for (const option of options) expect(option.condition === null, option.id).toBe(option.reason !== null);
  });

  it("célula cortada (RN-SQL-011): só as de nulo, porque o valor que a tela tem não é o que o banco guarda", () => {
    const options = optionsOf("começo do texto que foi cortado…", column("nome"), true);

    expect(conditionsOf(options)).toEqual({ eq: null, ne: null, gt: null, lt: null, like: null, isNull: `"nome" IS NULL`, isNotNull: `"nome" IS NOT NULL` });
    expect(options[0].label).toBe(`"nome" = (valor da célula)`);
  });

  it("coluna binária: só as de nulo", () => {
    expect(conditionsOf(optionsOf("0x00ff", column("foto", "binary")))).toEqual({ eq: null, ne: null, gt: null, lt: null, like: null, isNull: `"foto" IS NULL`, isNotNull: `"foto" IS NOT NULL` });
  });

  it("valor que não cabe num literal (quebra de linha, tabulação, controle): as comparações ficam desabilitadas, as de nulo não", () => {
    for (const value of [hostile.lf, hostile.crlf, hostile.tab, hostile.controls]) {
      const conditions = conditionsOf(optionsOf(value));
      expect(conditions, JSON.stringify(value)).toEqual({ eq: null, ne: null, gt: null, lt: null, like: null, isNull: `"nome" IS NULL`, isNotNull: `"nome" IS NOT NULL` });
    }
  });

  it("a barra invertida (RN-TABELA-007): o PostgreSQL a dobra num E'...'; o Db2 e o Informix a levam como está, e as comparações ficam habilitadas", () => {
    expect(conditionsOf(optionsOf("a\\b", column("nome"), false, 1)).eq).toBe(`"nome" = E'a\\\\b'`);
    expect(conditionsOf(optionsOf("a\\b", column("nome"), false, 2)).eq).toBe(`"nome" = 'a\\b'`);
    expect(conditionsOf(optionsOf("a\\b", column("nome"), false, 3)).eq).toBe(`"nome" = 'a\\b'`);
    expect(conditionsOf(optionsOf("a\\b", column("nome"), false, 2))).toMatchObject({ ne: `"nome" <> 'a\\b'`, isNull: `"nome" IS NULL` });
  });

  it("a condição de `igual` é a mesma que o clique na chave estrangeira escreve (equalsCondition)", () => {
    for (const engine of engines) {
      for (const value of ["abc", "O'Brien", "007", "a\\b", hostile.lf, "12.5"]) {
        for (const kind of ["text", "number"] as const) expect(conditionsOf(optionsOf(value, column("c", kind), false, engine)).eq, `${engine} ${kind} ${JSON.stringify(value)}`).toBe(equalsCondition(engine, "c", value, kind));
      }
    }
  });

  it("nome de coluna hostil vai entre aspas, com a aspa de dentro dobrada", () => {
    expect(conditionsOf(optionsOf("1", column('a"b; --'))).eq).toBe(`"a""b; --" = '1'`);
    expect(conditionsOf(optionsOf(null, column("n\nl"))).isNull).toBe(`"n\nl" IS NULL`);
  });
});

describe("valueFilterOptions: o rótulo encurta o nome e o literal sem quebrar o menu", () => {
  const labelOf = (value: string, kind: QueryColumn["kind"] = "text", name = "c") => optionsOf(value, column(name, kind))[0].label;

  it("um literal comprido é cortado com reticências (30 caracteres), por caractere e não por unidade UTF-16; a condição vai inteira", () => {
    expect(labelOf("x".repeat(100))).toBe(`"c" = '${"x".repeat(28)}…`);
    expect(labelOf("x".repeat(28))).toBe(`"c" = '${"x".repeat(28)}'`);
    expect(optionsOf("x".repeat(100), column("c"))[0].condition).toBe(`"c" = '${"x".repeat(100)}'`);
    // Cada emoji ocupa dois `char`: cortar no meio de um daria um par solto.
    const label = labelOf("🙂".repeat(40));
    expect(label).toBe(`"c" = '${"🙂".repeat(28)}…`);
    expect([...label].every((char) => !/[\ud800-\udfff]/.test(char) || char.length === 2)).toBe(true);
  });

  it("o nome comprido também é cortado, e o operador fica à vista", () => {
    expect(labelOf("1", "number", "n".repeat(60))).toBe(`"${"n".repeat(28)}… = 1`);
  });

  it("as marcas de direção de texto (U+202E) e os caracteres invisíveis não chegam ao rótulo; a condição os leva", () => {
    expect(labelOf(`fatura${chars(0x202e)}vsc.exe`)).toBe(`"c" = 'fatura vsc.exe'`);
    expect(labelOf(`a${chars(0x200b, 0xfeff, 0x2066)}b`)).toBe(`"c" = 'a b'`);
    expect(optionsOf(`a${chars(0x200b)}b`, column("c"))[0].condition).toBe(`"c" = 'a${chars(0x200b)}b'`);
  });

  it("o número aparece sem aspas", () => {
    expect(labelOf("12.5", "number")).toBe(`"c" = 12.5`);
  });
});

describe("`contém`: os curingas do próprio valor (% e _) valem como texto nos três bancos (ESCAPE '!')", () => {
  /** O LIKE do padrão SQL, por ponto de código: `%` é qualquer sequência, `_` é um caractere, e o escape torna literal o caractere seguinte. */
  function likeMatches(pattern: string, text: string): boolean {
    const p = Array.from(pattern);
    const t = Array.from(text);
    const match = (pi: number, ti: number): boolean => {
      if (pi === p.length) return ti === t.length;
      if (p[pi] === likeEscape && pi + 1 < p.length) return ti < t.length && t[ti] === p[pi + 1] && match(pi + 2, ti + 1);
      if (p[pi] === "%") {
        for (let k = ti; k <= t.length; k++) if (match(pi + 1, k)) return true;
        return false;
      }
      if (p[pi] === "_") return ti < t.length && match(pi + 1, ti + 1);
      return ti < t.length && t[ti] === p[pi] && match(pi + 1, ti + 1);
    };
    return match(0, 0);
  }

  it("o escape é `!`, que não tem papel nenhum nas literais de texto dos três bancos (a barra invertida teria)", () => {
    expect(likeEscape).toBe("!");
  });

  it("`%`, `_` e o próprio escape ganham o escape; o resto do texto fica", () => {
    expect(likePattern("abc")).toBe("%abc%");
    expect(likePattern("100%")).toBe("%100!%%");
    expect(likePattern("a_b")).toBe("%a!_b%");
    expect(likePattern("oi!")).toBe("%oi!!%");
    expect(likePattern("%_!")).toBe("%!%!_!!%");
    expect(likePattern("")).toBe("%%");
  });

  it("o padrão casa exatamente os textos que CONTÊM o valor, qualquer que seja o valor (sorteio de semente fixa, com %, _, ! e emoji)", () => {
    const random = seededRandom(2026);
    const alphabet = ["a", "b", "%", "_", "!", "🙂", "'", "\\", " "];
    const word = (max: number) => Array.from({ length: Math.floor(random() * (max + 1)) }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
    let hits = 0;

    for (let round = 0; round < 3000; round++) {
      const value = word(4);
      const text = random() < 0.5 ? `${word(3)}${value}${word(3)}` : word(7);
      const expected = text.includes(value);

      expect(likeMatches(likePattern(value), text), `${JSON.stringify(value)} em ${JSON.stringify(text)}`).toBe(expected);
      if (expected) hits++;
    }
    expect(hits).toBeGreaterThan(500);
  });

  it("o curinga do valor não casa o que não está lá: `100%` não acha `1000`, e `a_b` não acha `axb`", () => {
    expect(likeMatches(likePattern("100%"), "x1000y")).toBe(false);
    expect(likeMatches(likePattern("100%"), "x100%y")).toBe(true);
    expect(likeMatches(likePattern("a_b"), "axb")).toBe(false);
    expect(likeMatches(likePattern("a_b"), "a_b")).toBe(true);
  });

  it("a condição leva a cláusula ESCAPE e o padrão como literal do banco (aspa dobrada; barra invertida como no `igual`)", () => {
    expect(conditionsOf(optionsOf("50%_!", column("c"))).like).toBe(`"c" LIKE '%50!%!_!!%' ESCAPE '!'`);
    expect(conditionsOf(optionsOf("O'Brien", column("c"))).like).toBe(`"c" LIKE '%O''Brien%' ESCAPE '!'`);
    expect(conditionsOf(optionsOf("a\\b", column("c"), false, 1)).like).toBe(`"c" LIKE E'%a\\\\b%' ESCAPE '!'`);
    expect(conditionsOf(optionsOf("a\\b", column("c"), false, 2)).like).toBe(`"c" LIKE '%a\\b%' ESCAPE '!'`);
    expect(conditionsOf(optionsOf("a\\b", column("c"), false, 3)).like).toBe(`"c" LIKE '%a\\b%' ESCAPE '!'`);
  });
});

describe("valueFilterOptions: nenhuma condição vira mais de um comando, nos três bancos", () => {
  const kinds: QueryColumn["kind"][] = ["text", "number", "datetime", "boolean"];

  it("cada condição, com valor e nome hostis, é UMA condição de um comando só", () => {
    for (const engine of engines) {
      for (const value of [...hostileValues, "'; DROP TABLE x; --", "-- ", "/*", "*/", "{", "$$", "$a$", "E'\\'"]) {
        for (const kind of kinds) {
          for (const option of optionsOf(value, column('n"; DROP TABLE y; --', kind), false, engine)) {
            if (option.condition === null) continue;
            expect(statementCount(`SELECT * FROM t WHERE ${option.condition}`, engine), `${engine} ${kind} ${option.id} ${JSON.stringify(value)}`).toBe(1);
          }
        }
      }
    }
  });

  it("sorteio de semente fixa: 1.500 valores por banco", () => {
    for (const engine of engines) {
      const random = seededRandom(7 + engine);
      let produced = 0;

      for (let round = 0; round < 1500; round++) {
        for (const option of optionsOf(randomText(random), column(randomText(random), random() < 0.3 ? "number" : "text"), false, engine)) {
          if (option.condition === null) continue;
          produced++;
          expect(statementCount(`SELECT * FROM t WHERE ${option.condition}`, engine), `${engine} ${option.condition}`).toBe(1);
        }
      }
      expect(produced).toBeGreaterThan(3000);
    }
  });
});

describe("mergeCondition: junta a condição nova ao que já está no campo", () => {
  it("campo vazio, só de espaços ou só de `;` vira só a condição nova", () => {
    expect(mergeCondition("", `"a" = 1`)).toBe(`"a" = 1`);
    expect(mergeCondition("   ", `"a" = 1`)).toBe(`"a" = 1`);
    expect(mergeCondition("\n\t  \r\n", `"a" = 1`)).toBe(`"a" = 1`);
    expect(mergeCondition(" ; ;  ", `"a" = 1`)).toBe(`"a" = 1`);
  });

  it("com condição no campo: `(existente) AND (nova)`", () => {
    expect(mergeCondition(`"a" = 1`, `"b" = 2`)).toBe(`("a" = 1) AND ("b" = 2)`);
    expect(mergeCondition(`a = 1 OR a = 2`, `b IS NULL`)).toBe(`(a = 1 OR a = 2) AND (b IS NULL)`);
  });

  it("tira o espaço das pontas e o `;` do fim de cada lado (o `;` do fim é só o fim do comando que a pessoa escreveu)", () => {
    expect(mergeCondition("  a = 1 ;  ", " b = 2; ")).toBe("(a = 1) AND (b = 2)");
    expect(mergeCondition("a = 1;;", "b = 2")).toBe("(a = 1) AND (b = 2)");
  });

  it("de novo sobre o resultado: os parênteses se acumulam e a ordem das condições fica", () => {
    expect(mergeCondition(mergeCondition("a", "b"), "c")).toBe("((a) AND (b)) AND (c)");
  });

  it("sem condição nova, o campo fica como estava (aparado)", () => {
    expect(mergeCondition(" a = 1 ", "  ")).toBe("a = 1");
    expect(mergeCondition("", "")).toBe("");
  });

  it("o comentário `--` no fim do que está no campo não engole a condição nova: a quebra de linha o encerra antes do parêntese", () => {
    const merged = mergeCondition("a = 1 -- só ativos", "b = 2");

    expect(merged).toBe("(a = 1 -- só ativos\n) AND (b = 2)");
    expect(isInsideComment(merged, merged.indexOf("AND"))).toBe(false);
    for (const engine of engines) expect(statementCount(`SELECT * FROM t WHERE ${merged}`, engine)).toBe(1);
  });

  it("`--` dentro de texto entre aspas não é comentário: nenhuma quebra de linha no meio", () => {
    expect(mergeCondition("a = '--'", "b = 2")).toBe("(a = '--') AND (b = 2)");
    expect(mergeCondition('a = "x--y"', "b = 2")).toBe('(a = "x--y") AND (b = 2)');
  });

  it("a condição composta com a de uma célula continua sendo um comando só", () => {
    const added = conditionsOf(optionsOf("O'Brien; DROP TABLE t; --", column("nome"))).eq ?? "";

    for (const engine of engines) {
      expect(statementCount(`SELECT * FROM t WHERE ${mergeCondition("x > 1", added)}`, engine)).toBe(1);
      expect(statementCount(`SELECT * FROM t WHERE ${mergeCondition("", added)}`, engine)).toBe(1);
    }
  });
});

describe("valueFilterOptions: o lógico e a data e hora no Informix usam o literal que o servidor aceita (Tarefa 33a, rodada 1)", () => {
  const stamp = "2024-01-02 03:04:05.123450";

  it("data e hora: igual, diferente, maior e menor levam DATETIME (...) YEAR TO FRACTION(5); contém não se aplica a data", () => {
    const conditions = conditionsOf(optionsOf(stamp, column("criado_em", "datetime"), false, 3));
    const literal = "DATETIME (2024-01-02 03:04:05.12345) YEAR TO FRACTION(5)";

    expect(conditions).toEqual({
      eq: `"criado_em" = ${literal}`,
      ne: `"criado_em" <> ${literal}`,
      gt: `"criado_em" > ${literal}`,
      lt: `"criado_em" < ${literal}`,
      like: null,
      isNull: `"criado_em" IS NULL`,
      isNotNull: `"criado_em" IS NOT NULL`,
    });
  });

  it("uma fração que perderia um dígito, ou um texto que não é data nem hora: as quatro comparações ficam desabilitadas e as de nulo valem", () => {
    for (const value of ["2024-01-02 03:04:05.123456", "hoje"]) {
      const conditions = conditionsOf(optionsOf(value, column("criado_em", "datetime"), false, 3));

      expect([conditions.eq, conditions.ne, conditions.gt, conditions.lt]).toEqual([null, null, null, null]);
      expect(conditions.isNull).toBe(`"criado_em" IS NULL`);
    }
  });

  it("a data e a hora sozinhas, e o lógico, no Informix", () => {
    expect(conditionsOf(optionsOf("2024-01-02", column("dia", "datetime"), false, 3)).eq).toBe(`"dia" = '2024-01-02'`);
    expect(conditionsOf(optionsOf("03:04:05", column("hora", "datetime"), false, 3)).eq).toBe(`"hora" = '03:04:05'`);
    expect(conditionsOf(optionsOf("true", column("ativo", "boolean"), false, 3)).eq).toBe(`"ativo" = 't'`);
    expect(conditionsOf(optionsOf("false", column("ativo", "boolean"), false, 3)).ne).toBe(`"ativo" <> 'f'`);
    expect(conditionsOf(optionsOf("sim", column("ativo", "boolean"), false, 3)).eq).toBeNull();
  });

  it("o Informix não ordena o lógico (-674, `Routine (greaterthan) can not be resolved`): maior e menor ficam desabilitados, e igual, diferente e os de nulo valem", () => {
    const conditions = conditionsOf(optionsOf("true", column("ativo", "boolean"), false, 3));

    expect([conditions.gt, conditions.lt]).toEqual([null, null]);
    expect([conditions.eq, conditions.ne, conditions.isNull, conditions.isNotNull]).toEqual([`"ativo" = 't'`, `"ativo" <> 't'`, `"ativo" IS NULL`, `"ativo" IS NOT NULL`]);
    for (const engine of [1, 2] as const) expect(conditionsOf(optionsOf("true", column("ativo", "boolean"), false, engine)).gt).toBe(`"ativo" > 'true'`);
    expect(conditionsOf(optionsOf("1", column("n", "number"), false, 3)).gt).toBe(`"n" > 1`);
  });

  it("o PostgreSQL e o Db2 não mudam: o texto da célula entre aspas", () => {
    for (const engine of [1, 2] as const) {
      expect(conditionsOf(optionsOf(stamp, column("criado_em", "datetime"), false, engine)).eq).toBe(`"criado_em" = '${stamp}'`);
      expect(conditionsOf(optionsOf("true", column("ativo", "boolean"), false, engine)).eq).toBe(`"ativo" = 'true'`);
    }
  });

  it("cada condição é um comando só, nos três bancos, e com a ordem do cabeçalho depois", () => {
    for (const engine of engines) {
      for (const option of optionsOf(stamp, column("criado_em", "datetime"), false, engine)) {
        if (option.condition === null) continue;
        expect(statementCount(`SELECT * FROM "s"."t" WHERE ${option.condition} ORDER BY "criado_em" DESC`, engine), `${engine} ${option.id}`).toBe(1);
      }
    }
  });
});
