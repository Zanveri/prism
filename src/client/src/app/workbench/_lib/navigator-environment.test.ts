import { describe, expect, it } from "vitest";

import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";
import { environmentLookup } from "@/app/connections/_lib/environment";

import { allEnvironments, choiceAvailable, filterByEnvironment, noEnvironment, type EnvironmentChoice } from "./navigator-environment";

const now = "2026-10-14T10:00:00Z";

function folder(id: string, parentID: string | null, environmentName: string | null = null): Folder {
  return { id, parentID, name: `Pasta ${id}`, environmentName, environmentColor: null, color: null, createdAt: now, updatedAt: now };
}

function connection(id: string, folderID: string | null, environmentName: string | null = null): Connection {
  return { id, folderID, name: `Conexão ${id}`, engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName, environmentColor: null, createdAt: now, updatedAt: now };
}

// Fábrica (Produção) > Linha (sem ambiente) > Extrusão (QAS); Geral, na raiz, sem ambiente; Vazia (Produção), sem nada dentro.
const fabrica = folder("fabrica", null, "Produção");
const linha = folder("linha", "fabrica");
const extrusao = folder("extrusao", "linha", "QAS");
const geral = folder("geral", null);
const vazia = folder("vazia", null, "Produção");
const folders = [fabrica, linha, extrusao, geral, vazia];

const herdaProducao = connection("mes", "linha");
const herdaQas = connection("qas", "extrusao");
const propriaDevelop = connection("dev", "fabrica", "Develop");
const semNada = connection("solta", "geral");
const raizProducao = connection("erp", null, "PRODUÇÃO");
const connections = [herdaProducao, herdaQas, propriaDevelop, semNada, raizProducao];

const run = (choice: EnvironmentChoice) => filterByEnvironment(folders, connections, choice, environmentLookup(folders));
const ids = (result: { folders: readonly Folder[]; connections: readonly Connection[] }) => ({ folders: result.folders.map((item) => item.id), connections: result.connections.map((item) => item.id) });

describe("o filtro do navegador por ambiente (RN-NAV-010)", () => {
  it("'Todos os ambientes' é a árvore inteira, as mesmas listas", () => {
    const result = run(allEnvironments);

    expect(result.folders).toBe(folders);
    expect(result.connections).toBe(connections);
  });

  it("um ambiente: só as conexões cujo ambiente é esse, próprio ou herdado da pasta, sem diferenciar maiúsculas, e as pastas no caminho até elas", () => {
    expect(ids(run({ type: "environment", key: "produção" }))).toEqual({ folders: ["fabrica", "linha"], connections: ["mes", "erp"] });
  });

  it("o ambiente próprio da conexão ganha do da pasta: a de Develop dentro da Fábrica não é de Produção", () => {
    expect(ids(run({ type: "environment", key: "develop" }))).toEqual({ folders: ["fabrica"], connections: ["dev"] });
  });

  it("a subpasta com outro ambiente leva as conexões dela para esse, e o caminho inteiro até ela aparece", () => {
    expect(ids(run({ type: "environment", key: "qas" }))).toEqual({ folders: ["fabrica", "linha", "extrusao"], connections: ["qas"] });
  });

  it("'Sem ambiente': só as conexões sem ambiente próprio nem herdado", () => {
    expect(ids(run(noEnvironment))).toEqual({ folders: ["geral"], connections: ["solta"] });
  });

  it("a pasta sem conexão do ambiente não aparece, mesmo sendo dele", () => {
    expect(run({ type: "environment", key: "produção" }).folders).not.toContain(vazia);
  });

  it("um ambiente que ninguém usa mais não mostra nada", () => {
    expect(ids(run({ type: "environment", key: "homologação" }))).toEqual({ folders: [], connections: [] });
  });

  it("pastas em ciclo não prendem o caminho num laço", () => {
    const a = folder("a", "b", "QAS");
    const b = folder("b", "a");
    const loop = [a, b];
    const result = filterByEnvironment(loop, [connection("c", "b", "QAS")], { type: "environment", key: "qas" }, environmentLookup(loop));

    expect(ids(result)).toEqual({ folders: ["a", "b"], connections: ["c"] });
  });
});

describe("a escolha que ainda vale", () => {
  const environments = [{ key: "qas", name: "QAS", color: null }];

  it("'Todos' e 'Sem ambiente' valem sempre; um ambiente, só enquanto alguém o usa", () => {
    expect(choiceAvailable(allEnvironments, [])).toBe(true);
    expect(choiceAvailable(noEnvironment, [])).toBe(true);
    expect(choiceAvailable({ type: "environment", key: "qas" }, environments)).toBe(true);
    expect(choiceAvailable({ type: "environment", key: "produção" }, environments)).toBe(false);
  });
});
