using Microsoft.Extensions.Options;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using Serilog.Core;
using System.Text;
using System.Text.Json;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>
/// RN-DBEAVER-018 e RN-VERSAO-005: a origem da conexão (`Origin`) e o que o cofre guarda do DBeaver (`Dbeaver`: o convite e a última importação) entraram na
/// 0.5.0 SEM subir o formato do cofre, nos dois sentidos, como o lugar do resultado (RN-ABAS-016).
///
/// Para trás: o cofre do formato 4 gravado pela 0.4.0, sem os campos, abre com eles nulos, e a gravação seguinte os escreve. Para a frente: o leitor da 0.4.0
/// é o `JsonSerializer.Deserialize&lt;VaultDocument&gt;` com as opções padrão (`VaultService.Unlock`, o mesmo no `v0.4.0`), sobre os records daquela versão; os
/// `Legacy*` abaixo são esses records, copiados como estavam, sem os campos novos. O teste serializa um documento com os campos preenchidos, como o serviço
/// o serializa, e o lê com eles: abre, ignora o que não conhece e entrega o resto igual. O conteúdo é escrito à mão e cifrado como o serviço cifra.
/// </summary>
public sealed class VaultDbeaverFieldsTests : IDisposable
{
    private const string UserName = "marina.costa";
    private const string Password = "senha-do-teste-do-dbeaver";

    /// <summary>O formato do cofre da 0.4.0, que continua o atual: os campos novos não o sobem.</summary>
    private const int FormatOfTheDbeaverFields = 4;

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-dbeaver-").FullName;

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private string VaultPath
        => Path.Combine(_directory, "vaults", $"{UserName}.vault.json");

