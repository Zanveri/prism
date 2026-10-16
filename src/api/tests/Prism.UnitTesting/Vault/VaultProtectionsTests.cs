using Microsoft.Extensions.Options;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using Serilog.Core;
using System.Text;
using System.Text.Json;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// RN-PROT-001 e 002, RN-VERIF-001 e RN-VERSAO-005: as proteções da pasta (`VaultFolderRecord.ConfirmCommands` e `ReadOnly`) e as da conexão, com a
/// verificação periódica (`VaultConnectionRecord.ConfirmCommands`, `ReadOnly`, `VerificationEnabled`, `VerificationInterval` e `VerificationQuery`),
/// entraram nos registros SEM subir o formato do cofre, como a cor da pasta (`VaultFolderColorAndScriptIconTests`). Um cofre do formato 3 (o atual quando a
/// mudança foi feita) gravado antes dela, com a pasta e a conexão sem os campos novos, abre com eles nulos (a pasta e a conexão sem proteção, e a verificação
/// no padrão), e a gravação seguinte o regrava com eles, que voltam na entrada seguinte. O conteúdo é escrito à mão, com os campos que os dois registros tinham
/// até então, cifrado como o serviço cifra. Ele escreve o número 3 de propósito (e não `VaultCrypto.Version`): com o formato 4 (RN-SCRIPT-011) ele passa a
/// provar também a migração desse cofre.
/// </summary>
public sealed class VaultProtectionsTests : IDisposable
{
    private const string UserName = "marina.costa";
    private const string Password = "senha-do-teste-das-protecoes";

    /// <summary>O formato do cofre quando a mudança foi feita: ela não o subiu. O 4, que veio depois, o migra ao abrir.</summary>
    private const int FormatBeforeTheProtections = 3;

    private static readonly Guid FolderID = Guid.Parse("0199e0a0-0000-7000-8000-0000000000c1");
    private static readonly Guid ConnectionID = Guid.Parse("0199e0a0-0000-7000-8000-0000000000c2");
    private static readonly DateTime SavedAt = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-protections-").FullName;

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private string VaultPath
        => Path.Combine(_directory, "vaults", $"{UserName}.vault.json");

    private VaultService CreateService()
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));

        return new VaultService(new VaultFileClient(options, Logger.None), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);
    }

    /// <summary>O documento como o código de antes o gravava: a pasta até a cor, a conexão até as datas, sem script e com a área de trabalho vazia.</summary>
    private static byte[] DocumentWithoutTheProtections()
        => Encoding.UTF8.GetBytes($$$"""
            {"UserName":"{{{UserName}}}","Folders":[{"ID":"{{{FolderID}}}","ParentID":null,"Name":"Fábrica","CreatedAt":"2026-10-15T12:00:00Z","UpdatedAt":"2026-10-15T12:00:00Z","EnvironmentName":"Produção","EnvironmentColor":"#FF8A7A","Color":"#7DB2FF"}],"Connections":[{"ID":"{{{ConnectionID}}}","FolderID":"{{{FolderID}}}","Name":"MES Produção","Engine":1,"Host":"192.0.2.10","Port":5432,"Database":"mes","UserName":"leitor","Password":"senha-do-banco-de-exemplo","EnvironmentName":null,"EnvironmentColor":null,"CreatedAt":"2026-10-15T12:00:00Z","UpdatedAt":"2026-10-15T12:00:00Z"}],"Scripts":[],"Workspace":{"Tabs":[],"ActiveIndex":null}}
            """);

    /// <summary>Monta o arquivo como o `VaultService.CreateAsync` monta: a chave do cofre embrulhada pela chave da senha, e o conteúdo cifrado pela chave do cofre.</summary>
    private void WriteVaultWithoutTheProtections()
    {
        var kdf = VaultFakers.CreateKdf();
        var associatedData = VaultCrypto.AssociatedData(FormatBeforeTheProtections, kdf);
        var passwordKey = VaultCrypto.DeriveKey(Password, kdf);
        var key = VaultCrypto.NewKey();
        var file = new VaultFile(FormatBeforeTheProtections, kdf, VaultCrypto.Seal(passwordKey, key, associatedData), VaultCrypto.Seal(key, DocumentWithoutTheProtections(), associatedData));

        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
        File.WriteAllBytes(VaultPath, JsonSerializer.SerializeToUtf8Bytes(file, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    [Trait("VaultProtections", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre sem as proteções e sem a verificação abre com os campos nulos, e a gravação seguinte o regrava com eles")]
    public async Task Unlock_VaultWithoutTheProtections_OpensAndIsRewrittenWithThem()
    {
        //Arrange
        WriteVaultWithoutTheProtections();
        var service = CreateService();

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);
        var openedFolder = service.Read().Value.Folders.Single();
        var openedConnection = service.Read().Value.Connections.Single();
        var saved = await service.SaveAsync(document => document with
        {
            Folders = [.. document.Folders.Select(folder => folder with { ConfirmCommands = "irreversible", ReadOnly = true })],
            Connections = [.. document.Connections.Select(connection => connection with { ConfirmCommands = "all", ReadOnly = true, VerificationEnabled = false, VerificationInterval = 120, VerificationQuery = "SELECT 1" })],
        }, CancellationToken.None);
        service.Lock();
        var reopenedService = CreateService();
        var reopened = await reopenedService.UnlockAsync(UserName, Password, CancellationToken.None);
        var rewrittenFolder = reopenedService.Read().Value.Folders.Single();
        var rewrittenConnection = reopenedService.Read().Value.Connections.Single();

        //Assert
        using var header = JsonDocument.Parse(File.ReadAllBytes(VaultPath));
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(new VaultFolderRecord(FolderID, null, "Fábrica", SavedAt, SavedAt, "Produção", "#FF8A7A", "#7DB2FF"), openedFolder);
        Assert.Null(openedFolder.ConfirmCommands);
        Assert.Null(openedFolder.ReadOnly);
        Assert.Equal(new VaultConnectionRecord(ConnectionID, FolderID, "MES Produção", EDatabaseEngine.PostgreSql, "192.0.2.10", 5432, "mes", "leitor", "senha-do-banco-de-exemplo", null, null, SavedAt, SavedAt), openedConnection);
        Assert.Null(openedConnection.ConfirmCommands);
        Assert.Null(openedConnection.ReadOnly);
        Assert.Null(openedConnection.VerificationEnabled);
        Assert.Null(openedConnection.VerificationInterval);
        Assert.Null(openedConnection.VerificationQuery);
        Assert.True(saved.IsSuccess);
        Assert.True(reopened.IsSuccess);
        Assert.Equal(openedFolder with { ConfirmCommands = "irreversible", ReadOnly = true }, rewrittenFolder);
        Assert.Equal(openedConnection with { ConfirmCommands = "all", ReadOnly = true, VerificationEnabled = false, VerificationInterval = 120, VerificationQuery = "SELECT 1" }, rewrittenConnection);
        Assert.Equal(VaultCrypto.Version, header.RootElement.GetProperty("version").GetInt32());
    }
}
