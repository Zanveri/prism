import type { Folder, FolderInput } from "./connections.schema";

/**
 * O corpo do `POST` (sem pasta) ou do `PATCH` (com a pasta que existe) do diálogo de pasta. Cada modo pergunta só uma parte (renomear: o nome e o
 * ambiente; mover: a pasta pai), e o `PATCH` grava a pasta por inteiro (RN-PASTA-005): o que o modo não perguntou vai como a pasta já tem, senão
 * mover tiraria o ambiente dela. Na criação, o que não foi perguntado vai vazio.
 */
export function folderInputOf(existing: Folder | null, asked: Partial<FolderInput>): FolderInput {
  const unchanged: FolderInput = existing === null ? { name: "", parentID: null, environmentName: null, environmentColor: null } : { name: existing.name, parentID: existing.parentID, environmentName: existing.environmentName, environmentColor: existing.environmentColor };
  return { ...unchanged, ...asked };
}
