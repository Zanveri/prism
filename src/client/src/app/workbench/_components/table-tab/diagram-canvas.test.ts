import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultPreferences } from "@/app/settings/_lib/preferences";
import type { Column, ForeignKey } from "../../_lib/database-sessions.schema";
import { layoutDiagram, referencedTables, type DiagramLayout } from "../../_lib/table-diagram";
import { DiagramCanvas } from "./diagram-canvas";

const noop = () => {};
const column = (name: string, position: number, over: Partial<Column> = {}): Column => ({ name, type: "bigint", isNullable: false, isPrimaryKey: false, position, ...over });
const fk = (name: string, columns: string[], referencedTable: string): ForeignKey => ({ name, columns, referencedSchema: "producao", referencedTable, referencedColumns: ["id"] });

const centerRef = { schema: "producao", name: "apontamento" };
const centerColumns = [column("id", 1, { isPrimaryKey: true }), column("ordem_id", 2), column("maquina_id", 3, { type: "numeric(12,3)" })];
const targetColumns = [column("id", 1, { isPrimaryKey: true }), column("nome", 2, { type: "varchar(60)" })];

function build(foreignKeys: ForeignKey[], tableNames: string[], columns: Column[] | null = targetColumns): DiagramLayout {
  const { tables } = referencedTables(centerRef, foreignKeys);
  return layoutDiagram({ center: { ref: centerRef, columns: centerColumns }, foreignKeys, neighbors: tables.filter((table) => tableNames.includes(table.name)).map((ref) => ({ ref, columns })) });
}

function render(layout: DiagramLayout, over: { omitted?: number; foreignKeyCount?: number; fetching?: boolean } = {}) {
  return renderToStaticMarkup(
    createElement(DiagramCanvas, { layout, schema: "producao", tableCount: layout.boxes.length, foreignKeyCount: over.foreignKeyCount ?? layout.edges.length, omitted: over.omitted ?? 0, fetching: over.fetching ?? false, onOpenTable: noop, onRefresh: noop }),
  );
}

const withKeys = [fk("fk_ordem", ["ordem_id"], "ordem_producao"), fk("fk_maquina", ["maquina_id"], "maquina")];

