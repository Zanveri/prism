import { useLocation } from "react-router";

import { pathsConfig } from "@/config/paths.config";

/**
 * A área de trabalho é a tela mostrada, e não está escondida por baixo de Configurações, Conexões ou Drivers. É a mesma regra do
 * `WorkbenchSlot` (`app/_components/workbench-slot.tsx`), que a esconde fora da rota dela. Uma aba só está À VISTA (RN-SEG-001) se for
 * a ativa e a área de trabalho estiver na tela: a escondida não fala com o banco.
 */
export function useWorkbenchOnScreen(): boolean {
  return useLocation().pathname === pathsConfig.workbench;
}
