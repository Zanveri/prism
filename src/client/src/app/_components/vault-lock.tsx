import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";

import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { signOut } from "@/app/sign-in/_lib/sign-in.service";
import { onPeerEvent, sharePeerEvent } from "@/lib/api/bridge";
import type { ApiResult } from "@/lib/api/prism-api";
import { vaultLock } from "@/lib/api/vault-lock";
import { workspaceSync } from "@/lib/api/workspace-sync";
import { resultHostRegistry } from "@/lib/host/host";

import { createLockVaultDeps, createUnlockHandler, lockVault, type CloseState } from "../_lib/lock-vault";
import { peerAction } from "../_lib/peer-session";
import { useIdleLock } from "../_lib/use-idle-lock";
import { IdleAnnouncer, IdleWarning } from "./idle-warning";
import { LockScreen } from "./lock-screen";

/** Um passo de tela do bloqueio que lançou: não impede o fechamento do cofre (`lockVault`), mas fica no registro do processo da tela. */
const reportError = (error: unknown) => console.error("[prism] bloqueio por inatividade:", error);

/** Onde esta janela está, para a decisão do que fazer com o que outra janela contou (`peerAction`). */
const where = () => (vaultLock.isLocked() ? "locked" : "open");

/**
 * RN-ABAS-004: a atividade desta janela vai às outras, e a das outras recomeça a contagem desta. Estável: é de módulo.
 */
const peers = {
  share: () => sharePeerEvent("activity"),
  subscribe: (onActivity: () => void) =>
    onPeerEvent((kind) => {
      if (peerAction(kind, where()) === "touch") onActivity();
    }),
};

/** A janela que bloqueia porque outra bloqueou não pede o fechamento do cofre: quem bloqueou já o fecha. */
const closedByAnotherWindow = async (): Promise<ApiResult<void>> => ({ ok: true, data: undefined });

type VaultLockProps = {
  /** Alguma aba tem comando em andamento? O tempo não conta enquanto tem. */
  isBusy: () => boolean;
  /** Solta o que dependia do cofre aberto, mantendo as abas e o texto de SQL (`discardForLock`, do provedor da área de trabalho). */
  discard: () => void;
  /** RN-SEG-001 e RN-EXPORT-023: quantas exportações com a entrega que falhou o bloqueio vai descartar (o aviso de antes dele diz). */
  discardedExports?: () => number;
};

/**
 * O bloqueio por inatividade (RN-SEG-001), por cima de qualquer tela de dentro do cofre. Sem tecla, ponteiro nem roda na janela pelo
 * tempo das preferências (`security.lockAfterMinutes`), e sem comando em andamento em nenhuma aba, avisa 60 segundos antes e bloqueia.
 *
 * Bloquear, nesta ordem (`lockVault`, em `_lib/lock-vault.ts`, onde a ordem e as falhas são testadas):
 * 1. a espera dos pedidos à API é armada (`vaultLock.lock()`) e a tela de bloqueio aparece: dali em diante nada chega à API, e nada
 *    do que estava aberto fica à mostra nem ao alcance do teclado. A época do bloqueio sobe, e as outras telas de dentro do cofre
 *    (Conexões, Configurações, Drivers) se remontam (`RemountOnLock`): o formulário aberto, o diálogo de revelar senha e uma senha de
 *    conexão revelada ou digitada e não gravada não sobrevivem. Diálogos e menus abertos por portal fecham (`closeOpenPortals`);
 * 2. o provedor solta as sessões e descarta os resultados e o cache de dados de banco, mantendo as abas e o texto (`discard`);
 * 3. as abas de todas as janelas são gravadas (RN-ABAS-006), com prazo;
 * 4. o cofre fecha na API pela chamada do "Sair" (RN-COFRE-008): as sessões com os bancos caem do lado dela.
 *
 * Nada disso desmonta a área de trabalho nem o provedor. "Desbloquear" abre o cofre do MESMO usuário pela chamada de entrada, solta os
 * pedidos que esperavam (a árvore se refaz numa sessão nova) e devolve o foco; "Sair" faz a saída de verdade. O cofre fechado por OUTRO
 * motivo (a API reiniciou, o quinto erro ao revelar uma senha) segue levando ao login, como antes: só este caminho passa por aqui.
 *
 * Com mais de uma janela (RN-ABAS-004), o cofre é um só: a contagem recomeça com a atividade de qualquer janela, e o bloqueio, o desbloqueio de uma
 * valem para todas. A janela que bloqueia conta às outras, que bloqueiam também, sem fechar o cofre de novo; a que desbloqueia (depois de conferir
 * a senha e o usuário) conta, e as outras soltam a barreira.
 */
