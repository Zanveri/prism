import type { QueryColumn } from "../query.schema";
import type { GridSlice } from "./grid-slice";

/** Só para os testes deste módulo: o recorte e os valores hostis que cada formato tem de aguentar. */

export const column = (name: string, kind: QueryColumn["kind"] = "text"): QueryColumn => ({ name, type: kind === "number" ? "integer" : kind, kind });

/** Monta um recorte; sem `rowNumbers`, as linhas são 1, 2, 3… */
export function sliceOf(columns: QueryColumn[], rows: (string | null)[][], extra: { truncated?: [number, number][]; rowNumbers?: number[] } = {}): GridSlice {
  return { columns, rows, truncated: extra.truncated ?? [], rowNumbers: extra.rowNumbers ?? rows.map((_, index) => index + 1) };
}

/** Os caracteres de controle e os pares soltos se escrevem por código: o lint recusa `\x00` num literal. */
export const chars = (...codes: number[]) => String.fromCharCode(...codes);

/** Um valor para cada coisa que costuma quebrar um formato. */
export const hostile = {
  quote: 'ele disse "oi"',
  singleQuote: "O'Brien",
  lf: "linha1\nlinha2",
  crlf: "linha1\r\nlinha2",
  cr: `só${chars(13)}CR`,
  tab: "a\tb",
  accents: "Extrusão — ação ç",
  emoji: "🙂 e 👨‍👩‍👧",
  controls: `a${chars(0)}b${chars(1)}c${chars(7)}d${chars(27)}e${chars(127)}f${chars(0x85)}g`,
  loneSurrogate: `x${chars(0xd800)}y${chars(0xdc00)}z`,
  markup: `<script>alert("x")</script> & <b>negrito</b> ]]> 'a'`,
  pipeAndBackslash: "a|b\\c|d\\",
  formulaEquals: "=1+1",
  formulaPlus: "+1+1",
  formulaMinus: "-1+1",
  formulaAt: "@SUM(A1)",
  formulaCommand: "=cmd|' /C calc'!A0",
  formulaAfterSpace: " \t=1+1",
  delimiters: "a;b,c|d\te",
};

/** Todos os valores acima, numa lista, para o teste que passa cada um por um formato. */
export const hostileValues: string[] = Object.values(hostile);

/** Um gerador pseudoaleatório de semente fixa (mulberry32): o sorteio dos testes é o mesmo em toda execução. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fragments = ["'", "''", '"', ";", "--", "/*", "*/", "{", "}", "\\", "$$", "$a$", "%", "_", "!", " ", "a", "Z", "0", "7", "é", "🙂", "\n", "\t", "\r", "E'", "\\'", "; DROP TABLE x; --", "'; DELETE FROM t; --", "-", "=", "."];

/** Um texto sorteado de pedaços perigosos para o SQL: aspas, `;`, comentários, barra invertida, quebra de linha, `$$`, chaves do Informix. */
export function randomText(random: () => number, maxPieces = 8): string {
  const count = Math.floor(random() * (maxPieces + 1));
  let text = "";
  for (let index = 0; index < count; index++) text += fragments[Math.floor(random() * fragments.length)];
  return text;
}
