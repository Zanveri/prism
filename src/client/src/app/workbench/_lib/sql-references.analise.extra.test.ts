import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";
import { withoutCursor } from "@/lib/testing/text";

import { analyzeAt, joinScope, type Reference } from "./sql-references";

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

/** Uma tabela do comando, sem o texto de onde veio: `via`, esquema, nome e apelido, para comparar por igual. */
type Ref = { via: Reference["via"]; schema: string | null; name: string; alias: string | null };

/** A tabela escrita como `r("from", "pedidos", "p", "erp")`: o apelido e o esquema são opcionais. */
const r = (via: Reference["via"], name: string, alias: string | null = null, schema: string | null = null): Ref => ({ via, schema, name, alias });

const plain = ({ via, schema, name, alias }: Reference): Ref => ({ via, schema, name, alias });

/** As tabelas do comando em que o cursor (`|`) está. */
function refsOf(text: string, engine: Engine = postgres): Ref[] {
  const { doc, at } = withoutCursor(text);
  return (analyzeAt(doc, at, engine)?.references ?? []).map(plain);
}

/** O que o cursor pede, como as sugestões o leem; `typed` é o que ele já escreveu (de onde a sugestão troca o texto até o cursor). */
type Pedido =
  | { kind: "none" }
  | { kind: "join"; typed: string }
  | { kind: "on"; table: { schema: string | null; name: string }; typed: string }
  | { kind: "member"; qualifier: string[]; typed: string };

const none: Pedido = { kind: "none" };
const join = (typed = ""): Pedido => ({ kind: "join", typed });
const on = (name: string, typed = "", schema: string | null = null): Pedido => ({ kind: "on", table: { schema, name }, typed });
const member = (qualifier: string[], typed = ""): Pedido => ({ kind: "member", qualifier, typed });

function pedidoDe(text: string, engine: Engine = postgres): Pedido {
  const { doc, at } = withoutCursor(text);
  const found = analyzeAt(doc, at, engine)?.context ?? { kind: "none" as const };
  if (found.kind === "none") return none;
  const typed = doc.slice(found.from, at);
  if (found.kind === "member") return { kind: "member", qualifier: found.qualifier, typed };
  if (found.kind === "join") return { kind: "join", typed };
  return { kind: "on", table: { schema: found.table.schema, name: found.table.name }, typed };
}

/** As tabelas que a junção pode usar no ponto do cursor (RN-SQL-025). */
function escopoDe(text: string, engine: Engine = postgres): Ref[] {
  const { doc, at } = withoutCursor(text);
  const analysis = analyzeAt(doc, at, engine);
  return analysis === null ? [] : joinScope(analysis).map(plain);
}

/** Os apelidos em uso, em ordem, e se o comando usa apelidos. */
function usadosDe(text: string, engine: Engine = postgres) {
  const { doc, at } = withoutCursor(text);
  const analysis = analyzeAt(doc, at, engine);
  return { used: [...(analysis?.used ?? [])].sort(), usesAliases: analysis?.usesAliases ?? false };
}

