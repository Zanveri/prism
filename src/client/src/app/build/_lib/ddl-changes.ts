import { engineRules, normalizeType, quoteName, sameName } from "./build-engines";
import { tableChanges, tableKey } from "./build-model";
import type { BuildModel, ModelForeignKey, ModelTable } from "./build-model.schema";
import { type DdlContext, type DdlResult, generateFullDdl } from "./ddl-full";
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

function formatPortugueseList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} e ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

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

type BuildChangesBodyResult = {
  blocks: string[][];
  statements: number;
  relativeLineOf: Record<string, { blockIndex: number; lineInBlock: number }>;
};

function buildChangesBody(
  model: BuildModel,
  filterTableKey: string | null,
): BuildChangesBodyResult {
  const engine = model.engine;
  const rules = engineRules[engine];
  const names = resolvedConstraintNames(model);
  const activeTables = model.tables.filter((t) => !t.dropInDatabase);

  const tablesInScope = filterTableKey
    ? model.tables.filter((t) => tableKey(t) === filterTableKey)
    : model.tables;

  const existingTables = [...tablesInScope.filter((t) => t.origin !== null)].sort((a, b) =>
    tableKey(a).localeCompare(tableKey(b)),
  );
  const newTables = tablesInScope.filter((t) => t.origin === null && !t.dropInDatabase);

  const changesByKey = new Map(existingTables.map((t) => [tableKey(t), tableChanges(engine, t)]));

  const blocks: string[][] = [];
  const relativeLineOf: Record<string, { blockIndex: number; lineInBlock: number }> = {};
  let statements = 0;

  const pushBlock = (blockLines: string[]) => {
    if (blockLines.length > 0) {
      blocks.push(blockLines);
    }
  };

  // Track unchanged FKs that must be dropped and re-added because a referenced or local column changed type
  const readdFksByTable = new Map<string, ModelForeignKey[]>();

  // 2. DROP CONSTRAINT das FKs removidas/alteradas, de tabelas excluídas, ou dependentes de coluna removida/alterada
  const dropFkLines: string[] = [];
  for (const table of existingTables) {
    const tKey = tableKey(table);
    const changes = changesByKey.get(tKey)!;
    const origin = table.origin!;
    const originQTable = qualifiedName(engine, origin.schema, origin.name, origin.exactName);

    if (changes.kind === "dropped") {
      for (const fk of origin.foreignKeys) {
        if (!fk.name) continue;
        const fkName = quoteName(engine, fk.name, false);
        const dropVerb = engine === "db2" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";
        dropFkLines.push(`ALTER TABLE ${originQTable} ${dropVerb} ${fkName};`);
        statements++;
      }
      continue;
    }

    if (changes.kind !== "changed") continue;

    const droppedFkNames = new Set<string>();
    for (const fk of changes.removedForeignKeys) {
      if (!fk.name) continue;
      droppedFkNames.add(fk.name);
      const fkName = quoteName(engine, fk.name, false);
      const dropVerb = engine === "db2" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";
      dropFkLines.push(`ALTER TABLE ${originQTable} ${dropVerb} ${fkName};`);
      statements++;
    }

    for (const originFk of origin.foreignKeys) {
      if (!originFk.name || droppedFkNames.has(originFk.name)) continue;
      const localRemoved = originFk.columns.some((col) => changes.removedColumns.includes(col));
      const localTypeChanged = originFk.columns.some((col) =>
        changes.changedColumns.some((cc) => cc.originName === col && cc.type),
      );
      if (localRemoved || localTypeChanged) {
        const fkName = quoteName(engine, originFk.name, false);
        const dropVerb = engine === "db2" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";
        dropFkLines.push(`ALTER TABLE ${originQTable} ${dropVerb} ${fkName};`);
        statements++;
        if (!localRemoved && localTypeChanged) {
          const currentFk = table.foreignKeys.find((f) => f.name === originFk.name);
          if (currentFk) {
            const list = readdFksByTable.get(tKey) ?? [];
            list.push(currentFk);
            readdFksByTable.set(tKey, list);
          }
        }
      }
    }
  }
  pushBlock(dropFkLines);

  // 3. DROP INDEX dos índices removidos ou alterados
  const dropIndexLines: string[] = [];
  for (const table of existingTables) {
    const tKey = tableKey(table);
    const changes = changesByKey.get(tKey)!;
    if (changes.kind !== "changed") continue;
    const origin = table.origin!;
    for (const ix of changes.removedIndexes) {
      const ixName =
        engine === "informix" || !origin.schema
          ? quoteName(engine, ix.name, false)
          : qualifiedName(engine, origin.schema, ix.name, false);
      dropIndexLines.push(`DROP INDEX ${ixName};`);
      statements++;
    }
  }
  pushBlock(dropIndexLines);

  // 4. DROP TABLE das existentes marcadas para excluir
  const dropTableLines: string[] = [];
  for (const table of existingTables) {
    const tKey = tableKey(table);
    const changes = changesByKey.get(tKey)!;
    if (changes.kind !== "dropped") continue;
    const origin = table.origin!;
    const originQTable = qualifiedName(engine, origin.schema, origin.name, origin.exactName);
    dropTableLines.push(`DROP TABLE ${originQTable};`);
    statements++;
  }
  pushBlock(dropTableLines);

  // 5. Renomeações: de tabela, depois de coluna
  const renameLines: string[] = [];
  for (const table of existingTables) {
    const tKey = tableKey(table);
    const changes = changesByKey.get(tKey)!;
    if (changes.kind !== "changed" || !changes.renamedFrom) continue;
    const origin = table.origin!;
    const originQTable = qualifiedName(engine, origin.schema, origin.name, origin.exactName);
    const newName = quoteName(engine, table.name, table.exactName);
    if (engine === "postgresql") {
      renameLines.push(`ALTER TABLE ${originQTable} RENAME TO ${newName};`);
    } else {
      renameLines.push(`RENAME TABLE ${originQTable} TO ${newName};`);
    }
    statements++;
  }
  for (const table of existingTables) {
    const tKey = tableKey(table);
    const changes = changesByKey.get(tKey)!;
    if (changes.kind !== "changed") continue;
    const qTable = qualifiedName(engine, table.schema, table.name, table.exactName);
    for (const cc of changes.changedColumns) {
      if (!cc.renamed) continue;
      const originCol = table.origin!.columns.find(
        (c) => (c.originName ?? c.name) === cc.originName || c.name === cc.originName,
      );
      const currentCol = table.columns.find((c) => c.name === cc.name);
      const fromCol = quoteName(engine, cc.originName, originCol?.exactName ?? false);
      const toCol = quoteName(engine, cc.name, currentCol?.exactName ?? false);
      if (engine === "informix") {
        renameLines.push(`RENAME COLUMN ${qTable}.${fromCol} TO ${toCol};`);
      } else {
        renameLines.push(`ALTER TABLE ${qTable} RENAME COLUMN ${fromCol} TO ${toCol};`);
      }
      statements++;
    }
  }
  pushBlock(renameLines);

  // 6. CREATE SCHEMA dos esquemas com create que não estão em knownSchemas
  if (!filterTableKey && rules.hasSchemas) {
    const knownSchemas = model.base?.knownSchemas ?? [];
    const schemasToCreate = model.schemas.filter(
      (s) =>
        s.create &&
        !knownSchemas.some((k) =>
          sameName(engine, { name: k, exactName: false }, { name: s.name, exactName: false }),
        ),
    );
    if (schemasToCreate.length > 0) {
      const schemaLines = schemasToCreate.map((s) => {
        statements++;
        return `CREATE SCHEMA ${quoteName(engine, s.name, false)};`;
      });
      pushBlock(schemaLines);
    }
  }

  // 8 & 9. ALTER TABLE de cada existente alterada (+ REORG no Db2)
  const alterLines: string[] = [];
  const reorgTables: { qTable: string; reasons: string[] }[] = [];

  for (const table of existingTables) {
    const tKey = tableKey(table);
    const changes = changesByKey.get(tKey)!;
    if (changes.kind !== "changed") continue;
    const qTable = qualifiedName(engine, table.schema, table.name, table.exactName);
    const reasons: string[] = [];
    const addReason = (reason: string) => {
      if (!reasons.includes(reason)) reasons.push(reason);
    };

    // Removidos os únicos e checks que saíram ou mudaram
    for (const uq of changes.removedUniques) {
      if (!uq.name) continue;
      alterLines.push(
        `ALTER TABLE ${qTable} DROP CONSTRAINT ${quoteName(engine, uq.name, false)};`,
      );
      statements++;
    }
    for (const ck of changes.removedChecks) {
      if (!ck.name) continue;
      alterLines.push(
        `ALTER TABLE ${qTable} DROP CONSTRAINT ${quoteName(engine, ck.name, false)};`,
      );
      statements++;
    }

    // Alteradas as colunas que mudaram
    for (const cc of changes.changedColumns) {
      if (!cc.type && !cc.default && !cc.nullable) continue;
      const col = table.columns.find((c) => c.name === cc.name)!;
      const originCol = table.origin!.columns.find(
        (c) => (c.originName ?? c.name) === cc.originName || c.name === cc.originName,
      )!;
      const qCol = quoteName(engine, col.name, col.exactName);

      if (engine === "informix") {
        const colDef = columnDefinition(engine, col, {
          inlinePrimaryKey: false,
          inlineReference: null,
        });
        alterLines.push(`ALTER TABLE ${qTable} MODIFY (${colDef});`);
        statements++;
      } else {
        if (cc.type) {
          if (engine === "postgresql") {
            const curFamily = normalizeType(engine, col.type).family;
            const origFamily = normalizeType(engine, originCol.type).family;
            const usingClause = curFamily !== origFamily ? ` USING ${qCol}::${col.type}` : "";
            alterLines.push(
              `ALTER TABLE ${qTable} ALTER COLUMN ${qCol} TYPE ${col.type}${usingClause};`,
            );
          } else {
            alterLines.push(`ALTER TABLE ${qTable} ALTER COLUMN ${qCol} SET DATA TYPE ${col.type};`);
            addReason("troca de tipo");
          }
          statements++;
        }
        if (cc.default) {
          if (col.default !== null && col.default.trim() !== "") {
            alterLines.push(
              `ALTER TABLE ${qTable} ALTER COLUMN ${qCol} SET DEFAULT ${col.default};`,
            );
          } else {
            alterLines.push(`ALTER TABLE ${qTable} ALTER COLUMN ${qCol} DROP DEFAULT;`);
          }
          statements++;
        }
        if (cc.nullable) {
          if (!col.nullable) {
            alterLines.push(`ALTER TABLE ${qTable} ALTER COLUMN ${qCol} SET NOT NULL;`);
          } else {
            alterLines.push(`ALTER TABLE ${qTable} ALTER COLUMN ${qCol} DROP NOT NULL;`);
          }
          if (engine === "db2") {
            addReason("troca de nulo");
          }
          statements++;
        }
      }
    }

    // Removidas as colunas que saíram
    for (const originColName of changes.removedColumns) {
      const originCol = table.origin!.columns.find(
        (c) => (c.originName ?? c.name) === originColName || c.name === originColName,
      );
      const qOriginCol = quoteName(engine, originColName, originCol?.exactName ?? false);
      if (engine === "informix") {
        alterLines.push(`ALTER TABLE ${qTable} DROP (${qOriginCol});`);
      } else {
        alterLines.push(`ALTER TABLE ${qTable} DROP COLUMN ${qOriginCol};`);
        if (engine === "db2") {
          addReason("remoção de coluna");
        }
      }
      statements++;
    }

    // Acrescentadas as colunas novas
    for (const colName of changes.addedColumns) {
      const col = table.columns.find((c) => c.name === colName)!;
      const colDef = columnDefinition(engine, col, {
        inlinePrimaryKey: false,
        inlineReference: null,
      });
      if (engine === "informix") {
        alterLines.push(`ALTER TABLE ${qTable} ADD (${colDef});`);
      } else {
        alterLines.push(`ALTER TABLE ${qTable} ADD COLUMN ${colDef};`);
      }
      relativeLineOf[`${tKey}.${col.name}`] = {
        blockIndex: blocks.length,
        lineInBlock: alterLines.length,
      };
      statements++;
    }

    // Acrescentados os únicos e checks novos
    for (const uq of changes.addedUniques) {
      const idx = table.uniques.indexOf(uq);
      const uqName = resolveConstraintName(model, uq.name, `${tKey}#uq#${idx}`, names);
      const uqCols = uq.columns
        .map((c) => quoteName(engine, c, findColumnExactName(table, c, engine)))
        .join(", ");
      const clause = constraintClause(engine, uqName, `UNIQUE (${uqCols})`);
      if (engine === "informix") {
        alterLines.push(`ALTER TABLE ${qTable} ADD CONSTRAINT ${clause};`);
      } else {
        alterLines.push(`ALTER TABLE ${qTable} ADD ${clause};`);
      }
      statements++;
    }
    for (const ck of changes.addedChecks) {
      const idx = table.checks.indexOf(ck);
      const ckName = resolveConstraintName(model, ck.name, `${tKey}#ck#${idx}`, names);
      const clause = constraintClause(engine, ckName, `CHECK (${ck.expression})`);
      if (engine === "informix") {
        alterLines.push(`ALTER TABLE ${qTable} ADD CONSTRAINT ${clause};`);
      } else {
        alterLines.push(`ALTER TABLE ${qTable} ADD ${clause};`);
      }
      statements++;
    }

    if (engine === "db2" && reasons.length > 0) {
      reorgTables.push({ qTable, reasons });
    }
  }
  pushBlock(alterLines);

  if (engine === "db2" && reorgTables.length > 0) {
    const reorgLines: string[] = [];
    for (const { qTable, reasons } of reorgTables) {
      reorgLines.push(`-- Reorganizar ${qTable} após ${formatPortugueseList(reasons)}`);
      reorgLines.push(`CALL SYSPROC.ADMIN_CMD('REORG TABLE ${qTable}');`);
      statements++;
    }
    pushBlock(reorgLines);
  }

  // 7. DROP das novas antes de criar + CREATE TABLE das novas
  const { order: newOrder, deferred } = dependencyOrder(newTables);
  const deferredFkCalls: { table: ModelTable; fkIndex: number }[] = [];

  if (!filterTableKey && model.ddl.dropNewFirst && newOrder.length > 0) {
    const dropNewLines: string[] = [];
    if (engine === "db2") {
      dropNewLines.push("-- O Db2 não tem DROP TABLE IF EXISTS: falha se a tabela não existir.");
    }
    for (const table of [...newOrder].reverse()) {
      const qName = qualifiedName(engine, table.schema, table.name, table.exactName);
      if (engine === "db2") {
        dropNewLines.push(`DROP TABLE ${qName};`);
      } else {
        dropNewLines.push(`DROP TABLE IF EXISTS ${qName};`);
      }
      statements++;
    }
    pushBlock(dropNewLines);
  }

  for (const table of newOrder) {
    const tKey = tableKey(table);
    const qTable = qualifiedName(engine, table.schema, table.name, table.exactName);
    const tableLines: string[] = [];
    const blockIdx = blocks.length;

    if (engine === "informix" && model.ddl.comments && table.comment) {
      tableLines.push(`-- ${table.comment}`);
    }
    tableLines.push(`CREATE TABLE ${qTable} (`);
    relativeLineOf[tKey] = { blockIndex: blockIdx, lineInBlock: tableLines.length };

    const maxColWidth = table.columns.reduce((max, col) => {
      const qCol = quoteName(engine, col.name, col.exactName);
      return Math.max(max, qCol.length);
    }, 0);

    type BodyEntry = {
      commentBefore?: string;
      text: string;
      columnName?: string;
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
      });
    });

    entries.forEach((entry, idx) => {
      if (entry.commentBefore) {
        tableLines.push(`  -- ${entry.commentBefore}`);
      }
      const isLast = idx === entries.length - 1;
      const entryText = isLast ? entry.text : `${entry.text},`;
      const splitLines = entryText.split("\n");
      const firstLineInBlock = tableLines.length + 1;
      for (const sl of splitLines) {
        tableLines.push(sl);
      }
      if (entry.columnName) {
        relativeLineOf[`${tKey}.${entry.columnName}`] = {
          blockIndex: blockIdx,
          lineInBlock: firstLineInBlock,
        };
      }
    });

    tableLines.push(");");
    statements++;
    pushBlock(tableLines);
  }

  // 10. ADD CONSTRAINT das FKs novas ou alteradas em existentes, e das FKs adiadas por ciclo
  const addFkLines: string[] = [];
  for (const table of existingTables) {
    const tKey = tableKey(table);
    const changes = changesByKey.get(tKey)!;
    if (changes.kind !== "changed") continue;
    const fksToAdd = [...changes.addedForeignKeys, ...(readdFksByTable.get(tKey) ?? [])];
    for (const fk of fksToAdd) {
      const fkIndex = table.foreignKeys.indexOf(fk);
      const fkName = resolveConstraintName(
        model,
        fk.name,
        `${tKey}#fk#${fkIndex >= 0 ? fkIndex : 0}`,
        names,
      );
      const stmt = formatAddForeignKey(engine, table, fk, fkName, activeTables);
      for (const l of stmt.split("\n")) {
        addFkLines.push(l);
      }
      statements++;
    }
  }
  for (const { table, fkIndex } of deferredFkCalls) {
    const tKey = tableKey(table);
    const fk = table.foreignKeys[fkIndex]!;
    const fkName = resolveConstraintName(model, fk.name, `${tKey}#fk#${fkIndex}`, names);
    const stmt = formatAddForeignKey(engine, table, fk, fkName, activeTables);
    for (const l of stmt.split("\n")) {
      addFkLines.push(l);
    }
    statements++;
  }
  pushBlock(addFkLines);

  // 11. CREATE INDEX dos índices novos ou alterados
  const indexLines: string[] = [];
  for (const table of existingTables) {
    const tKey = tableKey(table);
    const changes = changesByKey.get(tKey)!;
    if (changes.kind !== "changed") continue;
    for (const index of changes.addedIndexes) {
      const stmt = formatCreateIndex(engine, table, index);
      for (const l of stmt.split("\n")) {
        indexLines.push(l);
      }
      statements++;
    }
  }
  for (const table of newOrder) {
    for (const index of table.indexes) {
      const stmt = formatCreateIndex(engine, table, index);
      for (const l of stmt.split("\n")) {
        indexLines.push(l);
      }
      statements++;
    }
  }
  pushBlock(indexLines);

  // 12. Comentários novos ou alterados (COMMENT ON, só PostgreSQL e Db2)
  if (model.ddl.comments && engine !== "informix") {
    const commentLines: string[] = [];
    for (const table of existingTables) {
      const tKey = tableKey(table);
      const changes = changesByKey.get(tKey)!;
      if (changes.kind !== "changed") continue;
      const qTable = qualifiedName(engine, table.schema, table.name, table.exactName);
      if (changes.commentChanged) {
        if (table.comment) {
          commentLines.push(`COMMENT ON TABLE ${qTable}`);
          commentLines.push(`  IS '${escapeSqlString(table.comment)}';`);
        } else {
          commentLines.push(`COMMENT ON TABLE ${qTable}`);
          commentLines.push("  IS NULL;");
        }
        statements++;
      }
      for (const colName of changes.addedColumns) {
        const col = table.columns.find((c) => c.name === colName)!;
        if (col.comment) {
          const qCol = quoteName(engine, col.name, col.exactName);
          commentLines.push(`COMMENT ON COLUMN ${qTable}.${qCol}`);
          commentLines.push(`  IS '${escapeSqlString(col.comment)}';`);
          statements++;
        }
      }
      for (const cc of changes.changedColumns) {
        if (!cc.comment) continue;
        const col = table.columns.find((c) => c.name === cc.name)!;
        const qCol = quoteName(engine, col.name, col.exactName);
        if (col.comment) {
          commentLines.push(`COMMENT ON COLUMN ${qTable}.${qCol}`);
          commentLines.push(`  IS '${escapeSqlString(col.comment)}';`);
        } else {
          commentLines.push(`COMMENT ON COLUMN ${qTable}.${qCol}`);
          commentLines.push("  IS NULL;");
        }
        statements++;
      }
    }
    for (const table of newOrder) {
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
    pushBlock(commentLines);
  }

  return { blocks, statements, relativeLineOf };
}

