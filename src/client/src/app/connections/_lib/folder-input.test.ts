import { describe, expect, it } from "vitest";

import { unprotected, type Folder } from "./connections.schema";
import { folderInputOf } from "./folder-input";

const now = "2026-10-13T12:00:00Z";
const producao: Folder = { id: "f1", parentID: "raiz", name: "Produção", environmentName: "Produção", environmentColor: "#FF8A7A", color: "#7DB2FF", confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
// RN-PROT-001 e 002: a pasta com as duas proteções próprias marcadas.
const protegida: Folder = { ...producao, confirmCommands: "all", readOnly: true, protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: null } };
const noProtection = { confirmCommands: null, readOnly: false };

describe("o corpo que os diálogos de pasta mandam (RN-PASTA-001 a 007, RN-PROT-001 a 003)", () => {
  it("criar manda o que o formulário perguntou, e o que ele não perguntou vai vazio, sem proteção", () => {
    expect(folderInputOf(null, { name: "QAS", parentID: null, color: "#B79CFF", environmentName: "QAS", environmentColor: "#F2B644", confirmCommands: "irreversible", readOnly: true })).toEqual({ name: "QAS", parentID: null, color: "#B79CFF", environmentName: "QAS", environmentColor: "#F2B644", confirmCommands: "irreversible", readOnly: true });
    expect(folderInputOf(null, { name: "QAS" })).toEqual({ name: "QAS", parentID: null, color: null, environmentName: null, environmentColor: null, ...noProtection });
  });

  it("editar (Editar pasta…, RN-PASTA-006) troca o nome, a cor, o ambiente e as proteções, e a pasta fica onde está", () => {
    expect(folderInputOf(producao, { name: "Produção Sul", color: null, environmentName: null, environmentColor: null, confirmCommands: "all", readOnly: false })).toEqual({ name: "Produção Sul", parentID: "raiz", color: null, environmentName: null, environmentColor: null, confirmCommands: "all", readOnly: false });
  });

  it("pôr só o ambiente numa pasta que já existia: o PATCH leva o nome, a pasta pai e a cor como estavam, e o ambiente novo", () => {
    const desenvolvimento: Folder = { ...producao, name: "Desenvolvimento", environmentName: null, environmentColor: null };

    expect(folderInputOf(desenvolvimento, { name: "Desenvolvimento", color: "#7DB2FF", environmentName: "Develop", environmentColor: "#5ED3A3" })).toEqual({ name: "Desenvolvimento", parentID: "raiz", color: "#7DB2FF", environmentName: "Develop", environmentColor: "#5ED3A3", ...noProtection });
  });

  it("renomear (F2, RN-NAV-009) muda só o nome: a cor e o ambiente vão como estavam", () => {
    expect(folderInputOf(producao, { name: "Produção Norte" })).toEqual({ name: "Produção Norte", parentID: "raiz", color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A", ...noProtection });
  });

  it("mover muda só a pasta pai: o PATCH grava a pasta por inteiro, e a cor e o ambiente dela vão juntos, como estavam", () => {
    expect(folderInputOf(producao, { parentID: null })).toEqual({ name: "Produção", parentID: null, color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A", ...noProtection });
  });

  it("renomear e mover levam as proteções próprias como estavam: sem elas a API voltaria a confirmação a “Não” e tiraria o somente leitura (RN-PROT-003)", () => {
    expect(folderInputOf(protegida, { name: "Produção Norte" })).toMatchObject({ name: "Produção Norte", confirmCommands: "all", readOnly: true });
    expect(folderInputOf(protegida, { parentID: null })).toMatchObject({ parentID: null, confirmCommands: "all", readOnly: true });
  });

  it("as proteções que valem (`protections`, com as herdadas) não vão no corpo: a herdada não vira própria", () => {
    const herdeira: Folder = { ...producao, protections: { readOnly: true, readOnlyFolderID: "raiz", confirmCommands: "irreversible", confirmCommandsFolderID: "raiz" } };

    expect(folderInputOf(herdeira, { name: "Produção" })).toEqual({ name: "Produção", parentID: "raiz", color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A", ...noProtection });
  });
});
