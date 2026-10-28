import type { SqlFormatStyle } from "@/app/settings/_lib/preferences";
import type { Engine } from "@/components/ui/engine-tag";

import { uppercaseWords } from "./sql-keyword-case";
import { statementHasBody } from "./sql-statements";
import { splitScript } from "./variables/script-items";

export type SqlFormatOptions = {
  style: SqlFormatStyle;
  uppercaseKeywords: boolean;
  tabSize: number;
  engine?: Engine;
  blankLines?: boolean;
};

type TokenKind =
  | "word"
  | "string"
  | "quoted"
  | "dollar"
  | "lineComment"
  | "blockComment"
  | "number"
  | "operator"
  | "punct";

type Token = {
  kind: TokenKind;
  text: string;
};

type DialectRules = {
  escapeStrings: boolean;
  dollarQuotes: boolean;
  nestedComments: boolean;
  braceComments: boolean;
  carriageReturnEndsComment: boolean;
};

function dialectRulesOf(engine?: Engine): DialectRules {
  switch (engine) {
    case 1:
      return {
        escapeStrings: true,
        dollarQuotes: true,
        nestedComments: true,
        braceComments: false,
        carriageReturnEndsComment: true,
      };
    case 2:
      return {
        escapeStrings: false,
        dollarQuotes: false,
        nestedComments: true,
        braceComments: false,
        carriageReturnEndsComment: false,
      };
    case 3:
      return {
        escapeStrings: false,
        dollarQuotes: false,
        nestedComments: false,
        braceComments: true,
        carriageReturnEndsComment: false,
      };
    default:
      return {
        escapeStrings: true,
        dollarQuotes: true,
        nestedComments: true,
        braceComments: false,
        carriageReturnEndsComment: true,
      };
  }
}

/** Funções SQL comuns cuja caixa acompanha `uppercaseKeywords` quando seguidas de `(`. */
const sqlFunctions: ReadonlySet<string> = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "coalesce",
  "nullif",
  "row_number",
  "rank",
  "dense_rank",
  "lead",
  "lag",
  "lower",
  "upper",
  "trim",
  "substring",
  "concat",
  "now",
  "date_trunc",
  "extract",
]);

