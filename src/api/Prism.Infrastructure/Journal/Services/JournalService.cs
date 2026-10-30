using CSharpFunctionalExtensions;
using Prism.Infrastructure.Journal.Clients;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Vault.Services;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Threading.Channels;

namespace Prism.Infrastructure.Journal.Services;

internal sealed class JournalService : IJournalService, IDisposable
{
    private const int MaxBatchSize = 200;
    private static readonly TimeSpan FlushTimeoutOnLock = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan RetentionCheckInterval = TimeSpan.FromHours(24);

    private readonly IVaultService _vaultService;
    private readonly IJournalDatabaseClient _client;
    private readonly TimeProvider _timeProvider;
    private readonly object _lifecycleLock = new();

    private JournalSession? _session;
    private long _nextId;
    private byte[]? _lastKeyBufferForTesting;

    public JournalService(IVaultService vaultService, IJournalDatabaseClient client, TimeProvider timeProvider)
    {
        _vaultService = vaultService;
        _client = client;
        _timeProvider = timeProvider;

        _vaultService.Unlocked += OnVaultUnlocked;
        _vaultService.Locked += OnVaultLocked;

        if (_vaultService.IsUnlocked)
            OnVaultUnlocked();
    }

    public bool IsAvailable
    {
        get
        {
            var session = Volatile.Read(ref _session);

            return session is { AcceptingWrites: true } && _vaultService.IsUnlocked && _vaultService.Generation == session.Generation;
        }
    }

    internal byte[]? LastKeyBufferForTesting => Volatile.Read(ref _lastKeyBufferForTesting);

    public long Begin(JournalEntryStart start)
    {
        var session = Volatile.Read(ref _session);
        if (session is null || !session.AcceptingWrites || !_vaultService.IsUnlocked || _vaultService.Generation != session.Generation)
            return -1;

        var id = Interlocked.Increment(ref _nextId);
        session.InFlight[id] = session.Generation;

        if (!session.Channel.Writer.TryWrite(new JournalWork.Write(new JournalBatchItem.Insert(id, session.Generation, start))))
        {
            session.InFlight.TryRemove(id, out _);

            return -1;
        }

        return id;
    }

    public void Complete(long id, JournalEntryEnd end)
    {
        if (id <= 0)
            return;

        var session = Volatile.Read(ref _session);
        if (session is null || !session.AcceptingWrites || !_vaultService.IsUnlocked || _vaultService.Generation != session.Generation)
            return;

        if (!session.InFlight.TryRemove(id, out var entryGeneration) || entryGeneration != session.Generation)
            return;

        session.Channel.Writer.TryWrite(new JournalWork.Write(new JournalBatchItem.Update(id, session.Generation, end)));
    }

    public void Record(JournalEntryStart start, JournalEntryEnd end)
    {
        var session = Volatile.Read(ref _session);
        if (session is null || !session.AcceptingWrites || !_vaultService.IsUnlocked || _vaultService.Generation != session.Generation)
            return;

        var id = Interlocked.Increment(ref _nextId);
        session.Channel.Writer.TryWrite(new JournalWork.Write(new JournalBatchItem.InsertCompleted(id, session.Generation, start, end)));
    }

    public Task<Result<JournalPage, EJournalError>> QueryAsync(JournalQuery query, CancellationToken cancellationToken = default)
        => ExecuteWithFlushAsync(session => _client.Query(session.Connection, query), cancellationToken);

    public Task<Result<JournalEntry, EJournalError>> GetAsync(long id, CancellationToken cancellationToken = default)
        => ExecuteWithFlushAsync(session => _client.Get(session.Connection, id), cancellationToken);

    public Task<UnitResult<EJournalError>> HideAsync(long id, CancellationToken cancellationToken = default)
        => ExecuteUnitWithFlushAsync(session => _client.Hide(session.Connection, id), cancellationToken);

    public Task<Result<long, EJournalError>> HideConnectionAsync(Guid connectionId, CancellationToken cancellationToken = default)
        => ExecuteWithFlushAsync(session => _client.HideConnection(session.Connection, connectionId), cancellationToken);

    public Task<Result<JournalFacets, EJournalError>> FacetsAsync(CancellationToken cancellationToken = default)
        => ExecuteWithFlushAsync(session => _client.Facets(session.Connection), cancellationToken);

    public Task<Result<int?, EJournalError>> GetRetentionAsync(CancellationToken cancellationToken = default)
        => ExecuteWithFlushAsync(session => _client.GetRetention(session.Connection), cancellationToken);

    public Task<UnitResult<EJournalError>> SetRetentionAsync(int? days, CancellationToken cancellationToken = default)
        => ExecuteUnitWithFlushAsync(session => _client.SetRetention(session.Connection, days, _timeProvider.GetUtcNow()), cancellationToken);

