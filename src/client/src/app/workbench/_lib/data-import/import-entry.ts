import type { ObjectKind } from "../object-kind";
import { dataImportCopy } from "./data-import.copy";

const copy = dataImportCopy.entry;

/**
 * RN-IMPORT-001: por que o "Importar…" dos Registros não vale agora (nulo quando vale). A conexão somente leitura, pela opção dela ou de uma pasta acima
 * (`readOnly`, a dica do cadeado, `readOnlyHintOf`), e a visão, que a aba sabe pelas listas do navegador (`objectKindOf`). O tipo que a aba não sabe
 * (`unknown`) não desabilita: a recusa, se vier, vem no Mapeamento. A conexão desconectada, as alterações não salvas e a aba ocupada também não.
 */
export function importBlockerOf(readOnly: string | null, kind: ObjectKind): string | null {
  if (readOnly !== null) return copy.readOnly;
  if (kind === "view") return copy.view;
  return null;
}
