import { describe, expect, it } from "vitest";

import { runTableStructureEnrichers, type PluginQueryExecutor } from "./plugin-runtime";
import type { PluginBundle } from "./plugins.schema";

describe("runTableStructureEnrichers", () => {
  const sampleContext = {
    sessionId: "sess-1",
    connectionId: "conn-1",
    engine: 3 as const, // Informix
    schema: "informix",
    table: "diaemp",
    columns: [
      { position: 1, name: "empcod", type: "smallint", isNullable: false, isPrimaryKey: true },
      { position: 2, name: "empnom", type: "char(40)", isNullable: false, isPrimaryKey: false },
    ],
  };

  it("executes active plugin enricher and merges tableDescription, extraColumns, columnValues and attributeDetails", async () => {
    const bundle: PluginBundle = {
      id: "sit-descriptions",
      name: "Descrições SIT",
      version: "1.0.0",
      engines: ["informix"],
      code: `
        module.exports = {
          activate(prism) {
            prism.ui.registerTableStructureEnricher({
              id: "sit",
              engines: ["informix"],
              async enrich(ctx) {
                const res = await prism.db.query(ctx.sessionId, "SELECT colname, def_format FROM test");
                const columnValues = {};
                const attributeDetails = {};
                for (const row of res.rows) {
                  columnValues[row.colname] = {
                    format: row.def_format,
                    description: row.descr
                  };
                  attributeDetails[row.colname] = [
                    { label: "Formato", value: row.def_format },
                    { label: "Descrição", value: row.descr }
                  ];
                }
                return {
                  tableDescription: "Cadastro de Empresas",
                  extraColumns: [
                    { key: "format", label: "Formato", monospace: true },
                    { key: "description", label: "Descrição" }
                  ],
                  columnValues,
                  attributeDetails
                };
              }
            });
          }
        };
      `,
    };

    const fakeQuery: PluginQueryExecutor = async () => ({
      columns: ["colname", "def_format", "descr"],
      rawRows: [
        ["empcod", "999", "Código da Empresa"],
        ["empnom", "X(40)", "Nome da Empresa"],
      ],
      rows: [
        { colname: "empcod", def_format: "999", descr: "Código da Empresa" },
        { colname: "empnom", def_format: "X(40)", descr: "Nome da Empresa" },
      ],
    });

    const enrichment = await runTableStructureEnrichers([bundle], sampleContext, fakeQuery);

    expect(enrichment).not.toBeNull();
    expect(enrichment?.tableDescription).toBe("Cadastro de Empresas");
    expect(enrichment?.extraColumns).toEqual([
      { key: "format", label: "Formato", monospace: true },
      { key: "description", label: "Descrição" },
    ]);
    expect(enrichment?.columnValues?.empcod).toEqual({
      format: "999",
      description: "Código da Empresa",
    });
    expect(enrichment?.attributeDetails?.empcod).toEqual([
      { label: "Formato", value: "999" },
      { label: "Descrição", value: "Código da Empresa" },
    ]);
  });

  it("skips plugins whose engines do not match the session engine", async () => {
    const bundle: PluginBundle = {
      id: "sit-descriptions",
      name: "Descrições SIT",
      version: "1.0.0",
      engines: ["informix"],
      code: `
        prism.ui.registerTableStructureEnricher({
          enrich: () => ({ tableDescription: "Não deveria rodar no Postgres" })
        });
      `,
    };

    const enrichment = await runTableStructureEnrichers([bundle], {
      ...sampleContext,
      engine: 1, // PostgreSQL
    });

    expect(enrichment).toBeNull();
  });

  it("isolates errors thrown by a faulty plugin without crashing", async () => {
    const brokenBundle: PluginBundle = {
      id: "broken-plugin",
      name: "Broken",
      version: "1.0.0",
      engines: [],
      code: `
        prism.ui.registerTableStructureEnricher({
          enrich() {
            throw new Error("Plugin falhou");
          }
        });
      `,
    };

    const enrichment = await runTableStructureEnrichers([brokenBundle], sampleContext);
    expect(enrichment).toBeNull();
  });

  it("executes internal descriptions queries (diaabr and diadii) on the same session when useInternalDescriptions is true", async () => {
    const executedSql: string[] = [];
    const fakeQuery: PluginQueryExecutor = async (_sessionId, sql) => {
      executedSql.push(sql);
      if (sql.includes("from diaabr")) {
        return {
          columns: ["abrdescr"],
          rawRows: [["Ordens de Produção"]],
          rows: [{ abrdescr: "Ordens de Produção" }],
        };
      }
      if (sql.includes("diccod = 'ordemb'")) {
        return {
          columns: ["diidescr"],
          rawRows: [["Código da Embalagem"]],
          rows: [{ diidescr: "Código da Embalagem" }],
        };
      }
      return { columns: ["diidescr"], rawRows: [], rows: [] };
    };

    const enrichment = await runTableStructureEnrichers(
      [],
      {
        sessionId: "sess-pcaord",
        connectionId: "conn-1",
        engine: 3,
        schema: "informix",
        table: "PCAORD",
        columns: [
          { position: 1, name: "ordemb", type: "char(2)", isNullable: false, isPrimaryKey: true },
        ],
        useInternalDescriptions: true,
      },
      fakeQuery,
    );

    expect(enrichment).not.toBeNull();
    expect(enrichment?.tableDescription).toBe("Ordens de Produção");
    expect(enrichment?.extraColumns).toEqual([{ key: "description", label: "Descrição" }]);
    expect(enrichment?.columnValues?.ordemb).toEqual({ description: "Código da Embalagem" });
    expect(executedSql[0]).toContain("where abrtip = 'T'");
    expect(executedSql[0]).toContain("and abrabrev = 'pcaord'");
    expect(executedSql[1]).toContain("where diccod = 'ordemb'");
    expect(executedSql[1]).toContain("and diiidioma = 'P'");
  });
});
