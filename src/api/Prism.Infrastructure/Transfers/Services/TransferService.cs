using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Writers;
using Prism.Infrastructure.Vault.Services;
using System.Globalization;
using System.Runtime.InteropServices;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Transfers.Services;

/// <summary>
/// RN-EXPORT-016 a 018: o registro das transferências. Cada trabalho roda numa tarefa própria (`Task.Run`), numa conexão à parte que só ele usa, e
/// escreve o arquivo temporário pelo client da pasta `transfers`, que tem o único `try` do disco; a conexão tem o dela. Nada aqui lança: o que falha é o
/// fim do trabalho (`failed`, com o código e a mensagem), e o estado de cada um muda só sob a trava do registro. RN-IMPORT-014 e 027: a importação de dados
/// (<see cref="ImportRun"/>) e a cópia para outro banco (<see cref="CopyRun"/>) entram no mesmo registro, com o mesmo limite, gravando pelo mesmo
/// carregador (<see cref="TableLoader"/>).
///
/// O relógio (`TimeProvider`) decide o abandono (5 minutos sem consulta) e a falta de progresso (2 horas sem uma linha escrita nem uma fase nova), por um
/// temporizador que confere o registro de tempos em tempos; o mesmo relógio mede o prazo do cancelamento.
/// </summary>
internal sealed class TransferService : ITransferService, IAsyncDisposable
{
    /// <summary>RN-EXPORT-014: o limite da área de transferência, em bytes de UTF-8 do texto.</summary>
    internal const long ClipboardLimit = 10L * 1024 * 1024;

    private const string ColumnsChangedMessage = "As colunas do resultado mudaram desde a grade. Execute o comando de novo e exporte outra vez.";
    private const string StalledMessage = "O banco ficou 2 horas sem responder, e a exportação foi encerrada.";
    private const string ImportStalledMessage = "O banco ficou 2 horas sem responder, e a importação foi encerrada.";
    private const string CopyStalledMessage = "O banco ficou 2 horas sem responder, e a cópia foi encerrada.";
    private const string ClipboardTooLargeMessage = "O texto passou de 10 MiB, o limite da área de transferência. Exporte para um arquivo.";
    private const string DiskFullMessage = "Não há espaço em disco para o arquivo temporário da exportação, na pasta de dados do Prism.";

    private readonly Dictionary<EDatabaseEngine, IDatabaseClient> _clients;
    private readonly ITransferFileClient _files;
    private readonly IImportFileClient _importFiles;
    private readonly IVaultService _vault;
    private readonly TransferSettings _settings;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger _logger;
    private readonly ITimer _watch;

    /// <summary>Toda leitura e toda mudança de estado de um trabalho passam por esta trava; a leitura do banco e a escrita do arquivo, não.</summary>
    private readonly Lock _gate = new();

    private readonly Dictionary<Guid, Transfer> _transfers = [];

    public TransferService(IEnumerable<IDatabaseClient> clients, ITransferFileClient files, IImportFileClient importFiles, IVaultService vault, TransferSettings settings, TimeProvider timeProvider, ILogger logger)
    {
        _clients = clients.ToDictionary(client => client.Engine);
        _files = files;
        _importFiles = importFiles;
        _vault = vault;
        _settings = settings;
        _timeProvider = timeProvider;
        _logger = logger.ForContext<TransferService>();

        // RN-EXPORT-018: a partida apaga o que sobrou na pasta `transfers` de uma execução que caiu; nenhum trabalho atravessa uma partida.
        _files.Prepare();

        // RN-EXPORT-016 e RN-COFRE-008: fechar o cofre cancela os trabalhos dele.
        _vault.Locked += OnVaultLocked;
        _watch = timeProvider.CreateTimer(_ => Watch(), null, settings.CheckEvery, settings.CheckEvery);
    }

    public Result<Guid, ETransferStartFailure> StartExport(ExportJob job)
    {
        var now = _timeProvider.GetTimestamp();
        Transfer transfer;

        lock (_gate)
        {
            if (_vault.Generation != job.VaultGeneration)
                return ETransferStartFailure.VaultChanged;

            // As que terminaram não contam, nem a cancelada que ainda está parando em segundo plano.
            if (_transfers.Values.Count(running => running.State == ETransferState.Running) >= _settings.Limit)
                return ETransferStartFailure.LimitReached;

            transfer = new Transfer(Guid.CreateVersion7(), ETransferKind.Export, job.ConnectionID, job.WindowID, job.VaultGeneration, _timeProvider.GetUtcNow(), now);
            _transfers[transfer.ID] = transfer;
            transfer.Task = Task.Run(() => RunExportAsync(transfer, job));
        }

        _logger.Information("Exportação {TransferID} começou; conexão {ConnectionID}, formato {Format}, contagem {Count}.", transfer.ID, job.ConnectionID, job.Format, job.Count);

        return transfer.ID;
    }

