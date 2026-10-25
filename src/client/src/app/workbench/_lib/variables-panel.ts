import { staleNames, type StoredValue } from "./variables/run";
import type { ScriptModel } from "./variables/script";
import type { TabValuesSnapshot } from "./variables/tab-values";
import { dateValueText, displayValue, numberText, textOf, typeLabel, typeOfValue, type Value } from "./variables/values";

/*
 * O painel "Variáveis" (RN-VAR-024), sem React: as linhas da tabela em árvore (uma por variável declarada, na ordem do texto; a lista e o objeto abrem em um item ou
 * um campo por linha), o teclado da árvore, o texto que o Ctrl+C copia e a hora. É só para ver: os valores mudam pelo script e pelo Ctrl+Enter na declaração.
 */

/** Quantos itens de uma lista aparecem de cada vez, e de quantos em quantos o "Mostrar mais" cresce (RN-VAR-024). */
export const listPage = 100;

/** O valor longo cortado: 200 caracteres na linha, 2.000 na dica e no copiar (RN-VAR-024). */
const rowLimit = 200;
export const hintLimit = 2_000;

export type PanelRowKind = "variable" | "item" | "field" | "more";

export type PanelRow = {
  /** A chave estável da linha: o nome, e o caminho dentro dele (`ids/3`, `p/nome`). */
  key: string;
  kind: PanelRowKind;
  /** A chave da linha de cima, ou nulo na variável. */
  parent: string | null;
  /** O nível, de 1 em diante (`aria-level`). */
  level: number;
  /** O nome: o da variável, `[2]` do item da lista, o campo do objeto; na linha "Mostrar mais", a frase. */
  name: string;
  type: string;
  /** O valor curto (200 caracteres), ou "sem valor". Em `more`, vazio. */
  value: string;
  /** O valor para a dica (até 2.000). */
  hint: string;
  /** Só na variável: de onde veio o valor (literal, expressão, random, consulta, pergunta, diálogo). */
  origin: string | null;
  /** Só na variável: a hora local e, na consulta, o tempo. */
  when: string | null;
  stale: boolean;
  noValue: boolean;
  isNull: boolean;
  isSql: boolean;
  expandable: boolean;
  expanded: boolean;
  /** O que a linha "Mostrar mais" mostra (`shown` de `total`), e a lista a que ela pertence. */
  more: { shown: number; total: number } | null;
  /** O valor da linha, para copiar; nulo na que não tem. */
  raw: Value | null;
  /** A variável a que a linha pertence, para "Ir para a declaração". */
  variable: string;
};

export type PanelView = {
  /** As linhas abertas (chaves). */
  open: ReadonlySet<string>;
  /** Quantos itens de cada lista aparecem (chave da lista); sem entrada, `listPage`. */
  shown: ReadonlyMap<string, number>;
};

export const emptyView: PanelView = { open: new Set(), shown: new Map() };

/** Quantos itens "Mostrar mais" acrescenta, até o total. */
export const showMoreOf = (shown: number, total: number) => Math.min(total, shown + listPage);

