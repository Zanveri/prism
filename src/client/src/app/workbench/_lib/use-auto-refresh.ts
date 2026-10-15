import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { customInterval, type AutoRefreshBlocker, type AutoRefreshState } from "./auto-refresh";
import { autoRefreshCopy } from "./auto-refresh.copy";
import { autoRefreshMenuItem, intervalOf, type AutoRefreshAction, type AutoRefreshSource } from "./auto-refresh-menu";
import type { QueryRunner } from "./use-query-runner";

export type AutoRefreshView = {
  /** O estado do relógio da aba, para a barra do resultado. */
  state: AutoRefreshState;
  /** Por que não liga agora (lido a cada renderização da vista, que acompanha o executor). */
  blocker: AutoRefreshBlocker | null;
  /** O que o menu da grade usa (`useRecordEdits`). */
  source: AutoRefreshSource;
  /** A escolha de um intervalo, do "Personalizado…" ou de "Desligar", na grade ou na barra. */
  choose: (action: AutoRefreshAction) => void;
  /** O diálogo do "Personalizado…", aberto, com a recusa do último texto enviado (ou nula); fechado, nulo. */
  asking: { error: string | null } | null;
  /** Os segundos digitados no diálogo: um intervalo válido liga (ou troca o intervalo) e fecha; outro texto fica no diálogo, com o motivo. */
  submitCustom: (text: string) => void;
  closeCustom: () => void;
};

/**
 * A atualização automática na vista (RN-GRADE-014): a vista Registros e a aba de consulta. O relógio é do executor da aba (`runner.autoRefresh`, que
 * sobrevive a trocar de aba e de vista); aqui ficam o que a vista vê dele, a pausa de quando ela não está À VISTA (outra aba à frente, outra vista da tabela,
 * a área de trabalho atrás de outra tela, ou a vista desmontada) e o diálogo do "Personalizado…". A pausa da edição da grade é de `useRecordEdits`.
 *
 * `confirmStart` é o aviso de ligar (RN-PROT-001, na aba de consulta com "Todos os comandos"): só ao ligar, uma vez, e nunca ao trocar só o intervalo nem a
 * cada execução; liga pelo `proceed`, que sem pergunta roda na hora, e cancelado não liga. O que não liga de todo jeito (`blocker`) não pergunta. Os Registros não perguntam:
 * o comando deles é o que o Prism monta para mostrar a tabela.
 */
export function useAutoRefresh(runner: QueryRunner, visible: boolean, confirmStart?: (proceed: () => void) => void): AutoRefreshView {
  const auto = runner.autoRefresh;
  const state = useSyncExternalStore(auto.subscribe, auto.getState);
  const [asking, setAsking] = useState<{ error: string | null } | null>(null);

  // Só a aba à vista fala com o banco sozinha (RN-SEG-001): fora de vista, e com a vista desmontada, ela espera; ao voltar, executa se o prazo passou.
  useEffect(() => {
    auto.pause("hidden", !visible);
    return () => auto.pause("hidden", true);
  }, [auto, visible]);

  const confirmRef = useRef(confirmStart);
  useEffect(() => {
    confirmRef.current = confirmStart;
  });

  /** Liga, ou troca o intervalo; ligar pergunta antes, quando a proteção pede, e a resposta decide com o estado de então. */
  const start = useCallback(
    (everyMs: number) => {
      const ask = confirmRef.current;
      if (ask === undefined || auto.getState().status === "on" || auto.blocker() !== null) return auto.start(everyMs);
      ask(() => auto.start(everyMs));
    },
    [auto],
  );

  const choose = useCallback(
    (action: AutoRefreshAction) => {
      if (action === "autoRefresh:off") return auto.stop();
      if (action === "autoRefresh:custom") return setAsking({ error: null });
      const every = intervalOf(action);
      if (every !== null) start(every);
    },
    [auto, start],
  );

  const source = useMemo<AutoRefreshSource>(() => ({ item: () => autoRefreshMenuItem(auto.getState(), auto.blocker()), choose }), [auto, choose]);

  const submitCustom = useCallback(
    (text: string) => {
      const everyMs = customInterval(text);
      if (everyMs === null) return setAsking({ error: autoRefreshCopy.dialog.invalid });
      setAsking(null);
      start(everyMs);
    },
    [start],
  );
  const closeCustom = useCallback(() => setAsking(null), []);

  return { state, blocker: auto.blocker(), source, choose, asking, submitCustom, closeCustom };
}
