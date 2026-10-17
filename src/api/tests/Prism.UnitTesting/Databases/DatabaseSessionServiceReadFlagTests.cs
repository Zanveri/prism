using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EXPORT-001 e 002 (seção 6): a página do resultado diz se ele se exporta (`read`): o comando executado, com o filtro, é uma leitura só pela regra do
/// somente leitura (RN-PROT-005) e não gravou (não veio pelo caminho da RN-SQL-013). O "carregar mais" diz o mesmo do resultado atual. É a mesma
/// classe do `DatabaseSessionServiceTests`, em outro arquivo.
/// </summary>
public sealed partial class DatabaseSessionServiceTests
{
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK a leitura se exporta, também no carregar mais")]
    public async Task Execute_OfARead_IsRead()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: true), null, 0));

        //Act
        var executed = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", CancellationToken.None);
        var next = await service.FetchNextAsync(session.ID, CancellationToken.None);

        //Assert
        Assert.True(executed.Value.Page!.Read);
        Assert.True(next.Value.Read);
    }

    /// <summary>O comando que gravou e devolveu linhas (RN-SQL-013) traz o total: exportá-lo o executaria de novo, e ele grava.</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "Erro o comando que gravou e devolveu linhas não se exporta")]
    public async Task Execute_OfACommandThatWroteRows_IsNotRead()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: false) with { TotalRows = 1 }, null, 0));

        //Act
        var executed = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", CancellationToken.None);

        //Assert
        Assert.False(executed.Value.Page!.Read);
    }

    /// <summary>Na dúvida não é leitura: a trava de linha e a coluna `update` sem aspas também desabilitam o "Exportar…".</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Theory(DisplayName = "Erro o que não é leitura pela regra do somente leitura não se exporta")]
    [InlineData("SELECT * FROM loja.pedido FOR UPDATE")]
    [InlineData("SELECT update FROM loja.pedido")]
    [InlineData("SELECT nextval('loja.seq')")]
    public async Task Execute_OfWhatIsNotARead_IsNotRead(string sql)
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: false), null, 0));

        //Act
        var executed = await service.ExecuteAsync(session.ID, sql, CancellationToken.None);

        //Assert
        Assert.False(executed.Value.Page!.Read);
    }

    /// <summary>Quem se confere é o comando montado: o filtro que entra junto continua leitura.</summary>
    [Trait("DatabaseSessionService", "ExecuteAsync")]
    [Fact(DisplayName = "OK com filtro, o comando montado é o conferido")]
    public async Task Execute_WithAFilter_ChecksTheAssembledCommand()
    {
        //Arrange
        var service = CreateService();
        var session = await OpenAsync(service);
        _connection.Outcomes.Enqueue(new QueryOutcome(OnePage(hasMore: false), null, 0));

        //Act
        var executed = await service.ExecuteAsync(session.ID, "SELECT * FROM loja.pedido", "status = 'aberto'", QueryPaging.DefaultPageSize, CancellationToken.None);

        //Assert
        Assert.True(executed.Value.Page!.Read);
    }
}
