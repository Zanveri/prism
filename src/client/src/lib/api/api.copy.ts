import { pickCopy, type Localized } from "@/lib/i18n";

import { apiCopyEn } from "./api.copy.en";
import { apiCopyEs } from "./api.copy.es";

const pt = {
  /** O `title` dos erros que só a tela emite (`NETWORK_ERROR`, `RESPONSE_INVALID`) e o aviso do erro que não é da API (RN-AVISO-004). */
  noResponse: "Sem resposta da API.",
  invalidResponse: "A API respondeu em um formato inesperado.",
  unexpectedError: "Erro inesperado.",
  vaultLocked: "Cofre fechado. Entre de novo.",
  /** Fora do Electron (o navegador do desenvolvimento) a ponte não existe: a dica das entradas desabilitadas. */
  outsideElectron: {
    export: "Exportar só funciona no app do Prism.",
    import: "Importar só funciona no app do Prism.",
    dbeaver: "Importar do DBeaver só funciona no app do Prism.",
  },
} as const;

export type ApiCopy = Localized<typeof pt>;
export const apiCopy = pickCopy({ "pt-BR": pt, en: apiCopyEn, es: apiCopyEs });
