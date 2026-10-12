using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Models.Dtos;
using Prism.Application.Connections.Queries;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.Connections.Features.RevealConnectionPassword;

/// <summary>
/// RN-CONN-002: `Password` é a senha do usuário (a do Prism), e não a do banco. O `ID` vem da rota, e o `[JsonIgnore]` impede
/// que o corpo o escolha: o controller completa o comando com `with { ID = id }`.
/// </summary>
public sealed record RevealConnectionPasswordCommand : IRequest<Result<ConnectionPasswordDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid ID { get; init; }
    public string Password { get; init; } = string.Empty;

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e esta é a senha do usuário.</summary>
    public override string ToString() => nameof(RevealConnectionPasswordCommand);
}

internal sealed class RevealConnectionPasswordHandler(IConnectionQueries connectionQueries, IVaultService vaultService) : IRequestHandler<RevealConnectionPasswordCommand, Result<ConnectionPasswordDto, ApiErrorDto>>
{
    public async Task<Result<ConnectionPasswordDto, ApiErrorDto>> Handle(RevealConnectionPasswordCommand request, CancellationToken cancellationToken)
    {
        // Esta primeira leitura serve só para o 404: um ID que não existe responde sem conferir a senha e não gasta uma das cinco
        // tentativas (RN-CONN-003). Ela é feita fora do semáforo do cofre, então o registro lido aqui NUNCA responde: entre a leitura e a
        // conferência outro usuário pode ter virado o cofre aberto (a criação de um usuário deriva a chave durante segundos com o anterior
        // ainda aberto), e a senha dele "confirmaria" a conexão do anterior.
        var read = await connectionQueries.GetRecordByID(request.ID, cancellationToken);
        if (read.IsFailure)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(VaultErrors.From(read.Error));

        if (read.Value is null)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ID));

        // RN-CONN-002 e RN-CONN-003: quem deriva a chave, conta os erros seguidos e fecha o cofre no quinto é o serviço do cofre, e ele entrega
        // o documento do mesmo cofre que a senha abriu, na mesma operação. `Locked` é o cofre fechado (inclusive por este quinto erro, no
        // lugar do 422); sucesso sem documento é senha errada.
        var verified = await vaultService.ReadIfPasswordMatchesAsync(request.Password, cancellationToken);
        if (verified.IsFailure)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(VaultErrors.From(verified.Error));

        if (verified.Value is not { } document)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(ConnectionErrors.InvalidPassword());

        // A senha do banco sai deste documento. Se a conexão não está nele, o cofre mudou de dono no meio: é 404, e nada da primeira leitura vaza.
        var verifiedRecord = document.Connections.FirstOrDefault(connection => connection.ID == request.ID);
        if (verifiedRecord is null)
            return Result.Failure<ConnectionPasswordDto, ApiErrorDto>(ConnectionErrors.NotFound(request.ID));

        return Result.Success<ConnectionPasswordDto, ApiErrorDto>(new ConnectionPasswordDto { Password = verifiedRecord.Password });
    }
}
