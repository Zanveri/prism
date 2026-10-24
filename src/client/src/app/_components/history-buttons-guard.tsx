import { useEffect } from "react";

import { blockHistoryButtons } from "@/app/_lib/history-buttons";

/**
 * RN-ABAS-018: os botões "voltar" e "avançar" do mouse nunca andam pelo histórico das rotas, em nenhuma tela (nem no login nem no desbloqueio). Fica ao lado do roteador,
 * em `app.tsx`, fora das rotas, e não desenha nada.
 */
export function HistoryButtonsGuard() {
  useEffect(() => blockHistoryButtons(window), []);
  return null;
}
