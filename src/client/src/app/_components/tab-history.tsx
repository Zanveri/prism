import { useTabHistory } from "@/app/workbench/_lib/use-tab-history";

/**
 * Voltar e Avançar entre as abas (RN-ABAS-018). Fica ao lado do provedor da área de trabalho (`routes.tsx`), como o `SettingsShortcut`, e não desenha nada.
 */
export function TabHistory() {
  useTabHistory();
  return null;
}
