import { describe, expect, it } from "vitest";

import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";

import type { DatabaseObject } from "./database-sessions.schema";
import { childrenKey, clickEffect, columnNodes, flattenVisible, foreignKeyNodes, indexNodes, isFocusable, navKey, objectNodes, ownerConnectionId, parseNavKey, schemaNodes, tabbableKey, tableGroupNodes, tableTargetOf, treeNodes, type LevelState, type NavNode, type NavPath } from "./navigator-model";

const connectionPath: NavPath = { type: "connection", connectionId: "c1" };
const databasePath: NavPath = { type: "database", connectionId: "c1" };

function node(path: NavPath, label: string, extra: Partial<NavNode> = {}): NavNode {
  return { key: navKey(path), kind: "connection", label, depth: 0, hasChildren: true, ...extra };
}

function levels(...entries: [NavNode, LevelState][]): Map<string, LevelState> {
  return new Map(entries.map(([parent, state]) => [childrenKey(parent), state]));
}

const database = node(databasePath, "mes", { kind: "database" });
const connection = node(connectionPath, "MES Produção");

describe("flattenVisible", () => {
  it("nó fechado não mostra filhos", () => {
    const rows = flattenVisible([connection], new Set(), levels([connection, { status: "loaded", children: [database] }]));

    expect(rows.map((row) => row.label)).toEqual(["MES Produção"]);
  });

  it("nó aberto e carregado mostra os filhos com depth + 1", () => {
    const rows = flattenVisible([connection], new Set([connection.key]), levels([connection, { status: "loaded", children: [database] }]));

    expect(rows.map((row) => [row.label, row.depth])).toEqual([
      ["MES Produção", 0],
      ["mes", 1],
    ]);
  });

  it("os filhos de um filho aberto descem mais um nível, qualquer que seja a profundidade que o filho trazia", () => {
    const schema = node({ type: "schema", connectionId: "c1", schema: "public" }, "public", { kind: "schema", depth: 7 });
    const rows = flattenVisible(
      [connection],
      new Set([connection.key, database.key]),
      levels([connection, { status: "loaded", children: [database] }], [database, { status: "loaded", children: [schema] }]),
    );

    expect(rows.map((row) => [row.label, row.depth])).toEqual([
      ["MES Produção", 0],
      ["mes", 1],
      ["public", 2],
    ]);
  });

  it("nó aberto ainda não carregado mostra uma linha Carregando…", () => {
    const rows = flattenVisible([connection], new Set([connection.key]), new Map());

    expect(rows.map((row) => [row.kind, row.label, row.depth])).toEqual([
      ["connection", "MES Produção", 0],
      ["loading", "Carregando…", 1],
    ]);
  });

  it("nó com erro mostra uma linha de erro com a mensagem, ligada ao nó para tentar de novo", () => {
    const rows = flattenVisible([connection], new Set([connection.key]), levels([connection, { status: "error", message: 'password authentication failed for user "mes"' }]));

    expect(rows[1]).toMatchObject({ kind: "error", label: 'password authentication failed for user "mes"', depth: 1, hasChildren: false, retryKey: connection.key });
  });

  it("a linha de erro leva o código da API, quando há: é por ele que a árvore oferece 'Instalar driver' (RN-DRIVER-006)", () => {
    const rows = flattenVisible([connection], new Set([connection.key]), levels([connection, { status: "error", message: "O driver do IBM Data Server não está instalado.", code: "DRIVER_NOT_INSTALLED" }]));

    expect(rows[1]).toMatchObject({ kind: "error", label: "O driver do IBM Data Server não está instalado.", retryKey: connection.key, errorCode: "DRIVER_NOT_INSTALLED" });
    expect(flattenVisible([connection], new Set([connection.key]), levels([connection, { status: "error", message: "fora do ar" }]))[1].errorCode).toBeUndefined();
  });

  it("e o driver que falta (`driverID` do 422), para o link apontar a linha dele na tela de Drivers", () => {
    const rows = flattenVisible([connection], new Set([connection.key]), levels([connection, { status: "error", message: "falta", code: "DRIVER_NOT_INSTALLED", driverID: "ibm-data-server" }]));

    expect(rows[1].errorDriverID).toBe("ibm-data-server");
  });

  it("nó sem filhos (hasChildren falso) não abre, mesmo estando na lista de abertos", () => {
    const leaf = node({ type: "folder", id: "f" }, "vazia", { kind: "folder", hasChildren: false });

    expect(flattenVisible([leaf], new Set([leaf.key]), new Map())).toHaveLength(1);
  });

  it("o grupo aberto e carregado mostra quantos filhos tem", () => {
    const group = node({ type: "objects", connectionId: "c1", schema: "public", objects: "tables" }, "Tabelas", { kind: "group" });
    const tables = objectNodes("c1", "public", "tables", [
      { name: "a", kind: "table" },
      { name: "b", kind: "table" },
    ]);

    const open = flattenVisible([group], new Set([group.key]), levels([group, { status: "loaded", children: tables }]));
    const closed = flattenVisible([group], new Set(), levels([group, { status: "loaded", children: tables }]));

    expect(open[0].detail).toBe("2");
    expect(closed[0].detail).toBeUndefined();
  });

  // Sem relógio: a medida "menos de 50 ms" falhava de vez em quando com a máquina carregada. O que a árvore de milhares de tabelas precisa é que o achatamento
  // seja UMA passada, e isso se conta: quantas vezes ele pergunta se um nó está aberto e quantas vezes busca um nível, por linha devolvida.
  it("5.000 e 10.000 tabelas achatam numa passada só: no máximo duas perguntas por linha, e o dobro de linhas custa o dobro", () => {
    function cost(count: number) {
      const group = node({ type: "objects", connectionId: "c1", schema: "public", objects: "tables" }, "Tabelas", { kind: "group" });
      const objects: DatabaseObject[] = Array.from({ length: count }, (_, index) => ({ name: `tabela_${index}`, kind: "table" }));
      const counted = { asked: 0, fetched: 0 };

      class CountingSet extends Set<string> {
        override has(key: string): boolean {
          counted.asked++;
          return super.has(key);
        }
      }
      class CountingMap extends Map<string, LevelState> {
        override get(key: string): LevelState | undefined {
          counted.fetched++;
          return super.get(key);
        }
      }

      const rows = flattenVisible([group], new CountingSet([group.key]), new CountingMap(levels([group, { status: "loaded", children: objectNodes("c1", "public", "tables", objects) }])));
      return { rows: rows.length, ...counted };
    }

    const small = cost(5000);
    const large = cost(10_000);

    expect(small.rows).toBe(5001);
    expect(large.rows).toBe(10_001);
    for (const { rows, asked, fetched } of [small, large]) {
      expect(asked).toBeLessThanOrEqual(2 * rows);
      expect(fetched).toBeLessThanOrEqual(rows);
    }
    // Linear: o dobro de tabelas não custa mais que o dobro de perguntas (uma passada quadrática custaria o quádruplo).
    expect(large.asked + large.fetched).toBeLessThanOrEqual(2 * (small.asked + small.fetched));
  });
});

