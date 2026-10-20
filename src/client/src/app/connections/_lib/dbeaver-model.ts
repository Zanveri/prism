import type { DbeaverSourceReply } from "../../../../electron/dbeaver-messages";
import type { SelectOption } from "@/components/ui";
import type { ApiError } from "@/lib/api/prism-api";

import { markedLeaves, validMarks, type CheckTree } from "./check-tree";
import { allImportable, connectionTags, folderTags, importCounter, invalidReason, type PreviewIndex, type PreviewTag } from "./import-model";
import { dbeaverCopy } from "./dbeaver.copy";
import type { DbeaverDrdaPort, DbeaverImportResult, DbeaverNotes, DbeaverPreview, DbeaverPreviewConnection, DbeaverPreviewFolder, DbeaverScan, DbeaverScanProject } from "./dbeaver.schema";
import type { ConflictPolicy } from "./transfer.schema";
import { transferCopy } from "./transfer.copy";

/**
 * O que o diálogo "Importar do DBeaver" e o "Comece por aqui" decidem (RN-DBEAVER-001 a 018), puro e testado. A prévia vem da API; aqui ficam as frases da
 * origem, o seletor do projeto, as portas DRDA do Informix, as marcas de cada linha, a pergunta de sobrescrever e o aviso do que aconteceu. A árvore de
 * marcar, as marcas da seção 34 e a conta do rodapé são as do "Importar conexões" (`import-model.ts`).
 */

const copy = dbeaverCopy;
const informix = 3;

/** O DBeaver foi achado: onde, e quantos projetos tem. */
export type DbeaverFound = { sourceId: string; where: "standard" | "flatpak" | "snap" | "env" | "chosen" };

/** De onde o diálogo tira a origem ao abrir (RN-DBEAVER-014): a procura, a pasta escolhida na hora, ou a cópia que o convite já fez. */
export type DbeaverStart = { type: "find" } | { type: "choose" } | ({ type: "copy" } & DbeaverFound);

/** A origem do diálogo (RN-DBEAVER-014): procurando, achada (com a contagem dos projetos) ou recusada, com a frase e se vale tentar de novo. */
export type SourceState =
  | { kind: "searching" }
  | ({ kind: "ready"; scan: DbeaverScan } & DbeaverFound)
  | { kind: "refused"; message: string; retry: boolean };

/**
 * A frase da recusa do processo principal (RN-DBEAVER-006). `canceled` não é recusa (o `choose` desistido deixa tudo como estava), e `found` é o que dá certo:
 * `null` para os dois.
 */
export function sourceRefusal(reply: DbeaverSourceReply | { status: "error" }): { message: string; retry: boolean } | null {
  switch (reply.status) {
    case "found":
    case "canceled":
      return null;
    case "notFound":
      return { message: copy.source.notFound, retry: false };
    case "notDbeaver":
      return { message: copy.source.notDbeaver, retry: false };
    case "tooLarge":
      return { message: copy.source.tooLarge, retry: true };
    case "notWritable":
      return { message: copy.source.notWritable, retry: true };
    case "noSpace":
      return { message: copy.source.noSpace, retry: true };
    case "unreadable":
      return { message: reply.message, retry: true };
    case "error":
      return { message: copy.source.bridge, retry: true };
  }
}

/** A recusa da API ao ler a cópia (a contagem, a prévia), com a frase da tela. `missing`: a cópia sumiu, e a tela pede outra origem sozinha (RN-DBEAVER-016). */
export function apiSourceRefusal(error: ApiError): { message: string; missing: boolean } {
  if (error.code === "DBEAVER_SOURCE_MISSING") return { message: copy.source.missing, missing: true };
  if (error.code === "DBEAVER_SOURCE_INVALID") return { message: copy.source.invalid, missing: false };
  return { message: copy.source.unknown, missing: false };
}

/** A recusa da prévia ou da importação que o diálogo mostra no lugar, com o campo a que se refere (RN-DBEAVER-014 e 016). `null` para a que não é da leitura. */
export function readRefusal(code: string, several: boolean): { field: "origin" | "project" | "destination"; message: string; missing: boolean } | null {
  switch (code) {
    case "DBEAVER_SOURCE_MISSING":
      return { field: "origin", message: copy.source.missing, missing: true };
    case "DBEAVER_SOURCE_INVALID":
      return { field: "origin", message: copy.source.invalid, missing: false };
    case "DBEAVER_PROJECT_NOT_FOUND":
      return { field: "project", message: copy.source.projectGone, missing: false };
    case "DBEAVER_LIMITS_EXCEEDED":
      return { field: several ? "project" : "origin", message: copy.source.limits(several), missing: false };
    case "FOLDER_NOT_FOUND":
      return { field: "destination", message: transferCopy.import.destinationGone, missing: false };
    default:
      return null;
  }
}

