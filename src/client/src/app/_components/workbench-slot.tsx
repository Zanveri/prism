import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";

import { pathsConfig } from "@/config/paths.config";

/**
 * O lugar da área de trabalho dentro do cofre. Ela fica MONTADA enquanto o cofre está aberto, e as outras telas de dentro dele
 * (Configurações; o formulário de conexão é um diálogo sobre ela) aparecem no lugar dela sem desmontá-la: fora da rota dela ela fica escondida (`hidden`) e inerte
 * (`inert`: fora da ordem do teclado e do leitor de tela, sem clique), como as abas inativas já ficam. Assim o que o editor
 * guarda, e que não volta se ele for recriado (o cursor, a seleção, o histórico de desfazer, a rolagem), e o que a tela guarda
 * (a largura do navegador, a divisão entre editor e resultado, o zoom do diagrama) não se perdem ao ir e voltar.
 *
 * Uma consulta em andamento continua rodando com ela escondida (o executor mora no provedor, e é o que acontece ao trocar de aba). Os
 * atalhos dela (Ctrl+Enter, as setas da árvore) são do que está com o foco, e com ela inerte nada ali recebe o foco: não disparam.
 *
 * Ao reaparecer, o foco volta ao elemento que o tinha quando ela foi escondida (o editor, em geral), se ele ainda existe: as linhas de uma
 * lista virtual saem do DOM enquanto ela está escondida.
 *
 * `hidden` é `display: none`: enquanto dura, TODA caixa aqui dentro mede 0x0, e quem observa tamanho (`ResizeObserver`) é avisado disso. O
 * CodeMirror e o diagrama tratam o tamanho zero como "sem medida". A lista virtual, não: o contêiner sem altura só deixa de desenhar linhas
 * (e volta a desenhar quando reaparece), mas a LINHA medida com altura zero ficava guardada assim, e as primeiras linhas do navegador sumiam
 * ao voltar (E2). Por isso a lista que mede as linhas passa `measureElement: measureRendered` (`workbench/_lib/row-measure.ts`, com teste).
 */
export function WorkbenchSlot({ children }: { children: ReactNode }) {
  const visible = useLocation().pathname === pathsConfig.workbench;
  const lastFocused = useRef<HTMLElement | null>(null);
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      const target = lastFocused.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }

    wasVisible.current = visible;
  }, [visible]);

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
