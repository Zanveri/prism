import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, rename, rm, statfs, unlink } from "node:fs/promises";
import { basename, dirname, join, posix, win32 } from "node:path";

import { dbeaverLimits, dbeaverReleaseRequestSchema, dbeaverSourceRequestSchema, type DbeaverSourceReply, type DbeaverWhere } from "./dbeaver-messages";
import { unreadableReason } from "./transfer-source";

/**
 * A procura e a cópia do DBeaver (RN-DBEAVER-004 a 006), sem depender do Electron: o `main.ts` liga isto ao diálogo de pasta do sistema, e os testes, a pastas
 * temporárias. **O processo principal é o dono de todo caminho**: a pasta do DBeaver é achada nos lugares de sempre ou escolhida pela pessoa, e só os arquivos
 * esperados da `.dbeaver` de cada projeto são copiados para `transfers/<sourceId>.dbeaver/`, com um nome tirado só de um identificador aleatório. A tela recebe o
 * identificador, onde o DBeaver estava e quantos projetos foram copiados; a API lê a cópia pelo identificador (e decifra as senhas: este processo não lê o
 * conteúdo dos arquivos, só os copia). Nenhum caminho vem da tela, e nenhum vai a ela, ao log ou à API.
 */

export type DbeaverSourceDeps = {
  /** A pasta de dados do Prism (`PRISM_DATA_DIR`): a cópia vai para `<dados>/transfers/<sourceId>.dbeaver`. */
  dataDir: string;
  platform: NodeJS.Platform;
  /** As variáveis de ambiente (`DBEAVER_DATA` e, no Windows, `APPDATA`). */
  env: Readonly<Record<string, string | undefined>>;
  /** A pasta pessoal do usuário do sistema. Os testes passam uma falsa. */
  home: string;
  /** Abre o diálogo de pasta do sistema sobre a janela que pediu (uma pasta só, com os arquivos ocultos à vista); `null` quando a pessoa desiste. */
  showOpenDialog(windowId: number, options: { title: string; defaultPath: string }): Promise<string | null>;
  /** O log do processo principal: só o identificador, o `where`, as contagens e a duração, nunca um caminho nem um nome (RN-LOG-001). */
  log(message: string): void;
  /** Um identificador novo, na forma de um da API (36 caracteres, em minúsculas, com os hifens). */
  randomId(): string;
  now(): number;
  /** O espaço livre da pasta, em bytes; `null` quando o sistema não diz. Os testes o trocam para simular o disco cheio. */
  freeSpace?: (folder: string) => Promise<number | null>;
  /** Roda antes de cada arquivo ser aberto para a cópia. Só os testes o usam, para trocar o arquivo entre o `lstat` e a abertura. */
  beforeOpen?: (path: string) => Promise<void> | void;
};

/** O título do diálogo de pasta (RN-DBEAVER-005), escrito aqui: nada da tela vai ao diálogo. */
export const dbeaverDialogTitle = "Escolher a pasta do DBeaver";

/** A frase do atalho recusado (RN-DBEAVER-006), inteira. */
export const symlinkMessage = "O DBeaver guarda esta pasta por um atalho (link simbólico), e o Prism não segue atalhos. Escolha a pasta de verdade.";

/** A frase de um arquivo ilegível (RN-DBEAVER-006), com o motivo da RN-IMPORT-018. */
export const unreadableMessage = (reason: string) => `Não foi possível ler os arquivos do DBeaver: ${reason}.`;

/** Uma pasta de dados do DBeaver a procurar (RN-DBEAVER-004). `legacy`: a antiga do Linux, que só vale quando a de sempre não existe. */
export type DbeaverRoot = { where: DbeaverWhere; dir: string; legacy?: boolean };

/**
 * As pastas de dados do DBeaver, na ordem de RN-DBEAVER-004 (como o `RuntimeUtils` e o launcher dele a calculam): com `DBEAVER_DATA`, só
 * `$DBEAVER_DATA/DBeaverData`; no Windows, `%APPDATA%\DBeaverData`; no macOS, `~/Library/DBeaverData`; no Linux, o do Flatpak, o do Snap e o de sempre.
 */
