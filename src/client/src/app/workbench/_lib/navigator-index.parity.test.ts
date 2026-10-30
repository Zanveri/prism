import { describe, expect, it } from "vitest";

import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

import type { SchemaObjectNames } from "./database-sessions.schema";
import { treeKey } from "./database-sessions.service";
import { indexLevels } from "./navigator-index";
import { databaseNodes, objectNodes, schemaNodes, treeNodes } from "./navigator-model";
import { findMatch, fold, foldLabel, loadedLevels, searchTree, type CachedLevel, type CachedNames, type SearchView } from "./navigator-search";

/**
 * A regra de ouro do índice de nomes (RN-BUSCA-002): a tabela ou a visão achada pelo índice é a MESMA que a árvore acharia se o nível estivesse carregado, com a mesma
 * linha, a mesma chave, o mesmo trecho destacado, a mesma contagem. Aqui as duas contas rodam sobre os mesmos nomes e têm de dar o mesmo resultado, em vez de se
 * conferir caso a caso: o corpo de nomes é sorteado (com acento composto e solto, caixa, número, aspas, barra, "#", hangul, ligadura, "Σ") e a semente é fixa.
 */

const now = "2026-10-27T12:00:00Z";
const folder: Folder = { id: "f1", parentID: null, name: "Ambientes", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const connection = (id: string, name: string): Connection => ({ id, folderID: "f1", name, engine: 1, host: "srv", port: 5432, database: "erp", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now });
const base = treeNodes(buildConnectionTree([folder], [connection("c1", "Dev")]));

/** O gerador de números de uma semente (mulberry32): o mesmo sorteio em toda máquina. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Os pedaços de que os nomes são feitos: o que a dobra de caixa e de acento já enrolou alguma vez. */
const pieces = ["a", "b", "c", "A", "B", "á", "ã", "ç", "É", "é", "õ", "1", "2", "10", "_", "-", " ", '"', "\\", "#", "%", "'", "ß", "İ", "ｆ", "ﬁ", "한", "ǅ", "ς", "Σ", "Ⅻ", "😀", "x"];

type Corpus = { schemas: SchemaObjectNames[]; queries: string[] };

function corpusOf(seed: number): Corpus {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const name = () => Array.from({ length: 1 + Math.floor(next() * 5) }, () => pick(pieces)).join("");
  const names = (count: number) => [...new Set(Array.from({ length: count }, name))];

  const schemas = [...new Set(Array.from({ length: 1 + Math.floor(next() * 3) }, name))]
    .map((schema, position): SchemaObjectNames => ({ name: schema, isSystem: position === 2, tables: names(Math.floor(next() * 6)), views: names(Math.floor(next() * 6)) }))
    .filter((schema) => schema.tables.length + schema.views.length > 0);

  // Termos de pedaços soltos e de trechos de nomes que existem (com a caixa trocada), para o termo casar com frequência e em mais de um lugar.
  const everyName = schemas.flatMap((schema) => [schema.name, ...schema.tables, ...schema.views]);
  const queries = Array.from({ length: 8 }, () => {
    if (next() < 0.5 || everyName.length === 0) return Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(pieces)).join("");
    const chosen = [...pick(everyName)];
    const from = Math.floor(next() * chosen.length);
    const text = chosen.slice(from, from + 1 + Math.floor(next() * 4)).join("");
    return next() < 0.5 ? text.toUpperCase() : ` ${text.toLowerCase()} `;
  });
  return { schemas, queries };
}

/** O que a tela mostra de uma busca, inteiro: as linhas (chave, rótulo, recuo, detalhe, selo), o que está aberto, onde casou e quantos casaram. */
const shown = (view: SearchView) => ({ rows: view.rows, open: [...view.open].sort(), matches: [...view.matches], count: view.count });

