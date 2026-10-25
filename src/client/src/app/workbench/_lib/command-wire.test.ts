import { afterEach, describe, expect, it, vi } from "vitest";

import { sameCommand } from "./auto-refresh";
import { parametersOf, queryParamsOf, sentTextOf } from "./command-wire";
import { exportRequest, maxRequestBytes, requestSource } from "./data-export/export-request";
import { recordsSource, resultSource } from "./data-export/export-entry";
import { originCommandText } from "./data-export/export-source";
import { executeQuery } from "./query.service";
import { filterBaseOf } from "./result-filter";
import type { RowsState, RunTarget } from "./use-query-runner";
import type { BoundCommand } from "./variables/bind";

/** O comando com variáveis em tudo o que executa de novo a partir do resultado (RN-VAR-033). */

const sent: BoundCommand = {
  sql: "SELECT * FROM pedido WHERE id = $1 AND nome = $2",
  params: [
    { type: "number", value: "7", variable: "id", item: null },
    { type: "text", value: "Ana", variable: "nome", item: null },
  ],
  replacements: [],
};
const target: RunTarget = { sql: "SELECT * FROM pedido WHERE id = @id AND nome = @nome", offset: 12, engine: 1, sent };
const plain: RunTarget = { sql: "SELECT 1", offset: 0 };

describe("o comando como a API o recebe", () => {
  it("o texto enviado é o dos marcadores; sem variáveis, o do editor", () => {
    expect(sentTextOf(target)).toBe(sent.sql);
    expect(sentTextOf(plain)).toBe("SELECT 1");
  });

  it("os parâmetros do pedido levam só type e value; sem variáveis, nenhum", () => {
    expect(queryParamsOf(target)).toEqual([
      { type: "number", value: "7" },
      { type: "text", value: "Ana" },
    ]);
    expect(queryParamsOf(plain)).toEqual([]);
    expect(parametersOf(plain)).toBeUndefined();
    expect(parametersOf(target)).toHaveLength(2);
  });
});

describe("sameCommand compara os parâmetros (RN-GRADE-014)", () => {
  it("os mesmos parâmetros: o mesmo comando, qualquer que seja o lugar no editor", () => {
    expect(sameCommand(target, { ...target, offset: 99 })).toBe(true);
  });

  it("outro valor, outro tipo ou outra quantidade: outro comando", () => {
    const other = (params: BoundCommand["params"]): RunTarget => ({ ...target, sent: { ...sent, params } });
    expect(sameCommand(target, other([{ ...sent.params[0], value: "8" }, sent.params[1]]))).toBe(false);
    expect(sameCommand(target, other([{ ...sent.params[0], type: "text" }, sent.params[1]]))).toBe(false);
    expect(sameCommand(target, other([sent.params[0]]))).toBe(false);
  });

  it("o comando com variáveis não é o mesmo que o sem", () => {
    expect(sameCommand(target, { sql: target.sql, offset: 0 })).toBe(false);
  });
});

describe("o filtro do resultado mantém o comando trocado", () => {
  it("a base do filtro leva o texto enviado e os parâmetros", () => {
    const rows = { status: "rows", target: { ...target, filter: "id > 3" } } as unknown as RowsState;
    expect(filterBaseOf(rows, null)).toEqual({ sql: target.sql, offset: 12, engine: 1, sent });
  });
});

describe("a exportação e a cópia levam o texto enviado e source.params (RN-EXPORT-002 e 016)", () => {
  const rows = { status: "rows", id: 1, target, columns: [{ name: "id", type: "int4", kind: "number" }], rows: [], read: true } as unknown as RowsState;

  it("o resultado de um comando com variáveis", () => {
    const source = resultSource(rows, { connectionId: "c", tabTitle: "consulta-1.sql", scriptNumber: null, unsavedEdits: 0, table: null });
    expect(source.origin).toMatchObject({ kind: "result", sql: sent.sql });
    const request = requestSource("c", undefined, source.origin);
    expect(request).toEqual({ kind: "query", connectionID: "c", sql: sent.sql, params: [{ type: "number", value: "7" }, { type: "text", value: "Ana" }] });
  });

  it("a Origem do assistente mostra o texto com os valores no lugar, e não o dos marcadores (RN-EXPORT-015)", () => {
    const withMarkers: BoundCommand = {
      sql: "SELECT * FROM pedido WHERE id = $1 AND nome = $2",
      params: sent.params,
      replacements: [
        { name: "id", kind: "parameter", start: 33, end: 36, sentStart: 32, sentEnd: 34, firstParameter: 0, parameterCount: 1 },
        { name: "nome", kind: "parameter", start: 46, end: 51, sentStart: 46, sentEnd: 48, firstParameter: 1, parameterCount: 1 },
      ],
    };
    const bound = { ...target, sent: withMarkers };
    const source = resultSource({ ...rows, target: bound } as RowsState, { connectionId: "c", tabTitle: "consulta-1.sql", scriptNumber: null, unsavedEdits: 0, table: null });
    expect(source.origin).toMatchObject({ kind: "result", bound: withMarkers });
    expect(originCommandText(source.origin, 1)).toBe("SELECT * FROM pedido WHERE id = 7 AND nome = 'Ana'");

    const none = resultSource({ ...rows, target: plain } as RowsState, { connectionId: "c", tabTitle: "t", scriptNumber: null, unsavedEdits: 0, table: null });
    expect("bound" in none.origin).toBe(false);
    expect(originCommandText(none.origin, 1)).toBe("SELECT 1");
    expect(originCommandText({ kind: "table", view: false, schema: "s", name: "t" }, 1)).toBeNull();
  });

  it("sem variáveis, o pedido não leva a chave params", () => {
    const source = resultSource({ ...rows, target: plain } as RowsState, { connectionId: "c", tabTitle: "t", scriptNumber: null, unsavedEdits: 0, table: null });
    expect(requestSource("c", undefined, source.origin)).toEqual({ kind: "query", connectionID: "c", sql: "SELECT 1" });
  });

  it("os Registros também levam os parâmetros do comando que a grade mostra", () => {
    const source = recordsSource(rows, { connectionId: "c", schema: "s", name: "pedido", filter: "", unsavedEdits: 0 });
    expect(requestSource("c", undefined, source.origin)).toMatchObject({ params: [{ type: "number", value: "7" }, { type: "text", value: "Ana" }] });
  });

  it("o corpo vai até 16 MiB", () => {
    expect(maxRequestBytes).toBe(16 * 1024 * 1024);
    expect(exportRequest).toBeTypeOf("function");
  });
});

describe("POST queries leva os params", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("só type e value, na ordem; sem params, o corpo não os leva", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("window", { prism: { getApiConfig: async () => ({ baseUrl: "http://127.0.0.1:1", token: "t" }), onApiExit: () => () => {}, restartApi: async () => {} } });
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return Response.json({ columns: [{ name: "a", type: "int4", kind: "number" }], rows: [], hasMore: false, elapsedMs: 1 });
    });
    await executeQuery("s", sent.sql, undefined, [], queryParamsOf(target));
    await executeQuery("s", "SELECT 1");
    expect(bodies[0]).toEqual({ sql: sent.sql, params: [{ type: "number", value: "7" }, { type: "text", value: "Ana" }] });
    expect(bodies[1]).toEqual({ sql: "SELECT 1" });
  });
});
