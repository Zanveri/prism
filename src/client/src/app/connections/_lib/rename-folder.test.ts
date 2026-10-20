import { describe, expect, it } from "vitest";

import type { ApiError } from "@/lib/api/prism-api";

import { connectionsCopy } from "./connections.copy";
import { editFolderSchema, renameFolderSchema, unprotected, type Folder } from "./connections.schema";
import { folderInputOf } from "./folder-input";
import { renamedFolderInput, renameFolderRefusalFields } from "./rename-folder";

const now = "2026-10-15T12:00:00Z";
const fabrica: Folder = { id: "f1", parentID: "raiz", name: "Fábrica", environmentName: "Produção", environmentColor: "#FF8A7A", color: "#7DB2FF", confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };

const refusal = (code: string, errors: Record<string, string[]> | null = null): ApiError => ({ status: code === "FOLDER_ALREADY_EXISTS" ? 409 : 422, code, title: `Título de ${code}`, detail: null, errors, extensions: {} });

describe("renamedFolderInput: o Renomear da pasta (F2, RN-NAV-009)", () => {
  it("leva a pasta como está, na mesma pasta pai, com a cor e o ambiente dela, só com o nome novo", () => {
    expect(renamedFolderInput(fabrica, "Fábrica Sul")).toEqual({ name: "Fábrica Sul", parentID: "raiz", color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false });
  });

  it("renomear não tira as proteções da pasta (RN-PROT-003): sem elas a API voltaria a confirmação a “Não” e pediria a senha do somente leitura", () => {
    const protegida: Folder = { ...fabrica, confirmCommands: "irreversible", readOnly: true, protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "irreversible", confirmCommandsFolderID: null } };

    expect(renamedFolderInput(protegida, "Fábrica Sul")).toMatchObject({ name: "Fábrica Sul", confirmCommands: "irreversible", readOnly: true });
  });

  it("é o mesmo pedido que o Editar pasta… mandaria mudando só o nome (o mesmo PATCH, que grava a pasta por inteiro)", () => {
    const fromEdit = editFolderSchema.parse({ name: "Fábrica Sul", color: "#7DB2FF", environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: "none", readOnly: "false" });

    expect(renamedFolderInput(fabrica, "Fábrica Sul")).toEqual(folderInputOf(fabrica, fromEdit));
  });
});

describe("renameFolderSchema: o campo do diálogo, com a regra do nome da pasta (RN-PASTA-001)", () => {
  it("apara as pontas e pergunta só o nome", () => {
    expect(renameFolderSchema.parse({ name: "  Fábrica Sul  ", color: "#000000" })).toEqual({ name: "Fábrica Sul" });
  });

  it("vazio e mais de 60 caracteres são recusados, com as frases da nova pasta", () => {
    expect(renameFolderSchema.safeParse({ name: "   " }).error?.issues[0]?.message).toBe("Informe o nome da pasta.");
    expect(renameFolderSchema.safeParse({ name: "a".repeat(61) }).error?.issues[0]?.message).toBe("O nome pode ter no máximo 60 caracteres.");
    expect(renameFolderSchema.safeParse({ name: "a".repeat(60) }).success).toBe(true);
  });
});

describe("renameFolderRefusalFields: as recusas do nome ficam no próprio diálogo (RN-NAV-009)", () => {
  it("nome repetido entre as irmãs (RN-PASTA-002) vai ao campo do nome", () => {
    expect(renameFolderRefusalFields(refusal("FOLDER_ALREADY_EXISTS"))).toEqual({ name: connectionsCopy.folder.rename.nameTaken });
  });

  it("nome inválido vai ao campo do nome, com a mensagem da API", () => {
    expect(renameFolderRefusalFields(refusal("FOLDER_NAME_INVALID", { name: ["O nome da pasta deve ter de 1 a 60 caracteres."] }))).toEqual({ name: "O nome da pasta deve ter de 1 a 60 caracteres." });
  });

  it("o 422 de outro campo volta com o campo dele, que o diálogo não mostra (quem chama avisa pelo título)", () => {
    expect(renameFolderRefusalFields(refusal("FOLDER_NAME_INVALID", { color: ["Use uma cor no formato #RRGGBB."] }))).toEqual({ color: "Use uma cor no formato #RRGGBB." });
  });

  it("sem campo na recusa, o título vai ao campo do nome", () => {
    expect(renameFolderRefusalFields(refusal("FOLDER_NAME_INVALID"))).toEqual({ name: "Título de FOLDER_NAME_INVALID" });
  });
});