export function VaultLock({ isBusy, discard, discardedExports }: VaultLockProps) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const { lockEnabled, lockAfterMinutes } = preferences.security;
  const locked = useSyncExternalStore(vaultLock.subscribe, vaultLock.isLocked);
  // Onde está o fechamento do cofre na API: a tela de bloqueio diz a verdade sobre ele.
  const [closeState, setCloseState] = useState<CloseState>("closed");

  /** Bloqueia esta janela. `followed`: outra janela bloqueou e já fecha o cofre na API, e esta só a acompanha. */
  function lockNow(followed = false) {
    if (vaultLock.isLocked()) return;

    // A ordem e as falhas estão em `lockVault`, com as dependências injetadas e testadas; aqui só se ligam as peças de verdade. A barreira é armada no
    // primeiro passo, antes de qualquer espera: quando as outras janelas sabem do bloqueio, esta já não deixa pedido passar.
    // RN-ABAS-006: as abas são gravadas antes de o cofre fechar, por quem o fecha; a janela que acompanha o bloqueio de outra não grava (a outra já grava as
    // de todas as janelas).
    void lockVault(createLockVaultDeps({ lock: vaultLock, root: document, extraRoots: () => resultHostRegistry.list().map((host) => host.document), signOut: followed ? closedByAnotherWindow : signOut, discard, saveWorkspace: followed ? undefined : () => workspaceSync.flush(), report: setCloseState, onError: reportError })).catch(reportError);
    if (!followed) sharePeerEvent("lock");
  }

  const unlock = createUnlockHandler({ lock: vaultLock, queryClient });
  const onPeer = useEffectEvent((kind: Parameters<typeof peerAction>[0]) => {
    const action = peerAction(kind, where());
    if (action === "lock") lockNow(true);
    else if (action === "unlock") unlock();
  });
  useEffect(() => onPeerEvent((kind) => onPeer(kind)), []);

  const secondsLeft = useIdleLock({ enabled: lockEnabled && !locked, minutes: lockAfterMinutes, isBusy, onLock: lockNow, peers });
  // RN-SEG-001 e RN-ABAS-015: o aviso antes do bloqueio aparece também nas janelas do resultado, que não têm barra superior.
  const resultPages = useSyncExternalStore(resultHostRegistry.subscribe, resultHostRegistry.list, resultHostRegistry.list);

  if (locked)
    return (
      <LockScreen
        closeState={closeState}
        onUnlocked={() => {
          unlock();
          sharePeerEvent("unlock");
        }}
      />
    );
  const discarded = secondsLeft === null ? 0 : (discardedExports?.() ?? 0);
  return (
    <>
      <IdleAnnouncer active={secondsLeft !== null} discardedExports={discarded} />
      {secondsLeft === null ? null : <IdleWarning secondsLeft={secondsLeft} discardedExports={discarded} />}
      {secondsLeft === null ? null : resultPages.map((page) => createPortal(<IdleWarning secondsLeft={secondsLeft} discardedExports={discarded} inResultWindow />, page.document.body, page.resultWindow ?? undefined))}
    </>
  );
}