    public Result<Guid, ETransferStartFailure> StartImport(ImportJob job)
    {
        var now = _timeProvider.GetTimestamp();
        Transfer transfer;

        lock (_gate)
        {
            if (Refusal(job.VaultGeneration, job.Settings, job.Schema, job.Table) is { } refusal)
                return refusal;

            transfer = new Transfer(Guid.CreateVersion7(), ETransferKind.Import, job.ConnectionID, job.WindowID, job.VaultGeneration, _timeProvider.GetUtcNow(), now)
            {
                TargetConnectionID = job.ConnectionID,
                Target = (job.Settings, job.Schema, job.Table),
                Committed = 0
            };

            // RN-IMPORT-014: a API toma o arquivo; dali em diante ele é do trabalho. O que sumiu antes da troca (o processo principal o soltou) é 404, e o
            // arquivo que o sistema não deixa renomear também não é do trabalho: a resposta é a mesma, e a tela pede o arquivo de novo.
            if (_importFiles.Take(job.FileID, transfer.ID) is not null)
                return ETransferStartFailure.FileMissing;

            // O cofre não muda sob esta trava (o aviso de fechamento a espera), mas a geração é lida de novo depois da troca: se mudou, nada fica.
            if (_vault.Generation != job.VaultGeneration)
            {
                _files.Delete(transfer.ID);

                return ETransferStartFailure.VaultChanged;
            }

            _transfers[transfer.ID] = transfer;
            transfer.Task = Task.Run(() => RunImportAsync(transfer, job));
        }

        _logger.Information("Importação {TransferID} começou; conexão {ConnectionID}, formato {Format}, arquivo {FileID}.", transfer.ID, job.ConnectionID, job.Format, job.FileID);

        return transfer.ID;
    }

    public Result<Guid, ETransferStartFailure> StartCopy(CopyJob job)
    {
        var now = _timeProvider.GetTimestamp();
        Transfer transfer;

        lock (_gate)
        {
            if (Refusal(job.VaultGeneration, job.TargetSettings, job.Schema, job.Table) is { } refusal)
                return refusal;

            transfer = new Transfer(Guid.CreateVersion7(), ETransferKind.Copy, job.SourceConnectionID, job.WindowID, job.VaultGeneration, _timeProvider.GetUtcNow(), now)
            {
                TargetConnectionID = job.TargetConnectionID,
                Target = (job.TargetSettings, job.Schema, job.Table),
                Committed = 0
            };

            _transfers[transfer.ID] = transfer;
            transfer.Task = Task.Run(() => RunCopyAsync(transfer, job));
        }

        _logger.Information("Cópia {TransferID} começou; origem {SourceConnectionID}, destino {TargetConnectionID}, contagem {Count}.", transfer.ID, job.SourceConnectionID, job.TargetConnectionID, job.Count || job.ForcedCount);

        return transfer.ID;
    }

    /// <summary>
    /// Com a trava tomada. RN-EXPORT-016 e RN-IMPORT-014: o cofre que mudou, o limite (as que terminaram não contam, nem a cancelada que ainda está
    /// parando em segundo plano) e a tabela ocupada por outra importação ou cópia em andamento, pela regra da própria origem (RN-IMPORT-023).
    /// </summary>
    private ETransferStartFailure? Refusal(long vaultGeneration, ConnectionSettings settings, string schema, string table)
    {
        if (_vault.Generation != vaultGeneration)
            return ETransferStartFailure.VaultChanged;

        var running = _transfers.Values.Where(transfer => transfer.State == ETransferState.Running).ToList();
        if (running.Count >= _settings.Limit)
            return ETransferStartFailure.LimitReached;

        if (running.FirstOrDefault(transfer => transfer.Target is { } busy && TablePlaces.SameTable(busy.Settings, busy.Schema, busy.Table, settings, schema, table)) is { } occupied)
            return occupied.Kind == ETransferKind.Copy ? ETransferStartFailure.CopyBusy : ETransferStartFailure.ImportBusy;

        return null;
    }

    public TransferInfo? Get(Guid id)
    {
        lock (_gate)
        {
            if (!_transfers.TryGetValue(id, out var transfer) || transfer.VaultGeneration != _vault.Generation)
                return null;

            transfer.LastPolled = _timeProvider.GetTimestamp();

            return Snapshot(transfer);
        }
    }

    public IReadOnlyList<TransferInfo> List()
    {
        lock (_gate)
            return [.. _transfers.Values.Where(transfer => transfer.VaultGeneration == _vault.Generation).OrderBy(transfer => transfer.StartedAt).Select(Snapshot)];
    }

