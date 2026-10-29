using CSharpFunctionalExtensions;
using Moq;
using Moq.Protected;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Serilog;
using Serilog.Core;
using System.Collections;
using System.Data;
using System.Data.Common;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-019 a 021: a coluna inteira na base, sobre o driver de mentira. No "Salvar", a contagem tem de dar as linhas confirmadas e o `UPDATE` tem de
/// alterar exatamente elas, senão tudo é desfeito (no banco sem log, o que foi gravado fica, e a resposta diz isso); a coluna inteira vem antes dos
/// comandos por linha; o caminho por lotes lê as chaves do comando, até 1.000.000. É a mesma classe do `AdoDatabaseConnectionTests`, em outro arquivo.
/// </summary>
public sealed partial class AdoDatabaseConnectionTests
{
    private const string WholeCount = "COUNT WHOLE";
    private const string WholeUpdate = "UPDATE WHOLE";
    private const string RowUpdate = "UPDATE ROW";

    /// <summary>As linhas que o banco de mentira diz ter alterado num comando pelo leitor (a coluna inteira), pelo texto dele.</summary>
    private readonly Dictionary<string, int> _affected = [];

    /// <summary>O leitor que o banco de mentira devolve a um comando, pelo texto, quando o teste dá um; nulo é o de sempre.</summary>
    private Func<string, DbDataReader?> _readers = _ => null;

    /// <summary>Os níveis de isolamento com que a base abriu a transação do driver, na ordem.</summary>
    private readonly List<IsolationLevel> _isolations = [];

    private static readonly WholeColumnPlan WholeColumn = new(0, 3, WholeCount, new EditCommand(0, WholeUpdate, [new EditParameter("paga")]));

    private static readonly EditCommand OneRow = new(1, RowUpdate, [new EditParameter("1")]);

