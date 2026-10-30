import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { controlClassName } from "@/components/ui/field";
import { isNode } from "@/lib/host/host";
import { cn } from "@/lib/utils/cn";

import { useHost, useOnHostGone } from "./host-context";
import { CalendarIcon } from "./icons";

export type DatePickerMode = "date" | "datetime";

export type DatePickerParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type CalendarCell = {
  year: number;
  month: number;
  day: number;
  inMonth: boolean;
};

const monthNames = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

const weekdayShortLabels = [
  { key: "dom", label: "D", full: "Domingo" },
  { key: "seg", label: "S", full: "Segunda-feira" },
  { key: "ter", label: "T", full: "Terça-feira" },
  { key: "qua", label: "Q", full: "Quarta-feira" },
  { key: "qui", label: "Q", full: "Quinta-feira" },
  { key: "sex", label: "S", full: "Sexta-feira" },
  { key: "sab", label: "S", full: "Sábado" },
] as const;

const hours = Array.from({ length: 24 }, (_, index) => index);
const minutes = Array.from({ length: 60 }, (_, index) => index);

const gap = 6;
const viewportMargin = 8;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Lê `"YYYY-MM-DD"` ou `"YYYY-MM-DDTHH:mm"` sem passar pelo construtor `new Date(iso)`,
 * evitando deslocamento de fuso horário em datas puras.
 */
export function parseDatePickerValue(value: string): DatePickerParts | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] !== undefined ? Number(match[4]) : 0;
  const minute = match[5] !== undefined ? Number(match[5]) : 0;

  if (year < 1900 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;

  return { year, month, day, hour, minute };
}

