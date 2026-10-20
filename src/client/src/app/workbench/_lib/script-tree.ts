import { byName } from "@/app/connections/_lib/connection-tree";
import type { SelectOption } from "@/components/ui/select";

import { hasControlCharacter, normalizeScriptName } from "./saved-scripts";
import type { ScriptFolder, ScriptSummary } from "./scripts.schema";

/**
 * O que a tela decide sobre as pastas de scripts (seção 33 da especificação, RN-SCRIPT-007 a 010), sem tocar a página nem a API: a árvore da seção Scripts,
 * as linhas à vista e o teclado dela, o nome da pasta (as regras da API, para o diálogo dizer o problema antes de enviar; quem decide é a API), o caminho de
 * uma pasta, as escolhas do campo "Pasta" e a pasta que o diálogo do nome traz escolhida.
 */

/** RN-SCRIPT-007: o mesmo limite das pastas de conexões (RN-PASTA-001). */
export const maxScriptFolderNameLength = 60;

/** O que há direto dentro de uma pasta: é o que impede a exclusão (RN-SCRIPT-007). */
export type FolderContents = { folders: number; scripts: number };

/**
 * Uma linha da árvore. A chave leva o tipo, porque a pasta e o script podem ter o mesmo nome e vivem no mesmo nível. `parentKey` é a pasta acima (nula na
 * raiz): a seta para a esquerda vai a ela.
 */
export type ScriptTreeNode =
  | { kind: "folder"; key: string; folder: ScriptFolder; depth: number; parentKey: string | null; children: ScriptTreeNode[]; contents: FolderContents }
  | { kind: "script"; key: string; script: ScriptSummary; depth: number; parentKey: string | null };

export const folderKey = (id: string) => `folder:${id}`;
export const scriptKey = (id: string) => `script:${id}`;

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const group = key(item);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return groups;
}

/** RN-SCRIPT-007: as subpastas e os scripts que estão direto dentro da pasta, pelas duas listas, como a API conta. */
export function folderContents(folders: readonly ScriptFolder[], scripts: readonly ScriptSummary[], id: string): FolderContents {
  return { folders: folders.filter((folder) => folder.parentID === id).length, scripts: scripts.filter((script) => script.folderID === id).length };
}

/**
 * RN-SCRIPT-008: a árvore da seção Scripts. Em cada nível, as subpastas primeiro e depois os scripts, cada grupo por nome, na ordem do português sem diferenciar
 * maiúsculas (o `byName` da árvore das conexões). A pasta ou o script cuja pasta não está na lista (outra janela a excluiu entre duas leituras) vai para a
 * raiz, até a leitura seguinte: o que ficou sem lugar não some. Pastas em ciclo (a API não deixa criá-las) não têm como chegar à raiz e não aparecem.
 */
export function buildScriptTree(folders: readonly ScriptFolder[], scripts: readonly ScriptSummary[]): ScriptTreeNode[] {
  const folderIDs = new Set(folders.map((folder) => folder.id));
  const existing = (id: string | null) => (id !== null && folderIDs.has(id) ? id : null);

  const foldersByParent = groupBy(folders, (folder) => existing(folder.parentID));
  const scriptsByFolder = groupBy(scripts, (script) => existing(script.folderID));

  function level(parentID: string | null, depth: number): ScriptTreeNode[] {
    const parentKey = parentID === null ? null : folderKey(parentID);
    return [
      ...[...(foldersByParent.get(parentID) ?? [])].sort(byName).map(
        (folder): ScriptTreeNode => ({ kind: "folder", key: folderKey(folder.id), folder, depth, parentKey, children: level(folder.id, depth + 1), contents: folderContents(folders, scripts, folder.id) }),
      ),
      ...[...(scriptsByFolder.get(parentID) ?? [])].sort(byName).map((script): ScriptTreeNode => ({ kind: "script", key: scriptKey(script.id), script, depth, parentKey })),
    ];
  }

  return level(null, 0);
}

