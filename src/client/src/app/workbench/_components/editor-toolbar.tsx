import type { ReactNode } from "react";

import { Button, HistoryIcon, PlayIcon, PlayScriptIcon, PlayValuesIcon, StopIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { historyCopy } from "../_lib/history.copy";
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
  /** RN-VAR-026: o "Executar com valores…", só quando o texto do editor declara variáveis no topo; sem ele, o botão não aparece. */
  onRunWithValues?: () => void;
  valuesShortcut?: { label: string; aria: string };
  /** RN-HIST-001: abre e fecha o painel do Histórico (`Ctrl+Shift+H`), depois de "Executar script". */
  historyOpen?: boolean;
  onToggleHistory?: () => void;
  /** RN-ARVORE-008: a conexão da aba, e a troca dela (`ConnectionPicker`), antes do banco. */
  connection?: ReactNode;
  /** RN-ARVORE-007: o banco em que a aba roda, e a troca dele (`DatabasePicker`); nulo na aba sem conexão, que pede uma antes. */
  database?: ReactNode;
  /** RN-TX-001: o modo de transação da aba, o Commit e o Rollback (`TransactionControl`), no fim da barra, como no canvas. */
  transaction?: ReactNode;
};

/**
 * A barra do editor: Executar, Executar script, Histórico e Cancelar (seção 9 da especificação, RN-SQL-019, RN-HIST-001), a conexão da aba (RN-ARVORE-008), o banco dela
 * (RN-ARVORE-007) e a transação (RN-TX-001). Enquanto um comando (ou um script) roda, os dois botões de executar dão lugar a "Cancelar", e por isso a tela nunca pede um segundo
 * comando à mesma sessão (`SESSION_BUSY`, RN-SESSAO-002).
 */
export function EditorToolbar({
  busy,
  cancelling,
  runnable,
  onRun,
  onRunScript,
  scriptShortcut,
  onCancel,
  onRunWithValues,
  valuesShortcut,
  historyOpen = false,
  onToggleHistory,
  connection,
  database,
  transaction
}: EditorToolbarProps) {
  const hasTarget = Boolean(connection) || Boolean(database);

  return (
    <div
      role="toolbar"
      aria-label={copy.toolbar}
      className="@container flex flex-none flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border bg-panel px-2.5 py-1.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {busy ? (
          <Button type="button" variant="secondary" size="compact" onClick={onCancel} disabled={cancelling} className="h-7 gap-1.5 px-2.5 text-xs">
            <StopIcon className="size-3.5" />
            <span>{cancelling ? copy.cancelling : copy.cancel}</span>
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="compact"
              onClick={onRun}
              disabled={!runnable}
              title={`${copy.run} (${copy.runShortcut})`}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <PlayIcon className="size-3.5" />
              <span>{copy.run}</span>
              <kbd className="hidden rounded bg-panel/20 px-1 py-0.5 font-mono text-[10px] leading-none font-medium @5xl:inline-block">{copy.runShortcut}</kbd>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={onRunScript}
              disabled={!runnable}
              title={scriptRunCopy.editor.title(scriptShortcut.label)}
              aria-keyshortcuts={scriptShortcut.aria}
              className="h-7 gap-1.5 border-border bg-raised/70 px-2.5 text-xs hover:border-border-strong"
            >
              <PlayScriptIcon className="size-3.5" />
              <span>{scriptRunCopy.editor.run}</span>
              <kbd className="hidden rounded border border-border bg-panel/80 px-1 py-0.5 font-mono text-[10px] leading-none font-medium text-muted @5xl:inline-block">{scriptShortcut.label}</kbd>
            </Button>
            {onRunWithValues === undefined || valuesShortcut === undefined ? null : (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={onRunWithValues}
                aria-label={scriptRunCopy.editor.withValues}
                title={scriptRunCopy.editor.withValuesTitle(valuesShortcut.label)}
                aria-keyshortcuts={valuesShortcut.aria}
                className="size-7 border-border bg-raised/70 hover:border-border-strong"
              >
                <PlayValuesIcon className="size-3.5" />
              </Button>
            )}
          </>
        )}
        {onToggleHistory !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            aria-label={historyCopy.toolbarButton}
            aria-pressed={historyOpen}
            aria-keyshortcuts="Control+Shift+H"
            title={historyCopy.toolbarTooltip}
            onClick={onToggleHistory}
            className={cn(
              "h-7 gap-1.5 border border-transparent px-2 text-xs text-muted hover:border-border hover:bg-selected hover:text-ink",
              historyOpen && "border-accent/60 bg-selected text-ink",
            )}
          >
            <HistoryIcon className="size-3.5" />
            <span className="hidden @6xl:inline">{historyCopy.toolbarButton}</span>
          </Button>
        )}
        {hasTarget ? (
          <>
            <span aria-hidden="true" className="mx-0.5 h-4 w-px flex-none bg-border" />
            <div className="flex min-w-0 items-center gap-1.5">
              {connection}
              {database}
            </div>
          </>
        ) : null}
      </div>
      {transaction}
    </div>
  );
}
