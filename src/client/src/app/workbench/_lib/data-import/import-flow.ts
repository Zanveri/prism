import type { ApiResult } from "@/lib/api/prism-api";

import type { SourceReply, SourceStatus } from "../../../../../electron/transfer-messages";
import type { WizardRefusal } from "../data-export/export-wizard";
import { dataImportCopy } from "./data-import.copy";
import type { ImportChoices } from "./import-choices";
import { formatOfName, noRowsProblem, sourceRefusal } from "./import-file";
import { commitProblem } from "./import-load";
import { carryTargets, chooseTarget, movedText, noneMappedProblem, targetsOf, type Targets } from "./import-mapping";
import { importRequestBytes, maxImportRequestBytes, previewRequest, readerForRead, readRequest, startRequest, type ImportPlace } from "./import-request";
import { importRefusalsOf, importSteps, nextImportStep, previewRefusalOf, readerProblems, stepOfImportField, type ImportStep } from "./import-wizard";
import type { DetectedEncoding, ImportFormat, ImportPreview, ImportPreviewRequest, ImportRead, ImportReadRequest, ImportStartRequest, ImportValues } from "./imports.schema";

/**
 * O assistente "Importar dados" (RN-IMPORT-002 a 013) fora do React, como o acompanhamento das exportações: o arquivo escolhido e a cópia dele, a leitura e a
 * prévia do arquivo, o mapeamento e a prévia convertida, a carga, a confirmação e o "Importar". As peças de fora (a ponte, as rotas, o relógio) vêm
 * injetadas, e a tela só desenha o que ele publica (`snapshot`) e chama as ações. Os pedidos da leitura e da prévia vão um de cada vez: a mudança feita
 * durante um deles espera o fim dele e refaz uma vez, com as últimas escolhas (RN-IMPORT-007 e 011).
 */

/** O arquivo fora do diálogo do sistema: nenhum (com a frase da escolha que não deu), a cópia em andamento, pronto, ou a cópia que falhou. */
export type SettledSource =
  | { status: "none"; problem: string | null }
  | { status: "copying"; fileId: string; fileName: string; size: number; copied: number }
  | { status: "ready"; fileId: string; fileName: string; size: number }
  | { status: "failed"; fileName: string; message: string };

/**
 * O arquivo, do lado da tela: o de fora do diálogo, ou o diálogo aberto, com o arquivo de antes (`before`), que ainda é do assistente: volta se a pessoa
 * desistir, e é solto se o assistente fechar com o diálogo aberto (o bloqueio, o "Sair" de outra janela) ou se outro for escolhido (RN-IMPORT-002 e 003).
 */
export type FileSource = SettledSource | { status: "choosing"; before: SettledSource };

export type ReadState =
  | { status: "idle" }
  | { status: "reading"; previous: ImportRead | null }
  | { status: "done"; read: ImportRead }
  /** A recusa da leitura, no lugar da prévia (`field` quando é de um campo que o assistente desenha). */
  | { status: "refused"; message: string; field: string | null }
  /** A chamada que falhou sem recusa (a API fora do ar): o aviso central já disse; a etapa oferece "Tentar de novo". */
  | { status: "failed" };

export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; previous: ImportPreview | null; auto: boolean }
  | { status: "done"; preview: ImportPreview }
  /** A recusa da tabela, ou a chamada que falhou sem recusa (a API fora do ar, com "Tentar de novo"; o aviso central já disse o resto). */
  | { status: "refused"; message: string; retry: boolean; driverID?: string; previous: ImportPreview | null };

export type ImportFlowState = {
  /** A tabela de destino, já escolhida pela entrada (RN-IMPORT-001). */
  place: ImportPlace;
  step: ImportStep;
  source: FileSource;
  format: ImportFormat;
  choices: ImportChoices;
  /** A planilha escolhida no XLSX: nula até a primeira leitura, que diz qual leu (a primeira que não é oculta). */
  sheet: string | null;
  read: ReadState;
  /** A codificação que a leitura automática achou neste arquivo: as leituras seguintes a mandam, sem percorrer o arquivo de novo. */
  detectedEncoding: DetectedEncoding | null;
  /** O mapeamento, uma escolha por coluna do arquivo; nulo até a primeira prévia (que traz o automático). */
  targets: (string | null)[] | null;
  /** As colunas do arquivo a que o mapeamento se refere. */
  targetsColumns: readonly string[] | null;
  preview: PreviewState;
  /** A prévia convertida ficou para trás (outra leitura, outros formatos dos valores) e é pedida de novo ao entrar no Mapeamento. */
  previewStale: boolean;
  /** "total deixou de receber Total (R$).", com papel de estado. */
  moved: string | null;
  empty: boolean;
  understood: boolean;
  starting: boolean;
  refusals: readonly WizardRefusal[];
};

