import { defaultLocale, isLocale, pickCopy as pickFor, type Locale, type Localized, type Translations } from "../../electron/locale";

export type { Locale, Localized };

/**
 * O idioma desta janela, lido uma vez ao carregar, do argumento que o processo principal pôs nela (`electron/locale.ts`). No worker das variáveis,
 * que não tem a ponte, é o nome com que a janela o criou (`evaluator-host.ts`). Fora do Electron e nos testes, o português: os testes conferem os
 * textos em português.
 */
const fromBridge: unknown = globalThis.window?.prism?.locale ?? (globalThis as { name?: unknown }).name;
export const locale: Locale = isLocale(fromBridge) ? fromBridge : defaultLocale;

/** Os textos de um `*.copy.ts` no idioma desta janela. */
export function pickCopy<T>(all: Translations<T>): T {
  return pickFor(locale, all);
}
