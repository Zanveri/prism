import { z } from "zod";
import { apiRequest, unwrap } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

export const historyOutcomeSchema = z.enum([
  "succeeded",
  "error",
  "cancelled",
  "interrupted",
  "refused",
  "running"
]);

export type HistoryOutcome = z.infer<typeof historyOutcomeSchema>;

export const historyItemSchema = z.object({
  id: z.number(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  outcome: historyOutcomeSchema,
  rows: z.number().nullable(),
  connectionId: z.string().nullable(),
  connectionName: z.string().nullable(),
  database: z.string().nullable(),
  environmentName: z.string().nullable(),
  environmentColor: z.string().nullable(),
  text: z.string(),
  errorMessage: z.string().nullable(),
  repeat: z.number(),
  lastAt: z.string()
});

export type HistoryItem = z.infer<typeof historyItemSchema>;

const historyListSchema = z.array(historyItemSchema);

export type GetHistoryParams = {
  connectionId?: string | null;
  q?: string;
  before?: number;
  limit?: number;
};

export async function getHistory(params: GetHistoryParams): Promise<HistoryItem[]> {
  const query = new URLSearchParams();
  if (params.connectionId) {
    query.set("connectionId", params.connectionId);
  }
  if (params.q && params.q.trim().length > 0) {
    query.set("q", params.q.trim());
  }
  if (params.before !== undefined) {
    query.set("before", String(params.before));
  }
  query.set("limit", String(params.limit ?? 100));

  const qs = query.toString();
  const path =
    qs.length > 0
      ? `${prismEndpoints.userJournalHistory}?${qs}`
      : prismEndpoints.userJournalHistory;

  return unwrap(
    await apiRequest(path, {
      method: "GET",
      schema: historyListSchema
    })
  );
}

export async function hideHistoryEntry(id: number): Promise<void> {
  unwrap(
    await apiRequest(prismEndpoints.userJournalHistoryEntry(id), {
      method: "DELETE"
    })
  );
}

export async function hideConnectionHistory(connectionId: string): Promise<void> {
  const path = `${prismEndpoints.userJournalHistory}?connectionId=${encodeURIComponent(connectionId)}`;
  unwrap(
    await apiRequest(path, {
      method: "DELETE"
    })
  );
}
