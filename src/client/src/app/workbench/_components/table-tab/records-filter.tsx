import { useId, type FormEvent } from "react";

import { Button, type Engine } from "@/components/ui";

import type { FilterColumn } from "../../_lib/filter-completion";
import { gridFilterCopy } from "../../_lib/grid-filter.copy";
import { recordsCopy } from "../../_lib/records.copy";
import { canClear } from "../../_lib/table-view";
import { workbenchCopy } from "../../_lib/workbench.copy";
import { FilterField } from "../filter-field";

const text = workbenchCopy.tableTab.records;

type RecordsFilterProps = {
  /** O que está escrito no campo (ainda não aplicado). */
  draft: string;
  onDraft: (text: string) => void;
  /** O filtro em vigor (a condição, a ordem ou as duas): "Limpar" vale com ele ou com texto no campo. */
  applied: string;
  /**
   * O que o filtro tem de errado, se tem: a conferência de um comando só (`severalStatements`, nos Registros), ou a frase com que a API recusou o filtro
   * (`FILTER_INVALID`, no resultado da aba de consulta).
   */
  problem: "severalStatements" | { message: string } | null;
  /** Há algo em andamento na aba: o executor recusaria outro comando, e o botão espera. */
  busy: boolean;
  /** O comando que o último pedido montou: é o que a grade abaixo mostra (RN-TABELA-005). Sem ele (o resultado da aba de consulta), a linha não aparece. */
  command: string | null;
  onApply: () => void;
  onClear: () => void;
  /** O banco da aba: as cores do campo e como o nome de uma coluna sugerida é escrito (RN-TABELA-011). */
  engine: Engine | undefined;
  /** As colunas que o campo sugere: nos Registros, as da tabela; no resultado, as do resultado (RN-TABELA-011). */
  columns: readonly FilterColumn[];
  /** A chave do autocompletar do editor (RN-CONFIG-004): o campo sugere ao digitar só com ela ligada; Ctrl+Espaço sugere sempre. */
  autocomplete: boolean;
  /** De quem é o campo: os Registros de uma tabela, ou o resultado de um comando da aba de consulta (RN-GRADE-011). Muda o nome e a dica. */
  subject?: "table" | "result";
};

/**
 * O filtro dos registros (RN-TABELA-005 e 010, canvas `TabelaDados`), que é também o do resultado da aba de consulta (RN-GRADE-011): o campo recebe o que
 * vem depois do nome da tabela (ou do comando), como o usuário o escreve: uma condição, uma ordem (`ORDER BY ...`) ou as duas. Por isso não há um rótulo
 * `WHERE` fixo na frente dele: com só a ordem no campo ele seria falso; o texto de ajuda do campo vazio e a dica dizem o que cabe ali. "Aplicar filtro" (e
 * Enter) executa o texto, e "Limpar" tira a condição e a ordem de uma vez. A recusa (de mais de um comando, ou a da API) aparece no próprio campo. O campo
 * completa as colunas e as palavras do filtro (RN-TABELA-011, `FilterField`). Embaixo, nos Registros, o comando que a tela executou, uma parte por linha,
 * como foi enviado (o bloco rola se o filtro for comprido); a dica o repete inteiro.
 */
export function RecordsFilter({ draft, onDraft, applied, problem, busy, command, onApply, onClear, engine, columns, autocomplete, subject = "table" }: RecordsFilterProps) {
  const hintId = useId();
  const problemId = useId();
  const field = subject === "table" ? recordsCopy.filter : gridFilterCopy.result;
  const message = problem === null ? null : problem === "severalStatements" ? recordsCopy.filter.severalStatements : problem.message;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onApply();
  }

  return (
    <div className="flex flex-none flex-col gap-1.5 border-b border-border bg-panel px-3 py-2">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <label title={field.hint} className="flex h-8 min-w-60 flex-1 items-center rounded-md border border-border bg-raised px-2.5 has-[.cm-focused]:outline-2 has-[.cm-focused]:outline-accent">
          <FilterField
            value={draft}
            onChange={onDraft}
            onSubmit={() => {
              if (!busy) onApply();
            }}
            label={field.label}
            describedBy={message === null ? hintId : `${hintId} ${problemId}`}
            invalid={message !== null}
            placeholder={gridFilterCopy.placeholder}
            engine={engine}
            columns={columns}
            autocomplete={autocomplete}
          />
        </label>
        {/* A dica do campo para leitor de tela (a de quem vê é o `title` e o texto de ajuda do campo vazio). */}
        <span id={hintId} className="sr-only">
          {field.hint}
        </span>
        <Button type="submit" variant="secondary" size="compact" className="h-8 px-3" disabled={busy}>
          {text.apply}
        </Button>
        <Button type="button" variant="secondary" size="compact" className="h-8 px-3" disabled={!canClear(draft, applied)} onClick={onClear}>
          {text.clear}
        </Button>
      </form>

      {message === null ? null : (
        <p id={problemId} className="text-xs whitespace-pre-wrap text-danger">
          {message}
        </p>
      )}

      {command === null ? null : (
        <div className="flex min-w-0 items-baseline gap-2 text-xs">
          <span className="flex-none text-subtle">{text.command}</span>
          {/* Uma parte por linha, como o comando é enviado: juntado por espaço, um filtro com `-- nota` faria o resto parecer comentado. */}
          <code title={command} className="max-h-20 min-w-0 flex-1 overflow-auto font-editor break-words whitespace-pre-wrap text-muted select-text">
            {command}
          </code>
        </div>
      )}
    </div>
  );
}
