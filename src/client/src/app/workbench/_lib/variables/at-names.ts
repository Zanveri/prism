import type { Engine } from "@/components/ui/engine-tag";

import { statementHasBody, visitCode } from "../sql-statements";

/*
 * O `@nome` no SQL (RN-VAR-015 e 016). Quem acha é o leitor do SQL da tela, no banco da aba: o `@` dentro de texto entre aspas simples (também o `E'...'`), de nome
 * entre aspas duplas, de comentário e de `$tag$ ... $tag$` nunca é variável. Fora deles, é variável o `@` seguido, sem espaço, de um nome declarado no script,
 * quando o caractere de antes e o de depois deixam (os operadores do PostgreSQL com `@` continuam sendo SQL).
 */

/** Uma variável achada: `start` é a posição do `@` e `end` a do fim do nome. `field` é o `.campo` colado ao nome (`@p.campo`, RN-VAR-016). */
export type AtReference = { name: string; start: number; end: number; field: { name: string; start: number; end: number } | null };

/** Um `@nome` que está onde seria variável e não é: não declarado, ou declarado com outras maiúsculas (a dica do editor, RN-VAR-025). */
export type AtHint = { kind: "undeclared" | "differentCase" | "operator"; name: string; start: number; end: number; suggestion?: string };

export type AtScan = {
  references: AtReference[];
  hints: AtHint[];
  /** O comando tem um corpo (rotina, gatilho, bloco composto): o `@nome` dali vai como está (RN-VAR-015). */
  inBody: boolean;
};

const nameAt = /^[\p{ID_Start}_$][\p{ID_Continue}$]*/u;

const isWhitespace = /^\s$/u;
const nameCharacter = /^[\p{L}\p{N}\p{M}_$#@]$/u;

/** O caractere (ponto de código) que termina em `position - 1`, ou nulo no começo do texto. */
function characterBefore(sql: string, position: number): string | null {
  if (position === 0) return null;
  const low = sql.charCodeAt(position - 1);
  if (low >= 0xdc00 && low <= 0xdfff && position >= 2) return sql.slice(position - 2, position);
  return sql[position - 1];
}

/** Se o caractere antes do `@` deixa ele ser variável (RN-VAR-015): o começo do comando, um espaço, ou um dos operadores da lista; no Db2 e no Informix, qualquer um que não seja de nome nem aspa. */
export function allowedBefore(sql: string, position: number, engine: Engine | undefined): boolean {
  const before = characterBefore(sql, position);
  if (before === null || isWhitespace.test(before)) return true;
  if ("([,;:=>+-*/%".includes(before)) return true;
  // No PostgreSQL só o segundo `|` de um `||` deixa o `@` ser variável: o `|` sozinho é de um operador (`|@`).
  if (engine === 1 || engine === undefined) return before === "|" && sql[position - 2] === "|";
  return !nameCharacter.test(before) && before !== "'" && before !== '"';
}

/**
 * Os `@nome` do comando que são variáveis. `declared` são os nomes declarados no script (normalizados em NFC): só eles viram variável; os outros ficam como SQL e
 * viram dica. Dentro do corpo de uma rotina, de um gatilho ou de um bloco composto nada é variável.
 */
export function findAtReferences(sql: string, engine: Engine | undefined, declared: ReadonlySet<string> | ReadonlyMap<string, unknown>): AtScan {
  const references: AtReference[] = [];
  const hints: AtHint[] = [];

  if (!sql.includes("@")) return { references, hints, inBody: false };
  if (statementHasBody(sql, engine)) return { references, hints, inBody: true };

  const lowerCase = new Map<string, string>();
  for (const name of declared instanceof Map ? declared.keys() : declared) lowerCase.set(name.toLowerCase(), name);

  visitCode(sql, engine, (position, code) => {
    if (code !== 64) return;

    const match = nameAt.exec(sql.slice(position + 1, position + 1 + 200));
    if (match === null) return;
    const name = match[0].normalize("NFC");
    const end = position + 1 + match[0].length;

    // O caractere de depois: `#` e `@` ainda são de nome para o banco (`@x#`, `@x@y`). Letras, dígitos, `_` e `$` já entraram no nome.
    const after = sql[end];
    if (after === "#" || after === "@") return;

    if (!allowedBefore(sql, position, engine)) {
      if (declared.has(name)) hints.push({ kind: "operator", name, start: position, end });
      return;
    }

    if (!declared.has(name)) {
      const suggestion = lowerCase.get(name.toLowerCase());
      hints.push(suggestion === undefined ? { kind: "undeclared", name, start: position, end } : { kind: "differentCase", name, start: position, end, suggestion });
      return;
    }

    let field: AtReference["field"] = null;
    if (sql[end] === ".") {
      const fieldMatch = nameAt.exec(sql.slice(end + 1, end + 1 + 200));
      if (fieldMatch !== null) field = { name: fieldMatch[0].normalize("NFC"), start: end + 1, end: end + 1 + fieldMatch[0].length };
    }
    references.push({ name, start: position, end, field });
  });
  return { references, hints, inBody: false };
}
