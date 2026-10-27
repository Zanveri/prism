using CSharpFunctionalExtensions;
using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Extensions;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O catálogo estendido (RN-CAT-001 a 010) contra o banco de verdade, pelo client que o `AddInfrastructure` registra. Cada banco monta
/// no começo um esquema só dele (no Informix, um dono), com nome sorteado, com o que os testes leem, e o apaga no fim: os textos que o
/// catálogo devolve mudam de um banco para outro, e cada classe afirma o texto exato do seu, que é o que a tela vai mostrar.
/// </summary>
public abstract class CatalogContractTests
{
    private ServiceProvider _provider = null!;

    protected abstract EDatabaseEngine Engine { get; }

    protected IDatabaseClient Client { get; private set; } = null!;

    protected ConnectionSettings Settings { get; private set; } = null!;

    /// <summary>O esquema (no Informix, o dono) que a classe monta, como o banco o guarda.</summary>
    protected abstract string Schema { get; }

    /// <summary>Os comandos que montam o esquema do teste, um por envio, na ordem.</summary>
    protected abstract IEnumerable<string> Setup { get; }

    /// <summary>Os comandos que apagam o que <see cref="Setup"/> criou. Um que falhe não impede os seguintes.</summary>
    protected abstract IEnumerable<string> Teardown { get; }

    protected abstract Task<ConnectionSettings> StartDatabaseAsync();

    /// <summary>O que o banco precisa além do `AddInfrastructure`. O Db2 e o Informix apontam a pasta de drivers para a do driver instalado.</summary>
    protected virtual Task ConfigureAsync(IServiceCollection services)
        => Task.CompletedTask;

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        Settings = await StartDatabaseAsync();

        // A pasta de dados é do cofre, que estes testes não abrem: nada é gravado nela.
        var services = new ServiceCollection().AddInfrastructure(Path.Combine(Path.GetTempPath(), "prism-tests-sem-cofre"));
        await ConfigureAsync(services);
        _provider = services.BuildServiceProvider();
        Client = _provider.GetServices<IDatabaseClient>().Single(client => client.Engine == Engine);

        await using var connection = await OpenAsync();
        await RunAsync(connection, [.. Setup]);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await using (var connection = await OpenAsync())
        {
            foreach (var sql in Teardown)
                await connection.ExecuteAsync(sql, CancellationToken.None);
        }

