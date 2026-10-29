import {
  engineRules,
  needsQuotes,
  quoteName,
  sameName,
} from "@/app/build/_lib/build-engines";
import {
  engineIdOf,
  type BuildEngine,
  type BuildModel,
  type FkAction,
  type IdentityMode,
  type ModelCheck,
  type ModelColumn,
  type ModelForeignKey,
  type ModelTable,
  type ModelUnique,
} from "@/app/build/_lib/build-model.schema";
import {
  constraintClause,
  escapeSqlString,
  findColumnExactName,
  fkActionsClause,
  formatCreateIndex,
  formatForeignKeyBody,
  qualifiedName,
} from "@/app/build/_lib/ddl-write";
import {
  mergeTextTables,
  sameIdent,
  type TextRead,
  type TextWarning,
} from "@/app/build/_lib/text-merge";
import {
  type SqlToken,
  splitStatements,
  sqlTokens,
} from "@/app/workbench/_lib/sql-statements";

function findInlineCheckColumn(table: ModelTable, check: ModelCheck): ModelColumn | null {
  const identifiers = check.expression.match(/[A-Za-z_][A-Za-z0-9_$]*/g) ?? [];
  const matchedCols = new Map<string, ModelColumn>();
  for (const id of identifiers) {
    const col = table.columns.find((c) => c.name.toLowerCase() === id.toLowerCase());
    if (col) {
      matchedCols.set(col.name.toLowerCase(), col);
    }
  }
  if (matchedCols.size === 1) {
    return [...matchedCols.values()][0];
  }
  return null;
}

