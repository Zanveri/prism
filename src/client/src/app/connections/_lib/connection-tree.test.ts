import { describe, expect, it } from "vitest";

import { buildConnectionTree, folderOptions, type TreeNode } from "./connection-tree";
import type { Connection, Folder } from "./connections.schema";

const now = "2026-10-09T12:00:00Z";

function folder(id: string, name: string, parentID: string | null = null): Folder {
  return { id, parentID, name, environmentName: null, environmentColor: null, color: null, createdAt: now, updatedAt: now };
}

function connection(id: string, name: string, folderID: string | null = null): Connection {
  return { id, folderID, name, engine: 1, host: "srv", port: 5432, database: "db", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, createdAt: now, updatedAt: now };
}

/** O nome de cada nó, com a profundidade, na ordem em que a tela os desenha. */
function outline(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => [`${node.depth}:${node.kind}:${node.name}`, ...(node.kind === "folder" ? outline(node.children) : [])]);
}

describe("buildConnectionTree", () => {
  it("pastas aninhadas em três níveis viram árvore com a profundidade certa", () => {
    const tree = buildConnectionTree([folder("c", "Extrusão", "b"), folder("a", "Corporativo"), folder("b", "Fábrica", "a")], [connection("x", "MES", "c")]);

    expect(outline(tree)).toEqual(["0:folder:Corporativo", "1:folder:Fábrica", "2:folder:Extrusão", "3:connection:MES"]);
  });

  it("o nó da conexão leva a conexão inteira", () => {
    const mes = connection("x", "MES", "a");
    const [root] = buildConnectionTree([folder("a", "Fábrica")], [mes]);

    expect(root.kind === "folder" && root.children[0]).toEqual({ kind: "connection", id: "x", name: "MES", depth: 1, connection: mes });
  });

  it("conexão sem pasta fica na raiz", () => {
    const tree = buildConnectionTree([folder("a", "Fábrica")], [connection("x", "Avulsa")]);

    expect(outline(tree)).toEqual(["0:folder:Fábrica", "0:connection:Avulsa"]);
  });

  it("irmãos em ordem alfabética, sem diferenciar caixa nem acento, e pastas antes de conexões", () => {
    const tree = buildConnectionTree([folder("1", "zeta"), folder("2", "Álamo"), folder("3", "beta")], [connection("x", "Aardvark"), connection("y", "mes"), connection("z", "Financeiro", "3")]);

    expect(outline(tree)).toEqual(["0:folder:Álamo", "0:folder:beta", "1:connection:Financeiro", "0:folder:zeta", "0:connection:Aardvark", "0:connection:mes"]);
  });

  it("pasta órfã (pai inexistente) aparece na raiz, com o que tem dentro, em vez de sumir", () => {
    const tree = buildConnectionTree([folder("a", "Órfã", "removida"), folder("b", "Filha", "a")], [connection("x", "Solta", "removida")]);

    expect(outline(tree)).toEqual(["0:folder:Órfã", "1:folder:Filha", "0:connection:Solta"]);
  });

  it("sem nada, árvore vazia", () => {
    expect(buildConnectionTree([], [])).toEqual([]);
  });
});

describe("folderOptions", () => {
  it("lista todas as pastas na ordem da árvore, com o caminho inteiro no rótulo", () => {
    const tree = buildConnectionTree([folder("b", "Extrusão", "a"), folder("a", "Fábrica"), folder("c", "Corporativo")], []);

    expect(folderOptions(tree)).toEqual([
      { value: "c", label: "Corporativo" },
      { value: "a", label: "Fábrica" },
      { value: "b", label: "Fábrica / Extrusão" },
    ]);
  });
});
