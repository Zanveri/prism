import type { ToastAction } from "@/components/ui";
import type { ApiResult } from "@/lib/api/prism-api";

import type { ExportExtension } from "../../../../../electron/file-name";
import type { CopyReply, DeliverReply, DeliverRequest, DestinationReply, DestinationRequest } from "../../../../../electron/transfer-messages";
import { dataExportCopy } from "./data-export.copy";
import type { DataFormat } from "./export-options";
import { isExportPhase, type ExportPhase, type Transfer, type TransferSummary } from "./transfers.schema";

/**
 * As exportações desta janela, do 202 até a entrega (RN-EXPORT-020 a 022): a consulta a cada segundo, a entrega pelo processo principal quando o arquivo
 * fica pronto, a entrega que falha ("Salvar como…" e "Descartar"), o cancelamento e os avisos do fim. Um objeto fora do React (como o executor de uma aba),
 * com as peças de fora injetadas (a API, a ponte, os avisos e o relógio) e testado sem DOM: a barra de status só desenha o que ele publica.
 *
 * A exportação é da janela, e não da aba (RN-EXPORT-021): fechar a aba, trocar a conexão ou levar a aba para outra janela não a mudam. A consulta e a
 * entrega seguem com Configurações à frente, porque o objeto é da área de trabalho, que fica montada.
 */

/** Onde a exportação está, do lado da tela. `running`: o trabalho roda na API; `delivering`: o processo principal entrega; `deliveryFailed`: a entrega
 * falhou e espera "Salvar como…" ou "Descartar"; `cancelling`: o `DELETE` foi pedido; `lost`: três consultas seguidas falharam. */
export type ExportStage = "running" | "delivering" | "deliveryFailed" | "cancelling" | "lost";

export type TrackedExport = {
  id: string;
  /** A ordem em que começaram: a barra mostra a mais antiga (RN-EXPORT-021). */
  seq: number;
  /** "pedido", ou "resultado de consulta-1.sql": o nome na barra e nos avisos de erro (`progressName`). */
  name: string;
  /** O sujeito do aviso de sucesso: "Tabela pedido" (feminino), "Resultado de consulta-1.sql" (masculino). */
  subject: { subject: string; feminine: boolean };
  connectionId: string;
  format: DataFormat;
  /** Com a área de transferência não há destino nem arquivo. */
  clipboard: boolean;
  reveal: boolean;
  /** O destino escolhido no diálogo de salvar (o identificador do processo principal) e o nome do arquivo; nulos na área de transferência e depois de soltos. */
  destinationId: string | null;
  fileName: string | null;
  /** O que o "Salvar como…" pede de novo ao diálogo de salvar. */
  suggested: { suggestedName: string; extension: ExportExtension } | null;
  stage: ExportStage;
  phase: ExportPhase | null;
  rows: number;
  total: number | null;
  bytes: number;
  /** O motivo da entrega que falhou, sem caminho. */
  failure: string | null;
  /** Um pedido da pessoa em andamento sobre a entrada (o diálogo do "Salvar como…", o "Descartar"): os botões esperam. */
  busy: boolean;
};

export type NewExport = Omit<TrackedExport, "seq" | "stage" | "phase" | "rows" | "total" | "bytes" | "failure" | "busy">;

export type TrackerNotify = {
  success(title: string, description?: string, action?: ToastAction): void;
  warning(title: string, description?: string, action?: ToastAction): void;
  error(title: string, description?: string): void;
};

export type TrackerDeps = {
  getTransfer(id: string): Promise<ApiResult<Transfer>>;
  forget(id: string): Promise<ApiResult<void>>;
  deliver(request: DeliverRequest, fallback: string): Promise<DeliverReply>;
  copy(transferId: string, fallback: string): Promise<CopyReply>;
  chooseDestination(request: DestinationRequest): Promise<DestinationReply | { status: "error" }>;
  release(destinationId: string): Promise<void>;
  reveal(deliveryId: string): void;
  notify: TrackerNotify;
  /** O relógio da consulta: chama `run` daqui a `ms`, e devolve como desmarcar. */
  schedule(run: () => void, ms: number): () => void;
  /** A ordem entre as transferências da janela (as importações e as cópias também); sem ela, a ordem é só entre as exportações. */
  sequence?: () => number;
};

