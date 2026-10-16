import { describe, expect, it } from "vitest";

import { newVerification, unprotected, type Connection, type Folder } from "./connections.schema";
import {
  applyToMarked,
  closestCredentials,
  credentialsOf,
  credentialsOffered,
  exceedsLimits,
  exportCounter,
  exportFileName,
  exportFileType,
  exportRequestOf,
  exportSelection,
  exportTree,
  initialMarks,
  isEmptySelection,
  userPasswordChange,
} from "./export-model";
import { transferCopy } from "./transfer.copy";
import type { CredentialsChoice } from "./transfer.schema";

const now = "2026-10-16T12:00:00Z";
const folder = (id: string, parentID: string | null, name: string): Folder => ({ id, parentID, name, environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now });
const connection = (id: string, folderID: string | null, name: string, userName = "datafix", hasPassword = true): Connection => ({
  id,
  folderID,
  name,
  engine: 3,
  host: "informix-prd.exemplo.invalid",
  port: 9089,
  database: "estoque",
  userName,
  hasPassword,
  environmentName: null,
  environmentColor: null,
  confirmCommands: null,
  readOnly: false,
  ...newVerification,
  protections: unprotected,
  createdAt: now,
  updatedAt: now,
});

const folders = [folder("estoque", null, "Estoque"), folder("prd", "estoque", "Production PRD"), folder("dev", "estoque", "Desenvolvimento DEV"), folder("vazia", null, "Arquivo morto")];
const prdFix = connection("prd-fix", "prd", "DATA FIX");
const prdNominal = connection("prd-nominal", "prd", "NOMINAL", "pedro");
const devFix = connection("dev-fix", "dev", "DATA FIX");
const imported = connection("sem-tudo", "dev", "API_USER", "", false);
const userOnly = connection("so-usuario", "dev", "MIGRATION USER", "migra", false);
const connections = [prdFix, prdNominal, devFix, imported, userOnly];
const byId = new Map(connections.map((item) => [item.id, item]));
const tree = exportTree(folders, connections);

describe("initialMarks: com o que o diálogo abre (RN-TRANSF-001)", () => {
  it("pela conexão, só ela marcada; pela pasta, ela e tudo o que está dentro, a qualquer profundidade; pelo espaço vazio, nada", () => {
    expect(initialMarks(tree, { type: "connection", id: "prd-fix" })).toEqual({ marked: new Set(["prd-fix"]), scrollTo: "prd-fix" });
    expect([...initialMarks(tree, { type: "folder", id: "estoque" }).marked].sort()).toEqual(["dev-fix", "prd-fix", "prd-nominal", "so-usuario", "sem-tudo"].sort());
    expect(initialMarks(tree, { type: "all" })).toEqual({ marked: new Set(), scrollTo: null });
  });

  it("a pasta sem nenhuma conexão dentro vai também: a pasta vazia é a folha marcada (RN-TRANSF-006)", () => {
    expect(initialMarks(tree, { type: "folder", id: "vazia" }).marked).toEqual(new Set(["vazia"]));
  });
});

describe("as escolhas de cada conexão (RN-TRANSF-003)", () => {
  it("só o que a conexão tem gravado", () => {
    expect(credentialsOffered(prdFix)).toEqual(["none", "user", "userAndPassword"]);
    expect(credentialsOffered(userOnly)).toEqual(["none", "user"]);
    expect(credentialsOffered(imported)).toEqual(["none"]);
  });

  it("o padrão é “Sem usuário e senha”, o mais seguro", () => {
    expect(credentialsOf(new Map(), prdFix)).toBe("none");
  });

  it("na conexão que não tem o que se pede, fica o mais perto que ela tem", () => {
    expect(closestCredentials("userAndPassword", userOnly)).toBe("user");
    expect(closestCredentials("userAndPassword", imported)).toBe("none");
    expect(closestCredentials("user", imported)).toBe("none");
    expect(closestCredentials("user", prdFix)).toBe("user");
  });

  it("“Usuário e senha” para as DATA FIX que a busca mostra, e as NOMINAL continuam “Sem usuário e senha” (o exemplo do dono)", () => {
    const choices = applyToMarked(new Map(), "userAndPassword", [prdFix, devFix, userOnly]);

    expect(credentialsOf(choices, prdFix)).toBe("userAndPassword");
    expect(credentialsOf(choices, devFix)).toBe("userAndPassword");
    expect(credentialsOf(choices, userOnly)).toBe("user");
    expect(credentialsOf(choices, prdNominal)).toBe("none");
  });
});

