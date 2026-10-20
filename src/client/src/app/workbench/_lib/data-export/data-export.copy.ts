/**
 * Os textos da exportação de dados (seção 35 da especificação, RN-EXPORT-001 a 023), em pt-BR. As frases são as da especificação; as que ela não escreve
 * seguem o tom das vizinhas.
 */

const thousands = new Intl.NumberFormat("pt-BR");

/** O número com o ponto de milhar do pt-BR: `12.345`. */
export const formatCount = (value: number): string => thousands.format(value);

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const dataExportCopy = {
  // RN-EXPORT-001: as entradas e os motivos de não valerem.
  entry: {
    menu: "Exportar dados…",
    button: "Exportar…",
    recordsHint: "Exportar todas as linhas da tabela, com o filtro e a ordem da aba, em CSV ou outro formato",
    resultHint: "Exportar todas as linhas deste resultado, em CSV ou outro formato",
    noResult: "Não há resultado para exportar.",
    notRead: "Exportar executaria o comando de novo, e ele não é só de leitura.",
    busy: "Há um comando em andamento na aba.",
    statistics: "Escolha a aba de um resultado para exportar.",
  },

  // RN-EXPORT-003: o diálogo.
  wizard: {
    title: "Exportar dados",
    steps: { format: "Formato", extraction: "Extração", formatting: "Formatação", output: "Saída", confirmation: "Confirmação" },
    stepsLabel: "Etapas da exportação",
    cancel: "Cancelar",
    back: "Voltar",
    next: "Avançar",
    export: "Exportar",
    copy: "Copiar",
    exporting: "Exportando…",
    copying: "Copiando…",
    sourceTable: (schema: string, name: string) => `Tabela ${schema}.${name}`,
    sourceView: (schema: string, name: string) => `Visão ${schema}.${name}`,
    sourceRecordsFiltered: (schema: string, name: string) => `Tabela ${schema}.${name}, com o filtro e a ordem da aba`,
    sourceResult: (tab: string) => `Resultado de ${tab}`,
    sourceScriptResult: (number: number, tab: string) => `Resultado ${number} de ${tab}`,
    readOnly: "Somente leitura",
  },

  // RN-EXPORT-004: os formatos, na ordem da lista.
  formats: {
    label: "Formato da exportação",
    names: {
      csv: "CSV",
      sourceCode: "Código fonte",
      dbUnit: "DbUnit",
      html: "HTML",
      json: "JSON",
      markdown: "Markdown",
      sql: "SQL",
      txt: "TXT",
      xlsx: "XLSX",
      xml: "XML",
    },
    descriptions: {
      csv: "Texto separado por ponto e vírgula, para planilhas e outros programas.",
      sourceCode: "Um array do PHP com as linhas.",
      dbUnit: "Um conjunto de dados em XML, para testes com o DbUnit.",
      html: "Uma página com a tabela, para abrir no navegador.",
      json: "Uma lista de objetos, um por linha.",
      markdown: "Uma tabela no estilo do GitHub, para documentação.",
      sql: "Comandos INSERT, para levar as linhas a outra tabela.",
      txt: "Uma tabela de texto, com as colunas alinhadas.",
      xlsx: "Uma planilha do Excel.",
      xml: "Um documento XML, no formato do DBeaver.",
    },
    database: "Banco de dados",
    databaseDescription: "Copiar as linhas para uma tabela que já existe, nesta ou em outra conexão.",
  },

  // RN-EXPORT-005: Extração.
  extraction: {
    columns: "Colunas",
    checkAll: "Marcar todas",
    uncheckAll: "Desmarcar todas",
    loading: "Lendo as colunas…",
    loadFailed: "Não foi possível ler as colunas da tabela.",
    retry: "Tentar de novo",
    noneChecked: "Marque ao menos uma coluna.",
    // RN-EXPORT-005: aberto pela grade com colunas inteiras escolhidas (RN-GRADE-022).
    fromGrid: "Marcadas as colunas escolhidas na grade.",
    checked: (checked: number, total: number) => `${formatCount(checked)} de ${formatCount(total)} ${plural(total, "coluna marcada", "colunas marcadas")}`,
    count: "Contar as linhas antes, para mostrar o progresso",
    countHint: "A origem é lida duas vezes: uma para contar, outra para exportar.",
    origin: "Origem",
    allRowsOf: (schema: string, name: string) => `Todas as linhas de ${schema}.${name}.`,
    recordsFilter: "Filtro e ordem da aba:",
    recordsNoFilter: "Sem filtro nem ordem: todas as linhas da tabela.",
    command: "Comando:",
    resultFilter: "Filtro do resultado:",
    noEdit: "Aqui não se edita: para mudar a origem, mude a aba e exporte de novo.",
  },

  // RN-EXPORT-006 a 013: Formatação.
  formatting: {
    reset: "Voltar aos padrões",
    binary: "Binário",
    binaryHex: "Hexadecimal (0x…)",
    binaryEmpty: "Deixar vazio",
    binaryEmptyHint: "O binário sai como o nulo do formato: é o jeito de exportar uma tabela de imagens sem levar as imagens.",
    nullText: "Nulo como",
    nullTextHint: "Vazio por padrão.",
    lineBreak: "Quebra de linha",
    crlf: "CRLF (Windows)",
    lf: "LF",
    csv: {
      delimiter: "Separador",
      delimiters: { ";": "Ponto e vírgula (;)", ",": "Vírgula (,)", "\t": "Tabulação", "|": "Barra vertical (|)" },
      header: "Cabeçalho",
      headerFirst: "Na primeira linha",
      headerNone: "Sem cabeçalho",
      quoting: "Aspas",
      quotings: { auto: "Só quando precisa", text: "Em todos os textos", all: "Em todos os valores" },
      formulaGuard: "Proteção contra fórmula",
      formulaGuardOff: "Uma planilha pode executar como fórmula o valor que começa com =, +, - ou @.",
    },
    txt: {
      header: "Cabeçalho",
      headerLine: "Linha sob o cabeçalho",
      edgeDelimiters: "Barra nas pontas",
      minWidth: "Largura mínima",
      maxWidth: "Largura máxima",
      maxWidthHint: "0 é sem limite.",
      showNull: "Mostrar NULL",
    },
    html: { title: "Título com o nome da origem", columnNames: "Nomes das colunas" },
    markdown: { alignmentLine: "Linha de alinhamento" },
    json: { wrap: "Pôr o nome da origem", isoDates: "Datas em ISO 8601" },
    sourceCode: {
      php: "Versão do PHP",
      legacy: "Anterior ao PHP 5.4",
      short: "PHP 5.4 ou mais novo",
      quote: "Aspas",
      double: "Duplas",
      single: "Simples",
    },
    sql: {
      target: "Tabela de destino",
      schema: "Esquema",
      table: "Tabela",
      namesHint: "Os nomes como estão no banco, sem aspas: o Prism as põe.",
      omitSchema: "Omitir o esquema",
      rowsPerStatement: "Linhas por comando",
      rowsPerStatementHint: "Com valores grandes, use 1: cada banco tem um tamanho máximo de comando.",
      informixRows: "O Informix não aceita várias linhas num INSERT.",
      includeGenerated: "Incluir as colunas que o banco calcula",
      binary: "Binário",
      binaryLiteral: "Literal do banco",
      binaryNull: "NULL",
    },
    xml: { doctype: "Declaração DOCTYPE" },
    dbUnit: {
      table: "Tabela",
      upperCase: "Nomes em maiúsculas",
      nulls: "Nulo",
      omit: "Omitir o atributo",
      mark: "Escrever [NULL]",
      nullsHint: 'O DbUnit lê as colunas da primeira linha: a coluna nula nela fica de fora, a não ser que o conjunto seja carregado com columnSensing. "Escrever [NULL]" não tem esse limite.',
    },
    xlsx: { none: "O XLSX não tem outra opção nesta versão, além do binário." },
  },

  // As recusas dos campos (RN-EXPORT-007 a 014), na tela e, as mesmas, no `EXPORT_OPTIONS_INVALID` da API.
  problems: {
    nullTextControl: "O texto do nulo não pode ter caractere de controle.",
    nullTextLength: "O texto do nulo pode ter até 100 caracteres.",
    minWidth: "A largura mínima vai de 1 a 1.000.",
    maxWidth: "A largura máxima vai de 0 a 100.000.",
    maxBelowMin: "A largura máxima não pode ser menor que a mínima.",
    tableRequired: "Informe a tabela de destino.",
    nameControl: "O nome não pode ter caractere de controle.",
    nameLength: "O nome pode ter até 128 caracteres.",
    rowsPerStatement: "Use de 1 a 1.000 linhas por comando.",
    duplicateColumn: (name: string) => `O resultado tem duas colunas chamadas ${name}: deixe uma de fora na Extração.`,
    xlsxColumns: (extra: number) => `Uma planilha do Excel tem no máximo 16.384 colunas: deixe ${formatCount(extra)} de fora na Extração, ou escolha outro formato.`,
    fileNameEmpty: "Informe o nome do arquivo.",
    fileNameLength: "O nome do arquivo pode ter até 200 caracteres.",
    unknownVariable: (variable: string) => `A variável \${${variable}} não existe. Use \${tabela}, \${esquema}, \${conexao}, \${data} ou \${hora}.`,
  },

  // RN-EXPORT-014: Saída.
  output: {
    fileName: "Nome do arquivo",
    fileNameHint: "Variáveis: ${tabela}, ${esquema}, ${conexao}, ${data} e ${hora}.",
    preview: (name: string) => `Sai como ${name}`,
    encoding: "Codificação",
    utf8: "UTF-8",
    bom: "Incluir BOM",
    bomHint: "O caractere U+FEFF no começo, que faz o Excel ler o CSV em UTF-8.",
    zip: "Compactar em .zip",
    zipXlsx: "O XLSX já é um arquivo compactado.",
    reveal: "Mostrar na pasta ao terminar",
    clipboard: "Copiar para a área de transferência em vez de salvar",
    clipboardXlsx: "O XLSX não é texto: não vai para a área de transferência.",
    clipboardHint: "Até 10 MiB de texto, sem BOM.",
  },

  // RN-EXPORT-015: Confirmação.
  confirmation: {
    origin: "Origem",
    connection: "Conexão",
    columns: "Colunas",
    format: "Formato",
    output: "Saída",
    allRowsOf: (schema: string, name: string) => `Todas as linhas de ${schema}.${name}`,
    recordsOf: (schema: string, name: string) => `${schema}.${name}, com o filtro e a ordem da aba`,
    allColumns: (total: number) => (total === 1 ? "A coluna" : `Todas as ${formatCount(total)} colunas`),
    someColumns: (checked: number, total: number) => `${formatCount(checked)} de ${formatCount(total)} colunas`,
    counts: "Conta as linhas antes",
    noCount: "Sem contar as linhas",
    utf8Bom: "UTF-8 com BOM",
    utf8: "UTF-8",
    zipped: "compactado em .zip",
    revealed: "mostra na pasta ao terminar",
    clipboard: "Copiar para a área de transferência",
    rereadWarning: "As linhas são lidas de novo, numa conexão à parte: o arquivo traz o que o banco tem agora, e não o que a grade mostra.",
    unsavedWarning: (count: number) =>
      count === 1
        ? "A grade tem 1 alteração não salva. A exportação lê o que está gravado no banco e não leva essa alteração."
        : `A grade tem ${formatCount(count)} alterações não salvas. A exportação lê o que está gravado no banco e não leva essas alterações.`,
    generatedWarning: (names: readonly string[]) =>
      names.length === 1 ? `1 coluna que o banco calcula fica fora dos INSERT: ${names[0]}.` : `${formatCount(names.length)} colunas que o banco calcula ficam fora dos INSERT: ${names.join(", ")}.`,
    informixBinary: "O Informix não tem literal para binário: as linhas com binário saem como comentário.",
    outsideElectron: "Exportar só funciona no app do Prism.",
    tooLarge: "O pedido passa de 8 MiB, por causa do comando e dos nomes das colunas. Deixe colunas de fora na Extração.",
    notWritable: "Não é possível gravar na pasta escolhida. Escolha outra pasta.",
    inUse: "Outra exportação em andamento vai gravar neste arquivo. Escolha outro nome.",
    destinationFailed: "Não foi possível abrir o diálogo de salvar.",
    limitReached: "Já há 3 transferências em andamento (exportações, importações ou cópias para outro banco). Espere uma terminar, ou cancele uma na barra de status.",
    connectionMissing: "A conexão não existe mais.",
    userNameMissing: "Esta conexão não tem usuário gravado. Preencha-o em Editar conexão e exporte de novo.",
    passwordMissing: "Esta conexão não tem senha gravada. Preencha-a em Editar conexão e exporte de novo.",
  },

  // As frases do formato, numa linha só, na Confirmação ("CSV · ponto e vírgula · cabeçalho · …").
  summary: {
    delimiters: { ";": "ponto e vírgula", ",": "vírgula", "\t": "tabulação", "|": "barra vertical" },
    header: "cabeçalho",
    noHeader: "sem cabeçalho",
    quotings: { auto: "aspas só quando precisa", text: "aspas em todos os textos", all: "aspas em todos os valores" },
    formulaGuard: "proteção contra fórmula",
    noFormulaGuard: "sem proteção contra fórmula",
    nullAs: (text: string) => `nulo como "${text}"`,
    binaryEmpty: "binário vazio",
    headerLine: "linha sob o cabeçalho",
    edgeDelimiters: "barra nas pontas",
    widths: (min: string, max: string) => (max === "0" ? `largura mínima ${min}` : `largura de ${min} a ${max}`),
    showNull: "mostra NULL",
    title: "título",
    noTitle: "sem título",
    columnNames: "nomes das colunas",
    noColumnNames: "sem nomes das colunas",
    alignmentLine: "linha de alinhamento",
    noAlignmentLine: "sem linha de alinhamento",
    wrap: "com o nome da origem",
    noWrap: "só a lista",
    isoDates: "datas em ISO 8601",
    gridDates: "datas como na grade",
    phpLegacy: "anterior ao PHP 5.4",
    phpShort: "PHP 5.4 ou mais novo",
    doubleQuotes: "aspas duplas",
    singleQuotes: "aspas simples",
    into: (table: string) => `em ${table}`,
    omitSchema: "sem o esquema",
    rowsPerStatement: (rows: string) => (rows === "1" ? "1 linha por comando" : `${rows} linhas por comando`),
    binaryLiteral: "binário como literal",
    binaryNull: "binário como NULL",
    doctype: "com DOCTYPE",
    upperCase: "nomes em maiúsculas",
    nullsOmitted: "nulo omitido",
    nullsMarked: "nulo como [NULL]",
  },

  // RN-EXPORT-021: a barra de status.
  status: {
    label: "Transferências desta janela",
    connecting: (name: string) => `Exportando ${name}… conectando`,
    counting: (name: string) => `Exportando ${name}… contando as linhas`,
    exporting: (name: string) => `Exportando ${name}…`,
    percent: (percent: number) => `${percent}%`,
    rowsAndBytes: (rows: number, bytes: string) => `${formatCount(rows)} ${plural(rows, "linha", "linhas")} · ${bytes}`,
    ofTotal: (rows: number, total: number, bytes: string) => `${formatCount(rows)} de ${formatCount(total)} linhas · ${bytes}`,
    finishing: (name: string) => `Exportando ${name}… terminando`,
    delivering: (fileName: string) => `Gravando ${fileName}…`,
    deliveryFailed: (fileName: string, reason: string) => `${fileName} não foi gravado: ${reason}.`,
    lost: "Não foi possível saber como está a exportação.",
    cancelling: "Cancelando…",
    cancel: "Cancelar",
    cancelLabel: (name: string) => `Cancelar a exportação de ${name}`,
    saveAs: "Salvar como…",
    discard: "Descartar",
    more: (count: number) => `+${count} ${plural(count, "exportação", "exportações")}`,
    listLabel: "Exportações desta janela",
    progressLabel: (name: string) => `Progresso da exportação de ${name}`,
    reasons: {
      diskFull: "não há espaço no disco de destino",
      notWritable: "sem permissão para gravar na pasta escolhida",
      folderMissing: "a pasta escolhida não existe mais",
      inUse: "o arquivo está aberto em outro programa",
    },
    deliveryError: "o sistema recusou a gravação",
  },

  // RN-EXPORT-022: os avisos do fim.
  toasts: {
    exported: (subject: string, feminine: boolean, rows: number, fileName: string) => `${subject} ${feminine ? "exportada" : "exportado"}: ${formatCount(rows)} ${plural(rows, "linha", "linhas")} em ${fileName}.`,
    copied: (subject: string, feminine: boolean, rows: number, format: string) => `${subject} ${feminine ? "copiada" : "copiado"}: ${formatCount(rows)} ${plural(rows, "linha", "linhas")} em ${format}.`,
    reveal: "Mostrar na pasta",
    sheets: (sheets: number) => `Em ${formatCount(sheets)} planilhas: o Excel tem até 1.048.576 linhas por planilha.`,
    cutXlsx: (count: number) => `${formatCount(count)} ${plural(count, "valor cortado", "valores cortados")} no limite da célula do Excel (32.767 caracteres).`,
    cutTxt: (count: number) => `${formatCount(count)} ${plural(count, "valor cortado", "valores cortados")} na largura máxima do TXT.`,
    removed: (count: number) => (count === 1 ? "1 caractere que o formato não aceita foi tirado." : `${formatCount(count)} caracteres que o formato não aceita foram tirados.`),
    skipped: (count: number) =>
      count === 1
        ? "1 linha não exportada, comentada no arquivo: um valor dela não tem literal no banco."
        : `${formatCount(count)} linhas não exportadas, comentadas no arquivo: um valor delas não tem literal no banco.`,
    failed: (name: string) => `A exportação de ${name} falhou.`,
    sqlState: (state: string) => `SQLSTATE ${state}`,
    canceled: (name: string) => `Exportação de ${name} cancelada. Nenhum arquivo foi gravado.`,
    connectionDeleted: (name: string) => `A exportação de ${name} foi cancelada: a conexão foi excluída.`,
    lost: (name: string) => `A exportação de ${name} se perdeu antes de ser gravada. Exporte de novo.`,
    clipboardTooLarge: "O texto passou de 10 MiB, o limite da área de transferência. Exporte para um arquivo.",
    clipboardFailed: "Não foi possível copiar o texto exportado.",
  },

  // RN-EXPORT-023: as saídas.
  exits: {
    signOut: (count: number) =>
      count === 1 ? "Há 1 exportação em andamento. Sair cancela a exportação, e o arquivo dela não é gravado." : `Há ${formatCount(count)} exportações em andamento. Sair cancela as exportações, e os arquivos delas não são gravados.`,
    signOutTitle: "Sair com exportações em andamento?",
    signOutConfirm: (count: number) => (count === 1 ? "Sair e cancelar a exportação" : "Sair e cancelar as exportações"),
    keepExporting: "Continuar exportando",
    cancelling: "Cancelando as exportações…",
    windowTitle: "Fechar com exportações em andamento?",
    window: (count: number) =>
      count === 1
        ? "1 exportação começada nesta janela ainda não terminou. Fechar a janela cancela a exportação."
        : `${formatCount(count)} exportações começadas nesta janela ainda não terminaram. Fechar a janela cancela as exportações.`,
    windowConfirm: (count: number) => (count === 1 ? "Fechar e cancelar a exportação" : "Fechar e cancelar as exportações"),
    app: (count: number) =>
      count === 1
        ? "1 exportação começada nesta janela ainda não terminou. Fechar o Prism cancela a exportação."
        : `${formatCount(count)} exportações começadas nesta janela ainda não terminaram. Fechar o Prism cancela as exportações.`,
    appConfirm: (count: number) => (count === 1 ? "Fechar o Prism e cancelar a exportação" : "Fechar o Prism e cancelar as exportações"),
    canceledAhead: (count: number) => (count === 1 ? "A exportação em andamento será cancelada." : `As ${formatCount(count)} exportações em andamento serão canceladas.`),
    connectionDelete: (count: number) => (count === 1 ? "A exportação em andamento desta conexão será cancelada." : `As ${formatCount(count)} exportações em andamento desta conexão serão canceladas.`),
    discardedAtLock: (count: number) =>
      count === 1 ? "1 exportação com a entrega que falhou será descartada." : `${formatCount(count)} exportações com a entrega que falhou serão descartadas.`,
  },
} as const;
