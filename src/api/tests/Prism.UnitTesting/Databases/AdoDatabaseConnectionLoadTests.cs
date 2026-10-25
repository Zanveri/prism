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
/// RN-IMPORT-012, 015 e 016: o carregador da importação e da cópia na base, sobre o driver de mentira. O banco de mentira padrão é como o Db2 (um
/// `INSERT … VALUES` de várias linhas, com `?`, e a transação do driver); o de lotes é como o PostgreSQL (`NpgsqlBatch`, `$1`). O carregador com o
/// PostgreSQL de verdade é dos testes de integração. É a mesma classe do `AdoDatabaseConnectionTests`, em outro arquivo.
/// </summary>
public sealed partial class AdoDatabaseConnectionTests
{
    private static readonly LoadTarget Target = new("loja", "pe\"dido", ["id", "nome"]);

    /// <summary>Quantas vezes um comando foi preparado no banco de mentira.</summary>
    private int _prepared;

    /// <summary>Os valores dos parâmetros de cada comando sem linhas, na ordem em que chegaram, e se ele foi na transação.</summary>
    private readonly List<object?[]> _sentValues = [];

    /// <summary>RN-VAR-032: os comandos que foram ao banco de mentira pelo leitor, com os parâmetros que levaram, na ordem.</summary>
    private readonly List<(string Sql, DbParameter[] Parameters)> _readerCommands = [];
    private readonly List<bool> _sentInTransaction = [];

    /// <summary>O que o banco de mentira lança na confirmação da transação da carga; e o que acontece no meio dela.</summary>
    private Func<Exception?> _commitFailure = () => null;
    private Action _duringCommit = () => { };

    /// <summary>A posição do comando de um lote que o banco de mentira recusa, ou nula.</summary>
    private Func<int?> _batchFailure = () => null;

