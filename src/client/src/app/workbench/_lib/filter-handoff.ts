import { tableKey, type TableRef } from "./table-diagram";

/** A tabela de um pedido: com `database`, a de outro banco do servidor da conexão (RN-ARVORE-006). */
type HandoffTable = TableRef & { database?: string };

/** O filtro que o clique numa chave estrangeira pede à aba da tabela referenciada. `id` muda a cada pedido. */
export type FilterRequest = { id: number; where: string };

/**
 * A passagem do filtro de uma aba para outra (RN-TABELA-007): quem clica no valor de uma chave estrangeira abre (ou traz à frente) a aba da
 * tabela referenciada, e essa aba ainda não existe, ou existe em outra vista, quando o pedido sai. O pedido fica aqui, por conexão e tabela,
 * até a vista Registros daquela aba o levar ao campo do filtro e o apagar.
 *
 * O pedido é DA ABA da tabela a que se destina, e morre com ela (`forgetExcept`): fechar a aba e reabrir a mesma tabela não leva o filtro velho. E o
 * pedido que ninguém levou no prazo (a aba estava ocupada, ou a conexão desconectada) não some calado: quem ouve `onExpired` fica sabendo, e avisa.
 */
export function createFilterHandoff(lifetimeMs = 15_000) {
  const requests = new Map<string, FilterRequest>();
  const listeners = new Set<() => void>();
  const expiredListeners = new Set<(table: TableRef) => void>();
  let nextId = 0;

  // A mesma tabela em outro banco do servidor da conexão é outra tabela (RN-ARVORE-006).
  const keyOf = (connectionId: string, table: HandoffTable) => JSON.stringify([connectionId, table.database ?? null, tableKey(table)]);
  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** Apaga o pedido, se ainda for o mesmo. Devolve se apagou. */
  function drop(key: string, id: number): boolean {
    if (requests.get(key)?.id !== id) return false;
    requests.delete(key);
    emit();
    return true;
  }

  return {
    /** Pede o filtro para a tabela. Um pedido novo para a mesma tabela troca o anterior. */
    request(connectionId: string, table: HandoffTable, where: string): void {
      const key = keyOf(connectionId, table);
      const request: FilterRequest = { id: ++nextId, where };

      requests.set(key, request);
      // O prazo: só o pedido que AINDA está aqui (não foi levado, trocado, nem saiu com a aba) acabou sem ser atendido.
      setTimeout(() => {
        if (drop(key, request.id)) for (const listener of expiredListeners) listener(table);
      }, lifetimeMs);
      emit();
    },

    /** O pedido que espera esta tabela, ou `null`. O mesmo objeto até ser trocado ou apagado (é o que o React compara). */
    peek: (connectionId: string, table: HandoffTable): FilterRequest | null => requests.get(keyOf(connectionId, table)) ?? null,

    /** A vista levou o pedido ao campo: apaga-o, se ainda for o mesmo. */
    clear: (connectionId: string, table: HandoffTable, id: number): void => void drop(keyOf(connectionId, table), id),

    /** Apaga os pedidos das tabelas que não têm mais aba aberta (`open` são as abas de tabela que existem): o pedido morre com a aba. */
    forgetExcept(open: readonly { connectionId: string; table: HandoffTable }[]): void {
      const kept = new Set(open.map(({ connectionId, table }) => keyOf(connectionId, table)));
      const gone = [...requests.keys()].filter((key) => !kept.has(key));
      if (gone.length === 0) return;

      for (const key of gone) requests.delete(key);
      emit();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** Ouve o pedido que acabou o prazo sem ser levado, com a tabela a que se destinava. Devolve como deixar de ouvir. */
    onExpired(listener: (table: TableRef) => void): () => void {
      expiredListeners.add(listener);
      return () => void expiredListeners.delete(listener);
    },
  };
}

/** A passagem da janela: uma só, como o `vaultLock`. */
export const filterHandoff = createFilterHandoff();
