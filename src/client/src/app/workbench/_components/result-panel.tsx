import { useCallback, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";

import { InstallDriverLink } from "@/app/drivers/_components/install-driver-link";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, DownloadIcon, RefreshIcon, StopIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { GridZoom } from "@/app/settings/_lib/preferences";

import type { ColumnLink } from "../_lib/foreign-key-links";
import { noSizing, sizingFor, withWidth, type ColumnSizing } from "../_lib/grid-columns";
import { autoLoadArmed } from "../_lib/result-paging";
import { recall, remember } from "../_lib/tab-memory";
import type { RecordsSort } from "../_lib/table-sql";
import type { RowsState, RunnerState } from "../_lib/use-query-runner";
import { workbenchCopy } from "../_lib/workbench.copy";
import { GridZoomControls } from "./grid-zoom-controls";
import { ResultGrid } from "./result-grid";

const copy = workbenchCopy.result;

/** Os botões da área de resultado, na medida do canvas: 28 px de altura e texto de 12 px. */
function PanelButton({ children, ...props }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; "aria-describedby"?: string }) {
  return (
    <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" {...props}>
      {children}
    </Button>
  );
}

/**
 * RN-SQL-004: o que está na tela e o tempo do comando. Sem mais linhas a ler, o que está na tela é
 * tudo. O comando que gravou e devolveu linhas (RN-SQL-013) já acabou: diz quantas devolveu.
 */
function summaryOf(rows: RowsState): string {
  if (rows.totalRows !== null) return copy.returnedRows(rows.rows.length, rows.totalRows, rows.elapsedMs);
  if (!rows.hasMore) return copy.allRows(rows.rows.length, rows.elapsedMs);
  return rows.pages === 1 ? copy.firstRows(rows.rows.length, rows.elapsedMs) : copy.loadedRows(rows.rows.length, rows.elapsedMs);
}

/**
 * O que a barra diz de qualquer estado quando a área está recolhida (RN-PAINEL-001) e o corpo não
 * se vê: as linhas e o tempo (com o total, se foi contado), as linhas afetadas, o erro do banco com o
 * SQLSTATE, o cancelamento, a frase de "nada enviado" e o comando em andamento. Enquanto um comando
 * roda sobre um resultado, a barra diz que roda: é a notícia que importa.
 */
export function collapsedSummary(state: RunnerState): string {
  if (state.status === "running") return copy.running;
  if (state.status === "rows") return state.total === null ? summaryOf(state) : `${summaryOf(state)} · ${copy.total(state.total)}`;
  if (state.status === "affected") return copy.affected(state.rowsAffected, state.elapsedMs);
  if (state.status === "cancelled") return copy.cancelled;
  if (state.status === "notice") return state.message;
  if (state.status === "error") return state.sqlState === null ? state.title : `${state.title} · ${copy.sqlState} ${state.sqlState}`;
  return copy.empty;
}

/**
 * A vista Registros de uma tabela (RN-TABELA-002) usa esta mesma área: o título é outro, o rodapé
 * traz "Atualizar" (ou "Cancelar", enquanto algo roda) e a leitura de mais linhas, e antes do
 * primeiro resultado ela diz que carrega os registros em vez de pedir um comando.
 */
type RecordsMode = {
  /** O nome qualificado da tabela, para o rótulo da área. */
  name: string;
  onRefresh: () => void;
  onCancel: () => void;
  /** A ordem em vigor e quem a muda ao clicar num cabeçalho (RN-TABELA-005). Com algo em andamento a grade não ordena: o executor recusaria. */
  sort: RecordsSort | null;
  onSort: (column: string) => void;
  /** "Exportar CSV" (RN-TABELA-006): grava as linhas carregadas num arquivo. Só vale com linhas na tela. */
  onExport: () => void;
  /** As colunas que são chave estrangeira e o clique no valor delas (RN-TABELA-007). */
  links?: ReadonlyMap<number, ColumnLink>;
  onFollow?: (columnIndex: number, value: string) => void;
  /** O valor pode virar link neste banco? (`sqlLiteral`) */
  linkable?: (value: string) => boolean;
  /** A primeira carga está para começar (o banco da conexão ainda não chegou, a aba ainda não foi aberta): "Carregando…" é verdade. Sem isto, `idle` é "nenhum registro carregado". */
  waiting: boolean;
  /** A pessoa desconectou a conexão e nada foi carregado: a área diz que está desconectada, e "Atualizar" conecta e carrega. */
  disconnected: boolean;
};

