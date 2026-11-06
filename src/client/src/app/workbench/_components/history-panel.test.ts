import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elementsOf } from "@/lib/testing/react-tree";
import type { HistoryItem } from "../_lib/history.service";
import { EditorToolbar } from "./editor-toolbar";
import { HistoryPanel } from "./history-panel";

const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});

const mocks = vi.hoisted(() => ({
  pages: [] as HistoryItem[][],
  isLoading: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  invalidateQueries: vi.fn(),
  hideEntry: vi.fn<(...args: [number]) => Promise<void>>(async () => undefined),
  hideConnection: vi.fn<(...args: [string]) => Promise<void>>(async () => undefined)
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...rt.hooks
}));

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    data: { pages: mocks.pages },
    isLoading: mocks.isLoading,
    hasNextPage: mocks.hasNextPage,
    isFetchingNextPage: mocks.isFetchingNextPage,
    fetchNextPage: mocks.fetchNextPage
  }),
  useMutation: (opts: {
    mutationFn: (...args: unknown[]) => Promise<unknown>;
    onSuccess?: () => void;
  }) => ({
    mutate: (...args: unknown[]) => {
      void opts.mutationFn(...args).then(() => opts.onSuccess?.());
    },
    isPending: false
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("../_lib/history.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_lib/history.service")>();
  return {
    ...actual,
    hideHistoryEntry: (...args: [number]) => mocks.hideEntry(...args),
    hideConnectionHistory: (...args: [string]) => mocks.hideConnection(...args)
  };
});

function makeItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 42,
    startedAt: new Date().toISOString(),
    durationMs: 14,
    outcome: "succeeded",
    rows: 120,
    connectionId: "conn-1",
    connectionName: "db2-prod-sul",
    database: "FINANCEIRO",
    environmentName: "PROD",
    environmentColor: "#EF4444",
    text: "SELECT id, valor FROM lancamento\nWHERE competencia = '2026-10'\nORDER BY id\nFETCH FIRST 100 ROWS ONLY;",
    errorMessage: null,
    repeat: 1,
    lastAt: new Date().toISOString(),
    ...overrides
  };
}

