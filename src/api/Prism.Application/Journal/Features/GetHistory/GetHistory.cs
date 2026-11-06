using CSharpFunctionalExtensions;
using Prism.Application.Journal.Models;
using Prism.Application.Journal.Models.Dtos;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Journal.Services;

namespace Prism.Application.Journal.Features.GetHistory;

public sealed record GetHistoryCommand(string? ConnectionId, string? Q, long? Before, int? Limit) : IRequest<Result<HistoryPageDto, ApiErrorDto>>
{
    /// <summary>RN-DIARIO-009 e RN-LOG-001: não registra a busca nem o filtro no log em texto.</summary>
    public override string ToString() => nameof(GetHistoryCommand);
}

internal sealed class GetHistoryHandler(IJournalService journalService) : IRequestHandler<GetHistoryCommand, Result<HistoryPageDto, ApiErrorDto>>
{
    public async Task<Result<HistoryPageDto, ApiErrorDto>> Handle(GetHistoryCommand request, CancellationToken cancellationToken)
    {
        var limit = request.Limit ?? 100;
        IReadOnlyList<Guid> connectionIds = string.IsNullOrWhiteSpace(request.ConnectionId) ? [] : [Guid.Parse(request.ConnectionId)];

        var groups = new List<CollapsedGroup>(Math.Min(limit, 100));
        var cursor = request.Before;
        var batchSize = Math.Min(500, Math.Max(limit * 2, limit + 10));
        long? nextCursor = null;

        while (true)
        {
            var queryResult = await journalService.QueryAsync(
                new JournalQuery(
                    From: null,
                    To: null,
                    ConnectionIds: connectionIds,
                    Environments: [],
                    Levels: [],
                    Kinds: [],
                    Outcomes: [],
                    Text: request.Q,
                    HistoryOnly: true,
                    Before: cursor,
                    Limit: batchSize),
                cancellationToken);

            if (queryResult.IsFailure)
                return Result.Failure<HistoryPageDto, ApiErrorDto>(JournalErrors.From(queryResult.Error));

            var page = queryResult.Value;
            if (page.Items.Count == 0)
                break;

            var reachedExtraGroup = false;
            foreach (var entry in page.Items)
            {
                var key = BuildKey(entry);
                if (groups.Count > 0 && groups[^1].Key == key)
                {
                    groups[^1].Repeat++;
                    groups[^1].OldestId = entry.Id;
                    continue;
                }

                if (groups.Count == limit)
                {
                    nextCursor = groups[^1].OldestId;
                    reachedExtraGroup = true;
                    break;
                }

                groups.Add(new CollapsedGroup(key, entry));
            }

            if (reachedExtraGroup || page.NextBefore is null)
                break;

            cursor = page.Items[^1].Id;
        }

        var items = groups
            .Select(group => HistoryItemDto.FromEntry(group.Latest, group.Repeat))
            .ToList();

        return Result.Success<HistoryPageDto, ApiErrorDto>(new HistoryPageDto
        {
            Items = items,
            Next = nextCursor
        });
    }

    private static GroupKey BuildKey(JournalEntry entry)
    {
        var text = !string.IsNullOrWhiteSpace(entry.HistoryText)
            ? entry.HistoryText.Trim()
            : (entry.SqlText ?? entry.Action).Trim();

        return new GroupKey(
            entry.Connection.ConnectionId,
            entry.Connection.Database ?? string.Empty,
            text);
    }

    private readonly record struct GroupKey(Guid? ConnectionId, string Database, string Text);

    private sealed class CollapsedGroup(GroupKey key, JournalEntry latest)
    {
        public GroupKey Key { get; } = key;
        public JournalEntry Latest { get; } = latest;
        public int Repeat { get; set; } = 1;
        public long OldestId { get; set; } = latest.Id;
    }
}