    public async Task<bool> DeleteAsync(Guid id)
    {
        Transfer? transfer;
        bool running;
        var closed = false;

        lock (_gate)
        {
            if (!_transfers.TryGetValue(id, out transfer) || transfer.VaultGeneration != _vault.Generation)
                return false;

            running = transfer.State == ETransferState.Running;
            if (running)
            {
                transfer.CancelReason ??= ETransferCancelReason.Person;
            }
            else
            {
                // O cancelamento que chega depois do fim não muda o fim: esquece, e o arquivo que sobrou sai.
                closed = Forget(transfer);
            }
        }

        if (!running)
        {
            if (closed)
                _files.Delete(id);

            _logger.Information("Transferência {TransferID} esquecida.", id);

            return true;
        }

        // Sem esperar os avisos do cancelamento: o da conexão (`Cancel`) pode ficar preso na rede da conexão meio aberta, e o prazo tem de começar agora.
        _ = transfer.Cancellation.CancelAsync();
        if (await Task.WhenAny(transfer.Task, Task.Delay(_settings.CancelWait, _timeProvider)) == transfer.Task)
        {
            // O trabalho que terminou apesar do cancelamento (o último lote chegou antes dele) fica `done`, mas a tela já o deu por cancelado e não o
            // consulta mais: esquece, e o arquivo pronto sai, para ele não contar como pronto e não entregue até o abandono.
            // A importação e a cópia que terminaram assim ficam: a tela lê o fim delas (a confirmação final já tinha terminado) e as esquece depois.
            lock (_gate)
                closed = transfer.Kind == ETransferKind.Export && transfer.State == ETransferState.Done && !transfer.Removed && Forget(transfer);

            if (closed)
            {
                _files.Delete(id);
                _logger.Information("Transferência {TransferID} terminou antes do cancelamento e foi esquecida.", id);
            }

            return true;
        }

        // A conexão meio aberta, que não responde nem ao cancelamento: o trabalho fica cancelado e deixa de contar para o limite, e a conexão é abandonada
        // em segundo plano; o arquivo sai quando ela enfim parar, ou na partida seguinte.
        // RN-IMPORT-014: abandonada no meio de uma confirmação (ou, no Informix sem log, de um comando), o banco ainda pode concluí-la: o fim leva a dúvida.
        lock (_gate)
        {
            if (transfer.State == ETransferState.Running)
            {
                transfer.Uncertain = transfer.InDoubt;
                End(transfer, ETransferState.Canceled, null, null);
            }
        }

        _logger.Warning("Transferência {TransferID}: o trabalho não parou em {Seconds} s, e a conexão foi abandonada em segundo plano.", id, _settings.CancelWait.TotalSeconds);

        return true;
    }

    public void CancelByConnection(Guid connectionID)
    {
        Transfer[] canceled;

        lock (_gate)
        {
            canceled = [.. _transfers.Values.Where(transfer => (transfer.ConnectionID == connectionID || transfer.TargetConnectionID == connectionID) && transfer.State == ETransferState.Running)];
            foreach (var transfer in canceled)
                transfer.CancelReason ??= ETransferCancelReason.ConnectionDeleted;
        }

        foreach (var transfer in canceled)
            _ = transfer.Cancellation.CancelAsync();

        if (canceled.Length > 0)
            _logger.Information("Conexão {ConnectionID} excluída: {Transfers} transferências canceladas.", connectionID, canceled.Length);
    }

    /// <summary>RN-EXPORT-016: a API que encerra cancela os trabalhos e espera por eles, com o mesmo prazo do cancelamento; o que sobrar no disco, a partida seguinte apaga.</summary>
    public async ValueTask DisposeAsync()
    {
        _vault.Locked -= OnVaultLocked;
        await _watch.DisposeAsync();

        Transfer[] all;
        var closed = new List<Transfer>();
        lock (_gate)
        {
            all = [.. _transfers.Values];
            foreach (var transfer in all)
            {
                if (Forget(transfer))
                    closed.Add(transfer);
            }
        }

        foreach (var transfer in closed)
            _files.Delete(transfer.ID);

        // Como no `DELETE`, sem esperar os avisos do cancelamento: o prazo começa agora, também com uma conexão presa no `Cancel`.
        foreach (var transfer in all)
            _ = transfer.Cancellation.CancelAsync();

        await Task.WhenAny(Task.WhenAll(all.Select(transfer => transfer.Task)), Task.Delay(_settings.CancelWait, _timeProvider));
    }

