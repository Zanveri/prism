using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Prism.Infrastructure.Transfers.Writers;
using Prism.Infrastructure.Vault.Services;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Text;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-EXPORT-016 a 018: o registro das transferências com uma conexão de mentira (só a leitura da exportação), o client do disco de verdade numa pasta
/// temporária e o relógio na mão do teste (o abandono, a falta de progresso e o prazo do cancelamento). Esperar o fim de um trabalho é consultar o
/// registro em laço, e nunca um tempo chutado.
/// </summary>
public sealed class TransferServiceTests : IAsyncDisposable
{
    private static readonly CsvExportOptions Csv = new(";", true, ECsvQuoting.Auto, true, "\n", string.Empty, EExportBinary.Hex);

    private readonly string _data = Directory.CreateTempSubdirectory("prism-transfers-").FullName;
    private readonly FakeTimeProvider _clock = new();
    private readonly Mock<IVaultService> _vault = new();
    private readonly Guid _connectionID = Guid.CreateVersion7();
    private readonly List<TransferService> _services = [];
    private long _generation = 1;

    public TransferServiceTests()
        => _vault.SetupGet(vault => vault.Generation).Returns(() => _generation);

    private string Folder => Path.Combine(_data, "transfers");

    public async ValueTask DisposeAsync()
    {
        foreach (var service in _services)
            await service.DisposeAsync();

        Directory.Delete(_data, recursive: true);
    }

    private TransferService CreateService(params IDatabaseConnection[] connections)
        => CreateService(new QueueClient(connections), Logger.None);

    private TransferService CreateService(IDatabaseClient client, ILogger logger)
    {
        var settings = TransferSettings.For(_data);
        var service = new TransferService([client], new TransferFileClient(settings, logger), _vault.Object, settings, _clock, logger);
        _services.Add(service);

        return service;
    }

    private ExportJob Job(ExportFormatOptions? options = null, string format = ExportFormats.Csv, bool count = false, IReadOnlyList<ExportColumnChoice>? columns = null, bool clipboard = false)
        => new(_connectionID, new ConnectionSettings(EDatabaseEngine.PostgreSql, "db.invalid", 5432, "loja", "leitor", "segredo"), _generation, 7, "SELECT id, cliente FROM loja.pedido", columns ?? [new(0, "id"), new(1, "cliente")], true, count, format, options ?? Csv, "pedido", false, null, clipboard);

    private static async Task<TransferInfo> UntilAsync(TransferService service, Guid id, Func<TransferInfo, bool> condition)
    {
        for (var attempt = 0; attempt < 1000; attempt++)
        {
            if (service.Get(id) is { } info && condition(info))
                return info;

            await Task.Delay(10);
        }

        throw new TimeoutException("O trabalho não chegou ao estado esperado.");
    }

