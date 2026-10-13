import { useLayoutEffect } from "react";

import { applyFonts, clearFonts } from "../_lib/fonts";
import { usePreferences } from "../_lib/use-preferences";

/**
 * Aplica as fontes do usuário do cofre aberto (RN-CONFIG-008): a da interface e a do editor SQL vão para as variáveis do <html> (`fonts.ts`), na
 * hora em que mudam em Configurações, e em todas as janelas (cada uma monta o seu; a gravação de outra janela chega pelo `storage`). Fica dentro
 * do guard do cofre, como o `ThemeSync`: só com o cofre aberto há usuário. Ao desmontar (sair do cofre) a janela volta às fontes do app: diferente
 * do tema, nada das fontes é lembrado no dispositivo, e o login não mostra a escolha de quem usou o app por último.
 *
 * O editor SQL não depende destas variáveis: ele recebe a fonte pelas preferências (`sql-editor.tsx`), para o CodeMirror medir o texto de novo. As
 * variáveis servem ao resto: a interface inteira (`--font-sans`) e os campos de SQL fora do editor (`font-editor`).
 */
export function FontSync() {
  const { preferences, signedIn } = usePreferences();
  const ui = preferences.ui.fontFamily;
  const editor = preferences.editor.fontFamily;

  useLayoutEffect(() => {
    if (!signedIn) return;

    applyFonts({ ui, editor });
    return () => clearFonts();
  }, [signedIn, ui, editor]);

  return null;
}
