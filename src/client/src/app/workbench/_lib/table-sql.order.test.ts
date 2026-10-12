import { describe, expect, it } from "vitest";

import { statementCount } from "./sql-statements";
import { conditionOf, orderOf, recordsSql, sortOf, withOrder, type RecordsSort } from "./table-sql";

const postgres = 1;
const db2 = 2;
const informix = 3;
const engines = [postgres, db2, informix] as const;

/** As colunas do resultado: é nelas que a seta do cabeçalho acende. */
const columns = [{ name: "id" }, { name: "nome" }, { name: "is_active" }, { name: "Criado Em" }, { name: 'a"b' }];

describe("orderOf: a ordem DE FORA do texto do filtro (RN-TABELA-010)", () => {
  it.each(engines)("texto só com ordem, e condição seguida de ordem: do ORDER BY até o fim do código (banco %s)", (engine) => {
    expect(orderOf("ORDER BY nome", engine)).toBe("ORDER BY nome");
    expect(orderOf("  order by nome desc  ", engine)).toBe("order by nome desc");
    expect(orderOf("ativo = 1 ORDER BY nome, id DESC", engine)).toBe("ORDER BY nome, id DESC");
    expect(orderOf('ativo = 1 ORDER BY "nome" ASC, "id" DESC', engine)).toBe('ORDER BY "nome" ASC, "id" DESC');
  });

  it.each(engines)("sem ordem, nada; `order` sem `by`, ou dentro de outra palavra, não é ordem (banco %s)", (engine) => {
    for (const text of ["", "   ", "ativo = 1", "order_id = 3", "reorder = 1 AND border = 2", '"order" = 1', "x = 1 order", "by = 1", "ordering by_x = 1"]) expect(orderOf(text, engine), text).toBe("");
  });

  it.each(engines)("maiúsculas e minúsculas, e qualquer espaço entre ORDER e BY: quebra de linha, tabulação, comentário (banco %s)", (engine) => {
    expect(orderOf("a = 1 Order By nome", engine)).toBe("Order By nome");
    expect(orderOf("a = 1 oRdEr bY nome", engine)).toBe("oRdEr bY nome");
    expect(orderOf("a = 1 ORDER\nBY nome", engine)).toBe("ORDER\nBY nome");
    expect(orderOf("a = 1 ORDER\r\n\t  BY nome", engine)).toBe("ORDER\r\n\t  BY nome");
    expect(orderOf("a = 1 ORDER /* por */ BY nome", engine)).toBe("ORDER /* por */ BY nome");
    expect(orderOf("a = 1 ORDER -- por\nBY nome", engine)).toBe("ORDER -- por\nBY nome");
  });

  it.each(engines)("o `order by` de dentro de texto entre aspas simples e de identificador entre aspas duplas não é a ordem (banco %s)", (engine) => {
    expect(orderOf("obs = 'order by nome'", engine)).toBe("");
    expect(orderOf("obs = 'it''s order by nome'", engine)).toBe("");
    expect(orderOf('"order by" = 1', engine)).toBe("");
    expect(orderOf('"a"" order by x" = 1', engine)).toBe("");
    // O de fora, depois deles, é.
    expect(orderOf("obs = 'order by nome' ORDER BY id", engine)).toBe("ORDER BY id");
    expect(orderOf('"order by" = 1 order by "order by"', engine)).toBe('order by "order by"');
  });

  it.each(engines)("o de dentro de comentário de linha e de bloco não é a ordem (banco %s)", (engine) => {
    expect(orderOf("a = 1 -- order by nome", engine)).toBe("");
    expect(orderOf("a = 1 /* order by nome */", engine)).toBe("");
    expect(orderOf("a = 1 /* order by nome */ ORDER BY id", engine)).toBe("ORDER BY id");
    // O comentário depois da ordem não é dela.
    expect(orderOf("a = 1 ORDER BY id -- do mais velho", engine)).toBe("ORDER BY id");
    expect(orderOf("a = 1 ORDER BY id /* do mais velho */", engine)).toBe("ORDER BY id");
  });

  it("o comentário de bloco dentro de outro vale no PostgreSQL e no Db2; no Informix o primeiro fecho o encerra", () => {
    const text = "a = 1 /* x /* y */ order by nome */";

    expect(orderOf(text, postgres)).toBe("");
    expect(orderOf(text, db2)).toBe("");
    expect(orderOf(text, informix)).toBe("order by nome */");
  });

  it("`{ ... }` é comentário só no Informix", () => {
    const text = "a = 1 { order by nome }";

    expect(orderOf(text, informix)).toBe("");
    expect(orderOf(text, postgres)).toBe("order by nome }");
    expect(orderOf(text, db2)).toBe("order by nome }");
  });

  it("o bloco `$tag$ ... $tag$` é texto só no PostgreSQL", () => {
    expect(orderOf("obs = $$ order by nome $$", postgres)).toBe("");
    expect(orderOf("obs = $t$ order by nome $t$ ORDER BY id", postgres)).toBe("ORDER BY id");
    expect(orderOf("obs = $$ order by nome $$", db2)).toBe("order by nome $$");
    expect(orderOf("obs = $$ order by nome $$", informix)).toBe("order by nome $$");
  });

  it.each(engines)("a ordem de uma subconsulta, ou de qualquer coisa entre parênteses, é dela, e não a de fora (banco %s)", (engine) => {
    expect(orderOf("id IN (SELECT pedido_id FROM itens ORDER BY valor)", engine)).toBe("");
    expect(orderOf("posicao = (SELECT rank() OVER (ORDER BY id) FROM t)", engine)).toBe("");
    expect(orderOf("id IN (SELECT pedido_id FROM itens ORDER BY valor) ORDER BY nome", engine)).toBe("ORDER BY nome");
    expect(orderOf("(a = 1) order by nome", engine)).toBe("order by nome");
    // Um parêntese dentro de texto não abre nada.
    expect(orderOf("obs = '(' ORDER BY nome", engine)).toBe("ORDER BY nome");
  });

  it.each(engines)("o `;` do fim não é da ordem (banco %s)", (engine) => {
    expect(orderOf("a = 1 ORDER BY nome;", engine)).toBe("ORDER BY nome");
    expect(orderOf("ORDER BY nome ;  ; ", engine)).toBe("ORDER BY nome");
  });
});