function formatModelTableSql(
  engine: BuildEngine,
  table: ModelTable,
  allTables: readonly ModelTable[],
): string {
  const statements: string[] = [];
  const isExisting = table.origin !== null;

  const pk = table.primaryKey;
  const inlinePkCol =
    pk && pk.columns.length === 1 && (pk.name === null || isExisting) ? pk.columns[0] : null;

  const inlineUniqueCols = new Set<string>();
  const tableLevelUniques: ModelUnique[] = [];
  for (const uq of table.uniques) {
    if (uq.columns.length === 1 && (uq.name === null || isExisting)) {
      inlineUniqueCols.add(uq.columns[0]);
    } else {
      tableLevelUniques.push(uq);
    }
  }

  const inlineFkByCol = new Map<string, ModelForeignKey>();
  const tableLevelFks: ModelForeignKey[] = [];
  for (const fk of table.foreignKeys) {
    if (
      fk.columns.length === 1 &&
      fk.target.columns.length === 1 &&
      (fk.name === null || isExisting) &&
      !inlineFkByCol.has(fk.columns[0])
    ) {
      inlineFkByCol.set(fk.columns[0], fk);
    } else {
      tableLevelFks.push(fk);
    }
  }

  const inlineChecksByCol = new Map<string, ModelCheck[]>();
  const tableLevelChecks: ModelCheck[] = [];
  for (const ck of table.checks) {
    if (ck.name === null || isExisting) {
      const col = findInlineCheckColumn(table, ck);
      if (col) {
        const list = inlineChecksByCol.get(col.name) ?? [];
        list.push(ck);
        inlineChecksByCol.set(col.name, list);
        continue;
      }
    }
    tableLevelChecks.push(ck);
  }

  const maxColWidth = table.columns.reduce((max, col) => {
    const q = quoteName(engine, col.name, col.exactName);
    return Math.max(max, q.length);
  }, 0);

  const items: string[] = [];

  for (const col of table.columns) {
    const rawName = quoteName(engine, col.name, col.exactName);
    const namePart = rawName.padEnd(maxColWidth, " ");

    let body: string;
    if (col.identity !== null) {
      if (engine === "informix") {
        const serialType = col.type.toLowerCase().startsWith("big") ? "BIGSERIAL" : "SERIAL";
        body = `${serialType} NOT NULL`;
      } else {
        const mode = col.identity === "always" ? "ALWAYS" : "BY DEFAULT";
        body = `${col.type} GENERATED ${mode} AS IDENTITY`;
      }
    } else if (engine === "informix") {
      const parts = [col.type];
      if (col.default !== null && col.default.trim() !== "") {
        parts.push(`DEFAULT ${col.default}`);
      }
      if (!col.nullable) {
        parts.push("NOT NULL");
      }
      body = parts.join(" ");
    } else {
      const parts = [col.type];
      if (!col.nullable) {
        parts.push("NOT NULL");
      }
      if (col.default !== null && col.default.trim() !== "") {
        parts.push(`DEFAULT ${col.default}`);
      }
      body = parts.join(" ");
    }

    if (inlinePkCol !== null && sameIdent(engine, inlinePkCol, col.name)) {
      body += " PRIMARY KEY";
    }

    if (inlineUniqueCols.has(col.name)) {
      body += " UNIQUE";
    }

    const inlineFk = inlineFkByCol.get(col.name);
    if (inlineFk) {
      const targetTableObj = allTables.find(
        (t) =>
          sameIdent(engine, t.schema, inlineFk.target.schema) &&
          sameName(engine, t, { name: inlineFk.target.table, exactName: false }),
      );
      const targetTable = qualifiedName(
        engine,
        inlineFk.target.schema,
        inlineFk.target.table,
        targetTableObj?.exactName ?? false,
      );
      const targetCols = inlineFk.target.columns
        .map((c) => quoteName(engine, c, findColumnExactName(targetTableObj, c, engine)))
        .join(", ");
      const actions = fkActionsClause(engine, inlineFk).trim();
      body += ` REFERENCES ${targetTable} (${targetCols})`;
      if (actions) {
        body += `\n               ${actions}`;
      }
    }

    const inlineChecks = inlineChecksByCol.get(col.name) ?? [];
    for (const ck of inlineChecks) {
      body += `\n               CHECK (${ck.expression})`;
    }

    const prefix =
      engine === "informix" && col.comment ? `  -- ${col.comment}\n` : "";
    items.push(`${prefix}  ${namePart} ${body}`);
  }

  if (pk && pk.columns.length > 0 && inlinePkCol === null) {
    const pkCols = pk.columns
      .map((c) => quoteName(engine, c, findColumnExactName(table, c, engine)))
      .join(", ");
    items.push(`  ${constraintClause(engine, pk.name, `PRIMARY KEY (${pkCols})`)}`);
  }

  for (const uq of tableLevelUniques) {
    const uqCols = uq.columns
      .map((c) => quoteName(engine, c, findColumnExactName(table, c, engine)))
      .join(", ");
    items.push(`  ${constraintClause(engine, uq.name, `UNIQUE (${uqCols})`)}`);
  }

  for (const ck of tableLevelChecks) {
    items.push(`  ${constraintClause(engine, ck.name, `CHECK (${ck.expression})`)}`);
  }

  for (const fk of tableLevelFks) {
    const fkBody = formatForeignKeyBody(engine, table, fk, allTables);
    items.push(`  ${constraintClause(engine, fk.name, fkBody)}`);
  }

  const qTable = qualifiedName(engine, table.schema, table.name, table.exactName);
  const informixHeader =
    engine === "informix" && table.comment ? `-- ${table.comment}\n` : "";
  statements.push(`${informixHeader}CREATE TABLE ${qTable} (\n${items.join(",\n")}\n);`);

  for (const index of table.indexes) {
    statements.push(formatCreateIndex(engine, table, index));
  }

  if (engine !== "informix") {
    if (table.comment) {
      statements.push(
        `COMMENT ON TABLE ${qTable}\n  IS '${escapeSqlString(table.comment)}';`,
      );
    }
    for (const col of table.columns) {
      if (col.comment) {
        const qCol = quoteName(engine, col.name, col.exactName);
        statements.push(
          `COMMENT ON COLUMN ${qTable}.${qCol}\n  IS '${escapeSqlString(col.comment)}';`,
        );
      }
    }
  }

  return statements.join("\n\n");
}

export function printModelSql(model: BuildModel): string {
  const newTables = model.tables.filter((t) => t.origin === null && !t.dropInDatabase);
  const existingTables = model.tables.filter((t) => t.origin !== null && !t.dropInDatabase);

  const blocks: string[] = [];

  if (existingTables.length > 0 || model.base !== null) {
    blocks.push(
      `-- ${model.defaultSchema} · ${engineRules[model.engine].label} · as tabelas novas e, no fim, as existentes\n-- o que você mudar numa existente vira ALTER no DDL de diferenças`,
    );
  }

  for (const table of newTables) {
    blocks.push(formatModelTableSql(model.engine, table, model.tables));
  }

  if (existingTables.length > 0) {
    const dbName = model.base?.database ?? "base";
    const firstExisting = formatModelTableSql(model.engine, existingTables[0], model.tables);
    blocks.push(`-- existentes em ${dbName}\n${firstExisting}`);
    for (let i = 1; i < existingTables.length; i++) {
      blocks.push(formatModelTableSql(model.engine, existingTables[i], model.tables));
    }
  }

  return blocks.join("\n\n");
}

export const writeModelSql = printModelSql;

type OffsetToken = SqlToken & { raw: string };

