import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";
import { withoutCursor } from "@/lib/testing/text";

import { analyzeAt, joinScope, resolveName, resolveQualifier, resolveReference, type Reference } from "./sql-references";
import type { LinkCatalog } from "./table-links";

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

/** Lê o texto com o cursor onde está o `|`. */
function read(text: string, engine: Engine = postgres, blankLines = false) {
  const { doc, at } = withoutCursor(text);
  return analyzeAt(doc, at, engine, blankLines);
}

/** As tabelas como `esquema.nome apelido`, para a tabela de casos caber numa linha. */
const shown = (references: readonly Reference[]) => references.map((reference) => `${reference.via}:${reference.schema === null ? "" : `${reference.schema}.`}${reference.name}${reference.alias === null ? "" : ` ${reference.alias}`}`);

describe("as tabelas e os apelidos do comando (RN-SQL-025)", () => {
  it.each([
    ["from simples", "select * from pedidos |", ["from:pedidos"]],
    ["apelido sem AS", "select * from pedidos p where |", ["from:pedidos p"]],
    ["apelido com AS", "select * from pedidos as p where |", ["from:pedidos p"]],
    ["esquema", "select * from erp.pedidos p where |", ["from:erp.pedidos p"]],
    ["nomes entre aspas, como estão escritos", 'select * from "ERP"."Pedidos" "P" where |', ["from:ERP.Pedidos P"]],
    ["lista com vírgulas", "select * from pedidos p, clientes c, itens where |", ["from:pedidos p", "from:clientes c", "from:itens"]],
    ["várias junções", "select * from pedidos p join clientes c on c.id = p.cliente_id left outer join itens i on i.pedido_id = p.id where |", ["from:pedidos p", "join:clientes c", "join:itens i"]],
    ["inner, right e full", "select * from a inner join b on 1=1 right join c on 1=1 full outer join d on 1=1 |", ["from:a", "join:b", "join:c", "join:d"]],
    ["UPDATE com apelido", "update pedidos p set p.|", ["update:pedidos p"]],
    ["UPDATE ONLY", "update only pedidos set x = 1 where |", ["update:pedidos"]],
    ["INSERT INTO com a lista de colunas", "insert into pedidos (id, cliente_id) values (1, 2) |", ["into:pedidos"]],
    ["DELETE FROM com apelido", "delete from pedidos p where |", ["from:pedidos p"]],
    ["o que vem depois da tabela não é apelido", "select * from pedidos where x = 1 group by y order by z |", ["from:pedidos"]],
    ["LIMIT, UNION e FOR UPDATE não são apelido", "select * from pedidos limit 1 |", ["from:pedidos"]],
    ["a palavra reservada sem aspas não é tabela", "select * from select |", []],
    ["IS DISTINCT FROM não traz tabela", "select * from t where a is distinct from b |", ["from:t"]],
  ])("%s", (_name, text, expected) => {
    expect(shown(read(text)?.references ?? [])).toEqual(expected);
  });

  it("a subconsulta e o apelido dela não são tabela; o nível do cursor é o do comando", () => {
    const analysis = read("select * from (select * from interna i) s join clientes c on c.id = s.cliente_id where |");

    expect(shown(analysis?.references ?? [])).toEqual(["join:clientes c"]);
    // O apelido da subconsulta e o da tabela dentro dela ficam fora das tabelas, mas o `s` continua em uso (um apelido novo não pode repeti-lo).
    expect([...(analysis?.used ?? [])].sort()).toEqual(["c", "s"]);
  });

  it("com o cursor dentro de uma subconsulta, as tabelas são as dela", () => {
    expect(shown(read("select * from pedidos p where p.id in (select pedido_id from itens i join |)")?.references ?? [])).toEqual(["from:itens i"]);
  });

  it("com o cursor num parêntese que não é subconsulta, vale o nível de cima", () => {
    expect(shown(read("select * from pedidos p where (p.|)")?.references ?? [])).toEqual(["from:pedidos p"]);
  });

  it("o OUTER do Informix (FROM a, OUTER b) traz a tabela, e a junção seguinte a enxerga", () => {
    expect(shown(read("select * from pedidos p, outer clientes c where |", informix)?.references ?? [])).toEqual(["from:pedidos p", "from:clientes c"]);
    expect(shown(read("select * from pedidos p, outer erp.clientes as c, outer itens where |", informix)?.references ?? [])).toEqual(["from:pedidos p", "from:erp.clientes c", "from:itens"]);

    const joining = read("select * from pedidos p, outer clientes c join |", informix);
    expect(shown(joining === null ? [] : joinScope(joining))).toEqual(["from:pedidos p", "from:clientes c"]);
  });

  it("o OUTER JOIN continua sendo só a junção", () => {
    expect(shown(read("select * from pedidos p left outer join clientes c on 1=1 where |", informix)?.references ?? [])).toEqual(["from:pedidos p", "join:clientes c"]);
  });

  it("o USING do DELETE e do MERGE traz tabelas; o USING de uma junção ou de um índice não", () => {
    expect(shown(read("delete from pedidos using clientes c, itens i where |")?.references ?? [])).toEqual(["from:pedidos", "from:clientes c", "from:itens i"]);
    expect(shown(read("merge into pedidos p using clientes c on c.id = p.cliente_id when matched then delete |")?.references ?? [])).toEqual(["into:pedidos p", "from:clientes c"]);
    expect(shown(read("select * from pedidos p join clientes c using (id) where |")?.references ?? [])).toEqual(["from:pedidos p", "join:clientes c"]);
    expect(shown(read("create index ix on pedidos using btree (id) |")?.references ?? [])).toEqual([]);
    expect(shown(read("select * from pedidos p join clientes c using (id), itens i where |")?.references ?? [])).toEqual(["from:pedidos p", "join:clientes c"]);
  });

  it("a chamada de função na lista não é tabela, mas o apelido dela conta como usado", () => {
    const analysis = read("select * from generate_series(1, 3) g join clientes c on true |");

    expect(shown(analysis?.references ?? [])).toEqual(["join:clientes c"]);
    expect(analysis?.used.has("g")).toBe(true);
  });

  it("texto entre aspas, comentário e $tag$ não trazem tabela", () => {
    const text = "select 'from falsa f', $x$ join outra o $x$ from pedidos p -- join comentada c\n /* from bloco b */ where |";

    expect(shown(read(text)?.references ?? [])).toEqual(["from:pedidos p"]);
  });

  it("o Db2 dobra o que não está entre aspas para maiúsculas; entre aspas vale como está", () => {
    expect(shown(read('select * from erp.pedidos p join "Clientes" "c" on 1=1 |', db2)?.references ?? [])).toEqual(["from:ERP.PEDIDOS P", "join:Clientes c"]);
  });

  it("o PostgreSQL e o Informix dobram para minúsculas", () => {
    expect(shown(read("select * from ERP.Pedidos P |", postgres)?.references ?? [])).toEqual(["from:erp.pedidos p"]);
    expect(shown(read("select * from Pedidos P |", informix)?.references ?? [])).toEqual(["from:pedidos p"]);
  });

  it("três partes (banco.esquema.tabela) ficam com as duas últimas", () => {
    expect(shown(read("select * from banco.erp.pedidos p |")?.references ?? [])).toEqual(["from:erp.pedidos p"]);
  });

  it("os apelidos em uso: o apelido, ou o nome da tabela sem apelido; e se o comando usa apelidos", () => {
    const aliased = read("select * from pedidos p join clientes on 1=1 |");
    expect([...(aliased?.used ?? [])].sort()).toEqual(["clientes", "p"]);
    expect(aliased?.usesAliases).toBe(true);

    const plain = read("select * from pedidos join clientes on 1=1 |");
    expect([...(plain?.used ?? [])].sort()).toEqual(["clientes", "pedidos"]);
    expect(plain?.usesAliases).toBe(false);
  });

  it("só o comando do cursor conta", () => {
    expect(shown(read("select * from antes a;\nselect * from pedidos p join |;\nselect * from depois d")?.references ?? [])).toEqual(["from:pedidos p"]);
  });

  it("a linha em branco separa o comando quando a preferência está ligada", () => {
    expect(shown(read("select * from antes a\n\nselect * from pedidos p join |", postgres, true)?.references ?? [])).toEqual(["from:pedidos p"]);
  });

  it("depois do ';' o comando é outro e não herda as tabelas do de cima", () => {
    expect(shown(read("select * from pedidos p;\n select x.|")?.references ?? [])).toEqual([]);
    expect(read("select * from pedidos p join clientes c on 1=1;\n|")?.references ?? []).toEqual([]);
  });
});

