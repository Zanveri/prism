using CSharpFunctionalExtensions;
using Prism.Application.Common.Vault;
using Prism.Application.ScriptFolders.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Vault.Services;
using ILogger = Serilog.ILogger;

namespace Prism.Application.ScriptFolders.Features.GetScriptFolders;

/// <summary>A lista inteira das pastas de scripts do usuário, de todos os níveis, sem paginação: a tela monta a árvore da seção Scripts a partir dela (RN-SCRIPT-008).</summary>
public sealed record GetScriptFoldersCommand : IRequest<Result<IReadOnlyList<ScriptFolderDto>, ApiErrorDto>>;

internal sealed class GetScriptFoldersHandler(IVaultService vaultService, ILogger logger) : IRequestHandler<GetScriptFoldersCommand, Result<IReadOnlyList<ScriptFolderDto>, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<GetScriptFoldersHandler>();

    public Task<Result<IReadOnlyList<ScriptFolderDto>, ApiErrorDto>> Handle(GetScriptFoldersCommand request, CancellationToken cancellationToken)
    {
        // Uma lista vazia seria a resposta errada para um cofre fechado.
        var read = vaultService.Read();
        if (read.IsFailure)
            return Task.FromResult(Result.Failure<IReadOnlyList<ScriptFolderDto>, ApiErrorDto>(VaultErrors.From(read.Error)));

        // Pelo nome, sem diferenciar maiúsculas; o ID (Guid v7) desempata. A ordem da árvore, na ordem do português, é da tela.
        IReadOnlyList<ScriptFolderDto> folders = [.. read.Value.ScriptFolders.OrderBy(folder => folder.Name, StringComparer.OrdinalIgnoreCase).ThenBy(folder => folder.ID).Select(folder => folder.ToDto())];

        // RN-LOG-001: a contagem, nunca os nomes.
        _logger.Information("Pastas de scripts lidas: {FolderCount}.", folders.Count);

        return Task.FromResult(Result.Success<IReadOnlyList<ScriptFolderDto>, ApiErrorDto>(folders));
    }
}
