using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Queries;
using Prism.Application.Connections.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.Connections.Features.UpdateConnection;

/// <summary>
/// O `PATCH` grava todos os campos: `FolderID` nulo move a conexão para a raiz, e quem não muda a pasta manda a que ela
/// já tem. A senha é a exceção (RN-CONN-004): `Password` ausente ou nula mantém a gravada, e enviada troca. Sem ela, host e porta não
/// podem mudar (422 `CONNECTION_INVALID`, decidido pelo repository dentro da gravação): a senha gravada só vai ao servidor para o qual foi gravada.
///
/// As proteções (RN-PROT-001 e 002) e a verificação (RN-VERIF-001) também são gravadas por inteiro, como o ambiente: o ausente volta ao padrão.
/// `UserPassword` é a senha do usuário do Prism, que só a mudança do somente leitura pede (RN-PROT-003: marcar, desmarcar, ou tirar a conexão de uma
/// pasta somente leitura); quem decide se ela é pedida é a gravação, contra o documento mais recente.
/// </summary>
public sealed record UpdateConnectionCommand : IRequest<Result<ConnectionDto, ApiErrorDto>>
{
    public Guid ID { get; init; }
    public Guid? FolderID { get; init; }
    public string Name { get; init; } = string.Empty;
    public EDatabaseEngine Engine { get; init; }
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; }
    public string Database { get; init; } = string.Empty;
    public string UserName { get; init; } = string.Empty;
    public string? Password { get; init; }
    public string? EnvironmentName { get; init; }
    public string? EnvironmentColor { get; init; }

    /// <summary>RN-PROT-001: `none`, `irreversible` ou `all`; ausente, nulo ou vazio é `none`.</summary>
    public string? ConfirmCommands { get; init; }

    /// <summary>RN-PROT-002: ausente é falso.</summary>
    public bool ReadOnly { get; init; }

    /// <summary>RN-VERIF-001: ausente ou nulo, ligada, a cada 30 segundos, com a consulta do banco.</summary>
    public bool? VerificationEnabled { get; init; }
    public int? VerificationInterval { get; init; }
    public string? VerificationQuery { get; init; }

    public bool? UseInternalDescriptions { get; init; }

    /// <summary>RN-PROT-003: a senha do usuário do Prism, e não a do banco.</summary>
    public string? UserPassword { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta pode ser a senha nova do banco (e o host e o usuário vão junto), e a do usuário.</summary>
    public override string ToString() => nameof(UpdateConnectionCommand);
}

internal sealed class UpdateConnectionHandler(IConnectionQueries connectionQueries, IConnectionRepository connectionRepository, TimeProvider timeProvider) : IRequestHandler<UpdateConnectionCommand, Result<ConnectionDto, ApiErrorDto>>
{
    public async Task<Result<ConnectionDto, ApiErrorDto>> Handle(UpdateConnectionCommand request, CancellationToken cancellationToken)
    {
        // A leitura carrega a falha do cofre, então o cofre fechado é 401 e "a conexão não existe" (sucesso com `null`) é 404.
        // Ela dá a conexão como estava gravada quando foi lida, fora do semáforo do cofre: só o que não muda (o ID e a criação) vale. Que a conexão
        // continue lá, que a pasta exista, que o nome seja livre (RN-CONN-011) e a senha que RN-CONN-004 mantém quem resolve é a gravação, com o documento mais recente.
        var read = await connectionQueries.GetRecordByID(request.ID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<ConnectionDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is not { } record)
            return Result.Failure<ConnectionDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ID));

        var connection = ConnectionRecords.ToDomain(record);
        var safeguards = ConnectionSafeguards.From(request.ConfirmCommands, request.ReadOnly, request.VerificationEnabled, request.VerificationInterval, request.VerificationQuery, request.UseInternalDescriptions);
        connection.Update(request.FolderID, request.Name, request.Engine, request.Host, request.Port, request.Database, request.UserName, request.Password, request.EnvironmentName, request.EnvironmentColor, safeguards, timeProvider.GetUtcNow().UtcDateTime);

        // A senha vai à parte: omitida (nula) mantém a do documento na hora da gravação, e não a que esta leitura trouxe (RN-CONN-004). A do usuário
        // também: a gravação a confere só se a mudança do somente leitura a pede (RN-PROT-003).
        var updated = await connectionRepository.Update(connection, request.Password, request.UserPassword, cancellationToken);
        if (updated.IsFailure)
            return Result.Failure<ConnectionDto, ApiErrorDto>(updated.Error);

        return Result.Success<ConnectionDto, ApiErrorDto>(connection.ToDto(updated.Value));
    }
}
