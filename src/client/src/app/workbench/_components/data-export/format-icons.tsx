import type { ComponentProps, ReactNode } from "react";

import { DatabaseIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { DataFormat } from "../../_lib/data-export/export-options";

/** Um ícone de formato no traço do canvas (16 px, traço 1,5, pontas redondas), como os de `icons.tsx` (seção 9: os dos formatos são novos). */
function FormatIcon({ className, children, ...props }: ComponentProps<"svg">) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("flex-none", className)} {...props}>
      {children}
    </svg>
  );
}

const shapes: Record<DataFormat, ReactNode> = {
  // As colunas separadas de uma planilha de texto.
  csv: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12M6 3v10M10 3v10" />
    </>
  ),
  // O cifrão das variáveis do PHP.
  sourceCode: <path d="M10.5 5c-.4-1-1.3-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2 0 2.8 5 1.5 5 4.3 0 1.2-1.1 2.2-2.6 2.2-1.2 0-2.1-.6-2.6-1.6M8 2v12" />,
  // O tubo de ensaio dos testes.
  dbUnit: <path d="M6 2.5h4M7 2.5v4.2l-3.2 5.6c-.4.7.1 1.2.8 1.2h6.8c.7 0 1.2-.5.8-1.2L9 6.7V2.5M5.3 10h5.4" />,
  // A página do navegador.
  html: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 5.5h12M6.5 8l-1.5 1.5L6.5 11M9.5 8l1.5 1.5L9.5 11" />
    </>
  ),
  // As chaves de um objeto.
  json: <path d="M5.5 2.5c-1.3 0-1.8.6-1.8 1.8v1.5c0 1-.5 1.6-1.4 2.2.9.6 1.4 1.2 1.4 2.2v1.5c0 1.2.5 1.8 1.8 1.8M10.5 2.5c1.3 0 1.8.6 1.8 1.8v1.5c0 1 .5 1.6 1.4 2.2-.9.6-1.4 1.2-1.4 2.2v1.5c0 1.2-.5 1.8-1.8 1.8" />,
  // O "M" e a seta para baixo do Markdown.
  markdown: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M4 10.5v-5l2 2.3 2-2.3v5M11 5.5v5M9.5 9l1.5 1.5L12.5 9" />
    </>
  ),
  // O cilindro do banco (o `INSERT` vai para uma tabela).
  sql: null,
  // As linhas de um texto.
  txt: <path d="M3 3.5h10M3 6.5h10M3 9.5h10M3 12.5h6" />,
  // A planilha do Excel.
  xlsx: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
    </>
  ),
  // A marcação, com a barra de fechar.
  xml: <path d="M5 4.5L1.5 8 5 11.5M11 4.5l3.5 3.5-3.5 3.5M9.2 3.5l-2.4 9" />,
};

const formatFamilies: Record<DataFormat, string> = {
  csv: "table",
  sourceCode: "code",
  dbUnit: "document",
  html: "code",
  json: "code",
  markdown: "document",
  sql: "database",
  txt: "lines",
  xlsx: "table",
  xml: "code",
};

/** O ícone de cada formato da lista (RN-EXPORT-004); o SQL usa o cilindro do banco que o app já tem. */
export function DataFormatIcon({ format, className }: { format: DataFormat; className?: string }) {
  if (format === "sql") return <DatabaseIcon className={className} />;
  return (
    <FormatIcon data-icon={formatFamilies[format]} className={className}>
      {shapes[format]}
    </FormatIcon>
  );
}

/** O ícone do destino "Banco de dados" (seção 36), o mesmo cilindro. */
export function DatabaseTargetIcon({ className }: { className?: string }) {
  return <DatabaseIcon className={className} />;
}
