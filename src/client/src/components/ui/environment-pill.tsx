import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

const darkText = "#14181D";
const lightText = "#FFFFFF";

/**
 * Texto escuro sobre cor clara e claro sobre cor escura, pela luminância (a conta do canvas:
 * 0,2126 R + 0,7152 G + 0,0722 B, de 0 a 1, com o limite em 0,5). A cor é do usuário e pode ser
 * qualquer uma, então o contraste não pode ser fixo.
 */
export function environmentTextColor(color: string): string {
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.5 ? darkText : lightText;
}

/**
 * A etiqueta do ambiente de uma conexão (RN-CONN-015): o nome sobre a cor que o usuário escolheu.
 * Sem nome não há o que dizer e nada é desenhado; sem cor, a etiqueta é só um contorno neutro.
 * A cor é dado do usuário, não token: vai em `style`, que a política de conteúdo permite.
 */
export function EnvironmentPill({ name, color, className, ...props }: { name: string | null; color: string | null } & Omit<ComponentProps<"span">, "color">) {
  if (!name) return null;

  return (
    <span
      style={color === null ? undefined : { backgroundColor: color, color: environmentTextColor(color) }}
      className={cn("inline-flex h-[18px] flex-none items-center rounded-full px-[7px] text-[11px] leading-[18px] font-semibold whitespace-nowrap", color === null && "border border-border-strong text-muted", className)}
      {...props}
    >
      {name}
    </span>
  );
}