    /// <summary>
    /// RN-EXPORT-016 e RN-COFRE-008. O aviso chega na thread que fechou o cofre; numa troca de usuário, com o cofre novo já aberto. Saem os trabalhos de
    /// outra geração: são cancelados e esquecidos, e os arquivos saem (o do que ainda roda, quando ele parar).
    /// </summary>
    private void OnVaultLocked()
    {
        Transfer[] taken;
        var closed = new List<Transfer>();

        lock (_gate)
        {
            taken = [.. _transfers.Values.Where(transfer => transfer.VaultGeneration != _vault.Generation)];
            foreach (var transfer in taken)
            {
                if (Forget(transfer))
                    closed.Add(transfer);
            }
        }

        foreach (var transfer in taken)
            _ = transfer.Cancellation.CancelAsync();

        foreach (var transfer in closed)
            _files.Delete(transfer.ID);

        if (taken.Length > 0)
            _logger.Information("O cofre fechou: {Transfers} transferências canceladas e esquecidas.", taken.Length);
    }

    /// <summary>
    /// RN-EXPORT-016. O abandono: o trabalho que ninguém consulta há 5 minutos, em qualquer estado, é cancelado e esquecido, e o arquivo sai. A falta de
    /// progresso: o que roda e não escreve uma linha nem muda de fase há 2 horas termina como `failed` (`EXPORT_STALLED`) na hora, mesmo que a conexão
    /// não responda ao cancelamento, para não segurar o limite nem o bloqueio por inatividade.
    /// </summary>
    private void Watch()
    {
        var abandoned = new List<Transfer>();
        var stalled = new List<Transfer>();
        var closed = new List<Transfer>();

        lock (_gate)
        {
            foreach (var transfer in _transfers.Values.ToList())
            {
                if (_timeProvider.GetElapsedTime(transfer.LastPolled) >= _settings.AbandonAfter)
                {
                    if (Forget(transfer))
                        closed.Add(transfer);

                    abandoned.Add(transfer);
                }
                else if (transfer.State == ETransferState.Running && _timeProvider.GetElapsedTime(transfer.LastProgress) >= _settings.StallAfter)
                {
                    transfer.Uncertain = transfer.InDoubt;
                    End(transfer, ETransferState.Failed, StalledFailure(transfer.Kind), null);
                    stalled.Add(transfer);
                }
            }
        }

        foreach (var transfer in abandoned.Concat(stalled))
            _ = transfer.Cancellation.CancelAsync();

        foreach (var transfer in closed)
            _files.Delete(transfer.ID);

        foreach (var transfer in abandoned)
            _logger.Information("Transferência {TransferID} abandonada: ninguém a consultou por {Minutes} minutos.", transfer.ID, _settings.AbandonAfter.TotalMinutes);

        foreach (var transfer in stalled)
            _logger.Warning("Transferência {TransferID} encerrada: {Hours} horas sem progresso ({Error}).", transfer.ID, _settings.StallAfter.TotalHours, transfer.Error?.Code);
    }

    /// <summary>RN-EXPORT-016 e RN-IMPORT-014: a falta de progresso, com o código e a frase de cada tipo de trabalho.</summary>
    private static TransferFailure StalledFailure(ETransferKind kind)
        => kind switch
        {
            ETransferKind.Export => new TransferFailure(ETransferError.Stalled, StalledMessage),
            ETransferKind.Import => new TransferFailure(ETransferError.ImportStalled, ImportStalledMessage) { Side = ETransferSide.Target },
            _ => new TransferFailure(ETransferError.ImportStalled, CopyStalledMessage)
        };

    /// <summary>
    /// RN-EXPORT-017 e 018: conectar, preparar a sessão, contar (quando pedido), abrir a leitura, conferir as colunas, escrever o arquivo lote a lote e
    /// completá-lo. Cada passo devolve a falha, e a primeira é o fim; o cancelamento é conferido entre os passos e alcança o comando em andamento pelo
    /// `Cancel` da conexão.
    /// </summary>
    private async Task RunExportAsync(Transfer transfer, ExportJob job)
    {
        var token = transfer.Cancellation.Token;
        ExportFile? file = null;
        TransferSummary? summary = null;
        TransferFailure? failure = null;

        var opened = await ConnectAsync(job.Settings, token);
        if (opened.IsFailure)
        {
            failure = new TransferFailure(ETransferError.DatabaseConnectionFailed, opened.Error.Message, opened.Error.SqlState);
        }
        else
        {
            await using var connection = opened.Value;
            using var interruption = token.Register(connection.Cancel);
            (summary, failure, file) = await ExportAsync(transfer, job, connection, token);
        }

        Finish(transfer, job, summary, failure, file);
    }