    private VaultService CreateService()
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));

        return new VaultService(new VaultFileClient(options, Logger.None), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);
    }

    private void WriteVault(byte[] document)
    {
        var kdf = VaultFakers.CreateKdf();
        var associatedData = VaultCrypto.AssociatedData(FormatOfTheDbeaverFields, kdf);
        var passwordKey = VaultCrypto.DeriveKey(Password, kdf);
        var key = VaultCrypto.NewKey();
        var file = new VaultFile(FormatOfTheDbeaverFields, kdf, VaultCrypto.Seal(passwordKey, key, associatedData), VaultCrypto.Seal(key, document, associatedData));

        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
        File.WriteAllBytes(VaultPath, JsonSerializer.SerializeToUtf8Bytes(file, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    private const string ConnectionOfVersionFour = """{"ID":"0199c3a0-0000-7000-8000-0000000000c1","FolderID":null,"Name":"Estoque DEV","Engine":3,"Host":"ifx-dev.exemplo.invalid","Port":9089,"Database":"estoque","UserName":"fulano","Password":"senha-inventada","EnvironmentName":"Desenvolvimento","EnvironmentColor":null,"CreatedAt":"2026-10-01T10:00:00Z","UpdatedAt":"2026-10-01T10:00:00Z","ConfirmCommands":null,"ReadOnly":null,"VerificationEnabled":null,"VerificationInterval":null,"VerificationQuery":null}""";

    private static byte[] DocumentOfVersionFour(string extraInTheConnection = "", string extraInTheDocument = "")
        => Encoding.UTF8.GetBytes($$"""
            {"UserName":"{{UserName}}","Folders":[],"Connections":[{{ConnectionOfVersionFour[..^1]}}{{extraInTheConnection}}}],"Scripts":[],"Workspace":{"Tabs":[],"ActiveIndex":null},"ScriptFolders":[]{{extraInTheDocument}}}
            """);

    [Trait("VaultDbeaverFields", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre da 0.4.0, sem a origem nem o estado do DBeaver, abre com eles nulos, e a gravação seguinte os escreve")]
    public async Task Unlock_VaultWithoutTheDbeaverFields_OpensAndIsRewrittenWithThem()
    {
        //Arrange
        Assert.Equal(FormatOfTheDbeaverFields, VaultCrypto.Version);
        WriteVault(DocumentOfVersionFour());
        var service = CreateService();
        var invitedAt = new DateTime(2026, 10, 20, 14, 32, 0, DateTimeKind.Utc);
        var origin = new VaultConnectionOrigin(VaultConnectionOrigin.DbeaverSource, "General", "informix-1999a18bee0-1d368a39432da0b3");

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);
        var opened = service.Read().Value;
        var saved = await service.SaveAsync(document => document with
        {
            Connections = [document.Connections[0] with { Origin = origin }],
            Dbeaver = new VaultDbeaverRecord(invitedAt, invitedAt)
        }, CancellationToken.None);
        service.Lock();
        var reopenedService = CreateService();
        var reopened = await reopenedService.UnlockAsync(UserName, Password, CancellationToken.None);
        var rewritten = reopenedService.Read().Value;

        //Assert
        using var header = JsonDocument.Parse(File.ReadAllBytes(VaultPath));
        Assert.True(unlocked.IsSuccess);
        Assert.Null(opened.Dbeaver);
        Assert.Null(opened.Connections[0].Origin);
        Assert.Equal(("Estoque DEV", EDatabaseEngine.Informix, 9089), (opened.Connections[0].Name, opened.Connections[0].Engine, opened.Connections[0].Port));
        Assert.True(saved.IsSuccess);
        Assert.True(reopened.IsSuccess);
        Assert.Equal(origin, rewritten.Connections[0].Origin);
        Assert.Equal(new VaultDbeaverRecord(invitedAt, invitedAt), rewritten.Dbeaver);
        Assert.Equal(FormatOfTheDbeaverFields, header.RootElement.GetProperty("version").GetInt32());
    }

    [Trait("VaultDbeaverFields", "UnlockAsync")]
    [Fact(DisplayName = "OK o campo que o leitor não conhece, na conexão e no documento, é ignorado, e o cofre abre")]
    public async Task Unlock_VaultWithMembersTheReaderDoesNotKnow_Opens()
    {
        //Arrange
        WriteVault(DocumentOfVersionFour(extraInTheConnection: ",\"Origin\":{\"Source\":\"dbeaver\",\"Project\":\"General\",\"ID\":\"x\",\"CampoDeUmaVersaoFutura\":[1]}", extraInTheDocument: ",\"Dbeaver\":{\"InvitedAt\":null,\"LastImportAt\":null,\"OutroCampoFuturo\":true}"));
        var service = CreateService();

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);

        //Assert
        Assert.True(unlocked.IsSuccess);
        var document = service.Read().Value;
        Assert.Equal(new VaultConnectionOrigin("dbeaver", "General", "x"), document.Connections[0].Origin);
        Assert.Equal(new VaultDbeaverRecord(null, null), document.Dbeaver);
    }

    /// <summary>O leitor da 0.4.0: os records do `v0.4.0`, sem os campos novos, lidos pelo `JsonSerializer` com as opções padrão, como o `VaultService.Unlock` dela os lê.</summary>
    [Trait("VaultDbeaverFields", "Version040Reader")]
    [Fact(DisplayName = "OK o cofre gravado com a origem e o estado do DBeaver abre no leitor da 0.4.0, que os ignora e entrega o resto igual")]
    public void Version040Reader_ReadsTheDocumentWrittenWithTheDbeaverFields()
    {
        //Arrange
        var connection = VaultFakers.CreateConnection(name: "Estoque DEV", host: "ifx-dev.exemplo.invalid", userName: "fulano", password: "senha-inventada", engine: EDatabaseEngine.Informix) with
        {
            Origin = new VaultConnectionOrigin(VaultConnectionOrigin.DbeaverSource, "Vendas", "informix-1999a18bee0-1d368a39432da0b3")
        };
        var invitedAt = new DateTime(2026, 10, 20, 14, 32, 0, DateTimeKind.Utc);
        var document = new VaultDocument(UserName, [VaultFakers.CreateFolder(name: "Estoque")], [connection], [VaultFakers.CreateScript()], VaultWorkspaceRecord.Empty, [], new VaultDbeaverRecord(invitedAt, invitedAt));

        //Act
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(document);
        var read = JsonSerializer.Deserialize<LegacyVaultDocument>(plaintext)!;

        //Assert
        using var json = JsonDocument.Parse(plaintext);
        Assert.Equal("Vendas", json.RootElement.GetProperty("Connections")[0].GetProperty("Origin").GetProperty("Project").GetString());
        Assert.Equal(UserName, read.UserName);
        Assert.Single(read.Folders);
        Assert.Single(read.Scripts);
        var legacy = Assert.Single(read.Connections);
        Assert.Equal((connection.ID, connection.Name, connection.Host, connection.Port, connection.Database, connection.UserName, connection.Password, connection.Engine), (legacy.ID, legacy.Name, legacy.Host, legacy.Port, legacy.Database, legacy.UserName, legacy.Password, legacy.Engine));
    }

    /// <summary>A conexão e o documento como a 0.4.0 os declarava (`v0.4.0`), sem `Origin` nem `Dbeaver`.</summary>
    private sealed record LegacyConnection(Guid ID, Guid? FolderID, string Name, EDatabaseEngine Engine, string Host, int Port, string Database, string UserName, string Password, string? EnvironmentName, string? EnvironmentColor, DateTime CreatedAt, DateTime UpdatedAt, string? ConfirmCommands = null, bool? ReadOnly = null, bool? VerificationEnabled = null, int? VerificationInterval = null, string? VerificationQuery = null);

    private sealed record LegacyVaultDocument(string UserName, IReadOnlyList<VaultFolderRecord> Folders, IReadOnlyList<LegacyConnection> Connections, IReadOnlyList<VaultScriptRecord> Scripts, VaultWorkspaceRecord Workspace, IReadOnlyList<VaultScriptFolderRecord> ScriptFolders);
}
