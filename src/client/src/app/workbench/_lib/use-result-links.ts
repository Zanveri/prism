import { useQueries, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Engine } from "@/components/ui/engine-tag";

import type { ForeignKey } from "./database-sessions.schema";
import { filterHandoff } from "./filter-handoff";
import { followOf, sameLinks, shownResultLinks, sourceTables, type ColumnLink } from "./foreign-key-links";
import type { TargetAnswer as SqlTargetAnswer } from "./generate-sql/generate-sql-flow";
import { inDatabase } from "./navigator-model";
import type { SqlTarget } from "./record-edits.schema";
import { sqlTargetKey } from "./sql-target-key";
import { tableKey, type TableRef } from "./table-diagram";
import { sqlLiteral } from "./table-sql";
import { foreignKeysQuery } from "./table-structure.service";
import type { RowsState } from "./use-query-runner";

type Params = {
  /** As linhas à frente: as do último comando (também as de antes de um comando que roda) ou as da aba guardada do script. */
  shown: RowsState | null;
  connectionId: string | null;
  /** O banco da aba (RN-ARVORE-006): as tabelas referenciadas abrem nele. */
  database: string | undefined;
  engine: Engine | undefined;
  /** A aba tem sessão com o banco: sem ela (a pessoa desconectou), nenhum valor é link. */
  connected: boolean;
  /** O resultado está à vista no lugar dele (a aba ativa com a área de trabalho na tela, a aba do resultado, a janela): escondido, nada se pergunta. */
  onView: boolean;
  /** O alvo `purpose: "sql"` do resultado (`useRecordEdits`), sem a faixa de "Conferindo…". */
  sqlTarget: () => Promise<SqlTargetAnswer>;
  /** Abre (ou traz à frente) a aba da tabela referenciada, na vista Registros, na conexão e no banco do resultado. */
  onOpenTable: (table: TableRef) => void;
};

/** A pergunta que lança (fora do contrato do `useRecordEdits`, que já devolve a falha como resposta) vale como a falha: sem link, sem aviso e sem nada guardado, e a execução seguinte da pessoa pergunta de novo. */
const failedAnswer = (): SqlTargetAnswer => ({ kind: "failed", message: null });

/** As chaves estrangeiras de cada tabela de origem, na ordem delas: `undefined` enquanto o catálogo não chegou. A mesma lista, enquanto nada chega. */
const foreignKeysOfAll = (results: readonly UseQueryResult<readonly ForeignKey[]>[]) => results.map((result) => result.data);

/**
 * RN-TABELA-007: o valor de uma chave estrangeira no resultado da consulta e do script leva ao registro referenciado, como nos Registros. A origem de cada
 * coluna é o alvo `purpose: "sql"` da API (RN-GRADE-020), que a tela pergunta em silêncio quando o resultado chega com linhas, à vista e com a aba conectada, e
 * guarda por comando e colunas (`sqlTargetKey`, em `useRecordEdits`): a atualização automática e o F5 não perguntam de novo, e o "Gerar SQL" e o "Copiar como" usam
 * o mesmo. As chaves de cada tabela de origem vêm de `foreignKeysQuery`, o mesmo cache dos Registros, da Estrutura e do Diagrama. Enquanto nada chega, e se o
 * alvo for recusado ou falhar, os valores são texto, sem aviso. O clique, o item do menu e o link de cada coluna fazem o mesmo que nos Registros.
 */
