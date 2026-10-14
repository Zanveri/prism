import type { QueryColumn, QueryRow } from "./query.schema";

/*
 * As larguras das colunas da grade do resultado (RN-GRADE-009), em funções puras. Todas as medidas daqui são as de 100% de zoom: quem desenha
 * multiplica pelo zoom (RN-GRADE-010), e a largura que a pessoa arrasta é guardada já dividida por ele, para valer igual em qualquer zoom.
 */

/** O respiro da célula: 12 px de cada lado (o `px-3`) e a divisória. */
export const cellPadding = 25;
/** A IBM Plex Mono a 13 px tem 0,6 em por caractere; o tipo, no cabeçalho, vai a 11 px. Como a fonte é de largura fixa, contar caracteres dispensa medir o DOM. */
export const charWidth = 7.8;
const typeCharWidth = 6.6;
/** O espaço entre o nome e o tipo, no cabeçalho (`gap-1.5`). */
const nameTypeGap = 6;
/** A seta da ordem e o espaço antes dela (`size-3` e `gap-1.5`). */
const sortArrowWidth = 18;

/** A largura de saída: entre estas duas, pelo cabeçalho e pela primeira página. */
const minBaseWidth = 72;
const maxBaseWidth = 480;

/** A menor largura escolhida à mão: o respiro e uns três caracteres, para a coluna ainda mostrar alguma coisa (o começo do valor e a reticência). */
export const minWidth = 48;
/** A maior largura escolhida à mão (arrastar ou setas). */
export const maxWidth = 2000;
/** O teto do ajuste ao conteúdo (o duplo clique na divisa): um valor de 10.000 caracteres não vira uma coluna de 78.000 px. */
export const fitCap = 600;

/**
 * A largura do cabeçalho de uma coluna: o nome, o tipo (quando o cabeçalho o mostra, RN-CONFIG-006), a marca da coluna que não se edita (RN-EDIT-002,
 * depois do tipo, com ` · `) e, quando o cabeçalho ordena, a seta.
 */
function headerWidth(column: QueryColumn, { sortable, showType, mark = null }: { sortable: boolean; showType: boolean; mark?: string | null }): number {
  const note = showType ? (mark === null ? column.type : `${column.type} · ${mark}`) : (mark ?? "");
  return column.name.length * charWidth + (note.length > 0 || showType ? nameTypeGap + note.length * typeCharWidth : 0) + (sortable ? sortArrowWidth : 0);
}

/** A largura do texto de uma célula (o nulo conta com o texto que a pessoa escolheu para ele). */
const valueWidth = (value: string | null, nullText: string) => (value?.length ?? nullText.length) * charWidth;

/**
 * A largura de saída de cada coluna, pelo cabeçalho e pelos valores das linhas dadas (a grade passa a PRIMEIRA página: carregar mais não muda o que está na
 * tela). Valor mais largo que o teto termina em reticências. Sem o tipo no cabeçalho (RN-CONFIG-006) a coluna não reserva lugar para ele.
 */
export function baseWidths(columns: readonly QueryColumn[], rows: readonly QueryRow[], nullText: string, showType = true, marks: readonly (string | null)[] | null = null): number[] {
  return columns.map((column, index) => {
    let width = headerWidth(column, { sortable: false, showType, mark: marks?.[index] ?? null });
    for (const row of rows) width = Math.max(width, valueWidth(row[index] ?? null, nullText));
    return Math.min(maxBaseWidth, Math.max(minBaseWidth, Math.ceil(width) + cellPadding));
  });
}

/**
 * O ajuste ao conteúdo (o duplo clique na divisa, e o Enter com o foco nela): o maior valor entre TODAS as linhas carregadas e o cabeçalho, com a seta da
 * ordem quando ele ordena, até o teto do ajuste. O que passa do teto continua com reticências.
 */
export function fitWidth(column: QueryColumn, index: number, rows: readonly QueryRow[], nullText: string, { sortable = false, showType = true, mark = null }: { sortable?: boolean; showType?: boolean; mark?: string | null } = {}): number {
  let width = headerWidth(column, { sortable, showType, mark });
  for (const row of rows) width = Math.max(width, valueWidth(row[index] ?? null, nullText));
  return Math.min(fitCap, Math.max(minWidth, Math.ceil(width) + cellPadding));
}

/** Uma largura escolhida à mão, entre os limites e em pixels inteiros. */
export function clampWidth(width: number): number {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

/**
 * A largura durante o arrasto da divisa: a de quando o arrasto começou mais o quanto o ponteiro andou, na escala do zoom (em 200% o ponteiro anda o dobro
 * para a mesma largura de 100%). Contar a partir do começo, e não somar movimento a movimento, não acumula arredondamento.
 */
export function dragWidth(start: { x: number; width: number }, x: number, zoom: number): number {
  return clampWidth(start.width + (x - start.x) / zoom);
}

/** O passo das setas na divisa, e o das setas com Shift. */
const keyStep = 10;
const bigKeyStep = 50;

export type ResizeKeyAction = { type: "step"; delta: number } | { type: "min" } | { type: "fit" };

/**
 * As teclas da divisa com o foco nela (o padrão da divisória entre o editor e o resultado, RN-PAINEL-001, na horizontal): as setas esquerda e direita
 * estreitam e alargam, com Shift em passos maiores; Home vai à largura mínima; Enter ajusta ao conteúdo, que é o duplo clique de quem usa o teclado. `null`
 * para qualquer outra tecla, que segue o caminho dela.
 */
export function resizeKeyAction(key: string, shiftKey: boolean): ResizeKeyAction | null {
  const step = shiftKey ? bigKeyStep : keyStep;
  switch (key) {
    case "ArrowRight":
      return { type: "step", delta: step };
    case "ArrowLeft":
      return { type: "step", delta: -step };
    case "Home":
      return { type: "min" };
    case "Enter":
      return { type: "fit" };
    default:
      return null;
  }
}

/**
 * As larguras que a pessoa escolheu, por posição da coluna, a 100% de zoom. Valem só para as colunas de `key` (`columnsKey`): executar de novo com as
 * mesmas colunas, filtrar, ordenar e carregar mais as mantêm, e outras colunas voltam ao padrão (RN-GRADE-009). A coluna que não está em `widths` tem a
 * largura de saída.
 */
export type ColumnSizing = { key: string; widths: Readonly<Record<number, number>> };

/** Nenhuma largura escolhida. */
export const noSizing: ColumnSizing = Object.freeze({ key: "", widths: Object.freeze({}) });

/** A chave de uma lista de colunas: o nome e o tipo de cada uma, na ordem, em JSON (um nome com vírgula ou aspas não faz duas listas colidirem). */
export function columnsKey(columns: readonly QueryColumn[]): string {
  return JSON.stringify(columns.map((column) => [column.name, column.type]));
}

/** As larguras escolhidas para estas colunas: as mesmas (o mesmo objeto) se as colunas são as delas; senão, nenhuma, já com a chave destas. */
export function sizingFor(sizing: ColumnSizing, columns: readonly QueryColumn[]): ColumnSizing {
  const key = columnsKey(columns);
  return sizing.key === key ? sizing : { key, widths: {} };
}

/** A largura escolhida para uma coluna, entre os limites. Devolve o mesmo objeto quando nada muda, para a grade não se redesenhar à toa. */
export function withWidth(sizing: ColumnSizing, index: number, width: number): ColumnSizing {
  const clamped = clampWidth(width);
  return sizing.widths[index] === clamped ? sizing : { key: sizing.key, widths: { ...sizing.widths, [index]: clamped } };
}
