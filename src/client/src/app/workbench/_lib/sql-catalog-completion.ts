import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import type { Text } from "@codemirror/state";
import type { QueryClient } from "@tanstack/react-query";

import type { Engine } from "@/components/ui";

import { databaseSessionKey, treeKey, treeQuery, type FetchedPath } from "./database-sessions.service";
import { inDatabase, type NavNode } from "./navigator-model";
import type { CachedLevel } from "./navigator-search";
import { cachedLevels, columnOptions, requoted, sameLevels } from "./sql-completion";
import { analyzeAt, maxAnalyzedLength, resolveQualifier, type Analysis } from "./sql-references";
import { defaultSchemasOf, linkCatalog, type LinkCatalog } from "./table-links";

/**
 * RN-CONFIG-004: as colunas de `tabela.` (ou `apelido.`). É o que o autocompletar busca no banco: as colunas de uma tabela ou visão, pela MESMA consulta da árvore
 * (`treeQuery`, nível `columns`, então o navegador as mostra depois sem pedir de novo). Só com a sessão da árvore daquela conexão e daquele banco já aberta (nada
 * conecta nem reconecta por causa dele), uma vez por lista; a busca que falha não mostra nem avisa nada, e não é refeita enquanto a sessão for a mesma.
 */

export type CatalogCompletionEnv = {
  queryClient: QueryClient;
  engine: () => Engine | undefined;
  /** A conexão da aba, ou `null` (a aba sem conexão não completa nada daqui). */
  connectionId: () => string | null;
  /** O outro banco do servidor da aba (RN-ARVORE-006). */
  database: () => string | undefined;
  /** O usuário da conexão, de onde sai o esquema padrão da sessão. */
  userName: () => string | undefined;
  /** A linha em branco separa os comandos (RN-SQL-018). */
  blankLines: () => boolean;
};

export type CatalogCompletion = {
  /** As fontes novas: as colunas de `nome.`. */
  sources: CompletionSource[];
  /**
   * `nome.` é uma tabela, visão ou apelido que a fonte das colunas completa (com as colunas do cache ou buscando-as): a fonte de nomes do `lang-sql` se cala ali
   * para a lista não ter cada coluna duas vezes.
   */
  owns: (context: CompletionContext) => boolean;
};

/** O que vem antes do cursor e pode ser um pedido destas fontes: um ponto, e a palavra (ou o nome entre aspas) começada. */
const mayAsk = /\.(?:"[^"\n]*|[\p{L}\p{N}_$]*)$/u;
/** O quanto do texto antes do cursor a conferência rápida olha. */
const lookBack = 400;

const validForWord = /^[\p{L}\p{N}_$]*$/u;
const validForQuoted = /^"[^"]*"?$/;

/** Uma tabela do catálogo. */
type TableName = { schema: string; name: string };

