using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Models;
using System.Text;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>
/// RN-IMPORT-014 a 016: por que a carga parou antes do fim: a falha (do banco, com a linha quando se sabe) ou o motivo do cancelamento que o cofre deu
/// antes de um comando (a conexão que passou a ser somente leitura, a excluída). Os dois nulos são o cancelamento pedido (a pessoa, a conexão excluída, o
/// cofre que fechou).
/// </summary>
internal sealed record LoadStop(TransferFailure? Failure, ETransferCancelReason? Reason = null)
{
    public static LoadStop Canceled { get; } = new(Failure: null);

    public override string ToString()
        => nameof(LoadStop);
}

/// <summary>
/// RN-IMPORT-015: o que a confirmação em andamento precisa que o cancelamento saiba: enquanto ela roda, o `Cancel` da conexão não é chamado (ela termina,
/// e só depois quem a pediu vê o cancelamento).
/// </summary>
internal sealed class CommitGuard
{
    private volatile bool _committing;

    public bool Committing
    {
        get => _committing;
        set => _committing = value;
    }
}

/// <summary>
/// RN-IMPORT-012, 015 e 016: o carregador, o mesmo da importação e da cópia. Recebe uma linha por vez, já convertida, e a grava em comandos com parâmetros
/// (ou lotes, no PostgreSQL), dentro das transações da carga: a cada N linhas, ou numa só, ou nenhuma no banco sem log de transação. O comando fecha no
/// número de linhas do banco (<see cref="IDatabaseConnection.LoadRowsPerCommand"/>), antes dele quando os valores passam de 16 MiB, e nunca atravessa uma
/// confirmação. Antes de cada comando confere o cancelamento e a proteção da conexão de destino (RN-PROT-006). A memória é a de um comando.
///
/// A falha diz a linha (a do arquivo, ou o número na leitura da origem) quando o banco diz qual foi, a coluna quando o banco a diz, e, na confirmação
/// que cai com a conexão (ou, sem log, no comando), que o Prism não sabe o que ficou (`uncertain`).
/// </summary>
internal sealed class TableLoader(IDatabaseConnection connection, LoadTarget target, LoadSettings options, bool oneAtATime, TransferProgress progress, CommitGuard guard, Func<CancellationToken, Task<ETransferCancelReason?>> targetStop, Func<string?, string?> sourceColumnOf, ETransferSide side, CancellationToken token)
{
    /// <summary>RN-IMPORT-015: os valores de um comando (ou lote): passando deles, o comando fecha antes do número de linhas.</summary>
    internal const long MaxCommandBytes = 16L * 1024 * 1024;

    private readonly int _rowsPerCommand = Math.Max(1, connection.LoadRowsPerCommand(target.Columns.Count));
    private readonly List<IReadOnlyList<EditParameter>> _pending = [];
    private readonly List<long> _lines = [];
    private long _pendingBytes;

    /// <summary>As linhas gravadas na transação em andamento (ainda não confirmadas).</summary>
    private long _inTransaction;

    /// <summary>RN-IMPORT-014: as linhas gravadas, na transação em andamento ou já confirmadas.</summary>
    public long Written { get; private set; }

    /// <summary>RN-IMPORT-014: as linhas confirmadas (no banco sem log, todas as gravadas).</summary>
    public long Committed { get; private set; }

    /// <summary>RN-IMPORT-020: o esvaziamento foi feito (e, no fim, confirmado com as primeiras linhas).</summary>
    public bool Emptied { get; private set; }

    /// <summary>A transação da carga, quando o banco tem log de transação (no sem log, cada comando fica gravado ao terminar).</summary>
    public async Task<LoadStop?> BeginAsync()
    {
        if (oneAtATime)
            return null;

        var begun = await connection.BeginLoadTransactionAsync(token);

        return begun.IsSuccess ? null : Stop(begun.Error);
    }

    /// <summary>RN-IMPORT-012: o `DELETE` sem `WHERE`, na primeira transação (no banco sem log, sozinho: parado no meio, a tabela pode ter sido esvaziada em parte).</summary>
    public async Task<LoadStop?> EmptyAsync()
    {
        progress.Phase(ETransferPhase.Emptying);
        if (await BeforeCommandAsync() is { } stop)
            return stop;

        progress.InDoubt(oneAtATime);
        var emptied = await connection.EmptyTableAsync(target.Schema, target.Table, token);
        progress.InDoubt(false);
        if (emptied.IsFailure)
            return Stop(emptied.Error, uncertain: oneAtATime && IsLost(emptied.Error));

        Emptied = true;

        return null;
    }

