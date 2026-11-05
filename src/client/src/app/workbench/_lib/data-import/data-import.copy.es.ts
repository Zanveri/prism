import type { DataImportCopy } from "./data-import.copy";

const formatCount = (value: number) => value.toLocaleString("es");
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

const listOf = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`);

const rangeOf = (first: number, last: number) => (first === last ? `la línea ${formatCount(first)}` : `las líneas ${formatCount(first)} a ${formatCount(last)}`);

export const dataImportCopyEs: DataImportCopy = {
  entry: {
    menu: "Importar datos…",
    button: "Importar…",
    recordsHint: "Importar filas de un archivo CSV, TSV, JSON o XLSX a esta tabla",
    readOnly: "La conexión es de solo lectura: importar escribe en la tabla.",
    view: "Solo una tabla recibe filas importadas: esta es una vista.",
  },

  wizard: {
    title: "Importar datos",
    target: (schema: string, table: string) => `A la tabla ${schema}.${table}`,
    steps: { file: "Archivo", mapping: "Mapeo", load: "Carga", confirmation: "Confirmación" },
    stepsLabel: "Pasos de la importación",
    cancel: "Cancelar",
    back: "Atrás",
    next: "Siguiente",
    import: "Importar",
    importing: "Importando…",
  },

  file: {
    label: "Archivo",
    choose: "Elegir archivo…",
    change: "Cambiar archivo…",
    cancelCopy: "Cancelar",
    copying: (name: string, percent: number) => `Copiando ${name}… ${percent}%`,
    copyProgressLabel: (name: string) => `Copia de ${name}`,
    chosen: (name: string, size: string) => `${name} · ${size}`,
    outsideElectron: "Importar solo funciona en la app de Prism.",
    dialogFailed: "No se pudo abrir el diálogo del sistema.",
    tooLarge: (size: string) => `El archivo pesa ${size}, y Prism importa hasta 2 GB.`,
    noSpace: (needed: string) => `No hay espacio en la carpeta de datos de Prism para copiar el archivo: se necesitan ${needed}.`,
    notWritable: "No se puede escribir en la carpeta de datos de Prism.",
    unreadable: (reason: string) => `No se pudo leer el archivo: ${reason}.`,
    notAFile: "Elige un archivo, no una carpeta ni un dispositivo.",
    missing: "El archivo elegido ya no está en Prism. Elige el archivo de nuevo.",
    waitCopy: "Espera a que termine la copia del archivo.",
    chooseFirst: "Elige el archivo que importar.",
    format: "Formato",
    formats: { csv: "CSV", tsv: "TSV", json: "JSON", xlsx: "XLSX" },
    encoding: "Codificación",
    encodings: { auto: "Automática", "utf-8": "UTF-8", "utf-16le": "UTF-16 LE", "utf-16be": "UTF-16 BE", "windows-1252": "Windows-1252", "iso-8859-1": "ISO-8859-1" },
    detectedEncoding: (name: string) => `Detectada: ${name}`,
    delimiter: "Separador",
    delimiters: { auto: "Automático", ";": "Punto y coma (;)", ",": "Coma (,)", "\t": "Tabulación", "|": "Barra vertical (|)" },
    detectedDelimiter: (name: string) => `Detectado: ${name}`,
    header: "La primera fila es el encabezado",
    quote: "Comillas",
    quotes: { double: "Comillas dobles", none: "Ninguna" },
    nullText: "Texto del nulo",
    nullTextHint: "Vacío por defecto: solo el campo vacío puede ser nulo. El campo sin comillas igual a este texto es nulo en cualquier columna.",
    emptyAsNull: "El campo vacío pasa a ser nulo",
    emptyAsNullHint: "En una columna que no es de texto, el campo vacío siempre es nulo.",
    trim: "Quitar los espacios de los extremos",
    skipEmptyLines: "Omitir líneas vacías",
    unguardFormulas: "Quitar el apóstrofo de la protección contra fórmulas",
    unguardFormulasHint:
      "El Exportar CSV de Prism pone un apóstrofo antes del texto que empieza con =, +, - o @, para que la hoja de cálculo no lo ejecute. Activado, la importación lo quita, y el texto vuelve como era. El texto que realmente empieza con un apóstrofo seguido de =, +, - o @ llega sin él: para ese archivo, desactiva la opción.",
    sheet: "Hoja",
    hiddenSheet: (name: string) => `${name} (oculta)`,
    jsonNone: "JSON no tiene opciones de lectura: el archivo se lee como UTF-8, como pide el formato.",
    decimal: "Separador decimal",
    decimals: { point: "Punto (1234.56)", comma: "Coma (1234,56)" },
    thousandsDot: "Aceptar el punto como separador de miles",
    thousandsDotHint: "1.500 pasa a ser mil quinientos. Actívalo solo si el archivo escribe los miles con punto.",
    dates: "Formato de las fechas",
    dateFormats: { iso: "aaaa-mm-dd", dayMonthYear: "dd/mm/aaaa" },
    valuesHint: "Valen para el texto que va a una columna de número, de fecha, de fecha y hora o de hora.",
  },

  problems: {
    nullTextControl: "El texto del nulo no puede tener caracteres de control.",
    nullTextLength: "El texto del nulo puede tener hasta 100 caracteres.",
    commitEvery: "Usa de 1 a 1.000.000 de filas.",
  },

  preview: {
    title: "Vista previa del archivo",
    reading: "Leyendo el archivo…",
    line: "Línea",
    item: "Elemento",
    columns: (count: number) => `${formatCount(count)} ${plural(count, "columna", "columnas")}`,
    encodingName: (name: string, bom: boolean) => `${name}${bom ? " con BOM" : ""}`,
    delimiterNames: { ";": "punto y coma", ",": "coma", "\t": "tabulación", "|": "barra vertical" } as Record<string, string>,
    oneColumn: "una sola columna",
    sheet: (name: string) => `Hoja ${name}`,
    list: (key: string) => `Lista en ${key}`,
    rootList: "Lista de objetos",
    hiddenColumns: (count: number) => (count === 1 ? "La otra columna no aparece en la vista previa." : `Las otras ${formatCount(count)} columnas no aparecen en la vista previa.`),
    noRows: "El archivo no tiene filas que importar.",
    short: (line: number, values: number, header: boolean, expected: number) =>
      `La línea ${formatCount(line)} tiene ${formatCount(values)} ${plural(values, "valor", "valores")}, y ${header ? "el encabezado" : "la primera línea"} tiene ${formatCount(expected)}: los que faltan van como nulo.`,
    nullValue: "NULL",
  },

  mapping: {
    loading: (schema: string, table: string) => `Leyendo las columnas de ${schema}.${table}…`,
    refreshing: "Actualizando la vista previa…",
    loadFailed: (schema: string, table: string) => `No se pudieron leer las columnas de ${schema}.${table}.`,
    refreshFailed: "No se pudo actualizar la vista previa.",
    retry: "Reintentar",
    tableMissing: (schema: string, table: string) => `La tabla ${schema}.${table} ya no existe.`,
    readOnly: "La conexión es de solo lectura, y la importación escribe en la tabla. No se envió nada a la base de datos.",
    title: "Columnas",
    fileColumn: "Columna del archivo",
    sourceColumn: "Columna del origen",
    tableColumn: "Columna de la tabla",
    type: "Tipo",
    choiceLabel: (name: string) => `Columna de la tabla para ${name}`,
    skip: "No importar",
    required: "obligatoria",
    filledByDatabase: "rellenada por la base de datos",
    computedByDatabase: "calculada por la base de datos",
    computedReason: "La base de datos calcula esta columna y no acepta valor.",
    typeReason: "Prism todavía no importa este tipo en esta base de datos.",
    binaryReason: "Binario solo va a una columna binaria.",
    money: "La base de datos lee este valor en el formato de moneda del servidor.",
    ambiguous: "Más de una columna de la tabla coincide con este nombre.",
    byName: "Mapear por nombre",
    none: "No importar ninguna",
    moved: (target: string, from: string) => `${target} dejó de recibir ${from}.`,
    defaults: "Se quedan con el valor por defecto de la tabla:",
    nullDefault: "nulo",
    noneMapped: "Elige al menos una columna de la tabla para recibir valores.",
    requiredWarning: (names: readonly string[]) =>
      names.length === 1
        ? `${names[0]} es obligatoria (no acepta nulo y no tiene valor por defecto) y no recibe valor: la base de datos rechazará las filas, a menos que un trigger de la tabla la rellene.`
        : `Las columnas ${listOf(names)} son obligatorias (no aceptan nulo y no tienen valor por defecto), y no reciben valor: la base de datos rechazará las filas, a menos que un trigger de la tabla las rellene.`,
    byDefaultWarning: (name: string, copy: boolean) =>
      `${name} la rellena la base de datos cuando queda sin valor. Con los valores ${copy ? "del origen" : "del archivo"}, el contador de la base de datos no avanza, y las filas creadas después sin ${name} pueden repetir un valor ${copy ? "copiado" : "importado"}.`,
    notNullDefaultWarning: (name: string, value: string, copy: boolean) =>
      `${name} no acepta nulo y tiene valor por defecto (${value}): ${copy ? "un nulo del origen va como nulo" : "un valor vacío o ausente del archivo va como nulo"}, y no como el valor por defecto, y la base de datos rechaza la fila.`,
    previewTitle: "Vista previa, ya convertida",
    convertsAll: (rows: number) => (rows === 1 ? "La primera fila se convierte." : `Las ${formatCount(rows)} primeras filas se convierten.`),
    problems: (values: number, rows: number, line: number) =>
      `${formatCount(values)} ${plural(values, "valor", "valores")} ${rows === 1 ? "de la primera fila" : `de las ${formatCount(rows)} primeras filas`} ${plural(values, "no se convierte", "no se convierten")}: la importación se detendrá en la línea ${formatCount(line)} del archivo.`,
    checksPostgres: "La vista previa comprueba la conversión de los valores. El tamaño, las restricciones y las claves, los comprueba la base de datos al escribir, y el número o la hora con más decimales que la columna, los redondea.",
    checksIbm: "La vista previa comprueba la conversión de los valores. El tamaño, las restricciones y las claves, los comprueba la base de datos al escribir.",
    rowProblem: "Problema de la fila",
  },

  copyTarget: {
    steps: { target: "Tabla de destino", mapping: "Mapeo", load: "Carga" },
    copyRows: "Copiar filas",
    copying: "Copiando…",
    connection: "Conexión",
    database: "Base de datos",
    schema: "Esquema",
    table: "Tabla",
    search: "Buscar tabla",
    tables: "Tablas del esquema",
    readOnlyOption: "solo lectura",
    connecting: (name: string) => `Conectando a ${name}…`,
    loadingDatabases: "Cargando las bases de datos…",
    loadingSchemas: "Leyendo los esquemas…",
    loadingTables: "Leyendo las tablas…",
    noTables: "Este esquema no tiene tablas.",
    noMatch: "Ninguna tabla con ese nombre.",
    chooseConnection: "Elige la conexión de destino.",
    chooseSchema: "Elige el esquema de la tabla de destino.",
    chooseTable: "Elige la tabla de destino.",
    readOnly: "La conexión es de solo lectura, y la copia escribe en la tabla. Elige otra conexión.",
    readOnlyRefused: "La conexión de destino es de solo lectura, y la copia escribe en la tabla. No se envió nada a la base de datos.",
    isSource: "La tabla de destino es el propio origen. Elige otra tabla.",
    db2Locked: "En Db2, la conexión usa una sola base de datos.",
    countForced: "El origen y el destino están en la misma base de datos: el recuento es obligatorio.",
    retry: "Reintentar",
    userNameMissing: "La conexión de destino no tiene usuario guardado. Rellénalo en Editar conexión y copia de nuevo.",
    passwordMissing: "La conexión de destino no tiene contraseña guardada. Rellénala en Editar conexión y copia de nuevo.",
    rereadWarning: "Las filas se leen de nuevo, en una conexión aparte: la copia lleva lo que tiene la base de datos ahora, y no lo que muestra la cuadrícula.",
    unsavedSource: (count: number) =>
      count === 1
        ? "La cuadrícula tiene 1 cambio sin guardar. La copia lee lo que está guardado en la base de datos y no lleva ese cambio."
        : `La cuadrícula tiene ${formatCount(count)} cambios sin guardar. La copia lee lo que está guardado en la base de datos y no lleva esos cambios.`,
    readsTarget: (table: string) =>
      `La sentencia del origen lee ${table}, que es la tabla de destino. La copia escribirá en ella las filas que lee; en Db2 e Informix, la lectura puede alcanzar las filas escritas, y la copia se detiene al pasar de las filas contadas.`,
  },

  copyNotes: {
    classes: { text: "texto", number: "número", date: "fecha", dateTime: "fecha y hora", time: "hora", boolean: "lógico", binary: "binario", other: "otro tipo" } as Record<string, string>,
    differentClass: (source: string, target: string) => `El origen es ${source}, y el destino es ${target}: cada valor se convierte, y la copia se detiene en el que no se convierta.`,
    zoneDropped: "La hora va como PostgreSQL la escribe en la zona horaria de la sesión, sin la zona.",
    timeToDate: "El origen tiene hora, y el destino es solo fecha: la copia se detiene en el valor con hora distinta de cero.",
    fewerPlaces: (source: number, target: number) => `El origen tiene hasta ${formatCount(source)} ${plural(source, "decimal", "decimales")}, y el destino guarda ${formatCount(target)}: la copia se detiene en el valor con más decimales distintos de cero.`,
    postgresRounds: (source: number, target: number) => `El origen tiene hasta ${formatCount(source)} ${plural(source, "decimal", "decimales")}, y el destino guarda ${formatCount(target)}: PostgreSQL redondea el valor.`,
    db2Fraction: "El driver entrega hasta 7 decimales de fracción: los demás se pierden.",
    money: "El money sale en el formato de moneda del servidor (R$ 1.234,56), que no es un número: copia desde una consulta con money::numeric.",
  },

  load: {
    empty: "Vaciar la tabla antes de importar",
    emptyCopy: "Vaciar la tabla antes de copiar",
    emptyHint: (schema: string, table: string, copy: boolean) =>
      `Elimina todas las filas de ${schema}.${table} antes de la primera fila ${copy ? "del origen" : "del archivo"}, con un DELETE sin WHERE. Los triggers de eliminación se disparan, y las claves foráneas con eliminación en cascada eliminan también filas de otras tablas.`,
    emptyWarning: (schema: string, table: string, copy: boolean) => `Todas las filas de ${schema}.${table} se eliminarán antes de la ${copy ? "copia" : "importación"}.`,
    cascade: (tables: string) => `La eliminación en cascada elimina también filas de ${tables}.`,
    setNull: (tables: string, table: string, rule: "null" | "default" | "both") =>
      `La eliminación también modifica filas de ${tables}: sus columnas que apuntan a ${table} quedan ${rule === "null" ? "nulas" : rule === "default" ? "con el valor por defecto" : "nulas (o con el valor por defecto)"}.`,
    restrict: (tables: string, table: string, copy: boolean) =>
      `Las filas de ${tables} que apuntan a ${table} impiden el vaciado: si hay alguna, la base de datos rechaza el DELETE, y la ${copy ? "copia" : "importación"} se detiene sin escribir nada.`,
    restrictNoLog: "Sin log de transacciones, el DELETE que la base de datos rechaza a mitad de camino puede haber eliminado ya parte de las filas.",
    andMore: (count: number) => `(y ${formatCount(count)} más)`,
    commit: "Commit",
    every: "Cada",
    everyRows: "filas",
    everyLabel: "Filas por commit",
    everyHint: (copy: boolean) => `Si la ${copy ? "copia" : "importación"} se detiene, las filas ya confirmadas quedan en la tabla, y las de la transacción en curso se revierten.`,
    single: "Todo en una sola transacción",
    singleHint: (copy: boolean) =>
      `Si la ${copy ? "copia" : "importación"} se detiene, no queda nada, y la tabla vuelve a ser lo que era. La transacción larga mantiene los bloqueos de la tabla hasta el final y, con muchas filas, puede llenar el log de la base de datos (en Informix, la propia base de datos revierte la transacción larga).`,
    emptyEvery: (rows: string, copy: boolean) =>
      `El vaciado se confirma junto con las primeras ${rows} filas. Si la ${copy ? "copia" : "importación"} se detiene después de eso, las filas antiguas no vuelven: la tabla queda solo con las ${copy ? "copiadas" : "importadas"} hasta ahí. Para todo o nada, elige Todo en una sola transacción.`,
    check: "Comprobar el archivo entero antes de escribir",
    checkHint:
      "Lee todo el archivo antes de escribir la primera fila y se detiene en el primer valor que Prism rechaza, sin tocar la tabla. Lo que solo comprueba la base de datos (el tamaño del texto, las restricciones, las claves y, en PostgreSQL, la conversión) aparece al escribir. En un archivo grande, la lectura adicional tarda unos minutos.",
    onFailure: "Si una fila falla",
    onFailureText: (copy: boolean) =>
      `La ${copy ? "copia" : "importación"} se detiene en la primera fila que falle: la transacción en curso se revierte, y las filas ya confirmadas quedan. La fila que repite una clave de la tabla también detiene la ${copy ? "copia" : "importación"}.`,
    noLog: (copy: boolean) =>
      `Esta base de datos no tiene log de transacciones: cada fila se escribe sola, en el acto. Si la ${copy ? "copia" : "importación"} se detiene, las filas anteriores ya están escritas, y el vaciado no se deshace.`,
    informix: "En Informix cada fila va en una sentencia: muchas filas tardan más que en las otras bases de datos.",
  },

  confirmation: {
    file: "Archivo",
    values: "Valores",
    target: "Destino",
    columns: "Columnas",
    load: "Carga",
    withHeader: "con encabezado",
    withoutHeader: "sin encabezado",
    sheet: (name: string) => `hoja ${name}`,
    list: (key: string) => `lista en ${key}`,
    rootList: "lista de objetos",
    decimalPoint: "decimal con punto",
    decimalComma: "decimal con coma",
    decimalCommaThousands: "decimal con coma y punto de millar",
    datesOf: (format: string) => `fechas ${format}`,
    columnsOf: (mapped: number, fileColumns: number, used: number, tableColumns: number, copy: boolean) =>
      `${formatCount(mapped)} de ${formatCount(fileColumns)} ${plural(fileColumns, "columna", "columnas")} ${copy ? "del origen" : "del archivo"}, en ${formatCount(used)} de las ${formatCount(tableColumns)} ${plural(tableColumns, "columna", "columnas")} de la tabla`,
    pair: (from: string, to: string) => `${from} → ${to}`,
    empties: "Vacía la tabla antes",
    checks: "comprueba el archivo antes",
    noCheck: "sin comprobar el archivo antes",
    commitEvery: (rows: string) => `commit cada ${rows} filas`,
    single: "en una sola transacción",
    oneAtATime: "cada fila escrita sola",
    previewProblems: (values: number, rows: number, line: number) =>
      `${rows === 1 ? "En la primera fila" : `En las ${formatCount(rows)} primeras filas`}, ${formatCount(values)} ${plural(values, "valor no se convierte", "valores no se convierten")}: la importación se detendrá en la línea ${formatCount(line)} del archivo.`,
    unsaved: (table: string, count: number, empty: boolean, copy = false) =>
      empty
        ? `La pestaña de registros de ${table} tiene ${formatCount(count)} ${plural(count, "cambio sin guardar", "cambios sin guardar")}: después de vaciar la tabla, ya no ${plural(count, "encuentra", "encuentran")} las filas.`
        : `La pestaña de registros de ${table} tiene ${formatCount(count)} ${plural(count, "cambio sin guardar", "cambios sin guardar")}. La ${copy ? "copia" : "importación"} no ${plural(count, "lo lleva, y sigue pendiente", "los lleva, y siguen pendientes")}.`,
    understand: (schema: string, table: string) => `Entiendo que las filas actuales de ${schema}.${table} se eliminarán.`,
    understandFirst: "Marca que entiendes que la tabla se vaciará.",
    outsideElectron: "Importar solo funciona en la app de Prism.",
    tooLarge: "La solicitud pasa de 16 MiB, por los nombres de las columnas. Deja columnas fuera en el Mapeo.",
    limitReached: "Ya hay 3 transferencias en curso (exportaciones, importaciones o copias a otra base de datos). Espera a que termine una, o cancela una en la barra de estado.",
    connectionMissing: "La conexión ya no existe.",
    userNameMissing: "Esta conexión no tiene usuario guardado. Rellénalo en Editar conexión e importa de nuevo.",
    passwordMissing: "Esta conexión no tiene contraseña guardada. Rellénala en Editar conexión e importa de nuevo.",
    sourceUserNameMissing: "La conexión de origen no tiene usuario guardado. Rellénalo en Editar conexión y copia de nuevo.",
    sourcePasswordMissing: "La conexión de origen no tiene contraseña guardada. Rellénala en Editar conexión y copia de nuevo.",
    targetUserNameMissing: "La conexión de destino no tiene usuario guardado. Rellénalo en Editar conexión y copia de nuevo.",
    targetPasswordMissing: "La conexión de destino no tiene contraseña guardada. Rellénala en Editar conexión y copia de nuevo.",
  },

  question: {
    emptyAndImport: "¿Vaciar la tabla e importar?",
    import: "¿Importar datos?",
    emptyAndCopy: "¿Vaciar la tabla y copiar?",
    copy: "¿Copiar datos?",
    emptyDoes: (target: string, source: string) => `Elimina todas las filas de ${target} y escribe las de ${source}.`,
    writeDoes: (source: string, target: string) => `Escribe las filas de ${source} en ${target}.`,
    confirmImport: "Importar de todos modos",
    confirmCopy: "Copiar de todos modos",
  },

  status: {
    importing: (file: string, table: string) => `Importando ${file} a ${table}…`,
    copying: (source: string, table: string) => `Copiando ${source} a ${table}…`,
    connecting: "conectando",
    counting: "contando las filas",
    checking: (percent: number) => `comprobando el archivo, ${percent}%`,
    checkingHint: (read: string, size: string) => `Comprobando el archivo antes de escribir: todavía no se escribió nada · ${read} de ${size} leídos`,
    emptying: "vaciando la tabla",
    committing: "confirmando",
    percent: (percent: number) => `${percent}%`,
    rows: (rows: number) => `${formatCount(rows)} ${plural(rows, "fila", "filas")}`,
    loadedHint: (rows: number, committed: number | null, read: string | null, size: string | null) =>
      [
        committed === null
          ? `${formatCount(rows)} ${plural(rows, "fila escrita", "filas escritas")}`
          : `${formatCount(rows)} ${plural(rows, "fila escrita", "filas escritas")}, ${formatCount(committed)} ${plural(committed, "confirmada", "confirmadas")}`,
        read === null || size === null ? null : `${read} de ${size} leídos`,
      ]
        .filter((part) => part !== null)
        .join(" · "),
    copiedHint: (rows: number, total: number | null, committed: number) =>
      `${total === null ? `${formatCount(rows)} ${plural(rows, "fila", "filas")}` : `${formatCount(rows)} de ${formatCount(total)} filas`} · ${formatCount(committed)} ${plural(committed, "confirmada", "confirmadas")}`,
    lostImport: "No se pudo saber cómo va la importación.",
    lostCopy: "No se pudo saber cómo va la copia.",
    cancelling: "Cancelando…",
    cancel: "Cancelar",
    cancelImportLabel: (file: string) => `Cancelar la importación de ${file}`,
    cancelCopyLabel: (source: string) => `Cancelar la copia de ${source}`,
    importProgressLabel: (file: string) => `Progreso de la importación de ${file}`,
    copyProgressLabel: (source: string) => `Progreso de la copia de ${source}`,
    failedImport: (table: string) => `La importación a ${table} se detuvo.`,
    failedCopy: (source: string, table: string) => `La copia de ${source} a ${table} se detuvo.`,
    showError: "Ver el error",
    discard: "Descartar",
    more: (count: number, kind: "export" | "import" | "copy" | "mixed") => {
      switch (kind) {
        case "export":
          return `+${count} ${plural(count, "exportación", "exportaciones")}`;
        case "import":
          return `+${count} ${plural(count, "importación", "importaciones")}`;
        case "copy":
          return `+${count} ${plural(count, "copia", "copias")}`;
        case "mixed":
          return `+${count} ${plural(count, "transferencia", "transferencias")}`;
      }
    },
    listLabel: "Transferencias de esta ventana",
  },

  cancelQuestion: {
    importTitle: (table: string) => `¿Cancelar la importación a ${table}?`,
    copyTitle: (source: string, table: string) => `¿Cancelar la copia de ${source} a ${table}?`,
    committed: (committed: number) =>
      `${committed === 1 ? "La fila ya confirmada queda" : `Las ${formatCount(committed)} filas ya confirmadas quedan`} en la tabla, y las de la transacción en curso se revierten.`,
    committedEmptied: (committed: number) =>
      `${committed === 1 ? "La fila ya confirmada queda" : `Las ${formatCount(committed)} filas ya confirmadas quedan`} en la tabla, y las filas antiguas, eliminadas por el vaciado, no vuelven.`,
    written: (rows: number) => (rows === 1 ? "La fila ya escrita queda en la tabla." : `Las ${formatCount(rows)} filas ya escritas quedan en la tabla.`),
    emptyingNoLog: "El vaciado ya empezó, y las filas que eliminó no vuelven.",
    unknown: "Las filas ya confirmadas quedan en la tabla.",
    cancelImport: "Cancelar la importación",
    keepImporting: "Seguir importando",
    cancelCopy: "Cancelar la copia",
    keepCopying: "Seguir copiando",
  },

  toasts: {
    imported: (rows: number, table: string) => `${formatCount(rows)} ${plural(rows, "fila importada", "filas importadas")} en ${table}.`,
    copied: (rows: number, source: string, table: string) => `${formatCount(rows)} ${plural(rows, "fila copiada", "filas copiadas")} de ${source} a ${table}.`,
    lateImport: (table: string, rows: number) => `La importación a ${table} ya había terminado cuando llegó la cancelación: ${formatCount(rows)} ${plural(rows, "fila importada", "filas importadas")}.`,
    lateCopy: (source: string, table: string, rows: number) => `La copia de ${source} a ${table} ya había terminado cuando llegó la cancelación: ${formatCount(rows)} ${plural(rows, "fila copiada", "filas copiadas")}.`,
    openRecords: "Abrir registros",
    emptied: "La tabla se vació antes.",
    skippedLines: (count: number) => (count === 1 ? "Se omitió 1 línea vacía del archivo." : `Se omitieron ${formatCount(count)} líneas vacías del archivo.`),
    unguarded: (count: number) => (count === 1 ? "1 valor perdió el apóstrofo de la protección contra fórmulas." : `${formatCount(count)} valores perdieron el apóstrofo de la protección contra fórmulas.`),
    shortRows: (count: number) =>
      count === 1 ? "1 fila tenía menos valores que el encabezado y se completó con nulo." : `${formatCount(count)} filas tenían menos valores que el encabezado y se completaron con nulo.`,
    formulasWithoutValue: (count: number) =>
      count === 1 ? "1 celda con fórmula sin resultado guardado llegó vacía." : `${formatCount(count)} celdas con fórmula sin resultado guardado llegaron vacías.`,
    failedImport: (table: string) => `La importación a ${table} se detuvo.`,
    failedCopy: (source: string, table: string) => `La copia de ${source} a ${table} se detuvo.`,
    canceledImport: (table: string) => `Importación a ${table} cancelada.`,
    canceledCopy: (source: string, table: string) => `Copia de ${source} a ${table} cancelada.`,
    canceledUncertainImport: (table: string) => `Importación a ${table} cancelada, pero la base de datos no respondió a la cancelación: Prism no sabe qué quedó en la tabla. Compruébala.`,
    canceledUncertainCopy: (source: string, table: string) => `Copia de ${source} a ${table} cancelada, pero la base de datos no respondió a la cancelación: Prism no sabe qué quedó en la tabla. Compruébala.`,
    connectionDeletedImport: (table: string) => `La importación a ${table} se canceló: la conexión fue eliminada.`,
    connectionDeletedCopy: (source: string, table: string) => `La copia de ${source} a ${table} se canceló: la conexión fue eliminada.`,
    readOnlyImport: (table: string) => `La importación a ${table} se detuvo: la conexión pasó a ser de solo lectura.`,
    readOnlyCopy: (source: string, table: string) => `La copia de ${source} a ${table} se detuvo: la conexión de destino pasó a ser de solo lectura.`,
    lostImport: (table: string) => `La importación a ${table} se perdió: Prism no sabe qué quedó en la tabla. Compruébala.`,
    lostCopy: (source: string, table: string) => `La copia de ${source} a ${table} se perdió: Prism no sabe qué quedó en la tabla. Compruébala.`,
    sqlState: (state: string) => `SQLSTATE ${state}`,
    fileLine: (line: number) => `Línea ${formatCount(line)} del archivo`,
    listItem: (line: number) => `Elemento ${formatCount(line)} de la lista`,
    sheetLine: (line: number, sheet: string) => `Línea ${formatCount(line)} de la hoja ${sheet}`,
    sourceLine: (line: number) => `Línea ${formatCount(line)} del origen`,
    column: (name: string) => `columna ${name}`,
    inRange: (first: number, last: number, copy: boolean) => `En las líneas ${formatCount(first)} a ${formatCount(last)} ${copy ? "del origen" : "del archivo"}`,
    readingSource: "Al leer el origen:",
    writingTarget: "Al escribir en el destino:",
    committedStayed: (committed: number) =>
      committed === 1 ? "1 fila confirmada quedó en la tabla; las de la transacción en curso se revirtieron." : `${formatCount(committed)} filas confirmadas quedaron en la tabla; las de la transacción en curso se revirtieron.`,
    nothingStayed: "No se escribió ninguna fila, y la tabla está como antes.",
    previousStayed: (rows: number) => (rows === 1 ? "La fila anterior quedó escrita." : `Las ${formatCount(rows)} filas anteriores quedaron escritas.`),
    writtenStayed: (rows: number) => (rows === 1 ? "La fila escrita hasta ahí quedó en la tabla." : `Las ${formatCount(rows)} filas escritas hasta ahí quedaron en la tabla.`),
    noneWrittenNoLog: "No se escribió ninguna fila.",
    partlyEmptied: (copy: boolean) => `La tabla puede haberse vaciado en parte; no se escribió ninguna fila ${copy ? "del origen" : "del archivo"}.`,
    uncertainCommit: (first: number, last: number) => `La conexión se cayó durante la confirmación de ${rangeOf(first, last)}: Prism no sabe si ${first === last ? "se escribió" : "se escribieron"}. Comprueba la tabla.`,
    uncertainEmptyCommit: (first: number, last: number) =>
      `La conexión se cayó durante la confirmación del vaciado y de ${rangeOf(first, last)}: Prism no sabe si la tabla se vació ni si las filas se escribieron. Comprueba la tabla.`,
    uncertainEmptyOnly: "La conexión se cayó durante la confirmación del vaciado: Prism no sabe si la tabla se vació. Comprueba la tabla.",
    uncertainRow: (line: number) => `La conexión se cayó durante la escritura de la línea ${formatCount(line)}: Prism no sabe si se escribió. Comprueba la tabla.`,
    uncertainCancel: "La base de datos no respondió a la cancelación: Prism no sabe qué quedó en la tabla. Compruébala.",
  },

  failure: {
    importTitle: "Importación interrumpida",
    copyTitle: "Copia interrumpida",
    file: "Archivo",
    source: "Origen",
    table: "Tabla",
    line: "Línea",
    column: "Columna",
    message: "Mensaje",
    sqlState: "SQLSTATE",
    stayed: "Qué quedó",
    copyMessage: "Copiar el mensaje",
    copied: "Mensaje copiado.",
    notCopied: "No se pudo copiar el mensaje.",
    close: "Cerrar",
  },

  records: {
    imported: "Se importaron filas en esta tabla después de la lectura.",
    refresh: "Actualizar",
  },

  exits: {
    count: (exports: number, imports: number, copies: number) => {
      const parts = [
        exports > 0 ? `${formatCount(exports)} ${plural(exports, "exportación", "exportaciones")}` : null,
        imports > 0 ? `${formatCount(imports)} ${plural(imports, "importación", "importaciones")}` : null,
        copies > 0 ? `${formatCount(copies)} ${plural(copies, "copia a otra base de datos", "copias a otra base de datos")}` : null,
      ].filter((part): part is string => part !== null);
      const total = exports + imports + copies;
      if (parts.length === 1) return `Hay ${parts[0]} en curso.`;
      return `Hay ${formatCount(total)} transferencias en curso: ${listOf(parts)}.`;
    },
    verbs: { signOut: "Cerrar sesión", window: "Cerrar la ventana", app: "Cerrar Prism" },
    buttonVerbs: { signOut: "Cerrar sesión", window: "Cerrar", app: "Cerrar Prism" },
    nouns: {
      export: ["exportación", "exportaciones"],
      import: ["importación", "importaciones"],
      copy: ["copia", "copias"],
      mixed: ["transferencia", "transferencias"],
    } as Record<"export" | "import" | "copy" | "mixed", readonly [string, string]>,
    keep: { export: "Seguir exportando", import: "Seguir importando", copy: "Seguir copiando", mixed: "Seguir transfiriendo" } as Record<"export" | "import" | "copy" | "mixed", string>,
    title: (verb: string, plural: string) => `¿${verb} con ${plural} en curso?`,
    confirm: (verb: string, what: string) => `${verb} y cancelar ${what}`,
    pending: (what: string) => `Cancelando ${what}…`,
    cancelsOne: (verb: string, what: string, single: boolean) =>
      single
        ? `${verb} cancela ${what}: las filas que ya confirmó quedan en la tabla, y las de la transacción en curso se revierten.`
        : `${verb} cancela ${what}: las filas que ya confirmaron quedan en las tablas, y las de las transacciones en curso se revierten.`,
    cancelsLoads: (verb: string) => `${verb} cancela todas: las filas que ya confirmaron quedan en las tablas, y las de las transacciones en curso se revierten.`,
    cancelsMixed: (verb: string, exports: number, loads: string, single: boolean) =>
      `${verb} cancela todas: ${exports === 1 ? "el archivo de la exportación no se escribe" : "los archivos de las exportaciones no se escriben"}, y ${loads} ${single ? "deja en la tabla solo las filas que ya confirmó" : "dejan en las tablas solo las filas que ya confirmaron"}.`,
    aheadOne: (noun: string) => `La ${noun} en curso se cancelará, y en la tabla quedan solo las filas que ya confirmó.`,
    aheadKind: (count: number, plural: string) => `Las ${formatCount(count)} ${plural} en curso se cancelarán, y en las tablas quedan solo las filas que ya confirmaron.`,
    aheadMixed: (count: number, loads: string, single: boolean) =>
      `Las ${formatCount(count)} transferencias en curso se cancelarán: ${single ? `en la tabla queda solo lo que ${loads} ya confirmó` : `en las tablas quedan solo las filas que ${loads} ya confirmaron`}.`,
    connectionOne: (noun: string) => `La ${noun} en curso de esta conexión se cancelará, y en la tabla queda solo lo que ya confirmó.`,
    connectionMany: (count: number, plural: string, loads: string, single: boolean) =>
      `Las ${formatCount(count)} ${plural} en curso de esta conexión se cancelarán. ${loads.charAt(0).toUpperCase()}${loads.slice(1)} ${single ? "deja en la tabla solo las filas que ya confirmó" : "dejan en las tablas solo las filas que ya confirmaron"}.`,
    loads: (imports: number, copies: number) =>
      imports > 0 && copies > 0 ? "las importaciones y las copias" : imports > 0 ? (imports === 1 ? "la importación" : "las importaciones") : copies === 1 ? "la copia" : "las copias",
    copyNoun: "copia a otra base de datos",
    objects: { export: ["la exportación", "las exportaciones"], import: ["la importación", "las importaciones"], copy: ["la copia", "las copias"], mixed: ["la transferencia", "las transferencias"] } as Record<"export" | "import" | "copy" | "mixed", readonly [string, string]>,
    titleVerbs: { signOut: "Cerrar sesión", window: "Cerrar", app: "Cerrar" },
    copyNounPlural: "copias a otra base de datos",
  },
};
