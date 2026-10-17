import type { ToastAction } from "@/components/ui";
import type { ApiResult } from "@/lib/api/prism-api";

import { formatFileSize } from "../data-export/transfer-tracker";
import { isLoadPhase, type LoadPhase, type Transfer } from "../data-export/transfers.schema";
import { dataImportCopy } from "./data-import.copy";
import type { ImportFormat } from "./imports.schema";

/**
 * As importações de dados e as cópias para outro banco desta janela (RN-IMPORT-019 a 021 e 027), do 202 até o fim lido: a consulta a cada segundo, o
 * "Cancelar" que pergunta quando algo já ficou na tabela, os avisos do fim com "Abrir registros", a entrada da falha na barra ("Ver o erro" e "Descartar")
 * e a nota dos Registros abertos da tabela. Um objeto fora do React, como o acompanhamento das exportações, com as peças de fora injetadas e testado sem DOM.
 * A importação é da janela, e não da aba: fechar os Registros de onde ela saiu não a muda.
 */

export type LoadKind = "import" | "copy";

/** `running`: o trabalho roda; `cancelling`: o `DELETE` foi pedido; `lost`: três consultas seguidas falharam; `failed`: a entrada da falha, só da tela. */
export type LoadStage = "running" | "cancelling" | "lost" | "failed";

/** A tabela que recebe as linhas: a da importação, ou a de destino da cópia. */
export type LoadTable = { connectionId: string; database?: string; schema: string; name: string };

/** O que o diálogo "Importação interrompida" mostra (RN-IMPORT-020). */
export type LoadFailure = { line: number | null; column: string | null; message: string; sqlState: string | null; side: "source" | "target" | null; stayed: string };

export type TrackedLoad = {
  id: string;
  seq: number;
  kind: LoadKind;
  /** Na importação, o nome do arquivo; na cópia, o nome da origem ("pedido", "resultado de consulta-1.sql"). */
  sourceName: string;
  /** Na importação, o formato e a planilha: a linha do erro é "Item 12 da lista" no JSON e "Linha 12 da planilha Pedidos" no XLSX. */
  format: ImportFormat | null;
  sheet: string | null;
  table: LoadTable;
  /** O Informix sem log (RN-EDIT-012): cada linha gravada sozinha. */
  oneAtATime: boolean;
  empty: boolean;
  /** "Tudo numa transação só": nada fica se parar, e o "Cancelar" não pergunta. */
  single: boolean;
  stage: LoadStage;
  phase: LoadPhase | null;
  rows: number;
  committed: number | null;
  total: number | null;
  bytes: number;
  size: number | null;
  failure: LoadFailure | null;
};

export type NewLoad = Pick<TrackedLoad, "id" | "kind" | "sourceName" | "format" | "sheet" | "table" | "oneAtATime" | "empty" | "single">;

export type LoadNotify = {
  success(title: string, description?: string, action?: ToastAction): void;
  warning(title: string, description?: string, action?: ToastAction): void;
  error(title: string, description?: string): void;
};

export type LoadTrackerDeps = {
  getTransfer(id: string): Promise<ApiResult<Transfer>>;
  forget(id: string): Promise<ApiResult<void>>;
  notify: LoadNotify;
  schedule(run: () => void, ms: number): () => void;
  /** "Abrir registros": a aba dos Registros da tabela nesta janela (abre, ou traz à frente). */
  openRecords(table: LoadTable): void;
  /** Linhas foram (ou podem ter sido) gravadas na tabela: os Registros abertos dela mostram a nota com "Atualizar". */
  markImported(table: LoadTable): void;
  /** A ordem entre as transferências da janela (as exportações também): a barra mostra a mais antiga. */
  sequence(): number;
};

export const loadPollMs = 1000;
export const maxLoadPollFailures = 3;

const st = dataImportCopy.status;
const t = dataImportCopy.toasts;
const q = dataImportCopy.cancelQuestion;

/** O texto e a dica da entrada da barra (RN-IMPORT-019 e 027); `percent` nulo é a barra sem medida. */
export type LoadEntryView = { text: string; hint: string; percent: number | null; busy: boolean };

