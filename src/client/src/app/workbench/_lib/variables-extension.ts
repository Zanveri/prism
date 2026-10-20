import { Prec, StateEffect, StateField, type ChangeSet, type EditorState, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, hoverTooltip, ViewPlugin, WidgetType, type DecorationSet, type Tooltip, type ViewUpdate } from "@codemirror/view";

import type { Engine } from "@/components/ui/engine-tag";

import { analysisMaxChars, analyze, emptyAnalysis, type DeclaredName, type EditorAnalysis, type MarkKind, type Problem, type ValueTail } from "./variables-analysis";
import { variablesEditorCopy as copy } from "./variables-editor.copy";

/*
 * As variáveis no editor (RN-VAR-025): o realce, os erros e as dicas sublinhados, a dica do ponteiro e o valor no fim da linha. A leitura do script (`variables-analysis.ts`)
 * roda depois de uma pausa na digitação (`AnalysisScheduler`) e entra no estado por um efeito; entre uma leitura e a outra as marcas só acompanham a edição (o
 * mapa das mudanças), então a tecla nunca espera pela leitura. O valor de cada variável não é calculado aqui: vem do armazém da aba (`VariablesStore`), por uma
 * leitura e uma assinatura.
 */

/** O que o armazém dos valores da aba entrega ao editor por variável: o tipo e o valor como o painel os escreve, e se o valor é de antes de a declaração mudar. */
export type VariableEntry = { type: string; value: string; stale: boolean };

export type VariablesStore = {
  snapshot(): ReadonlyMap<string, VariableEntry>;
  subscribe(listener: () => void): () => void;
};

const noValues: ReadonlyMap<string, VariableEntry> = new Map();

/** Quanto do valor cabe na dica do ponteiro e no fim da linha (RN-VAR-025). */
export const hoverValueChars = 200;
export const tailValueChars = 60;

