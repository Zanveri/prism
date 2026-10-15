import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectionSchema, createConnectionSchema, createFolderSchema, editConnectionSchema, engineOptions, folderSchema, moveFolderSchema, editFolderSchema, renameFolderSchema } from "./connections.schema";

const form = { engine: "1", name: "ERP", folderID: "", host: "srv-pg.exemplo.local", port: "5432", database: "erp", userName: "prism_leitura", password: "demonstracao", environmentName: "", environmentColor: "" };

/** As mensagens por campo da recusa, ou `{}` quando o schema aceitou. */
function fieldErrors(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  return result.success ? {} : z.flattenError(result.error as z.ZodError<Record<string, unknown>>).fieldErrors;
}

const saved = {
  id: "8d0c5a54-5b51-4a0f-9d3b-6f0f5b8a2d11",
  folderID: null,
  name: "ERP",
  engine: 3,
  host: "srv-ifx.exemplo.local",
  port: 9089,
  database: "erp",
  userName: "prism_leitura",
  hasPassword: true,
  environmentName: "Produção",
  environmentColor: "#FF8A7A",
  createdAt: "2026-10-09T12:00:00Z",
  updatedAt: "2026-10-09T12:00:00Z",
};

describe("engineOptions (RN-CONN-012)", () => {
  it("traz o rótulo, a etiqueta e a porta sugerida de cada banco", () => {
    expect(engineOptions.map(({ value, label, tag, defaultPort }) => [value, label, tag, defaultPort])).toEqual([
      [1, "PostgreSQL", "PG", 5432],
      [2, "Db2", "DB2", 50000],
      [3, "Informix", "IFX", 9089],
    ]);
  });
});

describe("createConnectionSchema (RN-CONN-010)", () => {
  it("aceita um formulário válido e entrega a porta e o banco como número", () => {
    const result = createConnectionSchema.safeParse(form);

    expect(result.success && result.data).toEqual({ engine: 1, name: "ERP", folderID: null, host: "srv-pg.exemplo.local", port: 5432, database: "erp", userName: "prism_leitura", password: "demonstracao", environmentName: null, environmentColor: null });
  });

  it.each(["0", "65536", "-1", "12.5", "abc", ""])("recusa a porta %j, no campo da porta", (port) => {
    expect(fieldErrors(createConnectionSchema, { ...form, port })).toHaveProperty("port");
  });

  it.each(["1", "65535", "5432"])("aceita a porta %j", (port) => {
    expect(createConnectionSchema.safeParse({ ...form, port }).success).toBe(true);
  });

  it.each(["#12345", "#12345G", "FF8A7A", "red", "#FF8A7A00"])("recusa a cor %j", (environmentColor) => {
    expect(fieldErrors(createConnectionSchema, { ...form, environmentColor })).toHaveProperty("environmentColor");
  });

  it("aceita a cor #RRGGBB e apara o nome do ambiente", () => {
    const result = createConnectionSchema.safeParse({ ...form, environmentName: " Produção ", environmentColor: "#FF8A7A" });

    expect(result.success && [result.data.environmentName, result.data.environmentColor]).toEqual(["Produção", "#FF8A7A"]);
  });

  it("recusa o nome do ambiente com 31 caracteres e o nome da conexão vazio ou com 81", () => {
    expect(fieldErrors(createConnectionSchema, { ...form, environmentName: "a".repeat(31) })).toHaveProperty("environmentName");
    expect(fieldErrors(createConnectionSchema, { ...form, name: "   " })).toHaveProperty("name");
    expect(fieldErrors(createConnectionSchema, { ...form, name: "a".repeat(81) })).toHaveProperty("name");
  });

  it("recusa host, banco e usuário vazios, cada um no seu campo", () => {
    expect(Object.keys(fieldErrors(createConnectionSchema, { ...form, host: "", database: " ", userName: "" }))).toEqual(["host", "database", "userName"]);
  });

  it("recusa banco fora de 1, 2 e 3", () => {
    expect(fieldErrors(createConnectionSchema, { ...form, engine: "4" })).toHaveProperty("engine");
    expect(fieldErrors(createConnectionSchema, { ...form, engine: "0" })).toHaveProperty("engine");
  });

  it("recusa senha vazia na criação", () => {
    expect(fieldErrors(createConnectionSchema, { ...form, password: "" })).toHaveProperty("password");
  });

  it("a senha não é aparada: espaço nas pontas faz parte dela", () => {
    const result = createConnectionSchema.safeParse({ ...form, password: " com espaço " });

    expect(result.success && result.data.password).toBe(" com espaço ");
  });
});