        await _provider.DisposeAsync();
    }

    protected async Task<IDatabaseConnection> OpenAsync(ConnectionSettings? settings = null)
    {
        var opened = await Client.OpenAsync(settings ?? Settings, CancellationToken.None);
        Assert.That(opened.IsSuccess, Is.True, opened.IsFailure ? opened.Error.Message : null);

        return opened.Value;
    }

    /// <summary>Executa os comandos de arranjo, um por envio, e para no primeiro que o banco recusar, com a mensagem dele.</summary>
    protected static async Task RunAsync(IDatabaseConnection connection, params string[] commands)
    {
        foreach (var sql in commands)
        {
            var outcome = await connection.ExecuteAsync(sql, CancellationToken.None);
            Assert.That(outcome.IsSuccess, Is.True, outcome.IsFailure ? $"{sql}\n{outcome.Error.Message}" : null);
        }
    }

    /// <summary>O sucesso de uma consulta de catálogo, ou a falha do teste com a mensagem do banco.</summary>
    protected static T Value<T>(Result<T, DatabaseFailure> result)
    {
        Assert.That(result.IsSuccess, Is.True, result.IsFailure ? result.Error.Message : null);

        return result.Value;
    }

    /// <summary>
    /// RN-CAT-010: as contagens de cada esquema são as das listas de objetos dele, numa consulta só. Confere o esquema do teste e um de
    /// sistema, que tem centenas de objetos.
    /// </summary>
    [Test]
    public async Task Schemas_CountWhatTheObjectListsShow()
    {
        await using var connection = await OpenAsync();

        var schemas = Value(await connection.GetSchemasAsync(CancellationToken.None));

        foreach (var schema in new[] { schemas.Single(item => item.Name == Schema), schemas.First(item => item.IsSystem) })
        {
            var tables = Value(await connection.GetObjectsAsync(schema.Name, "tables", CancellationToken.None));
            var views = Value(await connection.GetObjectsAsync(schema.Name, "views", CancellationToken.None));
            var routines = Value(await connection.GetObjectsAsync(schema.Name, "routines", CancellationToken.None));

            Assert.That((schema.Tables, schema.Views, schema.Routines), Is.EqualTo((tables.Count, views.Count, routines.Count)), schema.Name);
        }

        Assert.That(schemas.Single(item => item.Name == Schema).Tables, Is.GreaterThan(0));
    }

    /// <summary>
    /// RN-BUSCA-002: o índice de nomes é o que as listas de objetos mostram. Em cada esquema (o do teste e um de sistema, que tem centenas de
    /// objetos), as tabelas do índice são as de `objects?kind=tables` e as visões as de `objects?kind=views`, os mesmos nomes na mesma ordem,
    /// e as rotinas ficam de fora. É o que garante que a linha que a tela monta do índice é a que a árvore carregaria. Os esquemas vêm com
    /// os comuns antes dos de sistema, e só os que têm tabela ou visão.
    /// </summary>
    [Test]
    public async Task ObjectNames_AreWhatTheObjectListsShow()
    {
        await using var connection = await OpenAsync();

        var names = Value(await connection.GetObjectNamesAsync(1_000_000, CancellationToken.None));
        var schemas = Value(await connection.GetSchemasAsync(CancellationToken.None));

        Assert.That(names.Truncated, Is.False);
        Assert.That(names.Schemas.Select(schema => schema.IsSystem), Is.Ordered);
        Assert.That(names.Schemas.Select(schema => schema.Tables.Count + schema.Views.Count), Is.All.GreaterThan(0));

        foreach (var schema in new[] { schemas.Single(item => item.Name == Schema), schemas.First(item => item.IsSystem && item.Tables + item.Views > 0) })
        {
            var tables = Value(await connection.GetObjectsAsync(schema.Name, "tables", CancellationToken.None));
            var views = Value(await connection.GetObjectsAsync(schema.Name, "views", CancellationToken.None));
            var indexed = names.Schemas.Single(item => item.Name == schema.Name);

            Assert.That(indexed.IsSystem, Is.EqualTo(schema.IsSystem), schema.Name);
            Assert.That(indexed.Tables, Is.EqualTo(tables.Select(table => table.Name)), schema.Name);
            Assert.That(indexed.Views, Is.EqualTo(views.Select(view => view.Name)), schema.Name);
        }

        Assert.That(names.Schemas.Single(item => item.Name == Schema).Tables, Is.Not.Empty);
    }

    /// <summary>
    /// RN-BUSCA-002: com um limite pequeno o banco é cortado (`Truncated`), e a resposta traz exatamente `limit` nomes, os dos primeiros
    /// esquemas; sem corte, o limite folgado não liga nada. A consulta lê um nome a mais que o limite só para saber que há mais.
    /// </summary>
    [Test]
    public async Task ObjectNames_WithASmallLimit_AreTruncated()
    {
        await using var connection = await OpenAsync();

        var cut = Value(await connection.GetObjectNamesAsync(3, CancellationToken.None));
        var whole = Value(await connection.GetObjectNamesAsync(1_000_000, CancellationToken.None));

        Assert.That(cut.Truncated, Is.True);
        Assert.That(cut.Schemas.Sum(schema => schema.Tables.Count + schema.Views.Count), Is.EqualTo(3));
        Assert.That(whole.Truncated, Is.False);
        Assert.That(whole.Schemas.Sum(schema => schema.Tables.Count + schema.Views.Count), Is.GreaterThan(3));
    }

    /// <summary>
    /// RN-BUSCA-002: o índice de um esquema de 300 tabelas, que a classe do banco monta e apaga (o mesmo do diagrama). A prova do custo é o
    /// tempo da chamada e o tamanho do JSON, escritos na saída do teste (o relatório os leva): uma varredura do catálogo.
    /// </summary>
    [Test]
    public async Task ObjectNames_OfASchemaWith300Tables_ComeInOneCall()
    {
        var schema = await CreateLargeSchemaAsync();
        try
        {
            await using var connection = await OpenAsync();
            var watch = Stopwatch.StartNew();
            var names = Value(await connection.GetObjectNamesAsync(50_000, CancellationToken.None));
            watch.Stop();
            var json = JsonSerializer.Serialize(names, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            var total = names.Schemas.Sum(item => item.Tables.Count + item.Views.Count);
            await TestContext.Out.WriteLineAsync($"{Engine}: índice de nomes de {total} tabelas e visões em {names.Schemas.Count} esquemas em {watch.ElapsedMilliseconds} ms, {json.Length} caracteres de JSON ({Encoding.UTF8.GetByteCount(json)} bytes).");

            var large = names.Schemas.Single(item => item.Name == schema);
            Assert.That(large.Tables, Has.Count.EqualTo(300));
            Assert.That(large.Views, Is.Empty);
            Assert.That(large.Tables, Is.EquivalentTo(Enumerable.Range(1, 300).Select(number => TableNameOf(number))));
            Assert.That(names.Truncated, Is.False);
        }
        finally
        {
            await DropLargeSchemaAsync(schema);
        }
    }

    /// <summary>O nome da tabela de número dado do esquema grande (`t1` a `t300`), como o banco o guarda: maiúsculas no Db2.</summary>
    protected virtual string TableNameOf(int number)
        => $"t{number}";

    /// <summary>A tabela que não existe responde lista vazia, como as consultas de colunas, índices e chaves sempre responderam.</summary>
    [Test]
    public async Task Catalog_OfUnknownTable_ReturnsEmpty()
    {
        await using var connection = await OpenAsync();

        var columns = Value(await connection.GetColumnsAsync(Schema, "nao_existe", CancellationToken.None));
        var indexes = Value(await connection.GetIndexesAsync(Schema, "nao_existe", CancellationToken.None));
        var foreignKeys = Value(await connection.GetForeignKeysAsync(Schema, "nao_existe", CancellationToken.None));
        var referencedBy = Value(await connection.GetReferencingForeignKeysAsync(Schema, "nao_existe", CancellationToken.None));
        var checks = Value(await connection.GetChecksAsync(Schema, "nao_existe", CancellationToken.None));
        var view = Value(await connection.GetViewDefinitionAsync(Schema, "nao_existe", CancellationToken.None));
        var diagram = Value(await connection.GetDiagramAsync("nao_existe", CancellationToken.None));

        Assert.That(columns, Is.Empty);
        Assert.That(indexes, Is.Empty);
        Assert.That(foreignKeys, Is.Empty);
        Assert.That(referencedBy, Is.Empty);
        Assert.That(checks, Is.Empty);
        Assert.That(view.Definition, Is.Null);
        Assert.That(diagram.Tables, Is.Empty);
        Assert.That(diagram.ForeignKeys, Is.Empty);
    }

    /// <summary>
    /// RN-CAT-008: o diagrama de um esquema de 300 tabelas e 400 chaves estrangeiras, que a classe do banco monta pelo próprio banco e
    /// apaga. A prova do custo é o tempo da chamada e o tamanho do JSON, escritos na saída do teste (o relatório os leva): duas
    /// consultas para o esquema inteiro.
    /// </summary>
    [Test]
    public async Task Diagram_OfASchemaWith300TablesAnd400ForeignKeys_ComesInOneCall()
    {
        var schema = await CreateLargeSchemaAsync();
        try
        {
            await using var connection = await OpenAsync();
            var watch = Stopwatch.StartNew();
            var diagram = Value(await connection.GetDiagramAsync(schema, CancellationToken.None));
            watch.Stop();
            var json = JsonSerializer.Serialize(diagram, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            await TestContext.Out.WriteLineAsync($"{Engine}: diagrama de {diagram.Tables.Count} tabelas e {diagram.ForeignKeys.Count} chaves em {watch.ElapsedMilliseconds} ms, {json.Length} caracteres de JSON ({Encoding.UTF8.GetByteCount(json)} bytes).");

            Assert.That(diagram.Tables, Has.Count.EqualTo(300));
            Assert.That(diagram.Tables.Select(table => table.Columns.Count), Is.All.EqualTo(4));
            Assert.That(diagram.ForeignKeys, Has.Count.EqualTo(400));
        }
        finally
        {
            await DropLargeSchemaAsync(schema);
        }
    }

    /// <summary>Monta o esquema de 300 tabelas (`t1` a `t300`, cada uma com `id` na chave primária, `nome`, `ref_a` e `ref_b`) e 400 chaves: `ref_a` de cada uma para a anterior (299) e `ref_b` da 101 à 201 para a de cem antes (101). Devolve o esquema como o banco o guarda.</summary>
    protected abstract Task<string> CreateLargeSchemaAsync();

    protected abstract Task DropLargeSchemaAsync(string schema);
}
