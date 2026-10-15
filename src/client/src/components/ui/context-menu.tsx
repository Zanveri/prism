import { Fragment, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils/cn";

import { CheckIcon } from "./icons";

export type ContextMenuItem = {
  id: string;
  label: string;
  /** O desenho à esquerda. Se algum item do menu tem um, os demais reservam o espaço dele e os rótulos alinham. */
  icon?: ReactNode;
  /** O atalho que já existe para a ação, escrito à direita. */
  shortcut?: string;
  /** A ação não se aplica agora: fica apagada, é anunciada como desabilitada, recebe foco pelas setas e não executa. */
  disabled?: boolean;
  /** Por que a ação não se aplica, embaixo do rótulo (a célula só leitura, com o motivo). Faz parte do texto do item, que o leitor de tela lê. */
  hint?: string;
  /**
   * O item é uma escolha de um grupo de escolha única (o intervalo da atualização automática, na grade): `menuitemradio`, com `aria-checked`, e a marca de
   * escolhido no lugar do ícone. Sem a propriedade, é um item comum.
   */
  checked?: boolean;
  /**
   * Os itens de um submenu ("Filtrar", na grade): o item não executa, abre o submenu ao lado (seta para a direita, Enter, Espaço, o clique ou o mouse em
   * cima). Um nível só: o item de um submenu não tem outro.
   */
  submenu?: { label: string; groups: ContextMenuGroup[] };
  onSelect?: () => void;
};

/** Os itens entre dois separadores; com `label`, o grupo tem um título (que não recebe foco) e é anunciado com ele ("Valor da célula"). */
export type ContextMenuGroup = ContextMenuItem[] | { label: string; items: ContextMenuItem[] };

export type ContextMenuProps = {
  /** O nome do menu para quem o ouve. */
  label: string;
  /** Onde abrir, nas coordenadas da janela: o ponto do clique, ou o pé da linha quando o menu veio do teclado. */
  point: { x: number; y: number };
  /** Os itens em grupos; entre dois grupos entra um separador. */
  groups: ContextMenuGroup[];
  /** `first` (teclado) põe o foco no primeiro item; `menu` (mouse) no próprio menu, sem item ativo até uma seta ou o mouse. */
  initialFocus?: "first" | "menu";
  /** O id do item cujo submenu já abre com o menu, com o foco no primeiro item dele (o F11 da grade abre o "Filtrar"). */
  openSubmenu?: string;
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

/**
 * Onde o submenu fica: à direita do item que o abriu, com o primeiro item na altura dele; sem lugar à direita, à esquerda do menu; e de cima para baixo até
 * onde a janela deixa (o que não cabe sobe, e no fim encosta na margem de cima).
 */
export function placeSubmenu(anchor: { left: number; right: number; top: number }, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const right = anchor.right - 2;
  const left = right + size.width <= viewport.width - viewportMargin ? right : Math.max(viewportMargin, anchor.left - size.width + 2);
  const wanted = anchor.top - 4;
  const top = Math.max(viewportMargin, wanted + size.height <= viewport.height - viewportMargin ? wanted : viewport.height - viewportMargin - size.height);
  return { left, top };
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

/** O que é item do menu para as setas e para o foco: o comum e o de escolha única. */
const itemSelector = '[role="menuitem"], [role="menuitemradio"]';

/** Os itens de um grupo, com ou sem título. */
export const groupItems = (group: ContextMenuGroup): ContextMenuItem[] => (Array.isArray(group) ? group : group.items);

type ItemsProps = {
  groups: ContextMenuGroup[];
  onChoose: (item: ContextMenuItem) => void;
  /** O item do submenu aberto, se há (o item mostra que está aberto). */
  expanded?: string | null;
  /** O mouse passou por um item: o do submenu o abre, os outros fecham o que estiver aberto. */
  onHover?: (item: ContextMenuItem, element: HTMLElement) => void;
};

/**
 * Os itens do menu e os separadores entre os grupos, sem portal nem posição (e sem hooks): o que se desenha e o que um clique em cada item chama.
 * O item desabilitado sai com `aria-disabled` e o clique nele não chama `onChoose`: o menu continua aberto. Se algum item tem ícone, os outros
 * reservam o espaço dele e os rótulos alinham. O grupo com título é um `group` com nome, e o título não é item (não recebe foco). O item de submenu
 * diz que abre um menu (`aria-haspopup`) e se está aberto (`aria-expanded`), com a seta à direita.
 */
export function ContextMenuItems({ groups, onChoose, expanded = null, onHover }: ItemsProps) {
  const hasIcons = groups.some((group) => groupItems(group).some((item) => item.icon !== undefined || item.checked !== undefined));
  const shown = groups.filter((group) => groupItems(group).length > 0);

  const button = (item: ContextMenuItem) => (
    <button
      key={item.id}
      type="button"
      role={item.checked === undefined ? "menuitem" : "menuitemradio"}
      tabIndex={-1}
      data-item={item.id}
      aria-checked={item.checked}
      aria-disabled={item.disabled === true ? true : undefined}
      aria-haspopup={item.submenu === undefined ? undefined : "menu"}
      aria-expanded={item.submenu === undefined ? undefined : expanded === item.id}
      onClick={() => item.disabled !== true && onChoose(item)}
      onPointerMove={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        onHover?.(item, event.currentTarget);
      }}
      className={cn(
        "flex w-full cursor-default items-center gap-2.5 rounded-sm px-2 text-left text-sm text-body outline-none focus:bg-selected focus:text-ink focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset aria-disabled:opacity-50 aria-expanded:bg-selected",
        item.hint === undefined ? "h-7" : "min-h-7 py-1",
      )}
    >
      {hasIcons ? <span className="flex size-4 flex-none items-center justify-center text-muted">{item.icon ?? (item.checked === true ? <CheckIcon /> : null)}</span> : null}
      {item.hint === undefined ? (
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{item.label}</span>
          <span className="max-w-72 text-xs whitespace-normal text-muted">{item.hint}</span>
        </span>
      )}
      {item.shortcut === undefined ? null : <span className="ml-6 flex-none font-mono text-[11px] text-subtle">{item.shortcut}</span>}
      {item.submenu === undefined ? null : (
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn("flex-none text-muted", item.shortcut === undefined && "ml-6")}>
          <path d="M6 4l4 4-4 4" />
        </svg>
      )}
    </button>
  );

  return shown.map((group, position) => {
    const items = groupItems(group);
    return (
      <Fragment key={items[0].id}>
        {position > 0 ? <div role="separator" className="my-1 h-px bg-border" /> : null}
        {Array.isArray(group) ? (
          items.map(button)
        ) : (
          <div role="group" aria-label={group.label}>
            <div aria-hidden="true" className="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">
              {group.label}
            </div>
            {items.map(button)}
          </div>
        )}
      </Fragment>
    );
  });
}

const allItems = (groups: ContextMenuGroup[]) => groups.flatMap(groupItems);

const menuClass = "fixed z-50 max-h-[calc(100dvh-1rem)] max-w-[min(360px,calc(100vw-1rem))] min-w-[208px] overflow-y-auto rounded-md border border-border-strong bg-raised p-1 shadow-2xl outline-none";

/** Os itens de um menu (o principal ou o submenu), na ordem das setas: os comuns e os de escolha única. */
const itemElementsOf = (menu: ParentNode | null) => Array.from(menu?.querySelectorAll<HTMLElement>(itemSelector) ?? []);

/** O primeiro item do menu (comum ou de escolha única), que recebe o foco quando o menu ou o submenu vem do teclado. */
export const firstItemOf = (menu: ParentNode | null): HTMLElement | null => menu?.querySelector<HTMLElement>(itemSelector) ?? null;

/** As setas, Home e End movem o foco entre os itens do menu dado; devolve se a tecla foi dele. */
export function moveFocus(event: Pick<KeyboardEvent<HTMLElement>, "key" | "preventDefault">, menu: ParentNode | null): boolean {
  const elements = itemElementsOf(menu);
  const target = nextItemIndex(event.key, elements.indexOf(document.activeElement as HTMLElement), elements.length);
  if (target === null) return false;
  event.preventDefault();
  elements[target].focus({ preventScroll: true });
  return true;
}

type SubmenuProps = {
  label: string;
  groups: ContextMenuGroup[];
  /** O item que abriu o submenu, para a posição e para onde o foco volta (seta para a esquerda, Esc). */
  anchor: HTMLElement;
  /** O foco entra no primeiro item (o submenu veio do teclado); pelo mouse ele fica no item que o abriu. */
  focusFirst: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onChoose: (item: ContextMenuItem) => void;
  /** Fecha só o submenu, com o foco de volta no item que o abriu. */
  onBack: () => void;
  /** Fecha tudo (Tab). */
  onClose: () => void;
};

/** O submenu: outro `menu`, num portal ao lado do item que o abriu, com as mesmas teclas do menu e a seta para a esquerda (e o Esc) para voltar. */
function Submenu({ label, groups, anchor, focusFirst, menuRef, onChoose, onBack, onClose }: SubmenuProps) {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;

    const { width, height } = menu.getBoundingClientRect();
    const { left, top } = placeSubmenu(anchor.getBoundingClientRect(), { width, height }, { width: window.innerWidth, height: window.innerHeight });
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";
  }, [anchor, menuRef]);

  useEffect(() => {
    if (focusFirst) firstItemOf(menuRef.current)?.focus({ preventScroll: true });
  }, [focusFirst, menuRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // O submenu é irmão do menu na árvore do React: a tecla dele não sobe ao menu nem ao que está atrás.
    event.stopPropagation();

    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      onBack();
    } else if (event.key === "Tab") {
      event.preventDefault();
      onClose();
    } else moveFocus(event, menuRef.current);
  }

  return createPortal(
    <div ref={menuRef} role="menu" aria-label={label} aria-orientation="vertical" tabIndex={-1} onKeyDown={handleKeyDown} onContextMenu={(event) => event.preventDefault()} style={{ left: 0, top: 0, visibility: "hidden" }} className={menuClass}>
      <ContextMenuItems groups={groups} onChoose={onChoose} />
    </div>,
    document.body,
  );
}

