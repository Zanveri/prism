/**
 * Caminhos da API, com a grafia do controller (seção 6 da especificação). Um recurso, uma
 * constante; cada tela acrescenta os seus. O que leva um `id` na rota é função.
 */
export const prismEndpoints = {
  publicSessions: "api/public/sessions",
  publicUsers: "api/public/users",
  userPassword: "api/user/password",
  userFolders: "api/user/folders",
  userFolder: (id: string) => `api/user/folders/${encodeURIComponent(id)}`,
  userConnections: "api/user/connections",
  userConnection: (id: string) => `api/user/connections/${encodeURIComponent(id)}`,
  userConnectionPasswordReveal: (id: string) => `api/user/connections/${encodeURIComponent(id)}/password/reveal`,
  userConnectionDuplicate: (id: string) => `api/user/connections/${encodeURIComponent(id)}/duplicate`,
  userConnectionsTest: "api/user/connections/test",
  userConnectionVerification: (id: string) => `api/user/connections/${encodeURIComponent(id)}/verification`,
  // Seção 34: exportar e importar conexões com as pastas (RN-TRANSF-008, 011 e 014).
  userConnectionsExport: "api/user/connections/export",
  userConnectionsImportPreview: "api/user/connections/import/preview",
  userConnectionsImport: "api/user/connections/import",
  // Seção 40: importar do DBeaver (RN-DBEAVER-016 a 018).
  userConnectionsDbeaver: "api/user/connections/dbeaver",
  userConnectionsDbeaverInvite: "api/user/connections/dbeaver/invite",
  userConnectionsDbeaverScan: "api/user/connections/dbeaver/scan",
  userConnectionsDbeaverPreview: "api/user/connections/dbeaver/import/preview",
  userConnectionsDbeaverImport: "api/user/connections/dbeaver/import",
  userDatabaseSessions: "api/user/database-sessions",
  userDatabaseSession: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}`,
  userDatabaseSessionDatabases: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/databases`,
  userDatabaseSessionSchemas: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/schemas`,
  // RN-BANCO-001 e RN-CAT-010: propriedades somente leitura do servidor e do banco da sessão.
  userDatabaseSessionProperties: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/properties`,
  // RN-BUSCA-002: o índice de nomes das tabelas e visões de todos os esquemas do banco da sessão, para a busca do navegador.
  userDatabaseSessionObjectNames: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/object-names`,
  // Nome de esquema e de tabela vêm do banco e podem ter espaço, aspas, barra e maiúsculas: sempre codificados.
  userDatabaseSessionObjects: (id: string, schema: string, kind: "tables" | "views" | "routines" | "sequences") => `api/user/database-sessions/${encodeURIComponent(id)}/schemas/${encodeURIComponent(schema)}/objects?kind=${kind}`,
  // RN-ESQUEMA-003 e RN-CAT-008: todas as tabelas, colunas e chaves estrangeiras do esquema de uma vez.
  userDatabaseSessionSchemaDiagram: (id: string, schema: string) => `api/user/database-sessions/${encodeURIComponent(id)}/schemas/${encodeURIComponent(schema)}/diagram`,
  userDatabaseSessionColumns: (id: string, schema: string, table: string) => `${tablePath(id, schema, table)}/columns`,
  userDatabaseSessionIndexes: (id: string, schema: string, table: string) => `${tablePath(id, schema, table)}/indexes`,
  userDatabaseSessionChecks: (id: string, schema: string, table: string) => `${tablePath(id, schema, table)}/checks`,
  userDatabaseSessionForeignKeys: (id: string, schema: string, table: string) => `${tablePath(id, schema, table)}/foreign-keys`,
  userDatabaseSessionReferencedBy: (id: string, schema: string, table: string) => `${tablePath(id, schema, table)}/referenced-by`,
  userDatabaseSessionQueries: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries`,
  userDatabaseSessionQueriesNext: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/next`,
  userDatabaseSessionQueriesCount: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/count`,
  userDatabaseSessionQueriesCancel: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/cancel`,
  userDatabaseSessionQueriesEditTarget: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/edit-target`,
  userDatabaseSessionQueriesEdits: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/edits`,
  userDatabaseSessionQueriesEditsPreview: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/edits/preview`,
  userDatabaseSessionQueriesEditsCount: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/edits/count`,
  userDatabaseSessionResultCells: (id: string, resultId: string) => `api/user/database-sessions/${encodeURIComponent(id)}/results/${encodeURIComponent(resultId)}/cells`,
  userScripts: "api/user/scripts",
  userScript: (id: string) => `api/user/scripts/${encodeURIComponent(id)}`,
  // RN-SCRIPT-007: as pastas da seção Scripts, à parte das pastas de conexões.
  userScriptFolders: "api/user/script-folders",
  userScriptFolder: (id: string) => `api/user/script-folders/${encodeURIComponent(id)}`,
  // RN-CONSTRUIR-080: modelos do Construir no cofre.
  userBuildModels: "api/user/build-models",
  userBuildModel: (id: string) => `api/user/build-models/${encodeURIComponent(id)}`,
  userWorkspace: "api/user/workspace",
  userDrivers: "api/user/drivers",
  userDriver: (id: string) => `api/user/drivers/${encodeURIComponent(id)}`,
  userDriverInstall: (id: string) => `api/user/drivers/${encodeURIComponent(id)}/install`,
  userPlugins: "api/user/plugins",
  userPluginsBundles: "api/user/plugins/bundles",
  userPluginsConsent: "api/user/plugins/consent",
  userPluginsInstall: "api/user/plugins/install",
  userPlugin: (id: string) => `api/user/plugins/${encodeURIComponent(id)}`,
  userPluginEnabled: (id: string) => `api/user/plugins/${encodeURIComponent(id)}/enabled`,
  userPluginUpdate: (id: string) => `api/user/plugins/${encodeURIComponent(id)}/update`,
  // RN-EXPORT-016: os trabalhos em segundo plano (a exportação de dados), um registro só para todas as janelas.
  userTransfers: "api/user/transfers",
  userTransferExports: "api/user/transfers/exports",
  userTransferImportsRead: "api/user/transfers/imports/read",
  userTransferImportsPreview: "api/user/transfers/imports/preview",
  userTransferImports: "api/user/transfers/imports",
  userTransferCopiesPreview: "api/user/transfers/copies/preview",
  userTransferCopies: "api/user/transfers/copies",
  userTransfer: (id: string) => `api/user/transfers/${encodeURIComponent(id)}`,
} as const;

function tablePath(id: string, schema: string, table: string) {
  return `api/user/database-sessions/${encodeURIComponent(id)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}`;
}
