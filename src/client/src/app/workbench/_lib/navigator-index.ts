import { byName } from "@/app/connections/_lib/connection-tree";

import type { DatabaseObject, ObjectNames, SchemaObjectNames } from "./database-sessions.schema";
import { childrenKey, databaseNodes, inDatabase, navKey, objectNode, objectNodes, schemaGroupNodes, schemaNodes, type DatabaseRef, type LevelState, type LoadedLevels, type NavPath, type ObjectsPath } from "./navigator-model";
import { foldLabel, type CachedNames } from "./navigator-search";

/**
 * O corte da busca (RN-BUSCA-002): cada banco mostra, no máximo, as 200 primeiras tabelas e visões do índice que casam, na ordem dos esquemas e dos nomes do banco.
 * É por banco, e não do total: um corte do total deixaria o primeiro ambiente da árvore engolir os outros, que é o caso do pedido (três ambientes de tabelas iguais).
 */
export const searchIndexCap = 200;

/** Um esquema do índice com os nomes já dobrados (sem caixa e sem acento, do jeito que `findMatch` os compara: `foldLabel`), para cada tecla gastar só um `includes` por nome. */
type FoldedSchema = {
  schema: SchemaObjectNames;
  folded: string;
  foldedTables: readonly string[];
  foldedViews: readonly string[];
  /** A posição de cada visão na lista do esquema em ordem `byName` (`viewPositions`), calculada na primeira vez que uma visão do esquema casa. */
  positions?: Int32Array;
};

/**
 * O índice dobrado é calculado UMA vez por resposta: a chave é o objeto que a consulta guarda, que não muda até o "Atualizar" (`structuralSharing` mantém a referência
 * quando a resposta nova é igual). Com 50.000 nomes por banco, dobrá-los a cada tecla custaria mais do que a tecla pode gastar.
 */
const foldedIndexes = new WeakMap<ObjectNames, readonly FoldedSchema[]>();

function foldedIndex(names: ObjectNames): readonly FoldedSchema[] {
  let index = foldedIndexes.get(names);
  if (index === undefined) {
    index = names.schemas.map((schema) => ({ schema, folded: foldLabel(schema.name), foldedTables: schema.tables.map(foldLabel), foldedViews: schema.views.map(foldLabel) }));
    foldedIndexes.set(names, index);
  }
  return index;
}

/**
 * A posição de cada visão do esquema na lista INTEIRA em ordem `byName`: é a posição que a chave da folha leva (`objectNode`), a mesma que a visão terá quando o nível
 * carregar. A conta pede a lista toda (o rank de uma visão depende de todas as outras), e ordenar com o `Intl.Collator` custa, por isso só se faz para o esquema em que
 * uma visão casou, e uma vez. A ordenação é estável, como a do `objectNodes`: os nomes que o `byName` acha iguais ficam na ordem do banco.
 */
function viewPositions(entry: FoldedSchema): Int32Array {
  if (entry.positions === undefined) {
    const views = entry.schema.views.map((name, index) => ({ name, index })).sort(byName);
    const positions = new Int32Array(views.length);
    views.forEach(({ index }, position) => {
      positions[index] = position;
    });
    entry.positions = positions;
  }
  return entry.positions;
}

/** Um banco cujos achados passaram do corte: quantas tabelas e visões do índice casaram (`found`) e quantas entraram na tela (`shown`). */
export type IndexCut = DatabaseRef & { found: number; shown: number };

export type IndexLevels = {
  /** Os níveis recebidos e, a mais, os que a busca montou do índice. */
  levels: LoadedLevels;
  /** Os bancos em que o corte deixou achados de fora (`found` > `shown`). */
  cuts: IndexCut[];
  /** Quantos achados o corte deixou de fora, somados: a contagem "1.234 resultados, 600 à vista" continua além do corte. */
  hidden: number;
};

/**
 * Os níveis da busca montados dos índices de nomes (RN-BUSCA-002), para a `searchTree` achar as tabelas e as visões de um esquema que ninguém abriu. Roda DEPOIS de
 * `loadedLevels` e só ACRESCENTA o que falta: o que a árvore carregou de verdade (`levels`) vale mais, e o grupo "Tabelas" ou "Visões" já carregado não recebe nada do
 * índice. Não altera `levels`; sem índice com algum esquema devolve o próprio `levels`.
 *
 * Cada banco com índice (`indexes`: os do escopo, que o chamador escolheu; as conexões que a árvore não mostra não entram aqui) ganha, no que faltar:
 * - a lista dos bancos da conexão: só o banco dela, marcado como o padrão (`databaseName`, o que a sessão da árvore diz), e os outros bancos que também têm índice;
 * - a lista dos esquemas do banco: os do índice cujo nome casa ou que têm algo que casa (`schemaNodes`: os comuns primeiro, os de sistema depois);
 * - os grupos fixos de cada esquema com achado (`schemaGroupNodes`);
 * - Tabelas e Visões: só os nomes que casam, com as MESMAS chaves que a árvore dará quando o nível carregar (`objectNodes`; a visão leva a posição na lista inteira do
 *   esquema, `viewPositions`), e `total` = quantos o índice tem ali, para o grupo dizer "3 de 120". Com o índice cortado na API (`truncated`) o total não se sabe, e o
 *   grupo mostra só o número achado.
 *
 * `needle` já passou por `fold` e não é vazio, como em `findMatch`. O corte (`cap`) vale por banco e conta só o que o índice preenche. A conta dos achados
 * não para no corte: `cuts` e `hidden` dizem quantos ficaram de fora. Sem a lista dos bancos nem o nome do banco da conexão (a sessão já não está no cache), o índice do
 * banco da conexão não tem onde aparecer e fica de fora.
 *
 * Desempenho: o índice dobrado vem do cache por resposta (`foldedIndex`), e cada tecla gasta um `includes` por nome e monta linhas só para o que entra no corte.
 */