/** Palavras-chave que mantêm espaço antes de `(`. */
const keywordsWithSpaceBeforeParen: ReadonlySet<string> = new Set([
  "as",
  "in",
  "exists",
  "values",
  "over",
  "filter",
  "with",
  "from",
  "join",
  "on",
  "where",
  "and",
  "or",
  "not",
  "case",
  "when",
  "then",
  "else",
  "set",
  "into",
  "table",
  "using",
]);

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isWordStart(ch: string): boolean {
  return /[\p{L}\p{M}_@#]/u.test(ch);
}

function isWordPart(ch: string): boolean {
  return /[\p{L}\p{M}\p{N}_$@#]/u.test(ch);
}

function matchDollarTag(sql: string, position: number): string | null {
  if (sql.charCodeAt(position) !== 36) return null;
  let end = position + 1;
  if (end < sql.length && isDigitCode(sql.charCodeAt(end))) return null;
  while (end < sql.length) {
    const ch = sql[end];
    if (ch === "$") return sql.slice(position, end + 1);
    if (!/[\p{L}\p{M}\p{N}_]/u.test(ch)) return null;
    end++;
  }
  return null;
}

function tokenizeSql(sql: string, rules: DialectRules): Token[] {
  const result: Token[] = [];
  let pos = 0;

  while (pos < sql.length) {
    const code = sql.charCodeAt(pos);
    if (isWhitespaceCode(code)) {
      pos++;
      continue;
    }

    const next = sql.charCodeAt(pos + 1);

    // Comentário de linha `--`
    if (code === 45 && next === 45) {
      let end = pos + 2;
      while (
        end < sql.length &&
        sql.charCodeAt(end) !== 10 &&
        !(rules.carriageReturnEndsComment && sql.charCodeAt(end) === 13)
      ) {
        end++;
      }
      const raw = sql.slice(pos, end).replace(/\r+$/, "");
      result.push({ kind: "lineComment", text: raw });
      pos = end;
      continue;
    }

    // Comentário de bloco `/* ... */`
    if (code === 47 && next === 42) {
      let depth = 1;
      let end = pos + 2;
      while (end < sql.length && depth > 0) {
        if (rules.nestedComments && sql.charCodeAt(end) === 47 && sql.charCodeAt(end + 1) === 42) {
          depth++;
          end += 2;
        } else if (sql.charCodeAt(end) === 42 && sql.charCodeAt(end + 1) === 47) {
          depth--;
          end += 2;
        } else {
          end++;
        }
      }
      result.push({ kind: "blockComment", text: sql.slice(pos, end) });
      pos = end;
      continue;
    }

    // Comentário de chaves `{ ... }` do Informix
    if (code === 123 && rules.braceComments) {
      const close = sql.indexOf("}", pos + 1);
      const end = close < 0 ? sql.length : close + 1;
      result.push({ kind: "blockComment", text: sql.slice(pos, end) });
      pos = end;
      continue;
    }

    // String com escape `E'...'` ou `e'...'`
    if (
      rules.escapeStrings &&
      (code === 69 || code === 101) &&
      next === 39 &&
      (pos === 0 || !isWordPart(sql[pos - 1]))
    ) {
      let end = pos + 2;
      while (end < sql.length) {
        const c = sql.charCodeAt(end);
        if (c === 92) {
          end += 2;
        } else if (c === 39) {
          if (sql.charCodeAt(end + 1) === 39) end += 2;
          else {
            end++;
            break;
          }
        } else {
          end++;
        }
      }
      result.push({ kind: "string", text: sql.slice(pos, end) });
      pos = end;
      continue;
    }

    // String simples `'...'`
    if (code === 39) {
      let end = pos + 1;
      while (end < sql.length) {
        if (sql.charCodeAt(end) === 39) {
          if (sql.charCodeAt(end + 1) === 39) end += 2;
          else {
            end++;
            break;
          }
        } else {
          end++;
        }
      }
      result.push({ kind: "string", text: sql.slice(pos, end) });
      pos = end;
      continue;
    }

    // Identificador entre aspas duplas `"..."`
    if (code === 34) {
      let end = pos + 1;
      while (end < sql.length) {
        if (sql.charCodeAt(end) === 34) {
          if (sql.charCodeAt(end + 1) === 34) end += 2;
          else {
            end++;
            break;
          }
        } else {
          end++;
        }
      }
      result.push({ kind: "quoted", text: sql.slice(pos, end) });
      pos = end;
      continue;
    }

    // Dollar-quoted string `$tag$...$tag$` ou parâmetro `$1`
    if (code === 36) {
      if (rules.dollarQuotes) {
        const tag = matchDollarTag(sql, pos);
        if (tag !== null) {
          const close = sql.indexOf(tag, pos + tag.length);
          const end = close < 0 ? sql.length : close + tag.length;
          result.push({ kind: "dollar", text: sql.slice(pos, end) });
          pos = end;
          continue;
        }
      }
      let end = pos + 1;
      while (end < sql.length && isWordPart(sql[end])) end++;
      result.push({ kind: "word", text: sql.slice(pos, end) });
      pos = end;
      continue;
    }

    // Número
    if (isDigitCode(code)) {
      let end = pos + 1;
      while (end < sql.length && (isDigitCode(sql.charCodeAt(end)) || sql[end] === ".")) end++;
      result.push({ kind: "number", text: sql.slice(pos, end) });
      pos = end;
      continue;
    }

    // Palavra / identificador / variável `@nome`
    if (isWordStart(sql[pos])) {
      let end = pos + 1;
      while (end < sql.length && isWordPart(sql[end])) end++;
      result.push({ kind: "word", text: sql.slice(pos, end) });
      pos = end;
      continue;
    }

    // Operadores compostos de 3 ou 2 caracteres
    const three = sql.slice(pos, pos + 3);
    if (three === "->>") {
      result.push({ kind: "operator", text: three });
      pos += 3;
      continue;
    }

    const two = sql.slice(pos, pos + 2);
    if (
      two === ">=" ||
      two === "<=" ||
      two === "<>" ||
      two === "!=" ||
      two === "::" ||
      two === "||" ||
      two === "->" ||
      two === ":="
    ) {
      result.push({ kind: "operator", text: two });
      pos += 2;
      continue;
    }

    // Pontuação
    const ch = sql[pos];
    if (ch === "(" || ch === ")" || ch === "," || ch === ";" || ch === ".") {
      result.push({ kind: "punct", text: ch });
      pos++;
      continue;
    }

    // Operadores simples e demais símbolos
    result.push({ kind: "operator", text: ch });
    pos++;
  }

  return result;
}

function applyKeywordCase(tokens: readonly Token[], uppercaseKeywords: boolean): Token[] {
  return tokens.map((token, index) => {
    if (token.kind !== "word") return token;
    if (token.text.startsWith("@") || token.text.startsWith("$")) return token;

    const prev = tokens[index - 1];
    if (prev?.text === ".") return token;

    const lower = token.text.toLowerCase();
    const next = tokens[index + 1];
    const isKeyword = uppercaseWords.has(lower);
    const isFuncCall = sqlFunctions.has(lower) && next?.text === "(";

    if (!isKeyword && !isFuncCall) return token;
    return {
      ...token,
      text: uppercaseKeywords ? lower.toUpperCase() : lower,
    };
  });
}

function joinTokens(tokens: readonly Token[]): string {
  if (tokens.length === 0) return "";
  let out = "";

  for (let i = 0; i < tokens.length; i++) {
    const curr = tokens[i];
    const prev = i > 0 ? tokens[i - 1] : undefined;

    if (i === 0) {
      out += curr.text;
      continue;
    }

    if (prev?.kind === "lineComment") {
      out += "\n" + curr.text;
      continue;
    }

    const needSpace = shouldInsertSpace(prev!, curr, tokens[i - 2]);
    out += (needSpace ? " " : "") + curr.text;
  }

  return out;
}

function shouldInsertSpace(prev: Token, curr: Token, beforePrev?: Token): boolean {
  if (curr.text === "," || curr.text === ";" || curr.text === ")" || curr.text === ".") return false;
  if (prev.text === "(" || prev.text === ".") return false;
  if (curr.text === "::" || prev.text === "::") return false;

  if (curr.text === "(" && prev.kind === "word") {
    const lower = prev.text.toLowerCase();
    if (beforePrev?.text === ".") return false;
    return keywordsWithSpaceBeforeParen.has(lower);
  }

  if (curr.text === "*" && (prev.text === "(" || prev.text === ".")) return false;

  if (
    (prev.text === "+" || prev.text === "-") &&
    (beforePrev === undefined ||
      beforePrev.text === "(" ||
      beforePrev.text === "," ||
      beforePrev.kind === "operator")
  ) {
    return false;
  }

  return true;
}

type JoinClause = {
  keyword: string;
  tableTokens: Token[];
  onConditions: { conjunction?: string; tokens: Token[] }[];
};

type ConditionItem = {
  conjunction?: string;
  tokens: Token[];
};

type CteItem = {
  headerKeyword: string;
  name: string;
  asKeyword: string;
  bodyTokens: Token[];
};

type ParsedSelect = {
  ctes: CteItem[];
  selectKeyword: string;
  selectItems: Token[][];
  fromKeyword?: string;
  fromTable?: Token[];
  joins: JoinClause[];
  whereKeyword?: string;
  whereConditions: ConditionItem[];
  groupByKeyword?: string;
  groupByItems: Token[][];
  havingKeyword?: string;
  havingConditions: ConditionItem[];
  orderByKeyword?: string;
  orderByItems: Token[][];
  limitClause?: { keyword: string; tokens: Token[] };
  offsetClause?: { keyword: string; tokens: Token[] };
};

function isWord(token: Token | undefined, word: string): boolean {
  return token !== undefined && token.kind === "word" && token.text.toLowerCase() === word;
}

const joinModWords = new Set(["inner", "left", "right", "full", "outer", "cross", "natural"]);

function matchClauseAt(
  tokens: readonly Token[],
  index: number,
): { kind: string; keyword: string; span: number } | null {
  const t0 = tokens[index];
  if (t0?.kind !== "word") return null;
  const w0 = t0.text.toLowerCase();
  const t1 = tokens[index + 1];
  const w1 = t1?.kind === "word" ? t1.text.toLowerCase() : "";
  const t2 = tokens[index + 2];
  const w2 = t2?.kind === "word" ? t2.text.toLowerCase() : "";

  if (w0 === "select") {
    if (w1 === "distinct") {
      return { kind: "SELECT", keyword: `${t0.text} ${t1.text}`, span: 2 };
    }
    return { kind: "SELECT", keyword: t0.text, span: 1 };
  }

  if (w0 === "from") {
    return { kind: "FROM", keyword: t0.text, span: 1 };
  }

  if (w0 === "join") {
    return { kind: "JOIN", keyword: t0.text, span: 1 };
  }

  if (joinModWords.has(w0)) {
    if (w1 === "join") {
      return { kind: "JOIN", keyword: `${t0.text} ${t1.text}`, span: 2 };
    }
    if (joinModWords.has(w1) && w2 === "join") {
      return { kind: "JOIN", keyword: `${t0.text} ${t1.text} ${t2.text}`, span: 3 };
    }
  }

  if (w0 === "where") {
    return { kind: "WHERE", keyword: t0.text, span: 1 };
  }

  if (w0 === "group" && w1 === "by") {
    return { kind: "GROUP BY", keyword: `${t0.text} ${t1.text}`, span: 2 };
  }

  if (w0 === "having") {
    return { kind: "HAVING", keyword: t0.text, span: 1 };
  }

  if (w0 === "order" && w1 === "by") {
    return { kind: "ORDER BY", keyword: `${t0.text} ${t1.text}`, span: 2 };
  }

  if (w0 === "limit") {
    return { kind: "LIMIT", keyword: t0.text, span: 1 };
  }

  if (w0 === "offset") {
    return { kind: "OFFSET", keyword: t0.text, span: 1 };
  }

  return null;
}

function splitByTopLevelComma(tokens: readonly Token[]): Token[][] {
  const items: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const token of tokens) {
    if (token.text === "(") depth++;
    else if (token.text === ")" && depth > 0) depth--;

    if (depth === 0 && token.text === ",") {
      items.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }

  if (current.length > 0) items.push(current);
  return items;
}

function splitConditions(tokens: readonly Token[]): ConditionItem[] {
  const items: ConditionItem[] = [];
  let current: Token[] = [];
  let conjunction: string | undefined;
  let depth = 0;
  let inBetween = false;

  for (const token of tokens) {
    if (token.text === "(") depth++;
    else if (token.text === ")" && depth > 0) depth--;

    if (depth === 0 && token.kind === "word") {
      const lower = token.text.toLowerCase();
      if (lower === "between") {
        inBetween = true;
        current.push(token);
        continue;
      }
      if (lower === "and" && inBetween) {
        inBetween = false;
        current.push(token);
        continue;
      }
      if (lower === "and" || lower === "or") {
        items.push({ conjunction, tokens: current });
        conjunction = token.text;
        current = [];
        continue;
      }
    }

    current.push(token);
  }

  if (current.length > 0 || conjunction !== undefined) {
    items.push({ conjunction, tokens: current });
  }
  return items;
}

function splitJoinOn(tokens: readonly Token[]): {
  tableTokens: Token[];
  onKeyword?: string;
  onConditions: ConditionItem[];
} {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.text === "(") depth++;
    else if (token.text === ")" && depth > 0) depth--;
    else if (depth === 0 && isWord(token, "on")) {
      const tableTokens = tokens.slice(0, i);
      const rest = tokens.slice(i + 1);
      const conds = splitConditions(rest);
      if (conds.length > 0) {
        conds[0] = { conjunction: token.text, tokens: conds[0].tokens };
      }
      return { tableTokens, onKeyword: token.text, onConditions: conds };
    }
  }
  return { tableTokens: [...tokens], onConditions: [] };
}

