using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.TestingCore.Extensions;

public static class DatabaseConnectionExtensions
{
    /// <summary>
    /// O comando com as linhas por página de quando a busca não diz quantas (RN-SQL-016: 200), que é o que a rota usa sem `pageSize`.
    /// Os testes que não são sobre o tamanho da página executam assim; os que são passam o tamanho à própria conexão.
    /// </summary>
    public static Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(this IDatabaseConnection connection, string sql, CancellationToken cancellationToken)
        => connection.ExecuteAsync(sql, QueryPaging.DefaultPageSize, cancellationToken);

    /// <summary>O mesmo, pelo registro de sessões.</summary>
    public static Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(this IDatabaseSessionService service, Guid sessionID, string sql, CancellationToken cancellationToken)
        => service.ExecuteAsync(sessionID, sql, QueryPaging.DefaultPageSize, cancellationToken);

    /// <summary>
    /// Executa o comando sem a recusa de controle de transação da RN-SQL-003, pelo caminho interno da conexão. Existe para o teste da
    /// rede de segurança da RN-SESSAO-005 chegar ao banco com um `BEGIN`, no lugar de uma forma de abrir transação que a recusa não
    /// conhecesse. Fica aqui para o projeto de integração continuar sem enxergar nada interno da aplicação.
    /// </summary>
    public static Task<Result<QueryOutcome, DatabaseFailure>> ExecutePastTheTransactionControlRefusalAsync(this IDatabaseConnection connection, string sql, CancellationToken cancellationToken)
        => ((AdoDatabaseConnection)connection).ExecuteWithoutRefusalAsync(sql, QueryPaging.DefaultPageSize, cancellationToken);
}
