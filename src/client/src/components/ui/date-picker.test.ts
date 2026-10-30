import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  ...rt.hooks,
}));
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: unknown) => children,
}));

import { elementsOf } from "@/lib/testing/react-tree";

import {
  buildCalendarGrid,
  DatePicker,
  DateTimePicker,
  daysInMonth,
  formatDatePickerDisplay,
  formatDatePickerValue,
  parseDatePickerValue,
} from "./date-picker";

const control = {
  focus: vi.fn(),
  getBoundingClientRect: () => ({ left: 120, right: 320, width: 200, top: 80, bottom: 112 }),
};
const body = { name: "body" };
const page = {
  activeElement: body as unknown,
  body,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("DatePicker: leitura, formatação e grade do calendário sem deslocamento de fuso", () => {
  it("lê e formata datas e data/hora preservando dia, mês, ano, hora e minuto exatos", () => {
    const dateParts = parseDatePickerValue("2026-10-30");
    expect(dateParts).toEqual({ year: 2026, month: 10, day: 30, hour: 0, minute: 0 });
    expect(formatDatePickerValue(dateParts!, "date")).toBe("2026-10-30");
    expect(formatDatePickerDisplay("2026-10-30", "date")).toBe("30/10/2026");

    const dateTimeParts = parseDatePickerValue("2026-10-30T14:40");
    expect(dateTimeParts).toEqual({ year: 2026, month: 10, day: 30, hour: 14, minute: 40 });
    expect(formatDatePickerValue(dateTimeParts!, "datetime")).toBe("2026-10-30T14:40");
    expect(formatDatePickerDisplay("2026-10-30T14:40", "datetime")).toBe("30/10/2026 14:40");
  });

  it("recusa datas inválidas como 31 de fevereiro ou mês 13", () => {
    expect(parseDatePickerValue("")).toBeNull();
    expect(parseDatePickerValue("2026-02-31")).toBeNull();
    expect(parseDatePickerValue("2026-13-01")).toBeNull();
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it("monta sempre 42 células (6 semanas) alinhadas pelo domingo", () => {
    const grid = buildCalendarGrid(2026, 10);
    expect(grid).toHaveLength(42);
    // Outubro de 2026 começa numa quinta-feira (4 dias de setembro antes: 27, 28, 29, 30)
    expect(grid[0]).toEqual({ year: 2026, month: 9, day: 27, inMonth: false });
    expect(grid[4]).toEqual({ year: 2026, month: 10, day: 1, inMonth: true });
    expect(grid[34]).toEqual({ year: 2026, month: 10, day: 31, inMonth: true });
  });
});

describe("DatePicker e DateTimePicker: interação", () => {
  it("no modo date, escolher um dia emite YYYY-MM-DD e fecha o calendário", () => {
    const onChange = vi.fn();
    const render = () => {
      const tree = rt.render(() =>
        DatePicker({
          id: "purge-before",
          value: "2026-10-30",
          onChange,
        }),
      );
      const all = elementsOf(tree);
      const trigger = all.find((el) => el.type === "button" && el.props.id === "purge-before")!;
      (trigger.props.ref as { current: unknown }).current = control;
      return { all, trigger };
    };

    const initial = render();
    expect(initial.trigger.props["aria-expanded"]).toBe(false);

    (initial.trigger.props.onClick as () => void)();
    render();
    const opened = render();

    const day15 = opened.all.find(
      (el) => el.type === "button" && el.props["aria-label"] === "15/10/2026",
    )!;
    (day15.props.onClick as () => void)();

    expect(onChange).toHaveBeenCalledWith("2026-10-15");
    const closed = render();
    expect(closed.trigger.props["aria-expanded"]).toBe(false);
  });

  it("no modo datetime, permite escolher dia, hora e minuto emitindo YYYY-MM-DDTHH:mm", () => {
    const onChange = vi.fn();
    const render = () => {
      const tree = rt.render(() =>
        DateTimePicker({
          id: "period-from",
          value: "2026-10-30T14:40",
          onChange,
        }),
      );
      const all = elementsOf(tree);
      const trigger = all.find((el) => el.type === "button" && el.props.id === "period-from")!;
      (trigger.props.ref as { current: unknown }).current = control;
      return { all, trigger };
    };

    const initial = render();
    (initial.trigger.props.onClick as () => void)();
    render();
    const opened = render();

    const day20 = opened.all.find(
      (el) => el.type === "button" && el.props["aria-label"] === "20/10/2026",
    )!;
    (day20.props.onClick as () => void)();
    expect(onChange).toHaveBeenLastCalledWith("2026-10-20T14:40");
  });
});
