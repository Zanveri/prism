import type { Engine } from "@/components/ui/engine-tag";

import { integerIn } from "../data-export/export-options";
import { quoteIdentifier } from "../table-sql";
import { emptyCounts, type DocumentContext, type DocumentWriter } from "./document";
import { documentCopy } from "./document.copy";
import { scriptLiteral } from "./script-literal";

/** RN-EXPORT-011: o maior pedaço de uma constante hexadecimal do Db2, 32.672 dígitos (16.336 bytes). */
export const db2HexPieceDigits = 32_672;

/**
 * RN-EXPORT-011: o literal do binário (o `ExportText.BinaryLiteral` da API, conferido pela fixture `sql-binary.json`), dos dígitos hexadecimais do valor.
 * No PostgreSQL, `decode('DEADBEEF', 'hex')`, que vale qualquer que seja o `standard_conforming_strings`. No Db2, pelo tipo da coluna: `BINARY` e
 * `VARBINARY` com a constante binária, `BX'DEADBEEF'`; `BLOB` com `BLOB(X'…')`; o texto binário (`CHAR () FOR BIT DATA`, `VARCHAR () FOR BIT DATA`) e o
 * resto com a hexadecimal, `X'DEADBEEF'`, que é um texto e que o Db2 recusa numa coluna `BINARY` ou `VARBINARY` (SQL0408N). Em pedaços de até 16.336 bytes
 * unidos por `||`. No Informix não há: `null`, e a linha vira comentário.
 *
 * @param type O tipo da coluna como o banco o diz (`BLOB`, `BINARY`, `VARBINARY`, `VARCHAR () FOR BIT DATA`…).
 */
export function binaryLiteral(engine: Engine, hex: string, type: string): string | null {
  const digits = hex.toUpperCase();
  if (engine === 1) return `decode('${digits}', 'hex')`;
  if (engine !== 2) return null;

  const name = type.trim().toUpperCase();
  const blob = name === "BLOB";
  const constant = name === "BINARY" || name === "VARBINARY" ? "BX" : "X";
  const pieces: string[] = [];
  let offset = 0;
  do {
    const piece = `${constant}'${digits.slice(offset, offset + db2HexPieceDigits)}'`;
    pieces.push(blob ? `BLOB(${piece})` : piece);
    offset += db2HexPieceDigits;
  } while (offset < digits.length);
  return pieces.join(" || ");
}

/** Os dígitos do binário como a grade o escreve (`0x…`, inteiro: RN-SQL-017), ou `null` quando o texto não é isso. */
const hexOf = (value: string) => (/^0x(?:[0-9A-Fa-f]{2})*$/.test(value) ? value.slice(2) : null);

/** O caractere de controle (abaixo de U+0020, e o DEL) que não é quebra de linha, retorno de carro nem tabulação: o que um script não leva. */
// eslint-disable-next-line no-control-regex
const otherControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const reasons = documentCopy.sql.reasons;

/**
 * RN-EXPORT-011: comandos `INSERT`, o `SqlExportWriter` da API, com os nomes entre aspas duplas, os valores como literais do banco (`scriptLiteral` e
 * `binaryLiteral`) e as palavras-chave em maiúsculas. Com várias linhas por comando, a primeira linha do comando é `INSERT INTO "esquema"."tabela" ("a",
 * "b") VALUES` e cada linha vem na seguinte, com dois espaços de recuo, separadas por vírgula, até o `;`. Com uma linha por comando (sempre, no Informix),
 * cada `INSERT` fica numa linha só. Cada comando termina em `;`, e o texto, em LF; sem linhas, vazio.
 *
 * A linha que não vira `INSERT` não sai: o comando em andamento fecha com `;` antes dela, e no lugar dela vai um comentário de frase fixa, com o número da
 * linha na grade, sem nenhum dado do banco; as seguintes começam outro `INSERT`, e `skippedRows` conta. As frases da API (o binário no Informix, o controle
 * que não vira literal, a data e hora do Informix) e as que só a tela escreve (RN-GRADE-016): a linha nova ainda não salva, sem número; a célula "gerado
 * pelo banco"; e o valor cortado que não veio inteiro. Na linha, a primeira coluna com um desses, da esquerda para a direita, decide a frase.
 */
export function sqlWriter({ engine, columns, options }: DocumentContext): DocumentWriter {
  const o = options.sql;
  const counts = emptyCounts();
  const schema = o.omitSchema ? "" : o.schema;
  const table = schema === "" ? quoteIdentifier(o.table) : `${quoteIdentifier(schema)}.${quoteIdentifier(o.table)}`;
  const insert = `INSERT INTO ${table} (${columns.map((column) => quoteIdentifier(column.name)).join(", ")}) VALUES`;
  // O Informix não aceita várias linhas num `INSERT … VALUES`: a tela já mostra 1 no campo, e o escritor não as junta.
  const perStatement = engine === 3 ? 1 : (integerIn(o.rowsPerStatement, 1, 1000) ?? 10);
  let open = 0;

  /** Fecha o comando de várias linhas em andamento, se há um. */
  const close = () => {
    if (open === 0) return "";
    open = 0;
    return ";\n";
  };

  /** O literal do valor, ou o motivo de não haver. */
  const literalOf = (value: string | null, index: number): { literal: string } | { reason: string } => {
    if (value === null) return { literal: "NULL" };
    const column = columns[index];
    if (column.kind === "binary") {
      if (o.binary === "null") return { literal: "NULL" };
      const hex = hexOf(value);
      if (hex !== null) {
        const literal = binaryLiteral(engine, hex, column.type);
        return literal === null ? { reason: reasons.informixBinary } : { literal };
      }
    }
    const literal = scriptLiteral(engine, value, column.kind);
    if (literal !== null) return { literal };
    return { reason: otherControl.test(value) ? reasons.control : reasons.informixDateTime };
  };

  const skip = (comment: string) => {
    counts.skippedRows++;
    return `${close()}${comment}\n`;
  };

  return {
    counts,
    begin: () => "",
    write: (row) => {
      if (row.number === null) return skip(documentCopy.sql.newRow);

      const generated = row.generated ?? [];
      const cut = row.cut ?? [];
      const literals: string[] = [];
      for (let index = 0; index < row.values.length; index++) {
        if (generated.includes(index)) return skip(`${documentCopy.sql.skipped(row.number)}${reasons.generated}`);
        if (cut.includes(index)) {
          // O binário cortado que o SQL não escreve com o valor dele não precisa vir inteiro, e a tela não o busca (RN-SQL-017): com "NULL" ele é o nulo, e no
          // Informix, que não tem literal para binário, a linha é comentada pelo motivo dele, como seria com o valor inteiro.
          const binary = columns[index].kind === "binary";
          if (binary && engine === 3 && o.binary !== "null") return skip(`${documentCopy.sql.skipped(row.number)}${reasons.informixBinary}`);
          if (!(binary && o.binary === "null")) return skip(`${documentCopy.sql.skipped(row.number)}${reasons.notWhole}`);
        }
        const written = literalOf(row.values[index], index);
        if ("reason" in written) return skip(`${documentCopy.sql.skipped(row.number)}${written.reason}`);
        literals.push(written.literal);
      }

      const values = `(${literals.join(", ")})`;
      if (perStatement === 1) return `${insert} ${values};\n`;

      const text = open === 0 ? `${insert}\n  ${values}` : `,\n  ${values}`;
      return ++open === perStatement ? `${text}${close()}` : text;
    },
    end: close,
  };
}
