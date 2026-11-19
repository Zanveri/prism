import { foldService } from "@codemirror/language";
import { EditorSelection, StateEffect, StateField, type EditorState, type Extension, type Range, type SelectionRange, type StateCommand, type TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

export type FindOptions = {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export type FindMatch = {
  from: number;
  to: number;
};

export const defaultFindOptions: FindOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
};

/** Letras (com acentos), dígitos e os símbolos que fazem parte de identificadores/variáveis SQL (`_`, `$`, `@`, `#`). */
const wordChar = /[\p{L}\p{M}\p{N}_$@#]/u;

// shortcut: teto de 5000 ocorrências contadas e 2000 decoradas na busca interativa, paginar por viewport se surgirem scripts de dezenas de MB
const maxSearchMatches = 5000;
const maxDecoratedMatches = 2000;

function nextIndex(doc: string, index: number): number {
  if (index >= doc.length) return doc.length;
  return index + ((doc.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
}

function prevIndex(doc: string, index: number): number {
  if (index <= 0) return 0;
  if (index >= 2) {
    const high = doc.charCodeAt(index - 2);
    const low = doc.charCodeAt(index - 1);
    if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) return index - 2;
  }
  return index - 1;
}

function isWordAt(doc: string, index: number): boolean {
  if (index < 0 || index >= doc.length) return false;
  const code = doc.codePointAt(index);
  return code !== undefined && wordChar.test(String.fromCodePoint(code));
}

export function wordRangeAt(doc: string, pos: number): FindMatch | null {
  const clamped = Math.min(Math.max(0, pos), doc.length);
  const atRight = isWordAt(doc, clamped);
  const atLeft = clamped > 0 && isWordAt(doc, prevIndex(doc, clamped));
  if (!atRight && !atLeft) return null;

  let from = clamped;
  while (from > 0 && isWordAt(doc, prevIndex(doc, from))) from = prevIndex(doc, from);
  let to = clamped;
  while (to < doc.length && isWordAt(doc, to)) to = nextIndex(doc, to);
  return from < to ? { from, to } : null;
}

export function isWholeWord(doc: string, from: number, to: number): boolean {
  if (from >= to) return false;
  if (from > 0 && isWordAt(doc, prevIndex(doc, from))) return false;
  if (to < doc.length && isWordAt(doc, to)) return false;
  for (let at = from; at < to; at = nextIndex(doc, at)) {
    if (!isWordAt(doc, at)) return false;
  }
  return true;
}

function matchesWholeWordBoundary(doc: string, from: number, to: number): boolean {
  if (from >= to) return false;
  const startsWord = isWordAt(doc, from);
  const endsWord = isWordAt(doc, prevIndex(doc, to));
  if (startsWord && from > 0 && isWordAt(doc, prevIndex(doc, from))) return false;
  if (endsWord && to < doc.length && isWordAt(doc, to)) return false;
  return true;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileQuery(query: string, options: FindOptions, global: boolean): RegExp | null {
  const source = options.regex ? query : escapeRegExp(query);
  const flags = `${global ? "g" : ""}${options.matchCase ? "" : "i"}`;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** Localiza todas as ocorrências não vazias até `limit` (evita travar em scripts grandes ou regex de comprimento zero). */
export function findMatches(
  doc: string,
  query: string,
  options: FindOptions = defaultFindOptions,
  limit = maxSearchMatches,
): { matches: FindMatch[]; invalidRegex: boolean } {
  if (query === "") return { matches: [], invalidRegex: false };
  const expr = compileQuery(query, options, true);
  if (expr === null) return { matches: [], invalidRegex: true };

  const matches: FindMatch[] = [];
  while (matches.length < limit) {
    const found = expr.exec(doc);
    if (found === null) break;
    const from = found.index;
    const to = from + found[0].length;
    if (from === to) {
      if (from >= doc.length) break;
      expr.lastIndex = nextIndex(doc, from);
      continue;
    }
    if (!options.wholeWord || matchesWholeWordBoundary(doc, from, to)) {
      matches.push({ from, to });
    }
  }
  return { matches, invalidRegex: false };
}

export function activeMatchIndex(matches: readonly FindMatch[], selection: { from: number; to: number }): number {
  if (selection.from === selection.to) return -1;
  let lo = 0;
  let hi = matches.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const candidate = matches[mid];
    if (candidate.from === selection.from && candidate.to === selection.to) return mid;
    if (candidate.from < selection.from) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export function nextMatchIndex(matches: readonly FindMatch[], cursor: { from: number; to: number }, direction: 1 | -1): number {
  if (matches.length === 0) return -1;
  const current = activeMatchIndex(matches, cursor);
  if (current >= 0) return (current + direction + matches.length) % matches.length;

  if (direction === 1) {
    const after = matches.findIndex((match) => match.from >= cursor.to);
    return after >= 0 ? after : 0;
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].to <= cursor.from) return i;
  }
  return matches.length - 1;
}

export function replaceMatchText(doc: string, match: FindMatch, query: string, replacement: string, options: FindOptions): string {
  if (!options.regex) return replacement;
  const single = compileQuery(query, options, false);
  if (single === null) return replacement;
  return doc.slice(match.from, match.to).replace(single, replacement);
}

export function replaceAllChanges(
  doc: string,
  matches: readonly FindMatch[],
  query: string,
  replacement: string,
  options: FindOptions,
): { from: number; to: number; insert: string }[] {
  return matches.map((match) => ({
    from: match.from,
    to: match.to,
    insert: replaceMatchText(doc, match, query, replacement, options),
  }));
}

export type SearchSpec = {
  query: string;
  options: FindOptions;
};

export type SearchFieldValue = {
  query: string;
  options: FindOptions;
  matches: FindMatch[];
  activeIndex: number;
  invalidRegex: boolean;
  decorations: DecorationSet;
};

export const setSearchQuery = StateEffect.define<SearchSpec | null>();

const searchMatchMark = Decoration.mark({ class: "cm-search-match" });
const searchCurrentMark = Decoration.mark({ class: "cm-search-match cm-search-match-current" });

function buildSearchDecorations(matches: readonly FindMatch[], activeIndex: number): DecorationSet {
  if (matches.length === 0) return Decoration.none;
  const marks: Range<Decoration>[] = [];
  const capped = Math.min(matches.length, maxDecoratedMatches);
  for (let i = 0; i < capped; i++) {
    const match = matches[i];
    marks.push((i === activeIndex ? searchCurrentMark : searchMatchMark).range(match.from, match.to));
  }
  if (activeIndex >= capped && activeIndex < matches.length) {
    const active = matches[activeIndex];
    marks.push(searchCurrentMark.range(active.from, active.to));
  }
  return Decoration.set(marks);
}

const emptySearchValue: SearchFieldValue = {
  query: "",
  options: defaultFindOptions,
  matches: [],
  activeIndex: -1,
  invalidRegex: false,
  decorations: Decoration.none,
};

export const searchState = StateField.define<SearchFieldValue>({
  create: () => emptySearchValue,
  update(current, transaction) {
    let spec: SearchSpec | null | undefined;
    for (const effect of transaction.effects) {
      if (effect.is(setSearchQuery)) spec = effect.value;
    }

    if (spec === null) return emptySearchValue;

    const query = spec !== undefined ? spec.query : current.query;
    const options = spec !== undefined ? spec.options : current.options;
    if (query === "") return current === emptySearchValue ? current : emptySearchValue;

    if (spec !== undefined || transaction.docChanged) {
      const { matches, invalidRegex } = findMatches(transaction.state.doc.toString(), query, options);
      const activeIndex = activeMatchIndex(matches, transaction.state.selection.main);
      return {
        query,
        options,
        matches,
        activeIndex,
        invalidRegex,
        decorations: buildSearchDecorations(matches, activeIndex),
      };
    }

    if (transaction.selection !== undefined) {
      const activeIndex = activeMatchIndex(current.matches, transaction.state.selection.main);
      if (activeIndex !== current.activeIndex) {
        return {
          ...current,
          activeIndex,
          decorations: buildSearchDecorations(current.matches, activeIndex),
        };
      }
    }

    return current;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function applySearchQueryState(state: EditorState, query: string, options: FindOptions, jumpToNearest: boolean): TransactionSpec {
  if (query === "") return { effects: setSearchQuery.of(null) };
  const effects = setSearchQuery.of({ query, options });
  if (!jumpToNearest) return { effects };

  const { matches } = findMatches(state.doc.toString(), query, options);
  if (matches.length === 0) return { effects };
  const anchor = state.selection.main.from;
  const idx = matches.findIndex((match) => match.from >= anchor);
  const target = matches[idx >= 0 ? idx : 0];
  return {
    effects,
    selection: EditorSelection.single(target.from, target.to),
    scrollIntoView: true,
  };
}

export function findNextState(state: EditorState, direction: 1 | -1, fallback?: SearchSpec): TransactionSpec | null {
  const field = state.field(searchState, false);
  const matches =
    field !== undefined && field.query !== ""
      ? field.matches
      : fallback !== undefined && fallback.query !== ""
        ? findMatches(state.doc.toString(), fallback.query, fallback.options).matches
        : [];
  if (matches.length === 0) return null;
  const idx = nextMatchIndex(matches, state.selection.main, direction);
  if (idx < 0) return null;
  const match = matches[idx];
  return { selection: EditorSelection.single(match.from, match.to), scrollIntoView: true };
}

export function replaceNextState(state: EditorState, replacement: string): TransactionSpec | null {
  const field = state.field(searchState, false);
  if (field === undefined || field.matches.length === 0 || field.invalidRegex) return null;

  if (field.activeIndex < 0) return findNextState(state, 1);

  const doc = state.doc.toString();
  const target = field.matches[field.activeIndex];
  const insert = replaceMatchText(doc, target, field.query, replacement, field.options);
  const delta = insert.length - (target.to - target.from);

  if (field.matches.length === 1) {
    return {
      changes: { from: target.from, to: target.to, insert },
      selection: EditorSelection.cursor(target.from + insert.length),
      scrollIntoView: true,
    };
  }

  const nextIdx = (field.activeIndex + 1) % field.matches.length;
  const next = field.matches[nextIdx];
  const shift = nextIdx > field.activeIndex ? delta : 0;
  return {
    changes: { from: target.from, to: target.to, insert },
    selection: EditorSelection.single(next.from + shift, next.to + shift),
    scrollIntoView: true,
  };
}

export function replaceAllState(state: EditorState, replacement: string): TransactionSpec | null {
  const field = state.field(searchState, false);
  if (field === undefined || field.matches.length === 0 || field.invalidRegex) return null;
  const doc = state.doc.toString();
  // Na substituição em lote, relê sem o teto visual para trocar todas as ocorrências do documento.
  const { matches } = findMatches(doc, field.query, field.options, Number.MAX_SAFE_INTEGER);
  if (matches.length === 0) return null;
  return { changes: replaceAllChanges(doc, matches, field.query, replacement, field.options) };
}

function overlapsAny(candidate: FindMatch, ranges: readonly SelectionRange[]): boolean {
  return ranges.some((range) => candidate.from < range.to && candidate.to > range.from);
}

function nextUnselectedMatch(matches: readonly FindMatch[], afterPos: number, existing: readonly SelectionRange[]): FindMatch | null {
  for (const match of matches) {
    if (match.from >= afterPos && !overlapsAny(match, existing)) return match;
  }
  for (const match of matches) {
    if (match.from < afterPos && !overlapsAny(match, existing)) return match;
  }
  return null;
}

function selectionWithPrimary(existing: readonly SelectionRange[], added: SelectionRange): EditorSelection {
  const sorted = [...existing, added].sort((a, b) => a.from - b.from);
  const mainIndex = sorted.indexOf(added);
  return EditorSelection.create(sorted, mainIndex >= 0 ? mainIndex : 0);
}

/**
 * Ctrl+D como no VS Code: sem seleção, seleciona a palavra sob o cursor; com seleção, mantém as atuais e
 * adiciona a próxima ocorrência (palavra inteira quando todas as seleções atuais são palavras inteiras).
 */
export function selectNextOccurrenceState(state: EditorState, matchCase = false): TransactionSpec | null {
  const doc = state.doc.toString();
  const { ranges, mainIndex } = state.selection;

  if (ranges.every((range) => range.empty)) {
    const expanded: SelectionRange[] = [];
    let nextMain = 0;
    ranges.forEach((range, idx) => {
      const word = wordRangeAt(doc, range.head);
      if (word !== null) {
        if (idx === mainIndex) nextMain = expanded.length;
        expanded.push(EditorSelection.range(word.from, word.to));
      }
    });
    if (expanded.length === 0) return null;
    return { selection: EditorSelection.create(expanded, nextMain), scrollIntoView: true };
  }

  const main = state.selection.main;
  const target = main.empty ? wordRangeAt(doc, main.head) : { from: main.from, to: main.to };
  if (target === null) return null;
  if (main.empty) {
    const added = EditorSelection.range(target.from, target.to);
    const others = ranges.filter((_, idx) => idx !== mainIndex);
    return { selection: selectionWithPrimary(others, added), scrollIntoView: true };
  }

  const needle = doc.slice(target.from, target.to);
  if (needle.includes("\n")) return null;
  const wholeWord = ranges.every((range) => !range.empty && isWholeWord(doc, range.from, range.to));
  const { matches } = findMatches(doc, needle, { matchCase, wholeWord, regex: false }, Number.MAX_SAFE_INTEGER);
  const next = nextUnselectedMatch(matches, main.to, ranges);
  if (next === null) return null;

  const added = EditorSelection.range(next.from, next.to);
  return { selection: selectionWithPrimary(ranges, added), scrollIntoView: true };
}

/** Ctrl+K Ctrl+D como no VS Code: solta a seleção atual e avança para a próxima ocorrência. */
export function skipLastOccurrenceState(state: EditorState, matchCase = false): TransactionSpec | null {
  const doc = state.doc.toString();
  const main = state.selection.main;
  if (main.empty) return selectNextOccurrenceState(state, matchCase);

  const needle = doc.slice(main.from, main.to);
  if (needle.includes("\n")) return null;
  const kept = state.selection.ranges.filter((_, idx) => idx !== state.selection.mainIndex);
  const wholeWord = state.selection.ranges.every((range) => !range.empty && isWholeWord(doc, range.from, range.to));
  const { matches } = findMatches(doc, needle, { matchCase, wholeWord, regex: false }, Number.MAX_SAFE_INTEGER);
  const next = nextUnselectedMatch(matches, main.to, kept);
  if (next === null || (next.from === main.from && next.to === main.to)) return null;

  const added = EditorSelection.range(next.from, next.to);
  return { selection: selectionWithPrimary(kept, added), scrollIntoView: true };
}

/** Ctrl+Shift+L / Ctrl+F2 como no VS Code: seleciona todas as ocorrências da seleção ou da palavra sob o cursor. */
export function selectAllOccurrencesState(state: EditorState, matchCase = false): TransactionSpec | null {
  const doc = state.doc.toString();
  const main = state.selection.main;
  const base = main.empty ? wordRangeAt(doc, main.head) : { from: main.from, to: main.to };
  if (base === null) return null;

  const needle = doc.slice(base.from, base.to);
  if (needle === "" || needle.includes("\n")) return null;
  const wholeWord = main.empty ? true : state.selection.ranges.every((range) => !range.empty && isWholeWord(doc, range.from, range.to));
  const { matches } = findMatches(doc, needle, { matchCase, wholeWord, regex: false }, Number.MAX_SAFE_INTEGER);
  if (matches.length === 0) return null;

  const selected = matches.map((match) => EditorSelection.range(match.from, match.to));
  const mainIdx = Math.max(
    0,
    matches.findIndex((match) => match.from >= base.from),
  );
  return { selection: EditorSelection.create(selected, mainIdx) };
}

/** Ctrl+L como no VS Code: seleciona a linha inteira (incluindo a quebra) e estende para a linha seguinte a cada repetição. */
export const selectFullLine: StateCommand = ({ state, dispatch }) => {
  const { doc } = state;
  const expanded = state.selection.ranges.map((range) => {
    const firstLine = doc.lineAt(range.from);
    if (range.empty) {
      return EditorSelection.range(firstLine.from, Math.min(doc.length, firstLine.to + 1));
    }
    const endLine = doc.lineAt(range.to);
    return EditorSelection.range(firstLine.from, Math.min(doc.length, endLine.to + 1));
  });
  dispatch(state.update({ selection: EditorSelection.create(expanded, state.selection.mainIndex), scrollIntoView: true }));
  return true;
};

/** Ctrl+Shift+Enter como no VS Code: abre uma linha em branco acima mantendo o recuo da linha atual (Ctrl+Enter permanece Executar SQL). */
export const insertBlankLineAbove: StateCommand = ({ state, dispatch }) => {
  const seenLines = new Set<number>();
  const changes: { from: number; insert: string }[] = [];
  const cursors: SelectionRange[] = [];
  let shift = 0;

  for (const range of [...state.selection.ranges].sort((a, b) => a.from - b.from)) {
    const line = state.doc.lineAt(range.head);
    if (seenLines.has(line.number)) continue;
    seenLines.add(line.number);
    const indent = /^[\t ]*/.exec(line.text)?.[0] ?? "";
    const inserted = `${indent}\n`;
    changes.push({ from: line.from, insert: inserted });
    cursors.push(EditorSelection.cursor(line.from + shift + indent.length));
    shift += inserted.length;
  }

  if (changes.length === 0) return false;
  dispatch(state.update({ changes, selection: EditorSelection.create(cursors, cursors.length - 1), scrollIntoView: true, userEvent: "input" }));
  return true;
};

export function parseGoToLine(raw: string): { line: number; column: number } | null {
  const trimmed = raw.trim().replace(/^:/, "").trim();
  const match = /^(\d+)(?:\s*[:.,]\s*(\d+))?$/.exec(trimmed);
  if (match === null) return null;
  const line = Number(match[1]);
  const column = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return null;
  return { line, column };
}

export function goToLineOffset(state: EditorState, raw: string): number | null {
  const parsed = parseGoToLine(raw);
  if (parsed === null) return null;
  const lineNumber = Math.min(parsed.line, state.doc.lines);
  const line = state.doc.line(lineNumber);
  return Math.min(line.from + parsed.column - 1, line.to);
}

export function visualIndent(text: string, tabSize: number): { columns: number; contentIndex: number } {
  let columns = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 32) columns += 1;
    else if (ch === 9) columns += tabSize - (columns % tabSize);
    else return { columns, contentIndex: i };
  }
  return { columns, contentIndex: text.length };
}

/**
 * Dobramento por recuo, como o VS Code faz em arquivos SQL/rotinas: toda linha seguida de um bloco mais recuado
 * dobra até a última linha não vazia desse bloco, preservando o `END IF`, `END CASE` ou `END PROCEDURE` logo abaixo.
 */
export function indentationFoldRange(state: EditorState, lineStart: number): FindMatch | null {
  const startLine = state.doc.lineAt(lineStart);
  const { tabSize } = state;
  const startInfo = visualIndent(startLine.text, tabSize);
  if (startInfo.contentIndex === startLine.text.length) return null;

  let lastFoldedLine = startLine.number;
  let sawDeeper = false;

  for (let lineNo = startLine.number + 1; lineNo <= state.doc.lines; lineNo++) {
    const line = state.doc.line(lineNo);
    const info = visualIndent(line.text, tabSize);
    if (info.contentIndex === line.text.length) continue;
    if (info.columns <= startInfo.columns) break;
    sawDeeper = true;
    lastFoldedLine = lineNo;
  }

  if (!sawDeeper) return null;
  const to = state.doc.line(lastFoldedLine).to;
  return to > startLine.to ? { from: startLine.to, to } : null;
}

export const sqlIndentationFold: Extension = foldService.of((state, lineStart) => indentationFoldRange(state, lineStart));

const indentGuideMark = Decoration.mark({ class: "cm-indent-guides" });

function computeIndentGuides(view: EditorView): DecorationSet {
  const { state } = view;
  const { tabSize } = state;
  if (tabSize <= 0) return Decoration.none;
  const marks: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      let col = 0;
      let guideStart = -1;
      let contentStart = line.text.length;
      for (let i = 0; i < line.text.length; i++) {
        const ch = line.text.charCodeAt(i);
        if (ch === 32) col += 1;
        else if (ch === 9) col += tabSize - (col % tabSize);
        else {
          contentStart = i;
          break;
        }
        if (guideStart < 0 && col >= tabSize) guideStart = i + 1;
      }
      if (contentStart < line.text.length && guideStart >= 0 && guideStart < contentStart) {
        marks.push(indentGuideMark.range(line.from + guideStart, line.from + contentStart));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(marks);
}

/** Guias verticais de recuo na área visível, alinhadas ao `tabSize` do editor (como no VS Code). */
export const indentGuides: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeIndentGuides(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.startState.tabSize !== update.state.tabSize) {
        this.decorations = computeIndentGuides(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const selectionMatchMark = Decoration.mark({ class: "cm-selection-match" });

/**
 * Ocorrências iguais ao texto selecionado que não se sobrepõem a nenhuma seleção ativa (`selectionHighlight` do VS Code).
 * Funciona para palavras inteiras ou trechos parciais em uma única linha e permanece ativo ao adicionar cursores com `Ctrl+D`.
 */
export function findSelectionMatchRanges(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): { from: number; to: number }[] {
  if (state.field(searchState, false)?.query) return [];

  const nonEmpty = state.selection.ranges.filter((range) => !range.empty);
  if (nonEmpty.length === 0) return [];

  const first = state.sliceDoc(nonEmpty[0].from, nonEmpty[0].to);
  if (first.length > 200 || first.includes("\n") || first.includes("\r") || first.trim() === "") return [];

  const needle = first.toLowerCase();
  for (let i = 1; i < nonEmpty.length; i++) {
    const piece = state.sliceDoc(nonEmpty[i].from, nonEmpty[i].to);
    if (piece.toLowerCase() !== needle) return [];
  }

  const expr = compileQuery(first, { matchCase: false, wholeWord: false, regex: false }, true);
  if (expr === null) return [];

  const matches: { from: number; to: number }[] = [];
  let lastEnd = -1;
  for (const { from, to } of visibleRanges) {
    const slice = state.sliceDoc(from, to);
    expr.lastIndex = 0;
    let count = 0;
    while (count < 500) {
      const found = expr.exec(slice);
      if (found === null || found[0].length === 0) break;
      const absFrom = from + found.index;
      const absTo = absFrom + found[0].length;
      if (absFrom >= lastEnd && !nonEmpty.some((sel) => absFrom < sel.to && absTo > sel.from)) {
        matches.push({ from: absFrom, to: absTo });
        lastEnd = absTo;
      }
      count++;
    }
  }
  return matches;
}

function computeSelectionMatches(view: EditorView): DecorationSet {
  const ranges = findSelectionMatchRanges(view.state, view.visibleRanges);
  if (ranges.length === 0) return Decoration.none;
  return Decoration.set(ranges.map((range) => selectionMatchMark.range(range.from, range.to)));
}

/** Realça discretamente na área visível as demais ocorrências do trecho selecionado (`selectionHighlight` do VS Code). */
export const selectionMatchHighlight: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeSelectionMatches(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.some((tr) => tr.effects.some((ef) => ef.is(setSearchQuery)))) {
        this.decorations = computeSelectionMatches(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