/** Os níveis que a árvore teria guardado se tudo estivesse carregado, ou só as partes que `loaded` deixa (o resto vem do índice). */
function loadedCache(schemas: SchemaObjectNames[], database: string | undefined, loaded: { connection: boolean; database: boolean; tables: (position: number) => boolean; views: (position: number) => boolean }): CachedLevel[] {
  const list = database === undefined ? [{ name: "erp", isCurrent: true }] : [{ name: database, isCurrent: false }];

  return [
    ...(loaded.connection ? [{ key: treeKey({ type: "connection", connectionId: "c1" }), nodes: databaseNodes("c1", list) }] : []),
    ...(loaded.database ? [{ key: treeKey({ type: "database", connectionId: "c1", ...(database === undefined ? {} : { database }) }), nodes: schemaNodes("c1", schemas.map(({ name, isSystem }) => ({ name, isSystem })), database) }] : []),
    ...schemas.flatMap((schema, position): CachedLevel[] => [
      ...(loaded.tables(position) ? [{ key: treeKey({ type: "objects", connectionId: "c1", ...(database === undefined ? {} : { database }), schema: schema.name, objects: "tables" }), nodes: objectNodes("c1", schema.name, "tables", schema.tables.map((tableName) => ({ name: tableName, kind: "table" as const })), database) }] : []),
      ...(loaded.views(position) ? [{ key: treeKey({ type: "objects", connectionId: "c1", ...(database === undefined ? {} : { database }), schema: schema.name, objects: "views" }), nodes: objectNodes("c1", schema.name, "views", schema.views.map((viewName) => ({ name: viewName, kind: "view" as const })), database) }] : []),
    ]),
  ];
}

const everything = { connection: true, database: true, tables: () => true, views: () => true };

describe("o índice acha exatamente o que a árvore carregada acharia (RN-BUSCA-002)", () => {
  const seeds = Array.from({ length: 400 }, (_, index) => index + 1);

  for (const database of [undefined, "arquivo"]) {
    const where = database === undefined ? "no banco da conexão" : "em outro banco do servidor";

    it(`só com o índice, sem nível nenhum carregado, ${where}: as mesmas linhas, chaves, destaques e contagem`, () => {
      for (const seed of seeds) {
        const { schemas, queries } = corpusOf(seed);
        if (schemas.length === 0) continue;

        const truth = loadedLevels(base.levels, loadedCache(schemas, database, everything));
        const indexes: CachedNames[] = [{ connectionId: "c1", ...(database === undefined ? { databaseName: "erp" } : { database, databaseName: database }), names: { schemas, truncated: false } }];

        for (const query of queries) {
          const needle = fold(query.trim());
          if (needle === "") continue;

          const fromIndex = searchTree(base.roots, indexLevels(base.levels, indexes, needle).levels, query);
          expect(shown(fromIndex), `semente ${seed}, termo ${JSON.stringify(query)}`).toEqual(shown(searchTree(base.roots, truth, query)));
        }
      }
    });

    it(`com parte da árvore já carregada de verdade, ${where}: o índice só acrescenta o que falta e o resultado é o mesmo`, () => {
      for (const seed of seeds) {
        const { schemas, queries } = corpusOf(seed);
        if (schemas.length === 0) continue;

        // Quais níveis a árvore já carregou: sorteado por semente, e cada grupo de cada esquema por conta própria.
        const next = random(seed * 7919);
        const loaded = { connection: next() < 0.5, database: next() < 0.5, tables: () => next() < 0.5, views: () => next() < 0.5 };
        const partial = loadedLevels(base.levels, loadedCache(schemas, database, loaded));
        const truth = loadedLevels(base.levels, loadedCache(schemas, database, everything));
        const indexes: CachedNames[] = [{ connectionId: "c1", ...(database === undefined ? { databaseName: "erp" } : { database, databaseName: database }), names: { schemas, truncated: false } }];

        for (const query of queries) {
          const needle = fold(query.trim());
          if (needle === "") continue;

          const mixed = searchTree(base.roots, indexLevels(partial, indexes, needle).levels, query);
          expect(shown(mixed), `semente ${seed}, termo ${JSON.stringify(query)}`).toEqual(shown(searchTree(base.roots, truth, query)));
        }
      }
    });
  }

  it("o corte não muda o que cada linha é: as que entram no corte são as mesmas da busca completa, e a contagem do que ficou de fora fecha", () => {
    for (const seed of seeds.slice(0, 200)) {
      const { schemas, queries } = corpusOf(seed);
      if (schemas.length === 0) continue;

      const truth = loadedLevels(base.levels, loadedCache(schemas, undefined, everything));
      const indexes: CachedNames[] = [{ connectionId: "c1", databaseName: "erp", names: { schemas, truncated: false } }];

      for (const query of queries) {
        const needle = fold(query.trim());
        if (needle === "") continue;

        const whole = searchTree(base.roots, truth, query);
        const cap = 2;
        const cut = indexLevels(base.levels, indexes, needle, cap);
        const view = searchTree(base.roots, cut.levels, query);
        const objects = (rows: SearchView["rows"]) => rows.filter((row) => row.kind === "table" || row.kind === "view");

        // O que o corte deixou de fora, somado ao que entrou, é tudo o que a busca completa achou: nenhum achado se perde e nenhum se conta duas vezes.
        expect(objects(view.rows).length + cut.hidden, `semente ${seed}, termo ${JSON.stringify(query)}`).toBe(objects(whole.rows).length);
        expect(objects(view.rows).length).toBeLessThanOrEqual(cap);
        for (const row of objects(view.rows)) expect(whole.rows).toContainEqual({ ...row, depth: row.depth });
      }
    }
  });
});

