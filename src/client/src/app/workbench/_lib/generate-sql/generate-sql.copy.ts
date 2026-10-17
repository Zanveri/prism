import { formatCount } from "@/lib/utils/format";

/** O número como a tela o escreve (`1.234`). */
const number = (count: number) => count.toLocaleString("pt-BR");

/**
 * Os textos do "Gerar SQL" (RN-GRADE-006 e 018 a 020), num lugar só. Os comentários do SQL são frases FIXAS e números: nenhum dado do banco (nome de
 * coluna, valor) entra num comentário, porque uma quebra de linha dentro de um `--` o encerra e o que vem depois passa a ser código.
 */
export const generateSqlCopy = {
  /** Os seis itens do submenu, na ordem do print do dono (RN-GRADE-006). */
  items: {
    selectEquals: "SELECT .. WHERE .. =",
    selectIn: "SELECT .. WHERE .. IN",
    insert: "INSERT",
    update: "UPDATE",
    delete: "DELETE pela chave única",
    create: "CREATE",
  },
  menu: "Gerar SQL",

  /** Os comentários do texto (RN-GRADE-019): o do começo, sem chave, e os do fim, um por motivo, seguidos dos números das linhas na grade. */
  sql: {
    noKey: "Sem chave primária nem chave única: a condição usa todas as colunas, e linhas iguais seriam afetadas juntas.",
    skipped: {
      truncated: "Linhas da grade não geradas, com um valor que não pôde vir inteiro",
      binary: "Linhas da grade não geradas, com um valor binário, que o Informix não escreve como literal",
      literal:
        "Linhas da grade não geradas, com um valor que não cabe num literal (caractere de controle que não seja quebra de linha, retorno de carro nem tabulação; no Informix, também data e hora com mais de cinco casas de segundo ou lógico que não seja true nem false)",
      generated: "Linhas da grade não geradas, com um valor que o banco gerou e a grade não mostra (execute de novo para vê-lo)",
    },
  },

  /** Os motivos dos itens desabilitados (RN-GRADE-006): o que é fragmento entra em "Indisponível: <motivo>.", e o que já é frase vai sozinho. */
  reasons: {
    unavailable: (fragment: string) => `Indisponível: ${fragment}.`,
    noRows: "O resultado não tem linhas.",
    onlyNewRows: "As linhas novas ainda não estão no banco: o Ver SQL mostra o INSERT delas.",
    busy: "há um comando em andamento na aba",
    refreshing: "a atualização automática está lendo as linhas de novo; tente outra vez em um instante",
    oneTable: (reason: string) => `Só num resultado de uma tabela: ${reason}.`,
    join: "num resultado de junção só se alteram células",
    elsewhere: (table: string) => `${table}, escrita sem esquema, leva agora a outra tabela na sessão`,
    keyIncomplete: (table: string, missing: readonly string[]) => `a chave de ${table} não está inteira no resultado: faltam ${missing.join(", ")}`,
    nothingToSet: "não há coluna fora da chave para atualizar",
    noCondition: "nenhuma coluna do resultado serve de condição",
    nothingToInsert: "todas as colunas da tabela no resultado são geradas pelo banco",
    view: (table: string) => `${table} é uma visão: o Prism não monta o DDL de visões`,
    notATable: (table: string) => `${table} não é uma tabela: o Prism só monta o DDL de tabelas`,
  },

  /** O diálogo (RN-GRADE-018). */
  dialog: {
    title: "Gerar SQL",
    /** O que se gera, embaixo do título: "UPDATE · estoque.pedido · 3 linhas". */
    rows: (count: number) => formatCount(count, "linha", "linhas"),
    separator: " · ",
    options: "Opções",
    qualified: "Nomes completos (esquema.tabela)",
    compact: "SQL compacto (uma linha por comando)",
    excludeGenerated: "Excluir as colunas que o banco gera",
    target: "Tabela de destino",
    schema: "Esquema",
    schemaHint: "Opcional. Os nomes como estão no banco: o Prism põe as aspas.",
    table: "Tabela",
    tableMissing: "Informe a tabela de destino.",
    nameTooLong: "O nome tem no máximo 128 caracteres.",
    nameControl: "O nome não pode ter caractere de controle.",
    duplicateColumn: (name: string) => `O resultado tem duas colunas chamadas ${name}: o INSERT seria recusado pelo banco.`,
    sqlLabel: "SQL gerado",
    checking: "Conferindo a tabela e a chave deste resultado…",
    fetching: "Buscando os valores completos…",
    readingCatalog: "Lendo o catálogo…",
    cancel: "Cancelar",
    targetFailed: "Não foi possível saber a tabela e a chave deste resultado.",
    catalogFailed: "Não foi possível ler o catálogo da tabela.",
    retry: "Tentar de novo",
    changed: "O resultado mudou desde a escolha das linhas. Escolha as linhas de novo e gere outra vez.",
    tooLarge: "O SQL passaria de 1 MB, o limite do texto de uma aba de consulta. Escolha menos linhas, ou exporte em SQL (Exportar dados…).",
    close: "Fechar",
    openInTab: "Abrir numa aba de consulta",
    copy: "Copiar",
    copied: "SQL copiado.",
    notCopied: "Não foi possível copiar.",
  },

  /** As frases no tom de atenção, acima do editor (RN-GRADE-018). */
  warnings: {
    skipped: (skipped: number, total: number) => {
      if (total === 1) return "A linha ficou de fora: o comentário no fim do SQL diz por quê.";
      return skipped === 1
        ? `1 das ${number(total)} linhas ficou de fora: o comentário no fim do SQL diz qual e por quê.`
        : `${number(skipped)} das ${number(total)} linhas ficaram de fora: o comentário no fim do SQL diz quais e por quê.`;
    },
    newRows: "As linhas novas ainda não salvas ficaram de fora: o Ver SQL mostra o INSERT delas.",
    pending: (count: number) =>
      count === 1
        ? "1 linha tem alterações não salvas: o SQL usa os valores da grade, e a condição, a chave lida do banco."
        : `${number(count)} linhas têm alterações não salvas: o SQL usa os valores da grade, e a condição, a chave lida do banco.`,
    readOnly: "A conexão é somente leitura: o SQL que grava será recusado nela.",
  },
};
