using CSharpFunctionalExtensions;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.Connections.Features.CreateConnection;

/// <summary>
/// `FolderID` nulo cria na raiz (RN-CONN-010). A senha é do banco, e é obrigatória na criação. As proteções (RN-PROT-001 e 002) e a verificação
/// (RN-VERIF-001) são opcionais, e o ausente é o padrão; criar já marcada como somente leitura não pede a senha do usuário (RN-PROT-003).
/// </summary>
public sealed record CreateConnectionCommand : IRequest<Result<ConnectionDto, ApiErrorDto>>
{
    public Guid? FolderID { get; init; }
    public string Name { get; init; } = string.Empty;
    public EDatabaseEngine Engine { get; init; }
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; }
    public string Database { get; init; } = string.Empty;
    public string UserName { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }

    /// <summary>RN-PROT-001: `none`, `irreversible` ou `all`; ausente, nulo ou vazio é `none`.</summary>
    public string? ConfirmCommands { get; init; }

    /// <summary>RN-PROT-002.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>RN-VERIF-001: ausente ou nulo, ligada, a cada 30 segundos, com a consulta do banco.</summary>
    public bool? VerificationEnabled { get; init; }
    public int? VerificationInterval { get; init; }
    public string? VerificationQuery { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta é a senha do banco (e o host e o usuário vão junto).</summary>
    public override string ToString() => nameof(CreateConnectionCommand);
}

internal sealed class CreateConnectionHandler(IConnectionRepository connectionRepository, TimeProvider timeProvider) : IRequestHandler<CreateConnectionCommand, Result<ConnectionDto, ApiErrorDto>>
{
    public async Task<Result<ConnectionDto, ApiErrorDto>> Handle(CreateConnectionCommand request, CancellationToken cancellationToken)
    {
        var safeguards = ConnectionSafeguards.From(request.ConfirmCommands, request.ReadOnly, request.VerificationEnabled, request.VerificationInterval, request.VerificationQuery);
        var connection = Connection.Create(request.FolderID, request.Name, request.Engine, request.Host, request.Port, request.Database, request.UserName, request.Password, request.EnvironmentName, request.EnvironmentColor, safeguards, timeProvider.GetUtcNow().UtcDateTime);

        // Que a pasta exista (404) e que o nome esteja livre nela (409, RN-CONN-011) quem diz é a gravação, o único lugar em que um cofre
        // fechado não vira 404: nenhuma consulta feita antes leu o cofre com a garantia de que ele continuaria aberto. As proteções que valem
        // (RN-PROT-004) saem do documento que ela gravou.
        var inserted = await connectionRepository.Insert(connection, cancellationToken);
        if (inserted.IsFailure)
            return Result.Failure<ConnectionDto, ApiErrorDto>(inserted.Error);

        return Result.Success<ConnectionDto, ApiErrorDto>(connection.ToDto(inserted.Value));
    }
}
