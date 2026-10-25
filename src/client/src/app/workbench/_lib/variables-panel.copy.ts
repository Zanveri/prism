/** Os textos do painel "Variáveis" (RN-VAR-024) e da lista de abas que o traz. */
export const variablesPanelCopy = {
  tab: "Variáveis",
  result: "Resultado",
  label: "Variáveis da aba",
  tabsLabel: "Área de resultado",
  columns: { name: "Nome", type: "Tipo", value: "Valor", origin: "Origem", when: "Quando" },
  noValue: "sem valor",
  stale: "desatualizado",
  /** O `sql` entra no comando como está (RN-VAR-004). */
  sqlWarning: "Entra no comando como está, sem aspas nem parâmetro.",
  menu: { label: "Variável", copy: "Copiar valor", goTo: "Ir para a declaração" },
  copied: "Valor copiado.",
  notCopied: "Não foi possível copiar o valor.",
  empty: "Nenhuma variável avaliada ainda. Execute o script (Alt+X) ou a declaração (Ctrl+Enter).",
} as const;
