import { resolvedFontFamily } from "@/app/settings/_lib/fonts";
import type { Preferences } from "@/app/settings/_lib/preferences";
import { appliedTheme, systemPrefersLight, type ThemeId } from "@/app/settings/_lib/theme";

import { saveBlob, saveText } from "./save-file";
import { diagramMetrics, fitText, rowHeight, type DiagramBox, type DiagramLayout } from "./table-diagram";

export type DiagramPalette = {
  background: string;
  panel: string;
  raised: string;
  selected: string;
  border: string;
  borderStrong: string;
  ink: string;
  muted: string;
  subtle: string;
  accent: string;
  postgres: string;
};

/**
 * As cores de cada tema de `globals.css` resolvidas sem `light-dark()` nem `var()`,
 * para que a exportação em PNG (`<canvas>`) e a diretiva `init` do Mermaid preservem
 * exatamente o tema ativo do usuário.
 */
export const themePalettes: Record<ThemeId, DiagramPalette> = {
  dark: {
    background: "#0e1114",
    panel: "#14181d",
    raised: "#1b2027",
    selected: "#232a33",
    border: "#2a313b",
    borderStrong: "#38414d",
    ink: "#e6eaf0",
    muted: "#b4bcc8",
    subtle: "#8e99a8",
    accent: "#f2b644",
    postgres: "#7db2ff",
  },
  light: {
    background: "#f7f8fa",
    panel: "#eceff3",
    raised: "#ffffff",
    selected: "#e3e8ee",
    border: "#d5dae1",
    borderStrong: "#b4bcc8",
    ink: "#1b2027",
    muted: "#47505d",
    subtle: "#5f6875",
    accent: "#8a5200",
    postgres: "#1d5fd1",
  },
  monokai: {
    background: "#272822",
    panel: "#1e1f1c",
    raised: "#30312b",
    selected: "#373832",
    border: "#3e3d32",
    borderStrong: "#5a594e",
    ink: "#f8f8f2",
    muted: "#c7c4b5",
    subtle: "#a6a28c",
    accent: "#f2b644",
    postgres: "#7db2ff",
  },
  dracula: {
    background: "#282a36",
    panel: "#21222c",
    raised: "#32343f",
    selected: "#393a45",
    border: "#44475a",
    borderStrong: "#6272a4",
    ink: "#f8f8f2",
    muted: "#c0c6dc",
    subtle: "#9aa5ce",
    accent: "#f2b644",
    postgres: "#7db2ff",
  },
  nord: {
    background: "#2e3440",
    panel: "#272c36",
    raised: "#373d49",
    selected: "#3d434f",
    border: "#434c5e",
    borderStrong: "#4c566a",
    ink: "#d8dee9",
    muted: "#b9c2d3",
    subtle: "#a5b0c4",
    accent: "#f2b644",
    postgres: "#7db2ff",
  },
  "github-light": {
    background: "#ffffff",
    panel: "#f6f8fa",
    raised: "#ffffff",
    selected: "#ececed",
    border: "#d1d9e0",
    borderStrong: "#afb8c1",
    ink: "#1f2328",
    muted: "#424952",
    subtle: "#59636e",
    accent: "#8a5200",
    postgres: "#1d5fd1",
  },
  kanagawa: {
    background: "#1f1f28",
    panel: "#1a1a22",
    raised: "#2a2a35",
    selected: "#2a2a38",
    border: "#54546d",
    borderStrong: "#54546d",
    ink: "#dcd7ba",
    muted: "#b8b396",
    subtle: "#9c987d",
    accent: "#819fdc",
    postgres: "#7e9cd8",
  },
};

export type DiagramVisualStyle = {
  themeId: ThemeId;
  palette: DiagramPalette;
  uiFontFamily: string;
  editorFontFamily: string;
  metrics: ReturnType<typeof diagramMetrics>;
};

/** Resolve o tema, as fontes e o tamanho de fonte ativos do usuário para renderização e exportação do diagrama. */
export function resolveDiagramStyle(preferences: Preferences, prefersLight: boolean = systemPrefersLight()): DiagramVisualStyle {
  const themeId = appliedTheme(preferences.theme, prefersLight);
  return {
    themeId,
    palette: themePalettes[themeId],
    uiFontFamily: resolvedFontFamily("ui", preferences.ui.fontFamily),
    editorFontFamily: resolvedFontFamily("editor", preferences.editor.fontFamily),
    metrics: diagramMetrics(preferences.editor.fontSize),
  };
}

const sanitizeMermaidType = (type: string): string => {
  const cleaned = type
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_[\]]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned.length > 0 ? cleaned : "unknown";
};

const sanitizeMermaidIdentifier = (name: string): string => {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  return cleaned.length > 0 ? cleaned : "col";
};

