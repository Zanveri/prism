/** Os textos do "SQL enviado" (RN-VAR-018): o diálogo, o botão e a dica dele. */
export const sentSqlCopy = {
  title: "SQL enviado",
  description: "O comando com os valores das variáveis escritos como literais do banco, para ler e para copiar e executar noutro lugar. O que foi ao banco foram os parâmetros.",
  /** O botão de ícone da barra do resultado e das Estatísticas. */
  button: "SQL enviado",
  hint: "Ver o SQL enviado, com os valores das variáveis",
  /** Na pergunta de erro do script (RN-SQL-021). */
  view: "Ver o SQL enviado",
  parameters: "Parâmetros",
  columns: { marker: "Marcador", variable: "Variável", type: "Tipo", value: "Valor" },
  none: "O comando não levou parâmetros.",
  copy: "Copiar",
  close: "Fechar",
  copied: "SQL copiado.",
  notCopied: "Não foi possível copiar o SQL.",
} as const;
