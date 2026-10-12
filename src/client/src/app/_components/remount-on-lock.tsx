import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { vaultLock } from "@/lib/api/vault-lock";

/**
 * Quando as outras telas se remontam (pura, é o que os testes exercitam). `mounted` é a época com que o que está dentro foi montado;
 * `lockEpoch`, a do último bloqueio. A URL tem de estar limpa antes de remontar: as telas leem a busca da rota ao montar (`?connection=<id>`
 * abre aquela conexão no formulário; `?driver=<id>` destaca uma linha). Elas gastam o parâmetro assim que o usam (`useSpendParam` o tira da
 * URL, com `replace`), então quase sempre a URL já está limpa; mas um parâmetro ainda não gasto no instante do bloqueio (a lista de
 * conexões não tinha chegado, por exemplo) reabriria o formulário sozinho no desbloqueio, e é essa espera pela URL limpa que garante que
 * não. O roteador aplica a navegação numa transição, e a remontagem pelo bloqueio é urgente: ela leria a URL velha. Por isso, com a busca
 * suja, espera e pede para limpá-la (`clearSearch`); com a URL limpa, remonta.
 */
export function remountStep({ mounted, lockEpoch, search }: { mounted: number; lockEpoch: number; search: string }): { mounted: number; clearSearch: boolean } {
  const waiting = mounted !== lockEpoch;
  return { mounted: waiting && search === "" ? lockEpoch : mounted, clearSearch: waiting && search !== "" };
}

/**
 * Remonta o que está dentro dele a cada bloqueio por inatividade (RN-SEG-001): as outras telas de dentro do cofre (Conexões,
 * Configurações e Drivers, o `Outlet`) voltam ao estado inicial. Um formulário aberto, o diálogo de revelar senha, uma senha de conexão
 * revelada ou digitada e ainda não gravada, um rascunho de campo: nada disso sobrevive ao bloqueio, nem fica na memória da tela por
 * baixo da tela de bloqueio. A chave é a época do bloqueio (`vaultLock.epoch`), que sobe a cada bloqueio.
 *
 * **A área de trabalho não entra aqui**: ela mantém as abas, o texto de SQL, o cursor e o histórico de desfazer (o `WorkbenchSlot` fica
 * ao lado deste componente, e não dentro dele).
 */
export function RemountOnLock({ children }: { children: ReactNode }) {
  const lockEpoch = useSyncExternalStore(vaultLock.subscribe, vaultLock.epoch);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(lockEpoch);

  const step = remountStep({ mounted, lockEpoch, search });
  // Ajuste durante a renderização (e não num efeito), como no provedor da área de trabalho: nenhum filho chega a ver a tela velha com a chave nova.
  if (step.mounted !== mounted) setMounted(step.mounted);

  useEffect(() => {
    if (step.clearSearch) void navigate({ pathname }, { replace: true });
  }, [step.clearSearch, pathname, navigate]);

  return <Fragment key={step.mounted}>{children}</Fragment>;
}
