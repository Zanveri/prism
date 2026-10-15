import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils/cn";

import { commandHead, commandHint, entriesOf, scriptResultCap, scriptTotals, statisticsRange, type ScriptEntry, type ScriptEntryStatus, type ScriptRun } from "../_lib/script-run";
import { scriptRunCopy } from "../_lib/script-run.copy";

const copy = scriptRunCopy.statistics;

/** A cor da situação: o que deu certo, o que falhou (também o pulado, que falhou), o que roda e o que não rodou. */
const statusTone: Record<ScriptEntryStatus, string> = {
  pending: "text-muted",
  running: "text-accent",
  ok: "text-success",
  error: "text-danger",
  skipped: "text-danger",
  cancelled: "text-muted",
  notRun: "text-muted",
};

/** As linhas do comando, como a coluna as diz: as lidas (com mais a ler, as primeiras), as devolvidas pelo comando que grava, as afetadas. */
function rowsOf(entry: ScriptEntry): string {
  if (entry.rows !== null) {
    const rows = entry.rows.total === null ? copy.read(entry.rows.read, entry.rows.more) : copy.returned(entry.rows.total);
    return entry.kept === false ? `${rows} · ${copy.notKept}` : rows;
  }
  return entry.affected === null ? "" : copy.affected(entry.affected);
}

const cell = "border-b border-border px-2 py-1 align-top";

/**
 * Um comando, e o erro dele na linha de baixo, como veio (RN-SQL-009). Memorizado: o script publica um estado novo a cada comando, e só a linha do comando
 * que mudou é outro objeto.
 */
