import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

/** O rótulo é um `<label>`: quem usa liga o `htmlFor` dele ao `id` do campo. */
export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm text-muted", className)} {...props} />;
}

/**
 * A caixa de um campo, a mesma no `Input` e no `Select`. O foco troca a borda pelo acento, como
 * no canvas, e o anel dá a espessura que a borda de 1px não tem.
 */
const controlClassName =
  "h-10 w-full rounded-md border border-border-strong bg-raised px-3 font-sans text-ink outline-none placeholder:text-subtle focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClassName, className)} {...props} />;
}

export { controlClassName };
