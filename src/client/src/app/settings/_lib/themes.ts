import { settingsCopy } from "./settings.copy";
import type { ThemeId } from "./theme";

/** Uma variante (sub-tema) selecionável dentro de uma família de tema. */
export type ThemeVariantOption = { mode: ThemeId; label: string; kind: string };

/**
 * Os temas disponíveis (RN-CONFIG-001 e RN-CONFIG-003): os do canvas, Kanagawa e os dez temas com variantes inspirados no Obsidian.
 * Cada tema e variante adicional é um bloco de `globals.css`; "seguir o sistema" escolhe entre o Prism Escuro e o Prism Claro.
 */
export type ThemeOption = {
  mode: ThemeId;
  name: string;
  kind: string;
  variants?: readonly ThemeVariantOption[];
};

const names = settingsCopy.appearance.themes;
const variants = settingsCopy.appearance.variants;

export const themeOptions: readonly ThemeOption[] = [
  { mode: "dark", ...names.dark },
  { mode: "light", ...names.light },
  { mode: "monokai", ...names.monokai },
  { mode: "dracula", ...names.dracula },
  { mode: "nord", ...names.nord },
  { mode: "github-light", ...names.githubLight },
  { mode: "kanagawa", ...names.kanagawa },
  {
    mode: "anuppuccin",
    ...names.anuppuccin,
    variants: [
      { mode: "anuppuccin", ...variants.mocha },
      { mode: "anuppuccin-frappe", ...variants.frappe },
      { mode: "anuppuccin-macchiato", ...variants.macchiato },
      { mode: "anuppuccin-latte", ...variants.latte },
      { mode: "anuppuccin-rosepine-light", ...variants.rosepineLight },
    ],
  },
  {
    mode: "blue-topaz",
    ...names.blueTopaz,
    variants: [
      { mode: "blue-topaz", ...variants.dark },
      { mode: "blue-topaz-light", ...variants.light },
    ],
  },
  {
    mode: "obsidianite",
    ...names.obsidianite,
    variants: [
      { mode: "obsidianite", ...variants.dark },
      { mode: "obsidianite-light", ...variants.light },
    ],
  },
  {
    mode: "atom",
    ...names.atom,
    variants: [
      { mode: "atom", ...variants.dark },
      { mode: "atom-light", ...variants.light },
    ],
  },
  {
    mode: "typewriter",
    ...names.typewriter,
    variants: [
      { mode: "typewriter", ...variants.dark },
      { mode: "typewriter-light", ...variants.light },
    ],
  },
  {
    mode: "willemstad",
    ...names.willemstad,
    variants: [
      { mode: "willemstad", ...variants.dark },
      { mode: "willemstad-light", ...variants.light },
    ],
  },
  {
    mode: "obsidian-gruvbox",
    ...names.obsidianGruvbox,
    variants: [
      { mode: "obsidian-gruvbox", ...variants.dark },
      { mode: "obsidian-gruvbox-light", ...variants.light },
    ],
  },
  {
    mode: "primary",
    ...names.primary,
    variants: [
      { mode: "primary", ...variants.dark },
      { mode: "primary-light", ...variants.light },
    ],
  },
  {
    mode: "catppuccin",
    ...names.catppuccin,
    variants: [
      { mode: "catppuccin", ...variants.mocha },
      { mode: "catppuccin-frappe", ...variants.frappe },
      { mode: "catppuccin-macchiato", ...variants.macchiato },
      { mode: "catppuccin-latte", ...variants.latte },
    ],
  },
  {
    mode: "prism",
    ...names.prism,
    variants: [
      { mode: "prism", ...variants.raven },
      { mode: "prism-mocha", ...variants.mocha },
      { mode: "prism-indigo", ...variants.indigo },
      { mode: "prism-pine", ...variants.pine },
      { mode: "prism-cherry", ...variants.cherry },
      { mode: "prism-swan", ...variants.swan },
      { mode: "prism-latte", ...variants.latte },
      { mode: "prism-periwinkle", ...variants.periwinkle },
      { mode: "prism-pistachio", ...variants.pistachio },
      { mode: "prism-peach", ...variants.peach },
    ],
  },
];

