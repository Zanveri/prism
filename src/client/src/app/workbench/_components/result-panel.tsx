import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { InstallDriverLink } from "@/app/drivers/_components/install-driver-link";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, DownloadIcon, RefreshIcon, StopIcon, UploadIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { GridZoom } from "@/app/settings/_lib/preferences";

import type { ColumnLink } from "../_lib/foreign-key-links";
import type { GridEditing } from "../_lib/grid-editing";
import { noSizing, sizingFor, withWidth, type ColumnSizing } from "../_lib/grid-columns";
import { dataExportCopy } from "../_lib/data-export/data-export.copy";
import { dataImportCopy } from "../_lib/data-import/data-import.copy";
import { controlHeight, iconControlSize, type ControlSize } from "../_lib/result-bar";
import { autoLoadArmed } from "../_lib/result-paging";
import { platformScriptShortcut } from "../_lib/script-run";
import { recall, remember } from "../_lib/tab-memory";
import { isPersonBusy, type RowsState, type RunnerState, type VariableErrorsState } from "../_lib/use-query-runner";
import { variableRunCopy } from "../_lib/variable-run.copy";
import { workbenchCopy } from "../_lib/workbench.copy";
import { EditBar } from "./edit-bar";
import { GridZoomControls } from "./grid-zoom-controls";
import { ResultGrid } from "./result-grid";
import { KeptResultNote } from "./script-tabs";
import { SentSqlButton } from "./sent-sql-button";

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
 * RN-SQL-006: "Contar total" e, com o total já contado, "Contar de novo" (issue #10). É UM botão só, no mesmo lugar da barra, que troca o que mostra: o
 * texto antes da primeira contagem, o ícone com a dica depois. Clicado, ele continua na página e com o foco, e o F5 da aba segue valendo (antes, o
 * botão virava o texto do total e o foco caía no `body`, fora da aba). Ocupado (`busy`: contando, carregando mais, outro comando da pessoa rodando) ele
 * não se desabilita de verdade, só por `aria-disabled`: o botão `disabled` perde o foco. Quando ele sai da página com o foco (o resultado novo não tem o
 * que contar), avisa `onFocusLost`, e quem desenha a área leva o foco para dentro dela.
 */
export function CountButton({ rows, busy, onCount, onFocusLost, size = "regular" }: { rows: RowsState; busy: boolean; onCount: () => void; onFocusLost?: () => void; size?: ControlSize }) {
  const recount = rows.total !== null;
  const lost = useRef(onFocusLost);
  useLayoutEffect(() => {
    lost.current = onFocusLost;
  });
  // A limpeza da ref (React 19) roda quando o botão sai, com ele ainda na página: é aí que se sabe se ele tinha o foco. Estável, para não rodar a cada
  // renderização.
  const watchFocus = useCallback((button: HTMLButtonElement | null) => {
    if (button === null) return;
    return () => {
      if (button.ownerDocument.activeElement === button) lost.current?.();
    };
  }, []);

  return (
    <Button
      ref={watchFocus}
      type="button"
      variant="secondary"
      size="compact"
      aria-disabled={busy || undefined}
      aria-label={recount ? copy.recount : undefined}
      title={recount ? copy.recount : undefined}
      onClick={() => {
        if (!busy) onCount();
      }}
      className={cn("text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50", recount ? cn(iconControlSize[size], "px-0") : cn(controlHeight[size], "px-2.5"))}
    >
      {recount ? <RefreshIcon className={cn(rows.counting && "animate-spin")} /> : rows.counting ? copy.counting : copy.count}
    </Button>
  );
}

/**
 * Um botão de entrada de assistente do rodapé ou da barra: está sempre lá, e o que não se aplica fica desabilitado sem sair do caminho do Tab
 * (`aria-disabled`, como o "Contar total"), com o motivo na dica e para o leitor de tela.
 */
function EntryButton({ icon, label, blocker, hint, onOpen, size = "regular" }: { icon: ReactNode; label: string; blocker: string | null; hint: string; onOpen: () => void; size?: ControlSize }) {
  const reasonId = useId();
  const blocked = blocker !== null;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="compact"
        aria-disabled={blocked || undefined}
        aria-describedby={reasonId}
        title={blocker ?? hint}
        onClick={() => {
          if (!blocked) onOpen();
        }}
        className={cn("px-2.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50", controlHeight[size])}
      >
        {icon}
        {label}
      </Button>
      <span id={reasonId} className="sr-only">
        {blocker ?? hint}
      </span>
    </>
  );
}

