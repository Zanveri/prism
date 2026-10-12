import { truncatedIn, type GridSlice } from "./grid-slice";
import { strictNumber } from "./number-text";

/**
 * As chaves do objeto de cada linha: o nome da coluna. O primeiro nome fica como está; um nome que já foi usado ganha `_2`, `_3`… (o primeiro
 * número livre). Uma coluna que já se chama `id_2` não colide com o sufixo: quem chega depois com o nome tomado também ganha um (`id`, `id`, `id_2`,
 * `id` viram `id`, `id_2`, `id_2_2`, `id_3`). As chaves saem sempre distintas.
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
 * gramática (`.5`, `+1`, `1.`, `NaN`, zero à esquerda, espaço) é texto.
 */
function jsonValue(kind: string, value: string | null, cut: boolean): string {
  if (value === null) return "null";
  if (!cut && kind === "number" && strictNumber.test(value)) return value;
  if (!cut && kind === "boolean" && (value === "true" || value === "false")) return value;

  return JSON.stringify(value);
}

/**
 * O recorte como uma lista de objetos, uma chave por coluna (`jsonKeys`), com recuo de 2 espaços (o do `JSON.stringify`). O texto é escrito à mão e
 * não por um objeto do JavaScript: ele poria as chaves numéricas (`"2"`, `"10"`) antes das outras e trataria `__proto__` como protótipo, e as colunas
 * saem na ordem em que estão. `boolean` é `true` ou `false` só quando o texto é exatamente o que a API manda; o nulo é `null`.
 */
export function toJson(slice: GridSlice): string {
  const keys = jsonKeys(slice.columns.map((column) => column.name)).map((key) => JSON.stringify(key));
  const cut = truncatedIn(slice);
  const objects = slice.rows.map((row, rowIndex) => {
    const members = row.map((value, index) => `    ${keys[index]}: ${jsonValue(slice.columns[index].kind, value, cut(rowIndex, index))}`);
    return members.length === 0 ? "  {}" : `  {\n${members.join(",\n")}\n  }`;
  });

  return objects.length === 0 ? "[]" : `[\n${objects.join(",\n")}\n]`;
}
