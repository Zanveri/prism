import { cellAccess, deleteRowAccess, newRowAccess, resultReadOnly, type EditAccess, type RowContext } from "./cell-editing";
import type { GridCell } from "./grid-cursor";
import { editShortcuts, type EditShortcut } from "./grid-editing";
import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit;

/** Os quatro botões da barra de edição, os mesmos itens do menu da célula (RN-EDIT-013). */
export type EditBarAction = "edit" | "newRow" | "duplicateRow" | "deleteRow";

/**
 * Um botão da barra: o texto, o atalho da plataforma (a dica e o `aria-keyshortcuts`), a dica inteira e o motivo de ele não se aplicar agora (nulo quando
 * se aplica). O motivo é o que a dica e o leitor de tela dizem, e o que a faixa diria se a ação fosse tentada.
 */
export type EditBarButton = { id: EditBarAction; label: string; shortcut: EditShortcut; title: string; reason: string | null };

export type EditBarState = {
  /** RN-EDIT-002 e RN-PROT-002: o motivo de o resultado inteiro ser só leitura, pela página ou pela recusa do `edit-target`. */
  readOnly: string | null;
  /**
   * O que o catálogo respondeu; nulo enquanto não se perguntou, e então o que depende dele fica habilitado (RN-EDIT-010): a primeira tentativa pergunta. O
   * que a linha já diz (a marcada para exclusão, a célula cortada ou preenchida pelo banco) vale sem ele.
   */
  target: EditTarget | null;
  /** A aba ocupada (um comando, o Salvar) ou a atualização automática lendo as linhas de novo (`"refresh"`, RN-GRADE-014). */
  busy: boolean | "refresh";
  /** A célula ativa, com a linha dela; nula sem célula ativa. */
  active: { cell: GridCell; row: RowContext } | null;
  /** As linhas da grade, as lidas e as novas. */
  rows: number;
  /** `navigator.platform`: os atalhos do macOS são outros (RN-EDIT-015). */
  platform: string;
};

const reasonOf = (access: EditAccess) => (access.editable ? null : access.reason);

/**
 * RN-EDIT-014: quando cada botão da barra vale, sem custar consulta (RN-EDIT-010): só com o que a tela já sabe. Quando mais de um motivo vale, fica o
 * primeiro, nesta ordem:
 *
 * 1. os quatro, com o resultado inteiro só leitura (o motivo da barra do resultado: o da página, o da conexão somente leitura, o do catálogo quando
 *    nenhuma tabela se edita);
 * 2. os quatro, com a aba ocupada, ou a atualização automática lendo as linhas de novo;
 * 3. "Adicionar linha", "Duplicar linha" e "Excluir linha", quando o catálogo já disse que o resultado não aceita linha nova nem exclusão (a junção, ou o
 *    motivo da tabela);
 * 4. "Editar célula", pelo que vale na célula ativa (`cellAccess`: a tabela e a coluna, quando o catálogo já disse; a linha marcada para exclusão; a
 *    célula ou a chave cortada ou gerada; a junção externa sem linha);
 * 5. "Excluir linha", na linha cuja chave não se sabe e na que já está marcada para exclusão (`deleteRowAccess`);
 * 6. sem nenhuma linha na grade, "O resultado não tem linhas." nos três que agem sobre uma; sem célula ativa, "Escolha uma célula na grade." e "Escolha uma
 *    linha na grade.". "Adicionar linha" continua valendo nos dois.
 */
export function editBar({ readOnly, target, busy, active, rows, platform }: EditBarState): EditBarButton[] {
  const shortcuts = editShortcuts(platform);
  const whole = resultReadOnly(readOnly, target) ?? (busy ? copy.readOnly(busy === "refresh" ? copy.reasons.refreshing : copy.reasons.busy) : null);
  const rowOperations = whole ?? reasonOf(newRowAccess(null, target, false));
  const missing = (choose: string) => (rows === 0 ? copy.bar.noRows : active === null ? choose : null);

  const edit = whole ?? (active === null ? null : reasonOf(cellAccess({ readOnly: null, target, busy: false, column: active.cell.column, row: active.row }))) ?? missing(copy.bar.chooseCell);
  const duplicate = rowOperations ?? missing(copy.bar.chooseRow);
  const remove = rowOperations ?? (active === null ? null : reasonOf(deleteRowAccess(active.row, null, target, false))) ?? missing(copy.bar.chooseRow);

  const button = (id: EditBarAction, label: string, reason: string | null): EditBarButton => {
    const shortcut = shortcuts[id];
    return { id, label, shortcut, title: reason === null ? copy.bar.title(label, shortcut.label) : copy.bar.disabledTitle(label, shortcut.label, reason), reason };
  };

  return [button("edit", copy.menu.edit, edit), button("newRow", copy.menu.newRow, rowOperations), button("duplicateRow", copy.menu.duplicateRow, duplicate), button("deleteRow", copy.menu.deleteRow, remove)];
}
