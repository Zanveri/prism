import { utf16IndexOf } from "../sql-statements";
import type { BoundCommand, Replacement } from "./bind";

/*
 * O mapa das posições (RN-SQL-009): a posição que o banco dá no erro é a do texto enviado, com os marcadores, e a tela a leva ao texto do editor. Fora dos marcadores,
 * pela diferença de tamanho que as trocas de antes deixaram; dentro de um marcador, de uma lista expandida ou do texto de um `sql`, ao começo do `@nome`.
 */

/** A posição no texto do comando (o do editor, com os `@nome`) de uma posição do texto enviado. As duas são unidades UTF-16, de 0 em diante. */
export function originalOffset(replacements: readonly Replacement[], sentOffset: number): number {
  let shift = 0;
  for (const replacement of replacements) {
    if (sentOffset < replacement.sentStart) break;
    if (sentOffset < replacement.sentEnd || (sentOffset === replacement.sentEnd && replacement.sentEnd === replacement.sentStart)) return replacement.start;
    shift += replacement.sentEnd - replacement.sentStart - (replacement.end - replacement.start);
  }
  return sentOffset - shift;
}

/**
 * Onde, no texto do editor, está a posição que o banco informou no erro. O banco conta em caracteres, de 1 em diante, no texto enviado; `statementStart` é onde o
 * comando começa no editor. O resultado é uma posição do editor (unidades UTF-16, de 0 em diante).
 */
export function editorOffset(statementStart: number, command: BoundCommand, databasePosition: number): number {
  return statementStart + originalOffset(command.replacements, utf16IndexOf(command.sql, databasePosition));
}