    private async Task<IDatabaseConnection> OpenForWholeColumnAsync(bool snapshot = false, bool errorlessInterruption = false)
    {
        _driver.Protected().Setup<ValueTask<DbTransaction>>("BeginDbTransactionAsync", ItExpr.IsAny<IsolationLevel>(), ItExpr.IsAny<CancellationToken>()).Returns((IsolationLevel level, CancellationToken _) =>
        {
            _sent.Add("BEGIN TRANSACTION");
            _isolations.Add(level);

            return ValueTask.FromResult<DbTransaction>(new FakeTransaction(this));
        });
        _nonQuery = (sql, _) => Task.FromResult(sql == RowUpdate ? 1 : 0);
        _catalog[WholeCount] = [[3L]];
        _affected[WholeUpdate] = 3;

        AdoDatabaseConnection connection = (snapshot, errorlessInterruption) switch
        {
            (true, _) => new SnapshotEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None),
            (_, true) => new ErrorlessInterruptionEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None),
            _ => new FakeEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None)
        };

        return (await connection.OpenAsync(CancellationToken.None)).Value;
    }

    private static Task<Result<int, DatabaseFailure>> SaveAsync(IDatabaseConnection connection, WholeColumnPlan whole, bool oneAtATime = false, params EditCommand[] commands)
        => connection.ApplyEditsAsync(new EditTables([], []), oneAtATime, wholeColumn: true, _ => new EditPlan(whole, commands), CancellationToken.None);

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "OK a coluna inteira vai primeiro, na transação: a contagem, o UPDATE e depois os comandos por linha, e ela conta como uma alteração")]
    public async Task ApplyEdits_WithTheWholeColumn_RunsItFirst()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();

        //Act
        var saved = await SaveAsync(connection, WholeColumn, false, OneRow);

        //Assert
        Assert.Equal(2, saved.Value);
        Assert.Equal(["BEGIN TRANSACTION", WholeCount, WholeUpdate, RowUpdate, "COMMIT"], _sent);
        Assert.Equal([IsolationLevel.Unspecified], _isolations);
    }

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "OK no banco que pede o retrato (o PostgreSQL), a transação do Salvar com a coluna inteira é Repeatable read; sem ela, a de sempre")]
    public async Task ApplyEdits_WithTheWholeColumn_OpensTheSnapshotTransaction()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync(snapshot: true);

        //Act
        await SaveAsync(connection, WholeColumn);
        await connection.ApplyEditsAsync(new EditTables([], []), false, wholeColumn: false, _ => new EditPlan(null, [OneRow]), CancellationToken.None);

        //Assert
        Assert.Equal([IsolationLevel.RepeatableRead, IsolationLevel.Unspecified], _isolations);
    }

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "Erro a contagem que não dá as linhas confirmadas é RESULT_CHANGED, e nada é executado: a transação é desfeita")]
    public async Task ApplyEdits_WhenTheCountDiffers_RunsNothing()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _catalog[WholeCount] = [[1240L]];

        //Act
        var saved = await SaveAsync(connection, WholeColumn with { Rows = 1234 }, false, OneRow);

        //Assert
        Assert.Equal((EDatabaseFailure.ResultChanged, WholeColumnSql.CountChanged(1240, 1234)), (saved.Error.Kind, saved.Error.Message));
        Assert.Equal(["BEGIN TRANSACTION", WholeCount, "ROLLBACK"], _sent);
    }

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "Erro o UPDATE que não altera as linhas confirmadas é RESULT_CHANGED, com a dica do gatilho, e tudo é desfeito")]
    public async Task ApplyEdits_WhenTheUpdateDiffers_UndoesEverything()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _affected[WholeUpdate] = 2;

        //Act
        var saved = await SaveAsync(connection, WholeColumn, false, OneRow);

        //Assert
        Assert.Equal((EDatabaseFailure.ResultChanged, WholeColumnSql.UpdateChanged(2, 3)), (saved.Error.Kind, saved.Error.Message));
        Assert.Equal(["BEGIN TRANSACTION", WholeCount, WholeUpdate, "ROLLBACK"], _sent);
    }

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "Erro no banco sem log, o UPDATE que altera outro número de linhas fica gravado: EDIT_ROW_MISMATCH com rowsAffected e applied 1")]
    public async Task ApplyEdits_WithoutLog_WhenTheUpdateDiffers_SaysItWasWritten()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _affected[WholeUpdate] = 5;

        //Act
        var saved = await SaveAsync(connection, WholeColumn, true, OneRow);

        //Assert
        Assert.Equal((EDatabaseFailure.EditRowMismatch, (int?)0, (long?)5, (int?)1), (saved.Error.Kind, saved.Error.Change, saved.Error.RowsAffected, saved.Error.Applied));
        Assert.Equal(WholeColumnSql.WrittenAnyway(5, 3), saved.Error.Message);
        Assert.Equal([WholeCount, WholeUpdate], _sent);
    }

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "Erro no banco sem log, a falha do UPDATE da coluna inteira é outcome unknown com applied 0; a da contagem, a de sempre")]
    public async Task ApplyEdits_WithoutLog_WhenTheUpdateFails_TheOutcomeIsUnknown()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _commandFailure = sql => sql == WholeUpdate ? new FakeDatabaseException("recusa do banco", "IX000") : null;

        //Act
        var update = await SaveAsync(connection, WholeColumn, true, OneRow);
        _commandFailure = sql => sql == WholeCount ? new FakeDatabaseException("recusa do banco", "IX000") : null;
        var count = await SaveAsync(connection, WholeColumn, true, OneRow);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, (int?)0, (ECancelOutcome?)ECancelOutcome.Unknown, (int?)0), (update.Error.Kind, update.Error.Change, update.Error.Outcome, update.Error.Applied));
        Assert.Equal((EDatabaseFailure.ExecutionFailed, (int?)0, (ECancelOutcome?)null, (int?)0), (count.Error.Kind, count.Error.Change, count.Error.Outcome, count.Error.Applied));
        Assert.DoesNotContain(RowUpdate, _sent);
    }

    /// <summary>
    /// RN-SQL-010 e RN-EDIT-021: no driver da IBM, o `UPDATE` interrompido dentro da transação do "Salvar" às vezes volta numa exceção sem nenhum erro do
    /// banco. Com o "Cancelar" pedido ela é a interrupção (`outcome: canceled`, a transação desfeita); sem o pedido, um erro comum, sem desfecho.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Theory(DisplayName = "Erro a exceção sem informação do banco no UPDATE da coluna inteira é canceled só com o Cancelar pedido, e a transação é desfeita")]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ApplyEdits_WhenTheUpdateComesBackWithoutErrorInformation_IsCanceledOnlyWhenACancelWasRequested(bool cancelRequested)
    {
        //Arrange
        IDatabaseConnection? connection = null;
        _commandFailure = sql =>
        {
            if (sql != WholeUpdate)
                return null;

            if (cancelRequested)
                connection!.Cancel();

            return new NoErrorInformationException();
        };
        connection = await OpenForWholeColumnAsync(errorlessInterruption: true);

        //Act
        var saved = await SaveAsync(connection, WholeColumn, false, OneRow);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, NoErrorInformationException.Text, cancelRequested ? ECancelOutcome.Canceled : (ECancelOutcome?)null), (saved.Error.Kind, saved.Error.Message, saved.Error.Outcome));
        Assert.Equal(["BEGIN TRANSACTION", WholeCount, WholeUpdate, "ROLLBACK"], _sent);
    }

    /// <summary>RN-SQL-010: no banco que não declara a exceção sem informação como interrupção (o PostgreSQL), ela é um erro comum, mesmo com o "Cancelar" pedido.</summary>
    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "Erro no banco que não a declara, a exceção sem informação do banco não é canceled, mesmo com o Cancelar pedido")]
    public async Task ApplyEdits_WhenTheEngineDoesNotDeclareTheErrorlessInterruption_HasNoOutcome()
    {
        //Arrange
        IDatabaseConnection? connection = null;
        _commandFailure = sql =>
        {
            if (sql != WholeUpdate)
                return null;

            connection!.Cancel();

            return new NoErrorInformationException();
        };
        connection = await OpenForWholeColumnAsync();

        //Act
        var saved = await SaveAsync(connection, WholeColumn, false, OneRow);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, (ECancelOutcome?)null), (saved.Error.Kind, saved.Error.Outcome));
    }

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "OK no banco sem log, a falha de uma alteração por linha depois da coluna inteira leva applied com ela")]
    public async Task ApplyEdits_WithoutLog_WhenARowFailsAfterTheWholeColumn_CountsItAsApplied()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _nonQuery = (_, _) => Task.FromResult(0);

        //Act
        var saved = await SaveAsync(connection, WholeColumn, true, OneRow);

        //Assert
        Assert.Equal((EDatabaseFailure.EditRowMismatch, (int?)1, (int?)1, (ECancelOutcome?)null), (saved.Error.Kind, saved.Error.Change, saved.Error.Applied, saved.Error.Outcome));
    }

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "OK no caminho por lotes, as chaves são lidas do comando, como a grade as escreve, e cada lote altera as linhas das chaves dele")]
    public async Task ApplyEdits_ThroughTheBatches_ReadsTheKeysAndRunsEachBatch()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _rows = 3;
        IReadOnlyList<IReadOnlyList<string>>? read = null;
        _affected["BATCH 1"] = 2;
        _affected["BATCH 2"] = 1;
        var whole = new WholeColumnPlan(0, 3, ReadQuery, null, [0], keys =>
        {
            read = keys;

            return Result.Success<IReadOnlyList<WholeColumnBatch>, DatabaseFailure>([new WholeColumnBatch(new EditCommand(0, "BATCH 1", []), 2), new WholeColumnBatch(new EditCommand(0, "BATCH 2", []), 1)]);
        });

        //Act
        var saved = await SaveAsync(connection, whole);

        //Assert
        Assert.Equal(1, saved.Value);
        Assert.Equal([["1"], ["2"], ["3"]], read!);
        Assert.Equal(["BEGIN TRANSACTION", ReadQuery, "BATCH 1", "BATCH 2", "COMMIT"], _sent);
    }

    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "Erro no caminho por lotes, o lote que não altera as linhas das chaves dele para tudo: RESULT_CHANGED com a soma, e desfeito")]
    public async Task ApplyEdits_ThroughTheBatches_StopsAtTheBatchThatDiffers()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _rows = 3;
        _affected["BATCH 1"] = 1;
        var whole = new WholeColumnPlan(0, 3, ReadQuery, null, [0], _ => Result.Success<IReadOnlyList<WholeColumnBatch>, DatabaseFailure>([new WholeColumnBatch(new EditCommand(0, "BATCH 1", []), 2), new WholeColumnBatch(new EditCommand(0, "BATCH 2", []), 1)]));

        //Act
        var saved = await SaveAsync(connection, whole);

        //Assert
        Assert.Equal((EDatabaseFailure.ResultChanged, WholeColumnSql.UpdateChanged(1, 3)), (saved.Error.Kind, saved.Error.Message));
        Assert.Equal(["BEGIN TRANSACTION", ReadQuery, "BATCH 1", "ROLLBACK"], _sent);
    }

    [Trait("AdoDatabaseConnection", "CountWholeColumnAsync")]
    [Fact(DisplayName = "Erro o caminho por lotes com mais de 1.000.000 de linhas é recusado na contagem e no Salvar, sem alterar nada")]
    public async Task WholeColumn_WithMoreThanAMillionKeys_IsRefused()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _readers = sql => sql == "MUITAS" ? new CountingReader(WholeColumnSql.MaxKeys + 1) : null;
        var whole = new WholeColumnPlan(0, WholeColumnSql.MaxKeys, "MUITAS", null, [0], _ => throw new InvalidOperationException("os lotes não podem ser montados"));

        //Act
        var counted = await connection.CountWholeColumnAsync(new EditTables([], []), _ => whole, CancellationToken.None);
        var saved = await SaveAsync(connection, whole);

        //Assert
        Assert.Equal((EDatabaseFailure.EditAllRowsNotSupported, WholeColumnSql.TooManyKeysReason, (int?)0), (counted.Error.Kind, counted.Error.Reason, counted.Error.Change));
        Assert.Equal((EDatabaseFailure.EditAllRowsNotSupported, WholeColumnSql.TooManyKeysReason), (saved.Error.Kind, saved.Error.Reason));
        Assert.Equal(["MUITAS", "BEGIN TRANSACTION", "MUITAS", "ROLLBACK"], _sent);
    }

    [Trait("AdoDatabaseConnection", "CountWholeColumnAsync")]
    [Fact(DisplayName = "OK a contagem da pergunta confere o catálogo na sessão e conta na transação só de leitura; no caminho por lotes, lê as chaves")]
    public async Task CountWholeColumn_CountsInsideTheReadOnlyTransaction()
    {
        //Arrange
        var connection = await OpenForWholeColumnAsync();
        _rows = 4;
        IReadOnlyList<EditCatalogTable?>? described = null;

        //Act
        var counted = await connection.CountWholeColumnAsync(new EditTables([], []), catalogs =>
        {
            described = catalogs;

            return WholeColumn;
        }, CancellationToken.None);
        var keys = await connection.CountWholeColumnAsync(new EditTables([], []), _ => new WholeColumnPlan(0, null, ReadQuery, null, [0], _ => Result.Success<IReadOnlyList<WholeColumnBatch>, DatabaseFailure>([])), CancellationToken.None);
        var refused = await connection.CountWholeColumnAsync(new EditTables([], []), _ => new DatabaseFailure(EDatabaseFailure.ResultChanged, "A tabela pedido mudou desde a consulta."), CancellationToken.None);

        //Assert
        Assert.NotNull(described);
        Assert.Equal((3L, 4L), (counted.Value, keys.Value));
        Assert.Equal(EDatabaseFailure.ResultChanged, refused.Error.Kind);
        Assert.Equal(["BEGIN READ ONLY", WholeCount, "COMMIT", ReadQuery], _sent);
    }

    /// <summary>Um banco que abre a transação da coluna inteira no retrato, como o PostgreSQL.</summary>
    private sealed class SnapshotEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override System.Data.IsolationLevel? WholeColumnIsolation => System.Data.IsolationLevel.RepeatableRead;
    }

    /// <summary>Um banco como os da IBM, em que a exceção sem nenhum erro do banco conta como interrupção.</summary>
    private sealed class ErrorlessInterruptionEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override bool CameWithoutErrorInformation(Exception exception)
            => exception is NoErrorInformationException;
    }

    /// <summary>A exceção do driver da IBM que não trouxe nenhum erro do banco: sem SQLSTATE, só o texto do driver.</summary>
    private sealed class NoErrorInformationException() : DbException(Text)
    {
        public const string Text = "ERROR - no error information available";
    }

    /// <summary>Um leitor de uma coluna inteira, com `rows` linhas, sem o custo do Moq em cada leitura: é o comando de muitas chaves.</summary>
    private sealed class CountingReader(int rows) : DbDataReader
    {
        private int _row;

        public override int FieldCount => 1;

        public override int RecordsAffected => -1;

        public override bool HasRows => rows > 0;

        public override bool IsClosed => false;

        public override int Depth => 0;

        public override object this[int ordinal] => GetValue(ordinal);

        public override object this[string name] => GetValue(0);

        public override bool Read()
            => ++_row <= rows;

        public override Task<bool> ReadAsync(CancellationToken cancellationToken)
            => Task.FromResult(Read());

        public override bool NextResult()
            => false;

        public override object GetValue(int ordinal)
            => _row;

        public override Type GetFieldType(int ordinal)
            => typeof(int);

        public override string GetName(int ordinal)
            => "id";

        public override string GetDataTypeName(int ordinal)
            => "integer";

        public override int GetOrdinal(string name)
            => 0;

        public override bool IsDBNull(int ordinal)
            => false;

        public override int GetValues(object[] values)
            => throw new NotSupportedException();

        public override bool GetBoolean(int ordinal)
            => throw new NotSupportedException();

        public override byte GetByte(int ordinal)
            => throw new NotSupportedException();

        public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length)
            => throw new NotSupportedException();

        public override char GetChar(int ordinal)
            => throw new NotSupportedException();

        public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length)
            => throw new NotSupportedException();

        public override DateTime GetDateTime(int ordinal)
            => throw new NotSupportedException();

        public override decimal GetDecimal(int ordinal)
            => throw new NotSupportedException();

        public override double GetDouble(int ordinal)
            => throw new NotSupportedException();

        public override float GetFloat(int ordinal)
            => throw new NotSupportedException();

        public override Guid GetGuid(int ordinal)
            => throw new NotSupportedException();

        public override short GetInt16(int ordinal)
            => throw new NotSupportedException();

        public override int GetInt32(int ordinal)
            => _row;

        public override long GetInt64(int ordinal)
            => _row;

        public override string GetString(int ordinal)
            => throw new NotSupportedException();

        public override IEnumerator GetEnumerator()
            => throw new NotSupportedException();
    }
}
