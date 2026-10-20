using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EXPORT-002 e 016: exportar executa o comando de novo, e só vale para uma leitura só, pela lista do somente leitura (RN-PROT-005). O envio
/// com mais de um comando é a recusa própria (`MULTIPLE_STATEMENTS_NOT_SUPPORTED`), que vem antes da de leitura.
/// </summary>
public sealed class ReadOnlySqlExportTests
{
    [Trait("ReadOnlySql", "ExportRefusal")]
    [Theory(DisplayName = "OK uma leitura só se exporta nos três bancos")]
    [InlineData("SELECT * FROM loja.pedido")]
    [InlineData("SELECT 1;")]
    [InlineData("WITH abertos AS (SELECT * FROM loja.pedido) SELECT * FROM abertos")]
    [InlineData("SELECT ';' AS separador FROM loja.pedido -- ; no comentário")]
    public void ExportRefusal_ShouldBeNull_ForASingleRead(string sql)
        => Assert.All(Enum.GetValues<EDatabaseEngine>(), engine => Assert.Null(ReadOnlySql.ExportRefusal(sql, engine)));

    [Trait("ReadOnlySql", "ExportRefusal")]
    [Theory(DisplayName = "Erro o que grava, ou pode gravar, e mais de um comando não se exportam")]
    [InlineData("DELETE FROM loja.pedido", "um DELETE não é leitura")]
    [InlineData("SELECT * FROM loja.pedido FOR UPDATE", "a trava de linha (FOR UPDATE, FOR SHARE) é para alterar as linhas")]
    [InlineData("SELECT update FROM loja.pedido", "o comando tem um UPDATE, que grava")]
    [InlineData("SELECT 1; SELECT 2", "o texto tem mais de um comando")]
    public void ExportRefusal_ShouldSayWhy(string sql, string reason)
        => Assert.All(Enum.GetValues<EDatabaseEngine>(), engine => Assert.Equal(reason, ReadOnlySql.ExportRefusal(sql, engine)));

    [Trait("ReadOnlySql", "HasSeveralStatements")]
    [Theory(DisplayName = "OK mais de um comando é dito pelos ; do nível de código, sem os soltos das pontas")]
    [InlineData("SELECT 1", false)]
    [InlineData(";; SELECT 1 ;;", false)]
    [InlineData("SELECT ';' FROM loja.pedido", false)]
    [InlineData("SELECT 1 /* ; */", false)]
    [InlineData("SELECT 1; SELECT 2", true)]
    [InlineData("SELECT 1; DELETE FROM loja.pedido", true)]
    public void HasSeveralStatements_ShouldCountTheStatements(string sql, bool several)
        => Assert.All(Enum.GetValues<EDatabaseEngine>(), engine => Assert.Equal(several, ReadOnlySql.HasSeveralStatements(sql, engine)));

    /// <summary>No Db2 o driver encerra o comentário de bloco no primeiro `*/`: o `;` que só ele vê dentro de um comentário aninhado também conta.</summary>
    [Trait("ReadOnlySql", "HasSeveralStatements")]
    [Fact(DisplayName = "OK no Db2 basta uma das duas leituras do comentário ver o segundo comando")]
    public void HasSeveralStatements_InDb2_ShouldReadTheCommentAsTheDriver()
    {
        //Arrange
        const string sql = "SELECT 1 /* a /* b */ ; DELETE FROM loja.pedido */";

        //Act
        var db2 = ReadOnlySql.HasSeveralStatements(sql, EDatabaseEngine.Db2);

        //Assert
        Assert.True(db2);
    }
}
