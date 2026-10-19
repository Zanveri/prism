import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { AlertIcon, CheckIcon, CloseIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { recordsCopy } from "../_lib/records.copy";

const copy = recordsCopy.edit;

type CellEditorProps = {
  /** O nome do campo para quem o ouve: a coluna e a linha. */
  label: string;
  draft: string;
  /**
   * RN-EDIT-017: para quantas células a edição vale ("Vale para as 37 células escolhidas da coluna preco."), logo abaixo do campo (acima, quando não cabe
   * embaixo), no tom de atenção, sem cobrir a célula ativa; é a descrição do campo (`aria-describedby`), e o leitor de tela a lê quando ele abre. Nula com uma
   * célula só, e então não há dica.
   */
  hint?: string | null;
  /** Coluna numérica: o texto fica à direita, como na grade. */
  number: boolean;
  onDraft: (text: string) => void;
  /** Confirmar; com Tab (`1`) e Shift+Tab (`-1`), passar à próxima célula editável. */
  onCommit: (move?: 1 | -1) => void;
  onCancel: () => void;
};

/**
 * O campo de edição dentro da célula (RN-EDIT-001), como no canvas: o texto, "Confirmar edição (Enter)" e "Cancelar edição (Esc)". Enter
 * confirma (Shift+Enter quebra a linha, para o texto que tem quebra), Esc desfaz, Tab e Shift+Tab confirmam e passam à próxima célula
 * editável, e sair do campo confirma. É uma área de texto de uma linha, e não um `input`: o `input` tira as quebras de linha do valor.
 * As teclas não sobem para a grade nem para a faixa das abas (o Ctrl+W dentro do campo não fecha a aba). Os botões não tiram o foco do
 * campo ao serem apertados (`mouseDown`), senão o clique em "Cancelar" chegaria depois de o campo ter confirmado ao perder o foco.
 */
export function CellEditor({ label, draft, hint = null, number, onDraft, onCommit, onCancel }: CellEditorProps) {
  const hintId = useId();
  const hintRef = useRef<HTMLParagraphElement>(null);
  // A dica vai abaixo do campo; quando o fim dela passaria do fim da grade (a célula na última linha à vista), vai acima. A medida é a da caixa que rola.
  const [above, setAbove] = useState(false);
  useLayoutEffect(() => {
    const element = hintRef.current;
    const box = element?.closest<HTMLElement>("[role='grid']")?.getBoundingClientRect();
    if (element === null || box === undefined) return;
    const rect = element.getBoundingClientRect();
    if (!above && rect.bottom > box.bottom) setAbove(true);
  }, [above, hint]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation();

    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Tab") {
      event.preventDefault();
      onCommit(event.shiftKey ? -1 : 1);
    }
  }

  const button = "flex size-[calc(26px*var(--grid-zoom))] flex-none cursor-pointer items-center justify-center rounded-sm";

  return (
    <div className="relative flex h-full min-w-0 items-center gap-1 bg-raised px-1">
      <textarea
        // O campo nasce com o foco: é o que a pessoa pediu ao abrir a edição.
        autoFocus
        aria-label={label}
        aria-describedby={hint === null ? undefined : hintId}
        value={draft}
        rows={1}
        spellCheck={false}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onCommit()}
        className={cn("h-[calc(26px*var(--grid-zoom))] min-w-0 flex-1 resize-none overflow-hidden rounded-sm border border-accent bg-background px-1.5 leading-[calc(24px*var(--grid-zoom))] whitespace-pre text-ink outline-none", number && "text-right")}
      />
      <button type="button" aria-label={copy.confirmEdit} title={copy.confirmEdit} onMouseDown={(event) => event.preventDefault()} onClick={() => onCommit()} className={cn(button, "bg-accent text-panel hover:brightness-110")}>
        <CheckIcon className="size-4" />
      </button>
      <button type="button" aria-label={copy.cancelEdit} title={copy.cancelEdit} onMouseDown={(event) => event.preventDefault()} onClick={onCancel} className={cn(button, "border border-border-strong text-ink hover:bg-selected")}>
        <CloseIcon className="size-4" />
      </button>
      {hint === null ? null : (
        <p
          ref={hintRef}
          id={hintId}
          data-editor-hint
          className={cn(
            "pointer-events-none absolute left-0 z-40 flex max-w-[calc(360px*var(--grid-zoom))] min-w-full items-start gap-1.5 rounded-sm border border-accent bg-raised px-2 py-1 font-sans text-[length:calc(12px*var(--grid-zoom))] leading-[calc(16px*var(--grid-zoom))] whitespace-normal text-ink shadow-md",
            above ? "bottom-full mb-0.5" : "top-full mt-0.5",
          )}
        >
          <AlertIcon aria-hidden className="mt-px size-[calc(12px*var(--grid-zoom))] flex-none text-accent" />
          <span>{hint}</span>
        </p>
      )}
    </div>
  );
}
