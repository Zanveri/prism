using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Infrastructure.Databases.Clients;

/// <summary>O driver de um banco: sabe abrir uma conexão com ele. Um por banco, sem estado.</summary>
public interface IDatabaseClient
{
    EDatabaseEngine Engine { get; }

    /// <summary>Abre a conexão, já pronta para uso. Falha `ConnectionFailed`, com a mensagem do banco (RN-SESSAO-003).</summary>
    Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken);
}