function lineAndCol(sql: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < sql.length; i++) {
    if (sql.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

function unquoteIdentifier(
  engine: BuildEngine,
  raw: string,
): { name: string; exactName: boolean } {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    const inner = raw.slice(1, -1).replace(/""/g, '"');
    return { name: inner, exactName: needsQuotes(engine, inner) };
  }
  return { name: raw, exactName: false };
}

function unquoteSqlString(raw: string): string {
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

const COLUMN_MODIFIER_STARTERS = new Set([
  "not",
  "null",
  "default",
  "generated",
  "primary",
  "unique",
  "references",
  "check",
  "constraint",
]);

const TABLE_CONSTRAINT_STARTERS = new Set([
  "constraint",
  "primary",
  "unique",
  "check",
  "foreign",
]);

function extractLeadingLineComment(segmentText: string): string | null {
  const lines = segmentText.split(/\r?\n/);
  const commentLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      commentLines.length = 0;
      continue;
    }
    if (trimmed.startsWith("--")) {
      const content = trimmed.slice(2).trim();
      if (
        content.includes("as tabelas novas e, no fim, as existentes") ||
        content.includes("vira ALTER no DDL de diferenças") ||
        content.startsWith("existentes em ")
      ) {
        continue;
      }
      commentLines.push(content);
    } else {
      break;
    }
  }
  return commentLines.length > 0 ? commentLines.join(" ") : null;
}

function extractCommentBeforeOffset(sql: string, fromOffset: number, toOffset: number): string | null {
  const slice = sql.slice(fromOffset, toOffset);
  const lines = slice.split(/\r?\n/);
  const comments: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) {
      comments.push(trimmed.slice(2).trim());
    }
  }
  return comments.length > 0 ? comments.join(" ") : null;
}

function parseActionClause(
  tokens: readonly OffsetToken[],
  startIdx: number,
): { action: FkAction; nextIdx: number } | null {
  const t0 = tokens[startIdx];
  if (!t0) return null;
  if (t0.word && t0.text === "cascade") {
    return { action: "cascade", nextIdx: startIdx + 1 };
  }
  if (t0.word && t0.text === "restrict") {
    return { action: "restrict", nextIdx: startIdx + 1 };
  }
  if (t0.word && t0.text === "no" && tokens[startIdx + 1]?.text === "action") {
    return { action: "noAction", nextIdx: startIdx + 2 };
  }
  if (t0.word && t0.text === "set") {
    const next = tokens[startIdx + 1];
    if (next?.word && next.text === "null") {
      return { action: "setNull", nextIdx: startIdx + 2 };
    }
  }
  return null;
}

function parseQualifiedName(
  engine: BuildEngine,
  defaultSchema: string,
  tokens: readonly OffsetToken[],
  startIdx: number,
): { schema: string; name: string; exactName: boolean; nextIdx: number } | null {
  const first = tokens[startIdx];
  if (!first || (!first.word && !first.raw.startsWith('"'))) return null;
  if (tokens[startIdx + 1]?.text === "." && tokens[startIdx + 2]) {
    const second = tokens[startIdx + 2];
    const s = unquoteIdentifier(engine, first.raw);
    const t = unquoteIdentifier(engine, second.raw);
    return { schema: s.name, name: t.name, exactName: t.exactName, nextIdx: startIdx + 3 };
  }
  const t = unquoteIdentifier(engine, first.raw);
  return { schema: defaultSchema, name: t.name, exactName: t.exactName, nextIdx: startIdx + 1 };
}

function parseIdentifierListInParens(
  engine: BuildEngine,
  tokens: readonly OffsetToken[],
  startIdx: number,
): { names: string[]; nextIdx: number } | null {
  if (tokens[startIdx]?.text !== "(") return null;
  let i = startIdx + 1;
  const names: string[] = [];
  while (i < tokens.length && tokens[i].text !== ")") {
    const tok = tokens[i];
    if (tok.text === ",") {
      i++;
      continue;
    }
    if (tok.word && (tok.text === "asc" || tok.text === "desc")) {
      i++;
      continue;
    }
    names.push(unquoteIdentifier(engine, tok.raw).name);
    i++;
  }
  if (tokens[i]?.text !== ")") return null;
  return { names, nextIdx: i + 1 };
}

