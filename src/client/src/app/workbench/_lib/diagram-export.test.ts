import { describe, expect, it, vi } from "vitest";

import { defaultPreferences, type Preferences } from "@/app/settings/_lib/preferences";

import type { SchemaDiagram } from "./database-sessions.schema";
import { diagramFileName, pngExportScale, renderDiagramToCanvas, resolveDiagramStyle, toMermaidErDiagram, toMermaidMarkdown } from "./diagram-export";
import { layoutSchemaDiagram } from "./schema-diagram";

const sampleDiagram: SchemaDiagram = {
  tables: [
    {
      name: "pedidos",
      columns: [
        { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
        { name: "cliente_id", type: "bigint", isNullable: false, isPrimaryKey: false },
        { name: "valor_total", type: "numeric(12,2)", isNullable: false, isPrimaryKey: false },
      ],
    },
    {
      name: "clientes",
      columns: [
        { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
        { name: "nome", type: "varchar(80)", isNullable: false, isPrimaryKey: false },
      ],
    },
  ],
  foreignKeys: [
    {
      name: "fk_pedido_cliente",
      referencingTable: "pedidos",
      columns: ["cliente_id"],
      referencedSchema: "loja",
      referencedTable: "clientes",
      referencedColumns: ["id"],
    },
  ],
};

describe("resolveDiagramStyle: tema, fonte e tamanho de fonte do usuário", () => {
  it("resolve a paleta do tema escolhido e as famílias de fonte sem var()", () => {
    const custom: Preferences = {
      ...defaultPreferences,
      theme: "dracula",
      ui: { ...defaultPreferences.ui, fontFamily: "Inter" },
      editor: { ...defaultPreferences.editor, fontFamily: "JetBrains Mono", fontSize: 15 },
    };

    const style = resolveDiagramStyle(custom, false);

    expect(style.themeId).toBe("dracula");
    expect(style.palette.background).toBe("#282a36");
    expect(style.palette.ink).toBe("#f8f8f2");
    expect(style.uiFontFamily).toContain('"Inter"');
    expect(style.editorFontFamily).toContain('"JetBrains Mono"');
    expect(style.metrics.fontSize).toBe(15);
  });

  it("respeita o modo do sistema quando o tema é 'system'", () => {
    const systemPrefs: Preferences = { ...defaultPreferences, theme: "system" };

    expect(resolveDiagramStyle(systemPrefs, true).themeId).toBe("light");
    expect(resolveDiagramStyle(systemPrefs, false).themeId).toBe("dark");
  });
});

describe("toMermaidErDiagram e toMermaidMarkdown: exportação Mermaid com estilo do usuário", () => {
  it("gera erDiagram com entidades, colunas PK/FK e relacionamentos e diretiva init com fonte e cores do usuário", () => {
    const layout = layoutSchemaDiagram("loja", sampleDiagram);
    const prefs: Preferences = {
      ...defaultPreferences,
      theme: "nord",
      editor: { ...defaultPreferences.editor, fontFamily: "Fira Code", fontSize: 14 },
    };
    const style = resolveDiagramStyle(prefs, false);

    const mermaid = toMermaidErDiagram(layout, style);
    expect(mermaid).toContain("erDiagram");
    expect(mermaid).toContain('"pedidos" {');
    expect(mermaid).toContain("bigint id PK");
    expect(mermaid).toContain("bigint cliente_id FK");
    expect(mermaid).toContain('"pedidos" }o--|| "clientes" : "fk_pedido_cliente"');
    expect(mermaid).toContain("Fira Code");
    expect(mermaid).toContain("#2e3440");

    const markdown = toMermaidMarkdown(layout, style, "loja");
    expect(markdown).toContain("# Diagrama — loja");
    expect(markdown).toContain("```mermaid\n");
    expect(markdown).toContain("\n```\n");
  });
});

describe("pngExportScale e renderDiagramToCanvas: exportação PNG em alta definição", () => {
  it("usa escala 3x por padrão e reduz proporcionalmente se o desenho ultrapassar o limite do canvas", () => {
    expect(pngExportScale(800, 600)).toBe(3);
    const hugeScale = pngExportScale(10_000, 8_000);
    expect(hugeScale).toBeLessThan(3);
    expect(10_000 * hugeScale).toBeLessThanOrEqual(16_384);
  });

  it("desenha fundo, arestas, caixas e textos com a fonte e o tema do usuário no contexto 2D", () => {
    const layout = layoutSchemaDiagram("loja", sampleDiagram);
    const style = resolveDiagramStyle(
      {
        ...defaultPreferences,
        theme: "kanagawa",
        editor: { ...defaultPreferences.editor, fontFamily: "Cascadia Code", fontSize: 16 },
      },
      false,
    );

    const fillTexts: string[] = [];
    const fontsUsed: string[] = [];
    let currentFont = "";
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      setLineDash: vi.fn(),
      fillText: vi.fn((text: string) => {
        fillTexts.push(text);
        fontsUsed.push(currentFont);
      }),
      set font(value: string) {
        currentFont = value;
      },
      get font() {
        return currentFont;
      },
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      textBaseline: "middle" as CanvasTextBaseline,
      textAlign: "left" as CanvasTextAlign,
    } as unknown as CanvasRenderingContext2D;

    renderDiagramToCanvas(ctx, layout, style, 3);

    expect(ctx.scale).toHaveBeenCalledWith(3, 3);
    expect(fillTexts).toContain("pedidos");
    expect(fillTexts).toContain("clientes");
    expect(fillTexts).toContain("PK");
    expect(fillTexts).toContain("FK");
    expect(fontsUsed.some((font) => font.includes("16px") && font.includes("Cascadia Code"))).toBe(true);
  });

  it("gera nomes de arquivo limpos com a extensão pedida", () => {
    expect(diagramFileName("loja.pedidos", "png")).toBe("diagrama-loja.pedidos.png");
    expect(diagramFileName("banco/principal", "md")).toBe("diagrama-banco-principal.md");
  });
});
