import { formatElapsed } from "@/lib/utils/format";

/** A hora de uma resposta, no relógio da máquina ("14:32:05"). */
export function clockOf(checkedAt: string): string {
  const date = new Date(checkedAt);
  return Number.isNaN(date.getTime()) ? checkedAt : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Os textos da verificação periódica (RN-VERIF-002 e 003): o indicador, a dica dele, a janela da falha e os avisos. */
export const connectionChecksCopy = {
  // O indicador, ao lado do nome da conexão conectada (na árvore, no lugar do ponto de conectada, no botão da conexão da aba e na barra de status).
  state: {
    waiting: "Conectada, ainda não verificada",
    ok: "Respondeu na última verificação",
    failed: "Não respondeu",
    notConnected: "Sem sessão aberta",
  },
  tip: {
    waiting: "Conectada. A primeira verificação vem depois do intervalo dela.",
    ok: (checkedAt: string, elapsedMs: number) => `Respondeu às ${clockOf(checkedAt)}, em ${formatElapsed(elapsedMs)}`,
    failed: (checkedAt: string, message: string, sqlState: string | null) => `Não respondeu às ${clockOf(checkedAt)}${sqlState === null ? "" : ` (SQLSTATE ${sqlState})`}:\n${message}`,
    notConnected: "Sem sessão aberta: a próxima ação na árvore ou na aba abre a sessão de novo.",
    // A resposta `busy` deixa o indicador como estava, com isto na dica.
    busy: "Ocupada: verificada na próxima",
  },
  // A falha num clique, como o erro de um nó da árvore (RN-ARVORE-005): na árvore, um botão das ações da linha; na barra de status, o próprio indicador.
  failure: {
    open: (connection: string) => `Ver por que ${connection} não respondeu`,
    title: (connection: string) => `${connection} não respondeu à verificação`,
    when: (checkedAt: string, elapsedMs: number | null) => `Às ${clockOf(checkedAt)}${elapsedMs === null ? "" : `, depois de ${formatElapsed(elapsedMs)}`}. A mensagem é a do banco, como veio.`,
    sqlState: "SQLSTATE",
    hint: "O Prism não reconecta sozinho: a próxima verificação tenta de novo no intervalo, e “Desconectar” e “Conectar” abrem outra sessão.",
    close: "Fechar",
  },
  toasts: {
    failed: (connection: string) => `${connection} não respondeu à verificação`,
    recovered: (connection: string) => `${connection} voltou a responder à verificação`,
  },
} as const;
