import type { ReactNode } from "react";

import { Button, PlayIcon, StopIcon } from "@/components/ui";

import { workbenchCopy } from "../_lib/workbench.copy";

const copy = workbenchCopy.editor;

type EditorToolbarProps = {
  /** Há comando em execução na sessão da aba: "Executar" vira "Cancelar" (RN-SQL-010). */
  busy: boolean;
  cancelling: boolean;
  /** Há o que enviar: texto selecionado ou comando no cursor (RN-SQL-001). */
  runnable: boolean;
  onRun: () => void;
  onCancel: () => void;
  /** RN-ARVORE-007: o banco em que a aba roda, e a troca dele (`DatabasePicker`); nulo na aba sem conexão, que pede uma antes. */
  database?: ReactNode;
};

/**
 * A barra do editor: Executar e Cancelar (seção 9 da especificação) e o banco da aba (RN-ARVORE-007). Enquanto um
 * comando roda o botão é "Cancelar", e por isso a tela nunca pede um segundo comando à mesma
 * sessão (`SESSION_BUSY`, RN-SESSAO-002).
 */
export function EditorToolbar({ busy, cancelling, runnable, onRun, onCancel, database }: EditorToolbarProps) {
  return (
    <div role="toolbar" aria-label={copy.toolbar} className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2">
      {busy ? (
        <Button type="button" variant="secondary" size="compact" onClick={onCancel} disabled={cancelling} className="px-3">
          <StopIcon />
          {cancelling ? copy.cancelling : copy.cancel}
        </Button>
      ) : (
        <Button type="button" size="compact" onClick={onRun} disabled={!runnable} className="px-3">
          <PlayIcon />
          <span>{copy.run}</span>
          <kbd className="font-mono text-[11px] font-medium">{copy.runShortcut}</kbd>
        </Button>
      )}
      {database}
    </div>
  );
}
