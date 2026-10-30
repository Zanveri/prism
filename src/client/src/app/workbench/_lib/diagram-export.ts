import { resolvedFontFamily } from "@/app/settings/_lib/fonts";
import type { Preferences } from "@/app/settings/_lib/preferences";
import { appliedTheme, systemPrefersLight, type ThemeId } from "@/app/settings/_lib/theme";

import { saveBlob, saveText } from "./save-file";
import { diagramMetrics, fitText, fitTitle, rowHeight, type DiagramBox, type DiagramLayout } from "./table-diagram";

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
  anuppuccin: {
    background: "#1e1e2e",
    panel: "#181825",
    raised: "#11111b",
    selected: "#313244",
    border: "#313244",
    borderStrong: "#45475a",
    ink: "#cdd6f4",
    muted: "#a9b0ca",
    subtle: "#a5aabf",
    accent: "#cba6f7",
    postgres: "#89b4fa",
  },
  "anuppuccin-frappe": {
    background: "#282b3a",
    panel: "#292c3c",
    raised: "#232634",
    selected: "#3e4255",
    border: "#414559",
    borderStrong: "#51576d",
    ink: "#c6d0f5",
    muted: "#b5bbd7",
    subtle: "#afb5cc",
    accent: "#cea6e8",
    postgres: "#99b4f0",
  },
  "anuppuccin-macchiato": {
    background: "#24273a",
    panel: "#1e2030",
    raised: "#181926",
    selected: "#363a4f",
    border: "#363a4f",
    borderStrong: "#494d64",
    ink: "#cad3f5",
    muted: "#b3bad3",
    subtle: "#afb4ca",
    accent: "#c6a0f6",
    postgres: "#8aadf4",
  },
  "anuppuccin-latte": {
    background: "#fafbfc",
    panel: "#e6e9ef",
    raised: "#f4f5f8",
    selected: "#e8eaee",
    border: "#ccd0da",
    borderStrong: "#bcc0cc",
    ink: "#1e2030",
    muted: "#474962",
    subtle: "#505368",
    accent: "#7013ea",
    postgres: "#094cd2",
  },
  "anuppuccin-rosepine-light": {
    background: "#fdfaf7",
    panel: "#f2e9de",
    raised: "#f8f5f0",
    selected: "#ece9e9",
    border: "#dfdad9",
    borderStrong: "#cecacd",
    ink: "#282538",
    muted: "#534e73",
    subtle: "#595472",
    accent: "#6c5685",
    postgres: "#27667f",
  },
  "blue-topaz": {
    background: "#181c24",
    panel: "#13171e",
    raised: "#1f2430",
    selected: "#283040",
    border: "#2a3242",
    borderStrong: "#3a465e",
    ink: "#e6eef8",
    muted: "#9fb0c7",
    subtle: "#93a5bb",
    accent: "#42a5f5",
    postgres: "#42a5f5",
  },
  "blue-topaz-light": {
    background: "#f9fbfd",
    panel: "#edf2f8",
    raised: "#e4ebf5",
    selected: "#e2ebf6",
    border: "#cfdbe8",
    borderStrong: "#b0c4db",
    ink: "#0a111b",
    muted: "#3b4f69",
    subtle: "#4f637f",
    accent: "#0256d4",
    postgres: "#1d5bbf",
  },
  obsidianite: {
    background: "#100e17",
    panel: "#0d0b12",
    raised: "#191621",
    selected: "#252031",
    border: "#262133",
    borderStrong: "#3b334f",
    ink: "#eef4f8",
    muted: "#a3b5c4",
    subtle: "#8093a5",
    accent: "#0fb6d6",
    postgres: "#45aaff",
  },
  "obsidianite-light": {
    background: "#fbfbfb",
    panel: "#f2f4f5",
    raised: "#e8ecee",
    selected: "#e6eaec",
    border: "#d4dcdf",
    borderStrong: "#b5c2c7",
    ink: "#121618",
    muted: "#475157",
    subtle: "#576268",
    accent: "#096a7e",
    postgres: "#1d5bbf",
  },
  atom: {
    background: "#272b34",
    panel: "#20242b",
    raised: "#1a1e24",
    selected: "#353b47",
    border: "#424958",
    borderStrong: "#545d70",
    ink: "#f0f2f5",
    muted: "#afb6c2",
    subtle: "#abb0ba",
    accent: "#61afef",
    postgres: "#61afef",
  },
  "atom-light": {
    background: "#fafafa",
    panel: "#eaeaeb",
    raised: "#f5f5f6",
    selected: "#eaeaea",
    border: "#dbdbdc",
    borderStrong: "#c2c2c4",
    ink: "#1f2026",
    muted: "#50535e",
    subtle: "#5b5e69",
    accent: "#085cbf",
    postgres: "#085cbf",
  },
  typewriter: {
    background: "#262626",
    panel: "#202020",
    raised: "#1a1a1a",
    selected: "#363636",
    border: "#383838",
    borderStrong: "#4d4d4d",
    ink: "#f2f2f2",
    muted: "#b3b3b3",
    subtle: "#a8a8a8",
    accent: "#6fbf7b",
    postgres: "#78a9ff",
  },
  "typewriter-light": {
    background: "#fefaf2",
    panel: "#f7ecd2",
    raised: "#f9f5e9",
    selected: "#f2e9d6",
    border: "#dfd0ad",
    borderStrong: "#c7b68f",
    ink: "#0f0e0d",
    muted: "#4f4a40",
    subtle: "#5e584d",
    accent: "#316839",
    postgres: "#1f5aa6",
  },
  willemstad: {
    background: "#1c1f21",
    panel: "#16191b",
    raised: "#222629",
    selected: "#2d3337",
    border: "#2f363a",
    borderStrong: "#434c52",
    ink: "#edf2f4",
    muted: "#a5b4ba",
    subtle: "#9aa8ac",
    accent: "#38b29a",
    postgres: "#5aa9e6",
  },
  "willemstad-light": {
    background: "#fafafb",
    panel: "#eff2f5",
    raised: "#e5eaee",
    selected: "#e5ebef",
    border: "#d0dae0",
    borderStrong: "#b3c2cc",
    ink: "#0e1416",
    muted: "#425257",
    subtle: "#526368",
    accent: "#166973",
    postgres: "#1b588c",
  },
  "obsidian-gruvbox": {
    background: "#282828",
    panel: "#1d2021",
    raised: "#32302f",
    selected: "#3c3836",
    border: "#3c3836",
    borderStrong: "#504945",
    ink: "#fbf1c7",
    muted: "#d5c4a1",
    subtle: "#bdae93",
    accent: "#fe841f",
    postgres: "#8aaa9e",
  },
  "obsidian-gruvbox-light": {
    background: "#fefbee",
    panel: "#f9f2df",
    raised: "#faf5ea",
    selected: "#f0e9d7",
    border: "#d5c4a1",
    borderStrong: "#bdae93",
    ink: "#1d2021",
    muted: "#504945",
    subtle: "#5b534b",
    accent: "#a03503",
    postgres: "#076273",
  },
  primary: {
    background: "#211c18",
    panel: "#1b1714",
    raised: "#28221d",
    selected: "#362d26",
    border: "#362d26",
    borderStrong: "#4d4036",
    ink: "#f2e5d5",
    muted: "#bfa88f",
    subtle: "#b09e8b",
    accent: "#e5a454",
    postgres: "#6eb5e5",
  },
  "primary-light": {
    background: "#fcfaf7",
    panel: "#f6f2eb",
    raised: "#efe9df",
    selected: "#eee9e1",
    border: "#dfd6c7",
    borderStrong: "#c9bda9",
    ink: "#161009",
    muted: "#594630",
    subtle: "#6f583f",
    accent: "#934e13",
    postgres: "#1d5d8f",
  },
  catppuccin: {
    background: "#1e1e2e",
    panel: "#181825",
    raised: "#11111b",
    selected: "#313244",
    border: "#313244",
    borderStrong: "#45475a",
    ink: "#cdd6f4",
    muted: "#a9b0ca",
    subtle: "#a5aabf",
    accent: "#b4befe",
    postgres: "#89b4fa",
  },
  "catppuccin-frappe": {
    background: "#282b3a",
    panel: "#292c3c",
    raised: "#232634",
    selected: "#3e4255",
    border: "#414559",
    borderStrong: "#51576d",
    ink: "#c6d0f5",
    muted: "#b5bbd7",
    subtle: "#afb5cc",
    accent: "#babbf1",
    postgres: "#99b4f0",
  },
  "catppuccin-macchiato": {
    background: "#24273a",
    panel: "#1e2030",
    raised: "#181926",
    selected: "#363a4f",
    border: "#363a4f",
    borderStrong: "#494d64",
    ink: "#cad3f5",
    muted: "#b3bad3",
    subtle: "#afb4ca",
    accent: "#b7bdf8",
    postgres: "#8aadf4",
  },
  "catppuccin-latte": {
    background: "#fafbfc",
    panel: "#e6e9ef",
    raised: "#f4f5f8",
    selected: "#e8eaee",
    border: "#ccd0da",
    borderStrong: "#bcc0cc",
    ink: "#1e2030",
    muted: "#474962",
    subtle: "#505368",
    accent: "#1236fc",
    postgres: "#094cd2",
  },
  prism: {
    background: "#2e2e2e",
    panel: "#1f1f1f",
    raised: "#141414",
    selected: "#3d3d3d",
    border: "#3d3d3d",
    borderStrong: "#525252",
    ink: "#f2f2f2",
    muted: "#bdbdbd",
    subtle: "#b3b3b3",
    accent: "#b29bf9",
    postgres: "#8ea8f8",
  },
  "prism-mocha": {
    background: "#30241c",
    panel: "#211913",
    raised: "#17110d",
    selected: "#423227",
    border: "#423227",
    borderStrong: "#574335",
    ink: "#f5ece6",
    muted: "#c4b2a5",
    subtle: "#b4a499",
    accent: "#b592f6",
    postgres: "#8ca6f5",
  },
  "prism-indigo": {
    background: "#1f2647",
    panel: "#14192e",
    raised: "#0e1221",
    selected: "#2d3763",
    border: "#2d3763",
    borderStrong: "#3f4d87",
    ink: "#edf0fa",
    muted: "#b0bce0",
    subtle: "#a5b0d0",
    accent: "#b695f8",
    postgres: "#8ea8f8",
  },
  "prism-pine": {
    background: "#173619",
    panel: "#0e2110",
    raised: "#09170a",
    selected: "#214c24",
    border: "#224d25",
    borderStrong: "#316b35",
    ink: "#eaf5eb",
    muted: "#a8c4aa",
    subtle: "#9fb8a1",
    accent: "#73d68f",
    postgres: "#98aff9",
  },
  "prism-cherry": {
    background: "#471a19",
    panel: "#2e1110",
    raised: "#210c0b",
    selected: "#612422",
    border: "#612422",
    borderStrong: "#7d312e",
    ink: "#faeceb",
    muted: "#d4b0ae",
    subtle: "#c3a4a1",
    accent: "#f58e9b",
    postgres: "#9bb2fa",
  },
  "prism-swan": {
    background: "#ffffff",
    panel: "#f5f5f5",
    raised: "#ededed",
    selected: "#eaeaea",
    border: "#dedede",
    borderStrong: "#c4c4c4",
    ink: "#161616",
    muted: "#4d4d4d",
    subtle: "#5c5c5c",
    accent: "#6538d4",
    postgres: "#2655c7",
  },
  "prism-latte": {
    background: "#fcfaf8",
    panel: "#f5ede6",
    raised: "#f8f4f0",
    selected: "#f0e9e2",
    border: "#ded0c3",
    borderStrong: "#c7b5a5",
    ink: "#100b07",
    muted: "#574230",
    subtle: "#68513d",
    accent: "#6538d4",
    postgres: "#2553c3",
  },
  "prism-periwinkle": {
    background: "#f9fbfd",
    panel: "#edf1f9",
    raised: "#e3e9f5",
    selected: "#e4eaf6",
    border: "#d2dced",
    borderStrong: "#b5c4de",
    ink: "#0b1224",
    muted: "#394a70",
    subtle: "#4b5c81",
    accent: "#5b2ec9",
    postgres: "#1e4ec2",
  },
  "prism-pistachio": {
    background: "#fbfdf9",
    panel: "#eff6ec",
    raised: "#e5f0e1",
    selected: "#e2edde",
    border: "#d3e3cd",
    borderStrong: "#b7cfb0",
    ink: "#172713",
    muted: "#3f5939",
    subtle: "#4c6547",
    accent: "#296f22",
    postgres: "#1e4ec2",
  },
  "prism-peach": {
    background: "#fdfaf9",
    panel: "#f9efed",
    raised: "#f5e6e4",
    selected: "#f4e7e6",
    border: "#e8d3d0",
    borderStrong: "#d1b6b2",
    ink: "#080303",
    muted: "#613835",
    subtle: "#784d49",
    accent: "#b42821",
    postgres: "#1e4ec2",
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
    const boxRowChars = box.width === 264 ? metrics.rowChars : Math.max(metrics.rowChars, Math.floor((metrics.rowChars * (box.width - 40)) / (264 - 32)));
    const rawTitle = box.title ?? box.ref.name;
    ctx.font = `600 ${metrics.titleFontSize}px ${uiFontFamily}`;
    ctx.fillStyle = box.center ? palette.ink : palette.muted;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(fitTitle(rawTitle, boxRowChars - 1).text, box.x + 16, box.y + 12 + rowHeight / 2);

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
