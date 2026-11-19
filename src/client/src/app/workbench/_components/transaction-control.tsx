import { useId, useState } from "react";

import { Button, CheckIcon, Dialog, Select, TransactionIcon, UndoIcon, type Engine } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { engineIsolationLevels, useTabTransaction, type IsolationLevel } from "../_lib/transaction";
import { transactionCopy } from "../_lib/transaction.copy";
import type { QueryRunner } from "../_lib/use-query-runner";

const copy = transactionCopy.editor;
const question = transactionCopy.question;

type TransactionControlProps = {
  transaction: QueryRunner["transaction"];
  /** O banco da conexão da aba: define quais níveis de isolamento aparecem (RN-ISOL-001). */
  engine?: Engine;
  /** Há comando em andamento na aba: a troca de modo, a de nível, o Commit e o Rollback esperam (`SESSION_BUSY`, RN-SESSAO-002). */
  busy: boolean;
};

/**
 * RN-TX-001 a 005 e RN-ISOL-001 a 005, como o canvas desenha a barra do editor: "Transação", o modo (Auto-commit ou Commit manual), o nível de isolamento e
 * "Commit" e "Rollback", que só se habilitam com a transação aberta (o Commit, também sem erro: RN-TX-009). O que não se aplica fica desabilitado sem sair do
 * Tab (`aria-disabled`), com o motivo na dica e para o leitor de tela. Sair do Commit manual com a transação aberta pergunta antes: Commit, Rollback ou
 * Cancelar (com erro, só Rollback ou Cancelar).
 */
