import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

import { treeKey, type FetchedPath } from "./database-sessions.service";
import { childrenKey, columnNodes, databaseNodes, navKey, objectNodes, parseNavKey, schemaGroupNodes, schemaNodes, tableGroupNodes, treeNodes, type LevelState, type NavNode, type NavPath } from "./navigator-model";
import { cachedTree, findMatch, fold, levelPathOf, loadedLevels, searchTree } from "./navigator-search";

describe("fold (sem caixa e sem acento)", () => {
  it("tira a caixa e o acento", () => {
    expect(fold("Produção")).toBe("producao");
    expect(fold("ÁRVORE Não")).toBe("arvore nao");
    expect(fold("coração")).toBe("coracao");
  });

  it("o nome comum de banco fica como está, só em minúsculas", () => {
    expect(fold("ORDEM_PRODUCAO")).toBe("ordem_producao");
  });
});

describe("findMatch (onde o termo casou, em posições do rótulo)", () => {
  const needle = (text: string) => fold(text);

  it("casa sem diferenciar maiúsculas", () => {
    expect(findMatch("Apontamento", needle("PONTA"))).toEqual([1, 6]);
    expect(findMatch("ordem_producao", needle("Ordem"))).toEqual([0, 5]);
  });

  it("casa sem diferenciar acento, nos dois sentidos, e o trecho tem o tamanho do rótulo", () => {
    expect(findMatch("Produção Extra", needle("producao"))).toEqual([0, 8]);
    expect(findMatch("producao", needle("PRODUÇÃO"))).toEqual([0, 8]);
    expect(findMatch("Área útil", needle("ut"))).toEqual([5, 7]);
  });

  it("o acento solto (decomposto, como alguns bancos devolvem) leva o acento junto no destaque", () => {
    const decomposed = "Produção"; // c + cedilha, a + til
    expect(decomposed).toHaveLength(10);

    expect(findMatch(decomposed, needle("producao"))).toEqual([0, 10]);
    expect(findMatch(decomposed, needle("duca"))).toEqual([3, 9]);
  });

  it("não casa o que não está no nome; casa só a primeira ocorrência", () => {
    expect(findMatch("pedido", needle("xyz"))).toBeNull();
    expect(findMatch("pedido_pedido", needle("ped"))).toEqual([0, 3]);
  });

  it("espaço dentro do termo conta (a busca é por trecho, não por palavras)", () => {
    expect(findMatch("Produção Extra", needle("o ex"))).toEqual([7, 11]);
  });

  it("emoji e caractere fora do plano básico não desalinham o trecho", () => {
    expect(findMatch("📦 caixa", needle("caixa"))).toEqual([3, 8]);
  });

  it("o trecho achado, dobrado, contém sempre o termo: acento composto, decomposto, hangul (que se expande), emoji e mistura", () => {
    const labels = ["Produção", "Produção Ação", "한글 테이블", "📦 Caixa Grande", "ÀÉÎÕÜ_çÇ", "mix́ed Tést", "İstanbul ß"];

    for (const label of labels) {
      const folded = fold(label);
      for (let start = 0; start < folded.length; start++) {
        for (const length of [1, 2, 4]) {
          const term = folded.slice(start, start + length);
          if (term.trim() === "") continue;

          const range = findMatch(label, term);
          expect(range, `${label} / ${term}`).not.toBeNull();
          expect(fold(label.slice(range![0], range![1])).includes(term), `${label} / ${term} / ${JSON.stringify(range)}`).toBe(true);
        }
      }
    }
  });
});