describe("withOrder: o clique no cabeçalho escreve, troca ou tira o ORDER BY no texto (RN-TABELA-010)", () => {
  const asc: RecordsSort = { column: "nome", direction: "asc" };
  const desc: RecordsSort = { column: "nome", direction: "desc" };

  it.each(engines)("texto vazio: só a ordem, com a coluna entre aspas; sem ordem, vazio (banco %s)", (engine) => {
    expect(withOrder("", asc, engine)).toBe('ORDER BY "nome" ASC');
    expect(withOrder("   ", desc, engine)).toBe('ORDER BY "nome" DESC');
    expect(withOrder("", null, engine)).toBe("");
  });

  it.each(engines)("texto com condição: a ordem vai depois dela (banco %s)", (engine) => {
    expect(withOrder("ativo = 1", asc, engine)).toBe('ativo = 1 ORDER BY "nome" ASC');
    expect(withOrder("  ativo = 1 AND obs = 'order by'  ", desc, engine)).toBe(`ativo = 1 AND obs = 'order by' ORDER BY "nome" DESC`);
  });

  it.each(engines)("o ORDER BY que já está no texto, do cabeçalho ou digitado pela pessoa, é trocado inteiro (banco %s)", (engine) => {
    expect(withOrder('ORDER BY "nome" ASC', desc, engine)).toBe('ORDER BY "nome" DESC');
    expect(withOrder("ativo = 1 order by id, nome desc", asc, engine)).toBe('ativo = 1 ORDER BY "nome" ASC');
    expect(withOrder("ativo = 1 ORDER\nBY lower(nome) NULLS FIRST", { column: "id", direction: "desc" }, engine)).toBe('ativo = 1 ORDER BY "id" DESC');
  });

  it.each(engines)("sem ordem: o ORDER BY sai do texto, e a condição fica como estava (banco %s)", (engine) => {
    expect(withOrder('ativo = 1 ORDER BY "nome" DESC', null, engine)).toBe("ativo = 1");
    expect(withOrder('ORDER BY "nome" DESC', null, engine)).toBe("");
    expect(withOrder("ativo = 1", null, engine)).toBe("ativo = 1");
  });

  it.each(engines)("o ciclo do cabeçalho sobre um texto sem condição e sobre um com condição volta ao texto de partida (banco %s)", (engine) => {
    for (const start of ["", "ativo = 1", "obs = 'order by x' AND id IN (SELECT id FROM t ORDER BY id)"]) {
      const ascending = withOrder(start, asc, engine);
      const descending = withOrder(ascending, desc, engine);

      expect(ascending, start).toBe([start, 'ORDER BY "nome" ASC'].filter((part) => part !== "").join(" "));
      expect(descending, start).toBe([start, 'ORDER BY "nome" DESC'].filter((part) => part !== "").join(" "));
      expect(withOrder(descending, null, engine), start).toBe(start);
    }
  });

  it.each(engines)("o nome da coluna segue a regra única das aspas: nada nele vira outro comando nem outra ordem (banco %s)", (engine) => {
    for (const column of ['a"b', "Criado Em", "a;b", "x' --", "order by", "a, b"]) {
      const text = withOrder("ativo = 1", { column, direction: "asc" }, engine);

      expect(text, column).toBe(`ativo = 1 ORDER BY "${column.replaceAll('"', '""')}" ASC`);
      expect(statementCount(recordsSql(engine, "s", "t", text), engine), column).toBe(1);
      expect(sortOf(text, [{ name: column }], engine), column).toEqual({ column, direction: "asc" });
    }
  });

  it.each(engines)("a condição que termina em comentário de linha não engole a ordem: ela entra antes do comentário (banco %s)", (engine) => {
    const text = withOrder("ativo = 1 -- só os ativos", asc, engine);

    expect(text).toBe('ativo = 1 ORDER BY "nome" ASC -- só os ativos');
    expect(orderOf(text, engine)).toBe('ORDER BY "nome" ASC');
    // E continua lá ao trocar e ao tirar a ordem.
    expect(withOrder(text, desc, engine)).toBe('ativo = 1 ORDER BY "nome" DESC -- só os ativos');
    expect(withOrder(text, null, engine)).toBe("ativo = 1 -- só os ativos");
    // Sem código nenhum (só o comentário), a ordem vai na frente.
    expect(withOrder("-- só os ativos", asc, engine)).toBe('ORDER BY "nome" ASC -- só os ativos');
  });

  it.each(engines)("o `;` do fim fica no fim: a ordem entra antes dele, e o texto segue um comando só (banco %s)", (engine) => {
    expect(withOrder("ativo = 1;", asc, engine)).toBe('ativo = 1 ORDER BY "nome" ASC;');
    expect(conditionOf(withOrder("ativo = 1 ;  ", asc, engine))).toBe('ativo = 1 ORDER BY "nome" ASC');
    // O `;` seguido de comentário, que sozinho é um comando só, continua sendo com a ordem.
    const noted = withOrder("ativo = 1; -- nota", asc, engine);
    expect(noted).toBe('ativo = 1 ORDER BY "nome" ASC; -- nota');
    expect(statementCount(recordsSql(engine, "s", "t", noted), engine)).toBe(1);
  });

  it("lê o texto pelas regras do banco: o que é comentário num é código no outro", () => {
    // No Informix `{ ... }` é comentário: a ordem que está lá dentro não é a de fora, e a nova entra antes dele.
    expect(withOrder("a = 1 { order by x }", asc, informix)).toBe('a = 1 ORDER BY "nome" ASC { order by x }');
    // No PostgreSQL `$$ ... $$` é texto: a ordem que está lá dentro fica onde está.
    expect(withOrder("obs = $$ order by x $$", asc, postgres)).toBe('obs = $$ order by x $$ ORDER BY "nome" ASC');
    expect(withOrder("obs = $$ order by x $$", asc, db2)).toBe('obs = $$ ORDER BY "nome" ASC');
  });
});

