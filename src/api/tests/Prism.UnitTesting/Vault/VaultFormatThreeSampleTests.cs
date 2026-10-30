using Microsoft.Extensions.Options;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Vault;
using Serilog.Core;
using System.Text.Json;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// O formato 3 do cofre (o da área de trabalho, RN-ABAS-006) como um arquivo gravado ANTES do formato 4 e versionado em `Vault/Samples/`. O formato 4 acrescentou
/// as pastas de scripts ao documento (RN-SCRIPT-011), e a pasta de cada script ao registro dele: o exemplo abre, é migrado ao abrir (as pastas de scripts vazias,
/// os scripts na raiz, e todo o resto como estava: a pasta e a conexão com o ambiente, a cor, as proteções e a verificação, os scripts com o ícone e a cor, e a
/// área de trabalho), o arquivo passa a declarar o formato atual e o de antes fica no `.bak` (RN-VERSAO-005). Os dos formatos 1 e 2 continuam em
/// `VaultFormatOneSampleTests` e `VaultFormatTwoSampleTests`, que passam por este passo também.
///
/// A SENHA É A MESMA CONSTANTE FICTÍCIA dos exemplos dos formatos 1 e 2, de um cofre com dados inventados (usuário, host, senha de banco e scripts que não
/// existem): sem ela o arquivo não serve de prova. O arquivo foi gerado pelo próprio código do formato 3 (Argon2id de 8 MiB e uma passada, o mesmo dos testes) e
/// não é regravado: quem o regerar perde a prova de que o formato 3 continua abrindo.
/// </summary>
public sealed class VaultFormatThreeSampleTests : IDisposable
{
    private const string SampleUserName = "exemplo.formato3";

    private const string SampleResource = "vault-format-3.json";

    private static readonly Guid ScriptID = Guid.Parse("0199ec00-0000-7000-8000-000000000003");

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-sample-").FullName;

    /// <summary>
    /// O que o cofre de exemplo guarda: uma pasta (com o ambiente, a cor e a confirmação), uma conexão dentro dela (somente leitura, com a verificação a cada 60
    /// segundos e a consulta própria), dois scripts (um com conexão, ícone e cor, e um genérico) e a área de trabalho com uma aba de consulta do script e uma de
    /// tabela, tudo inventado. As pastas de scripts são do formato 4: aberto, o exemplo as ganha vazias, e os scripts ficam na raiz.
    /// </summary>
    private static VaultDocument SampleDocument { get; } = CreateSampleDocument();

    private static VaultDocument CreateSampleDocument()
    {
        var createdAt = new DateTime(2026, 10, 16, 12, 0, 0, DateTimeKind.Utc);
        var folder = new VaultFolderRecord(Guid.Parse("0199ec00-0000-7000-8000-000000000001"), null, "Financeiro", createdAt, createdAt, "Homologação", "#3366cc", "#22aa66", "irreversible", null);
        var connection = new VaultConnectionRecord(Guid.Parse("0199ec00-0000-7000-8000-000000000002"), folder.ID, "Banco de exemplo 3", EDatabaseEngine.PostgreSql, "db3.exemplo.invalid", 5434, "exemplo", "usuario_exemplo", "senha-ficticia-do-banco-de-exemplo", null, null, createdAt, createdAt, null, true, false, 60, "SELECT 1");
        var script = new VaultScriptRecord(ScriptID, "Fechamento do mês", "SELECT conta, SUM(valor) FROM exemplo.lancamentos GROUP BY conta", connection.ID, "exemplo", createdAt, createdAt, "chart", "#cc3300");
        var generic = new VaultScriptRecord(Guid.Parse("0199ec00-0000-7000-8000-000000000004"), "Contagem genérica", "SELECT COUNT(*) FROM exemplo.clientes", null, null, createdAt, createdAt);
        var workspace = new VaultWorkspaceRecord([
            new VaultWorkspaceTabRecord("query", connection.ID, "exemplo", "SELECT conta FROM exemplo.lancamentos", script.ID, true, false, null, null, null),
            new VaultWorkspaceTabRecord("table", connection.ID, null, null, null, false, false, "exemplo", "clientes", "data")], 1);

        return new VaultDocument(SampleUserName, [folder], [connection], [script, generic], workspace, []);
    }

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private static byte[] ReadSample()
    {
        using var stream = typeof(VaultFormatThreeSampleTests).Assembly.GetManifestResourceStream(SampleResource)!;
        using var memory = new MemoryStream();
        stream.CopyTo(memory);

        return memory.ToArray();
    }

