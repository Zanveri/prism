import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectionSchema, createConnectionSchema, createFolderSchema, editConnectionSchema, editWithoutPasswordSchema, engineOptions, folderSchema, moveFolderSchema, editFolderSchema, renameFolderSchema, queryWithoutControl, withoutControl } from "./connections.schema";

const form = {
  engine: "1",
  name: "ERP",
  folderID: "",
  host: "srv-pg.exemplo.local",
  port: "5432",
  database: "erp",
  userName: "prism_leitura",
  password: "demonstracao",
  environmentName: "",
  environmentColor: "",
  confirmCommands: "none",
  readOnly: "false",
  verificationEnabled: "true",
  verificationInterval: "30",
  verificationQuery: "",
};

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
  confirmCommands: null,
  readOnly: false,
  verificationEnabled: true,
  verificationInterval: 30,
  verificationQuery: null,
  protections: { readOnly: false, readOnlyFolderID: null, confirmCommands: null, confirmCommandsFolderID: null },
  createdAt: "2026-10-09T12:00:00Z",
  updatedAt: "2026-10-09T12:00:00Z",
};

describe("engineOptions (RN-CONN-012)", () => {
  it("traz o rótulo, a etiqueta, a porta sugerida e a consulta de verificação de cada banco, a da API (RN-CONN-013 e RN-VERIF-001)", () => {
    expect(engineOptions.map(({ value, label, tag, defaultPort, verificationQuery }) => [value, label, tag, defaultPort, verificationQuery])).toEqual([
      [1, "PostgreSQL", "PG", 5432, "SELECT 1"],
      [2, "Db2", "DB2", 50000, "SELECT 1 FROM SYSIBM.SYSDUMMY1"],
      [3, "Informix", "IFX", 9089, "SELECT 1 FROM systables WHERE tabid = 1"],
    ]);
  });
});

