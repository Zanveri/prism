using Prism.Application.DbeaverImports.Models;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>RN-DBEAVER-010: a leitura da URL JDBC de cada banco e o começo dela, o único pedaço que pode aparecer quando não casa.</summary>
public sealed class DbeaverJdbcUrlTests
{
    [Trait("DbeaverJdbcUrl", "TryParse")]
    [Theory(DisplayName = "OK o PostgreSQL: host, porta e banco, sem diferenciar maiúsculas no começo")]
    [InlineData("jdbc:postgresql://pg.exemplo.invalid:5433/pedidos?ssl=true", "pg.exemplo.invalid", "5433", "pedidos")]
    [InlineData("JDBC:POSTGRESQL://pg.exemplo.invalid/pedidos", "pg.exemplo.invalid", null, "pedidos")]
    [InlineData("jdbc:postgresql://[2001:db8::1]:5432/pedidos", "2001:db8::1", "5432", "pedidos")]
    [InlineData("jdbc:postgresql://h1.exemplo.invalid:5432,h2.exemplo.invalid:5433/pedidos", "h1.exemplo.invalid", "5432", "pedidos")]
    [InlineData("jdbc:postgresql://pg.exemplo.invalid:5432", "pg.exemplo.invalid", "5432", null)]
    [InlineData("jdbc:postgresql://pg.exemplo.invalid/?ssl=true", "pg.exemplo.invalid", null, null)]
    public void TryParse_PostgreSql(string url, string host, string? port, string? database)
    {
        //Act
        var parsed = DbeaverJdbcUrl.TryParse(EDatabaseEngine.PostgreSql, url);

        //Assert
        Assert.NotNull(parsed);
        Assert.Equal((host, port, database, (string?)null), (parsed.Host, parsed.Port, parsed.Database, parsed.Server));
    }

    [Trait("DbeaverJdbcUrl", "TryParse")]
    [Theory(DisplayName = "OK o Db2: o banco vai até as propriedades")]
    [InlineData("jdbc:db2://db2.exemplo.invalid:50001/cadastro:currentSchema=APP;", "db2.exemplo.invalid", "50001", "cadastro")]
    [InlineData("jdbc:db2://db2.exemplo.invalid/cadastro", "db2.exemplo.invalid", null, "cadastro")]
    [InlineData("jdbc:db2://db2.exemplo.invalid:50000/", "db2.exemplo.invalid", "50000", null)]
    public void TryParse_Db2(string url, string host, string? port, string? database)
    {
        //Act
        var parsed = DbeaverJdbcUrl.TryParse(EDatabaseEngine.Db2, url);

        //Assert
        Assert.NotNull(parsed);
        Assert.Equal((host, port, database), (parsed.Host, parsed.Port, parsed.Database));
    }

    [Trait("DbeaverJdbcUrl", "TryParse")]
    [Theory(DisplayName = "OK o Informix: o servidor em INFORMIXSERVER, sem diferenciar maiúsculas, e as outras propriedades nunca saem")]
    [InlineData("jdbc:informix-sqli://ifx.exemplo.invalid:55080/tramon:INFORMIXSERVER=ifx_dev_tcp", "55080", "tramon", "ifx_dev_tcp")]
    [InlineData("jdbc:informix-sqli://ifx.exemplo.invalid:55080/:INFORMIXSERVER=ifx_dev_tcp", "55080", null, "ifx_dev_tcp")]
    [InlineData("jdbc:informix-sqli://ifx.exemplo.invalid:55080/estoque:informixserver=ifx_hml_tcp;user=fulano;password=senha-inventada-na-url", "55080", "estoque", "ifx_hml_tcp")]
    [InlineData("jdbc:informix-sqli://ifx.exemplo.invalid:55080/estoque;INFORMIXSERVER=ifx_hml_tcp;DELIMIDENT=y", "55080", "estoque", "ifx_hml_tcp")]
    [InlineData("jdbc:informix-sqli://ifx.exemplo.invalid:55080/estoque", "55080", "estoque", null)]
    [InlineData("jdbc:informix-sqli://ifx.exemplo.invalid/estoque:INFORMIXSERVER=x", null, "estoque", "x")]
    public void TryParse_Informix(string url, string? port, string? database, string? server)
    {
        //Act
        var parsed = DbeaverJdbcUrl.TryParse(EDatabaseEngine.Informix, url);

        //Assert
        Assert.NotNull(parsed);
        Assert.Equal(("ifx.exemplo.invalid", port, database, server), (parsed.Host, parsed.Port, parsed.Database, parsed.Server));
        Assert.DoesNotContain("senha-inventada", parsed.ToString());
    }