export function generateChangesDdl(model: BuildModel, context: DdlContext): DdlResult {
  const engine = model.engine;
  const rules = engineRules[engine];
  const baseLabel = context.baseLabel ?? model.base?.database ?? "a base";
  const readAtPart = model.base?.readAt ? `, lida em ${model.base.readAt}` : "";

  const { blocks, statements, relativeLineOf } = buildChangesBody(model, null);

  const headerLines = [
    `-- Modelo ${context.modelName} · ${rules.label} · gerado pelo Prism ${context.prismVersion} em ${context.generatedAt}`,
    `-- Só as diferenças em relação a ${baseLabel}${readAtPart}.`,
  ];

  if (statements === 0) {
    const lines = [...headerLines, "", `-- Nada mudou em relação a ${baseLabel}.`];
    return {
      text: lines.join("\n"),
      statements: 0,
      lineOf: {},
    };
  }

  const unchangedExisting = model.tables
    .filter((t) => t.origin !== null && !t.dropInDatabase && tableChanges(engine, t).kind === "same")
    .sort((a, b) => tableKey(a).localeCompare(tableKey(b)))
    .map((t) => qualifiedName(engine, t.schema, t.name, t.exactName));

  if (unchangedExisting.length > 0) {
    headerLines.push(
      `-- Sem mudança, e por isso fora daqui: ${formatPortugueseList(unchangedExisting)}.`,
    );
  }

  const lines: string[] = [...headerLines];
  const blockStartLine: number[] = [];

  for (const block of blocks) {
    lines.push("");
    blockStartLine.push(lines.length);
    for (const l of block) {
      lines.push(l);
    }
  }

  const lineOf: Record<string, number> = {};
  for (const [key, pos] of Object.entries(relativeLineOf)) {
    const start = blockStartLine[pos.blockIndex];
    if (start !== undefined) {
      lineOf[key] = start + pos.lineInBlock;
    }
  }

  return {
    text: lines.join("\n"),
    statements,
    lineOf,
  };
}

export function tableChangesDdl(model: BuildModel, key: string, _context: DdlContext): string {
  const { blocks } = buildChangesBody(model, key);
  return blocks.map((block) => block.join("\n")).join("\n");
}

export function generateDdl(model: BuildModel, context: DdlContext): DdlResult {
  if (model.base !== null && model.ddl.scope === "changes") {
    return generateChangesDdl(model, context);
  }
  return generateFullDdl(model, context);
}