/** O nome da tabela nos textos: sem o esquema (RN-IMPORT-019). */
const tableName = (entry: Pick<TrackedLoad, "table">) => entry.table.name;

/** O texto da entrada pela fase: conectando, conferindo, esvaziando, a porcentagem (no máximo 99% até o fim), confirmando. */
export function loadEntryView(entry: TrackedLoad): LoadEntryView {
  const busy = entry.stage === "cancelling";
  const plain = (text: string): LoadEntryView => ({ text, hint: text, percent: null, busy });
  const copy = entry.kind === "copy";
  switch (entry.stage) {
    case "cancelling":
      return plain(st.cancelling);
    case "lost":
      return plain(copy ? st.lostCopy : st.lostImport);
    case "failed":
      return plain(copy ? st.failedCopy(entry.sourceName, tableName(entry)) : st.failedImport(tableName(entry)));
    case "running":
      break;
  }
  const prefix = copy ? st.copying(entry.sourceName, tableName(entry)) : st.importing(entry.sourceName, tableName(entry));
  const read = (bytes: number) => formatFileSize(bytes);
  const filePercent = entry.size !== null && entry.size > 0 ? Math.min(99, Math.floor((entry.bytes / entry.size) * 100)) : null;
  switch (entry.phase) {
    case null:
    case "connecting":
      return plain(`${prefix} ${st.connecting}`);
    case "counting":
      return plain(`${prefix} ${st.counting}`);
    case "emptying":
      return plain(`${prefix} ${st.emptying}`);
    case "committing":
      return plain(`${prefix} ${st.committing}`);
    case "checking": {
      const text = filePercent === null ? `${prefix} ${st.checking(0)}` : `${prefix} ${st.checking(filePercent)}`;
      return { text, hint: st.checkingHint(read(entry.bytes), read(entry.size ?? 0)), percent: filePercent, busy };
    }
    case "loading": {
      if (copy) {
        const committed = entry.committed ?? 0;
        if (entry.total !== null && entry.total > 0 && entry.rows <= entry.total) {
          const percent = Math.min(99, Math.floor((entry.rows / entry.total) * 100));
          return { text: `${prefix} ${st.percent(percent)}`, hint: st.copiedHint(entry.rows, entry.total, committed), percent, busy };
        }
        return { text: `${prefix} ${st.rows(entry.rows)}`, hint: st.copiedHint(entry.rows, null, committed), percent: null, busy };
      }
      const hint = st.loadedHint(entry.rows, entry.oneAtATime ? null : (entry.committed ?? 0), entry.size === null ? null : read(entry.bytes), entry.size === null ? null : read(entry.size));
      return { text: filePercent === null ? `${prefix} ${st.rows(entry.rows)}` : `${prefix} ${st.percent(filePercent)}`, hint, percent: filePercent, busy };
    }
  }
}

/**
 * O "Cancelar" pergunta antes quando algo já ficaria na tabela (RN-IMPORT-019): `committed` acima de zero; no Informix sem log, uma linha gravada ou o
 * esvaziamento começado; e sempre na entrada que não sabe como está. Não pergunta na conexão, na conferência, na contagem e com "Tudo numa transação só".
 */
export function cancelQuestionOf(entry: TrackedLoad): { title: string; text: string; confirm: string; keep: string } | null {
  const copy = entry.kind === "copy";
  const title = copy ? q.copyTitle(entry.sourceName, tableName(entry)) : q.importTitle(tableName(entry));
  const buttons = copy ? { confirm: q.cancelCopy, keep: q.keepCopying } : { confirm: q.cancelImport, keep: q.keepImporting };
  if (entry.stage === "lost") return { title, text: q.unknown, ...buttons };
  if (entry.stage !== "running") return null;
  if (entry.phase === null || entry.phase === "connecting" || entry.phase === "checking" || entry.phase === "counting") return null;
  if (entry.oneAtATime) {
    if (entry.rows > 0) return { title, text: q.written(entry.rows), ...buttons };
    if (entry.empty && (entry.phase === "emptying" || entry.phase === "loading" || entry.phase === "committing")) return { title, text: q.emptyingNoLog, ...buttons };
    return null;
  }
  if (entry.single) return null;
  const committed = entry.committed ?? 0;
  if (committed <= 0) return null;
  return { title, text: entry.empty ? q.committedEmptied(committed) : q.committed(committed), ...buttons };
}

