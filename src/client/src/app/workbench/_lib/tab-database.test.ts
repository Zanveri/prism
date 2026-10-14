import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import { databaseNodes } from "./navigator-model";
import { databaseChoices, databaseOfValue, databaseValue, withDatabase } from "./tab-database";
import type { QueryTab } from "./workbench-model";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.editor.database;
const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

/** A lista da árvore (RN-ARVORE-006): o banco da conexão primeiro, sem nome no caminho; os outros com o nome. */
const listed = databaseNodes("c1", [
  { name: "alfa", isCurrent: false },
  { name: "mes", isCurrent: true },
  { name: "vendas", isCurrent: false },
]);

describe("o valor de um banco na lista da barra do editor (RN-ARVORE-007)", () => {
  it("o banco da conexão e cada outro banco têm valores que não se confundem, nem com um banco chamado 'null'", () => {
    const values = [databaseValue(undefined), databaseValue("alfa"), databaseValue("null"), databaseValue("")];

    expect(new Set(values).size).toBe(values.length);
    expect(databaseOfValue(databaseValue(undefined))).toBeUndefined();
    expect(databaseOfValue(databaseValue("alfa"))).toBe("alfa");
    expect(databaseOfValue(databaseValue("null"))).toBe("null");
  });

  it("o que não é um valor da lista não vira banco", () => {
    expect(databaseOfValue("não é JSON")).toBeUndefined();
    expect(databaseOfValue("42")).toBeUndefined();
  });
});

describe("databaseChoices: o que a lista dos bancos da aba mostra (RN-ARVORE-007)", () => {
  it("com a lista da árvore em cache, traz os bancos do servidor nela, na mesma ordem, com o da conexão marcado como o padrão", () => {
    const choices = databaseChoices({ nodes: listed, current: undefined, connectionDatabase: "mes", engine: postgres });

    expect(choices.options).toEqual([
      { value: databaseValue(undefined), label: copy.defaultName("mes") },
      { value: databaseValue("alfa"), label: "alfa" },
      { value: databaseValue("vendas"), label: "vendas" },
    ]);
    expect(choices.value).toBe(databaseValue(undefined));
    expect(choices.locked).toBe(false);
  });

  it("o valor é o banco em que a aba roda: outro banco do servidor, quando ela está nele", () => {
    expect(databaseChoices({ nodes: listed, current: "vendas", connectionDatabase: "mes", engine: informix }).value).toBe(databaseValue("vendas"));
  });

  it("antes de a lista chegar, mostra só o banco da aba: o da conexão pelo nome do cadastro, ou o outro pelo nome dele", () => {
    expect(databaseChoices({ nodes: undefined, current: undefined, connectionDatabase: "mes", engine: postgres }).options).toEqual([{ value: databaseValue(undefined), label: copy.defaultName("mes") }]);
    expect(databaseChoices({ nodes: undefined, current: "vendas", connectionDatabase: "mes", engine: postgres }).options).toEqual([{ value: databaseValue("vendas"), label: "vendas" }]);
  });

  it("o nome do banco da conexão é o que o servidor listou (o Informix e o Db2 mudam as maiúsculas); sem lista nem cadastro, uma frase no lugar", () => {
    const upper = databaseNodes("c1", [{ name: "MES", isCurrent: true }]);

    expect(databaseChoices({ nodes: upper, current: undefined, connectionDatabase: "mes", engine: informix }).options[0].label).toBe(copy.defaultName("MES"));
    expect(databaseChoices({ nodes: undefined, current: undefined, connectionDatabase: undefined, engine: postgres }).options[0].label).toBe(copy.defaultName(copy.connectionDatabase));
  });

  it("o banco da aba que a lista não traz (um script salvo num banco que sumiu) continua na lista, no fim, para o valor ter rótulo", () => {
    const choices = databaseChoices({ nodes: listed, current: "antigo", connectionDatabase: "mes", engine: postgres });

    expect(choices.options.at(-1)).toEqual({ value: databaseValue("antigo"), label: "antigo" });
    expect(choices.value).toBe(databaseValue("antigo"));
  });

  it("no Db2 a lista fica presa ao banco da conexão, mesmo com outros em cache: ele conecta num banco só por vez", () => {
    const choices = databaseChoices({ nodes: listed, current: undefined, connectionDatabase: "SAMPLE", engine: db2 });

    expect(choices.locked).toBe(true);
    expect(choices.options).toEqual([{ value: databaseValue(undefined), label: copy.defaultName("mes") }]);
  });

  it("sem saber o banco (a conexão ainda não chegou), a lista não fica presa", () => {
    expect(databaseChoices({ nodes: undefined, current: undefined, connectionDatabase: undefined, engine: undefined }).locked).toBe(false);
  });
});

describe("withDatabase: a aba de consulta passa a outro banco do servidor (RN-ARVORE-007)", () => {
  const tab: QueryTab = { id: "q1", title: "consulta-1.sql", connectionId: "c1", sessionId: "s-velha", sql: "select 1" };

  it("leva o banco novo e larga a sessão do anterior; o texto fica, o do editor deste instante", () => {
    expect(withDatabase(tab, "vendas", "select 2")).toEqual({ ...tab, database: "vendas", sessionId: null, sql: "select 2" });
  });

  it("voltar ao banco da conexão tira o banco da aba, como a aba aberta pela conexão", () => {
    const next = withDatabase({ ...tab, database: "vendas" }, undefined);

    expect(next).toEqual({ ...tab, sessionId: null });
    expect(next).not.toHaveProperty("database");
  });

  it("o mesmo banco, a aba de uma tabela e a aba sem conexão não trocam nada", () => {
    expect(withDatabase({ ...tab, database: "vendas" }, "vendas")).toBeNull();
    expect(withDatabase(tab, undefined)).toBeNull();
    expect(withDatabase({ ...tab, table: { schema: "loja", name: "pedido", view: "data" } }, "vendas")).toBeNull();
    expect(withDatabase({ ...tab, connectionId: null }, "vendas")).toBeNull();
  });

  it("a aba de um script fica com mudança não salva enquanto o banco não é o salvo, e sem ela ao voltar ao banco salvo com o texto salvo (RN-SCRIPT-001)", () => {
    const script = { id: "s1", name: "Fechamento", savedSql: "select 1", dirty: false };
    const moved = withDatabase({ ...tab, script }, "vendas");
    const back = withDatabase(moved!, undefined);
    const edited = withDatabase(moved!, undefined, "select 3");

    expect(moved?.script?.dirty).toBe(true);
    expect(back?.script?.dirty).toBe(false);
    expect(edited?.script?.dirty).toBe(true);
  });
});
