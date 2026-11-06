import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

import { pathsConfig } from "@/config/paths.config";

import { isLost } from "../workbench/_lib/tab-focus";

/**
 * O lugar das telas que ficam montadas dentro do cofre (Área de trabalho e Construir, RN-CONSTRUIR-001). Elas ficam MONTADAS enquanto o cofre
 * está aberto, e as outras telas de dentro dele (Configurações; o formulário de conexão é um diálogo sobre a área de trabalho) aparecem no lugar
 * delas sem desmontá-las: fora da rota de cada uma, ela fica escondida (`hidden`) e inerte (`inert`: fora da ordem do teclado e do leitor de tela,
 * sem clique), como as abas inativas já ficam. Assim o que o editor guarda, e que não volta se ele for recriado (o cursor, a seleção, o histórico
 * de desfazer, a rolagem), e o que a tela guarda (a largura do navegador, a divisão entre editor e resultado, o zoom do diagrama) não se perdem ao
 * ir e voltar.
 *
 * Com `mountOnFirstVisit`, a tela só é montada na primeira vez que a rota dela é visitada na janela, e dali em diante fica montada até o cofre fechar.
 *
 * Ao reaparecer, o foco volta ao elemento que o tinha quando ela foi escondida (o editor, em geral), se ele ainda existe: as linhas de uma
 * lista virtual saem do DOM enquanto ela está escondida. Só volta se o foco está perdido (RN-ABAS-019): este invólucro é pai da área das abas e o efeito dele
 * roda depois do dela, então devolver o foco antigo sempre desfaria o foco que ela acabou de levar a uma aba aberta na mesma volta da tela.
 */
export function KeepAliveSlot({ path = pathsConfig.workbench, mountOnFirstVisit = false, children }: { path?: string; mountOnFirstVisit?: boolean; children: ReactNode }) {
  const visible = useLocation().pathname === path;
  const [visited, setVisited] = useState(!mountOnFirstVisit || visible);
  if (visible && !visited) setVisited(true);
  const lastFocused = useRef<HTMLElement | null>(null);
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      const target = lastFocused.current;
      if (target?.isConnected && isLost(document.activeElement, document)) target.focus({ preventScroll: true });
    }

    wasVisible.current = visible;
  }, [visible]);

  if (!visited) return null;

  return (
    <div
      hidden={!visible}
      inert={!visible}
      // O foco que ela tinha, para devolvê-lo: depois de escondida o navegador o tira de lá.
      onFocusCapture={(event) => {
        lastFocused.current = event.target as HTMLElement;
      }}
      className="h-full"
    >
      {children}
    </div>
  );
}

/** O invólucro da Área de trabalho, com o caminho padrão `/workbench`. */
export const WorkbenchSlot = KeepAliveSlot;