describe("schemaNodes", () => {
  it("esquemas comuns vêm antes dos de sistema, cada grupo em ordem alfabética", () => {
    const nodes = schemaNodes("c1", [
      { name: "pg_catalog", isSystem: true },
      { name: "vendas", isSystem: false },
      { name: "information_schema", isSystem: true },
      { name: "Álamo", isSystem: false },
      { name: "public", isSystem: false },
    ]);

    expect(nodes.map((schema) => schema.label)).toEqual(["Álamo", "public", "vendas", "information_schema", "pg_catalog"]);
  });

  it("o esquema de sistema é marcado como tal", () => {
    const [common, system] = schemaNodes("c1", [
      { name: "public", isSystem: false },
      { name: "pg_catalog", isSystem: true },
    ]);

    expect(common.detail).toBeUndefined();
    expect(system.detail).toBe("sistema");
  });
});

describe("chaves", () => {
  it("tabelas de mesmo nome em esquemas diferentes têm chaves diferentes", () => {
    const [inPublic] = objectNodes("c1", "public", "tables", [{ name: "pedido", kind: "table" }]);
    const [inVendas] = objectNodes("c1", "vendas", "tables", [{ name: "pedido", kind: "table" }]);

    expect(inPublic.key).not.toBe(inVendas.key);
  });

  it("a mesma tabela em conexões diferentes também", () => {
    const [first] = objectNodes("c1", "public", "tables", [{ name: "pedido", kind: "table" }]);
    const [second] = objectNodes("c2", "public", "tables", [{ name: "pedido", kind: "table" }]);

    expect(first.key).not.toBe(second.key);
  });

  it("rotinas sobrecarregadas (mesmo nome duas vezes) não repetem a chave", () => {
    const nodes = objectNodes("c1", "public", "routines", [
      { name: "soma", kind: "function" },
      { name: "soma", kind: "function" },
    ]);

    expect(new Set(nodes.map((routine) => routine.key)).size).toBe(2);
  });

  it("a chave de um nome com aspas, barra e espaço volta ao caminho que a gerou", () => {
    const path: NavPath = { type: "table", connectionId: "c1", schema: 'Vendas "2026"', table: "a/b c" };

    expect(parseNavKey(navKey(path))).toEqual(path);
  });
});

