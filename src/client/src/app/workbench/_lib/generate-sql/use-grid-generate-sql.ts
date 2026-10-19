import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { EditAccess } from "../cell-editing";
import type { ObjectKind } from "../object-kind";
import type { GenerateSqlSource, GridSelectionContext } from "../use-record-edits";
import { generateSql, sqlItems, type SqlItem } from "./generate-sql";
import { readSqlOptions } from "./generate-sql-choices";
import { sqlTextLimit, utf8Bytes, type FullValuesAnswer, type LoadedRows, type SqlFlowDeps } from "./generate-sql-flow";
import { sqlMenuStates, sqlPlanOf } from "./sql-plan";
import { sqlSelectionOf } from "./sql-selection";
import { catalogReader, useGenerateSql, type GenerateSqlDeps } from "./use-generate-sql";

/**
 * O "Gerar SQL" da grade ligado (RN-GRADE-006 e 018 a 020, seção 37): a fonte do submenu que `useRecordEdits` recebe (`GenerateSqlSource`), com o motivo de
 * cada item desabilitado, e o diálogo, aberto com as linhas da seleção daquele instante. As peças que falam com a API vêm do contexto da grade
 * (`GridSelectionContext`: o alvo com `purpose: "sql"`, o mesmo do "Copiar como"; o valor completo das cortadas; a pausa da atualização automática; "o
 * resultado ainda é o mesmo?") e do cache da Estrutura (o CREATE); as decisões são de `sql-plan.ts`, `sql-selection.ts` e `generate-sql-flow.ts`, puras.
 */

/** Nos Registros, a tabela da aba e o que a árvore diz dela (`objectKindOf`): o CREATE vai direto ao catálogo, e o de uma visão vem desabilitado. */
export type RecordsTable = { schema: string; name: string; kind: ObjectKind };

type Params = {
  /** A conexão e o banco da aba: o catálogo do CREATE e a aba de consulta nova são deles. */
  connectionId: string | null;
  database?: string;
  /** O usuário do cofre: as opções do diálogo são lembradas por ele (RN-GRADE-018). */
  userName: string | null;
  /** Nos Registros, a tabela da aba (lida na hora: a árvore pode ter chegado depois); nula no resultado de um comando. */
  records: () => RecordsTable | null;
  /** RN-PROT-002: a conexão é somente leitura agora (o aviso de que o SQL que grava será recusado nela). */
  readOnlyConnection: () => boolean;
  /** RN-ARVORE-006 e 007: a aba de consulta nova, da conexão e do banco do resultado, com o texto no editor; nada é executado. */
  openQueryTab: (connectionId: string, sql: string, database?: string) => void;
};

const allowed: EditAccess = { editable: true };

