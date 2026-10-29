import { themeModes, type ThemeMode } from "./preferences";

/**
 * O tema (RN-CONFIG-001). O CSS decide as cores pelo atributo `data-theme` do <html> (`globals.css`); aqui ficam o
 * atributo e a lembrança dele. As preferências são por usuário, mas o login acontece antes de se saber quem entrou:
 * por isso o último modo aplicado também é guardado numa chave do DISPOSITIVO, que `public/theme-boot.js` lê antes da
 * primeira pintura, e o tema do usuário entra assim que o cofre abre.
 */
export const themeStorageKey = "prism:theme";

export type Scheme = "dark" | "light";

/** Um tema que se escolhe (tudo o que o modo pode ser, menos "seguir o sistema"). */
export type ThemeId = Exclude<ThemeMode, "system">;

/**
 * O esquema de cor de cada tema: o `color-scheme` que o CSS dá ao <html> para ele (`globals.css`, um teste confere que são os mesmos). Decide o que
 * muda com o claro e o escuro e não é cor de token: a coluna das fichas `light-dark()`, a marca, a barra de rolagem e os controles do navegador,
 * e se o CodeMirror trata o editor como escuro.
 */
export const themeSchemes = {
  dark: "dark",
  light: "light",
  monokai: "dark",
  dracula: "dark",
  nord: "dark",
  "github-light": "light",
  kanagawa: "dark",
  anuppuccin: "dark",
  "anuppuccin-frappe": "dark",
  "anuppuccin-macchiato": "dark",
  "anuppuccin-latte": "light",
  "anuppuccin-rosepine-light": "light",
  "blue-topaz": "dark",
  "blue-topaz-light": "light",
  obsidianite: "dark",
  "obsidianite-light": "light",
  atom: "dark",
  "atom-light": "light",
  typewriter: "dark",
  "typewriter-light": "light",
  willemstad: "dark",
  "willemstad-light": "light",
  "obsidian-gruvbox": "dark",
  "obsidian-gruvbox-light": "light",
  primary: "dark",
  "primary-light": "light",
  catppuccin: "dark",
  "catppuccin-frappe": "dark",
  "catppuccin-macchiato": "dark",
  "catppuccin-latte": "light",
  prism: "dark",
  "prism-mocha": "dark",
  "prism-indigo": "dark",
  "prism-pine": "dark",
  "prism-cherry": "dark",
  "prism-swan": "light",
  "prism-latte": "light",
  "prism-periwinkle": "light",
  "prism-pistachio": "light",
  "prism-peach": "light",
} as const satisfies Record<ThemeId, Scheme>;

/** O mínimo que se usa do <html>: o teste passa um objeto qualquer no lugar. */
type ThemeRoot = { dataset: Record<string, string | undefined> };

function browserStorage(): Pick<Storage, "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Põe o modo no <html> e o guarda para a próxima abertura. A gravação que falha não tira o tema da tela. */
export function applyTheme(mode: ThemeMode, root: ThemeRoot = document.documentElement, storage: Pick<Storage, "setItem"> | null = browserStorage()): void {
  root.dataset.theme = mode;

  try {
    storage?.setItem(themeStorageKey, mode);
  } catch {
    // Cota cheia ou acesso bloqueado: a próxima abertura volta ao tema escuro, e só isso.
  }
}

/** O modo claro do sistema está ligado? Sem `matchMedia` (um teste, a tela fora do navegador) vale "não". */
export function systemPrefersLight(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** O tema que está na tela: o escolhido, ou, seguindo o sistema, o Prism Claro ou o Prism Escuro. */
export function appliedTheme(mode: ThemeMode, prefersLight: boolean): ThemeId {
  if (mode === "system") return prefersLight ? "light" : "dark";
  return mode;
}

/** O esquema de cor que um modo produz: cada tema tem o seu, e "system" vale o do sistema. */
export function resolveScheme(mode: ThemeMode, prefersLight: boolean): Scheme {
  return themeSchemes[appliedTheme(mode, prefersLight)];
}

/** O esquema que está aplicado agora, lido do <html> (o CSS é a fonte da verdade). Sem nada aplicado é o escuro. */
export function currentScheme(root: ThemeRoot = document.documentElement, prefersLight: boolean = systemPrefersLight()): Scheme {
  const mode = root.dataset.theme;
  return mode !== undefined && (themeModes as readonly string[]).includes(mode) ? resolveScheme(mode as ThemeMode, prefersLight) : "dark";
}

/** Avisa quando o sistema troca entre claro e escuro. Para `useSyncExternalStore`. */
export function subscribeSystemScheme(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};

  const query = window.matchMedia("(prefers-color-scheme: light)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
