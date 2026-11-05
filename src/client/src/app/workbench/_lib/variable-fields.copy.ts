import { formatCount } from "@/lib/utils/format";

/** Os textos da pergunta dos valores (RN-VAR-021) e dos campos do "Executar com valores…" (RN-VAR-027), com a escolha pela chave (RN-VAR-031). */
export const variableFieldsCopy = {
  title: "Valores para executar",
  /** RN-VAR-027: o diálogo do "Executar com valores…". */
  fullTitle: (name: string) => `Executar com valores · ${name}`,
  where: "Onde",
  connection: "Conexão",
  database: "Banco de dados",
  defaultDatabase: "o padrão da conexão",
  values: "Valores",
  below: "Mais abaixo no script",
  calculated: (count: number) => `Mais ${count === 1 ? "1 variável é calculada" : `${count.toLocaleString("pt-BR")} variáveis são calculadas`} durante o script.`,
  computed: (text: string) => `calculado: ${text}`,
  noTopDeclarations: "Este script não declara variáveis.",
  /** RN-VAR-028: os valores lembrados. */
  lastTime: "da última vez",
  resetToScript: "Voltar ao valor do script",
  forget: "Esquecer os valores deste script",
  rememberFailed: (reason: string) => `Não foi possível lembrar os valores: ${reason}.`,
  tooLargeToRemember: (names: readonly string[]) => (names.length === 1 ? `O valor de ${names[0]} é grande demais para ser lembrado.` : `Os valores de ${names.join(", ")} são grandes demais para serem lembrados.`),
  summary: (count: number) => `O script declara ${formatCount(count, "variável", "variáveis")} sem valor. Escreva os valores para continuar.`,
  run: "Executar",
  cancel: "Cancelar",

  required: (name: string) => `Escreva um valor para ${name}.`,
  emptyItem: "O item está vazio.",
  notNumber: "Escreva um número, como 42 ou 3.5.",
  decimalHint: "Use ponto nos decimais, como 3.5.",
  chooseDate: "Escolha uma data.",
  chooseTime: "Escolha a hora.",
  badItem: (item: string, message: string) => `${item}: ${message}`,

  yes: "Sim",
  no: "Não",
  nullLabel: "NULL",
  time: "Hora",
  timeOptional: "Hora (opcional)",
  sqlWarning: "Entra no comando como está, sem aspas: confira o que escreve.",
  items: (count: number) => formatCount(count, "item", "itens"),
  removeItem: (item: string) => `Remover ${item}`,
  itemsHint: "Enter ou vírgula fecham o item; colar várias linhas cria um item por linha.",
  edgeSpace: (start: boolean, end: boolean) => (start && end ? "Espaço no começo e no fim" : start ? "1 espaço no começo" : "1 espaço no fim"),

  /** RN-VAR-031: a escolha com busca. */
  choiceNote: (table: string, column: string, described: boolean) => `Valores de ${table} (${column})${described ? ", com o nome" : ""}`,
  search: "Buscar",
  loadMore: "Carregar mais",
  loading: "Carregando…",
  noValues: "Nenhum valor.",
  tryAgain: "Tentar de novo",
  truncated: "O valor é longo demais para escolher daqui: escreva-o.",
  missing: (values: readonly string[], table: string, column: string) =>
    values.length === 1 ? `O valor ${values[0]} não existe em ${table} (${column}).` : `Os valores ${values.slice(0, -1).join(", ")} e ${values[values.length - 1]} não existem em ${table} (${column}).`,
} as const;