    private string CopySampleToVaults()
    {
        var path = Path.Combine(_directory, "vaults", $"{SampleUserName}.vault.json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, ReadSample());

        return path;
    }

    private VaultService CreateService()
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));

        return new VaultService(new VaultFileClient(options, Logger.None), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);
    }

    [Trait("VaultFormatThreeSample", "Header")]
    [Fact(DisplayName = "OK o arquivo de exemplo declara o formato 3, mais antigo que o atual")]
    public void Sample_DeclaresFormatThree()
    {
        //Arrange
        using var json = JsonDocument.Parse(ReadSample());

        //Act
        var format = json.RootElement.GetProperty("version").GetInt32();

        //Assert
        Assert.Equal(3, format);
        Assert.Equal(4, VaultCrypto.Version);
    }

    /// <summary>
    /// RN-VERSAO-005 e RN-SCRIPT-011: o cofre do formato 3 abre com a senha e é migrado ao abrir. O principal passa a declarar o formato atual, com o mesmo
    /// algoritmo, os mesmos parâmetros e o mesmo sal; o documento ganha as pastas de scripts vazias, os scripts ficam na raiz, e o resto fica como estava (a
    /// comparação é do documento inteiro); o arquivo de antes fica no `.bak`, byte a byte.
    /// </summary>
    [Trait("VaultFormatThreeSample", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre do formato 3 abre, é migrado ao formato atual com as pastas de scripts vazias e os scripts na raiz, e o arquivo de antes fica no .bak")]
    public async Task Unlock_VaultOfFormatThreeWrittenBefore_OpensAndMigrates()
    {
        //Arrange
        var path = CopySampleToVaults();
        var sample = File.ReadAllBytes(path);
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword, CancellationToken.None);
        var opened = service.Read().Value;
        service.Lock();
        var reopened = await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword, CancellationToken.None);

        //Assert
        using var before = JsonDocument.Parse(sample);
        using var after = JsonDocument.Parse(File.ReadAllBytes(path));
        Assert.True(result.IsSuccess);
        Assert.True((opened with { Journal = null }).JsonEquals(SampleDocument));
        Assert.Empty(opened.ScriptFolders);
        Assert.All(opened.Scripts, script => Assert.Null(script.FolderID));
        Assert.Equal(2, opened.Workspace.Tabs.Count);
        Assert.Equal("chart", opened.Scripts.Single(script => script.ID == ScriptID).Icon);
        Assert.True(Assert.Single(opened.Connections).ReadOnly);
        Assert.Equal(VaultCrypto.Version, after.RootElement.GetProperty("version").GetInt32());
        Assert.Equal(before.RootElement.GetProperty("kdf").GetRawText(), after.RootElement.GetProperty("kdf").GetRawText());
        Assert.Equal(sample, File.ReadAllBytes(path + ".bak"));
        Assert.True(reopened.IsSuccess);
        Assert.True((service.Read().Value with { Journal = null }).JsonEquals(SampleDocument));
    }

    /// <summary>A migração acontece uma vez: a entrada seguinte acha o formato atual e não regrava nada, e o `.bak` continua sendo o arquivo do formato 3.</summary>
    [Trait("VaultFormatThreeSample", "UnlockAsync")]
    [Fact(DisplayName = "OK a entrada seguinte à migração não regrava nada, e o .bak continua sendo o arquivo do formato 3")]
    public async Task Unlock_AfterTheMigration_WritesNothingAndKeepsTheBak()
    {
        //Arrange
        var path = CopySampleToVaults();
        var sample = File.ReadAllBytes(path);
        var service = CreateService();
        await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword, CancellationToken.None);
        service.Lock();
        var migrated = File.ReadAllBytes(path);

        //Act
        var result = await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(migrated, File.ReadAllBytes(path));
        Assert.Equal(sample, File.ReadAllBytes(path + ".bak"));
    }

    /// <summary>
    /// RN-SCRIPT-007 e 011: a primeira pasta de scripts gravada depois da migração, com um script dentro dela, vai cifrada para o disco, no formato atual, e volta
    /// inteira na entrada seguinte; o outro script continua na raiz.
    /// </summary>
    [Trait("VaultFormatThreeSample", "SaveAsync")]
    [Fact(DisplayName = "OK depois da migração a primeira pasta de scripts se grava, com um script dentro, e volta na entrada seguinte")]
    public async Task Save_AfterTheMigration_KeepsTheFirstScriptFolder()
    {
        //Arrange
        var path = CopySampleToVaults();
        var service = CreateService();
        await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword, CancellationToken.None);
        var createdAt = new DateTime(2026, 10, 16, 13, 0, 0, DateTimeKind.Utc);
        var folder = new VaultScriptFolderRecord(Guid.CreateVersion7(), null, "Fechamento", createdAt, createdAt);

        //Act
        var saved = await service.SaveAsync(document => document with { ScriptFolders = [folder], Scripts = [.. document.Scripts.Select(script => script.ID == ScriptID ? script with { FolderID = folder.ID } : script)] }, CancellationToken.None);
        service.Lock();
        var reopened = await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword, CancellationToken.None);

        //Assert
        using var file = JsonDocument.Parse(File.ReadAllBytes(path));
        Assert.True(saved.IsSuccess);
        Assert.True(reopened.IsSuccess);
        Assert.Equal(VaultCrypto.Version, file.RootElement.GetProperty("version").GetInt32());
        Assert.True(Assert.Single(service.Read().Value.ScriptFolders).JsonEquals(folder));
        Assert.Equal(folder.ID, service.Read().Value.Scripts.Single(script => script.ID == ScriptID).FolderID);
        Assert.Null(service.Read().Value.Scripts.Single(script => script.ID != ScriptID).FolderID);
        Assert.DoesNotContain("Fechamento", File.ReadAllText(path), StringComparison.Ordinal);
    }

    [Trait("VaultFormatThreeSample", "UnlockAsync")]
    [Fact(DisplayName = "Erro o cofre do formato 3 não abre com outra senha, e continua sendo credencial inválida")]
    public async Task Unlock_VaultOfFormatThreeWithAnotherPassword_ReturnsInvalidCredentials()
    {
        //Arrange
        var path = CopySampleToVaults();
        var sample = File.ReadAllBytes(path);
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword + "x", CancellationToken.None);

        //Assert
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(sample, File.ReadAllBytes(path));
    }
}