function extractCtes(tokens: readonly Token[]): { ctes: CteItem[]; rest: readonly Token[] } {
  if (!isWord(tokens[0], "with")) return { ctes: [], rest: tokens };

  const ctes: CteItem[] = [];
  let pos = 1;
  let firstHeader = tokens[0].text;

  if (isWord(tokens[pos], "recursive")) {
    firstHeader = `${firstHeader} ${tokens[pos].text}`;
    pos++;
  }

  while (pos < tokens.length) {
    const nameToken = tokens[pos];
    const asToken = tokens[pos + 1];
    const openParen = tokens[pos + 2];
    if (!nameToken || !isWord(asToken, "as") || openParen?.text !== "(") {
      return { ctes: [], rest: tokens };
    }

    let depth = 1;
    let closeIdx = pos + 3;
    while (closeIdx < tokens.length && depth > 0) {
      if (tokens[closeIdx].text === "(") depth++;
      else if (tokens[closeIdx].text === ")") depth--;
      if (depth > 0) closeIdx++;
    }
    if (depth !== 0) return { ctes: [], rest: tokens };

    const bodyTokens = tokens.slice(pos + 3, closeIdx);
    ctes.push({
      headerKeyword: ctes.length === 0 ? firstHeader : ",",
      name: nameToken.text,
      asKeyword: asToken.text,
      bodyTokens,
    });

    pos = closeIdx + 1;
    if (tokens[pos]?.text === ",") {
      pos++;
      continue;
    }
    break;
  }

  return { ctes, rest: tokens.slice(pos) };
}

