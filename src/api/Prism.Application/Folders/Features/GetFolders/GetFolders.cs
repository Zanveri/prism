using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.Folders.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Folders.Features.GetFolders;

/// <summary>A lista inteira das pastas do usuário, sem paginação: a tela monta a árvore a partir dela.</summary>
public sealed record GetFoldersCommand : IRequest<Result<IReadOnlyList<FolderDto>, ApiErrorDto>>;

internal sealed class GetFoldersHandler(IVaultService vaultService) : IRequestHandler<GetFoldersCommand, Result<IReadOnlyList<FolderDto>, ApiErrorDto>>
{
    public Task<Result<IReadOnlyList<FolderDto>, ApiErrorDto>> Handle(GetFoldersCommand request, CancellationToken cancellationToken)
    {
        // Uma lista vazia seria a resposta errada para um cofre fechado (a tela mostraria uma árvore sem pastas em vez de voltar ao login).
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<IReadOnlyList<FolderDto>, ApiErrorDto>(VaultErrors.From(read.Error)));

        // Pelo nome, sem diferenciar maiúsculas; o ID (Guid v7, que cresce com o tempo) desempata nomes iguais de pastas diferentes.
        IReadOnlyList<FolderDto> folders = [.. read.Value.Folders.OrderBy(folder => folder.Name, StringComparer.OrdinalIgnoreCase).ThenBy(folder => folder.ID).Select(folder => folder.ToDto())];

        return Task.FromResult(Result.Success<IReadOnlyList<FolderDto>, ApiErrorDto>(folders));
    }
}
