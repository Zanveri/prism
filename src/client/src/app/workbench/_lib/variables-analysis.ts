import type { Engine } from "@/components/ui/engine-tag";

import { commandStart, statementHasBody, visitCode } from "./sql-statements";
import { childrenOf, type Node } from "./variables/ast";
import { checkScript } from "./variables/run";
import { readScript, staticDiagnostics, type ItemDiagnostic, type ModelItem, type ScriptModel } from "./variables/script";
import { variablesEditorCopy as copy } from "./variables-editor.copy";

/*
 * O que o editor lê do script para as variáveis (RN-VAR-025): onde pintar, o que sublinhar como erro, as dicas e onde cada declaração acaba. É puro: recebe o texto e o
 * banco da aba e devolve posições e frases, sem CodeMirror. A leitura é a da execução, sem o banco (`readScript`, `staticDiagnostics` e a execução em seco de
 * `checkScript`), e roda depois de uma pausa na digitação (`variables-extension.ts`), nunca a cada tecla.
 */

/**
 * Acima disto o editor não lê o script para as variáveis. A leitura roda na thread da tela, e não no Worker que a RN-VAR-014 pede (decisão registrada no guia da tela): custa de
 * 0,4 a 0,5 ms por 1.000 caracteres (medido: ~60 ms para 150.000, e 165 a 200 ms para 190.000 com 500 declarações e 3.000 comandos com `@v`), e o texto maior que 100.000
 * caracteres já passaria dos 50 ms parado na vez da pessoa.
 */
export const analysisMaxChars = 100_000;

/** Quanto tempo a execução em seco de `checkScript` pode levar no editor. Passou disso, o resto dela é descartado: o erro que só a execução vê aparece quando a pessoa executa. */
export const dryRunBudgetMs = 40;

export type MarkKind = "keyword" | "variable" | "sqlVariable" | "comment" | "string";

/** Um trecho a pintar. `name` é a variável, nas marcas de variável (a dica do ponteiro). */
export type Mark = { from: number; to: number; kind: MarkKind; name: string | null };

/** Um erro ou uma dica: o trecho sublinhado e a frase da dica do ponteiro. */
export type Problem = { from: number; to: number; message: string };

/** Uma variável declarada, com o item da declaração. `type` é a anotação como a pessoa a escreveu. */
export type DeclaredName = { name: string; itemIndex: number; from: number; to: number; type: string | null; mutable: boolean; sql: boolean };

/** Onde o valor aparece no fim da linha: `at` é o fim da última linha da declaração. */
export type ValueTail = { name: string; from: number; to: number; at: number };

export type AnalysisItem = { kind: "statement" | "declaration" | "reassignment"; from: number; to: number };

export type EditorAnalysis = {
  /** O tamanho do texto lido. */
  length: number;
  /** O texto passou do limite e não foi lido. */
  skipped: boolean;
  marks: Mark[];
  errors: Problem[];
  hints: Problem[];
  declared: DeclaredName[];
  tails: ValueTail[];
  items: AnalysisItem[];
};

/** A leitura de um texto sem nada a mostrar; `skipped` diz que o texto passou do limite e nem foi lido. */
export const emptyAnalysis = (length: number, skipped: boolean): EditorAnalysis => ({ length, skipped, marks: [], errors: [], hints: [], declared: [], tails: [], items: [] });

/** Se o texto pode ter uma declaração, um `@nome`, um `LET` em outra caixa ou um `//`: o resto nem é lido. */
const mayHaveVariables = /\b(?:let|const)\b|@|\/\//i;

const nameSticky = /[\p{ID_Start}_$][\p{ID_Continue}$]*/uy;

/** O tamanho do nome que começa em `at` (o nome da declaração tem as letras que o texto tem, e não as normalizadas). */
function nameLengthAt(source: string, at: number): number {
  nameSticky.lastIndex = at;
  const match = nameSticky.exec(source);
  return match === null ? 0 : match[0].length;
}

