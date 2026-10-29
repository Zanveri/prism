import type { ReactNode } from "react";

import { Button, PlayIcon, PlayScriptIcon, StopIcon } from "@/components/ui";

import { scriptRunCopy } from "../_lib/script-run.copy";
import { workbenchCopy } from "../_lib/workbench.copy";

const copy = workbenchCopy.editor;

type EditorToolbarProps = {
  /** Há comando em execução na sessão da aba: "Executar" vira "Cancelar" (RN-SQL-010), também durante um script (RN-SQL-019). */
  busy: boolean;
  cancelling: boolean;
  /** Há o que enviar: texto selecionado ou comando no cursor (RN-SQL-001). */
  runnable: boolean;
  onRun: () => void;
  /** RN-SQL-019: "Executar script", ao lado de "Executar". */
  onRunScript: () => void;
  /** O atalho do script como a plataforma o escreve (`scriptShortcutLabel`): Alt+X, ou Cmd+Option+X no macOS. */
  scriptShortcut: { label: string; aria: string };
  onCancel: () => void;
  /** RN-ARVORE-008: a conexão da aba, e a troca dela (`ConnectionPicker`), antes do banco. */
  connection?: ReactNode;
  /** RN-ARVORE-007: o banco em que a aba roda, e a troca dele (`DatabasePicker`); nulo na aba sem conexão, que pede uma antes. */
  database?: ReactNode;
  /** RN-TX-001: o modo de transação da aba, o Commit e o Rollback (`TransactionControl`), no fim da barra, como no canvas. */
  transaction?: ReactNode;
};

/**
 * A barra do editor: Executar, Executar script e Cancelar (seção 9 da especificação, RN-SQL-019), a conexão da aba (RN-ARVORE-008), o banco dela
 * (RN-ARVORE-007) e a transação (RN-TX-001). Enquanto um comando (ou um script) roda, os dois botões de executar dão lugar a "Cancelar", e por isso a tela nunca pede um segundo
 * comando à mesma sessão (`SESSION_BUSY`, RN-SESSAO-002).
 */
export function EditorToolbar({ busy, cancelling, runnable, onRun, onRunScript, scriptShortcut, onCancel, connection, database, transaction }: EditorToolbarProps) {
  return (
    <div role="toolbar" aria-label={copy.toolbar} className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2">
      {busy ? (
        <Button type="button" variant="secondary" size="compact" onClick={onCancel} disabled={cancelling} className="px-3">
          <StopIcon />
          {cancelling ? copy.cancelling : copy.cancel}
        </Button>
      ) : (
        <>
          <Button type="button" size="compact" onClick={onRun} disabled={!runnable} className="px-3">
            <PlayIcon />
            <span>{copy.run}</span>
            <kbd className="font-mono text-[11px] font-medium">{copy.runShortcut}</kbd>
          </Button>
          <Button type="button" variant="secondary" size="compact" onClick={onRunScript} disabled={!runnable} title={scriptRunCopy.editor.title(scriptShortcut.label)} aria-keyshortcuts={scriptShortcut.aria} className="px-3">
            <PlayScriptIcon />
            <span>{scriptRunCopy.editor.run}</span>
            <kbd className="font-mono text-[11px] font-medium text-muted">{scriptShortcut.label}</kbd>
          </Button>
        </>
      )}
      {connection}
      {database}
      {transaction}
    </div>
  );
}
