import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";

import { isSettingsPath } from "@/app/settings/_lib/settings-route";
import { pathsConfig } from "@/config/paths.config";
import { vaultLock } from "@/lib/api/vault-lock";
import { isMacPlatform } from "@/lib/utils/platform";

import { tabElementId } from "../_components/tab-strip";
import { createTabHistory, type HistoryScreen } from "./tab-history-controller";
import { popupOpen } from "./tab-focus";
import { useWorkbench } from "./workbench-state";

const screenOf = (pathname: string): HistoryScreen => (pathname === pathsConfig.workbench ? "workbench" : isSettingsPath(pathname) ? "settings" : "other");

/**
 * Voltar e Avançar entre as abas desta janela (RN-ABAS-018): registra a aba ativa a cada mudança, ouve os botões "voltar" e "avançar" do mouse e as teclas
 * (Alt+← e Alt+→; Cmd+[ e Cmd+] no macOS), e ativa a aba pelo mesmo caminho do clique nela, com o foco nela. Fica ao lado do provedor da área de trabalho
 * (`routes.tsx`): vale também com as Configurações por cima, onde Voltar volta à área de trabalho. Nenhum botão e nenhuma tecla anda pelo histórico das
 * rotas. A conta é de `tab-history.ts`, e o histórico, só da memória, zera quando o cofre bloqueia.
 */
export function useTabHistory(): void {
  const { tabs, activeTabId, setActiveTab } = useWorkbench();
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const lockEpoch = useSyncExternalStore(vaultLock.subscribe, vaultLock.epoch, vaultLock.epoch);

  const idsKey = tabs.map((tab) => tab.id).join("\n");
  const open = useMemo(() => new Set(idsKey === "" ? [] : idsKey.split("\n")), [idsKey]);

  // O que o controlador lê na hora de agir, sempre o da última renderização (um objeto só, criado uma vez, como `runners` no provedor: o lint do React não deixa
  // passar o conteúdo de uma ref a quem o cria durante a renderização).
  const [latest] = useState(() => ({ pathname, open, setActiveTab, navigate, }));
  useEffect(() => {
    Object.assign(latest, { pathname, open, setActiveTab, navigate });
  });

  const [controller] = useState(() =>
    createTabHistory({
      screen: () => screenOf(latest.pathname),
      openTabs: () => latest.open,
      activate: (tabId) => {
        latest.setActiveTab(tabId);
      },
      leaveSettings: () => void latest.navigate(pathsConfig.workbench),
      // Um diálogo modal, um menu ou uma lista aberta têm as setas só deles (`popupOpen`, de `tab-focus.ts`, que também segura o Ctrl+W da janela).
      blocked: () => vaultLock.isLocked() || popupOpen(),
      mac: typeof navigator !== "undefined" && isMacPlatform(navigator.platform),
    }),
  );

  // O bloqueio zera o histórico; a aba ativa de agora volta a ser a primeira entrada.
  useEffect(() => {
    controller.reset();
  }, [controller, lockEpoch]);
  useEffect(() => {
    controller.observe(open, activeTabId);
  }, [controller, open, activeTabId, lockEpoch]);

  useEffect(() => {
    // A aba que o Voltar ou o Avançar ativou recebe o foco depois de desenhada, como a aba em que se clica.
    if (activeTabId === null || !controller.takeFocus(activeTabId)) return;
    document.getElementById(tabElementId(activeTabId))?.focus({ preventScroll: true });
  }, [activeTabId, controller]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => controller.onKeyDown(event);
    // O menu e a lista fecham no `pointerdown` (document, captura): a janela o vê antes, e é ali que se vê se havia algo aberto (ver `pressBlocked` no controlador).
    const onPointerDown = (event: PointerEvent) => controller.onPointerDown(event);
    // O Chromium navega ao SOLTAR o botão; quem o segura é `blockHistoryButtons`, acima de tudo, e aqui se age no mesmo evento.
    const onMouseUp = (event: MouseEvent) => controller.onMouseUp(event);
    // Todas na fase de captura: as teclas antes de qualquer componente (ver `onKeyDown` do controlador).
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    };
  }, [controller]);
}