describe("exportSelection e a conta do rodapé (RN-TRANSF-002)", () => {
  const all: Map<string, CredentialsChoice> = new Map([
    ["prd-fix", "userAndPassword"],
    ["dev-fix", "user"],
    ["sem-tudo", "userAndPassword"],
  ]);

  it("as conexões marcadas, as que levam a senha gravada, e as pastas do arquivo (as do caminho contam)", () => {
    const selection = exportSelection(tree, new Set(["prd-fix", "dev-fix", "sem-tudo"]), all, byId);

    // Na ordem da árvore: dentro de cada pasta, pelo nome (API_USER antes de DATA FIX).
    expect(selection.connections.map((item) => item.id)).toEqual(["sem-tudo", "dev-fix", "prd-fix"]);
    expect(selection.withPassword.map((item) => item.id)).toEqual(["prd-fix"]);
    expect(selection.foldersInFile).toBe(3);
    expect(selection.deepestLevel).toBe(2);
    expect(exportCounter(selection)).toBe("3 conexões marcadas, 1 com a senha · 3 pastas no arquivo");
  });

  it("os textos da conta: sem conexão, no singular, e sem nada", () => {
    expect(exportCounter(exportSelection(tree, new Set(["vazia"]), all, byId))).toBe("Nenhuma conexão marcada · 1 pasta no arquivo");
    expect(exportCounter(exportSelection(tree, new Set(["prd-fix"]), all, byId))).toBe("1 conexão marcada, com a senha · 2 pastas no arquivo");
    expect(exportCounter(exportSelection(tree, new Set(["dev-fix"]), all, byId))).toBe("1 conexão marcada · 2 pastas no arquivo");
    expect(exportCounter(exportSelection(tree, new Set(), all, byId))).toBe("Nada marcado");
    expect(isEmptySelection(exportSelection(tree, new Set(), all, byId))).toBe(true);
    expect(isEmptySelection(exportSelection(tree, new Set(["vazia"]), all, byId))).toBe(false);
  });

  it("a conexão da raiz não leva pasta nenhuma", () => {
    const root = exportTree([], [connection("solta", null, "Solta")]);
    expect(exportCounter(exportSelection(root, new Set(["solta"]), new Map(), new Map([["solta", connection("solta", null, "Solta")]])))).toBe("1 conexão marcada");
  });

  it("o aviso das senhas e a frase do “Confirme a sua senha” (RN-TRANSF-003 e 005)", () => {
    expect(transferCopy.export.passwordsWarning(2)).toBe(
      "As senhas de banco de 2 conexões vão no arquivo. Quem tiver o arquivo e a senha de exportação entra nesses bancos com elas. Para exportá-las, o Prism pede a sua senha do Prism.",
    );
    expect(transferCopy.export.passwordsWarning(1)).toContain("de 1 conexão vão no arquivo");

    const one = exportSelection(tree, new Set(["prd-fix", "dev-fix"]), all, byId);
    expect(userPasswordChange(one)).toBe("Exportar DATA FIX com a senha");
    const three = exportSelection(tree, new Set(["prd-fix", "dev-fix", "prd-nominal"]), new Map([...all, ["dev-fix", "userAndPassword"], ["prd-nominal", "userAndPassword"]]), byId);
    expect(userPasswordChange(three)).toBe("Exportar 3 conexões com a senha");
  });
});

