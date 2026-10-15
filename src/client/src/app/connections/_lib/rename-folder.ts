import type { ApiError } from "@/lib/api/prism-api";
import { apiFieldErrors, type FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "./connections.copy";
import type { Folder, FolderInput } from "./connections.schema";
import { folderInputOf } from "./folder-input";

/**
 * O pedido do "Renomear" da pasta (RN-NAV-009: F2 na linha, ou o menu). O `PATCH` grava a pasta por inteiro, então ela vai como está, na mesma pasta pai,
 * com a cor (RN-PASTA-007) e o ambiente (RN-PASTA-005) de sempre, só com o nome novo.
 */
export function renamedFolderInput(folder: Folder, name: string): FolderInput {
  return folderInputOf(folder, { name });
}

/**
 * As recusas do "Renomear" no campo do nome (RN-NAV-009: no próprio diálogo, como no da conexão): o nome repetido entre as irmãs (RN-PASTA-002) e o 422 do
 * nome. Um 422 de outro campo (a cor ou o ambiente que outra janela gravou fora da regra) volta com o campo dele, que o diálogo não mostra: quem chama avisa
 * pelo título.
 */
export function renameFolderRefusalFields(error: ApiError): FieldErrors {
  if (error.code === "FOLDER_ALREADY_EXISTS") return { name: connectionsCopy.folder.rename.nameTaken };

  const fields = apiFieldErrors(error.errors);
  return Object.keys(fields).length > 0 ? fields : { name: error.title };
}
