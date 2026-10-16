import { checkTree, foldersInFile, leavesOf, markedLeaves, type CheckTree } from "./check-tree";
import type { Connection, Folder } from "./connections.schema";
import type { CredentialsChoice, ExportRequest } from "./transfer.schema";
import { transferCopy } from "./transfer.copy";

/**
 * O que o diálogo "Exportar conexões" decide (RN-TRANSF-002 a 008), puro e testado. A árvore é a do cofre inteiro (as listas do navegador, sem os filtros
 * dele): o que o filtro esconde também pode ir.
 */

/** Os limites da importação, que a exportação respeita para todo arquivo que o Prism gera voltar pela importação dele (RN-TRANSF-006). */
export const exportLimits = { connections: 2000, folders: 2000, levels: 32 } as const;

/** A árvore de marcar da exportação: as pastas e as conexões do cofre, na ordem do navegador, todas marcáveis. */
export function exportTree(folders: readonly Folder[], connections: readonly Connection[]): CheckTree {
  return checkTree([
    ...folders.map((folder) => ({ key: folder.id, kind: "folder" as const, parentKey: folder.parentID, name: folder.name, selectable: true })),
    ...connections.map((connection) => ({ key: connection.id, kind: "connection" as const, parentKey: connection.folderID, name: connection.name, selectable: true })),
  ]);
}

/** De onde o diálogo foi aberto (RN-TRANSF-001): a conexão (só ela marcada), a pasta (ela e tudo o que está dentro), ou o espaço vazio (nada). */
export type ExportOrigin = { type: "connection"; id: string } | { type: "folder"; id: string } | { type: "all" };

/** As marcas com que o diálogo abre (RN-TRANSF-001), e a linha até onde ele rola. */
export function initialMarks(tree: CheckTree, origin: ExportOrigin): { marked: Set<string>; scrollTo: string | null } {
  if (origin.type === "all") return { marked: new Set(), scrollTo: null };
  return { marked: new Set(leavesOf(tree, origin.id).map((leaf) => leaf.key)), scrollTo: tree.byKey.has(origin.id) ? origin.id : null };
}

type Credentials = Pick<Connection, "userName" | "hasPassword">;

/**
 * As escolhas que a conexão oferece (RN-TRANSF-003): só o que ela tem gravado. Sem usuário (a conexão que a importação trouxe sem ele, RN-TRANSF-015), só "Sem
 * usuário e senha"; com usuário e sem senha, não há "Usuário e senha".
 */
export function credentialsOffered(connection: Credentials): CredentialsChoice[] {
  if (connection.userName === "") return ["none"];
  return connection.hasPassword ? ["none", "user", "userAndPassword"] : ["none", "user"];
}

/** A escolha mais perto da pedida que a conexão tem: "Usuário e senha" vira "Só o usuário" na conexão sem senha, e "Sem usuário e senha" na sem usuário. */
export function closestCredentials(choice: CredentialsChoice, connection: Credentials): CredentialsChoice {
  const offered = credentialsOffered(connection);
  if (offered.includes(choice)) return choice;
  return choice === "userAndPassword" && offered.includes("user") ? "user" : "none";
}

/** A escolha de uma conexão: a guardada (o padrão é "Sem usuário e senha", o mais seguro), dentro do que ela tem. */
export function credentialsOf(choices: ReadonlyMap<string, CredentialsChoice>, connection: Credentials & { id: string }): CredentialsChoice {
  return closestCredentials(choices.get(connection.id) ?? "none", connection);
}

/**
 * Os botões "Para as marcadas:" (RN-TRANSF-003): a escolha em todas as conexões marcadas, ou só nas que a busca mostra, cada uma com o mais perto que ela tem.
 * As desmarcadas guardam o que tinham.
 */
export function applyToMarked(choices: ReadonlyMap<string, CredentialsChoice>, choice: CredentialsChoice, targets: readonly (Credentials & { id: string })[]): Map<string, CredentialsChoice> {
  const next = new Map(choices);
  for (const connection of targets) next.set(connection.id, closestCredentials(choice, connection));
  return next;
}

