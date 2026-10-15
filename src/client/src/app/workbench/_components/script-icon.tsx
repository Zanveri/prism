import type { ComponentProps, ComponentType } from "react";

import { BugIcon, ChartIcon, ClockIcon, CodeIcon, DatabaseIcon, DocumentIcon, FlagIcon, LightningIcon, StarIcon, TableIcon, WrenchIcon, iconColorStyle } from "@/components/ui";

import type { ScriptIcon } from "../_lib/saved-scripts";

/** O desenho de cada ícone da lista fechada (RN-SCRIPT-006): os do app, no mesmo traço. O documento é o de antes, o padrão. */
export const scriptIconComponents: Record<ScriptIcon, ComponentType<ComponentProps<"svg">>> = {
  document: DocumentIcon,
  code: CodeIcon,
  database: DatabaseIcon,
  table: TableIcon,
  chart: ChartIcon,
  clock: ClockIcon,
  lightning: LightningIcon,
  bug: BugIcon,
  wrench: WrenchIcon,
  star: StarIcon,
  flag: FlagIcon,
};

/**
 * O ícone de um script (RN-SCRIPT-006), na seção "Scripts", na aba dele e no "Editar script…": o desenho escolhido e, com cor, a cor ajustada ao contraste
 * do tema (`iconColorStyle`, a mesma regra da cor da pasta). Sem cor, a de quem está em volta (`currentColor`), o neutro de sempre.
 */
export function ScriptIconView({ icon, color, style, ...props }: { icon: ScriptIcon; color: string | null } & Omit<ComponentProps<"svg">, "color">) {
  const Icon = scriptIconComponents[icon];
  return <Icon data-script-icon={icon} style={color === null ? style : { ...style, color: iconColorStyle(color) }} {...props} />;
}
