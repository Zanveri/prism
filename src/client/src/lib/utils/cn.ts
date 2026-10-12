import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Junta classes condicionais resolvendo conflitos do Tailwind.
 *
 * Os tokens do Prism reaproveitam os nomes da escala padrão (`text-sm`, `rounded-xl`,
 * `shadow-2xl`), então o tailwind-merge os reconhece sem configuração. Um token de tamanho de
 * texto com nome novo precisa ser declarado aqui com `extendTailwindMerge`, ou ele é confundido
 * com `text-<cor>` e um dos dois some ao juntar as classes.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