const isSpace = (character: string | undefined) => character === " " || character === "\t" || character === "\n" || character === "\r";

/** Onde a linha que contém `at` acaba (sem o retorno de carro). */
function lineEndAt(source: string, at: number): number {
  const found = source.indexOf("\n", at);
  const end = found < 0 ? source.length : found;
  return end > at && source[end - 1] === "\r" ? end - 1 : end;
}

/**
 * O trecho que um erro sublinha, a partir da posição que a linguagem deu: o nome ou a palavra que começa ali (com o `@`), o texto entre aspas simples até a aspa que
 * fecha, ou um caractere. Numa posição que é espaço ou quebra de linha, o caractere de antes (o erro "esperava um valor" aponta o fim da linha).
 */
export function problemRange(source: string, offset: number): { from: number; to: number } {
  const at = Math.max(0, Math.min(offset, source.length));
  if (source.length === 0) return { from: 0, to: 0 };
  if (at >= source.length || isSpace(source[at])) return { from: Math.max(0, at - 1), to: at };

  const word = /^@?[\p{L}\p{N}_$]+/u.exec(source.slice(at, at + 200));
  if (word !== null) return { from: at, to: at + word[0].length };

  if (source[at] === "'" || source[at] === '"') {
    const quote = source[at];
    for (let index = at + 1; index < source.length && source[index] !== "\n"; index++) {
      if (source[index] === "\\") index++;
      else if (source[index] === quote) return { from: at, to: index + 1 };
    }
  }

  const code = source.codePointAt(at) ?? 0;
  return { from: at, to: at + (code > 0xffff ? 2 : 1) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// O que há dentro e entre as declarações: os comentários `//`, os textos e o comentário colado ao valor.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

type Trivia = { slashComments: { from: number; to: number }[]; strings: { from: number; to: number }[]; gluedComments: { from: number; to: number }[] };

/** O fim do texto entre aspas que abre em `at`: a aspa que fecha (a barra escapa), ou o fim da linha (o `'` e o `"`) ou do trecho (a crase). */
function stringEnd(source: string, at: number, limit: number): number {
  const quote = source[at];
  for (let index = at + 1; index < limit; index++) {
    const character = source[index];
    if (character === "\\") index++;
    else if (character === quote) return index + 1;
    else if (character === "\n" && quote !== "`") return index;
  }
  return limit;
}

/**
 * Lê `[from, to)` de um trecho em que `//` é comentário (RN-VAR-001: dentro de uma declaração, no topo do script e logo acima das declarações): acha os comentários `//`
 * (pintados como comentário, que o `lang-sql` não conhece), os textos entre aspas (o JavaScript escapa com a barra, e o `"..."` é texto, e não nome entre aspas) e o
 * `--` ou `//` colado ao valor (`i--`, `a //2`), que quase nunca é um comentário de quem escreveu. Os comentários `--` e os de bloco ficam para o `lang-sql`.
 * `isName` diz se um texto é o nome de uma variável declarada.
 */
function readTrivia(source: string, from: number, to: number, isName: (name: string) => boolean): Trivia {
  const found: Trivia = { slashComments: [], strings: [], gluedComments: [] };
  let index = from;

  while (index < to) {
    const character = source[index];
    if (character === "'" || character === '"' || character === "`") {
      const end = stringEnd(source, index, to);
      found.strings.push({ from: index, to: end });
      index = end;
    } else if ((character === "/" && source[index + 1] === "/") || (character === "-" && source[index + 1] === "-")) {
      const end = Math.min(lineEndAt(source, index), to);
      if (character === "/") found.slashComments.push({ from: index, to: end });

      // Colado ao valor: algo antes na linha, sem espaço entre ele e o marcador; ou o resto da linha é só um número ou o nome de uma variável (`a // b`).
      const lineStart = source.lastIndexOf("\n", index - 1) + 1;
      const hasCodeBefore = source.slice(lineStart, index).trim() !== "";
      const rest = source.slice(index + 2, end).trim();
      const operandLike = /^-?\d+(?:\.\d+)?$/.test(rest) || isName(rest);
      if (hasCodeBefore && (!isSpace(source[index - 1]) || operandLike)) found.gluedComments.push({ from: index, to: index + 2 });
      index = end;
    } else if (character === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 || close + 2 > to ? to : close + 2;
    } else index++;
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// As dicas dos comandos.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

const definitionCommand = /^(?:create|alter|drop|grant|revoke|comment|set)\b/i;

/** O que as cláusulas que esperam um nome fariam com o valor, e as palavras que encerram a lista do `ORDER BY` / `GROUP BY`. */
const listStops = /\b(?:where|having|limit|offset|fetch|union|select|from|on|and|or|when|then|else|window)\b/i;

/** Se o trecho fecha um parêntese que abriu antes dele: a janela `OVER (ORDER BY x)` ou a subconsulta acabou, e a vírgula depois dela não é da lista do `ORDER BY`. */
function closesParenthesis(text: string): boolean {
  let depth = 0;
  for (const character of text) {
    if (character === "(") depth++;
    else if (character === ")" && --depth < 0) return true;
  }
  return false;
}

/** A palavra de `from`/`join`/... que a frase cita, em maiúsculas. */
function expectedName(before: string, name: string): string | null {
  const text = before.slice(-400).replace(/\s+$/, "");

  const clause = /\b(order|group)\s+by$/i.exec(text);
  if (clause !== null) return clause[1].toLowerCase() === "order" ? copy.clauses.orderBy(name) : copy.clauses.groupBy(name);

  const word = /\b(from|join|into|update|table)$/i.exec(text);
  if (word !== null) {
    const head = text.slice(0, word.index).replace(/\s+$/, "");
    // `IS DISTINCT FROM @x` e `EXTRACT(YEAR FROM @d)`, `SUBSTRING(t FROM @n)`, `TRIM(BOTH FROM @s)`: ali o `FROM` não espera um nome.
    if (/\bdistinct$/i.test(head) || /\b(?:extract|substring|trim|overlay)\s*\([^()]*$/i.test(head)) return null;
    return copy.clauses.table(word[1].toUpperCase(), name);
  }

  // A vírgula na lista do ORDER BY / GROUP BY.
  if (text.endsWith(",")) {
    let last: RegExpExecArray | null = null;
    for (const match of text.matchAll(/\b(order|group)\s+by\b/gi)) last = match;
    if (last === null) return null;
    const rest = text.slice(last.index + last[0].length);
    if (/[;=<>']/.test(rest) || listStops.test(rest) || closesParenthesis(rest)) return null;
    return last[1].toLowerCase() === "order" ? copy.clauses.orderBy(name) : copy.clauses.groupBy(name);
  }
  return null;
}

/** Se a variável pode ser `null` ou ter um `null` na lista (o `NOT IN` dela nunca é verdadeiro). */
function mayBeNull(declaration: ModelItem | undefined): boolean {
  const parsed = declaration?.parsed;
  if (parsed === undefined || parsed === null || parsed.kind !== "declaration") return false;
  if (parsed.annotation?.nullable === true) return true;
  const value = parsed.value;
  return value !== null && (value.t === "null" || (value.t === "list" && value.items.some((item) => item.node.t === "null")));
}

/** Os trechos que `/^[ \t]*(let|const)[ \t]+nome/` acha no começo de uma linha. */
const letLine = /^[ \t]*(let|const)[ \t]+[\p{ID_Start}_$]/gmu;
const hasLetLine = /^[ \t]*(?:let|const)[ \t]+[\p{ID_Start}_$]/mu;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// A leitura.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** As variáveis do texto de uma expressão: o nome de cada uso, com a posição. */
function visitNames(node: Node, visit: (name: string, node: Node) => void): void {
  if (node.t === "name") visit(node.name, node);
  for (const child of childrenOf(node)) visitNames(child, visit);
}

/**
 * Um relógio que, passado o orçamento, corre depressa demais: a execução em seco acusa "passou do tempo" no resto das declarações e acaba logo. Quem lê o resultado olha
 * `exceeded()` e joga fora o que a execução em seco achou (o relógio é o único jeito de o avaliador parar; ele não sabe do editor).
 */
function budgetClock(milliseconds: number) {
  const started = performance.now();
  let skew = 0;
  let over = false;
  return {
    clock: () => {
      const now = performance.now();
      if (!over && now - started > milliseconds) over = true;
      if (over) skew += 1e9;
      return now + skew;
    },
    exceeded: () => over,
  };
}

const diagnosticKey = (diagnostic: ItemDiagnostic) => `${diagnostic.offset}|${diagnostic.message}`;

/** Os erros que a leitura do script acha: os que se sabem lendo o texto e, com o orçamento, a execução em seco do que não depende do banco (RN-VAR-012). */
function diagnosticsOf(model: ScriptModel): ItemDiagnostic[] {
  const statics = staticDiagnostics(model);
  const budget = budgetClock(dryRunBudgetMs);
  try {
    const dry = checkScript(model, budget.clock);
    if (budget.exceeded()) return statics;

    const known = new Set(statics.map(diagnosticKey));
    return [...statics, ...dry.filter((diagnostic) => !known.has(diagnosticKey(diagnostic)))].sort((a, b) => a.offset - b.offset);
  } catch {
    return statics;
  }
}

/** Lê o script para o editor (RN-VAR-025). Nunca lança: o que a leitura não entende vira "nada a mostrar". */
export function analyze(source: string, engine: Engine | undefined, blankLines: boolean): EditorAnalysis {
  if (!mayHaveVariables.test(source)) return emptyAnalysis(source.length, false);
  if (source.length > analysisMaxChars) return emptyAnalysis(source.length, true);

  try {
    return read(source, engine, blankLines);
  } catch {
    return emptyAnalysis(source.length, false);
  }
}

function read(source: string, engine: Engine | undefined, blankLines: boolean): EditorAnalysis {
  const model = readScript(source, engine, { blankLines });
  const analysis = emptyAnalysis(source.length, false);
  const { marks, errors, hints } = analysis;
  const isName = (name: string) => model.declaredNames.has(name);
  const problem = (list: Problem[], from: number, to: number, message: string) => list.push({ from, to, message });

  for (const diagnostic of diagnosticsOf(model)) {
    const { from, to } = problemRange(source, diagnostic.offset);
    problem(errors, from, to, diagnostic.message);
  }

  for (const item of model.items) {
    analysis.items.push({ kind: item.kind, from: item.start, to: item.end });
    if (item.kind === "statement") readStatement(model, item, analysis, problem);
    else readAssignment(model, item, analysis, isName);
  }

  // O `//` do topo do script, antes do primeiro comando, é comentário (RN-VAR-001): fica entre os itens. O que está dentro de um comando é SQL.
  let cursor = 0;
  const gaps: { from: number; to: number }[] = [];
  for (const item of model.items) {
    if (item.start > cursor) gaps.push({ from: cursor, to: item.start });
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < source.length) gaps.push({ from: cursor, to: source.length });
  // Só os trechos entre os itens que têm um `//` são lidos: o `indexOf` de cada um para no fim do trecho, e não do texto.
  // Sem nenhuma declaração a execução é a de sempre, que não conhece o `//` (variableRange): ele vai ao banco, e o editor avisa em vez de pintá-lo de comentário.
  const declares = model.declarations.size > 0;
  if (source.includes("//"))
    for (const gap of gaps)
      if (source.slice(gap.from, gap.to).includes("//"))
        for (const span of readTrivia(source, gap.from, gap.to, isName).slashComments) {
          if (declares) marks.push({ ...span, kind: "comment", name: null });
          else problem(hints, span.from, span.from + 2, copy.hint.slashesInSql());
        }

  for (const declaration of model.declarations.values()) {
    const item = model.items[declaration.itemIndex];
    analysis.declared.push({ name: declaration.name, itemIndex: declaration.itemIndex, from: item.start, to: item.end, type: declaration.annotation?.text ?? null, mutable: declaration.mutable, sql: declaration.annotation?.base === "sql" });
    if (item.parsed?.kind === "declaration") analysis.tails.push({ name: declaration.name, from: item.start, to: item.end, at: lineEndAt(source, item.end) });
  }
  analysis.declared.sort((a, b) => a.itemIndex - b.itemIndex);
  analysis.tails.sort((a, b) => a.from - b.from);

  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  errors.sort((a, b) => a.from - b.from);
  hints.sort((a, b) => a.from - b.from);
  return analysis;
}

/** A primeira palavra do item depois dos espaços e dos comentários, inclusive os `//` de cima. */
function firstTokenStart(source: string, item: ModelItem, engine: Engine | undefined): number {
  let at = item.start;
  for (;;) {
    at += commandStart(source.slice(at, item.end), engine);
    if (source.startsWith("//", at)) at = lineEndAt(source, at);
    else return at;
    if (at >= item.end) return item.end;
  }
}

/** Uma declaração ou reatribuição: o `let`, o nome, os usos de outras variáveis, os textos e os comentários `//`, e o comentário colado ao valor. */
function readAssignment(model: ScriptModel, item: ModelItem, analysis: EditorAnalysis, isName: (name: string) => boolean): void {
  const { source } = model;
  const { marks, hints } = analysis;
  const parsed = item.parsed;

  const keywordAt = parsed === null ? firstTokenStart(source, item, model.engine) : parsed.kind === "declaration" ? parsed.start : -1;
  if (item.kind === "declaration" && keywordAt >= 0) {
    const word = /^(?:let|const)/.exec(source.slice(keywordAt, keywordAt + 5));
    if (word !== null) marks.push({ from: keywordAt, to: keywordAt + word[0].length, kind: "keyword", name: null });
  }

  if (parsed !== null) {
    marks.push({ from: parsed.nameStart, to: parsed.nameStart + nameLengthAt(source, parsed.nameStart), kind: "variable", name: parsed.name });
    if (parsed.value !== null)
      visitNames(parsed.value, (name, node) => {
        if (model.declaredNames.has(name)) marks.push({ from: node.start, to: node.end, kind: "variable", name });
      });
  }

  const trivia = readTrivia(source, item.start, item.end, isName);
  for (const span of trivia.slashComments) marks.push({ ...span, kind: "comment", name: null });
  for (const span of trivia.strings) marks.push({ ...span, kind: "string", name: null });
  for (const span of trivia.gluedComments) hints.push({ ...span, message: copy.hint.commentInValue() });
}

/** Um comando: os `@nome` (a cor), e as dicas da RN-VAR-025. */
function readStatement(model: ScriptModel, item: ModelItem, analysis: EditorAnalysis, problem: (list: Problem[], from: number, to: number, message: string) => void): void {
  const { engine } = model;
  const { marks, hints } = analysis;
  const text = item.text;
  const scan = item.atScan;
  const hint = (from: number, to: number, message: string) => problem(hints, item.start + from, item.start + to, message);

  // O `LET` em outra caixa onde uma declaração valeria: o começo do comando.
  const first = commandStart(text, engine);
  const keyword = /^(let|const)[ \t]+[\p{ID_Start}_$][\p{ID_Continue}$]*[ \t]*(?:[=:;]|\r?$)/imu.exec(text.slice(first, first + 300));
  if (keyword !== null && keyword[1] !== "let" && keyword[1] !== "const") hint(first, first + keyword[1].length, copy.hint.wrongCaseKeyword(keyword[1], keyword[1].toLowerCase()));

  if (scan === null) return;

  // O `let` do corpo não tem `@`, e o leitor do `@nome` só diz se há corpo quando acha um: a pergunta do corpo é feita aqui também.
  if (scan.inBody || (hasLetLine.test(text) && statementHasBody(text, engine))) {
    readBody(model, item, hint);
    return;
  }

  const definition = definitionCommand.test(text.slice(first, first + 12));
  for (const reference of scan.references) {
    const declared = model.declarations.get(reference.name);
    const isSql = declared?.annotation?.base === "sql";
    marks.push({ from: item.start + reference.start, to: item.start + reference.end, kind: isSql ? "sqlVariable" : "variable", name: reference.name });
    if (isSql) continue;

    const before = text.slice(Math.max(0, reference.start - 400), reference.start);
    if (definition) {
      hint(reference.start, reference.end, copy.hint.definitionCommand(reference.name));
      continue;
    }

    const clause = expectedName(before, reference.name);
    if (clause !== null) hint(reference.start, reference.end, copy.hint.expectsName(reference.name, clause));

    const declaration = declared === undefined ? undefined : model.items[declared.itemIndex];
    const closes = /^\s*\)/.test(text.slice(reference.end, reference.end + 20));
    if (closes && /\bnot\s+in\s*\(\s*$/i.test(before)) {
      if (mayBeNull(declaration)) hint(reference.start, reference.end, copy.hint.notInNull());
    }
    if (closes && /\bin\s*\(\s*$/i.test(before) && declaration?.parsed?.kind === "declaration" && declaration.parsed.value?.t === "query" && declaration.parsed.annotation?.list !== true)
      hint(reference.start, reference.end, copy.hint.queryInList(reference.name));
  }

  for (const found of scan.hints) {
    if (found.kind === "undeclared") hint(found.start, found.end, copy.hint.undeclared(found.name));
    else if (found.kind === "differentCase") hint(found.start, found.end, copy.hint.differentCase(found.suggestion ?? found.name));
    else hint(found.start, found.end, copy.hint.operator(found.name));
  }

  // O `//` no SQL (RN-VAR-001): fora das posições em que é comentário, ele é texto do SQL, e o banco o recusa.
  if (text.includes("//"))
    visitCode(text, engine, (position, code) => {
      if (code === 47 && text.charCodeAt(position + 1) === 47 && text.charCodeAt(position - 1) !== 47) hint(position, position + 2, copy.hint.slashesInSql());
    });
}

/** O corpo de uma rotina, de um gatilho ou de um bloco composto (RN-VAR-001 e 015): ali o `let` e o `@x` são SQL, e vão ao banco como estão. */
function readBody(model: ScriptModel, item: ModelItem, hint: (from: number, to: number, message: string) => void): void {
  const { engine } = model;
  const text = item.text;

  const lets = [...text.matchAll(letLine)];
  const ats = text.includes("@") ? text : "";
  if (lets.length === 0 && ats === "") return;

  const code = new Set<number>();
  visitCode(text, engine, (position) => code.add(position));

  for (const match of lets) {
    // O `let` ou o `const` é a primeira palavra da linha: só espaços antes dele.
    const wordAt = text.indexOf(match[1], match.index);
    if (code.has(wordAt)) hint(wordAt, wordAt + match[1].length, copy.hint.letInBlock());
  }

  if (ats === "") return;
  for (const position of code) {
    if (text.charCodeAt(position) !== 64) continue;
    const name = /^[\p{ID_Start}_$][\p{ID_Continue}$]*/u.exec(text.slice(position + 1, position + 201));
    if (name !== null && model.declaredNames.has(name[0].normalize("NFC"))) hint(position, position + 1 + name[0].length, copy.hint.inRoutineBody(name[0]));
  }
}