describe("editConnectionSchema (RN-CONN-004)", () => {
  it("aceita senha vazia e a entrega como nula, para a API manter a gravada", () => {
    const result = editConnectionSchema.safeParse({ ...form, password: "" });

    expect(result.success && result.data.password).toBeNull();
  });

  it("entrega a senha nova quando ela foi digitada", () => {
    const result = editConnectionSchema.safeParse({ ...form, password: "outra" });

    expect(result.success && result.data.password).toBe("outra");
  });
});

describe("connectionSchema (RN-CONN-001)", () => {
  it("aceita a conexão da API, que traz hasPassword e nunca a senha", () => {
    expect(connectionSchema.safeParse(saved).success).toBe(true);
  });

  it("aceita ambiente e pasta nulos", () => {
    expect(connectionSchema.safeParse({ ...saved, environmentName: null, environmentColor: null }).success).toBe(true);
  });

  it("recusa a resposta que traz um campo password: a tela não aceita senha fora do diálogo de revelar", () => {
    expect(connectionSchema.safeParse({ ...saved, password: "demonstracao" }).success).toBe(false);
    expect(connectionSchema.safeParse({ ...saved, password: null }).success).toBe(false);
  });

  it("recusa banco fora de 1, 2 e 3 e resposta sem hasPassword", () => {
    expect(connectionSchema.safeParse({ ...saved, engine: 9 }).success).toBe(false);
    expect(connectionSchema.safeParse({ ...saved, hasPassword: undefined }).success).toBe(false);
  });

  it("não quebra por um campo novo que não é senha", () => {
    expect(connectionSchema.safeParse({ ...saved, outroCampo: 1 }).success).toBe(true);
  });
});