/** O que vai ao acompanhamento quando a API aceita a importação (o 202). */
export type StartedImport = {
  id: string;
  fileName: string;
  format: ImportFormat;
  sheet: string | null;
  place: ImportPlace;
  oneAtATime: boolean;
  empty: boolean;
  single: boolean;
  choices: ImportChoices;
};

export type ImportFlowDeps = {
  place: ImportPlace;
  initialChoices: ImportChoices;
  /** Há processo principal para escolher e copiar o arquivo? Fora do Electron, "Escolher arquivo…" diz que importar só funciona no app. */
  available(): boolean;
  choose(): Promise<SourceReply | { status: "error" }>;
  status(fileId: string): Promise<SourceStatus>;
  release(fileId: string): Promise<void>;
  /** As rotas, já com as recusas que o assistente mostra devolvidas como valor; as outras lançam (e foram ao aviso central). */
  read(request: ImportReadRequest): Promise<ApiResult<ImportRead>>;
  preview(request: ImportPreviewRequest): Promise<ApiResult<ImportPreview>>;
  start(request: ImportStartRequest): Promise<ApiResult<{ id: string }>>;
  windowId(): number | null;
  schedule(run: () => void, ms: number): () => void;
  onStarted(started: StartedImport): void;
};

/** A cópia do arquivo é consultada a cada 250 ms (RN-IMPORT-018). */
export const copyPollMs = 250;

const f = dataImportCopy.file;

/** O "um pedido de cada vez": o pedido durante outro espera o fim dele e refaz uma vez, com o que valer então. */
function serial(run: () => Promise<void>, alive: () => boolean): () => void {
  let running = false;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      try {
        do {
          again = false;
          await run();
        } while (again && alive());
      } finally {
        running = false;
      }
    })();
  };
}

const delimitedOf = (state: Pick<ImportFlowState, "format" | "choices">) => (state.format === "csv" ? state.choices.csv : state.format === "tsv" ? state.choices.tsv : null);

/** O mapeamento vai pelo nome com cabeçalho e no JSON, e pela posição sem cabeçalho (RN-IMPORT-009 e 011). */
export function mapsByName(state: Pick<ImportFlowState, "format" | "choices">): boolean {
  if (state.format === "json") return true;
  if (state.format === "xlsx") return state.choices.xlsx.header;
  return (delimitedOf(state) ?? { header: true }).header;
}

/** A recusa que segura cada etapa ("Avançar" desabilitado, com o motivo à vista), ou `null`. */
export function importStepProblem(state: ImportFlowState, step: ImportStep): string | null {
  switch (step) {
    case "file": {
      const source = state.source;
      if (source.status === "none") return source.problem ?? f.chooseFirst;
      if (source.status === "choosing") return f.chooseFirst;
      if (source.status === "copying") return f.waitCopy;
      if (source.status === "failed") return source.message;
      const fieldProblem = Object.values(readerProblems(state.format, delimitedOf(state)))[0];
      if (fieldProblem !== undefined) return fieldProblem;
      switch (state.read.status) {
        case "idle":
        case "reading":
          return dataImportCopy.preview.reading;
        case "refused":
          return state.read.message;
        case "failed":
          return dataImportCopy.preview.reading;
        case "done":
          return noRowsProblem(state.read.read);
      }
      return null;
    }
    case "mapping": {
      const preview = state.preview;
      if (preview.status === "refused") return preview.message;
      return mappingProgress(state) ?? noneMappedProblem(state.targets ?? []);
    }
    case "load": {
      const table = state.preview.status === "done" ? state.preview.preview.table : null;
      return commitProblem(state.choices.load, table?.oneAtATime ?? false);
    }
    case "confirmation":
      return state.empty && !state.understood ? dataImportCopy.confirmation.understandFirst : null;
  }
}