/** RN-EXPORT-001: "Exportar…", que abre o assistente "Exportar dados" com a origem desta área. Está sempre lá, também sem resultado. */
export function ExportButton({ exporter, hint, size }: { exporter: ExportEntry; hint: string; size?: ControlSize }) {
  return <EntryButton icon={<DownloadIcon />} label={dataExportCopy.entry.button} blocker={exporter.blocker} hint={hint} onOpen={exporter.onExport} size={size} />;
}

/** RN-IMPORT-001: "Importar…", nos Registros de uma tabela, logo depois de "Exportar…": abre o assistente "Importar dados" com a tabela da aba. */
export function ImportButton({ importer }: { importer: ImportEntry }) {
  return <EntryButton icon={<UploadIcon />} label={dataImportCopy.entry.button} blocker={importer.blocker} hint={dataImportCopy.entry.recordsHint} onOpen={importer.onImport} />;
}

/** O "Importar…" dos Registros (RN-IMPORT-001): o motivo de não valer (a conexão somente leitura, a visão; nulo quando vale) e o que abre o assistente. */
export type ImportEntry = { blocker: string | null; onImport: () => void };

/** O "Exportar…" da área (RN-EXPORT-001): o motivo de não valer agora (nulo quando vale) e o que abre o assistente. */
export type ExportEntry = { blocker: string | null; onExport: () => void };

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
  // A execução da atualização automática (RN-GRADE-014) não é notícia: a barra segue com o resultado que está lá.
  if (state.status === "running") return state.auto === true && state.previous !== null ? collapsedSummary(state.previous) : copy.running;
  if (state.status === "rows") return state.total === null ? summaryOf(state) : `${summaryOf(state)} · ${copy.total(state.total)}`;
  if (state.status === "affected") return copy.affected(state.rowsAffected, state.elapsedMs);
  if (state.status === "cancelled") return copy.cancelled;
  if (state.status === "notice") return state.message;
  if (state.status === "variableErrors") return `${variableRunCopy.errors.title} · ${state.errors.length.toLocaleString("pt-BR")}`;
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
  /**
   * RN-ABAS-014: "Onde mostrar o resultado", logo antes dos botões do fim da barra: antes do recolher e do maximizar (no painel), na ponta direita (na aba),
   * antes de "Voltar para o painel" (na janela). Só na aba de consulta; os Registros não o têm.
   */
  placeControl?: ReactNode;
  id?: string;
  /** O `flex` que o pai dá à área; sem ele ela ocupa o que sobra. */
  style?: CSSProperties;
  records?: RecordsMode;
  /**
   * RN-TABELA-007: as colunas do resultado de um comando que são chave estrangeira e o clique no valor delas (a aba de consulta e as abas de resultado do script, em
   * qualquer lugar em que a área esteja). Nos Registros, quem diz é `records`.
   */
  follow?: Pick<RecordsMode, "links" | "onFollow" | "linkable">;
  /** O texto do valor nulo na grade (`results.nullText`, RN-CONFIG-005); sem ele, "NULL". */
  nullText?: string;
  /** Buscar a página seguinte ao rolar até o fim da grade (`results.autoLoadMore`, RN-CONFIG-005). Quem chama passa `onLoadMore` com identidade estável. */
  autoLoadMore?: boolean;
  /**
   * O id da aba, quando esta área pode desmontar com a aba aberta (a vista Registros desmonta ao trocar para a Estrutura): as larguras das colunas ficam
   * lembradas por ele (`tab-memory.ts`) e voltam com a vista. A área da aba de consulta não desmonta com a aba aberta, e as guarda só no próprio estado.
   */
  tabId?: string;
  /**
   * RN-EDIT-001 a 004: a edição das células, entregue à grade (nos Registros, na aba de consulta e nas abas guardadas do script, RN-SQL-023). Com ela vem a
   * barra de edição (RN-EDIT-013), que a área desenha só com a grade na tela: no rodapé dos Registros, logo depois de "Exportar CSV", e, no resultado de um
   * comando, numa linha própria entre a grade e os rodapés dela (também acima da nota da aba guardada).
   */
  editing?: GridEditing;
  /** A faixa da edição (as pendências, o erro do Salvar, o motivo de só leitura), acima da grade. */
  banner?: ReactNode;
  /**
   * RN-GRADE-011: o campo de filtro do resultado da aba de consulta, no topo do corpo da área (acima da faixa e da grade). Fica também com o erro do comando
   * filtrado na tela, para a pessoa corrigir o filtro; recolhida a área, recolhe com ela.
   */
  filter?: ReactNode;
  /**
   * RN-GRADE-014: a atualização automática (`AutoRefreshControl`), ao lado de "Atualizar": nos Registros, no rodapé, logo depois do botão; na aba de
   * consulta, que não tem o botão (o F5 e "Executar" fazem a vez dele), na barra, antes do zoom, que fica também com a área recolhida.
   */
  autoRefresh?: ReactNode;
  /**
   * Seção 31 (RN-SQL-020): as abas do script, no lugar do título "Resultado". O corpo da área passa a ser o painel da aba escolhida (`role="tabpanel"`,
   * rotulado por ela).
   */
  /** `mark`: o que vai logo depois da lista (o ponto vermelho do script parado na pergunta de erro, na janela do resultado, RN-ABAS-015). */
  tabs?: { list: ReactNode; mark?: ReactNode; panelId: string; labelledBy: string };
  /** RN-SQL-019: o comando do script em execução ("Executando 3 de 12…"), na barra, em qualquer aba e com a área recolhida, no lugar do "Executando…". */
  progress?: string | null;
  /** RN-SQL-020: as Estatísticas do script no corpo, no lugar do resultado; `summary` é o que a barra recolhida diz delas. */
  statistics?: { body: ReactNode; summary: string };
  /** RN-VAR-024: o painel "Variáveis" no corpo, no lugar do resultado, como as Estatísticas; `summary` é o que a barra recolhida diz dele. */
  variables?: { body: ReactNode; summary: string };
  /** RN-VAR-012: um erro da lista "Erros nas variáveis" leva o cursor do editor ao lugar dele (a posição no texto do editor). */
  onGoTo?: (offset: number) => void;
  /** RN-VAR-018: o botão "SQL enviado", na barra do resultado de um comando que levou variáveis; o clique abre o diálogo. */
  onViewSent?: () => void;
  /**
   * RN-SQL-020 e 023: uma aba guardada do script. As linhas lidas, que se editam como as do último comando (a faixa e a edição, com a barra dela, vêm de
   * quem usa a área), sem contar, sem "Carregar mais", sem filtro nem atualização automática, e a nota dela (`KeptResultNote`), com "Executar este comando",
   * no lugar do rodapé do cursor. `busy`: há comando da pessoa em andamento na aba (o `state` desta área é a cópia guardada, que não sabe disso), e o botão
   * não executa.
   */
  kept?: { busy: boolean; onRunAlone: () => void; note?: string | null };
  /**
   * RN-EXPORT-001: "Exportar…". Nos Registros, no rodapé, logo depois de "Exportar CSV"; no resultado de um comando, na barra da área (que fica à vista com a
   * área recolhida), depois do zoom da grade e antes de recolher e maximizar.
   */
  exporter?: ExportEntry;
  /** RN-IMPORT-001: "Importar…", só nos Registros, no rodapé, logo depois de "Exportar…". */
  importer?: ImportEntry;
};