/** Encontra a família de tema e a variante (quando houver) correspondente a um `ThemeId`. */
export function findThemeOption(id: ThemeId): { option: ThemeOption; variant?: ThemeVariantOption } {
  for (const option of themeOptions) {
    if (option.variants) {
      const variant = option.variants.find((candidate) => candidate.mode === id);
      if (variant) return { option, variant };
    } else if (option.mode === id) {
      return { option };
    }
  }
  return { option: themeOptions[0] };
}

/**
 * As nove cores com que o canvas desenha a prévia de cada tema (`lista`, no script do `Configuracoes.dc.html`). A prévia
 * mostra o tema que NÃO está aplicado, então não pode ler os tokens do CSS: tem valores próprios, e `themes.test.ts`
 * confere que são os mesmos dos tokens (bg é o background; painel, o panel; linha, o border; fg, o ink; kw, o syntax-keyword;
 * str, o syntax-string; num, o syntax-number; com, o syntax-comment; rolagem, o border-strong).
 */
export type ThemePreview = { bg: string; painel: string; linha: string; fg: string; kw: string; str: string; num: string; com: string; rolagem: string };

export const themePreviews: Record<ThemeId, ThemePreview> = {
  dark: { bg: "#0E1114", painel: "#14181D", linha: "#2A313B", fg: "#E6EAF0", kw: "#7DB2FF", str: "#5ED3A3", num: "#F2B644", com: "#8E99A8", rolagem: "#38414D" },
  light: { bg: "#F7F8FA", painel: "#ECEFF3", linha: "#D5DAE1", fg: "#1B2027", kw: "#1D5FD1", str: "#097244", num: "#8A5200", com: "#5F6875", rolagem: "#B4BCC8" },
  monokai: { bg: "#272822", painel: "#1E1F1C", linha: "#3E3D32", fg: "#F8F8F2", kw: "#FB72A3", str: "#E6DB74", num: "#B48AFF", com: "#A6A28C", rolagem: "#5A594E" },
  dracula: { bg: "#282A36", painel: "#21222C", linha: "#44475A", fg: "#F8F8F2", kw: "#FF79C6", str: "#F1FA8C", num: "#BD93F9", com: "#9AA5CE", rolagem: "#6272A4" },
  nord: { bg: "#2E3440", painel: "#272C36", linha: "#434C5E", fg: "#D8DEE9", kw: "#98B2CC", str: "#A3BE8C", num: "#C5A7BF", com: "#A5B0C4", rolagem: "#4C566A" },
  "github-light": { bg: "#FFFFFF", painel: "#F6F8FA", linha: "#D1D9E0", fg: "#1F2328", kw: "#CF222E", str: "#0A3069", num: "#0550AE", com: "#59636E", rolagem: "#AFB8C1" },
  kanagawa: { bg: "#1F1F28", painel: "#1A1A22", linha: "#54546D", fg: "#DCD7BA", kw: "#7E9CD8", str: "#98BB6C", num: "#DCA561", com: "#9C987D", rolagem: "#54546D" },
  anuppuccin: { bg: "#1E1E2E", painel: "#181825", linha: "#313244", fg: "#CDD6F4", kw: "#CBA6F7", str: "#A6E3A1", num: "#FAB387", com: "#A5AABF", rolagem: "#45475A" },
  "anuppuccin-frappe": { bg: "#282B3A", painel: "#292C3C", linha: "#414559", fg: "#C6D0F5", kw: "#D6B4EC", str: "#A6D189", num: "#F2B291", com: "#AFB5CC", rolagem: "#51576D" },
  "anuppuccin-macchiato": { bg: "#24273A", painel: "#1E2030", linha: "#363A4F", fg: "#CAD3F5", kw: "#C9A5F6", str: "#A6DA95", num: "#F5A97F", com: "#AFB4CA", rolagem: "#494D64" },
  "anuppuccin-latte": { bg: "#FAFBFC", painel: "#E6E9EF", linha: "#CCD0DA", fg: "#1E2030", kw: "#6A12DE", str: "#26601A", num: "#933601", com: "#505368", rolagem: "#BCC0CC" },
  "anuppuccin-rosepine-light": { bg: "#FDFAF7", painel: "#F2E9DE", linha: "#DFDAD9", fg: "#282538", kw: "#634F7B", str: "#245E75", num: "#9B3530", com: "#595472", rolagem: "#CECACD" },
  "blue-topaz": { bg: "#181C24", painel: "#13171E", linha: "#2A3242", fg: "#E6EEF8", kw: "#64B5F6", str: "#81C784", num: "#FFB74D", com: "#93A5BB", rolagem: "#3A465E" },
  "blue-topaz-light": { bg: "#F9FBFD", painel: "#EDF2F8", linha: "#CFDBE8", fg: "#0A111B", kw: "#0B5BD0", str: "#146F44", num: "#A64300", com: "#4F637F", rolagem: "#B0C4DB" },
  obsidianite: { bg: "#100E17", painel: "#0D0B12", linha: "#262133", fg: "#EEF4F8", kw: "#F4569D", str: "#4ADE80", num: "#FBBF24", com: "#8093A5", rolagem: "#3B334F" },
  "obsidianite-light": { bg: "#FBFBFB", painel: "#F2F4F5", linha: "#D4DCDF", fg: "#121618", kw: "#B42D32", str: "#186D3C", num: "#875600", com: "#576268", rolagem: "#B5C2C7" },
  atom: { bg: "#272B34", painel: "#20242B", linha: "#424958", fg: "#F0F2F5", kw: "#D59BE6", str: "#98C379", num: "#D7A77A", com: "#ABB0BA", rolagem: "#545D70" },
  "atom-light": { bg: "#FAFAFA", painel: "#EAEAEB", linha: "#DBDBDC", fg: "#1F2026", kw: "#831FDF", str: "#276A2B", num: "#885011", com: "#5B5E69", rolagem: "#C2C2C4" },
  typewriter: { bg: "#262626", painel: "#202020", linha: "#383838", fg: "#F2F2F2", kw: "#7EC889", str: "#A8DB9B", num: "#F5A97F", com: "#A8A8A8", rolagem: "#4D4D4D" },
  "typewriter-light": { bg: "#FEFAF2", painel: "#F7ECD2", linha: "#DFD0AD", fg: "#0F0E0D", kw: "#2B6434", str: "#2E6337", num: "#914114", com: "#5E584D", rolagem: "#C7B68F" },
  willemstad: { bg: "#1C1F21", painel: "#16191B", linha: "#2F363A", fg: "#EDF2F4", kw: "#4FD1B8", str: "#74D69D", num: "#F4A261", com: "#9AA8AC", rolagem: "#434C52" },
  "willemstad-light": { bg: "#FAFAFB", painel: "#EFF2F5", linha: "#D0DAE0", fg: "#0E1416", kw: "#125C66", str: "#186D49", num: "#9D4716", com: "#526368", rolagem: "#B3C2CC" },
  "obsidian-gruvbox": { bg: "#282828", painel: "#1D2021", linha: "#3C3836", fg: "#FBF1C7", kw: "#FD8F82", str: "#B8BB26", num: "#DB9CAE", com: "#BDAE93", rolagem: "#504945" },
  "obsidian-gruvbox-light": { bg: "#FEFBEE", painel: "#F9F2DF", linha: "#D5C4A1", fg: "#1D2021", kw: "#9D0006", str: "#4D5A00", num: "#843A69", com: "#5B534B", rolagem: "#BDAE93" },
  primary: { bg: "#211C18", painel: "#1B1714", linha: "#362D26", fg: "#F2E5D5", kw: "#F18078", str: "#7EC488", num: "#EBC159", com: "#B09E8B", rolagem: "#4D4036" },
  "primary-light": { bg: "#FCFAF7", painel: "#F6F2EB", linha: "#DFD6C7", fg: "#161009", kw: "#AD2923", str: "#266838", num: "#7F5300", com: "#6F583F", rolagem: "#C9BDA9" },
  catppuccin: { bg: "#1E1E2E", painel: "#181825", linha: "#313244", fg: "#CDD6F4", kw: "#CBA6F7", str: "#A6E3A1", num: "#FAB387", com: "#A5AABF", rolagem: "#45475A" },
  "catppuccin-frappe": { bg: "#282B3A", painel: "#292C3C", linha: "#414559", fg: "#C6D0F5", kw: "#D6B4EC", str: "#A6D189", num: "#F2B291", com: "#AFB5CC", rolagem: "#51576D" },
  "catppuccin-macchiato": { bg: "#24273A", painel: "#1E2030", linha: "#363A4F", fg: "#CAD3F5", kw: "#C9A5F6", str: "#A6DA95", num: "#F5A97F", com: "#AFB4CA", rolagem: "#494D64" },
  "catppuccin-latte": { bg: "#FAFBFC", painel: "#E6E9EF", linha: "#CCD0DA", fg: "#1E2030", kw: "#6A12DE", str: "#26601A", num: "#933601", com: "#505368", rolagem: "#BCC0CC" },
  prism: { bg: "#2E2E2E", painel: "#1F1F1F", linha: "#3D3D3D", fg: "#F2F2F2", kw: "#C2A4F9", str: "#6DD58C", num: "#F59F58", com: "#B3B3B3", rolagem: "#525252" },
  "prism-mocha": { bg: "#30241C", painel: "#211913", linha: "#423227", fg: "#F5ECE6", kw: "#B897F6", str: "#73D18E", num: "#F29B55", com: "#B4A499", rolagem: "#574335" },
  "prism-indigo": { bg: "#1F2647", painel: "#14192E", linha: "#2D3763", fg: "#EDF0FA", kw: "#C0A3F9", str: "#6DD58C", num: "#F59E56", com: "#A5B0D0", rolagem: "#3F4D87" },
  "prism-pine": { bg: "#173619", painel: "#0E2110", linha: "#224D25", fg: "#EAF5EB", kw: "#CDB6FA", str: "#73D68F", num: "#F7B37A", com: "#9FB8A1", rolagem: "#316B35" },
  "prism-cherry": { bg: "#471A19", painel: "#2E1110", linha: "#612422", fg: "#FAECEB", kw: "#C4A2FC", str: "#78DB96", num: "#F7A868", com: "#C3A4A1", rolagem: "#7D312E" },
  "prism-swan": { bg: "#FFFFFF", painel: "#F5F5F5", linha: "#DEDEDE", fg: "#161616", kw: "#6538D4", str: "#1F6B00", num: "#8E4A00", com: "#5C5C5C", rolagem: "#C4C4C4" },
  "prism-latte": { bg: "#FCFAF8", painel: "#F5EDE6", linha: "#DED0C3", fg: "#100B07", kw: "#5D2ED2", str: "#1C6100", num: "#844400", com: "#68513D", rolagem: "#C7B5A5" },
  "prism-periwinkle": { bg: "#F9FBFD", painel: "#EDF1F9", linha: "#D2DCED", fg: "#0B1224", kw: "#5B2EC9", str: "#1D6800", num: "#8F4800", com: "#4B5C81", rolagem: "#B5C4DE" },
  "prism-pistachio": { bg: "#FBFDF9", painel: "#EFF6EC", linha: "#D3E3CD", fg: "#172713", kw: "#5B2EC9", str: "#286C21", num: "#944B00", com: "#4C6547", rolagem: "#B7CFB0" },
  "prism-peach": { bg: "#FDFAF9", painel: "#F9EFED", linha: "#E8D3D0", fg: "#080303", kw: "#5B2EC9", str: "#1D6600", num: "#8C4400", com: "#784D49", rolagem: "#D1B6B2" },
};