/**
 * O que o Mapeamento espera, para a linha de estado da etapa (com papel de estado, e não no tom de erro): "Lendo as colunas de estoque.pedido…" até a
 * primeira prévia, e "Atualizando a prévia…" enquanto uma mudança do mapeamento a refaz. Nulo quando não espera nada.
 */
export function mappingProgress(state: Pick<ImportFlowState, "place" | "preview" | "targets">): string | null {
  const preview = state.preview;
  if (preview.status === "refused") return null;
  const loading = dataImportCopy.mapping.loading(state.place.schema, state.place.table);
  if (preview.status === "idle" || state.targets === null) return loading;
  if (preview.status === "loading") return preview.previous === null ? loading : dataImportCopy.mapping.refreshing;
  return null;
}

/** O arquivo que o assistente segura agora: o do campo, ou, com o diálogo aberto, o de antes dele. */
export function heldSource(source: FileSource): SettledSource {
  return source.status === "choosing" ? source.before : source;
}

/** A tabela que a prévia leu, quando há (a de agora, ou a de antes, durante a atualização). */
export function previewTable(state: Pick<ImportFlowState, "preview">) {
  const preview = state.preview;
  if (preview.status === "done") return preview.preview.table;
  if (preview.status === "loading" || preview.status === "refused") return preview.previous?.table ?? null;
  return null;
}

/** A prévia convertida que está na tela (a de agora, ou a de antes, esmaecida, durante a atualização). */
export function shownPreview(state: Pick<ImportFlowState, "preview">): ImportPreview | null {
  const preview = state.preview;
  if (preview.status === "done") return preview.preview;
  if (preview.status === "loading" || preview.status === "refused") return preview.previous;
  return null;
}

/** A leitura que está na tela (a de agora, ou a de antes, durante a leitura nova). */
export function shownRead(state: Pick<ImportFlowState, "read">): ImportRead | null {
  return state.read.status === "done" ? state.read.read : state.read.status === "reading" ? state.read.previous : null;
}

