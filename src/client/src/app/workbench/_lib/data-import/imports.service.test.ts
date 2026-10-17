import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getTransfer } from "../data-export/transfers.service";
import { inProgress, kindOf } from "../data-export/transfers.schema";
import { previewCopy, previewImport, readImportFile, startCopy, startImport } from "./imports.service";

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };
const fileID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const jobID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, type: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...extra }), { status, headers: { "Content-Type": "application/problem+json" } });

function answering(...responses: Response[]) {
  const fake = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => responses.shift() ?? json({}));
  vi.stubGlobal("fetch", fake);
  return fake;
}

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

const reader = { encoding: "auto" as const, delimiter: "auto" as const, header: true, quote: "double" as const, nullText: "", emptyAsNull: false, trim: false, skipEmptyLines: true, unguardFormulas: true };
const values = { decimal: "point" as const, thousandsDot: false, dates: "iso" as const };
const target = { connectionID: "c1", schema: "estoque", table: "pedido" };

const table = {
  schema: "estoque",
  name: "pedido",
  oneAtATime: false,
  columns: [
    { name: "id", type: "integer", nullable: false, defaultValue: "nextval('pedido_id_seq'::regclass)", generated: "byDefault", class: "number", importable: true, reason: null },
    { name: "total", type: "numeric(10,2)", nullable: true, defaultValue: null, generated: null, class: "number", importable: true, reason: null },
    { name: "faixa", type: "int4range", nullable: true, defaultValue: null, generated: null, class: "intervaloNovo", importable: true },
  ],
  referencedBy: [{ schema: "estoque", table: "item_pedido", onDelete: "cascade" }],
};

describe("a leitura do arquivo (`imports/read`, RN-IMPORT-007)", () => {
  it("o POST leva o arquivo pelo `fileID`, o formato e o leitor; a resposta traz o que a leitura achou e as linhas como foram lidas", async () => {
    const fake = answering(
      json({ encoding: { name: "utf-8", bom: true }, delimiter: ";", listKey: null, sheets: null, sheet: null, columns: ["id", "nome"], shownColumns: 2, rows: [{ line: 2, values: ["1", null], short: true }] }),
    );
    const result = await readImportFile({ fileID, format: "csv", reader });
    expect(result).toEqual({ ok: true, data: { encoding: { name: "utf-8", bom: true }, delimiter: ";", listKey: null, sheets: null, sheet: null, columns: ["id", "nome"], shownColumns: 2, rows: [{ line: 2, values: ["1", null], short: true }] } });
    const [url, init] = fake.mock.calls[0];
    expect(url).toBe(`${base}/api/user/transfers/imports/read`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ fileID, format: "csv", reader });
  });

  it("a recusa do arquivo vem como valor, com o motivo e a linha nas extensões", async () => {
    answering(problem(422, "IMPORT_FILE_UNREADABLE", { detail: "A aspa aberta na linha 12 não fecha até o fim do arquivo.", reason: "format", line: 12 }));
    const result = await readImportFile({ fileID, format: "csv", reader });
    expect(result).toMatchObject({ ok: false, error: { code: "IMPORT_FILE_UNREADABLE", detail: "A aspa aberta na linha 12 não fecha até o fim do arquivo.", extensions: { reason: "format", line: 12 } } });
  });

  it("a resposta sem as colunas não é uma leitura (RESPONSE_INVALID)", async () => {
    answering(json({ encoding: null, rows: [] }));
    expect(await readImportFile({ fileID, format: "json", reader: {} })).toMatchObject({ ok: false, error: { code: "RESPONSE_INVALID" } });
  });
});

describe("a prévia convertida (`imports/preview`, RN-IMPORT-009 a 011)", () => {
  it("sem mapeamento, a resposta traz o sugerido; a classe que a tela não conhece vale `other`, e a regra de exclusão das chaves que chegam vem lida", async () => {
    const fake = answering(json({ table, columns: ["id", "total"], mapping: [{ source: 1, target: "total" }], shownColumns: 1, rows: [{ line: 2, problem: null, short: false, cells: [{ value: "12.50", problem: null }] }] }));
    const result = await previewImport({ fileID, format: "csv", reader, values, target });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.table.columns.map((column) => column.class)).toEqual(["number", "number", "other"]);
    expect(result.data.table.referencedBy).toEqual([{ schema: "estoque", table: "item_pedido", onDelete: "cascade" }]);
    expect(result.data.mapping).toEqual([{ source: 1, target: "total" }]);
    expect(fake.mock.calls[0][0]).toBe(`${base}/api/user/transfers/imports/preview`);
    expect(JSON.parse(String(fake.mock.calls[0][1].body))).toEqual({ fileID, format: "csv", reader, values, target });
  });

  it("as recusas da tabela vêm como valor: a que não existe, a que não é tabela, a conexão somente leitura", async () => {
    for (const [status, code] of [
      [404, "IMPORT_TABLE_NOT_FOUND"],
      [422, "IMPORT_TARGET_NOT_TABLE"],
      [422, "CONNECTION_READ_ONLY"],
    ] as const) {
      answering(problem(status, code));
      expect(await previewImport({ fileID, format: "csv", reader, values, target })).toMatchObject({ ok: false, error: { code } });
    }
  });
});