    public Task<Result<long, EJournalError>> PurgeBeforeAsync(DateTimeOffset before, CancellationToken cancellationToken = default)
        => ExecuteWithFlushAsync(session => _client.PurgeBefore(session.Connection, before), cancellationToken);

    public async Task<bool> RekeyAsync(byte[] newKey, CancellationToken cancellationToken = default)
    {
        var session = Volatile.Read(ref _session);
        if (session is null || !session.AcceptingWrites)
            return false;

        await FlushSessionAsync(session, cancellationToken);
        await session.DbGate.WaitAsync(cancellationToken);
        try
        {
            if (session.Closed)
                return false;

            var rekeyResult = _client.Rekey(session.Connection, newKey);
            if (rekeyResult.IsFailure)
                return false;

            if (session.PreviousKey is not null)
                CryptographicOperations.ZeroMemory(session.PreviousKey);

            session.PreviousKey = session.Key;
            session.Key = newKey.ToArray();
            Volatile.Write(ref _lastKeyBufferForTesting, session.Key);

            return true;
        }
        finally
        {
            session.DbGate.Release();
        }
    }

    public async Task RevertRekeyAsync(CancellationToken cancellationToken = default)
    {
        var session = Volatile.Read(ref _session);
        if (session is null || session.PreviousKey is null)
            return;

        await FlushSessionAsync(session, cancellationToken);
        await session.DbGate.WaitAsync(cancellationToken);
        try
        {
            if (session.Closed || session.PreviousKey is null)
                return;

            _client.Rekey(session.Connection, session.PreviousKey);
            CryptographicOperations.ZeroMemory(session.Key);
            session.Key = session.PreviousKey;
            session.PreviousKey = null;
            Volatile.Write(ref _lastKeyBufferForTesting, session.Key);
        }
        finally
        {
            session.DbGate.Release();
        }
    }

    public void CommitRekey()
    {
        var session = Volatile.Read(ref _session);
        if (session?.PreviousKey is { } previous)
        {
            CryptographicOperations.ZeroMemory(previous);
            session.PreviousKey = null;
        }
    }

    public void Dispose()
    {
        _vaultService.Unlocked -= OnVaultUnlocked;
        _vaultService.Locked -= OnVaultLocked;
        OnVaultLocked();
    }

    private void OnVaultUnlocked()
    {
        lock (_lifecycleLock)
        {
            CloseCurrentSession();

            var generation = _vaultService.Generation;
            var readResult = _vaultService.Read();
            if (readResult.IsFailure || _vaultService.Generation != generation)
                return;

            var document = readResult.Value;
            if (document.Journal is null || document.Journal.Key.Length == 0)
                return;

            var keyCopy = document.Journal.Key.ToArray();
            var now = _timeProvider.GetUtcNow();
            var openResult = _client.Open(document.UserName, keyCopy, now);
            if (openResult.IsFailure)
            {
                CryptographicOperations.ZeroMemory(keyCopy);

                return;
            }

            var outcome = openResult.Value;
            AdvanceNextId(outcome.MaxId);

            var session = new JournalSession(outcome.Connection, keyCopy, generation);
            Volatile.Write(ref _lastKeyBufferForTesting, keyCopy);
            Volatile.Write(ref _session, session);

            session.WriterTask = Task.Run(() => RunWriterLoopAsync(session));
            session.RetentionTask = Task.Run(() => RunRetentionLoopAsync(session));

            if (outcome.ReplacedDamagedFile)
            {
                var start = new JournalEntryStart(now, EJournalKind.Security, "Diário ilegível substituído", EJournalLevel.Critical, "O arquivo anterior do diário não pôde ser decifrado com a chave do cofre e foi renomeado.");
                var end = new JournalEntryEnd(now, 0, EJournalOutcome.Ok);
                Record(start, end);
            }
        }
    }

    private void OnVaultLocked()
    {
        lock (_lifecycleLock)
            CloseCurrentSession();
    }

    private void CloseCurrentSession()
    {
        var session = Interlocked.Exchange(ref _session, null);
        if (session is null)
            return;

        session.AcceptingWrites = false;
        session.Channel.Writer.TryComplete();
        session.RetentionCts.Cancel();

        try
        {
            session.WriterTask?.Wait(FlushTimeoutOnLock);
        }
        catch
        {
            // O encerramento não propaga exceção da tarefa em segundo plano.
        }

        session.DbGate.Wait();
        try
        {
            session.Closed = true;
            _client.Close(session.Connection);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(session.Key);
            if (session.PreviousKey is not null)
            {
                CryptographicOperations.ZeroMemory(session.PreviousKey);
                session.PreviousKey = null;
            }

            session.DbGate.Release();
            session.DbGate.Dispose();
            session.RetentionCts.Dispose();
        }
    }

    private void AdvanceNextId(long maxId)
    {
        long current;
        do
        {
            current = Volatile.Read(ref _nextId);
            if (maxId <= current)
                return;
        }
        while (Interlocked.CompareExchange(ref _nextId, maxId, current) != current);
    }

