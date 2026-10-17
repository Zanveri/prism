using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Serilog;
using Serilog.Core;
using System.Data.Common;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EXPORT-017: a leitura da exportação na base, sobre o driver de mentira. O banco de mentira daqui é como o PostgreSQL na exportação: prepara a
/// sessão (o prazo de trava e a forma do texto) e abre a transação em que a contagem e a leitura veem o mesmo instante. A contagem tem um ponto de
/// salvamento só dela, e a recusa dela não desfaz a transação; a leitura vai em lotes, do mesmo leitor, até o fim, que confirma a transação. É a mesma
/// classe do `AdoDatabaseConnectionTests`, em outro arquivo.
/// </summary>
public sealed partial class AdoDatabaseConnectionTests
{
    private const string CountQuery = "CONTAGEM";

    private async Task<IDatabaseConnection> OpenForExportAsync()
        => (await new ExportEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None).OpenAsync(CancellationToken.None)).Value;

    private static ExportReadPlan PlanOf(params int[] ordinals)
        => new(ordinals, new HashSet<int>());

    [Trait("AdoDatabaseConnection", "BeginExportAsync")]
    [Fact(DisplayName = "OK a exportação prepara a sessão e abre a transação, nessa ordem")]
    public async Task BeginExport_ShouldPrepareTheSessionThenOpenTheTransaction()
    {
        //Arrange
        var connection = await OpenForExportAsync();

        //Act
        var begun = await connection.BeginExportAsync(CancellationToken.None);

        //Assert
        Assert.True(begun.IsSuccess);
        Assert.Equal(["LOCK TIMEOUT", "SET FORMA", "BEGIN EXPORT"], _sent);
    }

    /// <summary>Sem transação só de leitura (Db2 e Informix), só o prazo de trava: a leitura é a de uma sessão nova.</summary>
    [Trait("AdoDatabaseConnection", "BeginExportAsync")]
    [Fact(DisplayName = "OK sem transação só de leitura, só o prazo de trava")]
    public async Task BeginExport_WithoutReadOnlyTransactions_ShouldOnlyLimitTheLockWait()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        await connection.BeginExportAsync(CancellationToken.None);

        //Assert
        Assert.Equal(["LOCK TIMEOUT"], _sent);
    }

    [Trait("AdoDatabaseConnection", "CountExportAsync")]
    [Fact(DisplayName = "OK a contagem roda num ponto de salvamento só dela, dentro da transação")]
    public async Task CountExport_ShouldRunInItsOwnSavepoint()
    {
        //Arrange
        _catalog[CountQuery] = [[42L]];
        var connection = await OpenForExportAsync();
        await connection.BeginExportAsync(CancellationToken.None);
        _sent.Clear();

        //Act
        var total = await connection.CountExportAsync(CountQuery, required: false, CancellationToken.None);

        //Assert
        Assert.Equal(42L, total.Value);
        Assert.Equal(["SAVEPOINT prism_count", CountQuery, "RELEASE SAVEPOINT prism_count"], _sent);
    }

    /// <summary>A recusa da contagem não para a exportação: o total vem nulo, o ponto de salvamento é desfeito, e a transação continua para a leitura.</summary>
    [Trait("AdoDatabaseConnection", "CountExportAsync")]
    [Fact(DisplayName = "OK a contagem recusada vem sem total, e a leitura segue na mesma transação")]
    public async Task CountExport_Refused_ShouldBeWithoutTotal_AndKeepTheTransaction()
    {
        //Arrange
        _rows = 2;
        _commandFailure = sql => sql == CountQuery ? new FakeDatabaseException("a subconsulta não pode ser contada", "42601") : null;
        var connection = await OpenForExportAsync();
        await connection.BeginExportAsync(CancellationToken.None);
        _sent.Clear();

        //Act
        var total = await connection.CountExportAsync(CountQuery, required: false, CancellationToken.None);
        var columns = await connection.StartExportReadAsync(ReadQuery, CancellationToken.None);
        var batch = await connection.ReadExportRowsAsync(PlanOf(0), CancellationToken.None);

        //Assert
        Assert.True(total.IsSuccess);
        Assert.Null(total.Value);
        Assert.Equal(["numero"], columns.Value.Select(column => column.Name));
        Assert.Equal([["1"], ["2"]], batch.Value.Rows.Select(row => row.Select(cell => cell.Text).ToArray()));
        Assert.True(batch.Value.Finished);
        Assert.Equal(["SAVEPOINT prism_count", CountQuery, "ROLLBACK TO SAVEPOINT prism_count", ReadQuery, "COMMIT"], _sent);
    }

    /// <summary>A leitura vai em lotes do mesmo leitor; o último fecha o leitor e confirma a transação, e nada mais é enviado no meio.</summary>
    [Trait("AdoDatabaseConnection", "ReadExportRowsAsync")]
    [Fact(DisplayName = "OK a leitura vai em lotes do mesmo leitor até o fim, que confirma a transação")]
    public async Task ReadExportRows_ShouldReadInBatches_UntilTheEnd()
    {
        //Arrange
        _rows = 250;
        var connection = await OpenForExportAsync();
        await connection.BeginExportAsync(CancellationToken.None);
        await connection.StartExportReadAsync(ReadQuery, CancellationToken.None);
        var plan = PlanOf(0) with { MaxRows = 100 };

        //Act
        var first = await connection.ReadExportRowsAsync(plan, CancellationToken.None);
        var second = await connection.ReadExportRowsAsync(plan, CancellationToken.None);
        var third = await connection.ReadExportRowsAsync(plan, CancellationToken.None);
        var after = await connection.ReadExportRowsAsync(plan, CancellationToken.None);

        //Assert
        Assert.Equal((100, false), (first.Value.Rows.Count, first.Value.Finished));
        Assert.Equal((100, false), (second.Value.Rows.Count, second.Value.Finished));
        Assert.Equal((50, true), (third.Value.Rows.Count, third.Value.Finished));
        Assert.Equal("250", third.Value.Rows[^1][0].Text);
        Assert.Equal(EDatabaseFailure.NoOpenCursor, after.Error.Kind);
        Assert.Equal(["LOCK TIMEOUT", "SET FORMA", "BEGIN EXPORT", ReadQuery, "COMMIT"], _sent);
    }

    /// <summary>Cada valor sai inteiro, sem o corte da grade: o texto acima de 10.000 caracteres e o binário acima de 32 bytes.</summary>
    [Trait("AdoDatabaseConnection", "ReadExportRowsAsync")]
    [Fact(DisplayName = "OK o valor sai inteiro, sem o corte da grade")]
    public async Task ReadExportRows_ShouldReadWholeValues()
    {
        //Arrange
        _rows = 2;
        _fieldType = typeof(object);
        var bytes = Enumerable.Range(0, 300).Select(value => (byte)value).ToArray();
        _value = row => row == 1 ? new string('a', 50000) : bytes;
        var connection = await OpenForExportAsync();
        await connection.StartExportReadAsync(ReadQuery, CancellationToken.None);

        //Act
        var batch = await connection.ReadExportRowsAsync(PlanOf(0), CancellationToken.None);

        //Assert
        Assert.Equal(50000, batch.Value.Rows[0][0].Text!.Length);
        Assert.Equal(bytes, batch.Value.Rows[1][0].Bytes);
    }

    /// <summary>RN-EXPORT-006: o binário com "Deixar vazio" nem é pedido ao leitor, e chega nulo.</summary>
    [Trait("AdoDatabaseConnection", "ReadExportRowsAsync")]
    [Fact(DisplayName = "OK a coluna deixada de fora do leitor chega nula, sem ser pedida")]
    public async Task ReadExportRows_ShouldNotAskForASkippedColumn()
    {
        //Arrange
        _rows = 1;
        var asked = 0;
        _value = _ =>
        {
            asked++;

            return "valor";
        };
        var connection = await OpenForExportAsync();
        await connection.StartExportReadAsync(ReadQuery, CancellationToken.None);

        //Act
        var batch = await connection.ReadExportRowsAsync(new ExportReadPlan([0], new HashSet<int> { 0 }), CancellationToken.None);

        //Assert
        Assert.True(batch.Value.Rows[0][0].IsNull);
        Assert.Equal(0, asked);
    }

    /// <summary>RN-EXPORT-017: o valor acima do teto para a leitura ali, sem guardá-lo; o lote leva as linhas de antes e diz a coluna.</summary>
    [Trait("AdoDatabaseConnection", "ReadExportRowsAsync")]
    [Fact(DisplayName = "Erro o valor acima do teto para a leitura e diz a coluna")]
    public async Task ReadExportRows_ShouldStop_AtAValueOverTheLimit()
    {
        //Arrange
        _rows = 3;
        _value = row => row == 3 ? "ação-ação" : "ok";
        var connection = await OpenForExportAsync();
        await connection.StartExportReadAsync(ReadQuery, CancellationToken.None);

        //Act
        var batch = await connection.ReadExportRowsAsync(PlanOf(0) with { MaxValueBytes = 10 }, CancellationToken.None);

        //Assert
        Assert.Equal(2, batch.Value.Rows.Count);
        Assert.Equal(new ExportOversize(0, WholeRow: false), batch.Value.Oversize);
        Assert.False(batch.Value.Finished);
    }

    [Trait("AdoDatabaseConnection", "ReadExportRowsAsync")]
    [Fact(DisplayName = "Erro a linha acima do teto de valores somados para a leitura")]
    public async Task ReadExportRows_ShouldStop_AtARowOverTheLimit()
    {
        //Arrange
        _rows = 1;
        _value = _ => "123456";
        var connection = await OpenForExportAsync();
        await connection.StartExportReadAsync(ReadQuery, CancellationToken.None);

        //Act
        var batch = await connection.ReadExportRowsAsync(new ExportReadPlan([0, 0], new HashSet<int>()) { MaxValueBytes = 10, MaxRowBytes = 10 }, CancellationToken.None);

        //Assert
        Assert.Empty(batch.Value.Rows);
        Assert.Equal(new ExportOversize(1, WholeRow: true), batch.Value.Oversize);
    }

    /// <summary>O lote fecha na linha que passa dos bytes dele, para a memória ser a de um lote pequeno ou a de uma linha grande.</summary>
    [Trait("AdoDatabaseConnection", "ReadExportRowsAsync")]
    [Fact(DisplayName = "OK o lote fecha na linha que passa dos bytes dele")]
    public async Task ReadExportRows_ShouldCloseTheBatch_PastItsBytes()
    {
        //Arrange
        _rows = 10;
        _value = _ => "1234";
        var connection = await OpenForExportAsync();
        await connection.StartExportReadAsync(ReadQuery, CancellationToken.None);

        //Act
        var batch = await connection.ReadExportRowsAsync(PlanOf(0) with { MaxBatchBytes = 10 }, CancellationToken.None);

        //Assert
        Assert.Equal(3, batch.Value.Rows.Count);
    }

    /// <summary>A recusa do banco no meio da leitura é a falha da exportação, com a mensagem dele; a transação é desfeita e o leitor fecha.</summary>
    [Trait("AdoDatabaseConnection", "ReadExportRowsAsync")]
    [Fact(DisplayName = "Erro a recusa do banco no meio da leitura desfaz a transação")]
    public async Task ReadExportRows_Refused_ShouldUndoTheTransaction()
    {
        //Arrange
        _rows = 10;
        _rowFailure = row => row == 5 ? new FakeDatabaseException("division by zero", "22012") : null;
        var connection = await OpenForExportAsync();
        await connection.BeginExportAsync(CancellationToken.None);
        await connection.StartExportReadAsync(ReadQuery, CancellationToken.None);

        //Act
        var batch = await connection.ReadExportRowsAsync(PlanOf(0), CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, "division by zero", "22012"), (batch.Error.Kind, batch.Error.Message, batch.Error.SqlState));
        Assert.Equal("ROLLBACK", _sent[^1]);
        Assert.False(connection.HasOpenCursor);
    }

    /// <summary>Como o PostgreSQL na exportação: a sessão recebe a forma do texto, e a leitura roda numa transação que ele confirma no fim.</summary>
    private sealed class ExportEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override IReadOnlyList<string> ExportSessionSql => ["LOCK TIMEOUT", "SET FORMA"];

        protected override string? BeginExportSql => "BEGIN EXPORT";
    }
}