describe("createConnectionSchema (RN-CONN-010)", () => {
  it("aceita um formulário válido e entrega a porta e o banco como número", () => {
    const result = createConnectionSchema.safeParse(form);

    expect(result.success && result.data).toEqual({
      engine: 1,
      name: "ERP",
      folderID: null,
      host: "srv-pg.exemplo.local",
      port: 5432,
      database: "erp",
      userName: "prism_leitura",
      password: "demonstracao",
      environmentName: null,
      environmentColor: null,
      confirmCommands: null,
      readOnly: false,
      verificationEnabled: true,
      verificationInterval: 30,
      verificationQuery: null,
    });
  });

  it("a sessão da conexão (RN-VERIF-001): a caixa vem do campo escondido, o intervalo vira número e a consulta é aparada, nula em branco", () => {
    const off = createConnectionSchema.safeParse({ ...form, verificationEnabled: "false", verificationInterval: " 120 ", verificationQuery: "  SELECT 1 FROM SYSIBM.SYSDUMMY1\n" });
    const blank = createConnectionSchema.safeParse({ ...form, verificationQuery: " \n " });

    expect(off.success && [off.data.verificationEnabled, off.data.verificationInterval, off.data.verificationQuery]).toEqual([false, 120, "SELECT 1 FROM SYSIBM.SYSDUMMY1"]);
    expect(blank.success && blank.data.verificationQuery).toBeNull();
  });

  it.each(["4", "3601", "0", "12.5", "trinta", "", "-30"])("recusa o intervalo %j no campo dele, com a frase da API", (verificationInterval) => {
    expect(fieldErrors(createConnectionSchema, { ...form, verificationInterval }).verificationInterval).toEqual(["A verificação deve ser feita a cada 5 a 3.600 segundos."]);
  });

  it.each(["5", "3600", "30"])("aceita o intervalo %j", (verificationInterval) => {
    expect(createConnectionSchema.safeParse({ ...form, verificationInterval }).success).toBe(true);
  });

  it("a consulta de verificação tem até 1.000 caracteres depois de aparada, como a API conta", () => {
    expect(createConnectionSchema.safeParse({ ...form, verificationQuery: ` ${"x".repeat(1000)} ` }).success).toBe(true);
    expect(fieldErrors(createConnectionSchema, { ...form, verificationQuery: "x".repeat(1001) }).verificationQuery).toEqual(["A consulta de verificação pode ter no máximo 1.000 caracteres."]);
  });

  it("sem os campos da sessão da conexão o formulário é recusado, em vez de gravar a verificação padrão por cima da escolhida", () => {
    const without: Partial<typeof form> = { ...form };
    delete without.verificationEnabled;
    delete without.verificationInterval;
    delete without.verificationQuery;

    expect(Object.keys(fieldErrors(createConnectionSchema, without)).sort()).toEqual(["verificationEnabled", "verificationInterval", "verificationQuery"]);
  });

  it("as proteções próprias (RN-PROT-001 e 002) vêm dos campos escondidos: “Não” vai nulo, como a API devolve, e o somente leitura vira booleano", () => {
    const protegida = createConnectionSchema.safeParse({ ...form, confirmCommands: "all", readOnly: "true" });
    const irreversiveis = createConnectionSchema.safeParse({ ...form, confirmCommands: "irreversible" });

    expect(protegida.success && [protegida.data.confirmCommands, protegida.data.readOnly]).toEqual(["all", true]);
    expect(irreversiveis.success && irreversiveis.data.confirmCommands).toBe("irreversible");
  });

  it("sem os campos das proteções, ou com um valor fora da lista, o formulário é recusado em vez de gravar a proteção mais fraca", () => {
    const withoutProtections: Partial<typeof form> = { ...form };
    delete withoutProtections.confirmCommands;
    delete withoutProtections.readOnly;

    expect(Object.keys(fieldErrors(createConnectionSchema, withoutProtections)).sort()).toEqual(["confirmCommands", "readOnly"]);
    expect(fieldErrors(createConnectionSchema, { ...form, confirmCommands: "sempre" }).confirmCommands).toEqual(["Escolha não confirmar, só os comandos irreversíveis ou todos os comandos."]);
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

describe("os tetos e os caracteres de controle e de direção do texto (RN-CONN-010 e RN-PASTA-001, seção 34)", () => {
  // Os de controle (U+0000 a U+001F, U+007F a U+009F) e os de direção do texto (U+200E, U+200F, U+202A a U+202E, U+2066 a U+2069): um U+202E faria o host
  // que a prévia da importação manda conferir parecer outro.
  const refused = ["\u0000", "\u001B", "\u007F", "\u009F", "\u200E", "\u200F", "\u202A", "\u202E", "\u2066", "\u2069"];

  it.each(refused)("o nome, o host, o banco de dados, o usuário e o ambiente recusam U+%s, cada um com o nome do campo", (character) => {
    const errors = fieldErrors(createConnectionSchema, { ...form, name: `ERP${character}`, host: `srv${character}.exemplo.invalid`, database: `erp${character}`, userName: `u${character}`, environmentName: `Prod${character}` });

    expect(errors).toEqual({
      name: ["O nome da conexão não pode ter caractere de controle nem de direção do texto."],
      host: ["O host não pode ter caractere de controle nem de direção do texto."],
      database: ["O banco de dados não pode ter caractere de controle nem de direção do texto."],
      userName: ["O usuário do banco não pode ter caractere de controle nem de direção do texto."],
      environmentName: ["O nome do ambiente não pode ter caractere de controle nem de direção do texto."],
    });
    expect(fieldErrors(createFolderSchema, { name: `Fábrica${character}`, parentID: "", color: "", environmentName: "", environmentColor: "", confirmCommands: "none", readOnly: "false" })).toEqual({
      name: ["O nome da pasta não pode ter caractere de controle nem de direção do texto."],
    });
  });

  it("no nome, a tabulação e a quebra de linha viram espaço na normalização (a da API), e não são recusadas; no host, são", () => {
    expect(withoutControl("Fábrica\tNorte", true)).toBe(true);
    expect(withoutControl("Fábrica\nNorte", true)).toBe(true);
    expect(withoutControl("Fábrica\u0085Norte", true)).toBe(true);
    expect(withoutControl("srv\tdb")).toBe(false);
    expect(fieldErrors(createConnectionSchema, { ...form, name: "ERP\tNorte", host: "srv\tdb" })).toEqual({ host: ["O host não pode ter caractere de controle nem de direção do texto."] });
  });

  it.each(refused)("a consulta de verificação recusa U+%s, também num comentário ou numa cadeia, na criação, na edição e na edição sem senha (RN-VERIF-001)", (character) => {
    const message = ["A consulta de verificação não pode ter caractere de controle nem de direção do texto."];

    for (const schema of [createConnectionSchema, editConnectionSchema, editWithoutPasswordSchema]) {
      expect(fieldErrors(schema, { ...form, verificationQuery: `SELECT 1 /* ${character} */` })).toEqual({ verificationQuery: message });
      expect(fieldErrors(schema, { ...form, verificationQuery: `SELECT '${character}abc'` })).toEqual({ verificationQuery: message });
    }
  });

  it("a consulta de verificação, que é SQL de várias linhas, aceita a tabulação, a quebra de linha e o retorno de carro; a tabulação vertical e o NEL, não", () => {
    expect(queryWithoutControl("SELECT 1\r\n\tFROM systables\n\tWHERE tabid = 1")).toBe(true);
    expect(queryWithoutControl("SELECT\u000B1")).toBe(false);
    expect(queryWithoutControl("SELECT \u0085 1")).toBe(false);
    const multiline = createConnectionSchema.safeParse({ ...form, verificationQuery: " SELECT 1\r\n\tFROM systables\r\n" });
    expect(multiline.success && multiline.data.verificationQuery).toBe("SELECT 1\r\n\tFROM systables");
  });

  it("o caractere comum, o acento e o emoji passam", () => {
    expect(createConnectionSchema.safeParse({ ...form, name: "Produção 🚀", host: "informix-prd.exemplo.invalid", userName: "joão" }).success).toBe(true);
  });

  it("o host tem até 255 caracteres, o banco de dados e o usuário até 128, contados depois de aparados", () => {
    expect(createConnectionSchema.safeParse({ ...form, host: ` ${"h".repeat(255)} `, database: "d".repeat(128), userName: "u".repeat(128) }).success).toBe(true);
    expect(fieldErrors(createConnectionSchema, { ...form, host: "h".repeat(256), database: "d".repeat(129), userName: "u".repeat(129) })).toEqual({
      host: ["O host pode ter até 255 caracteres."],
      database: ["O banco de dados pode ter até 128 caracteres."],
      userName: ["O usuário do banco pode ter até 128 caracteres."],
    });
  });

  it("a senha tem até 1.024 caracteres, contados como veio (ela não é aparada), na criação e na edição", () => {
    for (const schema of [createConnectionSchema, editConnectionSchema, editWithoutPasswordSchema]) {
      expect(schema.safeParse({ ...form, password: " ".repeat(1024) }).success).toBe(true);
      expect(fieldErrors(schema, { ...form, password: `${"s".repeat(1024)} ` })).toEqual({ password: ["A senha do banco pode ter até 1.024 caracteres."] });
    }
  });
});

describe("editWithoutPasswordSchema: a edição da conexão sem senha gravada (RN-TRANSF-015)", () => {
  it("exige a senha: não há o que manter, e vazio é “Informe a senha do banco.”", () => {
    expect(fieldErrors(editWithoutPasswordSchema, { ...form, password: "" })).toEqual({ password: ["Informe a senha do banco."] });
    const ok = editWithoutPasswordSchema.safeParse({ ...form, password: "nova" });
    expect(ok.success && ok.data.password).toBe("nova");
  });

  it("o usuário continua obrigatório no formulário: tirá-lo é recusado no campo", () => {
    expect(fieldErrors(editWithoutPasswordSchema, { ...form, userName: "" })).toEqual({ userName: ["Informe o usuário do banco."] });
    expect(fieldErrors(editConnectionSchema, { ...form, userName: " " })).toEqual({ userName: ["Informe o usuário do banco."] });
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

  it("traz as proteções próprias, as que valem com a pasta de onde vêm, e a verificação (RN-PROT-004, RN-VERIF-001); o “none” é “Não”, nulo", () => {
    const protegida = connectionSchema.parse({ ...saved, confirmCommands: "none", readOnly: true, verificationEnabled: false, verificationInterval: 120, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1", protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: "3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12" } });

    expect([protegida.confirmCommands, protegida.readOnly, protegida.verificationEnabled, protegida.verificationInterval, protegida.verificationQuery]).toEqual([null, true, false, 120, "SELECT 1 FROM systables WHERE tabid = 1"]);
    expect(protegida.protections).toEqual({ readOnly: true, readOnlyFolderID: null, confirmCommands: "all", confirmCommandsFolderID: "3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12" });
  });

  it("recusa a resposta sem as proteções ou com uma confirmação que a tela não conhece: o PATCH seguinte gravaria a proteção mais fraca sem ninguém pedir", () => {
    const withoutProtections: Partial<typeof saved> = { ...saved };
    delete withoutProtections.protections;

    expect(connectionSchema.safeParse(withoutProtections).success).toBe(false);
    expect(connectionSchema.safeParse({ ...saved, confirmCommands: "sempre" }).success).toBe(false);
    expect(connectionSchema.safeParse({ ...saved, readOnly: undefined }).success).toBe(false);
  });
});

describe("folderSchema e formulários de pasta (RN-PASTA-001, RN-PASTA-005 e RN-PASTA-007)", () => {
  const folder = { id: "8d0c5a54-5b51-4a0f-9d3b-6f0f5b8a2d11", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: { readOnly: false, readOnlyFolderID: null, confirmCommands: null, confirmCommandsFolderID: null }, createdAt: "2026-10-09T12:00:00Z", updatedAt: "2026-10-09T12:00:00Z" };
  const noEnvironment = { color: "", environmentName: "", environmentColor: "", confirmCommands: "none", readOnly: "false" };

  it("aceita a pasta da API, na raiz ou dentro de outra, com ou sem ambiente", () => {
    expect(folderSchema.safeParse(folder).success).toBe(true);
    expect(folderSchema.safeParse({ ...folder, parentID: "3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12" }).success).toBe(true);
    expect(folderSchema.safeParse({ ...folder, environmentName: "Produção", environmentColor: "#FF8A7A" }).success).toBe(true);
    expect(folderSchema.safeParse({ ...folder, color: "#7DB2FF" }).success).toBe(true);
  });

  it("a pasta traz as proteções próprias e as que valem (RN-PROT-004); sem elas, é recusada", () => {
    const protegida = folderSchema.parse({ ...folder, confirmCommands: "irreversible", readOnly: true, protections: { readOnly: true, readOnlyFolderID: "3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12", confirmCommands: "all", confirmCommandsFolderID: "3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12" } });
    const withoutProtections: Partial<typeof folder> = { ...folder };
    delete withoutProtections.protections;

    expect([protegida.confirmCommands, protegida.readOnly, protegida.protections.confirmCommands]).toEqual(["irreversible", true, "all"]);
    expect(folderSchema.safeParse(withoutProtections).success).toBe(false);
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

    expect(ok.success && ok.data).toEqual({ name: "Fábrica", parentID: null, color: null, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false });
    expect(fieldErrors(createFolderSchema, { name: "   ", parentID: "", ...noEnvironment })).toHaveProperty("name");
    expect(fieldErrors(createFolderSchema, { name: "a".repeat(61), parentID: "", ...noEnvironment })).toHaveProperty("name");
    expect(createFolderSchema.safeParse({ name: "a".repeat(60), parentID: "", ...noEnvironment }).success).toBe(true);
  });

  it("o ambiente da pasta tem as regras do da conexão: até 30 caracteres e cor #RRGGBB", () => {
    const ok = createFolderSchema.safeParse({ ...noEnvironment, name: "Produção", parentID: "", environmentName: "  Produção ", environmentColor: "#FF8A7A" });

    expect(ok.success && ok.data).toEqual({ name: "Produção", parentID: null, color: null, environmentName: "Produção", environmentColor: "#FF8A7A", confirmCommands: null, readOnly: false });
    expect(fieldErrors(createFolderSchema, { ...noEnvironment, name: "Produção", parentID: "", environmentName: "a".repeat(31) })).toHaveProperty("environmentName");
    expect(fieldErrors(createFolderSchema, { ...noEnvironment, name: "Produção", parentID: "", environmentColor: "vermelho" })).toHaveProperty("environmentColor");
    expect(fieldErrors(editConnectionSchema, { ...form, environmentName: "a".repeat(31) }).environmentName).toEqual(fieldErrors(createFolderSchema, { ...noEnvironment, name: "P", parentID: "", environmentName: "a".repeat(31) }).environmentName);
  });

  it("a cor da pasta (RN-PASTA-007) tem a regra da cor do ambiente: #RRGGBB, e vazia é sem cor", () => {
    const colored = createFolderSchema.safeParse({ name: "Produção", parentID: "", ...noEnvironment, color: "#7db2ff" });

    expect(colored.success && colored.data.color).toBe("#7db2ff");
    expect(fieldErrors(createFolderSchema, { name: "Produção", parentID: "", ...noEnvironment, color: "azul" }).color).toEqual(["Use uma cor no formato #RRGGBB."]);
    expect(fieldErrors(createFolderSchema, { name: "Produção", parentID: "", ...noEnvironment, color: "#7DB2F" })).toHaveProperty("color");
  });

  it("editar (Editar pasta…, RN-PASTA-006) pede o nome, a cor, o ambiente e as proteções; renomear (F2, RN-NAV-009), só o nome; e mover, só a pasta pai", () => {
    const renamed = editFolderSchema.safeParse({ name: "Nova", color: "#B79CFF", environmentName: "QAS", environmentColor: "#F2B644", confirmCommands: "all", readOnly: "true" });

    expect(renamed.success && renamed.data).toEqual({ name: "Nova", color: "#B79CFF", environmentName: "QAS", environmentColor: "#F2B644", confirmCommands: "all", readOnly: true });
    expect(Object.keys(editFolderSchema.shape).sort()).toEqual(["color", "confirmCommands", "environmentColor", "environmentName", "name", "readOnly"]);
    expect(Object.keys(renameFolderSchema.shape)).toEqual(["name"]);
    expect(fieldErrors(editFolderSchema, { name: "", ...noEnvironment })).toHaveProperty("name");

    const toFolder = moveFolderSchema.safeParse({ parentID: "3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12" });
    const toRoot = moveFolderSchema.safeParse({ parentID: "" });

    expect(toFolder.success && toFolder.data.parentID).toBe("3f2b8a54-5b51-4a0f-9d3b-6f0f5b8a2d12");
    expect(toRoot.success && toRoot.data.parentID).toBeNull();
    expect(Object.keys(moveFolderSchema.shape)).toEqual(["parentID"]);
  });
});