function parseSelectQuery(tokens: readonly Token[]): ParsedSelect | null {
  if (tokens.some((t) => t.kind === "lineComment" || t.kind === "blockComment")) {
    // Queries com comentários nos tokens usam o formatador linear de cláusulas ou compacto
    // para preservar a posição exata dos comentários.
  }

  const { ctes, rest } = extractCtes(tokens);
  const firstClause = matchClauseAt(rest, 0);
  if (firstClause?.kind !== "SELECT") return null;

  type RawClause = { kind: string; keyword: string; tokens: Token[] };
  const clauses: RawClause[] = [];
  let current: RawClause = { kind: firstClause.kind, keyword: firstClause.keyword, tokens: [] };
  let depth = 0;
  let i = firstClause.span;

  while (i < rest.length) {
    const token = rest[i];
    if (token.text === "(") {
      depth++;
      current.tokens.push(token);
      i++;
      continue;
    }
    if (token.text === ")") {
      if (depth > 0) depth--;
      current.tokens.push(token);
      i++;
      continue;
    }

    if (depth === 0) {
      // Se encontrar UNION/INTERSECT/EXCEPT no nível 0, não é um SELECT simples único
      if (isWord(token, "union") || isWord(token, "intersect") || isWord(token, "except")) {
        return null;
      }
      const matched = matchClauseAt(rest, i);
      if (matched !== null) {
        clauses.push(current);
        current = { kind: matched.kind, keyword: matched.keyword, tokens: [] };
        i += matched.span;
        continue;
      }
    }

    current.tokens.push(token);
    i++;
  }
  clauses.push(current);

  const parsed: ParsedSelect = {
    ctes,
    selectKeyword: firstClause.keyword,
    selectItems: [],
    joins: [],
    whereConditions: [],
    groupByItems: [],
    havingConditions: [],
    orderByItems: [],
  };

  for (const clause of clauses) {
    switch (clause.kind) {
      case "SELECT":
        parsed.selectKeyword = clause.keyword;
        parsed.selectItems = splitByTopLevelComma(clause.tokens);
        break;
      case "FROM":
        parsed.fromKeyword = clause.keyword;
        parsed.fromTable = clause.tokens;
        break;
      case "JOIN": {
        const { tableTokens, onConditions } = splitJoinOn(clause.tokens);
        parsed.joins.push({
          keyword: clause.keyword,
          tableTokens,
          onConditions,
        });
        break;
      }
      case "WHERE":
        parsed.whereKeyword = clause.keyword;
        parsed.whereConditions = splitConditions(clause.tokens);
        break;
      case "GROUP BY":
        parsed.groupByKeyword = clause.keyword;
        parsed.groupByItems = splitByTopLevelComma(clause.tokens);
        break;
      case "HAVING":
        parsed.havingKeyword = clause.keyword;
        parsed.havingConditions = splitConditions(clause.tokens);
        break;
      case "ORDER BY":
        parsed.orderByKeyword = clause.keyword;
        parsed.orderByItems = splitByTopLevelComma(clause.tokens);
        break;
      case "LIMIT":
        parsed.limitClause = { keyword: clause.keyword, tokens: clause.tokens };
        break;
      case "OFFSET":
        parsed.offsetClause = { keyword: clause.keyword, tokens: clause.tokens };
        break;
    }
  }

  return parsed;
}

