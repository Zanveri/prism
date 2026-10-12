import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { pathsConfig } from "@/config/paths.config";

import { isOpenSettingsShortcut } from "../_lib/shortcut";

/**
 * Ctrl+, abre as Configurações de qualquer tela de dentro do cofre (RN-CONFIG-001). Fica ao lado do provedor da área de
 * trabalho (`routes.tsx`), então a área de trabalho continua montada por baixo: voltar encontra as abas como estavam.
 */
export function SettingsShortcut() {
  const navigate = useNavigate();
  const onSettings = useLocation().pathname === pathsConfig.settings;

  useEffect(() => {
    // Já estando lá, não empilha a mesma tela no histórico.
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