describe("exportRequestOf: o corpo do pedido (RN-TRANSF-008)", () => {
  it("as pastas vazias marcadas, as conexões com a escolha de cada uma (dentro do que ela tem) e a senha de exportação; a senha do Prism só quando pedida", () => {
    const choices: Map<string, CredentialsChoice> = new Map([
      ["prd-fix", "userAndPassword"],
      ["so-usuario", "userAndPassword"],
    ]);
    const selection = exportSelection(tree, new Set(["vazia", "prd-fix", "so-usuario", "sem-tudo"]), choices, byId);

    const request = exportRequestOf(selection, choices, "senha-de-exportação");
    expect(request).toEqual({
      folderIDs: ["vazia"],
      connections: [
        { id: "sem-tudo", credentials: "none" },
        { id: "so-usuario", credentials: "user" },
        { id: "prd-fix", credentials: "userAndPassword" },
      ],
      passphrase: "senha-de-exportação",
    });
    expect(request).not.toHaveProperty("userPassword");
    expect(exportRequestOf(selection, choices, "senha-de-exportação", "senha do prism")).toMatchObject({ userPassword: "senha do prism" });
  });
});

describe("os limites da importação, que a exportação respeita (RN-TRANSF-006)", () => {
  it("até 2.000 conexões, 2.000 pastas e 32 níveis de pastas a partir da raiz do navegador", () => {
    const chain = Array.from({ length: 33 }, (_, index) => folder(`n${index}`, index === 0 ? null : `n${index - 1}`, `Nível ${index + 1}`));
    const deep = exportTree(chain, [connection("fundo", "n32", "Fundo")]);
    const deepById = new Map([["fundo", connection("fundo", "n32", "Fundo")]]);
    expect(exceedsLimits(exportSelection(deep, new Set(["fundo"]), new Map(), deepById))).toBe(true);

    const ok = exportTree(chain.slice(0, 32), [connection("fundo", "n31", "Fundo")]);
    expect(exceedsLimits(exportSelection(ok, new Set(["fundo"]), new Map(), new Map([["fundo", connection("fundo", "n31", "Fundo")]])))).toBe(false);

    const many = Array.from({ length: 2001 }, (_, index) => connection(`c${index}`, null, `C${index}`));
    const manyTree = exportTree([], many);
    expect(exceedsLimits(exportSelection(manyTree, new Set(many.map((item) => item.id)), new Map(), new Map(many.map((item) => [item.id, item]))))).toBe(true);
  });

  it("a frase é uma só, para as contagens, o tamanho e os níveis", () => {
    expect(transferCopy.export.limits).toBe(
      "O arquivo passaria dos limites da importação: até 2.000 conexões, 2.000 pastas, 5 MiB e 32 níveis de pastas a partir da raiz. Exporte em partes; o que está a mais de 32 níveis da raiz só sai se for movido para mais perto dela.",
    );
  });
});

describe("o arquivo e o aviso de sucesso (RN-TRANSF-007 e 008)", () => {
  it("o nome sugerido tem a data do dia na máquina, e nunca nome de pasta, de conexão ou de servidor", () => {
    expect(exportFileName(new Date(2026, 9, 16, 23, 59))).toBe("conexoes-prism-2026-10-16.prismconexoes");
    expect(exportFileName(new Date(2027, 0, 5))).toBe("conexoes-prism-2027-01-05.prismconexoes");
    expect(exportFileType).toBe("application/octet-stream");
  });

  it.each([
    [{ connections: 3, withPassword: 0, folders: 5 }, "3 conexões exportadas."],
    [{ connections: 1, withPassword: 0, folders: 1 }, "1 conexão exportada."],
    [{ connections: 3, withPassword: 1, folders: 5 }, "3 conexões exportadas, 1 com a senha."],
    [{ connections: 2, withPassword: 2, folders: 1 }, "2 conexões exportadas, todas com a senha."],
    [{ connections: 1, withPassword: 1, folders: 1 }, "1 conexão exportada, com a senha."],
    [{ connections: 0, withPassword: 0, folders: 2 }, "2 pastas exportadas, sem conexões."],
    [{ connections: 0, withPassword: 0, folders: 1 }, "1 pasta exportada, sem conexões."],
  ])("%o: %s", (result, message) => {
    expect(transferCopy.export.toast(result)).toBe(message);
  });
});
