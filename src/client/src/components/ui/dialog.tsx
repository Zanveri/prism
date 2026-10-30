import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isHtmlElement, type Host } from "@/lib/host/host";
import { cn } from "@/lib/utils/cn";

import { HostProvider, useHost, useOnHostGone } from "./host-context";

export type DialogSize = "sm" | "md" | "lg";

/** Como o diálogo se fecha por fora: pelo Esc, pelo clique fora e pelo X (`true`, o padrão), só pelo Esc (`"escape"`) ou por nenhum (`false`). */
export type DialogDismissal = boolean | "escape";

export type DialogProps = {
  open: boolean;
  title: string;
  /** Um ícone na caixa ao lado do título, como o cadeado do diálogo de senha. A descrição passa para baixo dele, na largura inteira. */
  icon?: ReactNode;
  description?: ReactNode;
  /** `sm` para uma pergunta curta ou um campo só; `lg` para um formulário inteiro. */
  size?: DialogSize;
  /** Enquanto a ação roda, nada fecha o diálogo: nem Esc, nem clique fora, nem o X. */
  pending?: boolean;
  /**
   * `false` para o diálogo que só se resolve por um botão dele (o reinício dos drivers): sem o X, e Esc e clique fora não
   * fecham. A saída, se houver, é um botão do rodapé. `"escape"` para o que se fecha só pelo Esc, que tem um sentido dito
   * (a pergunta de erro do script, RN-SQL-021, em que o Esc é "Parar"): sem o X, e o clique fora não faz nada.
   */
  dismissible?: DialogDismissal;
  /** Ações fixas na base; o corpo rola e elas continuam à mão. */
  footer?: ReactNode;
  /** `alertdialog` para a pergunta que interrompe (`ConfirmDialog`). */
  role?: "dialog" | "alertdialog";
  /** Uma faixa no topo do painel, acima do título: a do ambiente no aviso de confirmação (RN-PROT-001). Quem a desenha dá a cor dela. */
  banner?: ReactNode;
  /**
   * Os ids (separados por espaço) do que, no corpo, diz o que o diálogo pergunta, quando isso não é a `description` do cabeçalho: o leitor de tela os lê
   * junto do título quando o diálogo abre (o aviso de confirmação, RN-PROT-001: o que o comando faz e o comando). Com os dois, a `description` vem antes.
   */
  describedBy?: string;
  children?: ReactNode;
  onClose: () => void;
};

const sizes: Record<DialogSize, string> = {
  sm: "max-w-[440px]",
  md: "max-w-[560px]",
  lg: "max-w-[760px]",
};

/**
 * O que fecha um diálogo por fora (`via`: o Esc, o clique fora ou o X): nada enquanto a ação roda, nada nos diálogos que só se resolvem por um botão
 * deles (`dismissible={false}`, o reinício dos drivers), e só o Esc nos que se fecham só por ele (`dismissible="escape"`, a pergunta de erro do script).
 */
export function canClose({ pending, dismissible }: { pending: boolean; dismissible: DialogDismissal }, via: "escape" | "backdrop" | "button" = "button"): boolean {
  if (pending || dismissible === false) return false;
  return dismissible === true || via === "escape";
}

/**
 * O clique no fundo escurecido fecha o diálogo só com o botão principal, e só se foi no fundo mesmo (e não num filho dele) e o diálogo se deixa
 * fechar por ele (`canClose`). Com o botão direito ou o do meio ele fica: fechando no `pointerdown`, o diálogo sumiria e o `contextmenu` que vem
 * logo depois cairia no que estava por baixo dele (o menu de contexto da linha do navegador).
 */
export function closesFromBackdrop(event: { button: number; target: unknown; currentTarget: unknown }, state: { pending: boolean; dismissible: DialogDismissal }): boolean {
  return event.button === 0 && event.target === event.currentTarget && canClose(state, "backdrop");
}

/** O `aria-describedby` do painel: a `description` do cabeçalho, quando há, e o que o corpo aponta (`describedBy`), nessa ordem; sem nenhum, nada. */
export function describedByOf(descriptionID: string | null, describedBy: string | undefined): string | undefined {
  const ids = [descriptionID, describedBy === undefined || describedBy === "" ? null : describedBy].filter((id) => id !== null);
  return ids.length === 0 ? undefined : ids.join(" ");
}

