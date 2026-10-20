using CSharpFunctionalExtensions;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Vault;
using Prism.Application.Connections.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Connections.Features.GetConnections;

/// <summary>A lista inteira das conexões do usuário, sem paginação: a tela monta a árvore a partir dela. Sem a senha (RN-CONN-001).</summary>
public sealed record GetConnectionsCommand : IRequest<Result<IReadOnlyList<ConnectionDto>, ApiErrorDto>>;

internal sealed class GetConnectionsHandler(IVaultService vaultService) : IRequestHandler<GetConnectionsCommand, Result<IReadOnlyList<ConnectionDto>, ApiErrorDto>>
{
    public Task<Result<IReadOnlyList<ConnectionDto>, ApiErrorDto>> Handle(GetConnectionsCommand request, CancellationToken cancellationToken)
    {
        // Uma lista vazia seria a resposta errada para um cofre fechado (a tela mostraria uma árvore sem conexões em vez de voltar ao login).
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<IReadOnlyList<ConnectionDto>, ApiErrorDto>(VaultErrors.From(read.Error)));

        // Pelo nome, sem diferenciar maiúsculas; o ID (Guid v7, que cresce com o tempo) desempata nomes iguais de pastas diferentes. As proteções que
        // valem (RN-PROT-004) saem das pastas da mesma leitura.
        var folders = ProtectionRules.FoldersOf(read.Value);
        IReadOnlyList<ConnectionDto> connections = [.. read.Value.Connections.OrderBy(connection => connection.Name, StringComparer.OrdinalIgnoreCase).ThenBy(connection => connection.ID).Select(connection => connection.ToDto(ProtectionRules.Of(folders, connection.FolderID, connection.ReadOnly == true, connection.ConfirmCommands)))];

        return Task.FromResult(Result.Success<IReadOnlyList<ConnectionDto>, ApiErrorDto>(connections));
    }
}
