import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { getBridge } from "@/lib/api/bridge";

/**
 * As preferências de atualização (RN-ATUALIZA-007 e 010) moram no processo principal, fora do cofre, e a tela as lê e as muda pela
 * ponte (`window.prism.updates`): "verificar ao abrir", a versão pulada, a hora da última verificação e "Receber versões beta". A
 * ponte é a fronteira de confiança: a resposta é conferida aqui, e só estes campos passam. "Receber versões beta" ausente ou fora
 * do formato vale desligado, como no arquivo do processo principal; o resto fora do formato é resposta inválida.
 */
const updatePreferencesSchema = z.object({
  checkOnStartup: z.boolean(),
  skippedVersion: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  receiveBeta: z.boolean().optional().catch(undefined),
});

export type UpdatePreferences = z.infer<typeof updatePreferencesSchema>;

/** O que a ponte respondeu, conferido. Lança se não são as preferências. */
function readUpdatePreferences(reply: unknown): UpdatePreferences {
  return updatePreferencesSchema.parse(reply);
}

/**
 * A consulta fica sem aviso (`silent`): a falha aparece na própria seção, com "Tentar de novo". Sem a ponte (a tela aberta fora
 * do Electron) o `getBridge` lança, e é essa a falha que a seção mostra.
 */
export const updatePreferencesQuery = queryOptions({
  queryKey: ["update-preferences"],
  queryFn: async () => readUpdatePreferences(await getBridge().updates.getPreferences()),
  refetchOnWindowFocus: false,
  meta: { silent: true },
});

/** "Verificar ao abrir": a ponte grava e devolve o que ficou, conferido. */
export async function saveCheckOnStartup(value: boolean): Promise<UpdatePreferences> {
  return readUpdatePreferences(await getBridge().updates.setCheckOnStartup(value));
}

/**
 * "Receber versões beta" (RN-ATUALIZA-010): a ponte grava e devolve o que ficou, conferido. Só a escolha vai ao processo principal,
 * e ele não consulta nem instala nada por causa dela: vale a partir da próxima verificação.
 */
export async function saveReceiveBeta(value: boolean): Promise<UpdatePreferences> {
  return readUpdatePreferences(await getBridge().updates.setReceiveBeta(value));
}

/**
 * Relê as preferências na ponte. O processo principal as muda por conta própria: grava a hora a cada consulta (também a que a barra
 * pede), e o diálogo de versão nova grava "pular" e "não verificar ao abrir" direto na ponte. Quem mostra os valores (a seção
 * Atualizações) chama isto quando algo assim acontece; com a seção fechada só marca a leitura como velha.
 */
export function refreshUpdatePreferences(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: updatePreferencesQuery.queryKey });
}

/** A hora da última consulta, como a tela a escreve (data curta e hora, do Brasil). Sem consulta, ou com uma data que não é data, não há o que mostrar. */
export function formatCheckedAt(iso: string | null, timeZone?: string): string | null {
  if (iso === null) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone }).format(date);
}
