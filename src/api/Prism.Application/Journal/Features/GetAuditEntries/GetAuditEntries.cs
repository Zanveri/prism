using CSharpFunctionalExtensions;
using Prism.Application.Journal.Models;
using Prism.Application.Journal.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;
using System.Globalization;

namespace Prism.Application.Journal.Features.GetAuditEntries;

public sealed record GetAuditEntriesCommand(
    string? From,
    string? To,
    IReadOnlyList<string>? ConnectionId,
    IReadOnlyList<string>? Environment,
    IReadOnlyList<string>? Level,
    IReadOnlyList<string>? Kind,
    IReadOnlyList<string>? Outcome,
    string? Q,
    string? ScriptRunId,
    long? Before,
    int? Limit) : IRequest<Result<AuditPageDto, ApiErrorDto>>
{
    /// <summary>RN-DIARIO-009 e RN-LOG-001: não registra filtros nem busca no log em texto.</summary>
    public override string ToString() => nameof(GetAuditEntriesCommand);
}

internal sealed class GetAuditEntriesHandler(IJournalService journalService) : IRequestHandler<GetAuditEntriesCommand, Result<AuditPageDto, ApiErrorDto>>
{
    public async Task<Result<AuditPageDto, ApiErrorDto>> Handle(GetAuditEntriesCommand request, CancellationToken cancellationToken)
    {
        DateTimeOffset? from = string.IsNullOrWhiteSpace(request.From)
            ? null
            : DateTimeOffset.Parse(request.From, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

        DateTimeOffset? to = string.IsNullOrWhiteSpace(request.To)
            ? null
            : DateTimeOffset.Parse(request.To, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

        IReadOnlyList<Guid> connectionIds = request.ConnectionId is { Count: > 0 }
            ? request.ConnectionId.Where(id => !string.IsNullOrWhiteSpace(id)).Select(Guid.Parse).ToList()
            : [];

        IReadOnlyList<string?> environments = request.Environment is { Count: > 0 }
            ? request.Environment.Select(env => string.IsNullOrEmpty(env) || env == "__none__" ? null : env).ToList()
            : [];

        IReadOnlyList<EJournalLevel> levels = request.Level is { Count: > 0 }
            ? request.Level.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => { JournalFormat.TryParseLevel(v, out var parsed); return parsed; }).ToList()
            : [];

        IReadOnlyList<EJournalKind> kinds = request.Kind is { Count: > 0 }
            ? request.Kind.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => { JournalFormat.TryParseKind(v, out var parsed); return parsed; }).ToList()
            : [];

        IReadOnlyList<EJournalOutcome> outcomes = request.Outcome is { Count: > 0 }
            ? request.Outcome.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => { JournalFormat.TryParseOutcome(v, out var parsed); return parsed; }).ToList()
            : [];

        Guid? scriptRunId = string.IsNullOrWhiteSpace(request.ScriptRunId) ? null : Guid.Parse(request.ScriptRunId);
        var limit = request.Limit ?? 200;

        var queryResult = await journalService.QueryAsync(
            new JournalQuery(
                From: from,
                To: to,
                ConnectionIds: connectionIds,
                Environments: environments,
                Levels: levels,
                Kinds: kinds,
                Outcomes: outcomes,
                Text: request.Q,
                HistoryOnly: false,
                Before: request.Before,
                Limit: limit,
                ScriptRunId: scriptRunId),
            cancellationToken);

        if (queryResult.IsFailure)
            return Result.Failure<AuditPageDto, ApiErrorDto>(JournalErrors.From(queryResult.Error));

        var page = queryResult.Value;
        var items = page.Items.Select(AuditItemDto.FromEntry).ToList();

        return Result.Success<AuditPageDto, ApiErrorDto>(new AuditPageDto
        {
            Items = items,
            Total = page.Total,
            Next = page.NextBefore
        });
    }
}