/** "14:32:05", a hora local da avaliação (RN-VAR-024). */
export function clockText(at: number): string {
  const date = new Date(at);
  const part = (value: number) => String(value).padStart(2, "0");
  return `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
}

const isComposite = (value: Value) => value.kind === "list" || value.kind === "object";

function describe(value: Value): { text: string; hint: string } {
  if (value.kind === "list") {
    const count = value.items.length;
    return { text: `${count.toLocaleString("pt-BR")} ${count === 1 ? "item" : "itens"} ${displayValue(value, rowLimit)}`, hint: displayValue(value, hintLimit) };
  }
  if (value.kind === "object") {
    const count = value.fields.size;
    return { text: `${count.toLocaleString("pt-BR")} ${count === 1 ? "campo" : "campos"} ${displayValue(value, rowLimit)}`, hint: displayValue(value, hintLimit) };
  }
  return { text: displayValue(value, rowLimit), hint: displayValue(value, hintLimit) };
}

function childrenOf(row: PanelRow, view: PanelView): PanelRow[] {
  const value = row.raw;
  if (value === null || !row.expanded) return [];

  const make = (name: string, key: string, kind: "item" | "field", child: Value): PanelRow => {
    const { text, hint } = describe(child);
    return {
      key,
      kind,
      parent: row.key,
      level: row.level + 1,
      name,
      type: typeLabel(typeOfValue(child)),
      value: text,
      hint,
      origin: null,
      when: null,
      stale: false,
      noValue: false,
      isNull: child.kind === "null",
      isSql: child.kind === "sql",
      expandable: isComposite(child),
      expanded: view.open.has(key),
      more: null,
      raw: child,
      variable: row.variable,
    };
  };

  const rows: PanelRow[] = [];
  const push = (child: PanelRow) => {
    rows.push(child);
    rows.push(...childrenOf(child, view));
  };

  if (value.kind === "list") {
    const shown = Math.min(value.items.length, view.shown.get(row.key) ?? listPage);
    for (let index = 0; index < shown; index++) push(make(`[${index}]`, `${row.key}/${index}`, "item", value.items[index]));
    if (shown < value.items.length) {
      rows.push({ ...make("", `${row.key}/more`, "item", value), kind: "more", name: `Mostrar mais ${listPage.toLocaleString("pt-BR")} (de ${value.items.length.toLocaleString("pt-BR")})`, value: "", hint: "", type: "", expandable: false, expanded: false, more: { shown, total: value.items.length }, raw: null, isNull: false });
    }
  } else if (value.kind === "object") {
    for (const [name, field] of value.fields) push(make(name, `${row.key}/${name}`, "field", field));
  }
  return rows;
}

/**
 * As linhas do painel, na ordem do texto: uma por variável declarada (a que ainda não tem valor aparece "sem valor"), com a lista e o objeto abertos em um item ou
 * um campo por linha. O valor é o da última atribuição avaliada, com a hora; "desatualizado" quando a declaração mudou ou uma atribuição de que ela depende foi
 * avaliada de novo (RN-VAR-023).
 */
export function panelRows(model: ScriptModel, snapshot: TabValuesSnapshot, view: PanelView = emptyView): PanelRow[] {
  const stale = staleNames(model, snapshot.values);
  const rows: PanelRow[] = [];
  const declared = [...model.declarations.values()].sort((a, b) => a.itemIndex - b.itemIndex);

  for (const declaration of declared) {
    const entry: StoredValue | undefined = snapshot.values.get(declaration.name);
    if (entry === undefined) {
      rows.push({ key: declaration.name, kind: "variable", parent: null, level: 1, name: declaration.name, type: "", value: "sem valor", hint: "", origin: null, when: null, stale: false, noValue: true, isNull: false, isSql: false, expandable: false, expanded: false, more: null, raw: null, variable: declaration.name });
      continue;
    }

    const { text, hint } = describe(entry.value);
    const row: PanelRow = {
      key: declaration.name,
      kind: "variable",
      parent: null,
      level: 1,
      name: declaration.name,
      type: typeLabel(entry.type),
      value: text,
      hint,
      origin: entry.origin,
      when: entry.origin === "consulta" ? `${clockText(entry.at)} · ${Math.round(entry.ms).toLocaleString("pt-BR")} ms` : clockText(entry.at),
      stale: stale.has(declaration.name),
      noValue: false,
      isNull: entry.value.kind === "null",
      isSql: entry.value.kind === "sql",
      expandable: isComposite(entry.value),
      expanded: view.open.has(declaration.name),
      more: null,
      raw: entry.value,
      variable: declaration.name,
    };
    rows.push(row, ...childrenOf(row, view));
  }
  return rows;
}

/** O texto do valor como o JSON o escreve: o número como está, o texto, a data como texto, a lista e o objeto aninhados; o objeto sem protótipo. */
function jsonOf(value: Value): unknown {
  switch (value.kind) {
    case "number":
      return value.exact !== undefined && /^-?\d+(\.\d+)?$/.test(value.exact) ? Number(value.exact) : value.value;
    case "string":
      return value.value;
    case "boolean":
      return value.value;
    case "null":
      return null;
    case "date":
      return dateValueText(value);
    case "sql":
      return value.text;
    case "list":
      return value.items.map(jsonOf);
    case "object": {
      const object = Object.create(null) as Record<string, unknown>;
      for (const [key, field] of value.fields) object[key] = jsonOf(field);
      return object;
    }
  }
}

/** O que o Ctrl+C e o "Copiar valor" levam (RN-VAR-024): o simples como texto; a lista e o objeto como JSON. Nulo na linha sem valor. */
export function copyTextOf(row: PanelRow): string | null {
  const value = row.raw;
  if (value === null) return null;
  if (isComposite(value)) return JSON.stringify(jsonOf(value));
  if (value.kind === "number") return numberText(value);
  return textOf(value);
}

export type PanelMove = {
  /** A linha que fica com o foco. */
  focus: string;
  /** A linha que abre ou fecha, quando a tecla faz isso. */
  open?: string;
  close?: string;
};

/**
 * O teclado da árvore (`treegrid`): as setas para cima e para baixo, Home e End; a seta para a direita abre a linha (e, aberta, vai ao primeiro filho); a seta
 * para a esquerda fecha a aberta ou vai à linha de cima. Outra tecla: nulo, e ela segue o caminho dela.
 */
export function navigate(rows: readonly PanelRow[], focused: string | null, key: string): PanelMove | null {
  if (rows.length === 0) return null;
  const at = Math.max(0, rows.findIndex((row) => row.key === focused));
  const current = rows[at];
  switch (key) {
    case "ArrowDown":
      return { focus: rows[Math.min(rows.length - 1, at + 1)].key };
    case "ArrowUp":
      return { focus: rows[Math.max(0, at - 1)].key };
    case "Home":
      return { focus: rows[0].key };
    case "End":
      return { focus: rows[rows.length - 1].key };
    case "ArrowRight":
      if (current.expandable && !current.expanded) return { focus: current.key, open: current.key };
      if (current.expandable && current.expanded && rows[at + 1]?.parent === current.key) return { focus: rows[at + 1].key };
      return { focus: current.key };
    case "ArrowLeft":
      if (current.expandable && current.expanded) return { focus: current.key, close: current.key };
      return { focus: current.parent ?? current.key };
    default:
      return null;
  }
}
