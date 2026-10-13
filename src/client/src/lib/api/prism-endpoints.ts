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
  userConnectionsTest: "api/user/connections/test",
  userDatabaseSessions: "api/user/database-sessions",
  userDatabaseSession: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}`,
  userDatabaseSessionDatabases: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/databases`,
  userDatabaseSessionSchemas: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/schemas`,
  // Nome de esquema e de tabela vêm do banco e podem ter espaço, aspas, barra e maiúsculas: sempre codificados.
  userDatabaseSessionObjects: (id: string, schema: string, kind: "tables" | "views" | "routines") => `api/user/database-sessions/${encodeURIComponent(id)}/schemas/${encodeURIComponent(schema)}/objects?kind=${kind}`,
  userDatabaseSessionColumns: (id: string, schema: string, table: string) => `${tablePath(id, schema, table)}/columns`,
  userDatabaseSessionIndexes: (id: string, schema: string, table: string) => `${tablePath(id, schema, table)}/indexes`,
  userDatabaseSessionForeignKeys: (id: string, schema: string, table: string) => `${tablePath(id, schema, table)}/foreign-keys`,
  userDatabaseSessionQueries: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries`,
  userDatabaseSessionQueriesNext: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/next`,
  userDatabaseSessionQueriesCount: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/count`,
  userDatabaseSessionQueriesCancel: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/cancel`,
  userDatabaseSessionQueriesEditTarget: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/edit-target`,
  userDatabaseSessionQueriesEdits: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/edits`,
  userDatabaseSessionQueriesEditsPreview: (id: string) => `api/user/database-sessions/${encodeURIComponent(id)}/queries/edits/preview`,
  userDrivers: "api/user/drivers",
  userDriver: (id: string) => `api/user/drivers/${encodeURIComponent(id)}`,
  userDriverInstall: (id: string) => `api/user/drivers/${encodeURIComponent(id)}/install`,
} as const;

function tablePath(id: string, schema: string, table: string) {
  return `api/user/database-sessions/${encodeURIComponent(id)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}`;
}
