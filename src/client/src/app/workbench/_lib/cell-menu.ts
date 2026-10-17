import type { AutoRefreshAction } from "./auto-refresh-menu";
import type { EditAccess } from "./cell-editing";
import type { FilterAction } from "./filter-menu";
import { dataExportCopy } from "./data-export/data-export.copy";
import { editShortcuts, type EditShortcut, type RowShortcut } from "./grid-editing";
import { gridSelectionCopy } from "./grid-selection.copy";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit.menu;
const grid = gridSelectionCopy.menu;

/** Os nove "Copiar como", na ordem do print do dono (RN-GRADE-003): os formatos de texto da exportação (seção 35), sem o XLSX, que não é texto. */
export const copyAsFormats = ["csv", "sourceCode", "dbUnit", "html", "json", "markdown", "sql", "txt", "xml"] as const;
export type CopyAsFormat = (typeof copyAsFormats)[number];

/** O submenu "Copiar avançado" que é de outra frente (RN-GRADE-003, 016 e 017): o diálogo, os "Copiar como" de cada formato e a configuração deles. */
export type CopyAsAction = "copyAdvanced" | `copyAs:${CopyAsFormat}` | "copyAsConfigure";

/** Os seis itens do "Gerar SQL", na ordem do print do dono (RN-GRADE-006). */
export const generateSqlKinds = ["selectEquals", "selectIn", "insert", "update", "delete", "create"] as const;
export type GenerateSqlKind = (typeof generateSqlKinds)[number];
export type GenerateSqlAction = `sql:${GenerateSqlKind}`;

/** O "Ordenar" (RN-GRADE-004): crescente, decrescente ou sem ordem, para a coluna da célula ativa. */
export type SortAction = "sort:asc" | "sort:desc" | "sort:none";

export type CellMenuAction =
  | "copy"
  | "copyWithHeader"
  | "advancedCopy"
  | "copyColumnNames"
  | "copyRowNumbers"
  | CopyAsAction
  | "paste"
  | "edit"
  | "setNull"
  | "undo"
  | "newRow"
  | "duplicateRow"
  | "deleteRow"
  | "filter"
  | "sort"
  | SortAction
  | "follow"
  | "refresh"
  | FilterAction
  | "autoRefresh"
  | AutoRefreshAction
  | "exportData"
  | "generateSql"
  | GenerateSqlAction;

/** A ação é de um "Copiar como", do diálogo "Copiar avançado…" ou da configuração deles (a outra frente as executa). */
export const isCopyAsAction = (action: CellMenuAction): action is CopyAsAction => action === "copyAdvanced" || action === "copyAsConfigure" || action.startsWith("copyAs:");

/** A ação é um item do "Gerar SQL" (a outra frente as executa). */
export const isGenerateSqlAction = (action: CellMenuAction): action is GenerateSqlAction => action.startsWith("sql:");

/**
 * Um item do menu da célula. O modelo só descreve; quem executa é a vista Registros, que tem as pendências e a área de transferência. `checked`: o item é
 * uma escolha de um grupo de escolha única (o intervalo da atualização automática), marcada ou não.
 */
export type CellMenuItem = { id: CellMenuAction; label: string; shortcut?: string; disabled?: boolean; hint?: string; text?: string; checked?: boolean; submenu?: { label: string; groups: CellMenuGroup[] } };

/** Os itens entre dois separadores; com `label`, o grupo tem título (o "Valor da célula" do submenu "Filtrar"). */
export type CellMenuGroup = CellMenuItem[] | { label: string; items: CellMenuItem[] };

/**
 * O que os itens do "Copiar avançado" que são de outra frente dizem ao abrir o menu (o diálogo, cada "Copiar como" e a configuração): se valem, ou por quê
 * não. O formato que não está aqui vale.
 */
export type CopyAsAccess = { dialog: EditAccess; formats?: Partial<Record<CopyAsFormat, EditAccess>>; configure: EditAccess };

