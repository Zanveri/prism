using CSharpFunctionalExtensions;
using Prism.Infrastructure.Journal.Models;

namespace Prism.Infrastructure.Journal.Clients;

internal interface IJournalConnection : IDisposable
{
    string FilePath { get; }
}

internal abstract record JournalBatchItem(long Generation)
{
    internal sealed record Insert(long Id, long Generation, JournalEntryStart Start) : JournalBatchItem(Generation);

    internal sealed record InsertCompleted(long Id, long Generation, JournalEntryStart Start, JournalEntryEnd End) : JournalBatchItem(Generation);

    internal sealed record Update(long Id, long Generation, JournalEntryEnd End) : JournalBatchItem(Generation);
}

internal sealed record JournalOpenOutcome(IJournalConnection Connection, long MaxId, bool ReplacedDamagedFile, int? RetentionDays);

internal interface IJournalDatabaseClient
{
    Result<JournalOpenOutcome, EJournalError> Open(string userName, ReadOnlySpan<byte> key, DateTimeOffset now);

    UnitResult<EJournalError> WriteBatch(IJournalConnection connection, IReadOnlyList<JournalBatchItem> items);

    Result<JournalPage, EJournalError> Query(IJournalConnection connection, JournalQuery query);

    Result<JournalEntry, EJournalError> Get(IJournalConnection connection, long id);

    UnitResult<EJournalError> Hide(IJournalConnection connection, long id);

    Result<long, EJournalError> HideConnection(IJournalConnection connection, Guid connectionId);

    Result<JournalFacets, EJournalError> Facets(IJournalConnection connection);

    Result<int?, EJournalError> GetRetention(IJournalConnection connection);

    UnitResult<EJournalError> SetRetention(IJournalConnection connection, int? days, DateTimeOffset now);

    Result<long, EJournalError> PurgeBefore(IJournalConnection connection, DateTimeOffset before);

    UnitResult<EJournalError> Rekey(IJournalConnection connection, ReadOnlySpan<byte> newKey);

    void Close(IJournalConnection connection);
}