describe("folderSchema e formulários de pasta (RN-PASTA-001, RN-PASTA-005 e RN-PASTA-007)", () => {
  const folder = { id: "8d0c5a54-5b51-4a0f-9d3b-6f0f5b8a2d11", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z" };
  const noEnvironment = { color: "", environmentName: "", environmentColor: "" };

  it("aceita a pasta da API, na raiz ou dentro de outra, com ou sem ambiente", () => {
    expect(folderSchema.safeParse(folder).success).toBe(true);
    expect(folderSchema.safeParse({ ...folder, parentID: "3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12" }).success).toBe(true);
    expect(folderSchema.safeParse({ ...folder, environmentName: "Produção", environmentColor: "#FF8A7A" }).success).toBe(true);
    expect(folderSchema.safeParse({ ...folder, color: "#7DB2FF" }).success).toBe(true);
  });

  it("a pasta sem a cor é recusada: a API a devolve sempre, nula quando não há (RN-PASTA-007)", () => {
    const withoutColor: Partial<typeof folder> = { ...folder };
    delete withoutColor.color;

    expect(folderSchema.safeParse(withoutColor).success).toBe(false);
  });

  it("a pasta sem os campos do ambiente é recusada: a API os devolve sempre, nulos quando não há", () => {
    const withoutEnvironment: Partial<typeof folder> = { ...folder };
    delete withoutEnvironment.environmentName;
    delete withoutEnvironment.environmentColor;

    expect(folderSchema.safeParse(withoutEnvironment).success).toBe(false);
  });

  it("nome da pasta: aparado, de 1 a 60 caracteres; o ambiente em branco vira nulo", () => {
    const ok = createFolderSchema.safeParse({ name: "  Fábrica ", parentID: "", ...noEnvironment });

    expect(ok.success && ok.data).toEqual({ name: "Fábrica", parentID: null, color: null, environmentName: null, environmentColor: null });
    expect(fieldErrors(createFolderSchema, { name: "   ", parentID: "", ...noEnvironment })).toHaveProperty("name");
    expect(fieldErrors(createFolderSchema, { name: "a".repeat(61), parentID: "", ...noEnvironment })).toHaveProperty("name");
    expect(createFolderSchema.safeParse({ name: "a".repeat(60), parentID: "", ...noEnvironment }).success).toBe(true);
  });

  it("o ambiente da pasta tem as regras do da conexão: até 30 caracteres e cor #RRGGBB", () => {
    const ok = createFolderSchema.safeParse({ name: "Produção", parentID: "", color: "", environmentName: "  Produção ", environmentColor: "#FF8A7A" });

    expect(ok.success && ok.data).toEqual({ name: "Produção", parentID: null, color: null, environmentName: "Produção", environmentColor: "#FF8A7A" });
    expect(fieldErrors(createFolderSchema, { name: "Produção", parentID: "", color: "", environmentName: "a".repeat(31), environmentColor: "" })).toHaveProperty("environmentName");
    expect(fieldErrors(createFolderSchema, { name: "Produção", parentID: "", color: "", environmentName: "", environmentColor: "vermelho" })).toHaveProperty("environmentColor");
    expect(fieldErrors(editConnectionSchema, { ...form, environmentName: "a".repeat(31) }).environmentName).toEqual(fieldErrors(createFolderSchema, { name: "P", parentID: "", color: "", environmentName: "a".repeat(31), environmentColor: "" }).environmentName);
  });

  it("a cor da pasta (RN-PASTA-007) tem a regra da cor do ambiente: #RRGGBB, e vazia é sem cor", () => {
    const colored = createFolderSchema.safeParse({ name: "Produção", parentID: "", ...noEnvironment, color: "#7db2ff" });

    expect(colored.success && colored.data.color).toBe("#7db2ff");
    expect(fieldErrors(createFolderSchema, { name: "Produção", parentID: "", ...noEnvironment, color: "azul" }).color).toEqual(["Use uma cor no formato #RRGGBB."]);
    expect(fieldErrors(createFolderSchema, { name: "Produção", parentID: "", ...noEnvironment, color: "#7DB2F" })).toHaveProperty("color");
  });

  it("editar (Editar pasta…, RN-PASTA-006) pede o nome, a cor e o ambiente; renomear (F2, RN-NAV-009), só o nome; e mover, só a pasta pai", () => {
    const renamed = editFolderSchema.safeParse({ name: "Nova", color: "#B79CFF", environmentName: "QAS", environmentColor: "#F2B644" });

    expect(renamed.success && renamed.data).toEqual({ name: "Nova", color: "#B79CFF", environmentName: "QAS", environmentColor: "#F2B644" });
    expect(Object.keys(editFolderSchema.shape).sort()).toEqual(["color", "environmentColor", "environmentName", "name"]);
    expect(Object.keys(renameFolderSchema.shape)).toEqual(["name"]);
    expect(fieldErrors(editFolderSchema, { name: "", ...noEnvironment })).toHaveProperty("name");

    const toFolder = moveFolderSchema.safeParse({ parentID: "3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12" });
    const toRoot = moveFolderSchema.safeParse({ parentID: "" });

    expect(toFolder.success && toFolder.data.parentID).toBe("3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12");
    expect(toRoot.success && toRoot.data.parentID).toBeNull();
    expect(Object.keys(moveFolderSchema.shape)).toEqual(["parentID"]);
  });
});
