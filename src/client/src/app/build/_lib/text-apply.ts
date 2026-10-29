import type { BuildModel } from "./build-model.schema";
import { printDbml, readDbml } from "./dbml";
import { printModelSql, readModelSql } from "./sql-model";
import { applyTextRead, type TextError, type TextWarning } from "./text-merge";

export const textApplyDelayMs = 400;

export type TextStatus =
  | { kind: "applied"; warnings: TextWarning[] }
  | { kind: "error"; error: TextError };

export function printText(model: BuildModel, format: "sql" | "dbml"): string {
  return format === "dbml" ? printDbml(model) : printModelSql(model);
}

export function applyText(
  model: BuildModel,
  format: "sql" | "dbml",
  text: string,
): { model: BuildModel | null; status: TextStatus } {
  const result = format === "dbml" ? readDbml(text, model) : readModelSql(text, model);
  if (!result.ok) {
    return {
      model: null,
      status: { kind: "error", error: result.error },
    };
  }
  return {
    model: applyTextRead(model, result),
    status: { kind: "applied", warnings: result.warnings },
  };
}


