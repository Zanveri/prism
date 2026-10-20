using CSharpFunctionalExtensions;
using Prism.Application.Scripts.Models.Dtos;
using Prism.Application.Scripts.Repositories;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;

namespace Prism.Application.Scripts.Features.UpdateScript;

/// <summary>
/// O `PATCH` é parcial: o que vem ausente ou nulo fica como está. Renomear manda `name`; gravar a aba por cima (RN-SCRIPT-001) manda `sql` e o lugar
/// (`connectionID` e `database`). O lugar é um par: com `connectionID` os dois são gravados, e `database` nulo é o banco da conexão; sem ele, ficam os dois.
/// `generic: true` apaga o lugar, e o script passa a ser genérico (RN-SCRIPT-005): é o jeito explícito de tirar a conexão, porque a ausente fica. O "Editar
/// script…" (RN-SCRIPT-006) manda o nome, o `icon` e a `color`: a cor vazia tira a cor, e o ícone vazio ou `document` volta ao padrão. O "Mover para…"
/// (RN-SCRIPT-009) manda `folderID`, a pasta de destino, ou `root: true`, a raiz da seção Scripts: o `folderID` nulo é "fica", como o resto.
/// </summary>
public sealed record UpdateScriptCommand : IRequest<Result<ScriptSummaryDto, ApiErrorDto>>
{
    public Guid ID { get; init; }
    public string? Name { get; init; }
    public string? Sql { get; init; }
    public Guid? ConnectionID { get; init; }
    public string? Database { get; init; }
    public bool Generic { get; init; }
    public string? Icon { get; init; }
    public string? Color { get; init; }
    public Guid? FolderID { get; init; }

    /// <summary>RN-SCRIPT-009: leva o script para a raiz da seção Scripts; falso ou ausente não faz nada.</summary>
    public bool Root { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o texto do SQL.</summary>
    public override string ToString() => nameof(UpdateScriptCommand);
}

internal sealed class UpdateScriptHandler(IScriptRepository scriptRepository, TimeProvider timeProvider) : IRequestHandler<UpdateScriptCommand, Result<ScriptSummaryDto, ApiErrorDto>>
{
    public async Task<Result<ScriptSummaryDto, ApiErrorDto>> Handle(UpdateScriptCommand request, CancellationToken cancellationToken)
    {
        // Nada é lido antes: a existência, o nome único, a pasta de destino e o que fica de cada campo ausente são do registro mais recente, dentro da gravação.
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var updated = await scriptRepository.Update(request.ID, script =>
        {
            var changed = script.Change(request.Name, request.Sql, request.ConnectionID, request.Database, request.Generic, request.Icon, request.Color, now);
            var moved = script.MoveTo(request.FolderID, request.Root, now);

            return changed || moved;
        }, cancellationToken);
        if (updated.IsFailure)
            return Result.Failure<ScriptSummaryDto, ApiErrorDto>(updated.Error);

        return Result.Success<ScriptSummaryDto, ApiErrorDto>(updated.Value.ToSummaryDto());
    }
}
