import { engineRules, quoteName } from "./build-engines";
import { tableKey } from "./build-model";
import type { BuildModel, ModelTable } from "./build-model.schema";
import {
  columnDefinition,
  constraintClause,
  dependencyOrder,
  escapeSqlString,
  findColumnExactName,
  formatAddForeignKey,
  formatCreateIndex,
  formatForeignKeyBody,
  qualifiedName,
  resolvedConstraintNames,
} from "./ddl-write";

export type DdlContext = {
  modelName: string;
  prismVersion: string;
  generatedAt: string;
  baseLabel: string | null;
};

export type DdlResult = {
  text: string;
  statements: number;
  lineOf: Record<string, number>;
};

function resolveConstraintName(
  model: BuildModel,
  explicitName: string | null,
  key: string,
  names: Map<string, string>,
): string | null {
  if (explicitName) return explicitName;
  if (!model.ddl.constraintNames) return null;
  return names.get(key) ?? null;
}

export function generateFullDdl(model: BuildModel, context: DdlContext): DdlResult {
  const engine = model.engine;
  const rules = engineRules[engine];
  const names = resolvedConstraintNames(model);
  const activeTables = model.tables.filter((t) => !t.dropInDatabase);
  const { order, deferred } = dependencyOrder(activeTables);

  const lines: string[] = [];
  const lineOf: Record<string, number> = {};
  let statements = 0;

  const pushBlock = (blockLines: string[]) => {
    if (lines.length > 0 && blockLines.length > 0) {
      lines.push("");
    }
    for (const l of blockLines) {
      lines.push(l);
    }
  };

  // 1. Cabeçalho
  const headerLines = [
    `-- Modelo ${context.modelName} · ${rules.label} · gerado pelo Prism ${context.prismVersion} em ${context.generatedAt}`,
  ];
  if (model.base !== null) {
    headerLines.push(
      "-- Tudo: o esquema inteiro, do zero, com as existentes como estão no modelo.",
    );
    if (context.baseLabel) {
      headerLines.push(
        `-- Em ${context.baseLabel} falha no primeiro CREATE: as existentes já estão lá.`,
      );
    }
  } else {
    headerLines.push("-- Tudo: o esquema inteiro, do zero.");
  }
  pushBlock(headerLines);

  // 2. DROP das novas antes de criar (ordem inversa de dependência)
  if (model.ddl.dropNewFirst) {
    const newInReverse = order.filter((t) => t.origin === null).reverse();
    if (newInReverse.length > 0) {
      const dropLines: string[] = [];
      if (engine === "db2") {
        dropLines.push("-- O Db2 não tem DROP TABLE IF EXISTS: falha se a tabela não existir.");
      }
      for (const table of newInReverse) {
        const qName = qualifiedName(engine, table.schema, table.name, table.exactName);
        if (engine === "db2") {
          dropLines.push(`DROP TABLE ${qName};`);
        } else {
          dropLines.push(`DROP TABLE IF EXISTS ${qName};`);
        }
        statements++;
      }
      pushBlock(dropLines);
    }
  }

  // 3. CREATE SCHEMA
  if (rules.hasSchemas) {
    const schemasToCreate = model.schemas.filter((s) => s.create);
    if (schemasToCreate.length > 0) {
      const schemaLines = schemasToCreate.map((s) => {
        statements++;
        return `CREATE SCHEMA ${quoteName(engine, s.name, false)};`;
      });
      pushBlock(schemaLines);
    }
  }

  // 4. CREATE TABLE
  const deferredFkCalls: { table: ModelTable; fkIndex: number }[] = [];

  for (const table of order) {
    const tKey = tableKey(table);
    const qTable = qualifiedName(engine, table.schema, table.name, table.exactName);

    if (lines.length > 0) {
      lines.push("");
    }
    if (engine === "informix" && model.ddl.comments && table.comment) {
      lines.push(`-- ${table.comment}`);
    }

    lines.push(`CREATE TABLE ${qTable} (`);
    lineOf[tKey] = lines.length;

    const maxColWidth = table.columns.reduce((max, col) => {
      const qCol = quoteName(engine, col.name, col.exactName);
      return Math.max(max, qCol.length);
    }, 0);

    type BodyEntry = {
      commentBefore?: string;
      text: string;
      columnName?: string;
      fkColumnName?: string;
    };
    const entries: BodyEntry[] = [];

    for (const col of table.columns) {
      const colDef = columnDefinition(engine, col, {
        inlinePrimaryKey: false,
        inlineReference: null,
        nameWidth: maxColWidth,
      });
      entries.push({
        commentBefore:
          engine === "informix" && model.ddl.comments && col.comment ? col.comment : undefined,
        text: `  ${colDef}`,
        columnName: col.name,
      });
    }

    if (table.primaryKey && table.primaryKey.columns.length > 0) {
      const pkCols = table.primaryKey.columns
        .map((c) => quoteName(engine, c, findColumnExactName(table, c, engine)))
        .join(", ");
      const pkName = resolveConstraintName(model, table.primaryKey.name, `${tKey}#pk#0`, names);
      entries.push({
        text: `  ${constraintClause(engine, pkName, `PRIMARY KEY (${pkCols})`)}`,
      });
    }

    table.uniques.forEach((uq, idx) => {
      if (uq.columns.length === 0) return;
      const uqCols = uq.columns
        .map((c) => quoteName(engine, c, findColumnExactName(table, c, engine)))
        .join(", ");
      const uqName = resolveConstraintName(model, uq.name, `${tKey}#uq#${idx}`, names);
      entries.push({
        text: `  ${constraintClause(engine, uqName, `UNIQUE (${uqCols})`)}`,
      });
    });

    table.checks.forEach((ck, idx) => {
      const ckName = resolveConstraintName(model, ck.name, `${tKey}#ck#${idx}`, names);
      entries.push({
        text: `  ${constraintClause(engine, ckName, `CHECK (${ck.expression})`)}`,
      });
    });

    table.foreignKeys.forEach((fk, idx) => {
      const fkKey = `${tKey}#fk#${idx}`;
      if (model.ddl.foreignKeysAtEnd || deferred.has(fkKey)) {
        deferredFkCalls.push({ table, fkIndex: idx });
        return;
      }
      const fkName = resolveConstraintName(model, fk.name, fkKey, names);
      const fkBody = formatForeignKeyBody(engine, table, fk, activeTables);
      entries.push({
        text: `  ${constraintClause(engine, fkName, fkBody)}`,
        fkColumnName: fk.columns[0],
      });
    });

    entries.forEach((entry, idx) => {
      if (entry.commentBefore) {
        lines.push(`  -- ${entry.commentBefore}`);
      }
      const isLast = idx === entries.length - 1;
      const entryText = isLast ? entry.text : `${entry.text},`;
      const splitLines = entryText.split("\n");
      const firstLineNumber = lines.length + 1;
      for (const sl of splitLines) {
        lines.push(sl);
      }
      if (entry.columnName) {
        lineOf[`${tKey}.${entry.columnName}`] = firstLineNumber;
      }
    });

    lines.push(");");
    statements++;
  }

  // 4b. FKs adiadas ou foreignKeysAtEnd
  if (deferredFkCalls.length > 0) {
    const fkLines: string[] = [];
    for (const { table, fkIndex } of deferredFkCalls) {
      const tKey = tableKey(table);
      const fk = table.foreignKeys[fkIndex];
      const fkName = resolveConstraintName(model, fk.name, `${tKey}#fk#${fkIndex}`, names);
      const stmt = formatAddForeignKey(engine, table, fk, fkName, activeTables);
      for (const l of stmt.split("\n")) {
        fkLines.push(l);
      }
      statements++;
    }
    pushBlock(fkLines);
  }

  // 5. CREATE INDEX (na ordem das tabelas)
  const indexLines: string[] = [];
  for (const table of order) {
    for (const index of table.indexes) {
      const stmt = formatCreateIndex(engine, table, index);
      for (const l of stmt.split("\n")) {
        indexLines.push(l);
      }
      statements++;
    }
  }
  if (indexLines.length > 0) {
    pushBlock(indexLines);
  }

  // 6. Comentários (COMMENT ON, só PostgreSQL e Db2)
  if (model.ddl.comments && engine !== "informix") {
    const commentLines: string[] = [];
    for (const table of order) {
      const qTable = qualifiedName(engine, table.schema, table.name, table.exactName);
      if (table.comment) {
        commentLines.push(`COMMENT ON TABLE ${qTable}`);
        commentLines.push(`  IS '${escapeSqlString(table.comment)}';`);
        statements++;
      }
      for (const col of table.columns) {
        if (col.comment) {
          const qCol = quoteName(engine, col.name, col.exactName);
          commentLines.push(`COMMENT ON COLUMN ${qTable}.${qCol}`);
          commentLines.push(`  IS '${escapeSqlString(col.comment)}';`);
          statements++;
        }
      }
    }
    if (commentLines.length > 0) {
      pushBlock(commentLines);
    }
  }

  return {
    text: lines.join("\n"),
    statements,
    lineOf,
  };
}
