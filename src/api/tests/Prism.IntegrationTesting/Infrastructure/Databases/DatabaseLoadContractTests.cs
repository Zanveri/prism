using CSharpFunctionalExtensions;
using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure;
using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;
using Prism.TestingCore.Extensions;
using System.Data;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// RN-IMPORT-015 e 016 contra o banco de verdade, pela conexão à parte do carregador (`BeginLoadAsync`, `BeginLoadTransactionAsync`, `EmptyTableAsync`,
/// `InsertRowsAsync`, `CommitLoadAsync`): os comandos de várias linhas com parâmetros (no PostgreSQL, o lote de comandos de uma linha; no Db2, o `INSERT …
/// VALUES` de até 500 linhas; no Informix, uma linha por comando), também com texto longo e binário; a linha recusada dentro do comando, que o lote do
/// PostgreSQL diz e que o Db2 acha voltando linha por linha; e a transação desfeita na recusa, com o esvaziamento junto. Os valores passam pela conversão da
/// importação (`ImportValues.Convert`, com as colunas lidas do catálogo), como no trabalho. Cada banco monta um esquema só dele (no Informix, um dono, com o
/// nome da tabela sorteado) e o apaga no fim.
/// </summary>
public abstract class DatabaseLoadContractTests
{
    private ServiceProvider _provider = null!;
    private IDatabaseClient _client = null!;

    protected ConnectionSettings Settings { get; private set; } = null!;

    protected abstract EDatabaseEngine Engine { get; }

    /// <summary>O esquema (no Informix, o dono), como o banco o guarda.</summary>
    protected abstract string Schema { get; }

    /// <summary>A tabela do teste, como o banco a guarda.</summary>
    protected abstract string Table { get; }

    /// <summary>
    /// Os comandos que criam a tabela `carga` (`id` inteiro e chave, `nome` texto curto, `texto` texto longo, `anexo` binário), na ordem do mapeamento, e o
    /// que ela precisar antes.
    /// </summary>
    protected abstract IEnumerable<string> Setup { get; }

    protected abstract IEnumerable<string> Teardown { get; }

    /// <summary>O tamanho do texto longo que vai num valor: 40.000 caracteres onde a coluna guarda mais que um `VARCHAR`; no Informix, o que cabe no `LVARCHAR` da linha.</summary>
    protected virtual int LongTextLength => 40_000;

    protected abstract Task<ConnectionSettings> StartDatabaseAsync();

    protected virtual Task ConfigureAsync(IServiceCollection services)
        => Task.CompletedTask;

    /// <summary>O nome de coluna como o banco o guarda quando é escrito sem aspas.</summary>
    protected abstract string Name(string name);

    [OneTimeSetUp]
    public async Task StartAsync()
    {
        Settings = await StartDatabaseAsync();

        // A pasta de dados é do cofre, que estes testes não abrem: nada é gravado nela.
        var services = new ServiceCollection().AddInfrastructure(Directory.CreateTempSubdirectory("prism-loads-").FullName);
        await ConfigureAsync(services);
        _provider = services.BuildServiceProvider();
        _client = _provider.GetServices<IDatabaseClient>().Single(client => client.Engine == Engine);

        await RunAsync(Settings, [.. Setup]);
    }

    [OneTimeTearDown]
    public async Task StopAsync()
    {
        await RunAsync(Settings, [.. Teardown]);
        await _provider.DisposeAsync();
    }

    [SetUp]
    public Task ResetAsync()
        => RunAsync(Settings, [$"DELETE FROM {Quoted}"]);

    protected string Quoted
        => $"{Q(Schema)}.{Q(Table)}";

    protected static string Q(string name)
        => $"\"{name.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    protected static T Value<T>(Result<T, DatabaseFailure> result)
    {
        Assert.That(result.IsSuccess, Is.True, result.IsFailure ? result.Error.Message : null);

        return result.Value;
    }

    protected static void Success(UnitResult<DatabaseFailure> result)
        => Assert.That(result.IsSuccess, Is.True, result.IsFailure ? result.Error.Message : null);

    protected async Task<IDatabaseConnection> OpenAsync(ConnectionSettings settings)
        => Value(await _client.OpenAsync(settings, CancellationToken.None));

    /// <summary>Os comandos de arranjo, numa conexão comum e em auto-commit.</summary>
    protected async Task RunAsync(ConnectionSettings settings, params string[] sqls)
    {
        await using var connection = await OpenAsync(settings);
        foreach (var sql in sqls)
            Value(await connection.ExecuteAsync(sql, CancellationToken.None));
    }

