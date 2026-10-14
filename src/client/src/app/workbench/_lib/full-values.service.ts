import { z } from "zod";

import { apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

const cellsSchema = z.object({ values: z.array(z.object({ row: z.number().int(), column: z.number().int(), value: z.string().nullable() })) });

/**
 * RN-SQL-017: `POST .../results/{resultID}/cells`, o valor completo das células que chegaram cortadas, pela linha no resultado inteiro e pela
 * coluna (até 10.000 por pedido: quem divide é `fetchFullValues`). Devolve os valores na ordem pedida, cada um achado pela posição que a resposta
 * diz (a célula que ela não traz fica nula, sem tomar o valor de outra). Nunca lança: a recusa volta como valor, e quem chama decide.
 */
export async function resultCells(sessionId: string, resultId: string, cells: { row: number; column: number }[], signal: AbortSignal): Promise<ApiResult<(string | null)[]>> {
  const answer = await apiRequest(prismEndpoints.userDatabaseSessionResultCells(sessionId, resultId), { method: "POST", body: { cells }, schema: cellsSchema, signal });
  if (!answer.ok) return answer;

  const found = new Map(answer.data.values.map((cell) => [`${cell.row}:${cell.column}`, cell.value]));
  return { ok: true, data: cells.map((cell) => found.get(`${cell.row}:${cell.column}`) ?? null) };
}
