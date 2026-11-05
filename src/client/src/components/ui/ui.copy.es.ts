import type { UiCopy } from "./ui.copy";

export const uiCopyEs: UiCopy = {
  cancel: "Cancelar",
  close: "Cerrar",
  toast: { close: "Cerrar aviso" },
  datePicker: {
    months: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
    weekdays: [
      { key: "dom", label: "D", full: "Domingo" },
      { key: "seg", label: "L", full: "Lunes" },
      { key: "ter", label: "M", full: "Martes" },
      { key: "qua", label: "X", full: "Miércoles" },
      { key: "qui", label: "J", full: "Jueves" },
      { key: "sex", label: "V", full: "Viernes" },
      { key: "sab", label: "S", full: "Sábado" },
    ],
    monthOfYear: (month: string, year: number) => `${month} de ${year}`,
    selectDate: "Seleccionar fecha",
    selectDateTime: "Seleccionar fecha y hora",
    previousMonth: "Mes anterior",
    nextMonth: "Mes siguiente",
    clear: "Borrar",
    now: "Ahora",
    today: "Hoy",
    time: "Hora",
    hours: "Horas",
    minutes: "Minutos",
  },
};
