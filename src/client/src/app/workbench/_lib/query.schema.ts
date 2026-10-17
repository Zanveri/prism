import { z } from "zod";

/**
 * Uma coluna do resultado. `kind` só serve para alinhar (número à direita): um valor que a tela
 * não conhece vira `text`, em vez de recusar um resultado que o banco já entregou.
 */
export const queryColumnSchema = z.object({ name: z.string(), type: z.string(), kind: z.enum(["text", "number", "datetime", "boolean", "binary"]).catch("text") });

export type QueryColumn = z.infer<typeof queryColumnSchema>;

/** Cada célula viaja como texto ou nulo, já formatada pela API (RN-SQL-011). */
export type QueryRow = (string | null)[];

/**
 * Uma página de linhas. `truncatedCells` são pares `[linha, coluna]` relativos à página.
 * `totalRows` só vem preenchido quando o comando gravou e devolveu linhas (RN-SQL-013): ele foi
 * executado até o fim, esse é o total que devolveu, e não há cursor aberto para ler o resto.
 */
export type QueryPage = {
  kind: "rows";
  columns: QueryColumn[];
  rows: QueryRow[];
  hasMore: boolean;
  elapsedMs: number;
  truncatedCells: [number, number][];
  totalRows: number | null;
  /** RN-EDIT-002: o resultado a que a página pertence (muda a cada execução); é por ele que a edição pergunta e grava. Nulo sem ele. */
  resultId?: string | null;
  /** RN-EDIT-002: o motivo de o resultado inteiro ser só leitura, quando a API já o sabe sem consultar o banco ("união de consultas"). */
  readOnly?: string | null;
  /**
   * RN-GRADE-011: como o filtro do resultado entrou no comando: `merged` (no `WHERE` e no `ORDER BY` do próprio comando) ou `wrapped` (por fora, `SELECT *
   * FROM (<comando>) … WHERE …`); nulo sem filtro.
   */
  filterApplied?: FilterApplied | null;
  /**
   * RN-EXPORT-002: o comando executado, com o filtro, é uma leitura pela regra do somente leitura (RN-PROT-005) e não gravou (RN-SQL-013). É o que habilita o
   * "Exportar…" do resultado (RN-EXPORT-001). Nulo quando a API não o diz: na dúvida, não é leitura.
   */
  read?: boolean | null;
};

/** RN-GRADE-011: o filtro do resultado juntado ao comando (`merged`) ou por fora dele (`wrapped`). */
export type FilterApplied = "merged" | "wrapped";

/** O que um comando que não devolve linhas responde (RN-SQL-008). */
export type QueryAffected = { kind: "affected"; rowsAffected: number; elapsedMs: number };

export type QueryResult = QueryPage | QueryAffected;

/**
 * A resposta de `queries` e de `queries/next` (seção 6). A API manda a mesma forma nos dois casos,
 * com `null` no que não se aplica; a seção 6 descreve o comando sem linhas só com `rowsAffected` e
 * `elapsedMs`. As duas grafias passam: o que decide é haver `columns`.
 *
 * O que não se tolera é linha com tamanho diferente do número de colunas: a grade leria a célula
 * de uma coluna na outra.
 */
const responseSchema = z.object({
  columns: z.array(queryColumnSchema).nullish(),
  rows: z.array(z.array(z.string().nullable())).nullish(),
  hasMore: z.boolean().nullish(),
  elapsedMs: z.number(),
  truncatedCells: z.array(z.tuple([z.number().int(), z.number().int()])).nullish(),
  rowsAffected: z.number().int().nullish(),
  totalRows: z.number().int().nullish(),
  // A edição (seção 22): fora do formato não recusa a página, que o banco já entregou; só não há o que editar.
  resultID: z.string().nullish().catch(null),
  editable: z.object({ known: z.boolean(), reason: z.string().nullish() }).nullish().catch(null),
  // RN-GRADE-011: um valor que a tela não conhece não recusa a página, que o banco já entregou; só não se sabe como o filtro entrou.
  filterApplied: z.enum(["merged", "wrapped"]).nullish().catch(null),
  // RN-EXPORT-002: fora do formato não recusa a página; só o "Exportar…" fica desabilitado, como na dúvida.
  read: z.boolean().nullish().catch(null),
});

export const queryResultSchema = responseSchema.transform((response, context): QueryResult => {
  const { columns, rows, elapsedMs } = response;
  const refuse = (message: string) => {
    context.issues.push({ code: "custom", message, input: response });
    return z.NEVER;
  };

  if (columns == null) return typeof response.rowsAffected === "number" ? { kind: "affected", rowsAffected: response.rowsAffected, elapsedMs } : refuse("A resposta não tem colunas nem linhas afetadas.");
  if (rows == null) return refuse("A resposta tem colunas e não tem linhas.");
  if (rows.some((row) => row.length !== columns.length)) return refuse("Há linha com tamanho diferente do número de colunas.");

  const readOnly = response.editable?.known === true ? (response.editable.reason ?? null) : null;
  return { kind: "rows", columns, rows, hasMore: response.hasMore ?? false, elapsedMs, truncatedCells: response.truncatedCells ?? [], totalRows: response.totalRows ?? null, resultId: response.resultID ?? null, readOnly, filterApplied: response.filterApplied ?? null, read: response.read ?? null };
});

/** "Carregar mais" só devolve página de linhas. */
export const queryPageSchema = queryResultSchema.transform((result, context): QueryPage => {
  if (result.kind === "rows") return result;

  context.issues.push({ code: "custom", message: "A página não tem linhas.", input: result });
  return z.NEVER;
});

export const queryTotalSchema = z.object({ total: z.number().int() });

export type QueryTotal = z.infer<typeof queryTotalSchema>;

/** Os campos extras do 422 `SQL_EXECUTION_FAILED` (RN-SQL-009). `position` conta de 1 em diante no SQL enviado e pode faltar. */
const sqlErrorDetailsSchema = z.object({ sqlState: z.string().nullish().catch(null), position: z.number().int().min(1).nullish().catch(null) });

export type SqlErrorDetails = { sqlState: string | null; position: number | null };

/** Lê o SQLSTATE e a posição dos campos extras do erro. O que vier fora do formato vira nulo: a mensagem do banco aparece do mesmo jeito. */
export function sqlErrorDetails(extensions: Record<string, unknown>): SqlErrorDetails {
  const { sqlState, position } = sqlErrorDetailsSchema.parse(extensions);
  return { sqlState: sqlState ?? null, position: position ?? null };
}
