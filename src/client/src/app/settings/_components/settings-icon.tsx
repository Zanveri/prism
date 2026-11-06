import type { ComponentProps } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * O ícone de Configurações do canvas (os dois controles deslizantes), no traço dos demais (`components/ui/icons.tsx`):
 * 16×16, traço de 1,5, pontas redondas, cor do texto em volta. Mora aqui, e não junto dos outros, para a barra superior
 * e a tela de Configurações dependerem só dela.
 */
export function SettingsIcon({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon="settings" className={cn("flex-none", className)} {...props}>
      <path d="M3 5h6M12 5h1M3 11h1M7 11h6" />
      <circle cx="10.5" cy="5" r="1.5" className="icon-part-knob-left" />
      <circle cx="5.5" cy="11" r="1.5" className="icon-part-knob-right" />
    </svg>
  );
}
