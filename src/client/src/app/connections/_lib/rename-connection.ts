import type { ApiError } from "@/lib/api/prism-api";
import { apiFieldErrors, type FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "./connections.copy";
import type { Connection, ConnectionInput } from "./connections.schema";
import { movedConnectionInput } from "./move-connection";

/**
 * O pedido de renomear uma conexão pelo navegador (RN-NAV-009). O `PATCH` leva a conexão por inteiro, então vai como está, na mesma pasta, só
 * com o nome novo; a senha nula mantém a gravada (RN-CONN-004), e com o host e a porta de sempre nada mais muda.
 */
export function renamedConnectionInput(connection: Connection, name: string): ConnectionInput {
  return { ...movedConnectionInput(connection, connection.folderID), name };
}

/**
 * As recusas do renomear no campo do nome (RN-NAV-009: no próprio diálogo): o nome repetido na pasta (RN-CONN-011) e o 422 do nome. Um 422 de
 * outro campo (a senha, se o host mudou por outra janela) volta com o campo dele, que o diálogo não mostra: quem chama avisa pelo título.
 */
export function renameRefusalFields(error: ApiError): FieldErrors {
  if (error.code === "CONNECTION_ALREADY_EXISTS") return { name: connectionsCopy.rename.nameTaken };

  const fields = apiFieldErrors(error.errors);
  return Object.keys(fields).length > 0 ? fields : { name: error.title };
}
