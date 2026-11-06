import { pickCopy, type Localized } from "@/lib/i18n";

import { gateCopyEn } from "./gate.copy.en";
import { gateCopyEs } from "./gate.copy.es";

/** Os textos das guardas da raiz do app: a API que não sobe ou caiu (`ApiGate`) e o cofre que não pôde ser consultado (`VaultGuard`). */
const pt = {
  api: {
    opening: "Abrindo o Prism…",
    exited: "O processo da API foi encerrado.",
    title: "A API do Prism não está em execução",
    restart: "Reiniciar",
  },
  vault: {
    checkFailed: "Não foi possível consultar o cofre.",
    retry: "Tentar de novo",
  },
} as const;

export type GateCopy = Localized<typeof pt>;
export const gateCopy = pickCopy({ "pt-BR": pt, en: gateCopyEn, es: gateCopyEs });
