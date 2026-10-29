import { quoteName } from "@/app/build/_lib/build-engines";
import type {
  BuildEngine,
  BuildModel,
  FkAction,
  ModelCheck,
  ModelColumn,
  ModelForeignKey,
  ModelIndex,
  ModelTable,
  ModelUnique,
} from "@/app/build/_lib/build-model.schema";
import {
  mergeTextTables,
  sameIdent,
  type TextRead,
  type TextWarning,
} from "@/app/build/_lib/text-merge";

function formatDbmlIdent(engine: BuildEngine, name: string, exactName: boolean): string {
  return quoteName(engine, name, exactName);
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function unescapeSingleQuotes(value: string): string {
  return value.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function formatDefaultValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed;
  }
  if (/^(true|false)$/i.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }
  return `\`${trimmed}\``;
}

function formatFkAction(action: FkAction): string {
  switch (action) {
    case "noAction":
      return "no action";
    case "restrict":
      return "restrict";
    case "cascade":
      return "cascade";
    case "setNull":
      return "set null";
    case "setDefault":
      return "set default";
  }
}

function parseFkAction(raw: string): FkAction | null {
  const norm = raw.trim().toLowerCase().replace(/\s+/g, " ");
  switch (norm) {
    case "no action":
      return "noAction";
    case "restrict":
      return "restrict";
    case "cascade":
      return "cascade";
    case "set null":
      return "setNull";
    case "set default":
      return "setDefault";
    default:
      return null;
  }
}

function canInlineFk(engine: BuildEngine, table: ModelTable, fk: ModelForeignKey): boolean {
  if (fk.columns.length !== 1 || fk.target.columns.length !== 1) return false;
  if (fk.onDelete !== "noAction" || fk.onUpdate !== "noAction") return false;
  if (fk.name !== null && table.origin === null) return false;
  const matchingForColumn = table.foreignKeys.filter(
    (other) => other.columns.length === 1 && sameIdent(engine, other.columns[0], fk.columns[0]),
  );
  return matchingForColumn.length === 1;
}

function findInlineCheckColumn(table: ModelTable, check: ModelCheck): ModelColumn | null {
  if (check.name !== null) return null;
  const expr = check.expression.trim();
  const matches = table.columns.filter((col) => {
    const escaped = col.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}\\b`, "i").test(expr);
  });
  if (matches.length !== 1) return null;
  const col = matches[0];
  const otherChecksForCol = table.checks.filter(
    (other) =>
      other !== check &&
      other.name === null &&
      new RegExp(`^${col.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        other.expression.trim(),
      ),
  );
  return otherChecksForCol.length === 0 ? col : null;
}