describe("levelPathOf (a chave de uma consulta da árvore, de volta ao nó)", () => {
  it.each<FetchedPath>([
    { type: "connection", connectionId: "c1" },
    { type: "database", connectionId: "c1" },
    { type: "database", connectionId: "c1", database: "arquivo morto" },
    { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" },
    { type: "objects", connectionId: "c1", database: "arquivo", schema: "vendas", objects: "routines" },
    { type: "tableLevel", connectionId: "c1", database: "arquivo", schema: "vendas", table: "pedido", level: "columns" },
    { type: "objects", connectionId: "c1", schema: "a b/c", objects: "views" },
    { type: "tableLevel", connectionId: "c1", schema: "vendas", table: "pedido", level: "foreignKeys" },
  ])("é o inverso de treeKey: %j", (path) => {
    expect(levelPathOf(treeKey(path))).toEqual(path);
  });

  it("chave que não é de nível da árvore não vira caminho", () => {
    expect(levelPathOf(["database-session", "c1"])).toBeNull();
    expect(levelPathOf(["tree", "c1"])).toBeNull();
    expect(levelPathOf(["tree", "c1", { database: "arquivo" }])).toBeNull();
    expect(levelPathOf(["tree", "c1", { database: "arquivo" }, "schema", "s", "objects"])).toBeNull();
    expect(levelPathOf(["tree", "c1", "schema", "s", "objects"])).toBeNull();
  });
});

// --- a árvore de exemplo --------------------------------------------------------------------------------------------

const now = "2026-10-09T12:00:00Z";
const folder: Folder = { id: "f1", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const connection = (id: string, name: string, folderID: string | null): Connection => ({ id, folderID, name, engine: 1, host: "srv", port: 5432, database: "mes", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now });

const base = treeNodes(buildConnectionTree([folder], [connection("c1", "MES Produção", "f1"), connection("c2", "ERP", null)]));
const loaded = (children: NavNode[]): LevelState => ({ status: "loaded", children });
const key = (path: NavPath) => navKey(path);

const tables = objectNodes("c1", "producao", "tables", ["apontamento", "linha", "maquina", "operador", "ordem_producao", "produto", "Produção Extra"].map((name) => ({ name, kind: "table" as const })));
const views = objectNodes("c1", "producao", "views", [{ name: "v_ordens_abertas", kind: "view" }]);
const columns = columnNodes({ type: "tableLevel", connectionId: "c1", schema: "producao", table: "apontamento", level: "columns" }, [
  { name: "id", type: "uuid", isNullable: false, isPrimaryKey: true, position: 1 },
  { name: "ordem_id", type: "uuid", isNullable: false, isPrimaryKey: false, position: 2 },
]);

/** O que o componente entrega à busca: as consultas da árvore já guardadas, a começar pela lista dos bancos da conexão (RN-ARVORE-006). */
const cached = [
  { key: treeKey({ type: "connection", connectionId: "c1" }), nodes: databaseNodes("c1", [{ name: "mes", isCurrent: true }]) },
  { key: treeKey({ type: "database", connectionId: "c1" }), nodes: schemaNodes("c1", [{ name: "producao", isSystem: false }, { name: "public", isSystem: false }, { name: "pg_catalog", isSystem: true }]) },
  { key: treeKey({ type: "objects", connectionId: "c1", schema: "producao", objects: "tables" }), nodes: tables },
  { key: treeKey({ type: "objects", connectionId: "c1", schema: "producao", objects: "views" }), nodes: views },
  { key: treeKey({ type: "tableLevel", connectionId: "c1", schema: "producao", table: "apontamento", level: "columns" }), nodes: columns },
];
const levels = loadedLevels(base.levels, cached);
const labels = (rows: NavNode[]) => rows.map((row) => row.label);

describe("loadedLevels (tudo o que a árvore já carregou, aberto ou não)", () => {
  it("liga a conexão ao banco, o banco aos esquemas, o esquema aos grupos fixos e o grupo ao que foi buscado", () => {
    const get = (path: NavPath) => levels.get(childrenKey({ key: key(path) }));

    expect(get({ type: "connection", connectionId: "c1" })).toEqual(loaded(databaseNodes("c1", [{ name: "mes", isCurrent: true }])));
    expect(get({ type: "database", connectionId: "c1" })).toMatchObject({ status: "loaded", children: expect.arrayContaining([expect.objectContaining({ label: "producao" })]) });
    expect(get({ type: "schema", connectionId: "c1", schema: "producao" })).toEqual(loaded(schemaGroupNodes("c1", "producao")));
    expect(get({ type: "objects", connectionId: "c1", schema: "producao", objects: "tables" })).toEqual(loaded(tables));
    expect(get({ type: "table", connectionId: "c1", schema: "producao", table: "apontamento" })).toEqual(loaded(tableGroupNodes("c1", "producao", "apontamento")));
  });

  it("só cria os grupos fixos do que tem algo carregado embaixo (nenhum nível inventado)", () => {
    expect(levels.has(childrenKey({ key: key({ type: "schema", connectionId: "c1", schema: "public" }) }))).toBe(false);
    expect(levels.has(childrenKey({ key: key({ type: "table", connectionId: "c1", schema: "producao", table: "linha" }) }))).toBe(false);
  });

  it("não mexe nos níveis que já havia (os das pastas e os dos nós abertos)", () => {
    const original = new Map(base.levels);
    loadedLevels(base.levels, cached);

    expect(base.levels).toEqual(original);
  });

  it("o que o componente já tem de um nível (o nó aberto) vale mais que o guardado", () => {
    const failed: LevelState = { status: "error", message: "caiu" };
    const own = new Map(base.levels).set(childrenKey({ key: key({ type: "objects", connectionId: "c1", schema: "producao", objects: "tables" }) }), failed);

    expect(loadedLevels(own, cached).get(childrenKey({ key: key({ type: "objects", connectionId: "c1", schema: "producao", objects: "tables" }) }))).toBe(failed);
  });
});

describe("a busca e os outros bancos do servidor (RN-ARVORE-006 e RN-BUSCA-001)", () => {
  it("acha o que já foi carregado de outro banco, sob o nó dele, com o banco da conexão primeiro e marcado", () => {
    const other = [
      { key: treeKey({ type: "connection", connectionId: "c1" }), nodes: databaseNodes("c1", [{ name: "arquivo", isCurrent: false }, { name: "mes", isCurrent: true }]) },
      { key: treeKey({ type: "database", connectionId: "c1", database: "arquivo" }), nodes: schemaNodes("c1", [{ name: "historico", isSystem: false }], "arquivo") },
      { key: treeKey({ type: "objects", connectionId: "c1", database: "arquivo", schema: "historico", objects: "tables" }), nodes: objectNodes("c1", "historico", "tables", [{ name: "apontamento_2019", kind: "table" }], "arquivo") },
      ...cached.slice(1),
    ];

    const { rows } = searchTree(base.roots, loadedLevels(base.levels, other), "apont");

    expect(labels(rows)).toEqual(["Fábrica", "MES Produção", "mes", "producao", "Tabelas", "apontamento", "arquivo", "historico", "Tabelas", "apontamento_2019"]);
    expect(rows.find((row) => row.label === "mes")?.badge).toBe(databaseNodes("c1", [{ name: "mes", isCurrent: true }])[0].badge);
    expect(parseNavKey(rows.at(-1)!.key)).toEqual({ type: "table", connectionId: "c1", database: "arquivo", schema: "historico", table: "apontamento_2019" });
  });
});

describe("searchTree (RN-BUSCA-001)", () => {
  it("mostra o que casou com os ancestrais abertos até ele, e some com o resto", () => {
    const { rows, open } = searchTree(base.roots, levels, "apont");

    expect(labels(rows)).toEqual(["Fábrica", "MES Produção", "mes", "producao", "Tabelas", "apontamento"]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.filter((row) => open.has(row.key)).map((row) => row.label)).toEqual(["Fábrica", "MES Produção", "mes", "producao", "Tabelas"]);
  });

  it("o que casou e não tem nada casando embaixo não tem chevron nem fica aberto", () => {
    const { rows, open } = searchTree(base.roots, levels, "linha");
    const table = rows.find((row) => row.label === "linha");

    expect(table?.hasChildren).toBe(false);
    expect(open.has(table?.key ?? "")).toBe(false);
  });

  it("casa por nome sem diferenciar maiúsculas nem acentos: 'producao' acha o esquema, a tabela de acento e a conexão", () => {
    const { rows } = searchTree(base.roots, levels, "PRODUCAO");

    expect(labels(rows)).toContain("producao");
    expect(labels(rows)).toContain("Produção Extra");
    expect(labels(rows)).toContain("ordem_producao");
    expect(labels(rows)).toContain("MES Produção");
    expect(labels(rows)).not.toContain("linha");
  });

  it("acha o que está num nível carregado e depois recolhido (a busca vê o que a árvore já tem, não só o que está aberto)", () => {
    const { rows } = searchTree(base.roots, levels, "ordem_id");

    expect(labels(rows)).toEqual(["Fábrica", "MES Produção", "mes", "producao", "Tabelas", "apontamento", "Colunas", "ordem_id"]);
  });

  it("a visão e a coluna entram como as tabelas", () => {
    expect(labels(searchTree(base.roots, levels, "v_ordens").rows)).toEqual(["Fábrica", "MES Produção", "mes", "producao", "Visões", "v_ordens_abertas"]);
  });

  it("o destaque vem por chave da linha, na posição do rótulo", () => {
    const { rows, matches, count } = searchTree(base.roots, levels, "produção");
    const extra = rows.find((row) => row.label === "Produção Extra");

    expect(matches.get(extra?.key ?? "")).toEqual([0, 8]);
    expect(matches.get(rows.find((row) => row.label === "ordem_producao")?.key ?? "")).toEqual([6, 14]);
    expect(count).toBe(matches.size);
  });

  it("os grupos fixos (Tabelas, Colunas) não casam pelo próprio nome: 'tabelas' não acha nada", () => {
    const { rows, count } = searchTree(base.roots, levels, "tabelas");

    expect(rows).toEqual([]);
    expect(count).toBe(0);
  });

  it("nada encontrado: sem linhas", () => {
    expect(searchTree(base.roots, levels, "zzz").rows).toEqual([]);
  });

  it("o grupo diz quantos do total aparecem", () => {
    const { rows } = searchTree(base.roots, levels, "ordem_producao");
    const group = rows.find((row) => row.label === "Tabelas");

    expect(group?.detail).toBe("1 de 7");
  });

  it("o grupo em que tudo aparece diz só o total", () => {
    const { rows } = searchTree(base.roots, levels, "v_ordens");

    expect(rows.find((row) => row.label === "Visões")?.detail).toBe("1");
  });

  it("não procura no que não foi carregado: uma conexão sem nível carregado só casa pelo próprio nome", () => {
    expect(labels(searchTree(base.roots, levels, "erp").rows)).toEqual(["ERP"]);
    expect(labels(searchTree(base.roots, levels, "cliente").rows)).toEqual([]);
  });

  it("o recolhido pela pessoa na busca fica recolhido, mas continua com chevron para reabrir", () => {
    const schemaKey = key({ type: "schema", connectionId: "c1", schema: "producao" });
    const { rows, open } = searchTree(base.roots, levels, "apont", new Set([schemaKey]));
    const schema = rows.find((row) => row.key === schemaKey);

    expect(labels(rows)).toEqual(["Fábrica", "MES Produção", "mes", "producao"]);
    expect(schema?.hasChildren).toBe(true);
    expect(open.has(schemaKey)).toBe(false);
  });

  it("termo só de espaços não filtra nada: devolve a árvore vazia de busca (quem chama não deve usá-lo)", () => {
    expect(searchTree(base.roots, levels, "   ").rows).toEqual([]);
  });

  it("não altera a árvore nem os níveis que recebeu", () => {
    const rootsBefore = JSON.stringify(base.roots);
    const levelsBefore = new Map(levels);
    searchTree(base.roots, levels, "ped");

    expect(JSON.stringify(base.roots)).toBe(rootsBefore);
    expect(levels).toEqual(levelsBefore);
  });
});

describe("searchTree com milhares de itens carregados", () => {
  /**
   * O melhor tempo de cinco execuções, depois de uma de aquecimento: com a suíte inteira rodando em paralelo a máquina está disputada, e
   * uma medida só pega o pior momento (e a JIT fria), não o custo da função.
   */
  function bestOf(run: () => void): number {
    run();
    return Math.min(...Array.from({ length: 5 }, () => {
      const start = performance.now();
      run();
      return performance.now() - start;
    }));
  }

  const bulk = (names: (index: number) => string) => {
    const objects = Array.from({ length: 20_000 }, (_, index) => ({ name: names(index), kind: "table" as const }));
    const big = [...cached, { key: treeKey({ type: "objects", connectionId: "c1", schema: "public", objects: "tables" }), nodes: objectNodes("c1", "public", "tables", objects) }];
    return loadedLevels(base.levels, big);
  };

  it("20 mil nós carregados: um termo que acha poucos filtra em menos de 100 ms", () => {
    const huge = bulk((index) => `registro_${String(index).padStart(5, "0")}`);

    expect(labels(searchTree(base.roots, huge, "registro_19999").rows).at(-1)).toBe("registro_19999");
    expect(bestOf(() => searchTree(base.roots, huge, "registro_19999"))).toBeLessThan(100);
  });

  it("20 mil nós e um termo que acha todos (o pior caso) também fica abaixo de 100 ms", () => {
    const huge = bulk((index) => `registro_${String(index).padStart(5, "0")}`);
    const { rows, count } = searchTree(base.roots, huge, "registro");

    expect(rows.length).toBeGreaterThan(20_000);
    expect(count).toBeGreaterThanOrEqual(20_000);
    expect(bestOf(() => searchTree(base.roots, huge, "registro"))).toBeLessThan(100);
  });

  it("20 mil nós com acento no nome (o caminho lento do destaque) em menos de 100 ms", () => {
    const accented = bulk((index) => `Produção_${index}`);

    expect(searchTree(base.roots, accented, "producao_1").count).toBeGreaterThan(1000);
    expect(bestOf(() => searchTree(base.roots, accented, "producao_1"))).toBeLessThan(100);
  });
});

describe("cachedTree (o que a busca lê do cache, com identidade estável para o useMemo)", () => {
  const schemas = schemaNodes("c1", [{ name: "public", isSystem: false }]);
  const session = { id: "s1", database: "mes" };

  it("sem nada no cache, nada a buscar", () => {
    expect(cachedTree(new QueryClient())).toEqual({ cached: [] });
  });

  it("devolve os níveis respondidos, e mais nada do cache (nem as sessões: o banco vem da lista dos bancos)", () => {
    const client = new QueryClient();
    client.setQueryData(["database-session", "c1"], session);
    client.setQueryData(["tree", "c1", "schemas"], schemas);
    client.setQueryData(["connections"], [{ id: "c1" }]);

    expect(cachedTree(client)).toEqual({ cached: [{ key: ["tree", "c1", "schemas"], nodes: schemas }] });
  });

  it("a consulta sem dado (ainda a caminho, ou que falhou) não entra", () => {
    const client = new QueryClient();
    client.getQueryCache().build(client, { queryKey: ["tree", "c1", "schemas"] });
    client.getQueryCache().build(client, { queryKey: ["database-session", "c1"] });

    expect(cachedTree(client)).toEqual({ cached: [] });
  });

  it("é o MESMO objeto enquanto nada do que a busca lê mudou: é isso que deixa o useMemo do navegador valer", () => {
    const client = new QueryClient();
    client.setQueryData(["database-session", "c1"], session);
    client.setQueryData(["tree", "c1", "schemas"], schemas);
    const first = cachedTree(client);

    client.setQueryData(["connections"], [{ id: "c1" }]);

    expect(cachedTree(client)).toBe(first);
    expect(cachedTree(client)).toBe(first);
  });

  it("muda quando um nível chega, é atualizado ou é removido (a desconexão), mesmo com o mesmo número de itens", () => {
    const client = new QueryClient();
    client.setQueryData(["tree", "c1", "schemas"], schemas);
    const first = cachedTree(client);

    client.setQueryData(["tree", "c1", "schemas"], schemaNodes("c1", [{ name: "outro", isSystem: false }]));
    const updated = cachedTree(client);
    expect(updated).not.toBe(first);
    expect(updated.cached[0].nodes[0].label).toBe("outro");

    client.setQueryData(["tree", "c1", "schema", "outro", "objects", "tables"], []);
    const added = cachedTree(client);
    expect(added).not.toBe(updated);

    client.removeQueries({ queryKey: ["tree", "c1"] });
    expect(cachedTree(client)).toEqual({ cached: [] });
  });

  it("cada cliente tem o seu: dois cofres, ou o mesmo depois de a API reiniciar, não se misturam", () => {
    const one = new QueryClient();
    const other = new QueryClient();
    one.setQueryData(["tree", "c1", "schemas"], schemas);

    expect(cachedTree(other)).toEqual({ cached: [] });
    expect(cachedTree(one).cached).toHaveLength(1);
  });
});