/** Uma linha à vista: o nó e, na pasta que tem alguma coisa dentro, se ela está aberta (a pasta vazia não tem a seta de abrir, e não diz nada). */
export type ScriptTreeRow = { node: ScriptTreeNode; expanded: boolean | null };

/** RN-SCRIPT-008: as linhas à vista, na ordem da árvore. `collapsed` são as chaves das pastas fechadas: as pastas começam abertas. */
export function visibleScriptRows(tree: readonly ScriptTreeNode[], collapsed: ReadonlySet<string>): ScriptTreeRow[] {
  return tree.flatMap((node): ScriptTreeRow[] => {
    if (node.kind === "script") return [{ node, expanded: null }];
    if (node.children.length === 0) return [{ node, expanded: null }];
    const open = !collapsed.has(node.key);
    return [{ node, expanded: open }, ...(open ? visibleScriptRows(node.children, collapsed) : [])];
  });
}

/** O que uma tecla de navegação faz na árvore: leva o foco a outra linha, ou abre ou fecha uma pasta. `null`: a tecla não é de navegação, ou não faz nada ali. */
export type ScriptTreeMove = { focus: number } | { toggle: string };

/**
 * RN-SCRIPT-008: as setas para cima e para baixo andam pelas linhas à vista, sem dar a volta; Home e End vão à primeira e à última. A seta para a direita abre
 * a pasta fechada e, na aberta, vai à primeira linha dentro dela. A seta para a esquerda fecha a pasta aberta e, na fechada ou num script, vai à pasta pai (na
 * raiz, não faz nada).
 */
export function scriptTreeMove(key: string, rows: readonly ScriptTreeRow[], index: number): ScriptTreeMove | null {
  if (rows.length === 0 || index < 0 || index >= rows.length) return null;
  if (key === "ArrowDown") return { focus: Math.min(index + 1, rows.length - 1) };
  if (key === "ArrowUp") return { focus: Math.max(index - 1, 0) };
  if (key === "Home") return { focus: 0 };
  if (key === "End") return { focus: rows.length - 1 };

  const { node, expanded } = rows[index];
  if (key === "ArrowRight") {
    if (expanded === false) return { toggle: node.key };
    return expanded === true ? { focus: index + 1 } : null;
  }
  if (key === "ArrowLeft") {
    if (expanded === true) return { toggle: node.key };
    const parent = node.parentKey === null ? -1 : rows.findIndex((row) => row.node.key === node.parentKey);
    return parent < 0 ? null : { focus: parent };
  }
  return null;
}

/** Os nomes que o type-ahead compara (RN-ARVORE-009), um por linha à vista: o da pasta ou o do script, sem a marca do genérico. */
export const scriptTreeLabels = (rows: readonly ScriptTreeRow[]): string[] => rows.map(({ node }) => (node.kind === "folder" ? node.folder.name : node.script.name));

/** O que a linha faz com as outras teclas: Enter (a pasta abre e fecha, o script abre), F2 renomeia, Delete exclui, Shift+F10 e a tecla de menu abrem o menu. */
export function scriptTreeRowKey(event: { key: string; shiftKey: boolean }): "enter" | "rename" | "delete" | "menu" | null {
  if (event.key === "Enter") return "enter";
  if (event.key === "F2") return "rename";
  if (event.key === "Delete") return "delete";
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) return "menu";
  return null;
}

export type ScriptFolderNameProblem = "empty" | "tooLong" | "control" | "taken";

/**
 * RN-SCRIPT-007: de 1 a 60 caracteres depois de normalizado (como o nome do script), sem caractere de controle no que foi digitado (a tabulação não vira
 * espaço) e único entre as irmãs, sem diferenciar maiúsculas. `ownId` é a pasta que está sendo renomeada: o nome dela não colide com ela mesma.
 */