    private async Task<(TransferSummary? Summary, TransferFailure? Failure, ExportFile? File)> ExportAsync(Transfer transfer, ExportJob job, IDatabaseConnection connection, CancellationToken token)
    {
        var begun = await connection.BeginExportAsync(token);
        if (begun.IsFailure)
            return (null, DatabaseFailureOf(begun.Error), null);

        if (job.Count)
        {
            Advance(transfer, ETransferPhase.Counting);
            var counted = await connection.CountExportAsync(job.Sql, required: false, token, job.Parameters);
            if (counted.IsFailure)
                return (null, DatabaseFailureOf(counted.Error), null);

            lock (_gate)
                transfer.Total = counted.Value;
        }

        Advance(transfer, ETransferPhase.Reading);
        var started = await connection.StartExportReadAsync(job.Sql, token, job.Parameters);
        if (started.IsFailure)
            return (null, DatabaseFailureOf(started.Error), null);

        // RN-EXPORT-017: nos Registros e no resultado, cada coluna marcada tem de estar na posição e com o nome que a tela mandou; na tabela, o `SELECT`
        // já leva só as marcadas, na ordem.
        var columns = started.Value;
        IReadOnlyList<int> ordinals = job.CheckColumns ? [.. job.Columns.Select(column => column.Position)] : [.. Enumerable.Range(0, columns.Count)];
        if (columns.Count == 0 || (job.CheckColumns && job.Columns.Any(column => column.Position >= columns.Count || columns[column.Position].Name != column.Name)))
            return (null, new TransferFailure(ETransferError.ColumnsChanged, ColumnsChangedMessage), null);

        var written = ordinals.Select(ordinal => new ExportColumn(columns[ordinal].Name, columns[ordinal].Type, columns[ordinal].Kind)).ToList();
        var skipped = job.Options.Binary == EExportBinary.Null ? ordinals.Where(ordinal => columns[ordinal].Kind == "binary").ToHashSet() : [];
        var plan = new ExportReadPlan(ordinals, skipped);

        var created = _files.CreateExport(transfer.ID, job.Format, new ExportWriterContext(written, job.SourceName, job.Settings.Engine, job.Options), job.Bom, job.ZipEntryName);
        if (created.IsFailure)
            return (null, WriteFailureOf(created.Error), null);

        var file = created.Value;
        var begin = _files.Begin(file);
        if (begin.IsFailure)
            return (null, WriteFailureOf(begin.Error), file);

        long rows = 0;
        while (true)
        {
            if (token.IsCancellationRequested)
                return (null, null, file);

            var batch = await connection.ReadExportRowsAsync(plan, token);
            if (batch.IsFailure)
                return (null, DatabaseFailureOf(batch.Error), file);

            if (batch.Value.Oversize is { } oversize)
                return (null, OversizeOf(oversize, rows + batch.Value.Rows.Count + 1, written), file);

            var appended = _files.Append(file, batch.Value.Rows);
            if (appended.IsFailure)
                return (null, WriteFailureOf(appended.Error), file);

            rows += batch.Value.Rows.Count;
            Advance(transfer, ETransferPhase.Reading, rows, file.Bytes);

            if (job.Clipboard && file.Bytes > ClipboardLimit)
                return (null, new TransferFailure(ETransferError.ClipboardTooLarge, ClipboardTooLargeMessage), file);

            if (batch.Value.Finished)
                break;
        }

        Advance(transfer, ETransferPhase.Finishing, rows, file.Bytes);
        var completed = _files.Complete(file);
        if (completed.IsFailure)
            return (null, WriteFailureOf(completed.Error), file);

        if (job.Clipboard && completed.Value > ClipboardLimit)
            return (null, new TransferFailure(ETransferError.ClipboardTooLarge, ClipboardTooLargeMessage), file);

        var counts = file.Writer.Counts;

        return (new TransferSummary(rows, completed.Value, counts.Sheets, counts.CutValues, counts.RemovedCharacters, counts.SkippedRows), null, file);
    }

