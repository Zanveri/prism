import { locale } from "@/lib/i18n";

/** A hora de uma resposta, no relógio da máquina ("14:32:05"). */
export function clockOf(checkedAt: string): string {
  const date = new Date(checkedAt);
  return Number.isNaN(date.getTime()) ? checkedAt : date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
