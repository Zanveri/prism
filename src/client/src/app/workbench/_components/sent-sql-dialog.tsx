import { Button, Dialog, useHost, useToast } from "@/components/ui";
import { hostClipboard } from "@/lib/host/host";

import { sentSqlCopy as copy } from "../_lib/sent-sql.copy";
import type { BoundCommand } from "../_lib/variables/bind";
import { sentSql } from "../_lib/variables/sent-sql";
import type { Engine } from "@/components/ui/engine-tag";
import { HighlightedSql } from "./highlighted-sql";

/** A variável como o quadro a escreve: `@ids[2]` para o terceiro item de uma lista (RN-VAR-018). */
export const variableLabel = (variable: string, item: number | null) => (item === null ? variable : `${variable}[${item}]`);

/** O texto que "Copiar" leva: a linha de comentário do alto, quando há, e o comando com os literais. */
export function sentSqlText(command: BoundCommand, engine: Engine | undefined): string {
  const shown = sentSql(command, engine);
  return shown.header === null ? shown.text : `${shown.header}\n${shown.text}`;
}

/**
 * "SQL enviado" (RN-VAR-018), no desenho do "Ver SQL" (RN-EDIT-008): só leitura, com "Copiar" e "Fechar". O comando com os valores no lugar, como literais do
 * banco (os da exportação), com o trecho de cada variável `sql` no fundo de atenção; embaixo, o quadro dos parâmetros (o marcador, a variável, o tipo e o valor)
 * e uma linha por variável `sql` que entrou. O valor que não tem literal fica com o marcador, e uma linha de comentário no alto diz quais.
 */
export function SentSqlDialog({ command, engine, onClose }: { command: BoundCommand; engine: Engine | undefined; onClose: () => void }) {
  const toast = useToast();
  const host = useHost();
  const shown = sentSql(command, engine);

  async function copyAll() {
    try {
      await hostClipboard(host).writeText(sentSqlText(command, engine));
      toast.success(copy.copied);
    } catch {
      toast.warning(copy.notCopied);
    }
  }

  return (
    <Dialog
      open
      size="lg"
      title={copy.title}
      description={copy.description}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy.close}
          </Button>
          <Button type="button" onClick={() => void copyAll()}>
            {copy.copy}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-editor text-xs break-words whitespace-pre-wrap text-ink">
          {shown.header === null ? null : <span className="text-muted">{`${shown.header}\n`}</span>}
          <HighlightedSql text={shown.text} ranges={shown.sqlRanges} />
        </pre>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-muted">{copy.parameters}</h3>
          {shown.rows.length === 0 ? (
            <p className="text-sm text-muted">{copy.none}</p>
          ) : (
            <div className="max-h-48 overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-panel text-muted">
                  <tr>
                    {(["marker", "variable", "type", "value"] as const).map((column) => (
                      <th key={column} scope="col" className="border-b border-border px-2 py-1 font-medium">
                        {copy.columns[column]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.rows.map((row, index) => (
                    <tr key={index}>
                      <td className="border-b border-border px-2 py-1 font-mono text-ink">{row.marker}</td>
                      <td className="border-b border-border px-2 py-1 font-mono text-ink">{variableLabel(row.variable, command.params[index]?.item ?? null)}</td>
                      <td className="border-b border-border px-2 py-1 font-mono text-muted">{row.type}</td>
                      <td className="max-w-80 border-b border-border px-2 py-1 font-mono break-words whitespace-pre-wrap text-ink">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shown.notes.map((note) => (
            <p key={note} className="text-xs text-accent">
              {note}
            </p>
          ))}
        </section>
      </div>
    </Dialog>
  );
}
