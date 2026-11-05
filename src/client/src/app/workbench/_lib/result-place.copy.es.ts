import type { ResultPlaceCopy } from "./result-place.copy";

export const resultPlaceCopyEs: ResultPlaceCopy = {
  places: { panel: "En el panel", tab: "En una pestaña", window: "En una ventana" },
  placeLower: { panel: "en el panel", tab: "en una pestaña", window: "en una ventana" },
  button: {
    label: "Dónde mostrar el resultado",
    named: (place: string) => `Dónde mostrar el resultado: ${place}`,
    menuLabel: "Dónde mostrar el resultado",
  },
  moving: "La pestaña se está moviendo a otra ventana.",
  windowFailed: "No se pudo abrir la ventana del resultado.",
  announcement: { panel: "Resultado ahora en el panel.", tab: "Resultado ahora en una pestaña.", window: "Resultado ahora en una ventana." },
  tab: {
    title: (title: string) => `Resultado · ${title}`,
    hint: (title: string) => `Resultado de ${title}. F6 alterna con la consulta.`,
    panelLabel: (title: string) => `Resultado de ${title}`,
    running: ", ejecutando",
    unseen: ", resultado nuevo",
    close: (title: string) => `Devolver el resultado de ${title} al panel`,
    closeHint: (shortcut: string) => `Volver al panel (${shortcut})`,
    menuLabel: (title: string) => `Pestaña Resultado · ${title}`,
    goToQuery: "Ir a la consulta",
    backToPanel: "Volver al panel",
    f6: "F6",
  },
  window: {
    title: (title: string) => `Resultado · ${title} — Prism`,
    mainLabel: (title: string) => `Resultado de ${title}`,
    back: "Volver al panel",
    backHint: (shortcut: string) => `Volver al panel (${shortcut})`,
  },
  settings: {
    label: "Dónde aparece el resultado de las pestañas nuevas",
    hint: "Vale para las pestañas de consulta que se abran de ahora en adelante. Cada pestaña guarda su lugar, que el botón 'Dónde mostrar el resultado' del área de resultado cambia.",
  },
};
