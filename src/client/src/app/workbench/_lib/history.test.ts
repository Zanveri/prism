import { describe, expect, it } from "vitest";
import type { HistoryItem } from "./history.service";
import { groupByDay, insertAtCursor, openFromHistory } from "./history";

function makeItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 1,
    startedAt: "2026-10-30T14:32:08.000Z",
    durationMs: 14,
    outcome: "succeeded",
    rows: 1,
    connectionId: "conn-1",
    connectionName: "db2-prod-sul",
    database: "FINANCEIRO",
    environmentName: "PROD",
    environmentColor: "#EF4444",
    text: "SELECT 1;",
    errorMessage: null,
    repeat: 1,
    lastAt: "2026-10-30T14:32:08.000Z",
    ...overrides
  };
}

describe("groupByDay", () => {
  it("groups items around local midnight into Hoje, Ontem and D de mmm.", () => {
    const now = new Date(2026, 9, 30, 15, 0, 0); // 30 de outubro de 2026, 15:00 local
    const todayStart = new Date(2026, 9, 30, 0, 0, 1).toISOString();
    const yesterdayEnd = new Date(2026, 9, 29, 23, 59, 59).toISOString();
    const yesterdayStart = new Date(2026, 9, 29, 0, 0, 0).toISOString();
    const oct28End = new Date(2026, 9, 28, 23, 59, 59).toISOString();

    const items: HistoryItem[] = [
      makeItem({ id: 4, startedAt: todayStart, lastAt: todayStart }),
      makeItem({ id: 3, startedAt: yesterdayEnd, lastAt: yesterdayEnd }),
      makeItem({ id: 2, startedAt: yesterdayStart, lastAt: yesterdayStart }),
      makeItem({ id: 1, startedAt: oct28End, lastAt: oct28End })
    ];

    const groups = groupByDay(items, now);

    expect(groups).toEqual([
      { day: "Hoje", items: [items[0]] },
      { day: "Ontem", items: [items[1], items[2]] },
      { day: "28 de out.", items: [items[3]] }
    ]);
  });

  it("uses lastAt when present for repeated items", () => {
    const now = new Date(2026, 9, 30, 15, 0, 0);
    const yesterday = new Date(2026, 9, 29, 20, 0, 0).toISOString();
    const today = new Date(2026, 9, 30, 9, 0, 0).toISOString();

    const item = makeItem({ id: 10, startedAt: yesterday, lastAt: today, repeat: 3 });
    const groups = groupByDay([item], now);

    expect(groups).toEqual([{ day: "Hoje", items: [item] }]);
  });
});

describe("insertAtCursor", () => {
  it("inserts into an empty document without extra blank lines", () => {
    const result = insertAtCursor("", 0, "SELECT 1;");
    expect(result).toEqual({
      doc: "SELECT 1;",
      cursor: "SELECT 1;".length
    });
  });

  it("inserts at the end separated by one blank line and never two", () => {
    const first = insertAtCursor("SELECT 1;", 9, "SELECT 2;");
    expect(first).toEqual({
      doc: "SELECT 1;\n\nSELECT 2;",
      cursor: "SELECT 1;\n\nSELECT 2;".length
    });

    const withExistingBlank = insertAtCursor("SELECT 1;\n\n", 11, "SELECT 2;");
    expect(withExistingBlank).toEqual({
      doc: "SELECT 1;\n\nSELECT 2;",
      cursor: "SELECT 1;\n\nSELECT 2;".length
    });
  });

  it("inserts in the middle with one blank line before and one after, never two", () => {
    const doc = "SELECT 1;\nSELECT 3;";
    const pos = "SELECT 1;\n".length;
    const result = insertAtCursor(doc, pos, "SELECT 2;");

    expect(result).toEqual({
      doc: "SELECT 1;\n\nSELECT 2;\n\nSELECT 3;",
      cursor: "SELECT 1;\n\nSELECT 2;".length
    });

    const alreadyBlankDoc = "SELECT 1;\n\n\nSELECT 3;";
    const posBlank = "SELECT 1;\n\n".length;
    const resultBlank = insertAtCursor(alreadyBlankDoc, posBlank, "SELECT 2;");

    expect(resultBlank).toEqual({
      doc: "SELECT 1;\n\nSELECT 2;\n\nSELECT 3;",
      cursor: "SELECT 1;\n\nSELECT 2;".length
    });
  });
});

describe("openFromHistory", () => {
  it("openFromHistory_withMissingConnection_opensUnboundTab", () => {
    const item = makeItem({
      connectionId: "conn-deleted",
      database: "FINANCEIRO",
      text: "SELECT * FROM lancamento;"
    });

    const tab = openFromHistory(item, [{ id: "conn-1" }]);

    expect(tab).toEqual({
      connectionId: null,
      sql: "SELECT * FROM lancamento;"
    });
  });

  it("opens bound tab when connection still exists in the vault", () => {
    const item = makeItem({
      connectionId: "conn-1",
      database: "FINANCEIRO",
      text: "SELECT * FROM lancamento;"
    });

    const tab = openFromHistory(item, [{ id: "conn-1" }]);

    expect(tab).toEqual({
      connectionId: "conn-1",
      database: "FINANCEIRO",
      sql: "SELECT * FROM lancamento;"
    });
  });
});