function printTableDbml(
  engine: BuildEngine,
  table: ModelTable,
): { text: string; standaloneFks: { table: ModelTable; fk: ModelForeignKey }[] } {
  const lines: string[] = [];
  const tableHeader = `${table.schema}.${formatDbmlIdent(engine, table.name, table.exactName)}`;
  lines.push(`Table ${tableHeader} {`);

  const isSinglePk = (colName: string) =>
    table.primaryKey !== null &&
    table.primaryKey.columns.length === 1 &&
    sameIdent(engine, table.primaryKey.columns[0], colName);

  const isSingleUnnamedUnique = (colName: string) =>
    table.uniques.some(
      (uq) =>
        uq.columns.length === 1 &&
        sameIdent(engine, uq.columns[0], colName) &&
        (uq.name === null || table.origin !== null),
    );

  const inlinedChecks = new Set<ModelCheck>();
  const standaloneFks: { table: ModelTable; fk: ModelForeignKey }[] = [];

  for (const fk of table.foreignKeys) {
    if (!canInlineFk(engine, table, fk)) {
      standaloneFks.push({ table, fk });
    }
  }

  for (const col of table.columns) {
    const settings: string[] = [];
    const singlePk = isSinglePk(col.name);
    if (singlePk) {
      settings.push("pk");
    }
    if (col.identity !== null) {
      settings.push("increment");
    }
    if (!col.nullable && !singlePk) {
      settings.push("not null");
    }
    if (isSingleUnnamedUnique(col.name)) {
      settings.push("unique");
    }
    if (col.default !== null) {
      settings.push(`default: ${formatDefaultValue(col.default)}`);
    }

    const inlineFk = table.foreignKeys.find(
      (fk) => canInlineFk(engine, table, fk) && sameIdent(engine, fk.columns[0], col.name),
    );
    if (inlineFk) {
      settings.push(
        `ref: > ${inlineFk.target.schema}.${inlineFk.target.table}.${inlineFk.target.columns[0]}`,
      );
    }

    const inlineCheck = table.checks.find((chk) => {
      const targetCol = findInlineCheckColumn(table, chk);
      return targetCol !== null && sameIdent(engine, targetCol.name, col.name);
    });
    if (inlineCheck) {
      inlinedChecks.add(inlineCheck);
      settings.push(`check: \`${inlineCheck.expression}\``);
    }

    if (col.comment !== null) {
      settings.push(`note: '${escapeSingleQuotes(col.comment)}'`);
    }

    const colName = formatDbmlIdent(engine, col.name, col.exactName);
    const settingsSuffix = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
    lines.push(`  ${colName} ${col.type}${settingsSuffix}`);
  }

  const indexEntries: string[] = [];
  if (table.primaryKey && table.primaryKey.columns.length > 1) {
    indexEntries.push(`    (${table.primaryKey.columns.join(", ")}) [pk]`);
  }
  for (const uq of table.uniques) {
    if (uq.columns.length === 1 && (uq.name === null || table.origin !== null)) {
      continue;
    }
    const colsExpr = uq.columns.length === 1 ? uq.columns[0] : `(${uq.columns.join(", ")})`;
    const uqSettings = ["unique"];
    if (uq.name && table.origin === null) {
      uqSettings.push(`name: '${escapeSingleQuotes(uq.name)}'`);
    }
    indexEntries.push(`    ${colsExpr} [${uqSettings.join(", ")}]`);
  }
  for (const idx of table.indexes) {
    const colsExpr = idx.columns.length === 1 ? idx.columns[0] : `(${idx.columns.join(", ")})`;
    const idxSettings: string[] = [];
    if (idx.unique) idxSettings.push("unique");
    if (idx.name) idxSettings.push(`name: '${escapeSingleQuotes(idx.name)}'`);
    const suffix = idxSettings.length > 0 ? ` [${idxSettings.join(", ")}]` : "";
    indexEntries.push(`    ${colsExpr}${suffix}`);
  }

  const remainingChecks = table.checks.filter((chk) => !inlinedChecks.has(chk));

  if (indexEntries.length > 0 || remainingChecks.length > 0 || table.comment !== null) {
    lines.push("");
  }

  if (indexEntries.length > 0) {
    lines.push("  Indexes {");
    for (const entry of indexEntries) {
      lines.push(entry);
    }
    lines.push("  }");
  }

  if (remainingChecks.length > 0) {
    lines.push("  checks {");
    for (const chk of remainingChecks) {
      const suffix = chk.name ? ` [name: '${escapeSingleQuotes(chk.name)}']` : "";
      lines.push(`    \`${chk.expression}\`${suffix}`);
    }
    lines.push("  }");
  }

  if (table.comment !== null) {
    lines.push(`  Note: '${escapeSingleQuotes(table.comment)}'`);
  }

  lines.push("}");
  return { text: lines.join("\n"), standaloneFks };
}

