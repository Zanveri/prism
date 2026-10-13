using Microsoft.Extensions.Options;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using Serilog.Core;
using System.Text;
using System.Text.Json;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// RN-PASTA-005 e RN-VERSAO-005: o ambiente da pasta entrou no registro dela (`VaultFolderRecord.EnvironmentName` e `EnvironmentColor`) SEM subir o
/// formato do cofre. A leitura do documento entrega nulo ao campo que o JSON não tem, e é isso que este teste prova: um cofre do formato 2 gravado
/// antes da mudança, com a pasta sem os dois campos, abre com a pasta sem ambiente, e a gravação seguinte o regrava com eles, que voltam na
/// entrada seguinte. O conteúdo é escrito à mão, com os cinco campos que o registro da pasta tinha até então, cifrado como o serviço cifra.
/// </summary>
public sealed class VaultFolderEnvironmentTests : IDisposable
{
    private const string UserName = "marina.costa";
    private const string Password = "senha-do-teste-de-ambiente";

    /// <summary>O formato do cofre de antes do ambiente da pasta, e o atual quando a mudança foi feita.</summary>
    private const int FormatBeforeTheFolderEnvironment = 2;

    private static readonly Guid FolderID = Guid.Parse("0199c3a0-0000-7000-8000-0000000000a1");

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-folder-environment-").FullName;

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private string VaultPath
        => Path.Combine(_directory, "vaults", $"{UserName}.vault.json");

    private VaultService CreateService()
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));

        return new VaultService(new VaultFileClient(options, Logger.None), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);
    }

    /// <summary>O documento como o código de antes o gravava: o registro da pasta tem só ID, pasta pai, nome e as duas datas.</summary>
    private static byte[] DocumentWithoutTheFolderEnvironment()
        => Encoding.UTF8.GetBytes($$"""
            {"UserName":"{{UserName}}","Folders":[{"ID":"{{FolderID}}","ParentID":null,"Name":"Produção","CreatedAt":"2026-10-09T12:00:00Z","UpdatedAt":"2026-10-09T12:00:00Z"}],"Connections":[],"Scripts":[]}
            """);

    /// <summary>Monta o arquivo como o `VaultService.CreateAsync` monta: a chave do cofre embrulhada pela chave da senha, e o conteúdo cifrado pela chave do cofre.</summary>
    private void WriteVaultOfFormatTwoWithoutTheFolderEnvironment()
    {
        var kdf = VaultFakers.CreateKdf();
        var associatedData = VaultCrypto.AssociatedData(FormatBeforeTheFolderEnvironment, kdf);
        var passwordKey = VaultCrypto.DeriveKey(Password, kdf);
        var key = VaultCrypto.NewKey();
        var file = new VaultFile(FormatBeforeTheFolderEnvironment, kdf, VaultCrypto.Seal(passwordKey, key, associatedData), VaultCrypto.Seal(key, DocumentWithoutTheFolderEnvironment(), associatedData));

        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
        File.WriteAllBytes(VaultPath, JsonSerializer.SerializeToUtf8Bytes(file, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    [Trait("VaultFolderEnvironment", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre do formato 2 sem o ambiente da pasta abre com a pasta sem ambiente, e a gravação seguinte o regrava com ele")]
    public async Task Unlock_VaultOfFormatTwoWithoutTheFolderEnvironment_OpensAndIsRewrittenWithIt()
    {
        //Arrange
        WriteVaultOfFormatTwoWithoutTheFolderEnvironment();
        var service = CreateService();

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);
        var opened = service.Read().Value.Folders.Single();
        var saved = await service.SaveAsync(document => document with { Folders = [.. document.Folders.Select(folder => folder with { EnvironmentName = "Produção", EnvironmentColor = "#FF8A7A" })] }, CancellationToken.None);
        service.Lock();
        var reopenedService = CreateService();
        var reopened = await reopenedService.UnlockAsync(UserName, Password, CancellationToken.None);
        var rewritten = reopenedService.Read().Value.Folders.Single();

        //Assert
        using var header = JsonDocument.Parse(File.ReadAllBytes(VaultPath));
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(new VaultFolderRecord(FolderID, null, "Produção", new DateTime(2026, 10, 9, 12, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 9, 12, 0, 0, DateTimeKind.Utc)), opened);
        Assert.Null(opened.EnvironmentName);
        Assert.Null(opened.EnvironmentColor);
        Assert.True(saved.IsSuccess);
        Assert.True(reopened.IsSuccess);
        Assert.Equal(opened with { EnvironmentName = "Produção", EnvironmentColor = "#FF8A7A" }, rewritten);
        Assert.Equal(VaultCrypto.Version, header.RootElement.GetProperty("version").GetInt32());
    }
}
