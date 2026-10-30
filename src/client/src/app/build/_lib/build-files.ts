import { engineRules } from "./build-engines";
import { emptyModel } from "./build-model";
import { buildEngines, type BuildEngine, type BuildModel } from "./build-model.schema";
import { readDbml } from "./dbml";
import { readModelSql } from "./sql-model";
import { applyTextRead, type TextError } from "./text-merge";

export function needsScopeQuestion(model: BuildModel): boolean {
  return model.base !== null && model.ddl.scope === null;
}

export function fileNameOf(modelName: string, kind: "dbml" | "sql" | "png"): string {
  const safeName = modelName.trim().replace(/[\\/:*?"<>|]+/g, "_") || "modelo";
  return `${safeName}.${kind}`;
}

function detectDbmlEngine(text: string): BuildEngine | null {
  const projectMatch = /Project(?:\s+[^\s{]+)?\s*\{([\s\S]*?)\}/i.exec(text);
  if (!projectMatch) return null;
  const body = projectMatch[1] ?? "";
  const dbTypeMatch = /database_type\s*:\s*(['"])(.*?)\1/i.exec(body);
  if (!dbTypeMatch) return null;
  const raw = (dbTypeMatch[2] ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (raw === "postgresql" || raw === "postgres") return "postgresql";
  for (const engine of buildEngines) {
    if (raw === engine) return engine;
  }
  return null;
}

function stripExtension(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const stripped = baseName.replace(/\.(dbml|sql)$/i, "").trim();
  return stripped || "modelo";
}

export function defaultSchemaForEngine(engine: BuildEngine): string {
  if (!engineRules[engine].hasSchemas) return "";
  if (engineRules[engine].fold === "upper") return "PUBLIC";
  return "public";
}

export function modelFromFile(
  fileName: string,
  text: string,
  engine: BuildEngine | null,
):
  | { ok: true; name: string; model: BuildModel }
  | { ok: false; error: TextError }
  | { ok: false; needsEngine: true } {
  const isDbml = /\.dbml$/i.test(fileName.trim());
  const resolvedEngine = engine ?? (isDbml ? detectDbmlEngine(text) : null);

  if (!resolvedEngine) {
    return { ok: false, needsEngine: true };
  }

  const baseModel = emptyModel(resolvedEngine, defaultSchemaForEngine(resolvedEngine));
  const read = isDbml ? readDbml(text, baseModel) : readModelSql(text, baseModel);

  if (!read.ok) {
    return { ok: false, error: read.error };
  }

  let model = applyTextRead(baseModel, read);
  if (
    engineRules[resolvedEngine].hasSchemas &&
    model.tables.length > 0 &&
    !model.tables.some((t) => t.schema === model.defaultSchema)
  ) {
    const firstSchema = model.tables[0]?.schema ?? model.defaultSchema;
    model = {
      ...model,
      defaultSchema: firstSchema,
    };
  }

  return {
    ok: true,
    name: stripExtension(fileName),
    model,
  };
}
