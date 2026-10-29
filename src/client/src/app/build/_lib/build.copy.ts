/** Textos do modo Construir (RN-CONSTRUIR-*). */
export const buildCopy = {
  emptyModels: "Nenhum modelo aberto.",
  emptyModelsHint:
    "Abra um modelo salvo ou crie um novo: as tabelas dele aparecem aqui, separadas entre as que você vai criar e as que já existem no banco.",
  sidebarTitle: "Tabelas do modelo",
  hideSidebarLabel: "Ocultar tabelas do modelo",
  showSidebarLabel: "Mostrar tabelas do modelo",
  newTableLabel: "Nova tabela",
  newTableTitle: "Nova tabela (Alt+N)",
  importTablesLabel: "Importar tabelas de um banco",
  filterTablesPlaceholder: "Filtrar tabelas e colunas",
  newSchemaBadge: "novo esquema",
  existingSchemaBadge: "existente",
  changedTableBadge: "alterada",
  droppedTableBadge: "excluir",
  relationsSection: "Relações",
  indexesSection: "Índices",
  viewProblems: "Ver problemas",
  openModelsNavLabel: "Modelos abertos",
  savedModelsLink: "Modelos salvos",
  modelsTitle: "Modelos",
  modelsSubtitle:
    "Cada modelo guarda as tabelas, as relações, os índices e a posição de cada tabela no diagrama. Fica no seu cofre, cifrado como as conexões.",
  openFileButton: "Abrir arquivo .sql ou .dbml",
  newModelButton: "Novo modelo",
  filterModelsPlaceholder: "Filtrar modelos pelo nome ou pela tabela",
  colModel: "Modelo",
  colEngine: "Destino",
  colStart: "Ponto de partida",
  colTables: "Tabelas",
  colUpdated: "Alterado",
  colActions: "Ações",
  openAction: "Abrir",
  renameAction: "Renomear",
  duplicateAction: "Duplicar",
  exportDbmlAction: "Exportar DBML",
  exportDdlAction: "Exportar DDL",
  exportPngAction: "Exportar diagrama",
  deleteModelAction: "Excluir modelo…",
  deleteModelTitle: (name: string) => `Excluir o modelo "${name}"?`,
  deleteModelDescription:
    "O modelo será removido do cofre. As tabelas no banco de dados não são afetadas.",
  deleteModelConfirm: "Excluir modelo",
  toolbarTarget: "Destino",
  toolbarTargetHint: "O banco de destino é escolhido ao criar o modelo",
  toolbarBase: "Base",
  toolbarBaseAria: "Base das tabelas existentes",
  toolbarReread: "Reler do banco",
  toolbarRereadHint: "Relê as tabelas existentes do banco; o que você mudou nelas fica",
  toolbarUndo: "Desfazer (Ctrl+Z)",
  toolbarRedo: "Refazer (Ctrl+Shift+Z)",
  toolbarExport: "Exportar",
  toolbarGenerateDdl: "Gerar DDL",
  saveSaved: "Salvo no cofre",
  savePending: "Alterações pendentes…",
  saveSaving: "Salvando no cofre…",
  saveFailed: "Falha ao salvar no cofre",
  saveConflict: "Este modelo foi salvo em outra janela",
  reloadModel: "Recarregar o salvo",
  keepMineModel: "Manter o meu e salvar por cima",
  editorGroupLabel: "Forma de editar",
  paneSimple: "Simplificado",
  paneSql: "SQL",
  paneDbml: "DBML",
  paneSameModelHint: "As três editam o mesmo modelo",
  footerVaultOpen: (user: string) => `Cofre de ${user} aberto`,
  footerSavedModelsCount: (count: number) =>
    `${count} ${count === 1 ? "modelo salvo" : "modelos salvos"}`,
  diagramLabel: "Diagrama do modelo",
  diagramTableRemoved: (table: string) => `Tabela "${table}" removida.`,
  undoAction: "Desfazer",
  problems: {
    e1: (target: string) =>
      `Nome de ${target} vazio ou com caractere de controle. O banco rejeita identificadores assim.`,
    e2: (name: string) =>
      `O nome ${name} está repetido no mesmo escopo. O banco não permite dois objetos com o mesmo nome.`,
    e3: (table: string) =>
      `A tabela ${table} não tem colunas. Todo CREATE TABLE exige ao menos uma coluna.`,
    e4: (table: string, column: string) =>
      `${table}.${column} está sem tipo. Toda coluna precisa de um tipo válido no banco.`,
    e5: (table: string, ref: string) =>
      `${table} referencia ${ref}, que não existe no modelo. O banco rejeita a FK ao criar ou alterar a tabela.`,
    e6: (table: string, refTable: string) =>
      `A FK em ${table} tem número de colunas diferente da referência em ${refTable}.`,
    e7: (table: string, refTable: string, cols: string) =>
      `A FK em ${table} aponta para ${refTable} (${cols}), que não é PK nem único. O banco exige restrição única no destino.`,
    e8: (table: string, indexName: string) =>
      `O índice ${indexName} em ${table} está sem colunas ou referencia coluna inexistente.`,
    e9: (name: string, maxBytes: number) =>
      `O identificador ${name} passa do limite de ${maxBytes} bytes do banco de destino.`,
    e10: (table: string, column: string, type: string) =>
      `${table}.${column} tem auto-incremento no tipo ${type}. Só tipos inteiros aceitam identidade/serial.`,
    e11: (table: string, action: string) =>
      `A FK em ${table} usa a ação ${action}, que este banco não aceita.`,
    e12: (table: string, column: string, type: string) =>
      `${table}.${column} usa ${type}. No Informix, varchar vai até 255 bytes; acima disso use lvarchar.`,
    e13: (table: string) =>
      `${table} está marcada para excluir, mas outra tabela que fica no modelo ainda tem FK para ela.`,
    e14: (table: string) =>
      `${table} é uma tabela existente com alteração de PK, auto-incremento ou esquema, que não cabe no ALTER automático.`,
    w1: (table: string) =>
      `A tabela nova ${table} está sem chave primária. Sem PK, linhas duplicadas não são barradas e FKs não têm onde apontar.`,
    w2: (
      table: string,
      column: string,
      type: string,
      refTable: string,
      refColumn: string,
      refType: string,
    ) =>
      `${table}.${column} é ${type} e aponta para ${refTable}.${refColumn}, que é ${refType}. Um id acima de 2.147.483.647 não caberia.`,
    w3: () =>
      `Estas colunas de FK não começam nenhum índice. Buscar por elas, ou excluir a linha referenciada, lê a tabela inteira.`,
    w4: (name: string, isInformix: boolean) =>
      isInformix
        ? `O nome ${name} precisa de aspas duplas; no Informix isso exige DELIMIDENT ativo na sessão.`
        : `O nome ${name} precisa de aspas duplas em todas as consultas neste banco.`,
    w5: (table: string, column: string, type: string, suggestion: string | null) =>
      suggestion
        ? `${table}.${column} usa o tipo ${type}, fora do catálogo padrão. Talvez você queira ${suggestion}.`
        : `${table}.${column} usa o tipo ${type}, fora do catálogo padrão do banco.`,
    w6: (table: string, refTable: string, cols: string) =>
      `A FK em ${table} aponta para ${refTable} (${cols}), que não consta como PK nem índice único na tabela existente.`,
    w7: (table: string) =>
      `A tabela nova ${table} tem o mesmo nome de uma tabela que já existe no banco e não foi importada para o modelo.`,
    w10DropTable: (table: string) =>
      `DROP TABLE em ${table} apaga a tabela e todas as linhas dela no banco.`,
    w10DropColumn: (table: string, column: string) =>
      `DROP COLUMN em ${table}.${column} apaga os dados dessa coluna no banco.`,
    w10NarrowType: (table: string, column: string, fromType: string, toType: string) =>
      `${table}.${column} muda de ${fromType} para ${toType}, o que pode truncar dados ou falhar se houver valores maiores.`,
    w11: (table: string, column: string) =>
      `${table}.${column} passa a ser NOT NULL sem valor padrão. Se a tabela já tiver linhas no banco, o ALTER TABLE falha.`,
    w12: (table: string, refTable: string) =>
      `${table} aponta para ${refTable}, que não está no modelo. No banco de destino, ela precisa existir antes deste script.`,
    w14: (table: string, column: string, defaultExpr: string) =>
      `${table}.${column} usa ${defaultExpr}, mas o script não cria a sequência correspondente.`,
    i1: (baseLabel: string) =>
      `"Abrir na Área de trabalho" põe o script numa aba nova de ${baseLabel}. Nada roda até você executar, e a confirmação de comando irreversível vale como em qualquer aba.`,
    i2: (readAt: string) =>
      `As diferenças são contra a leitura de ${readAt}. Se alguém mudou o banco depois, releia antes de rodar: o que você mudou no modelo fica.`,
    i3: (baseLabel: string) =>
      `As tabelas existentes já estão em ${baseLabel}: lá, este script falha no primeiro CREATE. Ao abrir na Área de trabalho, o Prism pergunta a conexão.`,
  },
} as const;