    /// <summary>RN-IMPORT-012 a 016: a importação, pelo <see cref="ImportRun"/>, e o fim dela.</summary>
    private async Task RunImportAsync(Transfer transfer, ImportJob job)
    {
        var run = new ImportRun(transfer.ID, job, ConnectAsync, _importFiles, new TransferProgress(transfer, _gate, _timeProvider), _logger, transfer.Cancellation.Token);
        var end = await SafelyAsync(transfer, run.RunAsync, "a importação");
        var state = FinishLoad(transfer, end);
        var (elapsedMs, rows, committed, bytes, error) = LoadLog(transfer);

        // RN-LOG-001 e RN-IMPORT-014: os identificadores, o formato, as linhas lidas, gravadas e confirmadas, os bytes, a duração e a classe do erro com o
        // SQLSTATE; nunca o nome do arquivo, um caminho, os nomes da tabela e das colunas, os valores, a linha com o erro nem a mensagem do banco.
        if (error is null)
            _logger.Information("Importação {TransferID} terminou ({State}) em {ElapsedMs} ms; conexão {ConnectionID}, formato {Format}, {ReadRows} linhas lidas, {Rows} gravadas, {Committed} confirmadas, {Bytes} bytes.", transfer.ID, state, elapsedMs, job.ConnectionID, job.Format, run.ReadRows, rows, committed, bytes);
        else
            _logger.Information("Importação {TransferID} terminou ({State}) em {ElapsedMs} ms; conexão {ConnectionID}, formato {Format}, {ReadRows} linhas lidas, {Rows} gravadas, {Committed} confirmadas, {Bytes} bytes ({Error}, SQLSTATE {SqlState}).", transfer.ID, state, elapsedMs, job.ConnectionID, job.Format, run.ReadRows, rows, committed, bytes, error.Code, error.SqlState);
    }

    /// <summary>RN-IMPORT-022 a 027: a cópia para outro banco, pelo <see cref="CopyRun"/>, e o fim dela.</summary>
    private async Task RunCopyAsync(Transfer transfer, CopyJob job)
    {
        var run = new CopyRun(job, ConnectAsync, new TransferProgress(transfer, _gate, _timeProvider), transfer.Cancellation.Token);
        var end = await SafelyAsync(transfer, run.RunAsync, "a cópia");
        var state = FinishLoad(transfer, end);
        var (elapsedMs, rows, committed, _, error) = LoadLog(transfer);

        // RN-LOG-001 e RN-IMPORT-027: o da importação, com as duas conexões e sem o comando da origem.
        if (error is null)
            _logger.Information("Cópia {TransferID} terminou ({State}) em {ElapsedMs} ms; origem {SourceConnectionID}, destino {TargetConnectionID}, {ReadRows} linhas lidas, {Rows} gravadas, {Committed} confirmadas.", transfer.ID, state, elapsedMs, job.SourceConnectionID, job.TargetConnectionID, run.ReadRows, rows, committed);
        else
            _logger.Information("Cópia {TransferID} terminou ({State}) em {ElapsedMs} ms; origem {SourceConnectionID}, destino {TargetConnectionID}, {ReadRows} linhas lidas, {Rows} gravadas, {Committed} confirmadas ({Error}, SQLSTATE {SqlState}, lado {Side}).", transfer.ID, state, elapsedMs, job.SourceConnectionID, job.TargetConnectionID, run.ReadRows, rows, committed, error.Code, error.SqlState, error.Side);
    }

    /// <summary>
    /// A rede de segurança da importação e da cópia, que não deviam lançar (o que falha é o fim delas): a exceção que escapa mesmo assim, um defeito do
    /// Prism, termina o trabalho como `failed`, com `INTERNAL_SERVER_ERROR` e uma frase fixa, e não o deixa `Running` para sempre, com o arquivo no disco,
    /// a tabela ocupada e a vaga do limite tomada. O log recebe a classe e a pilha, nunca a mensagem, que pode trazer um valor do arquivo (RN-LOG-001).
    /// </summary>
    private async Task<LoadEnd> SafelyAsync(Transfer transfer, Func<Task<LoadEnd>> run, string what)
    {
        try
        {
            return await run();
        }
        catch (Exception exception)
        {
            _logger.Error("O trabalho {TransferID} parou por um defeito ({ExceptionType}).{NewLine}{StackTrace}", transfer.ID, exception.GetType().Name, Environment.NewLine, exception.StackTrace);

            return LoadEnd.Of(LoadSteps.Prism(ETransferError.Unexpected, $"Um erro inesperado do Prism parou {what}."));
        }
    }

    /// <summary>
    /// RN-IMPORT-014 e 016: o fim de uma importação ou de uma cópia. O resumo é `done`, mesmo com um cancelamento a caminho (a confirmação final já tinha
    /// terminado); a conexão que passou a ser somente leitura é `canceled` com `readOnly`; o cancelamento pedido é `canceled` com o motivo dele; o resto é
    /// `failed`, com as linhas confirmadas até ali e a dúvida da última confirmação. O estado só muda se ninguém o mudou antes (o `DELETE` que desistiu de
    /// esperar, a falta de progresso). O arquivo da importação sai em todo fim (RN-IMPORT-017), pela mesma regra do <see cref="Transfer.Closed"/>.
    /// </summary>
    private ETransferState FinishLoad(Transfer transfer, LoadEnd end)
    {
        ETransferState state;
        lock (_gate)
        {
            if (transfer.State == ETransferState.Running)
            {
                var failure = end.Stop?.Failure;
                if (end.Summary is not null)
                {
                    End(transfer, ETransferState.Done, null, end.Summary);
                }
                else if (end.Stop?.Reason is { } reason)
                {
                    transfer.CancelReason = reason;
                    End(transfer, ETransferState.Canceled, null, null);
                }
                else if (failure is null || transfer.Cancellation.IsCancellationRequested)
                {
                    transfer.Uncertain = failure?.Uncertain == true;
                    End(transfer, ETransferState.Canceled, null, null);
                }
                else
                {
                    transfer.Uncertain = failure.Uncertain == true;
                    End(transfer, ETransferState.Failed, failure, null);
                }
            }

            state = transfer.State;
            transfer.Closed = true;
        }

        if (transfer.Kind == ETransferKind.Import)
            _files.Delete(transfer.ID);

        return state;
    }

