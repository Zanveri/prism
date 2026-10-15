import { describe, expect, it } from "vitest";

import type { Folder } from "./connections.schema";
import { folderInputOf } from "./folder-input";

const now = "2026-10-13T12:00:00Z";
const producao: Folder = { id: "f1", parentID: "raiz", name: "Produção", environmentName: "Produção", environmentColor: "#FF8A7A", color: "#7DB2FF", createdAt: now, updatedAt: now };

describe("o corpo que os diálogos de pasta mandam (RN-PASTA-001 a 007)", () => {
  it("criar manda o que o formulário perguntou, e o que ele não perguntou vai vazio", () => {
    expect(folderInputOf(null, { name: "QAS", parentID: null, color: "#B79CFF", environmentName: "QAS", environmentColor: "#F2B644" })).toEqual({ name: "QAS", parentID: null, color: "#B79CFF", environmentName: "QAS", environmentColor: "#F2B644" });
    expect(folderInputOf(null, { name: "QAS" })).toEqual({ name: "QAS", parentID: null, color: null, environmentName: null, environmentColor: null });
  });

  it("editar (Editar pasta…, RN-PASTA-006) troca o nome, a cor e o ambiente, e a pasta fica onde está", () => {
    expect(folderInputOf(producao, { name: "Produção Sul", color: null, environmentName: null, environmentColor: null })).toEqual({ name: "Produção Sul", parentID: "raiz", color: null, environmentName: null, environmentColor: null });
  });

  it("pôr só o ambiente numa pasta que já existia: o PATCH leva o nome, a pasta pai e a cor como estavam, e o ambiente novo", () => {
    const desenvolvimento: Folder = { ...producao, name: "Desenvolvimento", environmentName: null, environmentColor: null };

    expect(folderInputOf(desenvolvimento, { name: "Desenvolvimento", color: "#7DB2FF", environmentName: "Develop", environmentColor: "#5ED3A3" })).toEqual({ name: "Desenvolvimento", parentID: "raiz", color: "#7DB2FF", environmentName: "Develop", environmentColor: "#5ED3A3" });
  });

  it("renomear (F2, RN-NAV-009) muda só o nome: a cor e o ambiente vão como estavam", () => {
    expect(folderInputOf(producao, { name: "Produção Norte" })).toEqual({ name: "Produção Norte", parentID: "raiz", color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A" });
  });

  it("mover muda só a pasta pai: o PATCH grava a pasta por inteiro, e a cor e o ambiente dela vão juntos, como estavam", () => {
    expect(folderInputOf(producao, { parentID: null })).toEqual({ name: "Produção", parentID: null, color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A" });
  });
});
