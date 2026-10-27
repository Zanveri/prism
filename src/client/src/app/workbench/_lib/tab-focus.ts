/**
 * O foco ao abrir, fechar e trocar de aba (RN-ABAS-019), sem React. Abrir, fechar e trocar de aba mudava a aba ativa sem dizer para onde o foco ia, e ele ficava no
 * navegador ou caía no corpo da página, fora da área das abas, onde o Ctrl+W, o F5, o Alt+X, o Ctrl+S e o Ctrl+Espaço não chegam. Aqui estão as peças:
 *
 * - a leitura do foco: onde ele está (`regionOf`), se está perdido (`isLost`) e se há um diálogo, um menu ou uma lista aberta (`popupOpen`);
 * - a decisão (`focusAfterChange`), uma função pura, para onde ele vai depois de uma mudança;
 * - o pedido que quem abre uma aba deixa (`tabFocus`), que a área das abas atende depois de a aba aparecer;
 * - o registro de COMO cada aba se foca (`tabEntries`): cada painel diz como, e um lugar só, a área das abas, decide quando.
 *
 * De módulo, como `result-slots.ts`: cada janela do app tem o seu.
 */

/** Onde o foco estava: na faixa das abas, no conteúdo de uma aba, ou fora das abas (o navegador, a barra de cima). */
export type FocusRegion = "strip" | "content" | "outside";

/** Para onde o foco vai: à entrada da aba ativa, à aba dela na faixa, ou à linha do navegador que o Tab alcança. */
export type FocusDestination = "entry" | "strip" | "navigator";

const dialogOrMenu = '[aria-modal="true"], dialog[open], [role="menu"]';
const listbox = '[role="listbox"]';

/**
 * Um diálogo modal, um menu ou uma lista aberta. Vale para a leitura do foco (o que está dentro deles não conta como região: o diálogo que se fecha devolve o
 * foco a quem o tinha) e para os atalhos da janela, que não agem por baixo deles.
 */
const popup = `${dialogOrMenu}, ${listbox}`;

/** Há um diálogo modal, um menu ou uma lista aberta na página? */
export function popupOpen(page: Pick<Document, "querySelector"> = document): boolean {
  return page.querySelector(popup) !== null;
}

/** A lista de sugestões do CodeMirror (o editor SQL e o filtro dos Registros): um `listbox` dentro de um `.cm-tooltip`, no `body`. */
const editorList = ".cm-tooltip";

/**
 * Há um diálogo, um menu ou uma lista que TOMOU o foco? É o `popupOpen` sem a lista de sugestões do CodeMirror: ela é do editor que tem o foco, e fecha quando ele o
 * perde, mas ainda está na página quando a aba que a pessoa abriu (o Ctrl+clique no nome de uma tabela, com a lista aberta de uma digitação) esconde o painel do editor.
 * Contada como popup, ela bloquearia o foco da aba nova, que cairia no corpo da página.
 */
export function popupTakesFocus(page: Pick<Document, "querySelector" | "querySelectorAll">): boolean {
  if (page.querySelector(dialogOrMenu) !== null) return true;
  return [...page.querySelectorAll(listbox)].some((list) => list.closest(editorList) === null);
}

/**
 * A região do foco em `element`, ou `null` quando ele não diz onde a pessoa estava: o corpo da página (foco perdido), nada, ou o que está dentro de um diálogo,
 * de um menu ou de uma lista. Assim o diálogo não apaga a região de quem o abriu, e o fechar sabe de onde o foco saiu.
 */
export function regionOf(element: Element | null): FocusRegion | null {
  if (element === null || element.tagName === "BODY" || element.tagName === "HTML") return null;
  if (element.closest(popup) !== null) return null;
  if (element.closest("[data-tab-strip]") !== null) return "strip";
  if (element.closest("[data-tab-content]") !== null) return "content";
  return "outside";
}

/**
 * O foco está perdido: não há elemento focado, é o corpo da página, o elemento saiu da página, ou ele está num painel que acabou de ficar escondido
 * (`checkVisibility`: o Chromium só tira o foco de lá numa tarefa seguinte, e a decisão é tomada antes).
 */
export function isLost(active: Element | null, page: Pick<Document, "body">): boolean {
  if (active === null || active === page.body) return true;
  if (!active.isConnected) return true;
  return active.checkVisibility?.() === false;
}

/** O elemento com o foco agora; `null` sem página (os testes, que não têm DOM). */
export function focusedElement(): Element | null {
  return typeof document === "undefined" ? null : document.activeElement;
}

/** A linha do navegador que o Tab alcança, se o navegador está à mostra (escondido, o foco não entraria nele). */
export function navigatorRow(page: Pick<Document, "querySelector">): HTMLElement | null {
  const row = page.querySelector<HTMLElement>('[role="tree"] [data-row-toggle][tabindex="0"]') ?? page.querySelector<HTMLElement>('[role="tree"] [data-row-toggle]:not([tabindex="-1"])');
  return row === null || row.checkVisibility?.() === false ? null : row;
}