export function catalogCompletion(env: CatalogCompletionEnv): CatalogCompletion {
  const { queryClient } = env;

  // O catálogo (o que a árvore já carregou) só é refeito quando algum nível muda, como no link da tabela (RN-LINK-001).
  let catalogOf: { levels: readonly CachedLevel[]; catalog: LinkCatalog } | null = null;
  // O comando é relido uma vez por versão do texto e posição: a fonte de nomes (`owns`) e as duas daqui perguntam o mesmo.
  let analyzed: { doc: Text; position: number; blankLines: boolean; engine: Engine | undefined; analysis: Analysis | null } | null = null;
  // As listas que falharam, por sessão: a busca não se repete a cada tecla.
  const failed = new Set<string>();

  const levels = (): CachedLevel[] => {
    const connectionId = env.connectionId();
    return connectionId === null ? [] : cachedLevels(queryClient, connectionId, env.database());
  };

  function catalog(): LinkCatalog {
    const current = levels();
    if (catalogOf === null || !sameLevels(catalogOf.levels, current)) catalogOf = { levels: current, catalog: linkCatalog(current) };
    return catalogOf.catalog;
  }

  function analysisAt(context: CompletionContext): Analysis | null {
    if (env.connectionId() === null) return null;
    const { doc } = context.state;
    if (doc.length > maxAnalyzedLength || !mayAsk.test(doc.sliceString(Math.max(0, context.pos - lookBack), context.pos))) return null;

    const blankLines = env.blankLines();
    const engine = env.engine();
    if (analyzed === null || analyzed.doc !== doc || analyzed.position !== context.pos || analyzed.blankLines !== blankLines || analyzed.engine !== engine) analyzed = { doc, position: context.pos, blankLines, engine, analysis: analyzeAt(doc.toString(), context.pos, engine, blankLines) };
    return analyzed.analysis;
  }

  const defaultSchemas = () => defaultSchemasOf(env.engine(), env.userName());

  /** A tabela de `nome.`, se o catálogo a tem. */
  function memberTable(context: CompletionContext): { analysis: Analysis; table: TableName; from: number; quoted: boolean } | null {
    const analysis = analysisAt(context);
    if (analysis === null || analysis.context.kind !== "member") return null;

    const table = resolveQualifier(analysis.context.qualifier, analysis.references, catalog(), defaultSchemas());
    return table === null ? null : { analysis, table, from: analysis.context.from, quoted: analysis.context.quoted };
  }

  /** A sessão da árvore da conexão e do banco da aba, se já está aberta: só então se busca. */
  function openSession(): string | null {
    const connectionId = env.connectionId();
    if (connectionId === null) return null;
    return queryClient.getQueryData<{ id: string }>(databaseSessionKey(connectionId, env.database()))?.id ?? null;
  }

  /**
   * A lista de uma consulta: a do cache, ou (com a sessão da árvore aberta e a lista ainda não pedida sem falha) a que chega da busca. As buscas da mesma lista
   * dividem uma só requisição. `null`: não deu (sem sessão, ou a busca falhou). A lista que falhou sai do cache quando ninguém a mostra, para a árvore não
   * mostrar um erro que a pessoa nunca pediu.
   */
  async function listOf<T>(queryKey: readonly unknown[], fetch: () => Promise<T>): Promise<T | null> {
    const cached = queryClient.getQueryData<T>(queryKey);
    if (cached !== undefined) return cached;

    const session = openSession();
    if (session === null) return null;

    const mark = `${session}\u0000${JSON.stringify(queryKey)}`;
    if (failed.has(mark)) return null;

    try {
      return await fetch();
    } catch {
      failed.add(mark);
      if (queryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() === 0) queryClient.removeQueries({ queryKey, exact: true });
      return null;
    }
  }

  const columnsPath = (table: TableName): FetchedPath => ({ type: "tableLevel", connectionId: env.connectionId() as string, ...inDatabase(env.database()), schema: table.schema, table: table.name, level: "columns" });

  const columnsOf = (table: TableName) => {
    const path = columnsPath(table);
    return listOf<NavNode[]>(treeKey(path), () => queryClient.fetchQuery({ ...treeQuery(path, queryClient, true), meta: { silent: true } }));
  };

  /** O resultado de uma lista de sugestões que troca o texto da palavra (ou do nome entre aspas aberto) do cursor. */
  function replacing(context: CompletionContext, from: number, quoted: boolean, options: Completion[], validFor?: RegExp): CompletionResult | null {
    if (options.length === 0) return null;
    // O nome entre aspas que a tela fechou sozinha (`p."|"`) é trocado junto.
    const to = quoted && context.state.sliceDoc(context.pos, context.pos + 1) === '"' ? context.pos + 1 : undefined;
    return { from, ...(to === undefined ? {} : { to }), options, ...(validFor === undefined ? {} : { validFor }) };
  }

  /** `tabela.`, `apelido.` e `esquema.tabela.`: as colunas. Uma tabela de colunas ainda não vistas é buscada, e a lista abre quando chegam. */
  const columnsSource: CompletionSource = (context) => {
    const found = memberTable(context);
    if (found === null) return null;

    const engine = env.engine();
    const answer = (nodes: NavNode[] | null): CompletionResult | null => {
      if (nodes === null) return null;
      const options: Completion[] = columnOptions(nodes, engine);
      return replacing(context, found.from, found.quoted, found.quoted ? options.map(requoted) : options, found.quoted ? validForQuoted : validForWord);
    };

    const cached = queryClient.getQueryData<NavNode[]>(treeKey(columnsPath(found.table)));
    if (cached !== undefined) return answer(cached);
    if (openSession() === null) return null;

    return columnsOf(found.table).then((nodes) => (context.aborted ? null : answer(nodes)));
  };

  return { sources: [columnsSource], owns: (context) => memberTable(context) !== null };
}
