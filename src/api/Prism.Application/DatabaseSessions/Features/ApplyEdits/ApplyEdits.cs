using CSharpFunctionalExtensions;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.ApplyEdits;

/// <summary>
/// RN-EDIT-005, 011 e 012: o "Salvar" das pendências, na sessão da aba, numa transação própria (nos Registros a aba é sempre
/// Auto-commit, RN-TX-001), ou, no Commit manual, na transação da aba, num ponto de salvamento só dele; no Informix sem log, uma alteração por vez.
/// Responde `{ applied, transaction }`.
/// </summary>
public sealed record ApplyEditsCommand : IRequest<Result<EditsAppliedDto, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public Guid ResultID { get; init; }
    public IReadOnlyList<EditChangeDto>? Changes { get; init; }

    /// <summary>RN-LOG-001: os valores das células são dados do usuário.</summary>
    public override string ToString() => nameof(ApplyEditsCommand);
}

internal sealed class ApplyEditsHandler(IConnectionQueries connectionQueries, IDatabaseSessionService databaseSessionService) : IRequestHandler<ApplyEditsCommand, Result<EditsAppliedDto, ApiErrorDto>>
{
    public async Task<Result<EditsAppliedDto, ApiErrorDto>> Handle(ApplyEditsCommand request, CancellationToken cancellationToken)
    {
        // RN-PROT-002: a edição de registros não existe numa conexão somente leitura (a dela ou a de uma pasta acima, no cofre agora).
        var readOnly = await connectionQueries.IsReadOnly(databaseSessionService, request.SessionID, cancellationToken);
        if (readOnly.IsFailure)
            return Result.Failure<EditsAppliedDto, ApiErrorDto>(readOnly.Error);

        if (readOnly.Value)
            return Result.Failure<EditsAppliedDto, ApiErrorDto>(SessionProtections.EditsRefusal());

        return (await databaseSessionService.ApplyEditsAsync(request.SessionID, request.ResultID, request.Changes.ToChanges(), cancellationToken)).Map(applied => new EditsAppliedDto(applied, databaseSessionService.TransactionOf(request.SessionID)?.ToDto())).MapError(DatabaseSessionErrors.From);
    }
}
