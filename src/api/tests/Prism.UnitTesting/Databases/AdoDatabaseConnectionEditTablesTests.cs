using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Serilog;
using Serilog.Core;
using System.Data.Common;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-EDIT-003 e RN-SQL-024: o catálogo da edição num banco que diz de que tabela vem cada coluna pelo identificador dela, como o PostgreSQL, na
/// base, sobre o driver de mentira. É a mesma classe do `AdoDatabaseConnectionTests`, em outro arquivo, para dividir o driver de mentira.
/// </summary>
public sealed partial class AdoDatabaseConnectionTests
{
    private const string RelationByIdQuery = "EDIT RELATION BY ID";
    private const string RelationByNameQuery = "EDIT RELATION";

    /// <summary>
    /// No PostgreSQL a tabela do `FROM` escrita sem esquema é a que a resposta do comando diz, pelo identificador. No "Salvar", na própria sessão,
    /// o nome tem de levar AGORA à mesma tabela pelo caminho de busca dela: se leva a outra (um `SET search_path` depois de um resultado
    /// guardado), ou a nenhuma, ela vem como `elsewhere`, e as colunas dela ficam só leitura. Fora da sessão (o catálogo do `edit-target`, na
    /// sessão da árvore ou numa conexão à parte) o caminho de busca é outro, e o nome nem é consultado.
    /// </summary>
    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Theory(DisplayName = "OK no Salvar, a tabela sem esquema a que o nome não leva mais na sessão vem como elsewhere")]
    [InlineData(1000L, "table")]
    [InlineData(2000L, EditCatalogTable.Elsewhere)]
    [InlineData(null, EditCatalogTable.Elsewhere)]
    public async Task ApplyEdits_ShouldMarkTheUnqualifiedTable_WhenItsNameNowLeadsElsewhere(long? now, string kind)
    {
        //Arrange
        _catalog[RelationByIdQuery] = [["loja", "pedido", "table", 1000L, false]];
        _catalog[RelationByNameQuery] = now is null ? [] : [["outro", "pedido", "table", now, false]];
        _catalog["COLUMNS"] = [];
        _catalog["EDIT KEYS"] = [];
        var connection = (await new ByIdEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None).OpenAsync(CancellationToken.None)).Value;
        var tables = new EditTables([new EditTableName(null, "pedido", "\"pedido\"")], [1000L]);
        IReadOnlyList<EditCatalogTable?>? described = null;

        //Act
        var outside = await connection.DescribeEditTablesAsync(tables, CancellationToken.None);
        var sentOutside = _sent.ToList();
        await connection.ApplyEditsAsync(tables, oneAtATime: true, wholeColumn: false, catalogs =>
        {
            described = catalogs;

            return Result.Failure<EditPlan, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.EditInvalid, "nada a gravar"));
        }, CancellationToken.None);

        //Assert
        Assert.Equal(("loja", 1000L, "table"), (outside.Value[0]!.Schema, outside.Value[0]!.Id, outside.Value[0]!.Kind));
        Assert.DoesNotContain(RelationByNameQuery, sentOutside);
        Assert.Equal(("loja", 1000L, kind), (described![0]!.Schema, described[0]!.Id, described[0]!.Kind));
    }

    /// <summary>A tabela com o esquema escrito não depende do caminho de busca: no "Salvar" o nome não é consultado.</summary>
    [Trait("AdoDatabaseConnection", "ApplyEditsAsync")]
    [Fact(DisplayName = "OK no Salvar, a tabela com o esquema escrito não confere o nome")]
    public async Task ApplyEdits_ShouldNotCheckTheName_OfAQualifiedTable()
    {
        //Arrange
        _catalog[RelationByIdQuery] = [["loja", "pedido", "table", 1000L, false]];
        _catalog["COLUMNS"] = [];
        _catalog["EDIT KEYS"] = [];
        var connection = (await new ByIdEngineConnection(_driver.Object, BeginProbe, () => _probeRoundTrip(), Logger.None).OpenAsync(CancellationToken.None)).Value;
        IReadOnlyList<EditCatalogTable?>? described = null;

        //Act
        await connection.ApplyEditsAsync(new EditTables([new EditTableName("loja", "pedido", "\"loja\".\"pedido\"")], [1000L]), oneAtATime: true, wholeColumn: false, catalogs =>
        {
            described = catalogs;

            return Result.Failure<EditPlan, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.EditInvalid, "nada a gravar"));
        }, CancellationToken.None);

        //Assert
        Assert.Equal("table", described![0]!.Kind);
        Assert.DoesNotContain(RelationByNameQuery, _sent);
    }

    /// <summary>Um banco que diz de que tabela vem cada coluna pelo identificador dela, como o PostgreSQL.</summary>
    private sealed class ByIdEngineConnection(DbConnection driver, Func<Exception?> beginProbe, Func<Exception?> probeRoundTrip, ILogger logger) : FakeEngineConnection(driver, beginProbe, probeRoundTrip, logger)
    {
        protected override (string Sql, IReadOnlyList<object> Parameters) EditRelationQuery(EditTableName table)
            => (RelationByNameQuery, [table.Written]);

        protected override (string Sql, IReadOnlyList<object> Parameters)? EditRelationByIdQuery(long id)
            => (RelationByIdQuery, [id]);
    }
}