describe("a lista de tabelas do comando: vírgulas, junções e nomes (RN-SQL-025)", () => {
  it.each([
    ["FROM com vírgulas, com e sem AS", "select * from a, b c, d AS e where |", [r("from", "a"), r("from", "b", "c"), r("from", "d", "e")]],
    ["vírgula, tabela sem apelido e JOIN: a palavra join não é apelido", "select * from a x, b join c on 1=1 where |", [r("from", "a", "x"), r("from", "b"), r("join", "c")]],
    [
      "vários JOIN: inner, left outer, right, full e cross (o CROSS também traz tabela)",
      "select * from a inner join b on 1=1 left outer join c c2 on 1=1 right join d on 1=1 full join e as f on 1=1 cross join g h where |",
      [r("from", "a"), r("join", "b"), r("join", "c", "c2"), r("join", "d"), r("join", "e", "f"), r("join", "g", "h")],
    ],
    ["nomes entre aspas com ponto e espaço, no esquema e no nome", 'select * from "my.schema"."my table" "my alias" where |', [r("from", "my table", "my alias", "my.schema")]],
    ["aspa dobrada dentro do nome entre aspas", 'select * from "odd""name" where |', [r("from", 'odd"name')]],
    ["esquema entre aspas, nome sem aspas dobrado para minúsculas", 'select * from "ERP".Pedidos P where |', [r("from", "pedidos", "p", "ERP")]],
    ["UPDATE com AS no apelido", "update pedidos as p set x = 1 where |", [r("update", "pedidos", "p")]],
    ["UPDATE sem AS, o apelido antes do SET", "update pedidos a set |", [r("update", "pedidos", "a")]],
    ["UPDATE ... FROM: as duas listas, cada uma com o seu via", "update pedidos p set x = 1 from clientes c where |", [r("update", "pedidos", "p"), r("from", "clientes", "c")]],
    ["INSERT INTO sem nada depois", "insert into pedidos |", [r("into", "pedidos")]],
    ["INSERT INTO com VALUES: a palavra reservada não é apelido", "insert into pedidos values (1) |", [r("into", "pedidos")]],
    ["INSERT INTO com AS no apelido e lista de colunas", "insert into pedidos as p (id, cliente_id) values (1, 2) |", [r("into", "pedidos", "p")]],
    ["INSERT ... SELECT: o alvo é INTO, o FROM e o JOIN são FROM e JOIN", "insert into itens select * from pedidos p join clientes c on 1=1 |", [r("into", "itens"), r("from", "pedidos", "p"), r("join", "clientes", "c")]],
    ["DELETE sem apelido", "delete from pedidos where |", [r("from", "pedidos")]],
    ["FROM dentro de EXTRACT e SUBSTRING não é tabela", "select extract(year from p.criado) as ano, substring(p.nome from 1 for 3) from pedidos p join clientes c on 1=1 |", [r("from", "pedidos", "p"), r("join", "clientes", "c")]],
    ["subconsulta no FROM com AS: a subconsulta e o apelido dela não são tabela", "select * from (select 1 as x) as s, pedidos p where |", [r("from", "pedidos", "p")]],
    ["subconsulta no JOIN não é tabela; a junção seguinte entra", "select * from pedidos p join (select 1 as id) s on s.id = p.id join clientes c on 1=1 where |", [r("from", "pedidos", "p"), r("join", "clientes", "c")]],
    ["palavra reservada depois de AS não é apelido, e a junção seguinte continua", "select * from pedidos as order join clientes c on 1=1 where |", [r("from", "pedidos"), r("join", "clientes", "c")]],
    ["palavra reservada entre aspas é apelido, como está escrito", 'select * from pedidos as "order" join clientes c on 1=1 where |', [r("from", "pedidos", "order"), r("join", "clientes", "c")]],
    ["palavra reservada entre aspas, sem AS, também é apelido", 'select * from pedidos "select" where |', [r("from", "pedidos", "select")]],
    ["UNION não é apelido; o SELECT depois dele traz a sua tabela", "select * from pedidos union select * from clientes c join |", [r("from", "pedidos"), r("from", "clientes", "c")]],
    ["palavra de cláusula depois da tabela não é apelido (RETURNING)", "delete from pedidos returning id |", [r("from", "pedidos")]],
    ["subconsulta correlata: o nível do cursor é o dela, sem o alias de fora", "select * from pedidos p where exists (select 1 from itens i where i.pedido_id = p.|)", [r("from", "itens", "i")]],
    ["comentário de linha com FROM e JOIN não traz tabela; a quebra de linha acaba o comentário", "select * from pedidos p -- from x y join z\njoin clientes c on 1=1 where |", [r("from", "pedidos", "p"), r("join", "clientes", "c")]],
    ["comentário de bloco com FROM e JOIN não traz tabela", "select * from pedidos p /* from x y join z */ where |", [r("from", "pedidos", "p")]],
    ["texto com FROM e JOIN, com aspa dobrada, não traz tabela", "select 'it''s from x y join z' as t from pedidos p where |", [r("from", "pedidos", "p")]],
    ["E'' do PostgreSQL: a barra escapa a aspa, e o FROM continua texto", String.raw`select E'it\'s from x y' from pedidos p where |`, [r("from", "pedidos", "p")]],
    ["$$ do PostgreSQL: o FROM dentro é texto", "select $$ from x y $$ from pedidos p where |", [r("from", "pedidos", "p")]],
    ["ponto e vírgula dentro de texto não encerra o comando", "select ';' as s from pedidos p join clientes c on 1=1 where |", [r("from", "pedidos", "p"), r("join", "clientes", "c")]],
    ["ponto e vírgula dentro de comentário de linha não encerra; o de baixo encerra", "select * from antes a -- x; y\n;\nselect * from pedidos p join |", [r("from", "pedidos", "p")]],
    ["o cursor no segundo comando do script: só as tabelas dele", "select * from a x join b y on 1=1;\nselect * from pedidos p join clientes c on |;\nselect * from depois d", [r("from", "pedidos", "p"), r("join", "clientes", "c")]],
    ["comentário de bloco aninhado: o PostgreSQL só fecha no segundo */", "select /* a /* b */ from x y */ from pedidos p where |", [r("from", "pedidos", "p")]],
  ])("%s", (_name, text, expected) => {
    expect(refsOf(text)).toEqual(expected);
  });
});

