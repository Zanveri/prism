import { verificationOf, type Connection, type ConnectionInput } from "./connections.schema";

/**
 * O pedido de mover uma conexão para outra pasta pelo navegador (RN-NAV-003; na tela de Conexões era trocar a pasta no formulário). O
 * `PATCH` leva a conexão por inteiro, então vai como está, só com a pasta nova; a senha nula mantém a gravada (RN-CONN-004). As proteções PRÓPRIAS
 * (RN-PROT-001 e 002) e a verificação (RN-VERIF-001) vão como a conexão as tem: sem elas a API as voltaria ao padrão. As herdadas da pasta não são
 * gravadas nela: mudam com a pasta de destino (RN-PROT-004), e sair de uma pasta somente leitura pede a senha (RN-PROT-003).
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
    confirmCommands: connection.confirmCommands,
    readOnly: connection.readOnly,
    ...(connection.useInternalDescriptions !== undefined ? { useInternalDescriptions: connection.useInternalDescriptions } : {}),
    ...verificationOf(connection),
  };
}
