import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-sans whitespace-nowrap no-underline transition-[background-color,color,filter] disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        /** Ação principal: o acento sólido. */
        primary: "bg-accent font-semibold text-panel enabled:hover:brightness-110",
        secondary: "border border-border-strong bg-transparent text-ink enabled:hover:bg-selected",
        ghost: "bg-transparent text-muted enabled:hover:bg-selected enabled:hover:text-ink",
        /** O que apaga ou não tem volta: só contorno, para não competir com a saída segura ao lado. */
        danger: "border border-danger bg-transparent font-semibold text-danger enabled:hover:bg-danger/10",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-sm",
        compact: "h-8 px-2 text-sm",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
