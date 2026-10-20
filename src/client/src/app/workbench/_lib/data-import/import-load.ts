import type { Engine } from "@/components/ui";

import { formatCount } from "../data-export/data-export.copy";
import { dataImportCopy, listOf } from "./data-import.copy";
import { commitEveryOf, type CommitChoices } from "./import-choices";
import type { ImportTable } from "./imports.schema";

/**
 * A etapa Carga sem React (RN-IMPORT-012 e 025), a mesma da importação e da cópia: as frases das chaves que apontam para a tabela, o que o "Commit" diz, a
 * recusa do N e a linha "Carga" da Confirmação.
 */

const l = dataImportCopy.load;

/** Até cinco tabelas por grupo; com mais, as cinco primeiras e "(e mais 3)". A tabela de outro esquema leva o esquema. */
export function tablesText(tables: readonly { schema: string; table: string }[], targetSchema: string): string {
  const names = tables.map((table) => (table.schema === targetSchema ? table.table : `${table.schema}.${table.table}`));
  if (names.length <= 5) return listOf(names);
  return `${names.slice(0, 5).join(", ")} ${l.andMore(names.length - 5)}`;
}

/**
 * O que o `DELETE` do esvaziamento faz nas tabelas que apontam para esta (RN-IMPORT-012), agrupado pela regra de exclusão de cada chave, no tom de atenção:
 * a cascata, o nulo ou o padrão, e as que impedem. A própria tabela (a chave que aponta para ela mesma) fica de fora; a mesma tabela por duas chaves de mesma
 * regra entra uma vez.
 */
export function referenceWarnings(table: Pick<ImportTable, "schema" | "name" | "referencedBy" | "oneAtATime">, copy: boolean): string[] {
  const others = table.referencedBy.filter((reference) => !(reference.schema === table.schema && reference.table === table.name));
  const group = (rules: readonly string[]) => {
    const seen = new Set<string>();
    return others.filter((reference) => {
      const key = JSON.stringify([reference.schema, reference.table]);
      if (!rules.includes(reference.onDelete) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const warnings: string[] = [];
  const cascade = group(["cascade"]);
  if (cascade.length > 0) warnings.push(l.cascade(tablesText(cascade, table.schema)));
  const setNull = group(["setNull", "setDefault"]);
  if (setNull.length > 0) {
    const rules = new Set(others.filter((reference) => reference.onDelete === "setNull" || reference.onDelete === "setDefault").map((reference) => reference.onDelete));
    warnings.push(l.setNull(tablesText(setNull, table.schema), table.name, rules.size === 2 ? "both" : rules.has("setNull") ? "null" : "default"));
  }
  const restrict = group(["restrict", "noAction"]);
  if (restrict.length > 0) warnings.push(`${l.restrict(tablesText(restrict, table.schema), table.name, copy)}${table.oneAtATime ? ` ${l.restrictNoLog}` : ""}`);
  return warnings;
}

/** A recusa do N do "A cada N linhas" (RN-IMPORT-012); nenhuma em "Tudo numa transação só" e no Informix sem log, em que a escolha não vale. */
export function commitProblem(choices: CommitChoices, oneAtATime: boolean): string | null {
  if (oneAtATime || choices.commit === "single") return null;
  return commitEveryOf(choices.commitEvery) === null ? dataImportCopy.problems.commitEvery : null;
}

/** O N escrito com o ponto de milhar ("10.000"), ou como foi digitado, quando não é um número que vale. */
export const commitEveryText = (text: string) => {
  const value = commitEveryOf(text);
  return value === null ? text.trim() : formatCount(value);
};

/**
 * Os avisos da etapa Carga, no tom de atenção, na ordem da etapa: com "Esvaziar", o que ele apaga, o das chaves que apontam para a tabela e, com "A cada N
 * linhas", o do esvaziamento confirmado com as primeiras; no Informix sem log, o de cada linha gravada sozinha.
 */
export function loadWarnings(
  table: Pick<ImportTable, "schema" | "name" | "referencedBy" | "oneAtATime">,
  { empty, commit }: { empty: boolean; commit: CommitChoices },
  copy: boolean,
): string[] {
  const warnings: string[] = [];
  if (empty) {
    warnings.push(l.emptyWarning(table.schema, table.name, copy));
    warnings.push(...referenceWarnings(table, copy));
    if (!table.oneAtATime && commit.commit === "every") warnings.push(l.emptyEvery(commitEveryText(commit.commitEvery), copy));
  }
  if (table.oneAtATime) warnings.push(l.noLog(copy));
  return warnings;
}

/** A nota do Informix (com log ou sem): cada linha vai num comando (RN-IMPORT-015). */
export const informixNote = (engine: Engine | undefined): string | null => (engine === 3 ? l.informix : null);

/**
 * A linha "Carga" da Confirmação (RN-IMPORT-013): "Esvazia a tabela antes · confere o arquivo antes · commit a cada 10.000 linhas", com cada parte só quando
 * vale; sem a conferência, "sem conferir o arquivo antes" no lugar da segunda (só na importação: a cópia não tem a conferência).
 */
export function loadSummary({ empty, commit, check }: { empty: boolean; commit: CommitChoices; check: boolean | null }, oneAtATime: boolean): string {
  const c = dataImportCopy.confirmation;
  const parts: string[] = [];
  if (empty) parts.push(c.empties);
  if (check !== null) parts.push(check ? c.checks : c.noCheck);
  parts.push(oneAtATime ? c.oneAtATime : commit.commit === "single" ? c.single : c.commitEvery(commitEveryText(commit.commitEvery)));
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** O `commitEvery` do pedido: nulo em "Tudo numa transação só"; no Informix sem log a API o ignora, e vai o que a escolha diz. */
export function commitEveryOfChoices(choices: CommitChoices): number | null {
  return choices.commit === "single" ? null : (commitEveryOf(choices.commitEvery) ?? 10_000);
}