/** As conexões que o Prism importa, de todos os projetos que se leem (RN-DBEAVER-001): a conta do "Comece por aqui" e do convite. */
export function importableTotal(scan: DbeaverScan): number {
  return scan.projects.reduce((sum, project) => sum + (project.protected || project.nameInvalid ? 0 : project.importable), 0);
}

/** O estado do cartão "Importar do DBeaver" do "Comece por aqui" (RN-DBEAVER-001), depois da procura e da contagem. */
export type CardState = { kind: "searching" } | { kind: "found"; count: number; where: DbeaverFound["where"] } | { kind: "noneImportable" } | { kind: "notFound" } | { kind: "refused"; message: string };

export function cardState(source: SourceState | { kind: "notFound" }): CardState {
  if (source.kind === "searching") return { kind: "searching" };
  if (source.kind === "notFound") return { kind: "notFound" };
  if (source.kind === "refused") return { kind: "refused", message: source.message };

  const count = importableTotal(source.scan);
  return count === 0 ? { kind: "noneImportable" } : { kind: "found", count, where: source.where };
}

/** A frase do cartão. */
export function cardSentence(state: CardState): string {
  switch (state.kind) {
    case "searching":
      return copy.source.searching;
    case "found":
      return copy.startHere.dbeaver.found(state.count, state.where);
    case "noneImportable":
      return copy.startHere.dbeaver.noneImportable;
    case "notFound":
      return copy.startHere.dbeaver.notFound;
    case "refused":
      return state.message;
  }
}

/** O botão principal do cartão: "Importar do DBeaver…" quando achou o que importar, senão "Escolher a pasta do DBeaver…" (e "Tentar de novo" nas recusas). */
export function cardButtons(state: CardState): { primary: "import" | "choose" | null; retry: boolean; link: boolean } {
  switch (state.kind) {
    case "searching":
      return { primary: null, retry: false, link: false };
    case "found":
      return { primary: "import", retry: false, link: true };
    case "noneImportable":
    case "notFound":
      return { primary: "choose", retry: false, link: false };
    case "refused":
      return { primary: "choose", retry: true, link: false };
  }
}

/** O campo "Origem" (RN-DBEAVER-014). */
export const originLabel = (where: DbeaverFound["where"]) => copy.source.where[where];

/** O seletor do projeto (RN-DBEAVER-014): "Todos os projetos" e cada projeto do manifesto, com o que o Prism importa dele; o protegido e o de nome inválido, desabilitados. */
export function projectOptions(projects: readonly DbeaverScanProject[]): SelectOption[] {
  return [
    { value: allProjects, label: copy.dialog.allProjects },
    ...projects.map((project, index): SelectOption => {
      if (project.nameInvalid) return { value: projectValue(index), label: copy.dialog.projectPosition(index + 1), disabled: true, hint: copy.dialog.projectNameInvalid };
      if (project.protected) return { value: projectValue(index), label: project.name, disabled: true, hint: copy.dialog.projectProtected };
      return { value: projectValue(index), label: copy.dialog.projectLabel(project.name, project.importable) };
    }),
  ];
}

export const allProjects = "all";
const projectValue = (index: number) => `project-${index}`;

/** O campo "Projeto" só aparece com mais de um projeto na origem. */
export const showsProjects = (scan: DbeaverScan) => scan.projects.length > 1;

/** O nome do projeto escolhido, ou `null` para todos (o que a API recebe em `project`). */
export function projectNameOf(scan: DbeaverScan, value: string): string | null {
  const index = scan.projects.findIndex((_, position) => projectValue(position) === value);
  const project = index < 0 ? undefined : scan.projects[index];
  // O protegido e o de nome inválido não se escolhem (o seletor os desabilita); aqui também não valem.
  return project === undefined || project.nameInvalid || project.protected ? null : project.name;
}

