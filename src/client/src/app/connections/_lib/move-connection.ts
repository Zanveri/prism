import type { Connection, ConnectionInput } from "./connections.schema";

/**
 * O pedido de mover uma conexão para outra pasta pelo navegador (RN-NAV-003; na tela de Conexões era trocar a pasta no formulário). O
 * `PATCH` leva a conexão por inteiro, então vai como está, só com a pasta nova; a senha nula mantém a gravada (RN-CONN-004).
 */
export function movedConnectionInput(connection: Connection, folderID: string | null): ConnectionInput {
  return {
    name: connection.name,
    folderID,
    engine: connection.engine,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    userName: connection.userName,
    password: null,
    environmentName: connection.environmentName,
    environmentColor: connection.environmentColor,
  };
}