describe("a lista de tabelas nos outros bancos (Db2 e Informix)", () => {
  it.each([
    ["Db2: palavras-chave e nomes sem aspas em maiúsculas", db2, "SELECT * FROM ERP.PEDIDOS P LEFT OUTER JOIN CLIENTES AS C ON 1=1 WHERE |", [r("from", "PEDIDOS", "P", "ERP"), r("join", "CLIENTES", "C")]],
    ["Db2: nomes sem aspas dobram para maiúsculas, com o esquema", db2, "select * from erp.pedidos p join clientes c on 1=1 where |", [r("from", "PEDIDOS", "P", "ERP"), r("join", "CLIENTES", "C")]],
    ["Db2: nome entre aspas vale como está; o resto dobra", db2, 'select * from "erp".pedidos p join "Clientes" c on 1=1 where |', [r("from", "PEDIDOS", "P", "erp"), r("join", "Clientes", "C")]],
    ["Db2: palavra reservada entre aspas é apelido, como está escrito", db2, 'select * from pedidos "ORDER" where |', [r("from", "PEDIDOS", "ORDER")]],
    ["Db2: comentário de bloco aninha, como no PostgreSQL", db2, "select /* a /* b */ from x y */ from pedidos p where |", [r("from", "PEDIDOS", "P")]],
    ["Informix: nomes sem aspas dobram para minúsculas", informix, "SELECT * FROM ERP.Pedidos P JOIN CLIENTES C ON 1=1 WHERE |", [r("from", "pedidos", "p", "erp"), r("join", "clientes", "c")]],
    ["Informix: o comentário de bloco fecha no primeiro */", informix, "select /* a /* b */ from x y */ from pedidos p where |", [r("from", "x", "y"), r("from", "pedidos", "p")]],
    ["Informix: { } também é comentário", informix, "select { from x y } from pedidos p where |", [r("from", "pedidos", "p")]],
  ])("%s", (_name, engine, text, expected) => {
    expect(refsOf(text, engine)).toEqual(expected);
  });
});

