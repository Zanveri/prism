using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.TestingCore.Extensions;
using Serilog.Core;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-SQL-024: os resultados que a tela pede para a sessão continuar guardando (as abas do script, RN-SQL-023), com a conexão de mentira. É a
/// mesma classe do `DatabaseSessionServiceTests`, em outro arquivo, para dividir o client de mentira de cada banco.
/// </summary>
public sealed partial class DatabaseSessionServiceTests
{
    private static readonly QueryColumn[] PedidoColumns = [new("ID", "INTEGER", "number"), new("STATUS", "VARCHAR(20)", "text")];

    private static readonly EditCatalogTable Db2Pedido = new("LOJA", "PEDIDO", "table", null, false, [new("ID", "INTEGER", false, true, 1, null, null), new("STATUS", "VARCHAR(20)", true, false, 2, null, null)], [new EditKey("PK_PEDIDO", true, ["ID"])]);

    private static readonly EditChange PaidOrder = new(EEditKind.Update, 0, ["1"], [new EditValue(1, "paga")]);

    /// <summary>O registro com a conexão de mentira num banco dado, e a sessão aberta nele.</summary>
    private async Task<(DatabaseSessionService Service, Guid Session)> OpenAsync(EDatabaseEngine engine)
    {
        _connection.Catalog = [Db2Pedido];
        var service = new DatabaseSessionService([new EngineClient(engine, _connection)], _vault.Object, _clock, Logger.None);
        var opened = await service.OpenAsync(Guid.NewGuid(), Settings with { Engine = engine }, 0, CancellationToken.None);

        return (service, opened.Value.ID);
    }

    /// <summary>Executa um comando que devolve linhas de `PEDIDO`, guardando os da lista, e devolve o `resultID` da página.</summary>
    private async Task<Guid> ReadAsync(DatabaseSessionService service, Guid session, string sql, bool hasMore = false, params Guid[] keep)
    {
        _connection.Outcomes.Enqueue(new QueryOutcome(new QueryPage(PedidoColumns, [["1", "aberta"]], hasMore, 1, []), null, 1));

        return (await service.ExecuteAsync(session, sql, null, QueryPaging.DefaultPageSize, false, keep, CancellationToken.None)).Value.Page!.ResultID!.Value;
    }

    /// <summary>Executa um comando sem linhas (`SET`, `UPDATE`), que vai ao banco, guardando os da lista.</summary>
    private async Task RunAsync(DatabaseSessionService service, Guid session, string sql, params Guid[] keep)
    {
        _connection.Outcomes.Enqueue(new QueryOutcome(null, 0, 1));
        Assert.True((await service.ExecuteAsync(session, sql, null, QueryPaging.DefaultPageSize, false, keep, CancellationToken.None)).IsSuccess);
    }

    /// <summary>
    /// O resultado de antes que a lista do comando seguinte leva continua se editando: o `edit-target`, o "Ver SQL" e o "Salvar" o acham pelo
    /// `resultID`. O "Salvar" dele é um comando na sessão: fecha o cursor do atual, que continua o atual, e o guardado continua guardado.
    /// </summary>
    [Trait("DatabaseSessionService", "Keep")]
    [Fact(DisplayName = "OK o resultado da lista continua se editando, e o Salvar dele fecha o cursor do atual sem trocar nenhum dos dois")]
    public async Task Keep_TheListedResult_IsStillEditable()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var first = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");
        var current = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO WHERE ID > 0", true, first);

        //Act
        var target = await service.GetEditTargetAsync(session, first, null, CancellationToken.None);
        var preview = await service.PreviewEditsAsync(session, first, [PaidOrder], CancellationToken.None);
        var saved = await service.ApplyEditsAsync(session, first, [PaidOrder], CancellationToken.None);
        var keptAfterTheSave = await service.PreviewEditsAsync(session, first, [PaidOrder], CancellationToken.None);
        var currentAfterTheSave = await service.GetEditTargetAsync(session, current, null, CancellationToken.None);

