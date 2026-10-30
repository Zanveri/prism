import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultPreferences } from "@/app/settings/_lib/preferences";
import type { Column, ForeignKey } from "../../_lib/database-sessions.schema";
import { layoutDiagram, referencedTables, type DiagramLayout } from "../../_lib/table-diagram";
import { DiagramCanvas, applyDiagramPan, shouldStartDiagramPan } from "./diagram-canvas";

const noop = () => {};
const column = (name: string, position: number, over: Partial<Column> = {}): Column => ({
  name,
  type: "bigint",
  isNullable: false,
  isPrimaryKey: false,
  position,
  ...over,
});
const fk = (name: string, columns: string[], referencedTable: string): ForeignKey => ({
  name,
  columns,
  referencedSchema: "producao",
  referencedTable,
  referencedColumns: ["id"],
});

const centerRef = { schema: "producao", name: "apontamento" };
const centerColumns = [
  column("id", 1, { isPrimaryKey: true }),
  column("ordem_id", 2),
  column("maquina_id", 3, { type: "numeric(12,3)" }),
];
const targetColumns = [column("id", 1, { isPrimaryKey: true }), column("nome", 2, { type: "varchar(60)" })];

function build(foreignKeys: ForeignKey[], tableNames: string[], columns: Column[] | null = targetColumns): DiagramLayout {
  const { tables } = referencedTables(centerRef, foreignKeys);
  return layoutDiagram({
    center: { ref: centerRef, columns: centerColumns },
    foreignKeys,
    neighbors: tables.filter((table) => tableNames.includes(table.name)).map((ref) => ({ ref, columns })),
  });
}