    private static Task<TransferInfo> FinishedAsync(TransferService service, Guid id)
        => UntilAsync(service, id, info => info.State != ETransferState.Running);

    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "OK a exportação conecta, lê, escreve o .ready e termina com o resumo")]
    public async Task Export_ShouldWriteTheReadyFile_AndFinishDone()
    {
        //Arrange
        var connection = new ExportConnection();
        var service = CreateService(connection);

        //Act
        var id = service.StartExport(Job()).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Done, ETransferKind.Export, _connectionID, 7L), (info.State, info.Kind, info.ConnectionID, info.WindowID));
        Assert.Equal((3L, null, ETransferPhase.Finishing), (info.Rows, info.Total, info.Phase));
        Assert.Equal("id;cliente\n1;cliente 1\n2;cliente 2\n3;cliente 3\n", File.ReadAllText(Path.Combine(Folder, $"{id:D}.ready")));
        Assert.Equal(new TransferSummary(3, info.Bytes, null, 0, 0, 0), info.Summary);
        Assert.Equal((null, null), (info.Error, info.Reason));
        Assert.NotNull(info.FinishedAt);
        Assert.Equal(["BEGIN", "START SELECT id, cliente FROM loja.pedido"], connection.Calls);
        Assert.True(connection.Disposed);
    }

    /// <summary>RN-EXPORT-017: a contagem é feita antes da leitura, e a recusa dela só deixa o progresso sem total.</summary>
    [Trait("TransferService", "StartExport")]
    [Theory(DisplayName = "OK a contagem dá o total, e a recusa dela segue sem ele")]
    [InlineData(3L)]
    [InlineData(null)]
    public async Task Export_WithCount_ShouldGiveTheTotal(long? total)
    {
        //Arrange
        var connection = new ExportConnection { Total = total };
        var service = CreateService(connection);

        //Act
        var id = service.StartExport(Job(count: true)).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Done, total), (info.State, info.Total));
        Assert.Equal(["BEGIN", "COUNT", "START SELECT id, cliente FROM loja.pedido"], connection.Calls);
    }

    /// <summary>RN-EXPORT-005 e 017: só as colunas marcadas, na ordem do resultado; o binário com "Deixar vazio" nem é pedido ao leitor.</summary>
    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "OK só as colunas marcadas saem, e o binário vazio não é pedido")]
    public async Task Export_ShouldWriteOnlyTheChosenColumns()
    {
        //Arrange
        var connection = new ExportConnection { Columns = [new("id", "int4", "number"), new("foto", "bytea", "binary"), new("cliente", "text", "text")] };
        var service = CreateService(connection);

        //Act
        var id = service.StartExport(Job(options: Csv with { Binary = EExportBinary.Null, Header = false }, columns: [new(1, "foto"), new(2, "cliente")])).Value;
        await FinishedAsync(service, id);

        //Assert
        Assert.Equal(";cliente 1\n;cliente 2\n;cliente 3\n", File.ReadAllText(Path.Combine(Folder, $"{id:D}.ready")));
        Assert.Equal([1, 2], connection.Plan!.Ordinals);
        Assert.Equal([1], connection.Plan.Skipped);
    }

    /// <summary>RN-EXPORT-017: a coluna que não está mais na posição, ou com outro nome, é a falha, e nada é escrito com a coluna errada.</summary>
    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "Erro as colunas que mudaram desde a grade terminam a exportação")]
    public async Task Export_ShouldFail_WhenTheColumnsChanged()
    {
        //Arrange
        var service = CreateService(new ExportConnection());

        //Act
        var id = service.StartExport(Job(columns: [new(0, "id"), new(1, "nome")])).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(ETransferState.Failed, info.State);
        Assert.Equal(new TransferFailure(ETransferError.ColumnsChanged, "As colunas do resultado mudaram desde a grade. Execute o comando de novo e exporte outra vez."), info.Error);
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>RN-EXPORT-017: a recusa do banco ao ler é a falha, com a mensagem como veio e o SQLSTATE; o arquivo pela metade é apagado.</summary>
    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "Erro a recusa do banco no meio da leitura termina a exportação com a mensagem dele")]
    public async Task Export_ShouldFail_WithTheDatabaseMessage()
    {
        //Arrange
        var service = CreateService(new ExportConnection { ReadFailure = new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "division by zero", "22012") });

        //Act
        var id = service.StartExport(Job()).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(new TransferFailure(ETransferError.SqlExecutionFailed, "division by zero", "22012"), info.Error);
        Assert.Empty(Directory.GetFiles(Folder));
    }

    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "Erro a conexão que não abre termina a exportação com DATABASE_CONNECTION_FAILED")]
    public async Task Export_ShouldFail_WhenTheConnectionDoesNotOpen()
    {
        //Arrange
        var service = CreateService(new QueueClient([], new DatabaseFailure(EDatabaseFailure.ConnectionFailed, "password authentication failed", "28P01")), Logger.None);

        //Act
        var id = service.StartExport(Job()).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(new TransferFailure(ETransferError.DatabaseConnectionFailed, "password authentication failed", "28P01"), info.Error);
    }

    /// <summary>RN-EXPORT-017: o valor acima do teto diz a coluna e a linha (com o ponto de milhar); a linha acima do teto diz só a linha.</summary>
    [Trait("TransferService", "StartExport")]
    [Theory(DisplayName = "Erro o valor ou a linha acima do teto terminam a exportação com EXPORT_VALUE_TOO_LARGE")]
    [InlineData(false, "Um valor da coluna cliente, na linha 1.235, passa de 64 MiB, e o Prism não o exporta. Deixe a coluna de fora na Extração, ou o binário vazio na Formatação.")]
    [InlineData(true, "A linha 1.235 passa de 256 MiB de valores, e o Prism não a exporta. Deixe colunas de fora na Extração, ou o binário vazio na Formatação.")]
    public async Task Export_ShouldFail_AtAValueOverTheLimit(bool wholeRow, string message)
    {
        //Arrange
        var service = CreateService(new ExportConnection { Rows = 1234, Oversize = new ExportOversize(1, wholeRow) });

        //Act
        var id = service.StartExport(Job()).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(new TransferFailure(ETransferError.ValueTooLarge, message), info.Error);
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>RN-EXPORT-014: o texto da área de transferência passa de 10 MiB: a exportação para ali.</summary>
    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "Erro o texto da área de transferência acima de 10 MiB termina a exportação")]
    public async Task Export_ToTheClipboard_ShouldFail_Past10MiB()
    {
        //Arrange
        var large = new string('x', 1024 * 1024);
        var service = CreateService(new ExportConnection { Rows = 11, Cell = (row, column) => column == 0 ? row.ToString() : large });

        //Act
        var id = service.StartExport(Job(clipboard: true)).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(new TransferFailure(ETransferError.ClipboardTooLarge, "O texto passou de 10 MiB, o limite da área de transferência. Exporte para um arquivo."), info.Error);
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>RN-EXPORT-016: até 3 em andamento, de todas as janelas; a quarta é recusada, e as que terminaram não contam.</summary>
    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "Erro a quarta transferência em andamento é recusada, e as que terminaram não contam")]
    public async Task Start_ShouldRefuseTheFourthRunning()
    {
        //Arrange
        var blocked = Enumerable.Range(0, 3).Select(_ => new ExportConnection { Block = new TaskCompletionSource() }).ToList();
        var service = CreateService([new ExportConnection(), .. blocked, new ExportConnection()]);
        var done = service.StartExport(Job()).Value;
        await FinishedAsync(service, done);
        var running = blocked.Select(_ => service.StartExport(Job()).Value).ToList();

        //Act
        var fourth = service.StartExport(Job());
        blocked[0].Block!.SetResult();
        await FinishedAsync(service, running[0]);
        var afterOneEnded = service.StartExport(Job());

        //Assert
        Assert.Equal(ETransferStartFailure.LimitReached, fourth.Error);
        Assert.True(afterOneEnded.IsSuccess);
        foreach (var connection in blocked.Skip(1))
            connection.Block!.SetResult();
    }

    /// <summary>RN-EXPORT-016: o pedido que chega depois de o cofre mudar não fica no registro.</summary>
    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "Erro o cofre que mudou antes de o trabalho entrar no registro recusa o começo")]
    public void Start_ShouldRefuse_WhenTheVaultChanged()
    {
        //Arrange
        var service = CreateService(new ExportConnection());
        var job = Job();
        _generation++;

        //Act
        var started = service.StartExport(job);

        //Assert
        Assert.Equal(ETransferStartFailure.VaultChanged, started.Error);
        Assert.Empty(service.List());
    }

    /// <summary>RN-EXPORT-016: cancelar interrompe o comando e apaga o arquivo; o cancelado fica até ser esquecido por um segundo `DELETE`.</summary>
    [Trait("TransferService", "DeleteAsync")]
    [Fact(DisplayName = "OK cancelar para o trabalho, que fica cancelado até ser esquecido")]
    public async Task Delete_ShouldCancelTheRunning_ThenForgetIt()
    {
        //Arrange
        var connection = new ExportConnection { Block = new TaskCompletionSource() };
        var service = CreateService(connection);
        var id = service.StartExport(Job()).Value;
        await UntilAsync(service, id, info => info.Phase == ETransferPhase.Reading && connection.Reading);

        //Act
        var canceled = await service.DeleteAsync(id);
        var info = service.Get(id);
        var forgotten = await service.DeleteAsync(id);
        var again = await service.DeleteAsync(id);

        //Assert
        Assert.True(canceled);
        Assert.Equal((ETransferState.Canceled, ETransferCancelReason.Person), (info!.State, info.Reason));
        Assert.True(connection.Canceled);
        Assert.True(forgotten);
        Assert.False(again);
        Assert.Null(service.Get(id));
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>RN-EXPORT-016: a conexão que não responde nem ao cancelamento: passados os 10 segundos, o trabalho fica cancelado e deixa de contar.</summary>
    [Trait("TransferService", "DeleteAsync")]
    [Fact(DisplayName = "OK o trabalho que não para em 10 segundos fica cancelado e deixa de contar para o limite")]
    public async Task Delete_ShouldGiveUpAfterTheWait()
    {
        //Arrange
        var stuck = new ExportConnection { Block = new TaskCompletionSource(), IgnoresCancel = true };
        var service = CreateService([stuck, new ExportConnection(), new ExportConnection(), new ExportConnection()]);
        var id = service.StartExport(Job()).Value;
        service.StartExport(Job());
        service.StartExport(Job());
        await UntilAsync(service, id, _ => stuck.Reading);

        //Act
        var deleting = service.DeleteAsync(id);
        while (!deleting.IsCompleted)
        {
            _clock.Advance(TimeSpan.FromSeconds(1));
            await Task.Delay(10);
        }

        var info = service.Get(id);
        var another = service.StartExport(Job());

        //Assert
        Assert.True(await deleting);
        Assert.Equal(ETransferState.Canceled, info!.State);
        Assert.True(another.IsSuccess);
        stuck.Block!.SetResult();
    }

    /// <summary>RN-EXPORT-016: o trabalho que ninguém consulta por 5 minutos, em qualquer estado, é abandonado: cancelado, esquecido e sem arquivo.</summary>
    [Trait("TransferService", "Watch")]
    [Fact(DisplayName = "OK o trabalho que ninguém consulta por 5 minutos é abandonado")]
    public async Task Watch_ShouldAbandonTheTransferNobodyPolls()
    {
        //Arrange
        var service = CreateService(new ExportConnection());
        var id = service.StartExport(Job()).Value;
        await FinishedAsync(service, id);

        //Act
        _clock.Advance(TimeSpan.FromMinutes(4));
        var kept = service.Get(id);
        _clock.Advance(TimeSpan.FromMinutes(5));

        //Assert
        Assert.NotNull(kept);
        Assert.Null(service.Get(id));
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>RN-EXPORT-016: 2 horas sem uma linha escrita nem uma fase nova terminam o trabalho como `failed`, mesmo com a conexão parada.</summary>
    [Trait("TransferService", "Watch")]
    [Fact(DisplayName = "Erro duas horas sem progresso terminam o trabalho com EXPORT_STALLED")]
    public async Task Watch_ShouldEndTheStalledTransfer()
    {
        //Arrange
        var stuck = new ExportConnection { Block = new TaskCompletionSource(), IgnoresCancel = true };
        var service = CreateService(stuck);
        var id = service.StartExport(Job()).Value;
        await UntilAsync(service, id, _ => stuck.Reading);

        //Act
        for (var minute = 0; minute < 121; minute++)
        {
            _clock.Advance(TimeSpan.FromMinutes(1));
            service.Get(id);
        }

        var info = service.Get(id);
        for (var attempt = 0; attempt < 1000 && !stuck.Canceled; attempt++)
            await Task.Delay(10);

        //Assert
        Assert.Equal(ETransferState.Failed, info!.State);
        Assert.Equal(new TransferFailure(ETransferError.Stalled, "O banco ficou 2 horas sem responder, e a exportação foi encerrada."), info.Error);
        Assert.True(stuck.Canceled);
        stuck.Block!.SetResult();
    }

    /// <summary>RN-EXPORT-016 e RN-COFRE-008: fechar o cofre cancela os trabalhos dele e os tira do registro; o cofre seguinte não os vê.</summary>
    [Trait("TransferService", "OnVaultLocked")]
    [Fact(DisplayName = "OK fechar o cofre cancela e esquece os trabalhos dele")]
    public async Task VaultLocked_ShouldCancelAndForgetTheTransfers()
    {
        //Arrange
        var connection = new ExportConnection { Block = new TaskCompletionSource() };
        var service = CreateService([connection, new ExportConnection()]);
        var running = service.StartExport(Job()).Value;
        await UntilAsync(service, running, _ => connection.Reading);

        //Act
        _generation++;
        _vault.Raise(vault => vault.Locked += null);
        for (var attempt = 0; attempt < 1000 && !connection.Disposed; attempt++)
            await Task.Delay(10);

        //Assert
        Assert.Null(service.Get(running));
        Assert.Empty(service.List());
        Assert.True(connection.Canceled);
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>RN-CONN-014: a conexão excluída cancela as exportações dela, com o motivo; as das outras conexões seguem.</summary>
    [Trait("TransferService", "CancelByConnection")]
    [Fact(DisplayName = "OK excluir a conexão cancela as exportações dela, com connectionDeleted")]
    public async Task CancelByConnection_ShouldCancelItsExports()
    {
        //Arrange
        var connection = new ExportConnection { Block = new TaskCompletionSource() };
        var service = CreateService(connection);
        var id = service.StartExport(Job()).Value;
        await UntilAsync(service, id, _ => connection.Reading);

        //Act
        service.CancelByConnection(Guid.CreateVersion7());
        var other = service.Get(id);
        service.CancelByConnection(_connectionID);
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(ETransferState.Running, other!.State);
        Assert.Equal((ETransferState.Canceled, ETransferCancelReason.ConnectionDeleted), (info.State, info.Reason));
    }

    /// <summary>RN-EXPORT-016: a lista é a do cofre aberto, na ordem do começo.</summary>
    [Trait("TransferService", "List")]
    [Fact(DisplayName = "OK a lista traz os trabalhos do cofre aberto")]
    public async Task List_ShouldBeTheTransfersOfTheOpenVault()
    {
        //Arrange
        var service = CreateService([new ExportConnection(), new ExportConnection()]);
        var first = service.StartExport(Job()).Value;
        var second = service.StartExport(Job()).Value;
        await FinishedAsync(service, first);
        await FinishedAsync(service, second);

        //Act
        var listed = service.List();

        //Assert
        Assert.Equal([first, second], listed.Select(info => info.ID));
    }

    /// <summary>RN-EXPORT-016: a API que encerra cancela os trabalhos.</summary>
    [Trait("TransferService", "DisposeAsync")]
    [Fact(DisplayName = "OK o descarte cancela o que roda e apaga os arquivos")]
    public async Task Dispose_ShouldCancelTheRunning()
    {
        //Arrange
        var connection = new ExportConnection { Block = new TaskCompletionSource() };
        var service = CreateService(connection);
        var id = service.StartExport(Job()).Value;
        await UntilAsync(service, id, _ => connection.Reading);

        //Act
        await service.DisposeAsync();
        _services.Remove(service);

        //Assert
        Assert.True(connection.Canceled);
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>RN-LOG-001: o log da exportação leva o identificador, a conexão, o formato e as contagens; nunca o comando, os valores, os nomes nem a mensagem do banco.</summary>
    [Trait("TransferService", "StartExport")]
    [Fact(DisplayName = "OK o log não leva o comando, os valores, os nomes nem a mensagem do banco")]
    public async Task Log_ShouldCarryNoCommandValueNameNorDatabaseMessage()
    {
        //Arrange
        var sink = new CollectingSink();
        var logger = new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(sink).CreateLogger();
        var service = CreateService(new QueueClient([new ExportConnection(), new ExportConnection { ReadFailure = new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "valor secreto-da-mensagem", "22012") }]), logger);

        //Act
        var done = service.StartExport(Job()).Value;
        await FinishedAsync(service, done);
        var failed = service.StartExport(Job()).Value;
        await FinishedAsync(service, failed);

        //Assert
        var text = string.Join('\n', sink.Events.Select(logged => logged.RenderMessage()));
        Assert.Contains(done.ToString(), text, StringComparison.Ordinal);
        Assert.Contains("22012", text, StringComparison.Ordinal);
        foreach (var secret in new[] { "SELECT", "loja.pedido", "cliente", "secreto", "segredo", "db.invalid", "pedido", _data })
            Assert.DoesNotContain(secret, text, StringComparison.Ordinal);
    }

    private sealed class CollectingSink : Serilog.Core.ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent)
        {
            lock (Events)
                Events.Add(logEvent);
        }
    }

    /// <summary>O client que entrega as conexões na ordem, uma por trabalho, ou a recusa dada.</summary>
    private sealed class QueueClient(IEnumerable<IDatabaseConnection> connections, DatabaseFailure? refusal = null) : IDatabaseClient
    {
        private readonly Queue<IDatabaseConnection> _connections = new(connections);

        public EDatabaseEngine Engine => EDatabaseEngine.PostgreSql;

        public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
        {
            if (refusal is not null)
                return Task.FromResult(Result.Failure<IDatabaseConnection, DatabaseFailure>(refusal));

            lock (_connections)
                return Task.FromResult(Result.Success<IDatabaseConnection, DatabaseFailure>(_connections.Dequeue()));
        }
    }

    /// <summary>
    /// A conexão de mentira da exportação: as colunas e as linhas dadas, entregues num lote só; a recusa ao ler; o valor acima do teto; e a leitura que
    /// espera (`Block`), que o cancelamento interrompe, a não ser a da conexão que não responde a ele (`IgnoresCancel`).
    /// </summary>
    private sealed class ExportConnection : IDatabaseConnection
    {
        public List<QueryColumn> Columns { get; init; } = [new("id", "int4", "number"), new("cliente", "text", "text")];

        public int Rows { get; init; } = 3;

        public Func<int, int, string> Cell { get; init; } = (row, column) => column == 0 ? row.ToString() : $"cliente {row}";

        public long? Total { get; init; } = 3;

        public DatabaseFailure? ReadFailure { get; init; }

        public ExportOversize? Oversize { get; init; }

        public TaskCompletionSource? Block { get; init; }

        public bool IgnoresCancel { get; init; }

        public List<string> Calls { get; } = [];

        public ExportReadPlan? Plan { get; private set; }

        public volatile bool Reading;

        public volatile bool Canceled;

        public volatile bool Disposed;

        public string ServerVersion => "0";

        public bool IsOpen => !Disposed;

        public bool HasOpenCursor => false;

        public void Cancel()
            => Canceled = true;

        public ValueTask DisposeAsync()
        {
            Disposed = true;

            return ValueTask.CompletedTask;
        }

        public Task<UnitResult<DatabaseFailure>> BeginExportAsync(CancellationToken cancellationToken)
        {
            Calls.Add("BEGIN");

            return Task.FromResult(UnitResult.Success<DatabaseFailure>());
        }

        public Task<Result<long?, DatabaseFailure>> CountExportAsync(string sql, CancellationToken cancellationToken)
        {
            Calls.Add("COUNT");

            return Task.FromResult(Result.Success<long?, DatabaseFailure>(Total));
        }

        public Task<Result<IReadOnlyList<QueryColumn>, DatabaseFailure>> StartExportReadAsync(string sql, CancellationToken cancellationToken)
        {
            Calls.Add($"START {sql}");

            return Task.FromResult(Result.Success<IReadOnlyList<QueryColumn>, DatabaseFailure>(Columns));
        }

        public async Task<Result<ExportBatch, DatabaseFailure>> ReadExportRowsAsync(ExportReadPlan plan, CancellationToken cancellationToken)
        {
            Plan = plan;
            Reading = true;
            if (Block is not null)
            {
                await Task.WhenAny(Block.Task, IgnoresCancel ? Block.Task : Task.Delay(Timeout.Infinite, cancellationToken));
                if (cancellationToken.IsCancellationRequested)
                    return new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "O comando foi cancelado.", Outcome: ECancelOutcome.Canceled);
            }

            if (ReadFailure is not null)
                return ReadFailure;

            IReadOnlyList<IReadOnlyList<ExportCell>> rows = [.. Enumerable.Range(1, Rows).Select(row => (IReadOnlyList<ExportCell>)[.. plan.Ordinals.Select(ordinal => plan.Skipped.Contains(ordinal) ? ExportCell.Null : ExportCell.FromText(Cell(row, ordinal)))])];

            return new ExportBatch(rows, Oversize is null, Oversize);
        }

        public Task<UnitResult<DatabaseFailure>> PingAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<UnitResult<DatabaseFailure>> VerifyAsync(string? sql, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(string sql, int pageSize, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteReadOnlyAsync(string sql, int pageSize, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<long, DatabaseFailure>> CountAsync(string sql, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task CloseCursorAsync() => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(string schema, string kind, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<ColumnInfo>, DatabaseFailure>> GetColumnsAsync(string schema, string table, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<IndexInfo>, DatabaseFailure>> GetIndexesAsync(string schema, string table, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<ForeignKeyInfo>, DatabaseFailure>> GetForeignKeysAsync(string schema, string table, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<ReferencingForeignKeyInfo>, DatabaseFailure>> GetReferencingForeignKeysAsync(string schema, string table, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<CheckConstraintInfo>, DatabaseFailure>> GetChecksAsync(string schema, string table, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<ViewDefinitionInfo, DatabaseFailure>> GetViewDefinitionAsync(string schema, string view, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<SchemaDiagramInfo, DatabaseFailure>> GetDiagramAsync(string schema, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<DatabasePropertyInfo>, DatabaseFailure>> GetPropertiesAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<DatabaseInfo>, DatabaseFailure>> GetDatabasesAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<EditCatalogTable?>, DatabaseFailure>> DescribeEditTablesAsync(EditTables tables, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<UnitResult<DatabaseFailure>> LimitLockWaitAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<int, DatabaseFailure>> ApplyEditsAsync(EditTables tables, bool oneAtATime, Func<IReadOnlyList<EditCatalogTable?>, Result<IReadOnlyList<EditCommand>, DatabaseFailure>> plan, CancellationToken cancellationToken) => throw new NotSupportedException();
    }
}
