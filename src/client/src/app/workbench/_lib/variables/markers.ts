import type { Engine } from "@/components/ui/engine-tag";

import { visitCode } from "../sql-statements";

/*
 * Os marcadores de parâmetro que já estão no texto do comando (RN-VAR-017 e 032): `$n` no PostgreSQL e `?` no Db2 e no Informix, fora de texto, de comentário, de
 * nome entre aspas e de `$tag$`. No PostgreSQL o `?` não é marcador (é o operador do `jsonb`). A tela conta com o mesmo leitor do SQL que o resto, e a API conta com
 * o dela (`SqlText`): os dois têm de contar igual, e a fixture `src/test-fixtures/variables/markers.json` confere os dois.
 */

export type MarkerScan = { count: number; /** O número de cada `$n` do PostgreSQL, na ordem do texto. */ numbers: number[]; /** O primeiro marcador como está escrito (`$1`, `?`), ou nulo. */ first: string | null };

const isNameCode = (code: number) => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36 || code > 127;

export function scanMarkers(sql: string, engine: Engine | undefined): MarkerScan {
  const numbers: number[] = [];
  let count = 0;
  let first: string | null = null;
  const postgres = engine === undefined || engine === 1;

  visitCode(sql, engine, (position, code) => {
    if (postgres) {
      // `$1` é um marcador; o `$` no meio de um nome (`a$1`) faz parte dele.
      if (code !== 36 || (position > 0 && isNameCode(sql.charCodeAt(position - 1)))) return;
      let end = position + 1;
      while (end < sql.length && sql.charCodeAt(end) >= 48 && sql.charCodeAt(end) <= 57) end++;
      if (end === position + 1) return;
      count++;
      numbers.push(Number(sql.slice(position + 1, end)));
      first ??= sql.slice(position, end);
    } else if (code === 63) {
      count++;
      first ??= "?";
    }
  });
  return { count, numbers, first };
}