    /// <summary>Uma linha, com um valor por coluna mapeada. Vai ao banco quando o comando enche, ou quando a linha completa as N da transação.</summary>
    public async Task<LoadStop?> AddAsync(IReadOnlyList<EditParameter> row, long line)
    {
        var bytes = BytesOf(row);
        if (_pending.Count > 0 && _pendingBytes + bytes > MaxCommandBytes && await FlushAsync() is { } overflow)
            return overflow;

        _pending.Add(row);
        _lines.Add(line);
        _pendingBytes += bytes;

        var commitNow = !oneAtATime && options.CommitEvery is { } every && _inTransaction + _pending.Count >= every;
        if (_pending.Count < _rowsPerCommand && !commitNow)
            return null;

        if (await FlushAsync() is { } stop)
            return stop;

        if (!commitNow)
            return null;

        if (await CommitAsync() is { } notCommitted)
            return notCommitted;

        return await BeginAsync();
    }

    /// <summary>O fim: o que falta vai ao banco, e a confirmação final (a fase `committing`).</summary>
    public async Task<LoadStop?> FinishAsync()
    {
        if (await FlushAsync() is { } stop)
            return stop;

        progress.Phase(ETransferPhase.Committing);

        return await CommitAsync();
    }

    private async Task<LoadStop?> FlushAsync()
    {
        if (_pending.Count == 0)
            return null;

        if (await BeforeCommandAsync() is { } stop)
            return stop;

        progress.InDoubt(oneAtATime);
        var inserted = await connection.InsertRowsAsync(target, _pending, token);
        progress.InDoubt(false);
        if (inserted.IsFailure)
        {
            var failure = inserted.Error;
            long? line = failure.Change is { } index && index >= 0 && index < _lines.Count ? _lines[index] : null;

            // Sem a linha, a falha é do comando inteiro (no Db2, a transação que o banco desfez, a conexão que caiu): as linhas dele contam, para o intervalo
            // que a tela compõe (RN-IMPORT-016).
            if (line is null)
                progress.Written(Written + _pending.Count);

            return Stop(failure, line, oneAtATime && IsLost(failure));
        }

        Written += _pending.Count;
        if (oneAtATime)
            Committed = Written;
        else
            _inTransaction += _pending.Count;

        _pending.Clear();
        _lines.Clear();
        _pendingBytes = 0;
        progress.Written(Written);
        if (oneAtATime)
            progress.Committed(Committed);

        return null;
    }

    /// <summary>
    /// RN-IMPORT-014 e 016: a confirmação, que o cancelamento não interrompe. Recusada pelo banco com a conexão viva (a restrição adiada), nada da transação
    /// ficou, e a falha não tem linha; caída a conexão no meio, o Prism não sabe se ela foi gravada.
    /// </summary>
    private async Task<LoadStop?> CommitAsync()
    {
        if (oneAtATime)
            return null;

        if (await BeforeCommandAsync() is { } stop)
            return stop;

        guard.Committing = true;
        progress.InDoubt(true);
        var committed = await connection.CommitLoadAsync();
        progress.InDoubt(false);
        guard.Committing = false;
        if (committed.IsFailure)
            return new LoadStop(FailureOf(committed.Error, null, IsLost(committed.Error) || committed.Error.SqlState is null));

        Committed += _inTransaction;
        _inTransaction = 0;
        progress.Committed(Committed);

        return null;
    }

    /// <summary>
    /// Antes de cada comando: o cancelamento pedido para a carga, e o cofre daquele instante também (RN-IMPORT-014): a conexão de destino que passou a ser
    /// somente leitura, ou que foi excluída antes de o cancelamento dela chegar aqui, com o motivo.
    /// </summary>
    private async Task<LoadStop?> BeforeCommandAsync()
    {
        if (token.IsCancellationRequested)
            return LoadStop.Canceled;

        return await targetStop(token) is { } reason ? new LoadStop(null, reason) : null;
    }

    private LoadStop Stop(DatabaseFailure failure, long? line = null, bool uncertain = false)
        => token.IsCancellationRequested ? LoadStop.Canceled : new LoadStop(FailureOf(failure, line, uncertain));

    private TransferFailure FailureOf(DatabaseFailure failure, long? line, bool uncertain)
        => new(failure.Kind == EDatabaseFailure.ConnectionFailed ? ETransferError.DatabaseConnectionFailed : ETransferError.SqlExecutionFailed, failure.Message, failure.SqlState)
        {
            Line = line,
            Column = line is null ? null : sourceColumnOf(failure.ColumnName),
            Side = side,
            Uncertain = uncertain
        };

    /// <summary>A conexão caiu: o banco não responde mais por ela, ou disse que o problema é a conexão (a classe 08).</summary>
    private bool IsLost(DatabaseFailure failure)
        => !connection.IsOpen || (failure.SqlState?.StartsWith("08", StringComparison.Ordinal) ?? false);

    /// <summary>O tamanho dos valores de uma linha: o texto em bytes de UTF-8, o binário em bytes, o resto pelo que ocupa um número.</summary>
    private static long BytesOf(IReadOnlyList<EditParameter> row)
    {
        long bytes = 0;
        foreach (var value in row)
            bytes += value.Value switch
            {
                null => 0,
                string text => Encoding.UTF8.GetByteCount(text),
                byte[] binary => binary.LongLength,
                _ => 16
            };

        return bytes;
    }
}
