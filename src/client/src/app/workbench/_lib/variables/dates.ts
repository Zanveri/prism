import { VariableError } from "./errors";

/*
 * As datas da linguagem (RN-VAR-007): os campos do calendário, do ano ao milissegundo, na hora local da máquina e sem fuso. Compara-se e soma-se pelos campos; só
 * o `getTime` e o `new Date(ms)` passam pelo fuso da máquina, e pelo `Date` do JavaScript (a hora que a troca do horário de verão repete é a primeira, e a que ela
 * pula é a de depois). O `Date` do JavaScript nunca é um valor da linguagem.
 */

export type DateFields = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };

/** De dia (a data, à meia-noite) ou de instante (a data e a hora): diz como a data vai ao banco (RN-VAR-017). */
export type DatePrecision = "day" | "instant";

export const minYear = 1;
export const maxYear = 9999;

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Se os campos escrevem uma data que existe, entre 0001-01-01 e 9999-12-31 (RN-VAR-007). */
export function existsAsDate(fields: DateFields): boolean {
  const { year, month, day, hour, minute, second, millisecond } = fields;
  return (
    Number.isInteger(year) && year >= minYear && year <= maxYear && Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 &&
    day <= daysInMonth(year, month) && Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59 &&
    Number.isInteger(second) && second >= 0 && second <= 59 && Number.isInteger(millisecond) && millisecond >= 0 && millisecond <= 999
  );
}

/** Os dias desde 0001-01-01 (o dia 0) no calendário gregoriano, o mesmo para qualquer fuso. */
export function dayNumber(year: number, month: number, day: number): number {
  const previousYear = year - 1;
  let days = previousYear * 365 + Math.floor(previousYear / 4) - Math.floor(previousYear / 100) + Math.floor(previousYear / 400);
  for (let m = 1; m < month; m++) days += daysInMonth(year, m);
  return days + day - 1;
}

/** A data de um número de dia (o inverso de `dayNumber`). */
export function fromDayNumber(days: number): { year: number; month: number; day: number } {
  // Uma estimativa do ano e o acerto: os ciclos de 400 anos têm 146.097 dias.
  let year = Math.floor((days / 146_097) * 400) + 1;
  while (dayNumber(year, 1, 1) > days) year--;
  while (dayNumber(year + 1, 1, 1) <= days) year++;

  let remaining = days - dayNumber(year, 1, 1);
  let month = 1;
  while (remaining >= daysInMonth(year, month)) {
    remaining -= daysInMonth(year, month);
    month++;
  }
  return { year, month, day: remaining + 1 };
}

/** A hora do dia em milissegundos. */
export const timeOfDay = ({ hour, minute, second, millisecond }: DateFields) => ((hour * 60 + minute) * 60 + second) * 1000 + millisecond;