/**
 * RN-VAR-012: a lista "Erros nas variáveis", quando a conferência de antes de executar achou erros e nada foi executado: cada erro com a linha e a frase; o
 * Enter e o clique levam o cursor do editor ao lugar dele.
 */
export function VariableErrorsView({ state, onGoTo }: { state: VariableErrorsState; onGoTo?: (offset: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold text-danger">{variableRunCopy.errors.title}</h3>
      <ul aria-label={variableRunCopy.errors.list} className="flex flex-col gap-1">
        {state.errors.map((error, index) => (
          <li key={index}>
            <button type="button" onClick={() => onGoTo?.(error.offset)} className="flex w-full cursor-pointer items-baseline gap-2 rounded-sm px-1 py-0.5 text-left text-ink hover:bg-selected">
              <span className="flex-none font-mono text-xs text-muted">{variableRunCopy.errors.line(error.line)}:</span>
              <span className="min-w-0 break-words">{error.message}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{variableRunCopy.errors.hint}</p>
    </div>
  );
}

/**
 * A área de resultado da aba (RN-SQL-004 a 009): as linhas na grade, as linhas afetadas, ou o erro
 * do banco como ele veio. É estado da tela, e não aviso: fica até o próximo comando (RN-AVISO-005).
 * Tudo o que vem do banco entra como texto (RN-SHELL-002).
 */
export function ResultPanel({ state, connected, onLoadMore, onCount, onRerun, collapsed = false, actions, placeControl, id, style, records, follow, nullText, autoLoadMore = false, tabId, editing, banner, filter, autoRefresh, tabs, progress = null, statistics: scriptStatistics, variables, onGoTo, onViewSent, kept, exporter, importer }: ResultPanelProps) {
  // As Estatísticas e o painel Variáveis tomam o corpo da área da mesma forma: nem grade, nem resumo das linhas na barra.
  const statistics = scriptStatistics ?? variables;
  // O comando que a área mostra rodando ("Executando…", a grade esmaecida). A execução da atualização automática (RN-GRADE-014) não: a cada 5 s a grade
  // piscaria; o controle dela diz "atualizando…". Ela também não ocupa a área para a pessoa (`busy`, abaixo).
  const running = state.status === "running" && state.auto !== true;
  // O que está na tela: o estado ou, enquanto um comando novo roda, o resultado que já estava lá
  // (linhas, linhas afetadas ou um erro de SQL). Só a API aceitar o comando novo o substitui;
  // recusado antes disso, ele continua valendo.
  const shown = state.status === "running" ? state.previous : state;
  // As Estatísticas do script (RN-SQL-020) tomam o corpo: nem grade, nem resumo das linhas na barra.
  const rows = statistics === undefined && shown?.status === "rows" ? shown : null;
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
  // "Carregar mais" e a contagem também ocupam a sessão (RN-SESSAO-002) e se cancelam (RN-SQL-010). A execução da atualização automática (RN-GRADE-014) não
  // ocupa a área para a pessoa: "Atualizar" não vira "Cancelar" e "Exportar CSV" segue valendo (o comando dela toma o lugar). O botão de ordenar do cabeçalho
  // é da edição (`editing.sort`, RN-GRADE-021), que diz quando ele não vale.
  const busy = isPersonBusy(state);
  const cancelling = (state.status === "running" || state.status === "rows") && state.cancelling;
  // RN-CONFIG-005: a grade só avisa que chegou ao fim; quem decide se a página seguinte pode vir é esta conta.
  const autoLoad = kept === undefined && autoLoadArmed(state, { enabled: autoLoadMore, connected });
  const loadedHint = autoLoadMore ? copy.loadedHintAuto : copy.loadedHint;
  const exportHintId = useId();
  // RN-ABAS-009: a barra da área de resultado da aba de consulta tem os botões de 24 px e o título (ou as abas do script) de 28 px; a dos Registros, a
  // medida de antes.
  const barSize: ControlSize = records ? "regular" : "bar";

  // RN-SQL-006: o botão de contar que sai da página com o foco (o resultado novo não tem o que contar) não o deixa cair no `body`, fora da aba, onde o F5
  // não vale: o foco vai para a grade ou, sem ela (ou com ela recolhida), para a própria área. O mesmo com "Executar este comando", de uma aba guardada do
  // script (RN-SQL-020), que sai com os resultados do script.
  const section = useRef<HTMLElement>(null);
  const focusLost = useRef(false);
  const rescueFocus = useCallback(() => {
    focusLost.current = true;
  }, []);
  useLayoutEffect(() => {
    if (!focusLost.current) return;
    focusLost.current = false;
    const area = section.current;
    const page = area?.ownerDocument;
    if (area === null || page === undefined || (page.activeElement !== null && page.activeElement !== page.body)) return;
    area.querySelector<HTMLElement>('[role="grid"], [role="table"]')?.focus();
    if (page.activeElement === null || page.activeElement === page.body) area.focus();
  });

  // RN-EDIT-013 e 014: a barra de edição, onde a grade tem a edição (também numa aba guardada do script, RN-SQL-023) e com a grade na tela. Depois do
  // botão, o foco volta à grade, como volta quando o botão que o tinha sai da tela; o "Editar célula" abre o campo, que o toma.
  const focusGrid = useCallback(() => section.current?.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true }), []);
  const editBar = rows === null || editing === undefined ? null : <EditBar buttons={editing.bar.buttons} onAction={editing.bar.onAction} onDone={focusGrid} />;

  return (
    // `tabIndex={-1}`: a área recebe o foco quando o botão que o tinha sai da página (`rescueFocus`), sem entrar no Tab.
    <section ref={section} tabIndex={-1} id={id} aria-label={records ? copy.recordsLabel(records.name) : copy.label} aria-busy={running || progress !== null} style={style} className="flex min-h-0 flex-1 flex-col border-t border-border bg-panel">
      <div className={cn("flex flex-none flex-wrap items-center gap-x-1 px-3", !records && "min-h-7", !collapsed && "border-b border-border")}>
        {tabs === undefined ? <h2 className={cn("mr-auto flex items-center border-b-2 border-accent font-semibold text-ink", records ? "h-9 px-2.5" : "h-7 px-2")}>{records ? copy.recordsTitle : copy.title}</h2> : <>{tabs.list}{tabs.mark}</>}
        {collapsed ? (
          <span role={running || progress !== null ? "status" : undefined} className="min-w-0 truncate px-2 text-xs text-muted">
            {progress ?? statistics?.summary ?? collapsedSummary(state)}
          </span>
        ) : null}
        {/*
          As linhas na tela, também enquanto outro comando roda sobre elas (esmaecidas): o resumo, o total e o botão de contar ficam no lugar, com
          "Executando…" depois. O botão, clicado, tem o foco, e não sai da página quando a pessoa executa de novo (RN-SQL-006).
        */}
        {collapsed || rows === null ? null : (
          <>
            <span className="px-2 text-xs text-muted">{summaryOf(rows)}</span>
            {/*
              RN-GRADE-001: com mais de uma célula escolhida, quantas, ao lado do resumo ("3 linhas escolhidas", "12 células escolhidas"). O lugar fica na página
              também vazio, para o leitor de tela anunciar a mudança; ela vem quando a seleção para de mudar (ao soltar o botão ou a tecla).
            */}
            {editing === undefined ? null : (
              <span role="status" className={cn("text-xs text-ink", editing.status !== null && "px-2")}>
                {editing.status ?? ""}
              </span>
            )}
            {/*
              RN-SQL-006: o total só é contado quando a pessoa pede, e só há o que contar quando há linhas
              que a tela não leu (`hasMore`, com o cursor aberto ou já fechado). Com o resultado inteiro na
              tela, o total é o número do resumo, sem ir ao banco. O total contado se conta de novo (issue #10):
              enquanto isso, o de antes fica à vista, marcado. O botão vem sempre depois do total, no mesmo lugar
              da árvore com ou sem ele: é o mesmo elemento, e o foco fica nele.
            */}
            {rows.total === null ? null : (
              <span className={cn("px-2 text-xs", rows.counting ? "text-muted" : "text-ink")}>
                {copy.total(rows.total)}
                {rows.counting ? ` · ${copy.recounting}` : null}
              </span>
            )}
            {connected && kept === undefined && (rows.hasMore || rows.total !== null) ? <CountButton rows={rows} busy={busy} onCount={onCount} onFocusLost={rescueFocus} size={barSize} /> : null}
          </>
        )}
        {/* Sem resultado na tela, "Executando…" ocupa a área de resultado, logo abaixo. O script diz qual comando roda (RN-SQL-019). */}
        {!collapsed && progress !== null ? (
          <span role="status" className="px-2 text-xs text-muted">
            {progress}
          </span>
        ) : !collapsed && running && shown !== null ? (
          <span role="status" className="px-2 text-xs text-muted">
            {copy.running}
          </span>
        ) : null}
        {records || kept !== undefined || statistics !== undefined ? null : (autoRefresh ?? null)}
        {/* Os controles do zoom só existem com a grade no corpo da área (as linhas, inclusive esmaecidas enquanto outro comando roda) e a área aberta. */}
        {rows !== null && !collapsed ? <GridZoomControls zoom={zoom} onZoom={zoomTo} size={barSize} /> : null}
        {/* RN-VAR-018: o resultado de um comando que levou variáveis mostra o SQL enviado, com os valores. */}
        {records || onViewSent === undefined || rows?.target.sent === undefined ? null : <SentSqlButton onClick={onViewSent} />}
        {records || exporter === undefined ? null : <ExportButton exporter={exporter} hint={dataExportCopy.entry.resultHint} size="bar" />}
        {placeControl}
        {actions}
      </div>

      {/* Recolhida, `inert` tira o corpo da ordem do Tab e da leitura de tela sem desmontá-lo. */}
      <div
        inert={collapsed}
        role={tabs === undefined ? undefined : "tabpanel"}
        id={tabs?.panelId}
        aria-labelledby={tabs?.labelledBy}
        // As Estatísticas não têm nada que receba o foco: o painel entra no Tab, como pede a lista de abas.
        tabIndex={statistics === undefined ? undefined : 0}
        className={cn("flex min-h-0 flex-1 flex-col", collapsed && "h-0 flex-none overflow-hidden")}
      >
        {kept !== undefined || statistics !== undefined ? null : (filter ?? null)}
        {statistics !== undefined ? (
          statistics.body
        ) : shown === null ? (
          // `flex-1`: na vista Registros o rodapé (com "Cancelar") fica no fim da área, e não colado à frase.
          <p role="status" className="flex-1 p-4 text-muted">
            {copy.running}
          </p>
        ) : rows !== null ? (
          <>
            {banner ?? null}
            {/* O mesmo lugar na árvore com o comando rodando ou não: a grade não é refeita, e a rolagem fica onde estava. */}
            <div className={cn("flex min-h-0 flex-1 flex-col", running && "opacity-50")}>
              <ResultGrid
                key={rows.id}
                columns={rows.columns}
                rows={rows.rows}
                truncated={rows.truncated}
                generated={rows.generated}
                nullText={nullText}
                onReachEnd={autoLoad ? onLoadMore : undefined}
                links={(records ?? follow)?.links}
                onFollow={(records ?? follow)?.onFollow}
                linkable={(records ?? follow)?.linkable}
                widths={current.widths}
                onResize={resize}
                showTypes={preferences.results.showColumnTypes}
                zoom={zoom}
                onZoom={zoomTo}
                editing={editing}
              />
            </div>

            {/* RN-EDIT-013: no resultado de um comando, a barra de edição numa linha própria, alinhada à esquerda, entre a grade e os rodapés dela. */}
            {records || editBar === null ? null : <div className="flex flex-none items-center border-t border-border bg-panel px-3 py-1.5">{editBar}</div>}

            {kept !== undefined ? (
              // O botão sai da página com o foco quando o comando executado troca os resultados do script: o foco vai à grade nova (RN-SQL-006).
              <KeptResultNote busy={kept.busy} onRunAlone={kept.onRunAlone} onFocusLost={rescueFocus} note={kept.note ?? null} />
            ) : running || records ? null : rows.cursorClosed ? (
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
                  <p className="text-muted">{copy.emptyHint(platformScriptShortcut)}</p>
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
            ) : shown.status === "variableErrors" ? (
              <VariableErrorsView state={shown} onGoTo={onGoTo} />
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
            {autoRefresh ?? null}
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
            {/* RN-EXPORT-001: todas as linhas, com o filtro e a ordem da aba, pelo assistente; sempre lá, também sem resultado. */}
            {exporter === undefined ? null : <ExportButton exporter={exporter} hint={dataExportCopy.entry.recordsHint} />}
            {/* RN-IMPORT-001: logo depois de "Exportar…", no mesmo desenho, com a seta para cima. */}
            {importer === undefined ? null : <ImportButton importer={importer} />}
            {/* RN-EDIT-013: nos Registros, a barra de edição logo depois de "Exportar CSV", "Exportar…" e "Importar…", antes das linhas carregadas e do
                "Carregar mais". */}
            {editBar}
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
