import { apiProcessCopyEn } from "./api-process.copy.en";
import { apiProcessCopyEs } from "./api-process.copy.es";
import { defaultLocale, pickCopy, type Locale, type Localized } from "./locale";

/**
 * As frases da partida e da queda da API que vão à tela: o aviso que ocupa a janela ("A API do Prism não está em execução", com "Reiniciar") mostra
 * o motivo, que é uma delas, seguida do fim do stderr da API como veio. O processo principal não tem `window.prism`: o `main.ts` escolhe o idioma
 * desta abertura e o passa ao `startApi`; sem ele, o português (os testes). As linhas do log continuam em português.
 */
const pt = {
  /** `api-process.ts`: a partida que não chegou ao fim. */
  notAnnounced: (seconds: number) => `A API não anunciou a porta em ${seconds} s.`,
  /** O comando que nem chegou a iniciar; `message` é a do sistema, como veio. */
  notStarted: (command: string, message: string) => `Não foi possível iniciar a API (${command}): ${message}`,
  exitedEarly: (code: number | null) => `A API saiu com código ${code} antes de anunciar a porta.`,
  /** `main.ts`: a API que saiu depois de pronta, e a que não está de pé quando a tela pede o endereço. */
  exited: (code: number | null) => `O processo da API foi encerrado (código ${code}).`,
  notRunning: "A API do Prism não está em execução.",
} as const;

export type ApiProcessCopy = Localized<typeof pt>;

/** Os textos no idioma desta abertura do app (`main.ts`); sem idioma, os do português. */
export function apiProcessCopy(locale: Locale = defaultLocale): ApiProcessCopy {
  return pickCopy(locale, { "pt-BR": pt, en: apiProcessCopyEn, es: apiProcessCopyEs });
}