export function indexLevels(levels: LoadedLevels, indexes: readonly CachedNames[], needle: string, cap: number = searchIndexCap): IndexLevels {
  if (indexes.length === 0 || needle === "") return { levels, cuts: [], hidden: 0 };

  let added: Map<string, LevelState> | null = null;
  const has = (path: NavPath) => (added ?? levels).has(childrenKey({ key: navKey(path) }));
  const put = (path: NavPath, state: LevelState) => {
    added ??= new Map(levels);
    added.set(childrenKey({ key: navKey(path) }), state);
  };

  const cuts: IndexCut[] = [];
  const databasesOf = new Map<string, { name: string; isCurrent: boolean }[]>();

  for (const { connectionId, database, databaseName, names } of indexes) {
    const at = { connectionId, ...inDatabase(database) };
    const name = database ?? databaseName;
    // O índice vazio (o banco sem tabela nem visão) não tem o que mostrar: nem o banco aparece.
    if (name !== undefined && names.schemas.length > 0) databasesOf.set(connectionId, [...(databasesOf.get(connectionId) ?? []), { name, isCurrent: database === undefined }]);

    const listed: SchemaObjectNames[] = [];
    let found = 0;
    let shown = 0;

    for (const entry of foldedIndex(names)) {
      const { schema } = entry;
      const parent = (objects: ObjectsPath["objects"]): ObjectsPath => ({ type: "objects", ...at, schema: schema.name, objects });

      // Os nomes que casam em cada grupo, na ordem do banco. O grupo que a árvore já carregou fica com a árvore: o que o índice tem dele não se conta nem se corta.
      const tables: number[] = [];
      const views: number[] = [];
      let anyMatch = false;

      for (const [group, folded, hits] of [["tables", entry.foldedTables, tables], ["views", entry.foldedViews, views]] as const) {
        let free: boolean | undefined;
        for (let position = 0; position < folded.length; position++) {
          if (!folded[position].includes(needle)) continue;
          anyMatch = true;
          free ??= !has(parent(group));
          if (!free) break;

          found++;
          if (shown < cap) {
            shown++;
            hits.push(position);
          }
        }
      }

      if (anyMatch || entry.folded.includes(needle)) listed.push(schema);
      if (tables.length === 0 && views.length === 0) continue;

      const schemaPath: NavPath = { type: "schema", ...at, schema: schema.name };
      if (!has(schemaPath)) put(schemaPath, { status: "loaded", children: schemaGroupNodes(connectionId, schema.name, database) });

      if (tables.length > 0) {
        const items = tables.map((position): DatabaseObject => ({ name: schema.tables[position], kind: "table" }));
        put(parent("tables"), { status: "loaded", children: objectNodes(connectionId, schema.name, "tables", items, database), ...(names.truncated ? {} : { total: schema.tables.length }) });
      }

      if (views.length > 0) {
        // Na ordem da lista do esquema (`byName`), que é a da tela: a ordem das posições.
        const positions = viewPositions(entry);
        const place = parent("views");
        const ordered = views.map((index) => ({ index, position: positions[index] })).sort((a, b) => a.position - b.position);
        put(place, { status: "loaded", children: ordered.map(({ index, position }) => objectNode(place, { name: schema.views[index], kind: "view" }, position)), ...(names.truncated ? {} : { total: schema.views.length }) });
      }
    }

    if (found > shown) cuts.push({ ...at, found, shown });
    if (listed.length > 0 && !has({ type: "database", ...at })) put({ type: "database", ...at }, { status: "loaded", children: schemaNodes(connectionId, listed, database) });
  }

  for (const [connectionId, databases] of databasesOf) {
    if (!has({ type: "connection", connectionId })) put({ type: "connection", connectionId }, { status: "loaded", children: databaseNodes(connectionId, databases) });
  }

  return { levels: added ?? levels, cuts, hidden: cuts.reduce((sum, cut) => sum + cut.found - cut.shown, 0) };
}