describe("o pedido do cursor: JOIN, ON e nome. (RN-SQL-025)", () => {
  it.each([
    ["LEFT OUTER JOIN com quebra de linha entre as palavras", "select *\nfrom pedidos p\nleft\nouter\njoin |", join()],
    ["FULL JOIN sem OUTER", "select * from pedidos p full join |", join()],
    ["RIGHT OUTER JOIN", "select * from pedidos p right outer join |", join()],
    ["INNER JOIN com letras", "select * from pedidos p inner join cli|", join("cli")],
    ["CROSS JOIN em duas linhas não é junção", "select * from pedidos p cross\njoin |", none],
    ["CROSS JOIN com letras não é junção", "select * from pedidos p cross join cli|", none],
    ["JOIN depois de comentário de bloco", "select * from pedidos p /* x */ join |", join()],
    ["ON depois de comentário de bloco", "select * from pedidos p join clientes c /* cond */ on |", on("clientes")],
    ['ON com esquema e nome entre aspas, com ponto e espaço', 'select * from pedidos p join "my.schema"."my table" "my alias" on |', on("my table", "", "my.schema")],
    ["ON com nome entre aspas parcialmente digitado", 'select * from pedidos p join clientes c on "Cli|', on("clientes", '"Cli')],
    ["ON em outra linha, com letras", "select *\nfrom pedidos p\njoin clientes c\non cl|", on("clientes", "cl")],
    ["ON de tabela com esquema e sem apelido", "select * from pedidos join erp.clientes on |", on("clientes", "", "erp")],
    ["ON sem espaço depois da palavra on: ainda não é ON", "select * from pedidos p join clientes c on|", none],
    ["ON depois de JOIN com subconsulta: a subconsulta não é tabela, nada", "select * from pedidos p join (select 1 as id) s on |", none],
    ["ON sem JOIN, depois de vírgula, não é junção", "select * from pedidos p, clientes c on |", none],
    ["vírgula na lista do FROM não é junção", "select * from pedidos p, |", none],
    ["JOIN dentro de texto antes do cursor não conta", "select 'a join' from pedidos p join |", join()],
    ["ON dentro de texto não", "select * from pedidos p join clientes c where x = 'on |'", none],
    ["ON depois de texto que tem a palavra on", "select 'x on' from pedidos p join clientes c on |", on("clientes")],
    ["JOIN no segundo comando, depois de um ponto e vírgula", "select 1;\nselect * from pedidos p left outer join |", join()],
    ["JOIN dentro de subconsulta do FROM", "select * from (select * from pedidos p join |) s", join()],
    ["UPDATE com FROM e JOIN", "update pedidos p set x = 1 from clientes c join |", join()],
    ["INSERT INTO não tem junção", "insert into pedidos |", none],
    ["UPDATE com apelido, depois do SET: nada", "update pedidos a set |", none],
    ["nome entre aspas com ponto, depois do ponto", 'select "a.b".| from t', member(["a.b"])],
    ["esquema e tabela entre aspas, depois do ponto", 'select "ERP"."Pedidos".| from "ERP"."Pedidos"', member(["ERP", "Pedidos"])],
    ["nome entre aspas com espaço, depois do ponto", 'select "my table".| from "my table" t', member(["my table"])],
    ["nome com dígito e sublinhado, com letras depois do ponto", "select c_1.na| from x c_1", member(["c_1"], "na")],
    ["duas partes com letras depois do ponto", "select erp.pedidos.pe| from erp.pedidos", member(["erp", "pedidos"], "pe")],
    ["nome de tabela sem apelido, depois de JOIN e do ponto", "select * from pedidos p join clientes.|", member(["clientes"])],
    ["alias no ON, depois do ponto", "select * from pedidos p join clientes c on c.|", member(["c"])],
    ["alias no UPDATE, depois do ponto", "update pedidos a set a.|", member(["a"])],
    ["no segundo comando, o alias do primeiro não conta: é só o nome", "select * from antes a;\nselect a.|", member(["a"])],
    ["dentro de subconsulta, o ponto do alias de fora ainda é o pedido de nome.", "select * from pedidos p where exists (select 1 from itens i where i.pedido_id = p.|)", member(["p"])],
    ["ponto depois de texto que já fechou é o nome", "select * from pedidos p where x = 'pedidos.' and p.|", member(["p"])],
    ["nome. dentro de texto não", "select * from pedidos p where x = 'ver pedidos.|'", none],
    ["aspa dobrada dentro de texto: o nome. ainda é texto", "select * from pedidos p where x = 'a''p.|", none],
    ["E'' com barra que escapa a aspa: ainda é texto", "select * from pedidos p where x = E'\\'p.|'", none],
    ["nome entre aspas com ponto, dentro de texto, não", `select * from pedidos p where x = '"p".|'`, none],
  ])("%s", (_name, text, expected) => {
    expect(pedidoDe(text)).toEqual(expected);
  });
});