/**
 * O menu de contexto (botão direito, Shift+F10, tecla de menu). Vai num portal `position: fixed` em `document.body`, como a lista
 * do `Select`, para o `overflow` de um painel não o recortar, e abre no ponto pedido sem sair da janela.
 *
 * Teclado: setas movem o foco entre os itens (dão a volta), Home e End vão ao primeiro e ao último, Enter e Espaço executam, Esc e Tab
 * fecham. Clique fora, rolar e trocar o foco da janela também fecham. Ao fechar, o foco volta a quem o tinha quando o menu abriu
 * (o item da árvore), a não ser que a ação escolhida já o tenha levado a outro lugar, como um diálogo que abriu.
 *
 * O item de submenu abre o submenu ao lado pela seta para a direita, por Enter e Espaço, pelo clique e pelo mouse em cima; no submenu, a seta
 * para a esquerda e o Esc voltam ao item que o abriu, e o Tab fecha tudo. O mouse sobre outro item do menu fecha o submenu aberto.
 *
 * O item desabilitado usa `aria-disabled`, e não `disabled`: continua na ordem das setas, para quem usa leitor de tela saber que
 * ele existe e por que não age.
 */
export function ContextMenu({ label, point, groups, initialFocus = "menu", openSubmenu, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  // Quem tinha o foco quando o menu abriu, lido na primeira renderização: o submenu que já abre com o menu (o F11) leva o foco antes do efeito do menu.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  // O submenu aberto: o item que o abriu (o elemento, para a posição) e se o foco entra nele.
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement | null; focusFirst: boolean } | null>(() => (openSubmenu === undefined ? null : { id: openSubmenu, anchor: null, focusFirst: true }));
  const openItem = open === null ? undefined : allItems(groups).find((item) => item.id === open.id && item.submenu !== undefined && item.disabled !== true);

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

  // O submenu que abre com o menu (o F11) ainda não tem o elemento do item: ele existe depois da primeira pintura do menu.
  const [anchorOf, setAnchorOf] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open === null || open.anchor !== null) return;
    const found = menuRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(open.id)}"]`) ?? null;
    if (found !== anchorOf) setAnchorOf(found);
  }, [open, anchorOf]);
  const anchor = open?.anchor ?? anchorOf;

  const startsInSubmenu = useRef(openSubmenu !== undefined);
  useEffect(() => {
    const menu = menuRef.current;

    // O submenu que já abre com o menu leva o foco ele mesmo.
    if (!startsInSubmenu.current) {
      if (initialFocus === "first") firstItemOf(menu)?.focus({ preventScroll: true });
      else menu?.focus({ preventScroll: true });
    }

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
  }, [initialFocus, opener]);

  const dismiss = useEffectEvent(() => onClose());

  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && (menuRef.current?.contains(target) === true || submenuRef.current?.contains(target) === true);
    const onOutside = (event: Event) => {
      if (!inside(event.target)) dismiss();
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
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    onClose();
    item.onSelect?.();
  }

  /** O item de submenu, escolhido pelo clique, Enter ou Espaço: abre o submenu com o foco no primeiro item dele. */
  function chooseInMenu(item: ContextMenuItem) {
    if (item.submenu === undefined) return choose(item);
    const element = menuRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(item.id)}"]`) ?? null;
    setOpen({ id: item.id, anchor: element, focusFirst: true });
  }

  /** O mouse num item: o de submenu o abre (o foco fica no item), outro fecha o submenu aberto. */
  function hover(item: ContextMenuItem, element: HTMLElement) {
    if (item.submenu !== undefined && item.disabled !== true) {
      if (open?.id !== item.id) setOpen({ id: item.id, anchor: element, focusFirst: false });
    } else if (open !== null) setOpen(null);
  }

  /** Volta do submenu ao item que o abriu. */
  function back() {
    const id = open?.id;
    setOpen(null);
    if (id !== undefined) menuRef.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Nada atrás do menu reage às teclas dele (o portal sobe os eventos pela árvore do React).
    event.stopPropagation();

    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowRight") {
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.item : undefined;
      const item = allItems(groups).find((candidate) => candidate.id === focused);
      if (item?.submenu !== undefined && item.disabled !== true) {
        event.preventDefault();
        chooseInMenu(item);
      }
      return;
    }

    if (moveFocus(event, menuRef.current) && open !== null) setOpen(null);
  }

  return (
    <>
      {createPortal(
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
          className={menuClass}
        >
          <ContextMenuItems groups={groups} onChoose={chooseInMenu} expanded={openItem === undefined ? null : openItem.id} onHover={hover} />
        </div>,
        document.body,
      )}
      {openItem?.submenu === undefined || anchor === null ? null : (
        <Submenu key={openItem.id} label={openItem.submenu.label} groups={openItem.submenu.groups} anchor={anchor} focusFirst={open?.focusFirst === true} menuRef={submenuRef} onChoose={choose} onBack={back} onClose={onClose} />
      )}
    </>
  );
}
