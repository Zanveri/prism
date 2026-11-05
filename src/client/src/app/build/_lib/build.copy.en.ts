import type { BuildCopy, IdentifierKind } from "./build.copy";

const identifierKinds: Record<IdentifierKind, string> = { table: "table", column: "column", constraint: "constraint", index: "index" };

export const buildCopyEn: BuildCopy = {
  emptyModels: "No model open.",
  emptyModelsHint:
    "Open a saved model or create a new one: its tables appear here, split between the ones you will create and the ones that already exist in the database.",
  sidebarTitle: "Model tables",
  hideSidebarLabel: "Hide model tables",
  showSidebarLabel: "Show model tables",
  hideSidebarTitle: "Collapse model tables (Ctrl+B)",
  showSidebarTitle: "Expand model tables (Ctrl+B)",
  hideEditorLabel: "Hide model editor",
  hideEditorTitle: "Collapse DDL creation panel",
  showEditorLabel: "Show model editor",
  showEditorTitle: "Expand DDL creation panel",
  newTableLabel: "New table",
  newTableTitle: "New table (Alt+N)",
  importTablesLabel: "Import tables from a database",
  filterTablesPlaceholder: "Filter tables and columns",
  newSchemaBadge: "new schema",
  existingSchemaBadge: "existing",
  changedTableBadge: "changed",
  droppedTableBadge: "drop",
  relationsSection: "Relations",
  indexesSection: "Indexes",
  viewProblems: "View problems",
  openModelsNavLabel: "Open models",
  savedModelsLink: "Saved models",
  modelsTitle: "Models",
  modelsSubtitle:
    "Each model keeps the tables, the relations, the indexes and the position of each table in the diagram. It stays in your vault, encrypted like the connections.",
  openFileButton: "Open .sql or .dbml file",
  newModelButton: "New model",
  filterModelsPlaceholder: "Filter models by name or table",
  colModel: "Model",
  colEngine: "Target",
  colStart: "Starting point",
  colTables: "Tables",
  colUpdated: "Changed",
  colActions: "Actions",
  openAction: "Open",
  renameAction: "Rename",
  duplicateAction: "Duplicate",
  exportDbmlAction: "Export DBML",
  exportDdlAction: "Export DDL",
  exportPngAction: "Export diagram",
  deleteModelAction: "Delete model…",
  deleteModelTitle: (name: string) => `Delete the model "${name}"?`,
  deleteModelDescription:
    "The model will be removed from the vault. The tables in the database are not affected.",
  deleteModelConfirm: "Delete model",
  toolbarTarget: "Target",
  toolbarTargetHint: "The target database is chosen when the model is created",
  toolbarBase: "Base",
  toolbarBaseAria: "Base of the existing tables",
  toolbarReread: "Re-read from database",
  toolbarRereadHint: "Re-reads the existing tables from the database; what you changed in them stays",
  toolbarUndo: "Undo (Ctrl+Z)",
  toolbarRedo: "Redo (Ctrl+Shift+Z)",
  toolbarExport: "Export",
  toolbarGenerateDdl: "Generate DDL",
  saveSaved: "Saved to the vault",
  savePending: "Pending changes…",
  saveSaving: "Saving to the vault…",
  saveFailed: "Failed to save to the vault",
  saveConflict: "This model was saved in another window",
  reloadModel: "Reload the saved one",
  keepMineModel: "Keep mine and save over it",
  editorGroupLabel: "Way of editing",
  paneSimple: "Simple",
  paneSql: "SQL",
  paneDbml: "DBML",
  paneSameModelHint: "All three edit the same model",
  footerVaultOpen: (user: string) => `${user}'s vault open`,
  footerSavedModelsCount: (count: number) =>
    `${count} ${count === 1 ? "saved model" : "saved models"}`,
  diagramLabel: "Model diagram",
  diagramTableRemoved: (table: string) => `Table "${table}" removed.`,
  diagramTablesRemoved: (count: number) => `${count} tables removed.`,
  diagramSchemaRemoved: (schema: string) => `Schema "${schema}" removed.`,
  diagramSchemaDropped: (schema: string) => `Schema "${schema}" marked to be dropped in the database.`,
  undoAction: "Undo",
  textApplied: "Applied to the model.",
  textDbmlRebuildNote:
    "When you switch tabs, the text is rebuilt from the model: loose comments and the order you gave are not kept.",
  textErrorLine: (line: number, message: string) => `Line ${line}: ${message}`,
  textErrorDiagramFollows: "The diagram keeps the last valid version.",
  textGoToLine: "Go to line",
  textEditorSqlLabel: "Model SQL editor",
  textEditorDbmlLabel: "Model DBML editor",
  newModelTitle: "New model",
  closeEscLabel: "Close (Esc)",
  modelNameLabel: "Model name",
  startPointLegend: "Starting point",
  startZeroLabel: "From scratch",
  startZeroHint: "An empty model. You choose the target database and create each table.",
  startDatabaseLabel: "From a database",
  startDatabaseHint:
    "Reads the tables of a connection so you can link the new ones to them and change the ones that already exist.",
  targetEngineLegend: "Target database",
  targetEngineHint:
    "The target decides the types the editor suggests, the name limits and the generated DDL. It does not change after creation; for another database, duplicate the model.",
  connectionLabel: "Connection",
  databaseLabel: "Database",
  schemasAndTablesLegend: "Schemas and tables to read",
  markedCount: (checked: number, total: number) => `${checked} of ${total} selected`,
  schemaTablesCount: (checked: number, total: number) =>
    checked > 0 ? `${checked} of ${total} tables` : `${total} ${total === 1 ? "table" : "tables"}`,
  markAllLabel: "Select all",
  unmarkLabel: "Clear selection",
  existingTablesExplain:
    "The selected tables come in as existing: they receive FKs from the new ones and can also be changed. When generating the DDL, you choose whether it brings everything or only the differences.",
  targetSameAsConnection: (engineLabel: string) =>
    `The target is ${engineLabel}, the same database as the connection.`,
  defaultSchemaLabel: "Schema of the new tables",
  createSchemaCheckbox: "Create the schema in the DDL",
  informixSchemaNote:
    "In Informix, which has no schemas, this field is the owner of the tables and the DDL does not include CREATE SCHEMA.",
  readOnlyCatalogNotice: "Prism only reads the catalog. Nothing changes in the database.",
  cancelButton: "Cancel",
  createModelButton: "Create model",
  readingTablesProgress: (done: number, total: number) => `Reading ${done} of ${total} tables…`,
  importTablesTitle: "Import tables from a database",
  importTablesButton: "Import tables",
  alreadyInModelNote: "already in the model",
  changeBaseMenuLabel: "Change the base…",
  changeBaseTitle: "Change the model's base",
  changeBaseConfirm: "Change base and re-read",
  scopeDialogTitle: "What should the DDL include?",
  scopeDialogIntro: (modelName: string, baseLabel: string) =>
    `The model ${modelName} started from ${baseLabel}. The DDL can include only what you changed relative to it, or the whole schema.`,
  scopeChangesLabel: "Only the differences",
  scopeChangesDescription: (baseLabel: string) =>
    `CREATE for the new tables and ALTER for what you changed in the existing ones. Unchanged existing tables are left out. To run on ${baseLabel}.`,
  scopeFullLabel: "Everything",
  scopeFullDescription: (baseLabel: string) =>
    `The whole schema, from scratch: CREATE for all tables, new and existing, as they are in the model. To create in another database; on ${baseLabel} itself, it fails at the first CREATE.`,
  scopeSavedNotice:
    "The choice is saved in the model. You can change it later, at the top of the DDL.",
  ddlBackToDiagram: "Back to the diagram",
  ddlTitlePrefix: "DDL of",
  ddlScopeGroupLabel: "What the DDL includes",
  ddlCopyButton: "Copy",
  ddlCopiedToast: "DDL copied to the clipboard.",
  ddlSaveSqlButton: "Save .sql",
  ddlOpenInWorkbenchButton: "Open in Workspace",
  ddlOpenInWorkbenchHint:
    "Opens a query tab with this script. Nothing runs until you execute it.",
  ddlOptionsGroupLabel: "DDL options",
  ddlOptionConstraintNames: "Constraint names",
  ddlOptionComments: "Comments",
  ddlOptionFkAtEnd: "FKs in ALTER TABLE at the end",
  ddlOptionDropNewFirst: "DROP the new ones before creating",
  ddlReadOnlyLabel: "Generated DDL, read-only",
  ddlProblemsTitle: "Problems",
  ddlProblemsExplain:
    "Warnings do not block the DDL. An error, such as an FK to a column that does not exist, does: the DDL is only produced once it is fixed.",
  ddlIgnoreWarning: "Ignore in this model",
  ddlGoToColumn: "Go to the column",
  ddlNothingChanged: (baseLabel: string) => `Nothing changed relative to ${baseLabel}.`,
  connectionChoiceTitle: "In which connection should the DDL open?",
  connectionChoiceIntro:
    "The script goes to a new query tab. Nothing is run until you tell it to.",
  connectionChoiceBaseNote: "the existing ones are already here",
  connectionChoiceConfirm: "Open in Workspace",
  problems: {
    e1: (target: IdentifierKind) =>
      `The ${identifierKinds[target]} name is empty or has a control character. The database rejects identifiers like that.`,
    e2: (name: string) =>
      `The name ${name} is repeated in the same scope. The database does not allow two objects with the same name.`,
    e3: (table: string) =>
      `The table ${table} has no columns. Every CREATE TABLE requires at least one column.`,
    e4: (table: string, column: string) =>
      `${table}.${column} has no type. Every column needs a type that is valid in the database.`,
    e5: (table: string, ref: string) =>
      `${table} references ${ref}, which does not exist in the model. The database rejects the FK when creating or altering the table.`,
    e6: (table: string, refTable: string) =>
      `The FK in ${table} has a different number of columns than the reference in ${refTable}.`,
    e7: (table: string, refTable: string, cols: string) =>
      `The FK in ${table} points to ${refTable} (${cols}), which is neither a PK nor unique. The database requires a unique constraint on the target.`,
    e8: (table: string, indexName: string) =>
      `The index ${indexName} on ${table} has no columns or references a column that does not exist.`,
    e9: (name: string, maxBytes: number) =>
      `The identifier ${name} exceeds the target database's limit of ${maxBytes} bytes.`,
    e10: (table: string, column: string, type: string) =>
      `${table}.${column} has auto-increment on type ${type}. Only integer types accept identity/serial.`,
    e11: (table: string, action: string) =>
      `The FK in ${table} uses the action ${action}, which this database does not accept.`,
    e12: (table: string, column: string, type: string) =>
      `${table}.${column} uses ${type}. In Informix, varchar goes up to 255 bytes; above that use lvarchar.`,
    e13: (table: string) =>
      `${table} is marked to be dropped, but another table that stays in the model still has an FK to it.`,
    e14: (table: string) =>
      `${table} is an existing table with a change to the PK, auto-increment or schema, which does not fit the automatic ALTER.`,
    w1: (table: string) =>
      `The new table ${table} has no primary key. Without a PK, duplicate rows are not blocked and FKs have nothing to point to.`,
    w2: (
      table: string,
      column: string,
      type: string,
      refTable: string,
      refColumn: string,
      refType: string,
    ) =>
      `${table}.${column} is ${type} and points to ${refTable}.${refColumn}, which is ${refType}. An id above 2,147,483,647 would not fit.`,
    w3: () =>
      `These FK columns do not start any index. Searching by them, or deleting the referenced row, reads the whole table.`,
    w4: (name: string, isInformix: boolean) =>
      isInformix
        ? `The name ${name} needs double quotes; in Informix that requires DELIMIDENT enabled in the session.`
        : `The name ${name} needs double quotes in every query on this database.`,
    w5: (table: string, column: string, type: string, suggestion: string | null) =>
      suggestion
        ? `${table}.${column} uses the type ${type}, outside the standard catalog. Maybe you meant ${suggestion}.`
        : `${table}.${column} uses the type ${type}, outside the database's standard catalog.`,
    w6: (table: string, refTable: string, cols: string) =>
      `The FK in ${table} points to ${refTable} (${cols}), which is not listed as a PK or unique index on the existing table.`,
    w7: (table: string) =>
      `The new table ${table} has the same name as a table that already exists in the database and was not imported into the model.`,
    w10DropTable: (table: string) =>
      `DROP TABLE on ${table} deletes the table and all its rows in the database.`,
    w10DropColumn: (table: string, column: string) =>
      `DROP COLUMN on ${table}.${column} deletes that column's data in the database.`,
    w10NarrowType: (table: string, column: string, fromType: string, toType: string) =>
      `${table}.${column} changes from ${fromType} to ${toType}, which may truncate data or fail if there are larger values.`,
    w11: (table: string, column: string) =>
      `${table}.${column} becomes NOT NULL with no default value. If the table already has rows in the database, the ALTER TABLE fails.`,
    w12: (table: string, refTable: string) =>
      `${table} points to ${refTable}, which is not in the model. In the target database, it must exist before this script.`,
    w14: (table: string, column: string, defaultExpr: string) =>
      `${table}.${column} uses ${defaultExpr}, but the script does not create the corresponding sequence.`,
    i1: (baseLabel: string) =>
      `"Open in Workspace" puts the script in a new ${baseLabel} tab. Nothing runs until you execute it, and the irreversible-statement confirmation applies as in any tab.`,
    i2: (readAt: string) =>
      `The differences are against the read from ${readAt}. If someone changed the database afterwards, re-read before running: what you changed in the model stays.`,
    i3: (baseLabel: string) =>
      `The existing tables are already in ${baseLabel}: there, this script fails at the first CREATE. When opening in Workspace, Prism asks for the connection.`,
  },
};
