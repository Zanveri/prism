import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui";

import { connectTree } from "../../_lib/table-structure.service";
import { workbenchCopy } from "../../_lib/workbench.copy";

const copy = workbenchCopy.tableTab;

/** `database`: o outro banco do servidor da aba (RN-ARVORE-006); "Conectar" abre a sessão da árvore dele. */
type DisconnectedViewProps = { connectionId: string; database?: string };

/**
 * O que a Estrutura e o Diagrama mostram de uma conexão que a pessoa desconectou (RN-SESSAO-004): nada reconecta sozinho, nem ao
 * mostrar uma vista que nunca tinha sido aberta. O botão é o clique que conecta: abre a sessão da árvore (`connectTree`) e as vistas
 * carregam em seguida. Quem devolve o foco, que estava no botão, é o painel da aba (`table-tab.tsx`).
 */
export function DisconnectedView({ connectionId, database }: DisconnectedViewProps) {
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setConnecting(true);
    await connectTree(queryClient, connectionId, database);
    setConnecting(false);
  }

  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <div className="flex flex-col gap-1">
        <p className="text-body">{copy.disconnected}</p>
        <p className="text-muted">{copy.disconnectedHint}</p>
      </div>
      <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void connect()} disabled={connecting}>
        {connecting ? copy.connecting : copy.connect}
      </Button>
    </div>
  );
}