    /// <summary>O que o log do fim de uma importação ou de uma cópia leva: a duração, as contagens e o erro (só a classe e o SQLSTATE vão ao log).</summary>
    private (long ElapsedMs, long Rows, long? Committed, long Bytes, TransferFailure? Error) LoadLog(Transfer transfer)
    {
        lock (_gate)
            return ((long)_timeProvider.GetElapsedTime(transfer.StartedTimestamp).TotalMilliseconds, transfer.Rows, transfer.Committed, transfer.Bytes, transfer.Error);
    }

    /// <summary>
    /// O fim do trabalho. O que terminou é `done`, mesmo com um cancelamento a caminho; o cancelado é `canceled`, com o motivo; o resto é `failed`. O
    /// estado só muda se ninguém o mudou antes (o `DELETE` que desistiu de esperar, a falta de progresso). Na falha, no cancelamento e no trabalho que
    /// saiu do registro, o arquivo pela metade (ou o pronto) é apagado: nada do que foi escrito chega ao destino.
    ///
    /// Quem apaga o arquivo do trabalho que sai do registro é decidido sob a trava, pelo <see cref="Transfer.Closed"/>: o que sai antes de o arquivo
    /// fechar o deixa para cá, e o que sai depois o apaga ele mesmo. Assim nenhum dos dois lados pula o arquivo, por mais que o resto daqui demore.
    /// </summary>
    private void Finish(Transfer transfer, ExportJob job, TransferSummary? summary, TransferFailure? failure, ExportFile? file)
    {
        bool removed;
        ETransferState state;

        lock (_gate)
        {
            if (transfer.State == ETransferState.Running)
            {
                if (summary is not null)
                    End(transfer, ETransferState.Done, null, summary);
                else if (transfer.Cancellation.IsCancellationRequested)
                    End(transfer, ETransferState.Canceled, null, null);
                else
                    End(transfer, ETransferState.Failed, failure, null);
            }

            state = transfer.State;
        }

        if (file is not null)
            _files.Close(file);

        lock (_gate)
        {
            transfer.Closed = true;
            removed = transfer.Removed;
        }

        if (state != ETransferState.Done || removed)
            _files.Delete(transfer.ID);

        var elapsedMs = (long)_timeProvider.GetElapsedTime(transfer.StartedTimestamp).TotalMilliseconds;
        var error = transfer.Error;

        // RN-LOG-001: o identificador, a conexão, o formato, as contagens, a duração e a classe do erro com o SQLSTATE; nunca o comando, os nomes, os
        // valores, o nome do arquivo, um caminho nem a mensagem do banco.
        if (error is null)
            _logger.Information("Exportação {TransferID} terminou ({State}) em {ElapsedMs} ms; conexão {ConnectionID}, formato {Format}, {Rows} linhas, {Bytes} bytes.", transfer.ID, state, elapsedMs, transfer.ConnectionID, job.Format, transfer.Rows, transfer.Bytes);
        else
            _logger.Information("Exportação {TransferID} terminou ({State}) em {ElapsedMs} ms; conexão {ConnectionID}, formato {Format}, {Rows} linhas, {Bytes} bytes ({Error}, SQLSTATE {SqlState}).", transfer.ID, state, elapsedMs, transfer.ConnectionID, job.Format, transfer.Rows, transfer.Bytes, error.Code, error.SqlState);
    }

    /// <summary>
    /// Com a trava tomada. Tira o trabalho do registro e diz se o arquivo dele sai agora, por quem o tirou: sim quando o trabalho já fechou o arquivo; senão,
    /// o <see cref="Finish"/>, que vê o <see cref="Transfer.Removed"/>, o apaga.
    /// </summary>
    private bool Forget(Transfer transfer)
    {
        _transfers.Remove(transfer.ID);
        transfer.Removed = true;

        return transfer.Closed;
    }