export function TransactionControl({ transaction, engine, busy }: TransactionControlProps) {
  const id = useId();
  const isolationId = useId();
  const state = useTabTransaction(transaction);
  const [asking, setAsking] = useState(false);
  const blocked = busy || state.pending;

  const options = [
    { value: "autoCommit", label: copy.autoCommit },
    // RN-TX-013: no banco sem log de transação, o Commit manual aparece desabilitado, com o motivo.
    { value: "manual", label: copy.manual, disabled: !state.available, ...(state.available ? {} : { hint: copy.notAvailable }) },
  ];
  const isolationReasonId = useId();
  const allowedLevels = engineIsolationLevels(engine);
  const currentLevel: IsolationLevel = allowedLevels.includes(state.isolationLevel) ? state.isolationLevel : "default";
  const levelDisabled = (level: IsolationLevel) => level !== "default" && !state.available && !(engine === 3 && level === "readUncommitted");
  const isolationOptions = allowedLevels.map((level) => {
    const disabled = levelDisabled(level);
    return {
      value: level,
      label: copy.levels[level],
      disabled,
      ...(disabled ? { hint: copy.notAvailable } : {}),
    };
  });
  const isolationBlocker = blocked ? copy.busy : state.open ? copy.openIsolation : !state.available && engine !== 3 ? copy.notAvailable : null;
  const endBlocker = blocked ? copy.busy : state.open ? null : copy.nothingToEnd;
  const commitBlocker = endBlocker ?? (state.failed ? copy.failedCommit : null);

  function choose(value: string) {
    if (value === "autoCommit" && state.open) {
      setAsking(true);
      return;
    }
    void transaction.setMode(value === "manual" ? "manual" : "autoCommit");
  }

  function chooseIsolation(value: string) {
    if (allowedLevels.includes(value as IsolationLevel)) {
      void transaction.setIsolationLevel(value as IsolationLevel);
    }
  }

  async function endAndLeave(commit: boolean) {
    if (await transaction.end(commit)) await transaction.setMode("autoCommit");
    setAsking(false);
  }

  const modeTitle = blocked ? copy.busy : `${copy.label}: ${state.mode === "manual" ? copy.manual : copy.autoCommit}`;
  const isolationTitle = isolationBlocker ?? `${copy.isolationLabel}: ${copy.levels[currentLevel]}`;

  return (
    <div
      className={cn(
        "flex min-h-7 flex-wrap items-center gap-0.5 rounded-md border border-border bg-raised/70 p-0.5",
        state.open && (state.failed ? "border-danger/45" : "border-accent/45"),
      )}
    >
      <span title={copy.label} className="flex h-[22px] items-center pr-0.5 pl-1.5 text-subtle">
        <TransactionIcon className="size-3.5" />
      </span>
      {state.open ? (
        <span aria-hidden="true" className={cn("mr-0.5 size-1.5 flex-none rounded-full", state.failed ? "bg-danger" : "bg-accent")} />
      ) : null}
      <label htmlFor={id} className="sr-only">
        {copy.label}
      </label>
      <Select
        id={id}
        value={state.mode}
        options={options}
        onChange={choose}
        title={modeTitle}
        aria-disabled={blocked || undefined}
        aria-label={copy.modeLabel}
        wideList
        className={cn(
          "h-[22px] min-h-[22px] w-auto rounded border-0 bg-transparent px-1.5 py-0 text-xs hover:bg-selected focus-visible:ring-1",
          state.mode === "manual" && "[&>span:first-child]:font-medium [&>span:first-child]:text-accent",
        )}
      />
      <span aria-hidden="true" className="h-3.5 w-px flex-none bg-border" />
      <label htmlFor={isolationId} className="sr-only">
        {copy.isolationLabel}
      </label>
      <Select
        id={isolationId}
        value={currentLevel}
        options={isolationOptions}
        onChange={chooseIsolation}
        title={isolationTitle}
        aria-disabled={isolationBlocker !== null || undefined}
        aria-describedby={isolationBlocker !== null ? isolationReasonId : undefined}
        aria-label={copy.isolationLabel}
        wideList
        className="h-[22px] min-h-[22px] w-auto max-w-40 rounded border-0 bg-transparent px-1.5 py-0 text-xs hover:bg-selected focus-visible:ring-1 [&>span:first-child]:truncate"
      />
      {isolationBlocker !== null ? (
        <span id={isolationReasonId} className="sr-only">
          {isolationBlocker}
        </span>
      ) : null}
      <span aria-hidden="true" className="h-3.5 w-px flex-none bg-border" />
      <EndButton kind="commit" label={copy.commit} blocker={commitBlocker} onEnd={() => void transaction.end(true)} />
      <EndButton kind="rollback" label={copy.rollback} blocker={endBlocker} onEnd={() => void transaction.end(false)} />
      {asking ? (
        <Dialog
          open
          role="alertdialog"
          title={question.title}
          description={state.failed ? question.failedDescription : question.description(state.commands)}
          pending={state.pending}
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button autoFocus type="button" variant="secondary" onClick={() => setAsking(false)} disabled={state.pending}>
                {question.cancel}
              </Button>
              <Button type="button" variant="danger" onClick={() => void endAndLeave(false)} disabled={state.pending}>
                {question.rollback}
              </Button>
              {state.failed ? null : (
                <Button type="button" onClick={() => void endAndLeave(true)} disabled={state.pending}>
                  {question.commit}
                </Button>
              )}
            </>
          }
        />
      ) : null}
    </div>
  );
}

function EndButton({
  kind,
  label,
  blocker,
  onEnd,
}: {
  kind: "commit" | "rollback";
  label: string;
  blocker: string | null;
  onEnd: () => void;
}) {
  const reasonId = useId();
  const blocked = blocker !== null;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="compact"
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        title={blocker ?? label}
        onClick={() => {
          if (!blocked) onEnd();
        }}
        className={cn(
          "h-[22px] gap-1 rounded px-2 text-xs",
          blocked
            ? "border border-transparent bg-transparent font-normal text-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-45 enabled:hover:bg-transparent enabled:hover:text-muted"
            : kind === "commit"
              ? "border border-success/40 bg-success/15 font-semibold text-success enabled:hover:bg-success/25 enabled:hover:text-success"
              : "border border-danger/35 bg-danger/10 font-medium text-danger enabled:hover:bg-danger/20 enabled:hover:text-danger",
        )}
      >
        {kind === "commit" ? <CheckIcon className="size-3" /> : <UndoIcon className="size-3" />}
        <span>{label}</span>
      </Button>
      {blocked ? (
        <span id={reasonId} className="sr-only">
          {blocker}
        </span>
      ) : null}
    </>
  );
}