type ResultPanelProps = {
  state: RunnerState;
  /** A aba tem sessão aberta: sem ela não há sobre o que contar. */
  connected: boolean;
  onLoadMore: () => void;
  onCount: () => void;
  onRerun: () => void;
  /**
   * Recolhida (RN-PAINEL-001): só a barra, com o resumo. O corpo continua montado e escondido: a
   * grade guarda a rolagem, e a área volta como estava.
   */
  collapsed?: boolean;
  /** Os botões do fim da barra (recolher, maximizar); a vista Registros de uma tabela não os tem. */
  actions?: ReactNode;
  id?: string;
  /** O `flex` que o pai dá à área; sem ele ela ocupa o que sobra. */
  style?: CSSProperties;
  records?: RecordsMode;
  /** O texto do valor nulo na grade (`results.nullText`, RN-CONFIG-005); sem ele, "NULL". */
  nullText?: string;
  /** Buscar a página seguinte ao rolar até o fim da grade (`results.autoLoadMore`, RN-CONFIG-005). Quem chama passa `onLoadMore` com identidade estável. */
  autoLoadMore?: boolean;
  /**
   * O id da aba, quando esta área pode desmontar com a aba aberta (a vista Registros desmonta ao trocar para a Estrutura): as larguras das colunas ficam
   * lembradas por ele (`tab-memory.ts`) e voltam com a vista. A área da aba de consulta não desmonta com a aba aberta, e as guarda só no próprio estado.
   */
  tabId?: string;
};

/**
 * A área de resultado da aba (RN-SQL-004 a 009): as linhas na grade, as linhas afetadas, ou o erro
 * do banco como ele veio. É estado da tela, e não aviso: fica até o próximo comando (RN-AVISO-005).
 * Tudo o que vem do banco entra como texto (RN-SHELL-002).
 */
