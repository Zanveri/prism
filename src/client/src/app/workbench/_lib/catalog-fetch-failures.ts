import type { QueryClient } from "@tanstack/react-query";

/**
 * RN-CONFIG-004: as listas do catálogo (colunas, chaves estrangeiras) que o autocompletar tentou buscar e não vieram. Uma lista que falhou não é pedida de novo
 * a cada tecla, enquanto a sessão for a mesma; o "Atualizar" do navegador e o da Estrutura (a pessoa mandando refazer) esquecem as marcas da conexão, e a busca
 * seguinte tenta de novo. Fica fora do autocompletar para o navegador e o serviço da Estrutura poderem esquecer sem importar o editor.
 */
const marks = new WeakMap<QueryClient, Set<string>>();

const markOf = (connectionId: string, session: string, queryKey: readonly unknown[]) => `${connectionId}\u0000${session}\u0000${JSON.stringify(queryKey)}`;

export function hasFailedList(queryClient: QueryClient, connectionId: string, session: string, queryKey: readonly unknown[]): boolean {
  return marks.get(queryClient)?.has(markOf(connectionId, session, queryKey)) === true;
}

export function markFailedList(queryClient: QueryClient, connectionId: string, session: string, queryKey: readonly unknown[]): void {
  const held = marks.get(queryClient) ?? new Set<string>();
  held.add(markOf(connectionId, session, queryKey));
  marks.set(queryClient, held);
}

/** "Atualizar": as listas da conexão que falharam voltam a ser buscadas. */
export function forgetFailedLists(queryClient: QueryClient, connectionId: string): void {
  const held = marks.get(queryClient);
  if (held === undefined) return;
  for (const mark of held) if (mark.startsWith(`${connectionId}\u0000`)) held.delete(mark);
}