const focusable = "button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Um conteúdo que precisa da tela por um momento sem tirar a pessoa de onde ela está — nomear
 * uma pasta, confirmar a senha para ver a de uma conexão.
 *
 * `ConfirmDialog` é a pergunta de sim ou não, montada sobre este; aqui está o recipiente, com
 * cabeçalho, corpo que rola e rodapé fixo, e tudo o que um diálogo precisa saber fazer. Vai num
 * portal `position: fixed` em `document.body` da página onde abriu (a da janela da aba, ou a da janela do resultado, RN-ABAS-017), como a lista do `Select` e os avisos: dentro da
 * árvore, o `overflow-hidden` de um painel o recortaria.
 *
 * O foco entra no diálogo — num campo com `autoFocus`, se houver, senão no próprio painel —,
 * fica preso nele pelo Tab e volta ao que estava focado ao fechar.
 */
export function Dialog({ open, title, icon, description, size = "md", pending = false, dismissible = true, footer, role = "dialog", banner, describedBy, children, onClose }: DialogProps) {
  const titleID = useId();
  const descriptionID = useId();
  const panel = useRef<HTMLDivElement>(null);
  // O foco a devolver é lido na renderização em que o diálogo abre. No efeito seria tarde: um
  // filho com `autoFocus` já o tomou no commit, e fechar devolveria o foco a um campo que acabou
  // de sair da tela.
  // RN-ABAS-017: a página (a janela da aba ou a do resultado) é a de quando o diálogo abre, e fica a mesma até ele fechar; o foco entra, fica preso e volta nela.
  const current = useHost();
  const [opener, setOpener] = useState<{ open: boolean; element: HTMLElement | null; host: Host }>({ open: false, element: null, host: current });
  if (opener.open !== open) setOpener({ open, element: open && isHtmlElement(current.document?.activeElement) ? current.document.activeElement : null, host: open ? current : opener.host });
  const returnFocus = opener.element;
  const host = open ? opener.host : current;

  useEffect(() => {
    if (!open) return;

    if (!panel.current?.contains(host.document.activeElement)) panel.current?.focus();

    return () => returnFocus?.focus();
  }, [open, returnFocus, host]);

  // A página da janela do resultado que sai fecha o diálogo, como o Esc faria (RN-ABAS-011); com a ação rodando, ele fica.
  useOnHostGone(host, open, () => {
    if (!pending) onClose();
  });

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Atalhos da página não podem agir por trás do diálogo. Uma confirmação aberta dentro dele
    // para a propagação antes, então o Esc dela não fecha os dois.
    event.stopPropagation();

    if (event.key === "Escape") {
      // Um `Select` aberto dentro do diálogo já usou o Esc para fechar a lista.
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (canClose({ pending, dismissible }, "escape")) onClose();
      return;
    }

    if (event.key !== "Tab" || panel.current === null) return;

    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(focusable));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && (host.document.activeElement === first || host.document.activeElement === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && host.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const descriptionBlock = description === undefined ? null : <div id={descriptionID} className={cn("text-muted", icon === undefined ? "mt-1.5" : "mt-3")}>{description}</div>;

  const content = (
    <HostProvider host={host}>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onPointerDown={(event) => {
        if (closesFromBackdrop(event, { pending, dismissible })) onClose();
      }}
      // Nada do que está por baixo do fundo abre menu enquanto o diálogo está aberto: o botão direito no fundo fica no fundo.
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleID}
        aria-describedby={describedByOf(description === undefined ? null : descriptionID, describedBy)}
        aria-busy={pending}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn("flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-xl border border-border-strong bg-raised shadow-2xl outline-none", banner !== undefined && "overflow-hidden", sizes[size])}
      >
        {banner === undefined ? null : <div className="flex-none">{banner}</div>}
        <div className="px-6 pt-6 pb-4">
          <div className={cn("flex gap-3", icon === undefined ? "items-start" : "items-center")}>
            {icon === undefined ? null : <span className="flex size-9 flex-none items-center justify-center rounded-lg border border-border-strong">{icon}</span>}
            <div className="min-w-0 flex-1">
              <h2 id={titleID} className="text-lg font-semibold">{title}</h2>
              {icon === undefined ? descriptionBlock : null}
            </div>
            {dismissible === true ? (
              <button type="button" aria-label="Fechar" title="Fechar" onClick={onClose} disabled={pending} className={cn("-mr-2 inline-flex size-9 flex-none cursor-pointer items-center justify-center rounded-md text-muted transition-colors enabled:hover:bg-selected enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50", icon === undefined && "-mt-2")}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" data-icon="close">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            ) : null}
          </div>
          {icon === undefined ? null : descriptionBlock}
        </div>
        {children === undefined || children === null ? null : <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>}
        {footer === undefined ? null : <div className="flex flex-wrap justify-end gap-3 px-6 pb-6">{footer}</div>}
      </div>
    </div>
    </HostProvider>
  );

  return host.document === undefined ? content : createPortal(content, host.document.body);
}
