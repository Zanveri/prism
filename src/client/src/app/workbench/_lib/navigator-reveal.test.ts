import { describe, expect, it } from "vitest";

import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

import { navKey } from "./navigator-model";
import { importArrived, importRevealOf, revealOf } from "./navigator-reveal";

const folders = [
  { id: "raiz", parentID: null },
  { id: "fabrica", parentID: "raiz" },
  { id: "extrusao", parentID: "fabrica" },
  { id: "outra", parentID: null },
];
const folderKey = (id: string) => navKey({ type: "folder", id });

describe("revealOf: o que a árvore abre para mostrar a conexão que acabou de ser salva (RN-NAV-004)", () => {
  it("a linha da conexão e as pastas acima dela, da mais próxima à raiz", () => {
    expect(revealOf({ id: "c1", folderID: "extrusao" }, folders)).toEqual({ key: navKey({ type: "connection", connectionId: "c1" }), folderKeys: [folderKey("extrusao"), folderKey("fabrica"), folderKey("raiz")] });
  });

  it("na raiz: nenhuma pasta", () => {
    expect(revealOf({ id: "c1", folderID: null }, folders).folderKeys).toEqual([]);
  });

  it("uma pasta que não existe mais acaba a subida (a árvore põe a conexão na raiz, `buildConnectionTree`)", () => {
    expect(revealOf({ id: "c1", folderID: "sumiu" }, folders).folderKeys).toEqual([]);
    expect(revealOf({ id: "c1", folderID: "x" }, [{ id: "x", parentID: "sumiu" }]).folderKeys).toEqual([folderKey("x")]);
  });

  it("pastas em ciclo (a API não deixa, RN-PASTA-003) não prendem a subida", () => {
    expect(revealOf({ id: "c1", folderID: "a" }, [{ id: "a", parentID: "b" }, { id: "b", parentID: "a" }]).folderKeys).toEqual([folderKey("a"), folderKey("b")]);
  });
});

describe("importRevealOf: o que a árvore mostra depois da importação (RN-TRANSF-014)", () => {
  const now = "2026-10-16T12:00:00Z";
  const folder = (id: string, parentID: string | null, name: string): Folder => ({ id, parentID, name, environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now });
  const connection = (id: string, folderID: string | null, name: string): Connection => ({
    id,
    folderID,
    name,
    engine: 3,
    host: "informix-prd.exemplo.invalid",
    port: 9089,
    database: "estoque",
    userName: "",
    hasPassword: false,
    environmentName: null,
    environmentColor: null,
    confirmCommands: null,
    readOnly: false,
    ...newVerification,
    protections: unprotected,
    createdAt: now,
    updatedAt: now,
  });

  // O lugar escolhido foi a pasta Sistemas; a pasta Estoque já existia nele e recebeu a Production PRD nova, com a DATA FIX e a NOMINAL dentro.
  const folders = [folder("sistemas", null, "Sistemas"), folder("estoque", "sistemas", "Estoque"), folder("prd", "estoque", "Production PRD"), folder("outra", null, "Outra")];
  const connections = [connection("antiga", "estoque", "Antiga"), connection("fix", "prd", "DATA FIX"), connection("nominal", "prd", "NOMINAL")];
  const imported = { folderIDs: ["prd"], connectionIDs: ["nominal", "fix"], targetFolderID: "sistemas" };

  it("abre as pastas até o que entrou e escolhe a primeira linha importada na ordem da árvore", () => {
    const plan = importRevealOf(imported, folders, connections);

    expect(plan.first).toBe(folderKey("prd"));
    expect(new Set(plan.folderKeys)).toEqual(new Set([folderKey("estoque"), folderKey("sistemas"), folderKey("prd")]));
    expect(plan.target).toBe(folderKey("sistemas"));
  });

  it("só conexões: a primeira pelo nome dentro da pasta; na raiz, sem pasta de destino", () => {
    const plan = importRevealOf({ folderIDs: [], connectionIDs: ["nominal", "fix"], targetFolderID: null }, folders, connections);

    expect(plan.first).toBe(navKey({ type: "connection", connectionId: "fix" }));
    expect(plan.target).toBeNull();
  });

  it("espera as listas trazerem tudo o que foi criado", () => {
    expect(importArrived(imported, folders, connections)).toBe(true);
    expect(importArrived(imported, folders, connections.slice(0, 2))).toBe(false);
    expect(importArrived(imported, folders.slice(0, 2), connections)).toBe(false);
  });
});
