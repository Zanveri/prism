import type { DocumentCopy } from "./document.copy";

// O arquivo exportado é contrato (fixtures de src/test-fixtures/export e SqlExportWriter da API): estas frases ficam em português nos três idiomas.
export const documentCopyEs: DocumentCopy = {
  sql: {
    skipped: (row: number) => `-- Linha ${row} não exportada: `,
    newRow: "-- Linha nova não exportada: ela ainda não está no banco.",
    reasons: {
      informixBinary: "o Informix não tem literal para binário.",
      control: "um valor tem caractere de controle que não vira literal.",
      informixDateTime: "no Informix, a data e hora tem mais de cinco casas de segundo.",
      notWhole: "um valor não pôde vir inteiro.",
      generated: "um valor que o banco gerou não aparece na grade.",
    },
  },
};
