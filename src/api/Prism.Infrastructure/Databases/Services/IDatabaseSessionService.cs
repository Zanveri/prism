using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Services;

/// <summary>
/// O registro das sessões abertas com os bancos. É `Singleton` porque uma conexão aberta atravessa várias requisições (decisão 3 do
/// guia da raiz). Fecha tudo o que dependia de um cofre quando ele fecha (RN-COFRE-008) e quando a API encerra (RN-SESSAO-004).
/// </summary>
public interface IDatabaseSessionService
{
    /// <summary>
    /// Abre uma sessão com as credenciais lidas do cofre. `vaultGeneration` é a `IVaultService.Generation` lida ANTES das credenciais:
    /// se o cofre aberto mudou até a conexão ficar pronta, a conexão fecha, nenhuma sessão é registrada e a falha é `VaultChanged`.
    /// Falha ao conectar: `ConnectionFailed`, com a mensagem do banco (RN-SESSAO-003).
    /// </summary>
    Task<Result<DatabaseSessionInfo, DatabaseFailure>> OpenAsync(Guid connectionID, ConnectionSettings settings, long vaultGeneration, CancellationToken cancellationToken);

    /// <summary>RN-CONN-013: abre, roda a consulta de verificação e fecha. Não registra sessão. Falha `ConnectionFailed`.</summary>
    Task<UnitResult<DatabaseFailure>> TestAsync(ConnectionSettings settings, CancellationToken cancellationToken);

    /// <summary>
    /// Fecha a sessão, interrompendo o comando e a contagem que estiverem rodando nela. Espera o comando parar por no máximo dez
    /// segundos; se o banco não responde, abandona a conexão e volta.
    /// </summary>
    Task<UnitResult<DatabaseFailure>> CloseAsync(Guid sessionID);

    /// <summary>RN-CONN-014: fecha as sessões da conexão excluída.</summary>
    Task CloseByConnectionAsync(Guid connectionID);

    Task CloseAllAsync();

    /// <summary>RN-DRIVER-007: se há sessão aberta de algum destes bancos. O driver de um banco não é removido com sessão aberta dele.</summary>
    bool HasOpenSession(IReadOnlyCollection<EDatabaseEngine> engines);

    /// <summary>As consultas de catálogo esperam a vez na sessão (RN-SESSAO-002): a árvore pede vários níveis ao mesmo tempo.</summary>
    Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <param name="kind">`tables`, `views` ou `routines`.</param>
    Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(Guid sessionID, string schema, string kind, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<ColumnInfo>, DatabaseFailure>> GetColumnsAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<IndexInfo>, DatabaseFailure>> GetIndexesAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>> GetForeignKeysAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-004: as chaves estrangeiras que apontam para a tabela, também as dela mesma.</summary>
    Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>> GetReferencingForeignKeysAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-005.</summary>
    Task<Result<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>> GetChecksAsync(Guid sessionID, string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-006.</summary>
    Task<Result<ViewDefinitionInfo, DatabaseFailure>> GetViewDefinitionAsync(Guid sessionID, string schema, string view, CancellationToken cancellationToken);

    /// <summary>RN-CAT-008: o diagrama do esquema inteiro, numa vez só da sessão.</summary>
    Task<Result<SchemaDiagramInfo, DatabaseFailure>> GetDiagramAsync(Guid sessionID, string schema, CancellationToken cancellationToken);

    /// <summary>RN-CAT-010.</summary>
    Task<Result<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>> GetPropertiesAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <summary>RN-ARVORE-006: os bancos do servidor da sessão, com o dela primeiro. Espera a vez, como as outras consultas de catálogo.</summary>
    Task<Result<IReadOnlyList<DatabaseInfo>, DatabaseFailure>> GetDatabasesAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <summary>Executar e carregar mais não esperam: com outro comando rodando na sessão, `SessionBusy` (RN-SESSAO-002).</summary>
    /// <param name="pageSize">RN-SQL-016: as linhas da primeira página e de cada "carregar mais" do cursor que o comando abrir.</param>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(Guid sessionID, string sql, int pageSize, CancellationToken cancellationToken);

    Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <summary>
    /// RN-SQL-006: conta, por outra conexão, o último comando da sessão que devolveu linhas; o cursor da sessão continua como está. Sem
    /// comando desse tipo, `NoQueryToCount`. Se esse comando gravou (RN-SQL-013), o total já veio com a resposta dele e é o que volta
    /// aqui, sem ir ao banco: contar seria gravar de novo.
    /// </summary>
    Task<Result<long, DatabaseFailure>> CountAsync(Guid sessionID, CancellationToken cancellationToken);

    /// <summary>RN-SQL-010: interrompe o comando e a contagem em andamento na sessão. Não afeta um cursor aberto e parado.</summary>
    UnitResult<DatabaseFailure> Cancel(Guid sessionID);

    /// <summary>
    /// RN-EDIT-002, 003 e 010: o que se edita no resultado `resultID` da sessão, pelo catálogo, uma vez por resultado. A consulta vai na
    /// sessão `catalogSessionID` (a da árvore da mesma conexão e do mesmo banco), esperando a vez nela, ou numa conexão à parte, com
    /// prazo de espera de trava; nunca na sessão do resultado, cujo cursor continua aberto. Outro resultado na sessão: `ResultChanged`;
    /// o resultado inteiro só leitura: `ResultNotEditable`, com o motivo.
    /// </summary>
    Task<Result<EditTarget, DatabaseFailure>> GetEditTargetAsync(Guid sessionID, Guid resultID, Guid? catalogSessionID, CancellationToken cancellationToken);

    /// <summary>RN-EDIT-008: os comandos que o "Salvar" executaria, com os valores como literais, sem executar nada.</summary>
    Task<Result<EditPreview, DatabaseFailure>> PreviewEditsAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken);

    /// <summary>
    /// RN-EDIT-005, 011 e 012: o "Salvar", na sessão do resultado, sem esperar a vez (`SessionBusy`). Confere o catálogo dentro da
    /// transação: se a tabela mudou desde o `edit-target`, `ResultChanged`, e nada é executado. Devolve quantas alterações gravou.
    /// </summary>
    Task<Result<int, DatabaseFailure>> ApplyEditsAsync(Guid sessionID, Guid resultID, IReadOnlyList<EditChange> changes, CancellationToken cancellationToken);
}
