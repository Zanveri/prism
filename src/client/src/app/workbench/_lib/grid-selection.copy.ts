import { formatCount } from "@/lib/utils/format";

/**
 * Os textos da seleção da grade, do copiar e do menu da grade da seção 37 (RN-GRADE-001 a 004, 015 e RN-EDIT-013 a 016 no plural). Os da edição de antes
 * seguem em `records.copy.ts`.
 */
export const gridSelectionCopy = {
  // RN-GRADE-001: a contagem da barra do resultado, com mais de uma célula escolhida.
  count: (rows: number, cells: number, whole: boolean) => (whole ? `${formatCount(rows, "linha escolhida", "linhas escolhidas")}` : `${formatCount(cells, "célula escolhida", "células escolhidas")}`),
  // O canto da grade, o "#" do cabeçalho do número da linha.
  selectAll: "Escolher todas as linhas",

  // RN-GRADE-002: o "Copiar" e o "Copiar com cabeçalho".
  copy: {
    copied: "Copiado.",
    copiedWithHeader: "Copiado, com o cabeçalho.",
    rows: (rows: number, header: boolean) => `${rows === 1 ? "1 linha copiada" : `${formatCount(rows, "linha", "linhas")} copiadas`}${header ? ", com o cabeçalho." : "."}`,
    tooLarge: "O texto passou de 10 MiB, o limite da área de transferência. Escolha menos células, ou use Exportar dados… para gravar um arquivo.",
    copying: "Copiando…",
    chooseCell: "Escolha uma célula na grade.",
  },

  // RN-GRADE-015: "Copiar nome da(s) coluna(s)" e "Copiar número de linha(s)".
  names: {
    copied: (count: number) => (count === 1 ? "Nome da coluna copiado." : `${formatCount(count, "nome", "nomes")} de coluna copiados.`),
  },
  numbers: {
    copied: (count: number) => (count === 1 ? "Número da linha copiado." : `${formatCount(count, "número", "números")} de linha copiados.`),
    onlyNew: "As linhas novas não têm número.",
  },

  // RN-GRADE-004: o menu da grade, nos grupos do menu do DBeaver.
  menu: {
    copy: "Copiar",
    copyWithHeader: "Copiar com cabeçalho",
    advanced: "Copiar avançado",
    advancedDialog: "Copiar avançado…",
    columnNames: "Copiar nome da(s) coluna(s)",
    rowNumbers: "Copiar número de linha(s)",
    copyAs: (format: string) => `Copiar como ${format}`,
    configureCopyAs: "Configurar comandos 'Copiar como'…",
    sort: "Ordenar",
    sortAscending: "Crescente",
    sortDescending: "Decrescente",
    sortNone: "Sem ordem",
    follow: "Ir para o registro referenciado",
    generateSql: "Gerar SQL",
    sql: {
      selectEquals: "SELECT .. WHERE .. =",
      selectIn: "SELECT .. WHERE .. IN",
      insert: "INSERT",
      update: "UPDATE",
      delete: "DELETE pela chave única",
      create: "CREATE",
    },
    // RN-GRADE-001: "Colar" e "Definir como nulo" agem numa célula só.
    oneCellOnly: "Vale para uma célula só: escolha uma.",
    // O "Ir para o registro referenciado" sem para onde ir: o nulo, o valor cortado e o que não cabe numa linha de filtro (RN-TABELA-007).
    followUnavailable: "Indisponível: este valor não leva a um registro.",
    copyShortcut: "Ctrl+C",
    copyShortcutMac: "Cmd+C",
    advancedShortcut: "Ctrl+Shift+C",
    advancedShortcutMac: "Cmd+Shift+C",
  },

  // RN-EDIT-013 a 016: as ações de linha com mais de uma linha na seleção.
  rows: {
    duplicate: "Duplicar linhas",
    remove: "Excluir linhas",
    duplicateTitle: (count: number, shortcut: string) => `Duplicar as ${count.toLocaleString("pt-BR")} linhas escolhidas (${shortcut})`,
    removeTitle: (count: number, shortcut: string) => `Excluir as ${count.toLocaleString("pt-BR")} linhas escolhidas (${shortcut})`,
    duplicateDescription: (count: number) => `Duplicar as ${count.toLocaleString("pt-BR")} linhas escolhidas`,
    removeDescription: (count: number) => `Excluir as ${count.toLocaleString("pt-BR")} linhas escolhidas`,
    // RN-EDIT-016: o limite do duplicar, que não é motivo de só leitura e vem sozinho.
    duplicateLimit: "Duplicar vale para até 1.000 linhas de uma vez: escolha menos linhas.",
    // RN-EDIT-014: o motivo da primeira linha que não se exclui, com o número dela na grade.
    keyTruncatedAt: (row: number) => `a chave da linha ${row.toLocaleString("pt-BR")} chegou cortada`,
    keyGeneratedAt: (row: number) => `a chave da linha ${row.toLocaleString("pt-BR")} foi gerada pelo banco; execute de novo para editá-la`,
    alreadyDeleted: "as linhas já estão marcadas para exclusão; Desfazer alteração as devolve",
    // RN-EDIT-016 no plural: a faixa depois de "Duplicar linhas", e por que elas não foram duplicadas.
    keyCopied: (table: string, columns: readonly string[]) => `As linhas duplicadas copiaram a chave de ${table} (${columns.join(", ")}): troque-a em cada uma antes de salvar, ou o banco vai recusar as linhas repetidas.`,
    fullValueMissing: (column: string, row: number, subject: "table" | "result") =>
      `As linhas não foram duplicadas: o valor completo de ${column}, na linha ${row.toLocaleString("pt-BR")}, não pôde vir. ${subject === "table" ? "Atualize os registros para duplicá-las." : "Execute o comando de novo para duplicá-las."}`,
    fetchCancelled: "As linhas não foram duplicadas: a busca dos valores completos foi cancelada.",
  },
} as const;