export function useResultLinks({ shown, connectionId, database, engine, connected, onView, sqlTarget, onOpenTable }: Params) {
  const queryClient = useQueryClient();
  const columns = shown?.columns;
  const columnCount = columns?.length ?? 0;
  const sql = shown?.target.sql;
  const filter = shown?.target.filter;
  const key = useMemo(() => (columns === undefined || sql === undefined ? null : sqlTargetKey(connectionId, database, { sql, filter }, columns)), [connectionId, database, sql, filter, columns]);
  // A execução da pessoa (o F5, o filtro, outro comando) muda; a atualização automática, que traz as mesmas colunas, não (`RowsState.id`).
  const run = shown?.id;
  const ready = onView && connected && connectionId !== null && key !== null && (shown?.rows.length ?? 0) > 0;

  // O alvo é do comando e das colunas que o pediram: outro comando começa sem link até a resposta; o mesmo (a atualização automática) segue com o que tem.
  const [answered, setAnswered] = useState<{ key: string; target: SqlTarget } | null>(null);
  const ask = useRef(sqlTarget);
  useEffect(() => {
    ask.current = sqlTarget;
  });
  // A resposta que não chegou (o catálogo falhou) ou chegou velha (a atualização automática trocou o resultado antes de ela pousar) não fica guardada: pergunta-se
  // de novo na execução seguinte da pessoa (`run`), e uma vez mais logo, se foi o resultado que mudou (`again`). A atualização automática não pergunta a cada 1 s.
  const [again, setAgain] = useState(0);
  const retried = useRef<string | null>(null);
  const answeredKey = useRef<string | null>(null);
  useEffect(() => {
    // Com o alvo do comando na mão, a execução seguinte (o F5) nada pergunta.
    if (!ready || answeredKey.current === key) return;

    let current = true;
    void ask.current().catch(failedAnswer).then((answer) => {
      if (!current) return;
      if (answer.kind === "target") {
        answeredKey.current = key;
        setAnswered((held) => (held?.key === key ? held : { key, target: answer.target }));
      }
      else if (answer.kind === "changed" && retried.current !== `${key}#${run}`) {
        retried.current = `${key}#${run}`;
        setAgain((count) => count + 1);
      }
    });
    return () => {
      current = false;
    };
  }, [ready, key, run, again]);
  const target = answered !== null && answered.key === key ? answered.target : null;

  const tables = useMemo(() => sourceTables(columnCount, target), [columnCount, target]);
  // Em silêncio como o alvo: o catálogo que falha (privilégio, sessão da árvore perdida) deixa os valores como texto, sem aviso (a Estrutura e os Registros, que
  // dizem o erro no próprio lugar, compartilham a consulta sem o `meta`).
  const catalogs = useQueries({ queries: tables.map((table) => ({ ...foreignKeysQuery(connectionId ?? "", table.schema, table.name, queryClient, ready, database), meta: { silent: true } })), combine: foreignKeysOfAll });
  const byTable = new Map(tables.map((table, index) => [tableKey(table), catalogs[index]] as const));
  const computed = shownResultLinks(connected, columnCount, target, (table) => byTable.get(tableKey(table)));
  // Os mesmos links são o mesmo mapa: a grade memorizada não redesenha a cada execução da atualização automática.
  const [links, setLinks] = useState(computed);
  if (!sameLinks(links, computed)) setLinks(computed);

  // Que valores viram link diz o mesmo `sqlLiteral` que o clique usa, com o banco da conexão.
  const linkable = useCallback((value: string) => engine !== undefined && sqlLiteral(engine, value, "text") !== null, [engine]);

  // O clique tem identidade fixa (a linha da grade é memorizada) e lê o que muda por uma ref atualizada depois de cada renderização.
  const latest = useRef({ engine, links, shown, connectionId, database, onOpenTable });
  useEffect(() => {
    latest.current = { engine, links, shown, connectionId, database, onOpenTable };
  });
  const follow = useCallback((columnIndex: number, value: string) => {
    const current = latest.current;
    const link: ColumnLink | undefined = current.links?.get(columnIndex);
    const column = current.shown?.columns[columnIndex];
    if (current.engine === undefined || current.connectionId === null || column === undefined || link === undefined) return;

    const request = followOf(current.engine, column, link, value);
    if (request === null) return;

    // O pedido sai antes de a aba abrir: a vista de lá, ainda por montar, ou já montada e escondida, o encontra à espera (RN-TABELA-007).
    filterHandoff.request(current.connectionId, { ...request.table, ...inDatabase(current.database) }, request.where);
    current.onOpenTable(request.table);
  }, []);

  return { links, linkable, follow };
}
