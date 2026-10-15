/**
 * Os textos dos formatos de exportação, e dos comandos SQL gerados (RN-GRADE-002 a 007; os do "Filtrar" estão em `grid-filter.copy.ts`), num lugar só. Os comentários
 * do SQL são frases FIXAS: nenhum dado do banco (nome de coluna, valor) entra num comentário, porque uma quebra de linha dentro de um
 * comentário `--` o encerra e o que vem depois passa a ser código.
 */
export const gridExportCopy = {
  /** O nome que a tela mostra para cada formato. */
  formats: { csv: "CSV", tsv: "TSV", json: "JSON", xlsx: "Excel (XLSX)", html: "HTML", markdown: "Markdown", xml: "XML", insert: "Comandos INSERT" },

  /** O cabeçalho da coluna do número da linha do texto delimitado. */
  rowNumberHeader: "#",

  /** O título do documento HTML e o nome padrão da planilha. */
  documentTitle: "Resultado",

  /** O que o HTML desenha (por CSS) numa célula nula. */
  nullMark: "NULL",

  /** A mensagem do `RangeError` de `toXlsx` quando o recorte não cabe numa planilha do Excel. */
  xlsxTooBig: "Uma planilha do Excel tem no máximo 1.048.576 linhas (o cabeçalho conta) e 16.384 colunas.",

  /** Os comentários do SQL gerado (RN-GRADE-006): frases fixas, de uma linha só, que nunca levam nome nem valor do banco. */
  sql: {
    noKey: "Sem chave primária conhecida: a condição usa todas as colunas, e linhas iguais seriam afetadas juntas.",
    keyNotInSlice: "Nada gerado: a chave primária não está entre as colunas escolhidas, e sem ela as linhas não se identificam.",
    nothingToSet: "Nada gerado: todas as colunas escolhidas são da chave, e não há o que atualizar.",
    tableNameMissing: "Nada gerado: informe o nome da tabela.",
    /** Seguidas de dois pontos e dos números das linhas na grade. */
    skipped: {
      truncated: "Linhas da grade não geradas, com um valor necessário que chegou cortado",
      binary: "Linhas da grade não geradas, com uma coluna necessária binária",
      literal: "Linhas da grade não geradas, com um valor que não cabe num literal (caractere de controle que não seja quebra de linha, retorno de carro nem tabulação; no Informix, também data e hora com mais de cinco casas de segundo ou lógico que não seja true nem false)",
    },
  },
};
