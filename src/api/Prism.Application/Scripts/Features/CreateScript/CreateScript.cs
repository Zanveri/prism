using CSharpFunctionalExtensions;
using Prism.Application.Scripts.Domain;
using Prism.Application.Scripts.Models.Dtos;
using Prism.Application.Scripts.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.Scripts.Features.CreateScript;

/// <summary>
/// RN-SCRIPT-001: o Ctrl+S da primeira vez e o "Salvar como". `ConnectionID` e `Database` são o lugar da aba (RN-SCRIPT-003); a conexão não é conferida, porque
/// um script continua do usuário mesmo depois de a conexão sair, e o banco sem conexão é descartado. `FolderID` é a pasta do campo "Pasta" (RN-SCRIPT-010),
/// ausente ou nula na raiz; ela é conferida, na gravação: a que outra janela excluiu é 404 `SCRIPT_FOLDER_NOT_FOUND`.
/// </summary>
public sealed record CreateScriptCommand : IRequest<Result<ScriptSummaryDto, ApiErrorDto>>
{
    public string Name { get; init; } = string.Empty;
    public string Sql { get; init; } = string.Empty;
    public Guid? ConnectionID { get; init; }
    public string? Database { get; init; }
    public Guid? FolderID { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o texto do SQL.</summary>
    public override string ToString() => nameof(CreateScriptCommand);
}

internal sealed class CreateScriptHandler(IScriptRepository scriptRepository, TimeProvider timeProvider) : IRequestHandler<CreateScriptCommand, Result<ScriptSummaryDto, ApiErrorDto>>
{
    public async Task<Result<ScriptSummaryDto, ApiErrorDto>> Handle(CreateScriptCommand request, CancellationToken cancellationToken)
    {
        var script = Script.Create(request.Name, request.Sql, request.ConnectionID, request.Database, request.FolderID, timeProvider.GetUtcNow().UtcDateTime);

        // O nome único (RN-SCRIPT-004) e a pasta que existe (RN-SCRIPT-010) são decididos só dentro da gravação, contra o documento mais recente.
        var inserted = await scriptRepository.Insert(script, cancellationToken);
        if (inserted.IsFailure)
            return Result.Failure<ScriptSummaryDto, ApiErrorDto>(inserted.Error);

        return Result.Success<ScriptSummaryDto, ApiErrorDto>(script.ToSummaryDto());
    }
}
