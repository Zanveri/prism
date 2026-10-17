import { createReadStream, createWriteStream } from "node:fs";
import { chmod, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, parse, sep } from "node:path";
import { pipeline } from "node:stream/promises";

import { exportFileName, extensionLabels } from "./file-name";
import {
  clipboardLimitBytes,
  copyRequestSchema,
  deliverRequestSchema,
  destinationRequestSchema,
  releaseRequestSchema,
  revealRequestSchema,
  type CopyReply,
  type DeliverReply,
  type DeliveryFailureReason,
  type DestinationReply,
} from "./transfer-messages";

/**
 * O destino e a entrega de uma exportação de dados (RN-EXPORT-019 e 020), sem depender do Electron: o `main.ts` liga isto ao diálogo de salvar, à área de
 * transferência e ao gerenciador de arquivos, e os testes, a uma pasta temporária. **O processo principal é o dono do destino**: o caminho escolhido no
 * diálogo do sistema fica só aqui (a tela recebe um identificador e o nome do arquivo), e o arquivo pronto é achado na pasta `transfers` da pasta de dados
 * só pelo identificador do trabalho, conferido como um `Guid` antes de virar nome de arquivo. Nenhum caminho vem da tela, e nenhum vai a ela.
 */

export type SaveDialogFilter = { name: string; extensions: string[] };

export type TransferDeskDeps = {
  /** A pasta de dados do Prism (`PRISM_DATA_DIR`): o arquivo pronto está em `<dados>/transfers/<id>.ready`, e nenhum destino pode ficar dentro dela. */
  dataDir: string;
  /** A pasta do primeiro diálogo de salvar desta abertura do app: a de Downloads do sistema (lida na hora: o Electron a dá depois de pronto). */
  downloadsDir: () => string;
  /** No Windows e no macOS os destinos se comparam sem diferenciar maiúsculas. */
  platform: NodeJS.Platform;
  /** Abre o diálogo de salvar do sistema sobre a janela que pediu; `null` quando a pessoa desiste. */
  showSaveDialog(windowId: number, options: { defaultPath: string; filters: SaveDialogFilter[] }): Promise<string | null>;
  writeClipboard(text: string): void;
  /** Abre o gerenciador de arquivos com o arquivo escolhido (`shell.showItemInFolder`). */
  reveal(path: string): void;
  /** O log do processo principal: só identificadores e tamanhos, nunca o caminho nem o nome do arquivo (RN-LOG-001). */
  log(message: string): void;
  randomId(): string;
  /** Leva o arquivo pronto ao destino (o `rename` do Node). Os testes o trocam para simular outra unidade (`EXDEV`). */
  move?: (from: string, to: string) => Promise<void>;
  /** A cópia em fluxo entre unidades, que o `AbortSignal` interrompe. Os testes a trocam por uma que espera o cancelamento. */
  copy?: (from: string, to: string, signal: AbortSignal) => Promise<void>;
};

/**
 * Um destino escolhido e ainda não entregue. `key` é o caminho resolvido (a pasta pelo `realpath`) para comparar com os outros; `existedAtChoice` diz se o
 * arquivo já existia quando a pessoa o escolheu (o sistema perguntou antes de substituir) ou não (e então o que aparecer lá até a entrega não é substituído).
 * `fileMode` é o modo que um arquivo novo ganha naquela pasta (o da prova de gravação), que o arquivo entregue por renomeação recebe no lugar do 0600 do
 * arquivo temporário da API.
 */
type Destination = {
  id: string;
  windowId: number;
  path: string;
  key: string;
  existedAtChoice: boolean;
  fileMode: number;
  state: "chosen" | "delivering" | "failed";
  abort: AbortController | null;
  settled: Promise<void>;
};

/** O que fica de uma entrega feita, para o "Mostrar na pasta" do aviso: o arquivo que ESTE processo gravou, e a janela que pediu. */
type Delivery = { windowId: number; path: string };

const codeOf = (error: unknown): string | undefined => (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined);

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const defaultCopy = (from: string, to: string, signal: AbortSignal) => pipeline(createReadStream(from), createWriteStream(to, { flags: "wx" }), { signal });

/** As frases da entrega que falhou, sem caminho (RN-EXPORT-020): a tela as mostra depois de "<arquivo> não foi gravado: ". */
export const deliveryFailureMessages: Record<Exclude<DeliveryFailureReason, "other">, string> = {
  diskFull: "não há espaço no disco de destino",
  notWritable: "sem permissão para gravar na pasta escolhida",
  folderMissing: "a pasta escolhida não existe mais",
  inUse: "o arquivo está aberto em outro programa",
};