    /// <summary>Com a trava tomada.</summary>
    private void End(Transfer transfer, ETransferState state, TransferFailure? failure, TransferSummary? summary)
    {
        // RN-IMPORT-016: o erro da importação e da cópia diz as linhas confirmadas até ele e a dúvida da última confirmação.
        if (failure is not null && transfer.Kind != ETransferKind.Export)
            failure = failure with { Committed = transfer.Committed ?? 0, Uncertain = transfer.Uncertain, Side = failure.Side ?? ETransferSide.Target };

        transfer.State = state;
        transfer.Error = failure;
        transfer.Summary = summary;
        transfer.Reason = state == ETransferState.Canceled ? transfer.CancelReason ?? ETransferCancelReason.Person : null;
        transfer.FinishedAt = _timeProvider.GetUtcNow();

        if (summary is not null)
        {
            transfer.Rows = summary.Rows;
            transfer.Bytes = summary.Bytes;
            if (transfer.Kind != ETransferKind.Export)
                transfer.Committed = summary.Committed;
        }
    }

    /// <summary>RN-EXPORT-016: uma fase nova ou um lote escrito é progresso, e adia o fim por falta dele.</summary>
    private void Advance(Transfer transfer, ETransferPhase phase, long? rows = null, long? bytes = null)
    {
        lock (_gate)
        {
            if (transfer.State != ETransferState.Running)
                return;

            transfer.Phase = phase;
            transfer.Rows = rows ?? transfer.Rows;
            transfer.Bytes = bytes ?? transfer.Bytes;
            transfer.LastProgress = _timeProvider.GetTimestamp();
        }
    }

    /// <summary>
    /// RN-ABERTO-006: o PostgreSQL tem client em toda plataforma; o banco sem client é o Db2 ou o Informix numa plataforma para a qual a IBM não publica
    /// o driver, e a resposta diz isso, como na abertura de uma sessão.
    /// </summary>
    private Task<Result<IDatabaseConnection, DatabaseFailure>> ConnectAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        => _clients.TryGetValue(settings.Engine, out var client)
            ? client.OpenAsync(settings, cancellationToken)
            : Task.FromResult(Result.Failure<IDatabaseConnection, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ConnectionFailed, $"O Prism para {RuntimeInformation.RuntimeIdentifier} ainda não conecta em Db2 e Informix: a IBM não publica o driver para ela.")));

    /// <summary>RN-EXPORT-017: a recusa do banco ou do driver ao contar e ao ler, com a mensagem como veio e o SQLSTATE (decisão 4 da seção 8).</summary>
    private static TransferFailure DatabaseFailureOf(DatabaseFailure failure)
        => new(failure.Kind == EDatabaseFailure.ConnectionFailed ? ETransferError.DatabaseConnectionFailed : ETransferError.SqlExecutionFailed, failure.Message, failure.SqlState);

    /// <summary>RN-EXPORT-018: o disco cheio tem a frase dele; o resto leva o motivo do sistema, sem o caminho.</summary>
    private static TransferFailure WriteFailureOf(TransferFileFailure failure)
        => new(ETransferError.WriteFailed, failure.DiskFull ? DiskFullMessage : $"Não foi possível gravar o arquivo temporário da exportação: {failure.Reason}.");

    /// <summary>RN-EXPORT-017: o valor ou a linha acima do teto, com o número da linha na ordem da origem e o nome da coluna (que vão à tela, e não ao log).</summary>
    private static TransferFailure OversizeOf(ExportOversize oversize, long row, IReadOnlyList<ExportColumn> columns)
        => new(ETransferError.ValueTooLarge, oversize.WholeRow
            ? $"A linha {Thousands(row)} passa de 256 MiB de valores, e o Prism não a exporta. Deixe colunas de fora na Extração, ou o binário vazio na Formatação."
            : $"Um valor da coluna {columns[oversize.Column].Name}, na linha {Thousands(row)}, passa de 64 MiB, e o Prism não o exporta. Deixe a coluna de fora na Extração, ou o binário vazio na Formatação.");

    /// <summary>O número com o ponto de milhar do português ("1.234"), sem depender da cultura da máquina.</summary>
    private static string Thousands(long value)
        => value.ToString("#,0", CultureInfo.InvariantCulture).Replace(',', '.');

    /// <summary>Com a trava tomada.</summary>
    private static TransferInfo Snapshot(Transfer transfer)
        => new(transfer.ID, transfer.Kind, transfer.ConnectionID, transfer.TargetConnectionID, transfer.WindowID, transfer.State, transfer.Phase, transfer.Rows, transfer.Committed, transfer.Total, transfer.Bytes, transfer.Size, transfer.Uncertain, transfer.Summary, transfer.Error, transfer.Reason, transfer.StartedAt, transfer.FinishedAt);
}