/** A consulta a cada segundo, como a instalação de um driver (RN-EXPORT-021). */
export const pollEveryMs = 1000;

/** Três falhas seguidas da consulta param a consulta da entrada (RN-EXPORT-021). */
export const maxPollFailures = 3;

const st = dataExportCopy.status;
const t = dataExportCopy.toasts;

/** O tamanho como o do arquivo no "Importar conexões" (RN-TRANSF-009): `14 KB`, `3,4 MB`, `1,2 GB`; 1 KB são 1.024 bytes. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 })} ${units[unit]}`;
}

/** O que a entrada da barra diz (RN-EXPORT-021): o texto, a dica com o texto inteiro, e a barra de progresso (`percent` nulo é a barra sem medida). */
export type EntryView = { text: string; hint: string; percent: number | null; busy: boolean };

/** O texto da entrada pela fase: conectando, contando, a porcentagem (no máximo 99% até o fim) ou as linhas sem o total, terminando, gravando. */
export function entryView(entry: TrackedExport): EntryView {
  const busy = entry.stage === "cancelling" || entry.busy;
  const plain = (text: string): EntryView => ({ text, hint: text, percent: null, busy });
  switch (entry.stage) {
    case "cancelling":
      return plain(st.cancelling);
    case "lost":
      return plain(st.lost);
    case "deliveryFailed":
      return plain(st.deliveryFailed(entry.fileName ?? entry.name, entry.failure ?? st.deliveryError));
    case "delivering":
      return plain(entry.fileName === null ? st.finishing(entry.name) : st.delivering(entry.fileName));
    case "running":
      break;
  }

  const size = formatFileSize(entry.bytes);
  switch (entry.phase) {
    case null:
    case "connecting":
      return plain(st.connecting(entry.name));
    case "counting":
      return plain(st.counting(entry.name));
    case "finishing":
      return plain(st.finishing(entry.name));
    case "reading": {
      // Com mais linhas que o total (outra sessão inseriu no meio, no Db2 e no Informix), o texto passa ao de sem total.
      if (entry.total !== null && entry.total > 0 && entry.rows <= entry.total) {
        const percent = Math.min(99, Math.floor((entry.rows / entry.total) * 100));
        return { text: `${st.exporting(entry.name)} ${st.percent(percent)}`, hint: st.ofTotal(entry.rows, entry.total, size), percent, busy };
      }
      const text = `${st.exporting(entry.name)} ${st.rowsAndBytes(entry.rows, size)}`;
      return { text, hint: text, percent: null, busy };
    }
  }
}

/** A entrada que a barra mostra (RN-EXPORT-021): a que pede ação (a entrega que falhou, a mais antiga delas); sem nenhuma, a mais antiga. */
export function featuredExport(entries: readonly TrackedExport[]): TrackedExport | null {
  const failed = entries.filter((entry) => entry.stage === "deliveryFailed");
  const pool = failed.length > 0 ? failed : entries;
  return pool.reduce<TrackedExport | null>((oldest, entry) => (oldest === null || entry.seq < oldest.seq ? entry : oldest), null);
}

/** O resumo que vai no aviso de sucesso, depois do ponto, e se ele passa ao tom de atenção (algo do dado não saiu inteiro, RN-EXPORT-022). */
export function summaryNotes(format: DataFormat, summary: TransferSummary | null): { notes: string[]; warning: boolean } {
  if (summary === null) return { notes: [], warning: false };
  const notes: string[] = [];
  let warning = false;
  if ((summary.sheets ?? 0) > 1) notes.push(t.sheets(summary.sheets ?? 0));
  if ((summary.cutValues ?? 0) > 0) {
    notes.push(format === "txt" ? t.cutTxt(summary.cutValues ?? 0) : t.cutXlsx(summary.cutValues ?? 0));
    warning = true;
  }
  if ((summary.removedCharacters ?? 0) > 0) {
    notes.push(t.removed(summary.removedCharacters ?? 0));
    warning = true;
  }
  if ((summary.skippedRows ?? 0) > 0) {
    notes.push(t.skipped(summary.skippedRows ?? 0));
    warning = true;
  }
  return { notes, warning };
}

/** A mensagem do trabalho que falhou: a do banco como veio, com o SQLSTATE, ou a frase da API (RN-EXPORT-017 e 018). */
const errorDescription = (error: Transfer["error"]) => (error === null || error === undefined ? undefined : error.sqlState === null || error.sqlState === undefined ? error.message : `${error.message} (${t.sqlState(error.sqlState)})`);