/** O fim pode ter deixado linhas na tabela (RN-IMPORT-020): então os Registros abertos dela ganham a nota com "Atualizar". */
function mayHaveWritten(entry: TrackedLoad, transfer: Transfer): boolean {
  if (transfer.state === "done") return true;
  const committed = transfer.error?.committed ?? transfer.committed ?? entry.committed ?? 0;
  if (committed > 0 || transfer.uncertain === true || transfer.error?.uncertain === true) return true;
  if (entry.oneAtATime) return transfer.rows > 0 || (entry.empty && (transfer.phase === "emptying" || transfer.phase === "loading" || transfer.phase === "committing"));
  return false;
}

/** O que ficou na tabela, a frase que fecha a falha e o cancelamento (RN-IMPORT-020), pelo `committed`, pelo `uncertain`, pela fase e pela carga. */
export function stayedText(entry: TrackedLoad, transfer: Transfer): string {
  const copy = entry.kind === "copy";
  const committed = transfer.error?.committed ?? transfer.committed ?? entry.committed ?? 0;
  const uncertain = transfer.uncertain === true || transfer.error?.uncertain === true;
  const phase = transfer.phase ?? entry.phase;
  const emptiedSuffix = (text: string) => (entry.empty ? `${text} ${t.emptied}` : text);

  if (uncertain) {
    if (transfer.state === "canceled") return t.uncertainCancel;
    if (entry.oneAtATime) return phase === "emptying" ? t.uncertainEmptyOnly : t.uncertainRow(transfer.error?.line ?? transfer.rows + 1);
    const first = committed + 1;
    const last = Math.max(transfer.rows, first);
    if (entry.empty && committed === 0) return transfer.rows === 0 ? t.uncertainEmptyOnly : t.uncertainEmptyCommit(first, last);
    return t.uncertainCommit(first, last);
  }
  if (entry.oneAtATime) {
    if (entry.empty && phase === "emptying") return t.partlyEmptied(copy);
    if (committed > 0) return emptiedSuffix(transfer.state === "canceled" ? t.writtenStayed(committed) : t.previousStayed(committed));
    return entry.empty ? `${t.noneWrittenNoLog} ${t.emptied}` : t.nothingStayed;
  }
  if (committed > 0) return emptiedSuffix(t.committedStayed(committed));
  return t.nothingStayed;
}

/** Onde a falha aconteceu: "Linha 1.234 do arquivo, coluna qtd", "Item 1.234 da lista", "Linha 1.234 da planilha Pedidos", "Linha 1.234 da origem". */
export function failurePlace(entry: Pick<TrackedLoad, "kind" | "format" | "sheet">, line: number | null, column: string | null): string | null {
  if (line === null) return null;
  const where = entry.kind === "copy" ? t.sourceLine(line) : entry.format === "json" ? t.listItem(line) : entry.format === "xlsx" ? t.sheetLine(line, entry.sheet ?? "") : t.fileLine(line);
  return column === null ? where : `${where}, ${t.column(column)}`;
}

/**
 * A descrição do aviso de falha (RN-IMPORT-020 e 027): na cópia, o lado ("Ao ler a origem:", "Ao gravar no destino:"); onde (a linha e a coluna, ou, no erro
 * do banco sem linha, o intervalo das linhas da transação desfeita); a mensagem como veio, com o SQLSTATE; e o que ficou. A tela decide pelo `code`, pela
 * linha, pela coluna e pelo `uncertain`, nunca pelo texto da mensagem.
 */