    /// <summary>A primeira célula de um `SELECT`, numa conexão nova (a da carga continua com o que é dela).</summary>
    protected async Task<string?> ScalarAsync(ConnectionSettings settings, string sql)
    {
        await using var connection = await OpenAsync(settings);

        return Value(await connection.ExecuteAsync(sql, CancellationToken.None)).Page!.Rows[0][0];
    }

    /// <summary>A conexão como o carregador a usa: o prazo de trava, a tabela lida do catálogo e o destino da carga com as colunas na ordem do mapeamento.</summary>
    protected async Task<(IDatabaseConnection Connection, LoadTarget Target, IReadOnlyList<ImportTargetColumn> Columns)> BeginAsync(ConnectionSettings settings)
    {
        var connection = await OpenAsync(settings);
        Success(await connection.BeginLoadAsync(CancellationToken.None));

        var catalog = Value(await connection.DescribeImportTargetAsync(Schema, Table, CancellationToken.None));
        Assert.That(catalog, Is.Not.Null);
        var table = ImportTargets.TableOf(Engine, catalog!);
        var columns = new[] { "id", "nome", "texto", "anexo" }.Select(name => table.Columns.Single(column => column.Name == Name(name))).ToList();
        Assert.That(columns.Select(column => column.Class), Is.EqualTo(new[] { EImportClass.Number, EImportClass.Text, EImportClass.Text, EImportClass.Binary }));

        return (connection, new LoadTarget(table.Schema, table.Name, [.. columns.Select(column => column.Name)]), columns);
    }

    /// <summary>Uma linha convertida como a importação a converte: o texto do arquivo nas colunas de texto e de número, e o binário em bytes, como na cópia.</summary>
    protected IReadOnlyList<EditParameter> Row(IReadOnlyList<ImportTargetColumn> columns, int id, string? text = null)
    {
        var values = new[] { id.ToString(System.Globalization.CultureInfo.InvariantCulture), $"Nome {id}", text ?? $"Texto {id}" };
        var row = values.Select((value, index) => Converted(columns[index], value)).ToList();
        row.Add(new EditParameter(new byte[] { (byte)(id % 256), 0x00, 0xFF }, DbType.Binary));

        return row;
    }

    protected EditParameter Converted(ImportTargetColumn column, string text)
    {
        var converted = ImportValues.Convert(Engine, column, new ImportValue(text, EImportValueSource.Quoted), ImportValueRules.None, ImportValueFormats.Default);
        Assert.That(converted.IsSuccess, Is.True, converted.IsFailure ? converted.Error : null);

        return converted.Value.Parameter;
    }

    /// <summary>
    /// Manda as linhas como o carregador: em comandos do tamanho que a conexão diz (<see cref="IDatabaseConnection.LoadRowsPerCommand"/>). Devolve a
    /// primeira recusa, com a posição da linha recusada em `rows` (e não no comando).
    /// </summary>
    protected static async Task<DatabaseFailure?> InsertAsync(IDatabaseConnection connection, LoadTarget target, IReadOnlyList<IReadOnlyList<EditParameter>> rows)
    {
        var size = connection.LoadRowsPerCommand(target.Columns.Count);
        for (var start = 0; start < rows.Count; start += size)
        {
            var inserted = await connection.InsertRowsAsync(target, [.. rows.Skip(start).Take(size)], CancellationToken.None);
            if (inserted.IsFailure)
                return inserted.Error with { Change = inserted.Error.Change is { } change ? start + change : null };
        }

        return null;
    }

