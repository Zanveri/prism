import { engineOption, type Confirmation } from "./connections.schema";
import { checkTree, foldersInFile, markedLeaves, type CheckNode, type CheckTree } from "./check-tree";
import type { ConflictPolicy, ImportPreview, ImportResult, PreviewConnection, PreviewFolder } from "./transfer.schema";
import { transferCopy } from "./transfer.copy";

/**
 * O que o diálogo "Importar conexões" decide (RN-TRANSF-009 a 014), puro e testado. A prévia vem da API; aqui ficam a árvore de marcar, as frases e as marcas
 * de cada linha.
 */

const copy = transferCopy.import;
const tags = copy.preview.tags;
const why = copy.preview.why;

/** O teto do arquivo: 5 MiB em bytes (RN-TRANSF-010, etapa 1). O maior é recusado pela tela antes de ser lido (RN-TRANSF-009). */
export const importFileMaxBytes = 5 * 1024 * 1024;

/** O tamanho do arquivo escolhido, ao lado do nome ("14 KB"). */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString("pt-BR")} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** O nome que se vê de um item do arquivo (o do item que não pode ser importado pode faltar). */
export const nameOf = (item: { name: string | null }) => item.name ?? transferCopy.tree.noName;

/** A árvore de marcar da prévia (RN-TRANSF-011): a do arquivo, com o que não pode ser importado sem caixa que se marque, e o que está dentro dele também. */
export function previewTree(preview: ImportPreview): CheckTree {
  return checkTree([
    ...preview.folders.map((folder) => ({ key: folder.key, kind: "folder" as const, parentKey: folder.parentKey, name: nameOf(folder), selectable: folder.invalid === null })),
    ...preview.connections.map((connection) => ({ key: connection.key, kind: "connection" as const, parentKey: connection.folderKey, name: nameOf(connection), selectable: connection.invalid === null })),
  ]);
}

/** A prévia por chave, para as linhas acharem o item delas. */
export type PreviewIndex = { folders: ReadonlyMap<string, PreviewFolder>; connections: ReadonlyMap<string, PreviewConnection> };

export function previewIndex(preview: ImportPreview): PreviewIndex {
  return { folders: new Map(preview.folders.map((folder) => [folder.key, folder])), connections: new Map(preview.connections.map((connection) => [connection.key, connection])) };
}

/** A prévia é calculada com tudo o que pode ser importado marcado, e é assim que o diálogo começa (RN-TRANSF-011). */
export function allImportable(tree: CheckTree): Set<string> {
  return new Set(tree.nodes.filter((node) => node.leaf && node.selectable).map((node) => node.key));
}

/**
 * Por que o item não pode ser importado (RN-TRANSF-014): o motivo dele, que a API dá, ou, dentro de uma pasta que não pode ser importada, o dela ("A pasta
 * Production PRD não pode ser importada."). `null` quando pode.
 */
export function invalidReason(tree: CheckTree, index: PreviewIndex, key: string): string | null {
  const own = index.folders.get(key)?.invalid ?? index.connections.get(key)?.invalid ?? null;
  if (own !== null) return own;

  for (let parent = tree.byKey.get(key)?.parentKey ?? null; parent !== null; parent = tree.byKey.get(parent)?.parentKey ?? null) {
    const folder = index.folders.get(parent);
    if (folder?.invalid != null) return copy.preview.invalidFolder(nameOf(folder));
  }
  return null;
}

/** O resumo no topo da prévia (RN-TRANSF-011), com tudo o que o arquivo traz. */
export function previewSummary(preview: ImportPreview): string {
  return copy.preview.summary({
    connections: preview.connections.length,
    folders: preview.folders.length,
    withUser: preview.connections.filter((connection) => connection.userName !== "").length,
    withPassword: preview.connections.filter((connection) => connection.hasPassword).length,
  });
}

/** A segunda linha da conexão: o servidor e as credenciais ("informix-prd.exemplo.invalid:9089 / estoque · usuário datafix · com senha"). A senha nunca. */
export function connectionLine(connection: PreviewConnection): string {
  const address = copy.preview.address(connection.host ?? "", connection.port === null ? "" : String(connection.port), connection.database ?? "");
  if (connection.userName === "") return `${address} · ${copy.preview.noCredentials}`;
  return `${address} · ${copy.preview.user(connection.userName)} · ${connection.hasPassword ? copy.preview.withPassword : copy.preview.withoutPassword}`;
}

/** Uma marca à direita da linha, com a explicação na dica (RN-TRANSF-011). `tone` diz a cor: o que não entra, o que muda, ou só informação. */
export type PreviewTag = { label: string; hint: string; tone: "neutral" | "attention" | "danger" };