export function ResultPanel({ state, connected, onLoadMore, onCount, onRerun, collapsed = false, actions, id, style, records, nullText, autoLoadMore = false, tabId }: ResultPanelProps) {
  const running = state.status === "running";
  // O que está na tela: o estado ou, enquanto um comando novo roda, o resultado que já estava lá
  // (linhas, linhas afetadas ou um erro de SQL). Só a API aceitar o comando novo o substitui;
  // recusado antes disso, ele continua valendo.
  const shown = state.status === "running" ? state.previous : state;
  const rows = shown?.status === "rows" ? shown : null;
  // O que a grade mostra por gosto do usuário, lido aqui e não passado por quem usa a área: vale nas duas grades (a da consulta e a dos Registros), na hora.
  const { preferences, update } = usePreferences();
  // O zoom da grade (RN-GRADE-010): uma preferência só, a mesma para as duas grades, que os botões da barra e o Ctrl+roda sobre a grade mudam.
  const zoom = preferences.results.gridZoom;
  const zoomTo = useCallback((next: GridZoom) => update({ results: { gridZoom: next } }), [update]);

  // As larguras que a pessoa deu às colunas (RN-GRADE-009). Moram aqui, e não na grade, que é refeita a cada execução: executar de novo com as mesmas
  // colunas, filtrar, ordenar, carregar mais e o bloqueio por inatividade (que descarta o resultado e o traz de volta) não as perdem. Linhas com OUTRAS
  // colunas as levam ao padrão (`sizingFor`), num ajuste durante a renderização: a grade nova já nasce sem as de antes. Sem linhas na tela (um erro, um
  // cancelamento, o resultado descartado) elas ficam como estão.
  const [sizing, setSizing] = useState<ColumnSizing>(() => (tabId === undefined ? undefined : recall(tabId, "grid")) ?? noSizing);
  const current = rows === null ? sizing : sizingFor(sizing, rows.columns);
  if (current !== sizing) setSizing(current);
  useEffect(() => {
    if (tabId !== undefined) remember(tabId, "grid", sizing);
  }, [tabId, sizing]);
  // Identidade estável: a grade é memorizada.
  const resize = useCallback((index: number, width: number) => setSizing((held) => withWidth(held, index, width)), []);
  // "Carregar mais" e a contagem também ocupam a sessão (RN-SESSAO-002) e se cancelam (RN-SQL-010).
  const busy = running || (state.status === "rows" && (state.loadingMore || state.counting));
  const cancelling = (state.status === "running" || state.status === "rows") && state.cancelling;
  // RN-CONFIG-005: a grade só avisa que chegou ao fim; quem decide se a página seguinte pode vir é esta conta.
  const autoLoad = autoLoadArmed(state, { enabled: autoLoadMore, connected });
  const loadedHint = autoLoadMore ? copy.loadedHintAuto : copy.loadedHint;
  const exportHintId = useId();

  return (
    <section id={id} aria-label={records ? copy.recordsLabel(records.name) : copy.label} aria-busy={running} style={style} className="flex min-h-0 flex-1 flex-col border-t border-border bg-panel">
      <div className={cn("flex flex-none flex-wrap items-center gap-x-1 px-3", !collapsed && "border-b border-border")}>
        <h2 className="mr-auto flex h-9 items-center border-b-2 border-accent px-2.5 font-semibold text-ink">{records ? copy.recordsTitle : copy.title}</h2>
        {collapsed ? (
          <span role={running ? "status" : undefined} className="min-w-0 truncate px-2 text-xs text-muted">
            {collapsedSummary(state)}
          </span>
        ) : running ? (
          // Sem resultado na tela, "Executando…" ocupa a área de resultado, logo abaixo.
          shown === null ? null : (
            <span role="status" className="px-2 text-xs text-muted">
              {copy.running}
            </span>
          )
        ) : rows === null ? null : (
          <>
            <span className="px-2 text-xs text-muted">{summaryOf(rows)}</span>
            {/*
              RN-SQL-006: o total só é contado quando a pessoa pede, e só há o que contar quando há linhas
              que a tela não leu (`hasMore`, com o cursor aberto ou já fechado). Com o resultado inteiro na
              tela, o total é o número do resumo, sem ir ao banco.
            */}
            {rows.total !== null ? (
              <span className="px-2 text-xs text-ink">{copy.total(rows.total)}</span>
            ) : connected && rows.hasMore ? (
              <PanelButton onClick={onCount} disabled={rows.counting || rows.loadingMore}>
                {rows.counting ? copy.counting : copy.count}
              </PanelButton>
            ) : null}
          </>
        )}
        {/* Os controles do zoom só existem com a grade no corpo da área (as linhas, inclusive esmaecidas enquanto outro comando roda) e a área aberta. */}
        {rows !== null && !collapsed ? <GridZoomControls zoom={zoom} onZoom={zoomTo} /> : null}
        {actions}
      </div>

      {/* Recolhida, `inert` tira o corpo da ordem do Tab e da leitura de tela sem desmontá-lo. */}
      <div inert={collapsed} className={cn("flex min-h-0 flex-1 flex-col", collapsed && "h-0 flex-none overflow-hidden")}>
        {shown === null ? (
          // `flex-1`: na vista Registros o rodapé (com "Cancelar") fica no fim da área, e não colado à frase.
          <p role="status" className="flex-1 p-4 text-muted">
            {copy.running}
          </p>
        ) : rows !== null ? (
          <>
            {/* O mesmo lugar na árvore com o comando rodando ou não: a grade não é refeita, e a rolagem fica onde estava. */}
            <div className={cn("flex min-h-0 flex-1 flex-col", running && "opacity-50")}>
              <ResultGrid
                key={rows.id}
                columns={rows.columns}
                rows={rows.rows}
                truncated={rows.truncated}
                nullText={nullText}
                onReachEnd={autoLoad ? onLoadMore : undefined}
                sort={records?.sort}
                onSort={records === undefined || busy ? undefined : (column) => records.onSort(column.name)}
                links={records?.links}
                onFollow={records?.onFollow}
                linkable={records?.linkable}
                widths={current.widths}
                onResize={resize}
                showTypes={preferences.results.showColumnTypes}
                zoom={zoom}
                onZoom={zoomTo}
              />
            </div>

            {running || records ? null : rows.cursorClosed ? (
              // RN-SQL-007: o cursor fechou; o que resta é executar de novo.
              <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-raised px-3 py-1.5 text-xs">
                <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
                <span className="text-ink">{copy.cursorClosed}</span>
                <span className="ml-auto">
                  <PanelButton onClick={onRerun}>{copy.rerun}</PanelButton>
                </span>
              </div>
            ) : rows.hasMore ? (
              <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-1.5 text-xs text-muted">
                <span>{loadedHint(rows.rows.length)}</span>
                <span className="ml-auto">
                  <PanelButton onClick={onLoadMore} disabled={rows.loadingMore || rows.counting}>
                    {rows.loadingMore ? copy.loadingMore : copy.loadMore}
                  </PanelButton>
                </span>
              </div>
            ) : null}
          </>
        ) : (
          // As linhas afetadas e o erro também ficam, esmaecidos, enquanto o comando novo roda.
          <div className={cn("flex min-h-0 flex-1 flex-col overflow-auto p-4", running && "opacity-50")}>
            {shown.status === "idle" ? (
              records ? (
                records.waiting ? (
                  <p role="status" className="text-muted">
                    {copy.recordsLoading}
                  </p>
                ) : records.disconnected ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-body">{copy.recordsDisconnected}</p>
                    <p className="text-muted">{copy.recordsDisconnectedHint}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <p className="text-body">{copy.recordsEmpty}</p>
                    <p className="text-muted">{copy.recordsEmptyHint}</p>
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="text-body">{copy.empty}</p>
                  <p className="text-muted">{copy.emptyHint}</p>
                </div>
              )
            ) : shown.status === "affected" ? (
              <p className="font-mono text-ink">{copy.affected(shown.rowsAffected, shown.elapsedMs)}</p>
            ) : shown.status === "notice" ? (
              // RN-SQL-001: o comando não foi enviado, e a frase diz o que fazer.
              <p className="flex items-baseline gap-2 text-ink">
                <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
                {shown.message}
              </p>
            ) : shown.status === "cancelled" ? (
              // RN-SQL-010: cancelado pelo usuário. Estado neutro, o mesmo traço do aviso de "nada enviado", e não o painel de erro.
              <p className="flex items-baseline gap-2 text-ink">
                <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
                {copy.cancelled}
              </p>
            ) : shown.status === "error" ? (
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold text-danger">{shown.title}</h3>
                {/* `pre-wrap`: a mensagem do banco pode ter várias linhas (mensagem, DETAIL, HINT), e é sempre texto (RN-SQL-009). */}
                {shown.message === null ? null : <pre className={cn("break-words whitespace-pre-wrap text-ink", shown.source === "api" || shown.source === "driver" ? "font-sans" : "font-mono")}>{shown.message}</pre>}
                {shown.sqlState === null ? null : (
                  <p className="text-xs text-muted">
                    {copy.sqlState} <span className="font-mono text-ink">{shown.sqlState}</span>
                  </p>
                )}
                {/* RN-DRIVER-006: sem o driver não há o que tentar de novo; o caminho é a tela de Drivers. */}
                {shown.source === "driver" ? <InstallDriverLink className="self-start" driverID={shown.driverID} /> : null}
              </div>
            ) : null}
          </div>
        )}

        {records ? (
          <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-panel px-3 py-1.5 text-xs">
            {busy ? (
              <PanelButton onClick={records.onCancel} disabled={cancelling}>
                <StopIcon />
                {cancelling ? workbenchCopy.editor.cancelling : workbenchCopy.editor.cancel}
              </PanelButton>
            ) : (
              <PanelButton onClick={records.onRefresh}>
                <RefreshIcon />
                {copy.refresh}
              </PanelButton>
            )}
            {/* RN-TABELA-006: exporta as linhas carregadas; a dica diz quantas são e que as outras não entram. */}
            {rows === null ? null : (
              <>
                <PanelButton onClick={records.onExport} disabled={busy} title={copy.exportHint(rows.rows.length, rows.hasMore)} aria-describedby={exportHintId}>
                  <DownloadIcon />
                  {copy.exportCsv}
                </PanelButton>
                <span id={exportHintId} className="sr-only">
                  {copy.exportHint(rows.rows.length, rows.hasMore)}
                </span>
              </>
            )}
            {rows === null || running ? null : rows.cursorClosed ? (
              <span className="flex items-baseline gap-2 text-ink">
                <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
                {copy.recordsCursorClosed}
              </span>
            ) : rows.hasMore ? (
              <>
                <span className="text-muted">{loadedHint(rows.rows.length)}</span>
                <span className="ml-auto">
                  <PanelButton onClick={onLoadMore} disabled={rows.loadingMore || rows.counting}>
                    {rows.loadingMore ? copy.loadingMore : copy.loadMore}
                  </PanelButton>
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
