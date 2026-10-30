import { describe, expect, it } from "vitest";
import type { BuildModel } from "@/app/build/_lib/build-model.schema";
import { fixture } from "@/app/build/_lib/fixtures";
import { footerCountsLabel, modelSummary } from "@/app/build/_lib/model-summary";

describe("model-summary", () => {
  it("resume o modelo do canvas com '3 novas · 3 existentes, 1 alterada'", () => {
    const manutencao = fixture<BuildModel>("build/models/manutencao.json");
    const summary = modelSummary(manutencao, (id) =>
      id === "0199c3a0-0000-7000-8000-000000000010" ? "MES Produção" : null,
    );

    expect(summary).toEqual({
      newTables: 3,
      existing: 3,
      changed: 1,
      start: "MES Produção / mes · producao",
      label: "3 novas · 3 existentes, 1 alterada",
    });

    expect(footerCountsLabel(manutencao)).toBe(
      "3 novas · 3 existentes, 1 alterada · 6 relações · 2 índices",
    );
  });
});
