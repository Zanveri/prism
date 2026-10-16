import { z } from "zod";

/**
 * Um trabalho em segundo plano da API (RN-EXPORT-016, seção 6): `GET api/user/transfers/{id}` e cada item de `GET api/user/transfers`. "Toda chave vem
 * sempre, nula quando não se aplica": a tela exige o que decide (o id, o estado, as contagens) e tolera o resto em qualquer formato, como a sessão da árvore
 * (uma fase ou um motivo que esta versão não conhece não derrubam a barra de status). Os campos da importação e da cópia para outro banco (seção 36:
 * `targetConnectionID`, `committed`, `size`, `uncertain`) passam sem ser lidos.
 */

const count = z.number().int().min(0);
const nullableCount = z.number().int().min(0).nullish().catch(null);

/** O resumo do fim (`done`): o que o aviso de sucesso diz além das linhas (RN-EXPORT-022). */
export const transferSummarySchema = z.object({
  rows: count,
  bytes: z.number().min(0).nullish().catch(null),
  sheets: nullableCount,
  cutValues: nullableCount,
  removedCharacters: nullableCount,
  skippedRows: nullableCount,
});

export type TransferSummary = z.infer<typeof transferSummarySchema>;

/** O erro do trabalho que falhou: o código (a tela decide por ele, nunca pela mensagem), a mensagem como veio e o SQLSTATE. */
export const transferErrorSchema = z.object({ code: z.string(), message: z.string(), sqlState: z.string().nullish().catch(null) });

export type TransferError = z.infer<typeof transferErrorSchema>;

export const transferStates = ["running", "done", "failed", "canceled"] as const;
export const transferPhases = ["connecting", "counting", "reading", "finishing"] as const;

export type TransferState = (typeof transferStates)[number];
export type TransferPhase = (typeof transferPhases)[number];

export const transferSchema = z.object({
  id: z.string().min(1),
  kind: z.string().nullish().catch(null),
  connectionID: z.string().nullish().catch(null),
  windowID: z.number().int().nullish().catch(null),
  state: z.enum(transferStates),
  phase: z.enum(transferPhases).nullish().catch(null),
  rows: count,
  total: nullableCount,
  bytes: z.number().min(0),
  summary: transferSummarySchema.nullish().catch(null),
  error: transferErrorSchema.nullish().catch(null),
  reason: z.string().nullish().catch(null),
});

export type Transfer = z.infer<typeof transferSchema>;

/** A lista: o item que não confere (de uma versão mais nova da API, de outro tipo) fica de fora, sem derrubar a lista inteira. */
export const transferListSchema = z.array(z.unknown()).transform((items) => items.flatMap((item) => {
  const parsed = transferSchema.safeParse(item);
  return parsed.success ? [parsed.data] : [];
}));

/** O 202 do `POST api/user/transfers/exports`. */
export const startedTransferSchema = z.object({ id: z.string().min(1) });

/** Em andamento para as saídas (RN-EXPORT-023): o que roda e o pronto que ainda não foi entregue (a tela o esquece só depois da entrega). */
export function inProgress(transfer: Pick<Transfer, "state">): boolean {
  return transfer.state === "running" || transfer.state === "done";
}
