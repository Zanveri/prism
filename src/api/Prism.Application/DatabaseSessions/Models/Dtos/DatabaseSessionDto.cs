using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.DatabaseSessions.Models.Dtos;

/// <summary>A sessão aberta (RN-SESSAO-001). O `Engine` vai como número (1, 2 ou 3), que é o que a tela valida.</summary>
public sealed record DatabaseSessionDto
{
    public Guid ID { get; init; }
    public Guid ConnectionID { get; init; }
    public EDatabaseEngine Engine { get; init; }
    public string Database { get; init; } = string.Empty;
    public string ServerVersion { get; init; } = string.Empty;

    /// <summary>RN-TX-013: o banco tem transação, e a aba pode ficar no Commit manual (o Informix sem log de transação não tem).</summary>
    public bool TransactionsAvailable { get; init; }

    /// <summary>RN-TX-001 e 003: o modo e a transação da sessão. Quem o põe é o handler, depois de abrir ou de trocar o modo.</summary>
    public TransactionDto? Transaction { get; init; }
}