export function failureDescription(entry: TrackedLoad, transfer: Transfer): { description: string; failure: LoadFailure } {
  const error = transfer.error;
  const line = error?.line ?? null;
  const column = error?.column ?? null;
  const message = error?.message ?? "";
  const sqlState = error?.sqlState ?? null;
  const committed = error?.committed ?? transfer.committed ?? 0;
  const databaseError = error?.code === "SQL_EXECUTION_FAILED" || error?.code === "DATABASE_CONNECTION_FAILED";
  let where = failurePlace(entry, line, column);
  if (where === null && databaseError && transfer.rows > committed && error?.uncertain !== true) where = t.inRange(committed + 1, transfer.rows, entry.kind === "copy");
  const withState = sqlState === null ? message : `${message} (${t.sqlState(sqlState)})`;
  const side = error?.side ?? null;
  const prefix = entry.kind === "copy" && side !== null ? (side === "source" ? t.readingSource : t.writingTarget) : null;
  const stayed = stayedText(entry, transfer);
  const body = where === null ? withState : `${where}: ${withState}`;
  const description = [prefix === null ? body : `${prefix} ${where === null ? body : body.charAt(0).toLowerCase() + body.slice(1)}`, stayed].join(" ");
  return { description, failure: { line, column, message, sqlState, side, stayed } };
}

/** O que o aviso de sucesso diz depois do ponto, e se ele passa ao tom de atenção (algo do arquivo não entrou como estava, RN-IMPORT-020). */
export function successNotes(summary: Transfer["summary"], emptied: boolean): { notes: string[]; warning: boolean } {
  const notes: string[] = [];
  let warning = false;
  if (emptied) notes.push(t.emptied);
  if ((summary?.skippedLines ?? 0) > 0) notes.push(t.skippedLines(summary?.skippedLines ?? 0));
  if ((summary?.unguarded ?? 0) > 0) notes.push(t.unguarded(summary?.unguarded ?? 0));
  if ((summary?.shortRows ?? 0) > 0) {
    notes.push(t.shortRows(summary?.shortRows ?? 0));
    warning = true;
  }
  if ((summary?.formulasWithoutValue ?? 0) > 0) {
    notes.push(t.formulasWithoutValue(summary?.formulasWithoutValue ?? 0));
    warning = true;
  }
  return { notes, warning };
}

const networkFailure: ApiResult<Transfer> = { ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "", detail: null, errors: null, extensions: {} } };