/** Alinha a palavra-chave à coluna do rio (largura 6 na primeira palavra). */
function riverPad(keyword: string): string {
  const parts = keyword.split(" ");
  if (parts.length === 1) {
    return keyword.padStart(6, " ");
  }
  return `${parts[0].padStart(6, " ")} ${parts.slice(1).join(" ")}`;
}

function renderRiver(parsed: ParsedSelect, baseIndent = ""): string {
  const lines: string[] = [];
  const riverIndent = baseIndent + " ".repeat(7);

  if (parsed.ctes.length > 0) {
    for (const cte of parsed.ctes) {
      const inner = formatQueryTokens(cte.bodyTokens, {
        style: "river",
        uppercaseKeywords: true,
        tabSize: 4,
      });
      const indentedInner = inner
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n");
      lines.push(`${baseIndent}${cte.headerKeyword} ${cte.name} ${cte.asKeyword} (`);
      lines.push(indentedInner);
      lines.push(`${baseIndent})`);
    }
  }

  const selectTexts = parsed.selectItems.map(joinTokens);
  if (selectTexts.length > 0) {
    selectTexts.forEach((item, idx) => {
      const suffix = idx < selectTexts.length - 1 ? "," : "";
      if (idx === 0) {
        lines.push(`${baseIndent}${riverPad(parsed.selectKeyword)} ${item}${suffix}`);
      } else {
        lines.push(`${riverIndent}${item}${suffix}`);
      }
    });
  }

  if (parsed.fromKeyword && parsed.fromTable) {
    lines.push(`${baseIndent}${riverPad(parsed.fromKeyword)} ${joinTokens(parsed.fromTable)}`);
  }

  for (const join of parsed.joins) {
    lines.push(`${baseIndent}${riverPad(join.keyword)} ${joinTokens(join.tableTokens)}`);
    for (const cond of join.onConditions) {
      const kw = cond.conjunction ?? "ON";
      lines.push(`${baseIndent}${riverPad(kw)} ${joinTokens(cond.tokens)}`);
    }
  }

  if (parsed.whereKeyword && parsed.whereConditions.length > 0) {
    parsed.whereConditions.forEach((cond, idx) => {
      const kw = idx === 0 ? parsed.whereKeyword! : (cond.conjunction ?? "AND");
      lines.push(`${baseIndent}${riverPad(kw)} ${joinTokens(cond.tokens)}`);
    });
  }

  if (parsed.groupByKeyword && parsed.groupByItems.length > 0) {
    lines.push(
      `${baseIndent}${riverPad(parsed.groupByKeyword)} ${parsed.groupByItems.map(joinTokens).join(", ")}`,
    );
  }

  if (parsed.havingKeyword && parsed.havingConditions.length > 0) {
    parsed.havingConditions.forEach((cond, idx) => {
      const kw = idx === 0 ? parsed.havingKeyword! : (cond.conjunction ?? "AND");
      lines.push(`${baseIndent}${riverPad(kw)} ${joinTokens(cond.tokens)}`);
    });
  }

  if (parsed.orderByKeyword && parsed.orderByItems.length > 0) {
    lines.push(
      `${baseIndent}${riverPad(parsed.orderByKeyword)} ${parsed.orderByItems.map(joinTokens).join(", ")}`,
    );
  }

  if (parsed.limitClause) {
    lines.push(`${baseIndent}${riverPad(parsed.limitClause.keyword)} ${joinTokens(parsed.limitClause.tokens)}`);
  }

  if (parsed.offsetClause) {
    lines.push(`${baseIndent}${riverPad(parsed.offsetClause.keyword)} ${joinTokens(parsed.offsetClause.tokens)}`);
  }

  return lines.join("\n");
}

