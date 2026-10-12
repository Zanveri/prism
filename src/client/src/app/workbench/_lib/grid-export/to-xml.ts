import type { GridSlice } from "./grid-slice";
import { escapeXmlAttribute, escapeXmlText, isXmlChar, stripUnaccepted } from "./text-escape";

/**
 * O recorte como XML: `<result>` com um `<row>` por linha e um `<column name="…">` por coluna. O nome da coluna é o valor de um atributo e NUNCA
 * o nome de um elemento (um nome do banco como `a b` ou `1x` não é nome de elemento). O nulo é `null="true"`; o texto vazio é um elemento vazio
 * sem o atributo. Os caracteres que o XML 1.0 não aceita (controle fora da tabulação, da quebra de linha e do retorno de carro, U+FFFE, U+FFFF e o
 * par substituto solto) são TIRADOS, no valor e no nome, e `removed` diz quantos (o nome da coluna conta uma vez, e não por linha).
 */
export function toXml(slice: GridSlice): { text: string; removed: number } {
  let removed = 0;
  const clean = (text: string) => {
    const result = stripUnaccepted(text, isXmlChar);
    removed += result.removed;
    return result.text;
  };

  const names = slice.columns.map((column) => escapeXmlAttribute(clean(column.name)));
  const rows = slice.rows.map((row) => {
    const columns = row.map((value, index) => {
      if (value === null) return `    <column name="${names[index]}" null="true"/>`;

      const text = escapeXmlText(clean(value));
      return text === "" ? `    <column name="${names[index]}"/>` : `    <column name="${names[index]}">${text}</column>`;
    });
    return columns.length === 0 ? "  <row/>" : `  <row>\n${columns.join("\n")}\n  </row>`;
  });

  return { text: `<?xml version="1.0" encoding="UTF-8"?>\n${rows.length === 0 ? "<result/>" : `<result>\n${rows.join("\n")}\n</result>`}\n`, removed };
}
