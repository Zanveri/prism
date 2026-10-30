import type { BuildEngine, FkAction } from "./build-model.schema";

export type EngineRules = {
  label: string;
  tag: "PG" | "DB2" | "IFX" | "SQL" | "MY" | "MDB" | "MS" | "ORA" | "FB" | "DK" | "CH" | "BQ" | "DBX";
  identifierLimit: number;
  limitInBytes: boolean;
  hasSchemas: boolean;
  plainName: RegExp;
  fold: "lower" | "upper";
  reserved: ReadonlySet<string>;
  types: readonly string[];
  deleteActions: readonly FkAction[];
  updateActions: readonly FkAction[];
};

const commonReserved = [
  "all",
  "alter",
  "and",
  "any",
  "as",
  "asc",
  "between",
  "by",
  "case",
  "check",
  "column",
  "constraint",
  "create",
  "cross",
  "current",
  "Current_date",
  "current_time",
  "current_timestamp",
  "current_user",
  "default",
  "delete",
  "desc",
  "distinct",
  "drop",
  "else",
  "end",
  "exists",
  "false",
  "fetch",
  "for",
  "foreign",
  "from",
  "full",
  "grant",
  "group",
  "having",
  "in",
  "index",
  "inner",
  "insert",
  "into",
  "is",
  "join",
  "key",
  "left",
  "like",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "outer",
  "primary",
  "references",
  "revoke",
  "right",
  "select",
  "session_user",
  "set",
  "some",
  "table",
  "then",
  "to",
  "true",
  "union",
  "unique",
  "update",
  "user",
  "using",
  "values",
  "view",
  "when",
  "where",
  "with",
].map((word) => word.toLowerCase());