function render(layout: DiagramLayout, over: { omitted?: number; foreignKeyCount?: number; fetching?: boolean; selectedKey?: string | null } = {}) {
  return renderToStaticMarkup(
    createElement(DiagramCanvas, {
      layout,
      schema: "producao",
      tableCount: layout.boxes.length,
      foreignKeyCount: over.foreignKeyCount ?? layout.edges.length,
      omitted: over.omitted ?? 0,
      fetching: over.fetching ?? false,
      selectedKey: over.selectedKey,
      onOpenTable: noop,
      onRefresh: noop,
    }),
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
      createElement(DiagramCanvas, {
        layout,
        schema: "producao",
        tableCount: layout.boxes.length,
        foreignKeyCount: layout.edges.length,
        omitted: 0,
        fetching: false,
        onOpenTable: noop,
        onRefresh: noop,
        initial: { zoom: 0.64, left: 120, top: 40 },
      }),
    );

    expect(markup).toContain(`width="${layout.width * 0.64}" height="${layout.height * 0.64}"`);
    expect(markup).toContain(">64%<");
  });

  it("a tabela do centro e cada vizinha têm cartão em HTML; só as vizinhas abrem (botão com nome, foco por teclado)", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toMatch(/<div[^>]*role="group"[^>]*aria-label="apontamento"/);
    expect(markup).toMatch(/<div[^>]*role="button"[^>]*aria-label="Abrir ordem_producao"/);
    expect(markup).toMatch(/<div[^>]*role="button"[^>]*aria-label="Abrir maquina"/);
    expect(markup.match(/role="button"/g)).toHaveLength(2);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(3);
  });

  it("o foco por teclado de uma vizinha usa o anel de foco do app: nenhuma classe o suprime", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));
    const buttons = [...markup.matchAll(/<div[^>]*role="button"[^>]*>/g)].map((match) => match[0]);

    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).not.toMatch(/outline-none|outline-0|focus:outline|ring-0/);
      expect(button).toContain('tabindex="0"');
    }
  });

  it("as colunas com o tipo alinhado à direita e as marcas PK e FK; a vizinha só com a PK", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toContain(">ordem_id<");
    expect(markup).toContain(">numeric(12,3)<");
    expect(markup.match(/>FK<\/span>/g)).toHaveLength(2);
    expect(markup.match(/>PK<\/span>/g)).toHaveLength(3);
  });

  it("uma curva Bézier por chave estrangeira, com a dica da chave e o pé-de-galinha na ponta da FK", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toContain("<title>fk_ordem: ordem_id → ordem_producao (id)</title>");
    expect(markup).toContain("<title>fk_maquina: maquina_id → maquina (id)</title>");
    expect(markup.match(/data-edge-marker="1:N"/g)).toHaveLength(2);
  });

  it("o texto vem do banco e marcação num nome de tabela não vira elemento executável (RN-SHELL-002)", () => {
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

  it("a barra flutuante de zoom traz selecionar, mover, reduzir, o valor em 100%, ampliar, ajustar à tela e mini-mapa", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));
    const names = [...markup.matchAll(/aria-label="(Selecionar|Mover pelo diagrama|Reduzir|Ampliar|Mini-mapa)"|>(Ajustar à tela)<|>100%</g)].map(
      (match) => match[1] ?? match[2] ?? "100%",
    );

    expect(markup).toContain('role="toolbar"');
    expect(names).toEqual(["Selecionar", "Mover pelo diagrama", "Reduzir", "100%", "Ampliar", "Ajustar à tela", "Mini-mapa"]);
    expect(markup).toContain('role="img"');
  });

  it("ao selecionar uma tabela, exibe o painel flutuante lateral apenas com o nome da tabela (sem badge de esquema), Referencia e Referenciada por", () => {
    const layout = build(withKeys, ["ordem_producao", "maquina"]);
    const markup = render(layout, { selectedKey: "producao.apontamento" });

    expect(markup).toContain('aria-label="Tabela selecionada"');
    const inspectorSlice = markup.slice(markup.indexOf('aria-label="Tabela selecionada"'));
    expect(inspectorSlice).toContain(">apontamento<");
    expect(inspectorSlice).not.toContain(">producao<");
    expect(markup).toContain("Referencia (2)");
    expect(markup).toContain("ordem_producao.id");
    expect(markup).toContain("maquina.id");
  });

  it("o título conta as tabelas (a do centro incluída) e as chaves estrangeiras", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toMatch(/<span[^>]*>producao<\/span> · 3 tabelas, 2 chaves estrangeiras/);
  });

  it("a legenda explica as marcas e a seta, e que as tabelas que apontam para esta ficam à esquerda e as referenciadas à direita", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toContain("chave primária");
    expect(markup).toContain("a seta sai da tabela com a chave estrangeira e aponta para a tabela referenciada");
    expect(markup).toContain("À esquerda ficam as tabelas que apontam para esta; à direita, as que esta tabela referencia.");
  });

  it("passando do teto, diz quantas das referenciadas estão no desenho", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]), { omitted: 3 });

    expect(markup).toContain("Mostrando 2 de 5 tabelas referenciadas.");
    expect(render(build(withKeys, ["ordem_producao", "maquina"]))).not.toContain("Mostrando");
  });

  it("sem chave estrangeira, o desenho é só a tabela e a frase diz por quê", () => {
    const markup = render(build([], []), { foreignKeyCount: 0 });

    expect(markup).toContain("Esta tabela não tem chaves estrangeiras.");
    expect(markup).not.toContain("data-edge-marker");
    expect(markup).not.toContain('role="button"');
  });

  it("'Atualizar' fica desabilitado enquanto busca", () => {
    expect(render(build(withKeys, ["ordem_producao", "maquina"]), { fetching: true })).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Atualizar/);
  });

  it("agrupa exportar PNG, exportar Mermaid (.md) e copiar Mermaid num menu Exportar na barra do diagrama", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toContain("Exportar");
    expect(markup).toContain(">Exportar PNG<");
    expect(markup).toContain(">Exportar Mermaid (.md)<");
    expect(markup).toContain(">Copiar Mermaid<");
  });

  it("aplica a família e o tamanho da fonte das preferências do usuário ao plano do diagrama", () => {
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

  it("trunca títulos de tabelas muito longos com reticências e preserva o nome completo em <title> para não vazar da caixa", () => {
    const longName = "usr_migration_stock_manager_tabela_com_nome_extremamente_longo";
    const layout = layoutDiagram({
      center: { ref: { schema: "s", name: longName }, columns: [column("id", 1, { isPrimaryKey: true })] },
      foreignKeys: [],
      neighbors: [],
    });
    const markup = render(layout);

    expect(markup).toContain(`<title>${longName}</title>`);
    expect(markup).toContain("…");
  });

  it("oferece o botão das 4 setas para travar o arraste pelo botão esquerdo e permite arrastar pelo botão direito a qualquer momento", () => {
    const markup = render(build(withKeys, ["ordem_producao", "maquina"]));

    expect(markup).toMatch(/<button[^>]*aria-label="Mover pelo diagrama"[^>]*aria-pressed="false"/);
    expect(shouldStartDiagramPan(2, false)).toBe(true);
    expect(shouldStartDiagramPan(2, true)).toBe(true);
    expect(shouldStartDiagramPan(0, false)).toBe(false);
    expect(shouldStartDiagramPan(0, true)).toBe(true);
    expect(shouldStartDiagramPan(1, true)).toBe(false);

    expect(applyDiagramPan({ scrollLeft: 100, scrollTop: 80, startX: 300, startY: 200 }, { clientX: 240, clientY: 150 })).toEqual({
      scrollLeft: 160,
      scrollTop: 130,
      moved: true,
    });
    expect(applyDiagramPan({ scrollLeft: 100, scrollTop: 80, startX: 300, startY: 200 }, { clientX: 301, clientY: 201 }).moved).toBe(false);
  });
});
