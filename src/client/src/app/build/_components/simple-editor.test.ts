import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { stripTags } from "@/lib/testing/text";
import { addIndex, removeColumn, updateColumn } from "../_lib/build-model";
import { engineRules } from "../_lib/build-engines";
import { fkActionOptions } from "../_lib/editor-rows";
import { readCanvasModel } from "../_lib/fixtures";
import { buildTypeOptions } from "./column-row";
import { SimpleEditor } from "./simple-editor";

const ddlContext = {
  modelName: "manutencao",
  prismVersion: "0.6.0",
  generatedAt: "29/10/2026 14:32",
  baseLabel: "MES Produção / mes",
};

describe("SimpleEditor", () => {
  it("renderiza tabela nova ordem_manutencao com 8 colunas, botões PK/NN/UQ/AI, marcas FK e Ao excluir", () => {
    const model = readCanvasModel();
    const html = renderToStaticMarkup(
      createElement(SimpleEditor, {
        model,
        tableKey: "manutencao.ordem_manutencao",
        baseLabel: "MES Produção / mes",
        ddlContext,
        onChange: () => {},
      }),
    );

    for (let i = 1; i <= 8; i++) {
      expect(html).toContain(`aria-label="Nome da coluna ${i}"`);
    }
    expect(html).toContain('aria-label="id: chave primária"');
    expect(html).toContain('aria-label="id: não aceita nulo"');
    expect(html).toContain('aria-label="id: valor único"');
    expect(html).toContain('aria-label="id: gerado pelo banco"');
    expect(html).toContain('title="Chave estrangeira para producao.maquina"');
    expect(html).toContain('title="Chave estrangeira para plano_manutencao"');
    expect(html).toContain('title="Chave estrangeira para producao.operador"');
    expect(html).toContain("Ao excluir: anular");
  });

  it("renderiza tabela existente producao.maquina com coluna alterada, removida e nova, sem a seção 'O que esta tabela vai gerar'", () => {
    let model = readCanvasModel();
    model = updateColumn(model, "producao.maquina", "tag", {
      name: "tag_patrimonio",
      type: "varchar(20)",
    });
    model = removeColumn(model, "producao.maquina", "modelo").model;
    model = addIndex(model, "producao.maquina", ["ultima_revisao_em"]);

    const html = renderToStaticMarkup(
      createElement(SimpleEditor, {
        model,
        tableKey: "producao.maquina",
        baseLabel: "MES Produção / mes",
        ddlContext,
        onChange: () => {},
      }),
    );
    const text = stripTags(html);

    expect(text).toContain("Era tag varchar(12)");
    expect(text).toContain("modelo");
    expect(text).toContain("Restaurar");
    expect(text).toContain("NOVA");
    expect(text).not.toContain("O que esta tabela vai gerar");
  });

  it("padroniza todas as opções do select de tipos para UPPERCASE", () => {
    for (const engine of ["postgresql", "db2", "informix"] as const) {
      const opts = buildTypeOptions(engineRules[engine].types, "integer");
      expect(opts.length).toBeGreaterThan(0);
      for (const opt of opts) {
        expect(opt.label).toBe(opt.label.toUpperCase());
      }
      const matched = opts.find((opt) => opt.value === "integer");
      expect(matched?.label).toBe("INTEGER");
    }
  });

  it("no Informix, Ao excluir só oferece impedir e cascata", () => {
    const model = { ...readCanvasModel(), engine: "informix" as const };
    const html = renderToStaticMarkup(
      createElement(SimpleEditor, {
        model,
        tableKey: "manutencao.ordem_manutencao",
        baseLabel: "MES Produção / mes",
        ddlContext,
        onChange: () => {},
      }),
    );

    expect(fkActionOptions("informix").onDelete).toEqual(["noAction", "cascade"]);
    expect(html).toContain("Ao excluir: impedir");
    expect(html).not.toContain("Ao excluir: anular");
  });
});