const escapeMermaidEntity = (name: string): string => name.replace(/"/g, "'");

const displayEntityName = (box: DiagramBox): string => escapeMermaidEntity(box.title ?? box.ref.name);

/**
 * Converte qualquer `DiagramLayout` (tabela, esquema ou banco) num bloco `erDiagram` do Mermaid,
 * incluindo a diretiva `%%{init: ...}%%` com o tema, a fonte e o tamanho de fonte do usuário.
 */
export function toMermaidErDiagram(layout: DiagramLayout, style: DiagramVisualStyle): string {
  const initConfig = {
    theme: "base",
    themeVariables: {
      fontFamily: style.editorFontFamily,
      fontSize: `${style.metrics.fontSize}px`,
      background: style.palette.background,
      mainBkg: style.palette.panel,
      primaryColor: style.palette.panel,
      primaryTextColor: style.palette.ink,
      primaryBorderColor: style.palette.borderStrong,
      lineColor: style.palette.borderStrong,
      secondaryColor: style.palette.raised,
      tertiaryColor: style.palette.selected,
    },
  };

  const lines: string[] = [`%%{init: ${JSON.stringify(initConfig)}}%%`, "erDiagram"];
  const byKey = new Map(layout.boxes.map((box) => [box.key, box]));

  for (const box of layout.boxes) {
    const entity = displayEntityName(box);
    if (!box.columns || box.columns.length === 0) {
      lines.push(`  "${entity}" {`);
      lines.push("  }");
      continue;
    }

    lines.push(`  "${entity}" {`);
    for (const column of box.columns) {
      const colType = sanitizeMermaidType(column.type);
      const colName = sanitizeMermaidIdentifier(column.name);
      const keyMark = column.primaryKey && column.foreignKey ? " PK, FK" : column.primaryKey ? " PK" : column.foreignKey ? " FK" : "";
      lines.push(`    ${colType} ${colName}${keyMark}`);
    }
    lines.push("  }");
  }

  for (const edge of layout.edges) {
    const sourceBox = edge.fromTable ? byKey.get(edge.fromTable) : undefined;
    const targetBox = edge.toTable ? byKey.get(edge.toTable) : undefined;
    if (!sourceBox || !targetBox) continue;

    const fromEntity = displayEntityName(sourceBox);
    const toEntity = displayEntityName(targetBox);
    const label = escapeMermaidEntity(edge.name);
    lines.push(`  "${fromEntity}" }o--|| "${toEntity}" : "${label}"`);
  }

  return lines.join("\n");
}

/** Gera o documento Markdown (`.md`) contendo o diagrama Mermaid cercado por crases. */
export function toMermaidMarkdown(layout: DiagramLayout, style: DiagramVisualStyle, title?: string): string {
  const heading = title && title.trim().length > 0 ? `# Diagrama — ${title.trim()}\n\n` : "";
  return `${heading}\`\`\`mermaid\n${toMermaidErDiagram(layout, style)}\n\`\`\`\n`;
}

/**
 * Calcula o fator de escala para exportação PNG em alta definição (padrão 3x),
 * reduzindo apenas quando necessário para respeitar os limites de dimensão do `<canvas>`.
 */
export function pngExportScale(width: number, height: number, desiredScale = 3, maxSide = 16_384, maxPixels = 67_108_864): number {
  if (width <= 0 || height <= 0) return 1;
  const bySide = Math.min(maxSide / width, maxSide / height);
  const byArea = Math.sqrt(maxPixels / (width * height));
  return Math.max(1, Math.min(desiredScale, bySide, byArea));
}

const defaultTitleMaxChars = 28;
const fitTitle = (name: string, maxChars = defaultTitleMaxChars) => (name.length <= maxChars ? name : `${name.slice(0, Math.max(1, maxChars - 1))}…`);

function drawRoundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    ctx.rect(x, y, width, height);
  }
}

/**
 * Desenha o diagrama diretamente num contexto 2D de `<canvas>` na escala pedida,
 * preservando as cores do tema, a família tipográfica e o tamanho de fonte do usuário.
 */