    /// <summary>
    /// RN-IMPORT-015: 1.234 linhas numa transação, em mais de um comando (no Db2, de 500 linhas com os 4 parâmetros de cada), com um texto longo e o binário
    /// de cada linha, confirmadas no fim: a outra conexão lê todas, o texto inteiro e os bytes.
    /// </summary>
    [Test]
    public async Task Insert_ManyRows_InSeveralCommands_WithLongTextAndBinary()
    {
        var (connection, target, columns) = await BeginAsync(Settings);
        await using (connection)
        {
            var rows = Enumerable.Range(1, 1234).Select(id => Row(columns, id, id == 7 ? new string('x', LongTextLength) : null)).ToList();

            Success(await connection.BeginLoadTransactionAsync(CancellationToken.None));
            Assert.That(await InsertAsync(connection, target, rows), Is.Null);
            Success(await connection.CommitLoadAsync());
        }

        Assert.That(await ScalarAsync(Settings, $"SELECT COUNT(*) FROM {Quoted}"), Is.EqualTo("1234"));
        Assert.That(await ScalarAsync(Settings, $"SELECT LENGTH({Q(Name("texto"))}) FROM {Quoted} WHERE {Q(Name("id"))} = 7"), Is.EqualTo(LongTextLength.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        Assert.That(await ScalarAsync(Settings, $"SELECT {Q(Name("nome"))} FROM {Quoted} WHERE {Q(Name("id"))} = 1234"), Is.EqualTo("Nome 1234"));
        Assert.That(await ScalarAsync(Settings, $"SELECT {Q(Name("anexo"))} FROM {Quoted} WHERE {Q(Name("id"))} = 3"), Is.EqualTo("0x0300FF"));
    }

    /// <summary>
    /// RN-IMPORT-016: a chave repetida na quarta linha de um comando: a recusa do banco diz a linha (no PostgreSQL pelo comando do lote; no Db2 pela volta
    /// linha por linha; no Informix, a do comando de uma linha), com a classe 23, e a transação em andamento é desfeita; o confirmado antes fica.
    /// </summary>
    [Test]
    public async Task Refusal_SaysTheRow_AndUndoesTheTransaction()
    {
        var (connection, target, columns) = await BeginAsync(Settings);
        await using (connection)
        {
            Success(await connection.BeginLoadTransactionAsync(CancellationToken.None));
            Assert.That(await InsertAsync(connection, target, [.. Enumerable.Range(1, 10).Select(id => Row(columns, id))]), Is.Null);
            Success(await connection.CommitLoadAsync());

            Success(await connection.BeginLoadTransactionAsync(CancellationToken.None));
            var refused = await InsertAsync(connection, target, [.. new[] { 11, 12, 13, 5, 14 }.Select(id => Row(columns, id))]);

            Assert.That(refused, Is.Not.Null);
            Assert.That(refused!.Change, Is.EqualTo(3));
            Assert.That(refused.SqlState, Does.StartWith("23"));
            Assert.That(connection.IsOpen, Is.True);
        }

        Assert.That(await ScalarAsync(Settings, $"SELECT COUNT(*) FROM {Quoted}"), Is.EqualTo("10"));
    }

    /// <summary>RN-IMPORT-012 e 016: o esvaziamento vai na primeira transação, e a recusa que vem depois o desfaz com ela: a tabela volta a ter as linhas de antes.</summary>
    [Test]
    public async Task Empty_IsUndoneWithTheTransaction()
    {
        var (connection, target, columns) = await BeginAsync(Settings);
        await using (connection)
        {
            Success(await connection.BeginLoadTransactionAsync(CancellationToken.None));
            Assert.That(await InsertAsync(connection, target, [.. Enumerable.Range(1, 3).Select(id => Row(columns, id))]), Is.Null);
            Success(await connection.CommitLoadAsync());

            Success(await connection.BeginLoadTransactionAsync(CancellationToken.None));
            Success(await connection.EmptyTableAsync(target.Schema, target.Table, CancellationToken.None));
            var refused = await InsertAsync(connection, target, [Row(columns, 1), Row(columns, 1)]);

            Assert.That(refused?.Change, Is.EqualTo(1));
        }

        Assert.That(await ScalarAsync(Settings, $"SELECT COUNT(*) FROM {Quoted}"), Is.EqualTo("3"));
    }

    /// <summary>RN-IMPORT-012: o esvaziamento e as linhas novas confirmados juntos.</summary>
    [Test]
    public async Task Empty_AndLoad_AreCommittedTogether()
    {
        await RunAsync(Settings, $"INSERT INTO {Quoted} ({Q(Name("id"))}, {Q(Name("nome"))}) VALUES (900, 'Antes')");
        var (connection, target, columns) = await BeginAsync(Settings);
        await using (connection)
        {
            Success(await connection.BeginLoadTransactionAsync(CancellationToken.None));
            Success(await connection.EmptyTableAsync(target.Schema, target.Table, CancellationToken.None));
            Assert.That(await InsertAsync(connection, target, [Row(columns, 1), Row(columns, 2)]), Is.Null);
            Success(await connection.CommitLoadAsync());
        }

        Assert.That(await ScalarAsync(Settings, $"SELECT COUNT(*) FROM {Quoted}"), Is.EqualTo("2"));
        Assert.That(await ScalarAsync(Settings, $"SELECT COUNT(*) FROM {Quoted} WHERE {Q(Name("id"))} = 900"), Is.EqualTo("0"));
    }
}
