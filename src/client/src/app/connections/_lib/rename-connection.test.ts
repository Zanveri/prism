import { describe, expect, it } from "vitest";

import type { ApiError } from "@/lib/api/prism-api";

import { connectionsCopy } from "./connections.copy";
import { editConnectionSchema, newVerification, renameConnectionSchema, unprotected, type Connection } from "./connections.schema";
import { renamedConnectionInput, renameRefusalFields } from "./rename-connection";

const now = "2026-10-13T12:00:00Z";
const mes: Connection = { id: "c1", folderID: "f1", name: "MES Produção", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", hasPassword: true, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };

const refusal = (code: string, errors: Record<string, string[]> | null = null): ApiError => ({ status: code === "CONNECTION_ALREADY_EXISTS" ? 409 : 422, code, title: `Título de ${code}`, detail: null, errors, extensions: {} });

// RN-PROT-001, 002 e RN-VERIF-001: a conexão com as proteções próprias e a verificação fora do padrão.
const protegida: Connection = { ...mes, confirmCommands: "all", readOnly: true, verificationEnabled: true, verificationInterval: 5, verificationQuery: "SELECT 1", protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: null } };

describe("renamedConnectionInput: renomear uma conexão pelo navegador (RN-NAV-009)", () => {
  it("leva a conexão como está, na mesma pasta, só com o nome novo, e a senha nula (a API mantém a gravada, RN-CONN-004)", () => {
    expect(renamedConnectionInput(mes, "MES Novo")).toEqual({ name: "MES Novo", folderID: "f1", engine: 3, host: "srv-ifx", port: 9089, database: "mes", userName: "informix", password: null, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false, ...newVerification });
  });

  it("renomear não tira as proteções nem muda a verificação (RN-PROT-003, RN-VERIF-001): sem elas a API pediria a senha e voltaria tudo ao padrão", () => {
    expect(renamedConnectionInput(protegida, "MES Novo")).toMatchObject({ name: "MES Novo", confirmCommands: "all", readOnly: true, verificationEnabled: true, verificationInterval: 5, verificationQuery: "SELECT 1" });
  });

  it("na raiz, a pasta continua nula", () => {
    expect(renamedConnectionInput({ ...mes, folderID: null }, "MES Novo").folderID).toBeNull();
  });

  it("é o mesmo pedido que o formulário mandaria mudando só o nome (o mesmo PATCH, que leva tudo por inteiro)", () => {
    // A sessão da conexão (RN-VERIF-001) vai pelo painel dela, que nasce com a gravada.
    const sessionFields = { verificationEnabled: String(protegida.verificationEnabled), verificationInterval: String(protegida.verificationInterval), verificationQuery: protegida.verificationQuery ?? "" };
    const fromForm = { ...editConnectionSchema.parse({ engine: "3", name: "MES Novo", folderID: "f1", host: protegida.host, port: String(protegida.port), database: protegida.database, userName: protegida.userName, password: "", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "all", readOnly: "true", ...sessionFields }) };

    expect(renamedConnectionInput(protegida, "MES Novo")).toEqual(fromForm);
  });
});

describe("renameConnectionSchema: o campo do diálogo, com a regra do nome do formulário (RN-CONN-010)", () => {
  it("apara as pontas", () => {
    expect(renameConnectionSchema.parse({ name: "  MES Novo  " })).toEqual({ name: "MES Novo" });
  });

  it("vazio e mais de 80 caracteres são recusados, com as frases do formulário", () => {
    expect(renameConnectionSchema.safeParse({ name: "   " }).error?.issues[0]?.message).toBe("Informe o nome da conexão.");
    expect(renameConnectionSchema.safeParse({ name: "a".repeat(81) }).error?.issues[0]?.message).toBe("O nome pode ter no máximo 80 caracteres.");
    expect(renameConnectionSchema.safeParse({ name: "a".repeat(80) }).success).toBe(true);
  });
});

describe("renameRefusalFields: as recusas do nome ficam no próprio diálogo (RN-NAV-009)", () => {
  it("nome repetido na pasta (RN-CONN-011) vai ao campo do nome", () => {
    expect(renameRefusalFields(refusal("CONNECTION_ALREADY_EXISTS"))).toEqual({ name: connectionsCopy.rename.nameTaken });
  });

  it("nome inválido vai ao campo do nome, com a mensagem da API", () => {
    expect(renameRefusalFields(refusal("CONNECTION_INVALID", { name: ["O nome pode ter no máximo 80 caracteres."] }))).toEqual({ name: "O nome pode ter no máximo 80 caracteres." });
  });

  it("um 422 de outro campo volta com o campo dele (o diálogo não o mostra e avisa pelo título)", () => {
    expect(renameRefusalFields(refusal("CONNECTION_INVALID", { password: ["Ao mudar o host ou a porta, informe a senha da conexão de novo."] }))).toEqual({ password: "Ao mudar o host ou a porta, informe a senha da conexão de novo." });
  });

  it("um 422 sem campos vai ao campo do nome, com o título", () => {
    expect(renameRefusalFields(refusal("CONNECTION_INVALID"))).toEqual({ name: "Título de CONNECTION_INVALID" });
  });
});
