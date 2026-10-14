import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate } from "react-router";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { Button, FormMessage } from "@/components/ui";
import { pathsConfig } from "@/config/paths.config";
import { onVaultLocked } from "@/lib/api/prism-api";
import { vaultLock } from "@/lib/api/vault-lock";

export type GuardState = "checking" | "failed" | "locked" | "open";

/**
 * O que o guard faz com o estado da consulta de sessão. A resposta que já se tem vale mais que
 * um erro posterior: uma reconsulta que falha não desmonta a área de trabalho — e com ela o texto
 * das abas de SQL. Só `unlocked: false` manda para o login.
 */
export function guardState(query: { data: { unlocked: boolean } | undefined; isError: boolean }): GuardState {
  if (query.data !== undefined) return query.data.unlocked ? "open" : "locked";
  return query.isError ? "failed" : "checking";
}

/**
 * As rotas de dentro do cofre. Com o cofre fechado a tela vai para o login — de saída, e também
 * quando qualquer chamada responde 401 `VAULT_LOCKED` (o quinto erro ao revelar uma senha, por
 * exemplo).
 *
 * É conforto de navegação: quem recusa os dados com o cofre fechado é a API (RN-API-005).
 */
export function VaultGuard() {
  const navigate = useNavigate();

  const session = useQuery(sessionQuery);
  const state = guardState(session);

  useEffect(() => {
    if (state === "locked") void navigate(pathsConfig.signIn, { replace: true });
  }, [state, navigate]);

  useEffect(() => onVaultLocked(() => void navigate(pathsConfig.signIn, { replace: true })), [navigate]);

  // Sair, a API reiniciar ou o cofre fechar por outro motivo desmonta o guard: o bloqueio por inatividade acaba junto (RN-SEG-001), e os
  // pedidos que esperavam o desbloqueio são largados. Sem isto, o login seguinte começaria bloqueado.
  useEffect(() => () => vaultLock.reset(), []);

  if (state === "open") return <Outlet />;
  if (state !== "failed") return null;

  return (
    <div className="flex h-full flex-col items-center justify-center-safe gap-4 overflow-y-auto p-8">
      <FormMessage tone="error">Não foi possível consultar o cofre.</FormMessage>
      <Button type="button" variant="secondary" onClick={() => void session.refetch()}>
        Tentar de novo
      </Button>
    </div>
  );
}
