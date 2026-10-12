import { cn } from "@/lib/utils/cn";

/**
 * Classes da entrada de uma lista de navegação vertical: a escolhida em destaque (fundo da seleção, negrito, texto forte), as outras apagadas até o mouse
 * chegar. É a entrada da lista de Configurações, e a das seções da Estrutura da tabela é a mesma. Função, e não componente, como `segmentedItem`: a lista de
 * Configurações marca com `aria-current` e a da Estrutura é uma lista de abas.
 */
export function navItem({ active = false }: { active?: boolean } = {}) {
  return cn("flex h-10 cursor-pointer items-center gap-2 rounded-md px-3 text-left transition-colors", active ? "bg-selected font-semibold text-ink" : "text-muted hover:bg-selected hover:text-ink");
}