/** O projeto escolhido volta ao padrão quando deixa de valer (a origem mudou, o projeto ficou protegido). */
export const validProject = (scan: DbeaverScan, value: string) => value === allProjects || projectNameOf(scan, value) !== null;

/** Alguma conexão da origem tem senha? Sem nenhuma, "Levar as senhas" não aparece (RN-DBEAVER-014). */
export const hasAnyPassword = (scan: DbeaverScan) => scan.projects.some((project) => !project.protected && !project.nameInvalid && project.withPassword > 0);

/** As chaves da prévia que são conexões a importar: as que não têm motivo de recusa. */
const importable = (preview: DbeaverPreview) => preview.connections.filter((connection) => connection.invalid === null);

/**
 * O resumo no topo da prévia (RN-DBEAVER-015). `scope` é o projeto quando um só está escolhido; sem conexão que o Prism importe, a frase diz isso. A prévia sem
 * conexão nem pasta diz que o DBeaver não tem nada.
 */
export function previewSummary(preview: DbeaverPreview, scope: string | null, withPasswords: boolean): string {
  if (preview.connections.length === 0 && preview.folders.length === 0) return copy.preview.empty;

  const usable = importable(preview);
  if (usable.length === 0) return copy.preview.nothingImportable;
  return copy.preview.summary({
    scope,
    connections: preview.connections.length,
    folders: preview.folders.length,
    importable: usable.length,
    withUser: usable.filter((connection) => connection.userName !== "").length,
    withPassword: usable.filter((connection) => connection.hasPassword).length,
    withPasswords,
  });
}

/**
 * As marcas depois de trocar o projeto (RN-DBEAVER-014 e 015): as que ainda valem na árvore nova continuam (a API dá a mesma chave ao mesmo item em "Todos os
 * projetos" e com o projeto escolhido), e o que a árvore de antes não tinha (o projeto que "Todos os projetos" traz) chega marcado, como na abertura.
 */
export function marksAfterScopeChange(tree: CheckTree, marked: ReadonlySet<string>, before: CheckTree): Set<string> {
  const result = validMarks(tree, marked);
  for (const key of allImportable(tree)) if (!before.byKey.has(key)) result.add(key);
  return result;
}

/** O aviso da prévia: no tom de atenção, ou no de informação (RN-DBEAVER-015). */
export type Notice = { key: string; tone: "warning" | "info"; text: string };

/**
 * Os avisos acima da árvore (RN-DBEAVER-015), na ordem: o projeto protegido que "Todos os projetos" deixou de fora, o arquivo de conexões que não pôde ser lido,
 * as senhas que não puderam ser lidas, as protegidas por senha de projeto, as que deviam estar e não estão e, por último, as que o DBeaver não guardou.
 * `scoped`: um projeto só está escolhido, e a frase das senhas não leva o nome dele.
 */
export function previewNotices(notes: DbeaverNotes, scoped: boolean): Notice[] {
  const result: Notice[] = [];
  for (const name of notes.protectedProjects) result.push({ key: `protected:${name}`, tone: "warning", text: copy.preview.notes.protectedProject(name) });
  // O projeto sem nenhum arquivo legível ficou de fora por inteiro: a mesma frase, no plural (RN-DBEAVER-007).
  for (const name of notes.unreadableFiles) {
    const wholeProject = notes.unreadableProjects.includes(name);
    result.push({ key: `unreadable:${name}`, tone: "warning", text: wholeProject ? copy.preview.notes.unreadableProject(name) : copy.preview.notes.unreadableFiles(name) });
  }
  for (const name of notes.credentialsUnreadable) result.push({ key: `credentials:${name}`, tone: "warning", text: copy.preview.notes.credentialsUnreadable(scoped ? null : name) });
  for (const name of notes.credentialsProtected) result.push({ key: `credentials-protected:${name}`, tone: "warning", text: copy.preview.notes.credentialsProtected(name) });
  if (notes.savedPasswordMissing > 0) result.push({ key: "missing", tone: "warning", text: copy.preview.notes.savedPasswordMissing(notes.savedPasswordMissing) });
  if (notes.withoutSavedPassword > 0) result.push({ key: "without", tone: "info", text: copy.preview.notes.withoutSavedPassword(notes.withoutSavedPassword) });
  return result;
}

/** As portas DRDA (RN-DBEAVER-010 e 015) -------------------------------------------------------------------------------------------------------------- */

