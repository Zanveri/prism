using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Transfers.Services;
using Serilog;

namespace Prism.UnitTesting.Transfers;

/// <summary>
/// RN-IMPORT-012 a 016 e 022 a 027: a importação e a cópia no registro das transferências, com o arquivo de verdade na pasta `transfers` (o `.in` que o
/// processo principal copiaria), a leitura de verdade e uma conexão de mentira que anota o que o carregador manda ao banco. É a mesma classe do
/// `TransferServiceTests`, em outro arquivo.
/// </summary>
public sealed partial class TransferServiceTests
{
    private const string FiveRows = "id;nome\n1;a\n2;b\n3;c\n4;d\n5;e\n";

    private static readonly ConnectionSettings Target = new(EDatabaseEngine.PostgreSql, "db.invalid", 5432, "loja", "gravador", "segredo");

    private static readonly IReadOnlyList<ImportMappingEntry> Mapping = [new(0, "id"), new(1, "nome")];

    /// <summary>O `.in` que o processo principal copiaria, com o identificador dado.</summary>
    private Guid WriteFile(string text)
    {
        var fileID = Guid.NewGuid();
        File.WriteAllText(Path.Combine(Folder, $"{fileID:D}.in"), text);

        return fileID;
    }

    private ImportJob Import(Guid fileID, LoadSettings? load = null, IReadOnlyList<ImportMappingEntry>? mapping = null, Func<CancellationToken, Task<ETransferCancelReason?>>? stop = null, ConnectionSettings? settings = null, string table = "pedido")
        => new(fileID, _connectionID, settings ?? Target, _generation, 7, ImportFormats.Csv, CsvImportOptions.Default with { Delimiter = ";" }, ImportValueFormats.Default, "loja", table, mapping ?? Mapping, load ?? new LoadSettings(false, 2, false), stop ?? (_ => Task.FromResult<ETransferCancelReason?>(null)));

    private CopyJob Copy(Guid targetConnectionID, bool count = false, bool forcedCount = false, string table = "pedido_hist", IReadOnlyList<ExportColumnChoice>? columns = null)
        => new(_connectionID, Target with { Database = "origem" }, "SELECT id, nome FROM loja.pedido", columns ?? [new(0, "id"), new(1, "nome")], true, count, forcedCount, targetConnectionID, Target, "loja", table, Mapping, new LoadSettings(false, null, false), _generation, 7, _ => Task.FromResult<ETransferCancelReason?>(null));

    /// <summary>
    /// O log até a linha do fim do trabalho dado: ela é escrita logo depois de o estado mudar, e o teste que só esperou o estado poderia ler antes dela. A
    /// lista é lida sob a mesma trava do `Emit`, porque outro trabalho pode escrever nela ao mesmo tempo.
    /// </summary>
    private static async Task<string> LoggedUntilTheEndAsync(CollectingSink sink, Guid id)
    {
        var end = $"Importação {id} terminou";
        for (var attempt = 0; attempt < 1000; attempt++)
        {
            string text;
            lock (sink.Events)
                text = string.Join('\n', sink.Events.Select(logged => logged.RenderMessage()));

            if (text.Contains(end, StringComparison.Ordinal))
                return text;

            await Task.Delay(10);
        }

        throw new TimeoutException("O fim do trabalho não chegou ao log.");
    }

