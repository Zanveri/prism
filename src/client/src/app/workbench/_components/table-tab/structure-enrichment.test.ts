import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TableStructureEnrichment } from "@/lib/plugins/plugin-runtime";

import { structureColumns, structureForeignKeys, structureIndexes } from "../../_lib/table-structure";
import { StructureSections } from "./structure-sections";

const noop = () => {};

const columns = structureColumns(
  [
    { name: "ordemb", type: "char(2)", isNullable: false, isPrimaryKey: true, position: 1 },
    { name: "ordnum", type: "integer", isNullable: false, isPrimaryKey: true, position: 2 },
  ],
  [],
);

const enrichment: TableStructureEnrichment = {
  tableDescription: "Ordens de Produção",
  extraColumns: [{ key: "description", label: "Descrição" }],
  columnValues: {
    ordemb: { description: "Código da Embalagem" },
    ordnum: { description: "Número da Ordem" },
  },
  attributeDetails: {
    ordemb: [{ label: "Descrição", value: "Código da Embalagem" }],
    ordnum: [{ label: "Descrição", value: "Número da Ordem" }],
  },
};

function renderWithEnrichment(selectedColumn: string | null = null) {
  return renderToStaticMarkup(
    createElement(StructureSections, {
      section: "columns",
      onSection: noop,
      columns: { view: { kind: "ready" }, rows: columns },
      foreignKeys: { view: { kind: "empty" }, rows: structureForeignKeys([], "informix") },
      indexes: { view: { kind: "empty" }, rows: structureIndexes([]) },
      ddl: { kind: "loading" },
      onCopyDdl: noop,
      fetching: false,
      onRefresh: noop,
      onOpenDiagram: noop,
      onRetry: noop,
      tableName: "pcaord",
      enrichment,
      selectedColumn,
      onSelectColumn: noop,
    }),
  ).replaceAll("<wbr/>", "");
}

describe("enriquecimento da Estrutura (Info. e Colunas e descrições internas)", () => {
  it("altera Colunas para Info. e Colunas, exibe o nome da tabela em maiúsculas (PCAORD), a Descrição da tabela e a coluna Descrição ao lado do Nome", () => {
    const markup = renderWithEnrichment("ordemb");

    expect(markup).toContain("Info. e Colunas");
    expect(markup).toContain(">PCAORD<");
    expect(markup).toContain("Descrição da tabela: ");
    expect(markup).toContain(">Ordens de Produção<");
    expect(markup).toContain(">Descrição<");
    expect(markup).toContain(">Código da Embalagem<");
    expect(markup).toContain(">Número da Ordem<");

    // Verifica que a coluna "Descrição" fica imediatamente ao lado de "Nome" (antes de "Tipo")
    const nomeIdx = markup.indexOf(">Nome<");
    const descricaoIdx = markup.indexOf(">Descrição<");
    const tipoIdx = markup.indexOf(">Tipo<");
    expect(nomeIdx).toBeGreaterThan(-1);
    expect(descricaoIdx).toBeGreaterThan(nomeIdx);
    expect(tipoIdx).toBeGreaterThan(descricaoIdx);
  });

  it("atualiza o painel Inf. do atributo quando outra coluna está selecionada", () => {
    const markup = renderWithEnrichment("ordnum");

    expect(markup).toContain("Inf. do atributo (ordnum)");
  });
});
