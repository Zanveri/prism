import { describe, expect, it } from "vitest";

import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";
import { environmentLookup } from "@/app/connections/_lib/environment";

import { filterConnected } from "./navigator-connected";
import { filterByEnvironment, noEnvironment } from "./navigator-environment";

const now = "2026-10-15T10:00:00Z";

function folder(id: string, parentID: string | null, environmentName: string | null = null): Folder {
  return { id, parentID, name: `Pasta ${id}`, environmentName, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
}

function connection(id: string, folderID: string | null, environmentName: string | null = null): Connection {
  return { id, folderID, name: `Conexão ${id}`, engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };
}

// Fábrica (Produção) > Linha > MES e QAS; Geral, na raiz, com o ERP; Vazia, sem nada; e o BI solto na raiz.
const fabrica = folder("fabrica", null, "Produção");
const linha = folder("linha", "fabrica");
const geral = folder("geral", null);
const vazia = folder("vazia", null);
const folders = [fabrica, linha, geral, vazia];
const mes = connection("mes", "linha");
const qas = connection("qas", "linha", "QAS");
const erp = connection("erp", "geral");
const bi = connection("bi", null);
const connections = [mes, qas, erp, bi];

const ids = (result: { folders: readonly Folder[]; connections: readonly Connection[] }) => ({ folders: result.folders.map((item) => item.id), connections: result.connections.map((item) => item.id) });

describe("“Só as conectadas” no navegador (RN-NAV-013)", () => {
  it("desligado, a árvore inteira, as mesmas listas: ela não se refaz", () => {
    const result = filterConnected(folders, connections, null);

    expect(result.folders).toBe(folders);
    expect(result.connections).toBe(connections);
  });

  it("ligado, só as conectadas e as pastas no caminho até elas, na ordem da lista", () => {
    expect(ids(filterConnected(folders, connections, new Set(["qas", "bi"])))).toEqual({ folders: ["fabrica", "linha"], connections: ["qas", "bi"] });
    expect(ids(filterConnected(folders, connections, new Set(["erp"])))).toEqual({ folders: ["geral"], connections: ["erp"] });
  });

  it("ligado e sem nenhuma conectada, a árvore fica vazia, e a pasta sem conectada dentro não aparece", () => {
    expect(ids(filterConnected(folders, connections, new Set()))).toEqual({ folders: [], connections: [] });
  });

  it("combina com o seletor de ambiente (RN-NAV-010): roda sobre o que ele deixou", () => {
    const lookup = environmentLookup(folders);
    const producao = filterByEnvironment(folders, connections, { type: "environment", key: "produção" }, lookup);
    const semAmbiente = filterByEnvironment(folders, connections, noEnvironment, lookup);
    const connected = new Set(["mes", "qas", "erp"]);

    // O MES herda Produção da Fábrica, e o QAS tem o próprio: em Produção só o MES; sem ambiente, o ERP (o BI está desconectado).
    expect(ids(filterConnected(producao.folders, producao.connections, connected))).toEqual({ folders: ["fabrica", "linha"], connections: ["mes"] });
    expect(ids(filterConnected(semAmbiente.folders, semAmbiente.connections, connected))).toEqual({ folders: ["geral"], connections: ["erp"] });
  });

  it("a pasta em ciclo (que a API recusa, RN-PASTA-003) não prende o caminho num laço", () => {
    const a = folder("a", "b");
    const b = folder("b", "a");

    expect(ids(filterConnected([a, b], [connection("x", "a")], new Set(["x"])))).toEqual({ folders: ["a", "b"], connections: ["x"] });
  });
});
