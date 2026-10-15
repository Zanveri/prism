import { describe, expect, it } from "vitest";

import type { Connection, Folder } from "./connections.schema";
import { environmentLookup } from "./environment";

const now = "2026-10-13T12:00:00Z";

function folder(id: string, parentID: string | null, environmentName: string | null = null, environmentColor: string | null = null): Folder {
  return { id, parentID, name: `Pasta ${id}`, environmentName, environmentColor, color: null, createdAt: now, updatedAt: now };
}

function connection(folderID: string | null, environmentName: string | null = null, environmentColor: string | null = null): Connection {
  return { id: "c1", folderID, name: "MES", engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName, environmentColor, createdAt: now, updatedAt: now };
}

// Produção (vermelha) > Linha 1 (sem ambiente) > Extrusão (QAS, âmbar); Geral na raiz, sem ambiente.
const producao = folder("producao", null, "Produção", "#FF8A7A");
const linha = folder("linha", "producao");
const extrusao = folder("extrusao", "linha", "QAS", "#F2B644");
const geral = folder("geral", null);
const folders = [producao, linha, extrusao, geral];

describe("o ambiente que a conexão mostra (RN-CONN-015 e RN-PASTA-005)", () => {
  it("o ambiente próprio da conexão sempre ganha, mesmo dentro de uma pasta com ambiente", () => {
    expect(environmentLookup(folders).connection(connection("producao", "Develop", "#5ED3A3"))).toEqual({ name: "Develop", color: "#5ED3A3", folder: null });
  });

  it("sem ambiente próprio, herda o da pasta em que está", () => {
    expect(environmentLookup(folders).connection(connection("producao"))).toEqual({ name: "Produção", color: "#FF8A7A", folder: producao });
  });

  it("pastas aninhadas: herda o da pasta mais próxima acima que tenha um, e não o de mais longe", () => {
    const lookup = environmentLookup(folders);

    expect(lookup.connection(connection("linha"))).toEqual({ name: "Produção", color: "#FF8A7A", folder: producao });
    expect(lookup.connection(connection("extrusao"))).toEqual({ name: "QAS", color: "#F2B644", folder: extrusao });
  });

  it("na raiz, ou numa pasta sem ambiente em lugar nenhum acima, não há o que herdar", () => {
    const lookup = environmentLookup(folders);

    expect(lookup.connection(connection(null))).toBeNull();
    expect(lookup.connection(connection("geral"))).toBeNull();
  });

  it("a cor sem nome não é ambiente: a conexão só com cor herda o da pasta, e a pasta só com cor passa adiante o de cima", () => {
    const soCor = folder("so-cor", "producao", null, "#7DB2FF");
    const lookup = environmentLookup([...folders, soCor]);

    expect(lookup.connection(connection("producao", null, "#7DB2FF"))).toEqual({ name: "Produção", color: "#FF8A7A", folder: producao });
    expect(lookup.connection(connection("so-cor"))).toEqual({ name: "Produção", color: "#FF8A7A", folder: producao });
  });

  it("mover muda o que ela herda: a mesma conexão em outra pasta, ou a pasta dela em outro lugar", () => {
    const lookup = environmentLookup(folders);
    const moved = environmentLookup([producao, { ...linha, parentID: "geral" }, extrusao, geral]);

    expect(lookup.connection(connection("geral"))).toBeNull();
    expect(lookup.connection(connection("linha"))?.name).toBe("Produção");
    expect(moved.connection(connection("linha"))).toBeNull();
  });

  it("a pasta que sumiu e as pastas em ciclo (que a API recusa) não herdam nada e não travam a conta", () => {
    const a = folder("a", "b");
    const b = folder("b", "a");
    const lookup = environmentLookup([a, b, folder("orfa", "sumiu")]);

    expect(lookup.connection(connection("sumiu"))).toBeNull();
    expect(lookup.connection(connection("orfa"))).toBeNull();
    expect(lookup.connection(connection("a"))).toBeNull();
  });

  it("a mesma conexão e a mesma pasta dão o mesmo objeto, para o que é memorizado não redesenhar à toa", () => {
    const lookup = environmentLookup(folders);
    const mes = connection("linha");
    const propria = connection(null, "Develop", "#5ED3A3");

    expect(lookup.connection(mes)).toBe(lookup.connection(mes));
    expect(lookup.connection(propria)).toBe(lookup.connection(propria));
    expect(lookup.inheritedIn("linha")).toBe(lookup.inheritedIn("producao"));
  });
});

describe("o ambiente da pasta (RN-PASTA-005)", () => {
  it("a etiqueta da pasta é só o ambiente dela: a subpasta sem ambiente não mostra o de cima", () => {
    const lookup = environmentLookup(folders);

    expect(lookup.folder("producao")).toEqual({ name: "Produção", color: "#FF8A7A", folder: null });
    expect(lookup.folder("linha")).toBeNull();
    expect(lookup.folder("sumiu")).toBeNull();
  });

  it("o que uma conexão sem ambiente herdaria em cada pasta, para o formulário dizer de onde vem", () => {
    const lookup = environmentLookup(folders);

    expect(lookup.inheritedIn("linha")).toEqual({ name: "Produção", color: "#FF8A7A", folder: producao });
    expect(lookup.inheritedIn("extrusao")?.folder).toBe(extrusao);
    expect(lookup.inheritedIn(null)).toBeNull();
    expect(lookup.inheritedIn("geral")).toBeNull();
  });

  it("a cor da pasta (RN-PASTA-007) não é ambiente e não passa adiante: a pasta só com ela não tem etiqueta, e a conexão de dentro não herda nada", () => {
    const pintada: Folder = { ...folder("pintada", null), color: "#B79CFF" };
    const lookup = environmentLookup([pintada]);

    expect(lookup.folder("pintada")).toBeNull();
    expect(lookup.connection(connection("pintada"))).toBeNull();
  });
});
