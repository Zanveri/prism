import { settingsCopy } from "./settings.copy";
import type { ThemeId } from "./theme";

/**
 * Os temas disponíveis (RN-CONFIG-001 e RN-CONFIG-003): Prism Escuro, Prism Claro, Monokai, Dracula, Nord, GitHub Claro e Kanagawa.
 * Cada tema adicional é um bloco de `globals.css`; "seguir o sistema" escolhe entre o Prism Escuro e o Prism Claro.
 */
export type ThemeOption = { mode: ThemeId; name: string; kind: string };

const names = settingsCopy.appearance.themes;

export const themeOptions: readonly ThemeOption[] = [
  { mode: "dark", ...names.dark },
  { mode: "light", ...names.light },
  { mode: "monokai", ...names.monokai },
  { mode: "dracula", ...names.dracula },
  { mode: "nord", ...names.nord },
  { mode: "github-light", ...names.githubLight },
  { mode: "kanagawa", ...names.kanagawa },
];

/**
 * As nove cores com que o canvas desenha a prévia de cada tema (`lista`, no script do `Configuracoes.dc.html`). A prévia
 * mostra o tema que NÃO está aplicado, então não pode ler os tokens do CSS: tem valores próprios, e `themes.test.ts`
 * confere que são os mesmos dos tokens (bg é o background; painel, o panel; linha, o border; fg, o ink; kw, o syntax-keyword;
 * str, o syntax-string; num, o syntax-number; com, o syntax-comment; rolagem, o border-strong).
 *
 * Onde a cor do canvas, sozinha, não passa em 4,5:1, a prévia (e o token) levam a mais próxima que passa, e a prévia mostra o tema como ele é:
 * - Prism Claro, `str`: #097244, e não o #0B7A4B do canvas, que dava 4,37:1 sobre a linha selecionada;
 * - Monokai, `kw` e `num`: #FB72A3 e #B48AFF, e não o #F92672 (3,9:1 sobre o fundo) e o #AE81FF (4,2:1 sobre a linha selecionada);
 * - Nord, `kw`, `num` e `com`: #98B2CC, #C5A7BF e #A5B0C4, e não o #81A1C1 (3,7:1 sobre a linha selecionada), o #B48EAD (4,4:1 sobre o fundo) e o #9AA6BD (4,0:1 sobre a linha selecionada).
 */
export type ThemePreview = { bg: string; painel: string; linha: string; fg: string; kw: string; str: string; num: string; com: string; rolagem: string };

export const themePreviews: Record<ThemeId, ThemePreview> = {
  dark: { bg: "#0E1114", painel: "#14181D", linha: "#2A313B", fg: "#E6EAF0", kw: "#7DB2FF", str: "#5ED3A3", num: "#F2B644", com: "#8E99A8", rolagem: "#38414D" },
  light: { bg: "#F7F8FA", painel: "#ECEFF3", linha: "#D5DAE1", fg: "#1B2027", kw: "#1D5FD1", str: "#097244", num: "#8A5200", com: "#5F6875", rolagem: "#B4BCC8" },
  monokai: { bg: "#272822", painel: "#1E1F1C", linha: "#3E3D32", fg: "#F8F8F2", kw: "#FB72A3", str: "#E6DB74", num: "#B48AFF", com: "#A6A28C", rolagem: "#5A594E" },
  dracula: { bg: "#282A36", painel: "#21222C", linha: "#44475A", fg: "#F8F8F2", kw: "#FF79C6", str: "#F1FA8C", num: "#BD93F9", com: "#9AA5CE", rolagem: "#6272A4" },
  nord: { bg: "#2E3440", painel: "#272C36", linha: "#434C5E", fg: "#D8DEE9", kw: "#98B2CC", str: "#A3BE8C", num: "#C5A7BF", com: "#A5B0C4", rolagem: "#4C566A" },
  "github-light": { bg: "#FFFFFF", painel: "#F6F8FA", linha: "#D1D9E0", fg: "#1F2328", kw: "#CF222E", str: "#0A3069", num: "#0550AE", com: "#59636E", rolagem: "#AFB8C1" },
  kanagawa: { bg: "#1F1F28", painel: "#1A1A22", linha: "#54546D", fg: "#DCD7BA", kw: "#7E9CD8", str: "#98BB6C", num: "#DCA561", com: "#727169", rolagem: "#54546D" },
};