/** O texto cortado em `max` caracteres, com `…` no lugar do resto. */
export function clipped(text: string, max: number): string {
  const characters = [...text];
  return characters.length > max ? `${characters.slice(0, max - 1).join("")}…` : text;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// A pausa antes de ler.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** Depois de quanto tempo parado o editor lê o script (RN-VAR-025). */
export const analysisDelayMs = 300;

/** O teto do atraso: um script lento de ler é lido menos vezes, e nunca passa disto sem ser lido. */
export const analysisMaxDelayMs = 2000;

export type SchedulerTimers = {
  set: (callback: () => void, milliseconds: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
};

/**
 * Pede a leitura do script, uma de cada vez, depois da pausa: cada pedido novo recomeça a espera (a digitação contínua nunca lê). O atraso cresce com o que a última
 * leitura custou (quatro vezes o custo, de 300 ms a 2 s): o script grande é lido menos vezes, e a leitura nunca ocupa mais que um quinto do tempo da pessoa.
 */
export class AnalysisScheduler {
  private handle: unknown = null;
  private cost = 0;
  private readonly run: () => void;
  private readonly timers: SchedulerTimers;

  constructor(run: () => void, timers: SchedulerTimers = { set: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>), now: () => performance.now() }) {
    this.run = run;
    this.timers = timers;
  }

  /** O atraso de agora. */
  get delay(): number {
    return Math.min(analysisMaxDelayMs, Math.max(analysisDelayMs, this.cost * 4));
  }

  /** Pede a leitura, depois da pausa (`milliseconds` troca a pausa: a primeira leitura de um editor novo não espera 300 ms). */
  request(milliseconds: number = this.delay): void {
    this.cancel();
    this.handle = this.timers.set(() => {
      this.handle = null;
      const started = this.timers.now();
      try {
        this.run();
      } finally {
        this.cost = this.timers.now() - started;
      }
    }, milliseconds);
  }

  cancel(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// O estado.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** O resultado de uma leitura, do texto `doc`. */
const setAnalysis = StateEffect.define<{ analysis: EditorAnalysis; doc: Text }>();
/** Os valores do armazém mudaram. */
export const setVariableValues = StateEffect.define<ReadonlyMap<string, VariableEntry>>();
/** A preferência "Mostrar o valor das variáveis no fim da linha" (RN-CONFIG-004). */
export const setShowVariableValues = StateEffect.define<boolean>();
/** O banco ou a preferência da linha em branco mudou: o script se lê de novo. */
export const reanalyzeVariables = StateEffect.define<null>();

type TailItem = ValueTail;

type VariablesState = {
  /** A leitura mais nova, e o texto de que ela foi feita (a leitura só vale para ele). */
  analysis: EditorAnalysis | null;
  analysisDoc: Text | null;
  marks: DecorationSet;
  problems: DecorationSet;
  tailItems: readonly TailItem[];
  tails: DecorationSet;
  declared: ReadonlyMap<string, DeclaredName>;
  values: ReadonlyMap<string, VariableEntry>;
  /** As declarações que a pessoa mexeu e cujo valor segue escondido até o armazém assumir (marcar `stale`) ou uma avaliação nova chegar. */
  touched: ReadonlyMap<string, Touched>;
  showValues: boolean;
};

/** Uma declaração mexida: o texto dela antes da primeira mudança (voltar a ele devolve o valor) e o que o armazém tinha dela então (mudar, ou ficar `stale`, solta o valor). */
type Touched = { text: string; entry: VariableEntry | undefined };

const sameEntry = (a: VariableEntry, b: VariableEntry) => a.type === b.type && a.value === b.value && a.short === b.short && a.from === b.from;

const markClass: Record<MarkKind, string> = { keyword: "cm-var-keyword", variable: "cm-var-name", sqlVariable: "cm-var-name cm-var-sql", comment: "cm-var-comment", string: "cm-var-string" };

type MarkSpec = { variable: string | null };
type ProblemSpec = { message: string; error: boolean };

const markDecoration = (kind: MarkKind, name: string | null) => Decoration.mark({ class: markClass[kind], variable: name });
const problemDecoration = (problem: Problem, error: boolean) => Decoration.mark({ class: error ? "cm-sql-error" : "cm-var-hint", message: problem.message, error });

/** O valor escrito no fim da linha: um texto que o editor desenha e que não é do documento (não se seleciona, não se copia, não vai ao arquivo). */
class ValueWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  eq(other: ValueWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-var-value";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** O texto do fim da linha de uma variável (`= 7`), ou nulo quando nada se mostra: sem valor, ou com o valor de antes de a declaração mudar. */
export function tailText(entry: VariableEntry | undefined): string | null {
  if (entry === undefined || entry.stale || entry.value === "") return null;
  return `= ${clipped(entry.value, tailValueChars)}`;
}

function buildTails(items: readonly TailItem[], values: ReadonlyMap<string, VariableEntry>, show: boolean, touched: ReadonlyMap<string, Touched>): DecorationSet {
  if (!show) return Decoration.none;
  const ranges = [];
  for (const item of items) {
    if (touched.has(item.name)) continue;
    const text = tailText(values.get(item.name));
    if (text !== null) ranges.push(Decoration.widget({ widget: new ValueWidget(text), side: 1 }).range(item.at));
  }
  return Decoration.set(ranges, true);
}

function buildMarks(analysis: EditorAnalysis, length: number): DecorationSet {
  const ranges = [];
  for (const mark of analysis.marks) if (mark.from < mark.to && mark.to <= length) ranges.push(markDecoration(mark.kind, mark.name).range(mark.from, mark.to));
  return Decoration.set(ranges, true);
}

function buildProblems(analysis: EditorAnalysis, length: number): DecorationSet {
  const ranges = [];
  for (const problem of analysis.errors) if (problem.from < problem.to && problem.to <= length) ranges.push(problemDecoration(problem, true).range(problem.from, problem.to));
  for (const problem of analysis.hints) if (problem.from < problem.to && problem.to <= length) ranges.push(problemDecoration(problem, false).range(problem.from, problem.to));
  return Decoration.set(ranges, true);
}

/**
 * Se a mudança mexe na declaração: o que apaga ou troca texto dela, ou escreve dentro dela. A quebra de linha escrita logo antes ou logo depois (Enter no fim da linha,
 * uma linha em branco acima) não é mudar a declaração.
 */
function touches(item: TailItem, fromA: number, toA: number, inserted: Text): boolean {
  if (fromA < toA) return fromA < item.at && toA > item.from;
  if (fromA > item.from && fromA < item.to) return true;
  if (fromA === item.from) return !inserted.sliceString(Math.max(0, inserted.length - 1)).endsWith("\n");
  if (fromA >= item.to && fromA <= item.at) return !inserted.sliceString(0, 1).startsWith("\n");
  return false;
}

/** O valor de uma variável cuja declaração foi mexida some até a próxima avaliação (RN-VAR-025): a declaração mudou, e o valor era o da de antes. */
function mapTails(items: readonly TailItem[], changes: ChangeSet): { kept: TailItem[]; dropped: TailItem[] } {
  const kept: TailItem[] = [];
  const dropped: TailItem[] = [];
  for (const item of items) {
    let touched = false;
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (touches(item, fromA, toA, inserted)) touched = true;
    });
    if (touched) dropped.push(item);
    else kept.push({ name: item.name, from: changes.mapPos(item.from, 1), to: changes.mapPos(item.to, -1), at: changes.mapPos(item.at, -1) });
  }
  return { kept, dropped };
}

const variablesField = StateField.define<VariablesState>({
  create: () => ({ analysis: null, analysisDoc: null, marks: Decoration.none, problems: Decoration.none, tailItems: [], tails: Decoration.none, declared: new Map(), values: noValues, touched: new Map(), showValues: true }),
  update(state, transaction) {
    let next = state;

    if (transaction.docChanged) {
      const changes = transaction.changes;
      const { kept: tailItems, dropped } = mapTails(next.tailItems, changes);
      // A leitura seguinte (300 ms) refaz o valor das declarações a partir do armazém, que só marca `stale` quando o texto chega à aba (400 ms): o editor guarda por conta
      // própria quais declarações foram mexidas, para o valor de antes não voltar por esse meio segundo.
      let touched: ReadonlyMap<string, Touched> = next.touched;
      if (dropped.length > 0) {
        const grown = new Map(touched);
        touched = grown;
        for (const item of dropped) if (!grown.has(item.name)) grown.set(item.name, { text: transaction.startState.doc.sliceString(item.from, item.to), entry: next.values.get(item.name) });
      }
      next = { ...next, marks: next.marks.map(changes), problems: next.problems.map(changes), tailItems, touched, tails: buildTails(tailItems, next.values, next.showValues, touched), analysisDoc: null };
    }

    for (const effect of transaction.effects) {
      if (effect.is(setAnalysis)) {
        // A leitura é de um texto; se o editor já tem outro, ela não vale (a seguinte já foi pedida).
        if (effect.value.doc !== transaction.state.doc) continue;
        const { analysis } = effect.value;
        const length = transaction.state.doc.length;
        // A declaração que voltou a ser o que era devolve o valor.
        let touched: ReadonlyMap<string, Touched> = next.touched;
        if (touched.size > 0) {
          const kept = new Map(touched);
          for (const [name, held] of touched) {
            const tail = analysis.tails.find((candidate) => candidate.name === name);
            if (tail === undefined || transaction.state.doc.sliceString(tail.from, tail.to) === held.text) kept.delete(name);
          }
          touched = kept;
        }
        next = {
          ...next,
          touched,
          analysis,
          analysisDoc: effect.value.doc,
          marks: buildMarks(analysis, length),
          problems: buildProblems(analysis, length),
          tailItems: analysis.tails,
          tails: buildTails(analysis.tails, next.values, next.showValues, touched),
          declared: new Map(analysis.declared.map((declared) => [declared.name, declared])),
        };
      } else if (effect.is(setVariableValues)) {
        // O armazém assumiu (marcou `stale`) ou trouxe uma avaliação nova: o valor que o editor escondia deixa de ser dele.
        const released = new Map(next.touched);
        for (const [name, held] of next.touched) {
          const entry = effect.value.get(name);
          if (entry === undefined || entry.stale || held.entry === undefined || !sameEntry(entry, held.entry)) released.delete(name);
        }
        const touched: ReadonlyMap<string, Touched> = released.size === next.touched.size ? next.touched : released;
        next = { ...next, values: effect.value, touched, tails: buildTails(next.tailItems, effect.value, next.showValues, touched) };
      } else if (effect.is(setShowVariableValues)) next = { ...next, showValues: effect.value, tails: buildTails(next.tailItems, next.values, effect.value, next.touched) };
    }
    return next;
  },
  // As marcas ficam por dentro das cores do `lang-sql` (`Prec.highest`): a cor da variável vence a da palavra-chave que o dialeto acha no nome (`id`, `name`).
  provide: (field) => [
    Prec.highest(EditorView.decorations.from(field, (state) => state.marks)),
    EditorView.decorations.from(field, (state) => state.problems),
    EditorView.decorations.from(field, (state) => state.tails),
  ],
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// O que se lê do estado.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** As marcas, os sublinhados e os valores no fim da linha de agora (o que o editor desenha). */
export function variablesDecorations(state: EditorState): { marks: DecorationSet; problems: DecorationSet; tails: DecorationSet } {
  const held = state.field(variablesField, false);
  return { marks: held?.marks ?? Decoration.none, problems: held?.problems ?? Decoration.none, tails: held?.tails ?? Decoration.none };
}

/** A leitura mais nova, se é do texto de agora (`state.doc`); senão, nula: o resto do editor lê o script de novo, ou fica sem. */
export function currentAnalysis(state: EditorState): EditorAnalysis | null {
  const held = state.field(variablesField, false);
  return held !== undefined && held.analysisDoc === state.doc ? held.analysis : null;
}

/** A última leitura, mesmo de um texto de antes (as posições podem ter deslocado): só os nomes e os tipos declarados são lidos dela. */
export function lastDeclared(state: EditorState): ReadonlyMap<string, DeclaredName> {
  return state.field(variablesField, false)?.declared ?? new Map();
}

export type HoverLine = { kind: "error" | "hint" | "variable"; text: string };

/**
 * O que a dica do ponteiro mostra em `position` (RN-VAR-025): a frase do erro, a das dicas e, sobre uma variável, o nome, o tipo e o valor de agora na aba. Lê as marcas
 * do estado, e não a leitura do script: elas acompanham a edição. Nulo quando não há nada ali.
 */
export function hoverAt(state: EditorState, position: number): { from: number; to: number; lines: HoverLine[] } | null {
  const held = state.field(variablesField, false);
  if (held === undefined) return null;

  const lines: HoverLine[] = [];
  let from = Infinity;
  let to = -Infinity;
  const cover = (start: number, end: number) => {
    from = Math.min(from, start);
    to = Math.max(to, end);
  };

  held.problems.between(position, position, (start, end, value) => {
    if (start > position || end <= position) return;
    const spec = value.spec as ProblemSpec;
    lines.push({ kind: spec.error ? "error" : "hint", text: spec.message });
    cover(start, end);
  });
  lines.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "error" ? -1 : 1));

  held.marks.between(position, position, (start, end, value) => {
    const name = (value.spec as MarkSpec).variable;
    if (name === null || start > position || end <= position || lines.some((line) => line.kind === "variable")) return;
    lines.push({ kind: "variable", text: variableTip(name, held) });
    cover(start, end);
  });

  return lines.length === 0 ? null : { from, to, lines };
}

/** "cliente_id: number = 7", ou "cliente_id: number · ainda sem valor. Alt+X, ou Ctrl+Enter na declaração, calcula." */
function variableTip(name: string, held: VariablesState): string {
  const entry = held.values.get(name);
  if (entry !== undefined) return copy.tip.withValue(name, entry.type, clipped(entry.value, hoverValueChars), entry.stale || held.touched.has(name), entry.from);
  return copy.tip.withoutValue(name, held.declared.get(name)?.type ?? null);
}

const variablesHover = hoverTooltip(
  (view, position): Tooltip | null => {
    const found = hoverAt(view.state, position);
    if (found === null) return null;

    return {
      pos: found.from,
      end: found.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-var-tip";
        for (const line of found.lines) {
          const row = document.createElement("div");
          row.className = `cm-var-tip-${line.kind}`;
          row.textContent = line.text;
          dom.append(row);
        }
        return { dom };
      },
    };
  },
  { hideOnChange: true },
);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// A leitura em segundo plano.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** Lê o texto do editor. O texto grande demais (`analysisMaxChars`) nem é copiado para uma cadeia. */
export function analyzeDoc(doc: Text, engine: Engine | undefined, blankLines: boolean): EditorAnalysis {
  if (doc.length > analysisMaxChars) return emptyAnalysis(doc.length, true);
  return analyze(doc.toString(), engine, blankLines);
}

/** O efeito que entrega ao estado a leitura do texto de agora. */
export function analysisEffect(state: EditorState, engine: Engine | undefined, blankLines: boolean): StateEffect<unknown> {
  return setAnalysis.of({ analysis: analyzeDoc(state.doc, engine, blankLines), doc: state.doc });
}

/**
 * Liga o editor ao armazém dos valores: entrega os valores de agora, e a cada aviso do armazém os novos, enquanto `alive()` diz que o editor ainda é o mesmo (o aviso de
 * um armazém não pode chegar a um editor já destruído). Devolve o que desliga.
 */
export function connectVariables(view: Pick<EditorView, "dispatch">, variables: VariablesStore | undefined, alive: () => boolean): () => void {
  if (variables === undefined) {
    view.dispatch({ effects: setVariableValues.of(noValues) });
    return () => {};
  }

  const push = () => {
    if (alive()) view.dispatch({ effects: setVariableValues.of(variables.snapshot()) });
  };
  push();
  return variables.subscribe(push);
}

type VariablesOptions = {
  engine: () => Engine | undefined;
  blankLines: () => boolean;
};

function variablesPlugin(options: VariablesOptions) {
  return ViewPlugin.fromClass(
    class {
      readonly scheduler: AnalysisScheduler;

      constructor(readonly view: EditorView) {
        this.scheduler = new AnalysisScheduler(() => this.read());
        // A primeira leitura não espera a pausa: o script salvo abre com as variáveis pintadas.
        this.scheduler.request(0);
      }

      read() {
        this.view.dispatch({ effects: analysisEffect(this.view.state, options.engine(), options.blankLines()) });
      }

      update(update: ViewUpdate) {
        if (update.docChanged) this.scheduler.request();
        else if (update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(reanalyzeVariables)))) this.scheduler.request(0);
      }

      destroy() {
        this.scheduler.cancel();
      }
    },
  );
}

