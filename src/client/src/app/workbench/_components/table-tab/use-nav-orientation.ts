import { useEffect, useState, type RefObject } from "react";

import { orientationOf } from "../../_lib/structure-sections";
import type { TabOrientation } from "../../_lib/table-view";

/**
 * A orientação da lista de seções da Estrutura, lida do que o CSS fez com ela. A lista é uma coluna ao lado da seção e uma fileira no topo dela quando o
 * painel é estreito, e quem decide é uma consulta de contêiner do CSS (`structure-sections.tsx`): a largura limite está escrita num lugar só. Este gancho não
 * repete a conta, só lê o resultado (`flex-direction` da lista, em `orientationOf`) e o lê de novo quando o tamanho da lista muda, para o `aria-orientation` e
 * as setas valerem para o que a pessoa vê. Começa na vertical (a lista ao lado da seção), que é também o que a renderização de servidor e os testes veem.
 *
 * Sem caixa (a área de trabalho por baixo de outra tela, escondida com `display: none`: toda caixa mede 0) não há o que ler, e a orientação fica como estava; ao
 * reaparecer, o observador avisa. Não é preciso `useLayoutEffect`: o que muda antes da leitura é só o atributo ARIA, e o desenho já é o do CSS.
 */
export function useNavOrientation(ref: RefObject<HTMLElement | null>): TabOrientation {
  const [orientation, setOrientation] = useState<TabOrientation>("vertical");

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    function read() {
      if (element!.clientWidth > 0) setOrientation(orientationOf(getComputedStyle(element!).flexDirection));
    }

    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return orientation;
}
