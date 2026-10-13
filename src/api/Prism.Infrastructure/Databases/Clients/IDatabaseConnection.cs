using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>
/// Uma conexão aberta com um banco. Os tipos do fornecedor param aqui: para fora só saem os modelos do Prism, e toda falha é um
/// <see cref="DatabaseFailure"/>. Faz um comando por vez: quem a usa (o registro de sessões) garante que duas chamadas não se
/// cruzam, com exceção do <see cref="Cancel"/>, que existe para ser chamado enquanto outra roda.
/// </summary>
public interface IDatabaseConnection : IAsyncDisposable
{
    string ServerVersion { get; }

    /// <summary>`false` quando a conexão caiu (rede, banco reiniciado, sessão derrubada por um administrador): depois de uma falha, é o que diz que ela não serve mais.</summary>
    bool IsOpen { get; }

    /// <summary>RN-CONN-013: a consulta de verificação do banco. Falha `ConnectionFailed`.</summary>
    Task<UnitResult<DatabaseFailure>> PingAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Envia o comando como está, um por vez (RN-SQL-003); controle de transação é recusado com `TransactionControlNotSupported`, sem
    /// ir ao banco. Uma leitura que devolve linhas traz as primeiras `pageSize` e mantém o cursor aberto enquanto houver mais
    /// (RN-SQL-004 e 016). Um comando que grava é executado até o fim e está confirmado quando a resposta sai (RN-SESSAO-005): devolve
    /// as linhas afetadas (RN-SQL-008) ou, se devolve linhas, as primeiras `pageSize` e o total, sem cursor (RN-SQL-013). O cursor de
    /// um comando anterior fecha antes (RN-SQL-007), como antes de qualquer outra operação que fale com o banco.
    /// </summary>
    /// <param name="pageSize">RN-SQL-016: as linhas da primeira página e de cada "carregar mais" deste cursor. Quem valida a faixa é a rota.</param>
    Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(string sql, int pageSize, CancellationToken cancellationToken);

    /// <summary>RN-SQL-005: as linhas seguintes do mesmo cursor, sem executar de novo, no tamanho com que ele foi aberto. Sem cursor aberto, `NoOpenCursor`.</summary>
    Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(CancellationToken cancellationToken);

    /// <summary>
    /// RN-SQL-006: `SELECT COUNT(*)` sobre o comando, como subconsulta, sem deixar que ele grave de novo. A posição do erro não vem:
    /// seria a do comando embrulhado.
    /// </summary>
    Task<Result<long, DatabaseFailure>> CountAsync(string sql, CancellationToken cancellationToken);

    /// <summary>Fecha o cursor aberto, se houver, sem esperar o resto das linhas. Não falha.</summary>
    Task CloseCursorAsync();

    /// <summary>
    /// RN-SQL-010: interrompe o comando em andamento, que termina com `ExecutionFailed`; se ele já tinha terminado quando o cancelamento
    /// chegou, termina como sucesso. Pode ser chamado de outra thread. Sem comando em andamento não faz nada: um cursor aberto e parado
    /// continua legível.
    /// </summary>
    void Cancel();

    /// <summary>Os esquemas, com os de sistema por último (RN-ARVORE-004).</summary>
    Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(CancellationToken cancellationToken);

    /// <param name="kind">`tables`, `views` ou `routines`.</param>
    Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(string schema, string kind, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<ColumnInfo>, DatabaseFailure>> GetColumnsAsync(string schema, string table, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<IndexInfo>, DatabaseFailure>> GetIndexesAsync(string schema, string table, CancellationToken cancellationToken);

    Task<Result<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>> GetForeignKeysAsync(string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-004: as chaves estrangeiras de outras tabelas, e da própria, que apontam para esta.</summary>
    Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>> GetReferencingForeignKeysAsync(string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-005: as restrições de conferência da tabela.</summary>
    Task<Result<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>> GetChecksAsync(string schema, string table, CancellationToken cancellationToken);

    /// <summary>RN-CAT-006: o texto que o banco guarda para a visão, ou nulo.</summary>
    Task<Result<ViewDefinitionInfo, DatabaseFailure>> GetViewDefinitionAsync(string schema, string view, CancellationToken cancellationToken);

    /// <summary>RN-CAT-008: as tabelas do esquema e as chaves que saem delas, por consultas do esquema inteiro.</summary>
    Task<Result<SchemaDiagramInfo, DatabaseFailure>> GetDiagramAsync(string schema, CancellationToken cancellationToken);

    /// <summary>RN-CAT-010: o que o servidor informa do banco conectado a esta conta.</summary>
    Task<Result<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>> GetPropertiesAsync(CancellationToken cancellationToken);

    /// <summary>RN-ARVORE-006: os bancos do servidor a que a conta pode se conectar, por nome, com o da sessão primeiro.</summary>
    Task<Result<IReadOnlyList<DatabaseInfo>, DatabaseFailure>> GetDatabasesAsync(CancellationToken cancellationToken);
}
