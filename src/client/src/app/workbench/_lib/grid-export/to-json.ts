import { emptyCounts, type DocumentContext, type DocumentWriter } from "./document";
import { strictNumber } from "./number-text";

/**
 * As chaves do objeto de cada linha: o nome da coluna. O primeiro nome fica como está; um nome que já foi usado ganha `_2`, `_3`… (o primeiro
 * número livre). Uma coluna que já se chama `id_2` não colide com o sufixo: quem chega depois com o nome tomado também ganha um (`id`, `id`, `id_2`,
 * `id` viram `id`, `id_2`, `id_2_2`, `id_3`). As chaves saem sempre distintas. É também a regra do atributo repetido do DbUnit (RN-EXPORT-012).
 */
export function jsonKeys(names: readonly string[]): string[] {
  const used = new Set<string>();

  return names.map((name) => {
    let key = name;
    for (let suffix = 2; used.has(key); suffix++) key = `${name}_${suffix}`;
    used.add(key);
    return key;
  });
}

/**
 * Uma célula como valor do JSON. Célula cortada (RN-SQL-011) nunca vira número nem booleano, ainda que o texto pareça. Numa coluna `number`, o texto que
 * é um número na gramática do JSON (`strictNumber`) vai para o arquivo COMO ESTÁ, dígito por dígito, sem passar por `Number` nem por `JSON.stringify`
 * (`12.50` fica `12.50`, um decimal de 30 dígitos fica com os 30, `-0` fica `-0`): perder precisão, se perder, é de quem lê. O que não casa com a
 * gramática (`.5`, `+1`, `1.`, `NaN`, zero à esquerda, espaço) é texto. É a regra da exportação da API também (RN-EXPORT-010): a fixture de ouro
 * `json-value.json` confere os dois lados (RN-EXPORT-024).
 */
export function jsonValue(kind: string, value: string | null, cut: boolean): string {
  if (value === null) return "null";
  if (isBareJsonValue(kind, value, cut)) return value;

  return JSON.stringify(value);
}

/** O valor que o JSON e o Código fonte escrevem sem aspas (o `IsBareJsonValue` da API): o número na gramática do JSON numa coluna de número e o lógico numa lógica, nunca o cortado. */
export function isBareJsonValue(kind: string, value: string, cut: boolean): boolean {
  return !cut && ((kind === "number" && strictNumber.test(value)) || (kind === "boolean" && (value === "true" || value === "false")));
}

/** A data e hora no formato da grade (`aaaa-mm-dd hh:mm:ss[.f…]`, com ou sem o fuso `±hh` ou `±hh:mm`), em partes. */
const gridDateTime = /^([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)([+-][0-9]{2}(?::[0-9]{2})?)?$/;

/**
 * RN-EXPORT-010, "Datas em ISO 8601" (o `ExportText.IsoDateTime` da API, conferido pela fixture `iso-datetime.json`): a data e hora da grade ganha o `T` no
 * lugar do espaço, e o fuso `±hh` vira `±hh:00`. A data sem hora, a hora sem data e o texto em outro formato saem como estão.
 */
export function isoDateTime(text: string): string {
  const match = gridDateTime.exec(text);
  if (match === null) return text;

  const [, date, time, zone = ""] = match;
  return `${date}T${time}${zone.length === 3 ? `${zone}:00` : zone}`;
}

/**
 * RN-EXPORT-010: a lista de objetos, o `JsonExportWriter` da API: um objeto por linha, uma chave por coluna (`jsonKeys`), na ordem do resultado. O texto é
 * escrito à mão, e não por um objeto do JavaScript: ele poria as chaves numéricas (`"2"`, `"10"`) antes das outras e trataria `__proto__` como protótipo.
 * Recuo de 2 espaços e LF, com uma quebra de linha no fim. Com "Pôr o nome da origem", a lista vai um nível para dentro, como o valor da chave com o nome
 * da origem: `{ "pedido": [ … ] }`. Sem linhas, `[]` (ou `{ "pedido": [] }`). Com "Datas em ISO 8601", a data e hora da coluna de data ganha o `T`.
 */
export function jsonWriter({ columns, sourceName, options }: DocumentContext): DocumentWriter {
  const o = options.json;
  const keys = jsonKeys(columns.map((column) => column.name)).map((key) => JSON.stringify(key));
  const indent = o.wrap ? "    " : "  ";
  let rows = 0;

  return {
    counts: emptyCounts(),
    begin: () => (o.wrap ? `{\n  ${JSON.stringify(sourceName)}: [` : "["),
    write: (row) => {
      const cut = row.cut ?? [];
      const members = row.values.map((value, index) => {
        const kind = columns[index].kind;
        const shown = value !== null && o.isoDates && kind === "datetime" ? isoDateTime(value) : value;
        return `${indent}  ${keys[index]}: ${jsonValue(kind, shown, cut.includes(index))}${index < row.values.length - 1 ? ",\n" : "\n"}`;
      });
      return `${rows++ === 0 ? "\n" : ",\n"}${indent}{\n${members.join("")}${indent}}`;
    },
    end: () => `${rows === 0 ? "]" : o.wrap ? "\n  ]" : "\n]"}${o.wrap ? "\n}\n" : "\n"}`,
  };
}
