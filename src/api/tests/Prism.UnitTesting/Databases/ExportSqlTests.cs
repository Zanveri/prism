using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EXPORT-002 e 016: o comando que a exportação executa, montado e conferido sem ir ao banco. A tabela vira o `SELECT` das colunas marcadas com os nomes
/// entre aspas; o resultado leva o filtro como no `queries`. Mais de um comando, o filtro que não se junta e o que não é leitura são recusados, nessa ordem.
/// </summary>
public sealed class ExportSqlTests
{
    [Trait("ExportSql", "Table")]
    [Fact(DisplayName = "OK a tabela vira o SELECT das colunas marcadas, na ordem dada, com as aspas dobradas")]
    public void Table_ShouldQuoteEveryName()
        => Assert.Equal("SELECT \"id\", \"cli\"\"ente\" FROM \"esto que\".\"Pedido\"", ExportSql.Table("esto que", "Pedido", ["id", "cli\"ente"]));

    [Trait("ExportSql", "Query")]
    [Theory(DisplayName = "OK o comando de leitura vai como veio, ou com o filtro junto")]
    [InlineData("SELECT * FROM loja.pedido", null, "SELECT * FROM loja.pedido")]
    [InlineData("SELECT * FROM loja.pedido", "  ", "SELECT * FROM loja.pedido")]
    [InlineData("SELECT * FROM loja.pedido;", null, "SELECT * FROM loja.pedido;")]
    [InlineData("SELECT * FROM loja.pedido", "status = 'aberto' ORDER BY total", "SELECT * FROM loja.pedido WHERE (status = 'aberto') ORDER BY total")]
    [InlineData("WITH a AS (SELECT 1 AS id) SELECT * FROM a", null, "WITH a AS (SELECT 1 AS id) SELECT * FROM a")]
    public void Query_Read_ShouldReturnTheCommand(string sql, string? filter, string expected)
    {
        //Act
        var result = ExportSql.Query(sql, filter, EDatabaseEngine.PostgreSql);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(expected, result.Value);
    }

    [Trait("ExportSql", "Query")]
    [Theory(DisplayName = "Erro mais de um comando, o filtro que não se junta, e o que não é leitura")]
    [InlineData("SELECT 1; SELECT 2", null, EDatabaseEngine.PostgreSql, EExportSqlRefusal.MultipleStatements)]
    [InlineData("SELECT 1; DELETE FROM loja.pedido", "a = 1", EDatabaseEngine.PostgreSql, EExportSqlRefusal.MultipleStatements)]
    [InlineData("SELECT * FROM loja.pedido", "a = 1; DROP TABLE loja.pedido", EDatabaseEngine.PostgreSql, EExportSqlRefusal.FilterInvalid)]
    [InlineData("DELETE FROM loja.pedido", null, EDatabaseEngine.PostgreSql, EExportSqlRefusal.NotRead)]
    [InlineData("UPDATE loja.pedido SET a = 1 RETURNING *", null, EDatabaseEngine.PostgreSql, EExportSqlRefusal.NotRead)]
    [InlineData("SELECT * FROM loja.pedido FOR UPDATE", null, EDatabaseEngine.PostgreSql, EExportSqlRefusal.NotRead)]
    [InlineData("SELECT nextval('loja.seq')", null, EDatabaseEngine.PostgreSql, EExportSqlRefusal.NotRead)]
    [InlineData("SELECT * FROM loja.pedido FOR UPDATE", null, EDatabaseEngine.Informix, EExportSqlRefusal.NotRead)]
    [InlineData("SELECT * FROM loja.pedido FOR UPDATE WITH RS", null, EDatabaseEngine.Db2, EExportSqlRefusal.NotRead)]
    public void Query_Refused_ShouldSayWhy(string sql, string? filter, EDatabaseEngine engine, EExportSqlRefusal kind)
    {
        //Act
        var result = ExportSql.Query(sql, filter, engine);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(kind, result.Error.Kind);
        Assert.False(string.IsNullOrWhiteSpace(result.Error.Reason));
    }

    /// <summary>RN-VAR-032 e RN-GRADE-011: com `params`, o filtro do resultado não tem marcador, como no `queries`; sem `params`, o `?` e o `$1` do filtro são texto do banco.</summary>
    [Trait("ExportSql", "Query")]
    [Theory(DisplayName = "Erro com params o filtro com marcador de parâmetro é FILTER_INVALID, nos três bancos")]
    [InlineData(EDatabaseEngine.PostgreSql, "SELECT * FROM loja.pedido WHERE a = $1 ORDER BY c", "b = $2")]
    [InlineData(EDatabaseEngine.Db2, "SELECT * FROM loja.pedido WHERE a = ? ORDER BY c", "b = ?")]
    [InlineData(EDatabaseEngine.Informix, "SELECT * FROM loja.pedido WHERE a = ?", "b = ?")]
    public void Query_FilterWithMarkerAndParameters_ShouldBeRefused(EDatabaseEngine engine, string sql, string filter)
    {
        //Act
        var result = ExportSql.Query(sql, filter, engine, hasParameters: true);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal((EExportSqlRefusal.FilterInvalid, QueryParameterRules.FilterMarker), (result.Error.Kind, result.Error.Reason));
    }

    [Trait("ExportSql", "Query")]
    [Theory(DisplayName = "OK com params o filtro sem marcador entra, e sem params o marcador do filtro não é recusado aqui")]
    [InlineData(EDatabaseEngine.PostgreSql, "SELECT * FROM loja.pedido WHERE a = $1", "b = 'x?$2'", true)]
    [InlineData(EDatabaseEngine.Db2, "SELECT * FROM loja.pedido WHERE a = ?", "b = 2", true)]
    [InlineData(EDatabaseEngine.Db2, "SELECT * FROM loja.pedido", "b = ?", false)]
    public void Query_FilterWithoutMarkerOrWithoutParameters_ShouldJoinTheFilter(EDatabaseEngine engine, string sql, string filter, bool hasParameters)
    {
        //Act
        var result = ExportSql.Query(sql, filter, engine, hasParameters);

        //Assert
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Reason : null);
        Assert.Contains(filter, result.Value, StringComparison.Ordinal);
    }
}
