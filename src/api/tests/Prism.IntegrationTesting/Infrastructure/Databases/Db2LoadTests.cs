using Microsoft.Extensions.DependencyInjection;
using Prism.Infrastructure.Databases.Models;
using Prism.IntegrationTesting.Configurations;
using Prism.TestingCore.Extensions;

namespace Prism.IntegrationTesting.Infrastructure.Databases;

/// <summary>
/// O carregador no Db2 (RN-IMPORT-015): o `INSERT … VALUES (?, ?), (?, ?), …` de até 500 linhas e 10.000 parâmetros, com os valores já convertidos pelo
/// Prism, também com o texto longo num `CLOB` e o binário num `BLOB`. A recusa de dado ou de restrição volta linha por linha na mesma transação até a linha
/// recusada (o Db2 desfaz só o comando, RN-TX-009), e a transação é desfeita depois.
/// </summary>
[TestFixture]
[Category("Databases")]
[Category("Db2")]
public sealed class Db2LoadTests : DatabaseLoadContractTests
{
    private readonly string _schema = $"CARGA_{Guid.NewGuid():N}"[..18].ToUpperInvariant();

    protected override EDatabaseEngine Engine => EDatabaseEngine.Db2;

    protected override string Schema => _schema;

    protected override string Table => "CARGA";

    protected override IEnumerable<string> Setup =>
    [
        $"CREATE SCHEMA {_schema}",
        $"CREATE TABLE {_schema}.CARGA (ID INTEGER NOT NULL PRIMARY KEY, NOME VARCHAR(40), TEXTO CLOB(1M), ANEXO BLOB(1M))"
    ];

    protected override IEnumerable<string> Teardown =>
    [
        $"DROP TABLE {_schema}.CARGA",
        $"DROP SCHEMA {_schema} RESTRICT"
    ];

    protected override Task<ConnectionSettings> StartDatabaseAsync()
        => Db2Singleton.GetSettingsAsync();

    protected override async Task ConfigureAsync(IServiceCollection services)
        => services.UseDriverSource(directory: await IbmDriverSingleton.GetDirectoryAsync());

    protected override string Name(string name)
        => name.ToUpperInvariant();

    /// <summary>RN-IMPORT-015: 4 colunas cabem em 500 linhas por comando (2.000 parâmetros); 40 colunas, em 250.</summary>
    [Test]
    public async Task RowsPerCommand_FollowTheParameterLimit()
    {
        await using var connection = await OpenAsync(Settings);

        Assert.That((connection.LoadRowsPerCommand(4), connection.LoadRowsPerCommand(40), connection.LoadRowsPerCommand(20_000)), Is.EqualTo((500, 250, 1)));
    }
}