/** A pasta do arquivo, acima do item, que dá a proteção ou o ambiente na origem ("pela pasta Estoque"), ou nulo quando é o próprio item. */
function originFolder(tree: CheckTree, index: PreviewIndex, node: CheckNode | undefined, gives: (folder: PreviewFolder) => boolean): string | null {
  for (let parent = node?.parentKey ?? null; parent !== null; parent = tree.byKey.get(parent)?.parentKey ?? null) {
    const folder = index.folders.get(parent);
    if (folder !== undefined && gives(folder)) return nameOf(folder);
  }
  return null;
}

const confirmationRank = (value: Confirmation | null) => (value === "all" ? 2 : value === "irreversible" ? 1 : 0);

/** As marcas do que a importação grava no item para ele não ficar mais fraco (RN-TRANSF-013), com o porquê. */
function strengthenedTags(tree: CheckTree, index: PreviewIndex, item: PreviewFolder | PreviewConnection, ownReadOnly: boolean, ownConfirm: Confirmation | null): PreviewTag[] {
  const node = tree.byKey.get(item.key);
  const result: PreviewTag[] = [];
  const { strengthened } = item;

  if (strengthened.readOnly) {
    const by = ownReadOnly ? null : originFolder(tree, index, node, (folder) => folder.readOnly);
    result.push({ label: tags.readOnly, hint: why.readOnly(why.by(by)), tone: "attention" });
  }
  if (strengthened.confirmCommands !== null) {
    const wanted = confirmationRank(strengthened.confirmCommands);
    const by = confirmationRank(ownConfirm) >= wanted ? null : originFolder(tree, index, node, (folder) => confirmationRank(folder.confirmCommands) >= wanted);
    result.push(strengthened.confirmCommands === "all" ? { label: tags.all, hint: why.all(why.by(by)), tone: "attention" } : { label: tags.irreversible, hint: why.irreversible(why.by(by)), tone: "attention" });
  }
  if (strengthened.environmentName !== null) {
    const by = originFolder(tree, index, node, (folder) => folder.environmentName !== null && folder.environmentName.trim().toLowerCase() === strengthened.environmentName?.trim().toLowerCase());
    result.push({ label: tags.environment(strengthened.environmentName), hint: why.environment(strengthened.environmentName, why.by(by)), tone: "attention" });
  }
  return result;
}

/** As marcas da linha de uma pasta (RN-TRANSF-011): "já existe", o que a importação grava nela, ou "não pode ser importada". */
export function folderTags(tree: CheckTree, index: PreviewIndex, folder: PreviewFolder): PreviewTag[] {
  const invalid = invalidReason(tree, index, folder.key);
  if (invalid !== null) return [{ label: tags.invalid, hint: invalid, tone: "danger" }];

  return [...(folder.existing ? [{ label: tags.existing, hint: tags.existingFolder, tone: "neutral" as const }] : []), ...strengthenedTags(tree, index, folder, folder.readOnly, folder.confirmCommands)];
}

/**
 * As marcas da linha de uma conexão (RN-TRANSF-011): o conflito de nome e o que acontece com ele pela escolha dos conflitos, o que a importação grava nela, a
 * consulta de verificação própria (com ela inteira na dica, e "não mantida" com a caixa desmarcada), ou "não pode ser importada".
 */
export function connectionTags(tree: CheckTree, index: PreviewIndex, connection: PreviewConnection, onConflict: ConflictPolicy, keepQueries: boolean): PreviewTag[] {
  const invalid = invalidReason(tree, index, connection.key);
  if (invalid !== null) return [{ label: tags.invalid, hint: invalid, tone: "danger" }];

  const result: PreviewTag[] = [];
  if (connection.conflict) {
    result.push({ label: tags.existing, hint: tags.existingConnection, tone: "neutral" });
    result.push(onConflict === "skip" ? { label: tags.skipped, hint: tags.existingConnection, tone: "danger" } : { label: tags.renamed(connection.copyName ?? nameOf(connection)), hint: tags.existingConnection, tone: "attention" });
  }
  // Na conexão que não será importada, o que a importação gravaria nela não acontece.
  if (connection.conflict && onConflict === "skip") return result;

  // A prévia não traz as proteções próprias da conexão, só as que valiam nela (`effective`): a origem é a pasta do arquivo que as dava, ou ela mesma.
  result.push(...strengthenedTags(tree, index, connection, false, null));
  if (connection.verificationQuery !== null) {
    const hint = copy.preview.query({ text: connection.verificationQuery, interval: connection.verificationInterval ?? 30, enabled: connection.verificationEnabled !== false, postgres: connection.engine === 1 });
    result.push({ label: keepQueries ? tags.ownQuery : tags.ownQueryDropped, hint, tone: keepQueries ? "attention" : "neutral" });
  }
  return result;
}