/** Um servidor do DBeaver com conexões Informix marcadas: uma linha da tabela "Porta DRDA do Informix". */
export type DrdaRow = { key: string; host: string; port: number; server: string | null; connections: number };

/**
 * A chave de um servidor do DBeaver (o host, a porta SQLI e o `INFORMIXSERVER`, como a prévia os dá: a API os compara assim, sem diferenciar nada), a mesma para
 * as linhas e para as conexões.
 */
export const drdaKey = (host: string, port: number, server: string | null) => `${host.trim()}|${port}|${server ?? ""}`;

/** A porta SQLI do DBeaver numa conexão Informix: `dbeaverPort`, já que `port` é a que a conexão terá e vira a DRDA quando a prévia a aplicou. */
export const sqliPortOf = (connection: DbeaverPreviewConnection): number | null => connection.dbeaverPort ?? connection.port;

export function connectionDrdaKey(connection: DbeaverPreviewConnection): string | null {
  const port = sqliPortOf(connection);
  return connection.engine === informix && connection.host !== null && port !== null ? drdaKey(connection.host, port, connection.server) : null;
}

/** Os servidores das conexões Informix marcadas que podem ser importadas, sem repetição, na ordem da árvore (a primeira conexão de cada um). */
export function drdaRows(tree: CheckTree, preview: DbeaverPreview, marked: ReadonlySet<string>): DrdaRow[] {
  const byKey = new Map(preview.connections.map((connection) => [connection.key, connection]));
  const rows = new Map<string, DrdaRow>();
  for (const leaf of markedLeaves(tree, marked)) {
    const connection = byKey.get(leaf.key);
    if (connection === undefined || connection.invalid !== null) continue;

    const key = connectionDrdaKey(connection);
    const port = sqliPortOf(connection);
    if (key === null || connection.host === null || port === null) continue;
    const row = rows.get(key);
    if (row === undefined) rows.set(key, { key, host: connection.host, port, server: connection.server, connections: 1 });
    else row.connections++;
  }
  return [...rows.values()];
}

/** O que se digita no campo da porta DRDA: vazio (a porta do DBeaver), uma porta, ou texto que não é uma porta. */
export type DrdaInput = { kind: "empty" } | { kind: "port"; port: number } | { kind: "invalid" };

export function parseDrdaInput(text: string): DrdaInput {
  const value = text.trim();
  if (value === "") return { kind: "empty" };
  if (!/^\d{1,5}$/.test(value)) return { kind: "invalid" };

  const port = Number(value);
  return port >= 1 && port <= 65535 ? { kind: "port", port } : { kind: "invalid" };
}

/** As portas DRDA preenchidas e válidas, das linhas à vista, como a API as recebe (`drdaPorts`). */
export function drdaPortsOf(rows: readonly DrdaRow[], values: Readonly<Record<string, string>>): DbeaverDrdaPort[] {
  const result: DbeaverDrdaPort[] = [];
  for (const row of rows) {
    const input = parseDrdaInput(values[row.key] ?? "");
    if (input.kind === "port") result.push({ host: row.host, port: row.port, server: row.server, drdaPort: input.port });
  }
  return result;
}

/** A mesma lista como texto, para saber se mudou desde a última prévia. */
export const drdaSignature = (ports: readonly DbeaverDrdaPort[]) => ports.map((port) => `${drdaKey(port.host, port.port, port.server)}=${port.drdaPort}`).join(";");

/** A porta DRDA digitada para a conexão, ou `null` (campo vazio, inválido, ou conexão que não é Informix). */
export function drdaPortFor(connection: DbeaverPreviewConnection, values: Readonly<Record<string, string>>): number | null {
  const key = connectionDrdaKey(connection);
  const input = key === null ? ({ kind: "empty" } as const) : parseDrdaInput(values[key] ?? "");
  return input.kind === "port" ? input.port : null;
}

/** As linhas da árvore ------------------------------------------------------------------------------------------------------------------------------- */

/**
 * A segunda linha da conexão (RN-DBEAVER-015): "pg-dev.exemplo.invalid:5432 / pedidos · usuário fulano · com senha", e no Informix o servidor depois do banco.
 * `drdaPort`, quando a pessoa a digitou, aparece no lugar da porta do DBeaver.
 */
