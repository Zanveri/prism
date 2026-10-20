import type { Engine } from "@/components/ui/engine-tag";

import type { DateFields, DatePrecision } from "./dates";
import { dateValue, listValue, nullValue, numberValue, objectValue, sqlValue, stringValue, booleanValue, type Type, type Value } from "./values";
import type { EvaluatedAssignment, Origin, StoredValue } from "./run";

/*
 * Os valores e os tipos como dados puros, para atravessar o Worker (RN-VAR-014: o Worker recebe o texto e os valores como dados, e devolve dados). A cópia estruturada
 * perderia o congelamento e o `Map`; aqui cada valor vira um registro tagueado, e quem recebe o reconstrói pelos construtores da linguagem, que conferem a forma: dado
 * de fora nunca vira valor sem passar por eles.
 */

export type WireValue =
  | { k: "number"; v: number; e?: string }
  | { k: "string"; v: string }
  | { k: "boolean"; v: boolean }
  | { k: "null" }
  | { k: "date"; f: [number, number, number, number, number, number, number]; p: DatePrecision; e?: string }
  | { k: "list"; i: WireValue[] }
  | { k: "object"; f: [string, WireValue][] }
  | { k: "sql"; t: string };

export type WireType =
  | { t: "number" | "string" | "boolean" | "sql" | "null" | "never" }
  | { t: "date"; p?: DatePrecision }
  | { t: "list"; i: WireType }
  | { t: "object"; f: [string, WireType][] }
  | { t: "nullable"; o: WireType };

export type WireStored = { name: string; value: WireValue; type: WireType; declared: WireType; origin: Origin; at: number; ms: number; text: string; order: number; earlier?: { text: string; order: number }[] };

export function toWire(value: Value): WireValue {
  switch (value.kind) {
    case "number":
      return value.exact === undefined ? { k: "number", v: value.value } : { k: "number", v: value.value, e: value.exact };
    case "string":
      return { k: "string", v: value.value };
    case "boolean":
      return { k: "boolean", v: value.value };
    case "null":
      return { k: "null" };
    case "date": {
      const f = value.fields;
      const fields: [number, number, number, number, number, number, number] = [f.year, f.month, f.day, f.hour, f.minute, f.second, f.millisecond];
      return value.exact === undefined ? { k: "date", f: fields, p: value.precision } : { k: "date", f: fields, p: value.precision, e: value.exact };
    }
    case "list":
      return { k: "list", i: value.items.map(toWire) };
    case "object":
      return { k: "object", f: [...value.fields].map(([key, field]) => [key, toWire(field)]) };
    case "sql":
      return { k: "sql", t: value.text };
  }
}

const isRecord = (data: unknown): data is Record<string, unknown> => typeof data === "object" && data !== null && !Array.isArray(data);

/** Reconstrói o valor de um dado de fora. Lança `TypeError` na forma errada. */
export function fromWire(data: unknown): Value {
  if (!isRecord(data) || typeof data.k !== "string") throw new TypeError("Valor malformado.");
  switch (data.k) {
    case "number":
      if (typeof data.v !== "number") break;
      return numberValue(data.v, typeof data.e === "string" ? data.e : undefined);
    case "string":
      if (typeof data.v !== "string") break;
      return stringValue(data.v);
    case "boolean":
      if (typeof data.v !== "boolean") break;
      return booleanValue(data.v);
    case "null":
      return nullValue;
    case "date": {
      const f = data.f;
      if (!Array.isArray(f) || f.length !== 7 || f.some((part) => typeof part !== "number") || (data.p !== "day" && data.p !== "instant")) break;
      const fields: DateFields = { year: f[0], month: f[1], day: f[2], hour: f[3], minute: f[4], second: f[5], millisecond: f[6] };
      return dateValue(fields, data.p, typeof data.e === "string" ? data.e : undefined);
    }
    case "list":
      if (!Array.isArray(data.i)) break;
      return listValue(data.i.map(fromWire));
    case "object":
      if (!Array.isArray(data.f)) break;
      return objectValue(data.f.map((pair: unknown) => {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") throw new TypeError("Campo malformado.");
        return [pair[0], fromWire(pair[1])] as const;
      }));
    case "sql":
      if (typeof data.t !== "string") break;
      return sqlValue(data.t);
  }
  throw new TypeError("Valor malformado.");
}

