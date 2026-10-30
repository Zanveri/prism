import { useId, useState } from "react";

import { Button, Dialog, Select, type Engine } from "@/components/ui";

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
  const allowedLevels = engineIsolationLevels(engine);
  const currentLevel: IsolationLevel = allowedLevels.includes(state.isolationLevel) ? state.isolationLevel : "default";
  const isolationOptions = allowedLevels.map((level) => ({
    value: level,
    label: copy.levels[level],
    disabled: level !== "default" && !state.available,
    ...(level === "default" || state.available ? {} : { hint: copy.notAvailable }),
  }));
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

  return (
    <div className="ml-auto flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-muted">
        {copy.label}
      </label>
      <Select id={id} value={state.mode} options={options} onChange={choose} aria-disabled={blocked || undefined} aria-label={copy.modeLabel} wideList className="min-h-8 w-40 py-1 text-sm" />
      <label htmlFor={isolationId} className="text-xs text-muted">
        {copy.isolationLabel}
      </label>
      <Select
        id={isolationId}
        value={currentLevel}
        options={isolationOptions}
        onChange={chooseIsolation}
        aria-disabled={blocked || !state.available || undefined}
        aria-label={copy.isolationLabel}
        wideList
        className="min-h-8 w-44 py-1 text-sm"
      />
      <EndButton label={copy.commit} blocker={commitBlocker} onEnd={() => void transaction.end(true)} />
      <EndButton label={copy.rollback} blocker={endBlocker} onEnd={() => void transaction.end(false)} />
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

function EndButton({ label, blocker, onEnd }: { label: string; blocker: string | null; onEnd: () => void }) {
  const reasonId = useId();
  const blocked = blocker !== null;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="compact"
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? reasonId : undefined}
        title={blocker ?? undefined}
        onClick={() => {
          if (!blocked) onEnd();
        }}
        className="px-3 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        {label}
      </Button>
      {blocked ? (
        <span id={reasonId} className="sr-only">
          {blocker}
        </span>
      ) : null}
    </>
  );
}
