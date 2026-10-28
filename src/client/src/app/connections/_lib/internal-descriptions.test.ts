import { describe, expect, it } from "vitest";

import { unprotected, type Connection, type Folder } from "./connections.schema";
import { inheritedInternalDescriptionsFolder, usesInternalDescriptions } from "./internal-descriptions";

const now = "2026-10-28T12:00:00Z";

function makeFolder(overrides: Partial<Folder> & { id: string; name: string }): Folder {
  return {
    parentID: null,
    environmentName: null,
    environmentColor: null,
    color: null,
    confirmCommands: null,
    readOnly: false,
    useInternalDescriptions: false,
    protections: unprotected,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeConnection(overrides: Partial<Connection> & { id: string; name: string }): Connection {
  return {
    folderID: null,
    engine: 3,
    host: "informix-srv",
    port: 9089,
    database: "sitdb",
    userName: "informix",
    hasPassword: true,
    environmentName: null,
    environmentColor: null,
    confirmCommands: null,
    readOnly: false,
    verificationEnabled: true,
    verificationInterval: 30,
    verificationQuery: null,
    useInternalDescriptions: null,
    protections: unprotected,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Utilizar descrições internas (herança da pasta e sobrescrita na conexão)", () => {
  const rootFolder = makeFolder({ id: "00000000-0000-4000-8000-000000000001", name: "Corporativo", useInternalDescriptions: true });
  const subFolder = makeFolder({ id: "00000000-0000-4000-8000-000000000002", name: "Produção", parentID: rootFolder.id, useInternalDescriptions: false });
  const otherFolder = makeFolder({ id: "00000000-0000-4000-8000-000000000003", name: "Externo", useInternalDescriptions: false });
  const folders = [rootFolder, subFolder, otherFolder];

  it("herda 'Utilizar descrições internas' marcado por padrão quando a pasta ou pasta ancestral está marcada", () => {
    expect(inheritedInternalDescriptionsFolder(folders, rootFolder.id)?.id).toBe(rootFolder.id);
    expect(inheritedInternalDescriptionsFolder(folders, subFolder.id)?.id).toBe(rootFolder.id);
    expect(inheritedInternalDescriptionsFolder(folders, otherFolder.id)).toBeNull();

    const connInSubfolder = makeConnection({ id: "00000000-0000-4000-8000-000000000010", name: "SIT Prod", folderID: subFolder.id, useInternalDescriptions: null });
    expect(usesInternalDescriptions(connInSubfolder, folders)).toBe(true);
  });

  it("permite desmarcar individualmente em uma conexão mesmo dentro de uma pasta marcada", () => {
    const connUnchecked = makeConnection({
      id: "00000000-0000-4000-8000-000000000011",
      name: "SIT Sem Descrições",
      folderID: rootFolder.id,
      useInternalDescriptions: false,
    });

    expect(usesInternalDescriptions(connUnchecked, folders)).toBe(false);
  });

  it("permite marcar individualmente uma conexão fora de pasta ou em pasta desmarcada", () => {
    const connChecked = makeConnection({
      id: "00000000-0000-4000-8000-000000000012",
      name: "Conexão Avulsa",
      folderID: otherFolder.id,
      useInternalDescriptions: true,
    });

    expect(usesInternalDescriptions(connChecked, folders)).toBe(true);
  });
});
