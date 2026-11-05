import type { ResultPlaceCopy } from "./result-place.copy";

export const resultPlaceCopyEn: ResultPlaceCopy = {
  places: { panel: "In the panel", tab: "In a tab", window: "In a window" },
  placeLower: { panel: "in the panel", tab: "in a tab", window: "in a window" },
  button: {
    label: "Where to show the result",
    named: (place: string) => `Where to show the result: ${place}`,
    menuLabel: "Where to show the result",
  },
  moving: "The tab is moving to another window.",
  windowFailed: "Could not open the result window.",
  announcement: { panel: "Result now in the panel.", tab: "Result now in a tab.", window: "Result now in a window." },
  tab: {
    title: (title: string) => `Result · ${title}`,
    hint: (title: string) => `Result of ${title}. F6 switches to the query.`,
    panelLabel: (title: string) => `Result of ${title}`,
    running: ", running",
    unseen: ", new result",
    close: (title: string) => `Move the result of ${title} back to the panel`,
    closeHint: (shortcut: string) => `Back to the panel (${shortcut})`,
    menuLabel: (title: string) => `Result tab · ${title}`,
    goToQuery: "Go to the query",
    backToPanel: "Back to the panel",
    f6: "F6",
  },
  window: {
    title: (title: string) => `Result · ${title} — Prism`,
    mainLabel: (title: string) => `Result of ${title}`,
    back: "Back to the panel",
    backHint: (shortcut: string) => `Back to the panel (${shortcut})`,
  },
  settings: {
    label: "Where the result of new tabs appears",
    hint: "Applies to query tabs opened from now on. Each tab keeps its own place, which the 'Where to show the result' button in the result area changes.",
  },
};
