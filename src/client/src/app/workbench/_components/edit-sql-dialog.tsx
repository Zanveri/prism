import { Button, Dialog, useToast } from "@/components/ui";

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
 * como parâmetros e, no banco sem log, que cada comando é gravado sozinho. Dá para copiar; não executa nada.
 */
export function EditSqlDialog({ preview, onClose }: { preview: EditPreview; onClose: () => void }) {
  const toast = useToast();
  const unwritten = preview.statements.flatMap((statement) => statement.values);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(previewText(preview));
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
      <pre className="max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-editor text-xs break-words whitespace-pre-wrap text-ink">{previewText(preview)}</pre>
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