function renderExpanded(parsed: ParsedSelect, tabSize: number, baseIndent = ""): string {
  const indent = " ".repeat(Math.max(1, tabSize));
  const lines: string[] = [];

  if (parsed.ctes.length > 0) {
    for (const cte of parsed.ctes) {
      const subParsed = parseSelectQuery(cte.bodyTokens);
      const inner = subParsed
        ? renderExpanded(subParsed, tabSize, baseIndent + indent)
        : `${baseIndent}${indent}${joinTokens(cte.bodyTokens)}`;
      lines.push(`${baseIndent}${cte.headerKeyword} ${cte.name} ${cte.asKeyword} (`);
      lines.push(inner);
      lines.push(`${baseIndent})`);
    }
  }

  lines.push(`${baseIndent}${parsed.selectKeyword}`);
  parsed.selectItems.forEach((item, idx) => {
    const suffix = idx < parsed.selectItems.length - 1 ? "," : "";
    lines.push(`${baseIndent}${indent}${joinTokens(item)}${suffix}`);
  });

  if (parsed.fromKeyword && parsed.fromTable) {
    lines.push(`${baseIndent}${parsed.fromKeyword}`);
    lines.push(`${baseIndent}${indent}${joinTokens(parsed.fromTable)}`);
    for (const join of parsed.joins) {
      lines.push(`${baseIndent}${indent}${join.keyword} ${joinTokens(join.tableTokens)}`);
      for (const cond of join.onConditions) {
        const kw = cond.conjunction ?? "ON";
        lines.push(`${baseIndent}${indent}${indent}${kw} ${joinTokens(cond.tokens)}`);
      }
    }
  }

  if (parsed.whereKeyword && parsed.whereConditions.length > 0) {
    lines.push(`${baseIndent}${parsed.whereKeyword}`);
    parsed.whereConditions.forEach((cond, idx) => {
      if (idx === 0) {
        lines.push(`${baseIndent}${indent}${joinTokens(cond.tokens)}`);
      } else {
        lines.push(`${baseIndent}${indent}${cond.conjunction ?? "AND"} ${joinTokens(cond.tokens)}`);
      }
    });
  }

  if (parsed.groupByKeyword && parsed.groupByItems.length > 0) {
    lines.push(`${baseIndent}${parsed.groupByKeyword}`);
    parsed.groupByItems.forEach((item, idx) => {
      const suffix = idx < parsed.groupByItems.length - 1 ? "," : "";
      lines.push(`${baseIndent}${indent}${joinTokens(item)}${suffix}`);
    });
  }

  if (parsed.havingKeyword && parsed.havingConditions.length > 0) {
    lines.push(`${baseIndent}${parsed.havingKeyword}`);
    parsed.havingConditions.forEach((cond, idx) => {
      if (idx === 0) {
        lines.push(`${baseIndent}${indent}${joinTokens(cond.tokens)}`);
      } else {
        lines.push(`${baseIndent}${indent}${cond.conjunction ?? "AND"} ${joinTokens(cond.tokens)}`);
      }
    });
  }

  if (parsed.orderByKeyword && parsed.orderByItems.length > 0) {
    lines.push(`${baseIndent}${parsed.orderByKeyword}`);
    parsed.orderByItems.forEach((item, idx) => {
      const suffix = idx < parsed.orderByItems.length - 1 ? "," : "";
      lines.push(`${baseIndent}${indent}${joinTokens(item)}${suffix}`);
    });
  }

  if (parsed.limitClause) {
    lines.push(`${baseIndent}${parsed.limitClause.keyword}`);
    lines.push(`${baseIndent}${indent}${joinTokens(parsed.limitClause.tokens)}`);
  }

  if (parsed.offsetClause) {
    lines.push(`${baseIndent}${parsed.offsetClause.keyword}`);
    lines.push(`${baseIndent}${indent}${joinTokens(parsed.offsetClause.tokens)}`);
  }

  return lines.join("\n");
}

function renderTabular(parsed: ParsedSelect): string {
  const keywords = [
    parsed.selectKeyword,
    parsed.fromKeyword ?? "",
    ...parsed.joins.map((j) => j.keyword),
    parsed.whereKeyword ?? "",
    ...parsed.whereConditions.slice(1).map((c) => c.conjunction ?? ""),
    parsed.groupByKeyword ?? "",
    parsed.havingKeyword ?? "",
    parsed.orderByKeyword ?? "",
    parsed.limitClause?.keyword ?? "",
    parsed.offsetClause?.keyword ?? "",
  ].filter(Boolean);

  const maxKw = Math.max(8, ...keywords.map((k) => k.length));
  const colWidth = maxKw + 1;
  const padKw = (kw: string) => kw.padEnd(colWidth, " ");
  const contIndent = " ".repeat(colWidth);

  const lines: string[] = [];

  if (parsed.ctes.length > 0) {
    for (const cte of parsed.ctes) {
      const subParsed = parseSelectQuery(cte.bodyTokens);
      const inner = subParsed ? renderTabular(subParsed) : joinTokens(cte.bodyTokens);
      lines.push(`${cte.headerKeyword} ${cte.name} ${cte.asKeyword} (`);
      lines.push(
        inner
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
      );
      lines.push(")");
    }
  }

  parsed.selectItems.forEach((item, idx) => {
    const suffix = idx < parsed.selectItems.length - 1 ? "," : "";
    if (idx === 0) {
      lines.push(`${padKw(parsed.selectKeyword)}${joinTokens(item)}${suffix}`);
    } else {
      lines.push(`${contIndent}${joinTokens(item)}${suffix}`);
    }
  });

  if (parsed.fromKeyword && parsed.fromTable) {
    lines.push(`${padKw(parsed.fromKeyword)}${joinTokens(parsed.fromTable)}`);
  }

  for (const join of parsed.joins) {
    const onText = join.onConditions
      .map((cond) => `${cond.conjunction ?? "ON"} ${joinTokens(cond.tokens)}`)
      .join(" ");
    const fullJoin = onText
      ? `${joinTokens(join.tableTokens)} ${onText}`
      : joinTokens(join.tableTokens);
    lines.push(`${padKw(join.keyword)}${fullJoin}`);
  }

  if (parsed.whereKeyword && parsed.whereConditions.length > 0) {
    parsed.whereConditions.forEach((cond, idx) => {
      const kw = idx === 0 ? parsed.whereKeyword! : (cond.conjunction ?? "AND");
      lines.push(`${padKw(kw)}${joinTokens(cond.tokens)}`);
    });
  }

  if (parsed.groupByKeyword && parsed.groupByItems.length > 0) {
    lines.push(`${padKw(parsed.groupByKeyword)}${parsed.groupByItems.map(joinTokens).join(", ")}`);
  }

  if (parsed.havingKeyword && parsed.havingConditions.length > 0) {
    parsed.havingConditions.forEach((cond, idx) => {
      const kw = idx === 0 ? parsed.havingKeyword! : (cond.conjunction ?? "AND");
      lines.push(`${padKw(kw)}${joinTokens(cond.tokens)}`);
    });
  }

  if (parsed.orderByKeyword && parsed.orderByItems.length > 0) {
    lines.push(`${padKw(parsed.orderByKeyword)}${parsed.orderByItems.map(joinTokens).join(", ")}`);
  }

  if (parsed.limitClause) {
    lines.push(`${padKw(parsed.limitClause.keyword)}${joinTokens(parsed.limitClause.tokens)}`);
  }

  if (parsed.offsetClause) {
    lines.push(`${padKw(parsed.offsetClause.keyword)}${joinTokens(parsed.offsetClause.tokens)}`);
  }

  return lines.join("\n");
}