/**
 * O que o leitor de tela ouve ao chegar na caixa de uma linha da prévia, além do nome: o caminho de pastas (as "NOMINAL" se repetem em cada ambiente), a
 * segunda linha, o motivo de não poder ser importada e cada marca com a explicação dela, que na tela só aparece na dica do mouse e não se alcança pelo
 * teclado (a consulta de verificação própria inteira, inclusive, que é o que se confere, RN-TRANSF-011).
 */
export function rowDescription(row: { path: string | null; line: string | null; reason: string | null; tags: readonly PreviewTag[] }): string {
  // O motivo já vem na marca "não pode ser importada", que o tem por dica: não se repete.
  const reasonInTags = row.tags.some((tag) => tag.hint === row.reason);
  const parts = [row.path === null ? null : transferCopy.tree.inFolder(row.path), row.line, reasonInTags ? null : row.reason, ...row.tags.map((tag) => `${tag.label}: ${tag.hint}`)];
  return parts
    .filter((part): part is string => part !== null && part !== "")
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");
}

/** O banco da conexão como a etiqueta o escreve, ou nada quando este Prism não o conhece. */
export const engineLabelOf = (connection: PreviewConnection) => (connection.engine === null ? null : engineOption(connection.engine).label);

/** As conexões que podem ser importadas e cujo nome já está tomado no lugar: com alguma, aparece a escolha dos conflitos (RN-TRANSF-011). */
export function conflictCount(tree: CheckTree, preview: ImportPreview): number {
  return preview.connections.filter((connection) => connection.conflict && tree.byKey.get(connection.key)?.selectable === true).length;
}

/** As conexões que podem ser importadas e trazem uma consulta de verificação própria: com alguma, aparece a caixa de mantê-las (RN-TRANSF-011). */
export function ownQueryCount(tree: CheckTree, preview: ImportPreview): number {
  return preview.connections.filter((connection) => connection.verificationQuery !== null && tree.byKey.get(connection.key)?.selectable === true).length;
}

/** A conta do rodapé (RN-TRANSF-011): as conexões marcadas e as pastas que vão, as do caminho inclusive. */
export function importCounter(tree: CheckTree, marked: ReadonlySet<string>): string {
  return copy.counter(markedLeaves(tree, marked).filter((leaf) => leaf.kind === "connection").length, foldersInFile(tree, marked).length);
}

/** As chaves que a tela manda (RN-TRANSF-014): as folhas marcadas (as pastas do caminho de cada uma vão sozinhas), nunca a do que não pode ser importado. */
export function importItems(tree: CheckTree, marked: ReadonlySet<string>): string[] {
  return markedLeaves(tree, marked).map((leaf) => leaf.key);
}

/**
 * O aviso do que aconteceu de fato (RN-TRANSF-014): de sucesso, com as conexões e as pastas criadas e as que mudaram de nome; de atenção quando o "Não
 * importar" deixou conexões de fora; e de atenção quando nada entrou.
 */
export function importToast(result: ImportResult): { tone: "success" | "warning"; message: string } {
  const connections = result.connectionIDs.length;
  const folders = result.folderIDs.length;
  if (connections === 0 && folders === 0) return { tone: "warning", message: copy.toasts.nothing };

  const imported = copy.toasts.imported({ connections, folders, renamed: result.renamed });
  return result.skipped === 0 ? { tone: "success", message: imported } : { tone: "warning", message: `${imported} ${copy.toasts.skipped(result.skipped)}` };
}

/** As recusas da leitura do arquivo, no campo a que se referem (RN-TRANSF-009 e 010), com a frase da tela. `null` para a que não é da leitura. */
export function readRefusal(code: string): { field: "file" | "passphrase" | "destination"; message: string } | null {
  switch (code) {
    case "IMPORT_LIMITS_EXCEEDED":
      return { field: "file", message: copy.fileErrors.limits };
    case "IMPORT_FILE_INVALID":
      return { field: "file", message: copy.fileErrors.invalid };
    case "IMPORT_FILE_NEWER":
      return { field: "file", message: copy.fileErrors.newer };
    case "IMPORT_PASSPHRASE_WRONG":
      return { field: "passphrase", message: copy.passphraseErrors.wrong };
    case "IMPORT_PASSPHRASE_INVALID":
      return { field: "passphrase", message: copy.passphraseErrors.required };
    case "FOLDER_NOT_FOUND":
      return { field: "destination", message: copy.destinationGone };
    default:
      return null;
  }
}
