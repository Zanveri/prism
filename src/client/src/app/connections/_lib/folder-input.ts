import type { Folder, FolderInput } from "./connections.schema";

/**
 * O corpo do `POST` (sem pasta) ou do `PATCH` (com a pasta que existe) dos diálogos de pasta. Cada um pergunta só uma parte (editar: o nome, a cor e o
 * ambiente; renomear: o nome; mover: a pasta pai), e o `PATCH` grava a pasta por inteiro (RN-PASTA-005 e RN-PASTA-007): o que o diálogo não perguntou
 * vai como a pasta já tem, senão mover ou renomear tirariam o ambiente e a cor dela. Na criação, o que não foi perguntado vai vazio.
 */
export function folderInputOf(existing: Folder | null, asked: Partial<FolderInput>): FolderInput {
  const unchanged: FolderInput = existing === null ? { name: "", parentID: null, color: null, environmentName: null, environmentColor: null } : { name: existing.name, parentID: existing.parentID, color: existing.color, environmentName: existing.environmentName, environmentColor: existing.environmentColor };
  return { ...unchanged, ...asked };
}
