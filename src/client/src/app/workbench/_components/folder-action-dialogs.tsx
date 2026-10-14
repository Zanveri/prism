import { DeleteFolderDialog } from "@/app/connections/_components/delete-folder-dialog";
import { FolderDialog } from "@/app/connections/_components/folder-dialog";
import type { Folder } from "@/app/connections/_lib/connections.schema";

/**
 * A ação de pasta que o navegador pediu (RN-NAV-003), pelo menu de contexto ou pela barra de ações: criar (na raiz, com `parentID` nulo, ou
 * dentro de uma pasta), editar (o nome e o ambiente, RN-PASTA-006), mover e excluir. São as que a tela de Conexões oferecia.
 */
export type FolderAction = { type: "create"; parentID: string | null } | { type: "edit" | "move" | "delete"; folder: Folder };

/**
 * Os diálogos das ações de pasta, os mesmos que a tela de Conexões usava: o `FolderDialog` (nova pasta, nova subpasta, editar, mover) e o
 * `DeleteFolderDialog` (excluir), que cuidam da própria chamada e dos próprios avisos. Montado ao abrir e desmontado ao fechar, como lá.
 */
export function FolderActionDialogs({ action, folders, onClose }: { action: FolderAction; folders: Folder[]; onClose: () => void }) {
  if (action.type === "delete") return <DeleteFolderDialog folder={action.folder} onClose={onClose} />;

  const state = action.type === "create" ? ({ mode: "create", parentID: action.parentID } as const) : ({ mode: action.type, folder: action.folder } as const);
  return <FolderDialog state={state} folders={folders} onClose={onClose} />;
}
