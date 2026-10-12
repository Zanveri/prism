/**
 * Os textos das sugestões do editor de SQL (RN-CONFIG-004): o que a lista diz de cada nome, e como o leitor de tela a chama. Moram ao lado
 * do código das sugestões, e não em `workbench.copy.ts`, que a aba da tabela também edita.
 */
export const completionCopy = {
  /** O nome da lista de sugestões para o leitor de tela (a biblioteca o escreve em inglês). */
  listLabel: "Sugestões",
  schema: "esquema",
  table: "tabela",
  view: "visão",
  /** O que a sugestão de uma tabela ou visão diz quando ela vem sem o esquema na frente: de onde ela é. */
  inSchema: (schema: string, what: string) => `${schema} · ${what}`,
};
