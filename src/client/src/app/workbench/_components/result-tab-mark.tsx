import { useState, useSyncExternalStore } from "react";

import { resultMarkOf, resultMarkText, trackUnseen } from "../_lib/result-place";
import { resultActivity } from "../_lib/result-slots";
import { isPersonBusy, useQueryRunner, useScriptRun, type QueryRunner } from "../_lib/use-query-runner";
import { ScriptWaitingMark } from "./script-tabs";

/**
 * O ponto da aba do resultado (RN-ABAS-012), depois do título: no acento do tema enquanto há um comando da pessoa em andamento na aba (também o script e o
 * "Salvar" das alterações; a execução automática não, RN-GRADE-014) e, com ela não ativa, desde que um comando termina até ela ficar ativa (um resultado novo
 * que a pessoa ainda não viu, um erro também). O ponto vermelho do script parado na pergunta de erro (RN-SQL-021) fica no lugar dele. O ponto é desenho; o
 * leitor de tela ouve o texto, no nome da aba ("…, executando", "…, resultado novo").
 */
export function ResultTabMark({ tabId, runner, active }: { tabId: string; runner: QueryRunner; active: boolean }) {
  const state = useQueryRunner(runner);
  const script = useScriptRun(runner);
  const saving = useSyncExternalStore(resultActivity.subscribe, () => resultActivity.isSaving(tabId));
  const busy = isPersonBusy(state) || script?.phase === "running" || saving;

  // Ajuste durante a renderização: o comando que acabou de terminar acende o ponto já nesta pintura.
  const [seen, setSeen] = useState(() => ({ busy, unseen: false }));
  const next = trackUnseen(seen, { busy, active });
  if (next.busy !== seen.busy || next.unseen !== seen.unseen) setSeen(next);

  if (script?.phase === "paused") return <ScriptWaitingMark runner={runner} />;
  const mark = resultMarkOf({ waiting: false, running: busy, unseen: next.unseen });
  if (mark === null) return null;

  return (
    <>
      <span aria-hidden data-result-mark={mark} className="size-1.5 flex-none rounded-full bg-accent" />
      <span className="sr-only">{resultMarkText(mark)}</span>
    </>
  );
}