describe("o que o cursor pede (RN-SQL-025)", () => {
  /** O pedido como `tipo:dado:palavra`: `palavra` é o que o cursor já escreveu (de onde a sugestão troca o texto até o cursor). */
  const context = (text: string, engine: Engine = postgres) => {
    const { doc, at } = withoutCursor(text);
    const found = analyzeAt(doc, at, engine)?.context ?? { kind: "none" as const };
    if (found.kind === "none") return "none";

    const typed = doc.slice(found.from, at);
    if (found.kind === "member") return `member:${found.qualifier.join(".")}:${typed}`;
    return found.kind === "on" ? `on:${found.table.name}:${typed}` : `join::${typed}`;
  };

  it.each([
    ["depois do ponto de um apelido", "select p.| from pedidos p", "member:p:"],
    ["com letras depois do ponto", "select p.na| from pedidos p", "member:p:na"],
    ["tabela com esquema", "select erp.pedidos.| from erp.pedidos", "member:erp.pedidos:"],
    ["nome entre aspas", 'select "P".| from pedidos "P"', "member:P:"],
    ["em minúsculas o que o PostgreSQL dobra", "select P.| from pedidos p", "member:p:"],
    ["o nome entre aspas ainda aberto", 'select p."na| from pedidos p', 'member:p:"na'],
    ["três partes", "select a.b.c.| from t", "member:a.b.c:"],
    ["quatro partes não são nome", "select a.b.c.d.| from t", "none"],
    ["ponto solto, sem nome antes", "select .| from t", "none"],
    ["depois de JOIN", "select * from pedidos p join |", "join::"],
    ["JOIN com letras", "select * from pedidos p join cli|", "join::cli"],
    ["INNER JOIN", "select * from pedidos p inner join |", "join::"],
    ["LEFT JOIN", "select * from pedidos p left join |", "join::"],
    ["LEFT OUTER JOIN", "select * from pedidos p left outer join |", "join::"],
    ["RIGHT JOIN", "select * from pedidos p right join |", "join::"],
    ["FULL OUTER JOIN", "select * from pedidos p full outer join |", "join::"],
    ["JOIN em várias linhas", "select *\nfrom pedidos p\njoin |", "join::"],
    ["CROSS JOIN não", "select * from pedidos p cross join |", "none"],
    ["NATURAL JOIN não", "select * from pedidos p natural join |", "none"],
    ["sem espaço depois de JOIN, a palavra é join", "select * from pedidos p join|", "none"],
    ["depois de ON", "select * from pedidos p join clientes c on |", "on:clientes:"],
    ["depois de ON, com letras", "select * from pedidos p join clientes as c on ped|", "on:clientes:ped"],
    ["ON sem apelido", "select * from pedidos p join erp.clientes on |", "on:clientes:"],
    ["ON de outra junção que já tem condição", "select * from pedidos p join clientes c on c.id = p.cliente_id join itens i on |", "on:itens:"],
    ["fora de junção não", "select * from pedidos p where |", "none"],
    ["depois de AND não", "select * from pedidos p join clientes c on c.id = p.cliente_id and |", "none"],
    ["dentro de texto não", "select * from pedidos p where x = 'a.|'", "none"],
    ["dentro de comentário de linha não", "select * from pedidos p -- p.|", "none"],
    ["dentro de comentário de bloco não", "select * from pedidos p /* join | */", "none"],
    ["dentro de $tag$ não", "select $t$ join | $t$ from pedidos p", "none"],
  ])("%s", (_name, text, expected) => {
    expect(context(text)).toBe(expected);
  });

  it("o Db2 dobra o apelido do qualificador para maiúsculas", () => {
    expect(context("select p.| from pedidos p", db2)).toBe("member:P:");
  });

  it("dentro do parêntese de uma subconsulta, o JOIN é o dela", () => {
    expect(context("select * from pedidos p where exists (select 1 from itens i join |)")).toBe("join::");
  });

  it("o nome entre aspas já fechado com o cursor entre as aspas que a tela fechou", () => {
    const analysis = read('select p."|" from pedidos p');
    expect(analysis?.context).toMatchObject({ kind: "member", qualifier: ["p"], quoted: true });
    expect(shown(analysis?.references ?? [])).toEqual(["from:pedidos p"]);
  });
});

