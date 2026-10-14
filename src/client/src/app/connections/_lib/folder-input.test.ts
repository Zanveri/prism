import { describe, expect, it } from "vitest";

import type { Folder } from "./connections.schema";
import { folderInputOf } from "./folder-input";

const now = "2026-10-13T12:00:00Z";
const producao: Folder = { id: "f1", parentID: "raiz", name: "Produção", environmentName: "Produção", environmentColor: "#FF8A7A", createdAt: now, updatedAt: now };

describe("o corpo que o diálogo de pasta manda (RN-PASTA-001 a 005)", () => {
  it("criar manda o que o formulário perguntou, e o que ele não perguntou vai vazio", () => {
    expect(folderInputOf(null, { name: "QAS", parentID: null, environmentName: "QAS", environmentColor: "#F2B644" })).toEqual({ name: "QAS", parentID: null, environmentName: "QAS", environmentColor: "#F2B644" });
    expect(folderInputOf(null, { name: "QAS" })).toEqual({ name: "QAS", parentID: null, environmentName: null, environmentColor: null });
  });

  it("editar (Editar pasta…, também pelo F2, RN-PASTA-006) troca o nome e o ambiente, e a pasta fica onde está", () => {
    expect(folderInputOf(producao, { name: "Produção Sul", environmentName: null, environmentColor: null })).toEqual({ name: "Produção Sul", parentID: "raiz", environmentName: null, environmentColor: null });
  });

  it("pôr só o ambiente numa pasta que já existia: o PATCH leva o nome e a pasta pai como estavam, e o ambiente novo", () => {
    const desenvolvimento: Folder = { ...producao, name: "Desenvolvimento", environmentName: null, environmentColor: null };

    expect(folderInputOf(desenvolvimento, { name: "Desenvolvimento", environmentName: "Develop", environmentColor: "#5ED3A3" })).toEqual({ name: "Desenvolvimento", parentID: "raiz", environmentName: "Develop", environmentColor: "#5ED3A3" });
  });

  it("mover muda só a pasta pai: o PATCH grava a pasta por inteiro, e o ambiente dela vai junto, como estava", () => {
    expect(folderInputOf(producao, { parentID: null })).toEqual({ name: "Produção", parentID: null, environmentName: "Produção", environmentColor: "#FF8A7A" });
  });
});
