import { describe, expect, it } from "vitest";

import { sqlFormatStyles } from "@/app/settings/_lib/preferences";

import { formatSql } from "./sql-format";

describe("formatSql", () => {
  it("formata no estilo River (rio) alinhando as palavras-chave à direita", () => {
    const input =
      "select c.nome, c.email, count(p.id) as total_pedidos from clientes as c join pedidos as p on p.cliente_id = c.id where c.ativo = 1 and p.data >= '2026-01-01' group by c.nome, c.email order by total_pedidos desc;";

    expect(
      formatSql(input, {
        style: "river",
        uppercaseKeywords: true,
        tabSize: 4,
      }),
    ).toBe(
      [
        "SELECT c.nome,",
        "       c.email,",
        "       COUNT(p.id) AS total_pedidos",
        "  FROM clientes AS c",
        "  JOIN pedidos AS p",
        "    ON p.cliente_id = c.id",
        " WHERE c.ativo = 1",
        "   AND p.data >= '2026-01-01'",
        " GROUP BY c.nome, c.email",
        " ORDER BY total_pedidos DESC;",
      ].join("\n"),
    );
  });

  it("formata no estilo Expandido com cada cláusula em sua linha e conteúdo indentado pelo tabSize", () => {
    const input =
      "select c.nome, c.email, count(p.id) as total_pedidos from clientes as c inner join pedidos as p on p.cliente_id = c.id where c.ativo = 1 and p.data >= '2026-01-01' group by c.nome, c.email order by total_pedidos desc;";

    expect(
      formatSql(input, {
        style: "expanded",
        uppercaseKeywords: true,
        tabSize: 4,
      }),
    ).toBe(
      [
        "SELECT",
        "    c.nome,",
        "    c.email,",
        "    COUNT(p.id) AS total_pedidos",
        "FROM",
        "    clientes AS c",
        "    INNER JOIN pedidos AS p",
        "        ON p.cliente_id = c.id",
        "WHERE",
        "    c.ativo = 1",
        "    AND p.data >= '2026-01-01'",
        "GROUP BY",
        "    c.nome,",
        "    c.email",
        "ORDER BY",
        "    total_pedidos DESC;",
      ].join("\n"),
    );

    expect(
      formatSql("select c.nome, c.email from clientes as c where c.ativo = 1", {
        style: "expanded",
        uppercaseKeywords: true,
        tabSize: 2,
      }),
    ).toBe(["SELECT", "  c.nome,", "  c.email", "FROM", "  clientes AS c", "WHERE", "  c.ativo = 1"].join("\n"));
  });

  it("formata no estilo Alinhado à esquerda (tabular) iniciando o conteúdo na mesma coluna", () => {
    const input =
      "select c.nome, c.email, count(p.id) as total_pedidos from clientes as c join pedidos as p on p.cliente_id = c.id where c.ativo = 1 and p.data >= '2026-01-01' group by c.nome, c.email order by total_pedidos desc;";

    expect(
      formatSql(input, {
        style: "tabular",
        uppercaseKeywords: true,
        tabSize: 4,
      }),
    ).toBe(
      [
        "SELECT   c.nome,",
        "         c.email,",
        "         COUNT(p.id) AS total_pedidos",
        "FROM     clientes AS c",
        "JOIN     pedidos AS p ON p.cliente_id = c.id",
        "WHERE    c.ativo = 1",
        "AND      p.data >= '2026-01-01'",
        "GROUP BY c.nome, c.email",
        "ORDER BY total_pedidos DESC;",
      ].join("\n"),
    );
  });

  it("formata no estilo Vírgula à esquerda (leading commas)", () => {
    const shortInput = "select c.nome, c.email, count(p.id) as total_pedidos from clientes as c";

    expect(
      formatSql(shortInput, {
        style: "leadingComma",
        uppercaseKeywords: true,
        tabSize: 4,
      }),
    ).toBe(
      [
        "SELECT c.nome",
        "     , c.email",
        "     , COUNT(p.id) AS total_pedidos",
        "FROM clientes AS c",
      ].join("\n"),
    );
  });

  it("formata no estilo Compacto em uma única linha preservando quebras após comentário de linha", () => {
    const input = `
      SELECT
        c.nome,
        c.email
      FROM
        clientes c
      WHERE
        c.ativo = 1;
    `;

    expect(
      formatSql(input, {
        style: "compact",
        uppercaseKeywords: true,
        tabSize: 4,
      }),
    ).toBe("SELECT c.nome, c.email FROM clientes c WHERE c.ativo = 1;");

    const withLineComment = "SELECT c.nome -- coluna principal\nFROM clientes c;";
    expect(
      formatSql(withLineComment, {
        style: "compact",
        uppercaseKeywords: true,
        tabSize: 4,
      }),
    ).toBe("SELECT c.nome -- coluna principal\nFROM clientes c;");
  });

  it("formata no estilo Moderno (dbt / analytics) com CTE, linha em branco e cláusulas alinhadas à raiz", () => {
    const input = `
      WITH pedidos_2026 AS (
        SELECT * FROM pedidos WHERE data >= '2026-01-01'
      )
      SELECT c.nome, c.email, COUNT(p.id) AS total_pedidos
      FROM clientes AS c
      INNER JOIN pedidos_2026 AS p ON p.cliente_id = c.id
      WHERE c.ativo = 1
      GROUP BY c.nome, c.email
    `;

    expect(
      formatSql(input, {
        style: "modern",
        uppercaseKeywords: false,
        tabSize: 4,
      }),
    ).toBe(
      [
        "with pedidos_2026 as (",
        "    select *",
        "    from pedidos",
        "    where data >= '2026-01-01'",
        ")",
        "",
        "select",
        "    c.nome,",
        "    c.email,",
        "    count(p.id) as total_pedidos",
        "from clientes as c",
        "inner join pedidos_2026 as p",
        "    on p.cliente_id = c.id",
        "where c.ativo = 1",
        "group by c.nome, c.email",
      ].join("\n"),
    );

    expect(
      formatSql(input, {
        style: "modern",
        uppercaseKeywords: true,
        tabSize: 4,
      }),
    ).toBe(
      [
        "WITH pedidos_2026 AS (",
        "    SELECT *",
        "    FROM pedidos",
        "    WHERE data >= '2026-01-01'",
        ")",
        "",
        "SELECT",
        "    c.nome,",
        "    c.email,",
        "    COUNT(p.id) AS total_pedidos",
        "FROM clientes AS c",
        "INNER JOIN pedidos_2026 AS p",
        "    ON p.cliente_id = c.id",
        "WHERE c.ativo = 1",
        "GROUP BY c.nome, c.email",
      ].join("\n"),
    );
  });

  it("respeita uppercaseKeywords (true = MAIÚSCULAS, false = minúsculas) em todos os 6 estilos", () => {
    const query = "select c.nome, count(p.id) as total from clientes as c where c.ativo = 1 order by total desc;";

    for (const style of sqlFormatStyles) {
      const upper = formatSql(query, { style, uppercaseKeywords: true, tabSize: 2 });
      const lower = formatSql(query, { style, uppercaseKeywords: false, tabSize: 2 });

      expect(upper).toContain("SELECT");
      expect(upper).toContain("FROM");
      expect(upper).toContain("WHERE");
      expect(upper).toContain("ORDER BY");
      expect(upper).toContain("COUNT(p.id) AS total");
      expect(upper).toContain("DESC");

      expect(lower).toContain("select");
      expect(lower).toContain("from");
      expect(lower).toContain("where");
      expect(lower).toContain("order by");
      expect(lower).toContain("count(p.id) as total");
      expect(lower).toContain("desc");
    }
  });

  it("preserva literais de texto, identificadores entre aspas, $tag$, comentários e declarações let/const", () => {
    const sql = [
      "let limite = 10;",
      "select 'select from where' as texto, \"select\" as coluna, $$select from$$ as bloco, c.order",
      "from clientes c",
      "where c.id = @limite;",
    ].join("\n");

    const formatted = formatSql(sql, {
      style: "expanded",
      uppercaseKeywords: true,
      tabSize: 2,
    });

    expect(formatted).toContain("let limite = 10;");
    expect(formatted).toContain("'select from where' AS texto");
    expect(formatted).toContain('"select" AS coluna');
    expect(formatted).toContain("$$select from$$ AS bloco");
    expect(formatted).toContain("c.order");

    const informixSql = "select { select informix } c.nome from clientes c;";
    expect(
      formatSql(informixSql, {
        style: "compact",
        uppercaseKeywords: true,
        tabSize: 2,
        engine: 3,
      }),
    ).toBe("SELECT { select informix } c.nome FROM clientes c;");
  });

  it("formata múltiplos comandos separados por ponto e vírgula", () => {
    const sql = "select a from t1; select b from t2;";

    expect(
      formatSql(sql, {
        style: "compact",
        uppercaseKeywords: true,
        tabSize: 2,
      }),
    ).toBe("SELECT a FROM t1;\n\nSELECT b FROM t2;");
  });

  it("preserva comentários no topo, no fim, antes de SELECT e antes de vírgulas, e respeita uppercaseKeywords em CTEs no estilo River", () => {
    const withLooseAndLeadingComments = [
      "-- cabeçalho solto",
      "",
      "-- comentário colado na query",
      "select c.nome, c.email from clientes as c;",
      "-- rodapé solto",
    ].join("\n");

    const formatted = formatSql(withLooseAndLeadingComments, {
      style: "expanded",
      uppercaseKeywords: true,
      tabSize: 2,
    });

    expect(formatted).toBe(
      [
        "-- cabeçalho solto",
        "",
        "-- comentário colado na query",
        "SELECT",
        "  c.nome,",
        "  c.email",
        "FROM",
        "  clientes AS c;",
        "",
        "-- rodapé solto",
      ].join("\n"),
    );

    const withCommentBeforeComma = "select a -- primeiro\n, b from t;";
    const formattedInlineComment = formatSql(withCommentBeforeComma, {
      style: "expanded",
      uppercaseKeywords: true,
      tabSize: 2,
    });
    expect(formattedInlineComment).not.toContain("-- primeiro,");
    expect(formattedInlineComment).toContain("-- primeiro\n, b");

    const riverCteLower = "WITH cte AS (SELECT id FROM pedidos) SELECT id FROM cte;";
    expect(
      formatSql(riverCteLower, {
        style: "river",
        uppercaseKeywords: false,
        tabSize: 4,
      }),
    ).toContain("select id\n      from pedidos");
  });
});
