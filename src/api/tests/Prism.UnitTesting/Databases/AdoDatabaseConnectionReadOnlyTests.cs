using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;
using Serilog;
using Serilog.Core;
using System.Data.Common;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-PROT-002 e 006, RN-VERIF-001: o comando de uma conexão somente leitura, o modo só de leitura da sessão e a consulta de verificação, na base,
/// sobre o driver de mentira. O banco de mentira daqui tem o modo da sessão (`SET READ ONLY` e `SET READ WRITE`, como o PostgreSQL) e recusa a
/// gravação na transação só de leitura com 25006. É a mesma classe do `AdoDatabaseConnectionTests`, em outro arquivo, para dividir o driver de mentira.
/// </summary>
public sealed partial class AdoDatabaseConnectionTests
{
    private const string ReadOnlyMode = "SET READ ONLY";
    private const string ReadWriteMode = "SET READ WRITE";

    private async Task<IDatabaseConnection> OpenWithSessionModeAsync()
        => (await new SessionModeEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None).OpenAsync(CancellationToken.None)).Value;

    private static FakeDatabaseException WriteRefusal()
        => new("cannot execute nextval() in a read-only transaction", "25006");

    /// <summary>O modo vai ao banco antes da transação só de leitura do primeiro comando, e não de novo enquanto ele não muda.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteReadOnlyAsync")]
    [Fact(DisplayName = "OK o primeiro comando somente leitura põe a sessão no modo só de leitura, uma vez, antes da transação")]
    public async Task ExecuteReadOnly_ShouldSetTheSessionModeOnce()
    {
        //Arrange
        var connection = await OpenWithSessionModeAsync();

        //Act
        var first = await connection.ExecuteReadOnlyAsync(ReadQuery, QueryPaging.DefaultPageSize, CancellationToken.None);
        var second = await connection.ExecuteReadOnlyAsync(ReadQuery, QueryPaging.DefaultPageSize, CancellationToken.None);

        //Assert
        Assert.True(first.IsSuccess);
        Assert.True(second.Value.Page!.HasMore);
        Assert.Equal([ReadOnlyMode, "BEGIN READ ONLY", ReadQuery, "ROLLBACK", "BEGIN READ ONLY", ReadQuery], _sent);
    }

    /// <summary>A conexão deixou de ser somente leitura: o comando seguinte, e só ele, tira a sessão do modo.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK o comando de depois que a conexão deixou de ser somente leitura tira a sessão do modo, uma vez")]
    public async Task Execute_AfterReadOnly_ShouldSetTheReadWriteModeOnce()
    {
        //Arrange
        _rows = 1;
        var connection = await OpenWithSessionModeAsync();
        await connection.ExecuteReadOnlyAsync(ReadQuery, QueryPaging.DefaultPageSize, CancellationToken.None);
        _sent.Clear();

        //Act
        var first = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);
        var second = await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.Equal(3, first.Value.RowsAffected);
        Assert.True(second.IsSuccess);
        Assert.Equal([ReadWriteMode, CountedCommand, CountedCommand], _sent);
    }

    /// <summary>A sessão de uma conexão que nunca foi somente leitura não recebe nada: vale o que o banco e o usuário dele já usam.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteAsync")]
    [Fact(DisplayName = "OK a sessão que nunca foi somente leitura não recebe o modo")]
    public async Task Execute_NeverReadOnly_ShouldNotSetTheMode()
    {
        //Arrange
        _rows = 1;
        var connection = await OpenWithSessionModeAsync();

        //Act
        await connection.ExecuteAsync(ReadQuery, CancellationToken.None);
        await connection.ExecuteAsync(CountedCommand, CancellationToken.None);

        //Assert
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "COMMIT", CountedCommand], _sent);
    }

    /// <summary>RN-PROT-002: na conexão somente leitura a recusa do banco por gravar é a resposta, e o comando não roda de novo fora da transação.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteReadOnlyAsync")]
    [Fact(DisplayName = "Erro a recusa do banco por gravar é a resposta, sem rodar de novo fora da transação, ao contrário da conexão comum")]
    public async Task ExecuteReadOnly_WriteRefusal_IsTheAnswer()
    {
        //Arrange
        _commandFailure = sql => sql == ReadQuery ? WriteRefusal() : null;
        var connection = await OpenWithSessionModeAsync();

        //Act
        var readOnly = await connection.ExecuteReadOnlyAsync(ReadQuery, QueryPaging.DefaultPageSize, CancellationToken.None);
        var sentReadOnly = _sent.ToList();
        _sent.Clear();
        _commandFailure = sql => sql == ReadQuery && _sent.Count(sent => sent == ReadQuery) == 1 ? WriteRefusal() : null;
        var common = await connection.ExecuteAsync(ReadQuery, CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.ExecutionFailed, "25006", "cannot execute nextval() in a read-only transaction"), (readOnly.Error.Kind, readOnly.Error.SqlState, readOnly.Error.Message));
        Assert.Equal([ReadOnlyMode, "BEGIN READ ONLY", ReadQuery, "ROLLBACK"], sentReadOnly);
        Assert.True(common.IsSuccess);
        Assert.Equal([ReadWriteMode, "BEGIN READ ONLY", ReadQuery, "ROLLBACK", ReadQuery], _sent);
    }

    /// <summary>
    /// RN-PROT-002: a recusa que só aparece no "carregar mais" também é a resposta, sem a sugestão de executar de novo; e a mesma leitura, executada de
    /// novo, continua na transação só de leitura, e não roda até o fim fora dela, como roda numa conexão comum.
    /// </summary>
    [Trait("AdoDatabaseConnection", "FetchNextAsync")]
    [Fact(DisplayName = "Erro a recusa por gravar no carregar mais de uma leitura somente leitura vem como veio, sem sugerir executar de novo")]
    public async Task FetchNext_ReadOnlyCursor_WriteRefusal_IsTheAnswer()
    {
        //Arrange
        _rowFailure = row => row == 202 ? WriteRefusal() : null;
        var connection = await OpenWithSessionModeAsync();
        await connection.ExecuteReadOnlyAsync(ReadQuery, QueryPaging.DefaultPageSize, CancellationToken.None);

        //Act
        var next = await connection.FetchNextAsync(CancellationToken.None);
        var again = await connection.ExecuteReadOnlyAsync(ReadQuery, QueryPaging.DefaultPageSize, CancellationToken.None);

        //Assert
        Assert.Equal(("25006", "cannot execute nextval() in a read-only transaction"), (next.Error.SqlState, next.Error.Message));
        Assert.True(again.Value.Page!.HasMore);
        Assert.Equal([ReadOnlyMode, "BEGIN READ ONLY", ReadQuery, "ROLLBACK", "BEGIN READ ONLY", ReadQuery], _sent);
    }

    /// <summary>As recusas pelo texto valem também no caminho somente leitura, sem ir ao banco.</summary>
    [Trait("AdoDatabaseConnection", "ExecuteReadOnlyAsync")]
    [Fact(DisplayName = "Erro controle de transação no caminho somente leitura é recusado sem ir ao banco")]
    public async Task ExecuteReadOnly_TransactionControl_IsRefused()
    {
        //Arrange
        var connection = await OpenWithSessionModeAsync();

        //Act
        var refused = await connection.ExecuteReadOnlyAsync("BEGIN", QueryPaging.DefaultPageSize, CancellationToken.None);

        //Assert
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, refused.Error.Kind);
        Assert.Empty(_sent);
    }

    /// <summary>RN-PROT-006: o "Salvar" só chega à conexão que não é somente leitura, e tira a sessão do modo antes de qualquer coisa.</summary>
    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "OK o Salvar depois de a conexão deixar de ser somente leitura tira a sessão do modo antes")]
    public async Task ApplyEdits_AfterReadOnly_ShouldSetTheReadWriteMode()
    {
        //Arrange
        _rows = 1;
        var connection = await OpenWithSessionModeAsync();
        await connection.ExecuteReadOnlyAsync(ReadQuery, QueryPaging.DefaultPageSize, CancellationToken.None);
        _sent.Clear();

        //Act
        var applied = await connection.ApplyEditsAsync(new EditTables([], []), oneAtATime: true, _ => Result.Failure<IReadOnlyList<EditCommand>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.EditInvalid, "nada a gravar")), CancellationToken.None);

        //Assert
        Assert.Equal(EDatabaseFailure.EditInvalid, applied.Error.Kind);
        Assert.Equal([ReadWriteMode], _sent);
    }

    /// <summary>RN-VERIF-001: a consulta própria roda na transação só de leitura e é lida até o fim; a do banco, sem transação.</summary>
    [Trait("AdoDatabaseConnection", "VerifyAsync")]
    [Fact(DisplayName = "OK a consulta de verificação própria roda numa transação só de leitura, e a do banco sem ela")]
    public async Task Verify_OwnQueryRunsInAReadOnlyTransaction()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        var own = await connection.VerifyAsync("SELECT 2", CancellationToken.None);
        var engines = await connection.VerifyAsync(null, CancellationToken.None);

        //Assert
        Assert.True(own.IsSuccess);
        Assert.True(engines.IsSuccess);
        Assert.Equal(["BEGIN READ ONLY", "SELECT 2", "COMMIT", "PING"], _sent);
        Assert.False(connection.HasOpenCursor);
    }

    /// <summary>A falha da consulta é `ConnectionFailed`, com a mensagem e o SQLSTATE do banco, e a transação dela é desfeita.</summary>
    [Trait("AdoDatabaseConnection", "VerifyAsync")]
    [Fact(DisplayName = "Erro a consulta de verificação que falha é ConnectionFailed com a mensagem do banco, e a transação é desfeita")]
    public async Task Verify_Failure_IsConnectionFailed()
    {
        //Arrange
        _commandFailure = sql => sql == "SELECT * FROM nao_existe" ? new FakeDatabaseException("relation \"nao_existe\" does not exist", "42P01") : null;
        var connection = await OpenAsync();

        //Act
        var verified = await connection.VerifyAsync("SELECT * FROM nao_existe", CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.ConnectionFailed, "relation \"nao_existe\" does not exist", "42P01"), (verified.Error.Kind, verified.Error.Message, verified.Error.SqlState));
        Assert.Equal(["BEGIN READ ONLY", "SELECT * FROM nao_existe", "ROLLBACK"], _sent);
        Assert.True(connection.IsOpen);
    }

    /// <summary>O banco de mentira com o modo só de leitura da sessão e a recusa da transação só de leitura, como o PostgreSQL.</summary>
    private sealed class SessionModeEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override string? SessionModeSql(bool readOnly)
            => readOnly ? ReadOnlyMode : ReadWriteMode;

        protected override bool IsWriteRefusal(DatabaseFailure failure)
            => failure.SqlState == "25006";
    }
}
