using Prism.Infrastructure.Databases.Clients;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-033: o alvo da edição (`edit-target`) e o "Gerar SQL" de um comando com marcadores. O leitor do comando aceita `$n` e `?` como valores no `WHERE` e nas outras
/// cláusulas sem mudar a leitura das tabelas e das colunas; o que se edita é a tabela pela chave, e os parâmetros não entram no `UPDATE` da linha.
/// </summary>
public sealed class EditableSqlParametersTests
{
    [Trait("EditableSql", "Read")]
    [Theory(DisplayName = "OK os marcadores no WHERE, no ORDER BY e nos limites não mudam a leitura da tabela nem das colunas")]
    [InlineData("PostgreSql", "SELECT id, status FROM loja.pedido WHERE status = $1 AND total > $2 ORDER BY $3 LIMIT $4 OFFSET $5")]
    [InlineData("PostgreSql", "SELECT p.id, p.status FROM loja.pedido p JOIN loja.item i ON i.pedido_id = p.id AND i.q > $1 WHERE p.status = $2")]
    [InlineData("Db2", "SELECT id, status FROM loja.pedido WHERE status = ? AND total > ? ORDER BY id FETCH FIRST ? ROWS ONLY")]
    [InlineData("Db2", "SELECT id, status FROM loja.pedido WHERE status = ? OFFSET ? ROWS FETCH FIRST ? ROWS ONLY")]
    [InlineData("Informix", "SELECT SKIP ? FIRST ? id, status FROM loja.pedido WHERE status = ?")]
    [InlineData("Informix", "SELECT id, status FROM loja.pedido WHERE status = ? ORDER BY id")]
    public void Read_ShouldSeeTheTablesAndTheColumnsWithMarkers(string dialect, string sql)
    {
        //Act
        var source = EditableSql.Read(sql, Enum.Parse<ESqlDialect>(dialect));

        //Assert
        Assert.Null(source.Reason);
        Assert.Equal("pedido", source.Tables[0].Name.Name, ignoreCase: true);
        Assert.Contains(source.Items, item => item is SelectItem.Column column && string.Equals(column.Name, "status", StringComparison.OrdinalIgnoreCase));
    }

    [Trait("EditableSql", "Read")]
    [Theory(DisplayName = "OK um marcador na lista do SELECT é uma coluna calculada, e a leitura das outras colunas segue")]
    [InlineData("PostgreSql", "SELECT $1::text AS rotulo, id, status FROM loja.pedido")]
    [InlineData("Db2", "SELECT CAST(? AS VARCHAR(10)) AS rotulo, id, status FROM loja.pedido")]
    [InlineData("Informix", "SELECT ? AS rotulo, id, status FROM loja.pedido")]
    public void Read_ShouldTreatAMarkerInTheSelectListAsComputed(string dialect, string sql)
    {
        //Act
        var source = EditableSql.Read(sql, Enum.Parse<ESqlDialect>(dialect));

        //Assert
        Assert.Null(source.Reason);
        Assert.IsType<SelectItem.Computed>(source.Items[0]);
        Assert.IsType<SelectItem.Column>(source.Items[1]);
        Assert.IsType<SelectItem.Column>(source.Items[2]);
    }
}