describe("o diagrama (RN-TABELA-004)", () => {
  it("o SVG tem o tamanho do desenho no zoom de 100%, e a área que rola é um grupo com nome", () => {
    const layout = build(withKeys, ["ordem_producao", "maquina"]);
    const markup = render(layout);

    expect(markup).toContain(`viewBox="0 0 ${layout.width} ${layout.height}"`);
    expect(markup).toContain(`width="${layout.width}" height="${layout.height}"`);
    expect(markup).toMatch(/<div[^>]*tabindex="0"[^>]*role="group"[^>]*aria-label="Diagrama da tabela"/);
  });

  it("com um zoom lembrado de quando a pessoa saiu, o desenho volta nele (e o rótulo diz qual)", () => {
    const layout = build(withKeys, ["ordem_producao", "maquina"]);
    const markup = renderToStaticMarkup(
      createElement(DiagramCanvas, { layout, schema: "producao", tableCount: layout.boxes.length, foreignKeyCount: layout.edges.length, omitted: 0, fetching: false, onOpenTable: noop, onRefresh: noop, initial: { zoom: 0.64, left: 120, top: 40 } }),
    );

    expect(markup).toContain(`width="${layout.width * 0.64}" height="${layout.height * 0.64}"`);
    expect(markup).toContain(">64%<");
  });

  it("a tabela do centro e cada vizinha têm caixa; só as vizinhas abrem (botão com nome, foco por teclado)", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toMatch(/<g[^>]*role="group"[^>]*aria-label="apontamento"/);
    expect(markup).toMatch(/<g[^>]*role="button"[^>]*aria-label="Abrir ordem_producao"/);
    expect(markup).toMatch(/<g[^>]*role="button"[^>]*aria-label="Abrir maquina"/);
    expect(markup.match(/role="button"/g)).toHaveLength(2);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(3);
  });

  it("o foco por teclado de uma vizinha usa o anel de foco do app: nenhuma classe o suprime", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));
    const buttons = [...markup.matchAll(/<g[^>]*role="button"[^>]*>/g)].map((match) => match[0]);

    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).not.toMatch(/outline-none|outline-0|focus:outline|ring-0/);
      expect(button).toContain('tabindex="0"');
    }
  });

  it("as colunas com o tipo e as marcas PK e FK; a vizinha só com a PK, que é o que o catálogo dela diz", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toContain(">ordem_id<");
    expect(markup).toContain(">numeric(12,3)<");
    expect(markup).toMatch(/<tspan[^>]*>PK<\/tspan>/);
    expect(markup).toMatch(/<tspan[^>]*>FK<\/tspan>/);
    // As duas chaves estrangeiras do centro marcam FK; as vizinhas, que não carregaram as chaves delas, não.
    expect(markup.match(/>FK<\/tspan>/g)).toHaveLength(2);
    expect(markup.match(/>PK<\/tspan>/g)).toHaveLength(3);
  });

  it("uma linha por chave estrangeira, com a dica da chave, e a seta entra na ponta da tabela referenciada", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toContain("<title>fk_ordem: ordem_id → ordem_producao (id)</title>");
    expect(markup).toContain("<title>fk_maquina: maquina_id → maquina (id)</title>");
    // Cada linha leva a visível e a faixa larga da dica.
    expect(markup.match(/<polyline/g)).toHaveLength(4);
    const markerId = /<marker id="([^"]+)"/.exec(markup)?.[1];
    expect(markerId).toBeDefined();
    expect(markup.match(new RegExp(`marker-end="url\\(#${markerId}\\)"`, "g"))).toHaveLength(2);
  });

  it("o texto vem do banco e entra como texto do SVG: marcação num nome de tabela não vira elemento (RN-SHELL-002)", () => {
    const hostile = layoutDiagram({
      center: { ref: { schema: "s", name: "<script>alert(1)</script>" }, columns: [column("<img src=x onerror=alert(1)>", 1)] },
      foreignKeys: [],
      neighbors: [],
    });
    const markup = render(hostile);

    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("a vizinha cujas colunas falharam aparece só com o nome", () => {
    const markup = render(build([fk("fk_ordem", ["ordem_id"], "ordem_producao")], ["ordem_producao"], null));

    expect(markup).toContain(">ordem_producao<");
    expect(markup).not.toContain(">varchar(60)<");
  });

  it("o zoom: reduzir, o valor, ampliar, ajustar à tela e atualizar, nesta ordem, com o valor em 100%", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));
    const names = [...markup.matchAll(/aria-label="(Reduzir|Ampliar)"|>(Ajustar à tela|Atualizar)<|>100%</g)].map((match) => match[1] ?? match[2] ?? "100%");

    expect(markup).toContain('role="toolbar"');
    expect(names).toEqual(["Reduzir", "100%", "Ampliar", "Ajustar à tela", "Atualizar"]);
  });

  it("o título conta as tabelas (a do centro incluída) e as chaves estrangeiras", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toMatch(/<span[^>]*>producao<\/span> · 3 tabelas, 2 chaves estrangeiras/);
  });

  it("a legenda explica as marcas e a seta, e diz que as tabelas que apontam para esta não aparecem", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toContain("chave primária");
    expect(markup).toContain("a seta sai da tabela com a chave estrangeira e aponta para a tabela referenciada");
    expect(markup).toContain("a API ainda não informa as que apontam para ela");
  });

  it("passando do teto, diz quantas das referenciadas estão no desenho", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]), { omitted: 3 });

    expect(markup).toContain("Mostrando 2 de 5 tabelas referenciadas.");
    expect(render(build(withKeys, ["ordem_producao", "maquina"]))).not.toContain("Mostrando");
  });

  it("sem chave estrangeira, o desenho é só a tabela e a frase diz por quê", () => {
    const markup = render(build([], []), { foreignKeyCount: 0 });

    expect(markup).toContain("Esta tabela não tem chaves estrangeiras.");
    expect(markup).not.toContain("<polyline");
    expect(markup).not.toContain('role="button"');
  });

  it("'Atualizar' fica desabilitado enquanto busca", () => {
    expect(render(build(withKeys, ["ordem_producao", "maquina"]), { fetching: true })).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Atualizar/);
  });

  it("oferece os botões de exportar PNG, exportar Mermaid (.md) e copiar Mermaid na barra do diagrama", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toContain(">Exportar PNG<");
    expect(markup).toContain(">Exportar Mermaid (.md)<");
    expect(markup).toContain(">Copiar Mermaid<");
  });

  it("aplica a família e o tamanho da fonte das preferências do usuário ao SVG do diagrama", () => {
    const layout = build(withKeys, ["ordem_producao", "maquina"]);
    const markup = renderToStaticMarkup(
      createElement(DiagramCanvas, {
        layout,
        schema: "producao",
        tableCount: layout.boxes.length,
        foreignKeyCount: layout.edges.length,
        omitted: 0,
        fetching: false,
        onOpenTable: noop,
        onRefresh: noop,
        preferences: {
          ...defaultPreferences,
          theme: "dracula",
          ui: { ...defaultPreferences.ui, fontFamily: "Inter" },
          editor: { ...defaultPreferences.editor, fontFamily: "JetBrains Mono", fontSize: 16 },




        },
      }),
    );

    expect(markup).toContain("JetBrains Mono");
    expect(markup).toContain("font-size:16px");
  });
});
