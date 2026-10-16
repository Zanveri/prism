import { Button, Dialog } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { checkView, type CheckState, type CheckView } from "../_lib/connection-checks";
import { connectionChecksCopy } from "../_lib/connection-checks.copy";
import { useConnectionCheck } from "../_lib/use-connection-checks";

const copy = connectionChecksCopy;

/** O desenho do ponto em cada estado: o de "respondeu" é o ponto de conectada do canvas; a falha, no tom de erro; sem resposta ainda, o anel. */
const toneClass: Record<CheckView["tone"], string> = {
  waiting: "border-[1.5px] border-success",
  ok: "bg-success",
  failed: "bg-danger",
  notConnected: "border-[1.5px] border-accent",
};

/**
 * O indicador da verificação (RN-VERIF-003), no lugar do ponto de conectada: o ponto no tom do estado, com o texto como nome acessível e a dica (a hora e o
 * tempo, ou a mensagem do banco, e a marca de ocupada). Sem verificação (desligada, ou a conexão desconectada) quem desenha é o ponto de sempre.
 */
export function CheckDot({ view, className }: { view: CheckView; className?: string }) {
  return <span role="img" aria-label={view.label} title={view.tip} data-check={view.tone} className={cn("size-2 flex-none rounded-full", toneClass[view.tone], className)} />;
}

/**
 * O indicador com o texto, para onde há espaço: a barra de status da aba e o painel "Sessão da conexão" do formulário, como no canvas ("Respondeu na última
 * verificação"). Na falha, o texto é um botão que mostra a mensagem do banco (`onFailure`), como o erro de um nó da árvore (RN-ARVORE-005).
 */
export function CheckLabel({ state, onFailure }: { state: CheckState; onFailure?: () => void }) {
  const view = checkView(state);
  return (
    <span className="flex items-center gap-1.5">
      <CheckDot view={view} />
      {view.tone === "failed" && onFailure !== undefined ? (
        <button type="button" title={view.tip} onClick={onFailure} className="cursor-pointer text-danger underline decoration-dotted underline-offset-2 hover:decoration-solid">
          {view.label}
        </button>
      ) : (
        <span title={view.tip} className={cn(view.tone === "failed" && "text-danger")}>
          {view.label}
        </span>
      )}
    </span>
  );
}

/** O mesmo, lendo o estado da verificação da conexão; nada sem ele (a verificação desligada, a conexão desconectada ou de fora desta janela). */
export function ConnectionCheckLabel({ connectionId, onFailure }: { connectionId: string; onFailure?: () => void }) {
  const state = useConnectionCheck(connectionId);
  return state === null ? null : <CheckLabel state={state} onFailure={onFailure} />;
}

/**
 * A falha da verificação num clique (RN-VERIF-003, como o erro de um nó da árvore, RN-ARVORE-005): a conexão, a hora, o tempo, a mensagem do banco como veio
 * (sempre texto, RN-SHELL-002) e o SQLSTATE. Só informa: o Prism não reconecta sozinho.
 */
export function CheckFailureDialog({ connection, state, onClose }: { connection: string; state: Extract<CheckState, { kind: "failed" }>; onClose: () => void }) {
  return (
    <Dialog
      open
      size="md"
      title={copy.failure.title(connection)}
      description={copy.failure.when(state.checkedAt, state.elapsedMs)}
      onClose={onClose}
      footer={
        <Button autoFocus type="button" onClick={onClose}>
          {copy.failure.close}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* `pre-wrap`: a mensagem do banco pode ter várias linhas (mensagem, DETAIL, HINT). */}
        <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-sm break-words whitespace-pre-wrap text-ink">{state.message}</pre>
        {state.sqlState === null ? null : (
          <p className="text-xs text-muted">
            {copy.failure.sqlState} <span className="font-mono text-ink">{state.sqlState}</span>
          </p>
        )}
        <p className="text-xs text-muted">{copy.failure.hint}</p>
      </div>
    </Dialog>
  );
}
