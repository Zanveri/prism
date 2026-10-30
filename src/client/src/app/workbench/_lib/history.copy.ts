export const historyCopy = {
  title: "Histórico",
  toolbarButton: "Histórico",
  toolbarTooltip: "Histórico (Ctrl+Shift+H)",
  close: "Fechar histórico",
  searchPlaceholder: "Buscar no comando…",
  clearSearch: "Limpar busca",
  scopeAria: "Escopo do histórico",
  scopeThisConnection: "Esta conexão",
  scopeAllConnections: "Todas as conexões",
  today: "Hoje",
  yesterday: "Ontem",
  outcomes: {
    succeeded: "concluído",
    error: "erro",
    cancelled: "cancelado",
    interrupted: "interrompido",
    refused: "erro",
    running: "interrompido"
  },
  rowsFormat: (count: number) =>
    count === 1 ? "1 linha" : `${count.toLocaleString("pt-BR")} linhas`,
  durationFormat: (ms: number | null) => {
    if (ms === null) return "—";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  },
  moreLines: (extra: number) => (extra === 1 ? "+1 linha" : `+${extra} linhas`),
  repeatBadge: (repeat: number) => `×${repeat}`,
  repeatTitle: (repeat: number) => `Executado ${repeat} vezes seguidas`,
  empty: "Nenhum comando registrado ainda.",
  emptyFiltered: "Nenhum comando encontrado para esta busca.",
  loading: "Carregando histórico…",
  loadMore: "Carregar mais",
  insertAtCursor: "Inserir no cursor",
  insertAtCursorHint: "Inserir no cursor (Enter)",
  openInNewTab: "Abrir em nova aba",
  openInNewTabHint: "Abrir em nova aba (Shift+Enter)",
  copy: "Copiar",
  copied: "Copiado",
  copyHint: "Copiar (Ctrl+C)",
  removeFromHistory: "Remover do histórico",
  removeFromHistoryHint: "Remover do histórico (Delete)",
  clearConnectionTrigger: "Limpar o histórico desta conexão",
  clearConnectionConfirmTitle: (name: string) =>
    `Limpar o histórico de ${name}?`,
  clearConnectionConfirmNote:
    "Os registros continuam na Auditoria.",
  clearConnectionConfirmButton: "Limpar histórico",
  clearConnectionCancelButton: "Cancelar"
} as const;
