/**
 * O erro da linguagem das variáveis (RN-VAR-012 e 014): a frase e onde, no texto, ele está. É o único erro que o leitor, o conferidor e o avaliador lançam de
 * propósito; qualquer outra exceção que escape deles é um defeito, e a fronteira (`boundary.ts`) a converte em "Erro interno do Prism ao avaliar <nome>.".
 * Não estende `Error` de propósito: o leitor lança muito (um por texto errado, na digitação), e a pilha de cada um custaria mais que a conta.
 */
export class VariableError {
  readonly message: string;
  /** A posição, em unidades UTF-16, no texto que foi lido (o script inteiro). */
  readonly offset: number;

  constructor(message: string, offset: number) {
    this.message = message;
    this.offset = offset;
  }
}

/** Um erro com a linha e a coluna, de 1 em diante (a coluna em unidades UTF-16): o que a lista "Erros nas variáveis" e o editor mostram (RN-VAR-012). */
export type Diagnostic = { message: string; offset: number; line: number; column: number };

/** A linha e a coluna (de 1 em diante) de `offset` em `source`. Uma posição depois do fim do texto vale o fim. */
export function locate(source: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  for (let index = source.indexOf("\n"); index >= 0 && index < at; index = source.indexOf("\n", index + 1)) {
    line++;
    lineStart = index + 1;
  }
  return { line, column: at - lineStart + 1 };
}

/** O erro de `VariableError` com a linha e a coluna dele em `source`. */
export const diagnosticOf = (source: string, error: VariableError): Diagnostic => ({ message: error.message, offset: error.offset, ...locate(source, error.offset) });

/** O localizador de linhas de um texto: acha a linha e a coluna de várias posições sem reler o texto de cada vez. */
export function makeLocator(source: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1)) starts.push(index + 1);

  return (offset) => {
    const at = Math.max(0, Math.min(offset, source.length));
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= at) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: at - starts[low] + 1 };
  };
}