/** -1, 0 ou 1: a ordem de dois instantes do calendário, campo a campo. */
export function compareFields(left: DateFields, right: DateFields): number {
  const a = [left.year, left.month, left.day, left.hour, left.minute, left.second, left.millisecond];
  const b = [right.year, right.month, right.day, right.hour, right.minute, right.second, right.millisecond];
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

const two = (value: number) => String(value).padStart(2, "0");

/** `aaaa-mm-dd` (de dia) ou `aaaa-mm-dd hh:mm:ss`, com `.fff` quando os milissegundos não são zero (RN-VAR-007). */
export function dateText(fields: DateFields, precision: DatePrecision): string {
  const day = `${String(fields.year).padStart(4, "0")}-${two(fields.month)}-${two(fields.day)}`;
  if (precision === "day") return day;
  const clock = `${two(fields.hour)}:${two(fields.minute)}:${two(fields.second)}`;
  return `${day} ${clock}${fields.millisecond === 0 ? "" : `.${String(fields.millisecond).padStart(3, "0")}`}`;
}

export const outOfRange = (offset: number) => new VariableError("A data passou do ano 9999 (ou ficou antes do ano 1).", offset);

/** Os campos do dia `days` depois (ou antes) de `from`, mantendo a hora do relógio, ou `null` quando passa da faixa. */
export function addDaysTo(from: DateFields, days: number): DateFields | null {
  const target = dayNumber(from.year, from.month, from.day) + days;
  if (!Number.isFinite(target) || target < 0 || target > dayNumber(maxYear, 12, 31)) return null;
  return { ...from, ...fromDayNumber(target) };
}

/** Soma meses: o mês curto prende o dia no último (31/01 mais um mês é 28/02 ou 29/02). `null` quando passa da faixa. */
export function addMonthsTo(from: DateFields, months: number): DateFields | null {
  const index = from.year * 12 + (from.month - 1) + months;
  if (!Number.isFinite(index)) return null;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  if (year < minYear || year > maxYear) return null;
  return { ...from, year, month, day: Math.min(from.day, daysInMonth(year, month)) };
}

/** Os dias inteiros do calendário local entre as duas datas, negativo quando `to` vem antes: a hora do dia só decide se o último dia está completo. */
export function diffDays(from: DateFields, to: DateFields): number {
  const days = dayNumber(to.year, to.month, to.day) - dayNumber(from.year, from.month, from.day);
  const fromTime = timeOfDay(from);
  const toTime = timeOfDay(to);
  if (days > 0 && toTime < fromTime) return days - 1;
  if (days < 0 && toTime > fromTime) return days + 1;
  return days;
}

/** Os milissegundos desde 1970 (UTC) dos campos lidos como hora local da máquina; o fuso da data decide, pelo `Date` do JavaScript (RN-VAR-007). */
export function localMilliseconds(fields: DateFields): number {
  const date = new Date(2000, 0, 1, 0, 0, 0, 0);
  date.setFullYear(fields.year, fields.month - 1, fields.day);
  date.setHours(fields.hour, fields.minute, fields.second, fields.millisecond);
  return date.getTime();
}

/** Os campos, na hora local da máquina, de um instante em milissegundos desde 1970, ou `null` quando ele sai da faixa. */
export function fieldsFromMilliseconds(milliseconds: number): DateFields | null {
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  const fields = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), millisecond: date.getMilliseconds() };
  return existsAsDate(fields) ? fields : null;
}

/** O deslocamento da máquina para o UTC naquela data, como o PostgreSQL o escreve depois do instante (`-03`, `+05:30`) (RN-VAR-017). */
export function offsetText(fields: DateFields): string {
  const date = new Date(localMilliseconds(fields));
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = two(Math.floor(absolute / 60));
  const rest = absolute % 60;
  return rest === 0 ? `${sign}${hours}` : `${sign}${hours}:${two(rest)}`;
}

const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const instantPattern = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/;

/** O que `new Date(texto)` leu (RN-VAR-007), ou `null` quando o texto não está numa das formas aceitas; `invalid` quando a forma é a certa e a data não existe. */
export type ParsedDate = { fields: DateFields; precision: DatePrecision } | { invalid: string } | null;

export function parseDateText(text: string): ParsedDate {
  const day = dayPattern.exec(text);
  if (day !== null) {
    const fields = { year: Number(day[1]), month: Number(day[2]), day: Number(day[3]), hour: 0, minute: 0, second: 0, millisecond: 0 };
    return existsAsDate(fields) ? { fields, precision: "day" } : { invalid: text };
  }

  const instant = instantPattern.exec(text);
  if (instant === null) return null;

  const written = {
    year: Number(instant[1]),
    month: Number(instant[2]),
    day: Number(instant[3]),
    hour: Number(instant[4]),
    minute: Number(instant[5]),
    second: Number(instant[6] ?? 0),
    millisecond: Number((instant[7] ?? "").padEnd(3, "0") || 0),
  };
  if (!existsAsDate(written)) return { invalid: text };

  // O fim `Z` ou `±hh:mm` diz o fuso do texto: o instante é convertido para a hora local.
  const zone = instant[8];
  if (zone === undefined) return { fields: written, precision: "instant" };

  const offset = zone === "Z" ? 0 : (zone.startsWith("-") ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  const utc = new Date(0);
  utc.setUTCFullYear(written.year, written.month - 1, written.day);
  utc.setUTCHours(written.hour, written.minute, written.second, written.millisecond);
  const local = fieldsFromMilliseconds(utc.getTime() - offset * 60_000);
  return local === null ? { invalid: text } : { fields: local, precision: "instant" };
}