export function dbeaverRoots({ platform, env, home }: Pick<DbeaverSourceDeps, "platform" | "env" | "home">): DbeaverRoot[] {
  const path = platform === "win32" ? win32 : posix;
  const data = env.DBEAVER_DATA;
  if (data !== undefined && data !== "") return [{ where: "env", dir: path.join(data, "DBeaverData") }];

  if (platform === "win32") {
    const appData = env.APPDATA;
    return [{ where: "standard", dir: path.join(appData !== undefined && appData !== "" ? appData : home, "DBeaverData") }];
  }
  if (platform === "darwin") return [{ where: "standard", dir: path.join(home, "Library", "DBeaverData") }];

  return [
    { where: "flatpak", dir: path.join(home, ".var", "app", "io.dbeaver.DBeaverCommunity", "data", "DBeaverData") },
    { where: "snap", dir: path.join(home, "snap", "dbeaver-ce", "current", ".local", "share", "DBeaverData") },
    { where: "standard", dir: path.join(home, ".local", "share", "DBeaverData") },
    { where: "standard", dir: path.join(home, ".local", "share", ".DBeaverData"), legacy: true },
  ];
}

/** O nome de um arquivo de conexões da `.dbeaver` (`data-sources.json` ou `data-sources-<sufixo>.json`); o sufixo tem de 1 a 64 caracteres de `[A-Za-z0-9._-]`. */
const dataSourcesName = /^data-sources(-[A-Za-z0-9._-]{1,64})?\.json$/;

/** Os cinco arquivos que se copiam (RN-DBEAVER-006); nenhum outro. */
const copiedName = /^(data-sources|credentials-config)(-[A-Za-z0-9._-]{1,64})?\.json$|^project-settings\.json$/;

const codeOf = (error: unknown): string | undefined => (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined);

/** Um arquivo a copiar, com o que o `lstat` viu dele: a abertura confere o mesmo dispositivo e o mesmo `inode` (a troca no meio do caminho não leva a outro). */
type FileRef = { name: string; size: number; dev: bigint; ino: bigint };

type Project = { name: string; dir: string; files: FileRef[]; newest: number };

/** O que a leitura de uma pasta de projeto achou: `null` quando não é um projeto, `symlink` quando é, mas por um atalho (a cópia inteira é recusada). */
type Scanned = Project | "symlink" | null;

type Located = { where: DbeaverWhere; projects: Project[] };

/** O que o `locate` e o `choose` devolvem antes da cópia: o que achou, ou a resposta pronta da recusa. */
type Search = { found: Located } | { reply: DbeaverSourceReply };

