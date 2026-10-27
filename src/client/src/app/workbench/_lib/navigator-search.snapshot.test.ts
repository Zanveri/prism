import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { ObjectNames } from "./database-sessions.schema";
import { databaseSessionKey, objectNamesKey } from "./database-sessions.service";
import { schemaNodes } from "./navigator-model";
import { cachedTree } from "./navigator-search";

const answer = (table: string): ObjectNames => ({ schemas: [{ name: "vendas", isSystem: false, tables: [table], views: [] }], truncated: false });
const schemas = (name: string) => schemaNodes("c1", [{ name, isSystem: false }]);

describe("cachedTree não devolve o retrato velho de uma consulta refeita (RN-BUSCA-002)", () => {
  it("o índice removido (o 'Desconectar') e refeito entre duas leituras volta com o dado novo, mesmo com o mesmo hash e a mesma contagem de atualizações", () => {
    const client = new QueryClient();
    client.setQueryData(objectNamesKey("c1"), answer("velha"));
    const first = cachedTree(client);

    client.removeQueries({ queryKey: ["tree", "c1"] });
    client.setQueryData(objectNamesKey("c1"), answer("nova"));
    const second = cachedTree(client);

    expect(second).not.toBe(first);
    expect(second.indexes[0].names.schemas[0].tables).toEqual(["nova"]);
  });

  it("o índice reiniciado (a sessão reaberta) e refeito entre duas leituras também", () => {
    const client = new QueryClient();
    client.setQueryData(objectNamesKey("c1"), answer("velha"));
    const first = cachedTree(client);

    client.getQueryCache().find({ queryKey: objectNamesKey("c1") })?.reset();
    client.setQueryData(objectNamesKey("c1"), answer("nova"));
    const second = cachedTree(client);

    expect(second).not.toBe(first);
    expect(second.indexes[0].names.schemas[0].tables).toEqual(["nova"]);
  });

  it("o nível removido e refeito entre duas leituras também", () => {
    const client = new QueryClient();
    client.setQueryData(["tree", "c1", "schemas"], schemas("velho"));
    const first = cachedTree(client);

    client.removeQueries({ queryKey: ["tree", "c1"] });
    client.setQueryData(["tree", "c1", "schemas"], schemas("novo"));
    const second = cachedTree(client);

    expect(second).not.toBe(first);
    expect(second.cached[0].nodes[0].label).toBe("novo");
  });

  it("a sessão que trocou de nome e o índice refeito com o mesmo conteúdo continuam dando um retrato novo, e o que não mudou dá o mesmo", () => {
    const client = new QueryClient();
    client.setQueryData(databaseSessionKey("c1"), { id: "s1", database: "mes" });
    client.setQueryData(objectNamesKey("c1"), answer("t"));
    const first = cachedTree(client);
    expect(cachedTree(client)).toBe(first);

    client.removeQueries({ queryKey: ["tree", "c1"] });
    client.setQueryData(objectNamesKey("c1"), answer("t"));
    // O mesmo conteúdo, mas outra resposta: um retrato novo (o dado é outro objeto), com os mesmos nomes.
    const again = cachedTree(client);
    expect(again).not.toBe(first);
    expect(again.indexes[0].names).toEqual(first.indexes[0].names);
    expect(cachedTree(client)).toBe(again);
  });

  it("gravar de novo o MESMO objeto conta como atualização, como antes (a contagem continua na assinatura)", () => {
    const client = new QueryClient();
    const names = answer("t");
    client.setQueryData(objectNamesKey("c1"), names);
    const first = cachedTree(client);

    client.setQueryData(objectNamesKey("c1"), names);

    expect(cachedTree(client)).not.toBe(first);
  });
});
