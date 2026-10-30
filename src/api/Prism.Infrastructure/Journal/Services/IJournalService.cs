using CSharpFunctionalExtensions;
using Prism.Infrastructure.Journal.Models;

namespace Prism.Infrastructure.Journal.Services;

public interface IJournalService : IJournalRecorder
{
    bool IsAvailable { get; }

    Task<Result<JournalPage, EJournalError>> QueryAsync(JournalQuery query, CancellationToken cancellationToken = default);

    Task<Result<JournalEntry, EJournalError>> GetAsync(long id, CancellationToken cancellationToken = default);

    Task<UnitResult<EJournalError>> HideAsync(long id, CancellationToken cancellationToken = default);

    Task<Result<long, EJournalError>> HideConnectionAsync(Guid connectionId, CancellationToken cancellationToken = default);

    Task<Result<JournalFacets, EJournalError>> FacetsAsync(CancellationToken cancellationToken = default);

    Task<Result<int?, EJournalError>> GetRetentionAsync(CancellationToken cancellationToken = default);

    Task<UnitResult<EJournalError>> SetRetentionAsync(int? days, CancellationToken cancellationToken = default);

    Task<Result<long, EJournalError>> PurgeBeforeAsync(DateTimeOffset before, CancellationToken cancellationToken = default);

    Task<bool> RekeyAsync(byte[] newKey, CancellationToken cancellationToken = default);

    Task RevertRekeyAsync(CancellationToken cancellationToken = default);

    void CommitRekey();
}
