import { z } from "zod";

/**
 * Um trabalho em segundo plano da API (RN-EXPORT-016, seção 6): `GET api/user/transfers/{id}` e cada item de `GET api/user/transfers`. "Toda chave vem
 * sempre, nula quando não se aplica": a tela exige o que decide (o id, o estado, as contagens) e tolera o resto em qualquer formato, como a sessão da árvore
 * (uma fase ou um motivo que esta versão não conhece não derrubam a barra de status). Com a seção 36 o mesmo item é também o da importação de dados e o da
 * cópia para outro banco (`kind` `import` e `copy`), com `targetConnectionID`, `committed`, `size` e `uncertain`, as fases da carga e os campos novos do
 * resumo e do erro.
 */

const count = z.number().int().min(0);
const nullableCount = z.number().int().min(0).nullish().catch(null);

/**
 * O resumo do fim (`done`): o que o aviso de sucesso diz além das linhas (RN-EXPORT-022). Na importação e na cópia (RN-IMPORT-020), as linhas confirmadas,
 * se a tabela foi esvaziada e o que a leitura fez no caminho: as linhas vazias puladas, os valores que perderam o apóstrofo da proteção contra fórmula, as
 * linhas completadas com nulo e as células com fórmula sem resultado guardado (zero quando não se aplicam).
 */
export const transferSummarySchema = z.object({
  rows: count,
  bytes: z.number().min(0).nullish().catch(null),
  sheets: nullableCount,
  cutValues: nullableCount,
  removedCharacters: nullableCount,
  skippedRows: nullableCount,
  committed: nullableCount,
  emptied: z.boolean().nullish().catch(null),
  shortRows: nullableCount,
  skippedLines: nullableCount,
  unguarded: nullableCount,
  formulasWithoutValue: nullableCount,
});

export type TransferSummary = z.infer<typeof transferSummarySchema>;

/**
 * O erro do trabalho que falhou: o código (a tela decide por ele, nunca pela mensagem), a mensagem como veio e o SQLSTATE. Na importação e na cópia
 * (RN-IMPORT-016), também a linha do arquivo (ou da leitura da origem), a coluna, o lado (`target`, ou `source` na leitura da cópia), as linhas confirmadas e a
 * dúvida sobre a última confirmação; todos presentes, nulos quando não se aplicam.
 */
export const transferErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  sqlState: z.string().nullish().catch(null),
  line: z.number().int().min(0).nullish().catch(null),
  column: z.string().nullish().catch(null),
  side: z.enum(["source", "target"]).nullish().catch(null),
  committed: nullableCount,
  uncertain: z.boolean().nullish().catch(null),
});

export type TransferError = z.infer<typeof transferErrorSchema>;

export const transferStates = ["running", "done", "failed", "canceled"] as const;
/** As fases da exportação (RN-EXPORT-016). */
export const exportPhases = ["connecting", "counting", "reading", "finishing"] as const;
/** As fases da importação e da cópia (RN-IMPORT-014 e 027): a conferência do arquivo, o esvaziamento, a leitura com a gravação e a confirmação final. */
export const loadPhases = ["connecting", "counting", "checking", "emptying", "loading", "committing"] as const;
export const transferPhases = ["connecting", "counting", "reading", "finishing", "checking", "emptying", "loading", "committing"] as const;
export const transferKinds = ["export", "import", "copy"] as const;

export type TransferState = (typeof transferStates)[number];
export type TransferPhase = (typeof transferPhases)[number];
export type ExportPhase = (typeof exportPhases)[number];
export type LoadPhase = (typeof loadPhases)[number];
export type TransferKind = (typeof transferKinds)[number];

export const isExportPhase = (phase: TransferPhase | null | undefined): phase is ExportPhase => (exportPhases as readonly string[]).includes(phase ?? "");
export const isLoadPhase = (phase: TransferPhase | null | undefined): phase is LoadPhase => (loadPhases as readonly string[]).includes(phase ?? "");

export const transferSchema = z.object({
  id: z.string().min(1),
  kind: z.string().nullish().catch(null),
  connectionID: z.string().nullish().catch(null),
  /** A conexão de destino: nula na exportação; igual a `connectionID` na importação; a do destino na cópia. */
  targetConnectionID: z.string().nullish().catch(null),
  windowID: z.number().int().nullish().catch(null),
  state: z.enum(transferStates),
  phase: z.enum(transferPhases).nullish().catch(null),
  rows: count,
  /** As linhas já confirmadas, na importação e na cópia (no Informix sem log, todas as gravadas); nulo na exportação. */
  committed: nullableCount,
  total: nullableCount,
  /** Na exportação, o tamanho do arquivo temporário; na importação, o que já foi lido do arquivo; nulo na cópia (vale 0 aqui). */
  bytes: z.number().min(0).nullish().transform((bytes) => bytes ?? 0),
  /** O tamanho do arquivo da importação (no XLSX, o descompactado da planilha); nulo na exportação e na cópia. */
  size: z.number().min(0).nullish().catch(null),
  /** Na importação e na cópia que pararam: o Prism não sabe o que a última confirmação deixou (RN-IMPORT-014 e 016). */
  uncertain: z.boolean().nullish().catch(null),
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

/** O tipo do trabalho: o que a API não diz, ou diz um que a tela não conhece, é tomado como exportação (o único tipo de antes da seção 36). */
export function kindOf(transfer: Pick<Transfer, "kind">): TransferKind {
  return transfer.kind === "import" || transfer.kind === "copy" ? transfer.kind : "export";
}

/**
 * Em andamento para as saídas (RN-EXPORT-023 e RN-IMPORT-021): o que roda e, na exportação, o pronto que ainda não foi entregue (a tela o esquece só depois
 * da entrega). A importação e a cópia que terminaram já não fazem nada: a tela só lê o fim delas e as esquece.
 */
export function inProgress(transfer: Pick<Transfer, "state" | "kind">): boolean {
  return transfer.state === "running" || (transfer.state === "done" && kindOf(transfer) === "export");
}