        //Assert
        Assert.True(target.IsSuccess, target.IsFailure ? target.Error.Message : null);
        Assert.True(target.Value.RowOperations);
        Assert.Equal(["UPDATE \"LOJA\".\"PEDIDO\" SET \"STATUS\" = 'paga' WHERE \"ID\" = 1"], preview.Value.Statements.Select(statement => statement.Sql));
        Assert.Equal(1, saved.Value);
        Assert.Single(_connection.Saved);
        Assert.False(_connection.HasOpenCursor);
        Assert.True(keptAfterTheSave.IsSuccess);
        Assert.True(currentAfterTheSave.IsSuccess);
    }

    /// <summary>
    /// O comando sem a lista (o Ctrl+Enter, "Executar este comando", o primeiro de outro script) esquece os guardados; o resultado que não é o
    /// atual nem um guardado responde `ResultChanged`, com o texto novo, nas três rotas, e nada vai à conexão.
    /// </summary>
    [Trait("DatabaseSessionService", "Keep")]
    [Fact(DisplayName = "Erro sem a lista, os guardados são esquecidos, e as três rotas respondem que o resultado não está mais guardado")]
    public async Task Keep_WithoutTheList_ForgetsTheKeptResults()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var first = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");
        var second = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO", false, first);
        await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");

        //Act
        var target = await service.GetEditTargetAsync(session, first, null, CancellationToken.None);
        var preview = await service.PreviewEditsAsync(session, second, [PaidOrder], CancellationToken.None);
        var saved = await service.ApplyEditsAsync(session, first, [PaidOrder], CancellationToken.None);

        //Assert
        const string Message = "O resultado não está mais guardado na sessão: outro comando foi executado nela depois dele. Execute o comando de novo para editar.";
        Assert.Equal([(EDatabaseFailure.ResultChanged, Message), (EDatabaseFailure.ResultChanged, Message), (EDatabaseFailure.ResultChanged, Message)], new[] { target.Error, preview.Error, saved.Error }.Select(failure => (failure.Kind, failure.Message)));
        Assert.Equal(0, _connection.DescribeCalls);
        Assert.Empty(_connection.Saved);
    }

    /// <summary>
    /// A lista vale entre o resultado atual e os já guardados: o atual que ela leva passa a guardado, o guardado que ela deixa de fora é
    /// esquecido, o identificador que a sessão não conhece é ignorado e o repetido conta uma vez. Vale também quando o comando falha no banco,
    /// e quando ele rodou e foi desfeito (o controle de transação com `executed`, RN-SESSAO-005): ele foi ao banco, e a sessão fica sem
    /// resultado atual. A recusa sem `executed` não muda nada (`Keep_RefusalBeforeTheDatabase_ChangesNothing`).
    /// </summary>
    [Trait("DatabaseSessionService", "Keep")]
    [Theory(DisplayName = "OK a lista guarda o atual e os guardados que leva, esquece os outros e ignora o desconhecido, também no comando que falha e no desfeito com executed")]
    [InlineData(EDatabaseFailure.ExecutionFailed, "SELECT * FROM LOJA.NADA", false)]
    [InlineData(EDatabaseFailure.TransactionControlNotSupported, "COMMIT", true)]
    public async Task Keep_AppliesToTheCurrentAndTheKept_WhenTheCommandRuns(EDatabaseFailure kind, string command, bool executed)
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var first = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");
        var second = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO", false, first);
        var third = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO", false, first, second);
        _connection.Failure = new DatabaseFailure(kind, "O banco recusou o comando.", Executed: executed);

        //Act
        var failed = await service.ExecuteAsync(session, command, null, QueryPaging.DefaultPageSize, false, [second, third, third, Guid.NewGuid()], CancellationToken.None);
        var targets = new List<Result<EditPreview, DatabaseFailure>>();
        foreach (var result in new[] { first, second, third })
            targets.Add(await service.PreviewEditsAsync(session, result, [PaidOrder], CancellationToken.None));

        //Assert
        Assert.Equal(kind, failed.Error.Kind);
        Assert.Equal([false, true, true], targets.Select(target => target.IsSuccess));
        Assert.Equal(EDatabaseFailure.ResultChanged, targets[0].Error.Kind);
    }

    /// <summary>
    /// A recusa antes de ir ao banco (o controle de transação, o filtro, a conexão somente leitura, a sessão ocupada) não muda nada: o resultado
    /// atual continua o atual, e os guardados continuam guardados, mesmo com uma lista vazia.
    /// </summary>
    [Trait("DatabaseSessionService", "Keep")]
    [Fact(DisplayName = "OK a recusa antes de ir ao banco não muda o atual nem os guardados")]
    public async Task Keep_RefusalBeforeTheDatabase_ChangesNothing()
    {
        //Arrange
        var (service, session) = await OpenAsync(EDatabaseEngine.Db2);
        var first = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO");
        var current = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO", false, first);
        _connection.Refusal = new DatabaseFailure(EDatabaseFailure.TransactionControlNotSupported, "O Prism não executa COMMIT.");

        //Act
        var refused = await service.ExecuteAsync(session, "COMMIT", null, QueryPaging.DefaultPageSize, false, [], CancellationToken.None);
        var readOnly = await service.ExecuteAsync(session, "DELETE FROM LOJA.PEDIDO", null, QueryPaging.DefaultPageSize, true, [], CancellationToken.None);
        var kept = await service.PreviewEditsAsync(session, first, [PaidOrder], CancellationToken.None);
        var stillCurrent = await service.PreviewEditsAsync(session, current, [PaidOrder], CancellationToken.None);

        //Assert
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, refused.Error.Kind);
        Assert.Equal(EDatabaseFailure.ConnectionReadOnly, readOnly.Error.Kind);
        Assert.True(kept.IsSuccess);
        Assert.True(stillCurrent.IsSuccess);
    }

    /// <summary>
    /// O guardado não leva os valores completos das células cortadas (RN-SQL-017): a rota das células responde que o resultado não existe, e a
    /// tela copia o valor cortado. O atual continua com os dele.
    /// </summary>
    [Trait("DatabaseSessionService", "Keep")]
    [Fact(DisplayName = "Erro o guardado não tem os valores completos das células cortadas")]
    public async Task Keep_TheKeptResult_HasNoFullValues()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(CutPage(1, 0, new string('a', 10001), hasMore: false), null, 0));
        _connection.Outcomes.Enqueue(new QueryOutcome(CutPage(1, 0, new string('b', 10001), hasMore: false), null, 0));
        var first = (await service.ExecuteAsync(session.ID, "SELECT id, corpo FROM documento", CancellationToken.None)).Value.Page!.ResultID!.Value;

        //Act
        var current = (await service.ExecuteAsync(session.ID, "SELECT id, corpo FROM documento", null, QueryPaging.DefaultPageSize, false, [first], CancellationToken.None)).Value.Page!.ResultID!.Value;
        var kept = service.GetCells(session.ID, first, [new CellPosition(0, 1)]);
        var ofTheCurrent = service.GetCells(session.ID, current, [new CellPosition(0, 1)]);

        //Assert
        Assert.Equal(EDatabaseFailure.ResultNotFound, kept.Error.Kind);
        Assert.Equal([new string('b', 10001)], ofTheCurrent.Value);
    }

    /// <summary>
    /// No Db2 e no Informix, o guardado com uma tabela escrita sem esquema deixa de se editar depois de um comando que pode trocar o esquema atual
    /// da sessão (`SET`, `CALL`, `EXECUTE`; no Informix também `DATABASE`): as três rotas respondem `ResultChanged` com o detalhe dele, sem
    /// consultar nada nem executar. A tabela com o esquema escrito continua se editando, e o comando que nem foi ao banco não conta.
    /// </summary>
    [Trait("DatabaseSessionService", "Keep")]
    [Theory(DisplayName = "Erro tabela sem esquema de um guardado depois de um SET, CALL, EXECUTE ou DATABASE do Informix")]
    [InlineData(EDatabaseEngine.Db2, "SET SCHEMA OUTRO")]
    [InlineData(EDatabaseEngine.Db2, "-- troca\n  set current schema = 'OUTRO'")]
    [InlineData(EDatabaseEngine.Db2, "CALL LOJA.TROCA_ESQUEMA()")]
    [InlineData(EDatabaseEngine.Informix, "EXECUTE PROCEDURE troca_dono()")]
    [InlineData(EDatabaseEngine.Informix, "DATABASE outro")]
    public async Task Keep_UnqualifiedTable_IsLockedAfterACommandThatMayChangeTheSchema(EDatabaseEngine engine, string command)
    {
        //Arrange
        var (service, session) = await OpenAsync(engine);
        var unqualified = await ReadAsync(service, session, "SELECT ID, STATUS FROM PEDIDO");
        var qualified = await ReadAsync(service, session, "SELECT ID, STATUS FROM LOJA.PEDIDO", false, unqualified);
        await RunAsync(service, session, command, unqualified, qualified);

        //Act
        var target = await service.GetEditTargetAsync(session, unqualified, null, CancellationToken.None);
        var preview = await service.PreviewEditsAsync(session, unqualified, [PaidOrder], CancellationToken.None);
        var saved = await service.ApplyEditsAsync(session, unqualified, [PaidOrder], CancellationToken.None);
        var withTheSchema = await service.PreviewEditsAsync(session, qualified, [PaidOrder], CancellationToken.None);

        //Assert
        // O nome como o banco o guarda quando é escrito sem aspas: em maiúsculas no Db2 e em minúsculas no Informix.
        var message = $"Um comando executado depois deste resultado (como um SET ou um CALL) pode ter trocado o esquema atual da sessão, e {(engine == EDatabaseEngine.Db2 ? "PEDIDO" : "pedido")}, escrita sem esquema, pode ser outra tabela agora. Nada foi gravado; escreva o esquema no comando (esquema.tabela), ou execute-o de novo.";
        Assert.Equal([(EDatabaseFailure.ResultChanged, message), (EDatabaseFailure.ResultChanged, message), (EDatabaseFailure.ResultChanged, message)], new[] { target.Error, preview.Error, saved.Error }.Select(failure => (failure.Kind, failure.Message)));
        Assert.Empty(_connection.Saved);
        Assert.False(withTheSchema.IsFailure && withTheSchema.Error.Kind == EDatabaseFailure.ResultChanged, withTheSchema.IsFailure ? withTheSchema.Error.Message : null);
    }

    /// <summary>
    /// O que não troca o esquema não tranca (`SELECT`, `UPDATE`, o `DATABASE` no Db2, que nem é comando dele); o comando recusado antes de ir ao
    /// banco também não, porque não rodou; e no PostgreSQL a contagem dos comandos não tranca nada, porque a origem das colunas é a tabela pelo
    /// identificador interno dela: quem confere se o nome sem esquema ainda leva a ela é o "Salvar", na própria sessão, dentro da transação
    /// (`AdoDatabaseConnectionTests` e, contra o banco, `DatabaseSessionEditsTests`).
    /// </summary>
    [Trait("DatabaseSessionService", "Keep")]
    [Theory(DisplayName = "OK o guardado com tabela sem esquema continua se editando depois do que não troca o esquema, e no PostgreSQL")]
    [InlineData(EDatabaseEngine.Db2, "UPDATE PEDIDO SET STATUS = 'x'")]
    [InlineData(EDatabaseEngine.Db2, "DATABASE OUTRO")]
    [InlineData(EDatabaseEngine.Informix, "SELECT * FROM pedido")]
    [InlineData(EDatabaseEngine.PostgreSql, "SET search_path TO outro")]
    public async Task Keep_UnqualifiedTable_StaysEditable_WhenNothingMayHaveChangedTheSchema(EDatabaseEngine engine, string command)
    {
        //Arrange
        var (service, session) = await OpenAsync(engine);
        var unqualified = await ReadAsync(service, session, "SELECT ID, STATUS FROM PEDIDO");
        await RunAsync(service, session, command, unqualified);
        _connection.Refusal = new DatabaseFailure(EDatabaseFailure.MultipleStatementsNotSupported, "Só um comando por execução.");
        await service.ExecuteAsync(session, "SET SCHEMA OUTRO; SELECT 1 FROM SYSIBM.SYSDUMMY1", null, QueryPaging.DefaultPageSize, false, [unqualified], CancellationToken.None);

        //Act
        var preview = await service.PreviewEditsAsync(session, unqualified, [PaidOrder], CancellationToken.None);

        //Assert
        Assert.False(preview.IsFailure && preview.Error.Kind == EDatabaseFailure.ResultChanged, preview.IsFailure ? preview.Error.Message : null);
    }

    /// <summary>O client de mentira de um banco dado, com a mesma conexão sempre (a da sessão, a do catálogo à parte).</summary>
    private sealed class EngineClient(EDatabaseEngine engine, FakeConnection connection) : IDatabaseClient
    {
        public EDatabaseEngine Engine => engine;

        public Task<Result<IDatabaseConnection, DatabaseFailure>> OpenAsync(ConnectionSettings settings, CancellationToken cancellationToken)
            => Task.FromResult(Result.Success<IDatabaseConnection, DatabaseFailure>(connection));
    }
}
