import { describe, expect, it } from "vitest";

import { newVerification, unprotected, type Connection, type Folder } from "./connections.schema";
import { environmentKey, findEnvironment, userEnvironments } from "./user-environments";

function folder(id: string, environmentName: string | null, environmentColor: string | null, updatedAt: string): Folder {
  return { id, parentID: null, name: `Pasta ${id}`, environmentName, environmentColor, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: updatedAt, updatedAt };
}

function connection(id: string, environmentName: string | null, environmentColor: string | null, updatedAt: string): Connection {
  return { id, folderID: null, name: `Conexão ${id}`, engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName, environmentColor, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: updatedAt, updatedAt };
}

describe("os ambientes do usuário (RN-AMB-001)", () => {
  it("são os nomes que as pastas e as conexões já usam, um por nome, em ordem alfabética", () => {
    const folders = [folder("f1", "QAS", "#F2B644", "2026-10-14T10:00:00Z"), folder("f2", "Produção", "#FF8A7A", "2026-10-14T10:00:00Z")];
    const connections = [connection("c1", "Develop", "#5ED3A3", "2026-10-14T10:00:00Z")];

    expect(userEnvironments(folders, connections)).toEqual([
      { key: "develop", name: "Develop", color: "#5ED3A3" },
      { key: "produção", name: "Produção", color: "#FF8A7A" },
      { key: "qas", name: "QAS", color: "#F2B644" },
    ]);
  });

  it("o mesmo nome com outra caixa é o mesmo ambiente, com o nome e a cor da pasta ou conexão alterada por último", () => {
    const folders = [folder("f1", "produção", "#AEB7C4", "2026-10-14T09:00:00Z")];
    const connections = [connection("c1", "PRODUÇÃO", "#FF8A7A", "2026-10-14T11:00:00.1234567Z"), connection("c2", "Produção", "#7DB2FF", "2026-10-14T10:00:00Z")];

    expect(userEnvironments(folders, connections)).toEqual([{ key: "produção", name: "PRODUÇÃO", color: "#FF8A7A" }]);
  });

  it("a alterada por último manda mesmo sem cor: o ambiente fica sem cor", () => {
    const folders = [folder("f1", "QAS", "#F2B644", "2026-10-14T09:00:00Z"), folder("f2", "qas", null, "2026-10-14T12:00:00Z")];

    expect(userEnvironments(folders, [])).toEqual([{ key: "qas", name: "qas", color: null }]);
  });

  it("no empate, fica a primeira encontrada: as pastas antes das conexões, na ordem da lista", () => {
    const at = "2026-10-14T10:00:00Z";

    expect(userEnvironments([folder("f1", "QAS", "#F2B644", at)], [connection("c1", "qas", "#7DB2FF", at)])).toEqual([{ key: "qas", name: "QAS", color: "#F2B644" }]);
  });

  it("só o nome faz um ambiente: a cor sozinha e o nome em branco não contam, e o espaço nas pontas não separa dois", () => {
    const at = "2026-10-14T10:00:00Z";
    const folders = [folder("f1", null, "#FF8A7A", at), folder("f2", "   ", "#F2B644", at), folder("f3", " QAS ", "#5ED3A3", at)];

    expect(userEnvironments(folders, [connection("c1", "QAS", "#5ED3A3", "2026-10-14T09:00:00Z")])).toEqual([{ key: "qas", name: "QAS", color: "#5ED3A3" }]);
  });

  it("nada é gravado à parte: sem pasta nem conexão que o use, o ambiente some da lista", () => {
    expect(userEnvironments([], [])).toEqual([]);
    expect(userEnvironments([folder("f1", null, null, "2026-10-14T10:00:00Z")], [connection("c1", null, null, "2026-10-14T10:00:00Z")])).toEqual([]);
  });

  it("a cor da pasta (RN-PASTA-007) não é ambiente: a pasta só com ela não entra na lista, e a com ambiente leva a cor do ambiente", () => {
    const at = "2026-10-14T10:00:00Z";
    const folders = [{ ...folder("f1", null, null, at), color: "#B79CFF" }, { ...folder("f2", "QAS", "#F2B644", at), color: "#7DB2FF" }];

    expect(userEnvironments(folders, [])).toEqual([{ key: "qas", name: "QAS", color: "#F2B644" }]);
  });

  it("a data que não se lê perde para qualquer outra", () => {
    const folders = [folder("f1", "QAS", "#F2B644", "ontem"), folder("f2", "QAS", "#7DB2FF", "2026-10-14T10:00:00Z")];

    expect(userEnvironments(folders, [])).toEqual([{ key: "qas", name: "QAS", color: "#7DB2FF" }]);
  });
});

describe("a chave de um ambiente e a busca por nome", () => {
  it("sem diferenciar maiúsculas e sem os espaços das pontas, mas o acento conta", () => {
    expect(environmentKey("  Produção ")).toBe("produção");
    expect(environmentKey("PRODUÇÃO")).toBe(environmentKey("produção"));
    expect(environmentKey("Producao")).not.toBe(environmentKey("Produção"));
  });

  it("acha o ambiente pelo nome digitado, com qualquer caixa; o nome em branco não acha nenhum", () => {
    const environments = [{ key: "qas", name: "QAS", color: "#F2B644" }];

    expect(findEnvironment(environments, " qas ")).toBe(environments[0]);
    expect(findEnvironment(environments, "QA")).toBeUndefined();
    expect(findEnvironment(environments, "")).toBeUndefined();
  });
});