export type FocusChange = {
  /** Um gesto pediu a aba (abrir, ou a aba que chegou) e o pedido ainda não foi atendido. */
  request: boolean;
  /** A última região em que o foco esteve (`regionOf`); `null`: nenhuma ainda. */
  lastRegion: FocusRegion | null;
  /** O foco está perdido (`isLost`). */
  lost: boolean;
  /** O foco ainda está em quem pediu (`stillWithRequester`). */
  atRequester: boolean;
  /** Há alguma aba depois da mudança. */
  hasTabs: boolean;
  /** Um diálogo, um menu ou uma lista aberta, o cofre bloqueado ou outra tela à mostra: o foco não é de ninguém aqui. */
  blocked: boolean;
  /** Outra regra já prometeu o foco (o F6, a troca do lugar do resultado, RN-ABAS-014): ela o leva quando puder. */
  promised: boolean;
};

/**
 * A decisão de RN-ABAS-019, depois de a aba ativa mudar ou de uma aba sair:
 *
 * - com um pedido, o foco vai à entrada da aba SE ainda está em quem pediu ou se perdeu; se saiu para outro lugar vivo (o type-ahead andou na árvore, a pessoa
 *   clicou num campo), fica onde está: abrir não rouba o foco de quem já foi para outro lugar;
 * - sem pedido, só age se o foco se perdeu (a aba em que ele estava saiu da página ou ficou escondida): no mesmo lugar em que estava (a faixa, ou o conteúdo da
 *   aba), e sem nenhuma aba, à linha do navegador. O foco que estava fora das abas fica onde está;
 * - bloqueado, ou com o foco prometido por outra regra, nada.
 */
export function focusAfterChange({ request, lastRegion, lost, atRequester, hasTabs, blocked, promised }: FocusChange): FocusDestination | null {
  if (blocked || promised) return null;
  if (request && (lost || atRequester)) return "entry";
  if (!lost) return null;
  if (!hasTabs) return lastRegion === "strip" || lastRegion === "content" ? "navigator" : null;
  if (lastRegion === "strip") return "strip";
  if (lastRegion === "content") return "entry";
  return null;
}

/** O pedido de foco de uma aba: quem tinha o foco quando ela foi pedida, e se era um diálogo, um menu ou uma lista (que fecham logo e devolvem o foco ao item). */
export type FocusRequest = { tabId: string; from: Element | null; fromPopup: boolean };

/**
 * O foco ainda está em quem pediu a aba? O menu que abriu a aba (RN-MENU-001) e o diálogo que a abriu fecham logo depois e devolvem o foco ao item da árvore:
 * quem pediu morreu com eles, e o foco que eles devolvem não é "outro lugar vivo".
 */
export function stillWithRequester(request: FocusRequest, active: Element | null): boolean {
  return request.fromPopup || request.from === active;
}

let pending: FocusRequest | null = null;
let version = 0;
const listeners = new Set<() => void>();

/**
 * O foco que espera a aba pedida aparecer (RN-ABAS-019): quem abre a aba (o duplo clique, o Enter, o menu, o seguir da chave estrangeira, a aba que chegou de
 * outra janela, as que voltaram na entrada) pede aqui, com o elemento que tinha o foco; a área das abas atende depois de a aba aparecer e de os painéis dela
 * montarem, uma vez. Um pedido por vez: o seguinte troca o de antes. A `version` muda a cada pedido, para a área das abas refazer o efeito quando a aba pedida
 * já é a ativa e nada mais mudou.
 */
export const tabFocus = {
  request(tabId: string, from: Element | null): void {
    pending = { tabId, from, fromPopup: from !== null && from.closest(popup) !== null };
    version += 1;
    for (const listener of listeners) listener();
  },
  /** O pedido da aba, se é dela; levado, sai. O de outra aba (que ainda não está ativa) fica esperando. */
  take(tabId: string): FocusRequest | null {
    if (pending === null || pending.tabId !== tabId) return null;
    const request = pending;
    pending = null;
    return request;
  },
  version: (): number => version,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** O pedido de uma aba que saiu não vale mais. */
  forgetExcept(open: ReadonlySet<string>): void {
    if (pending !== null && !open.has(pending.tabId)) pending = null;
  },
};

type FocusEntry = () => boolean | void;

const entries = new Map<string, FocusEntry>();

/**
 * COMO se foca a entrada de cada aba (RN-ABAS-019): a de consulta, o editor SQL (ou o resultado, com o editor escondido ou a aba do resultado ativa); a de
 * tabela, o filtro dos Registros ou o painel da vista. Cada painel registra a sua, e quem decide QUANDO é a área das abas. A função devolve se o foco chegou
 * (`false` quando não deu); sem devolver nada, vale que chegou.
 */
export const tabEntries = {
  /** Devolve a função que desfaz o registro. */
  register(tabId: string, focusEntry: FocusEntry): () => void {
    entries.set(tabId, focusEntry);
    return () => {
      if (entries.get(tabId) === focusEntry) entries.delete(tabId);
    };
  },
  /**
   * Foca a entrada da aba; `false` sem entrada registrada, ou se ela não conseguiu. Em desenvolvimento o `StrictMode` desmonta e monta de novo, no fim desta mesma
   * tarefa, os efeitos do painel que acabou de nascer: o editor ou o campo de filtro que recebeu o foco é recriado, e o foco cai no corpo da página. Se isso
   * aconteceu, a entrada o leva de novo, uma vez; no app empacotado nada se perde, e a segunda chamada não acontece.
   */
  focus(tabId: string): boolean {
    const focusEntry = entries.get(tabId);
    if (focusEntry === undefined || focusEntry() === false) return false;

    if (typeof document !== "undefined") {
      queueMicrotask(() => {
        if (isLost(document.activeElement, document)) entries.get(tabId)?.();
      });
    }
    return true;
  },
};