describe("sortOf: a ordem aplicada acende a seta do cabeçalho quando é de UMA coluna só (RN-TABELA-010)", () => {
  it.each(engines)("a que o cabeçalho escreve: a coluna entre aspas e o sentido (banco %s)", (engine) => {
    expect(sortOf('ORDER BY "nome" ASC', columns, engine)).toEqual({ column: "nome", direction: "asc" });
    expect(sortOf('ORDER BY "nome" DESC', columns, engine)).toEqual({ column: "nome", direction: "desc" });
    expect(sortOf('ativo = 1 ORDER BY "is_active" DESC', columns, engine)).toEqual({ column: "is_active", direction: "desc" });
    expect(sortOf('ORDER BY "Criado Em" DESC', columns, engine)).toEqual({ column: "Criado Em", direction: "desc" });
    expect(sortOf('ORDER BY "a""b" ASC', columns, engine)).toEqual({ column: 'a"b', direction: "asc" });
  });

  it.each(engines)("a digitada pela pessoa: sem o sentido é crescente, e o nome sem aspas acha a coluna sem olhar maiúsculas (banco %s)", (engine) => {
    expect(sortOf('order by "nome"', columns, engine)).toEqual({ column: "nome", direction: "asc" });
    expect(sortOf("order by nome desc", columns, engine)).toEqual({ column: "nome", direction: "desc" });
    expect(sortOf("ORDER BY NOME", columns, engine)).toEqual({ column: "nome", direction: "asc" });
    expect(sortOf("order by nome desc", [{ name: "NOME" }], engine)).toEqual({ column: "NOME", direction: "desc" });
    expect(sortOf("ORDER\nBY Is_Active Desc;", columns, engine)).toEqual({ column: "is_active", direction: "desc" });
    expect(sortOf('ORDER BY "nome" -- do A ao Z', columns, engine)).toEqual({ column: "nome", direction: "asc" });
  });

  it("entre duas colunas que só diferem em maiúsculas, o nome sem aspas fica com a de grafia igual; entre aspas o nome é exato", () => {
    const twins = [{ name: "Nome" }, { name: "nome" }];

    expect(sortOf("order by nome", twins)).toEqual({ column: "nome", direction: "asc" });
    expect(sortOf("order by Nome", twins)).toEqual({ column: "Nome", direction: "asc" });
    expect(sortOf('ORDER BY "NOME"', columns)).toBeNull();
    expect(sortOf('ORDER BY "Nome" DESC', twins)).toEqual({ column: "Nome", direction: "desc" });
  });

  it.each(engines)("ordem de várias colunas não acende seta nenhuma (banco %s)", (engine) => {
    expect(sortOf("ORDER BY nome, id", columns, engine)).toBeNull();
    expect(sortOf('ORDER BY "nome" ASC, "id" DESC', columns, engine)).toBeNull();
    expect(sortOf("ativo = 1 order by id desc, nome", columns, engine)).toBeNull();
  });

  it.each(engines)("ordem com expressão, por posição, com mais do que a coluna e o sentido, ou por coluna que o resultado não tem: sem seta (banco %s)", (engine) => {
    for (const text of ["ORDER BY lower(nome)", "ORDER BY nome || 'x'", "ORDER BY nome NULLS FIRST", "ORDER BY nome DESC NULLS LAST", "ORDER BY 1", "ORDER BY t.nome", "ORDER BY 'nome'", "ORDER BY outra", "ORDER BY", "ORDER BY nome ASC DESC", 'ORDER BY "nome'])
      expect(sortOf(text, columns, engine), text).toBeNull();
  });

  it.each(engines)("sem ordem de fora, sem seta: nem a de uma subconsulta, nem a de um comentário, conta (banco %s)", (engine) => {
    for (const text of ["", "ativo = 1", "id IN (SELECT id FROM t ORDER BY nome)", "ativo = 1 -- order by nome", "obs = 'order by nome'"]) expect(sortOf(text, columns, engine), text).toBeNull();
  });

  it("sem as colunas do resultado (nada na tela) não há cabeçalho a acender", () => {
    expect(sortOf('ORDER BY "nome" ASC', [])).toBeNull();
  });

  it.each(engines)("o que `withOrder` escreve, `sortOf` lê de volta, sobre qualquer texto de partida (banco %s)", (engine) => {
    const starts = ["", "ativo = 1", "obs = 'order by id'", "id IN (SELECT id FROM t ORDER BY id)", "ativo = 1 -- order by id", "ativo = 1 order by id, nome", "ativo = 1;"];

    for (const start of starts) {
      for (const sort of [{ column: "nome", direction: "asc" }, { column: "Criado Em", direction: "desc" }, { column: 'a"b', direction: "desc" }] as const) {
        expect(sortOf(withOrder(start, sort, engine), columns, engine), `${start} · ${sort.column}`).toEqual(sort);
      }
      expect(sortOf(withOrder(start, null, engine), columns, engine), start).toBeNull();
    }
  });
});