/** As cores e os sublinhados. Fichas do tema; o `*` repete a cor nos pedaços que o `lang-sql` pintou por dentro. */
const variablesTheme = EditorView.baseTheme({
  ".cm-var-keyword, .cm-var-keyword *": { color: "var(--color-syntax-keyword)" },
  ".cm-var-name, .cm-var-name *": { color: "var(--color-syntax-variable)" },
  ".cm-var-sql": { textDecoration: "underline dotted var(--color-accent)", textUnderlineOffset: "3px" },
  ".cm-var-string, .cm-var-string *": { color: "var(--color-syntax-string)" },
  ".cm-var-comment, .cm-var-comment *": { color: "var(--color-syntax-comment)", fontStyle: "italic" },
  ".cm-var-hint": { textDecoration: "underline dotted var(--color-subtle)", textUnderlineOffset: "3px" },
  ".cm-var-value": { color: "var(--color-subtle)", marginLeft: "1.5ch", userSelect: "none", pointerEvents: "none", whiteSpace: "pre" },
  ".cm-var-tip": { padding: "4px 8px", maxWidth: "480px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  ".cm-var-tip > * + *": { marginTop: "2px" },
  ".cm-var-tip-error": { color: "var(--color-danger)" },
  ".cm-var-tip-hint": { color: "var(--color-muted)" },
  ".cm-var-tip-variable": { color: "var(--color-ink)" },
});

/**
 * As variáveis no editor (RN-VAR-025). `engine` e `blankLines` são lidos na hora de cada leitura. Os valores entram pelos efeitos `setVariableValues` e
 * `setShowVariableValues`, e uma mudança de banco ou da linha em branco, por `reanalyzeVariables`.
 */
export function variablesEditor(options: VariablesOptions): Extension {
  return [variablesField, variablesPlugin(options), variablesHover, variablesTheme];
}
