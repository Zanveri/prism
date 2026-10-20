import { useId, useState } from "react";

import { Button, Dialog } from "@/components/ui";

import { configureProblems } from "../../_lib/copy-as/copy-as";
import { copyAsCopy } from "../../_lib/copy-as/copy-as.copy";
import { noTarget } from "../../_lib/copy-as/copy-as-choices";
import type { ConfigureCopyAsDialogProps } from "../../_lib/copy-as/use-copy-as";
import { defaultOptions, type FormatOptions } from "../../_lib/data-export/export-options";
import { resetFormat } from "../../_lib/data-export/export-wizard";
import { documentFormats, type DocumentFormat } from "../../_lib/grid-export/document";
import { FormattingStep } from "../data-export/export-wizard-steps";
import { CopyFormatList } from "./copy-format-list";

const c = copyAsCopy.configure;

/** Os formatos com algum campo recusado: a marca da lista e o "Salvar" desabilitado. */
export const refusedFormats = (options: FormatOptions): DocumentFormat[] => documentFormats.filter((format) => Object.keys(configureProblems(format, options)).length > 0);

/**
 * "Configurar comandos 'Copiar como'…" (RN-GRADE-017): o diálogo grande, como o do DBeaver. À esquerda, os nove formatos com o ícone, o nome e a frase de cada
 * um, com o CSV escolhido ao abrir; à direita, as opções do escolhido, as do "Copiar avançado…" menos a tabela de destino do SQL e a do DbUnit, que são da
 * origem, e "Voltar aos padrões". Trocar de formato guarda na memória do diálogo o que mudou no outro; "Salvar" entrega as opções de todos de uma vez
 * (`onSave`, que grava, fecha e avisa), e fica desabilitado com um campo recusado em qualquer formato, que ganha a marca na lista. "Cancelar", Esc e o X
 * fecham sem gravar e sem perguntar. Só de propriedades e estado: quem lê e grava as escolhas (`readCopyAsChoices`, `writeCopyAsChoices`) é quem o abre.
 */
export function ConfigureCopyAsDialog({ initial, onSave, onClose }: ConfigureCopyAsDialogProps) {
  const idPrefix = useId();
  const [format, setFormat] = useState<DocumentFormat>("csv");
  const [options, setOptions] = useState<FormatOptions>(initial.options);
  const refused = refusedFormats(options);

  const footer = (
    <>
      <Button type="button" variant="secondary" className="mr-auto" onClick={onClose}>
        {c.cancel}
      </Button>
      <Button type="button" onClick={() => onSave({ format: initial.format, options })} disabled={refused.length > 0}>
        {c.save}
      </Button>
    </>
  );

  return (
    <Dialog open title={c.title} size="lg" onClose={onClose} footer={footer}>
      <div className="flex min-h-[420px] gap-6">
        <div className="w-56 flex-none">
          <CopyFormatList format={format} onChoose={setFormat} idPrefix={idPrefix} label={c.formats} describe refused={(candidate) => refused.includes(candidate)} />
        </div>
        <div className="min-w-0 flex-1">
          <FormattingStep
            format={format}
            options={options}
            onChange={setOptions}
            problems={configureProblems(format, options)}
            informix={false}
            showGenerated
            target={false}
            onReset={() => setOptions(resetFormat(options, format, defaultOptions(noTarget)))}
          />
        </div>
      </div>
    </Dialog>
  );
}
