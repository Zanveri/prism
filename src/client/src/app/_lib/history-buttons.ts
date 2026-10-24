import { mouseHistoryAction } from "@/app/workbench/_lib/tab-history";

type Target = Pick<Window, "addEventListener" | "removeEventListener">;

const types = ["mousedown", "mouseup", "auxclick"] as const;

/**
 * Os botões "voltar" e "avançar" do mouse (os botões 4 e 5, `MouseEvent.button` 3 e 4) nunca navegam o Chromium (RN-ABAS-018). As rotas são em hash e
 * a janela guarda o histórico delas; o botão "voltar" levava a quem estivesse na entrada anterior, as Configurações em geral. O clique é seguro em
 * `mousedown`, `mouseup` e `auxclick`, na fase de captura, antes de qualquer outro ouvinte: o que a tela faz com o botão (Voltar entre as abas) é dela, em
 * `useTabHistory`, e no login, no desbloqueio e fora da área de trabalho o botão não faz nada. Devolve como soltar.
 */
export function blockHistoryButtons(target: Target): () => void {
  const hold = (event: Event) => {
    if (mouseHistoryAction((event as MouseEvent).button) !== null) event.preventDefault();
  };

  for (const type of types) target.addEventListener(type, hold, true);
  return () => {
    for (const type of types) target.removeEventListener(type, hold, true);
  };
}