describe("os começos (`imports` e `copies`) e a prévia da cópia", () => {
  it("o 202 da importação traz o id; o corpo é o pedido inteiro, com o `windowID`", async () => {
    const fake = answering(json({ id: jobID }, 202));
    const request = { fileID, format: "csv" as const, reader, values, target, mapping: [{ source: 0, target: "id" }], load: { empty: false, commitEvery: 10_000, check: true }, windowID: 1 };
    expect(await startImport(request)).toEqual({ ok: true, data: { id: jobID } });
    expect(fake.mock.calls[0][0]).toBe(`${base}/api/user/transfers/imports`);
    expect(JSON.parse(String(fake.mock.calls[0][1].body))).toEqual(request);
  });

  it("a prévia da cópia e o começo dela: as rotas, o corpo e as respostas", async () => {
    const source = { kind: "table" as const, connectionID: "c1", schema: "estoque", table: "pedido" };
    const fake = answering(json({ table, mapping: [{ source: 0, target: "id" }] }), json({ id: jobID }, 202));
    expect(await previewCopy({ source, columns: [{ position: 0, name: "id" }], target: { connectionID: "c2", schema: "dw", table: "pedido_hist" } })).toMatchObject({ ok: true, data: { mapping: [{ source: 0, target: "id" }] } });
    const start = { source, columns: [{ position: 0, name: "id" }], count: true, target: { connectionID: "c2", schema: "dw", table: "pedido_hist" }, mapping: [{ source: 0, target: "id" }], load: { empty: false, commitEvery: null }, windowID: 2 };
    expect(await startCopy(start)).toEqual({ ok: true, data: { id: jobID } });
    expect(fake.mock.calls.map(([url]) => url)).toEqual([`${base}/api/user/transfers/copies/preview`, `${base}/api/user/transfers/copies`]);
    expect(JSON.parse(String(fake.mock.calls[1][1].body))).toEqual(start);
  });
});

describe("o item do trabalho com a importação e a cópia (seção 6)", () => {
  const item = (change: Record<string, unknown>) => ({
    id: jobID,
    kind: "import",
    connectionID: "c1",
    targetConnectionID: "c1",
    windowID: 1,
    state: "running",
    phase: "loading",
    rows: 12_345,
    committed: 10_000,
    total: null,
    bytes: 120,
    size: 260,
    uncertain: false,
    summary: null,
    error: null,
    reason: null,
    startedAt: "2026-10-16T14:30:05Z",
    finishedAt: null,
    ...change,
  });

  it("as fases da carga, `committed`, `size` e `uncertain` são lidos; a cópia, sem `bytes` nem `size`, também", async () => {
    answering(json(item({})));
    expect(await getTransfer(jobID)).toMatchObject({ ok: true, data: { kind: "import", phase: "loading", committed: 10_000, bytes: 120, size: 260, uncertain: false } });

    answering(json(item({ kind: "copy", phase: "counting", bytes: null, size: null, total: 500, targetConnectionID: "c2" })));
    expect(await getTransfer(jobID)).toMatchObject({ ok: true, data: { kind: "copy", phase: "counting", bytes: 0, size: null, total: 500, targetConnectionID: "c2" } });
  });

  it("o erro e o resumo da carga: a linha, a coluna, o lado, as confirmadas e a dúvida; as contagens do fim", async () => {
    answering(
      json(
        item({
          state: "failed",
          error: { code: "IMPORT_VALUE_INVALID", message: "«12a» não é um número inteiro.", sqlState: null, line: 1234, column: "qtd", side: "target", committed: 0, uncertain: false },
        }),
      ),
    );
    expect(await getTransfer(jobID)).toMatchObject({ ok: true, data: { error: { code: "IMPORT_VALUE_INVALID", line: 1234, column: "qtd", side: "target", committed: 0, uncertain: false } } });

    answering(json(item({ state: "done", summary: { rows: 3, bytes: null, sheets: null, cutValues: null, removedCharacters: null, skippedRows: null, committed: 3, emptied: true, shortRows: 1, skippedLines: 2, unguarded: 0, formulasWithoutValue: 0 } })));
    expect(await getTransfer(jobID)).toMatchObject({ ok: true, data: { summary: { committed: 3, emptied: true, shortRows: 1, skippedLines: 2 } } });
  });

  it("em andamento para as saídas: a importação e a cópia só enquanto rodam; a exportação pronta e não entregue também conta", () => {
    expect(inProgress({ kind: "import", state: "running" })).toBe(true);
    expect(inProgress({ kind: "import", state: "done" })).toBe(false);
    expect(inProgress({ kind: "copy", state: "done" })).toBe(false);
    expect(inProgress({ kind: "export", state: "done" })).toBe(true);
    expect(inProgress({ kind: null, state: "done" })).toBe(true);
    expect(kindOf({ kind: "outro" })).toBe("export");
  });
});