describe("resolver os nomes pelo catálogo", () => {
  const catalog: LinkCatalog = new Map([
    ["public", new Set(["pedidos", "clientes"])],
    ["erp", new Set(["produtos", "clientes"])],
  ]);
  const standard = ["public"];

  it("com esquema, só vale o que o catálogo tem", () => {
    expect(resolveName("erp", "produtos", catalog, standard)).toEqual({ schema: "erp", name: "produtos" });
    expect(resolveName("erp", "pedidos", catalog, standard)).toBeNull();
  });

  it("sem esquema, vale o padrão da sessão e depois os demais esquemas do banco", () => {
    expect(resolveName(null, "clientes", catalog, standard)).toEqual({ schema: "public", name: "clientes" });
    expect(resolveName(null, "produtos", catalog, standard)).toEqual({ schema: "erp", name: "produtos" });
    expect(resolveName(null, "produtos", catalog, null)).toEqual({ schema: "erp", name: "produtos" });
    expect(resolveName(null, "inexistente", catalog, standard)).toBeNull();
  });

  it("o qualificador: apelido, nome da tabela escrita no comando, ou nome do catálogo", () => {
    const references = read("select * from erp.produtos p join pedidos on 1=1 join (select 1) s on 1=1 |")?.references ?? [];

    expect(resolveQualifier(["p"], references, catalog, standard)).toEqual({ schema: "erp", name: "produtos" });
    expect(resolveQualifier(["pedidos"], references, catalog, standard)).toEqual({ schema: "public", name: "pedidos" });
    expect(resolveQualifier(["clientes"], references, catalog, standard)).toEqual({ schema: "public", name: "clientes" });
    expect(resolveQualifier(["erp", "clientes"], references, catalog, standard)).toEqual({ schema: "erp", name: "clientes" });
    expect(resolveQualifier(["s"], references, catalog, standard)).toBeNull();
    expect(resolveQualifier(["erp"], references, catalog, standard)).toBeNull();
    expect(resolveQualifier(["a", "b", "c"], references, catalog, standard)).toBeNull();
  });

  it("o apelido vale mais que o nome de uma tabela do catálogo", () => {
    const references = read("select * from erp.produtos clientes |")?.references ?? [];

    expect(resolveQualifier(["clientes"], references, catalog, standard)).toEqual({ schema: "erp", name: "produtos" });
  });

  it("o apelido de fora de uma subconsulta correlacionada resolve; o de dentro esconde o de fora", () => {
    const analysis = read("select * from pedidos p where exists (select 1 from itens i where i.pedido_id = p.|)");

    expect(shown(analysis?.references ?? [])).toEqual(["from:itens i"]);
    expect(analysis?.outerReferences.map(shown)).toEqual([["from:pedidos p"]]);
    expect(resolveQualifier(["p"], analysis?.references ?? [], catalog, standard, analysis?.outerReferences)).toEqual({ schema: "public", name: "pedidos" });
    expect(resolveQualifier(["p"], analysis?.references ?? [], catalog, standard)).toBeNull();

    // Do mais de dentro para o mais de fora, e o comando por último; o primeiro nível que tem o apelido decide.
    const nested = read("select * from erp.produtos p join clientes c on 1=1 where exists (select 1 from pedidos p where exists (select 1 from itens i where c.|))");
    expect(nested?.outerReferences.map(shown)).toEqual([["from:pedidos p"], ["from:erp.produtos p", "join:clientes c"]]);
    expect(resolveQualifier(["c"], nested?.references ?? [], catalog, standard, nested?.outerReferences)).toEqual({ schema: "public", name: "clientes" });
    expect(resolveQualifier(["p"], nested?.references ?? [], catalog, standard, nested?.outerReferences)).toEqual({ schema: "public", name: "pedidos" });
  });

  it("sem subconsulta, não há níveis de fora; o parêntese que não é subconsulta também não é um", () => {
    expect(read("select * from pedidos p where p.|")?.outerReferences).toEqual([]);
    expect(read("select * from pedidos p where (p.|)")?.outerReferences).toEqual([]);
  });

  it("uma tabela do comando que o catálogo não tem não resolve", () => {
    const [reference] = read("select * from inexistente i |")?.references ?? [];

    expect(resolveReference(reference, catalog, standard)).toBeNull();
  });
});

describe("as tabelas que a junção pode usar (RN-SQL-025)", () => {
  const scoped = (text: string) => shown(joinScope(read(text) as NonNullable<ReturnType<typeof read>>));

  it.each([
    ["depois de JOIN: as de antes do cursor", "select * from pedidos p join |", ["from:pedidos p"]],
    ["depois de JOIN: as escritas adiante ficam de fora", "select * from pedidos p join | join clientes c on 1=1", ["from:pedidos p"]],
    ["depois de ON: só as que vêm antes da tabela do JOIN", "select * from itens i join pedidos p on | join clientes c on 1=1", ["from:itens i"]],
    ["o alvo do INSERT INTO não está no escopo do FROM", "insert into itens select * from pedidos p join |", ["from:pedidos p"]],
    ["o UPDATE conta", "update pedidos p set x = 1 from clientes c join |", ["update:pedidos p", "from:clientes c"]],
    ["fora de JOIN e ON, nada", "select p.| from pedidos p", []],
  ])("%s", (_name, text, expected) => {
    expect(scoped(text)).toEqual(expected);
  });
});