export function createImportFlow(deps: ImportFlowDeps) {
  let state: ImportFlowState = {
    place: deps.place,
    step: "file",
    source: { status: "none", problem: null },
    format: "csv",
    choices: deps.initialChoices,
    sheet: null,
    read: { status: "idle" },
    detectedEncoding: null,
    targets: null,
    targetsColumns: null,
    preview: { status: "idle" },
    previewStale: true,
    moved: null,
    empty: false,
    understood: false,
    starting: false,
    refusals: [],
  };
  const listeners = new Set<() => void>();
  let closed = false;
  let started = false;
  /** Sobe a cada arquivo novo (ou solto): a resposta de um pedido do arquivo de antes não muda nada. */
  let fileGeneration = 0;
  /** Sobe a cada leitura nova: a prévia pedida sobre a leitura de antes não muda nada. */
  let readGeneration = 0;
  /** "Mapear pelo nome": o pedido seguinte da prévia vai sem mapeamento, e a resposta traz o automático. */
  let wantAuto = false;
  let unpoll: (() => void) | null = null;

  function set(change: Partial<ImportFlowState>) {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  }

  const alive = () => !closed;

  // A leitura do arquivo (RN-IMPORT-007), refeita a cada mudança de uma opção do leitor.
  const triggerRead = serial(async () => {
    const source = state.source;
    if (source.status !== "ready") return;
    if (Object.keys(readerProblems(state.format, delimitedOf(state))).length > 0) return;
    const generation = fileGeneration;
    const format = state.format;
    const reader = readerForRead(format, state.choices, { sheet: state.sheet, detectedEncoding: state.detectedEncoding });
    set({ read: { status: "reading", previous: shownRead(state) } });
    let result: ApiResult<ImportRead>;
    try {
      result = await deps.read(readRequest(source.fileId, format, reader));
    } catch {
      if (alive() && generation === fileGeneration) set({ read: { status: "failed" } });
      return;
    }
    if (!alive() || generation !== fileGeneration) return;
    if (!result.ok) {
      if (result.error.code === "IMPORT_FILE_MISSING") return lostFile();
      const refusal = importRefusalsOf(result.error)[0];
      const field = refusal?.field ?? null;
      set({ read: { status: "refused", message: refusal?.message ?? result.error.title, field } });
      return;
    }
    const read = result.data;
    readGeneration++;
    const autoEncoding = "encoding" in reader && reader.encoding === "auto";
    const byName = mapsByName(state);
    set({
      read: { status: "done", read },
      detectedEncoding: autoEncoding && read.encoding !== null && read.encoding !== undefined ? read.encoding.name : state.detectedEncoding,
      sheet: format === "xlsx" ? (read.sheet ?? state.sheet) : state.sheet,
      targets: state.targets === null || state.targetsColumns === null ? state.targets : carryTargets(state.targetsColumns, read.columns, state.targets, byName),
      targetsColumns: state.targets === null ? state.targetsColumns : read.columns,
      previewStale: true,
    });
  }, alive);

  // A prévia convertida (RN-IMPORT-009 a 011), pedida ao entrar no Mapeamento e refeita a cada mudança do mapeamento.
  const triggerPreview = serial(async () => {
    const source = state.source;
    if (source.status !== "ready" || state.read.status !== "done") return;
    const read = state.read.read;
    const auto = state.targets === null || wantAuto;
    // Sem nenhuma coluna mapeada não há o que converter: o mapeamento vazio não vai (a API pede ao menos uma).
    if (!auto && state.targets !== null && state.targets.every((target) => target === null)) {
      set({ previewStale: false });
      return;
    }
    wantAuto = false;
    const generation = readGeneration;
    const fileAt = fileGeneration;
    const previous = shownPreview(state);
    set({ preview: { status: "loading", previous, auto }, previewStale: false });
    let result: ApiResult<ImportPreview>;
    try {
      result = await deps.preview(previewRequest(source.fileId, state.format, state.choices, read, deps.place, auto ? null : state.targets));
    } catch {
      // A chamada que falhou sem recusa (a API fora do ar, o 500): o aviso central já disse; a etapa diz que não leu e oferece "Tentar de novo" (RN-IMPORT-009).
      const message = previous === null ? dataImportCopy.mapping.loadFailed(deps.place.schema, deps.place.table) : dataImportCopy.mapping.refreshFailed;
      if (alive() && generation === readGeneration && fileAt === fileGeneration) set({ preview: { status: "refused", message, retry: true, previous } });
      return;
    }
    if (!alive() || generation !== readGeneration || fileAt !== fileGeneration) return;
    if (!result.ok) {
      if (result.error.code === "IMPORT_FILE_MISSING") return lostFile();
      const refusal = previewRefusalOf(result.error, deps.place);
      set({ preview: { status: "refused", message: refusal.message, retry: refusal.retry, ...(refusal.driverID === undefined ? {} : { driverID: refusal.driverID }), previous } });
      return;
    }
    const preview = result.data;
    set({
      preview: { status: "done", preview },
      ...(auto ? { targets: targetsOf(preview.mapping, read.columns.length), targetsColumns: read.columns, moved: null } : {}),
    });
  }, alive);

  function stopPolling() {
    unpoll?.();
    unpoll = null;
  }

  /** O arquivo que sumiu (a API que reiniciou, a pasta limpa): o assistente volta ao Arquivo e pede o arquivo de novo (RN-IMPORT-013). */
  function lostFile() {
    stopPolling();
    const source = heldSource(state.source);
    if (source.status === "copying" || source.status === "ready") void deps.release(source.fileId);
    fileGeneration++;
    const missing: SettledSource = { status: "none", problem: f.missing };
    // Com o diálogo aberto, o que volta se a pessoa desistir dele é o arquivo que sumiu.
    set({ ...blankReading(), source: state.source.status === "choosing" ? { status: "choosing", before: missing } : missing, step: "file", starting: false });
  }

  const blankReading = (): Partial<ImportFlowState> => ({ read: { status: "idle" }, detectedEncoding: null, sheet: null, targets: null, targetsColumns: null, preview: { status: "idle" }, previewStale: true, moved: null, refusals: [] });

  function poll(fileId: string) {
    stopPolling();
    unpoll = deps.schedule(() => {
      unpoll = null;
      void deps.status(fileId).then((reply) => {
        const source = state.source;
        if (!alive() || source.status !== "copying" || source.fileId !== fileId) return;
        switch (reply.status) {
          case "copying":
            set({ source: { ...source, copied: reply.copied, size: reply.size } });
            poll(fileId);
            return;
          case "ready":
            set({ source: { status: "ready", fileId, fileName: source.fileName, size: source.size } });
            triggerRead();
            return;
          case "failed":
            fileGeneration++;
            void deps.release(fileId);
            set({ source: { status: "failed", fileName: source.fileName, message: reply.message } });
            return;
          case "missing":
            fileGeneration++;
            set({ source: { status: "none", problem: f.missing } });
            return;
        }
      });
    }, copyPollMs);
  }

  /** "Escolher arquivo…" e "Trocar arquivo…" (RN-IMPORT-003): o diálogo do processo principal; escolhido outro, o de antes é solto e tudo recomeça. */
  async function chooseFile() {
    if (closed || state.starting || state.source.status === "choosing") return;
    if (!deps.available()) {
      set({ source: { status: "none", problem: f.outsideElectron } });
      return;
    }
    set({ source: { status: "choosing", before: state.source } });
    const reply = await deps.choose();
    // O arquivo fechado com o diálogo aberto já soltou o de antes (`close`); o escolhido depois disso é solto na chegada.
    if (closed) {
      if (reply.status === "chosen") void deps.release(reply.fileId);
      return;
    }
    // O de antes, como está agora (a leitura dele pode ter dito, com o diálogo aberto, que ele sumiu).
    const before = heldSource(state.source);
    // Desistir do diálogo deixa tudo como estava (e a cópia de antes, que a consulta deixou de olhar com o diálogo aberto, volta a ser consultada).
    if (reply.status === "canceled") {
      set({ source: before });
      if (before.status === "copying") poll(before.fileId);
      return;
    }
    stopPolling();
    if (before.status === "copying" || before.status === "ready") void deps.release(before.fileId);
    fileGeneration++;
    if (reply.status !== "chosen") {
      set({ ...blankReading(), source: { status: "none", problem: sourceRefusal(reply) }, step: "file" });
      return;
    }
    set({
      ...blankReading(),
      source: { status: "copying", fileId: reply.fileId, fileName: reply.fileName, size: reply.size, copied: 0 },
      format: formatOfName(reply.fileName),
      step: "file",
    });
    poll(reply.fileId);
  }

  /** "Cancelar" a cópia: o arquivo é solto, e o campo volta a "Escolher arquivo…". */
  function cancelCopy() {
    const source = state.source;
    if (source.status !== "copying") return;
    stopPolling();
    fileGeneration++;
    void deps.release(source.fileId);
    set({ ...blankReading(), source: { status: "none", problem: null } });
  }

  /** Toda mudança nas escolhas tira as recusas que vieram da API: elas eram do pedido de antes. */
  function changeReader(change: Partial<Pick<ImportFlowState, "format" | "choices" | "sheet">>) {
    set({ ...change, refusals: [] });
    triggerRead();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: () => state,
    chooseFile,
    cancelCopy,
    setFormat(format: ImportFormat) {
      if (format !== state.format) changeReader({ format, sheet: null });
    },
    setCsv(change: Partial<ImportChoices["csv"]>) {
      changeReader({ choices: { ...state.choices, csv: { ...state.choices.csv, ...change } } });
    },
    setTsv(change: Partial<ImportChoices["tsv"]>) {
      changeReader({ choices: { ...state.choices, tsv: { ...state.choices.tsv, ...change } } });
    },
    setXlsx(change: Partial<ImportChoices["xlsx"]>) {
      changeReader({ choices: { ...state.choices, xlsx: { ...state.choices.xlsx, ...change } } });
    },
    setSheet(sheet: string) {
      if (sheet !== state.sheet) changeReader({ sheet });
    },
    /** Os formatos dos valores não mudam a leitura (ela é antes de qualquer conversão), só a prévia convertida. */
    setValues(change: Partial<ImportValues>) {
      const values = { ...state.choices.values, ...change };
      set({ choices: { ...state.choices, values: values.decimal === "point" ? { ...values, thousandsDot: false } : values }, previewStale: true, refusals: [] });
    },
    retryRead: () => triggerRead(),
    /** "Avançar": só sem recusa na etapa; o Mapeamento pede a prévia, e a Confirmação desmarca a caixa do esvaziamento a cada abertura. */
    advance() {
      if (importStepProblem(state, state.step) !== null) return;
      const next = nextImportStep(state.step);
      if (next === null) return;
      set({ step: next, ...(next === "confirmation" ? { understood: false } : {}) });
      if (next === "mapping" && (state.previewStale || state.preview.status === "idle" || (state.preview.status === "refused" && state.preview.retry))) triggerPreview();
    },
    goTo(step: ImportStep) {
      if (importSteps.indexOf(step) >= importSteps.indexOf(state.step) || state.starting) return;
      set({ step });
    },
    setTarget(source: number, target: string | null) {
      if (state.targets === null || (state.preview.status === "loading" && state.preview.auto)) return;
      const { targets, moved } = chooseTarget(state.targets, source, target);
      set({ targets, moved: moved === null ? null : movedText(moved, state.targetsColumns ?? []), refusals: [] });
      triggerPreview();
    },
    mapByName() {
      wantAuto = true;
      set({ moved: null, refusals: [] });
      triggerPreview();
    },
    mapNone() {
      if (state.targets === null) return;
      set({ targets: state.targets.map(() => null), moved: null, refusals: [] });
    },
    retryPreview: () => triggerPreview(),
    setEmpty(empty: boolean) {
      set({ empty, understood: false, refusals: [] });
    },
    setLoad(change: Partial<ImportChoices["load"]>) {
      set({ choices: { ...state.choices, load: { ...state.choices.load, ...change } }, refusals: [] });
    },
    setUnderstood(understood: boolean) {
      set({ understood });
    },
    /**
     * "Importar", depois da pergunta da RN-PROT-001 (quem pergunta é a tela): o tamanho do corpo e o `POST`. Aceito (202), o arquivo passa a ser do trabalho
     * e não é solto; as recusas ficam no assistente, na etapa e no campo de cada uma, e o arquivo que sumiu leva de volta ao Arquivo.
     */
    async submit(): Promise<void> {
      if (state.starting || importStepProblem(state, "confirmation") !== null) return;
      const source = state.source;
      const read = state.read.status === "done" ? state.read.read : null;
      const table = previewTable(state);
      if (source.status !== "ready" || read === null || table === null || state.targets === null) return;
      const windowId = deps.windowId();
      if (windowId === null) {
        set({ refusals: [{ field: null, message: dataImportCopy.confirmation.outsideElectron }] });
        return;
      }
      const body = startRequest(source.fileId, state.format, state.choices, read, deps.place, state.targets, state.empty, windowId);
      if (importRequestBytes(body) > maxImportRequestBytes) {
        set({ refusals: [{ field: null, message: dataImportCopy.confirmation.tooLarge }] });
        return;
      }
      set({ starting: true, refusals: [] });
      let result: ApiResult<{ id: string }>;
      try {
        result = await deps.start(body);
      } catch {
        // A falha que não é recusa já foi ao aviso central; o assistente fica como estava.
        set({ starting: false });
        return;
      }
      if (!result.ok) {
        if (result.error.code === "IMPORT_FILE_MISSING") return lostFile();
        const refusals = importRefusalsOf(result.error);
        set({ starting: false, refusals, step: stepOfImportField(refusals[0]?.field ?? null) });
        return;
      }
      started = true;
      set({ starting: false });
      deps.onStarted({
        id: result.data.id,
        fileName: source.fileName,
        format: state.format,
        sheet: state.format === "xlsx" ? (read.sheet ?? state.sheet) : null,
        place: deps.place,
        oneAtATime: table.oneAtATime,
        empty: state.empty,
        single: state.choices.load.commit === "single",
        choices: state.choices,
      });
    },
    /** Cancelar, Esc, o X, o bloqueio e as saídas: o diálogo fecha e o arquivo é solto (a cópia em andamento para), a não ser que a API já o tenha tomado. */
    close() {
      if (closed) return;
      closed = true;
      stopPolling();
      // Também com o diálogo de "Trocar arquivo…" aberto: o arquivo de antes ainda é do assistente.
      const source = heldSource(state.source);
      if (!started && (source.status === "copying" || source.status === "ready")) void deps.release(source.fileId);
    },
    /** O mapeamento de agora, para o resumo, os avisos e o comando do aviso de confirmação. */
    targets: (): Targets => state.targets ?? [],
  };
}

export type ImportFlow = ReturnType<typeof createImportFlow>;