export type CellMenuState = {
  /** O texto da célula como a grade o mostra (a pendência, quando há), ou nulo. */
  value: string | null;
  /** Se a célula se edita (`cellAccess`), com o motivo quando não. */
  access: EditAccess;
  /** Alguma célula escolhida tem o que desfazer (a alteração pendente; na linha nova, a coluna preenchida). */
  pending: boolean;
  /** Alguma linha escolhida está marcada para exclusão: desfazer a devolve. */
  deletedRow: boolean;
  /** A coluna aceita NULL (o catálogo diz; sem o alvo, aceita). */
  nullable: boolean;
  newRow: EditAccess;
  /** RN-EDIT-016: "Duplicar linha" vale onde "Adicionar linha" vale (`newRowAccess`), para até 1.000 linhas. */
  duplicateRow: EditAccess;
  deleteRow: EditAccess;
  /** RN-GRADE-001: as linhas da seleção; com mais de uma, "Duplicar linhas" e "Excluir linhas". Sem ele, uma. */
  rows?: number;
  /** RN-GRADE-001: mais de uma célula escolhida: "Colar" e "Definir como nulo" valem para uma só. */
  several?: boolean;
  /** Há célula ativa: sem ela, "Copiar" e "Copiar com cabeçalho" pedem uma (RN-GRADE-002). Sem ele, há. */
  hasActive?: boolean;
  /** RN-GRADE-015: "Copiar nome da(s) coluna(s)" e "Copiar número de linha(s)"; sem eles, valem. */
  columnNames?: EditAccess;
  rowNumbers?: EditAccess;
  /** RN-GRADE-003, 016 e 017: os itens do "Copiar avançado" da outra frente; sem eles, o submenu tem só os nomes e os números. */
  copyAs?: CopyAsAccess;
  /** O "Filtrar" (F11) com o submenu dele (`filterMenuItem`), quando a grade tem campo de filtro. */
  filter?: CellMenuItem;
  /** RN-GRADE-004: o "Ordenar" da coluna da célula ativa, com a ordem em uso marcada; sem ele, o menu não o tem (as abas guardadas do script). */
  sort?: { direction: "asc" | "desc" | null; access: EditAccess };
  /** RN-TABELA-007: "Ir para o registro referenciado", numa coluna de chave estrangeira dos Registros; sem ele, o menu não o tem. */
  follow?: EditAccess;
  /** RN-GRADE-012: "Atualizar" (F5); desabilitado com o motivo enquanto algo roda. */
  refresh?: EditAccess;
  /** RN-GRADE-014: "Atualizar automaticamente", com o submenu dos intervalos (`autoRefreshMenuItem`), logo depois do "Atualizar". */
  autoRefresh?: CellMenuItem;
  /** RN-EXPORT-001 e RN-GRADE-004: "Exportar dados…", que abre o assistente com a origem desta grade, no grupo do "Gerar SQL". */
  exportData?: EditAccess;
  /** RN-GRADE-006: os seis itens do "Gerar SQL", da outra frente; o que não está aqui vale. Sem ele, o menu não tem o submenu. */
  generateSql?: Partial<Record<GenerateSqlKind, EditAccess>>;
  /** RN-EDIT-015: os atalhos como a plataforma os escreve (`editShortcuts`), os mesmos das dicas da barra de edição; sem eles, os do Windows e do Linux. */
  shortcuts?: Record<"edit" | RowShortcut, EditShortcut>;
  /** O macOS escreve o Cmd no lugar do Ctrl (o "Copiar" e o "Copiar avançado…"). */
  mac?: boolean;
};

const defaultShortcuts = editShortcuts("");

const hintOf = (access: EditAccess) => (access.editable ? {} : { disabled: true, hint: access.reason });
const allowed: EditAccess = { editable: true };

/**
 * O menu da grade (RN-GRADE-004), nos grupos do menu do DBeaver que o Prism tem, nesta ordem:
 *
 * 1. "Copiar" (Ctrl+C), "Copiar com cabeçalho", o submenu "Copiar avançado" e "Colar" (sem atalho);
 * 2. o submenu "Filtrar" (F11), o submenu "Ordenar" e "Ir para o registro referenciado", quando a grade os tem;
 * 3. "Editar célula" (F2), "Definir como nulo" e "Desfazer alteração";
 * 4. "Adicionar linha", "Duplicar linha(s)" e "Excluir linha(s)";
 * 5. "Exportar dados…" e o submenu "Gerar SQL", quando a grade os tem;
 * 6. "Atualizar" (F5) e o submenu "Atualizar automaticamente", quando a grade os tem.
 *
 * O que não se aplica vem desabilitado, sem sumir, com o motivo; o item que não existe naquele lugar não aparece. Copiar vale sempre, também na célula só
 * leitura; o nulo copia vazio. Os atalhos são os que a grade trata, como a plataforma os escreve.
 */