    /// <summary>A tabela de destino como o catálogo a descreve: `id` inteiro e `nome` texto, com ou sem log de transação.</summary>
    private static ImportCatalog Catalog(bool oneAtATime = false, string idType = "integer", string kind = "table")
        => new(new EditCatalogTable("loja", "pedido", kind, null, oneAtATime, [new("id", idType, false, true, 1, null, null), new("nome", "text", true, false, 2, null, null), new("foto", "bytea", true, false, 3, null, null)], []), [], new Dictionary<string, string>());

    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "OK a importação toma o arquivo, grava em transações de N linhas e termina com o resumo, apagando o arquivo")]
    public async Task Import_ShouldTakeTheFile_CommitEveryN_AndFinishDone()
    {
        //Arrange
        var connection = new LoadConnection();
        var service = CreateService(connection);
        var fileID = WriteFile(FiveRows);

        //Act
        var id = service.StartImport(Import(fileID)).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Done, ETransferKind.Import, _connectionID, (Guid?)_connectionID), (info.State, info.Kind, info.ConnectionID, info.TargetConnectionID));
        Assert.Equal((5L, (long?)5, (long?)FiveRows.Length, (long)FiveRows.Length, false), (info.Rows, info.Committed, info.Size, info.Bytes, info.Uncertain));
        Assert.Equal(ETransferPhase.Committing, info.Phase);
        Assert.Equal(new TransferSummary(5, FiveRows.Length, null, 0, 0, 0) { Committed = 5 }, info.Summary);
        Assert.Equal(["LOCK", "DESCRIBE", "BEGIN", "DESCRIBE", "INSERT 2", "COMMIT", "BEGIN", "INSERT 2", "COMMIT", "BEGIN", "INSERT 1", "COMMIT"], connection.Calls);
        Assert.Equal([["1", "a"], ["2", "b"], ["3", "c"], ["4", "d"], ["5", "e"]], connection.Inserted);
        Assert.Equal(("loja", "pedido"), (connection.LoadTarget!.Schema, connection.LoadTarget.Table));
        Assert.Equal(["id", "nome"], connection.LoadTarget.Columns);
        Assert.Empty(Directory.GetFiles(Folder));
        Assert.True(connection.Disposed);
    }

    /// <summary>RN-IMPORT-012: o esvaziamento vai na primeira transação, depois da leitura do catálogo dela; com "Tudo numa transação só", uma confirmação no fim.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "OK o esvaziamento vai na primeira transação, e numa transação só há uma confirmação")]
    public async Task Import_EmptyInOneTransaction_ShouldDeleteFirst()
    {
        //Arrange
        var connection = new LoadConnection();
        var service = CreateService(connection);
        var fileID = WriteFile(FiveRows);

        //Act
        var id = service.StartImport(Import(fileID, new LoadSettings(true, null, false))).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(ETransferState.Done, info.State);
        Assert.Equal(["LOCK", "DESCRIBE", "BEGIN", "DESCRIBE", "DELETE loja.pedido", "INSERT 5", "COMMIT"], connection.Calls);
        Assert.True(info.Summary!.Emptied);
    }

    /// <summary>RN-IMPORT-012: a conferência lê o arquivo inteiro antes de gravar e para no primeiro valor que o Prism recusa, sem tocar na tabela.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro a conferência para no valor recusado, com a linha e a coluna do arquivo, e nada vai à tabela")]
    public async Task Import_Check_ShouldStopBeforeWriting()
    {
        //Arrange
        var connection = new LoadConnection();
        var service = CreateService(connection);
        var fileID = WriteFile("id;nome\n1;a\n2;b\n3x;c\n");

        //Act
        var id = service.StartImport(Import(fileID, new LoadSettings(true, 2, true))).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Failed, ETransferPhase.Checking), (info.State, info.Phase));
        Assert.Equal(new TransferFailure(ETransferError.ImportValueInvalid, "«3x» não é um número inteiro.") { Line = 4, Column = "id", Side = ETransferSide.Target, Committed = 0, Uncertain = false }, info.Error);
        Assert.Equal(["LOCK", "DESCRIBE"], connection.Calls);
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>
    /// RN-IMPORT-014 e 019: depois da conferência, enquanto a primeira transação abre e o catálogo é lido de novo, a fase ainda é a conferência, com os
    /// bytes que ela leu; a conta volta a zero só quando a carga começa, junto com a fase dela.
    /// </summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "OK os bytes da conferência só voltam a zero quando a carga começa")]
    public async Task Import_AfterTheCheck_ShouldKeepTheBytesUntilLoading()
    {
        //Arrange
        using var described = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        var connection = new LoadConnection
        {
            Describe = number =>
            {
                if (number == 2)
                {
                    described.Set();
                    release.Wait(TimeSpan.FromSeconds(30));
                }

                return Catalog();
            }
        };
        var service = CreateService(connection);
        var id = service.StartImport(Import(WriteFile(FiveRows), new LoadSettings(false, 2, true))).Value;

        //Act
        await Task.Run(() => described.Wait(TimeSpan.FromSeconds(30)));
        var between = service.Get(id)!;
        release.Set();
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferPhase.Checking, (long)FiveRows.Length), (between.Phase, between.Bytes));
        Assert.Equal((ETransferState.Done, (long)FiveRows.Length), (info.State, info.Bytes));
    }

    /// <summary>RN-IMPORT-016: sem a conferência, a recusa do Prism aparece na carga, na linha dela, e o que já foi confirmado fica.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro sem a conferência, o valor recusado para a carga na linha dele, e as linhas confirmadas ficam")]
    public async Task Import_WithoutCheck_ShouldStopAtTheRow_KeepingTheCommitted()
    {
        //Arrange
        var connection = new LoadConnection();
        var service = CreateService(connection);
        var fileID = WriteFile("id;nome\n1;a\n2;b\n3;c\n4x;d\n");

        //Act
        var id = service.StartImport(Import(fileID)).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Failed, (long?)2, 5L, "id", (long?)2), (info.State, info.Committed, info.Error!.Line, info.Error.Column, info.Error.Committed));
        Assert.Equal(["LOCK", "DESCRIBE", "BEGIN", "DESCRIBE", "INSERT 2", "COMMIT", "BEGIN"], connection.Calls);
    }

    /// <summary>RN-IMPORT-016: a recusa do banco vem como veio, com o SQLSTATE, a linha do arquivo do comando que falhou e a coluna do arquivo que vai para a do erro.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro a recusa do banco aponta a linha do arquivo e a coluna do arquivo")]
    public async Task Import_DatabaseRefusal_ShouldPointTheLineAndTheColumn()
    {
        //Arrange
        var connection = new LoadConnection { InsertFailure = rows => new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "null value in column \"nome\"", "23502", Change: 1, ColumnName: "nome") };
        var service = CreateService(connection);
        var fileID = WriteFile("id;nome\n1;a\n\n2;\n");

        //Act
        var id = service.StartImport(Import(fileID, new LoadSettings(false, null, false))).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(ETransferState.Failed, info.State);
        Assert.Equal(new TransferFailure(ETransferError.SqlExecutionFailed, "null value in column \"nome\"", "23502") { Line = 4, Column = "nome", Side = ETransferSide.Target, Committed = 0, Uncertain = false }, info.Error);
    }

    /// <summary>RN-IMPORT-014 e RN-PROT-006: antes de cada comando, a proteção do destino; a que passou a ser somente leitura para a importação, com o motivo.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "OK a conexão que passou a ser somente leitura para antes do comando seguinte, com o motivo readOnly")]
    public async Task Import_TargetBecomesReadOnly_ShouldStopWithTheReason()
    {
        //Arrange
        var connection = new LoadConnection();
        var service = CreateService(connection);
        var fileID = WriteFile(FiveRows);
        var checks = 0;

        //Act
        var id = service.StartImport(Import(fileID, stop: _ => Task.FromResult(Interlocked.Increment(ref checks) >= 3 ? ETransferCancelReason.ReadOnly : (ETransferCancelReason?)null))).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Canceled, ETransferCancelReason.ReadOnly, (long?)2, (TransferFailure?)null), (info.State, info.Reason, info.Committed, info.Error));
        Assert.Equal(["LOCK", "DESCRIBE", "BEGIN", "DESCRIBE", "INSERT 2", "COMMIT", "BEGIN"], connection.Calls);
        Assert.Empty(Directory.GetFiles(Folder));
    }

    /// <summary>
    /// RN-IMPORT-014 e 020: o cancelamento que chega durante a confirmação final não a interrompe: o trabalho fica `done` e continua no registro, para a
    /// tela ler que ele já tinha terminado; o segundo `DELETE` o esquece.
    /// </summary>
    [Trait("TransferService", "DeleteAsync")]
    [Fact(DisplayName = "OK o cancelamento durante a confirmação final termina em done, e o trabalho espera ser esquecido")]
    public async Task Import_CanceledDuringTheFinalCommit_ShouldBeDone()
    {
        //Arrange
        var service = default(TransferService);
        var started = new TaskCompletionSource<Guid>(TaskCreationOptions.RunContinuationsAsynchronously);
        Task<bool>? deleting = null;

        // A pessoa cancela no meio da confirmação final: o pedido chega ao registro enquanto ela roda.
        var connection = new LoadConnection { OnCommit = _ => deleting ??= service!.DeleteAsync(started.Task.Result) };
        service = CreateService(connection);
        var fileID = WriteFile(FiveRows);

        //Act
        var id = service.StartImport(Import(fileID, new LoadSettings(false, null, false))).Value;
        started.SetResult(id);
        await UntilAsync(service, id, _ => deleting is not null);
        await deleting!;
        var info = service.Get(id);
        var forgotten = await service.DeleteAsync(id);

        //Assert
        Assert.Equal((ETransferState.Done, (long?)5, (ETransferCancelReason?)null), (info!.State, info.Committed, info.Reason));
        Assert.True(forgotten);
        Assert.Null(service.Get(id));
    }

    /// <summary>RN-IMPORT-016: a conexão que cai durante a confirmação deixa a dúvida: `uncertain`, e `committed` é o da confirmação anterior.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro a conexão que cai na confirmação deixa a dúvida, com as confirmadas antes dela")]
    public async Task Import_ConnectionLostDuringTheCommit_ShouldBeUncertain()
    {
        //Arrange
        var connection = new LoadConnection();
        connection.CommitFailure = number => number == 2 ? connection.Lose() : null;
        var service = CreateService(connection);
        var fileID = WriteFile(FiveRows);

        //Act
        var id = service.StartImport(Import(fileID)).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Failed, true, (long?)2), (info.State, info.Uncertain, info.Committed));
        Assert.Equal((ETransferError.SqlExecutionFailed, (long?)null, (long?)2, (bool?)true), (info.Error!.Code, info.Error.Line, info.Error.Committed, info.Error.Uncertain));
    }

    /// <summary>RN-IMPORT-014: abandonado no meio de uma confirmação (o banco não responde ao cancelamento), o trabalho fica cancelado com a dúvida.</summary>
    [Trait("TransferService", "DeleteAsync")]
    [Fact(DisplayName = "OK a confirmação que não responde ao cancelamento deixa o trabalho cancelado com a dúvida")]
    public async Task Import_AbandonedDuringACommit_ShouldBeCanceledUncertain()
    {
        //Arrange
        var hang = new TaskCompletionSource();
        var connection = new LoadConnection { CommitHang = hang.Task };
        var service = CreateService(connection);
        var fileID = WriteFile(FiveRows);
        var id = service.StartImport(Import(fileID)).Value;
        await UntilAsync(service, id, _ => connection.Committing);

        //Act
        var deleting = service.DeleteAsync(id);
        for (var attempt = 0; attempt < 1000 && !deleting.IsCompleted; attempt++)
        {
            service.Get(id);
            _clock.Advance(TimeSpan.FromSeconds(1));
            await Task.Delay(10);
        }

        var info = service.Get(id);

        //Assert
        Assert.True(await deleting);
        Assert.Equal((ETransferState.Canceled, true, (long?)0), (info!.State, info.Uncertain, info.Committed));
        hang.SetResult();
    }

    /// <summary>RN-IMPORT-014: a tabela ocupada, pela regra da própria origem (outra conexão ao mesmo servidor, sem diferenciar maiúsculas), é recusada.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro a segunda importação ou cópia para a mesma tabela é recusada, e outra tabela passa")]
    public async Task Import_SameTable_ShouldBeBusy()
    {
        //Arrange
        var hang = new TaskCompletionSource();
        var connection = new LoadConnection { CommitHang = hang.Task };
        var service = CreateService(connection, new LoadConnection(), new LoadConnection());
        var first = service.StartImport(Import(WriteFile(FiveRows))).Value;
        await UntilAsync(service, first, _ => connection.Committing);

        //Act
        var sameServer = service.StartImport(Import(WriteFile(FiveRows), settings: Target with { Host = "DB.INVALID" }));
        var copy = service.StartCopy(Copy(Guid.NewGuid(), table: "pedido"));
        var otherTable = service.StartImport(Import(WriteFile(FiveRows), table: "cliente"));

        //Assert
        Assert.Equal(ETransferStartFailure.ImportBusy, sameServer.Error);
        Assert.Equal(ETransferStartFailure.ImportBusy, copy.Error);
        Assert.True(otherTable.IsSuccess);
        hang.SetResult();
    }

    /// <summary>RN-IMPORT-014: o arquivo que sumiu antes da troca de nome (o processo principal o soltou) não deixa trabalho.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro o arquivo que sumiu antes da troca de nome é FileMissing, e nada fica no registro")]
    public void Import_FileMissing_ShouldNotStart()
    {
        //Arrange
        var service = CreateService(new LoadConnection());

        //Act
        var started = service.StartImport(Import(Guid.NewGuid()));

        //Assert
        Assert.Equal(ETransferStartFailure.FileMissing, started.Error);
        Assert.Empty(service.List());
    }

    /// <summary>RN-IMPORT-009: a posição além das colunas do arquivo é o fim do trabalho antes de gravar a primeira linha (e antes do esvaziamento).</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro a posição do mapeamento além das colunas do arquivo para antes de gravar")]
    public async Task Import_MappingBeyondTheFile_ShouldStopBeforeWriting()
    {
        //Arrange
        var connection = new LoadConnection();
        var service = CreateService(connection);

        //Act
        var id = service.StartImport(Import(WriteFile(FiveRows), new LoadSettings(true, 2, false), [new(0, "id"), new(4, "nome")])).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Failed, ETransferError.ImportMappingInvalid, "A coluna 5 do arquivo não existe: o arquivo tem 2 colunas."), (info.State, info.Error!.Code, info.Error.Message));
        Assert.Equal(["LOCK", "DESCRIBE"], connection.Calls);
    }

    /// <summary>RN-IMPORT-015: a tabela que sumiu, a que deixou de ser tabela e a coluna mapeada que mudou de tipo entre as duas leituras do catálogo.</summary>
    [Trait("TransferService", "StartImport")]
    [Theory(DisplayName = "Erro o catálogo que mudou termina o trabalho com o código de cada caso")]
    [InlineData(1, "missing", ETransferError.ImportTableNotFound, "A tabela loja.pedido não existe mais.")]
    [InlineData(1, "view", ETransferError.ImportTargetNotTable, "Só uma tabela recebe linhas: loja.pedido é uma visão.")]
    [InlineData(2, "type", ETransferError.ImportTableChanged, "As colunas de loja.pedido mudaram desde a prévia. Abra a importação de novo.")]
    public async Task Import_CatalogChanged_ShouldStop(int read, string change, ETransferError code, string message)
    {
        //Arrange
        var connection = new LoadConnection
        {
            Describe = number => number < read ? Catalog() : change switch
            {
                "missing" => null,
                "view" => Catalog(kind: "view"),
                _ => Catalog(idType: "text")
            }
        };
        var service = CreateService(connection);

        //Act
        var id = service.StartImport(Import(WriteFile(FiveRows))).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Failed, code, message), (info.State, info.Error!.Code, info.Error.Message));
        Assert.DoesNotContain("INSERT 2", connection.Calls);
    }

    /// <summary>RN-IMPORT-015, no Informix sem log: nenhuma transação, cada linha gravada sozinha, e as gravadas são as confirmadas.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "OK no banco sem log não há transação, e cada linha gravada conta como confirmada")]
    public async Task Import_WithoutLog_ShouldWriteEachRowAlone()
    {
        //Arrange
        var connection = new LoadConnection { Describe = _ => Catalog(oneAtATime: true), RowsPerCommand = 1 };
        var service = CreateService(connection);

        //Act
        var id = service.StartImport(Import(WriteFile("id;nome\n1;a\n2;b\n"), new LoadSettings(true, 1, false))).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Done, (long?)2), (info.State, info.Committed));
        Assert.Equal(["LOCK", "DESCRIBE", "DESCRIBE", "DELETE loja.pedido", "INSERT 1", "INSERT 1"], connection.Calls);
    }

    /// <summary>
    /// RN-IMPORT-016, no Informix sem log: o comando tem uma linha só, e a conexão que cai nele aponta a linha do arquivo dela (a dúvida é só sobre ela);
    /// as linhas gravadas ficam as de antes, sem contar a da dúvida.
    /// </summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro sem log, a conexão que cai no comando de uma linha aponta a linha do arquivo, com a dúvida só sobre ela")]
    public async Task Import_WithoutLog_ConnectionLostInARow_ShouldPointItsLine()
    {
        //Arrange
        var connection = new LoadConnection { Describe = _ => Catalog(oneAtATime: true), RowsPerCommand = 1 };
        connection.InsertFailure = rows => Equals(rows[0][0].Value, "3") ? connection.Lose() with { Change = 0 } : null;
        var service = CreateService(connection);

        //Act
        var id = service.StartImport(Import(WriteFile("id;nome\n1;a\n\n2;b\n3;c\n4;d\n"), new LoadSettings(false, 1, false))).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Failed, 2L, (long?)2, true), (info.State, info.Rows, info.Committed, info.Uncertain));
        Assert.Equal(((long?)5, (long?)2, (bool?)true), (info.Error!.Line, info.Error.Committed, info.Error.Uncertain));
    }

    /// <summary>RN-LOG-001 e RN-IMPORT-014: o log da importação não leva o nome da tabela ou das colunas, os valores nem a mensagem do banco.</summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "OK o log da importação não leva nomes, valores nem a mensagem do banco")]
    public async Task Import_Log_ShouldCarryNoNameValueNorDatabaseMessage()
    {
        //Arrange
        var sink = new CollectingSink();
        var logger = new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(sink).CreateLogger();
        var connection = new LoadConnection { InsertFailure = _ => new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "valor secreto-da-mensagem", "23505", Change: 0) };
        var service = CreateService(new QueueClient([connection]), logger);

        //Act
        var id = service.StartImport(Import(WriteFile("id;nome\n1;cliente-secreto\n"))).Value;
        await FinishedAsync(service, id);
        var text = await LoggedUntilTheEndAsync(sink, id);

        //Assert
        Assert.Contains(id.ToString(), text, StringComparison.Ordinal);
        Assert.Contains("23505", text, StringComparison.Ordinal);
        foreach (var secret in new[] { "pedido", "nome", "cliente-secreto", "secreto-da-mensagem", "segredo", "db.invalid", _data })
            Assert.DoesNotContain(secret, text, StringComparison.Ordinal);
    }

    /// <summary>
    /// Seção 6 e RN-IMPORT-014: a exceção que escapa da importação (um defeito do Prism) termina o trabalho como `failed`, com `INTERNAL_SERVER_ERROR`;
    /// o arquivo sai, a tabela fica livre para outra importação, e o log leva a classe da exceção, nunca a mensagem dela.
    /// </summary>
    [Trait("TransferService", "StartImport")]
    [Fact(DisplayName = "Erro a exceção que escapa da importação termina o trabalho, apaga o arquivo e solta a tabela")]
    public async Task Import_UnexpectedException_ShouldFailAndReleaseEverything()
    {
        //Arrange
        var sink = new CollectingSink();
        var logger = new LoggerConfiguration().MinimumLevel.Verbose().WriteTo.Sink(sink).CreateLogger();
        var throwing = new LoadConnection { InsertFailure = _ => throw new InvalidOperationException("valor-secreto") };
        var service = CreateService(new QueueClient([throwing, new LoadConnection()]), logger);
        var id = service.StartImport(Import(WriteFile(FiveRows))).Value;

        //Act
        var info = await FinishedAsync(service, id);
        var text = await LoggedUntilTheEndAsync(sink, id);
        var files = Directory.GetFiles(Folder);
        var again = service.StartImport(Import(WriteFile(FiveRows)));

        //Assert
        Assert.Equal((ETransferState.Failed, ETransferError.Unexpected, "Um erro inesperado do Prism parou a importação.", (long?)0), (info.State, info.Error!.Code, info.Error.Message, info.Error.Committed));
        Assert.Empty(files);
        Assert.True(throwing.Disposed);
        Assert.True(again.IsSuccess);
        Assert.Contains(nameof(InvalidOperationException), text, StringComparison.Ordinal);
        Assert.DoesNotContain("valor-secreto", text, StringComparison.Ordinal);
    }

    /// <summary>RN-IMPORT-026 e 027: a cópia lê a origem (com a contagem) e grava no destino, cada valor convertido; `connectionID` é o da origem.</summary>
    [Trait("TransferService", "StartCopy")]
    [Fact(DisplayName = "OK a cópia lê a origem, conta, grava no destino e termina com o resumo")]
    public async Task Copy_ShouldReadCountAndLoad()
    {
        //Arrange
        var source = new LoadConnection { SourceRows = 3 };
        var target = new LoadConnection();
        var service = CreateService(source, target);
        var targetID = Guid.NewGuid();

        //Act
        var id = service.StartCopy(Copy(targetID, count: true)).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Done, ETransferKind.Copy, _connectionID, (Guid?)targetID), (info.State, info.Kind, info.ConnectionID, info.TargetConnectionID));
        Assert.Equal((3L, (long?)3, (long?)3, (long?)null), (info.Rows, info.Committed, info.Total, info.Size));
        Assert.Equal(["READ BEGIN", "COUNT", "READ SELECT id, nome FROM loja.pedido"], source.Calls);
        Assert.Equal(["LOCK", "DESCRIBE", "BEGIN", "DESCRIBE", "INSERT 3", "COMMIT"], target.Calls);
        Assert.Equal([["1", "nome 1"], ["2", "nome 2"], ["3", "nome 3"]], target.Inserted);
    }

    /// <summary>RN-IMPORT-023: com a contagem obrigatória, a origem que passa do total mais um décimo (no mínimo, mais 1.000) termina a cópia.</summary>
    [Trait("TransferService", "StartCopy")]
    [Fact(DisplayName = "Erro a origem que continua crescendo termina a cópia, do lado da origem")]
    public async Task Copy_SourceGrowing_ShouldStop()
    {
        //Arrange
        var source = new LoadConnection { SourceRows = 2000, Total = 10 };
        var target = new LoadConnection();
        var service = CreateService(source, target);

        //Act
        var id = service.StartCopy(Copy(Guid.NewGuid(), forcedCount: true)).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Failed, ETransferError.ImportSourceGrowing, (ETransferSide?)ETransferSide.Source), (info.State, info.Error!.Code, info.Error.Side));
        Assert.Equal("A origem continua crescendo: a cópia leu mais linhas do que as 10 contadas e foi encerrada.", info.Error.Message);
        Assert.True(source.RequiredCount);
    }

    /// <summary>RN-IMPORT-024: o binário só vai para uma coluna binária; o contrário é a recusa da linha, com a linha da origem e a coluna dela.</summary>
    [Trait("TransferService", "StartCopy")]
    [Fact(DisplayName = "Erro o binário da origem numa coluna que não é binária é recusado na linha")]
    public async Task Copy_BinaryIntoText_ShouldBeRefused()
    {
        //Arrange
        var source = new LoadConnection { SourceRows = 1, SourceColumns = [new("id", "int4", "number"), new("foto", "bytea", "binary")] };
        var target = new LoadConnection();
        var service = CreateService(source, target);

        //Act
        var id = service.StartCopy(Copy(Guid.NewGuid(), columns: [new(0, "id"), new(1, "foto")])).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal(new TransferFailure(ETransferError.ImportValueInvalid, "A coluna foto da origem é binária, e a coluna de destino não é.") { Line = 1, Column = "foto", Side = ETransferSide.Target, Committed = 0, Uncertain = false }, info.Error);
    }

    /// <summary>RN-IMPORT-027: a falha da leitura para a cópia como a da gravação, com o lado da origem.</summary>
    [Trait("TransferService", "StartCopy")]
    [Fact(DisplayName = "Erro a falha da leitura da origem termina a cópia com o lado dela")]
    public async Task Copy_SourceFailure_ShouldSaySource()
    {
        //Arrange
        var source = new LoadConnection { SourceRows = 1, ReadFailure = new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "permission denied", "42501") };
        var service = CreateService(source, new LoadConnection());

        //Act
        var id = service.StartCopy(Copy(Guid.NewGuid())).Value;
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferError.SqlExecutionFailed, "42501", (ETransferSide?)ETransferSide.Source), (info.Error!.Code, info.Error.SqlState, info.Error.Side));
    }

    /// <summary>RN-CONN-014: a exclusão da conexão de destino cancela a cópia que grava nela.</summary>
    [Trait("TransferService", "CancelByConnection")]
    [Fact(DisplayName = "OK excluir a conexão de destino cancela a cópia, com o motivo")]
    public async Task Copy_TargetDeleted_ShouldCancel()
    {
        //Arrange
        var hang = new TaskCompletionSource();
        var source = new LoadConnection { SourceRows = 1, ReadHang = hang.Task };
        var service = CreateService(source, new LoadConnection());
        var targetID = Guid.NewGuid();
        var id = service.StartCopy(Copy(targetID)).Value;
        await UntilAsync(service, id, _ => source.Reading);

        //Act
        service.CancelByConnection(targetID);
        var info = await FinishedAsync(service, id);

        //Assert
        Assert.Equal((ETransferState.Canceled, ETransferCancelReason.ConnectionDeleted), (info.State, info.Reason));
        hang.TrySetResult();
    }

    /// <summary>
    /// A conexão de mentira da carga (e da leitura da origem da cópia): anota o que o carregador manda (`LOCK`, `DESCRIBE`, `BEGIN`, `DELETE`, `INSERT n`,
    /// `COMMIT`) e os valores gravados; a descrição da tabela de cada leitura; as recusas do comando e da confirmação; a confirmação que espera; e, como
    /// origem, as linhas e as colunas que a leitura entrega, a contagem e a recusa da leitura.
    /// </summary>
    private sealed class LoadConnection : IDatabaseConnection
    {
        private int _describes;
        private int _commits;
        private volatile bool _open = true;

        public List<string> Calls { get; } = [];

        public List<object?[]> Inserted { get; } = [];

        public LoadTarget? LoadTarget { get; private set; }

        public Func<int, ImportCatalog?> Describe { get; init; } = _ => Catalog();

        public int RowsPerCommand { get; init; } = 100;

        public Func<IReadOnlyList<IReadOnlyList<EditParameter>>, DatabaseFailure?> InsertFailure { get; set; } = _ => null;

        public Func<int, DatabaseFailure?> CommitFailure { get; set; } = _ => null;

        public Func<int, object?>? OnCommit { get; init; }

        public Task? CommitHang { get; init; }

        public int SourceRows { get; init; }

        public long? Total { get; init; }

        public IReadOnlyList<QueryColumn> SourceColumns { get; init; } = [new("id", "int4", "number"), new("nome", "text", "text")];

        public DatabaseFailure? ReadFailure { get; init; }

        public Task? ReadHang { get; init; }

        public volatile bool Committing;

        public volatile bool Reading;

        public volatile bool Canceled;

        public volatile bool Disposed;

        public volatile bool RequiredCount;

        private int _read;

        public string ServerVersion => "0";

        public bool IsOpen => _open && !Disposed;

        public bool HasOpenCursor => false;

        /// <summary>A conexão cai: a recusa da confirmação que o teste devolve.</summary>
        public DatabaseFailure Lose()
        {
            _open = false;

            return new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "the connection was closed");
        }

        public void Cancel()
            => Canceled = true;

        public ValueTask DisposeAsync()
        {
            Disposed = true;

            return ValueTask.CompletedTask;
        }

        public Task<UnitResult<DatabaseFailure>> BeginLoadAsync(CancellationToken cancellationToken)
            => Done("LOCK");

        public int LoadRowsPerCommand(int columns)
            => RowsPerCommand;

        public Task<Result<ImportCatalog?, DatabaseFailure>> DescribeImportTargetAsync(string schema, string table, CancellationToken cancellationToken)
        {
            Calls.Add("DESCRIBE");

            return Task.FromResult(Result.Success<ImportCatalog?, DatabaseFailure>(Describe(++_describes)));
        }

        public Task<UnitResult<DatabaseFailure>> BeginLoadTransactionAsync(CancellationToken cancellationToken)
            => Done("BEGIN");

        public Task<UnitResult<DatabaseFailure>> EmptyTableAsync(string schema, string table, CancellationToken cancellationToken)
            => Done($"DELETE {schema}.{table}");

        public Task<UnitResult<DatabaseFailure>> InsertRowsAsync(LoadTarget target, IReadOnlyList<IReadOnlyList<EditParameter>> rows, CancellationToken cancellationToken)
        {
            Calls.Add($"INSERT {rows.Count}");
            LoadTarget = target;
            if (InsertFailure(rows) is { } failure)
                return Task.FromResult(UnitResult.Failure(failure));

            Inserted.AddRange(rows.Select(row => row.Select(value => value.Value).ToArray()));

            return Task.FromResult(UnitResult.Success<DatabaseFailure>());
        }

        public async Task<UnitResult<DatabaseFailure>> CommitLoadAsync()
        {
            Calls.Add("COMMIT");
            var number = ++_commits;
            Committing = true;
            OnCommit?.Invoke(number);
            if (CommitHang is not null)
                await CommitHang;

            Committing = false;

            return CommitFailure(number) is { } failure ? UnitResult.Failure(failure) : UnitResult.Success<DatabaseFailure>();
        }

        public Task<UnitResult<DatabaseFailure>> BeginExportAsync(CancellationToken cancellationToken)
            => Done("READ BEGIN");

        public Task<Result<long?, DatabaseFailure>> CountExportAsync(string sql, bool required, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
        {
            Calls.Add("COUNT");
            RequiredCount = required;

            return Task.FromResult(Result.Success<long?, DatabaseFailure>(Total ?? SourceRows));
        }

        public Task<Result<IReadOnlyList<QueryColumn>, DatabaseFailure>> StartExportReadAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null)
        {
            Calls.Add($"READ {sql}");

            return Task.FromResult(Result.Success<IReadOnlyList<QueryColumn>, DatabaseFailure>(SourceColumns));
        }

        public async Task<Result<ExportBatch, DatabaseFailure>> ReadExportRowsAsync(ExportReadPlan plan, CancellationToken cancellationToken)
        {
            Reading = true;
            if (ReadHang is not null)
            {
                await Task.WhenAny(ReadHang, Task.Delay(Timeout.Infinite, cancellationToken));
                if (cancellationToken.IsCancellationRequested)
                    return new DatabaseFailure(EDatabaseFailure.ExecutionFailed, "O comando foi cancelado.", Outcome: ECancelOutcome.Canceled);
            }

            if (ReadFailure is not null)
                return ReadFailure;

            var rows = new List<IReadOnlyList<ExportCell>>();
            while (rows.Count < plan.MaxRows && _read < SourceRows)
            {
                _read++;
                rows.Add([.. plan.Ordinals.Select(ordinal => SourceColumns[ordinal].Kind == "binary" ? ExportCell.FromBytes([1, 2]) : ExportCell.FromText(ordinal == 0 ? _read.ToString() : $"nome {_read}"))]);
            }

            return new ExportBatch(rows, _read >= SourceRows);
        }

        private Task<UnitResult<DatabaseFailure>> Done(string call)
        {
            Calls.Add(call);

            return Task.FromResult(UnitResult.Success<DatabaseFailure>());
        }

        public Task<UnitResult<DatabaseFailure>> PingAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<UnitResult<DatabaseFailure>> VerifyAsync(string? sql, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null) => throw new NotSupportedException();
        public Task<Result<QueryOutcome, DatabaseFailure>> ExecuteReadOnlyAsync(string sql, int pageSize, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null) => throw new NotSupportedException();
        public Task<Result<QueryPage, DatabaseFailure>> FetchNextAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<long, DatabaseFailure>> CountAsync(string sql, CancellationToken cancellationToken, IReadOnlyList<QueryParameter>? parameters = null) => throw new NotSupportedException();
        public Task CloseCursorAsync() => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<SchemaInfo>, DatabaseFailure>> GetSchemasAsync(CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<DatabaseObjectInfo>, DatabaseFailure>> GetObjectsAsync(string schema, string kind, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<ObjectNamesInfo, DatabaseFailure>> GetObjectNamesAsync(int limit, CancellationToken cancellationToken) => throw new NotSupportedException();
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
        public Task<Result<int, DatabaseFailure>> ApplyEditsAsync(EditTables tables, bool oneAtATime, bool wholeColumn, Func<IReadOnlyList<EditCatalogTable?>, Result<EditPlan, DatabaseFailure>> plan, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<long, DatabaseFailure>> CountWholeColumnAsync(EditTables tables, Func<IReadOnlyList<EditCatalogTable?>, Result<WholeColumnPlan, DatabaseFailure>> plan, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<Result<IReadOnlyList<IReadOnlyList<string?>>, DatabaseFailure>> CheckImportCastsAsync(IReadOnlyList<string> types, IReadOnlyList<IReadOnlyList<object?>> values, CancellationToken cancellationToken) => throw new NotSupportedException();
    }
}
