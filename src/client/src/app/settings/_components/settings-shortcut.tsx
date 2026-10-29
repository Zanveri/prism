import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { pathsConfig } from "@/config/paths.config";

import { isSettingsPath } from "../_lib/settings-route";
import { isOpenSettingsShortcut } from "../_lib/shortcut";

/**
 * Ctrl+, abre as Configurações de qualquer tela de dentro do cofre (RN-CONFIG-001). Fica ao lado do provedor da área de
 * trabalho (`routes.tsx`), então a área de trabalho continua montada por baixo: voltar encontra as abas como estavam.
 */
export function SettingsShortcut() {
  const navigate = useNavigate();
  const onSettings = isSettingsPath(useLocation().pathname);

  useEffect(() => {
    // Já estando lá, em qualquer seção, não empilha a tela no histórico nem tira a pessoa da página em que está.
    if (onSettings) return;

    function onKeyDown(event: KeyboardEvent) {
      if (!isOpenSettingsShortcut(event)) return;

      event.preventDefault();
      void navigate(pathsConfig.settings);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, onSettings]);

  return null;
}
