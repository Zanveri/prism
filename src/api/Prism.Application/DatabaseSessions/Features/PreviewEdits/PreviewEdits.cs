using CSharpFunctionalExtensions;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.DatabaseSessions.Features.PreviewEdits;

/// <summary>RN-EDIT-008: o "Ver SQL" das pendências, sem executar nada. Responde `{ statements: [{ sql, values }], oneAtATime }`.</summary>
public sealed record PreviewEditsCommand : IRequest<Result<EditPreview, ApiErrorDto>>
{
    [JsonIgnore]
    public Guid SessionID { get; init; }
    public Guid ResultID { get; init; }
    public IReadOnlyList<EditChangeDto>? Changes { get; init; }

    /// <summary>RN-LOG-001: os valores das células são dados do usuário.</summary>
    public override string ToString() => nameof(PreviewEditsCommand);
}

internal sealed class PreviewEditsHandler(IDatabaseSessionService databaseSessionService) : IRequestHandler<PreviewEditsCommand, Result<EditPreview, ApiErrorDto>>
{
    public async Task<Result<EditPreview, ApiErrorDto>> Handle(PreviewEditsCommand request, CancellationToken cancellationToken)
        => (await databaseSessionService.PreviewEditsAsync(request.SessionID, request.ResultID, request.Changes.ToChanges(), cancellationToken)).MapError(DatabaseSessionErrors.From);
}