export function renderDiagramToCanvas(ctx: CanvasRenderingContext2D, layout: DiagramLayout, style: DiagramVisualStyle, scale = 3): void {
  const { palette, uiFontFamily, editorFontFamily, metrics } = style;

  ctx.save();
  ctx.scale(scale, scale);

  // Fundo do diagrama.
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // Arestas (chaves estrangeiras) e setas.
  ctx.strokeStyle = palette.borderStrong;
  ctx.fillStyle = palette.borderStrong;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([]);

  for (const edge of layout.edges) {
    if (edge.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(edge.points[0].x, edge.points[0].y);
    for (let index = 1; index < edge.points.length; index++) {
      ctx.lineTo(edge.points[index].x, edge.points[index].y);
    }
    ctx.stroke();

    // Seta na chegada (último segmento é horizontal).
    const end = edge.points.at(-1)!;
    const prev = edge.points.at(-2)!;
    const dir = end.x >= prev.x ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - dir * 6, end.y - 3);
    ctx.lineTo(end.x - dir * 6, end.y + 3);
    ctx.closePath();
    ctx.fill();
  }

  // Caixas das tabelas.
  const headerHeight = 12 + rowHeight;
  for (const box of layout.boxes) {
    ctx.save();

    // Fundo da caixa.
    drawRoundedBox(ctx, box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1, 8);
    ctx.fillStyle = palette.panel;
    ctx.fill();

    // Faixa do cabeçalho recortada no topo arredondado da caixa.
    ctx.save();
    drawRoundedBox(ctx, box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1, 8);
    ctx.clip();
    ctx.fillStyle = box.center ? palette.raised : palette.selected;
    ctx.fillRect(box.x + 1, box.y + 1, box.width - 2, headerHeight - 1);
    ctx.restore();

    // Linha divisória abaixo do cabeçalho quando há colunas.
    if (box.columns !== null && box.columns.length > 0) {
      ctx.beginPath();
      ctx.moveTo(box.x + 1, box.y + headerHeight);
      ctx.lineTo(box.x + box.width - 1, box.y + headerHeight);
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.stroke();
    }

    // Borda externa da caixa.
    drawRoundedBox(ctx, box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1, 8);
    ctx.strokeStyle = box.center ? palette.accent : palette.borderStrong;
    ctx.lineWidth = 1;
    ctx.setLineDash(box.external ? [4, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    // Título da tabela.
    const boxRowChars = box.width === 264 ? metrics.rowChars : Math.max(metrics.rowChars, Math.floor((metrics.rowChars * (box.width - 32)) / (264 - 32)));
    const rawTitle = box.title ?? box.ref.name;
    ctx.font = `600 ${metrics.titleFontSize}px ${uiFontFamily}`;
    ctx.fillStyle = box.center ? palette.ink : palette.muted;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(fitTitle(rawTitle, boxRowChars), box.x + 16, box.y + 12 + rowHeight / 2);

    // Linhas de colunas.
    for (const [index, column] of (box.columns ?? []).entries()) {
      const y = box.y + 12 + rowHeight * (index + 1) + rowHeight / 2;
      const mark = column.primaryKey ? "PK" : column.foreignKey ? "FK" : null;
      const fitted = fitText(column.name, column.type, mark, boxRowChars);
      const nameX = mark === null ? box.x + 16 : box.x + 36;

      if (mark !== null) {
        ctx.font = `600 ${metrics.markFontSize}px ${editorFontFamily}`;
        ctx.fillStyle = column.primaryKey ? palette.accent : palette.postgres;
        ctx.textAlign = "left";
        ctx.fillText(mark, box.x + 16, y);
      }

      ctx.font = `400 ${metrics.fontSize}px ${editorFontFamily}`;
      ctx.fillStyle = palette.ink;
      ctx.textAlign = "left";
      ctx.fillText(fitted.name, nameX, y);

      ctx.fillStyle = palette.subtle;
      ctx.textAlign = "right";
      ctx.fillText(fitted.type, box.x + box.width - 16, y);
    }

    ctx.restore();
  }

  ctx.restore();
}

/** Formata o nome de arquivo para exportação do diagrama (`.png` ou `.md`). */
export function diagramFileName(subject: string, extension: "png" | "md"): string {
  const safe = subject
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `diagrama-${safe.length > 0 ? safe : "esquema"}.${extension}`;
}

/** Exporta o diagrama como arquivo Markdown (`.md`) contendo o bloco Mermaid. */
export function exportDiagramMermaid(subject: string, layout: DiagramLayout, style: DiagramVisualStyle): void {
  const markdown = toMermaidMarkdown(layout, style, subject);
  saveText(diagramFileName(subject, "md"), markdown, "text/markdown;charset=utf-8");
}

/** Exporta o diagrama como imagem PNG de alta definição (`.png`) preservando fontes e tema do usuário. */
export async function exportDiagramPng(subject: string, layout: DiagramLayout, style: DiagramVisualStyle): Promise<boolean> {
  if (typeof document !== "undefined" && "fonts" in document && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Se o carregamento de fontes falhar, prossegue com a reserva do sistema.
    }
  }

  const scale = pngExportScale(layout.width, layout.height, 3);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layout.width * scale));
  canvas.height = Math.max(1, Math.round(layout.height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  renderDiagramToCanvas(ctx, layout, style, scale);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/png");
  });
  if (!blob) return false;

  saveBlob(diagramFileName(subject, "png"), blob);
  return true;
}