describe("HistoryPanel and EditorToolbar history button", () => {
  beforeEach(() => {
    mocks.pages = [
      [
        makeItem({ id: 1, outcome: "succeeded", repeat: 3 }),
        makeItem({
          id: 2,
          outcome: "error",
          rows: null,
          text: "UPDATE lancamento SET valor = 0;",
          errorMessage: "SQL0803N One or more values in the INSERT statement are not valid."
        }),
        makeItem({
          id: 3,
          outcome: "cancelled",
          rows: null,
          text: "SELECT '<script>alert(1)</script>' FROM sysibm.sysdummy1;"
        })
      ]
    ];
    mocks.isLoading = false;
    mocks.hasNextPage = false;
    mocks.isFetchingNextPage = false;
    mocks.fetchNextPage.mockClear();
    mocks.invalidateQueries.mockClear();
    mocks.hideEntry.mockClear();
    mocks.hideConnection.mockClear();
  });

  afterEach(() => {
    rt.unmount();
  });

  it("renders EditorToolbar history button with aria-keyshortcuts Control+Shift+H", () => {
    const html = renderToStaticMarkup(
      EditorToolbar({
        busy: false,
        cancelling: false,
        runnable: true,
        scriptShortcut: { label: "Alt+X", aria: "Alt+X" },
        historyOpen: true,
        onRun: () => undefined,
        onRunScript: () => undefined,
        onCancel: () => undefined,
        onToggleHistory: () => undefined
      })
    );

    expect(html).toContain('aria-keyshortcuts="Control+Shift+H"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Histórico");
  });

  it("focuses search input, selects 'Esta conexão' by default, writes outcome label in text and escapes SQL from journal (RN-SHELL-002)", () => {
    const props = {
      connectionId: "conn-1",
      connectionName: "db2-prod-sul",
      driver: "Db2" as const,
      onInsertAtCursor: () => undefined,
      onOpenInNewTab: () => undefined,
      onClose: () => undefined
    };
    const tree = rt.render(() => HistoryPanel(props));
    const all = elementsOf(tree);

    const searchInput = all.find(
      (el) => el.type === "input" && el.props.type === "search"
    );
    expect(searchInput?.props.autoFocus).toBe(true);

    const connectionScope = all.find(
      (el) =>
        el.props.role === "radio" &&
        String(el.props.children).includes("Esta conexão")
    );
    expect(connectionScope?.props["aria-checked"]).toBe(true);

    const html = renderToStaticMarkup(tree);
    // Outcome written as text, not only color
    expect(html).toContain("concluído");
    expect(html).toContain("erro");
    expect(html).toContain("cancelado");
    // Repeat badge
    expect(html).toContain("×3");
    // Escaped HTML from journal (RN-SHELL-002)
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("supports keyboard navigation: Enter inserts at cursor, Shift+Enter opens in new tab, Delete hides entry, Esc clears search then closes", () => {
    const inserted: string[] = [];
    const opened: HistoryItem[] = [];
    let closed = 0;

    const props = {
      connectionId: "conn-1",
      connectionName: "db2-prod-sul",
      driver: "Db2" as const,
      onInsertAtCursor: (sql: string) => inserted.push(sql),
      onOpenInNewTab: (item: HistoryItem) => opened.push(item),
      onClose: () => {
        closed += 1;
      }
    };

    let tree = rt.render(() => HistoryPanel(props));
    let all = elementsOf(tree);

    let panelRoot = all.find(
      (el) =>
        typeof el.props.onKeyDown === "function" &&
        el.props["aria-label"] === "Histórico"
    );
    expect(panelRoot).toBeDefined();

    // Enter inserts first item at cursor
    (panelRoot?.props.onKeyDown as (e: unknown) => void)({
      key: "Enter",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined
    });
    expect(inserted).toEqual([mocks.pages[0][0].text]);

    // ArrowDown moves selection to second item, Shift+Enter opens in new tab
    (panelRoot?.props.onKeyDown as (e: unknown) => void)({
      key: "ArrowDown",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined
    });

    tree = rt.render(() => HistoryPanel(props));
    all = elementsOf(tree);
    panelRoot = all.find(
      (el) =>
        typeof el.props.onKeyDown === "function" &&
        el.props["aria-label"] === "Histórico"
    );

    (panelRoot?.props.onKeyDown as (e: unknown) => void)({
      key: "Enter",
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined
    });
    expect(opened).toEqual([mocks.pages[0][1]]);

    // Delete hides selected entry
    (panelRoot?.props.onKeyDown as (e: unknown) => void)({
      key: "Delete",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined
    });
    expect(mocks.hideEntry).toHaveBeenCalledWith(2);

    // Search input with text: Esc clears search first, second Esc closes panel
    const searchInput = all.find(
      (el) => el.type === "input" && el.props.type === "search"
    );
    (searchInput?.props.onChange as (e: unknown) => void)({
      target: { value: "lancamento" }
    });

    tree = rt.render(() => HistoryPanel(props));
    all = elementsOf(tree);
    panelRoot = all.find(
      (el) =>
        typeof el.props.onKeyDown === "function" &&
        el.props["aria-label"] === "Histórico"
    );

    (panelRoot?.props.onKeyDown as (e: unknown) => void)({
      key: "Escape",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined
    });
    expect(closed).toBe(0);

    tree = rt.render(() => HistoryPanel(props));
    all = elementsOf(tree);
    panelRoot = all.find(
      (el) =>
        typeof el.props.onKeyDown === "function" &&
        el.props["aria-label"] === "Histórico"
    );

    (panelRoot?.props.onKeyDown as (e: unknown) => void)({
      key: "Escape",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined
    });
    expect(closed).toBe(1);
  });

  it("asks confirmation before clearing the connection history (RN-HIST-006)", () => {
    const props = {
      connectionId: "conn-1",
      connectionName: "db2-prod-sul",
      driver: "Db2" as const,
      onInsertAtCursor: () => undefined,
      onOpenInNewTab: () => undefined,
      onClose: () => undefined
    };

    let tree = rt.render(() => HistoryPanel(props));
    let all = elementsOf(tree);

    const clearTrigger = all.find(
      (el) =>
        el.type === "button" &&
        typeof el.props.children === "string" &&
        el.props.children.includes("Limpar o histórico desta conexão")
    );
    expect(clearTrigger).toBeDefined();

    (clearTrigger?.props.onClick as () => void)();
    expect(mocks.hideConnection).not.toHaveBeenCalled();

    tree = rt.render(() => HistoryPanel(props));
    all = elementsOf(tree);

    const confirmBtn = all.find(
      (el) =>
        typeof el.props.onClick === "function" &&
        el.props.children === "Limpar histórico"
    );
    expect(confirmBtn).toBeDefined();

    (confirmBtn?.props.onClick as () => void)();
    expect(mocks.hideConnection).toHaveBeenCalledWith("conn-1");
  });
});
