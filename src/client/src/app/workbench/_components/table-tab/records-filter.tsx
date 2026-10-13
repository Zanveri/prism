import { useId, type FormEvent } from "react";

import { Button } from "@/components/ui";

import { recordsCopy } from "../../_lib/records.copy";
import { canClear } from "../../_lib/table-view";
import { workbenchCopy } from "../../_lib/workbench.copy";

const text = workbenchCopy.tableTab.records;
const field = recordsCopy.filter;

type RecordsFilterProps = {
  /** O que está escrito no campo (ainda não aplicado). */
  draft: string;
  onDraft: (text: string) => void;
  /** O filtro em vigor (a condição, a ordem ou as duas): "Limpar" vale com ele ou com texto no campo. */
  applied: string;
  /** O que o filtro tem de errado, se tem (a conferência de um comando só). */
  problem: "severalStatements" | null;
  /** Há algo em andamento na aba: o executor recusaria outro comando, e o botão espera. */
  busy: boolean;
  /** O comando que o último pedido montou: é o que a grade abaixo mostra (RN-TABELA-005). */
  command: string | null;
  onApply: () => void;
  onClear: () => void;
};

/**
 * O filtro dos registros (RN-TABELA-005 e 010, canvas `TabelaDados`): o campo recebe o que vem depois do nome da tabela, como o usuário o
 * escreve: uma condição, uma ordem (`ORDER BY ...`) ou as duas. Por isso não há um rótulo `WHERE` fixo na frente dele: com só a ordem no campo
 * ele seria falso; o exemplo do campo vazio e a dica dizem o que cabe ali. "Aplicar filtro" (e Enter) executa o texto, e "Limpar" tira a
 * condição e a ordem de uma vez. A recusa de mais de um comando aparece no próprio campo. Embaixo, o comando que a tela executou, uma parte por
 * linha, como foi enviado (o bloco rola se o filtro for comprido); a dica o repete inteiro.
 */
export function RecordsFilter({ draft, onDraft, applied, problem, busy, command, onApply, onClear }: RecordsFilterProps) {
  const hintId = useId();
  const problemId = useId();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!busy) onApply();
  }

  return (
    <div className="flex flex-none flex-col gap-1.5 border-b border-border bg-panel px-3 py-2">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <label title={field.hint} className="flex h-8 min-w-60 flex-1 items-center rounded-md border border-border bg-raised px-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
          <input
            type="text"
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            aria-label={field.label}
            aria-invalid={problem !== null}
            aria-describedby={problem === null ? hintId : `${hintId} ${problemId}`}
            placeholder={field.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="h-7 min-w-0 flex-1 bg-transparent font-editor text-ink outline-none placeholder:text-subtle"
          />
        </label>
        {/* A dica do campo para leitor de tela (a de quem vê é o `title` e o exemplo do campo vazio). */}
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

      {problem === null ? null : (
        <p id={problemId} className="text-xs text-danger">
          {field.severalStatements}
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
