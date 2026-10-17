import { randomBytes } from "node:crypto";
import { mkdir, open, rename, stat, statfs, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { maxImportBytes, sourceRequestSchema, type SourceFailureReason, type SourceReply, type SourceStatus } from "./transfer-messages";

/**
 * O arquivo de uma importação de dados (RN-IMPORT-017 e 018), sem depender do Electron: o `main.ts` liga isto ao diálogo de abrir do sistema, e os testes, a
 * uma pasta temporária. **O processo principal é o dono do caminho**: o arquivo que a pessoa escolhe é lido só aqui, conferido e copiado para a pasta
 * `transfers` da pasta de dados com um nome tirado só de um identificador aleatório (`<fileId>.in`, e `<fileId>.in.part` enquanto copia). A tela recebe o
 * identificador, o nome do arquivo sem a pasta e o tamanho; a API lê a cópia pelo identificador. Nenhum caminho vem da tela, e nenhum vai a ela.
 */

export type OpenDialogFilter = { name: string; extensions: string[] };

export type TransferSourceDeps = {
  /** A pasta de dados do Prism (`PRISM_DATA_DIR`): a cópia vai para `<dados>/transfers/<fileId>.in`. */
  dataDir: string;
  /** A pasta do primeiro diálogo de abrir desta abertura do app: a de Downloads do sistema (lida na hora: o Electron a dá depois de pronto). */
  downloadsDir: () => string;
  /** Abre o diálogo de abrir do sistema sobre a janela que pediu, com o título e os filtros daqui; `null` quando a pessoa desiste. */
  showOpenDialog(windowId: number, options: { title: string; defaultPath: string; filters: OpenDialogFilter[] }): Promise<string | null>;
  /** O log do processo principal: só o identificador, o tamanho e a duração, nunca o nome nem o caminho do arquivo (RN-LOG-001). */
  log(message: string): void;
  /** Um identificador novo, na forma de um da API (36 caracteres, em minúsculas, com os hifens). */
  randomId(): string;
  now(): number;
  /** O espaço livre da pasta, em bytes (o `statfs`); `null` quando o sistema não diz. Os testes o trocam para simular o disco cheio. */
  freeSpace?: (folder: string) => Promise<number | null>;
  /** A cópia em fluxo, que o `AbortSignal` interrompe. Os testes a trocam por uma que espera o cancelamento ou falha no meio. */
  copy?: (from: string, to: string, signal: AbortSignal, progress: (copied: number) => void) => Promise<void>;
};

/** O título e os filtros do diálogo de abrir (RN-IMPORT-018), escritos aqui: nada da tela vai ao diálogo. */
export const sourceDialogTitle = "Importar dados";

export const sourceDialogFilters: OpenDialogFilter[] = [
  { name: "Arquivos de dados (*.csv, *.tsv, *.tab, *.txt, *.json, *.xlsx, *.xlsm)", extensions: ["csv", "tsv", "tab", "txt", "json", "xlsx", "xlsm"] },
  { name: "CSV e TSV (*.csv, *.tsv, *.tab, *.txt)", extensions: ["csv", "tsv", "tab", "txt"] },
  { name: "JSON (*.json)", extensions: ["json"] },
  { name: "Excel (*.xlsx, *.xlsm)", extensions: ["xlsx", "xlsm"] },
  { name: "Todos os arquivos", extensions: ["*"] },
];

/** A folga além do tamanho do arquivo que a pasta de dados precisa ter livre para a cópia começar (RN-IMPORT-018). */
export const spareBytes = 64 * 1024 * 1024;

const codeOf = (error: unknown): string | undefined => (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined);

/**
 * A frase do motivo de não ler o arquivo, escolhida pelo código do sistema, e nunca pelo texto dele, que traz o caminho (RN-IMPORT-018). É a mesma ao escolher
 * (`unreadable`) e na cópia que falha no meio.
 */
export function unreadableReason(code: string | undefined): string {
  switch (code) {
    case "EACCES":
    case "EPERM":
      return "o sistema não dá permissão para ler o arquivo";
    case "EBUSY":
      return "o arquivo está em uso por outro programa";
    case "ENOENT":
      return "o arquivo não existe mais";
    case "EIO":
      return "o disco deu erro de leitura";
    default:
      return `erro ${code ?? "sem código"}`;
  }
}

/** As frases da cópia que falhou (RN-IMPORT-018), inteiras, sem caminho: a tela as mostra no campo do arquivo. */
export function copyFailureMessage(reason: SourceFailureReason, code: string | undefined): string {
  switch (reason) {
    case "diskFull":
      return "Não há espaço na pasta de dados do Prism para copiar o arquivo.";
    case "tooLarge":
      return "O arquivo passou de 2 GB durante a cópia.";
    case "unreadable":
      return `Não foi possível ler o arquivo: ${unreadableReason(code)}.`;
    case "other":
      return `Não foi possível copiar o arquivo (${code ?? "sem código"}).`;
  }
}

/** O erro de um dos lados da cópia: a leitura do arquivo da pessoa, a gravação na pasta de dados ou o arquivo que passou de 2 GiB no meio. */
export class SideError extends Error {
  constructor(
    readonly side: "read" | "write" | "size",
    readonly code: string | undefined,
  ) {
    super(`A cópia falhou (${side}).`);
  }
}

/**
 * A cópia de verdade: o arquivo aberto só para leitura, a cópia criada com `wx` e o modo 0600 (o `umask` só pode apertar), em fluxo pelo `stream.pipeline` com
 * o `AbortSignal`, contando os bytes e parando ao passar de 2 GiB (o arquivo que cresceu no meio), e gravada no disco (`flush`, o `fsync` antes de fechar). O
 * erro diz de que lado foi, para a frase. O teto (`maxBytes`) é o da importação; os testes passam um pequeno, para a parada no meio correr na cópia de verdade.
 */
export async function defaultCopy(from: string, to: string, signal: AbortSignal, progress: (copied: number) => void, maxBytes = maxImportBytes): Promise<void> {
  let source;
  try {
    source = await open(from, "r");
  } catch (error) {
    throw new SideError("read", codeOf(error));
  }
  let target;
  try {
    target = await open(to, "wx", 0o600);
  } catch (error) {
    await source.close().catch(() => undefined);
    throw new SideError("write", codeOf(error));
  }

  const reader = source.createReadStream({ highWaterMark: 1024 * 1024 });
  const writer = target.createWriteStream({ flush: true });
  let failure: SideError | null = null;
  reader.once("error", (error) => (failure ??= new SideError("read", codeOf(error))));
  writer.once("error", (error) => (failure ??= new SideError("write", codeOf(error))));
  let copied = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      copied += chunk.length;
      if (copied > maxBytes) {
        failure ??= new SideError("size", undefined);
        done(failure);
        return;
      }
      progress(copied);
      done(null, chunk);
    },
  });
  try {
    await pipeline(reader, counter, writer, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw failure ?? new SideError("write", codeOf(error));
  } finally {
    // O `pipeline` fecha os dois quando termina ou falha; fechar de novo não faz nada.
    await source.close().catch(() => undefined);
    await target.close().catch(() => undefined);
  }
}

