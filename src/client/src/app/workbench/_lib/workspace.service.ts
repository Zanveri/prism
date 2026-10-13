import { z } from "zod";

import { apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { savedTabSchema, type SavedTab, type SavedWorkspace } from "../../../../electron/workspace-messages";

/**
 * A leitura das abas gravadas (`GET api/user/workspace`, seção 24: RN-ABAS-006), que a janela principal reabre na entrada. A gravação não passa por aqui: quem
 * grava é o processo principal, que junta as abas de todas as janelas (`workspace-hub.ts`), e a tela só conta as dela pela ponte.
 *
 * A API devolve cada aba com todos os campos, os do outro tipo nulos; o schema de cada aba (o mesmo da gravação, `workspace-messages.ts`) fica só com os do tipo
 * dela. Uma aba que não confere fica de fora sem derrubar as outras, e a ativa continua apontando para a mesma aba; se a que não conferiu era a ativa, para a
 * que ficou no lugar dela (ou para a anterior, se era a última). Só a resposta sem a forma de uma área de trabalho é recusada por inteiro.
 */
const workspaceResponseSchema = z.object({ tabs: z.array(z.unknown()), activeIndex: z.number().int().min(0).nullable() }).transform(({ tabs, activeIndex }): SavedWorkspace => {
  const parsed = tabs.map((tab) => savedTabSchema.safeParse(tab));
  const kept: SavedTab[] = parsed.flatMap((result) => (result.success ? [result.data] : []));
  if (activeIndex === null || kept.length === 0) return { tabs: kept, activeIndex: null };

  const before = parsed.slice(0, Math.min(activeIndex, parsed.length)).filter((result) => result.success).length;
  return { tabs: kept, activeIndex: Math.min(before, kept.length - 1) };
});

export function getWorkspace(signal?: AbortSignal): Promise<ApiResult<SavedWorkspace>> {
  return apiRequest(prismEndpoints.userWorkspace, { schema: workspaceResponseSchema, signal });
}