/** O que o gancho devolve: a fonte do submenu e as propriedades do diálogo aberto (nulas com ele fechado). */
export function useGridGenerateSql({ connectionId, database, userName, records, readOnlyConnection, openQueryTab }: Params) {
  const queryClient = useQueryClient();
  // A grade de quando o item foi escolhido: o diálogo pergunta, busca e confere por ela até fechar.
  const chosen = useRef<GridSelectionContext | null>(null);
  const latest = useRef({ connectionId, database, records, readOnlyConnection, openQueryTab, userName });
  useEffect(() => {
    latest.current = { connectionId, database, records, readOnlyConnection, openQueryTab, userName };
  });

  const deps: GenerateSqlDeps = {
    // RN-GRADE-020 e RN-EDIT-010: o alvo que a edição já pediu, o que o "Copiar como" já perguntou, ou o `edit-target` com `purpose: "sql"`.
    target: () => chosen.current?.sqlTarget() ?? Promise.resolve({ kind: "failed", message: null }),
    // RN-SQL-017: o valor completo das cortadas que o item usa, pela rota das células, com a linha da grade (o número dela menos um).
    fullValues: async (cells, signal): Promise<FullValuesAnswer> => {
      const context = chosen.current;
      if (context === null) return { kind: "cancelled" };
      const full = await context.fullValues(
        cells.map(({ row, column }) => ({ row: row.number - 1, column })),
        signal,
      );
      if (full === null) return { kind: "cancelled" };
      if (context.moved()) return { kind: "changed" };
      return { kind: "values", valueOf: (row, column) => full.valueOf(row.number - 1, column) };
    },
    // RN-TABELA-003: as três listas da Estrutura, pela sessão da árvore e do mesmo cache, no banco da aba.
    catalog: (table, signal): ReturnType<SqlFlowDeps["catalog"]> => {
      const { connectionId: id, database: db } = latest.current;
      return id === null ? Promise.resolve({ kind: "failed", message: null }) : catalogReader(queryClient, id, db)(table, signal);
    },
    stillCurrent: () => chosen.current === null || !chosen.current.moved(),
    // RN-GRADE-023: com colunas inteiras, todas as linhas do resultado: as que faltam vêm antes, pelo carregar da grade, e param quando o texto passaria de
    // 1 MB (a conta é a do texto de cada página, com as opções lembradas; o texto final é medido de novo, exato). Depois, a grade do diálogo é a das linhas
    // que chegaram.
    loadRows: async (request, plan, signal, progress): Promise<LoadedRows | null> => {
      const context = chosen.current;
      if (context === null || context.wholeColumns === null || !context.rowsToLoad || request.item === "create") return null;
      const item = request.item;
      const options = { ...readSqlOptions(latest.current.userName) };
      let bytes = 0;
      const outcome = await context.loadRest({
        signal,
        onProgress: progress,
        keepGoing: (rows, from) => {
          const positions = from === 0 ? context.rows : Array.from({ length: rows.rows.length - from }, (_, index) => from + index);
          const page = sqlSelectionOf(rows, context.pending, positions).rows;
          if (page.length === 0) return true;
          const text = generateSql(item, plan, page, options, sqlTextLimit);
          if (text.tooLarge === true) return false;
          bytes += utf8Bytes(text.text);
          return bytes <= sqlTextLimit;
        },
      });
      if (outcome.kind === "stopped") return { kind: "tooLarge" };
      if (outcome.kind === "refused") return { kind: "refused", reason: outcome.reason, detail: outcome.detail };
      if (outcome.kind === "cancelled") return { kind: signal.aborted ? "cancelled" : "changed" };
      chosen.current = outcome.context;
      return { kind: "rows", ...sqlSelectionOf(outcome.context.shown, outcome.context.pending, outcome.context.rows) };
    },
    // RN-GRADE-014: a atualização automática fica em pausa enquanto o diálogo está aberto.
    hold: () => chosen.current?.hold() ?? (() => {}),
    openQueryTab: (sql) => {
      const { connectionId: id, database: db, openQueryTab: open } = latest.current;
      if (id !== null) open(id, sql, db);
    },
  };
  const generate = useGenerateSql({ userName, deps });
  // O submenu lê o gancho de agora (o plano que a primeira escolha deixou) por uma ref: a fonte fica a mesma de uma renderização para outra.
  const generateNow = useRef(generate);
  useEffect(() => {
    generateNow.current = generate;
  });

  const source = useMemo<GenerateSqlSource>(
    () => ({
      // RN-GRADE-006: habilitar não custa consulta. O plano vem do alvo que a tela já sabe (o da edição, o do "Copiar como", o da primeira escolha), e sem ele
      // os itens valem, menos os que a grade já recusa (sem linhas, só linhas novas, a aba ocupada, a visão dos Registros).
      access: (context) => {
        const engine = context.engine;
        if (engine === undefined) return {};
        const read = context.layout.read;
        const savedRows = context.rows.filter((row) => row < read).length;
        const known = context.knownSqlTarget();
        const plan = known !== null && (known.kind === "target" || known.kind === "notEditable") ? sqlPlanOf(engine, context.shown.columns, known) : context.resultId === null ? null : generateNow.current.planOf(context.resultId);
        const table = latest.current.records();
        const states = sqlMenuStates({ gridRows: read + context.layout.added.length, savedRows, newRows: context.rows.length - savedRows, busy: context.busy, plan, records: table === null ? null : { name: table.name, kind: table.kind } });
        return Object.fromEntries(sqlItems.map((item) => [item, states[item] === null ? allowed : { editable: false, reason: states[item] }]));
      },
      // RN-GRADE-018: as linhas do diálogo são as da seleção quando ele abriu.
      choose: (action, context) => {
        const engine = context.engine;
        if (engine === undefined || context.resultId === null) return;
        const { rows, newRows } = sqlSelectionOf(context.shown, context.pending, context.rows);
        chosen.current = context;
        generateNow.current.open({
          resultId: context.resultId,
          item: action.slice("sql:".length) as SqlItem,
          engine,
          resultColumns: context.shown.columns,
          rows,
          newRows,
          records: latest.current.records(),
          readOnlyConnection: latest.current.readOnlyConnection(),
        });
      },
    }),
    [],
  );

  return { source, dialog: generate.dialog };
}

/** O que o gancho devolve a quem monta o diálogo (`resultEditDialogs`). */
export type GridGenerateSql = ReturnType<typeof useGridGenerateSql>;