export function cellMenu(state: CellMenuState): CellMenuItem[][] {
  const shortcuts = state.shortcuts ?? defaultShortcuts;
  const several = state.several === true ? { disabled: true, hint: grid.oneCellOnly } : null;
  const notNullable = several ?? (!state.access.editable ? hintOf(state.access) : state.nullable ? {} : { disabled: true, hint: copy.notNullable });
  const chooseCell = state.hasActive === false ? { disabled: true, hint: gridSelectionCopy.copy.chooseCell } : {};
  const many = (state.rows ?? 1) > 1;

  const advanced: CellMenuGroup[] = [
    [
      ...(state.copyAs === undefined ? [] : [{ id: "copyAdvanced" as const, label: grid.advancedDialog, shortcut: state.mac === true ? grid.advancedShortcutMac : grid.advancedShortcut, ...hintOf(state.copyAs.dialog) }]),
      { id: "copyColumnNames", label: grid.columnNames, ...hintOf(state.columnNames ?? allowed) },
      { id: "copyRowNumbers", label: grid.rowNumbers, ...hintOf(state.rowNumbers ?? allowed) },
    ],
    ...(state.copyAs === undefined
      ? []
      : [
          copyAsFormats.map((format): CellMenuItem => ({ id: `copyAs:${format}`, label: grid.copyAs(dataExportCopy.formats.names[format]), ...hintOf(state.copyAs?.formats?.[format] ?? allowed) })),
          [{ id: "copyAsConfigure" as const, label: grid.configureCopyAs, ...hintOf(state.copyAs.configure) }],
        ]),
  ];

  const sort = state.sort;
  const view: CellMenuItem[] = [
    ...(state.filter === undefined ? [] : [state.filter]),
    ...(sort === undefined
      ? []
      : [
          {
            id: "sort" as const,
            label: grid.sort,
            submenu: {
              label: grid.sort,
              groups: [
                [
                  { id: "sort:asc" as const, label: grid.sortAscending, checked: sort.direction === "asc", ...hintOf(sort.access) },
                  { id: "sort:desc" as const, label: grid.sortDescending, checked: sort.direction === "desc", ...hintOf(sort.access) },
                  { id: "sort:none" as const, label: grid.sortNone, checked: sort.direction === null, ...hintOf(sort.access) },
                ],
              ],
            },
          },
        ]),
    ...(state.follow === undefined ? [] : [{ id: "follow" as const, label: grid.follow, ...hintOf(state.follow) }]),
  ];

  const output: CellMenuItem[] = [
    ...(state.exportData === undefined ? [] : [{ id: "exportData" as const, label: dataExportCopy.entry.menu, disabled: false, ...hintOf(state.exportData) }]),
    ...(state.generateSql === undefined
      ? []
      : [{ id: "generateSql" as const, label: grid.generateSql, submenu: { label: grid.generateSql, groups: [generateSqlKinds.map((kind): CellMenuItem => ({ id: `sql:${kind}`, label: grid.sql[kind], ...hintOf(state.generateSql?.[kind] ?? allowed) }))] } }]),
  ];

  const refresh: CellMenuItem[] = [
    ...(state.refresh === undefined ? [] : [{ id: "refresh" as const, label: copy.refresh, shortcut: "F5", disabled: false, ...hintOf(state.refresh) }]),
    ...(state.autoRefresh === undefined ? [] : [state.autoRefresh]),
  ];

  return [
    [
      { id: "copy", label: grid.copy, shortcut: state.mac === true ? grid.copyShortcutMac : grid.copyShortcut, disabled: false, text: state.value ?? "", ...chooseCell },
      { id: "copyWithHeader", label: grid.copyWithHeader, disabled: false, ...chooseCell },
      { id: "advancedCopy", label: grid.advanced, submenu: { label: grid.advanced, groups: advanced } },
      { id: "paste", label: copy.paste, ...(several ?? hintOf(state.access)) },
    ],
    ...(view.length === 0 ? [] : [view]),
    [
      { id: "edit", label: copy.edit, shortcut: shortcuts.edit.label, ...hintOf(state.access) },
      { id: "setNull", label: copy.setNull, ...notNullable },
      { id: "undo", label: copy.undo, disabled: !state.pending && !state.deletedRow },
    ],
    [
      { id: "newRow", label: copy.newRow, shortcut: shortcuts.newRow.label, ...hintOf(state.newRow) },
      { id: "duplicateRow", label: many ? gridSelectionCopy.rows.duplicate : copy.duplicateRow, shortcut: shortcuts.duplicateRow.label, ...hintOf(state.duplicateRow) },
      { id: "deleteRow", label: many ? gridSelectionCopy.rows.remove : copy.deleteRow, shortcut: shortcuts.deleteRow.label, ...hintOf(state.deleteRow) },
    ],
    ...(output.length === 0 ? [] : [output]),
    ...(refresh.length === 0 ? [] : [refresh]),
  ];
}
