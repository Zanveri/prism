import { measureElement, observeElementOffset, type Virtualizer } from "@tanstack/react-virtual";

/*
 * As duas guardas de uma lista virtual que fica escondida por `display: none` (a área de trabalho por baixo das outras telas do cofre, o painel da aba
 * inativa). Escondido, o contêiner e tudo o que há dentro dele não têm caixa: as medidas são zero e a rolagem lê zero. NADA disso é dado, e a
 * biblioteca não pode guardá-lo: a altura da linha (`measureRendered`) e a posição da rolagem (`observeRenderedOffset`).
 */

/**
 * A observação da rolagem de uma lista virtual (o `observeElementOffset` do `useVirtualizer`): a da biblioteca, menos numa coisa. A rolagem LIDA SEM
 * CAIXA não é posição de rolagem, e a lista fica com a que tinha.
 *
 * Por quê: a biblioteca relê a rolagem 150 ms depois do último evento (é como ela sabe que a rolagem acabou). Quem rola e, antes disso, vai a outra tela
 * (ou troca de aba) esconde a lista com a releitura ainda por vir: ela acontece com o contêiner sem caixa, lê `scrollTop` 0 e guarda 0. Ao voltar, o
 * Chromium devolve o `scrollTop` de antes SEM evento de rolagem, e a lista desenha as linhas do topo com o DOM lá embaixo: fica em branco até um giro
 * da roda. O mesmo vale para um evento de rolagem que só é entregue com a lista já escondida. O aviso de que a rolagem acabou continua passando (com a
 * posição que a lista já tinha): só a leitura é que não vale.
 */
export function observeRenderedOffset<TScroll extends Element, TItem extends Element>(instance: Virtualizer<TScroll, TItem>, report: (offset: number, isScrolling: boolean) => void) {
  return observeElementOffset(instance, (offset, isScrolling) => {
    const element = instance.scrollElement;
    const hasBox = element !== null && (element.clientHeight > 0 || element.clientWidth > 0);
    report(hasBox ? offset : (instance.scrollOffset ?? 0), isScrolling);
  });
}

/**
 * A medida de uma linha de lista virtual (o `measureElement` do `useVirtualizer`), para a lista que mede as linhas (`ref={….measureElement}`).
 * Mede como a biblioteca mede, menos num caso: ZERO não é altura de linha, é a linha SEM CAIXA, e ela fica com a medida que tinha (a medida
 * guardada ou, se nunca foi medida, a estimada).
 *
 * Por quê: a área de trabalho fica montada por baixo das outras telas do cofre, escondida por `display: none` (`WorkbenchSlot`), e o painel da
 * aba inativa também. Escondida, toda caixa lá dentro vira 0x0 e o `ResizeObserver` avisa isso. A biblioteca guardava o zero como a altura de
 * cada linha desenhada; ao reaparecer, cada linha "crescia" de 0 para a altura de verdade, e ela, achando que uma linha ACIMA da janela tinha
 * crescido, somava essa altura à rolagem que guarda. Numa lista que cabe sem rolar o Chromium não rola nem avisa de rolagem nenhuma, então
 * a rolagem guardada ficava igual à altura da lista inteira, com o DOM no topo: a faixa visível passava a ser a do FIM da lista (a última linha
 * e as do `overscan` antes dela), e as primeiras linhas do navegador sumiam (E2). O teste reproduz a sequência com o `Virtualizer` de verdade.
 */
export function measureRendered<TScroll extends Element | Window, TItem extends Element>(element: TItem, entry: ResizeObserverEntry | undefined, instance: Virtualizer<TScroll, TItem>): number {
  const measured = measureElement(element, entry, instance);
  if (measured !== 0) return measured;

  const index = instance.indexFromElement(element);
  return instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? instance.options.estimateSize(index);
}

/**
 * Esquece as alturas medidas de uma lista virtual que mede as linhas (`measure()`: a estimativa mudou, como na troca da densidade do navegador,
 * RN-NAV-011) e mede de novo, na hora, as linhas desenhadas.
 *
 * Por quê: depois de `measure()` toda linha vale a estimativa até ser medida, e a linha desenhada só é medida pelo `ResizeObserver`, que avisa quando a
 * CAIXA dela muda, e pelo `ref`, que o React só chama ao montar (a função é a mesma a cada renderização). As linhas comuns mudam de altura com a densidade
 * e o observador as mede; a de erro, não: a altura dela vem da mensagem e do botão. Ela ficava com a estimativa até sair de vista, e as linhas de baixo
 * subiam por cima da mensagem e do "Tentar de novo" (a troca feita noutra janela, com a árvore à mostra).
 *
 * As posições que a lista guarda ainda são as de antes de esquecer, e a medida nova só é gravada quando difere delas: a linha que mede o mesmo que antes
 * (a de erro, de novo) não seria gravada. Por isso as linhas são lidas (`getVirtualItems`, que refaz as posições com as estimativas) antes de medir. A
 * medida é a do `ref` (`measureElement`), e a linha sem caixa fica com a estimativa nova (`measureRendered`).
 */
export function remeasureRendered<TScroll extends Element | Window, TItem extends Element>(instance: Virtualizer<TScroll, TItem>) {
  instance.measure();
  instance.getVirtualItems();
  for (const element of [...instance.elementsCache.values()]) if (element.isConnected) instance.measureElement(element);
}