describe("recordsSql: o texto do campo é o que vem depois do nome da tabela (RN-TABELA-010)", () => {
  it.each(engines)("o texto que começa por ORDER BY vai depois da tabela como está, sem WHERE (banco %s)", (engine) => {
    expect(recordsSql(engine, "etio", "institutions", 'ORDER BY "is_active" ASC')).toBe('SELECT * FROM "etio"."institutions"\nORDER BY "is_active" ASC');
    expect(recordsSql(engine, "s", "t", "  order by nome, id desc ; ")).toBe('SELECT * FROM "s"."t"\norder by nome, id desc');
    expect(recordsSql(engine, "s", "t", "ORDER\tBY nome")).toBe('SELECT * FROM "s"."t"\nORDER\tBY nome');
  });

  it.each(engines)("qualquer outro vai depois de WHERE, e pode trazer o ORDER BY dele no fim (banco %s)", (engine) => {
    expect(recordsSql(engine, "s", "t", "ativo = 1")).toBe('SELECT * FROM "s"."t"\nWHERE ativo = 1');
    expect(recordsSql(engine, "s", "t", 'ativo = 1 ORDER BY "nome" DESC')).toBe('SELECT * FROM "s"."t"\nWHERE ativo = 1 ORDER BY "nome" DESC');
    // O que só parece ordem no começo é condição.
    expect(recordsSql(engine, "s", "t", "order_id = 3")).toBe('SELECT * FROM "s"."t"\nWHERE order_id = 3');
    expect(recordsSql(engine, "s", "t", "'order by' = obs")).toBe(`SELECT * FROM "s"."t"\nWHERE 'order by' = obs`);
    expect(recordsSql(engine, "s", "t", "(SELECT 1 FROM x ORDER BY 1) = 1")).toBe('SELECT * FROM "s"."t"\nWHERE (SELECT 1 FROM x ORDER BY 1) = 1');
  });

  it.each(engines)("o comentário antes da ordem não faz dela uma condição: sem WHERE (banco %s)", (engine) => {
    expect(recordsSql(engine, "s", "t", "/* do mais novo */ ORDER BY id DESC")).toBe('SELECT * FROM "s"."t"\n/* do mais novo */ ORDER BY id DESC');
  });

  it.each(engines)("continua um comando só com a ordem no texto, e são dois com um `;` no meio (banco %s)", (engine) => {
    expect(statementCount(recordsSql(engine, "s", "t", 'ativo = 1 ORDER BY "nome" DESC;'), engine)).toBe(1);
    expect(statementCount(recordsSql(engine, "s", "t", "ORDER BY nome; DELETE FROM t"), engine)).toBe(2);
  });
});
