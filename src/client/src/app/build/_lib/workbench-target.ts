import type { BuildEngine, BuildModel } from "./build-model.schema";

export function workbenchTarget(
  model: BuildModel,
):
  | { kind: "base"; connectionId: string; database: string | null }
  | { kind: "ask"; engine: BuildEngine; baseConnectionId: string | null } {
  if (model.base !== null && (model.ddl.scope ?? "changes") === "changes") {
    return {
      kind: "base",
      connectionId: model.base.connectionId,
      database: model.base.database,
    };
  }
  return {
    kind: "ask",
    engine: model.engine,
    baseConnectionId: model.base?.connectionId ?? null,
  };
}
