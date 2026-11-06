import { readdirSync, readFileSync } from "node:fs";

import { type BuildModel, parseModelBody } from "./build-model.schema";

const repositoryRoot = new URL("../../../../../../", import.meta.url);

export function fixture<T = unknown>(relativePath: string): T {
  const raw = readFileSync(new URL(`src/test-fixtures/${relativePath}`, repositoryRoot), "utf8");
  return JSON.parse(raw) as T;
}

export function readFixtures<T = unknown>(relativeDir: string): [string, T][] {
  const dirUrl = new URL(`src/test-fixtures/${relativeDir}/`, repositoryRoot);
  const files = readdirSync(dirUrl)
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
  return files.map((file) => {
    const raw = readFileSync(new URL(file, dirUrl), "utf8");
    return [file.replace(/\.json$/, ""), JSON.parse(raw) as T];
  });
}

export function readCanvasModel(): BuildModel {
  const raw = readFileSync(
    new URL("src/test-fixtures/build/models/manutencao.json", repositoryRoot),
    "utf8",
  );
  const parsed = parseModelBody(raw);
  if (!parsed) {
    throw new Error("Invalid canvas model fixture");
  }
  return parsed;
}
