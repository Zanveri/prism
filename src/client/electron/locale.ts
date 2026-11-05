/**
 * O idioma do programa, desta instalação, e não do usuário: a tela de entrada já abre nele, antes de se saber quem entra (como o zoom e o tema). O
 * processo principal o lê de `locale.json` ao abrir e o põe em `additionalArguments`; o preload o lê em `process.argv`, e a tela escolhe os textos
 * de cada `*.copy.ts` uma vez, ao carregar. Por isso trocar o idioma vale na próxima abertura. Puro e sem Node: a tela também o importa.
 *
 * O código é também a etiqueta do `Intl` (números e datas no mesmo idioma dos textos). Um idioma novo entra nesta lista e no `localeNames`; o
 * `pnpm typecheck` aponta então cada `*.copy.ts` que ainda não tem a tradução dele.
 */
export const locales = ["pt-BR", "en", "es"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "pt-BR";

/** O nome de cada idioma escrito nele mesmo: quem não lê o idioma atual ainda acha o seu na lista. */
export const localeNames: Record<Locale, string> = { "pt-BR": "Português (Brasil)", en: "English", es: "Español" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** O conteúdo de `locale.json`. O que não é um dos idiomas vale o padrão. */
export function parseLocale(json: string): Locale {
  try {
    const value: unknown = (JSON.parse(json) as { locale?: unknown } | null)?.locale;
    return isLocale(value) ? value : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

const prefix = "--prism-locale=";

export function localeArgument(locale: Locale): string {
  return `${prefix}${locale}`;
}

/** O padrão quando o argumento não veio ou não é um dos idiomas. */
export function localeFromArgv(argv: readonly string[]): Locale {
  const value = argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  return isLocale(value) ? value : defaultLocale;
}

/**
 * A forma de uma tradução: a do português, com cada texto como `string` e cada função com os mesmos parâmetros. Uma chave a mais ou a menos
 * não compila.
 */
export type Localized<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Localized<R>
    : T extends object
      ? { readonly [K in keyof T]: Localized<T[K]> }
      : T;

/** O português, que dá a forma, e cada outro idioma nela. */
export type Translations<T> = { "pt-BR": T } & { [L in Exclude<Locale, "pt-BR">]: NoInfer<Localized<T>> };

/** Os textos de um módulo no idioma pedido. */
export function pickCopy<T>(locale: Locale, all: Translations<T>): T {
  return all[locale] as T;
}
