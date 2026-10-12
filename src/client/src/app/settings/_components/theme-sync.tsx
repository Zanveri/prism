import { useLayoutEffect } from "react";

import { applyTheme } from "../_lib/theme";
import { usePreferences } from "../_lib/use-preferences";

/**
 * Aplica o tema do usuário do cofre aberto (RN-CONFIG-001): a abertura do app e o login usam o último tema aplicado
 * (`public/theme-boot.js`), e daqui em diante vale o dele, na hora em que muda em Configurações. Fica dentro do guard do
 * cofre porque é lá que existe usuário; sair deixa o tema como está, e quem entrar depois traz o seu.
 *
 * É um efeito de layout, que roda antes da pintura: com um efeito comum, quem entra com um tema diferente do de quem usou o app por
 * último veria um quadro com o tema do anterior.
 */
export function ThemeSync() {
  const { preferences, signedIn } = usePreferences();
  const mode = preferences.theme;

  useLayoutEffect(() => {
    if (signedIn) applyTheme(mode);
  }, [signedIn, mode]);

  return null;
}
