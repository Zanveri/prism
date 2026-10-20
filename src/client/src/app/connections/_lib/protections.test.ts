import { describe, expect, it } from "vitest";

import { unprotected, type Folder } from "./connections.schema";
import { confirmationChoiceOf, confirmationRank, inheritedProtections, shownProtections, strongerConfirmation } from "./protections";

const now = "2026-10-15T12:00:00Z";
const folder = (id: string, parentID: string | null, over: Partial<Folder> = {}): Folder => ({ id, parentID, name: `Pasta ${id}`, environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now, ...over });

// A Fábrica é somente leitura e confirma os irreversíveis; a Linha 1, dentro dela, pede todos os comandos; a Linha 2, dentro da Linha 1, não marca nada.
const fabrica = folder("f1", null, { name: "Fábrica", readOnly: true, confirmCommands: "irreversible", protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "irreversible", confirmCommandsFolderID: null } });
const linha1 = folder("f2", "f1", { name: "Linha 1", confirmCommands: "all", protections: { readOnly: true, readOnlyFolderID: "f1", confirmCommands: "all", confirmCommandsFolderID: null } });
const linha2 = folder("f3", "f2", { name: "Linha 2", protections: { readOnly: true, readOnlyFolderID: "f1", confirmCommands: "all", confirmCommandsFolderID: "f2" } });
const livre = folder("f4", null, { name: "Livre" });
const folders = [fabrica, linha1, linha2, livre];

describe("a força da confirmação (RN-PROT-004)", () => {
  it("“Todos os comandos”, depois “Só comandos irreversíveis”, depois “Não”", () => {
    expect([confirmationRank("all"), confirmationRank("irreversible"), confirmationRank("none"), confirmationRank(null)]).toEqual([2, 1, 0, 0]);
    expect(strongerConfirmation("irreversible", "all")).toBe("all");
    expect(strongerConfirmation("all", null)).toBe("all");
    expect(strongerConfirmation(null, null)).toBeNull();
  });

  it("a escolha do formulário para a confirmação gravada: nula é “Não”", () => {
    expect([confirmationChoiceOf(null), confirmationChoiceOf("irreversible"), confirmationChoiceOf("all")]).toEqual(["none", "irreversible", "all"]);
  });
});

describe("inheritedProtections: o que se herda dentro de uma pasta (RN-PROT-004)", () => {
  it("na raiz e numa pasta sem proteção, nada", () => {
    expect(inheritedProtections(folders, null)).toEqual({ readOnly: null, confirm: null });
    expect(inheritedProtections(folders, "f4")).toEqual({ readOnly: null, confirm: null });
  });

  it("a pasta que impõe as próprias passa as duas, com ela como origem", () => {
    expect(inheritedProtections(folders, "f1")).toEqual({ readOnly: fabrica, confirm: { level: "irreversible", folder: fabrica } });
  });

  it("a qualquer profundidade, cada proteção vem da pasta mais próxima que impõe o valor que vale (o que a API diz em `protections`)", () => {
    expect(inheritedProtections(folders, "f2")).toEqual({ readOnly: fabrica, confirm: { level: "all", folder: linha1 } });
    expect(inheritedProtections(folders, "f3")).toEqual({ readOnly: fabrica, confirm: { level: "all", folder: linha1 } });
  });

  it("a pasta que a lista não tem não passa nada adiante; a origem que sumiu fica a própria pasta, e a proteção continua valendo", () => {
    expect(inheritedProtections(folders, "nao-existe")).toEqual({ readOnly: null, confirm: null });
    expect(inheritedProtections([linha2], "f3")).toEqual({ readOnly: linha2, confirm: { level: "all", folder: linha2 } });
  });
});

describe("shownProtections: as que valem, com a pasta de onde vem cada uma (RN-PROT-002 e 004)", () => {
  it("a própria tem a origem nula; a herdada, a pasta; sem proteção, nada", () => {
    expect(shownProtections({ readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: null }, folders)).toEqual({ readOnly: { from: null }, confirm: { level: "all", from: null } });
    expect(shownProtections(linha2.protections, folders)).toEqual({ readOnly: { from: fabrica }, confirm: { level: "all", from: linha1 } });
    expect(shownProtections(unprotected, folders)).toEqual({ readOnly: null, confirm: null });
  });

  it("a pasta de origem que a lista não tem fica nula, e a proteção continua", () => {
    expect(shownProtections(linha2.protections, [])).toEqual({ readOnly: { from: null }, confirm: { level: "all", from: null } });
  });
});