export function createLoadTracker(deps: LoadTrackerDeps) {
  let entries: readonly TrackedLoad[] = [];
  const listeners = new Set<() => void>();
  const inFlight = new Set<string>();
  const failures = new Map<string, number>();
  /** As entradas cujo cancelamento a pessoa pediu: o fim `done` delas é o do cancelamento que chegou tarde. */
  const cancelWanted = new Set<string>();
  let unschedule: (() => void) | null = null;

  function publish(next: readonly TrackedLoad[]) {
    entries = next;
    for (const listener of listeners) listener();
    plan();
  }

  const find = (id: string) => entries.find((entry) => entry.id === id) ?? null;

  function patch(id: string, change: Partial<TrackedLoad>) {
    if (find(id) === null) return;
    publish(entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
  }

  function remove(id: string) {
    inFlight.delete(id);
    failures.delete(id);
    cancelWanted.delete(id);
    if (find(id) !== null) publish(entries.filter((entry) => entry.id !== id));
  }

  const polled = (entry: TrackedLoad) => entry.stage === "running";

  function plan() {
    if (!entries.some(polled)) {
      unschedule?.();
      unschedule = null;
      return;
    }
    if (unschedule !== null) return;
    unschedule = deps.schedule(() => {
      unschedule = null;
      tick();
      plan();
    }, loadPollMs);
  }

  function tick() {
    for (const entry of entries) {
      if (!polled(entry) || inFlight.has(entry.id)) continue;
      inFlight.add(entry.id);
      void deps
        .getTransfer(entry.id)
        .catch(() => networkFailure)
        .then((result) => onPolled(entry.id, result))
        .finally(() => inFlight.delete(entry.id));
    }
  }

  const openAction = (entry: TrackedLoad): ToastAction => ({ label: t.openRecords, run: () => deps.openRecords(entry.table) });

  /** O fim lido (o `done`, `failed` ou `canceled` da API): o aviso, a nota dos Registros e, na falha, a entrada "Ver o erro". O trabalho é esquecido. */
  async function settle(entry: TrackedLoad, transfer: Transfer) {
    const copy = entry.kind === "copy";
    const table = tableName(entry);
    const wanted = cancelWanted.has(entry.id);
    if (mayHaveWritten(entry, transfer)) deps.markImported(entry.table);
    switch (transfer.state) {
      case "done": {
        const rows = transfer.summary?.committed ?? transfer.summary?.rows ?? transfer.rows;
        // A tabela foi esvaziada antes: o resumo diz; sem ele, vale o que a pessoa pediu.
        const { notes, warning } = successNotes(transfer.summary ?? null, transfer.summary?.emptied ?? entry.empty);
        const title = wanted ? (copy ? t.lateCopy(entry.sourceName, table, rows) : t.lateImport(table, rows)) : copy ? t.copied(rows, entry.sourceName, table) : t.imported(rows, table);
        deps.notify[warning ? "warning" : "success"](title, notes.length === 0 ? undefined : notes.join(" "), openAction(entry));
        remove(entry.id);
        break;
      }
      case "failed": {
        const { description, failure } = failureDescription(entry, transfer);
        deps.notify.error(copy ? t.failedCopy(entry.sourceName, table) : t.failedImport(table), description);
        cancelWanted.delete(entry.id);
        failures.delete(entry.id);
        patch(entry.id, { stage: "failed", failure, phase: isLoadPhase(transfer.phase) ? transfer.phase : entry.phase, rows: transfer.rows, committed: transfer.committed ?? entry.committed });
        break;
      }
      case "canceled": {
        const uncertain = transfer.uncertain === true;
        const stayed = stayedText(entry, transfer);
        if (transfer.reason === "connectionDeleted") deps.notify.warning(`${copy ? t.connectionDeletedCopy(entry.sourceName, table) : t.connectionDeletedImport(table)} ${stayed}`);
        else if (transfer.reason === "readOnly") deps.notify.warning(`${copy ? t.readOnlyCopy(entry.sourceName, table) : t.readOnlyImport(table)} ${stayed}`);
        else if (uncertain) deps.notify.warning(copy ? t.canceledUncertainCopy(entry.sourceName, table) : t.canceledUncertainImport(table));
        else deps.notify.warning(`${copy ? t.canceledCopy(entry.sourceName, table) : t.canceledImport(table)} ${stayed}`);
        remove(entry.id);
        break;
      }
      case "running":
        return;
    }
    // O trabalho terminado (ou cancelado) é esquecido na API; o 404 é que ele já não existia.
    await deps.forget(entry.id).catch(() => undefined);
  }

  function onPolled(id: string, result: ApiResult<Transfer>) {
    const entry = find(id);
    if (entry === null || entry.stage !== "running") return;
    if (!result.ok) {
      // O cofre fechou (a tela vai à entrada): nada a dizer.
      if (result.error.code === "VAULT_LOCKED") return;
      if (result.error.code === "TRANSFER_NOT_FOUND") {
        // Abandonado, ou a API reiniciou: o que ficou na tabela, a tela não sabe.
        deps.markImported(entry.table);
        deps.notify.warning(entry.kind === "copy" ? t.lostCopy(entry.sourceName, tableName(entry)) : t.lostImport(tableName(entry)));
        remove(id);
        return;
      }
      const count = (failures.get(id) ?? 0) + 1;
      failures.set(id, count);
      if (count >= maxLoadPollFailures) patch(id, { stage: "lost" });
      return;
    }
    failures.delete(id);
    const transfer = result.data;
    if (transfer.state === "running") {
      patch(id, {
        phase: isLoadPhase(transfer.phase) ? transfer.phase : entry.phase,
        rows: transfer.rows,
        committed: transfer.committed ?? entry.committed,
        total: transfer.total ?? null,
        bytes: transfer.bytes,
        size: transfer.size ?? entry.size,
      });
      return;
    }
    void settle(entry, transfer);
  }

  /**
   * O cancelamento confirmado (ou que não precisava de pergunta): "Cancelando…" até o `DELETE` responder (em até 10 segundos); então a tela lê o trabalho,
   * diz o que ficou e o esquece (RN-IMPORT-019). Sem resposta da API, a entrada volta como estava, e "Cancelar" tenta de novo.
   */
  async function confirmCancel(id: string) {
    const entry = find(id);
    if (entry === null || entry.stage === "cancelling" || entry.stage === "failed") return;
    const before = entry.stage;
    cancelWanted.add(id);
    patch(id, { stage: "cancelling" });
    const result = await deps.forget(id).catch(() => null);
    const now = find(id);
    if (now === null) return;
    if (result === null || (!result.ok && result.error.code !== "TRANSFER_NOT_FOUND")) {
      cancelWanted.delete(id);
      patch(id, { stage: before });
      return;
    }
    if (!result.ok) {
      // Já não existia: não há o que ler.
      deps.markImported(now.table);
      deps.notify.warning(now.kind === "copy" ? t.lostCopy(now.sourceName, tableName(now)) : t.lostImport(tableName(now)));
      remove(id);
      return;
    }
    const final = await deps.getTransfer(id).catch(() => networkFailure);
    const after = find(id);
    if (after === null) return;
    if (!final.ok || final.data.state === "running") {
      deps.markImported(after.table);
      deps.notify.warning(after.kind === "copy" ? t.canceledUncertainCopy(after.sourceName, tableName(after)) : t.canceledUncertainImport(tableName(after)));
      remove(id);
      await deps.forget(id).catch(() => undefined);
      return;
    }
    await settle(after, final.data);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: () => entries,
    /** Uma importação ou cópia aceita pela API (o 202): entra na barra, e a consulta começa. */
    start(added: NewLoad) {
      publish([...entries, { ...added, seq: deps.sequence(), stage: "running", phase: null, rows: 0, committed: null, total: null, bytes: 0, size: null, failure: null }]);
    },
    /** A pergunta do "Cancelar", quando ela vale (`cancelQuestionOf`); sem ela, a tela chama `confirmCancel` direto. */
    cancelQuestion: (id: string) => {
      const entry = find(id);
      return entry === null ? null : cancelQuestionOf(entry);
    },
    confirmCancel,
    /** "Descartar" da entrada da falha: só da tela (o trabalho já foi esquecido na API). */
    discard: (id: string) => remove(id),
    /**
     * As saídas confirmadas (RN-IMPORT-021): o `DELETE` de cada uma que roda (o cancelamento), e o segundo, que a esquece; a entrada da falha sai sem
     * perguntar. Sem avisos: quem sai já sabe.
     */
    async cancelAll() {
      const all = entries;
      publish([]);
      await Promise.all(
        all
          .filter((entry) => entry.stage !== "failed")
          .map(async (entry) => {
            await deps.forget(entry.id).catch(() => undefined);
            await deps.forget(entry.id).catch(() => undefined);
          }),
      );
    },
    /** O cofre que fecha por outro caminho: a API já cancelou e esqueceu os trabalhos; a tela só tira as entradas, sem aviso. */
    vaultClosed() {
      publish([]);
    },
    /** RN-SEG-001 e RN-IMPORT-021: a importação e a cópia seguram o bloqueio do começo ao fim lido; a entrada da falha e a que não se sabe, não. */
    holdsLock: () => entries.some((entry) => entry.stage === "running" || entry.stage === "cancelling"),
    /** As desta janela que ainda não terminaram (a pergunta de fechar a janela), por tipo; a entrada da falha não conta. */
    counts: () => ({
      imports: entries.filter((entry) => entry.kind === "import" && entry.stage !== "failed").length,
      copies: entries.filter((entry) => entry.kind === "copy" && entry.stage !== "failed").length,
    }),
    has: (id: string) => find(id) !== null,
    /** A área de trabalho desmontou: para a consulta e esquece tudo, sem avisos. */
    reset() {
      unschedule?.();
      unschedule = null;
      inFlight.clear();
      failures.clear();
      cancelWanted.clear();
      entries = [];
      for (const listener of listeners) listener();
    },
  };
}

export type LoadTracker = ReturnType<typeof createLoadTracker>;
