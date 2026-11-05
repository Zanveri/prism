import type { DataImportCopy } from "./data-import.copy";

const formatCount = (value: number) => value.toLocaleString("en");
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

const listOf = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const rangeOf = (first: number, last: number) => (first === last ? `line ${formatCount(first)}` : `lines ${formatCount(first)} to ${formatCount(last)}`);

export const dataImportCopyEn: DataImportCopy = {
  entry: {
    menu: "Import data…",
    button: "Import…",
    recordsHint: "Import rows from a CSV, TSV, JSON or XLSX file into this table",
    readOnly: "The connection is read-only: importing writes to the table.",
    view: "Only a table receives imported rows: this is a view.",
  },

  wizard: {
    title: "Import data",
    target: (schema: string, table: string) => `Into table ${schema}.${table}`,
    steps: { file: "File", mapping: "Mapping", load: "Load", confirmation: "Confirmation" },
    stepsLabel: "Import steps",
    cancel: "Cancel",
    back: "Back",
    next: "Next",
    import: "Import",
    importing: "Importing…",
  },

  file: {
    label: "File",
    choose: "Choose file…",
    change: "Change file…",
    cancelCopy: "Cancel",
    copying: (name: string, percent: number) => `Copying ${name}… ${percent}%`,
    copyProgressLabel: (name: string) => `Copy of ${name}`,
    chosen: (name: string, size: string) => `${name} · ${size}`,
    outsideElectron: "Import only works in the Prism app.",
    dialogFailed: "Could not open the system dialog.",
    tooLarge: (size: string) => `The file is ${size}, and Prism imports up to 2 GB.`,
    noSpace: (needed: string) => `There is not enough space in the Prism data folder to copy the file: ${needed} needed.`,
    notWritable: "Cannot write to the Prism data folder.",
    unreadable: (reason: string) => `Could not read the file: ${reason}.`,
    notAFile: "Choose a file, not a folder or a device.",
    missing: "The chosen file is no longer with Prism. Choose the file again.",
    waitCopy: "Wait for the file copy to finish.",
    chooseFirst: "Choose the file to import.",
    format: "Format",
    formats: { csv: "CSV", tsv: "TSV", json: "JSON", xlsx: "XLSX" },
    encoding: "Encoding",
    encodings: { auto: "Automatic", "utf-8": "UTF-8", "utf-16le": "UTF-16 LE", "utf-16be": "UTF-16 BE", "windows-1252": "Windows-1252", "iso-8859-1": "ISO-8859-1" },
    detectedEncoding: (name: string) => `Detected: ${name}`,
    delimiter: "Delimiter",
    delimiters: { auto: "Automatic", ";": "Semicolon (;)", ",": "Comma (,)", "\t": "Tab", "|": "Vertical bar (|)" },
    detectedDelimiter: (name: string) => `Detected: ${name}`,
    header: "First row is the header",
    quote: "Quotes",
    quotes: { double: "Double quotes", none: "None" },
    nullText: "Null text",
    nullTextHint: "Empty by default: only the empty field can be null. An unquoted field equal to this text is null in any column.",
    emptyAsNull: "Empty field becomes null",
    emptyAsNullHint: "In a non-text column, the empty field is always null.",
    trim: "Trim leading and trailing spaces",
    skipEmptyLines: "Skip empty lines",
    unguardFormulas: "Remove the apostrophe that guards against formulas",
    unguardFormulasHint:
      "Prism's CSV export puts an apostrophe before text that starts with =, +, - or @, so the spreadsheet does not run it. When on, the import removes it, and the text comes back as it was. Text that actually starts with an apostrophe followed by =, +, - or @ arrives without it: for that file, turn the option off.",
    sheet: "Sheet",
    hiddenSheet: (name: string) => `${name} (hidden)`,
    jsonNone: "JSON has no read options: the file is read as UTF-8, as the format requires.",
    decimal: "Decimal separator",
    decimals: { point: "Point (1234.56)", comma: "Comma (1234,56)" },
    thousandsDot: "Accept the point as a thousands separator",
    thousandsDotHint: "1.500 becomes one thousand five hundred. Turn on only if the file writes thousands with a point.",
    dates: "Date format",
    dateFormats: { iso: "yyyy-mm-dd", dayMonthYear: "dd/mm/yyyy" },
    valuesHint: "They apply to text that goes to a number, date, date-time or time column.",
  },

  problems: {
    nullTextControl: "The null text cannot contain a control character.",
    nullTextLength: "The null text can have up to 100 characters.",
    commitEvery: "Use from 1 to 1,000,000 rows.",
  },

  preview: {
    title: "File preview",
    reading: "Reading the file…",
    line: "Line",
    item: "Item",
    columns: (count: number) => `${formatCount(count)} ${plural(count, "column", "columns")}`,
    encodingName: (name: string, bom: boolean) => `${name}${bom ? " with BOM" : ""}`,
    delimiterNames: { ";": "semicolon", ",": "comma", "\t": "tab", "|": "vertical bar" } as Record<string, string>,
    oneColumn: "a single column",
    sheet: (name: string) => `Sheet ${name}`,
    list: (key: string) => `List in ${key}`,
    rootList: "List of objects",
    hiddenColumns: (count: number) => (count === 1 ? "The other column does not appear in the preview." : `The other ${formatCount(count)} columns do not appear in the preview.`),
    noRows: "The file has no rows to import.",
    short: (line: number, values: number, header: boolean, expected: number) =>
      `Line ${formatCount(line)} has ${formatCount(values)} ${plural(values, "value", "values")}, and ${header ? "the header" : "the first line"} has ${formatCount(expected)}: the missing ones go as null.`,
    nullValue: "NULL",
  },

  mapping: {
    loading: (schema: string, table: string) => `Reading the columns of ${schema}.${table}…`,
    refreshing: "Updating the preview…",
    loadFailed: (schema: string, table: string) => `Could not read the columns of ${schema}.${table}.`,
    refreshFailed: "Could not update the preview.",
    retry: "Try again",
    tableMissing: (schema: string, table: string) => `The table ${schema}.${table} no longer exists.`,
    readOnly: "The connection is read-only, and the import writes to the table. Nothing was sent to the database.",
    title: "Columns",
    fileColumn: "File column",
    sourceColumn: "Source column",
    tableColumn: "Table column",
    type: "Type",
    choiceLabel: (name: string) => `Table column for ${name}`,
    skip: "Don't import",
    required: "required",
    filledByDatabase: "filled by the database",
    computedByDatabase: "computed by the database",
    computedReason: "The database computes this column and does not accept a value.",
    typeReason: "Prism does not import this type on this database yet.",
    binaryReason: "Binary only goes to a binary column.",
    money: "The database reads this value in the server's currency format.",
    ambiguous: "More than one table column matches this name.",
    byName: "Map by name",
    none: "Don't import any",
    moved: (target: string, from: string) => `${target} no longer receives ${from}.`,
    defaults: "They keep the table default:",
    nullDefault: "null",
    noneMapped: "Choose at least one table column to receive values.",
    requiredWarning: (names: readonly string[]) =>
      names.length === 1
        ? `${names[0]} is required (does not accept null and has no default) and receives no value: the database will refuse the rows, unless a table trigger fills it in.`
        : `The columns ${listOf(names)} are required (they do not accept null and have no default), and receive no value: the database will refuse the rows, unless a table trigger fills them in.`,
    byDefaultWarning: (name: string, copy: boolean) =>
      `${name} is filled in by the database when it has no value. With the values ${copy ? "from the source" : "from the file"}, the database counter does not advance, and rows created later without ${name} may repeat a ${copy ? "copied" : "imported"} value.`,
    notNullDefaultWarning: (name: string, value: string, copy: boolean) =>
      `${name} does not accept null and has a default (${value}): ${copy ? "a null from the source goes as null" : "an empty or missing value in the file goes as null"}, not as the default, and the database refuses the row.`,
    previewTitle: "Preview, already converted",
    convertsAll: (rows: number) => (rows === 1 ? "The first row converts." : `The first ${formatCount(rows)} rows convert.`),
    problems: (values: number, rows: number, line: number) =>
      `${formatCount(values)} ${plural(values, "value", "values")} ${rows === 1 ? "of the first row" : `of the first ${formatCount(rows)} rows`} ${plural(values, "does not convert", "do not convert")}: the import will stop at line ${formatCount(line)} of the file.`,
    checksPostgres: "The preview checks the conversion of the values. The database checks size, constraints and keys when writing, and it rounds a number or time with more places than the column.",
    checksIbm: "The preview checks the conversion of the values. The database checks size, constraints and keys when writing.",
    rowProblem: "Row problem",
  },

  copyTarget: {
    steps: { target: "Target table", mapping: "Mapping", load: "Load" },
    copyRows: "Copy rows",
    copying: "Copying…",
    connection: "Connection",
    database: "Database",
    schema: "Schema",
    table: "Table",
    search: "Search table",
    tables: "Tables in the schema",
    readOnlyOption: "read-only",
    connecting: (name: string) => `Connecting to ${name}…`,
    loadingDatabases: "Loading the databases…",
    loadingSchemas: "Reading the schemas…",
    loadingTables: "Reading the tables…",
    noTables: "This schema has no tables.",
    noMatch: "No table with that name.",
    chooseConnection: "Choose the target connection.",
    chooseSchema: "Choose the schema of the target table.",
    chooseTable: "Choose the target table.",
    readOnly: "The connection is read-only, and the copy writes to the table. Choose another connection.",
    readOnlyRefused: "The target connection is read-only, and the copy writes to the table. Nothing was sent to the database.",
    isSource: "The target table is the source itself. Choose another table.",
    db2Locked: "On Db2, the connection uses a single database.",
    countForced: "The source and the target are in the same database: counting is required.",
    retry: "Try again",
    userNameMissing: "The target connection has no saved user. Fill it in under Edit connection and copy again.",
    passwordMissing: "The target connection has no saved password. Fill it in under Edit connection and copy again.",
    rereadWarning: "The rows are read again, on a separate connection: the copy carries what the database has now, not what the grid shows.",
    unsavedSource: (count: number) =>
      count === 1
        ? "The grid has 1 unsaved change. The copy reads what is saved in the database and does not carry that change."
        : `The grid has ${formatCount(count)} unsaved changes. The copy reads what is saved in the database and does not carry those changes.`,
    readsTarget: (table: string) =>
      `The source statement reads ${table}, which is the target table. The copy will write into it the rows it reads; on Db2 and Informix, the read may reach the written rows, and the copy stops when it passes the counted rows.`,
  },

  copyNotes: {
    classes: { text: "text", number: "number", date: "date", dateTime: "date-time", time: "time", boolean: "boolean", binary: "binary", other: "other type" } as Record<string, string>,
    differentClass: (source: string, target: string) => `The source is ${source}, and the target is ${target}: each value is converted, and the copy stops at one that does not convert.`,
    zoneDropped: "The time goes as PostgreSQL writes it in the session time zone, without the zone.",
    timeToDate: "The source has a time, and the target is date only: the copy stops at a value whose time is not zero.",
    fewerPlaces: (source: number, target: number) => `The source has up to ${formatCount(source)} ${plural(source, "place", "places")}, and the target keeps ${formatCount(target)}: the copy stops at a value with more non-zero places.`,
    postgresRounds: (source: number, target: number) => `The source has up to ${formatCount(source)} ${plural(source, "place", "places")}, and the target keeps ${formatCount(target)}: PostgreSQL rounds the value.`,
    db2Fraction: "The driver delivers up to 7 fraction places: the others are lost.",
    money: "The money comes out in the server's currency format (R$ 1.234,56), which is not a number: copy from a query with money::numeric.",
  },

  load: {
    empty: "Empty the table before importing",
    emptyCopy: "Empty the table before copying",
    emptyHint: (schema: string, table: string, copy: boolean) =>
      `Deletes all rows of ${schema}.${table} before the first row ${copy ? "of the source" : "of the file"}, with a DELETE without WHERE. Delete triggers fire, and foreign keys with cascading delete also delete rows from other tables.`,
    emptyWarning: (schema: string, table: string, copy: boolean) => `All rows of ${schema}.${table} will be deleted before the ${copy ? "copy" : "import"}.`,
    cascade: (tables: string) => `The cascading delete also deletes rows from ${tables}.`,
    setNull: (tables: string, table: string, rule: "null" | "default" | "both") =>
      `The delete also changes rows in ${tables}: their columns that point to ${table} become ${rule === "null" ? "null" : rule === "default" ? "the default" : "null (or the default)"}.`,
    restrict: (tables: string, table: string, copy: boolean) =>
      `Rows in ${tables} that point to ${table} prevent emptying: if there are any, the database refuses the DELETE, and the ${copy ? "copy" : "import"} stops without writing anything.`,
    restrictNoLog: "Without a transaction log, a DELETE the database refuses midway may have already deleted part of the rows.",
    andMore: (count: number) => `(and ${formatCount(count)} more)`,
    commit: "Commit",
    every: "Every",
    everyRows: "rows",
    everyLabel: "Rows per commit",
    everyHint: (copy: boolean) => `If the ${copy ? "copy" : "import"} stops, the rows already committed stay in the table, and those in the transaction in progress are rolled back.`,
    single: "Everything in a single transaction",
    singleHint: (copy: boolean) =>
      `If the ${copy ? "copy" : "import"} stops, nothing stays, and the table goes back to what it was. The long transaction holds the table locks until the end and, with many rows, may fill the database log (on Informix, the database itself rolls back the long transaction).`,
    emptyEvery: (rows: string, copy: boolean) =>
      `The emptying is committed together with the first ${rows} rows. If the ${copy ? "copy" : "import"} stops after that, the old rows do not come back: the table keeps only the ${copy ? "copied" : "imported"} ones up to that point. For all or nothing, choose Everything in a single transaction.`,
    check: "Check the whole file before writing",
    checkHint:
      "Reads the whole file before writing the first row and stops at the first value Prism refuses, without touching the table. What only the database checks (text size, constraints, keys and, on PostgreSQL, conversion) shows up when writing. On a large file, the extra read takes a few minutes.",
    onFailure: "If a row fails",
    onFailureText: (copy: boolean) =>
      `The ${copy ? "copy" : "import"} stops at the first row that fails: the transaction in progress is rolled back, and the rows already committed stay. A row that repeats a table key also stops the ${copy ? "copy" : "import"}.`,
    noLog: (copy: boolean) =>
      `This database has no transaction log: each row is written on its own, right away. If the ${copy ? "copy" : "import"} stops, the previous rows are already written, and the emptying cannot be undone.`,
    informix: "On Informix each row goes in one statement: many rows take longer than on the other databases.",
  },

  confirmation: {
    file: "File",
    values: "Values",
    target: "Target",
    columns: "Columns",
    load: "Load",
    withHeader: "with header",
    withoutHeader: "without header",
    sheet: (name: string) => `sheet ${name}`,
    list: (key: string) => `list in ${key}`,
    rootList: "list of objects",
    decimalPoint: "decimal with point",
    decimalComma: "decimal with comma",
    decimalCommaThousands: "decimal with comma and point as thousands separator",
    datesOf: (format: string) => `dates ${format}`,
    columnsOf: (mapped: number, fileColumns: number, used: number, tableColumns: number, copy: boolean) =>
      `${formatCount(mapped)} of ${formatCount(fileColumns)} ${copy ? "source" : "file"} ${plural(fileColumns, "column", "columns")}, into ${formatCount(used)} of the ${formatCount(tableColumns)} table ${plural(tableColumns, "column", "columns")}`,
    pair: (from: string, to: string) => `${from} → ${to}`,
    empties: "Empties the table first",
    checks: "checks the file first",
    noCheck: "without checking the file first",
    commitEvery: (rows: string) => `commit every ${rows} rows`,
    single: "in a single transaction",
    oneAtATime: "each row written on its own",
    previewProblems: (values: number, rows: number, line: number) =>
      `${rows === 1 ? "In the first row" : `In the first ${formatCount(rows)} rows`}, ${formatCount(values)} ${plural(values, "value does not convert", "values do not convert")}: the import will stop at line ${formatCount(line)} of the file.`,
    unsaved: (table: string, count: number, empty: boolean, copy = false) =>
      empty
        ? `The records tab of ${table} has ${formatCount(count)} unsaved ${plural(count, "change", "changes")}: after the table is emptied, ${plural(count, "it", "they")} can no longer find the rows.`
        : `The records tab of ${table} has ${formatCount(count)} unsaved ${plural(count, "change", "changes")}. The ${copy ? "copy" : "import"} does not carry ${plural(count, "it, and it stays pending", "them, and they stay pending")}.`,
    understand: (schema: string, table: string) => `I understand that the current rows of ${schema}.${table} will be deleted.`,
    understandFirst: "Check that you understand the table will be emptied.",
    outsideElectron: "Import only works in the Prism app.",
    tooLarge: "The request exceeds 16 MiB, because of the column names. Leave columns out in Mapping.",
    limitReached: "There are already 3 transfers in progress (exports, imports or copies to another database). Wait for one to finish, or cancel one in the status bar.",
    connectionMissing: "The connection no longer exists.",
    userNameMissing: "This connection has no saved user. Fill it in under Edit connection and import again.",
    passwordMissing: "This connection has no saved password. Fill it in under Edit connection and import again.",
    sourceUserNameMissing: "The source connection has no saved user. Fill it in under Edit connection and copy again.",
    sourcePasswordMissing: "The source connection has no saved password. Fill it in under Edit connection and copy again.",
    targetUserNameMissing: "The target connection has no saved user. Fill it in under Edit connection and copy again.",
    targetPasswordMissing: "The target connection has no saved password. Fill it in under Edit connection and copy again.",
  },

  question: {
    emptyAndImport: "Empty the table and import?",
    import: "Import data?",
    emptyAndCopy: "Empty the table and copy?",
    copy: "Copy data?",
    emptyDoes: (target: string, source: string) => `Deletes all rows of ${target} and writes those of ${source}.`,
    writeDoes: (source: string, target: string) => `Writes the rows of ${source} into ${target}.`,
    confirmImport: "Import anyway",
    confirmCopy: "Copy anyway",
  },

  status: {
    importing: (file: string, table: string) => `Importing ${file} into ${table}…`,
    copying: (source: string, table: string) => `Copying ${source} to ${table}…`,
    connecting: "connecting",
    counting: "counting the rows",
    checking: (percent: number) => `checking the file, ${percent}%`,
    checkingHint: (read: string, size: string) => `Checking the file before writing: nothing has been written yet · ${read} of ${size} read`,
    emptying: "emptying the table",
    committing: "committing",
    percent: (percent: number) => `${percent}%`,
    rows: (rows: number) => `${formatCount(rows)} ${plural(rows, "row", "rows")}`,
    loadedHint: (rows: number, committed: number | null, read: string | null, size: string | null) =>
      [
        committed === null ? `${formatCount(rows)} ${plural(rows, "row written", "rows written")}` : `${formatCount(rows)} ${plural(rows, "row written", "rows written")}, ${formatCount(committed)} committed`,
        read === null || size === null ? null : `${read} of ${size} read`,
      ]
        .filter((part) => part !== null)
        .join(" · "),
    copiedHint: (rows: number, total: number | null, committed: number) =>
      `${total === null ? `${formatCount(rows)} ${plural(rows, "row", "rows")}` : `${formatCount(rows)} of ${formatCount(total)} rows`} · ${formatCount(committed)} committed`,
    lostImport: "Could not determine the state of the import.",
    lostCopy: "Could not determine the state of the copy.",
    cancelling: "Cancelling…",
    cancel: "Cancel",
    cancelImportLabel: (file: string) => `Cancel the import of ${file}`,
    cancelCopyLabel: (source: string) => `Cancel the copy of ${source}`,
    importProgressLabel: (file: string) => `Progress of the import of ${file}`,
    copyProgressLabel: (source: string) => `Progress of the copy of ${source}`,
    failedImport: (table: string) => `The import into ${table} stopped.`,
    failedCopy: (source: string, table: string) => `The copy of ${source} to ${table} stopped.`,
    showError: "View the error",
    discard: "Discard",
    more: (count: number, kind: "export" | "import" | "copy" | "mixed") => {
      switch (kind) {
        case "export":
          return `+${count} ${plural(count, "export", "exports")}`;
        case "import":
          return `+${count} ${plural(count, "import", "imports")}`;
        case "copy":
          return `+${count} ${plural(count, "copy", "copies")}`;
        case "mixed":
          return `+${count} ${plural(count, "transfer", "transfers")}`;
      }
    },
    listLabel: "Transfers in this window",
  },

  cancelQuestion: {
    importTitle: (table: string) => `Cancel the import into ${table}?`,
    copyTitle: (source: string, table: string) => `Cancel the copy of ${source} to ${table}?`,
    committed: (committed: number) =>
      `${committed === 1 ? "The row already committed stays" : `The ${formatCount(committed)} rows already committed stay`} in the table, and those in the transaction in progress are rolled back.`,
    committedEmptied: (committed: number) =>
      `${committed === 1 ? "The row already committed stays" : `The ${formatCount(committed)} rows already committed stay`} in the table, and the old rows, deleted by the emptying, do not come back.`,
    written: (rows: number) => (rows === 1 ? "The row already written stays in the table." : `The ${formatCount(rows)} rows already written stay in the table.`),
    emptyingNoLog: "The emptying has already started, and the rows it deleted do not come back.",
    unknown: "The rows already committed stay in the table.",
    cancelImport: "Cancel the import",
    keepImporting: "Keep importing",
    cancelCopy: "Cancel the copy",
    keepCopying: "Keep copying",
  },

  toasts: {
    imported: (rows: number, table: string) => `${formatCount(rows)} ${plural(rows, "row imported", "rows imported")} into ${table}.`,
    copied: (rows: number, source: string, table: string) => `${formatCount(rows)} ${plural(rows, "row copied", "rows copied")} from ${source} to ${table}.`,
    lateImport: (table: string, rows: number) => `The import into ${table} had already finished when the cancellation arrived: ${formatCount(rows)} ${plural(rows, "row imported", "rows imported")}.`,
    lateCopy: (source: string, table: string, rows: number) => `The copy of ${source} to ${table} had already finished when the cancellation arrived: ${formatCount(rows)} ${plural(rows, "row copied", "rows copied")}.`,
    openRecords: "Open records",
    emptied: "The table was emptied first.",
    skippedLines: (count: number) => (count === 1 ? "1 empty line in the file was skipped." : `${formatCount(count)} empty lines in the file were skipped.`),
    unguarded: (count: number) => (count === 1 ? "1 value lost the apostrophe that guards against formulas." : `${formatCount(count)} values lost the apostrophe that guards against formulas.`),
    shortRows: (count: number) =>
      count === 1 ? "1 row had fewer values than the header and was completed with null." : `${formatCount(count)} rows had fewer values than the header and were completed with null.`,
    formulasWithoutValue: (count: number) =>
      count === 1 ? "1 formula cell without a stored result arrived empty." : `${formatCount(count)} formula cells without a stored result arrived empty.`,
    failedImport: (table: string) => `The import into ${table} stopped.`,
    failedCopy: (source: string, table: string) => `The copy of ${source} to ${table} stopped.`,
    canceledImport: (table: string) => `Import into ${table} cancelled.`,
    canceledCopy: (source: string, table: string) => `Copy of ${source} to ${table} cancelled.`,
    canceledUncertainImport: (table: string) => `Import into ${table} cancelled, but the database did not respond to the cancellation: Prism does not know what stayed in the table. Check it.`,
    canceledUncertainCopy: (source: string, table: string) => `Copy of ${source} to ${table} cancelled, but the database did not respond to the cancellation: Prism does not know what stayed in the table. Check it.`,
    connectionDeletedImport: (table: string) => `The import into ${table} was cancelled: the connection was deleted.`,
    connectionDeletedCopy: (source: string, table: string) => `The copy of ${source} to ${table} was cancelled: the connection was deleted.`,
    readOnlyImport: (table: string) => `The import into ${table} stopped: the connection became read-only.`,
    readOnlyCopy: (source: string, table: string) => `The copy of ${source} to ${table} stopped: the target connection became read-only.`,
    lostImport: (table: string) => `The import into ${table} was lost: Prism does not know what stayed in the table. Check it.`,
    lostCopy: (source: string, table: string) => `The copy of ${source} to ${table} was lost: Prism does not know what stayed in the table. Check it.`,
    sqlState: (state: string) => `SQLSTATE ${state}`,
    fileLine: (line: number) => `Line ${formatCount(line)} of the file`,
    listItem: (line: number) => `Item ${formatCount(line)} of the list`,
    sheetLine: (line: number, sheet: string) => `Line ${formatCount(line)} of sheet ${sheet}`,
    sourceLine: (line: number) => `Line ${formatCount(line)} of the source`,
    column: (name: string) => `column ${name}`,
    inRange: (first: number, last: number, copy: boolean) => `In lines ${formatCount(first)} to ${formatCount(last)} ${copy ? "of the source" : "of the file"}`,
    readingSource: "When reading the source:",
    writingTarget: "When writing to the target:",
    committedStayed: (committed: number) =>
      committed === 1 ? "1 committed row stayed in the table; those in the transaction in progress were rolled back." : `${formatCount(committed)} committed rows stayed in the table; those in the transaction in progress were rolled back.`,
    nothingStayed: "No row was written, and the table is as before.",
    previousStayed: (rows: number) => (rows === 1 ? "The previous row stayed written." : `The ${formatCount(rows)} previous rows stayed written.`),
    writtenStayed: (rows: number) => (rows === 1 ? "The row written up to that point stayed in the table." : `The ${formatCount(rows)} rows written up to that point stayed in the table.`),
    noneWrittenNoLog: "No row was written.",
    partlyEmptied: (copy: boolean) => `The table may have been partly emptied; no row ${copy ? "from the source" : "from the file"} was written.`,
    uncertainCommit: (first: number, last: number) => `The connection dropped during the commit of ${rangeOf(first, last)}: Prism does not know whether ${first === last ? "it was written" : "they were written"}. Check the table.`,
    uncertainEmptyCommit: (first: number, last: number) =>
      `The connection dropped during the commit of the emptying and of ${rangeOf(first, last)}: Prism does not know whether the table was emptied or whether the rows were written. Check the table.`,
    uncertainEmptyOnly: "The connection dropped during the commit of the emptying: Prism does not know whether the table was emptied. Check the table.",
    uncertainRow: (line: number) => `The connection dropped while writing line ${formatCount(line)}: Prism does not know whether it was written. Check the table.`,
    uncertainCancel: "The database did not respond to the cancellation: Prism does not know what stayed in the table. Check it.",
  },

  failure: {
    importTitle: "Import interrupted",
    copyTitle: "Copy interrupted",
    file: "File",
    source: "Source",
    table: "Table",
    line: "Line",
    column: "Column",
    message: "Message",
    sqlState: "SQLSTATE",
    stayed: "What stayed",
    copyMessage: "Copy the message",
    copied: "Message copied.",
    notCopied: "Could not copy the message.",
    close: "Close",
  },

  records: {
    imported: "Rows were imported into this table after the read.",
    refresh: "Refresh",
  },

  exits: {
    count: (exports: number, imports: number, copies: number) => {
      const parts = [
        exports > 0 ? `${formatCount(exports)} ${plural(exports, "export", "exports")}` : null,
        imports > 0 ? `${formatCount(imports)} ${plural(imports, "import", "imports")}` : null,
        copies > 0 ? `${formatCount(copies)} ${plural(copies, "copy to another database", "copies to another database")}` : null,
      ].filter((part): part is string => part !== null);
      const total = exports + imports + copies;
      if (parts.length === 1) return `There ${total === 1 ? "is" : "are"} ${parts[0]} in progress.`;
      return `There are ${formatCount(total)} transfers in progress: ${listOf(parts)}.`;
    },
    verbs: { signOut: "Sign out", window: "Close the window", app: "Close Prism" },
    buttonVerbs: { signOut: "Sign out", window: "Close", app: "Close Prism" },
    nouns: {
      export: ["export", "exports"],
      import: ["import", "imports"],
      copy: ["copy", "copies"],
      mixed: ["transfer", "transfers"],
    } as Record<"export" | "import" | "copy" | "mixed", readonly [string, string]>,
    keep: { export: "Keep exporting", import: "Keep importing", copy: "Keep copying", mixed: "Keep transferring" } as Record<"export" | "import" | "copy" | "mixed", string>,
    title: (verb: string, plural: string) => `${verb} with ${plural} in progress?`,
    confirm: (verb: string, what: string) => `${verb} and cancel ${what}`,
    pending: (what: string) => `Cancelling ${what}…`,
    cancelsOne: (verb: string, what: string, single: boolean) =>
      single
        ? `${verb} cancels ${what}: the rows it already committed stay in the table, and those in the transaction in progress are rolled back.`
        : `${verb} cancels ${what}: the rows they already committed stay in the tables, and those in the transactions in progress are rolled back.`,
    cancelsLoads: (verb: string) => `${verb} cancels all of them: the rows they already committed stay in the tables, and those in the transactions in progress are rolled back.`,
    cancelsMixed: (verb: string, exports: number, loads: string, single: boolean) =>
      `${verb} cancels all of them: ${exports === 1 ? "the export file is not written" : "the export files are not written"}, and ${loads} ${single ? "leaves in the table only the rows it already committed" : "leave in the tables only the rows they already committed"}.`,
    aheadOne: (noun: string) => `The ${noun} in progress will be cancelled, and only the rows it already committed stay in the table.`,
    aheadKind: (count: number, plural: string) => `The ${formatCount(count)} ${plural} in progress will be cancelled, and only the rows they already committed stay in the tables.`,
    aheadMixed: (count: number, loads: string, single: boolean) =>
      `The ${formatCount(count)} transfers in progress will be cancelled: ${single ? `only what ${loads} already committed stays in the table` : `only the rows that ${loads} already committed stay in the tables`}.`,
    connectionOne: (noun: string) => `The ${noun} in progress on this connection will be cancelled, and only what it already committed stays in the table.`,
    connectionMany: (count: number, plural: string, loads: string, single: boolean) =>
      `The ${formatCount(count)} ${plural} in progress on this connection will be cancelled. ${loads.charAt(0).toUpperCase()}${loads.slice(1)} ${single ? "leaves in the table only the rows it already committed" : "leave in the tables only the rows they already committed"}.`,
    loads: (imports: number, copies: number) =>
      imports > 0 && copies > 0 ? "the imports and the copies" : imports > 0 ? (imports === 1 ? "the import" : "the imports") : copies === 1 ? "the copy" : "the copies",
    copyNoun: "copy to another database",
    objects: { export: ["the export", "the exports"], import: ["the import", "the imports"], copy: ["the copy", "the copies"], mixed: ["the transfer", "the transfers"] } as Record<"export" | "import" | "copy" | "mixed", readonly [string, string]>,
    titleVerbs: { signOut: "Sign out", window: "Close", app: "Close" },
    copyNounPlural: "copies to another database",
  },
};
