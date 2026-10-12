/**
 * O navegador retrátil (RN-NAV-008): esconder e mostrar pelo botão da barra de ações, pelo botão da barra superior (sempre à vista), por
 * Ctrl+B, e Ctrl+Shift+E mostra e leva o foco à busca. O que decide é daqui, em funções puras; a página (`workbench/page.tsx`) só executa.
 *
 * A escolha é lembrada por usuário, numa chave própria do `localStorage` (`prism:navigator:<usuário>`): o arquivo de preferências é de outra
 * frente, e o jeito de guardar é o mesmo dele (leitura tolerante, memória da sessão quando o armazenamento falta ou recusa). Nada de segredo
 * nem de dado de conexão passa por aqui.
 */

export type NavigatorLayout = { readonly hidden: boolean };

const shown: NavigatorLayout = Object.freeze({ hidden: false });
const hiddenLayout: NavigatorLayout = Object.freeze({ hidden: true });

/** O nome como a API o grava (RN-COFRE-010), como as preferências fazem: sem espaços nas pontas e em minúsculas. */
export function navigatorLayoutKey(userName: string): string {
  return `prism:navigator:${userName.trim().toLowerCase()}`;
}

/** O que está gravado pode ser qualquer coisa (editado à mão, cortado): nunca lança, e o que não confere é o padrão (à mostra). */
export function parseNavigatorLayout(raw: string | null): NavigatorLayout {
  if (raw === null) return shown;

  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && (value as { hidden?: unknown }).hidden === true ? hiddenLayout : shown;
  } catch {
    return shown;
  }
}

export type NavigatorLayoutStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * O armazenamento da escolha. `getStorage` é chamado a cada acesso e pode devolver `null` ou lançar: nos dois casos, e quando ler ou gravar
 * falha, a escolha vive na memória da sessão e a tela segue. Cada usuário tem o seu objeto, e é o MESMO objeto até a próxima gravação
 * (`useSyncExternalStore` compara por referência).
 */
export function createNavigatorLayoutStore(getStorage: () => NavigatorLayoutStorage | null) {
  const cache = new Map<string, NavigatorLayout>();
  const listeners = new Set<() => void>();

  function storage(): NavigatorLayoutStorage | null {
    try {
      return getStorage();
    } catch {
      return null;
    }
  }

  function get(userName: string): NavigatorLayout {
    const key = navigatorLayoutKey(userName);
    let layout = cache.get(key);

    if (layout === undefined) {
      let raw: string | null = null;
      try {
        raw = storage()?.getItem(key) ?? null;
      } catch {
        // Leitura recusada: vale o padrão.
      }
      layout = parseNavigatorLayout(raw);
      cache.set(key, layout);
    }

    return layout;
  }

  function set(userName: string, next: NavigatorLayout): void {
    if (get(userName).hidden === next.hidden) return;

    const key = navigatorLayoutKey(userName);
    const layout = next.hidden ? hiddenLayout : shown;
    cache.set(key, layout);
    try {
      storage()?.setItem(key, JSON.stringify(layout));
    } catch {
      // Cota cheia ou acesso bloqueado: a escolha vale até fechar o app.
    }

    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  return { get, set, subscribe };
}

/** O armazenamento da janela: o gancho da página fala com este. */
export const navigatorLayoutStore = createNavigatorLayoutStore(() => (typeof localStorage === "undefined" ? null : localStorage));

type KeyEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented" | "isComposing">;

/** O atalho do navegador: `toggle` esconde e mostra (Ctrl+B); `reveal` mostra e leva o foco à busca (Ctrl+Shift+E). */
export type NavigatorShortcut = "toggle" | "reveal";

/**
 * A tecla é um atalho do navegador (RN-NAV-008)? Ctrl+B (Cmd+B no macOS) e Ctrl+Shift+E valem com o foco em qualquer lugar da área de
 * trabalho, inclusive no editor de SQL (o CodeMirror não trata essas teclas fora do macOS, e no macOS o Ctrl+B dele é o Ctrl, não o Cmd: elas
 * chegam à janela sem `defaultPrevented`). NÃO valem nas outras telas (`onScreen`), com um diálogo aberto (`modalOpen`; o `Dialog` também
 * para a propagação do teclado) nem com o Prism bloqueado (`locked`; a tela de bloqueio já corta o teclado de fora dela). Quem já tratou a
 * tecla fica com ela, e Alt ou a composição de um acento fazem outra coisa.
 */
export function navigatorShortcut(event: KeyEventLike, { onScreen, modalOpen, locked }: { onScreen: boolean; modalOpen: boolean; locked: boolean }): NavigatorShortcut | null {
  if (!onScreen || modalOpen || locked || event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;

  const key = event.key.toLowerCase();
  if (key === "b" && !event.shiftKey) return "toggle";
  return key === "e" && event.shiftKey ? "reveal" : null;
}

/**
 * Para onde vai o foco que estava no navegador quando ele se esconde (RN-NAV-008: "nada do navegador é alcançável pelo teclado"; um foco
 * dentro de um `display: none` se perde no `<body>`). Pelo botão da barra de ações, ao botão da barra superior, que o traz de volta; pelo
 * Ctrl+B, ao trabalho da aba ativa (o editor, ou a aba na faixa), ou, sem aba, ao mesmo botão. Com o foco fora do navegador, ele fica onde está.
 */
export function hideFocusTarget(origin: "toolbar" | "toggle" | "shortcut", { focusInside, hasActiveTab }: { focusInside: boolean; hasActiveTab: boolean }): "toggle" | "workArea" | null {
  if (!focusInside) return null;
  return origin === "shortcut" && hasActiveTab ? "workArea" : "toggle";
}

/** Os atalhos como a plataforma os escreve, para as dicas dos botões: Cmd no macOS, Ctrl nas outras (`navigator.platform`). */
export function navigatorShortcutLabels(platform: string): { toggle: string; reveal: string } {
  const mod = /mac|iphone|ipad/i.test(platform) ? "Cmd" : "Ctrl";
  return { toggle: `${mod}+B`, reveal: `${mod}+Shift+E` };
}

/**
 * A rolagem da árvore que a busca devolve ao ser limpa (RN-BUSCA-001: "limpar devolve a árvore como estava"), a cada aviso de rolagem. Durante a
 * busca a lista é outra, e a guardada fica. **Lida sem caixa, não é posição**: o aviso de uma rolagem chega um quadro depois, e quem rola e
 * esconde o navegador (ou vai a outra tela) no mesmo instante recebe o aviso com a lista em `display: none`, `scrollTop` 0; guardá-lo faria a busca
 * limpa voltar ao topo. É a regra de `observeRenderedOffset`, para a rolagem que o navegador guarda.
 */
export function rememberedTreeScroll(previous: number, { scrollTop, clientHeight, searching }: { scrollTop: number; clientHeight: number; searching: boolean }): number {
  return searching || clientHeight === 0 ? previous : scrollTop;
}