function findMatchingParen(tokens: readonly OffsetToken[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].text === "(") depth++;
    else if (tokens[i].text === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseTrailingInformixConstraintName(
  engine: BuildEngine,
  tokens: readonly OffsetToken[],
  startIdx: number,
): { name: string | null; nextIdx: number } {
  if (tokens[startIdx]?.word && tokens[startIdx].text === "constraint" && tokens[startIdx + 1]) {
    const cName = unquoteIdentifier(engine, tokens[startIdx + 1].raw).name;
    return { name: cName, nextIdx: startIdx + 2 };
  }
  return { name: null, nextIdx: startIdx };
}

function parseReferencesClause(
  engine: BuildEngine,
  defaultSchema: string,
  localColumns: string[],
  constraintName: string | null,
  tokens: readonly OffsetToken[],
  startIdx: number,
): { fk: ModelForeignKey; nextIdx: number } | null {
  if (!(tokens[startIdx]?.word && tokens[startIdx].text === "references")) return null;
  const targetQual = parseQualifiedName(engine, defaultSchema, tokens, startIdx + 1);
  if (!targetQual) return null;
  let i = targetQual.nextIdx;
  let targetCols = ["id"];
  if (tokens[i]?.text === "(") {
    const parsedCols = parseIdentifierListInParens(engine, tokens, i);
    if (!parsedCols) return null;
    targetCols = parsedCols.names;
    i = parsedCols.nextIdx;
  }

  let onDelete: FkAction = "noAction";
  let onUpdate: FkAction = "noAction";

  while (i < tokens.length && tokens[i].word && tokens[i].text === "on") {
    const kind = tokens[i + 1]?.text;
    if (kind === "delete" || kind === "update") {
      const act = parseActionClause(tokens, i + 2);
      if (!act) break;
      if (kind === "delete") onDelete = act.action;
      else onUpdate = act.action;
      i = act.nextIdx;
    } else {
      break;
    }
  }

  const trailing = parseTrailingInformixConstraintName(engine, tokens, i);
  i = trailing.nextIdx;

  return {
    fk: {
      name: constraintName ?? trailing.name,
      columns: localColumns,
      target: {
        schema: targetQual.schema,
        table: targetQual.name,
        columns: targetCols,
      },
      onDelete,
      onUpdate,
    },
    nextIdx: i,
  };
}

function parseTableConstraintItem(
  sql: string,
  engine: BuildEngine,
  defaultSchema: string,
  table: ModelTable,
  tokens: readonly OffsetToken[],
  startIdx: number,
): { nextIdx: number } | null {
  let i = startIdx;
  let constraintName: string | null = null;

  if (tokens[i]?.word && tokens[i].text === "constraint" && tokens[i + 1]) {
    constraintName = unquoteIdentifier(engine, tokens[i + 1].raw).name;
    i += 2;
  }

  const head = tokens[i];
  if (!head?.word) return null;

  if (head.text === "primary" && tokens[i + 1]?.text === "key") {
    const cols = parseIdentifierListInParens(engine, tokens, i + 2);
    if (!cols) return null;
    const trailing = parseTrailingInformixConstraintName(engine, tokens, cols.nextIdx);
    const finalName = constraintName ?? trailing.name;
    table.primaryKey = { name: finalName, columns: cols.names };
    for (const pkColName of cols.names) {
      const col = table.columns.find((c) => sameIdent(engine, c.name, pkColName));
      if (col) col.nullable = false;
    }
    return { nextIdx: trailing.nextIdx };
  }

  if (head.text === "unique") {
    const cols = parseIdentifierListInParens(engine, tokens, i + 1);
    if (!cols) return null;
    const trailing = parseTrailingInformixConstraintName(engine, tokens, cols.nextIdx);
    table.uniques.push({ name: constraintName ?? trailing.name, columns: cols.names });
    return { nextIdx: trailing.nextIdx };
  }

  if (head.text === "check" && tokens[i + 1]?.text === "(") {
    const closeIdx = findMatchingParen(tokens, i + 1);
    if (closeIdx < 0) return null;
    const expr = sql.slice(tokens[i + 1].end, tokens[closeIdx].start).trim();
    const trailing = parseTrailingInformixConstraintName(engine, tokens, closeIdx + 1);
    table.checks.push({ name: constraintName ?? trailing.name, expression: expr });
    return { nextIdx: trailing.nextIdx };
  }

  if (head.text === "foreign" && tokens[i + 1]?.text === "key") {
    const localCols = parseIdentifierListInParens(engine, tokens, i + 2);
    if (!localCols) return null;
    const ref = parseReferencesClause(
      engine,
      defaultSchema,
      localCols.names,
      constraintName,
      tokens,
      localCols.nextIdx,
    );
    if (!ref) return null;
    table.foreignKeys.push(ref.fk);
    return { nextIdx: ref.nextIdx };
  }

  return null;
}

function parseDataType(
  sql: string,
  tokens: readonly OffsetToken[],
  startIdx: number,
): { rawType: string; nextIdx: number } | null {
  const first = tokens[startIdx];
  if (!first || (!first.word && !first.raw.startsWith('"'))) return null;

  let i = startIdx + 1;
  while (
    i < tokens.length &&
    tokens[i].word &&
    !COLUMN_MODIFIER_STARTERS.has(tokens[i].text)
  ) {
    i++;
  }

  if (tokens[i]?.text === "(") {
    const closeIdx = findMatchingParen(tokens, i);
    if (closeIdx < 0) return null;
    i = closeIdx + 1;
  }

  while (
    i < tokens.length &&
    tokens[i].word &&
    !COLUMN_MODIFIER_STARTERS.has(tokens[i].text)
  ) {
    i++;
  }

  if (tokens[i]?.text === "(" && !COLUMN_MODIFIER_STARTERS.has(tokens[i - 1]?.text ?? "")) {
    const closeIdx = findMatchingParen(tokens, i);
    if (closeIdx >= 0) {
      i = closeIdx + 1;
    }
  }

  if (tokens[i]?.text === "[" && tokens[i + 1]?.text === "]") {
    i += 2;
  }

  const rawType = sql.slice(first.start, tokens[i - 1].end).trim();
  return { rawType, nextIdx: i };
}

function parseDefaultExpression(
  sql: string,
  tokens: readonly OffsetToken[],
  startIdx: number,
): { value: string; nextIdx: number } | null {
  const first = tokens[startIdx];
  if (!first) return null;
  let i = startIdx;

  if (tokens[i].text === "-" || tokens[i].text === "+") {
    i++;
  }

  if (tokens[i]?.text === "(") {
    const closeIdx = findMatchingParen(tokens, i);
    if (closeIdx < 0) return null;
    i = closeIdx + 1;
  } else if (tokens[i]) {
    i++;
    if (tokens[i]?.text === "(") {
      const closeIdx = findMatchingParen(tokens, i);
      if (closeIdx < 0) return null;
      i = closeIdx + 1;
    } else if (
      tokens[i - 1]?.word &&
      (tokens[i - 1].text === "current" || tokens[i - 1].text === "next") &&
      tokens[i]?.word &&
      !COLUMN_MODIFIER_STARTERS.has(tokens[i].text)
    ) {
      i++;
      if (
        tokens[i - 1]?.text === "value" &&
        tokens[i]?.text === "for" &&
        tokens[i + 1]
      ) {
        i += 2;
      }
    }
  }

  if (tokens[i]?.text === ":" && tokens[i + 1]?.text === ":" && tokens[i + 2]) {
    i += 3;
  }

  const value = sql.slice(first.start, tokens[i - 1].end).trim();
  return { value, nextIdx: i };
}

export function readModelSql(text: string, before: BuildModel): TextRead {
  const engine = before.engine;
  const engineNum = engineIdOf(engine);
  const statements = splitStatements(text, engineNum);

  const tables: ModelTable[] = [];
  const schemas: string[] = [];
  const warnings: TextWarning[] = [];

  const findTable = (schema: string, name: string): ModelTable | undefined =>
    tables.find(
      (t) =>
        sameIdent(engine, t.schema, schema) &&
        sameName(engine, t, { name, exactName: false }),
    );

  for (const stmt of statements) {
    const rawTokens = sqlTokens(stmt.text, engineNum);
    if (rawTokens.length === 0) continue;

    const tokens: OffsetToken[] = rawTokens.map((tok) => ({
      ...tok,
      start: stmt.start + tok.start,
      end: stmt.start + tok.end,
      raw: text.slice(stmt.start + tok.start, stmt.start + tok.end),
    }));

    const first = tokens[0];
    const second = tokens[1];

    if (first.word && first.text === "create") {
      let idx = 1;
      let isUniqueIndex = false;
      if (tokens[idx]?.word && tokens[idx].text === "unique") {
        isUniqueIndex = true;
        idx++;
      }

      const kind = tokens[idx];
      if (kind?.word && kind.text === "schema") {
        idx++;
        if (
          tokens[idx]?.text === "if" &&
          tokens[idx + 1]?.text === "not" &&
          tokens[idx + 2]?.text === "exists"
        ) {
          idx += 3;
        }
        const sTok = tokens[idx];
        if (sTok) {
          const sName = unquoteIdentifier(engine, sTok.raw).name;
          if (!schemas.some((s) => sameIdent(engine, s, sName))) {
            schemas.push(sName);
          }
        }
        continue;
      }

      if (kind?.word && kind.text === "index") {
        idx++;
        if (
          tokens[idx]?.text === "if" &&
          tokens[idx + 1]?.text === "not" &&
          tokens[idx + 2]?.text === "exists"
        ) {
          idx += 3;
        }
        const idxQual = parseQualifiedName(engine, before.defaultSchema, tokens, idx);
        if (!idxQual) continue;
        idx = idxQual.nextIdx;
        if (tokens[idx]?.word && tokens[idx].text === "on") {
          idx++;
          const tblQual = parseQualifiedName(engine, before.defaultSchema, tokens, idx);
          if (!tblQual) continue;
          idx = tblQual.nextIdx;
          const cols = parseIdentifierListInParens(engine, tokens, idx);
          if (!cols) continue;
          const targetTable = findTable(tblQual.schema, tblQual.name);
          if (targetTable) {
            targetTable.indexes.push({
              name: idxQual.name,
              columns: cols.names,
              unique: isUniqueIndex,
            });
          }
        }
        continue;
      }

      if (kind?.word && kind.text === "table") {
        idx++;
        if (
          tokens[idx]?.text === "if" &&
          tokens[idx + 1]?.text === "not" &&
          tokens[idx + 2]?.text === "exists"
        ) {
          idx += 3;
        }
        const tblQual = parseQualifiedName(engine, before.defaultSchema, tokens, idx);
        if (!tblQual) {
          const pos = lineAndCol(text, (tokens[idx] ?? first).start);
          return {
            ok: false,
            error: {
              line: pos.line,
              column: pos.column,
              message: "esperava o nome da tabela após CREATE TABLE",
            },
          };
        }
        idx = tblQual.nextIdx;
        if (tokens[idx]?.text !== "(") {
          const pos = lineAndCol(text, (tokens[idx] ?? first).start);
          return {
            ok: false,
            error: {
              line: pos.line,
              column: pos.column,
              message: "esperava ( após o nome da tabela",
            },
          };
        }

        const closeParenIdx = findMatchingParen(tokens, idx);
        if (closeParenIdx < 0) {
          const lastTok = tokens[tokens.length - 1];
          const pos = lineAndCol(text, lastTok.start);
          return {
            ok: false,
            error: {
              line: pos.line,
              column: pos.column,
              message: "esperava ) para fechar CREATE TABLE",
            },
          };
        }

        const leadingComment =
          engine === "informix"
            ? extractLeadingLineComment(text.slice(stmt.start, first.start))
            : null;

        const table: ModelTable = {
          schema: tblQual.schema,
          name: tblQual.name,
          exactName: tblQual.exactName,
          comment: leadingComment,
          columns: [],
          primaryKey: null,
          uniques: [],
          checks: [],
          indexes: [],
          foreignKeys: [],
          origin: null,
          dropInDatabase: false,
        };

        let p = idx + 1;
        let prevBoundaryOffset = tokens[idx].end;

        while (p < closeParenIdx) {
          if (tokens[p].text === ",") {
            prevBoundaryOffset = tokens[p].end;
            p++;
            continue;
          }

          const cur = tokens[p];
          if (cur.word && TABLE_CONSTRAINT_STARTERS.has(cur.text)) {
            const parsedConstraint = parseTableConstraintItem(
              text,
              engine,
              before.defaultSchema,
              table,
              tokens,
              p,
            );
            if (parsedConstraint) {
              p = parsedConstraint.nextIdx;
              if (p < closeParenIdx && tokens[p].text !== ",") {
                const unexpected = tokens[p];
                const pos = lineAndCol(text, unexpected.start);
                return {
                  ok: false,
                  error: {
                    line: pos.line,
                    column: pos.column,
                    message: `esperava , ou ) antes de ${unexpected.raw}`,
                  },
                };
              }
              if (tokens[p]?.text === ",") {
                prevBoundaryOffset = tokens[p].end;
                p++;
              }
              continue;
            }
          }

          const colComment =
            engine === "informix"
              ? extractCommentBeforeOffset(text, prevBoundaryOffset, cur.start)
              : null;

          const colIdent = unquoteIdentifier(engine, cur.raw);
          p++;

          const dt = parseDataType(text, tokens, p);
          if (!dt) {
            const errTok = tokens[p] ?? cur;
            const pos = lineAndCol(text, errTok.start);
            return {
              ok: false,
              error: {
                line: pos.line,
                column: pos.column,
                message: `esperava o tipo da coluna ${colIdent.name}`,
              },
            };
          }
          p = dt.nextIdx;

          let colType = dt.rawType;
          let identity: IdentityMode | null = null;
          let nullable = true;
          let defaultVal: string | null = null;

          const lowerRawType = colType.toLowerCase();
          if (lowerRawType === "serial" || lowerRawType === "serial4") {
            colType = "integer";
            identity = "byDefault";
            nullable = false;
          } else if (lowerRawType === "bigserial" || lowerRawType === "serial8") {
            colType = "bigint";
            identity = "byDefault";
            nullable = false;
          } else if (lowerRawType === "smallserial" || lowerRawType === "serial2") {
            colType = "smallint";
            identity = "byDefault";
            nullable = false;
          }

          while (p < closeParenIdx && tokens[p].text !== ",") {
            const mod = tokens[p];
            let inlineConstraintName: string | null = null;
            if (mod.word && mod.text === "constraint" && tokens[p + 1]) {
              inlineConstraintName = unquoteIdentifier(engine, tokens[p + 1].raw).name;
              p += 2;
            }

            const kw = tokens[p];
            if (!kw) break;

            if (kw.word && kw.text === "not" && tokens[p + 1]?.text === "null") {
              nullable = false;
              p += 2;
              const trailing = parseTrailingInformixConstraintName(engine, tokens, p);
              p = trailing.nextIdx;
              continue;
            }

            if (kw.word && kw.text === "null") {
              p += 1;
              continue;
            }

            if (kw.word && kw.text === "default") {
              const def = parseDefaultExpression(text, tokens, p + 1);
              if (!def) {
                const pos = lineAndCol(text, kw.start);
                return {
                  ok: false,
                  error: {
                    line: pos.line,
                    column: pos.column,
                    message: `esperava expressão após DEFAULT em ${colIdent.name}`,
                  },
                };
              }
              defaultVal = def.value;
              p = def.nextIdx;
              continue;
            }

            if (kw.word && kw.text === "generated") {
              if (tokens[p + 1]?.text === "always") {
                identity = "always";
                p += 2;
              } else if (
                tokens[p + 1]?.text === "by" &&
                tokens[p + 2]?.text === "default"
              ) {
                identity = "byDefault";
                p += 3;
              } else {
                p += 1;
              }
              if (tokens[p]?.text === "as") p++;
              if (tokens[p]?.text === "identity") p++;
              if (tokens[p]?.text === "(") {
                const closeSeq = findMatchingParen(tokens, p);
                if (closeSeq >= 0) p = closeSeq + 1;
              }
              nullable = false;
              continue;
            }

            if (kw.word && kw.text === "primary" && tokens[p + 1]?.text === "key") {
              p += 2;
              const trailing = parseTrailingInformixConstraintName(engine, tokens, p);
              p = trailing.nextIdx;
              nullable = false;
              table.primaryKey = {
                name: inlineConstraintName ?? trailing.name,
                columns: [colIdent.name],
              };
              continue;
            }

            if (kw.word && kw.text === "unique") {
              p += 1;
              const trailing = parseTrailingInformixConstraintName(engine, tokens, p);
              p = trailing.nextIdx;
              table.uniques.push({
                name: inlineConstraintName ?? trailing.name,
                columns: [colIdent.name],
              });
              continue;
            }

            if (kw.word && kw.text === "references") {
              const ref = parseReferencesClause(
                engine,
                before.defaultSchema,
                [colIdent.name],
                inlineConstraintName,
                tokens,
                p,
              );
              if (!ref) {
                const pos = lineAndCol(text, kw.start);
                return {
                  ok: false,
                  error: {
                    line: pos.line,
                    column: pos.column,
                    message: `referência inválida na coluna ${colIdent.name}`,
                  },
                };
              }
              table.foreignKeys.push(ref.fk);
              p = ref.nextIdx;
              continue;
            }

            if (kw.word && kw.text === "check" && tokens[p + 1]?.text === "(") {
              const closeChk = findMatchingParen(tokens, p + 1);
              if (closeChk < 0) {
                const pos = lineAndCol(text, kw.start);
                return {
                  ok: false,
                  error: {
                    line: pos.line,
                    column: pos.column,
                    message: `CHECK sem fechar ) na coluna ${colIdent.name}`,
                  },
                };
              }
              const expr = text.slice(tokens[p + 1].end, tokens[closeChk].start).trim();
              const trailing = parseTrailingInformixConstraintName(
                engine,
                tokens,
                closeChk + 1,
              );
              table.checks.push({
                name: inlineConstraintName ?? trailing.name,
                expression: expr,
              });
              p = trailing.nextIdx;
              continue;
            }

            const pos = lineAndCol(text, kw.start);
            return {
              ok: false,
              error: {
                line: pos.line,
                column: pos.column,
                message: `esperava , ou ) antes de ${kw.raw}`,
              },
            };
          }

          table.columns.push({
            name: colIdent.name,
            exactName: colIdent.exactName,
            originName: null,
            type: colType,
            nullable,
            default: defaultVal,
            identity,
            comment: colComment,
          });

          if (tokens[p]?.text === ",") {
            prevBoundaryOffset = tokens[p].end;
            p++;
          }
        }

        tables.push(table);
        continue;
      }

      const stmtLine = lineAndCol(text, first.start).line;
      let label = "CREATE";
      let kIdx = 1;
      while (
        tokens[kIdx]?.word &&
        (tokens[kIdx].text === "or" ||
          tokens[kIdx].text === "replace" ||
          tokens[kIdx].text === "temp" ||
          tokens[kIdx].text === "temporary" ||
          tokens[kIdx].text === "materialized" ||
          tokens[kIdx].text === "unique")
      ) {
        kIdx++;
      }
      if (tokens[kIdx]?.word) {
        label = `CREATE ${tokens[kIdx].text.toUpperCase()}`;
      }
      warnings.push({ line: stmtLine, message: `linha ${stmtLine}: ${label} ignorado` });
      continue;
    }

    if (first.word && first.text === "alter" && second?.word && second.text === "table") {
      let idx = 2;
      if (tokens[idx]?.text === "if" && tokens[idx + 1]?.text === "exists") {
        idx += 2;
      }
      const tblQual = parseQualifiedName(engine, before.defaultSchema, tokens, idx);
      if (tblQual) {
        idx = tblQual.nextIdx;
        const targetTable = findTable(tblQual.schema, tblQual.name);
        if (targetTable && tokens[idx]?.word && tokens[idx].text === "add") {
          idx++;
          const parsed = parseTableConstraintItem(
            text,
            engine,
            before.defaultSchema,
            targetTable,
            tokens,
            idx,
          );
          if (parsed) {
            continue;
          }
        }
      }
      const stmtLine = lineAndCol(text, first.start).line;
      warnings.push({ line: stmtLine, message: `linha ${stmtLine}: ALTER TABLE ignorado` });
      continue;
    }

    if (first.word && first.text === "comment" && second?.word && second.text === "on") {
      const kind = tokens[2];
      if (kind?.word && kind.text === "table") {
        const tblQual = parseQualifiedName(engine, before.defaultSchema, tokens, 3);
        if (tblQual && tokens[tblQual.nextIdx]?.text === "is") {
          const valTok = tokens[tblQual.nextIdx + 1];
          const targetTable = findTable(tblQual.schema, tblQual.name);
          if (targetTable && valTok) {
            targetTable.comment =
              valTok.word && valTok.text === "null" ? null : unquoteSqlString(valTok.raw);
          }
          continue;
        }
      }
      if (kind?.word && kind.text === "column") {
        let idx = 3;
        let schema = before.defaultSchema;
        let tblName = "";
        let colName = "";
        if (
          tokens[idx + 1]?.text === "." &&
          tokens[idx + 3]?.text === "." &&
          tokens[idx + 4]
        ) {
          schema = unquoteIdentifier(engine, tokens[idx].raw).name;
          tblName = unquoteIdentifier(engine, tokens[idx + 2].raw).name;
          colName = unquoteIdentifier(engine, tokens[idx + 4].raw).name;
          idx += 5;
        } else if (tokens[idx + 1]?.text === "." && tokens[idx + 2]) {
          tblName = unquoteIdentifier(engine, tokens[idx].raw).name;
          colName = unquoteIdentifier(engine, tokens[idx + 2].raw).name;
          idx += 3;
        }
        if (tblName && colName && tokens[idx]?.text === "is") {
          const valTok = tokens[idx + 1];
          const targetTable = findTable(schema, tblName);
          const targetCol = targetTable?.columns.find((c) =>
            sameIdent(engine, c.name, colName),
          );
          if (targetCol && valTok) {
            targetCol.comment =
              valTok.word && valTok.text === "null" ? null : unquoteSqlString(valTok.raw);
          }
          continue;
        }
      }
    }

    const stmtLine = lineAndCol(text, first.start).line;
    const cmdLabel =
      (first.text === "drop" || first.text === "alter") && second?.word
        ? `${first.text.toUpperCase()} ${second.text.toUpperCase()}`
        : first.raw.toUpperCase();
    warnings.push({ line: stmtLine, message: `linha ${stmtLine}: ${cmdLabel} ignorado` });
  }

  return {
    ok: true,
    tables: mergeTextTables(tables, before, "sql"),
    schemas,
    warnings,
  };
}
