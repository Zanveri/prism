import { describe, expect, it } from "vitest";
import { emptyModel } from "./build-model";
import { readCanvasModel } from "./fixtures";
import { workbenchTarget } from "./workbench-target";

describe("workbenchTarget", () => {
  it("com base e scope 'changes' devolve kind: 'base' com a conexão e o banco da base", () => {
    const model = {
      ...readCanvasModel(),
      ddl: { ...readCanvasModel().ddl, scope: "changes" as const },
    };

    expect(workbenchTarget(model)).toEqual({
      kind: "base",
      connectionId: "0199c3a0-0000-7000-8000-000000000010",
      database: "mes",
    });
  });

  it("com base e scope 'full' devolve kind: 'ask' com baseConnectionId da base", () => {
    const model = {
      ...readCanvasModel(),
      ddl: { ...readCanvasModel().ddl, scope: "full" as const },
    };

    expect(workbenchTarget(model)).toEqual({
      kind: "ask",
      engine: "postgresql",
      baseConnectionId: "0199c3a0-0000-7000-8000-000000000010",
    });
  });

  it("sem base devolve kind: 'ask' com baseConnectionId nulo", () => {
    const model = emptyModel("db2", "PUBLIC");

    expect(workbenchTarget(model)).toEqual({
      kind: "ask",
      engine: "db2",
      baseConnectionId: null,
    });
  });
});