export function connectionLine(connection: DbeaverPreviewConnection, drdaPort: number | null): string {
  const port = drdaPort ?? connection.port;
  const address = transferCopy.import.preview.address(connection.host ?? "", port === null ? "" : String(port), connection.database ?? "");
  const server = connection.server === null ? null : copy.preview.server(connection.server);
  const credentials =
    connection.userName === ""
      ? transferCopy.import.preview.noCredentials
      : `${transferCopy.import.preview.user(connection.userName)} · ${connection.hasPassword ? transferCopy.import.preview.withPassword : transferCopy.import.preview.withoutPassword}`;
  return [address, server, credentials].filter((part) => part !== null).join(" · ");
}

const leftOutText = (connection: DbeaverPreviewConnection): { items: string[]; tunnel: boolean } => {
  const items: string[] = [];
  const messages = copy.preview.leftOut;
  for (const code of connection.leftOut) {
    switch (code) {
      case "informixServer":
        items.push(messages.informixServer(connection.server));
        break;
      case "authModel":
        items.push(messages.authModel(connection.authModel));
        break;
      case "sshTunnel":
      case "proxy":
      case "driverProperties":
      case "bootstrap":
      case "autocommitOff":
      case "events":
      case "confirmDataChange":
      case "permissions":
      case "navigatorFilters":
        items.push(messages[code]);
        break;
      case "environmentCut":
      case "environmentInvalid":
        break;
    }
  }
  return { items, tunnel: connection.leftOut.includes("sshTunnel") || connection.leftOut.includes("proxy") };
};

/**
 * As marcas da linha de uma conexão (RN-DBEAVER-015): as da seção 34 (o conflito de nome, o que a importação grava para não ficar mais fraca, o não
 * importável), com a dica da "confirma todos os comandos" trocada pela do DBeaver, mais "já existe no Prism", "porta do DBeaver" (no Informix cujo servidor está
 * sem porta DRDA no campo), "ficou de fora" e os dois avisos do ambiente.
 */
export function dbeaverConnectionTags(tree: CheckTree, index: PreviewIndex, connection: DbeaverPreviewConnection, onConflict: ConflictPolicy, drdaPort: number | null): PreviewTag[] {
  const base = connectionTags(tree, index, connection, onConflict, false);
  if (invalidReason(tree, index, connection.key) !== null) return base;

  const tags = copy.preview.tags;
  const hints = copy.preview.hints;
  const result: PreviewTag[] = [];
  if (connection.existing !== null) result.push({ label: tags.existsInPrism, hint: hints.existsInPrism(connection.existing.path, connection.existing.name), tone: "neutral" });
  for (const tag of base) result.push(tag.label === transferCopy.import.preview.tags.all ? { ...tag, hint: hints.confirmAll(connection.dbeaverType) } : tag);
  if (connection.conflict && onConflict === "skip") return result;

  if (connection.engine === informix && drdaPort === null) result.push({ label: tags.dbeaverPort, hint: hints.dbeaverPort(sqliPortOf(connection)), tone: "attention" });
  const left = leftOutText(connection);
  if (left.items.length > 0) result.push({ label: tags.leftOut, hint: hints.leftOut(left.items, left.tunnel), tone: "neutral" });
  if (connection.leftOut.includes("environmentCut")) result.push({ label: tags.environmentCut, hint: hints.environmentCut, tone: "neutral" });
  if (connection.leftOut.includes("environmentInvalid")) result.push({ label: tags.noEnvironment, hint: hints.noEnvironment, tone: "attention" });
  return result;
}

/** As marcas da linha de uma pasta: as da seção 34 e "nome cortado" (RN-DBEAVER-011). */
export function dbeaverFolderTags(tree: CheckTree, index: PreviewIndex, folder: DbeaverPreviewFolder): PreviewTag[] {
  const base = folderTags(tree, index, folder);
  if (!folder.nameCut || invalidReason(tree, index, folder.key) !== null) return base;
  return [...base, { label: copy.preview.tags.folderCut, hint: copy.preview.hints.folderCut, tone: "neutral" }];
}

/** A conta do rodapé (RN-DBEAVER-015): a da seção 34, com ", 3 já existem no Prism" no fim quando há. */
export function dbeaverCounter(tree: CheckTree, marked: ReadonlySet<string>, existingMarked: number): string {
  return importCounter(tree, marked) + (existingMarked === 0 ? "" : copy.dialog.existingInCounter(existingMarked));
}