export const engineRules: Record<BuildEngine, EngineRules> = {
  postgresql: {
    label: "PostgreSQL",
    tag: "PG",
    identifierLimit: 63,
    limitInBytes: true,
    hasSchemas: true,
    plainName: /^[a-z_][a-z0-9_$]*$/,
    fold: "lower",
    reserved: new Set([
      ...commonReserved,
      "analyse",
      "analyze",
      "array",
      "asymmetric",
      "both",
      "cast",
      "collate",
      "concurrently",
      "deferrable",
      "do",
      "except",
      "freeze",
      "ilike",
      "initially",
      "intersect",
      "lateral",
      "leading",
      "localtime",
      "localtimestamp",
      "natural",
      "Overlay",
      "placing",
      "returning",
      "similar",
      "symmetric",
      "tablesample",
      "trailing",
      "variadic",
      "verbose",
      "window",
    ].map((word) => word.toLowerCase())),
    types: [
      "bigint",
      "integer",
      "smallint",
      "serial",
      "bigserial",
      "smallserial",
      "numeric",
      "decimal",
      "real",
      "double precision",
      "varchar",
      "char",
      "text",
      "boolean",
      "date",
      "time",
      "timetz",
      "timestamptz",
      "timestamp",
      "interval",
      "uuid",
      "json",
      "jsonb",
      "bytea",
      "inet",
      "cidr",
      "macaddr",
      "xml",
    ],
    deleteActions: ["noAction", "restrict", "cascade", "setNull"],
    updateActions: ["noAction", "restrict", "cascade", "setNull"],
  },
  db2: {
    label: "Db2",
    tag: "DB2",
    identifierLimit: 128,
    limitInBytes: false,
    hasSchemas: true,
    plainName: /^[A-Za-z][A-Za-z0-9_]*$/,
    fold: "upper",
    reserved: new Set([
      ...commonReserved,
      "activate",
      "alias",
      "allow",
      "associate",
      "audit",
      "aux",
      "auxiliary",
      "before",
      "binary",
      "bufferpool",
      "call",
      "called",
      "capture",
      "cascaded",
      "ccsid",
      "cluster",
      "collection",
      "collid",
      "comment",
      "commit",
      "concat",
      "condition",
      "connect",
      "connection",
      "contains",
      "continue",
      "count",
      "cursor",
      "cycle",
      "data",
      "database",
      "day",
      "days",
      "db2general",
      "db2genrl",
      "db2sql",
      "dbinfo",
      "declare",
      "deterministic",
      "disallow",
      "disconnect",
      "double",
      "dsnhattr",
      "dssize",
      "dynamic",
      "editproc",
      "elseif",
      "encryption",
      "ending",
      "end-exec",
      "erase",
      "escape",
      "except",
      "exception",
      "execute",
      "exit",
      "explain",
      "external",
      "fenced",
      "fieldproc",
      "file",
      "final",
      "free",
      "function",
      "generated",
      "get",
      "global",
      "go",
      "goto",
      "graphic",
      "handler",
      "hold",
      "hour",
      "hours",
      "if",
      "immediate",
      "inclusive",
      "increment",
      "indicator",
      "inherit",
      "inout",
      "insensitive",
      "integrity",
      "intersect",
      "isolation",
      "iterate",
      "jar",
      "java",
      "label",
      "language",
      "lc_ctype",
      "leave",
      "linktype",
      "local",
      "locale",
      "locator",
      "locators",
      "lock",
      "lockmax",
      "locksize",
      "long",
      "loop",
      "maintained",
      "materialized",
      "microsecond",
      "microseconds",
      "minute",
      "minutes",
      "modifies",
      "month",
      "months",
      "nextval",
      "no",
      "nocache",
      "nocycle",
      "nodename",
      "nodenumber",
      "nomaxvalue",
      "nominvalue",
      "none",
      "noorder",
      "normalized",
      "nulls",
      "numparts",
      "obid",
      "of",
      "old",
      "open",
      "optimization",
      "optimize",
      "out",
      "overriding",
      "package",
      "padded",
      "pagesize",
      "parameter",
      "part",
      "partition",
      "partitioned",
      "partitioning",
      "path",
      "piecesize",
      "plan",
      "position",
      "precision",
      "prepare",
      "prevval",
      "priqty",
      "privileges",
      "procedure",
      "program",
      "psid",
      "public",
      "query",
      "queryno",
      "reads",
      "recovery",
      "refresh",
      "release",
      "rename",
      "repeat",
      "reset",
      "resignal",
      "restart",
      "restrict",
      "result",
      "result_set_locator",
      "return",
      "returns",
      "role",
      "rollback",
      "round_ceiling",
      "round_down",
      "round_floor",
      "round_half_down",
      "round_half_even",
      "round_half_up",
      "round_up",
      "routine",
      "row",
      "rowset",
      "run",
      "savepoint",
      "schema",
      "scratchpad",
      "scroll",
      "search",
      "second",
      "seconds",
      "secqty",
      "security",
      "sensitive",
      "sequence",
      "signal",
      "simple",
      "source",
      "specific",
      "sql",
      "sqlid",
      "stacked",
      "standard",
      "start",
      "starting",
      "statement",
      "static",
      "statment",
      "stay",
      "stogroup",
      "stores",
      "style",
      "summary",
      "synonym",
      "sysdate",
      "system",
      "systimestamp",
      "tablespace",
      "technical",
      "time",
      "timestamp",
      "transaction",
      "trigger",
      "truncate",
      "type",
      "undo",
      "until",
      "usage",
      "validproc",
      "value",
      "variable",
      "variant",
      "vcat",
      "volumes",
      "while",
      "wlm",
      "write",
      "xmlexists",
      "xmlnamespaces",
      "xmlcast",
      "year",
      "years",
    ].map((word) => word.toLowerCase())),
    types: [
      "bigint",
      "integer",
      "smallint",
      "decimal",
      "numeric",
      "real",
      "double",
      "decfloat",
      "varchar",
      "char",
      "clob",
      "graphic",
      "vargraphic",
      "boolean",
      "date",
      "time",
      "timestamp",
      "blob",
      "binary",
      "varbinary",
      "xml",
    ],
    deleteActions: ["noAction", "restrict", "cascade", "setNull"],
    updateActions: ["noAction", "restrict"],
  },
  informix: {
    label: "Informix",
    tag: "IFX",
    identifierLimit: 128,
    limitInBytes: false,
    hasSchemas: false,
    plainName: /^[a-z_][a-z0-9_]*$/,
    fold: "lower",
    reserved: new Set([
      ...commonReserved,
      "access",
      "add",
      "after",
      "aggregate",
      "alignment",
      "alloc",
      "allocation",
      "audit",
      "before",
      "begin",
      "blob",
      "boolean",
      "both",
      "byte",
      "call",
      "cascade",
      "cast",
      "char",
      "character",
      "clob",
      "close",
      "cluster",
      "collation",
      "comment",
      "commit",
      "committed",
      "connect",
      "connection",
      "constant",
      "continue",
      "Copy",
      "count",
      "cursor",
      "database",
      "date",
      "datetime",
      "day",
      "dba",
      "dbspace",
      "deallocate",
      "dec",
      "decimal",
      "declare",
      "deferred",
      "define",
      "delimiter",
      "dirty",
      "Disabled",
      "disconnect",
      "display",
      "distribution",
      "document",
      "domain",
      "double",
      "duplicate",
      "each",
      "elif",
      "enable",
      "enabled",
      "encrypted",
      "error",
      "escape",
      "exception",
      "exclusive",
      "exec",
      "execute",
      "exit",
      "explain",
      "express",
      "expression",
      "extend",
      "extent",
      "external",
      "file",
      "fillfactor",
      "filtering",
      "first",
      "fixed",
      "float",
      "foreach",
      "format",
      "fraction",
      "fragment",
      "free",
      "function",
      "global",
      "globals",
      "go",
      "goto",
      "high",
      "hold",
      "hour",
      "if",
      "immediate",
      "implicit",
      "inactive",
      "increment",
      "index",
      "indicator",
      "informa",
      "init",
      "inline",
      "inout",
      "input",
      "int",
      "int8",
      "integer",
      "integ",
      "internal",
      "interval",
      "isolation",
      "javavm",
      "label",
      "language",
      "last",
      "leading",
      "let",
      "level",
      "like",
      "list",
      "listing",
      "load",
      "local",
      "locator",
      "lock",
      "locks",
      "log",
      "long",
      "low",
      "lvarchar",
      "matches",
      "max",
      " maxvalue",
      "medium",
      "memory",
      "min",
      "minute",
      "minvalue",
      "mode",
      "moderate",
      "modify",
      "module",
      "money",
      "month",
      "multiset",
      "name",
      "nchar",
      "new",
      "next",
      "no",
      "nocache",
      "nocycle",
      "nomaxvalue",
      "nominvalue",
      "none",
      "noorder",
      "normal",
      "note",
      "numeric",
      "nvarchar",
      "object",
      "of",
      "off",
      "old",
      "online",
      "only",
      "opaque",
      "opclass",
      "open",
      "optical",
      "optimization",
      "option",
      "out",
      "output",
      "page",
      "parallel",
      "parameter",
      "partition",
      "pascal",
      "passthrough",
      "password",
      "pdqpriority",
      "per",
      "pipe",
      "pli",
      "precision",
      "prepare",
      "previous",
      "private",
      "privileges",
      "procedure",
      "public",
      "put",
      "raw",
      "read",
      "real",
      "record",
      "referencing",
      "register",
      "release",
      "remainder",
      "rename",
      "reoptimization",
      "repeatable",
      "replication",
      "reserve",
      "resolution",
      "resource",
      "restrict",
      "resume",
      "retain",
      "return",
      "returning",
      "returns",
      "reuse",
      "role",
      "rollback",
      "rollforward",
      "routine",
      "row",
      "rowid",
      "rows",
      "sameas",
      "samples",
      "save",
      "schedule",
      "schema",
      "scratch",
      "scroll",
      "second",
      "section",
      "self",
      "sequence",
      "serial",
      "serial8",
      "bigserial",
      "serializable",
      "server",
      "serveruuid",
      "session",
      "share",
      "short",
      "siblings",
      "size",
      "skall",
      "skinhibit",
      "skip",
      "skshow",
      "smallfloat",
      "smallint",
      "stability",
      "stack",
      "standard",
      "start",
      "starting",
      "static",
      "statistics",
      "step",
      "stop",
      "storage",
      "strategies",
      "string",
      "struct",
      "style",
      "sum",
      "synonym",
      "system",
      "table",
      "tables",
      "temp",
      "template",
      "test",
      "text",
      "time",
      "timeout",
      "today",
      "trace",
      "trailing",
      "transaction",
      "transition",
      "trigger",
      "triggers",
      "trim",
      "truncate",
      "type",
      "typedef",
      "uncommitted",
      "under",
      "unencrypted",
      "union",
      "unique",
      "units",
      "unknown",
      "unload",
      "unlock",
      "unsigned",
      "update",
      "usage",
      "user",
      "using",
      "value",
      "values",
      "var",
      "varchar",
      "variable",
      "variant",
      "varying",
      "view",
      "violations",
      "void",
      "volatile",
      "wait",
      "warning",
      "weekday",
      "whenever",
      "while",
      "with",
      "without",
      "work",
      "write",
      "year",
    ].map((word) => word.trim().toLowerCase())),
    types: [
      "bigserial",
      "serial8",
      "serial",
      "bigint",
      "int8",
      "integer",
      "smallint",
      "decimal",
      "numeric",
      "money",
      "smallfloat",
      "float",
      "varchar",
      "lvarchar",
      "char",
      "nchar",
      "nvarchar",
      "text",
      "clob",
      "boolean",
      "date",
      "datetime",
      "interval",
      "byte",
      "blob",
    ],
    deleteActions: ["noAction", "cascade"],
    updateActions: ["noAction"],
  },
  sqlite: {
    label: "SQLite",
    tag: "SQL",
    identifierLimit: 128,
    limitInBytes: false,
    hasSchemas: false,
    plainName: /^[A-Za-z_][A-Za-z0-9_]*$/,
    fold: "lower",
    reserved: new Set(commonReserved),
    types: [
      "integer",
      "bigint",
      "smallint",
      "real",
      "numeric",
      "decimal",
      "text",
      "varchar",
      "char",
      "boolean",
      "date",
      "datetime",
      "timestamp",
      "blob",
      "json",
    ],
    deleteActions: ["noAction", "restrict", "cascade", "setNull"],
    updateActions: ["noAction", "restrict", "cascade", "setNull"],
  },
  mysql: {
    label: "MySQL",
    tag: "MY",
    identifierLimit: 64,
    limitInBytes: false,
    hasSchemas: true,
    plainName: /^[A-Za-z_][A-Za-z0-9_$]*$/,
    fold: "lower",
    reserved: new Set(commonReserved),
    types: [
      "bigint",
      "integer",
      "smallint",
      "tinyint",
      "decimal",
      "numeric",
      "float",
      "double",
      "varchar",
      "char",
      "text",
      "longtext",
      "boolean",
      "date",
      "time",
      "datetime",
      "timestamp",
      "json",
      "blob",
      "binary",
      "varbinary",
    ],
    deleteActions: ["noAction", "restrict", "cascade", "setNull"],
    updateActions: ["noAction", "restrict", "cascade", "setNull"],
  },
  mariadb: {
    label: "MariaDB",
    tag: "MDB",
    identifierLimit: 64,
    limitInBytes: false,
    hasSchemas: true,
    plainName: /^[A-Za-z_][A-Za-z0-9_$]*$/,
    fold: "lower",
    reserved: new Set(commonReserved),
    types: [
      "bigint",
      "integer",
      "smallint",
      "tinyint",
      "decimal",
      "numeric",
      "float",
      "double",
      "varchar",
      "char",
      "text",
      "longtext",
      "boolean",
      "date",
      "time",
      "datetime",
      "timestamp",
      "uuid",
      "json",
      "blob",
      "binary",
      "varbinary",
    ],
    deleteActions: ["noAction", "restrict", "cascade", "setNull"],
    updateActions: ["noAction", "restrict", "cascade", "setNull"],
  },
  sqlserver: {
    label: "SQL Server",
    tag: "MS",
    identifierLimit: 128,
    limitInBytes: false,
    hasSchemas: true,
    plainName: /^[A-Za-z_][A-Za-z0-9_]*$/,
    fold: "lower",
    reserved: new Set(commonReserved),
    types: [
      "bigint",
      "int",
      "integer",
      "smallint",
      "tinyint",
      "bit",
      "decimal",
      "numeric",
      "money",
      "float",
      "real",
      "varchar",
      "nvarchar",
      "char",
      "nchar",
      "text",
      "date",
      "time",
      "datetime",
      "datetime2",
      "datetimeoffset",
      "uniqueidentifier",
      "varbinary",
      "binary",
      "xml",
    ],
    deleteActions: ["noAction", "cascade", "setNull"],
    updateActions: ["noAction", "cascade", "setNull"],
  },
  oracle: {
    label: "Oracle",
    tag: "ORA",
    identifierLimit: 128,
    limitInBytes: true,
    hasSchemas: true,
    plainName: /^[A-Za-z][A-Za-z0-9_$#]*$/,
    fold: "upper",
    reserved: new Set(commonReserved),
    types: [
      "number",
      "integer",
      "smallint",
      "decimal",
      "numeric",
      "float",
      "binary_float",
      "binary_double",
      "varchar2",
      "nvarchar2",
      "varchar",
      "char",
      "nchar",
      "clob",
      "nclob",
      "date",
      "timestamp",
      "raw",
      "blob",
    ],
    deleteActions: ["noAction", "cascade", "setNull"],
    updateActions: ["noAction"],
  },
  firebird: {
    label: "Firebird",
    tag: "FB",
    identifierLimit: 63,
    limitInBytes: false,
    hasSchemas: false,
    plainName: /^[A-Za-z][A-Za-z0-9_$]*$/,
    fold: "upper",
    reserved: new Set(commonReserved),
    types: [
      "bigint",
      "integer",
      "smallint",
      "numeric",
      "decimal",
      "float",
      "double precision",
      "varchar",
      "char",
      "boolean",
      "date",
      "time",
      "timestamp",
      "blob",
    ],
    deleteActions: ["noAction", "restrict", "cascade", "setNull"],
    updateActions: ["noAction", "restrict", "cascade", "setNull"],
  },
  duckdb: {
    label: "DuckDB",
    tag: "DK",
    identifierLimit: 128,
    limitInBytes: false,
    hasSchemas: true,
    plainName: /^[a-z_][a-z0-9_]*$/,
    fold: "lower",
    reserved: new Set(commonReserved),
    types: [
      "bigint",
      "integer",
      "smallint",
      "tinyint",
      "hugeint",
      "decimal",
      "numeric",
      "real",
      "double",
      "varchar",
      "char",
      "text",
      "boolean",
      "date",
      "time",
      "timestamp",
      "timestamptz",
      "interval",
      "uuid",
      "json",
      "blob",
    ],
    deleteActions: ["noAction", "restrict"],
    updateActions: ["noAction", "restrict"],
  },
  clickhouse: {
    label: "ClickHouse",
    tag: "CH",
    identifierLimit: 128,
    limitInBytes: false,
    hasSchemas: true,
    plainName: /^[A-Za-z_][A-Za-z0-9_]*$/,
    fold: "lower",
    reserved: new Set(commonReserved),
    types: [
      "int64",
      "int32",
      "int16",
      "int8",
      "uint64",
      "uint32",
      "bigint",
      "integer",
      "smallint",
      "decimal",
      "float64",
      "float32",
      "string",
      "varchar",
      "fixedstring",
      "bool",
      "boolean",
      "date",
      "datetime",
      "datetime64",
      "uuid",
      "json",
    ],
    deleteActions: ["noAction"],
    updateActions: ["noAction"],
  },
  bigquery: {
    label: "BigQuery",
    tag: "BQ",
    identifierLimit: 128,
    limitInBytes: false,
    hasSchemas: true,
    plainName: /^[A-Za-z_][A-Za-z0-9_]*$/,
    fold: "lower",
    reserved: new Set(commonReserved),
    types: [
      "int64",
      "bigint",
      "integer",
      "numeric",
      "bignumeric",
      "decimal",
      "float64",
      "string",
      "varchar",
      "bytes",
      "bool",
      "boolean",
      "date",
      "time",
      "datetime",
      "timestamp",
      "json",
    ],
    deleteActions: ["noAction"],
    updateActions: ["noAction"],
  },
  databricks: {
    label: "Databricks",
    tag: "DBX",
    identifierLimit: 128,
    limitInBytes: false,
    hasSchemas: true,
    plainName: /^[A-Za-z_][A-Za-z0-9_]*$/,
    fold: "lower",
    reserved: new Set(commonReserved),
    types: [
      "bigint",
      "int",
      "integer",
      "smallint",
      "tinyint",
      "decimal",
      "numeric",
      "float",
      "double",
      "string",
      "varchar",
      "char",
      "boolean",
      "date",
      "timestamp",
      "binary",
    ],
    deleteActions: ["noAction"],
    updateActions: ["noAction"],
  },
};

export function needsQuotes(engine: BuildEngine, name: string, exactName = false): boolean {
  if (exactName) {
    return true;
  }
  const rules = engineRules[engine];
  return !rules.plainName.test(name) || rules.reserved.has(name.toLowerCase());
}

export function quoteName(engine: BuildEngine, name: string, exactName: boolean): string {
  if (!needsQuotes(engine, name, exactName)) {
    return name;
  }
  return `"${name.replaceAll('"', '""')}"`;
}

function canonicalName(engine: BuildEngine, item: { name: string; exactName: boolean }): string {
  if (item.exactName) {
    return item.name;
  }
  return engineRules[engine].fold === "upper"
    ? item.name.toUpperCase()
    : item.name.toLowerCase();
}

export function sameName(
  engine: BuildEngine,
  a: { name: string; exactName: boolean },
  b: { name: string; exactName: boolean },
): boolean {
  return canonicalName(engine, a) === canonicalName(engine, b);
}

export function exactNameFromCatalog(engine: BuildEngine, name: string): boolean {
  const rules = engineRules[engine];
  if (rules.fold === "upper") {
    return name !== name.toUpperCase() || !rules.plainName.test(name) || rules.reserved.has(name.toLowerCase());
  }
  return name !== name.toLowerCase() || !rules.plainName.test(name) || rules.reserved.has(name.toLowerCase());
}

export type NormalizedType = {
  family: "integer" | "decimal" | "float" | "text" | "datetime" | "boolean" | "binary" | "other";
  base: string;
  args: number[];
};

const knownAliases: Record<BuildEngine, ReadonlySet<string>> = {
  postgresql: new Set([
    "int",
    "int2",
    "int4",
    "int8",
    "serial2",
    "serial4",
    "serial8",
    "float4",
    "float8",
    "float",
    "bool",
    "dec",
    "character varying",
    "character",
    "bpchar",
    "timestamp without time zone",
    "timestamp with time zone",
    "time without time zone",
    "time with time zone",
  ]),
  db2: new Set([
    "int",
    "dec",
    "float",
    "double precision",
    "character varying",
    "char varying",
    "character",
  ]),
  sqlite: new Set(["int", "int2", "int8", "bool", "float", "double", "double precision"]),
  mysql: new Set(["int", "bool", "dec", "double precision", "character varying"]),
  mariadb: new Set(["int", "bool", "dec", "double precision", "character varying"]),
  sqlserver: new Set(["bool", "boolean", "dec", "double precision", "character varying"]),
  oracle: new Set(["int", "dec", "double precision", "character varying", "bool", "boolean"]),
  firebird: new Set(["int", "dec", "bool", "character varying"]),
  duckdb: new Set(["int", "int2", "int4", "int8", "bool", "float", "float4", "float8", "dec", "double precision"]),
  clickhouse: new Set(["int", "float", "double", "text"]),
  bigquery: new Set(["int", "float", "double", "text", "varchar"]),
  databricks: new Set(["bool", "dec", "text", "datetime"]),
  informix: new Set([
    "int",
    "dec",
    "double precision",
    "character varying",
    "character",
  ]),
};

export function isKnownEngineType(engine: BuildEngine, type: string): boolean {
  const raw = type.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  const basePart = raw.replace(/\s*\(.*$/, "").trim();
  const rules = engineRules[engine];
  if (rules.types.includes(basePart) || knownAliases[engine].has(basePart)) {
    return true;
  }
  if (engine === "informix" && (basePart.startsWith("datetime ") || basePart.startsWith("interval "))) {
    return true;
  }
  return false;
}

export function normalizeType(_engine: BuildEngine, type: string): NormalizedType {
  const raw = type.trim().toLowerCase().replace(/\s+/g, " ");
  const parenIndex = raw.indexOf("(");
  const baseRaw = (parenIndex >= 0 ? raw.slice(0, parenIndex) : raw).trim();
  const args: number[] = [];

  if (parenIndex >= 0) {
    const closeIndex = raw.indexOf(")", parenIndex);
    const inside = closeIndex >= 0 ? raw.slice(parenIndex + 1, closeIndex) : raw.slice(parenIndex + 1);
    for (const part of inside.split(",")) {
      const parsed = Number.parseInt(part.trim(), 10);
      if (!Number.isNaN(parsed)) {
        args.push(parsed);
      }
    }
  }

  if (baseRaw === "int2" || baseRaw === "smallint" || baseRaw === "smallserial" || baseRaw === "serial2") {
    return { family: "integer", base: "smallint", args: [] };
  }
  if (baseRaw === "int" || baseRaw === "int4" || baseRaw === "integer" || baseRaw === "serial" || baseRaw === "serial4") {
    return { family: "integer", base: "integer", args: [] };
  }
  if (baseRaw === "int8" || baseRaw === "bigint" || baseRaw === "bigserial" || baseRaw === "serial8") {
    return { family: "integer", base: "bigint", args: [] };
  }
  if (baseRaw === "numeric" || baseRaw === "decimal" || baseRaw === "dec" || baseRaw === "money") {
    return { family: "decimal", base: "numeric", args };
  }
  if (baseRaw === "real" || baseRaw === "float4" || baseRaw === "smallfloat") {
    return { family: "float", base: "real", args: [] };
  }
  if (baseRaw === "double precision" || baseRaw === "float8" || baseRaw === "float" || baseRaw === "double" || baseRaw === "decfloat") {
    return { family: "float", base: "double precision", args };
  }
  if (baseRaw === "varchar" || baseRaw === "character varying" || baseRaw === "char varying" || baseRaw === "nvarchar" || baseRaw === "vargraphic") {
    return { family: "text", base: "varchar", args };
  }
  if (baseRaw === "lvarchar") {
    return { family: "text", base: "lvarchar", args };
  }
  if (baseRaw === "char" || baseRaw === "character" || baseRaw === "bpchar" || baseRaw === "nchar" || baseRaw === "graphic") {
    return { family: "text", base: "char", args };
  }
  if (baseRaw === "text" || baseRaw === "clob") {
    return { family: "text", base: "text", args: [] };
  }
  if (baseRaw === "bool" || baseRaw === "boolean") {
    return { family: "boolean", base: "boolean", args: [] };
  }
  if (baseRaw === "date") {
    return { family: "datetime", base: "date", args: [] };
  }
  if (baseRaw === "time" || baseRaw === "time without time zone") {
    return { family: "datetime", base: "time", args };
  }
  if (baseRaw === "timetz" || baseRaw === "time with time zone") {
    return { family: "datetime", base: "timetz", args };
  }
  if (baseRaw === "timestamp" || baseRaw === "timestamp without time zone" || baseRaw === "datetime" || baseRaw.startsWith("datetime ")) {
    return { family: "datetime", base: "timestamp", args };
  }
  if (baseRaw === "timestamptz" || baseRaw === "timestamp with time zone") {
    return { family: "datetime", base: "timestamptz", args };
  }
  if (baseRaw === "interval" || baseRaw.startsWith("interval ")) {
    return { family: "datetime", base: "interval", args };
  }
  if (baseRaw === "bytea" || baseRaw === "blob" || baseRaw === "byte" || baseRaw === "binary" || baseRaw === "varbinary") {
    return { family: "binary", base: baseRaw, args };
  }

  return { family: "other", base: baseRaw, args };
}

const integerRank: Record<string, number> = {
  smallint: 1,
  integer: 2,
  bigint: 3,
};

const floatRank: Record<string, number> = {
  real: 1,
  "double precision": 2,
};

export function typeNarrows(engine: BuildEngine, from: string, to: string): boolean {
  const a = normalizeType(engine, from);
  const b = normalizeType(engine, to);

  if (a.family !== b.family) {
    return true;
  }

  if (a.family === "integer") {
    return (integerRank[b.base] ?? 0) < (integerRank[a.base] ?? 0);
  }

  if (a.family === "float") {
    return (floatRank[b.base] ?? 0) < (floatRank[a.base] ?? 0);
  }

  if (a.family === "text") {
    if (a.base === "text" && b.base !== "text") {
      return true;
    }
    if (a.args.length === 0 && b.args.length > 0) {
      return true;
    }
    if (a.args.length > 0 && b.args.length > 0) {
      return b.args[0]! < a.args[0]!;
    }
    return false;
  }

  if (a.family === "decimal") {
    if (a.args.length === 0 && b.args.length > 0) {
      return true;
    }
    if (a.args.length > 0 && b.args.length > 0) {
      if (b.args[0]! < a.args[0]!) {
        return true;
      }
      const scaleA = a.args[1] ?? 0;
      const scaleB = b.args[1] ?? 0;
      return scaleB < scaleA;
    }
    return false;
  }

  if (a.family === "other" && a.base !== b.base) {
    return true;
  }

  return false;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        val = Math.min(val, dp[i - 2]![j - 2]! + 1);
      }
      dp[i]![j] = val;
    }
  }
  return dp[m]![n]!;
}

export function closestType(engine: BuildEngine, type: string): string | null {
  const raw = type.trim();
  const parenIndex = raw.indexOf("(");
  const basePart = (parenIndex >= 0 ? raw.slice(0, parenIndex) : raw).trim().toLowerCase();
  const suffix = parenIndex >= 0 ? raw.slice(parenIndex).trim() : "";

  let best: string | null = null;
  let bestDist = 3;

  for (const candidate of engineRules[engine].types) {
    const dist = editDistance(basePart, candidate.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  if (!best) {
    return null;
  }
  return suffix ? `${best}${suffix}` : best;
}
