import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import type { Connection } from "@/app/connections/_lib/connections.schema";

import { AlertIcon, Button, useToast } from "@/components/ui";
import { allowRefusal } from "@/lib/api/prism-api";
import { throughMutationCache } from "@/lib/api/mutation-cache";

import { chipsOf } from "../_lib/execution-tab";
import { executionTabCopy as copy } from "../_lib/execution-tab.copy";
import { inDatabase } from "../_lib/navigator-model";
import { scriptPlace } from "../_lib/saved-scripts";
import { scriptProgress } from "../_lib/script-run";
import { getScript } from "../_lib/scripts.service";
import { useScriptRun, type QueryRunner } from "../_lib/use-query-runner";
import type { ExecutionTarget, ExecutionValues, QueryTab } from "../_lib/workbench-model";
import { useWorkbench } from "../_lib/workbench-state";

/** O que a aba executa por pedido do cabeçalho: o texto, os valores e o que fazer com a resposta do diálogo. */
export type ExecutionRun = (
  text: string,
  values: ExecutionValues | null,
  options: { dialog: boolean; offerNewTab: boolean; onAnswered: (values: ExecutionValues) => void; onNewTab: (values: ExecutionValues) => void; onCancel?: () => void },
) => void;

/** Os botões do cabeçalho, para o Alt+X e o Shift+Alt+X da aba, que valem com o foco em qualquer ponto dela. */
export type ExecutionActions = { rerun: () => void; change: () => void };

type ExecutionHeaderProps = {
  tab: QueryTab;
  execution: ExecutionTarget;
  runner: QueryRunner;
  /** A conexão e o banco da aba, com a troca (RN-ARVORE-007 e 008): rodar o mesmo script em outra conexão é trocar aqui e executar de novo. */
  place: ReactNode;
  busy: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onRun: ExecutionRun;
  actionsRef: RefObject<ExecutionActions | null>;
  rerunShortcut: string;
  valuesShortcut: string;
};

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/**
 * RN-VAR-029: o cabeçalho da aba de execução, acima da área de resultado: onde (a conexão e o banco), quando ("Executado às 14:32:05", ou o andamento do script),
 * os valores usados em fichas, e "Executar de novo", "Mudar os valores…" e "Abrir o script". É ele que atende o pedido que o navegador deixou na aba.
 */
export function ExecutionHeader({ tab, execution, runner, place, busy, cancelling, onCancel, onRun, actionsRef, rerunShortcut, valuesShortcut }: ExecutionHeaderProps) {
  const workbench = useWorkbench();
  // As respostas do diálogo chegam depois: elas usam a área de trabalho daquele instante, e não a do clique (fechar a aba com a lista velha desfaria o resto).
  const latest = useRef(workbench);
  useEffect(() => {
    latest.current = workbench;
  });
  const queryClient = useQueryClient();
  const toast = useToast();
  const script = useScriptRun(runner);

  function run(text: string, values: ExecutionValues | null, { dialog, fresh }: { dialog: boolean; fresh: boolean }) {
    onRun(text, values, {
      dialog,
      offerNewTab: !fresh,
      onAnswered: (next) => latest.current.updateExecution(tab.id, { values: next, ranAt: Date.now() }),
      onNewTab: (next) => latest.current.requestExecution({ id: execution.scriptId, name: execution.name, sql: text, generic: execution.generic }, { connectionId: tab.connectionId, ...inDatabase(tab.database) }, next, true),
      // A aba que nasceu do pedido e nunca executou não tem o que mostrar: cancelar o diálogo a fecha.
      ...(fresh ? { onCancel: () => latest.current.closeTab(tab.id) } : {}),
    });
  }

  // O pedido do navegador, uma vez cada (o modo estrito do React chama o efeito duas vezes). A aba sem conexão espera a pessoa escolher uma na faixa.
  const handled = useRef<ExecutionTarget["pending"]>(null);
  useEffect(() => {
    const { pending } = execution;
    if (pending === null || tab.connectionId === null || handled.current === pending) return;
    handled.current = pending;
    latest.current.updateExecution(tab.id, { pending: null });
    run(tab.sql, pending.values, { dialog: false, fresh: pending.fresh });
  });

  /** O script como está gravado agora; nulo quando ele não existe mais (com o aviso) ou a leitura falhou (o aviso central). */
  async function readScript() {
    const read = await throughMutationCache(queryClient, async () => allowRefusal(await getScript(execution.scriptId), "SCRIPT_NOT_FOUND")).catch(() => null);
    if (read === null) return null;
    if (!read.ok) {
      toast.warning(copy.missing(execution.name));
      return null;
    }
    return read.data;
  }

  /** "Executar de novo": o texto gravado agora, os mesmos valores, a mesma aba. Depois do bloqueio (sem valores), o diálogo, com os lembrados. */
  async function rerun() {
    const read = await readScript();
    if (read === null) return;
    latest.current.updateTab(tab.id, { sql: read.sql });
    run(read.sql, execution.values, { dialog: false, fresh: false });
  }

  const change = () => run(tab.sql, execution.values, { dialog: true, fresh: false });

  /** "Abrir o script": numa aba de consulta, no lugar dele (o genérico, na conexão desta aba), ou a aba em que ele já está. */
  async function openScript() {
    const read = await readScript();
    if (read === null) return;
    const known = queryClient.getQueryData<Connection[]>(connectionsQuery.queryKey);
    const where = scriptPlace(read, known === undefined ? null : new Set(known.map((connection) => connection.id)), tab.connectionId === null ? [] : [tab.connectionId]);
    latest.current.openScriptTab(read, { connectionId: where.connectionId, ...inDatabase(where.database), saved: where.saved });
  }

  useEffect(() => {
    actionsRef.current = { rerun: () => void rerun(), change };
  });

  const progress = busy ? scriptProgress(script) : null;
  const status = progress ?? (execution.ranAt === null ? null : copy.ranAt(timeFormat.format(execution.ranAt)));
  // ponytail: todas as fichas, quebrando a linha; o "+3" que abre a lista quando passam de uma linha fica para quando os scripts tiverem muitas variáveis.
  const chips = execution.values === null ? [] : chipsOf(execution.values);

  return (
    <div className="flex flex-none flex-col gap-2 border-b border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {place}
        {status === null ? null : <span className="text-xs text-muted">{status}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {busy ? (
            <Button type="button" size="compact" variant="secondary" disabled={cancelling} onClick={onCancel}>
              {copy.cancel}
            </Button>
          ) : (
            <Button type="button" size="compact" aria-label={copy.rerunLabel} title={copy.rerunHint(rerunShortcut)} onClick={() => void rerun()}>
              {copy.rerun}
            </Button>
          )}
          <Button type="button" size="compact" variant="secondary" title={copy.changeHint(valuesShortcut)} disabled={busy} onClick={change}>
            {copy.change}
          </Button>
          <Button type="button" size="compact" variant="ghost" onClick={() => void openScript()}>
            {copy.openScript}
          </Button>
        </div>
      </div>
      {chips.length === 0 ? null : (
        <ul aria-label={copy.values} className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li key={chip.name} title={chip.sql ? `${chip.full}\n${copy.sqlChip}` : chip.full} className="flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 font-mono text-xs">
              {chip.sql ? <AlertIcon className="size-3 text-warning" aria-hidden="true" /> : null}
              {chip.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
