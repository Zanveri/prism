import { useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { signOut } from "@/app/sign-in/_lib/sign-in.service";
import { vaultLock } from "@/lib/api/vault-lock";

import { createLockVaultDeps, createUnlockHandler, lockVault, type CloseState } from "../_lib/lock-vault";
import { useIdleLock } from "../_lib/use-idle-lock";
import { IdleAnnouncer, IdleWarning } from "./idle-warning";
import { LockScreen } from "./lock-screen";

/** Um passo de tela do bloqueio que lançou: não impede o fechamento do cofre (`lockVault`), mas fica no registro do processo da tela. */
const reportError = (error: unknown) => console.error("[prism] bloqueio por inatividade:", error);

type VaultLockProps = {
  /** Alguma aba tem comando em andamento? O tempo não conta enquanto tem. */
  isBusy: () => boolean;
  /** Solta o que dependia do cofre aberto, mantendo as abas e o texto de SQL (`discardForLock`, do provedor da área de trabalho). */
  discard: () => void;
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
 * 3. o cofre fecha na API pela chamada do "Sair" (RN-COFRE-008): as sessões com os bancos caem do lado dela.
 *
 * Nada disso desmonta a área de trabalho nem o provedor. "Desbloquear" abre o cofre do MESMO usuário pela chamada de entrada, solta os
 * pedidos que esperavam (a árvore se refaz numa sessão nova) e devolve o foco; "Sair" faz a saída de verdade. O cofre fechado por OUTRO
 * motivo (a API reiniciou, o quinto erro ao revelar uma senha) segue levando ao login, como antes: só este caminho passa por aqui.
 */
export function VaultLock({ isBusy, discard }: VaultLockProps) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const { lockEnabled, lockAfterMinutes } = preferences.security;
  const locked = useSyncExternalStore(vaultLock.subscribe, vaultLock.isLocked);
  // Onde está o fechamento do cofre na API: a tela de bloqueio diz a verdade sobre ele.
  const [closeState, setCloseState] = useState<CloseState>("closed");

  function lockNow() {
    if (vaultLock.isLocked()) return;

    // A ordem e as falhas estão em `lockVault`, com as dependências injetadas e testadas; aqui só se ligam as peças de verdade.
    void lockVault(createLockVaultDeps({ lock: vaultLock, root: document, signOut, discard, report: setCloseState, onError: reportError })).catch(reportError);
  }

  const secondsLeft = useIdleLock({ enabled: lockEnabled && !locked, minutes: lockAfterMinutes, isBusy, onLock: lockNow });

  if (locked) return <LockScreen closeState={closeState} onUnlocked={createUnlockHandler({ lock: vaultLock, queryClient })} />;
  return (
    <>
      <IdleAnnouncer active={secondsLeft !== null} />
      {secondsLeft === null ? null : <IdleWarning secondsLeft={secondsLeft} />}
    </>
  );
}
