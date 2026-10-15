import { z } from "zod";

/**
 * As respostas das rotas da edição (seção 22, "Rotas e respostas"). `edit-target`: cada tabela do `FROM` com a chave (pela posição da
 * coluna no resultado) e o motivo de não se editar; cada coluna do resultado com a tabela de onde vem (nula na calculada), se se edita
 * e por quê; "Linha nova" e "Excluir linha" (`rowOperations`); e o banco sem log de transação (`oneAtATime`, RN-EDIT-012).
 */
export const editTargetSchema = z.object({
  tables: z.array(z.object({ schema: z.string(), name: z.string(), key: z.array(z.number().int()), editable: z.boolean(), reason: z.string().nullable() })),
  columns: z.array(z.object({ table: z.number().int().nullable(), baseColumn: z.string().nullable(), editable: z.boolean(), reason: z.string().nullable(), nullable: z.boolean(), generated: z.string().nullable() })),
  rowOperations: z.boolean(),
  oneAtATime: z.boolean(),
});

export type EditTarget = z.infer<typeof editTargetSchema>;

/** RN-EDIT-008: os comandos do Salvar, com os literais; os valores sem literal vão como `?`, e o texto deles em `values`, na ordem. */
export const editPreviewSchema = z.object({ statements: z.array(z.object({ sql: z.string(), values: z.array(z.string().nullable()) })), oneAtATime: z.boolean() });

export type EditPreview = z.infer<typeof editPreviewSchema>;

export const editsAppliedSchema = z.object({ applied: z.number().int() });

export type EditsApplied = z.infer<typeof editsAppliedSchema>;

/** Uma alteração do pedido: `table` pela posição em `tables`, `column` pela posição no resultado, `key` com os textos que a grade leu na chave. */
export type ApiChange =
  | { kind: "update"; table: number; key: string[]; set: { column: number; value: string | null }[] }
  | { kind: "delete"; table: number; key: string[] }
  | { kind: "insert"; table: number; values: { column: number; value: string | null }[] };

/** As extensões das recusas da edição. O que vier fora do formato vira nulo: a mensagem aparece do mesmo jeito. */
const editErrorDetailsSchema = z.object({
  reason: z.string().nullish().catch(null),
  change: z.number().int().min(0).nullish().catch(null),
  column: z.number().int().min(0).nullish().catch(null),
  rowsAffected: z.number().int().min(0).nullish().catch(null),
  applied: z.number().int().min(0).nullish().catch(null),
});

export type EditErrorDetails = { reason: string | null; change: number | null; column: number | null; rowsAffected: number | null; applied: number | null };

export function editErrorDetails(extensions: Record<string, unknown>): EditErrorDetails {
  const details = editErrorDetailsSchema.parse(extensions);
  return { reason: details.reason ?? null, change: details.change ?? null, column: details.column ?? null, rowsAffected: details.rowsAffected ?? null, applied: details.applied ?? null };
}