    private async Task<IDatabaseConnection> OpenForLoadAsync(bool batches = false, bool silentCancel = false, bool oneRow = false)
    {
        _driver.Protected().Setup<ValueTask<DbTransaction>>("BeginDbTransactionAsync", ItExpr.IsAny<IsolationLevel>(), ItExpr.IsAny<CancellationToken>()).Returns(() =>
        {
            _sent.Add("BEGIN TRANSACTION");

            return ValueTask.FromResult<DbTransaction>(new FakeTransaction(this));
        });
        _driver.Protected().Setup<DbBatch>("CreateDbBatch").Returns(() => new FakeBatch(this));

        AdoDatabaseConnection connection = batches
            ? new BatchEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None)
            : oneRow
                ? new OneRowEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None)
            : silentCancel
                ? new SilentCancelEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), () => false, Logger.None)
                : new FakeEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None);

        return (await connection.OpenAsync(CancellationToken.None)).Value;
    }

    private static IReadOnlyList<IReadOnlyList<EditParameter>> Rows(params (int Id, string Name)[] rows)
        => [.. rows.Select(row => (IReadOnlyList<EditParameter>)[new EditParameter(row.Id), new EditParameter(row.Name)])];

    [Trait("AdoDatabaseConnection", "BeginLoadAsync")]
    [Fact(DisplayName = "OK a conexão do carregador só recebe o prazo de trava, e nada sobre o modo só de leitura")]
    public async Task BeginLoad_ShouldOnlyLimitTheLockWait()
    {
        //Arrange
        var connection = await OpenForLoadAsync();

        //Act
        var begun = await connection.BeginLoadAsync(CancellationToken.None);

        //Assert
        Assert.True(begun.IsSuccess);
        Assert.Equal(["LOCK TIMEOUT"], _sent);
    }

    /// <summary>RN-IMPORT-015: no Db2, até 500 linhas e até 10.000 parâmetros por comando (40 colunas, 250 linhas); no lote do PostgreSQL, 500.</summary>
    [Trait("AdoDatabaseConnection", "LoadRowsPerCommand")]
    [Theory(DisplayName = "OK as linhas de um comando respeitam as 500 linhas e os 10.000 parâmetros")]
    [InlineData(false, 2, 500)]
    [InlineData(false, 40, 250)]
    [InlineData(false, 30000, 1)]
    [InlineData(true, 40, 500)]
    public async Task LoadRowsPerCommand_ShouldRespectTheLimits(bool batches, int columns, int expected)
    {
        //Arrange
        var connection = await OpenForLoadAsync(batches);

        //Act
        var rows = connection.LoadRowsPerCommand(columns);

        //Assert
        Assert.Equal(expected, rows);
    }

    [Trait("AdoDatabaseConnection", "InsertRowsAsync")]
    [Fact(DisplayName = "OK as linhas vão num INSERT de várias linhas, com os nomes entre aspas e os valores em parâmetros, na transação")]
    public async Task InsertRows_ShouldSendOneMultiRowInsertInTheTransaction()
    {
        //Arrange
        var connection = await OpenForLoadAsync();
        await connection.BeginLoadTransactionAsync(CancellationToken.None);

        //Act
        var inserted = await connection.InsertRowsAsync(Target, Rows((1, "a"), (2, "b")), CancellationToken.None);

        //Assert
        Assert.True(inserted.IsSuccess);
        Assert.Equal(["BEGIN TRANSACTION", "INSERT INTO \"loja\".\"pe\"\"dido\" (\"id\", \"nome\") VALUES (?, ?), (?, ?)"], _sent);
        Assert.Equal([1, "a", 2, "b"], _sentValues.Single());
        Assert.True(_sentInTransaction.Single());
    }

    /// <summary>RN-IMPORT-015: o comando é preparado uma vez e executado de novo enquanto o texto é o mesmo (no Informix, uma linha por comando).</summary>
    [Trait("AdoDatabaseConnection", "InsertRowsAsync")]
    [Fact(DisplayName = "OK o comando do mesmo texto é preparado uma vez e recebe os valores das linhas seguintes")]
    public async Task InsertRows_SameText_ShouldReuseThePreparedCommand()
    {
        //Arrange
        var connection = await OpenForLoadAsync();

        //Act
        await connection.InsertRowsAsync(Target, Rows((1, "a"), (2, "b")), CancellationToken.None);
        await connection.InsertRowsAsync(Target, Rows((3, "c"), (4, "d")), CancellationToken.None);
        await connection.InsertRowsAsync(Target, Rows((5, "e")), CancellationToken.None);

        //Assert
        Assert.Equal(2, _prepared);
        Assert.Equal([[1, "a", 2, "b"], [3, "c", 4, "d"], [5, "e"]], _sentValues);
        Assert.Equal([false, false, false], _sentInTransaction);
    }

    /// <summary>
    /// RN-IMPORT-016, no Db2: o comando de várias linhas recusado por uma restrição é executado de novo, linha por linha, na mesma transação, até a
    /// recusada, que a falha aponta; e a transação é desfeita.
    /// </summary>
    [Trait("AdoDatabaseConnection", "InsertRowsAsync")]
    [Theory(DisplayName = "OK a recusa de dado ou de restrição é procurada linha por linha, e aponta a linha")]
    [InlineData("23505")]
    [InlineData("22001")]
    public async Task InsertRows_DataOrConstraintRefusal_ShouldRetryRowByRow(string sqlState)
    {
        //Arrange
        _nonQuery = (sql, _) => sql.Contains("), (", StringComparison.Ordinal) || _sentValues[^1] is [2, _] ? Task.FromException<int>(new FakeDatabaseException("duplicate key", sqlState)) : Task.FromResult(1);
        var connection = await OpenForLoadAsync();
        await connection.BeginLoadTransactionAsync(CancellationToken.None);

        //Act
        var inserted = await connection.InsertRowsAsync(Target, Rows((1, "a"), (2, "b"), (3, "c")), CancellationToken.None);

        //Assert
        Assert.True(inserted.IsFailure);
        Assert.Equal((1, sqlState, "duplicate key"), (inserted.Error.Change, inserted.Error.SqlState, inserted.Error.Message));
        Assert.Equal([[1, "a", 2, "b", 3, "c"], [1, "a"], [2, "b"]], _sentValues);
        Assert.Equal("ROLLBACK", _sent[^1]);
    }

    /// <summary>RN-IMPORT-016: com outra classe (a transação que o banco desfez, a conexão), não há volta: a falha não tem linha.</summary>
    [Trait("AdoDatabaseConnection", "InsertRowsAsync")]
    [Fact(DisplayName = "OK a recusa de outra classe não volta linha por linha, e fica sem linha")]
    public async Task InsertRows_OtherRefusal_ShouldNotRetry()
    {
        //Arrange
        _nonQuery = (_, _) => Task.FromException<int>(new FakeDatabaseException("deadlock", "40001"));
        var connection = await OpenForLoadAsync();
        await connection.BeginLoadTransactionAsync(CancellationToken.None);

        //Act
        var inserted = await connection.InsertRowsAsync(Target, Rows((1, "a"), (2, "b")), CancellationToken.None);

        //Assert
        Assert.True(inserted.IsFailure);
        Assert.Null(inserted.Error.Change);
        Assert.Single(_sentValues);
        Assert.Equal("ROLLBACK", _sent[^1]);
    }

    /// <summary>
    /// RN-IMPORT-016: o comando de uma linha só (no Informix, todos; no Db2, o último antes de uma confirmação) aponta a linha dele em toda falha, da
    /// restrição à transação que o banco desfez, sem a volta linha por linha.
    /// </summary>
    [Trait("AdoDatabaseConnection", "InsertRowsAsync")]
    [Theory(DisplayName = "OK a falha do comando de uma linha só aponta essa linha")]
    [InlineData(false, "23505")]
    [InlineData(false, "40001")]
    [InlineData(true, "23505")]
    [InlineData(true, "23502")]
    public async Task InsertRows_OneRow_ShouldPointTheRow(bool informix, string sqlState)
    {
        //Arrange
        _nonQuery = (_, _) => Task.FromException<int>(new FakeDatabaseException("refused", sqlState));
        var connection = await OpenForLoadAsync(oneRow: informix);
        await connection.BeginLoadTransactionAsync(CancellationToken.None);

        //Act
        var inserted = await connection.InsertRowsAsync(Target, Rows((7, "g")), CancellationToken.None);

        //Assert
        Assert.True(inserted.IsFailure);
        Assert.Equal((0, sqlState), (inserted.Error.Change, inserted.Error.SqlState));
        Assert.Equal([[7, "g"]], _sentValues);
        Assert.Equal("ROLLBACK", _sent[^1]);
    }

    /// <summary>RN-IMPORT-015 e 016, no PostgreSQL: um `INSERT` de uma linha por comando do lote, com `$1`; o lote diz qual comando o banco recusou.</summary>
    [Trait("AdoDatabaseConnection", "InsertRowsAsync")]
    [Fact(DisplayName = "OK o lote manda um INSERT por linha, e a recusa aponta o comando do lote")]
    public async Task InsertRows_InBatches_ShouldPointTheFailedCommand()
    {
        //Arrange
        _batchFailure = () => 2;
        var connection = await OpenForLoadAsync(batches: true);
        await connection.BeginLoadTransactionAsync(CancellationToken.None);

        //Act
        var inserted = await connection.InsertRowsAsync(Target, Rows((1, "a"), (2, "b"), (3, "c")), CancellationToken.None);

        //Assert
        Assert.True(inserted.IsFailure);
        Assert.Equal((2, "23502"), (inserted.Error.Change, inserted.Error.SqlState));
        Assert.Equal(["BEGIN TRANSACTION", .. Enumerable.Repeat("INSERT INTO \"loja\".\"pe\"\"dido\" (\"id\", \"nome\") VALUES ($1, $2)", 3), "ROLLBACK"], _sent);
        Assert.Equal([[1, "a"], [2, "b"], [3, "c"]], _sentValues);
    }

    [Trait("AdoDatabaseConnection", "EmptyTableAsync")]
    [Fact(DisplayName = "OK o esvaziamento é um DELETE sem WHERE, na transação da carga")]
    public async Task EmptyTable_ShouldDeleteEveryRowInTheTransaction()
    {
        //Arrange
        var connection = await OpenForLoadAsync();
        await connection.BeginLoadTransactionAsync(CancellationToken.None);

        //Act
        var emptied = await connection.EmptyTableAsync("loja", "pe\"dido", CancellationToken.None);

        //Assert
        Assert.True(emptied.IsSuccess);
        Assert.Equal(["BEGIN TRANSACTION", "DELETE FROM \"loja\".\"pe\"\"dido\""], _sent);
        Assert.True(_sentInTransaction.Single());
    }

    [Trait("AdoDatabaseConnection", "CommitLoadAsync")]
    [Fact(DisplayName = "OK a confirmação fecha a transação, e sem transação (o banco sem log) não faz nada")]
    public async Task CommitLoad_ShouldCommit_AndDoNothingWithoutTransaction()
    {
        //Arrange
        var connection = await OpenForLoadAsync();

        //Act
        var withoutTransaction = await connection.CommitLoadAsync();
        await connection.BeginLoadTransactionAsync(CancellationToken.None);
        await connection.InsertRowsAsync(Target, Rows((1, "a")), CancellationToken.None);
        var committed = await connection.CommitLoadAsync();
        await connection.InsertRowsAsync(Target, Rows((2, "b")), CancellationToken.None);

        //Assert
        Assert.True(withoutTransaction.IsSuccess);
        Assert.True(committed.IsSuccess);
        Assert.Equal(["BEGIN TRANSACTION", "INSERT INTO \"loja\".\"pe\"\"dido\" (\"id\", \"nome\") VALUES (?, ?)", "COMMIT", "INSERT INTO \"loja\".\"pe\"\"dido\" (\"id\", \"nome\") VALUES (?, ?)"], _sent);
        Assert.Equal([true, false], _sentInTransaction);
    }

    /// <summary>
    /// RN-IMPORT-014: o cancelamento que chega durante a confirmação não a interrompe, nem a transforma em cancelada no driver que não lança ao ser
    /// cancelado (os da IBM).
    /// </summary>
    [Trait("AdoDatabaseConnection", "CommitLoadAsync")]
    [Fact(DisplayName = "OK o cancelamento no meio da confirmação não a desfaz nem a dá por cancelada")]
    public async Task CommitLoad_CanceledInTheMiddle_ShouldStillSucceed()
    {
        //Arrange
        var connection = await OpenForLoadAsync(silentCancel: true);
        await connection.BeginLoadTransactionAsync(CancellationToken.None);
        _duringCommit = connection.Cancel;

        //Act
        var committed = await connection.CommitLoadAsync();

        //Assert
        Assert.True(committed.IsSuccess);
        Assert.Equal(["BEGIN TRANSACTION", "COMMIT"], _sent);
    }

    /// <summary>RN-IMPORT-016: a recusa na própria confirmação (a restrição adiada) é a falha, e o banco já desfez a transação: nada mais vai a ele.</summary>
    [Trait("AdoDatabaseConnection", "CommitLoadAsync")]
    [Fact(DisplayName = "Erro a confirmação recusada é a falha, sem ROLLBACK depois")]
    public async Task CommitLoad_Refused_ShouldBeTheFailure()
    {
        //Arrange
        _commitFailure = () => new FakeDatabaseException("violates foreign key constraint", "23503");
        var connection = await OpenForLoadAsync();
        await connection.BeginLoadTransactionAsync(CancellationToken.None);

        //Act
        var committed = await connection.CommitLoadAsync();

        //Assert
        Assert.True(committed.IsFailure);
        Assert.Equal("23503", committed.Error.SqlState);
        Assert.Equal(["BEGIN TRANSACTION", "COMMIT"], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>RN-IMPORT-015: a leitura do catálogo da primeira transação roda dentro dela, sem desfazê-la antes.</summary>
    [Trait("AdoDatabaseConnection", "DescribeImportTargetAsync")]
    [Fact(DisplayName = "OK o catálogo lido na transação da carga não a desfaz")]
    public async Task DescribeImportTarget_InTheLoadTransaction_ShouldKeepIt()
    {
        //Arrange
        _catalog["EDIT RELATION"] = [["loja", "pedido", "table", null, 0]];
        _catalog["COLUMNS"] = [["id", "integer", false, true, 1, null, null]];
        _catalog["EDIT KEYS"] = [];
        _catalog["REFERENCED BY"] = [];
        var connection = await OpenForLoadAsync();
        await connection.BeginLoadTransactionAsync(CancellationToken.None);

        //Act
        var described = await connection.DescribeImportTargetAsync("loja", "pedido", CancellationToken.None);
        await connection.InsertRowsAsync(Target, Rows((1, "a")), CancellationToken.None);
        await connection.CommitLoadAsync();

        //Assert
        Assert.Equal("pedido", described.Value!.Table.Name);
        Assert.DoesNotContain("ROLLBACK", _sent);
        Assert.Equal("COMMIT", _sent[^1]);
        Assert.True(_sentInTransaction.Single());
    }

    /// <summary>Um banco como o PostgreSQL na carga: as linhas num lote de comandos de uma linha, com `$1`.</summary>
    private sealed class BatchEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override bool LoadsInBatches => true;

        protected override int RowsPerLoadCommand(int columns)
            => MaxLoadRows;

        protected override string LoadParameter(int position)
            => $"${position}";
    }

    /// <summary>Um banco como o Informix na carga: uma linha por comando, com `?`.</summary>
    private sealed class OneRowEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override int RowsPerLoadCommand(int columns)
            => 1;
    }

    /// <summary>A transação do driver de mentira: anota a confirmação e o desfazimento, e lança o que o teste pedir na confirmação.</summary>
    private sealed class FakeTransaction(AdoDatabaseConnectionTests test) : DbTransaction
    {
        public override IsolationLevel IsolationLevel => IsolationLevel.ReadCommitted;

        protected override DbConnection? DbConnection => test._driver.Object;

        public override void Commit()
        {
            test._sent.Add("COMMIT");
            test._duringCommit();
            if (test._commitFailure() is { } failure)
                throw failure;
        }

        public override void Rollback()
            => test._sent.Add("ROLLBACK");
    }

    /// <summary>Os parâmetros de um comando de mentira, numa lista, com os valores que o teste confere.</summary>
    private sealed class FakeParameters : DbParameterCollection
    {
        private readonly List<DbParameter> _items = [];

        public IEnumerable<object?> Values => _items.Select(parameter => parameter.Value is DBNull ? null : parameter.Value);

        /// <summary>Os parâmetros como o comando os recebeu (o valor e o `DbType`).</summary>
        public IReadOnlyList<DbParameter> Items => _items;

        public override int Count => _items.Count;

        public override object SyncRoot => _items;

        public override int Add(object value)
        {
            _items.Add((DbParameter)value);

            return _items.Count - 1;
        }

        public override void AddRange(Array values)
        {
            foreach (var value in values)
                Add(value!);
        }

        public override void Clear()
            => _items.Clear();

        public override bool Contains(object value)
            => _items.Contains((DbParameter)value);

        public override bool Contains(string value)
            => _items.Any(parameter => parameter.ParameterName == value);

        public override void CopyTo(Array array, int index)
            => ((ICollection)_items).CopyTo(array, index);

        public override IEnumerator GetEnumerator()
            => _items.GetEnumerator();

        public override int IndexOf(object value)
            => _items.IndexOf((DbParameter)value);

        public override int IndexOf(string parameterName)
            => _items.FindIndex(parameter => parameter.ParameterName == parameterName);

        public override void Insert(int index, object value)
            => _items.Insert(index, (DbParameter)value);

        public override void Remove(object value)
            => _items.Remove((DbParameter)value);

        public override void RemoveAt(int index)
            => _items.RemoveAt(index);

        public override void RemoveAt(string parameterName)
            => _items.RemoveAt(IndexOf(parameterName));

        protected override DbParameter GetParameter(int index)
            => _items[index];

        protected override DbParameter GetParameter(string parameterName)
            => _items[IndexOf(parameterName)];

        protected override void SetParameter(int index, DbParameter value)
            => _items[index] = value;

        protected override void SetParameter(string parameterName, DbParameter value)
            => _items[IndexOf(parameterName)] = value;
    }

    /// <summary>Um comando de um lote de mentira.</summary>
    private sealed class FakeBatchCommand : DbBatchCommand
    {
        private readonly FakeParameters _parameters = new();

        public override string CommandText { get; set; } = string.Empty;

        public override CommandType CommandType { get; set; }

        public override int RecordsAffected => 1;

        public override bool CanCreateParameter => true;

        public FakeParameters Values => _parameters;

        protected override DbParameterCollection DbParameterCollection => _parameters;

        public override DbParameter CreateParameter()
            => new Mock<DbParameter>().SetupAllProperties().Object;
    }

    /// <summary>A lista de comandos de um lote de mentira.</summary>
    private sealed class FakeBatchCommands : DbBatchCommandCollection
    {
        private readonly List<DbBatchCommand> _items = [];

        public override int Count => _items.Count;

        public override bool IsReadOnly => false;

        public override void Add(DbBatchCommand item)
            => _items.Add(item);

        public override void Clear()
            => _items.Clear();

        public override bool Contains(DbBatchCommand item)
            => _items.Contains(item);

        public override void CopyTo(DbBatchCommand[] array, int arrayIndex)
            => _items.CopyTo(array, arrayIndex);

        public override IEnumerator<DbBatchCommand> GetEnumerator()
            => _items.GetEnumerator();

        public override int IndexOf(DbBatchCommand item)
            => _items.IndexOf(item);

        public override void Insert(int index, DbBatchCommand item)
            => _items.Insert(index, item);

        public override bool Remove(DbBatchCommand item)
            => _items.Remove(item);

        public override void RemoveAt(int index)
            => _items.RemoveAt(index);

        protected override DbBatchCommand GetBatchCommand(int index)
            => _items[index];

        protected override void SetBatchCommand(int index, DbBatchCommand batchCommand)
            => _items[index] = batchCommand;
    }

    /// <summary>O lote de mentira: anota cada comando, como chegaria ao banco, e recusa o que o teste pedir, dizendo qual (como o `NpgsqlBatch`).</summary>
    private sealed class FakeBatch(AdoDatabaseConnectionTests test) : DbBatch
    {
        private readonly FakeBatchCommands _commands = new();

        public override int Timeout { get; set; }

        protected override DbBatchCommandCollection DbBatchCommands => _commands;

        protected override DbConnection? DbConnection { get; set; }

        protected override DbTransaction? DbTransaction { get; set; }

        public override Task<int> ExecuteNonQueryAsync(CancellationToken cancellationToken = default)
        {
            foreach (FakeBatchCommand command in _commands)
            {
                test._sent.Add(command.CommandText);
                test._sentValues.Add([.. command.Values.Values]);
                test._sentInTransaction.Add(DbTransaction is not null);
            }

            return test._batchFailure() is { } index ? Task.FromException<int>(new FakeBatchException("null value in column \"nome\"", "23502", _commands[index])) : Task.FromResult(_commands.Count);
        }

        protected override DbBatchCommand CreateDbBatchCommand()
            => new FakeBatchCommand();

        public override int ExecuteNonQuery() => throw new NotSupportedException();
        public override object? ExecuteScalar() => throw new NotSupportedException();
        public override Task<object?> ExecuteScalarAsync(CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public override void Prepare() => throw new NotSupportedException();
        public override Task PrepareAsync(CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public override void Cancel() => throw new NotSupportedException();
        protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior) => throw new NotSupportedException();
        protected override Task<DbDataReader> ExecuteDbDataReaderAsync(CommandBehavior behavior, CancellationToken cancellationToken) => throw new NotSupportedException();
    }

    /// <summary>A recusa de um comando de um lote, que diz qual comando foi, como a do Npgsql.</summary>
    private sealed class FakeBatchException(string message, string sqlState, DbBatchCommand command) : DbException(message)
    {
        public override string? SqlState => sqlState;

        protected override DbBatchCommand? DbBatchCommand => command;
    }
}
