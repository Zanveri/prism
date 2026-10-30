import { StreamLanguage, type StringStream } from "@codemirror/language";

const dbmlKeywords = new Set([
  "project",
  "table",
  "ref",
  "indexes",
  "checks",
  "note",
  "enum",
  "tablegroup",
  "as",
  "pk",
  "primary",
  "key",
  "unique",
  "null",
  "not",
  "increment",
  "default",
  "delete",
  "update",
  "cascade",
  "restrict",
  "set",
  "no",
  "action",
  "true",
  "false",
]);

type DbmlState = {
  inBlockComment: boolean;
};

export const dbmlLanguage: StreamLanguage<unknown> = StreamLanguage.define<DbmlState>({
  name: "dbml",
  startState: () => ({ inBlockComment: false }),
  token(stream: StringStream, state: DbmlState): string | null {
    if (state.inBlockComment) {
      if (stream.skipTo("*/")) {
        stream.next();
        stream.next();
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "comment";
    }

    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }

    if (stream.match("/*")) {
      state.inBlockComment = true;
      return "comment";
    }

    const ch = stream.peek();
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = stream.next()!;
      while (!stream.eol()) {
        const next = stream.next();
        if (next === "\\") {
          stream.next();
        } else if (next === quote) {
          break;
        }
      }
      return quote === '"' ? "variableName.special" : "string";
    }

    if (stream.match(/^-?\d+(\.\d+)?/)) {
      return "number";
    }

    if (stream.match(/^[<>-]+/)) {
      return "operator";
    }

    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current().toLowerCase();
      if (dbmlKeywords.has(word)) {
        return "keyword";
      }
      return "variableName";
    }

    stream.next();
    return null;
  },
});
