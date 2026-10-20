using CSharpFunctionalExtensions;
using Prism.Application.ScriptFolders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using ILogger = Serilog.ILogger;

namespace Prism.Application.ScriptFolders.Features.DeleteScriptFolder;

public sealed record DeleteScriptFolderCommand(Guid ID) : IRequest<UnitResult<ApiErrorDto>>;

internal sealed class DeleteScriptFolderHandler(IScriptFolderRepository scriptFolderRepository, ILogger logger) : IRequestHandler<DeleteScriptFolderCommand, UnitResult<ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<DeleteScriptFolderHandler>();

    /// <summary>
    /// Que a pasta exista e esteja vazia (RN-SCRIPT-007) é dito só pela gravação: uma leitura antes devolveria "não existe" também com o cofre fechado, e
    /// não veria o script que outra janela pôs na pasta depois dela.
    /// </summary>
    public async Task<UnitResult<ApiErrorDto>> Handle(DeleteScriptFolderCommand request, CancellationToken cancellationToken)
    {
        var deleted = await scriptFolderRepository.Delete(request.ID, cancellationToken);

        // RN-LOG-001: o ID e as contagens, nunca o nome (que está no detalhe da recusa).
        if (deleted.IsSuccess)
            _logger.Information("Pasta de scripts {ScriptFolderID} excluída.", request.ID);
        else if (deleted.Error.Type == "SCRIPT_FOLDER_NOT_EMPTY")
            _logger.Information("Pasta de scripts {ScriptFolderID} não excluída: tem {FolderCount} subpastas e {ScriptCount} scripts.", request.ID, deleted.Error.Extensions["folders"], deleted.Error.Extensions["scripts"]);

        return deleted;
    }
}
