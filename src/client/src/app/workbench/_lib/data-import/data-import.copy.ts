import { formatCount } from "../data-export/data-export.copy";

/**
 * Os textos da importação de dados e da cópia para outro banco (seção 36 da especificação, RN-IMPORT-001 a 027), em pt-BR. As frases são as da
 * especificação; as que ela não escreve seguem o tom das vizinhas.
 */

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** "a e b", "a, b e c": a lista em português. */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** As linhas de um intervalo do arquivo ("nas linhas 20.001 a 30.000"), ou de uma linha só. */
const rangeOf = (first: number, last: number) => (first === last ? `da linha ${formatCount(first)}` : `das linhas ${formatCount(first)} a ${formatCount(last)}`);

export const dataImportCopy = {
  // RN-IMPORT-001: as entradas.
  entry: {
    menu: "Importar dados…",
    button: "Importar…",
    recordsHint: "Importar linhas de um arquivo CSV, TSV, JSON ou XLSX para esta tabela",
    readOnly: "A conexão é somente leitura: importar grava na tabela.",
    view: "Só uma tabela recebe linhas importadas: esta é uma visão.",
  },

  // RN-IMPORT-002: o diálogo.
  wizard: {
    title: "Importar dados",
    target: (schema: string, table: string) => `Para a tabela ${schema}.${table}`,
    steps: { file: "Arquivo", mapping: "Mapeamento", load: "Carga", confirmation: "Confirmação" },
    stepsLabel: "Etapas da importação",
    cancel: "Cancelar",
    back: "Voltar",
    next: "Avançar",
    import: "Importar",
    importing: "Importando…",
  },

  // RN-IMPORT-003 a 008: a etapa Arquivo.
  file: {
    label: "Arquivo",
    choose: "Escolher arquivo…",
    change: "Trocar arquivo…",
    cancelCopy: "Cancelar",
    copying: (name: string, percent: number) => `Copiando ${name}… ${percent}%`,
    copyProgressLabel: (name: string) => `Cópia de ${name}`,
    chosen: (name: string, size: string) => `${name} · ${size}`,
    outsideElectron: "Importar só funciona no app do Prism.",
    dialogFailed: "Não foi possível abrir o diálogo do sistema.",
    tooLarge: (size: string) => `O arquivo tem ${size}, e o Prism importa até 2 GB.`,
    noSpace: (needed: string) => `Não há espaço na pasta de dados do Prism para copiar o arquivo: são precisos ${needed}.`,
    notWritable: "Não é possível gravar na pasta de dados do Prism.",
    unreadable: (reason: string) => `Não foi possível ler o arquivo: ${reason}.`,
    notAFile: "Escolha um arquivo, e não uma pasta ou um dispositivo.",
    missing: "O arquivo escolhido não está mais com o Prism. Escolha o arquivo de novo.",
    waitCopy: "Espere a cópia do arquivo terminar.",
    chooseFirst: "Escolha o arquivo a importar.",
    format: "Formato",
    formats: { csv: "CSV", tsv: "TSV", json: "JSON", xlsx: "XLSX" },
    encoding: "Codificação",
    encodings: { auto: "Automática", "utf-8": "UTF-8", "utf-16le": "UTF-16 LE", "utf-16be": "UTF-16 BE", "windows-1252": "Windows-1252", "iso-8859-1": "ISO-8859-1" },
    detectedEncoding: (name: string) => `Detectada: ${name}`,
    delimiter: "Separador",
    delimiters: { auto: "Automático", ";": "Ponto e vírgula (;)", ",": "Vírgula (,)", "\t": "Tabulação", "|": "Barra vertical (|)" },
    detectedDelimiter: (name: string) => `Detectado: ${name}`,
    header: "Primeira linha é o cabeçalho",
    quote: "Aspas",
    quotes: { double: "Aspas duplas", none: "Nenhuma" },
    nullText: "Texto do nulo",
    nullTextHint: "Vazio por padrão: só o campo vazio pode ser nulo. O campo sem aspas igual a este texto é nulo em qualquer coluna.",
    emptyAsNull: "Campo vazio vira nulo",
    emptyAsNullHint: "Numa coluna que não é de texto, o campo vazio é sempre nulo.",
    trim: "Tirar os espaços das pontas",
    skipEmptyLines: "Pular linhas vazias",
    unguardFormulas: "Tirar o apóstrofo da proteção contra fórmula",
    unguardFormulasHint:
      "O Exportar CSV do Prism põe um apóstrofo antes do texto que começa com =, +, - ou @, para a planilha não o executar. Ligado, a importação o tira, e o texto volta como era. O texto que de fato começa por um apóstrofo seguido de =, +, - ou @ chega sem ele: para esse arquivo, desligue a opção.",
    sheet: "Planilha",
    hiddenSheet: (name: string) => `${name} (oculta)`,
    jsonNone: "O JSON não tem opção de leitura: o arquivo é lido como UTF-8, como pede o formato.",
    decimal: "Separador decimal",
    decimals: { point: "Ponto (1234.56)", comma: "Vírgula (1234,56)" },
    thousandsDot: "Aceitar o ponto como separador de milhar",
    thousandsDotHint: "1.500 vira mil e quinhentos. Ligue só se o arquivo escreve os milhares com ponto.",
    dates: "Formato das datas",
    dateFormats: { iso: "aaaa-mm-dd", dayMonthYear: "dd/mm/aaaa" },
    valuesHint: "Valem para o texto que vai a uma coluna de número, de data, de data e hora ou de hora.",
  },

  // RN-IMPORT-004 e 007: as recusas dos campos do leitor, na tela e, as mesmas, no `IMPORT_OPTIONS_INVALID` da API.
  problems: {
    nullTextControl: "O texto do nulo não pode ter caractere de controle.",
    nullTextLength: "O texto do nulo pode ter até 100 caracteres.",
    commitEvery: "Use de 1 a 1.000.000 linhas.",
  },

  // RN-IMPORT-007: a prévia do arquivo.
  preview: {
    title: "Prévia do arquivo",
    reading: "Lendo o arquivo…",
    line: "Linha",
    item: "Item",
    columns: (count: number) => `${formatCount(count)} ${plural(count, "coluna", "colunas")}`,
    encodingName: (name: string, bom: boolean) => `${name}${bom ? " com BOM" : ""}`,
    delimiterNames: { ";": "ponto e vírgula", ",": "vírgula", "\t": "tabulação", "|": "barra vertical" } as Record<string, string>,
    oneColumn: "uma coluna só",
    sheet: (name: string) => `Planilha ${name}`,
    list: (key: string) => `Lista em ${key}`,
    rootList: "Lista de objetos",
    hiddenColumns: (count: number) => (count === 1 ? "A outra coluna não aparece na prévia." : `As outras ${formatCount(count)} colunas não aparecem na prévia.`),
    noRows: "O arquivo não tem linhas para importar.",
    short: (line: number, values: number, header: boolean, expected: number) =>
      `A linha ${formatCount(line)} tem ${formatCount(values)} ${plural(values, "valor", "valores")}, e ${header ? "o cabeçalho" : "a primeira linha"} tem ${formatCount(expected)}: os que faltam vão como nulo.`,
    nullValue: "NULL",
  },

  // RN-IMPORT-009 a 011: Mapeamento.
  mapping: {
    loading: (schema: string, table: string) => `Lendo as colunas de ${schema}.${table}…`,
    refreshing: "Atualizando a prévia…",
    loadFailed: (schema: string, table: string) => `Não foi possível ler as colunas de ${schema}.${table}.`,
    refreshFailed: "Não foi possível atualizar a prévia.",
    retry: "Tentar de novo",
    tableMissing: (schema: string, table: string) => `A tabela ${schema}.${table} não existe mais.`,
    readOnly: "A conexão é somente leitura, e a importação grava na tabela. Nada foi enviado ao banco.",
    title: "Colunas",
    fileColumn: "Coluna do arquivo",
    sourceColumn: "Coluna da origem",
    tableColumn: "Coluna da tabela",
    type: "Tipo",
    choiceLabel: (name: string) => `Coluna da tabela para ${name}`,
    skip: "Não importar",
    required: "obrigatória",
    filledByDatabase: "preenchida pelo banco",
    computedByDatabase: "calculada pelo banco",
    computedReason: "O banco calcula esta coluna e não aceita valor.",
    typeReason: "O Prism ainda não importa este tipo neste banco.",
    binaryReason: "Binário só vai para uma coluna binária.",
    money: "O banco lê este valor no formato de moeda do servidor.",
    ambiguous: "Mais de uma coluna da tabela casa com este nome.",
    byName: "Mapear pelo nome",
    none: "Não importar nenhuma",
    moved: (target: string, from: string) => `${target} deixou de receber ${from}.`,
    defaults: "Ficam com o padrão da tabela:",
    nullDefault: "nulo",
    noneMapped: "Escolha ao menos uma coluna da tabela para receber valores.",
    requiredWarning: (names: readonly string[]) =>
      names.length === 1
        ? `${names[0]} é obrigatória (não aceita nulo e não tem padrão) e não recebe valor: o banco vai recusar as linhas, a não ser que um gatilho da tabela a preencha.`
        : `As colunas ${listOf(names)} são obrigatórias (não aceitam nulo e não têm padrão), e não recebem valor: o banco vai recusar as linhas, a não ser que um gatilho da tabela as preencha.`,
    byDefaultWarning: (name: string, copy: boolean) =>
      `${name} é preenchida pelo banco quando fica sem valor. Com os valores ${copy ? "da origem" : "do arquivo"}, o contador do banco não anda, e as linhas criadas depois sem ${name} podem repetir um valor ${copy ? "copiado" : "importado"}.`,
    notNullDefaultWarning: (name: string, value: string, copy: boolean) =>
      `${name} não aceita nulo e tem padrão (${value}): ${copy ? "um nulo da origem vai como nulo" : "um valor vazio ou ausente do arquivo vai como nulo"}, e não como o padrão, e o banco recusa a linha.`,
    previewTitle: "Prévia, já convertida",
    convertsAll: (rows: number) => (rows === 1 ? "A primeira linha converte." : `As ${formatCount(rows)} primeiras linhas convertem.`),
    problems: (values: number, rows: number, line: number) =>
      `${formatCount(values)} ${plural(values, "valor", "valores")} ${rows === 1 ? "da primeira linha" : `das ${formatCount(rows)} primeiras linhas`} ${plural(values, "não converte", "não convertem")}: a importação vai parar na linha ${formatCount(line)} do arquivo.`,
    checksPostgres: "A prévia confere a conversão dos valores. O tamanho, as restrições e as chaves, o banco confere ao gravar, e o número ou a hora com mais casas que a coluna, ele arredonda.",
    checksIbm: "A prévia confere a conversão dos valores. O tamanho, as restrições e as chaves, o banco confere ao gravar.",
    rowProblem: "Problema da linha",
  },

  // RN-IMPORT-024: as notas da conversão na cópia, por par de colunas.
  copyNotes: {
    classes: { text: "texto", number: "número", date: "data", dateTime: "data e hora", time: "hora", boolean: "lógico", binary: "binário", other: "outro tipo" } as Record<string, string>,
    differentClass: (source: string, target: string) => `A origem é ${source}, e o destino é ${target}: cada valor é convertido, e o que não converter para a cópia.`,
    zoneDropped: "A hora vai como o PostgreSQL a escreve no fuso da sessão, sem o fuso.",
    timeToDate: "A origem tem hora, e o destino é só data: o valor com hora que não é zero para a cópia.",
    fewerPlaces: (source: number, target: number) => `A origem tem até ${formatCount(source)} ${plural(source, "casa", "casas")}, e o destino guarda ${formatCount(target)}: o valor com mais casas que não são zero para a cópia.`,
    postgresRounds: (source: number, target: number) => `A origem tem até ${formatCount(source)} ${plural(source, "casa", "casas")}, e o destino guarda ${formatCount(target)}: o PostgreSQL arredonda o valor.`,
    db2Fraction: "O driver entrega até 7 casas de fração: as outras se perdem.",
    money: "O money sai no formato de moeda do servidor (R$ 1.234,56), que não é um número: copie de uma consulta com money::numeric.",
  },

  // RN-IMPORT-012: Carga.
  load: {
    empty: "Esvaziar a tabela antes de importar",
    emptyCopy: "Esvaziar a tabela antes de copiar",
    emptyHint: (schema: string, table: string, copy: boolean) =>
      `Apaga todas as linhas de ${schema}.${table} antes da primeira linha ${copy ? "da origem" : "do arquivo"}, com um DELETE sem WHERE. Os gatilhos de exclusão disparam, e as chaves estrangeiras com exclusão em cascata apagam também linhas de outras tabelas.`,
    emptyWarning: (schema: string, table: string, copy: boolean) => `Todas as linhas de ${schema}.${table} serão apagadas antes da ${copy ? "cópia" : "importação"}.`,
    cascade: (tables: string) => `A exclusão em cascata apaga também linhas de ${tables}.`,
    setNull: (tables: string, table: string, rule: "null" | "default" | "both") =>
      `A exclusão também altera linhas de ${tables}: as colunas delas que apontam para ${table} ficam ${rule === "null" ? "nulas" : rule === "default" ? "com o padrão" : "nulas (ou com o padrão)"}.`,
    restrict: (tables: string, table: string, copy: boolean) =>
      `As linhas de ${tables} que apontam para ${table} impedem o esvaziamento: se houver alguma, o banco recusa o DELETE, e a ${copy ? "cópia" : "importação"} para sem gravar nada.`,
    restrictNoLog: "Sem log de transação, o DELETE que o banco recusa no meio pode já ter apagado parte das linhas.",
    andMore: (count: number) => `(e mais ${formatCount(count)})`,
    commit: "Commit",
    every: "A cada",
    everyRows: "linhas",
    everyLabel: "Linhas por commit",
    everyHint: (copy: boolean) => `Se a ${copy ? "cópia" : "importação"} parar, as linhas já confirmadas ficam na tabela, e as da transação em andamento são desfeitas.`,
    single: "Tudo numa transação só",
    singleHint: (copy: boolean) =>
      `Se a ${copy ? "cópia" : "importação"} parar, nada fica, e a tabela volta a ser o que era. A transação longa segura as travas da tabela até o fim e, com muitas linhas, pode encher o log do banco (no Informix, o próprio banco desfaz a transação longa).`,
    emptyEvery: (rows: string, copy: boolean) =>
      `O esvaziamento é confirmado junto com as primeiras ${rows} linhas. Se a ${copy ? "cópia" : "importação"} parar depois disso, as linhas antigas não voltam: a tabela fica só com as ${copy ? "copiadas" : "importadas"} até ali. Para tudo ou nada, escolha Tudo numa transação só.`,
    check: "Conferir o arquivo inteiro antes de gravar",
    checkHint:
      "Lê o arquivo todo antes de gravar a primeira linha e para no primeiro valor que o Prism recusa, sem tocar na tabela. O que só o banco confere (o tamanho do texto, as restrições, as chaves e, no PostgreSQL, a conversão) aparece ao gravar. Num arquivo grande, a leitura a mais leva alguns minutos.",
    onFailure: "Se uma linha falhar",
    onFailureText: (copy: boolean) =>
      `A ${copy ? "cópia" : "importação"} para na primeira linha que falhar: a transação em andamento é desfeita, e as linhas já confirmadas ficam. A linha que repete uma chave da tabela também para a ${copy ? "cópia" : "importação"}.`,
    noLog: (copy: boolean) =>
      `Este banco não tem log de transação: cada linha é gravada sozinha, na hora. Se a ${copy ? "cópia" : "importação"} parar, as linhas anteriores já estão gravadas, e o esvaziamento não volta atrás.`,
    informix: "No Informix cada linha vai num comando: muitas linhas levam mais tempo que nos outros bancos.",
  },

  // RN-IMPORT-013: Confirmação.
  confirmation: {
    file: "Arquivo",
    values: "Valores",
    target: "Destino",
    columns: "Colunas",
    load: "Carga",
    withHeader: "com cabeçalho",
    withoutHeader: "sem cabeçalho",
    sheet: (name: string) => `planilha ${name}`,
    list: (key: string) => `lista em ${key}`,
    rootList: "lista de objetos",
    decimalPoint: "decimal com ponto",
    decimalComma: "decimal com vírgula",
    decimalCommaThousands: "decimal com vírgula e ponto de milhar",
    datesOf: (format: string) => `datas ${format}`,
    columnsOf: (mapped: number, fileColumns: number, used: number, tableColumns: number, copy: boolean) =>
      `${formatCount(mapped)} de ${formatCount(fileColumns)} ${plural(fileColumns, "coluna", "colunas")} ${copy ? "da origem" : "do arquivo"}, em ${formatCount(used)} ${plural(tableColumns, "da", "das")} ${formatCount(tableColumns)} ${plural(tableColumns, "coluna", "colunas")} da tabela`,
    pair: (from: string, to: string) => `${from} → ${to}`,
    empties: "Esvazia a tabela antes",
    checks: "confere o arquivo antes",
    noCheck: "sem conferir o arquivo antes",
    commitEvery: (rows: string) => `commit a cada ${rows} linhas`,
    single: "numa transação só",
    oneAtATime: "cada linha gravada sozinha",
    previewProblems: (values: number, rows: number, line: number) =>
      `${rows === 1 ? "Na primeira linha" : `Nas ${formatCount(rows)} primeiras linhas`}, ${formatCount(values)} ${plural(values, "valor não converte", "valores não convertem")}: a importação vai parar na linha ${formatCount(line)} do arquivo.`,
    unsaved: (table: string, count: number, empty: boolean) =>
      empty
        ? `A aba de registros de ${table} tem ${formatCount(count)} ${plural(count, "alteração não salva", "alterações não salvas")}: depois de esvaziar a tabela, ${plural(count, "ela não acha", "elas não acham")} mais as linhas.`
        : `A aba de registros de ${table} tem ${formatCount(count)} ${plural(count, "alteração não salva", "alterações não salvas")}. A importação não ${plural(count, "a leva, e ela continua pendente", "as leva, e elas continuam pendentes")}.`,
    understand: (schema: string, table: string) => `Entendo que as linhas atuais de ${schema}.${table} serão apagadas.`,
    understandFirst: "Marque que entende que a tabela será esvaziada.",
    outsideElectron: "Importar só funciona no app do Prism.",
    tooLarge: "O pedido passa de 8 MiB, por causa dos nomes das colunas. Deixe colunas de fora no Mapeamento.",
    limitReached: "Já há 3 transferências em andamento (exportações, importações ou cópias para outro banco). Espere uma terminar, ou cancele uma na barra de status.",
    connectionMissing: "A conexão não existe mais.",
    userNameMissing: "Esta conexão não tem usuário gravado. Preencha-o em Editar conexão e importe de novo.",
    passwordMissing: "Esta conexão não tem senha gravada. Preencha-a em Editar conexão e importe de novo.",
    sourceUserNameMissing: "A conexão de origem não tem usuário gravado. Preencha-o em Editar conexão e copie de novo.",
    sourcePasswordMissing: "A conexão de origem não tem senha gravada. Preencha-a em Editar conexão e copie de novo.",
    targetUserNameMissing: "A conexão de destino não tem usuário gravado. Preencha-o em Editar conexão e copie de novo.",
    targetPasswordMissing: "A conexão de destino não tem senha gravada. Preencha-a em Editar conexão e copie de novo.",
  },

  // RN-PROT-001, RN-IMPORT-013 e 025: o aviso antes de gravar, pela conexão de destino.
  question: {
    emptyAndImport: "Esvaziar a tabela e importar?",
    import: "Importar dados?",
    emptyAndCopy: "Esvaziar a tabela e copiar?",
    copy: "Copiar dados?",
    emptyDoes: (target: string, source: string) => `Apaga todas as linhas de ${target} e grava as de ${source}.`,
    writeDoes: (source: string, target: string) => `Grava as linhas de ${source} em ${target}.`,
    confirmImport: "Importar mesmo assim",
    confirmCopy: "Copiar mesmo assim",
  },

  // RN-IMPORT-019 e 027: a barra de status.
  status: {
    importing: (file: string, table: string) => `Importando ${file} para ${table}…`,
    copying: (source: string, table: string) => `Copiando ${source} para ${table}…`,
    connecting: "conectando",
    counting: "contando as linhas",
    checking: (percent: number) => `conferindo o arquivo, ${percent}%`,
    checkingHint: (read: string, size: string) => `Conferindo o arquivo antes de gravar: nada foi gravado ainda · ${read} de ${size} lidos`,
    emptying: "esvaziando a tabela",
    committing: "confirmando",
    percent: (percent: number) => `${percent}%`,
    rows: (rows: number) => `${formatCount(rows)} ${plural(rows, "linha", "linhas")}`,
    loadedHint: (rows: number, committed: number | null, read: string | null, size: string | null) =>
      [
        committed === null
          ? `${formatCount(rows)} ${plural(rows, "linha gravada", "linhas gravadas")}`
          : `${formatCount(rows)} ${plural(rows, "linha gravada", "linhas gravadas")}, ${formatCount(committed)} ${plural(committed, "confirmada", "confirmadas")}`,
        read === null || size === null ? null : `${read} de ${size} lidos`,
      ]
        .filter((part) => part !== null)
        .join(" · "),
    copiedHint: (rows: number, total: number | null, committed: number) =>
      `${total === null ? `${formatCount(rows)} ${plural(rows, "linha", "linhas")}` : `${formatCount(rows)} de ${formatCount(total)} linhas`} · ${formatCount(committed)} ${plural(committed, "confirmada", "confirmadas")}`,
    lostImport: "Não foi possível saber como está a importação.",
    lostCopy: "Não foi possível saber como está a cópia.",
    cancelling: "Cancelando…",
    cancel: "Cancelar",
    cancelImportLabel: (file: string) => `Cancelar a importação de ${file}`,
    cancelCopyLabel: (source: string) => `Cancelar a cópia de ${source}`,
    importProgressLabel: (file: string) => `Progresso da importação de ${file}`,
    copyProgressLabel: (source: string) => `Progresso da cópia de ${source}`,
    failedImport: (table: string) => `A importação para ${table} parou.`,
    failedCopy: (source: string, table: string) => `A cópia de ${source} para ${table} parou.`,
    showError: "Ver o erro",
    discard: "Descartar",
    more: (count: number, kind: "export" | "import" | "copy" | "mixed") => {
      switch (kind) {
        case "export":
          return `+${count} ${plural(count, "exportação", "exportações")}`;
        case "import":
          return `+${count} ${plural(count, "importação", "importações")}`;
        case "copy":
          return `+${count} ${plural(count, "cópia", "cópias")}`;
        case "mixed":
          return `+${count} ${plural(count, "transferência", "transferências")}`;
      }
    },
    listLabel: "Transferências desta janela",
  },

  // RN-IMPORT-019 e 027: o "Cancelar" que pergunta quando algo já ficou na tabela.
  cancelQuestion: {
    importTitle: (table: string) => `Cancelar a importação para ${table}?`,
    copyTitle: (source: string, table: string) => `Cancelar a cópia de ${source} para ${table}?`,
    committed: (committed: number) =>
      `${committed === 1 ? "A linha já confirmada fica" : `As ${formatCount(committed)} linhas já confirmadas ficam`} na tabela, e as da transação em andamento são desfeitas.`,
    committedEmptied: (committed: number) =>
      `${committed === 1 ? "A linha já confirmada fica" : `As ${formatCount(committed)} linhas já confirmadas ficam`} na tabela, e as linhas antigas, apagadas pelo esvaziamento, não voltam.`,
    written: (rows: number) => (rows === 1 ? "A linha já gravada fica na tabela." : `As ${formatCount(rows)} linhas já gravadas ficam na tabela.`),
    emptyingNoLog: "O esvaziamento já começou, e as linhas que ele apagou não voltam.",
    unknown: "As linhas já confirmadas ficam na tabela.",
    cancelImport: "Cancelar a importação",
    keepImporting: "Continuar importando",
    cancelCopy: "Cancelar a cópia",
    keepCopying: "Continuar copiando",
  },

  // RN-IMPORT-020 e 027: o fim.
  toasts: {
    imported: (rows: number, table: string) => `${formatCount(rows)} ${plural(rows, "linha importada", "linhas importadas")} em ${table}.`,
    copied: (rows: number, source: string, table: string) => `${formatCount(rows)} ${plural(rows, "linha copiada", "linhas copiadas")} de ${source} para ${table}.`,
    lateImport: (table: string, rows: number) => `A importação para ${table} já tinha terminado quando o cancelamento chegou: ${formatCount(rows)} ${plural(rows, "linha importada", "linhas importadas")}.`,
    lateCopy: (source: string, table: string, rows: number) => `A cópia de ${source} para ${table} já tinha terminado quando o cancelamento chegou: ${formatCount(rows)} ${plural(rows, "linha copiada", "linhas copiadas")}.`,
    openRecords: "Abrir registros",
    emptied: "A tabela foi esvaziada antes.",
    skippedLines: (count: number) => (count === 1 ? "1 linha vazia do arquivo foi pulada." : `${formatCount(count)} linhas vazias do arquivo foram puladas.`),
    unguarded: (count: number) => (count === 1 ? "1 valor perdeu o apóstrofo da proteção contra fórmula." : `${formatCount(count)} valores perderam o apóstrofo da proteção contra fórmula.`),
    shortRows: (count: number) =>
      count === 1 ? "1 linha tinha menos valores que o cabeçalho e foi completada com nulo." : `${formatCount(count)} linhas tinham menos valores que o cabeçalho e foram completadas com nulo.`,
    formulasWithoutValue: (count: number) =>
      count === 1 ? "1 célula com fórmula sem resultado guardado chegou vazia." : `${formatCount(count)} células com fórmula sem resultado guardado chegaram vazias.`,
    failedImport: (table: string) => `A importação para ${table} parou.`,
    failedCopy: (source: string, table: string) => `A cópia de ${source} para ${table} parou.`,
    canceledImport: (table: string) => `Importação para ${table} cancelada.`,
    canceledCopy: (source: string, table: string) => `Cópia de ${source} para ${table} cancelada.`,
    canceledUncertainImport: (table: string) => `Importação para ${table} cancelada, mas o banco não respondeu ao cancelamento: o Prism não sabe o que ficou na tabela. Confira-a.`,
    canceledUncertainCopy: (source: string, table: string) => `Cópia de ${source} para ${table} cancelada, mas o banco não respondeu ao cancelamento: o Prism não sabe o que ficou na tabela. Confira-a.`,
    connectionDeletedImport: (table: string) => `A importação para ${table} foi cancelada: a conexão foi excluída.`,
    connectionDeletedCopy: (source: string, table: string) => `A cópia de ${source} para ${table} foi cancelada: a conexão foi excluída.`,
    readOnlyImport: (table: string) => `A importação para ${table} parou: a conexão passou a ser somente leitura.`,
    readOnlyCopy: (source: string, table: string) => `A cópia de ${source} para ${table} parou: a conexão de destino passou a ser somente leitura.`,
    lostImport: (table: string) => `A importação para ${table} se perdeu: o Prism não sabe o que ficou na tabela. Confira-a.`,
    lostCopy: (source: string, table: string) => `A cópia de ${source} para ${table} se perdeu: o Prism não sabe o que ficou na tabela. Confira-a.`,
    sqlState: (state: string) => `SQLSTATE ${state}`,
    // Onde a falha aconteceu (RN-IMPORT-020 e 027).
    fileLine: (line: number) => `Linha ${formatCount(line)} do arquivo`,
    listItem: (line: number) => `Item ${formatCount(line)} da lista`,
    sheetLine: (line: number, sheet: string) => `Linha ${formatCount(line)} da planilha ${sheet}`,
    sourceLine: (line: number) => `Linha ${formatCount(line)} da origem`,
    column: (name: string) => `coluna ${name}`,
    inRange: (first: number, last: number, copy: boolean) => `Nas linhas ${formatCount(first)} a ${formatCount(last)} ${copy ? "da origem" : "do arquivo"}`,
    readingSource: "Ao ler a origem:",
    writingTarget: "Ao gravar no destino:",
    // O que ficou na tabela (RN-IMPORT-020).
    committedStayed: (committed: number) =>
      committed === 1 ? "1 linha confirmada ficou na tabela; as da transação em andamento foram desfeitas." : `${formatCount(committed)} linhas confirmadas ficaram na tabela; as da transação em andamento foram desfeitas.`,
    nothingStayed: "Nenhuma linha foi gravada, e a tabela está como antes.",
    previousStayed: (rows: number) => (rows === 1 ? "A linha anterior ficou gravada." : `As ${formatCount(rows)} linhas anteriores ficaram gravadas.`),
    writtenStayed: (rows: number) => (rows === 1 ? "A linha gravada até ali ficou na tabela." : `As ${formatCount(rows)} linhas gravadas até ali ficaram na tabela.`),
    noneWrittenNoLog: "Nenhuma linha foi gravada.",
    partlyEmptied: (copy: boolean) => `A tabela pode ter sido esvaziada em parte; nenhuma linha ${copy ? "da origem" : "do arquivo"} foi gravada.`,
    uncertainCommit: (first: number, last: number) => `A conexão caiu durante a confirmação ${rangeOf(first, last)}: o Prism não sabe se ${first === last ? "ela foi gravada" : "elas foram gravadas"}. Confira a tabela.`,
    uncertainEmptyCommit: (first: number, last: number) =>
      `A conexão caiu durante a confirmação do esvaziamento e ${rangeOf(first, last)}: o Prism não sabe se a tabela foi esvaziada nem se as linhas foram gravadas. Confira a tabela.`,
    uncertainEmptyOnly: "A conexão caiu durante a confirmação do esvaziamento: o Prism não sabe se a tabela foi esvaziada. Confira a tabela.",
    uncertainRow: (line: number) => `A conexão caiu durante a gravação da linha ${formatCount(line)}: o Prism não sabe se ela foi gravada. Confira a tabela.`,
    uncertainCancel: "O banco não respondeu ao cancelamento: o Prism não sabe o que ficou na tabela. Confira-a.",
  },

  // RN-IMPORT-020: a entrada da falha e o diálogo dela.
  failure: {
    importTitle: "Importação interrompida",
    copyTitle: "Cópia interrompida",
    file: "Arquivo",
    source: "Origem",
    table: "Tabela",
    line: "Linha",
    column: "Coluna",
    message: "Mensagem",
    sqlState: "SQLSTATE",
    stayed: "O que ficou",
    copyMessage: "Copiar a mensagem",
    copied: "Mensagem copiada.",
    notCopied: "Não foi possível copiar a mensagem.",
    close: "Fechar",
  },

  // RN-IMPORT-020: os Registros abertos da tabela que recebeu linhas.
  records: {
    imported: "Linhas foram importadas nesta tabela depois da leitura.",
    refresh: "Atualizar",
  },

  // RN-IMPORT-021: as saídas, com importações ou cópias.
  exits: {
    count: (exports: number, imports: number, copies: number) => {
      const parts = [
        exports > 0 ? `${formatCount(exports)} ${plural(exports, "exportação", "exportações")}` : null,
        imports > 0 ? `${formatCount(imports)} ${plural(imports, "importação", "importações")}` : null,
        copies > 0 ? `${formatCount(copies)} ${plural(copies, "cópia para outro banco", "cópias para outro banco")}` : null,
      ].filter((part): part is string => part !== null);
      const total = exports + imports + copies;
      if (parts.length === 1) return `Há ${parts[0]} em andamento.`;
      return `Há ${formatCount(total)} transferências em andamento: ${listOf(parts)}.`;
    },
  },
} as const;