function renderLeadingComma(parsed: ParsedSelect): string {
  const lines: string[] = [];
  const commaPrefix = `${" ".repeat(Math.max(0, parsed.selectKeyword.length - 1))}, `;

  if (parsed.ctes.length > 0) {
    for (const cte of parsed.ctes) {
      const subParsed = parseSelectQuery(cte.bodyTokens);
      const inner = subParsed ? renderLeadingComma(subParsed) : joinTokens(cte.bodyTokens);
      lines.push(`${cte.headerKeyword} ${cte.name} ${cte.asKeyword} (`);
      lines.push(
        inner
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
      );
      lines.push(")");
    }
  }

  parsed.selectItems.forEach((item, idx) => {
    if (idx === 0) {
      lines.push(`${parsed.selectKeyword} ${joinTokens(item)}`);
    } else {
      lines.push(`${commaPrefix}${joinTokens(item)}`);
    }
  });

  if (parsed.fromKeyword && parsed.fromTable) {
    lines.push(`${parsed.fromKeyword} ${joinTokens(parsed.fromTable)}`);
  }

  for (const join of parsed.joins) {
    lines.push(`${join.keyword} ${joinTokens(join.tableTokens)}`);
    for (const cond of join.onConditions) {
      const kw = cond.conjunction ?? "ON";
      lines.push(`  ${kw} ${joinTokens(cond.tokens)}`);
    }
  }

  if (parsed.whereKeyword && parsed.whereConditions.length > 0) {
    parsed.whereConditions.forEach((cond, idx) => {
      if (idx === 0) {
        lines.push(`${parsed.whereKeyword} ${joinTokens(cond.tokens)}`);
      } else {
        lines.push(`  ${cond.conjunction ?? "AND"} ${joinTokens(cond.tokens)}`);
      }
    });
  }

  if (parsed.groupByKeyword && parsed.groupByItems.length > 0) {
    const groupCommaPrefix = `${" ".repeat(Math.max(0, parsed.groupByKeyword.length - 1))}, `;
    parsed.groupByItems.forEach((item, idx) => {
      if (idx === 0) {
        lines.push(`${parsed.groupByKeyword} ${joinTokens(item)}`);
      } else {
        lines.push(`${groupCommaPrefix}${joinTokens(item)}`);
      }
    });
  }

  if (parsed.havingKeyword && parsed.havingConditions.length > 0) {
    parsed.havingConditions.forEach((cond, idx) => {
      if (idx === 0) {
        lines.push(`${parsed.havingKeyword} ${joinTokens(cond.tokens)}`);
      } else {
        lines.push(`  ${cond.conjunction ?? "AND"} ${joinTokens(cond.tokens)}`);
      }
    });
  }

  if (parsed.orderByKeyword && parsed.orderByItems.length > 0) {
    const orderCommaPrefix = `${" ".repeat(Math.max(0, parsed.orderByKeyword.length - 1))}, `;
    parsed.orderByItems.forEach((item, idx) => {
      if (idx === 0) {
        lines.push(`${parsed.orderByKeyword} ${joinTokens(item)}`);
      } else {
        lines.push(`${orderCommaPrefix}${joinTokens(item)}`);
      }
    });
  }

  if (parsed.limitClause) {
    lines.push(`${parsed.limitClause.keyword} ${joinTokens(parsed.limitClause.tokens)}`);
  }

  if (parsed.offsetClause) {
    lines.push(`${parsed.offsetClause.keyword} ${joinTokens(parsed.offsetClause.tokens)}`);
  }

  return lines.join("\n");
}