/** Uma recusa que a cópia traduz na resposta (`tooLarge`, `notWritable`, `noSpace`, `unreadable`). */
class CopyRefusal extends Error {
  constructor(readonly reply: Exclude<DbeaverSourceReply, { status: "found" } | { status: "canceled" } | { status: "notFound" } | { status: "notDbeaver" }>) {
    super("A cópia foi recusada.");
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

/**
 * Os nomes de uma pasta, no máximo `limit` (RN-DBEAVER-004): `null` quando ela não abre, `tooMany` quando passa do limite. Só lista, com chamadas assíncronas.
 */
async function listNames(dir: string, limit: number): Promise<string[] | "tooMany" | null> {
  let handle;
  try {
    handle = await opendir(dir);
  } catch {
    return null;
  }
  const names: string[] = [];
  try {
    for await (const entry of handle) {
      if (names.length >= limit) return "tooMany";
      names.push(entry.name);
    }
  } catch {
    return null;
  } finally {
    // O `for await` já fecha ao terminar ou ao sair; fechar de novo não faz nada.
    await handle.close().catch(() => undefined);
  }
  return names;
}

/**
 * O projeto de uma pasta (RN-DBEAVER-004): tem `.dbeaver/data-sources.json` ou ao menos um `.dbeaver/data-sources-*.json`. Os arquivos que se copiam saem
 * daqui, com o tamanho e a identidade de cada um; o atalho (a `.dbeaver` ou um dos arquivos) faz do projeto um `symlink`, que recusa a cópia (RN-DBEAVER-006).
 */
async function scanProject(dir: string, name: string): Promise<Scanned> {
  const dbeaver = join(dir, ".dbeaver");
  let info;
  try {
    info = await lstat(dbeaver);
  } catch {
    return null;
  }
  if (!info.isDirectory() && !info.isSymbolicLink()) return null;

  const names = await listNames(dbeaver, dbeaverLimits.entries);
  if (names === null || names === "tooMany" || !names.some((candidate) => dataSourcesName.test(candidate))) return null;
  if (info.isSymbolicLink()) return "symlink";

  const files: FileRef[] = [];
  let newest = 0;
  for (const candidate of names.filter((entry) => copiedName.test(entry)).sort()) {
    let stats;
    try {
      stats = await lstat(join(dbeaver, candidate), { bigint: true });
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) return "symlink";
    if (!stats.isFile()) continue;
    files.push({ name: candidate, size: Number(stats.size), dev: stats.dev, ino: stats.ino });
    if (dataSourcesName.test(candidate)) newest = Math.max(newest, Number(stats.mtimeMs));
  }
  return { name, dir: dbeaver, files, newest };
}

/** Os projetos de um workspace (RN-DBEAVER-004): cada subpasta direta que o é, sem as que começam por ponto; `General` primeiro, e os outros pela ordem dos nomes. */
async function scanWorkspace(workspace: string): Promise<{ projects: Project[]; symlinked: boolean } | "tooMany" | null> {
  const names = await listNames(workspace, dbeaverLimits.entries);
  if (names === null || names === "tooMany") return names;

  const projects: Project[] = [];
  let symlinked = false;
  for (const name of names.filter((entry) => !entry.startsWith(".")).sort()) {
    const dir = join(workspace, name);
    let info;
    try {
      info = await lstat(dir);
    } catch {
      continue;
    }
    // O atalho na pasta do workspace só conta se for de um projeto (não se segue: lê-se o nome dos arquivos de fora da `.dbeaver`, nada mais).
    if (!info.isDirectory() && !info.isSymbolicLink()) continue;
    const scanned = await scanProject(dir, name);
    if (scanned === null) continue;
    if (scanned === "symlink" || info.isSymbolicLink()) symlinked = true;
    else projects.push(scanned);
  }
  projects.sort((a, b) => (a.name === "General" ? -1 : b.name === "General" ? 1 : 0));
  return { projects, symlinked };
}

export function createDbeaverSource(deps: DbeaverSourceDeps) {
  const transfersDir = join(deps.dataDir, "transfers");
  const freeSpace = deps.freeSpace ?? defaultFreeSpace;
  /** As cópias vivas, com a janela dona de cada uma (RN-DBEAVER-006: no máximo uma por janela). */
  const copies = new Map<string, number>();
  /** O pedido mais novo de cada janela: o que termina depois de outro ter começado já não vale, e apaga a cópia que fez. */
  const operations = new Map<number, number>();
  /** Como no destino da exportação: a janela solta (recarregou, caiu, fechou) com o diálogo ou a cópia em andamento não registra nada. */
  const releases = new Map<number, number>();
  let releasesOfAll = 0;
  const releaseMark = (windowId: number) => `${releases.get(windowId) ?? 0}/${releasesOfAll}`;

  const partOf = (sourceId: string) => join(transfersDir, `${sourceId}.dbeaver.part`);
  const readyOf = (sourceId: string) => join(transfersDir, `${sourceId}.dbeaver`);

  /** A pasta `transfers` aceita gravação? Criada quando falta, com o modo 0700; um arquivo vazio de nome aleatório é criado e apagado nela (como a RN-IMPORT-018). */
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

  async function removeCopy(sourceId: string): Promise<void> {
    await rm(partOf(sourceId), { recursive: true, force: true }).catch(() => undefined);
    await rm(readyOf(sourceId), { recursive: true, force: true }).catch(() => undefined);
  }

  /** A pasta de dados escolhida em primeiro lugar pelo diálogo: a primeira dos lugares de sempre que existe, ou a pasta pessoal (RN-DBEAVER-005). */
  async function dialogStart(): Promise<string> {
    for (const root of dbeaverRoots(deps)) {
      try {
        await lstat(root.dir);
        return root.dir;
      } catch {
        // Não existe: a seguinte.
      }
    }
    return deps.home;
  }

  /** O workspace de uma pasta de dados: `workspace6` resolvido (`realpath`) uma vez, com seus projetos. */
  async function workspaceOf(dataFolder: string): Promise<Awaited<ReturnType<typeof scanWorkspace>>> {
    let workspace;
    try {
      workspace = await realpath(join(dataFolder, "workspace6"));
    } catch {
      return null;
    }
    return scanWorkspace(workspace);
  }

  /**
   * A procura nos lugares de sempre (RN-DBEAVER-004): cada pasta de dados é resolvida uma vez (`realpath`, que atravessa o `current` do Snap), e vale a que tem
   * o `data-sources*.json` alterado por último. A antiga do Linux só entra quando a de sempre não existe.
   */
  async function locate(): Promise<Search> {
    const roots = dbeaverRoots(deps);
    let standardExists = false;
    let best: { where: DbeaverWhere; projects: Project[]; newest: number; symlinked: boolean } | null = null;
    for (const root of roots) {
      if (root.legacy === true && standardExists) continue;
      let real;
      try {
        real = await realpath(root.dir);
      } catch {
        continue;
      }
      if (root.where === "standard" && root.legacy !== true) standardExists = true;

      const scanned = await workspaceOf(real);
      if (scanned === null || scanned === "tooMany") continue;
      if (scanned.projects.length === 0 && !scanned.symlinked) continue;
      const newest = Math.max(0, ...scanned.projects.map((project) => project.newest));
      if (best === null || newest > best.newest) best = { where: root.where, projects: scanned.projects, newest, symlinked: scanned.symlinked };
    }
    if (best === null) return { reply: { status: "notFound" } };
    if (best.symlinked) return { reply: { status: "unreadable", message: symlinkMessage } };
    return { found: { where: best.where, projects: best.projects } };
  }

  /**
   * O que a pessoa escolheu (RN-DBEAVER-005), pelo que tem dentro: a pasta de dados (com `workspace6`), um workspace (com projetos), um projeto (com a
   * `.dbeaver`) ou a própria `.dbeaver`. O atalho escolhido é resolvido antes (`realpath`).
   */
  async function shapeOf(chosen: string): Promise<Search> {
    let real;
    try {
      real = await realpath(chosen);
    } catch (error) {
      return { reply: { status: "unreadable", message: unreadableMessage(unreadableReason(codeOf(error))) } };
    }
    const projectName = basename(chosen) || basename(real);

    // A pasta de dados (o workspace dentro dela) e depois o próprio workspace: a primeira que tem projetos vale. Passar de 1.000 entradas não é do DBeaver.
    for (const look of [() => workspaceOf(real), () => scanWorkspace(real)]) {
      const scanned = await look();
      if (scanned === "tooMany") return { reply: { status: "notDbeaver" } };
      if (scanned === null || (scanned.projects.length === 0 && !scanned.symlinked)) continue;
      return scanned.symlinked ? { reply: { status: "unreadable", message: symlinkMessage } } : { found: { where: "chosen", projects: scanned.projects } };
    }

    const asProject = await scanProject(real, projectName);
    if (asProject === "symlink") return { reply: { status: "unreadable", message: symlinkMessage } };
    if (asProject !== null) return { found: { where: "chosen", projects: [asProject] } };

    // A própria `.dbeaver`: o projeto é a pasta acima dela.
    if (basename(real) === ".dbeaver") {
      const parent = dirname(real);
      const name = basename(basename(chosen) === ".dbeaver" ? dirname(chosen) : parent) || basename(parent);
      const inside = await scanProject(parent, name);
      if (inside === "symlink") return { reply: { status: "unreadable", message: symlinkMessage } };
      if (inside !== null) return { found: { where: "chosen", projects: [inside] } };
    }
    return { reply: { status: "notDbeaver" } };
  }

  /** Copia um arquivo: aberto só para leitura, conferido pelo `fstat` do descritor (comum, o mesmo dispositivo e `inode` do `lstat`) e lido até o teto. */
  async function copyFile(from: string, to: string, expected: FileRef, spent: { bytes: number }): Promise<void> {
    await deps.beforeOpen?.(from);
    let source;
    try {
      source = await open(from, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      // O atalho trocado no meio do caminho: o `O_NOFOLLOW` o recusa com `ELOOP`.
      if (codeOf(error) === "ELOOP") throw new CopyRefusal({ status: "unreadable", message: symlinkMessage });
      throw new CopyRefusal({ status: "unreadable", message: unreadableMessage(unreadableReason(codeOf(error))) });
    }
    try {
      const stats = await source.stat({ bigint: true });
      if (!stats.isFile() || stats.dev !== expected.dev || stats.ino !== expected.ino) {
        throw new CopyRefusal({ status: "unreadable", message: unreadableMessage("o arquivo foi trocado durante a cópia") });
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for (;;) {
        const chunk = Buffer.allocUnsafe(64 * 1024);
        let read;
        try {
          read = await source.read(chunk, 0, chunk.length, null);
        } catch (error) {
          throw new CopyRefusal({ status: "unreadable", message: unreadableMessage(unreadableReason(codeOf(error))) });
        }
        if (read.bytesRead === 0) break;
        size += read.bytesRead;
        spent.bytes += read.bytesRead;
        // O arquivo que cresceu no meio da cópia (RN-DBEAVER-006): para ao passar do teto, e a cópia inteira é recusada.
        if (size > dbeaverLimits.fileBytes || spent.bytes > dbeaverLimits.totalBytes) throw new CopyRefusal({ status: "tooLarge" });
        chunks.push(chunk.subarray(0, read.bytesRead));
      }

      let target;
      try {
        target = await open(to, "wx", 0o600);
      } catch (error) {
        throw new CopyRefusal(codeOf(error) === "ENOSPC" || codeOf(error) === "EDQUOT" ? { status: "noSpace" } : { status: "notWritable" });
      }
      try {
        await target.writeFile(Buffer.concat(chunks));
        await target.sync();
      } catch (error) {
        throw new CopyRefusal(codeOf(error) === "ENOSPC" || codeOf(error) === "EDQUOT" ? { status: "noSpace" } : { status: "notWritable" });
      } finally {
        await target.close().catch(() => undefined);
      }
    } finally {
      await source.close().catch(() => undefined);
    }
  }

  /**
   * A cópia (RN-DBEAVER-006): os limites e o espaço são conferidos antes de qualquer arquivo, tudo vai para `<sourceId>.dbeaver.part` (a pasta 0700 com uma
   * subpasta 0700 por projeto, `1`, `2`…, os arquivos 0600 e o `manifest.json` por último) e a pasta inteira é renomeada no fim: a API nunca vê uma cópia pela
   * metade. Qualquer falha apaga o `.part`.
   */
  async function copyAll(sourceId: string, located: Located): Promise<{ files: number; bytes: number }> {
    const { projects } = located;
    if (projects.length > dbeaverLimits.projects) throw new CopyRefusal({ status: "tooLarge" });
    let total = 0;
    let files = 0;
    for (const project of projects) {
      if (project.files.length > dbeaverLimits.filesPerProject) throw new CopyRefusal({ status: "tooLarge" });
      for (const file of project.files) {
        if (file.size > dbeaverLimits.fileBytes) throw new CopyRefusal({ status: "tooLarge" });
        total += file.size;
        files++;
      }
    }
    if (total > dbeaverLimits.totalBytes) throw new CopyRefusal({ status: "tooLarge" });

    if (!(await writable())) throw new CopyRefusal({ status: "notWritable" });
    const free = await freeSpace(transfersDir);
    if (free !== null && free < total + dbeaverLimits.spareBytes) throw new CopyRefusal({ status: "noSpace" });

    const part = partOf(sourceId);
    const spent = { bytes: 0 };
    try {
      await mkdir(part, { mode: 0o700 });
      const manifest = { version: 1, where: located.where, projects: [] as { folder: string; name: string }[] };
      for (const [index, project] of projects.entries()) {
        const folder = String(index + 1);
        await mkdir(join(part, folder), { mode: 0o700 });
        for (const file of project.files) await copyFile(join(project.dir, file.name), join(part, folder, file.name), file, spent);
        manifest.projects.push({ folder, name: project.name });
      }
      const handle = await open(join(part, "manifest.json"), "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(manifest), "utf8");
        await handle.sync();
      } finally {
        await handle.close().catch(() => undefined);
      }
      await rename(part, readyOf(sourceId));
    } catch (error) {
      await rm(part, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof CopyRefusal) throw error;
      const code = codeOf(error);
      throw new CopyRefusal(code === "ENOSPC" || code === "EDQUOT" ? { status: "noSpace" } : { status: "notWritable" });
    }
    return { files, bytes: spent.bytes };
  }

  /** Solta a cópia anterior da janela (RN-DBEAVER-006: no máximo uma por janela). */
  async function dropOf(windowId: number): Promise<void> {
    await Promise.all([...copies].filter(([, owner]) => owner === windowId).map(([sourceId]) => drop(sourceId)));
  }

  async function drop(sourceId: string): Promise<void> {
    copies.delete(sourceId);
    await removeCopy(sourceId);
  }

  /**
   * `prism:dbeaver-source`: `find` procura nos lugares de sempre e `choose` abre o diálogo de pasta; achado o DBeaver, copia os arquivos esperados e responde
   * `found`. A cópia anterior da janela é solta quando a nova começa (o `choose` desistido não solta nada).
   */
  async function source(windowId: number, raw: unknown): Promise<DbeaverSourceReply> {
    const { mode } = dbeaverSourceRequestSchema.parse(raw);
    const mark = releaseMark(windowId);
    const token = (operations.get(windowId) ?? 0) + 1;
    operations.set(windowId, token);
    const started = deps.now();

    let search: Search;
    if (mode === "find") {
      await dropOf(windowId);
      search = await locate();
    } else {
      const chosen = await deps.showOpenDialog(windowId, { title: dbeaverDialogTitle, defaultPath: await dialogStart() });
      if (chosen === null || chosen === "") return { status: "canceled" };
      await dropOf(windowId);
      search = await shapeOf(chosen);
    }
    if ("reply" in search) {
      deps.log(`dbeaver: ${mode} recusado: ${search.reply.status}`);
      return search.reply;
    }

    const sourceId = deps.randomId();
    let result;
    try {
      result = await copyAll(sourceId, search.found);
    } catch (error) {
      if (!(error instanceof CopyRefusal)) throw error;
      deps.log(`dbeaver: a cópia ${sourceId} foi recusada: ${error.reply.status}`);
      return error.reply;
    }

    // A janela que recarregou, caiu ou fechou, ou o pedido mais novo da mesma janela, tira o valor desta cópia: ninguém a soltaria.
    if (releaseMark(windowId) !== mark || operations.get(windowId) !== token) {
      await removeCopy(sourceId);
      return { status: "canceled" };
    }
    copies.set(sourceId, windowId);
    deps.log(`dbeaver: cópia ${sourceId} (${search.found.where}), ${search.found.projects.length} projetos, ${result.files} arquivos, ${result.bytes} bytes, em ${deps.now() - started} ms`);
    return { status: "found", sourceId, where: search.found.where, projects: search.found.projects.length };
  }

  /** `prism:dbeaver-source-release`: a cópia de outra janela, ou um `sourceId` que não se conhece, não existe para quem pede. */
  async function release(windowId: number, raw: unknown): Promise<void> {
    const { sourceId } = dbeaverReleaseRequestSchema.parse(raw);
    if (copies.get(sourceId) === windowId) await drop(sourceId);
  }

  /** A janela que recarrega, cai ou fecha solta a cópia dela. */
  async function releaseWindow(windowId: number): Promise<void> {
    releases.set(windowId, (releases.get(windowId) ?? 0) + 1);
    await dropOf(windowId);
  }

  /** O app que sai e o serviço que reinicia soltam todas as cópias (a API nova apagaria a pasta `transfers` na partida). */
  async function releaseAll(): Promise<void> {
    releasesOfAll++;
    await Promise.all([...copies.keys()].map(drop));
  }

  return { source, release, releaseWindow, releaseAll, transfersDir };
}

export type DbeaverSource = ReturnType<typeof createDbeaverSource>;
