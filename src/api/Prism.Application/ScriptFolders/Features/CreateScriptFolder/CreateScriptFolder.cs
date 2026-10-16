using CSharpFunctionalExtensions;
using Prism.Application.ScriptFolders.Domain;
using Prism.Application.ScriptFolders.Models.Dtos;
using Prism.Application.ScriptFolders.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using ILogger = Serilog.ILogger;

namespace Prism.Application.ScriptFolders.Features.CreateScriptFolder;

/// <summary>RN-SCRIPT-009: "Nova pasta" (na raiz da seção Scripts, `ParentID` ausente ou nulo) e "Nova subpasta" (dentro de `ParentID`).</summary>
public sealed record CreateScriptFolderCommand : IRequest<Result<ScriptFolderDto, ApiErrorDto>>
{
    public string Name { get; init; } = string.Empty;
    public Guid? ParentID { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o nome da pasta.</summary>
    public override string ToString() => nameof(CreateScriptFolderCommand);
}

internal sealed class CreateScriptFolderHandler(IScriptFolderRepository scriptFolderRepository, TimeProvider timeProvider, ILogger logger) : IRequestHandler<CreateScriptFolderCommand, Result<ScriptFolderDto, ApiErrorDto>>
{
    private readonly ILogger _logger = logger.ForContext<CreateScriptFolderHandler>();

    public async Task<Result<ScriptFolderDto, ApiErrorDto>> Handle(CreateScriptFolderCommand request, CancellationToken cancellationToken)
    {
        var folder = ScriptFolder.Create(request.Name, request.ParentID, timeProvider.GetUtcNow().UtcDateTime);

        // A pasta pai que existe e o nome único entre as irmãs (RN-SCRIPT-007) são decididos só dentro da gravação, contra o documento mais recente.
        var inserted = await scriptFolderRepository.Insert(folder, cancellationToken);
        if (inserted.IsFailure)
            return Result.Failure<ScriptFolderDto, ApiErrorDto>(inserted.Error);

        // RN-LOG-001: os IDs, nunca o nome.
        _logger.Information("Pasta de scripts {ScriptFolderID} criada.", folder.ID);

        return Result.Success<ScriptFolderDto, ApiErrorDto>(folder.ToDto());
    }
}