function renderModern(parsed: ParsedSelect, tabSize: number, baseIndent = "", isCteBody = false): string {
  const indent = " ".repeat(Math.max(1, tabSize));
  const sections: string[] = [];

  if (parsed.ctes.length > 0) {
    const cteBlocks: string[] = [];
    for (const cte of parsed.ctes) {
      const subParsed = parseSelectQuery(cte.bodyTokens);
      const inner = subParsed
        ? renderModern(subParsed, tabSize, baseIndent + indent, true)
        : `${baseIndent}${indent}${joinTokens(cte.bodyTokens)}`;
      const prefix = cte.headerKeyword === "," ? ", " : `${cte.headerKeyword} `;
      cteBlocks.push(`${baseIndent}${prefix}${cte.name} ${cte.asKeyword} (\n${inner}\n${baseIndent})`);
    }
    sections.push(cteBlocks.join("\n"));
  }

  const lines: string[] = [];
  const singleStar =
    isCteBody && parsed.selectItems.length === 1 && joinTokens(parsed.selectItems[0]) === "*";

  if (singleStar) {
    lines.push(`${baseIndent}${parsed.selectKeyword} *`);
  } else {
    lines.push(`${baseIndent}${parsed.selectKeyword}`);
    parsed.selectItems.forEach((item, idx) => {
      const suffix = idx < parsed.selectItems.length - 1 ? "," : "";
      lines.push(`${baseIndent}${indent}${joinTokens(item)}${suffix}`);
    });
  }

  if (parsed.fromKeyword && parsed.fromTable) {
    lines.push(`${baseIndent}${parsed.fromKeyword} ${joinTokens(parsed.fromTable)}`);
  }

  for (const join of parsed.joins) {
    lines.push(`${baseIndent}${join.keyword} ${joinTokens(join.tableTokens)}`);
    for (const cond of join.onConditions) {
      const kw = cond.conjunction ?? "ON";
      lines.push(`${baseIndent}${indent}${kw} ${joinTokens(cond.tokens)}`);
    }
  }

  if (parsed.whereKeyword && parsed.whereConditions.length > 0) {
    parsed.whereConditions.forEach((cond, idx) => {
      if (idx === 0) {
        lines.push(`${baseIndent}${parsed.whereKeyword} ${joinTokens(cond.tokens)}`);
      } else {
        lines.push(`${baseIndent}${indent}${cond.conjunction ?? "AND"} ${joinTokens(cond.tokens)}`);
      }
    });
  }

  if (parsed.groupByKeyword && parsed.groupByItems.length > 0) {
    lines.push(
      `${baseIndent}${parsed.groupByKeyword} ${parsed.groupByItems.map(joinTokens).join(", ")}`,
    );
  }

  if (parsed.havingKeyword && parsed.havingConditions.length > 0) {
    parsed.havingConditions.forEach((cond, idx) => {
      if (idx === 0) {
        lines.push(`${baseIndent}${parsed.havingKeyword} ${joinTokens(cond.tokens)}`);
      } else {
        lines.push(`${baseIndent}${indent}${cond.conjunction ?? "AND"} ${joinTokens(cond.tokens)}`);
      }
    });
  }

  if (parsed.orderByKeyword && parsed.orderByItems.length > 0) {
    lines.push(
      `${baseIndent}${parsed.orderByKeyword} ${parsed.orderByItems.map(joinTokens).join(", ")}`,
    );
  }

  if (parsed.limitClause) {
    lines.push(`${baseIndent}${parsed.limitClause.keyword} ${joinTokens(parsed.limitClause.tokens)}`);
  }

  if (parsed.offsetClause) {
    lines.push(`${baseIndent}${parsed.offsetClause.keyword} ${joinTokens(parsed.offsetClause.tokens)}`);
  }

  sections.push(lines.join("\n"));
  return sections.join("\n\n");
}

function formatQueryTokens(tokens: readonly Token[], options: SqlFormatOptions): string {
  const cased = applyKeywordCase(tokens, options.uppercaseKeywords);
  if (cased.length === 0) return "";

  const hasTrailingSemicolon = cased.at(-1)?.text === ";";
  const bodyTokens = hasTrailingSemicolon ? cased.slice(0, -1) : cased;

  if (options.style === "compact") {
    const body = joinTokens(bodyTokens);
    return hasTrailingSemicolon ? `${body};` : body;
  }

  const parsed = parseSelectQuery(bodyTokens);
  if (parsed === null) {
    const fallback = joinTokens(bodyTokens);
    return hasTrailingSemicolon ? `${fallback};` : fallback;
  }

  let formatted: string;
  switch (options.style) {
    case "river":
      formatted = renderRiver(parsed);
      break;
    case "expanded":
      formatted = renderExpanded(parsed, options.tabSize);
      break;
    case "tabular":
      formatted = renderTabular(parsed);
      break;
    case "leadingComma":
      formatted = renderLeadingComma(parsed);
      break;
    case "modern":
      formatted = renderModern(parsed, options.tabSize);
      break;
  }

  return hasTrailingSemicolon ? `${formatted};` : formatted;
}

function hasSemicolonAfter(sql: string, end: number): boolean {
  let pos = end;
  while (pos < sql.length && isWhitespaceCode(sql.charCodeAt(pos))) pos++;
  return sql.charCodeAt(pos) === 59;
}

/**
 * Formata um comando ou script SQL no estilo escolhido pelo usuário,
 * respeitando `uppercaseKeywords` (`true` = MAIÚSCULAS, `false` = minúsculas)
 * e `tabSize`, preservando literais, comentários e declarações `let`/`const`.
 */
export function formatSql(sql: string, options: SqlFormatOptions): string {
  if (sql.trim().length === 0) return sql;

  const rules = dialectRulesOf(options.engine);
  const items = splitScript(sql, options.engine, {
    blankLines: options.blankLines ?? true,
  });

  if (items.length === 0) return sql;

  const formattedItems = items.map((item) => {
    const withSemi = hasSemicolonAfter(sql, item.end);
    if (item.kind !== "statement" || statementHasBody(item.text, options.engine)) {
      const trimmed = item.text.trim();
      return withSemi && !trimmed.endsWith(";") ? `${trimmed};` : trimmed;
    }

    const rawText = withSemi ? `${item.text};` : item.text;
    const tokens = tokenizeSql(rawText, rules);
    return formatQueryTokens(tokens, options);
  });

  return formattedItems.join("\n\n");
}
