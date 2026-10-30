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

export function createTextSyncController(
  initialModel: BuildModel,
  initialFormat: "sql" | "dbml",
): {
  initialDoc(): string;
  receiveProps(
    nextModel: BuildModel,
    nextFormat: "sql" | "dbml",
  ): { shouldReplaceDoc: boolean; nextDoc: string };
  applyEditorText(editorText: string): {
    model: BuildModel | null;
    status: TextStatus;
  };
} {
  let currentModel = initialModel;
  let currentFormat = initialFormat;
  let lastAppliedModel = initialModel;

  return {
    initialDoc() {
      return printText(currentModel, currentFormat);
    },
    receiveProps(nextModel, nextFormat) {
      if (nextFormat !== currentFormat || nextModel !== lastAppliedModel) {
        currentModel = nextModel;
        currentFormat = nextFormat;
        lastAppliedModel = nextModel;
        return {
          shouldReplaceDoc: true,
          nextDoc: printText(nextModel, nextFormat),
        };
      }
      currentModel = nextModel;
      return { shouldReplaceDoc: false, nextDoc: "" };
    },
    applyEditorText(editorText) {
      const res = applyText(currentModel, currentFormat, editorText);
      if (res.model !== null && res.status.kind === "applied") {
        currentModel = res.model;
        lastAppliedModel = res.model;
      }
      return res;
    },
  };
}


