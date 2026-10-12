import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { PrismMark } from "@/components/layout/prism-mark";
import { Button } from "@/components/ui";
import { CheckUpdatesButton } from "@/components/update/check-updates-button";
import { getBridge } from "@/lib/api/bridge";

const RestartContext = createContext<(() => Promise<void>) | null>(null);

/**
 * Reinicia a API pelo mesmo caminho do "Reiniciar" da tela de erro (RN-DRIVER-005): o `ApiGate` desmonta
 * tudo, pede o reinício à ponte e monta de novo com um `QueryClient` novo. A API nova tem o cofre fechado, então
 * quem volta é o login. A tela que reiniciasse a API por conta própria deixaria o cache e a área de trabalho
 * da API antiga de pé (o processo principal não avisa um reinício que o próprio app pediu), e uma falha ao
 * subir não teria onde aparecer.
 */
export function useApiRestart(): () => Promise<void> {
  const restart = useContext(RestartContext);
  if (restart === null) throw new Error("useApiRestart precisa de um <ApiGate> acima na árvore.");
  return restart;
}

type GateState = { status: "starting" } | { status: "ready" } | { status: "failed"; message: string };

function failed(error: unknown): GateState {
  return { status: "failed", message: error instanceof Error ? error.message : String(error) };
}

/**
 * Nada da tela existe sem a API (seção 7 da especificação): enquanto ela inicia, a tela de
 * abertura; se não subir ou cair, um aviso que ocupa a janela, com o motivo e "Reiniciar".
 *
 * O que está dentro é desmontado quando a API cai e montado de novo quando ela volta. A API
 * nova tem o cofre fechado, então a tela pede o login outra vez.
 */
export function ApiGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "starting" });

  useEffect(() => {
    let active = true;
    let stopListening = () => {};

    // Dentro de uma função `async`, a ponte ausente vira rejeição, como qualquer outra falha.
    async function connect() {
      const bridge = getBridge();
      stopListening = bridge.onApiExit(() => setState({ status: "failed", message: "O processo da API foi encerrado." }));
      await bridge.getApiConfig();
    }

    connect().then(
      () => {
        if (active) setState({ status: "ready" });
      },
      (error: unknown) => {
        if (active) setState(failed(error));
      },
    );

    return () => {
      active = false;
      stopListening();
    };
  }, []);

  async function restart() {
    setState({ status: "starting" });
    try {
      await getBridge().restartApi();
      setState({ status: "ready" });
    } catch (error) {
      setState(failed(error));
    }
  }

  if (state.status === "ready") return <RestartContext.Provider value={restart}>{children}</RestartContext.Provider>;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex items-center gap-2.5 text-lg font-semibold tracking-[0.01em]">
        <PrismMark height={28} />
        <span>Prism</span>
      </div>

      {state.status === "starting" ? (
        <p role="status" className="text-muted">
          Abrindo o Prism…
        </p>
      ) : (
        <ApiGateError message={state.message} onRestart={() => void restart()} />
      )}
    </div>
  );
}

/**
 * O aviso de que a API não subiu ou caiu: o motivo, "Reiniciar" e, abaixo, "Verificar atualizações" (RN-ATUALIZA-002). O
 * atualizador mora no processo principal e não depende da API, e é nesta tela que a versão nova pode ser o conserto. Só de
 * propriedades: é o que os testes desenham.
 */
export function ApiGateError({ message, onRestart }: { message: string; onRestart: () => void }) {
  return (
    <div role="alert" className="flex w-full max-w-[640px] flex-col items-center gap-4">
      <h1 className="text-lg font-semibold">A API do Prism não está em execução</h1>
      {/* A mensagem traz o fim do stderr da API: é texto, nunca HTML (RN-SHELL-002). */}
      <p className="max-h-60 w-full overflow-y-auto rounded-md border border-border bg-panel px-3 py-2.5 font-mono text-sm break-words whitespace-pre-wrap text-muted">{message}</p>
      <Button type="button" onClick={onRestart}>
        Reiniciar
      </Button>
      <CheckUpdatesButton />
    </div>
  );
}