describe("filhos de um nível", () => {
  it("só tabelas abrem; visões e rotinas são folhas, e a rotina diz se é procedimento ou função", () => {
    const [table] = objectNodes("c1", "public", "tables", [{ name: "t", kind: "table" }]);
    const [view] = objectNodes("c1", "public", "views", [{ name: "v", kind: "view" }]);
    const [procedure, fn] = objectNodes("c1", "public", "routines", [
      { name: "p", kind: "procedure" },
      { name: "q", kind: "function" },
    ]);

    expect([table.kind, table.hasChildren]).toEqual(["table", true]);
    expect([view.kind, view.hasChildren]).toEqual(["view", false]);
    expect([procedure.kind, procedure.detail, procedure.hasChildren]).toEqual(["routine", "procedimento", false]);
    expect(fn.detail).toBe("função");
  });

  it("as três listas de uma tabela são Colunas, Índices e Chaves estrangeiras", () => {
    expect(tableGroupNodes("c1", "public", "t").map((group) => group.label)).toEqual(["Colunas", "Índices", "Chaves estrangeiras"]);
  });

  const columnsPath: Extract<NavPath, { type: "tableLevel" }> = { type: "tableLevel", connectionId: "c1", schema: "public", table: "t", level: "columns" };

  it("coluna mostra nome, tipo, nulo quando aceita e a marca da chave primária, na ordem da posição", () => {
    const nodes = columnNodes(columnsPath, [
      { name: "obs", type: "text", isNullable: true, isPrimaryKey: false, position: 2 },
      { name: "id", type: "uuid", isNullable: false, isPrimaryKey: true, position: 1 },
    ]);

    expect(nodes.map((column) => [column.label, column.detail, column.badge])).toEqual([
      ["id", "uuid", "PK"],
      ["obs", "text · nulo", undefined],
    ]);
  });

  it("índice mostra as colunas e a marca de único", () => {
    const nodes = indexNodes({ ...columnsPath, level: "indexes" }, [
      { name: "pk_t", columns: ["id"], isUnique: true },
      { name: "ix_t_obs", columns: ["obs", "id"], isUnique: false },
    ]);

    expect(nodes.map((index) => [index.label, index.detail, index.badge])).toEqual([
      ["pk_t", "id", "único"],
      ["ix_t_obs", "obs, id", undefined],
    ]);
  });

  it("chave estrangeira mostra colunas → tabela(colunas), e o esquema só quando é outro", () => {
    const nodes = foreignKeyNodes({ ...columnsPath, level: "foreignKeys" }, [
      { name: "fk_a", columns: ["a_id"], referencedSchema: "public", referencedTable: "a", referencedColumns: ["id"] },
      { name: "fk_b", columns: ["x", "y"], referencedSchema: "ref", referencedTable: "b", referencedColumns: ["x", "y"] },
    ]);

    expect(nodes.map((fk) => fk.detail)).toEqual(["a_id → a(id)", "x, y → ref.b(x, y)"]);
  });

  it("nomes que vêm do banco ficam como estão: texto, nunca tratados como marcação", () => {
    const [column] = columnNodes(columnsPath, [{ name: "<img src=x onerror=alert(1)>", type: "text", isNullable: false, isPrimaryKey: false, position: 1 }]);

    expect(column.label).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("treeNodes", () => {
  const now = "2026-10-09T12:00:00Z";
  const folder: Folder = { id: "f1", parentID: null, name: "Fábrica", createdAt: now, updatedAt: now };
  const mes: Connection = { id: "c1", folderID: "f1", name: "MES", engine: 1, host: "srv", port: 5432, database: "mes", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, createdAt: now, updatedAt: now };

  it("a pasta guarda as conexões como filhos; a conexão na raiz fica na raiz", () => {
    const solo = { ...mes, id: "c2", name: "Solta", folderID: null };
    const { roots, levels: tree } = treeNodes(buildConnectionTree([folder], [mes, solo]));

    expect(roots.map((root) => [root.kind, root.label])).toEqual([
      ["folder", "Fábrica"],
      ["connection", "Solta"],
    ]);

    const state = tree.get(childrenKey(roots[0]));
    expect(state?.status === "loaded" && state.children.map((child) => [child.kind, child.label])).toEqual([["connection", "MES"]]);
  });

  it("a pasta sem nada dentro não abre", () => {
    const { roots } = treeNodes(buildConnectionTree([folder], []));

    expect(roots[0].hasChildren).toBe(false);
  });
});

describe("tabbableKey (a linha que o Tab alcança)", () => {
  const first = node({ type: "connection", connectionId: "c1" }, "Primeira");
  const second = node({ type: "connection", connectionId: "c2" }, "Segunda");
  const failed = flattenVisible([second], new Set([second.key]), levels([second, { status: "error", message: "falhou" }]))[1];
  const loading = flattenVisible([second], new Set([second.key]), new Map())[1];

  it("a linha de erro recebe foco, a de Carregando… não", () => {
    expect(failed.kind).toBe("error");
    expect(isFocusable(failed)).toBe(true);
    expect(loading.kind).toBe("loading");
    expect(isFocusable(loading)).toBe(false);
  });

  it("a linha selecionada é a tabbable, se está entre as desenhadas", () => {
    expect(tabbableKey([first, second], second.key, [0, 1])).toBe(second.key);
  });

  it("a linha de erro selecionada é alcançável, como qualquer outra", () => {
    expect(tabbableKey([second, failed], failed.key, [0, 1])).toBe(failed.key);
  });

  it("a selecionada que rolou para fora das linhas desenhadas cai na primeira desenhada, para o Tab não pular a árvore", () => {
    const rows = [first, second, failed];

    expect(tabbableKey(rows, first.key, [1, 2])).toBe(second.key);
  });

  it("sem seleção, é a primeira desenhada que recebe foco (a de Carregando… não conta)", () => {
    expect(tabbableKey([loading, first, second], null, [0, 1, 2])).toBe(first.key);
  });

  it("a que sumiu da lista (o erro passou) também cai na primeira desenhada", () => {
    expect(tabbableKey([first, second], failed.key, [0, 1])).toBe(first.key);
  });

  it("nada desenhado, nada tabbable", () => {
    expect(tabbableKey([first], first.key, [])).toBeNull();
  });
});

describe("tableTargetOf (RN-TABELA-001)", () => {
  it("a tabela traz a conexão, o esquema e o nome da própria chave", () => {
    const [table] = objectNodes("c1", "vendas", "tables", [{ name: "pedido", kind: "table" }]);

    expect(tableTargetOf(table)).toEqual({ connectionId: "c1", schema: "vendas", name: "pedido" });
  });

  it("a visão não tem o nome na chave (a chave é o caminho do pai mais a posição): o nome sai do rótulo, o esquema do pai", () => {
    const [, view] = objectNodes("c2", "vendas", "views", [
      { name: "a", kind: "view" },
      { name: "v_pedidos", kind: "view" },
    ]);

    expect(tableTargetOf(view)).toEqual({ connectionId: "c2", schema: "vendas", name: "v_pedidos" });
  });

  it("nome de esquema com '#', aspas e barra não confunde o corte da chave da visão", () => {
    const [view] = objectNodes("c3", 'a#b "c"/d', "views", [{ name: "v#1", kind: "view" }]);

    expect(tableTargetOf(view)).toEqual({ connectionId: "c3", schema: 'a#b "c"/d', name: "v#1" });
  });

  it("rotina, coluna, grupo, conexão e as linhas de aviso não têm aba de tabela", () => {
    const [routine] = objectNodes("c1", "public", "routines", [{ name: "soma", kind: "function" }]);
    const [column] = columnNodes({ type: "tableLevel", connectionId: "c1", schema: "public", table: "t", level: "columns" }, [{ name: "id", type: "uuid", isNullable: false, isPrimaryKey: true, position: 1 }]);
    const [group] = tableGroupNodes("c1", "public", "t");
    const loading = flattenVisible([connection], new Set([connection.key]), new Map())[1];

    for (const other of [routine, column, group, connection, database, loading]) expect(tableTargetOf(other)).toBeNull();
  });
});

describe("clickEffect (a política do clique e do duplo clique)", () => {
  const [table] = objectNodes("c1", "public", "tables", [{ name: "pedido", kind: "table" }]);
  const [view] = objectNodes("c1", "public", "views", [{ name: "v", kind: "view" }]);
  const [group] = tableGroupNodes("c1", "public", "pedido");
  const name = (detail: number) => ({ detail, onChevron: false });
  const chevron = (detail: number) => ({ detail, onChevron: true });

  it("a conexão, o esquema e o grupo alternam no clique", () => {
    for (const node of [connection, group]) expect(clickEffect(node, name(1))).toBe("toggle");
  });

  it("o segundo clique de um duplo clique não alterna de novo: o nó não abre e fecha", () => {
    for (const node of [connection, group]) {
      expect(clickEffect(node, name(2))).toBe("none");
      expect(clickEffect(node, name(3))).toBe("none");
    }
  });

  it("o chevron alterna sempre, até no segundo clique seguido", () => {
    expect(clickEffect(connection, chevron(1))).toBe("toggle");
    expect(clickEffect(connection, chevron(2))).toBe("toggle");
  });

  it("o clique que veio do teclado (Espaço, sem contagem) alterna", () => {
    expect(clickEffect(connection, name(0))).toBe("toggle");
  });

  it("na tabela o clique no nome só seleciona (o duplo clique abre a aba, não a árvore); o chevron e o Espaço abrem os filhos", () => {
    expect(clickEffect(table, name(1))).toBe("none");
    expect(clickEffect(table, name(2))).toBe("none");
    expect(clickEffect(table, chevron(1))).toBe("toggle");
    expect(clickEffect(table, name(0))).toBe("toggle");
  });

  it("linha sem filhos (a visão) nunca alterna", () => {
    expect(clickEffect(view, name(1))).toBe("none");
    expect(clickEffect(view, chevron(1))).toBe("none");
  });
});

describe("ownerConnectionId (as ações do menu sabem de qual conexão a linha é)", () => {
  const folder = node({ type: "folder", id: "f" }, "Fábrica", { kind: "folder" });
  const schema = node({ type: "schema", connectionId: "c9", schema: "public" }, "public", { kind: "schema" });
  const [table] = objectNodes("c9", "public", "tables", [{ name: "t", kind: "table" }]);
  const [view] = objectNodes("c9", "public", "views", [{ name: "v", kind: "view" }]);
  const [routine] = objectNodes("c9", "public", "routines", [{ name: "r", kind: "function" }]);
  const [tablesGroup] = [node({ type: "objects", connectionId: "c9", schema: "public", objects: "tables" }, "Tabelas", { kind: "group" })];
  const [columnsGroup] = tableGroupNodes("c9", "public", "t");

  it("conexão, banco, esquema, grupos, tabela e visão trazem o id da conexão da própria chave", () => {
    const nodes = [node({ type: "connection", connectionId: "c9" }, "MES"), node({ type: "database", connectionId: "c9" }, "mes", { kind: "database" }), schema, tablesGroup, columnsGroup, table, view];

    expect(nodes.map(ownerConnectionId)).toEqual(Array(7).fill("c9"));
  });

  it("pasta, rotina e as linhas de aviso não têm conexão que as ações usem", () => {
    const loading = flattenVisible([connection], new Set([connection.key]), new Map())[1];

    expect([folder, routine, loading].map(ownerConnectionId)).toEqual([null, null, null]);
  });
});
