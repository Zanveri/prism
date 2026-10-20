using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Transfers.Imports;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;
using System.Globalization;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O carregador no Informix 14.10, pela porta DRDA (RN-IMPORT-015): uma linha por comando, `INSERT INTO … VALUES (?, ?, ?, ?)` preparado uma vez e
/// executado a cada linha, porque o Informix não aceita várias linhas num `INSERT … VALUES`. "Esquema" é o dono, e o nome de tabela é único no banco
/// inteiro: a tabela do teste tem o nome sorteado. No banco sem log (`prism_sem_log`), cada comando fica gravado ao terminar.
/// </summary>
[TestFixture]
[Category("Databases")]
[Category("Informix")]
public sealed class InformixLoadTests : DatabaseLoadContractTests
{
    private readonly string _suffix = $"{Guid.NewGuid():N}"[..8];
    private readonly string _owner = $"car_{Guid.NewGuid():N}"[..14];

    protected override EDatabaseEngine Engine => EDatabaseEngine.Informix;

    protected override string Schema => _owner;

    protected override string Table => $"carga_{_suffix}";

    /// <summary>O `LVARCHAR` guarda até 32.739 bytes, e a linha inteira do Informix, até 32.767: o texto longo fica em 20.000.</summary>
    protected override int LongTextLength => 20_000;

    protected override IEnumerable<string> Setup =>
        [$"CREATE TABLE {_owner}.{Table} (id INTEGER NOT NULL PRIMARY KEY, nome VARCHAR(40), texto LVARCHAR(20000), anexo BYTE)"];

    protected override IEnumerable<string> Teardown => [$"DROP TABLE {_owner}.{Table}"];

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => InformixSingleton.GetSettingsAsync();

    protected override async Task ConfigureAsync(IServiceCollection services)
        => services.UseDriverSource(directory: await IbmDriverSingleton.GetDirectoryAsync());

    protected override string Name(string name)
        => name;

    [Test]
    public async Task RowsPerCommand_IsOne()
    {
        await using var connection = await OpenAsync(Settings);

        Assert.That(connection.LoadRowsPerCommand(4), Is.EqualTo(1));
    }

    /// <summary>
    /// RN-IMPORT-010 e 015: o texto que o driver mandaria como `CLOB` (mais de 16.350 caracteres) vai como `LONG VARCHAR` até os 32.767 bytes dele, que o
    /// `LVARCHAR` do contrato também aceita; o maior segue como `CLOB`. Os dois entram inteiros no `TEXT` e no `CLOB`: 20.000 caracteres (`LONG VARCHAR`),
    /// 16.384 de dois bytes (32.768 bytes, `CLOB`) e 50.000 (`CLOB`).
    /// </summary>
    [Test]
    public async Task Insert_LongText_IntoTextAndClob_OnBothSidesOfTheLongVarChar()
    {
        var table = $"longo_{_suffix}";
        var texts = new[] { new string('t', 20_000), new string('é', 16_384), new string('c', 50_000) };
        await RunAsync(Settings, $"CREATE TABLE {_owner}.{table} (id INTEGER NOT NULL PRIMARY KEY, t TEXT, c CLOB)");

        try
        {
            await using (var connection = await OpenAsync(Settings))
            {
                Success(await connection.BeginLoadAsync(CancellationToken.None));
                var described = ImportTargets.TableOf(Engine, Value(await connection.DescribeImportTargetAsync(_owner, table, CancellationToken.None))!);
                var columns = new[] { "id", "t", "c" }.Select(name => described.Columns.Single(column => column.Name == name)).ToList();
                var rows = texts.Select((text, index) => (IReadOnlyList<EditParameter>)[Converted(columns[0], (index + 1).ToString(CultureInfo.InvariantCulture)), Converted(columns[1], text), Converted(columns[2], text)]).ToList();

                Success(await connection.BeginLoadTransactionAsync(CancellationToken.None));
                Assert.That(await InsertAsync(connection, new LoadTarget(described.Schema, described.Name, [.. columns.Select(column => column.Name)]), rows), Is.Null);
                Success(await connection.CommitLoadAsync());
            }

            await using var reader = await OpenAsync(Settings);
            foreach (var (text, index) in texts.Select((text, index) => (text, index)))
            {
                var page = Value(await reader.ExecuteAsync($"SELECT t, c FROM {Q(_owner)}.{Q(table)} WHERE id = {index + 1}", CancellationToken.None)).Page!;
                Assert.That(page.FullValues!.Select(value => value.Write()), Is.EqualTo(new[] { text, text }), $"linha {index + 1}");
            }
        }
        finally
        {
            await RunAsync(Settings, $"DROP TABLE {_owner}.{table}");
        }
    }

    /// <summary>
    /// RN-IMPORT-015 e 016, sem log de transação: sem a transação da carga, cada linha fica gravada ao terminar, e a recusa para na linha dela; as
    /// anteriores ficam.
    /// </summary>
    [Test]
    public async Task WithoutLog_EachRowStays_AndTheRefusalSaysItsRow()
    {
        var unlogged = Settings with { Database = InformixSingleton.UnloggedDatabase };
        var table = $"semlog_{_suffix}";
        await RunAsync(unlogged, $"CREATE TABLE {_owner}.{table} (id INTEGER NOT NULL PRIMARY KEY, nome VARCHAR(40), texto LVARCHAR(100), anexo BYTE)");

        try
        {
            await using var connection = await OpenAsync(unlogged);
            Success(await connection.BeginLoadAsync(CancellationToken.None));
            var catalog = Value(await connection.DescribeImportTargetAsync(_owner, table, CancellationToken.None))!;
            Assert.That(catalog.Table.OneAtATime, Is.True);

            var target = new LoadTarget(_owner, table, ["id", "nome"]);
            var refused = await InsertAsync(connection, target, [.. new[] { 1, 2, 1, 3 }.Select(id => (IReadOnlyList<EditParameter>)[new EditParameter(id, System.Data.DbType.Int32), new EditParameter($"Nome {id}", System.Data.DbType.String)])]);

            Assert.That(refused?.Change, Is.EqualTo(2));
            Assert.That(await ScalarAsync(unlogged, $"SELECT COUNT(*) FROM {Q(_owner)}.{Q(table)}"), Is.EqualTo("2"));
        }
        finally
        {
            await RunAsync(unlogged, $"DROP TABLE {_owner}.{table}");
        }
    }
}
