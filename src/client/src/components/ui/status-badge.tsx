import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

/** Selo de status: etiqueta mono de contorno, como as do canvas. A cor é o tom, com o mesmo sentido dos avisos. */
const statusBadgeVariants = cva("inline-flex h-[18px] items-center gap-1 rounded-sm border px-1 font-mono text-[11px] leading-none font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-border-strong text-muted",
      success: "border-success text-success",
      warning: "border-accent text-accent",
      error: "border-danger text-danger",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

export type StatusBadgeProps = ComponentProps<"span"> & VariantProps<typeof statusBadgeVariants>;

export function StatusBadge({ className, tone, ...props }: StatusBadgeProps) {
  return <span className={cn(statusBadgeVariants({ tone }), className)} {...props} />;
}

export { statusBadgeVariants };