    private async Task RunWriterLoopAsync(JournalSession session)
    {
        var reader = session.Channel.Reader;
        var batch = new List<JournalBatchItem>(MaxBatchSize);
        var flushes = new List<TaskCompletionSource>();

        while (await reader.WaitToReadAsync())
        {
            batch.Clear();
            flushes.Clear();

            while (batch.Count < MaxBatchSize && reader.TryRead(out var work))
            {
                if (work is JournalWork.Write write)
                    batch.Add(write.Item);
                else if (work is JournalWork.Flush flush)
                    flushes.Add(flush.Barrier);
            }

            if (batch.Count > 0)
            {
                await session.DbGate.WaitAsync();
                try
                {
                    if (!session.Closed)
                        _client.WriteBatch(session.Connection, batch);
                }
                finally
                {
                    session.DbGate.Release();
                }
            }

            foreach (var barrier in flushes)
                barrier.TrySetResult();
        }

        while (reader.TryRead(out var remaining))
        {
            if (remaining is JournalWork.Flush flush)
                flush.Barrier.TrySetResult();
        }
    }

    private async Task RunRetentionLoopAsync(JournalSession session)
    {
        try
        {
            using var timer = new PeriodicTimer(RetentionCheckInterval, _timeProvider);
            while (await timer.WaitForNextTickAsync(session.RetentionCts.Token))
            {
                await session.DbGate.WaitAsync(session.RetentionCts.Token);
                try
                {
                    if (session.Closed)
                        return;

                    var retention = _client.GetRetention(session.Connection);
                    if (retention.IsSuccess && retention.Value.HasValue)
                        _client.PurgeBefore(session.Connection, _timeProvider.GetUtcNow().AddDays(-retention.Value.Value));
                }
                finally
                {
                    session.DbGate.Release();
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Cancelamento esperado ao fechar o cofre.
        }
        catch (ObjectDisposedException)
        {
            // Descarte esperado ao fechar o cofre.
        }
    }

    private async Task<Result<T, EJournalError>> ExecuteWithFlushAsync<T>(Func<JournalSession, Result<T, EJournalError>> operation, CancellationToken cancellationToken)
    {
        var session = Volatile.Read(ref _session);
        if (session is null || !session.AcceptingWrites || !_vaultService.IsUnlocked || _vaultService.Generation != session.Generation)
            return EJournalError.Unavailable;

        await FlushSessionAsync(session, cancellationToken);
        await session.DbGate.WaitAsync(cancellationToken);
        try
        {
            if (session.Closed || !_vaultService.IsUnlocked || _vaultService.Generation != session.Generation)
                return EJournalError.Unavailable;

            return operation(session);
        }
        finally
        {
            session.DbGate.Release();
        }
    }

    private async Task<UnitResult<EJournalError>> ExecuteUnitWithFlushAsync(Func<JournalSession, UnitResult<EJournalError>> operation, CancellationToken cancellationToken)
    {
        var session = Volatile.Read(ref _session);
        if (session is null || !session.AcceptingWrites || !_vaultService.IsUnlocked || _vaultService.Generation != session.Generation)
            return EJournalError.Unavailable;

        await FlushSessionAsync(session, cancellationToken);
        await session.DbGate.WaitAsync(cancellationToken);
        try
        {
            if (session.Closed || !_vaultService.IsUnlocked || _vaultService.Generation != session.Generation)
                return EJournalError.Unavailable;

            return operation(session);
        }
        finally
        {
            session.DbGate.Release();
        }
    }

    private static async Task FlushSessionAsync(JournalSession session, CancellationToken cancellationToken)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        if (session.Channel.Writer.TryWrite(new JournalWork.Flush(tcs)))
        {
            await tcs.Task.WaitAsync(cancellationToken);
            return;
        }

        if (session.WriterTask is not null)
            await session.WriterTask.WaitAsync(cancellationToken);
    }

    private abstract record JournalWork
    {
        public sealed record Write(JournalBatchItem Item) : JournalWork;

        public sealed record Flush(TaskCompletionSource Barrier) : JournalWork;
    }

    private sealed class JournalSession(IJournalConnection connection, byte[] key, long generation)
    {
        public IJournalConnection Connection { get; } = connection;

        public byte[] Key { get; set; } = key;

        public byte[]? PreviousKey { get; set; }

        public long Generation { get; } = generation;

        public Channel<JournalWork> Channel { get; } = System.Threading.Channels.Channel.CreateUnbounded<JournalWork>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

        public ConcurrentDictionary<long, long> InFlight { get; } = new();

        public SemaphoreSlim DbGate { get; } = new(1, 1);

        public CancellationTokenSource RetentionCts { get; } = new();

        public volatile bool AcceptingWrites = true;

        public bool Closed { get; set; }

        public Task? WriterTask { get; set; }

        public Task? RetentionTask { get; set; }
    }
}