/** O que vai no arquivo, para a conta do rodapé, o aviso das senhas, o pedido e os limites. */
export type ExportSelection = {
  /** As conexões marcadas, na ordem da árvore. */
  connections: Connection[];
  /** As pastas vazias marcadas. */
  folderIDs: string[];
  /** As conexões marcadas que levam a senha gravada ("Usuário e senha" numa conexão com senha). */
  withPassword: Connection[];
  /** As pastas que vão no arquivo, as do caminho inclusive. */
  foldersInFile: number;
  /** O nível mais fundo dessas pastas, contado da raiz do navegador (a pasta da raiz é o nível 1). */
  deepestLevel: number;
};

export function exportSelection(tree: CheckTree, marked: ReadonlySet<string>, choices: ReadonlyMap<string, CredentialsChoice>, connectionsById: ReadonlyMap<string, Connection>): ExportSelection {
  const leaves = markedLeaves(tree, marked);
  const connections = leaves.flatMap((leaf) => {
    const connection = leaf.kind === "connection" ? connectionsById.get(leaf.key) : undefined;
    return connection === undefined ? [] : [connection];
  });
  const inFile = foldersInFile(tree, marked);
  return {
    connections,
    folderIDs: leaves.filter((leaf) => leaf.kind === "folder").map((leaf) => leaf.key),
    withPassword: connections.filter((connection) => credentialsOf(choices, connection) === "userAndPassword"),
    foldersInFile: inFile.length,
    deepestLevel: inFile.reduce((deepest, folder) => Math.max(deepest, folder.depth + 1), 0),
  };
}

/** Nada marcado: "Exportar…" fica desabilitado, com a dica (RN-TRANSF-002). */
export const isEmptySelection = (selection: ExportSelection) => selection.connections.length === 0 && selection.folderIDs.length === 0;

/**
 * Os limites que a tela já sabe conferir (as contagens e os níveis, RN-TRANSF-006): passou deles, o diálogo diz a frase de `EXPORT_LIMITS_EXCEEDED` sem pedir
 * nada à API, nem a senha do Prism. O tamanho só se sabe com o arquivo montado, e é a API que o confere.
 */
export function exceedsLimits(selection: ExportSelection): boolean {
  return selection.connections.length > exportLimits.connections || selection.foldersInFile > exportLimits.folders || selection.deepestLevel > exportLimits.levels;
}

/** A conta do rodapé, com papel de estado (RN-TRANSF-002). */
export function exportCounter(selection: ExportSelection): string {
  return transferCopy.export.counter(selection.connections.length, selection.withPassword.length, selection.foldersInFile);
}

/** A frase do "Confirme a sua senha" (RN-TRANSF-005): "Exportar 3 conexões com a senha", ou, com uma só, "Exportar DATA FIX com a senha". */
export function userPasswordChange(selection: ExportSelection): string {
  return transferCopy.export.userPassword.change(selection.withPassword.length, selection.withPassword[0]?.name ?? null);
}

/**
 * O corpo do pedido (RN-TRANSF-008): as pastas vazias marcadas (as do caminho de cada item vão sozinhas), as conexões marcadas com a escolha de cada uma
 * (dentro do que ela tem), a senha de exportação já na forma NFC e, só quando pedida, a senha do Prism.
 */
export function exportRequestOf(selection: ExportSelection, choices: ReadonlyMap<string, CredentialsChoice>, passphrase: string, userPassword?: string): ExportRequest {
  return {
    folderIDs: selection.folderIDs,
    connections: selection.connections.map((connection) => ({ id: connection.id, credentials: credentialsOf(choices, connection) })),
    passphrase,
    ...(userPassword === undefined ? {} : { userPassword }),
  };
}

/**
 * O nome sugerido do arquivo (RN-TRANSF-007), com a data do dia na máquina: `conexoes-prism-2026-10-16.prismconexoes`. Nunca leva nome de pasta, de conexão
 * ou de servidor: o nome do arquivo fica à vista em todo lugar por onde ele passa.
 */
export function exportFileName(now: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `conexoes-prism-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.prismconexoes`;
}

/** O tipo do arquivo entregue ao diálogo de salvar: um binário qualquer, para o sistema não trocar a extensão (RN-TRANSF-007). */
export const exportFileType = "application/octet-stream";
