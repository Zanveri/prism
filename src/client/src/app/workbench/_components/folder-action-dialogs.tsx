import { DeleteFolderDialog } from "@/app/connections/_components/delete-folder-dialog";
import { FolderDialog } from "@/app/connections/_components/folder-dialog";
import { RenameFolderDialog } from "@/app/connections/_components/rename-folder-dialog";
import type { Folder } from "@/app/connections/_lib/connections.schema";

/**
 * A ação de pasta que o navegador pediu (RN-NAV-003), pelo menu de contexto ou pela barra de ações: criar (na raiz, com `parentID` nulo, ou
 * dentro de uma pasta), renomear (só o nome, também pelo F2, RN-NAV-009), editar (o nome, a cor e o ambiente, RN-PASTA-006), mover e excluir.
 */
export type FolderAction = { type: "create"; parentID: string | null } | { type: "rename" | "edit" | "move" | "delete"; folder: Folder };

/**
 * Os diálogos das ações de pasta: o `FolderDialog` (nova pasta, nova subpasta, editar, mover), o `RenameFolderDialog` (renomear) e o
 * `DeleteFolderDialog` (excluir), que cuidam da própria chamada e dos próprios avisos. Montado ao abrir e desmontado ao fechar. `onMoved` avisa que a pasta
 * foi movida, para o navegador deixá-la à vista (RN-NAV-014).
 */
export function FolderActionDialogs({ action, folders, onClose, onMoved }: { action: FolderAction; folders: Folder[]; onClose: () => void; onMoved?: (folder: Folder) => void }) {
  if (action.type === "delete") return <DeleteFolderDialog folder={action.folder} onClose={onClose} />;
  if (action.type === "rename") return <RenameFolderDialog folder={action.folder} onClose={onClose} />;

  const state = action.type === "create" ? ({ mode: "create", parentID: action.parentID } as const) : ({ mode: action.type, folder: action.folder } as const);
  return <FolderDialog state={state} folders={folders} onClose={onClose} onMoved={onMoved} />;
}
