import { z } from "zod";

/**
 * As respostas das rotas da edição (seção 22, "Rotas e respostas"). `edit-target`: cada tabela do `FROM` com a chave (pela posição da
 * coluna no resultado) e o motivo de não se editar; cada coluna do resultado com a tabela de onde vem (nula na calculada), se se edita
 * e por quê; "Adicionar linha", "Duplicar linha" e "Excluir linha" (`rowOperations`); e o banco sem log de transação (`oneAtATime`, RN-EDIT-012).
 */
/**
 * RN-GRADE-020: o tipo de cada tabela do `FROM` no alvo: `other` é o que o catálogo não acha como tabela nem visão (um sinônimo), e `elsewhere` a tabela de uma
 * aba guardada do script que, escrita sem esquema, leva agora a outra na sessão (RN-SQL-024). O tipo que a tela não conhece vale `other`.
 */
export const editTableKinds = ["table", "view", "materializedView", "foreign", "other", "elsewhere"] as const;

export type EditTableKind = (typeof editTableKinds)[number];

const editTableSchema = z.object({ schema: z.string(), name: z.string(), key: z.array(z.number().int()), editable: z.boolean(), reason: z.string().nullable() });

/** RN-GRADE-020: o `kind` e o `keyColumns` de cada tabela, que a API sempre manda (a chave pelo nome: a da edição, ou a primeira candidata; vazia sem chave). */
const sqlTableFields = { kind: z.enum(editTableKinds).catch("other"), keyColumns: z.array(z.string()) };

const editColumnSchema = z.object({ table: z.number().int().nullable(), baseColumn: z.string().nullable(), editable: z.boolean(), reason: z.string().nullable(), nullable: z.boolean(), generated: z.string().nullable() });

/**
 * O alvo como a edição o lê. O `kind` e o `keyColumns` (RN-GRADE-020) ficam quando vêm, para o "Gerar SQL" usar o alvo que a edição já pediu (RN-EDIT-010:
 * o mesmo alvo, uma vez, `sqlTargetOf`); a edição não precisa deles.
 */
export const editTargetSchema = z.object({
  tables: z.array(editTableSchema.extend({ kind: sqlTableFields.kind.optional(), keyColumns: sqlTableFields.keyColumns.optional() })),
  columns: z.array(editColumnSchema),
  rowOperations: z.boolean(),
  oneAtATime: z.boolean(),
});

export type EditTarget = z.infer<typeof editTargetSchema>;

/** O alvo do "Gerar SQL" e do "Copiar como" do SQL e do DbUnit (`purpose: "sql"`, RN-GRADE-020): o da edição, com o tipo e a chave pelo nome de cada tabela. */
export const sqlTargetSchema = z.object({
  tables: z.array(editTableSchema.extend(sqlTableFields)),
  columns: z.array(editColumnSchema),
  rowOperations: z.boolean(),
  oneAtATime: z.boolean(),
});

export type SqlTarget = z.infer<typeof sqlTargetSchema>;

/** O alvo que a edição já pediu, quando ele traz o tipo e a chave pelo nome de cada tabela (a API de agora sempre os manda); senão, `null`, e o "Gerar SQL" pergunta. */
export function sqlTargetOf(target: EditTarget | null): SqlTarget | null {
  if (target === null) return null;
  const tables: SqlTarget["tables"] = [];
  for (const table of target.tables) {
    if (table.kind === undefined || table.keyColumns === undefined) return null;
    tables.push({ ...table, kind: table.kind, keyColumns: table.keyColumns });
  }
  return { ...target, tables };
}

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
