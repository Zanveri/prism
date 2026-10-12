import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  id: string;
  label: string;
  /** O desenho à esquerda. Se algum item do menu tem um, os demais reservam o espaço dele e os rótulos alinham. */
  icon?: ReactNode;
  /** O atalho que já existe para a ação, escrito à direita. */
  shortcut?: string;
  /** A ação não se aplica agora: fica apagada, é anunciada como desabilitada, recebe foco pelas setas e não executa. */
  disabled?: boolean;
  onSelect: () => void;
};

export type ContextMenuProps = {
  /** O nome do menu para quem o ouve. */
  label: string;
  /** Onde abrir, nas coordenadas da janela: o ponto do clique, ou o pé da linha quando o menu veio do teclado. */
  point: { x: number; y: number };
  /** Os itens em grupos; entre dois grupos entra um separador. */
  groups: ContextMenuItem[][];
  /** `first` (teclado) põe o foco no primeiro item; `menu` (mouse) no próprio menu, sem item ativo até uma seta ou o mouse. */
  initialFocus?: "first" | "menu";
  onClose: () => void;
};

/** A folga que o menu deixa até a borda da janela. */
const viewportMargin = 8;

/**
 * Onde o menu fica na janela. Abre com o canto no ponto; se não cabe dali até a borda, abre para o outro lado do ponto (a borda
 * do menu nele), como os menus do sistema; e se nem assim cabe, encosta na margem. A altura do menu é limitada pela janela
 * (`max-h` do componente), então o que não cabe rola.
 */
export function placeMenu(point: { x: number; y: number }, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const place = (at: number, extent: number, room: number) => (at + extent <= room - viewportMargin ? at : Math.max(viewportMargin, at - extent));
  return { left: place(point.x, size.width, viewport.width), top: place(point.y, size.height, viewport.height) };
}

/** O item que a seta (ou Home e End) leva o foco: `current` é o item com o foco, ou -1. As setas dão a volta. Outra tecla: `null`. */
export function nextItemIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;

  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Os itens do menu e os separadores entre os grupos, sem portal nem posição (e sem hooks): o que se desenha e o que um clique em cada item chama.
 * O item desabilitado sai com `aria-disabled` e o clique nele não chama `onChoose`: o menu continua aberto. Se algum item tem ícone, os outros
 * reservam o espaço dele e os rótulos alinham.
 */
export function ContextMenuItems({ groups, onChoose }: { groups: ContextMenuItem[][]; onChoose: (item: ContextMenuItem) => void }) {
  const hasIcons = groups.some((group) => group.some((item) => item.icon !== undefined));

  return groups
    .filter((group) => group.length > 0)
    .map((group, position) => (
      <Fragment key={group[0].id}>
        {position > 0 ? <div role="separator" className="my-1 h-px bg-border" /> : null}
        {group.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled === true ? true : undefined}
            onClick={() => item.disabled !== true && onChoose(item)}
            onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
            className="flex h-7 w-full cursor-default items-center gap-2.5 rounded-sm px-2 text-left text-sm text-body outline-none focus:bg-selected focus:text-ink focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset aria-disabled:opacity-50"
          >
            {hasIcons ? <span className="flex size-4 flex-none items-center justify-center text-muted">{item.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut === undefined ? null : <span className="ml-6 flex-none font-mono text-[11px] text-subtle">{item.shortcut}</span>}
          </button>
        ))}
      </Fragment>
    ));
}

/**
 * O menu de contexto (botão direito, Shift+F10, tecla de menu). Vai num portal `position: fixed` em `document.body`, como a lista
 * do `Select`, para o `overflow` de um painel não o recortar, e abre no ponto pedido sem sair da janela.
 *
 * Teclado: setas movem o foco entre os itens (dão a volta), Home e End vão ao primeiro e ao último, Enter e Espaço executam, Esc e Tab
 * fecham. Clique fora, rolar e trocar o foco da janela também fecham. Ao fechar, o foco volta a quem o tinha quando o menu abriu
 * (o item da árvore), a não ser que a ação escolhida já o tenha levado a outro lugar, como um diálogo que abriu.
 *
 * O item desabilitado usa `aria-disabled`, e não `disabled`: continua na ordem das setas, para quem usa leitor de tela saber que
 * ele existe e por que não age.
 */
export function ContextMenu({ label, point, groups, initialFocus = "menu", onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const itemElements = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // Mede o menu pronto e o põe no lugar antes de pintar. Direto no elemento: o React não repassa o estilo que não mudou.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;

    const { width, height } = menu.getBoundingClientRect();
    const { left, top } = placeMenu({ x: point.x, y: point.y }, { width, height }, { width: window.innerWidth, height: window.innerHeight });
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";
  }, [point.x, point.y]);

  useEffect(() => {
    const menu = menuRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openerRef.current = opener;

    if (initialFocus === "first") menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    else menu?.focus({ preventScroll: true });

    return () => {
      const restore = () => opener?.isConnected === true && opener.focus({ preventScroll: true });
      const lost = () => document.activeElement === null || document.activeElement === document.body;

      if (lost() || menu?.contains(document.activeElement)) restore();
      // O clique fora numa área sem foco tira o foco do que o tinha depois do nosso `pointerdown` (é o padrão do navegador): conferir de novo no fim do evento.
      // Só com o menu já fora do DOM: o `StrictMode` desmonta e monta os efeitos de mentira, e aí o menu segue vivo e é quem tem o foco.
      setTimeout(() => {
        if (menu?.isConnected !== true && lost()) restore();
      }, 0);
    };
  }, [initialFocus]);

  const dismiss = useEffectEvent(() => onClose());

  useEffect(() => {
    const menu = menuRef.current;
    const onOutside = (event: Event) => {
      if (!menu?.contains(event.target as Node)) dismiss();
    };
    const onWindow = () => dismiss();

    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("scroll", onOutside, true);
    window.addEventListener("resize", onWindow);
    window.addEventListener("blur", onWindow);

    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("scroll", onOutside, true);
      window.removeEventListener("resize", onWindow);
      window.removeEventListener("blur", onWindow);
    };
  }, []);

  /** Escolhido um item (habilitado: `ContextMenuItems` não chama com o outro): o foco volta ao item da árvore ANTES da ação, para um diálogo que ela abra devolver o foco ao lugar certo. */
  function choose(item: ContextMenuItem) {
    if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
    onClose();
    item.onSelect();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Nada atrás do menu reage às teclas dele (o portal sobe os eventos pela árvore do React).
    event.stopPropagation();

    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }

    const elements = itemElements();
    const target = nextItemIndex(event.key, elements.indexOf(document.activeElement as HTMLElement), elements.length);
    if (target === null) return;
    event.preventDefault();
    elements[target].focus({ preventScroll: true });
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      // O botão direito dentro do menu, e o `contextmenu` que a tecla de menu gera no keyup com o foco já aqui, não abrem o menu do navegador nem outro menu.
      onContextMenu={(event) => event.preventDefault()}
      // Escondido até o `useLayoutEffect` medir e posicionar: o menu nunca aparece num lugar e pula para outro.
      style={{ left: 0, top: 0, visibility: "hidden" }}
      className="fixed z-50 max-h-[calc(100dvh-1rem)] max-w-[min(360px,calc(100vw-1rem))] min-w-[208px] overflow-y-auto rounded-md border border-border-strong bg-raised p-1 shadow-2xl outline-none"
    >
      <ContextMenuItems groups={groups} onChoose={choose} />
    </div>,
    document.body,
  );
}
