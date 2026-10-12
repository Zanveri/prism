import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui";

import type { TableRef } from "../../_lib/table-diagram";
import { refreshStructure } from "../../_lib/table-structure.service";
import { workbenchCopy } from "../../_lib/workbench.copy";

/**
 * "Atualizar" e "Tentar de novo" da Estrutura e do Diagrama (que guardam as listas de uma ou mais tabelas,
 * `table-structure.service.ts`) são a mesma ação: refazer as listas, e abrir outra sessão da árvore se a API já não
 * conhece a que elas usavam (RN-AVISO-003). `refreshStructure` faz isso; aqui só se avisa.
 */
export function useStructureActions(connectionId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const refresh = useCallback(
    async (tables: readonly TableRef[]) => {
      const { sessionReopened } = await refreshStructure(queryClient, connectionId, tables);
      if (sessionReopened) toast.warning(workbenchCopy.toasts.sessionReopened);
    },
    [queryClient, toast, connectionId],
  );

  return { refresh };
}
