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
/// O formato 2 do cofre (o dos scripts, RN-SCRIPT-002) como um arquivo gravado ANTES do formato 3 e versionado em `Vault/Samples/`. O formato 3 acrescentou a
/// área de trabalho ao documento (RN-ABAS-006: as abas que voltam na próxima entrada), e o 4, as pastas de scripts (RN-SCRIPT-011): o exemplo abre, é migrado ao
/// abrir pelos dois passos (a área de trabalho vazia, as pastas de scripts vazias, os scripts
/// como estavam, e o arquivo passa a declarar o formato atual) e o arquivo de antes fica no `.bak` (RN-VERSAO-005). O do formato 1 continua em
/// `VaultFormatOneSampleTests`, que passa pelas duas migrações.
///
/// A SENHA É A MESMA CONSTANTE FICTÍCIA do exemplo do formato 1, de um cofre com dados inventados (usuário, host, senha de banco e script que não existem): sem
/// ela o arquivo não serve de prova. O arquivo foi gerado pelo próprio código do formato 2 (Argon2id de 8 MiB e uma passada, o mesmo dos testes) e não é
/// regravado: quem o regerar perde a prova de que o formato 2 continua abrindo.
/// </summary>
public sealed class VaultFormatTwoSampleTests : IDisposable
{
    private const string SampleUserName = "exemplo.formato2";

    private const string SampleResource = "vault-format-2.json";

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-sample-").FullName;

    /// <summary>
    /// O que o cofre de exemplo guarda: uma pasta, uma conexão e um script, tudo inventado. A área de trabalho é do formato 3 e as pastas de scripts do 4: aberto,
    /// o exemplo ganha as duas vazias, e o script fica na raiz.
    /// </summary>
    private static VaultDocument SampleDocument { get; } = CreateSampleDocument();

    private static VaultDocument CreateSampleDocument()
    {
        var createdAt = new DateTime(2026, 10, 13, 12, 0, 0, DateTimeKind.Utc);
        var folder = new VaultFolderRecord(Guid.Parse("0199dd00-0000-7000-8000-000000000001"), null, "Homologação", createdAt, createdAt);
        var connection = new VaultConnectionRecord(Guid.Parse("0199dd00-0000-7000-8000-000000000002"), folder.ID, "Banco de exemplo 2", EDatabaseEngine.PostgreSql, "db2.exemplo.invalid", 5433, "exemplo", "usuario_exemplo", "senha-ficticia-do-banco-de-exemplo", "Homologação", "#3366cc", createdAt, createdAt);
        var script = new VaultScriptRecord(Guid.Parse("0199dd00-0000-7000-8000-000000000003"), "Relatório de exemplo", "SELECT id, nome FROM exemplo.clientes ORDER BY nome", connection.ID, "exemplo", createdAt, createdAt);

        return new VaultDocument(SampleUserName, [folder], [connection], [script], VaultWorkspaceRecord.Empty, []);
    }

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private static byte[] ReadSample()
    {
        using var stream = typeof(VaultFormatTwoSampleTests).Assembly.GetManifestResourceStream(SampleResource)!;
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

    [Trait("VaultFormatTwoSample", "Header")]
    [Fact(DisplayName = "OK o arquivo de exemplo declara o formato 2, mais antigo que o atual")]
    public void Sample_DeclaresFormatTwo()
    {
        //Arrange
        using var json = JsonDocument.Parse(ReadSample());

        //Act
        var format = json.RootElement.GetProperty("version").GetInt32();

        //Assert
        Assert.Equal(2, format);
        Assert.Equal(4, VaultCrypto.Version);
    }

    /// <summary>
    /// RN-VERSAO-005, RN-ABAS-006 e RN-SCRIPT-011: o cofre do formato 2 abre com a senha e é migrado ao abrir. O principal passa a declarar o formato atual, com o
    /// mesmo algoritmo, os mesmos parâmetros e o mesmo sal; o documento ganha a área de trabalho vazia e as pastas de scripts vazias, e os scripts ficam como
    /// estavam, na raiz; o arquivo de antes fica no `.bak`, byte a byte.
    /// </summary>
    [Trait("VaultFormatTwoSample", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre do formato 2 abre, é migrado ao formato atual com a área de trabalho vazia e os scripts, e o arquivo de antes fica no .bak")]
    public async Task Unlock_VaultOfFormatTwoWrittenBefore_OpensAndMigrates()
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
        Assert.True(opened.JsonEquals(SampleDocument));
        Assert.Equal("SELECT id, nome FROM exemplo.clientes ORDER BY nome", Assert.Single(opened.Scripts).Sql);
        Assert.Null(Assert.Single(opened.Scripts).FolderID);
        Assert.Empty(opened.ScriptFolders);
        Assert.Empty(opened.Workspace.Tabs);
        Assert.Null(opened.Workspace.ActiveIndex);
        Assert.Equal(VaultCrypto.Version, after.RootElement.GetProperty("version").GetInt32());
        Assert.Equal(before.RootElement.GetProperty("kdf").GetRawText(), after.RootElement.GetProperty("kdf").GetRawText());
        Assert.Equal(sample, File.ReadAllBytes(path + ".bak"));
        Assert.True(reopened.IsSuccess);
        Assert.True(service.Read().Value.JsonEquals(SampleDocument));
    }

    /// <summary>A migração acontece uma vez: a entrada seguinte acha o formato atual e não regrava nada, e o `.bak` continua sendo o arquivo do formato 2.</summary>
    [Trait("VaultFormatTwoSample", "UnlockAsync")]
    [Fact(DisplayName = "OK a entrada seguinte à migração não regrava nada, e o .bak continua sendo o arquivo do formato 2")]
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

    /// <summary>A primeira área de trabalho gravada depois da migração vai cifrada para o disco, no formato atual, e volta inteira na entrada seguinte.</summary>
    [Trait("VaultFormatTwoSample", "SaveAsync")]
    [Fact(DisplayName = "OK depois da migração a área de trabalho se grava e volta na entrada seguinte")]
    public async Task Save_AfterTheMigration_KeepsTheWorkspace()
    {
        //Arrange
        CopySampleToVaults();
        var service = CreateService();
        await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword, CancellationToken.None);
        var workspace = VaultFakers.CreateWorkspace(0, VaultFakers.CreateQueryTab(connectionID: Guid.Parse("0199dd00-0000-7000-8000-000000000002"), sql: "SELECT 1", scriptID: Guid.Parse("0199dd00-0000-7000-8000-000000000003"), dirty: true));

        //Act
        var saved = await service.SaveAsync(document => document with { Workspace = workspace }, CancellationToken.None);
        service.Lock();
        var reopened = await service.UnlockAsync(SampleUserName, VaultFormatOneSampleTests.SamplePassword, CancellationToken.None);

        //Assert
        Assert.True(saved.IsSuccess);
        Assert.True(reopened.IsSuccess);
        Assert.True(service.Read().Value.Workspace.JsonEquals(workspace));
        Assert.Single(service.Read().Value.Scripts);
    }

    [Trait("VaultFormatTwoSample", "UnlockAsync")]
    [Fact(DisplayName = "Erro o cofre do formato 2 não abre com outra senha, e continua sendo credencial inválida")]
    public async Task Unlock_VaultOfFormatTwoWithAnotherPassword_ReturnsInvalidCredentials()
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
