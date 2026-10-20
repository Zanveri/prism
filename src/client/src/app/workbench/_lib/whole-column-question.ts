import type { WholeColumnQuestion } from "./command-confirmation";
import { multiEditCopy } from "./multi-edit.copy";
import type { EditPreview } from "./record-edits.schema";

const copy = multiEditCopy.question;

/** O que a pergunta da coluna inteira precisa saber do "Salvar" que ela confirma (RN-EDIT-019). */
export type WholeColumnFacts = {
  /** As colunas da coluna inteira, pelo nome no resultado, e as atribuições como a faixa as escreve ("preco = 10.00"). */
  columns: readonly string[];
  assignments: readonly string[];
  /** As linhas que a contagem deu. */
  rows: number;
  /** A tabela como a faixa a escreve: `esquema.tabela`. */
  table: string;
  /**
   * As linhas do resultado lido até o fim (as lidas), sem as linhas novas; nulo com linhas ainda a ler, também quando o "Contar total" já contou: a grade não
   * tem aquelas linhas, e a comparação seria com o que o comando devolvia, e não com o que a grade tem (RN-EDIT-019).
   */
  total: number | null;
  /** As linhas lidas que a grade tem. */
  loaded: number;
  /** A aba guardada do script que não é a do último comando (RN-SQL-023): o banco executa o comando dela depois dos que vieram depois. */
  kept: boolean;
  /** O comando limita as linhas, com `ORDER BY` (sem ele, a coluna inteira nem vale): a ordem pode ter empates. */
  limited: boolean;
  /** As outras alterações não salvas que o mesmo "Salvar" grava. */
  others: number;
  /** Os Registros de uma tabela, que leem de novo, ou o resultado de um comando, que executa de novo. */
  subject: "table" | "result";
  /** RN-EDIT-012: o banco sem log de transação. */
  oneAtATime: boolean;
  /** Os comandos do "Salvar" como o `queries/edits/preview` os devolve: a contagem e o `UPDATE` da coluna inteira vêm primeiro. */
  preview: EditPreview;
};

/**
 * RN-EDIT-019: os textos da pergunta do "Salvar" com a coluna inteira, de cima para baixo: o título ("Alterar preco em 1.234 linhas de estoque.pedido?", e
 * com zero linhas "Nenhuma linha de estoque.pedido será alterada"); a primeira frase, com uma linha por coluna; as linhas de atenção, na ordem da regra (o
 * resultado mudou desde que foi lido, a aba guardada do script, o limite com ordem, e sempre os gatilhos); as outras pendências; o que vem depois do
 * "Salvar"; o aviso do banco sem log; o `UPDATE` da coluna inteira, com a nota dele (o segundo comando do preview: o primeiro é a contagem); e o botão.
 */
export function wholeColumnQuestion(facts: WholeColumnFacts): WholeColumnQuestion {
  const { rows, total, loaded } = facts;
  const warnings: string[] = [];
  if (total !== null && rows !== total) warnings.push(copy.changed(total, rows));
  else if (rows < loaded) warnings.push(copy.changed(loaded, rows));
  if (facts.kept) warnings.push(copy.kept);
  if (facts.limited) warnings.push(copy.ties);
  warnings.push(copy.triggers);

  const update = facts.preview.statements[1] ?? null;
  return {
    kind: "wholeColumn",
    title: rows === 0 ? copy.none(facts.table) : copy.title(facts.columns, rows, facts.table),
    lead: rows === 0 ? copy.noRows : copy.goesTo,
    assignments: facts.assignments,
    warnings,
    others: facts.others === 0 ? null : copy.others(facts.others),
    after: facts.kept ? copy.after.kept : facts.subject === "table" ? copy.after.table : copy.after.result,
    oneAtATime: facts.oneAtATime ? copy.oneAtATime : null,
    command: update === null ? null : { sql: update.sql, note: update.note ?? null },
    confirm: copy.confirm(rows),
    rows,
  };
}
