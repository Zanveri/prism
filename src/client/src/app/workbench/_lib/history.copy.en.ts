import type { HistoryCopy } from "./history.copy";

export const historyCopyEn: HistoryCopy = {
  title: "History",
  toolbarButton: "History",
  toolbarTooltip: "History (Ctrl+Shift+H)",
  close: "Close history",
  searchPlaceholder: "Search in the statement…",
  clearSearch: "Clear search",
  scopeAria: "History scope",
  scopeThisConnection: "This connection",
  scopeAllConnections: "All connections",
  today: "Today",
  yesterday: "Yesterday",
  outcomes: {
    ok: "completed",
    succeeded: "completed",
    error: "error",
    cancelled: "cancelled",
    interrupted: "interrupted",
    refused: "refused",
    inProgress: "interrupted",
    running: "interrupted"
  },
  rowsFormat: (count: number) =>
    count === 1 ? "1 row" : `${count.toLocaleString("en")} rows`,
  durationFormat: (ms: number | null) => {
    if (ms === null) return "—";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  },
  moreLines: (extra: number) => (extra === 1 ? "+1 line" : `+${extra} lines`),
  repeatBadge: (repeat: number) => `×${repeat}`,
  repeatTitle: (repeat: number) => `Run ${repeat} times in a row`,
  empty: "No statements recorded yet.",
  emptyFiltered: "No statements found for this search.",
  loading: "Loading history…",
  loadMore: "Load more",
  insertAtCursor: "Insert at cursor",
  insertAtCursorHint: "Insert at cursor (Enter)",
  openInNewTab: "Open in new tab",
  openInNewTabHint: "Open in new tab (Shift+Enter)",
  copy: "Copy",
  copied: "Copied",
  copyHint: "Copy (Ctrl+C)",
  removeFromHistory: "Remove from history",
  removeFromHistoryHint: "Remove from history (Delete)",
  clearConnectionTrigger: "Clear this connection’s history",
  clearConnectionConfirmTitle: (name: string) =>
    `Clear the history of ${name}?`,
  clearConnectionConfirmNote:
    "The records remain in the Audit.",
  clearConnectionConfirmButton: "Clear history",
  clearConnectionCancelButton: "Cancel"
};
