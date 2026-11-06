import type { BuildCopy, IdentifierKind } from "./build.copy";

const identifierKinds: Record<IdentifierKind, string> = { table: "la tabla", column: "la columna", constraint: "la restricción", index: "el índice" };

export const buildCopyEs: BuildCopy = {
  emptyModels: "Ningún modelo abierto.",
  emptyModelsHint:
    "Abre un modelo guardado o crea uno nuevo: sus tablas aparecen aquí, separadas entre las que vas a crear y las que ya existen en la base de datos.",
  sidebarTitle: "Tablas del modelo",
  hideSidebarLabel: "Ocultar tablas del modelo",
  showSidebarLabel: "Mostrar tablas del modelo",
  hideSidebarTitle: "Contraer tablas del modelo (Ctrl+B)",
  showSidebarTitle: "Expandir tablas del modelo (Ctrl+B)",
  hideEditorLabel: "Ocultar editor del modelo",
  hideEditorTitle: "Contraer panel de creación de DDL",
  showEditorLabel: "Mostrar editor del modelo",
  showEditorTitle: "Expandir panel de creación de DDL",
  newTableLabel: "Nueva tabla",
  newTableTitle: "Nueva tabla (Alt+N)",
  importTablesLabel: "Importar tablas de una base de datos",
  filterTablesPlaceholder: "Filtrar tablas y columnas",
  newSchemaBadge: "esquema nuevo",
  existingSchemaBadge: "existente",
  changedTableBadge: "modificada",
  droppedTableBadge: "eliminar",
  relationsSection: "Relaciones",
  indexesSection: "Índices",
  viewProblems: "Ver problemas",
  openModelsNavLabel: "Modelos abiertos",
  savedModelsLink: "Modelos guardados",
  modelsTitle: "Modelos",
  modelsSubtitle:
    "Cada modelo guarda las tablas, las relaciones, los índices y la posición de cada tabla en el diagrama. Queda en tu caja fuerte, cifrado como las conexiones.",
  openFileButton: "Abrir archivo .sql o .dbml",
  newModelButton: "Nuevo modelo",
  filterModelsPlaceholder: "Filtrar modelos por nombre o por tabla",
  colModel: "Modelo",
  colEngine: "Destino",
  colStart: "Punto de partida",
  colTables: "Tablas",
  colUpdated: "Modificado",
  colActions: "Acciones",
  openAction: "Abrir",
  renameAction: "Renombrar",
  duplicateAction: "Duplicar",
  exportDbmlAction: "Exportar DBML",
  exportDdlAction: "Exportar DDL",
  exportPngAction: "Exportar diagrama",
  deleteModelAction: "Eliminar modelo…",
  deleteModelTitle: (name: string) => `¿Eliminar el modelo "${name}"?`,
  deleteModelDescription:
    "El modelo se quitará de la caja fuerte. Las tablas de la base de datos no se ven afectadas.",
  deleteModelConfirm: "Eliminar modelo",
  toolbarTarget: "Destino",
  toolbarTargetHint: "La base de datos de destino se elige al crear el modelo",
  toolbarBase: "Base",
  toolbarBaseAria: "Base de las tablas existentes",
  toolbarReread: "Releer de la base de datos",
  toolbarRereadHint: "Relee las tablas existentes de la base de datos; lo que cambiaste en ellas se mantiene",
  toolbarUndo: "Deshacer (Ctrl+Z)",
  toolbarRedo: "Rehacer (Ctrl+Shift+Z)",
  toolbarExport: "Exportar",
  toolbarGenerateDdl: "Generar DDL",
  saveSaved: "Guardado en la caja fuerte",
  savePending: "Cambios pendientes…",
  saveSaving: "Guardando en la caja fuerte…",
  saveFailed: "Error al guardar en la caja fuerte",
  saveConflict: "Este modelo se guardó en otra ventana",
  reloadModel: "Recargar el guardado",
  keepMineModel: "Mantener el mío y guardar encima",
  editorGroupLabel: "Forma de editar",
  paneSimple: "Simplificado",
  paneSql: "SQL",
  paneDbml: "DBML",
  paneSameModelHint: "Las tres editan el mismo modelo",
  footerVaultOpen: (user: string) => `Caja fuerte de ${user} abierta`,
  footerSavedModelsCount: (count: number) =>
    `${count} ${count === 1 ? "modelo guardado" : "modelos guardados"}`,
  diagramLabel: "Diagrama del modelo",
  diagramTableRemoved: (table: string) => `Tabla "${table}" eliminada.`,
  diagramTablesRemoved: (count: number) => `${count} tablas eliminadas.`,
  diagramSchemaRemoved: (schema: string) => `Esquema "${schema}" eliminado.`,
  diagramSchemaDropped: (schema: string) => `Esquema "${schema}" marcado para eliminarse en la base de datos.`,
  undoAction: "Deshacer",
  textApplied: "Aplicado al modelo.",
  textDbmlRebuildNote:
    "Al cambiar de pestaña, el texto se rehace a partir del modelo: los comentarios sueltos y el orden que diste no se conservan.",
  textErrorLine: (line: number, message: string) => `Línea ${line}: ${message}`,
  textErrorDiagramFollows: "El diagrama sigue con la última versión válida.",
  textGoToLine: "Ir a la línea",
  textEditorSqlLabel: "Editor SQL del modelo",
  textEditorDbmlLabel: "Editor DBML del modelo",
  newModelTitle: "Nuevo modelo",
  closeEscLabel: "Cerrar (Esc)",
  modelNameLabel: "Nombre del modelo",
  startPointLegend: "Punto de partida",
  startZeroLabel: "Desde cero",
  startZeroHint: "Un modelo vacío. Tú eliges la base de datos de destino y creas cada tabla.",
  startDatabaseLabel: "A partir de una base de datos",
  startDatabaseHint:
    "Lee las tablas de una conexión para que enlaces las nuevas con ellas y modifiques las que ya existen.",
  targetEngineLegend: "Base de datos de destino",
  targetEngineHint:
    "El destino decide los tipos que sugiere el editor, los límites de nombre y el DDL generado. No cambia después de creado; para otra base de datos, duplica el modelo.",
  connectionLabel: "Conexión",
  databaseLabel: "Base de datos",
  schemasAndTablesLegend: "Esquemas y tablas para leer",
  markedCount: (checked: number, total: number) => `${checked} de ${total} marcadas`,
  schemaTablesCount: (checked: number, total: number) =>
    checked > 0 ? `${checked} de ${total} tablas` : `${total} ${total === 1 ? "tabla" : "tablas"}`,
  markAllLabel: "Marcar todas",
  unmarkLabel: "Desmarcar",
  existingTablesExplain:
    "Las tablas marcadas entran como existentes: reciben FKs de las nuevas y también pueden modificarse. Al generar el DDL, eliges si trae todo o solo las diferencias.",
  targetSameAsConnection: (engineLabel: string) =>
    `El destino es ${engineLabel}, la misma base de datos de la conexión.`,
  defaultSchemaLabel: "Esquema de las tablas nuevas",
  createSchemaCheckbox: "Crear el esquema en el DDL",
  informixSchemaNote:
    "En Informix, que no tiene esquemas, este campo es el propietario de las tablas y el DDL no trae CREATE SCHEMA.",
  readOnlyCatalogNotice: "Prism solo lee el catálogo. No cambia nada en la base de datos.",
  cancelButton: "Cancelar",
  createModelButton: "Crear modelo",
  readingTablesProgress: (done: number, total: number) => `Leyendo ${done} de ${total} tablas…`,
  importTablesTitle: "Importar tablas de una base de datos",
  importTablesButton: "Importar tablas",
  alreadyInModelNote: "ya está en el modelo",
  changeBaseMenuLabel: "Cambiar la base…",
  changeBaseTitle: "Cambiar la base del modelo",
  changeBaseConfirm: "Cambiar base y releer",
  scopeDialogTitle: "¿Qué debe traer el DDL?",
  scopeDialogIntro: (modelName: string, baseLabel: string) =>
    `El modelo ${modelName} partió de ${baseLabel}. El DDL puede traer solo lo que cambiaste respecto a ella, o el esquema completo.`,
  scopeChangesLabel: "Solo las diferencias",
  scopeChangesDescription: (baseLabel: string) =>
    `CREATE de las tablas nuevas y ALTER de lo que cambiaste en las existentes. Las existentes sin cambios quedan fuera. Para ejecutar en ${baseLabel}.`,
  scopeFullLabel: "Todo",
  scopeFullDescription: (baseLabel: string) =>
    `El esquema completo, desde cero: CREATE de todas las tablas, nuevas y existentes, tal como están en el modelo. Para crear en otra base de datos; en la propia ${baseLabel}, falla en el primer CREATE.`,
  scopeSavedNotice:
    "La elección queda guardada en el modelo. Se puede cambiar después, en la parte superior del DDL.",
  ddlBackToDiagram: "Volver al diagrama",
  ddlTitlePrefix: "DDL de",
  ddlScopeGroupLabel: "Qué trae el DDL",
  ddlCopyButton: "Copiar",
  ddlCopiedToast: "DDL copiado al portapapeles.",
  ddlSaveSqlButton: "Guardar .sql",
  ddlOpenInWorkbenchButton: "Abrir en el área de trabajo",
  ddlOpenInWorkbenchHint:
    "Abre una pestaña de consulta con este script. No se ejecuta nada hasta que lo ejecutes.",
  ddlOptionsGroupLabel: "Opciones del DDL",
  ddlOptionConstraintNames: "Nombres de las restricciones",
  ddlOptionComments: "Comentarios",
  ddlOptionFkAtEnd: "FKs en ALTER TABLE al final",
  ddlOptionDropNewFirst: "DROP de las nuevas antes de crear",
  ddlReadOnlyLabel: "DDL generado, solo lectura",
  ddlProblemsTitle: "Problemas",
  ddlProblemsExplain:
    "Los avisos no impiden el DDL. Un error, como una FK a una columna que no existe, sí lo impide: el DDL solo sale después de corregirlo.",
  ddlIgnoreWarning: "Ignorar en este modelo",
  ddlGoToColumn: "Ir a la columna",
  ddlNothingChanged: (baseLabel: string) => `No cambió nada respecto a ${baseLabel}.`,
  connectionChoiceTitle: "¿En qué conexión abrir el DDL?",
  connectionChoiceIntro:
    "El script va a una pestaña de consulta nueva. No se ejecuta nada hasta que lo ordenes.",
  connectionChoiceBaseNote: "las existentes ya están aquí",
  connectionChoiceConfirm: "Abrir en el área de trabajo",
  problems: {
    e1: (target: IdentifierKind) =>
      `El nombre de ${identifierKinds[target]} está vacío o tiene un carácter de control. La base de datos rechaza identificadores así.`,
    e2: (name: string) =>
      `El nombre ${name} está repetido en el mismo ámbito. La base de datos no permite dos objetos con el mismo nombre.`,
    e3: (table: string) =>
      `La tabla ${table} no tiene columnas. Todo CREATE TABLE exige al menos una columna.`,
    e4: (table: string, column: string) =>
      `${table}.${column} no tiene tipo. Toda columna necesita un tipo válido en la base de datos.`,
    e5: (table: string, ref: string) =>
      `${table} referencia ${ref}, que no existe en el modelo. La base de datos rechaza la FK al crear o modificar la tabla.`,
    e6: (table: string, refTable: string) =>
      `La FK en ${table} tiene un número de columnas distinto al de la referencia en ${refTable}.`,
    e7: (table: string, refTable: string, cols: string) =>
      `La FK en ${table} apunta a ${refTable} (${cols}), que no es PK ni único. La base de datos exige una restricción única en el destino.`,
    e8: (table: string, indexName: string) =>
      `El índice ${indexName} en ${table} no tiene columnas o referencia una columna inexistente.`,
    e9: (name: string, maxBytes: number) =>
      `El identificador ${name} supera el límite de ${maxBytes} bytes de la base de datos de destino.`,
    e10: (table: string, column: string, type: string) =>
      `${table}.${column} tiene autoincremento en el tipo ${type}. Solo los tipos enteros aceptan identity/serial.`,
    e11: (table: string, action: string) =>
      `La FK en ${table} usa la acción ${action}, que esta base de datos no acepta.`,
    e12: (table: string, column: string, type: string) =>
      `${table}.${column} usa ${type}. En Informix, varchar llega hasta 255 bytes; por encima de eso usa lvarchar.`,
    e13: (table: string) =>
      `${table} está marcada para eliminarse, pero otra tabla que se queda en el modelo aún tiene una FK hacia ella.`,
    e14: (table: string) =>
      `${table} es una tabla existente con cambio de PK, autoincremento o esquema, que no cabe en el ALTER automático.`,
    w1: (table: string) =>
      `La tabla nueva ${table} no tiene clave primaria. Sin PK, las filas duplicadas no se bloquean y las FKs no tienen a dónde apuntar.`,
    w2: (
      table: string,
      column: string,
      type: string,
      refTable: string,
      refColumn: string,
      refType: string,
    ) =>
      `${table}.${column} es ${type} y apunta a ${refTable}.${refColumn}, que es ${refType}. Un id superior a 2.147.483.647 no cabría.`,
    w3: () =>
      `Estas columnas de FK no inician ningún índice. Buscar por ellas, o eliminar la fila referenciada, lee la tabla entera.`,
    w4: (name: string, isInformix: boolean) =>
      isInformix
        ? `El nombre ${name} necesita comillas dobles; en Informix eso exige DELIMIDENT activo en la sesión.`
        : `El nombre ${name} necesita comillas dobles en todas las consultas en esta base de datos.`,
    w5: (table: string, column: string, type: string, suggestion: string | null) =>
      suggestion
        ? `${table}.${column} usa el tipo ${type}, fuera del catálogo estándar. Quizá quisiste ${suggestion}.`
        : `${table}.${column} usa el tipo ${type}, fuera del catálogo estándar de la base de datos.`,
    w6: (table: string, refTable: string, cols: string) =>
      `La FK en ${table} apunta a ${refTable} (${cols}), que no figura como PK ni índice único en la tabla existente.`,
    w7: (table: string) =>
      `La tabla nueva ${table} tiene el mismo nombre que una tabla que ya existe en la base de datos y no se importó al modelo.`,
    w10DropTable: (table: string) =>
      `DROP TABLE en ${table} elimina la tabla y todas sus filas en la base de datos.`,
    w10DropColumn: (table: string, column: string) =>
      `DROP COLUMN en ${table}.${column} elimina los datos de esa columna en la base de datos.`,
    w10NarrowType: (table: string, column: string, fromType: string, toType: string) =>
      `${table}.${column} cambia de ${fromType} a ${toType}, lo que puede truncar datos o fallar si hay valores mayores.`,
    w11: (table: string, column: string) =>
      `${table}.${column} pasa a ser NOT NULL sin valor predeterminado. Si la tabla ya tiene filas en la base de datos, el ALTER TABLE falla.`,
    w12: (table: string, refTable: string) =>
      `${table} apunta a ${refTable}, que no está en el modelo. En la base de datos de destino, debe existir antes de este script.`,
    w14: (table: string, column: string, defaultExpr: string) =>
      `${table}.${column} usa ${defaultExpr}, pero el script no crea la secuencia correspondiente.`,
    i1: (baseLabel: string) =>
      `"Abrir en el área de trabajo" pone el script en una pestaña nueva de ${baseLabel}. No se ejecuta nada hasta que lo ejecutes, y la confirmación de sentencia irreversible vale como en cualquier pestaña.`,
    i2: (readAt: string) =>
      `Las diferencias son contra la lectura de ${readAt}. Si alguien cambió la base de datos después, relee antes de ejecutar: lo que cambiaste en el modelo se mantiene.`,
    i3: (baseLabel: string) =>
      `Las tablas existentes ya están en ${baseLabel}: allí, este script falla en el primer CREATE. Al abrir en el área de trabajo, Prism pregunta la conexión.`,
  },
};
