import { describe, expect, it } from "vitest";

import { editConnectionSchema, newVerification, unprotected, verificationOf, type Connection } from "./connections.schema";
import { movedConnectionInput } from "./move-connection";

const now = "2026-10-12T12:00:00Z";
const mes: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", hasPassword: true, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };

// RN-PROT-001, 002 e RN-VERIF-001: a conexão com as proteções próprias e a verificação fora do padrão.
const protegida: Connection = { ...mes, confirmCommands: "irreversible", readOnly: true, verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1", protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: "f1" } };

describe("movedConnectionInput: mover uma conexão de pasta pelo navegador (RN-NAV-003)", () => {
  it("leva a conexão como está, só com a pasta nova, e a senha nula (a API mantém a gravada, RN-CONN-004)", () => {
    expect(movedConnectionInput(mes, "f2")).toEqual({ name: "MES Produção", folderID: "f2", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", password: null, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false, ...newVerification });
  });

  it("leva as proteções próprias e a verificação como estão (RN-PROT-003, RN-VERIF-001): o PATCH grava por inteiro, e sem elas voltariam ao padrão", () => {
    expect(movedConnectionInput(protegida, "f2")).toMatchObject({ folderID: "f2", confirmCommands: "irreversible", readOnly: true, verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1" });
  });

  it("a confirmação herdada da pasta (`protections`) não vai como própria: ela muda com a pasta de destino (RN-PROT-004)", () => {
    expect(movedConnectionInput(protegida, null).confirmCommands).toBe("irreversible");
    expect(movedConnectionInput(protegida, null)).not.toHaveProperty("protections");
  });

  it("para a raiz, a pasta é nula", () => {
    expect(movedConnectionInput(mes, null).folderID).toBeNull();
  });

  it("é o mesmo pedido que o formulário mandaria sem mexer em nada além da pasta (o mesmo PATCH, que leva tudo por inteiro)", () => {
    // O formulário manda as proteções próprias pelos campos escondidos, e a verificação como a conexão a tem (o `readForm` do diálogo).
    const fromForm = { ...editConnectionSchema.parse({ engine: "3", name: protegida.name, folderID: "f2", host: protegida.host, port: String(protegida.port), database: protegida.database, userName: protegida.userName, password: "", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "irreversible", readOnly: "true" }), ...verificationOf(protegida) };

    expect(movedConnectionInput(protegida, "f2")).toEqual(fromForm);
  });
});
