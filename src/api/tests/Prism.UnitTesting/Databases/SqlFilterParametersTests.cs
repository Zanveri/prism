using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-GRADE-011 e RN-VAR-032: o filtro do resultado de um comando com parâmetros. O filtro não tem marcador, e entra depois do comando ou o embrulha, de modo que os
/// marcadores ficam na mesma ordem; quando a ordem do filtro trocaria um `ORDER BY` que tem marcador, o comando vai por fora, inteiro, com os marcadores como estavam.
/// </summary>
public sealed class SqlFilterParametersTests
{
    private static (string Sql, EFilterApplied Applied) Apply(string sql, string filter, ESqlDialect dialect)
    {
        var result = SqlFilter.Apply(sql, filter, dialect);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);

        return (result.Value.Sql, result.Value.Applied);
    }

    [Trait("SqlFilter", "Apply")]
    [Fact(DisplayName = "OK a condição do filtro entra no WHERE sem mexer na ordem dos marcadores do comando")]
    public void Apply_Condition_ShouldKeepTheMarkersInOrder()
    {
        //Act
        var postgres = Apply("SELECT * FROM t WHERE a = $1 ORDER BY b LIMIT $2", "c = 1", ESqlDialect.PostgreSql);
        var db2 = Apply("SELECT * FROM t WHERE a = ? ORDER BY b FETCH FIRST ? ROWS ONLY", "c = 1", ESqlDialect.Db2);
        var informix = Apply("SELECT FIRST ? * FROM t WHERE a = ? ORDER BY b", "c = 1 ORDER BY d", ESqlDialect.Informix);

        //Assert
        Assert.Equal(("SELECT * FROM t WHERE (a = $1) AND (c = 1) ORDER BY b LIMIT $2", EFilterApplied.Merged), postgres);
        Assert.Equal(("SELECT * FROM t WHERE (a = ?) AND (c = 1) ORDER BY b FETCH FIRST ? ROWS ONLY", EFilterApplied.Merged), db2);
        Assert.Equal(("SELECT FIRST ? * FROM t WHERE (a = ?) AND (c = 1) ORDER BY d", EFilterApplied.Merged), informix);
    }

    [Trait("SqlFilter", "Apply")]
    [Fact(DisplayName = "OK a ordem do filtro troca o ORDER BY quando ele não tem marcador, mesmo com marcador no WHERE")]
    public void Apply_Order_ShouldReplaceAnOrderByWithoutMarkers()
    {
        //Act
        var merged = Apply("SELECT * FROM t WHERE a = $1 ORDER BY b", "ORDER BY c", ESqlDialect.PostgreSql);
        var literal = Apply("SELECT * FROM t WHERE a = $1 ORDER BY '$2'", "ORDER BY c", ESqlDialect.PostgreSql);
        var jsonb = Apply("SELECT * FROM t WHERE a = $1 ORDER BY data ? 'x'", "ORDER BY c", ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal(("SELECT * FROM t WHERE a = $1 ORDER BY c", EFilterApplied.Merged), merged);
        Assert.Equal(EFilterApplied.Merged, literal.Applied);
        Assert.Equal(EFilterApplied.Merged, jsonb.Applied);
    }

    [Trait("SqlFilter", "Apply")]
    [Fact(DisplayName = "OK a ordem do filtro que trocaria um ORDER BY com marcador embrulha o comando, com os marcadores como estavam")]
    public void Apply_OrderOverAnOrderByWithAMarker_ShouldWrapTheCommand()
    {
        //Act
        var postgres = Apply("SELECT * FROM t WHERE a = $1 ORDER BY b = $2", "ORDER BY c", ESqlDialect.PostgreSql);
        var db2 = Apply("SELECT * FROM t WHERE a = ? ORDER BY CASE WHEN b = ? THEN 1 ELSE 2 END FETCH FIRST ? ROWS ONLY", "ORDER BY c", ESqlDialect.Db2);
        var informix = Apply("SELECT FIRST ? * FROM t ORDER BY b = ?", "x = 1 ORDER BY d", ESqlDialect.Informix);

        //Assert
        Assert.Equal(("SELECT * FROM (\nSELECT * FROM t WHERE a = $1 ORDER BY b = $2\n) prism_filtro\nORDER BY c", EFilterApplied.Wrapped), postgres);
        Assert.Equal(("SELECT * FROM (\nSELECT * FROM t WHERE a = ? ORDER BY CASE WHEN b = ? THEN 1 ELSE 2 END FETCH FIRST ? ROWS ONLY\n) prism_filtro\nORDER BY c", EFilterApplied.Wrapped), db2);
        Assert.Equal(("SELECT * FROM (\nSELECT FIRST ? * FROM t ORDER BY b = ?\n) prism_filtro\nWHERE x = 1\nORDER BY d", EFilterApplied.Wrapped), informix);
    }

    [Trait("SqlFilter", "Apply")]
    [Fact(DisplayName = "OK só a condição do filtro, com um ORDER BY com marcador no comando, entra no WHERE e deixa o ORDER BY")]
    public void Apply_ConditionOnly_ShouldKeepTheOrderByWithAMarker()
    {
        //Act
        var merged = Apply("SELECT * FROM t ORDER BY a = $1", "x = 1", ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal(("SELECT * FROM t WHERE (x = 1) ORDER BY a = $1", EFilterApplied.Merged), merged);
    }

    [Trait("SqlFilter", "Apply")]
    [Fact(DisplayName = "OK o comando que já ia por fora (união, GROUP BY) continua indo, com os marcadores dentro")]
    public void Apply_CommandThatWasWrapped_ShouldStayWrapped()
    {
        //Act
        var wrapped = Apply("SELECT a FROM t WHERE b = $1 GROUP BY a", "a > 1", ESqlDialect.PostgreSql);

        //Assert
        Assert.Equal(("SELECT * FROM (\nSELECT a FROM t WHERE b = $1 GROUP BY a\n) prism_filtro\nWHERE a > 1", EFilterApplied.Wrapped), wrapped);
    }
}
