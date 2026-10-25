import { Button, Dialog } from "@/components/ui";

import { commandHint, type ScriptChoice, type ScriptEntry } from "../_lib/script-run";
import { scriptRunCopy } from "../_lib/script-run.copy";
import { sentSqlCopy } from "../_lib/sent-sql.copy";
import type { RunTarget } from "../_lib/use-query-runner";
import { variableRunCopy } from "../_lib/variable-run.copy";

const copy = scriptRunCopy.error;

type ScriptErrorDialogProps = {
  /** O comando que falhou, com o erro dele. */
  entry: ScriptEntry;
  /** A posição dele no script (de 1 em diante) e quantos o script tem. */
  number: number;
  total: number;
  onChoose: (choice: ScriptChoice) => void;
  /** RN-VAR-018: "Ver o SQL enviado", no comando que levou variáveis. */
  onViewSent?: (target: RunTarget) => void;
};

/**
 * A pergunta de erro do script (RN-SQL-021), como o diálogo de erro do DBeaver: o comando, o erro como veio (RN-SQL-009), com o SQLSTATE, e "Parar",
 * "Tentar de novo", "Pular" e "Pular todos os erros". "Parar" é o padrão: nasce com o foco, como o "Cancelar" do `ConfirmDialog` (um Enter solto não
 * segue o script), e é também o Esc, como a especificação diz. Sem o X e sem o clique fora (`dismissible="escape"`): a resposta é uma das quatro, e um
 * clique fora, sem querer, pararia o script calado. O foco volta, ao fechar, ao que o tinha quando ela abriu: o editor, de onde o script saiu.
 */
export function ScriptErrorDialog({ entry, number, total, onChoose, onViewSent }: ScriptErrorDialogProps) {
  const error = entry.error;
  // RN-VAR-022: o erro numa declaração só deixa "Parar" e "Tentar de novo": sem o valor, os comandos que o usam não têm como rodar.
  const declaration = entry.kind === "declaration";
  const name = declaration ? (/^\s*(?:let|const)?\s*([^\s=:;]+)/.exec(entry.target.sql)?.[1] ?? "a variável") : "";
  const skipReason = declaration ? variableRunCopy.skipDisabled(name) : undefined;

  return (
    <Dialog
      open
      role="alertdialog"
      size="lg"
      dismissible="escape"
      title={declaration ? variableRunCopy.declarationTitle(number, total) : copy.title(number, total)}
      description={copy.description}
      onClose={() => onChoose("stop")}
      footer={
        <>
          <Button autoFocus type="button" onClick={() => onChoose("stop")}>
            {copy.stop}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onChoose("retry")}>
            {copy.retry}
          </Button>
          {/* O desabilitado de verdade (o foco não precisa chegar nele): o motivo vai na dica e no texto para o leitor de tela. */}
          <Button type="button" variant="secondary" disabled={declaration} title={skipReason} onClick={() => onChoose("skip")}>
            {copy.skip}
          </Button>
          <Button type="button" variant="secondary" disabled={declaration} title={skipReason} onClick={() => onChoose("skipAll")}>
            {copy.skipAll}
          </Button>
          {entry.target.sent === undefined || onViewSent === undefined ? null : (
            <Button type="button" variant="secondary" onClick={() => onViewSent(entry.target)}>
              {sentSqlCopy.view}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-muted">{declaration ? variableRunCopy.declaration : copy.command}</h3>
          <pre className="max-h-40 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs break-words whitespace-pre-wrap text-ink">{commandHint(entry.target.sql)}</pre>
        </section>
        {skipReason === undefined ? null : <p className="text-xs text-muted">{skipReason}</p>}
        {error === null ? null : (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold text-danger">{error.title}</h3>
            {/* `pre-wrap`: a mensagem do banco pode ter várias linhas (mensagem, DETAIL, HINT), e é sempre texto (RN-SQL-009). */}
            {error.message === null ? null : <pre className="max-h-56 overflow-auto font-mono text-sm break-words whitespace-pre-wrap text-ink">{error.message}</pre>}
            {error.sqlState === null ? null : (
              <p className="text-xs text-muted">
                {scriptRunCopy.statistics.sqlState} <span className="font-mono text-ink">{error.sqlState}</span>
              </p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