export function formatDatePickerValue(
  parts: { year: number; month: number; day: number; hour?: number; minute?: number },
  mode: DatePickerMode,
): string {
  const datePart = `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
  if (mode === "date") return datePart;
  return `${datePart}T${pad2(parts.hour ?? 0)}:${pad2(parts.minute ?? 0)}`;
}

export function formatDatePickerDisplay(value: string, mode: DatePickerMode): string {
  const parsed = parseDatePickerValue(value);
  if (!parsed) return "";
  const dateDisplay = `${pad2(parsed.day)}/${pad2(parsed.month)}/${pad4(parsed.year)}`;
  if (mode === "date") return dateDisplay;
  return `${dateDisplay} ${pad2(parsed.hour)}:${pad2(parsed.minute)}`;
}

/**
 * Grade fixa de 6 semanas (42 dias) começando no domingo, para o painel nunca mudar de altura ao trocar de mês.
 */
export function buildCalendarGrid(year: number, month: number): CalendarCell[] {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const currentMonthDays = daysInMonth(year, month);

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthDays = daysInMonth(prevYear, prevMonth);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  const cells: CalendarCell[] = [];

  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({
      year: prevYear,
      month: prevMonth,
      day: prevMonthDays - i,
      inMonth: false,
    });
  }

  for (let day = 1; day <= currentMonthDays; day++) {
    cells.push({
      year,
      month,
      day,
      inMonth: true,
    });
  }

  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({
      year: nextYear,
      month: nextMonth,
      day: nextDay++,
      inMonth: false,
    });
  }

  return cells;
}

function nowParts(now: Date = new Date()): DatePickerParts {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
  };
}

export type DatePickerProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  mode?: DatePickerMode;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
  className?: string;
};

type PanelPosition = {
  left: number;
  top?: number;
  bottom?: number;
};

/**
 * Seletor de data (`mode="date"`) ou data e hora (`mode="datetime"`) nos tokens do Prism.
 * Abre num portal `position: fixed` em `document.body` para nunca ser cortado por diálogos ou menus.
 */
export function DatePicker({
  id,
  name,
  value,
  onChange,
  mode = "date",
  placeholder,
  clearable = true,
  disabled = false,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "data-testid": dataTestId,
  className,
}: DatePickerProps) {
  const generatedId = useId();
  const triggerId = id ?? `datepicker-${generatedId}`;
  const popoverId = `${triggerId}-popover`;

  const host = useHost();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const parsed = parseDatePickerValue(value);
  const today = nowParts();

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => parsed?.year ?? today.year);
  const [viewMonth, setViewMonth] = useState(() => parsed?.month ?? today.month);
  const [position, setPosition] = useState<PanelPosition | null>(null);

  if (open && disabled) setOpen(false);

  const defaultPlaceholder = mode === "datetime" ? "dd/mm/aaaa --:--" : "dd/mm/aaaa";
  const displayValue = formatDatePickerDisplay(value, mode);

  function openPopover() {
    if (disabled) return;
    const target = parseDatePickerValue(value) ?? nowParts();
    setViewYear(target.year);
    setViewMonth(target.month);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    function place() {
      const trigger = buttonRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const estimatedWidth = mode === "datetime" ? 364 : 256;
      const estimatedHeight = 304;
      const panelWidth = panelRef.current?.offsetWidth ?? estimatedWidth;
      const panelHeight = panelRef.current?.offsetHeight ?? estimatedHeight;

      const below = host.view.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      const dropUp = below < panelHeight && above > below;

      const maxLeft = Math.max(viewportMargin, host.view.innerWidth - panelWidth - viewportMargin);
      const left = Math.max(viewportMargin, Math.min(rect.left, maxLeft));

      setPosition({
        left,
        ...(dropUp
          ? { bottom: host.view.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
      });
    }

    place();
    host.view.addEventListener("scroll", place, true);
    host.view.addEventListener("resize", place);
    return () => {
      host.view.removeEventListener("scroll", place, true);
      host.view.removeEventListener("resize", place);
    };
  }, [open, mode, host]);

  useOnHostGone(host, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        isNode(target) &&
        (buttonRef.current?.contains(target) || panelRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    host.document.addEventListener("pointerdown", onPointerDown);
    host.view.addEventListener("keydown", onKeyDown, true);
    return () => {
      host.document.removeEventListener("pointerdown", onPointerDown);
      host.view.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, host]);

  function stepMonth(delta: number) {
    const nextDate = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(nextDate.getFullYear());
    setViewMonth(nextDate.getMonth() + 1);
  }

  function handleSelectDay(cell: CalendarCell) {
    const current = parsed ?? { ...today, hour: 0, minute: 0 };
    const nextValue = formatDatePickerValue(
      {
        year: cell.year,
        month: cell.month,
        day: cell.day,
        hour: current.hour,
        minute: current.minute,
      },
      mode,
    );
    setViewYear(cell.year);
    setViewMonth(cell.month);

    if (mode === "date") {
      setOpen(false);
      buttonRef.current?.focus();
    }
    onChange(nextValue);
  }

  function handleSelectHour(hour: number) {
    const base = parsed ?? today;
    onChange(
      formatDatePickerValue(
        {
          year: base.year,
          month: base.month,
          day: base.day,
          hour,
          minute: parsed?.minute ?? 0,
        },
        "datetime",
      ),
    );
  }

  function handleSelectMinute(minute: number) {
    const base = parsed ?? today;
    onChange(
      formatDatePickerValue(
        {
          year: base.year,
          month: base.month,
          day: base.day,
          hour: parsed?.hour ?? base.hour,
          minute,
        },
        "datetime",
      ),
    );
  }

  function handlePickToday() {
    const currentNow = nowParts();
    setViewYear(currentNow.year);
    setViewMonth(currentNow.month);
    const nextValue = formatDatePickerValue(currentNow, mode);
    if (mode === "date") {
      setOpen(false);
      buttonRef.current?.focus();
    }
    onChange(nextValue);
  }

  function handleClear() {
    setOpen(false);
    buttonRef.current?.focus();
    onChange("");
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) setOpen(false);
      else openPopover();
    }
  }

  const cells = buildCalendarGrid(viewYear, viewMonth);
  const monthLabel = `${monthNames[viewMonth - 1]} de ${viewYear}`;

  return (
    <div className="relative">
      {name === undefined ? null : <input type="hidden" name={name} value={value} />}

      <button
        ref={buttonRef}
        id={triggerId}
        type="button"
        data-testid={dataTestId}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => (open ? setOpen(false) : openPopover())}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          controlClassName,
          "flex cursor-pointer items-center justify-between gap-2 text-left",
          open && "border-accent ring-1 ring-accent",
          className,
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            displayValue ? "font-mono text-ink" : "text-subtle",
          )}
        >
          {displayValue || placeholder || defaultPlaceholder}
        </span>
        <CalendarIcon className="size-3.5 flex-none text-subtle" />
      </button>

      {open && position !== null
        ? createPortal(
            <div
              ref={panelRef}
              id={popoverId}
              role="dialog"
              aria-label={mode === "datetime" ? "Selecionar data e hora" : "Selecionar data"}
              data-datepicker-popover="true"
              style={{ position: "fixed", ...position }}
              className="z-50 flex rounded-md border border-border-strong bg-raised p-3 text-xs text-ink shadow-2xl select-none"
            >
              {/* Coluna do calendário */}
              <div className="flex w-[228px] flex-col gap-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-ink capitalize">{monthLabel}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label="Mês anterior"
                      onClick={() => stepMonth(-1)}
                      className="flex size-6 cursor-pointer items-center justify-center rounded text-sm text-muted transition-colors hover:bg-selected hover:text-ink"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      aria-label="Próximo mês"
                      onClick={() => stepMonth(1)}
                      className="flex size-6 cursor-pointer items-center justify-center rounded text-sm text-muted transition-colors hover:bg-selected hover:text-ink"
                    >
                      ›
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {weekdayShortLabels.map((weekday) => (
                    <span
                      key={weekday.key}
                      title={weekday.full}
                      className=" flex h-6 items-center justify-center text-[11px] font-medium text-subtle"
                    >
                      {weekday.label}
                    </span>
                  ))}

                  {cells.map((cell) => {
                    const isSelected =
                      parsed !== null &&
                      parsed.year === cell.year &&
                      parsed.month === cell.month &&
                      parsed.day === cell.day;
                    const isToday =
                      today.year === cell.year &&
                      today.month === cell.month &&
                      today.day === cell.day;
                    const cellIso = `${pad4(cell.year)}-${pad2(cell.month)}-${pad2(cell.day)}`;
                    const cellLabel = `${pad2(cell.day)}/${pad2(cell.month)}/${pad4(cell.year)}`;

                    return (
                      <button
                        key={cellIso}
                        type="button"
                        data-date={cellIso}
                        aria-label={cellLabel}
                        aria-pressed={isSelected}
                        onClick={() => handleSelectDay(cell)}
                        className={cn(
                          "flex h-7 w-full cursor-pointer items-center justify-center rounded font-mono text-xs transition-colors",
                          isSelected
                            ? "bg-accent font-semibold text-panel"
                            : isToday
                              ? "border border-accent/60 font-semibold text-ink hover:bg-selected"
                              : cell.inMonth
                                ? "text-body hover:bg-selected hover:text-ink"
                                : "text-subtle/55 hover:bg-selected hover:text-muted",
                        )}
                      >
                        {cell.day}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-0.5 flex items-center justify-between border-t border-border pt-2">
                  {clearable ? (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-selected hover:text-ink"
                    >
                      Limpar
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={handlePickToday}
                    className="cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-selected"
                  >
                    {mode === "datetime" ? "Agora" : "Hoje"}
                  </button>
                </div>
              </div>

              {/* Coluna de horário (apenas em mode="datetime") */}
              {mode === "datetime" ? (
                <div className="ml-3 flex flex-col border-l border-border pl-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-subtle">Horário</span>
                    <span className="font-mono text-xs font-semibold text-ink">
                      {pad2(parsed?.hour ?? 0)}:{pad2(parsed?.minute ?? 0)}
                    </span>
                  </div>

                  <div className="grid h-[182px] grid-cols-2 gap-1">
                    <div
                      role="listbox"
                      aria-label="Horas"
                      className="flex flex-col gap-0.5 overflow-y-auto pr-0.5"
                    >
                      {hours.map((hour) => {
                        const selectedHour = (parsed?.hour ?? 0) === hour && parsed !== null;
                        return (
                          <button
                            key={hour}
                            type="button"
                            role="option"
                            aria-selected={selectedHour}
                            onClick={() => handleSelectHour(hour)}
                            className={cn(
                              "flex h-6 w-10 cursor-pointer items-center justify-center rounded font-mono text-xs transition-colors",
                              selectedHour
                                ? "bg-accent font-semibold text-panel"
                                : "text-body hover:bg-selected hover:text-ink",
                            )}
                          >
                            {pad2(hour)}
                          </button>
                        );
                      })}
                    </div>

                    <div
                      role="listbox"
                      aria-label="Minutos"
                      className="flex flex-col gap-0.5 overflow-y-auto pr-0.5"
                    >
                      {minutes.map((minute) => {
                        const selectedMinute = (parsed?.minute ?? 0) === minute && parsed !== null;
                        return (
                          <button
                            key={minute}
                            type="button"
                            role="option"
                            aria-selected={selectedMinute}
                            onClick={() => handleSelectMinute(minute)}
                            className={cn(
                              "flex h-6 w-10 cursor-pointer items-center justify-center rounded font-mono text-xs transition-colors",
                              selectedMinute
                                ? "bg-accent font-semibold text-panel"
                                : "text-body hover:bg-selected hover:text-ink",
                            )}
                          >
                            {pad2(minute)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-auto border-t border-border pt-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        buttonRef.current?.focus();
                      }}
                      className="cursor-pointer rounded bg-selected px-2 py-0.5 text-xs font-medium text-ink transition-colors hover:brightness-110"
                    >
                      OK
                    </button>
                  </div>
                </div>
              ) : null}
            </div>,
            host.document.body,
          )
        : null}
    </div>
  );
}

export type DateTimePickerProps = Omit<DatePickerProps, "mode">;

export function DateTimePicker(props: DateTimePickerProps) {
  return DatePicker({ ...props, mode: "datetime" });
}
