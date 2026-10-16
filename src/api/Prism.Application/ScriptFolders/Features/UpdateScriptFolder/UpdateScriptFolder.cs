using CSharpFunctionalExtensions;
using Prism.Application.ScriptFolders.Models.Dtos;
using Prism.Application.ScriptFolders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using ILogger = Serilog.ILogger;

namespace Prism.Application.ScriptFolders.Features.UpdateScriptFolder;

/// <summary>
/// "Renomear" e "Mover para…" (RN-SCRIPT-009) são a mesma rota, e o `PATCH` grava a pasta por inteiro, como o das pastas de conexões: o nome e a pasta pai
/// (`ParentID` ausente ou nulo é a raiz). Quem só renomeia manda a pasta pai que ela já tem, e quem só move manda o nome dela.
/// </summary>
public sealed record UpdateScriptFolderCommand : IRequest<Result<ScriptFolderDto, ApiErrorDto>>
{
    public Guid ID { get; init; }
    public string Name { get; init; } = string.Empty;
    public Guid? ParentID { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o nome da pasta.</summary>
    public override string ToString() => nameof(UpdateScriptFolderCommand);
}

internal sealed class UpdateScriptFolderHandler(IScriptFolderRepository scriptFolderRepository, TimeProvider timeProvider, ILogger logger) : IRequestHandler<UpdateScriptFolderCommand, Result<ScriptFolderDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<UpdateScriptFolderHandler>();

    public async Task<Result<ScriptFolderDto, ApiErrorDto>> Handle(UpdateScriptFolderCommand request, CancellationToken cancellationToken)
    {
        // Nada é lido antes: a existência, a pasta pai, o ciclo e o nome único são do documento mais recente, dentro da gravação.
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var updated = await scriptFolderRepository.Update(request.ID, folder => folder.Change(request.Name, request.ParentID, now), cancellationToken);
        if (updated.IsFailure)
            return Result.Failure<ScriptFolderDto, ApiErrorDto>(updated.Error);

        // RN-LOG-001: os IDs, nunca o nome.
        _logger.Information("Pasta de scripts {ScriptFolderID} gravada.", updated.Value.ID);

        return Result.Success<ScriptFolderDto, ApiErrorDto>(updated.Value.ToDto());
    }
}
