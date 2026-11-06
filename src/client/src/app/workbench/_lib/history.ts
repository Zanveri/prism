import { historyCopy } from "./history.copy";
import type { HistoryItem } from "./history.service";

const SHORT_MONTHS = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez."
] as const;

export type HistoryDayGroup = {
  day: string;
  items: HistoryItem[];
};

export type OpenQueryTabInput = {
  connectionId: string | null;
  database?: string;
  sql: string;
};

function formatDayLabel(date: Date, now: Date): string {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );
  const itemDayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  if (itemDayStart.getTime() === todayStart.getTime()) {
    return historyCopy.today;
  }
  if (itemDayStart.getTime() === yesterdayStart.getTime()) {
    return historyCopy.yesterday;
  }

  const day = date.getDate();
  const month = SHORT_MONTHS[date.getMonth()] ?? "";
  if (date.getFullYear() !== now.getFullYear()) {
    return `${day} de ${month} de ${date.getFullYear()}`;
  }
  return `${day} de ${month}`;
}

export function groupByDay(
  items: readonly HistoryItem[],
  now: Date = new Date()
): HistoryDayGroup[] {
  const groups: HistoryDayGroup[] = [];

  for (const item of items) {
    const timestamp = item.lastAt || item.startedAt;
    const date = new Date(timestamp);
    const label = formatDayLabel(date, now);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.day === label) {
      lastGroup.items.push(item);
    } else {
      groups.push({ day: label, items: [item] });
    }
  }

  return groups;
}

export function insertAtCursor(
  doc: string,
  cursor: number,
  text: string
): { doc: string; cursor: number } {
  const pos = Math.max(0, Math.min(doc.length, cursor));
  const before = doc.slice(0, pos);
  const after = doc.slice(pos);

  const hasBefore = before.trim().length > 0;
  const hasAfter = after.trim().length > 0;

  if (!hasBefore && !hasAfter) {
    return { doc: text, cursor: text.length };
  }

  if (hasBefore && !hasAfter) {
    const cleanBefore = before.replace(/(?:\r?\n)+$/, "");
    const nextDoc = `${cleanBefore}\n\n${text}`;
    return { doc: nextDoc, cursor: nextDoc.length };
  }

  if (!hasBefore && hasAfter) {
    const cleanAfter = after.replace(/^(?:\r?\n)+/, "");
    const nextDoc = `${text}\n\n${cleanAfter}`;
    return { doc: nextDoc, cursor: text.length };
  }

  const cleanBefore = before.replace(/(?:\r?\n)+$/, "");
  const cleanAfter = after.replace(/^(?:\r?\n)+/, "");
  const prefix = `${cleanBefore}\n\n${text}`;
  return {
    doc: `${prefix}\n\n${cleanAfter}`,
    cursor: prefix.length
  };
}

export function openFromHistory(
  item: Pick<HistoryItem, "connectionId" | "database" | "text">,
  connections: readonly { id: string }[]
): OpenQueryTabInput {
  if (
    item.connectionId !== null &&
    connections.some((c) => c.id === item.connectionId)
  ) {
    return {
      connectionId: item.connectionId,
      ...(item.database ? { database: item.database } : {}),
      sql: item.text
    };
  }

  return {
    connectionId: null,
    sql: item.text
  };
}

export function formatHistoryTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function splitPreviewLines(text: string, maxLines = 3): {
  preview: string;
  extraLines: number;
} {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return { preview: text, extraLines: 0 };
  }
  return {
    preview: lines.slice(0, maxLines).join("\n"),
    extraLines: lines.length - maxLines
  };
}
