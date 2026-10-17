/**
 * Os textos fixos dos documentos da exportação escritos na tela (RN-EXPORT-011 e RN-GRADE-016). Os comentários do SQL são frases FIXAS, iguais às da API
 * (`SqlExportWriter`): nenhum dado do banco (nome de coluna, valor) entra num comentário, porque uma quebra de linha dentro de um `--` o encerra e o que vem
 * depois passa a ser código.
 */
export const documentCopy = {
  sql: {
    /** O começo do comentário da linha que não virou `INSERT`, com o número dela na grade. */
    skipped: (row: number) => `-- Linha ${row} não exportada: `,
    /** O da linha nova ainda não salva, que não tem número (a grade mostra "+"); só a tela o escreve. */
    newRow: "-- Linha nova não exportada: ela ainda não está no banco.",
    reasons: {
      informixBinary: "o Informix não tem literal para binário.",
      control: "um valor tem caractere de controle que não vira literal.",
      informixDateTime: "no Informix, a data e hora tem mais de cinco casas de segundo.",
      /** Só a tela: o valor cortado que não veio inteiro (RN-SQL-017), porque o `INSERT` dele gravaria outro valor. */
      notWhole: "um valor não pôde vir inteiro.",
      /** Só a tela: a célula "gerado pelo banco" da linha nova já salva (RN-EDIT-009): o nulo no lugar dela gravaria por cima do valor que o banco gerou. */
      generated: "um valor que o banco gerou não aparece na grade.",
    },
  },
};
