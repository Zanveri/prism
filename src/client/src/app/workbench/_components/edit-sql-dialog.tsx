import { Button, Dialog, useHost, useToast } from "@/components/ui";
import { hostClipboard } from "@/lib/host/host";

import type { EditPreview } from "../_lib/record-edits.schema";
import { recordsCopy } from "../_lib/records.copy";

const copy = recordsCopy.edit;

/** O texto que "Copiar" leva: os comandos, um por linha, terminados em `;`. */
export function previewText(preview: EditPreview): string {
  return preview.statements.map((statement) => `${statement.sql};`).join("\n");
}

/**
 * "Ver SQL" (RN-EDIT-008): os comandos que o Salvar vai executar, na ordem, com os valores escritos como literais do banco para leitura;
 * o valor sem literal (caractere de controle) aparece como `?`, com o texto dele embaixo, na ordem. Diz que na execução os valores vão
 * como parâmetros e, no banco sem log, que cada comando é gravado sozinho. Com a coluna inteira (RN-EDIT-023), a contagem e o `UPDATE` dela vêm
 * primeiro, cada um com a nota que a API manda, embaixo dele, como veio. Dá para copiar (os comandos, sem as notas); não executa nada.
 */
export function EditSqlDialog({ preview, onClose }: { preview: EditPreview; onClose: () => void }) {
  const toast = useToast();
  const host = useHost();
  const unwritten = preview.statements.flatMap((statement) => statement.values);

  async function copyAll() {
    try {
      await hostClipboard(host).writeText(previewText(preview));
      toast.success(copy.copied);
    } catch {
      toast.warning(copy.notCopied);
    }
  }

  return (
    <Dialog
      open
      size="lg"
      title={copy.sqlTitle}
      description={preview.oneAtATime ? `${copy.sqlDescription} ${copy.sqlOneAtATime}` : copy.sqlDescription}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy.close}
          </Button>
          <Button type="button" onClick={() => void copyAll()}>
            {copy.copySql}
          </Button>
        </>
      }
    >
      <div className="flex max-h-80 flex-col gap-2 overflow-auto rounded-md border border-border bg-background p-3">
        {preview.statements.map((statement, index) => (
          <div key={index} className="flex flex-col gap-0.5">
            <pre className="font-editor text-xs break-words whitespace-pre-wrap text-ink">{`${statement.sql};`}</pre>
            {statement.note == null ? null : <p className="font-sans text-xs text-muted">{statement.note}</p>}
          </div>
        ))}
      </div>
      {unwritten.length === 0 ? null : (
        <div className="mt-3 text-sm text-muted">
          <p>{copy.sqlUnwritten}</p>
          <ol className="mt-1 list-decimal pl-5 font-mono text-xs text-ink">
            {unwritten.map((value, index) => (
              <li key={index} className="break-words whitespace-pre-wrap">
                {JSON.stringify(value)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Dialog>
  );
}
