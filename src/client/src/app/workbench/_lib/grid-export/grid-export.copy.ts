/**
 * Os textos dos formatos de exportação (RN-GRADE-002 a 007), num lugar só. Os do "Filtrar" estão em `grid-filter.copy.ts`, e os do "Gerar SQL", com os
 * comentários do SQL gerado, em `generate-sql/generate-sql.copy.ts`.
 */
export const gridExportCopy = {
  /** O cabeçalho da coluna do número da linha do texto delimitado. */
  rowNumberHeader: "#",

  /** O título do documento HTML e o nome padrão da planilha. */
  documentTitle: "Resultado",

  /** O que o HTML desenha (por CSS) numa célula nula. */
  nullMark: "NULL",

  /** A mensagem do `RangeError` de `toXlsx` quando o recorte não cabe numa planilha do Excel. */
  xlsxTooBig: "Uma planilha do Excel tem no máximo 1.048.576 linhas (o cabeçalho conta) e 16.384 colunas.",
};
