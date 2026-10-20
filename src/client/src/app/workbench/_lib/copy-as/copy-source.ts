import type { Engine } from "@/components/ui/engine-tag";

import type { TargetAnswer } from "../generate-sql/generate-sql-flow";
import type { SelectionSlice } from "../grid-selection";
import type { SqlTarget } from "../record-edits.schema";
import { resultSourceName, type CopyColumn, type CopyScope, type CopySource } from "./copy-as";

/**
 * A origem do "Copiar como" e do "Copiar avançado…" montada da seleção da grade (RN-GRADE-016, seção 37), sem React: o recorte da seleção
 * (`SelectionSlice`, de `grid-selection.ts`) vira a `CopySource` que os escritores recebem, com o que a origem diz além das linhas (o banco, o nome da
 * origem, a tabela de destino e as colunas que o banco calcula). Quem liga à grade é `use-copy-as.ts`.
 */

/** O que a cópia sabe da origem além das linhas: o banco, o nome da origem, a tabela de destino quando se sabe, e quem preenche cada coluna da grade. */
export type CopyOrigin = {
  engine: Engine;
  sourceName: string;
  table: { schema: string; name: string } | null;
  /** O `generated` do alvo para a coluna da grade (a posição no resultado); nulo quando ele não a diz da tabela de destino. */
  generated: (column: number) => CopyColumn["generated"];
};

/**
 * RN-GRADE-020: a tabela única do alvo do "Gerar SQL" e do "Copiar como": o `tables` com um item só, que não é `elsewhere`, qualquer que seja o `kind` e o
 * `editable` dele (a visão e a conexão somente leitura contam), e não o `rowOperations`. Nula numa junção e na aba guardada cuja tabela é outra agora.
 */
export function singleTableOf(target: SqlTarget): SqlTarget["tables"][number] | null {
  return target.tables.length === 1 && target.tables[0].kind !== "elsewhere" ? target.tables[0] : null;
}

const generationOf = (generated: string | null | undefined): CopyColumn["generated"] => (generated === "always" || generated === "byDefault" ? generated : null);

/**
 * O que a cópia sabe da origem (RN-GRADE-016): o nome da origem é o da tabela nos Registros (sem o esquema, RN-EXPORT-006) e `resultado` no resultado de um
 * comando; a tabela de destino do SQL e do DbUnit é a dos Registros, ou a do alvo de uma tabela só (`singleTableOf`); e as colunas que o banco calcula são as
 * que esse alvo diz da tabela (`table` 0). Sem o alvo, ou com a resposta que não o traz (o resultado só leitura por outro motivo, a falha), não se sabe quem
 * preenche cada coluna, e a tabela do resultado fica nula.
 */
export function copyOriginOf(engine: Engine, records: { schema: string; name: string } | null, answer: TargetAnswer | null): CopyOrigin {
  const target = answer?.kind === "target" ? answer.target : null;
  const single = target === null ? null : singleTableOf(target);
  const table = records ?? (single === null ? null : { schema: single.schema, name: single.name });
  return {
    engine,
    sourceName: records?.name ?? resultSourceName,
    table,
    generated: (column) => {
      const origin = single === null ? undefined : target?.columns[column];
      return origin?.table === 0 ? generationOf(origin.generated) : null;
    },
  };
}

/** As posições dentro do recorte agrupadas por linha: as células cortadas e as "gerado pelo banco" de cada uma. */
function byRow(cells: readonly (readonly [number, number])[]): Map<number, number[]> {
  const rows = new Map<number, number[]>();
  for (const [row, column] of cells) {
    const list = rows.get(row);
    if (list === undefined) rows.set(row, [column]);
    else list.push(column);
  }
  return rows;
}

/**
 * A origem de uma cópia, do recorte da seleção (RN-GRADE-016): as colunas da grade com o nome, os tipos e o `generated` do alvo; e as linhas na ordem da
 * grade, com os valores que ela mostra (a pendência, o lido na linha marcada para exclusão, o preenchido na linha nova), o número da grade (`null` na linha
 * nova ainda não salva, que não tem número), as células ainda cortadas e as "gerado pelo banco", que o recorte já traz nulas.
 */
export function copySourceOf(slice: SelectionSlice, origin: CopyOrigin): CopySource {
  const cut = byRow(slice.truncated);
  const generated = byRow(slice.generated);
  const added = new Set(slice.newRows);
  return {
    engine: origin.engine,
    sourceName: origin.sourceName,
    table: origin.table,
    columns: slice.columns.map((column, at) => ({ name: column.name, type: column.type, kind: column.kind, generated: origin.generated(slice.columnIndexes[at]) })),
    rows: slice.rows.map((values, index) => ({ values, number: added.has(index) ? null : (slice.rowNumbers[index] ?? index + 1), cut: cut.get(index) ?? [], generated: generated.get(index) ?? [] })),
  };
}

/** As três origens do "O que copiar" do "Copiar avançado…" (RN-GRADE-003), cada uma do seu recorte. */
export function copySourcesOf(slices: Record<CopyScope, SelectionSlice>, origin: CopyOrigin): Record<CopyScope, CopySource> {
  return { cells: copySourceOf(slices.cells, origin), rows: copySourceOf(slices.rows, origin), loaded: copySourceOf(slices.loaded, origin) };
}
