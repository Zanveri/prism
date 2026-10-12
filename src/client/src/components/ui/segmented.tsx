import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

/** Escolha única com as opções lado a lado, como o seletor de banco do canvas. */
export function Segmented({ className, ...props }: ComponentProps<"div">) {
  return <div role="group" className={cn("inline-flex flex-wrap gap-2", className)} {...props} />;
}

/**
 * Classe de um segmento. É função, e não componente, porque o segmento ora é um
 * `<button aria-pressed>` (formulário), ora um link de rota.
 */
export function segmentedItem({ active = false }: { active?: boolean } = {}) {
  return cn(
    "inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3.5 font-sans whitespace-nowrap no-underline transition-colors",
    active ? "border-accent bg-selected font-semibold text-ink" : "border-border-strong bg-transparent text-muted hover:text-ink",
  );
}
