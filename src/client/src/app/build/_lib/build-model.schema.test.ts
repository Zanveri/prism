import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildEngineOf,
  buildEngines,
  engineIdOf,
  parseModelBody,
  serializeModel,
  type BuildModel,
} from "./build-model.schema";

const repositoryRoot = new URL("../../../../../../", import.meta.url);
const canvasModel = JSON.parse(
  readFileSync(new URL("src/test-fixtures/build/models/manutencao.json", repositoryRoot), "utf8"),
) as BuildModel;

describe("build-model.schema (RN-CONSTRUIR-010)", () => {
  it("lê o modelo do canvas e recusa versão desconhecida", () => {
    expect(parseModelBody(serializeModel(canvasModel))).toEqual(canvasModel);
    expect(parseModelBody(JSON.stringify({ ...canvasModel, version: 2 }))).toBeNull();
    expect(parseModelBody("não é json")).toBeNull();
  });

  it("motor do Prism ↔ destino", () => {
    expect(buildEngines.map(engineIdOf)).toEqual([1, 2, 3]);
    expect(buildEngineOf(1)).toBe("postgresql");
    expect(buildEngineOf(2)).toBe("db2");
    expect(buildEngineOf(3)).toBe("informix");
    expect(buildEngineOf(4)).toBeNull();
  });
});