    [Trait("DbeaverJdbcUrl", "TryParse")]
    [Theory(DisplayName = "ERRO a URL que não casa não é adivinhada")]
    [InlineData(EDatabaseEngine.PostgreSql, "jdbc:postgresql://usuario:senha@pg.exemplo.invalid/pedidos")]
    [InlineData(EDatabaseEngine.PostgreSql, "jdbc:postgresql:pedidos")]
    [InlineData(EDatabaseEngine.PostgreSql, "jdbc:postgresql://:5432/pedidos")]
    [InlineData(EDatabaseEngine.PostgreSql, "jdbc:postgresql://pg.exemplo.invalid:abc/pedidos")]
    [InlineData(EDatabaseEngine.PostgreSql, "jdbc:mysql://pg.exemplo.invalid/pedidos")]
    [InlineData(EDatabaseEngine.Db2, "jdbc:db2://db2.exemplo.invalid:50000")]
    [InlineData(EDatabaseEngine.Informix, "jdbc:informix-sqli:INFORMIXSERVER=x;password=segredo-inventado-123")]
    [InlineData(EDatabaseEngine.Informix, "jdbc:postgresql://pg.exemplo.invalid/pedidos")]
    public void TryParse_DoesNotMatch(EDatabaseEngine engine, string url)
        => Assert.Null(DbeaverJdbcUrl.TryParse(engine, url));

    [Trait("DbeaverJdbcUrl", "Beginning")]
    [Theory(DisplayName = "OK o começo da URL: até antes do primeiro / ? ; ou , depois do //, e só o esquema com um @ ou sem //")]
    [InlineData("jdbc:informix-sqli://ifx-dev.exemplo.invalid:55080/tramon:INFORMIXSERVER=a;password=segredo-inventado-1", "jdbc:informix-sqli://ifx-dev.exemplo.invalid:55080/…")]
    [InlineData("jdbc:postgresql://pg.exemplo.invalid:5432?user=fulano&password=segredo-inventado-2", "jdbc:postgresql://pg.exemplo.invalid:5432…")]
    [InlineData("jdbc:db2://db2.exemplo.invalid:50000;user=fulano;password=segredo-inventado-3", "jdbc:db2://db2.exemplo.invalid:50000…")]
    [InlineData("jdbc:postgresql://h1.exemplo.invalid:5432,h2.exemplo.invalid:5433", "jdbc:postgresql://h1.exemplo.invalid:5432…")]
    [InlineData("jdbc:postgresql://usuario:segredo-inventado-4@pg.exemplo.invalid/pedidos", "jdbc:postgresql:…")]
    [InlineData("jdbc:informix-sqli:INFORMIXSERVER=x;password=segredo-inventado-5", "jdbc:informix-sqli:…")]
    [InlineData("jdbc:postgresql://admin:segredo-inventado-8/ret@pg.exemplo.invalid/pedidos", "jdbc:postgresql:…")]
    [InlineData("jdbc:postgresql://admin:segredo-inventado-9?x@pg.exemplo.invalid/pedidos", "jdbc:postgresql:…")]
    [InlineData("jdbc:db2://admin:segredo-inventado-10;x@db2.exemplo.invalid:50000/BD", "jdbc:db2:…")]
    [InlineData("jdbc:postgresql://admin:segredo-inventado-11,x@pg.exemplo.invalid/pedidos", "jdbc:postgresql:…")]
    [InlineData("jdbc:postgresql://admin:segredo-inventado-12/pedidos", "jdbc:postgresql:…")]
    [InlineData("jdbc:postgresql://admin:segredo-inventado-13:5432/pedidos", "jdbc:postgresql:…")]
    [InlineData("jdbc:postgresql://[2001:db8::1]:5432/pedidos", "jdbc:postgresql://[2001:db8::1]:5432/…")]
    [InlineData("jdbc:postgresql://pg.exemplo.invalid:5432", "jdbc:postgresql://pg.exemplo.invalid:5432")]
    public void Beginning_NeverShowsWhatComesAfterTheCut(string url, string expected)
    {
        //Act
        var beginning = DbeaverJdbcUrl.Beginning(url);

        //Assert
        Assert.Equal(expected, beginning);
        Assert.DoesNotContain("segredo-inventado", beginning);
    }

    [Trait("DbeaverJdbcUrl", "Beginning")]
    [Theory(DisplayName = "OK sem esquema reconhecível nada aparece, e o começo tem no máximo 200 caracteres")]
    [InlineData("texto qualquer com segredo-inventado-6")]
    [InlineData("")]
    [InlineData("user:segredo-inventado-7//host")]
    public void Beginning_WithoutAScheme_IsEmpty(string url)
        => Assert.Equal(string.Empty, DbeaverJdbcUrl.Beginning(url));

    [Trait("DbeaverJdbcUrl", "Beginning")]
    [Fact(DisplayName = "OK o endereço muito longo é cortado em 200 caracteres")]
    public void Beginning_CutsAtTwoHundred()
        => Assert.True(DbeaverJdbcUrl.Beginning($"jdbc:postgresql://{new string('a', 500)}/pedidos").Length <= 200);
}