const StatisticsRow = memo(function StatisticsRow({ entry, number, current }: { entry: ScriptEntry; number: number; current: boolean }) {
  return (
    <Fragment>
      <tr aria-current={current ? "step" : undefined} className={cn(current && "bg-selected")}>
        <td className={cn(cell, "text-right font-mono text-muted tabular-nums")}>{number.toLocaleString("pt-BR")}</td>
        <td className={cn(cell, "max-w-0 truncate font-mono text-ink")} title={commandHint(entry.target.sql)}>
          {commandHead(entry.target.sql, 96)}
        </td>
        <td className={cn(cell, "whitespace-nowrap", statusTone[entry.status])}>{copy.statuses[entry.status]}</td>
        <td className={cn(cell, "whitespace-nowrap text-ink")}>{rowsOf(entry)}</td>
        <td className={cn(cell, "text-right whitespace-nowrap text-ink tabular-nums")}>{entry.elapsedMs === null ? "" : copy.elapsed(entry.elapsedMs)}</td>
      </tr>
      {entry.error === null ? null : (
        <tr>
          <td className={cell} />
          <td colSpan={4} className={cell}>
            <p className="font-semibold text-danger">{entry.error.title}</p>
            {/* `pre-wrap`: a mensagem do banco pode ter várias linhas (mensagem, DETAIL, HINT), e é sempre texto (RN-SQL-009). */}
            {entry.error.message === null ? null : <pre className="font-mono break-words whitespace-pre-wrap text-ink">{entry.error.message}</pre>}
            {entry.error.sqlState === null ? null : (
              <p className="text-muted">
                {copy.sqlState} <span className="font-mono text-ink">{entry.error.sqlState}</span>
              </p>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
});

/** Uma linha de aviso na tabela, de ponta a ponta: os comandos que ela não mostra enquanto o script roda. */
function NoteRow({ text }: { text: string }) {
  return (
    <tr>
      <td colSpan={5} className={cn(cell, "text-muted")}>
        {text}
      </td>
    </tr>
  );
}

/** De quanto em quanto tempo, no máximo, as Estatísticas mostram o script que roda (`useCoalescedRun`). */
export const statisticsRefreshMs = 250;

/**
 * O script que as Estatísticas mostram: enquanto ele roda, o mais novo no máximo a cada `statisticsRefreshMs` (o executor publica um a cada comando, e um
 * script de milhares de comandos de poucos milissegundos refazia a tabela, media e pintava a cada um); a pergunta de erro, o fim e um script novo, na hora.
 */
export function useCoalescedRun(run: ScriptRun, everyMs = statisticsRefreshMs): ScriptRun {
  const [shown, setShown] = useState(run);
  const latest = useRef(run);
  useLayoutEffect(() => {
    latest.current = run;
  });
  // Ajuste durante a renderização: o que não pode esperar não chega a aparecer velho.
  const now = run !== shown && (run.phase !== "running" || run.id !== shown.id);
  if (now) setShown(run);
  // O relógio conta a partir da última troca, e não do último comando: com um comando a cada poucos milissegundos, ele nunca chegaria a disparar.
  const waiting = !now && run !== shown;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setShown(latest.current), everyMs);
    return () => clearTimeout(timer);
  }, [waiting, shown, everyMs]);
  return now ? run : shown;
}

/**
 * As Estatísticas do script (RN-SQL-020), como as do DBeaver: uma tabela com cabeçalho, um comando por linha (o número, o começo do texto, a situação, as
 * linhas e o tempo), o erro de cada um na linha de baixo, e os totais. Enquanto o script roda, ela se preenche, e a linha do comando em execução fica
 * marcada (`aria-current`); quem diz "Executando 3 de 12…" é a barra da área, uma vez só para o leitor de tela. O que se conta está em `scriptTotals`.
 *
 * Enquanto o script roda, a tabela mostra só os comandos em volta do que está em execução (`statisticsRange`), com uma linha dizendo quantos ficaram antes e
 * depois; no fim, todos. Ela está à frente e muda a cada comando: inteira, cada mudança refazia e media de novo a tabela toda, e um script de milhares de
 * comandos levava minutos, com a janela sem responder. E ela se redesenha no máximo quatro vezes por segundo enquanto o script roda (`useCoalescedRun`).
 */
export const ScriptStatistics = memo(function ScriptStatistics({ run }: { run: ScriptRun }) {
  return <StatisticsTable run={useCoalescedRun(run)} />;
});

/** A tabela e os totais de um script. Memorizada: o mesmo script não a redesenha. */
const StatisticsTable = memo(function StatisticsTable({ run }: { run: ScriptRun }) {
  const totals = scriptTotals(run);
  const { from, to } = statisticsRange(run);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 text-xs">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">{copy.caption}</caption>
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-28" />
          <col className="w-56" />
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr className="text-muted">
            <th scope="col" className={cn(cell, "text-right font-medium")}>
              {copy.number}
            </th>
            <th scope="col" className={cn(cell, "font-medium")}>
              {copy.command}
            </th>
            <th scope="col" className={cn(cell, "font-medium")}>
              {copy.status}
            </th>
            <th scope="col" className={cn(cell, "font-medium")}>
              {copy.rows}
            </th>
            <th scope="col" className={cn(cell, "text-right font-medium")}>
              {copy.time}
            </th>
          </tr>
        </thead>
        <tbody>
          {from === 0 ? null : <NoteRow text={copy.before(from)} />}
          {entriesOf(run, from, to).map((entry, offset) => (
            <StatisticsRow key={from + offset} entry={entry} number={from + offset + 1} current={run.current === from + offset} />
          ))}
          {to === run.size ? null : <NoteRow text={copy.after(run.size - to)} />}
        </tbody>
      </table>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-ink">
        <span>{copy.executed(totals.ok, totals.total)}</span>
        {totals.errors === 0 ? null : <span className="text-danger">{copy.withErrors(totals.errors)}</span>}
        <span>{copy.changed(totals.changed)}</span>
        <span>{copy.totalTime(totals.elapsedMs)}</span>
      </p>
      {totals.dropped === 0 ? null : <p className="mt-1 text-muted">{copy.dropped(totals.dropped, scriptResultCap)}</p>}
    </div>
  );
});
