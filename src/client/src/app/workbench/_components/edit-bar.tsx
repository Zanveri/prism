import { Fragment, useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button, CloseIcon, DuplicateIcon, PencilIcon, PlusIcon } from "@/components/ui";

import type { EditBarAction, EditBarButton } from "../_lib/edit-bar";
import { recordsCopy } from "../_lib/records.copy";
import { stripKeyTarget } from "../_lib/tab-strip";

const copy = recordsCopy.edit.bar;

/** Os desenhos da barra de baixo do resultado do DBeaver: o lápis, o mais, as duas folhas e o X, no tom de erro do tema. */
const icons: Record<EditBarAction, ReactNode> = {
  edit: <PencilIcon />,
  newRow: <PlusIcon />,
  duplicateRow: <DuplicateIcon />,
  deleteRow: <CloseIcon className="text-danger" />,
};

type EditBarProps = {
  /** Os quatro botões, como `editBar` os descreve: sempre os mesmos, e o que não se aplica vem desabilitado, com o motivo. */
  buttons: readonly EditBarButton[];
  onAction: (id: EditBarAction) => void;
  /** Depois do botão que agiu: quem desenha a barra leva o foco de volta à grade (o "Editar célula" o leva ao campo, que nasce com ele). */
  onDone?: () => void;
};

/**
 * A barra de edição da grade (RN-EDIT-013), como a de baixo do resultado do DBeaver: "Editar célula", "Adicionar linha", "Duplicar linha" e "Excluir linha",
 * cada um com ícone e texto, no desenho dos botões da área de resultado ("Atualizar", "Exportar CSV"). Os botões só criam e tiram pendências (RN-EDIT-004):
 * nada vai ao banco, e nenhum pergunta nada; "Salvar", "Descartar" e "Ver SQL" continuam na faixa sobre a grade.
 *
 * É uma barra de ferramentas, como a de ações do navegador: uma parada de tabulação só (o botão que teve o foco por último, de começo "Editar célula"), e as
 * setas, Home e End andam entre os quatro. O que não se aplica usa `aria-disabled`, e não `disabled`: fica no caminho das setas e não perde o foco, e diz
 * por quê na dica e, para o leitor de tela, num texto só para ele (`aria-describedby`), como o "Exportar CSV"; com várias linhas na seleção, o mesmo texto
 * diz sobre quantas o botão age ("Excluir as 3 linhas escolhidas", RN-EDIT-013). Cada botão declara o atalho da plataforma
 * (`aria-keyshortcuts`, RN-EDIT-015), que a dica também escreve. O clique no campo de edição aberto o confirma antes (o campo confirma ao perder o foco),
 * e só então o botão age.
 */
export function EditBar({ buttons, onAction, onDone }: EditBarProps) {
  const [focused, setFocused] = useState(0);
  const tabStop = Math.min(focused, buttons.length - 1);
  const hintId = useId();

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button"));
    const target = stripKeyTarget(event.key, items.indexOf(event.target as HTMLElement), items.length);
    if (target === null) return;

    event.preventDefault();
    items[target].focus();
  }

  return (
    <div role="toolbar" aria-label={copy.label} onKeyDown={handleKeyDown} className="flex flex-wrap items-center gap-2">
      {buttons.map((button, index) => (
        <Fragment key={button.id}>
          <Button
            type="button"
            variant="secondary"
            size="compact"
            title={button.title}
            aria-keyshortcuts={button.shortcut.aria}
            aria-disabled={button.reason === null ? undefined : true}
            aria-describedby={button.description === null ? undefined : `${hintId}-${button.id}`}
            tabIndex={index === tabStop ? 0 : -1}
            onFocus={() => setFocused(index)}
            onClick={() => {
              if (button.reason !== null) return;
              onAction(button.id);
              onDone?.();
            }}
            className="h-7 px-2.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
          >
            {icons[button.id]}
            {button.label}
          </Button>
          {button.description === null ? null : (
            <span id={`${hintId}-${button.id}`} className="sr-only">
              {button.description}
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}
