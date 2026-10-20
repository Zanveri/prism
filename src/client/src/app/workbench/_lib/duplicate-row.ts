import type { EditValue } from "./record-edits";
import type { EditTarget } from "./record-edits.schema";

/**
 * A linha de onde se duplica (RN-EDIT-016). Uma lida, com o valor que a tela mostra em cada coluna (a pendência, quando há; na linha marcada para exclusão,
 * o lido; o nulo, como nulo), as colunas que chegaram cortadas (RN-SQL-011) e, na linha nova já salva da aba de consulta, as que o banco preencheu e a tela
 * não sabe (RN-EDIT-009). Ou uma linha nova pendente (também uma duplicada), com o que foi preenchido nela.
 */
export type DuplicateSource =
  | { kind: "read"; values: readonly EditValue[]; truncated?: ReadonlySet<number>; generated?: ReadonlySet<number> }
  | { kind: "new"; values: Readonly<Record<number, EditValue>> };

/** O que a duplicada leva, pela posição da coluna no resultado. */
export type DuplicatePlan = {
  /** As colunas copiadas, com o valor da tela. A cortada leva o valor cortado até o completo chegar (`cut`). */
  values: Record<number, EditValue>;
  /** As copiadas que chegaram cortadas: o valor completo vem antes da API (RN-SQL-017), ou nada é duplicado. */
  cut: number[];
  /** As colunas da tabela no resultado que não foram copiadas e ficam com o padrão da tabela, na ordem da grade. */
  skipped: number[];
  /** A chave da tabela, quando foi copiada inteira (a faixa avisa, e a célula ativa vai à coluna dela mais à esquerda); senão, nula. */
  key: number[] | null;
};

/**
 * RN-EDIT-016: o que "Duplicar linha" copia da linha de origem, num resultado de uma tabela só (`rowOperations`). Copia o valor que a tela mostra de
 * cada coluna do resultado que se edita na tabela. Não copia, e essas ficam com o padrão da tabela, como na linha em branco: as que o banco gera,
 * "sempre" e "por padrão" (a identidade, o `SERIAL` do Informix, o `serial` do PostgreSQL), para ele gerar o valor da linha nova; as que não se editam
 * (a binária, a de um tipo que o Prism não converte); e, na linha nova já salva, as que o banco preencheu. A coluna calculada no comando não é da
 * tabela: não se copia e não entra na lista. Na linha nova de origem, a coluna que ela não tinha preenchido não entra na lista: já estava com o padrão.
 * A coluna da tabela que o resultado traz mais de uma vez (`SELECT id, id AS copia`) se copia uma vez só, pela primeira que se copia: o `INSERT` não leva a
 * mesma coluna duas vezes (a API o recusa). A repetição não entra na lista, porque a coluna da tabela foi copiada.
 */
export function duplicatePlan(target: EditTarget, source: DuplicateSource): DuplicatePlan {
  const values: Record<number, EditValue> = {};
  const cut: number[] = [];
  const skipped: number[] = [];
  const copied = new Set<string>();

  target.columns.forEach((column, index) => {
    if (column.table !== 0) return;
    if (source.kind === "new" && !(index in source.values)) return;
    const filledByTheDatabase = source.kind === "read" && source.generated?.has(index) === true;
    if (!column.editable || column.generated !== null || filledByTheDatabase) return void skipped.push(index);
    if (column.baseColumn !== null) {
      if (copied.has(column.baseColumn)) return;
      copied.add(column.baseColumn);
    }

    values[index] = source.values[index] ?? null;
    if (source.kind === "read" && source.truncated?.has(index) === true) cut.push(index);
  });

  const key = [...(target.tables[0]?.key ?? [])].sort((left, right) => left - right);
  return { values, cut, skipped, key: key.length > 0 && key.every((column) => column in values) ? key : null };
}