export function createTransferTracker(deps: TrackerDeps) {
  let entries: readonly TrackedExport[] = [];
  let seq = 0;
  const listeners = new Set<() => void>();
  const inFlight = new Set<string>();
  const failures = new Map<string, number>();
  /** As entradas cujo cancelamento a pessoa pediu durante a entrega: a resposta da entrega decide o aviso. */
  const cancelWanted = new Set<string>();
  /** O trabalho pronto (`done`) de cada entrada, com o resumo: o "Salvar como…" entrega de novo com ele. */
  const done = new Map<string, Transfer>();
  let unschedule: (() => void) | null = null;

  function publish(next: readonly TrackedExport[]) {
    entries = next;
    for (const listener of listeners) listener();
    plan();
  }

  const find = (id: string) => entries.find((entry) => entry.id === id) ?? null;

  function patch(id: string, change: Partial<TrackedExport>) {
    if (find(id) === null) return;
    publish(entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
  }

  function remove(id: string) {
    inFlight.delete(id);
    failures.delete(id);
    cancelWanted.delete(id);
    done.delete(id);
    if (find(id) !== null) publish(entries.filter((entry) => entry.id !== id));
  }

  /** As entradas que a consulta mantém vivas: a API dá como abandonado o trabalho que ninguém consulta, também durante a entrega e a entrega que falhou. */
  const polled = (entry: TrackedExport) => entry.stage === "running" || entry.stage === "delivering" || entry.stage === "deliveryFailed";

  function plan() {
    // Sem nada a consultar, o relógio para (e volta com a próxima exportação).
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
    }, pollEveryMs);
  }

  /** Esquece o trabalho na API (o arquivo que sobrou é apagado). O 404 depois da entrega não é erro: o arquivo já está no destino. */
  async function forget(id: string) {
    await deps.forget(id).catch(() => undefined);
  }

  async function releaseOf(entry: TrackedExport) {
    if (entry.destinationId !== null) await deps.release(entry.destinationId).catch(() => undefined);
  }

  /** O fim que não entregou nada: solta o destino, esquece o trabalho e tira a entrada. */
  async function finish(entry: TrackedExport) {
    remove(entry.id);
    await releaseOf(entry);
    await forget(entry.id);
  }

  function tick() {
    for (const entry of entries) {
      if (!polled(entry) || inFlight.has(entry.id)) continue;
      inFlight.add(entry.id);
      void deps
        .getTransfer(entry.id)
        .then((result) => onPolled(entry.id, result))
        .catch(() => onPolled(entry.id, { ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "", detail: null, errors: null, extensions: {} } }))
        .finally(() => inFlight.delete(entry.id));
    }
  }

  function onPolled(id: string, result: ApiResult<Transfer>) {
    const entry = find(id);
    if (entry === null) return;

    if (!result.ok) {
      // O cofre fechou (o login vem em seguida, e a área de trabalho desmonta): nada a dizer. O cancelamento pedido decide pela resposta dele.
      if (result.error.code === "VAULT_LOCKED" || entry.stage === "cancelling") return;
      if (result.error.code === "TRANSFER_NOT_FOUND") {
        // A entrega em andamento decide pela resposta dela; o resto se perdeu (abandonado, a API que reiniciou).
        if (entry.stage === "delivering") return;
        deps.notify.error(t.lost(entry.name));
        void finish(entry);
        return;
      }
      const count = (failures.get(id) ?? 0) + 1;
      failures.set(id, count);
      if (count >= maxPollFailures && entry.stage === "running") patch(id, { stage: "lost" });
      return;
    }
    failures.delete(id);

    const transfer = result.data;
    if (entry.stage !== "running") return;
    switch (transfer.state) {
      case "running":
        patch(id, { phase: isExportPhase(transfer.phase) ? transfer.phase : entry.phase, rows: transfer.rows, total: transfer.total ?? null, bytes: transfer.bytes });
        return;
      case "done":
        done.set(id, transfer);
        patch(id, { stage: "delivering", rows: transfer.summary?.rows ?? transfer.rows, bytes: transfer.bytes });
        void deliver(id, transfer);
        return;
      case "failed":
        deps.notify.error(t.failed(entry.name), errorDescription(transfer.error));
        void finish(entry);
        return;
      case "canceled":
        // O cancelado pela pessoa já foi dito por quem cancelou (nesta janela, `cancel`); o da conexão excluída, aqui (RN-EXPORT-022).
        if (transfer.reason === "connectionDeleted") deps.notify.warning(t.connectionDeleted(entry.name));
        void finish(entry);
        return;
    }
  }

  /** O sucesso, com o resumo e, no arquivo, o "Mostrar na pasta" (RN-EXPORT-022). */
  function succeed(entry: TrackedExport, transfer: Transfer, title: string, action?: ToastAction) {
    const { notes, warning } = summaryNotes(entry.format, transfer.summary ?? null);
    deps.notify[warning ? "warning" : "success"](title, notes.length === 0 ? undefined : notes.join(" "), action);
  }

  async function deliver(id: string, transfer: Transfer) {
    const entry = find(id);
    if (entry === null) return;
    const rows = transfer.summary?.rows ?? transfer.rows;

    if (entry.clipboard) {
      const reply = await deps.copy(id, t.clipboardFailed);
      const now = find(id);
      if (now === null) return;
      if (reply.status === "copied") succeed(now, transfer, t.copied(now.subject.subject, now.subject.feminine, rows, dataExportCopy.formats.names[now.format]));
      else if (reply.status === "tooLarge") deps.notify.error(t.failed(now.name), t.clipboardTooLarge);
      else if (reply.status === "missing") deps.notify.error(t.lost(now.name));
      else deps.notify.error(t.failed(now.name), reply.message);
      remove(id);
      await forget(id);
      return;
    }

    if (entry.destinationId === null) {
      // Sem destino (solto no meio): nada a entregar.
      await finish(entry);
      return;
    }
    const reply = await deps.deliver({ transferId: id, destinationId: entry.destinationId, reveal: entry.reveal }, st.deliveryError);
    const now = find(id);
    if (now === null) return;
    const wanted = cancelWanted.has(id);
    switch (reply.status) {
      case "delivered": {
        // Na mesma unidade a entrega é instantânea: o cancelamento que chegou depois chegou tarde, e o arquivo fica (RN-EXPORT-020).
        const deliveryId = reply.deliveryId;
        succeed(now, transfer, t.exported(now.subject.subject, now.subject.feminine, rows, reply.fileName), { label: t.reveal, run: () => deps.reveal(deliveryId) });
        remove(id);
        await forget(id);
        return;
      }
      case "canceled":
        if (wanted) deps.notify.warning(t.canceled(now.name));
        remove(id);
        await forget(id);
        return;
      case "missing":
        if (!wanted) deps.notify.error(t.lost(now.name));
        await finish(now);
        return;
      case "failed": {
        if (wanted) {
          deps.notify.warning(t.canceled(now.name));
          await finish(now);
          return;
        }
        const reason = reply.reason === "other" ? reply.message : st.reasons[reply.reason];
        patch(id, { stage: "deliveryFailed", failure: reason });
        return;
      }
    }
  }

  /** "Cancelar": sem perguntar, o `DELETE` e o destino solto; "Cancelando…" até a resposta, e então o aviso de atenção (RN-EXPORT-021). */
  async function cancel(id: string) {
    const entry = find(id);
    if (entry === null || entry.stage === "cancelling") return;

    if (entry.stage === "delivering") {
      // A entrega em andamento para (o processo principal apaga a cópia escondida), e a resposta dela diz o que aconteceu.
      cancelWanted.add(id);
      patch(id, { stage: "cancelling" });
      if (entry.destinationId !== null) await deps.release(entry.destinationId).catch(() => undefined);
      return;
    }

    const before = entry.stage;
    patch(id, { stage: "cancelling" });
    await releaseOf(entry);
    const result = await deps.forget(id).catch(() => null);
    if (result !== null && (result.ok || result.error.code === "TRANSFER_NOT_FOUND")) {
      remove(id);
      deps.notify.warning(t.canceled(entry.name));
      return;
    }
    // Sem resposta da API: a entrada volta como estava (o destino já foi solto), e "Cancelar" tenta de novo.
    patch(id, { stage: before === "running" ? "lost" : before, destinationId: null });
  }

  /** "Salvar como…" da entrega que falhou: solta o destino que falhou, abre o diálogo de salvar de novo e entrega no novo (RN-EXPORT-019 e 020). */
  async function saveAs(id: string) {
    const entry = find(id);
    if (entry === null || entry.stage !== "deliveryFailed" || entry.busy || entry.suggested === null) return;
    patch(id, { busy: true });
    await releaseOf(entry);
    patch(id, { destinationId: null });
    const reply = await deps.chooseDestination(entry.suggested);
    const now = find(id);
    if (now === null) return;
    if (reply.status !== "chosen") {
      // Desistir deixa a entrada como estava, com "Salvar como…" e "Descartar".
      if (reply.status === "notWritable") deps.notify.error(dataExportCopy.confirmation.notWritable);
      else if (reply.status === "inUse") deps.notify.error(dataExportCopy.confirmation.inUse);
      else if (reply.status === "error") deps.notify.error(dataExportCopy.confirmation.destinationFailed);
      patch(id, { busy: false });
      return;
    }
    patch(id, { busy: false, stage: "delivering", destinationId: reply.destinationId, fileName: reply.fileName, failure: null });
    // O trabalho continua pronto na API (a consulta o manteve vivo): entrega de novo, com o resumo de quando ficou pronto.
    const transfer = done.get(id);
    if (transfer !== undefined) await deliver(id, transfer);
  }

  /** "Descartar" da entrega que falhou: esquece a exportação (o arquivo pronto é apagado na API) e solta o destino. */
  async function discard(id: string) {
    const entry = find(id);
    if (entry === null || entry.busy) return;
    await finish(entry);
  }

  /** As saídas confirmadas (RN-EXPORT-023): o `DELETE` de cada uma e os destinos soltos, e só então a saída segue. Sem avisos. */
  async function cancelAll() {
    const all = entries;
    for (const entry of all) cancelWanted.add(entry.id);
    publish([]);
    await Promise.all(all.map(async (entry) => {
      await releaseOf(entry);
      await forget(entry.id);
    }));
  }

  /**
   * O cofre que fecha por outro caminho (o bloqueio por inatividade, que descarta as entregas que falharam; o cofre fechado por outra janela): a API já
   * cancelou e esqueceu os trabalhos, e a tela só solta os destinos (o que interrompe a entrega em andamento) e tira as entradas, sem aviso.
   */
  async function vaultClosed() {
    const all = entries;
    publish([]);
    await Promise.all(all.map(releaseOf));
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: () => entries,
    /** Uma exportação aceita pela API (o 202): entra na barra, e a consulta começa. */
    start(added: NewExport) {
      publish([...entries, { ...added, seq: deps.sequence?.() ?? ++seq, stage: "running", phase: null, rows: 0, total: null, bytes: 0, failure: null, busy: false }]);
    },
    cancel,
    saveAs,
    discard,
    cancelAll,
    vaultClosed,
    /** RN-SEG-001 e RN-EXPORT-023: a exportação segura o bloqueio do começo até a entrega; a entrega que falhou e a que não se sabe como está, não. */
    holdsLock: () => entries.some((entry) => entry.stage === "running" || entry.stage === "delivering" || entry.stage === "cancelling"),
    /** As entregas que falharam, que o bloqueio descarta (o aviso de antes dele diz quantas). */
    failedDeliveries: () => entries.filter((entry) => entry.stage === "deliveryFailed").length,
    /** As exportações começadas nesta janela que ainda não terminaram (a pergunta de fechar a janela). */
    count: () => entries.length,
    /** Os trabalhos que esta janela acompanha: a limpeza das que caíram não os cancela. */
    has: (id: string) => find(id) !== null,
    /**
     * A área de trabalho desmontou (o cofre fechou, outro usuário vai entrar): para a consulta, solta os destinos e esquece tudo, sem avisos. A resposta que
     * ainda chegar de antes não acha a entrada e não faz nada; a próxima entrada começa do zero.
     */
    reset() {
      unschedule?.();
      unschedule = null;
      const all = entries;
      inFlight.clear();
      failures.clear();
      cancelWanted.clear();
      done.clear();
      entries = [];
      for (const listener of listeners) listener();
      void Promise.all(all.map(releaseOf));
    },
  };
}

export type TransferTracker = ReturnType<typeof createTransferTracker>;