function formatStandaloneRef(table: ModelTable, fk: ModelForeignKey): string {
  const namePrefix = fk.name && table.origin === null ? ` ${fk.name}` : "";
  const leftCols = fk.columns.length === 1 ? fk.columns[0] : `(${fk.columns.join(", ")})`;
  const rightCols =
    fk.target.columns.length === 1 ? fk.target.columns[0] : `(${fk.target.columns.join(", ")})`;
  const actions: string[] = [];
  if (fk.onDelete !== "noAction") {
    actions.push(`delete: ${formatFkAction(fk.onDelete)}`);
  }
  if (fk.onUpdate !== "noAction") {
    actions.push(`update: ${formatFkAction(fk.onUpdate)}`);
  }
  const actionSuffix = actions.length > 0 ? ` [${actions.join(", ")}]` : "";
  return `Ref${namePrefix}: ${table.schema}.${table.name}.${leftCols} > ${fk.target.schema}.${fk.target.table}.${rightCols}${actionSuffix}`;
}

export function printDbml(model: BuildModel): string {
  const activeTables = model.tables.filter((t) => !t.dropInDatabase);
  const newTables = activeTables.filter((t) => t.origin === null);
  const existingTables = activeTables.filter((t) => t.origin !== null);

  const sections: string[] = [];
  if (existingTables.length > 0 || model.base !== null) {
    sections.push("// as tabelas novas e, no fim, as existentes: o que mudar nelas vira ALTER");
  }

  const newRefs: string[] = [];
  const newTableBlocks: string[] = [];
  for (const table of newTables) {
    const printed = printTableDbml(model.engine, table);
    newTableBlocks.push(printed.text);
    for (const item of printed.standaloneFks) {
      newRefs.push(formatStandaloneRef(item.table, item.fk));
    }
  }
  if (newTableBlocks.length > 0) {
    sections.push(newTableBlocks.join("\n\n"));
  }
  if (newRefs.length > 0) {
    sections.push(newRefs.join("\n"));
  }

  if (existingTables.length > 0) {
    const existingRefs: string[] = [];
    const existingBlocks: string[] = [];
    for (const table of existingTables) {
      const printed = printTableDbml(model.engine, table);
      existingBlocks.push(printed.text);
      for (const item of printed.standaloneFks) {
        existingRefs.push(formatStandaloneRef(item.table, item.fk));
      }
    }
    const dbName = model.base?.database ?? "base";
    sections.push(`// existentes em ${dbName}\n${existingBlocks.join("\n\n")}`);
    if (existingRefs.length > 0) {
      sections.push(existingRefs.join("\n"));
    }
  }

  return sections.join("\n\n");
}

