import type { KeyboardEvent } from "react";

import { CheckIcon, CloseIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { recordsCopy } from "../_lib/records.copy";

const copy = recordsCopy.edit;

type CellEditorProps = {
  /** O nome do campo para quem o ouve: a coluna e a linha. */
  label: string;
  draft: string;
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
export function CellEditor({ label, draft, number, onDraft, onCommit, onCancel }: CellEditorProps) {
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
    <div className="flex h-full min-w-0 items-center gap-1 bg-raised px-1">
      <textarea
        // O campo nasce com o foco: é o que a pessoa pediu ao abrir a edição.
        autoFocus
        aria-label={label}
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
    </div>
  );
}