/** Sobrescrever (RN-DBEAVER-017) ------------------------------------------------------------------------------------------------------------------------- */

/** As conexões marcadas que já existem no Prism: com alguma, "Importar" abre a pergunta. */
export function existingMarked(tree: CheckTree, preview: DbeaverPreview, marked: ReadonlySet<string>): DbeaverPreviewConnection[] {
  const keys = new Set(markedLeaves(tree, marked).map((leaf) => leaf.key));
  return preview.connections.filter((connection) => connection.existing !== null && connection.invalid === null && keys.has(connection.key));
}

/** O que a pergunta diz de uma conexão que já existe: o que muda, ou "nada muda" (RN-DBEAVER-017). */
export function overwriteChanges(connection: DbeaverPreviewConnection, drdaPort: number | null): string[] {
  const overwrite = connection.overwrite;
  const existing = connection.existing;
  if (overwrite === null || existing === null) return [];

  const changes = copy.overwrite.change;
  const result: string[] = [];
  if (overwrite.name) result.push(changes.name);
  if (overwrite.engine) result.push(changes.engine);
  if (overwrite.host) result.push(changes.host(existing.host ?? null, connection.host));
  // No Informix a porta só muda com a DRDA digitada (RN-DBEAVER-017): a API já a conta em `overwrite.port`.
  if (overwrite.port) result.push(changes.port(existing.port ?? null, drdaPort ?? connection.port));
  if (overwrite.database) result.push(changes.database(existing.database ?? null, connection.database));
  if (overwrite.userName) result.push(changes.userName(existing.userName ?? null, connection.userName));
  if (overwrite.password) result.push(changes.password);
  if (overwrite.environment) result.push(changes.environment(existing.environmentName ?? null, connection.effective.environmentName));
  if (overwrite.keepsName) result.push(copy.overwrite.keepsName(connection.name ?? existing.name));
  if (overwrite.dropsPassword) result.push(overwrite.host ? copy.overwrite.dropsPassword.host : overwrite.port ? copy.overwrite.dropsPassword.port : copy.overwrite.dropsPassword.userName);
  return result.length === 0 ? [copy.overwrite.nothingChanges] : result;
}

/** Quantas das conexões que já existem estão conectadas, em qualquer janela. */
export const connectedCount = (connections: readonly DbeaverPreviewConnection[]) => connections.filter((connection) => connection.existing?.connected === true).length;

/** O aviso do que aconteceu de fato (RN-DBEAVER-016). */
export function dbeaverToast(result: DbeaverImportResult): { tone: "success" | "warning"; message: string } {
  const connections = result.connectionIDs.length;
  const folders = result.folderIDs.length;
  const updated = result.updatedIDs.length;
  if (connections === 0 && folders === 0 && updated === 0) return { tone: "warning", message: copy.toasts.nothing };

  const message = connections === 0 && folders === 0 ? copy.toasts.updated(updated) : copy.toasts.imported({ connections, folders, renamed: result.renamed, updated });
  return result.skipped === 0 ? { tone: "success", message } : { tone: "warning", message: `${message} ${transferCopy.import.toasts.skipped(result.skipped)}` };
}

/** O que a importação criou, para o navegador mostrar (RN-DBEAVER-014): as pastas e as conexões novas, ou as atualizadas quando nada foi criado. */
export function importedItems(result: DbeaverImportResult, targetFolderID: string | null) {
  const created = result.folderIDs.length + result.connectionIDs.length > 0;
  return { folderIDs: result.folderIDs, connectionIDs: created ? result.connectionIDs : result.updatedIDs, targetFolderID };
}

/** A data da última importação (RN-CONFIG-011), na hora local e no formato da máquina ("20/10/2026, 14:32"). */
export function lastImportSentence(lastImportAt: string | null, locale?: string): string {
  if (lastImportAt === null) return copy.settings.never;
  const date = new Date(lastImportAt);
  if (Number.isNaN(date.getTime())) return copy.settings.never;

  const when = new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  return copy.settings.last(when);
}

/** Uma conexão `existing` só conta se está marcada e pode ser importada; devolve as chaves para o `overwrite` da importação. */
export const overwriteKeys = (connections: readonly DbeaverPreviewConnection[]) => connections.map((connection) => connection.key);
