import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stripTags } from "@/lib/testing/text";
import { revertTable } from "../_lib/build-model";
import { readCanvasModel } from "../_lib/fixtures";
import { DdlView } from "./ddl-view";

describe("DdlView", () => {
  it("mostra 'Só as diferenças | Tudo' com a marcada certa, CREATE SCHEMA manutencao (marcada) e producao (desmarcada) e '2 avisos · nenhum erro'", () => {
    const model = {
      ...readCanvasModel(),
      ddl: {
        ...readCanvasModel().ddl,
        scope: "changes" as const,
      },
    };

    const html = renderToStaticMarkup(
      createElement(DdlView, {
        model,
        modelName: "manutencao",
        baseLabel: "MES Produção / mes",
        baseEnvironment: "Produção",
        prismVersion: "0.6.0",
        generatedAt: "29/10/2026 14:32",
        onBackToDiagram: () => {},
        onChangeModel: () => {},
      }),
    );
    const text = stripTags(html);

    expect(html).toMatch(/aria-checked="true"[^>]*>Só as diferenças</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Tudo</);
    expect(html).toMatch(/checked=""[^>]*><span[^>]*>manutencao<\/span>/);
    expect(html).toMatch(/<input type="checkbox"(?! checked)[^>]*><span[^>]*>producao<\/span>/);
    expect(text).toContain("CREATE SCHEMA");
    expect(text).toContain("2 avisos · nenhum erro");
  });

  it("com um erro, 'Copiar', 'Salvar .sql' e 'Abrir na Área de trabalho' ficam desabilitados com a dica dele", () => {
    const base = readCanvasModel();
    const brokenTable = {
      ...base.tables[0]!,
      columns: [],
    };
    const model = {
      ...base,
      ddl: { ...base.ddl, scope: "changes" as const },
      tables: [brokenTable, ...base.tables.slice(1)],
    };

    const html = renderToStaticMarkup(
      createElement(DdlView, {
        model,
        modelName: "manutencao",
        baseLabel: "MES Produção / mes",
        baseEnvironment: "Produção",
        prismVersion: "0.6.0",
        generatedAt: "29/10/2026 14:32",
        onBackToDiagram: () => {},
        onChangeModel: () => {},
      }),
    );

    expect(html).toMatch(/disabled=""[^>]*title="[^"]*não tem colunas[^"]*"[^>]*>.*Copiar/);
    expect(html).toMatch(/disabled=""[^>]*title="[^"]*não tem colunas[^"]*"[^>]*>.*Salvar \.sql/);
    expect(html).toMatch(
      /disabled=""[^>]*title="[^"]*não tem colunas[^"]*"[^>]*>.*Abrir na Área de trabalho/,
    );
  });

  it("modelo com base sem mudança e scope 'changes' mostra 'Nada mudou em relação a MES Produção / mes.' e as três ações desabilitadas", () => {
    const base = readCanvasModel();
    const existingOnly = {
      ...base,
      ddl: { ...base.ddl, scope: "changes" as const },
      schemas: [{ name: "producao", create: false }],
      tables: base.tables.filter((t) => t.origin !== null),
    };
    const unchanged = revertTable(existingOnly, "producao.maquina");

    const html = renderToStaticMarkup(
      createElement(DdlView, {
        model: unchanged,
        modelName: "manutencao",
        baseLabel: "MES Produção / mes",
        baseEnvironment: "Produção",
        prismVersion: "0.6.0",
        generatedAt: "29/10/2026 14:32",
        onBackToDiagram: () => {},
        onChangeModel: () => {},
      }),
    );
    const text = stripTags(html);

    expect(text).toContain("Nada mudou em relação a MES Produção / mes.");
    expect(html).toMatch(
      /disabled=""[^>]*title="Nada mudou em relação a MES Produção \/ mes\."[^>]*>.*Copiar/,
    );
    expect(html).toMatch(
      /disabled=""[^>]*title="Nada mudou em relação a MES Produção \/ mes\."[^>]*>.*Salvar \.sql/,
    );
    expect(html).toMatch(
      /disabled=""[^>]*title="Nada mudou em relação a MES Produção \/ mes\."[^>]*>.*Abrir na Área de trabalho/,
    );
  });
});