export function typeToWire(type: Type): WireType {
  switch (type.tag) {
    case "date":
      return type.precision === undefined ? { t: "date" } : { t: "date", p: type.precision };
    case "list":
      return { t: "list", i: typeToWire(type.item) };
    case "object":
      return { t: "object", f: [...type.fields].map(([key, field]) => [key, typeToWire(field)]) };
    case "nullable":
      return { t: "nullable", o: typeToWire(type.of) };
    default:
      return { t: type.tag };
  }
}

export function typeFromWire(data: unknown): Type {
  if (!isRecord(data) || typeof data.t !== "string") throw new TypeError("Tipo malformado.");
  switch (data.t) {
    case "number":
    case "string":
    case "boolean":
    case "sql":
    case "null":
    case "never":
      return { tag: data.t };
    case "date":
      return data.p === "day" || data.p === "instant" ? { tag: "date", precision: data.p } : { tag: "date" };
    case "list":
      return { tag: "list", item: typeFromWire(data.i) };
    case "object":
      if (!Array.isArray(data.f)) break;
      return { tag: "object", fields: new Map(data.f.map((pair: unknown) => {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string") throw new TypeError("Campo malformado.");
        return [pair[0], typeFromWire(pair[1])] as const;
      })) };
    case "nullable":
      return { tag: "nullable", of: typeFromWire(data.o) };
  }
  throw new TypeError("Tipo malformado.");
}

const origins: ReadonlySet<string> = new Set(["literal", "expressão", "random", "consulta", "pergunta", "diálogo"]);

export function storedToWire(stored: StoredValue): WireStored {
  const { earlier, ...rest } = stored;
  return { ...rest, value: toWire(stored.value), type: typeToWire(stored.type), declared: typeToWire(stored.declared), ...(earlier === undefined ? {} : { earlier: earlier.map((entry) => ({ ...entry })) }) };
}

export function storedFromWire(data: unknown): StoredValue {
  if (!isRecord(data) || typeof data.name !== "string" || typeof data.text !== "string" || typeof data.at !== "number" || typeof data.ms !== "number" || typeof data.order !== "number" || typeof data.origin !== "string" || !origins.has(data.origin))
    throw new TypeError("Valor da aba malformado.");
  const earlier = Array.isArray(data.earlier) ? data.earlier.filter((entry): entry is EvaluatedAssignment => isRecord(entry) && typeof entry.text === "string" && typeof entry.order === "number").map((entry) => ({ text: entry.text, order: entry.order })) : [];
  return {
    name: data.name,
    value: fromWire(data.value),
    type: typeFromWire(data.type),
    declared: typeFromWire(data.declared),
    origin: data.origin as Origin,
    at: data.at,
    ms: data.ms,
    text: data.text,
    order: data.order,
    ...(earlier.length > 0 ? { earlier } : {}),
  };
}

/** O pedido de avaliação ao Worker (RN-VAR-014): o texto do script, o banco, os itens a avaliar na ordem, os valores da aba e o contador, a semente e a hora de agora. */
export type EvaluateRequest = {
  id: number;
  kind: "evaluate";
  source: string;
  engine: Engine | null;
  blankLines: boolean;
  indices: number[];
  tab: WireStored[];
  counter: number;
  seed: [number, number, number, number];
  now: number;
};

export type WireDiagnostic = { message: string; offset: number; line: number; column: number; itemIndex: number };

/** O que o Worker devolve: o começo de cada item (para o relógio da tela), o fim dele e o fim de tudo. */
export type EvaluateMessage =
  | { id: number; kind: "start"; index: number; name: string }
  | { id: number; kind: "item"; index: number; result: { ok: true; stored: WireStored; steps: number } | { ok: false; error: WireDiagnostic } }
  | { id: number; kind: "done"; counter: number; tab: WireStored[] }
  | { id: number; kind: "failed"; message: string };
