import { z } from "zod";

import type { PrismBridge } from "../../../electron/preload";

declare global {
  interface Window {
    /** Exposto pelo preload (`electron/preload.ts`). Não existe quando a tela abre fora do Electron. */
    prism?: PrismBridge;
  }
}

const noPreferences = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null, receiveBeta: false };

/** A pasta de dados que o processo principal diz: um caminho, e portanto texto que não é vazio. Qualquer outra resposta não é uma pasta. */
const dataFolderSchema = z.string().min(1);

/**
 * A pasta de dados em uso (os cofres e o log da API), para a tela mostrar em Configurações > Sobre. Sem pasta (`null`) quando a ponte não
 * existe, não responde, recusa o pedido ou responde algo que não é um caminho: é um dado só de leitura, e a tela passa sem ele.
 */
export async function readDataFolder(): Promise<string | null> {
  try {
    const parsed = dataFolderSchema.safeParse(await getBridge().getDataFolder());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * A ponte com o processo principal. Só em desenvolvimento, com a tela aberta num navegador comum
 * para conferência, o endereço e o token vêm de `VITE_DEV_API_URL` e `VITE_DEV_API_TOKEN`
 * (`.env.example`). O bundle de produção não leva esse ramo: `import.meta.env.DEV` é uma
 * constante, e o que está dentro do `if` sai na construção.
 */
export function getBridge(): PrismBridge {
  if (window.prism !== undefined) return window.prism;

  if (import.meta.env.DEV) {
    const config = z.object({ VITE_DEV_API_URL: z.url(), VITE_DEV_API_TOKEN: z.string().min(1) }).safeParse(import.meta.env);
    if (!config.success) throw new Error("Fora do Electron, defina VITE_DEV_API_URL e VITE_DEV_API_TOKEN em .env.local.");

    const { VITE_DEV_API_URL: url, VITE_DEV_API_TOKEN: token } = config.data;
    return {
      getApiConfig: async () => ({ baseUrl: url.replace(/\/$/, ""), token }),
      onApiExit: () => () => {},
      restartApi: async () => {},
      version: "dev",
      getDataFolder: async () => null,
      // Fora do Electron não há processo principal: nada procura atualização, e a consulta manual diz "sem origem".
      updates: {
        getState: async () => ({ status: "none" }),
        onState: () => () => {},
        onProgress: () => () => {},
        check: async () => ({ outcome: "noSource" }),
        download: async () => ({ status: "none" }),
        cancel: async () => {},
        install: async () => ({ status: "none" }),
        getPreferences: async () => noPreferences,
        setCheckOnStartup: async () => noPreferences,
        setReceiveBeta: async () => noPreferences,
        skipVersion: async () => noPreferences,
      },
    };
  }

  throw new Error("A ponte com o processo principal do Prism não está disponível.");
}