describe("foldLabel: o nome dobrado casa quando, e só quando, o findMatch acharia (a base do índice)", () => {
  const labels = ["Opção", "Opção", "ÁRVORE", "ΟΔΟΣ", "ΟΔΟΣ́", "éΣ", "éΣ", "ΣΑΣ", "İstanbul", "straße", "STRASSE", "한국어", "ǅ", "Ⅻ", "ﬁle", "ｆｕｌｌ", "Ĳ", "pedido_2019", "Pedido", "PEDIDO ", "a\"b", "a\\b", "x#y", "😀 emoji"];
  const typed = ["opcao", "OPÇÃO", "arvore", "οδοσ", "οδος", "Σ", "σ", "ς", "istanbul", "strasse", "straße", "한국", "ǆ", "xii", "file", "ij", "pedido", "2019", "a\"", "\\b", "#", "😀", "e"];

  it.each(labels)("%j", (label) => {
    for (const query of typed) {
      const needle = fold(query);
      expect(foldLabel(label).includes(needle), `rótulo ${JSON.stringify(label)}, termo ${JSON.stringify(query)}`).toBe(findMatch(label, needle) !== null);
    }
  });

  it("o 'Σ' do fim do nome: o nome inteiro dobra para 'ς', o ponto isolado para 'σ', e o índice usa a conta do findMatch em cada caso", () => {
    // Sem acento solto o nome inteiro é dobrado de uma vez (o 'Σ' final vira 'ς'); com acento solto, ponto por ponto ('Σ' vira 'σ'). O índice segue o findMatch nos dois.
    expect(foldLabel("ΟΔΟΣ")).toBe(fold("ΟΔΟΣ"));
    expect(foldLabel("ΟΔΟΣé")).toBe("οδοσe");
    expect(foldLabel("ｆÉéΣ#")).toBe("ｆeeσ#");
  });

  it("o nome comum (ASCII) só passa para minúsculas, e o texto sem acento solto é o próprio fold", () => {
    expect(foldLabel("Pedido_Item")).toBe("pedido_item");
    expect(foldLabel("Produção")).toBe(fold("Produção"));
    expect(foldLabel("")).toBe("");
  });
});
