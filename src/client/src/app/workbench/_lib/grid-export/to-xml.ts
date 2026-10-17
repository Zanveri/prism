import { emptyCounts, type DocumentContext, type DocumentWriter } from "./document";
import { escapeXmlAttribute, escapeXmlText, isXmlChar, stripUnaccepted } from "./text-escape";
import { jsonKeys } from "./to-json";
import { upperInvariant, xmlName } from "./xml-name";

/** O elemento de cada linha do XML, o do DBeaver. */
const record = "DATA_RECORD";

const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';

/**
 * RN-EXPORT-012, XML: o formato do DBeaver, o `XmlExportWriter` da API (no lugar do `<result><row><column name="…">` que esta biblioteca escrevia). A
 * declaração, a raiz com o nome da origem, um `DATA_RECORD` por linha e, dentro dele, um elemento por coluna, com o nome dela, na ordem (o nome repetido
 * aparece repetido). Os nomes passam pela regra do .NET (`xmlName`), e a volta é exata. O nulo e o texto vazio são o elemento vazio (`<cliente/>`), como no
 * DBeaver; o texto escapa `&`, `<`, `>` e o retorno de carro, e o que o XML 1.0 não aceita é tirado e contado. Recuo de 2 espaços e LF, com a quebra de
 * linha no fim. Sem linhas, a raiz vazia (`<pedido/>`). Com "Declaração DOCTYPE", o `<!DOCTYPE>` do DBeaver vem antes da raiz, cada nome declarado uma vez.
 */
export function xmlWriter({ columns, sourceName, options }: DocumentContext): DocumentWriter {
  const counts = emptyCounts();
  const root = xmlName(sourceName);
  const names = columns.map((column) => xmlName(column.name));
  let rows = 0;

  /** O `DOCTYPE` do DBeaver: a raiz tem `DATA_RECORD`s, o `DATA_RECORD` tem cada coluna (opcional, na ordem), e cada coluna tem texto. */
  const doctype = () => {
    // Um nome que já foi declarado (a coluna repetida, ou a que se chama como a raiz ou `DATA_RECORD`) não é declarado de novo.
    const declared = new Set([root, record]);
    let elements = "";
    for (const name of names) {
      if (declared.has(name)) continue;
      declared.add(name);
      elements += `  <!ELEMENT ${name} (#PCDATA)>\n`;
    }
    return `<!DOCTYPE ${root} [\n  <!ELEMENT ${root} (${record}*)>\n  <!ELEMENT ${record} (${names.map((name) => `${name}?`).join(",")})+>\n${elements}]>\n`;
  };

  return {
    counts,
    begin: () => `${declaration}${options.xml.doctype ? doctype() : ""}`,
    write: (row) => {
      const head = rows++ === 0 ? `<${root}>\n` : "";
      const cells = row.values.map((value, index) => {
        let text = "";
        if (value !== null) {
          const clean = stripUnaccepted(value, isXmlChar);
          counts.removedCharacters += clean.removed;
          text = escapeXmlText(clean.text);
        }
        return text === "" ? `    <${names[index]}/>\n` : `    <${names[index]}>${text}</${names[index]}>\n`;
      });
      return `${head}  <${record}>\n${cells.join("")}  </${record}>\n`;
    },
    end: () => (rows === 0 ? `<${root}/>\n` : `</${root}>\n`),
  };
}

/** O texto que o `ReplacementDataSet` do DbUnit troca de volta por nulo. */
const nullMark = "[NULL]";

/**
 * RN-EXPORT-012, DbUnit: o `<dataset>` do DbUnit, o `DbUnitExportWriter` da API, com um elemento vazio por linha, de nome igual ao da tabela ("Tabela", já
 * resolvida por quem monta o documento), e um atributo por coluna. Com "Nomes em maiúsculas", o da tabela e os das colunas vão em maiúsculas sem cultura
 * (`upperInvariant`, o `ToUpperInvariant` da API) ANTES da regra do nome do XML, para o `_x0020_` não virar `_X0020_`; o atributo repetido ganha `_2`,
 * `_3`…, como a chave do JSON. O nulo omite o atributo, ou, com "Escrever [NULL]", é `[NULL]`. O valor escapa o do texto, a aspa, a tabulação e a quebra
 * de linha, e o que o XML 1.0 não aceita é tirado e contado. Recuo de 4 espaços e LF, com a quebra no fim; sem linhas, `<dataset/>`.
 */
export function dbUnitWriter({ columns, options }: DocumentContext): DocumentWriter {
  const o = options.dbUnit;
  const counts = emptyCounts();
  const cased = (name: string) => (o.upperCase ? upperInvariant(name) : name);
  const element = xmlName(cased(o.table));
  const attributes = jsonKeys(columns.map((column) => xmlName(cased(column.name))));
  let rows = 0;

  return {
    counts,
    begin: () => declaration,
    write: (row) => {
      const head = rows++ === 0 ? "<dataset>\n" : "";
      let line = `    <${element}`;
      row.values.forEach((value, index) => {
        if (value === null && o.nulls === "omit") return;
        let text = nullMark;
        if (value !== null) {
          const clean = stripUnaccepted(value, isXmlChar);
          counts.removedCharacters += clean.removed;
          text = escapeXmlAttribute(clean.text);
        }
        line += ` ${attributes[index]}="${text}"`;
      });
      return `${head}${line}/>\n`;
    },
    end: () => (rows === 0 ? "<dataset/>\n" : "</dataset>\n"),
  };
}
