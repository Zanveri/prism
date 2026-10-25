import type { KeyboardEvent } from "react";

import { AlertIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { copyAsCopy } from "../../_lib/copy-as/copy-as.copy";
import { dataExportCopy } from "../../_lib/data-export/data-export.copy";
import { documentFormats, type DocumentFormat } from "../../_lib/grid-export/document";
import { DataFormatIcon } from "../data-export/format-icons";

/** O id da opção de um formato na lista, para o foco andar com as setas. */
export const copyFormatOptionId = (prefix: string, format: DocumentFormat) => `${prefix}-${format}`;

/** A tecla que anda pela lista: as setas, Home e End; `null` para as outras. */
export function formatForKey(key: string, current: DocumentFormat): DocumentFormat | null {
  const index = documentFormats.indexOf(current);
  const target = key === "ArrowDown" ? Math.min(index + 1, documentFormats.length - 1) : key === "ArrowUp" ? Math.max(index - 1, 0) : key === "Home" ? 0 : key === "End" ? documentFormats.length - 1 : null;
  return target === null ? null : documentFormats[target];
}

/**
 * A lista de escolha única (`listbox`) dos nove formatos do "Copiar como", na ordem do submenu (RN-GRADE-003 e 017), cada um com o ícone e o nome da
 * exportação (RN-EXPORT-004) e, com `describe`, a frase dele. Só o escolhido entra no Tab; as setas, Home e End andam e escolhem. O formato com um campo
 * recusado (`refused`) ganha a marca de erro, que o leitor de tela também lê ("CSV, com um campo recusado").
 */
export function CopyFormatList({
  format,
  onChoose,
  idPrefix,
  label,
  describe = false,
  refused = () => false,
}: {
  format: DocumentFormat;
  onChoose: (format: DocumentFormat) => void;
  idPrefix: string;
  label: string;
  describe?: boolean;
  refused?: (format: DocumentFormat) => boolean;
}) {
  const names = dataExportCopy.formats.names;

  function move(event: KeyboardEvent<HTMLElement>) {
    const next = formatForKey(event.key, format);
    if (next === null) return;
    event.preventDefault();
    onChoose(next);
    // A página do elemento (RN-ABAS-017): o diálogo pode estar na janela do resultado.
    event.currentTarget.ownerDocument.getElementById(copyFormatOptionId(idPrefix, next))?.focus();
  }

  return (
    <div role="listbox" aria-label={label} className="flex flex-col gap-1">
      {documentFormats.map((candidate) => {
        const selected = candidate === format;
        const wrong = refused(candidate);
        return (
          <div
            key={candidate}
            id={copyFormatOptionId(idPrefix, candidate)}
            role="option"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(candidate)}
            onKeyDown={move}
            className={cn("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-accent", selected ? "border-accent bg-selected" : "border-transparent hover:bg-selected")}
          >
            <DataFormatIcon format={candidate} className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium text-ink">
                {names[candidate]}
                {wrong ? <span className="sr-only">{copyAsCopy.configure.refusedSuffix}</span> : null}
              </span>
              {describe ? <span className="text-sm text-muted">{dataExportCopy.formats.descriptions[candidate]}</span> : null}
            </span>
            {wrong ? <AlertIcon aria-hidden className="mt-0.5 size-4 flex-none text-danger" /> : null}
          </div>
        );
      })}
    </div>
  );
}