describe("o pedido do cursor nos outros bancos (Db2 e Informix)", () => {
  it.each([
    ["Db2: JOIN em maiúsculas com letras", db2, "SELECT * FROM PEDIDOS P JOIN CLI|", join("CLI")],
    ["Db2: ON com o nome da tabela em maiúsculas", db2, "SELECT * FROM PEDIDOS P JOIN CLIENTES C ON |", on("CLIENTES")],
    ["Db2: LEFT OUTER JOIN, e o ponto depois do alias em maiúsculas", db2, "SELECT * FROM PEDIDOS P LEFT OUTER JOIN CLIENTES C ON C.|", member(["C"])],
    ["Db2: CROSS JOIN em maiúsculas não é junção", db2, "SELECT * FROM PEDIDOS P CROSS JOIN |", none],
    ["Db2: qualificador entre aspas mantém as minúsculas", db2, 'select "p".| from PEDIDOS "p"', member(["p"])],
    ["Db2: ON com a tabela entre aspas", db2, 'select * from pedidos p join "Clientes" c on |', on("Clientes")],
    ["Informix: o ponto depois do alias em maiúsculas dobra para minúsculas", informix, "SELECT * FROM Pedidos P JOIN Clientes C ON C.|", member(["c"])],
    ["Informix: { } é comentário, e o JOIN depois dele conta", informix, "select * from pedidos p { join x } join |", join()],
  ])("%s", (_name, engine, text, expected) => {
    expect(pedidoDe(text, engine)).toEqual(expected);
  });
});

describe("os apelidos em uso (o apelido novo não pode repetir estes)", () => {
  it.each([
    ["sem apelido: o nome da tabela em minúsculas, sem o esquema", postgres, 'select * from erp.pedidos join "My Table" on |', ["my table", "pedidos"], false],
    ["Db2: apelido em maiúsculas dobrado para minúsculas, e o nome sem apelido", db2, "select * from erp.pedidos P join clientes on 1=1 |", ["clientes", "p"], true],
    ["apelido entre aspas que é palavra reservada", postgres, 'select * from pedidos "order" join clientes c on |', ["c", "order"], true],
    ["palavra reservada depois de AS não é apelido: a tabela fica sem", postgres, "select * from pedidos as order join clientes on |", ["clientes", "pedidos"], false],
  ])("%s", (_name, engine, text, used, usesAliases) => {
    expect(usadosDe(text, engine)).toEqual({ used, usesAliases });
  });
});

describe("as tabelas que a junção pode usar (RN-SQL-025)", () => {
  it.each([
    ["depois de JOIN com lista de vírgulas: todas as de antes", "select * from a x, b y join |", [r("from", "a", "x"), r("from", "b", "y")]],
    ["depois de ON: a lista de vírgulas antes da tabela do JOIN", "select * from a x, b y join c z on |", [r("from", "a", "x"), r("from", "b", "y")]],
    ["depois de ON: as junções anteriores entram, a própria não", "select * from a x join b y on 1=1 join c z on |", [r("from", "a", "x"), r("join", "b", "y")]],
    ["depois de JOIN com subconsulta antes: a subconsulta fica de fora", "select * from (select 1) s join pedidos p join |", [r("join", "pedidos", "p")]],
    ["CROSS JOIN não é junção: nada", "select * from a x cross join |", []],
    ["depois de JOIN, tabela com esquema e nome entre aspas", 'select * from "my.schema"."my table" t join |', [r("from", "my table", "t", "my.schema")]],
  ])("%s", (_name, text, expected) => {
    expect(escopoDe(text)).toEqual(expected);
  });
});