async function defaultFreeSpace(folder: string): Promise<number | null> {
  try {
    const stats = await statfs(folder);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

/** Um arquivo escolhido por uma janela: a cópia em andamento, pronta ou que falhou. `settled` resolve quando a cópia parou, de qualquer jeito. */
type Source = {
  fileId: string;
  windowId: number;
  size: number;
  copied: number;
  state: "copying" | "ready" | "failed";
  failure: { reason: SourceFailureReason; message: string } | null;
  abort: AbortController;
  settled: Promise<void>;
};

export function createTransferSource(deps: TransferSourceDeps) {
  const transfersDir = join(deps.dataDir, "transfers");
  const copy = deps.copy ?? defaultCopy;
  const freeSpace = deps.freeSpace ?? defaultFreeSpace;
  const sources = new Map<string, Source>();
  /** A pasta da última importação desta abertura do app; a primeira abre em Downloads. Não vai ao disco. */
  let lastFolder: string | null = null;
  /** Como no destino da exportação: o diálogo que volta depois de a janela ser solta (recarregou, caiu, fechou) é de uma página que não existe mais. */
  const releases = new Map<number, number>();
  let releasesOfAll = 0;
  const releaseMark = (windowId: number) => `${releases.get(windowId) ?? 0}/${releasesOfAll}`;

  const partOf = (fileId: string) => join(transfersDir, `${fileId}.in.part`);
  const readyOf = (fileId: string) => join(transfersDir, `${fileId}.in`);

  /**
   * A pasta de dados aceita gravação? A pasta `transfers` é criada quando falta (alguém a apagou com o app aberto), com o modo 0700, que o `umask` só pode
   * apertar; a que já existe com outro modo, quem acerta é a partida da API. Então um arquivo vazio de nome aleatório é criado e apagado nela.
   */
  async function writable(): Promise<boolean> {
    try {
      await mkdir(transfersDir, { recursive: true, mode: 0o700 });
    } catch {
      return false;
    }
    const probe = join(transfersDir, `.prism-${randomBytes(8).toString("hex")}.tmp`);
    try {
      const handle = await open(probe, "wx", 0o600);
      await handle.close();
      return true;
    } catch {
      return false;
    } finally {
      await unlink(probe).catch(() => undefined);
    }
  }

  /** Apaga a cópia pela metade e a pronta que ainda estiverem lá (a que a API já tomou tem outro nome, e não é achada). */
  async function removeFiles(fileId: string): Promise<void> {
    await unlink(partOf(fileId)).catch(() => undefined);
    await unlink(readyOf(fileId)).catch(() => undefined);
  }

  function startCopy(source: Source, path: string): void {
    const started = deps.now();
    source.settled = (async () => {
      try {
        await copy(path, partOf(source.fileId), source.abort.signal, (copied) => (source.copied = copied));
        if (source.abort.signal.aborted) throw new Error("A cópia foi interrompida.");
        await rename(partOf(source.fileId), readyOf(source.fileId));
        source.state = "ready";
        deps.log(`importação: arquivo ${source.fileId} copiado, ${source.copied} bytes, em ${deps.now() - started} ms`);
      } catch (error) {
        await unlink(partOf(source.fileId)).catch(() => undefined);
        if (source.abort.signal.aborted) {
          deps.log(`importação: a cópia do arquivo ${source.fileId} foi interrompida`);
          return;
        }
        const side = error instanceof SideError ? error : new SideError("write", codeOf(error));
        const reason: SourceFailureReason =
          side.side === "size" ? "tooLarge" : side.side === "read" ? "unreadable" : side.code === "ENOSPC" || side.code === "EDQUOT" ? "diskFull" : "other";
        source.state = "failed";
        source.failure = { reason, message: copyFailureMessage(reason, side.code) };
        deps.log(`importação: a cópia do arquivo ${source.fileId} falhou: ${reason} (${side.code ?? "sem código"})`);
      }
    })();
  }

  /**
   * `prism:transfer-source`: o diálogo de abrir sobre a janela que pediu, e as conferências antes de responder, nesta ordem: um arquivo comum (seguindo o
   * atalho: não uma pasta, um FIFO, que prenderia a cópia, ou um dispositivo), até 2 GiB, que o sistema deixa ler (aberto só para leitura e fechado de novo), a
   * pasta de dados que aceita gravação e o espaço livre nela para o arquivo e mais 64 MiB. Passou, responde `chosen` e começa a cópia em segundo plano.
   */
  async function choose(windowId: number): Promise<SourceReply> {
    const mark = releaseMark(windowId);
    const chosen = await deps.showOpenDialog(windowId, { title: sourceDialogTitle, defaultPath: lastFolder ?? deps.downloadsDir(), filters: sourceDialogFilters });
    if (chosen === null || chosen === "") return { status: "canceled" };
    lastFolder = dirname(chosen);

    let size: number;
    try {
      const stats = await stat(chosen);
      if (!stats.isFile()) return { status: "notAFile" };
      size = stats.size;
    } catch (error) {
      return { status: "unreadable", message: unreadableReason(codeOf(error)) };
    }
    if (size > maxImportBytes) return { status: "tooLarge", size };
    try {
      const handle = await open(chosen, "r");
      await handle.close();
    } catch (error) {
      return { status: "unreadable", message: unreadableReason(codeOf(error)) };
    }
    if (!(await writable())) return { status: "notWritable" };
    const needed = size + spareBytes;
    const free = await freeSpace(transfersDir);
    if (free !== null && free < needed) return { status: "noSpace", needed };

    // A janela que recarregou, caiu ou fechou com o diálogo aberto não registra nada: ninguém soltaria o arquivo dela.
    if (releaseMark(windowId) !== mark) return { status: "canceled" };
    const fileId = deps.randomId();
    const source: Source = { fileId, windowId, size, copied: 0, state: "copying", failure: null, abort: new AbortController(), settled: Promise.resolve() };
    sources.set(fileId, source);
    startCopy(source, chosen);
    return { status: "chosen", fileId, fileName: basename(chosen), size };
  }

  /** O arquivo é da janela que o escolheu: o de outra janela, ou o `fileId` que não se conhece, não existe para quem pergunta. */
  function own(windowId: number, raw: unknown): Source | null {
    const { fileId } = sourceRequestSchema.parse(raw);
    const source = sources.get(fileId);
    return source === undefined || source.windowId !== windowId ? null : source;
  }

  /** `prism:transfer-source-status`: a tela consulta a cada 250 ms enquanto a cópia anda. */
  function status(windowId: number, raw: unknown): SourceStatus {
    const source = own(windowId, raw);
    if (source === null) return { status: "missing" };
    switch (source.state) {
      case "copying":
        return { status: "copying", copied: source.copied, size: source.size };
      case "ready":
        return { status: "ready" };
      case "failed":
        return { status: "failed", reason: source.failure?.reason ?? "other", message: source.failure?.message ?? copyFailureMessage("other", undefined) };
    }
  }

  /**
   * Interrompe a cópia, espera ela parar, apaga o `.in.part` e o `.in` que ainda estiverem lá e esquece o arquivo. Cancelar durante a troca de nome do fim não
   * deixa nada: ou a troca não aconteceu e o `.part` é apagado, ou aconteceu e o `.in` é apagado.
   */
  async function drop(source: Source): Promise<void> {
    sources.delete(source.fileId);
    source.abort.abort();
    await source.settled;
    await removeFiles(source.fileId);
  }

  /** `prism:transfer-source-release`: o assistente fechou sem importar, trocou de arquivo, o bloqueio, as saídas. */
  async function release(windowId: number, raw: unknown): Promise<void> {
    const source = own(windowId, raw);
    if (source !== null) await drop(source);
  }

  /** A janela que recarrega, cai ou fecha solta os arquivos dela. */
  async function releaseWindow(windowId: number): Promise<void> {
    releases.set(windowId, (releases.get(windowId) ?? 0) + 1);
    await Promise.all([...sources.values()].filter((source) => source.windowId === windowId).map(drop));
  }

  /** O app que sai e o serviço que reinicia soltam todos os arquivos (a API nova apagaria a pasta `transfers` na partida). */
  async function releaseAll(): Promise<void> {
    releasesOfAll++;
    await Promise.all([...sources.values()].map(drop));
  }

  return { choose, status, release, releaseWindow, releaseAll, transfersDir };
}

export type TransferSource = ReturnType<typeof createTransferSource>;