export function createTransferDesk(deps: TransferDeskDeps) {
  const transfersDir = join(deps.dataDir, "transfers");
  const move = deps.move ?? rename;
  const copy = deps.copy ?? defaultCopy;
  const caseless = deps.platform === "win32" || deps.platform === "darwin";
  const comparable = (path: string) => (caseless ? path.toLowerCase() : path);

  const destinations = new Map<string, Destination>();
  const deliveries = new Map<string, Delivery>();
  /** A pasta da última exportação desta abertura do app; a primeira abre em Downloads. Não vai ao disco (RN-EXPORT-019). */
  let lastFolder: string | null = null;
  /**
   * Quantas vezes os destinos de cada janela foram soltos (a página que recarregou ou caiu, a janela que fechou), e os de todas (a saída, o serviço que
   * reiniciou). O diálogo de salvar que volta depois de uma soltura é de uma página que não existe mais: o destino dele não é registrado.
   */
  const releases = new Map<number, number>();
  let releasesOfAll = 0;
  const releaseMark = (windowId: number) => `${releases.get(windowId) ?? 0}/${releasesOfAll}`;

  async function insideDataDir(realFolder: string): Promise<boolean> {
    let data: string;
    try {
      data = comparable(await realpath(deps.dataDir));
    } catch {
      data = comparable(deps.dataDir);
    }
    const folder = comparable(realFolder);
    return folder === data || folder.startsWith(data.endsWith(sep) ? data : `${data}${sep}`);
  }

  /**
   * A pasta aceita gravação? Um arquivo vazio de nome aleatório, criado e apagado: sem isso, a pessoa só saberia no fim de uma exportação longa. Responde o
   * modo com que o arquivo novo nasceu ali (o `umask` da pessoa, e o que a pasta impõe), ou `null` quando a pasta não aceita.
   */
  async function writable(folder: string): Promise<number | null> {
    const probe = join(folder, `.prism-${deps.randomId()}.tmp`);
    try {
      const handle = await open(probe, "wx");
      try {
        return (await handle.stat()).mode & 0o777;
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    } finally {
      await unlink(probe).catch(() => undefined);
    }
  }

  async function chooseDestination(windowId: number, raw: unknown): Promise<DestinationReply> {
    const { suggestedName, extension } = destinationRequestSchema.parse(raw);
    // A mesma regra de nome da tela (RN-EXPORT-014): o nome que chega é conferido de novo, e só ele vai ao diálogo.
    const name = exportFileName(suggestedName, extension);
    const filters = [
      { name: `${extensionLabels[extension]} (*.${extension})`, extensions: [extension] },
      { name: "Todos os arquivos", extensions: ["*"] },
    ];
    const mark = releaseMark(windowId);
    const chosen = await deps.showSaveDialog(windowId, { defaultPath: join(lastFolder ?? deps.downloadsDir(), name), filters });
    if (chosen === null || chosen === "") return { status: "canceled" };

    // O nome escolhido sem extensão nenhuma ganha a do formato.
    const path = extname(chosen) === "" ? `${chosen}.${extension}` : chosen;
    const folder = dirname(path);
    let realFolder: string;
    try {
      realFolder = await realpath(folder);
    } catch {
      return { status: "notWritable" };
    }
    // Dentro da pasta de dados (os cofres, as preferências, `transfers`) a exportação nunca grava.
    if (await insideDataDir(realFolder)) return { status: "notWritable" };
    const fileMode = await writable(realFolder);
    if (fileMode === null) return { status: "notWritable" };
    // O sistema perguntou antes de substituir só o nome que ele devolveu. Com a extensão posta aqui, o `nome.ext` que já existia nunca foi confirmado: conta
    // como se não existisse, e a entrega não o substitui (vai como `nome (2).ext`).
    const existedAtChoice = path === chosen && (await exists(path));

    // A conferência e o registro, sem espera entre eles: dois pedidos ao mesmo tempo não reservam o mesmo arquivo. A janela que fechou, recarregou ou caiu
    // com o diálogo aberto não registra nada: ninguém soltaria o destino dela.
    if (releaseMark(windowId) !== mark) return { status: "canceled" };
    const key = comparable(join(realFolder, basename(path)));
    if ([...destinations.values()].some((destination) => destination.key === key)) return { status: "inUse" };

    const id = deps.randomId();
    destinations.set(id, { id, windowId, path, key, existedAtChoice, fileMode, state: "chosen", abort: null, settled: Promise.resolve() });
    lastFolder = folder;
    return { status: "chosen", destinationId: id, fileName: basename(path) };
  }

  /** O arquivo que não existia ao escolher e passou a existir até a entrega não é substituído: vai como `nome (2).ext`, o primeiro livre. */
  async function finalPath(destination: Destination): Promise<string> {
    if (destination.existedAtChoice || !(await exists(destination.path))) return destination.path;

    const { dir, name, ext } = parse(destination.path);
    for (let number = 2; number < 10_000; number++) {
      const candidate = join(dir, `${name} (${number})${ext}`);
      if (!(await exists(candidate))) return candidate;
    }
    return destination.path;
  }

  /**
   * Entre unidades (ou numa pasta da rede): a cópia vai para um arquivo escondido ao lado do destino e só no fim ganha o nome final, para um arquivo pela
   * metade nunca ter o nome que a pessoa escolheu. É em fluxo, e não `copyFile`, que não se interrompe: o cancelamento e a saída param a cópia no meio.
   */
  async function copyAcross(ready: string, target: string, transferId: string, signal: AbortSignal): Promise<void> {
    const hidden = join(dirname(target), `.${basename(target)}.${transferId.slice(0, 8)}.part`);
    try {
      await copy(ready, hidden, signal);
      if (signal.aborted) throw new Error("A entrega foi interrompida.");
      await rename(hidden, target);
    } catch (error) {
      await unlink(hidden).catch(() => undefined);
      throw error;
    }
    // O pronto que não se apaga agora (no Windows, preso por outro programa) a API apaga ao esquecer o trabalho, ou na partida seguinte.
    await unlink(ready).catch(() => undefined);
  }

  function failureOf(error: unknown, targetExists: boolean): { reason: DeliveryFailureReason; message: string } {
    const code = codeOf(error);
    const known = (reason: Exclude<DeliveryFailureReason, "other">) => ({ reason, message: deliveryFailureMessages[reason] });
    if (code === "ENOSPC" || code === "EDQUOT") return known("diskFull");
    if (code === "ENOENT" || code === "ENOTDIR") return known("folderMissing");
    if (code === "EBUSY" || code === "ETXTBSY") return known("inUse");
    // No Windows, a planilha aberta no Excel prende o arquivo, e o sistema responde "sem permissão" ao substituí-lo.
    if ((code === "EPERM" || code === "EACCES") && deps.platform === "win32" && targetExists) return known("inUse");
    if (code === "EPERM" || code === "EACCES" || code === "EROFS") return known("notWritable");
    return { reason: "other", message: `o sistema recusou a gravação (${code ?? "sem código"})` };
  }

  async function deliver(windowId: number, raw: unknown): Promise<DeliverReply> {
    const { transferId, destinationId, reveal } = deliverRequestSchema.parse(raw);
    const destination = destinations.get(destinationId);
    // Solto antes (pela tela, pela janela que recarregou, pela saída): não há mais para onde entregar.
    if (destination === undefined) return { status: "canceled" };
    if (destination.windowId !== windowId) throw new Error("O destino é de outra janela.");
    if (destination.state !== "chosen") throw new Error("O destino já foi usado.");

    const ready = join(transfersDir, `${transferId}.ready`);
    if (!(await exists(ready))) {
      destinations.delete(destinationId);
      return { status: "missing" };
    }

    const abort = new AbortController();
    let settle = () => {};
    destination.state = "delivering";
    destination.abort = abort;
    destination.settled = new Promise((resolve) => (settle = resolve));
    try {
      const target = await finalPath(destination);
      const { size } = await stat(ready);
      if (abort.signal.aborted) throw new Error("A entrega foi interrompida.");
      try {
        // Na mesma unidade, renomear é instantâneo: o cancelamento que chega depois disso chega tarde, e o arquivo fica.
        await move(ready, target);
        // O renomeado guarda o 0600 do arquivo temporário da API; o copiado entre unidades nasce com o modo de um arquivo novo da pasta. Os dois ficam iguais.
        if (deps.platform !== "win32") await chmod(target, destination.fileMode).catch(() => undefined);
      } catch (error) {
        if (codeOf(error) !== "EXDEV") throw error;
        await copyAcross(ready, target, transferId, abort.signal);
      }

      destinations.delete(destinationId);
      const deliveryId = deps.randomId();
      deliveries.set(deliveryId, { windowId, path: target });
      deps.log(`exportação: trabalho ${transferId} entregue, ${size} bytes`);
      if (reveal) {
        // O arquivo já foi entregue: o gerenciador de arquivos que não abre não vira a falha da entrega.
        try {
          deps.reveal(target);
        } catch (error) {
          deps.log(`exportação: não foi possível mostrar a pasta da entrega do trabalho ${transferId}: ${codeOf(error) ?? "sem código"}`);
        }
      }
      return { status: "delivered", deliveryId, fileName: basename(target) };
    } catch (error) {
      if (abort.signal.aborted) {
        destinations.delete(destinationId);
        deps.log(`exportação: a entrega do trabalho ${transferId} foi interrompida`);
        return { status: "canceled" };
      }
      if (!(await exists(ready))) {
        destinations.delete(destinationId);
        return { status: "missing" };
      }
      // O destino continua reservado a esta exportação até a tela o soltar ("Salvar como…" ou "Descartar"); o arquivo pronto fica em `transfers`.
      destination.state = "failed";
      destination.abort = null;
      deps.log(`exportação: a entrega do trabalho ${transferId} falhou: ${codeOf(error) ?? "sem código"}`);
      return { status: "failed", ...failureOf(error, await exists(destination.path)) };
    } finally {
      settle();
    }
  }

  async function copyToClipboard(raw: unknown): Promise<CopyReply> {
    const { transferId } = copyRequestSchema.parse(raw);
    const ready = join(transfersDir, `${transferId}.ready`);
    try {
      const { size } = await stat(ready);
      if (size > clipboardLimitBytes) return { status: "tooLarge" };
      deps.writeClipboard(await readFile(ready, "utf8"));
      deps.log(`exportação: trabalho ${transferId} copiado, ${size} bytes`);
      return { status: "copied" };
    } catch (error) {
      if (codeOf(error) === "ENOENT") return { status: "missing" };
      return { status: "failed", message: `Não foi possível ler o texto exportado (${codeOf(error) ?? "sem código"}).` };
    }
  }

  /** "Mostrar na pasta": só o arquivo que este processo gravou, e só para a janela que pediu a entrega. Se ele foi movido depois, o sistema abre o que achar. */
  function reveal(windowId: number, raw: unknown): void {
    const { deliveryId } = revealRequestSchema.parse(raw);
    const delivery = deliveries.get(deliveryId);
    if (delivery === undefined) return;
    if (delivery.windowId !== windowId) throw new Error("A entrega é de outra janela.");
    deps.reveal(delivery.path);
  }

  /** Solta um destino: a entrega em andamento para (a cópia escondida é apagada) e só então a resposta vem. */
  async function drop(destination: Destination): Promise<void> {
    destinations.delete(destination.id);
    destination.abort?.abort();
    await destination.settled;
  }

  async function release(windowId: number, raw: unknown): Promise<void> {
    const { destinationId } = releaseRequestSchema.parse(raw);
    const destination = destinations.get(destinationId);
    if (destination === undefined) return;
    if (destination.windowId !== windowId) throw new Error("O destino é de outra janela.");
    await drop(destination);
  }

  /** A janela que recarrega ou cai solta os destinos dela (as entregas em andamento param). */
  async function releaseWindow(windowId: number): Promise<void> {
    releases.set(windowId, (releases.get(windowId) ?? 0) + 1);
    await Promise.all([...destinations.values()].filter((destination) => destination.windowId === windowId).map(drop));
  }

  /** A janela que fechou: os destinos dela soltos, e as entregas dela esquecidas (o "Mostrar na pasta" era dela). */
  async function windowClosed(windowId: number): Promise<void> {
    for (const [id, delivery] of deliveries) if (delivery.windowId === windowId) deliveries.delete(id);
    await releaseWindow(windowId);
  }

  /** O app que sai e o serviço que reinicia soltam todos os destinos: a entrega em andamento para, e a cópia escondida é apagada. */
  async function releaseAll(): Promise<void> {
    releasesOfAll++;
    await Promise.all([...destinations.values()].map(drop));
  }

  return { chooseDestination, deliver, copy: copyToClipboard, reveal, release, releaseWindow, windowClosed, releaseAll, transfersDir };
}

export type TransferDesk = ReturnType<typeof createTransferDesk>;
