import type { Folder, FolderInput } from "./connections.schema";

/**
 * O corpo do `POST` (sem pasta) ou do `PATCH` (com a pasta que existe) dos diálogos de pasta. Cada um pergunta só uma parte (editar: o nome, a cor, o
 * ambiente e as proteções; renomear: o nome; mover: a pasta pai), e o `PATCH` grava a pasta por inteiro (RN-PASTA-005, RN-PASTA-007 e RN-PROT-001 a 003): o
 * que o diálogo não perguntou vai como a pasta já tem, senão mover ou renomear tirariam o ambiente, a cor e as proteções dela (sem `confirmCommands`, a
 * confirmação voltaria a "Não"; sem `readOnly`, o somente leitura sairia, e a API pediria a senha). Na criação, o que não foi perguntado vai vazio, sem
 * proteção.
 */
export function folderInputOf(existing: Folder | null, asked: Partial<FolderInput>): FolderInput {
  const unchanged: FolderInput =
    existing === null
      ? { name: "", parentID: null, color: null, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false }
      : {
          name: existing.name,
          parentID: existing.parentID,
          color: existing.color,
          environmentName: existing.environmentName,
          environmentColor: existing.environmentColor,
          confirmCommands: existing.confirmCommands,
          readOnly: existing.readOnly,
          ...(existing.useInternalDescriptions !== undefined ? { useInternalDescriptions: existing.useInternalDescriptions } : {}),
        };
  const merged: FolderInput = { ...unchanged, ...asked };
  if (merged.useInternalDescriptions === undefined) {
    delete merged.useInternalDescriptions;
  }
  return merged;
}