function stripDbmlComments(raw: string): string[] {
  const result: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBlockComment = false;
  let current = "";

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
        current += "  ";
      } else if (ch === "\n") {
        result.push(current);
        current = "";
      } else {
        current += " ";
      }
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        current += "  ";
        continue;
      }
      if (ch === "/" && next === "/") {
        while (i < raw.length && raw[i] !== "\n") {
          i++;
        }
        result.push(current);
        current = "";
        continue;
      }
    }

    if (ch === "\\" && (inSingle || inDouble)) {
      current += ch;
      if (next !== undefined) {
        current += next;
        i++;
      }
      continue;
    }

    if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (ch === "`" && !inSingle && !inDouble) inBacktick = !inBacktick;

    if (ch === "\n") {
      result.push(current);
      current = "";
    } else if (ch !== "\r") {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let parenDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\\" && (inSingle || inDouble)) {
      current += ch + (input[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (ch === "`" && !inSingle && !inDouble) inBacktick = !inBacktick;
    else if (!inSingle && !inDouble && !inBacktick) {
      if (ch === "(") parenDepth++;
      else if (ch === ")" && parenDepth > 0) parenDepth--;
      else if (ch === "," && parenDepth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

function parseIdentPart(raw: string): { name: string; exactName: boolean } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return {
      name: trimmed.slice(1, -1).replace(/""/g, '"'),
      exactName: true,
    };
  }
  return { name: trimmed, exactName: false };
}

function parseQualifiedTable(
  raw: string,
  defaultSchema: string,
): { schema: string; name: string; exactName: boolean } {
  const trimmed = raw.trim();
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx < 0) {
    const parsed = parseIdentPart(trimmed);
    return { schema: defaultSchema, name: parsed.name, exactName: parsed.exactName };
  }
  const schemaPart = parseIdentPart(trimmed.slice(0, dotIdx));
  const tablePart = parseIdentPart(trimmed.slice(dotIdx + 1));
  return { schema: schemaPart.name, name: tablePart.name, exactName: tablePart.exactName };
}

type RefEndpoint = {
  schema: string;
  table: string;
  columns: string[];
};

function parseRefEndpoint(
  raw: string,
  defaultSchema: string,
  aliases: Map<string, { schema: string; table: string }>,
): RefEndpoint | null {
  const trimmed = raw.trim();
  const parenMatch = /^(.+)\.\(([^)]+)\)$/.exec(trimmed);
  if (parenMatch) {
    const tableRaw = parenMatch[1].trim();
    const cols = parenMatch[2]
      .split(",")
      .map((c) => parseIdentPart(c).name)
      .filter((c) => c.length > 0);
    const aliasTarget = aliases.get(tableRaw);
    if (aliasTarget) {
      return { schema: aliasTarget.schema, table: aliasTarget.table, columns: cols };
    }
    const qt = parseQualifiedTable(tableRaw, defaultSchema);
    return { schema: qt.schema, table: qt.name, columns: cols };
  }

  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const tableRaw = trimmed.slice(0, lastDot).trim();
  const colName = parseIdentPart(trimmed.slice(lastDot + 1)).name;
  if (!colName) return null;
  const aliasTarget = aliases.get(tableRaw);
  if (aliasTarget) {
    return { schema: aliasTarget.schema, table: aliasTarget.table, columns: [colName] };
  }
  const qt = parseQualifiedTable(tableRaw, defaultSchema);
  return { schema: qt.schema, table: qt.name, columns: [colName] };
}

function normalizeDbmlDbType(raw: string): BuildEngine | null {
  const norm = raw.trim().toLowerCase();
  if (norm === "postgresql" || norm === "postgres") return "postgresql";
  if (norm === "db2") return "db2";
  if (norm === "informix") return "informix";
  return null;
}

type DeferredRef = {
  line: number;
  name: string | null;
  left: RefEndpoint;
  op: ">" | "<" | "-";
  right: RefEndpoint;
  onDelete: FkAction;
  onUpdate: FkAction;
};

export function readDbml(text: string, before: BuildModel): TextRead {
  const lines = stripDbmlComments(text);
  const warnings: TextWarning[] = [];
  const tables: ModelTable[] = [];
  const schemas: string[] = [];
  const aliases = new Map<string, { schema: string; table: string }>();
  const deferredRefs: DeferredRef[] = [];

  let i = 0;
  while (i < lines.length) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      i++;
      continue;
    }

    // Project block
    const projectMatch = /^Project(?:\s+[^\s{]+)?\s*\{/i.exec(trimmed);
    if (projectMatch) {
      let depth = 1;
      i++;
      while (i < lines.length && depth > 0) {
        const innerLine = lines[i];
        const innerTrim = innerLine.trim();
        const dbTypeMatch = /^database_type\s*:\s*(['"])(.*?)\1/i.exec(innerTrim);
        if (dbTypeMatch) {
          const rawDbType = dbTypeMatch[2];
          const mapped = normalizeDbmlDbType(rawDbType);
          if (mapped !== before.engine) {
            warnings.push({
              line: i + 1,
              message: `linha ${i + 1}: database_type '${rawDbType}' ignorado`,
            });
          }
        }
        for (const ch of innerLine) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
        i++;
      }
      continue;
    }

    // Enum block
    if (/^Enum\s+/i.test(trimmed)) {
      warnings.push({ line: lineNum, message: `linha ${lineNum}: Enum ignorado` });
      if (trimmed.includes("{")) {
        let depth = 0;
        for (const ch of trimmed) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
        i++;
        while (i < lines.length && depth > 0) {
          for (const ch of lines[i]) {
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
          }
          i++;
        }
      } else {
        i++;
      }
      continue;
    }

    // TableGroup block
    if (/^TableGroup\s+/i.test(trimmed)) {
      warnings.push({ line: lineNum, message: `linha ${lineNum}: TableGroup ignorado` });
      if (trimmed.includes("{")) {
        let depth = 0;
        for (const ch of trimmed) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
        i++;
        while (i < lines.length && depth > 0) {
          for (const ch of lines[i]) {
            if (ch === "{") depth++;
            else if (ch === "}") depth--;
          }
          i++;
        }
      } else {
        i++;
      }
      continue;
    }

    // Standalone Ref
    if (/^Ref(?:\s+[^\s:{]+)?\s*[:{]/i.test(trimmed)) {
      let refBody = trimmed;
      let refName: string | null = null;

      if (trimmed.includes("{") && !trimmed.includes(":")) {
        const headerMatch = /^Ref(?:\s+([^\s{]+))?\s*\{/i.exec(trimmed);
        refName = headerMatch?.[1] ?? null;
        i++;
        const innerLines: string[] = [];
        while (i < lines.length && !lines[i].includes("}")) {
          if (lines[i].trim().length > 0) innerLines.push(lines[i].trim());
          i++;
        }
        i++;
        refBody = innerLines.join(" ");
      } else {
        const inlineMatch = /^Ref(?:\s+([^\s:]+))?\s*:\s*(.+)$/i.exec(trimmed);
        if (!inlineMatch) {
          return {
            ok: false,
            error: { line: lineNum, column: 1, message: "Ref inválida" },
          };
        }
        refName = inlineMatch[1] ?? null;
        refBody = inlineMatch[2].trim();
        i++;
      }

      if (refBody.includes("<>")) {
        const colIdx = rawLine.indexOf("<>");
        return {
          ok: false,
          error: {
            line: lineNum,
            column: colIdx >= 0 ? colIdx + 1 : 1,
            message: "muitos-para-muitos não vira FK; crie a tabela de ligação",
          },
        };
      }

      let settingsRaw = "";
      const bracketStart = refBody.lastIndexOf("[");
      if (bracketStart >= 0 && refBody.endsWith("]")) {
        settingsRaw = refBody.slice(bracketStart + 1, -1);
        refBody = refBody.slice(0, bracketStart).trim();
      }

      const opMatch = /^(.+?)\s*([><-])\s*(.+)$/.exec(refBody);
      if (!opMatch) {
        return {
          ok: false,
          error: { line: lineNum, column: 1, message: "Ref inválida" },
        };
      }

      const left = parseRefEndpoint(opMatch[1], before.defaultSchema, aliases);
      const op = opMatch[2] as ">" | "<" | "-";
      const right = parseRefEndpoint(opMatch[3], before.defaultSchema, aliases);
      if (!left || !right) {
        return {
          ok: false,
          error: { line: lineNum, column: 1, message: "Ref inválida" },
        };
      }

      let onDelete: FkAction = "noAction";
      let onUpdate: FkAction = "noAction";
      if (settingsRaw.length > 0) {
        for (const item of splitTopLevelCommas(settingsRaw)) {
          const kv = /^(delete|update)\s*:\s*(.+)$/i.exec(item);
          if (kv) {
            const parsedAction = parseFkAction(kv[2]);
            if (parsedAction) {
              if (kv[1].toLowerCase() === "delete") onDelete = parsedAction;
              else onUpdate = parsedAction;
            }
          }
        }
      }

      deferredRefs.push({
        line: lineNum,
        name: refName,
        left,
        op,
        right,
        onDelete,
        onUpdate,
      });
      continue;
    }

    // Table block
    const tableMatch = /^Table\s+([^\s{]+)(?:\s+as\s+([^\s[{]+))?(?:\s*\[[^\]]*\])?\s*\{$/i.exec(
      trimmed,
    );
    if (tableMatch) {
      const qt = parseQualifiedTable(tableMatch[1], before.defaultSchema);
      const alias = tableMatch[2];
      if (alias) {
        aliases.set(alias, { schema: qt.schema, table: qt.name });
        warnings.push({
          line: lineNum,
          message: `linha ${lineNum}: alias de tabela ignorado`,
        });
      }

      const columns: ModelColumn[] = [];
      const pkColumns: string[] = [];
      let pkName: string | null = null;
      const uniques: ModelUnique[] = [];
      const checks: ModelCheck[] = [];
      const indexes: ModelIndex[] = [];
      const foreignKeys: ModelForeignKey[] = [];
      let tableComment: string | null = null;

      i++;
      while (i < lines.length) {
        const innerLineNum = i + 1;
        const innerRaw = lines[i];
        const innerTrim = innerRaw.trim();

        if (innerTrim.length === 0) {
          i++;
          continue;
        }
        if (innerTrim === "}") {
          i++;
          break;
        }

        // Indexes block
        if (/^Indexes\s*\{$/i.test(innerTrim)) {
          i++;
          while (i < lines.length) {
            const idxLineNum = i + 1;
            const idxTrim = lines[i].trim();
            if (idxTrim.length === 0) {
              i++;
              continue;
            }
            if (idxTrim === "}") {
              i++;
              break;
            }
            if (idxTrim.includes("`")) {
              warnings.push({
                line: idxLineNum,
                message: `linha ${idxLineNum}: índice por expressão ignorado`,
              });
              i++;
              continue;
            }

            let idxBody = idxTrim;
            let idxSettingsRaw = "";
            const bStart = idxBody.indexOf("[");
            if (bStart >= 0 && idxBody.endsWith("]")) {
              idxSettingsRaw = idxBody.slice(bStart + 1, -1);
              idxBody = idxBody.slice(0, bStart).trim();
            }

            const idxCols =
              idxBody.startsWith("(") && idxBody.endsWith(")")
                ? idxBody
                    .slice(1, -1)
                    .split(",")
                    .map((c) => parseIdentPart(c).name)
                    .filter((c) => c.length > 0)
                : [parseIdentPart(idxBody).name];

            let isPk = false;
            let isUnique = false;
            let idxName: string | null = null;
            if (idxSettingsRaw.length > 0) {
              for (const part of splitTopLevelCommas(idxSettingsRaw)) {
                const lower = part.toLowerCase();
                if (lower === "pk" || lower === "primary key") isPk = true;
                else if (lower === "unique") isUnique = true;
                else {
                  const nameMatch = /^name\s*:\s*(['"])(.*?)\1$/i.exec(part);
                  if (nameMatch) idxName = unescapeSingleQuotes(nameMatch[2]);
                }
              }
            }

            if (isPk) {
              pkColumns.splice(0, pkColumns.length, ...idxCols);
              if (idxName) pkName = idxName;
              for (const col of columns) {
                if (idxCols.some((c) => sameIdent(before.engine, c, col.name))) {
                  col.nullable = false;
                }
              }
            } else {
              indexes.push({
                name: idxName,
                columns: idxCols,
                unique: isUnique,
              });
            }
            i++;
          }
          continue;
        }

        // checks block
        if (/^checks\s*\{$/i.test(innerTrim)) {
          i++;
          while (i < lines.length) {
            const chkTrim = lines[i].trim();
            if (chkTrim.length === 0) {
              i++;
              continue;
            }
            if (chkTrim === "}") {
              i++;
              break;
            }
            const chkMatch = /^`([^`]+)`(?:\s*\[([^\]]*)\])?$/.exec(chkTrim);
            if (chkMatch) {
              const expr = chkMatch[1];
              let chkName: string | null = null;
              if (chkMatch[2]) {
                for (const part of splitTopLevelCommas(chkMatch[2])) {
                  const nameMatch = /^name\s*:\s*(['"])(.*?)\1$/i.exec(part);
                  if (nameMatch) chkName = unescapeSingleQuotes(nameMatch[2]);
                }
              }
              checks.push({ name: chkName, expression: expr });
            }
            i++;
          }
          continue;
        }

        // Note: '...'
        const noteMatch = /^Note\s*:\s*(['"])(.*)\1$/i.exec(innerTrim);
        if (noteMatch) {
          tableComment = unescapeSingleQuotes(noteMatch[2]);
          i++;
          continue;
        }

        // Column definition
        let colBody = innerTrim;
        let colSettingsRaw = "";
        const bracketIdx = colBody.indexOf("[");
        if (bracketIdx >= 0) {
          if (!colBody.endsWith("]")) {
            return {
              ok: false,
              error: {
                line: innerLineNum,
                column: innerRaw.indexOf("[") + 1,
                message: "esperava ] no fim das configurações da coluna",
              },
            };
          }
          colSettingsRaw = colBody.slice(bracketIdx + 1, -1);
          colBody = colBody.slice(0, bracketIdx).trim();
        }

        const colMatch = /^("[^"]+"|\S+)\s+(.+)$/.exec(colBody);
        if (!colMatch) {
          return {
            ok: false,
            error: {
              line: innerLineNum,
              column: 1,
              message: `esperava nome e tipo da coluna em '${innerTrim}'`,
            },
          };
        }

        const parsedColIdent = parseIdentPart(colMatch[1]);
        const colType = colMatch[2].trim();
        let nullable = true;
        let defaultVal: string | null = null;
        let identity: "always" | "byDefault" | null = null;
        let comment: string | null = null;

        if (colSettingsRaw.length > 0) {
          for (const setting of splitTopLevelCommas(colSettingsRaw)) {
            const lower = setting.toLowerCase();
            if (lower === "pk" || lower === "primary key") {
              if (!pkColumns.includes(parsedColIdent.name)) {
                pkColumns.push(parsedColIdent.name);
              }
              nullable = false;
            } else if (lower === "increment") {
              identity = "always";
              nullable = false;
            } else if (lower === "not null") {
              nullable = false;
            } else if (lower === "null") {
              nullable = true;
            } else if (lower === "unique") {
              uniques.push({ name: null, columns: [parsedColIdent.name] });
            } else if (/^default\s*:/i.test(setting)) {
              const rawDef = setting.replace(/^default\s*:\s*/i, "").trim();
              if (rawDef.startsWith("`") && rawDef.endsWith("`") && rawDef.length >= 2) {
                defaultVal = rawDef.slice(1, -1);
              } else {
                defaultVal = rawDef;
              }
            } else if (/^note\s*:/i.test(setting)) {
              const rawNote = setting.replace(/^note\s*:\s*/i, "").trim();
              if (
                (rawNote.startsWith("'") && rawNote.endsWith("'")) ||
                (rawNote.startsWith('"') && rawNote.endsWith('"'))
              ) {
                comment = unescapeSingleQuotes(rawNote.slice(1, -1));
              }
            } else if (/^check\s*:/i.test(setting)) {
              const rawChk = setting.replace(/^check\s*:\s*/i, "").trim();
              if (rawChk.startsWith("`") && rawChk.endsWith("`") && rawChk.length >= 2) {
                checks.push({ name: null, expression: rawChk.slice(1, -1) });
              }
            } else if (/^ref\s*:/i.test(setting)) {
              const rawRef = setting.replace(/^ref\s*:\s*/i, "").trim();
              if (rawRef.startsWith("<>")) {
                const colIdx = innerRaw.indexOf("<>");
                return {
                  ok: false,
                  error: {
                    line: innerLineNum,
                    column: colIdx >= 0 ? colIdx + 1 : 1,
                    message: "muitos-para-muitos não vira FK; crie a tabela de ligação",
                  },
                };
              }
              const refOpMatch = /^([><-])\s*(.+)$/.exec(rawRef);
              if (!refOpMatch) {
                return {
                  ok: false,
                  error: {
                    line: innerLineNum,
                    column: 1,
                    message: "ref de coluna inválida",
                  },
                };
              }
              const refOp = refOpMatch[1] as ">" | "<" | "-";
              const targetEndpoint = parseRefEndpoint(
                refOpMatch[2],
                before.defaultSchema,
                aliases,
              );
              if (!targetEndpoint) {
                return {
                  ok: false,
                  error: {
                    line: innerLineNum,
                    column: 1,
                    message: "destino da ref inválido",
                  },
                };
              }
              if (refOp === ">" || refOp === "-") {
                if (
                  refOp === "-" &&
                  !uniques.some(
                    (u) =>
                      u.columns.length === 1 &&
                      sameIdent(before.engine, u.columns[0], parsedColIdent.name),
                  )
                ) {
                  uniques.push({ name: null, columns: [parsedColIdent.name] });
                }
                foreignKeys.push({
                  name: null,
                  columns: [parsedColIdent.name],
                  target: targetEndpoint,
                  onDelete: "noAction",
                  onUpdate: "noAction",
                });
              } else {
                deferredRefs.push({
                  line: innerLineNum,
                  name: null,
                  left: {
                    schema: qt.schema,
                    table: qt.name,
                    columns: [parsedColIdent.name],
                  },
                  op: "<",
                  right: targetEndpoint,
                  onDelete: "noAction",
                  onUpdate: "noAction",
                });
              }
            }
          }
        }

        columns.push({
          name: parsedColIdent.name,
          exactName: parsedColIdent.exactName,
          originName: null,
          type: colType,
          nullable,
          default: defaultVal,
          identity,
          comment,
        });
        i++;
      }

      tables.push({
        schema: qt.schema,
        name: qt.name,
        exactName: qt.exactName,
        comment: tableComment,
        columns,
        primaryKey: pkColumns.length > 0 ? { name: pkName, columns: pkColumns } : null,
        uniques,
        checks,
        indexes,
        foreignKeys,
        origin: null,
        dropInDatabase: false,
      });
      continue;
    }

    return {
      ok: false,
      error: {
        line: lineNum,
        column: 1,
        message: `construção DBML não reconhecida: '${trimmed}'`,
      },
    };
  }

  for (const ref of deferredRefs) {
    const source = ref.op === "<" ? ref.right : ref.left;
    const target = ref.op === "<" ? ref.left : ref.right;
    const sourceTable = tables.find(
      (t) =>
        sameIdent(before.engine, t.schema, source.schema) &&
        sameIdent(before.engine, t.name, source.table),
    );
    if (!sourceTable) {
      return {
        ok: false,
        error: {
          line: ref.line,
          column: 1,
          message: `tabela '${source.schema}.${source.table}' da Ref não encontrada`,
        },
      };
    }
    if (ref.op === "-" && source.columns.length === 1) {
      const colName = source.columns[0];
      if (
        !sourceTable.uniques.some(
          (u) => u.columns.length === 1 && sameIdent(before.engine, u.columns[0], colName),
        )
      ) {
        sourceTable.uniques.push({ name: null, columns: [colName] });
      }
    }
    sourceTable.foreignKeys.push({
      name: ref.name,
      columns: source.columns,
      target: {
        schema: target.schema,
        table: target.table,
        columns: target.columns,
      },
      onDelete: ref.onDelete,
      onUpdate: ref.onUpdate,
    });
  }

  for (const table of tables) {
    table.foreignKeys.sort((a, b) => {
      const idxA = table.columns.findIndex((c) => sameIdent(before.engine, c.name, a.columns[0]));
      const idxB = table.columns.findIndex((c) => sameIdent(before.engine, c.name, b.columns[0]));
      return idxA - idxB;
    });
  }

  return {
    ok: true,
    tables: mergeTextTables(tables, before, "dbml"),
    schemas,
    warnings,
  };
}