export function scriptFolderNameProblem(name: string, folders: readonly ScriptFolder[], parentID: string | null, ownId?: string): ScriptFolderNameProblem | null {
  if (hasControlCharacter(name)) return "control";

  const normalized = normalizeScriptName(name);
  if (normalized.length === 0) return "empty";
  if (normalized.length > maxScriptFolderNameLength) return "tooLong";
  const upper = normalized.toUpperCase();
  return folders.some((folder) => folder.id !== ownId && folder.parentID === parentID && folder.name.toUpperCase() === upper) ? "taken" : null;
}

/** A recusa do nome da API como o problema que o campo mostra. O nome inválido diz o problema que a conferência da tela acha; sem nenhum, o mais geral. */
export function scriptFolderRefusal(code: string, name: string): ScriptFolderNameProblem | null {
  if (code === "SCRIPT_FOLDER_ALREADY_EXISTS") return "taken";
  if (code === "SCRIPT_FOLDER_NAME_INVALID") return scriptFolderNameProblem(name, [], null) ?? "empty";
  return null;
}

/** O caminho da pasta, da raiz até ela, como a tela o escreve ("Fechamento / Mensal"); `null` na raiz e na pasta que não está na lista. A subida para num ciclo. */
export function scriptFolderPath(folders: readonly ScriptFolder[], id: string | null): string | null {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const visited = new Set<string>();
  for (let current = id; current !== null && !visited.has(current); ) {
    visited.add(current);
    const folder = byId.get(current);
    if (folder === undefined) break;
    names.unshift(folder.name);
    current = folder.parentID;
  }
  return names.length === 0 ? null : names.join(" / ");
}

/** As chaves das pastas acima de um nó, para abri-las: o que acabou de ser criado, renomeado ou movido fica à vista (RN-SCRIPT-008). */
export function ancestorKeys(folders: readonly ScriptFolder[], parentID: string | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const keys: string[] = [];
  for (let current = parentID; current !== null && !keys.includes(folderKey(current)); current = byId.get(current)?.parentID ?? null) keys.push(folderKey(current));
  return keys;
}

/**
 * RN-SCRIPT-009 e 010: as escolhas do campo "Pasta" (a do "Mover para…" e a do diálogo do nome): as pastas de scripts, cada uma com o caminho inteiro, na ordem
 * da árvore. "Sem pasta" (a raiz) é o placeholder do `Select`, de valor vazio. Para mover uma pasta (`exclude`), a lista não traz ela mesma nem as subpastas
 * dela.
 */
export function scriptFolderOptions(folders: readonly ScriptFolder[], exclude?: string): SelectOption[] {
  function walk(nodes: readonly ScriptTreeNode[], parents: string): SelectOption[] {
    return nodes.flatMap((node) => (node.kind !== "folder" || node.folder.id === exclude ? [] : [{ value: node.folder.id, label: parents + node.folder.name }, ...walk(node.children, `${parents}${node.folder.name} / `)]));
  }
  return walk(buildScriptTree(folders, []), "");
}

/**
 * RN-SCRIPT-010: a pasta que o diálogo do nome traz escolhida (o valor do campo; vazio é "Sem pasta"). No "Salvar como", a pasta em que o script de onde a aba
 * veio está na lista. No Ctrl+S do script que outra janela excluiu, que pede o nome de novo, a que a aba lembra de quando o abriu ou o gravou (`remembered`).
 * "Sem pasta" na aba que não veio de um script, quando a pasta não é sabida e quando ela não existe mais.
 */
export function initialSaveFolder(source: { scriptId: string | null; remembered: string | null }, scripts: readonly ScriptSummary[], folders: readonly ScriptFolder[]): string {
  if (source.scriptId === null) return "";
  const listed = scripts.find((script) => script.id === source.scriptId);
  const folderID = listed === undefined ? source.remembered : listed.folderID;
  return folderID !== null && folders.some((folder) => folder.id === folderID) ? folderID : "";
}
