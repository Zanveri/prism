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
/// RN-PASTA-007, RN-SCRIPT-006 e RN-VERSAO-005: a cor da pasta (`VaultFolderRecord.Color`) e o ícone e a cor do script (`VaultScriptRecord.Icon` e `Color`)
/// entraram nos registros SEM subir o formato do cofre, como o ambiente da pasta (`VaultFolderEnvironmentTests`). A leitura do documento entrega nulo ao campo
/// que o JSON não tem, e é isso que este teste prova: um cofre do formato atual gravado antes da mudança, com a pasta e o script sem os campos novos, abre com
/// a pasta sem cor e o script com o ícone padrão e sem cor, e a gravação seguinte o regrava com eles, que voltam na entrada seguinte. O conteúdo é escrito à
/// mão, com os campos que os dois registros tinham até então, cifrado como o serviço cifra.
/// </summary>
public sealed class VaultFolderColorAndScriptIconTests : IDisposable
{
    private const string UserName = "marina.costa";
    private const string Password = "senha-do-teste-da-cor";

    /// <summary>O formato do cofre quando a mudança foi feita: ela não o sobe.</summary>
    private const int FormatBeforeTheColors = 3;

    private static readonly Guid FolderID = Guid.Parse("0199e0a0-0000-7000-8000-0000000000a1");
    private static readonly Guid ScriptID = Guid.Parse("0199e0a0-0000-7000-8000-0000000000b1");
    private static readonly DateTime SavedAt = new(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc);

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-folder-color-").FullName;

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private string VaultPath
        => Path.Combine(_directory, "vaults", $"{UserName}.vault.json");

    private VaultService CreateService()
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));

        return new VaultService(new VaultFileClient(options, Logger.None), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);
    }

    /// <summary>O documento como o código de antes o gravava: a pasta até o ambiente, o script até as datas, e a área de trabalho vazia.</summary>
    private static byte[] DocumentWithoutTheColors()
        => Encoding.UTF8.GetBytes($$$"""
            {"UserName":"{{{UserName}}}","Folders":[{"ID":"{{{FolderID}}}","ParentID":null,"Name":"Produção","CreatedAt":"2026-10-14T12:00:00Z","UpdatedAt":"2026-10-14T12:00:00Z","EnvironmentName":"Produção","EnvironmentColor":"#FF8A7A"}],"Connections":[],"Scripts":[{"ID":"{{{ScriptID}}}","Name":"Fechamento","Sql":"SELECT 1","ConnectionID":null,"Database":null,"CreatedAt":"2026-10-14T12:00:00Z","UpdatedAt":"2026-10-14T12:00:00Z"}],"Workspace":{"Tabs":[],"ActiveIndex":null}}
            """);

    /// <summary>Monta o arquivo como o `VaultService.CreateAsync` monta: a chave do cofre embrulhada pela chave da senha, e o conteúdo cifrado pela chave do cofre.</summary>
    private void WriteVaultWithoutTheColors()
    {
        var kdf = VaultFakers.CreateKdf();
        var associatedData = VaultCrypto.AssociatedData(FormatBeforeTheColors, kdf);
        var passwordKey = VaultCrypto.DeriveKey(Password, kdf);
        var key = VaultCrypto.NewKey();
        var file = new VaultFile(FormatBeforeTheColors, kdf, VaultCrypto.Seal(passwordKey, key, associatedData), VaultCrypto.Seal(key, DocumentWithoutTheColors(), associatedData));

        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
        File.WriteAllBytes(VaultPath, JsonSerializer.SerializeToUtf8Bytes(file, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    [Trait("VaultFolderColorAndScriptIcon", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre sem a cor da pasta e sem o ícone do script abre com os dois nulos, e a gravação seguinte o regrava com eles")]
    public async Task Unlock_VaultWithoutTheColors_OpensAndIsRewrittenWithThem()
    {
        //Arrange
        WriteVaultWithoutTheColors();
        var service = CreateService();

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);
        var openedFolder = service.Read().Value.Folders.Single();
        var openedScript = service.Read().Value.Scripts.Single();
        var saved = await service.SaveAsync(document => document with
        {
            Folders = [.. document.Folders.Select(folder => folder with { Color = "#7DB2FF" })],
            Scripts = [.. document.Scripts.Select(script => script with { Icon = "chart", Color = "#F2B644" })],
        }, CancellationToken.None);
        service.Lock();
        var reopenedService = CreateService();
        var reopened = await reopenedService.UnlockAsync(UserName, Password, CancellationToken.None);
        var rewrittenFolder = reopenedService.Read().Value.Folders.Single();
        var rewrittenScript = reopenedService.Read().Value.Scripts.Single();

        //Assert
        using var header = JsonDocument.Parse(File.ReadAllBytes(VaultPath));
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(new VaultFolderRecord(FolderID, null, "Produção", SavedAt, SavedAt, "Produção", "#FF8A7A"), openedFolder);
        Assert.Null(openedFolder.Color);
        Assert.Equal(new VaultScriptRecord(ScriptID, "Fechamento", "SELECT 1", null, null, SavedAt, SavedAt), openedScript);
        Assert.Null(openedScript.Icon);
        Assert.Null(openedScript.Color);
        Assert.True(saved.IsSuccess);
        Assert.True(reopened.IsSuccess);
        Assert.Equal(openedFolder with { Color = "#7DB2FF" }, rewrittenFolder);
        Assert.Equal(openedScript with { Icon = "chart", Color = "#F2B644" }, rewrittenScript);
        Assert.Equal(FormatBeforeTheColors, header.RootElement.GetProperty("version").GetInt32());
        Assert.Equal(VaultCrypto.Version, header.RootElement.GetProperty("version").GetInt32());
    }
}
