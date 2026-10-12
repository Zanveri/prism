import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

/** Os mesmos três tons do aviso (`toast-queue.ts`): cada cor quer dizer uma coisa só. */
const formMessageVariants = cva("rounded-md border px-3 py-2.5 text-sm", {
  variants: {
    tone: {
      error: "border-danger/40 bg-danger/10 text-danger",
      warning: "border-accent/40 bg-accent/10 text-accent",
      success: "border-success/40 bg-success/10 text-success",
    },
  },
  defaultVariants: { tone: "error" },
});

export type FormMessageProps = ComponentProps<"div"> & VariantProps<typeof formMessageVariants>;

/**
 * Mensagem de nível de formulário que fica na tela até ser resolvida: credencial recusada, o
 * aviso de que a senha não tem recuperação. O resultado de uma ação é aviso (`useToast`), não isto.
 */
export function FormMessage({ className, tone, ...props }: FormMessageProps) {
  return <div role={tone === "warning" || tone === "success" ? "status" : "alert"} className={cn(formMessageVariants({ tone }), className)} {...props} />;
}

/** Erro de um campo específico, logo abaixo dele. */
export function FieldError({ className, children, ...props }: ComponentProps<"p">) {
  if (!children) return null;

  return (
    <p className={cn("text-xs text-danger", className)} {...props}>
      {children}
    </p>
  );
}
