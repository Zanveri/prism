import { pickCopy, type Localized } from "@/lib/i18n";

import { uiCopyEn } from "./ui.copy.en";
import { uiCopyEs } from "./ui.copy.es";

const pt = {
  cancel: "Cancelar",
  close: "Fechar",
  toast: { close: "Fechar aviso" },
  datePicker: {
    months: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
    /** `label` é a inicial na grade; `full` é a dica (`title`). */
    weekdays: [
      { key: "dom", label: "D", full: "Domingo" },
      { key: "seg", label: "S", full: "Segunda-feira" },
      { key: "ter", label: "T", full: "Terça-feira" },
      { key: "qua", label: "Q", full: "Quarta-feira" },
      { key: "qui", label: "Q", full: "Quinta-feira" },
      { key: "sex", label: "S", full: "Sexta-feira" },
      { key: "sab", label: "S", full: "Sábado" },
    ],
    monthOfYear: (month: string, year: number) => `${month} de ${year}`,
    selectDate: "Selecionar data",
    selectDateTime: "Selecionar data e hora",
    previousMonth: "Mês anterior",
    nextMonth: "Próximo mês",
    clear: "Limpar",
    now: "Agora",
    today: "Hoje",
    time: "Horário",
    hours: "Horas",
    minutes: "Minutos",
  },
} as const;

export type UiCopy = Localized<typeof pt>;
export const uiCopy = pickCopy({ "pt-BR": pt, en: uiCopyEn, es: uiCopyEs });
