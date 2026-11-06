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
/// RN-VAR-028 e RN-VERSAO-005: os valores lembrados entraram no registro do script (`VaultScriptRecord.RunValues`) SEM subir o formato do cofre, nos dois sentidos,
/// como o lugar do resultado da seção 39 (`VaultWorkspaceResultPlaceTests`). Para trás: o cofre do formato 4 gravado pela 0.4.0, com o script sem o campo, abre
/// com ele nulo, e a gravação seguinte o escreve. Para a frente: a 0.4.0, a 0.5.0, a 0.6.0 e a 0.6.1-beta.5 leem o documento com o
/// `JsonSerializer.Deserialize&lt;VaultDocument&gt;` de opções padrão, sem `UnmappedMemberHandling` em nenhum registro (conferido nas tags), e o registro do
/// script da 0.4.0 é o de hoje sem o campo no fim: o teste lê o que esta versão grava com uma cópia daquele registro, e o membro novo é pulado. O conteúdo é
/// escrito à mão e cifrado como o serviço cifra.
/// </summary>
public sealed class VaultScriptRunValuesTests : IDisposable
{
    private const string UserName = "marina.costa";
    private const string Password = "senha-do-teste-dos-valores-lembrados";

    /// <summary>O formato do cofre da 0.4.0, que continua o atual: o campo novo não o sobe.</summary>
    private const int FormatOfTheRunValues = 4;

    private static readonly Guid ScriptID = Guid.Parse("0199c3a0-0000-7000-8000-0000000000c1");

    /// <summary>O registro do script como a 0.4.0 o declara (`git show v0.4.0:src/api/Prism.Infrastructure/Vault/Models/VaultScriptRecord.cs`).</summary>
    private sealed record ScriptRecordOfVersionFour(Guid ID, string Name, string Sql, Guid? ConnectionID, string? Database, DateTime CreatedAt, DateTime UpdatedAt, string? Icon = null, string? Color = null, Guid? FolderID = null);

    /// <summary>O script como a 0.4.0 o gravava: os dez campos, sem os valores lembrados (as chaves em PascalCase, as opções padrão do cofre).</summary>
    private const string ScriptOfVersionFour = """{"ID":"0199c3a0-0000-7000-8000-0000000000c1","Name":"Relatório","Sql":"let x = 1\nSELECT @x","ConnectionID":null,"Database":null,"CreatedAt":"2026-10-01T12:00:00Z","UpdatedAt":"2026-10-01T12:00:00Z","Icon":null,"Color":null,"FolderID":null}""";

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-run-values-").FullName;

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private string VaultPath
        => Path.Combine(_directory, "vaults", $"{UserName}.vault.json");

    private VaultService CreateService()
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));

        return new VaultService(new VaultFileClient(options, Logger.None), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);
    }

    private static byte[] DocumentWith(string script)
        => Encoding.UTF8.GetBytes($$"""
            {"UserName":"{{UserName}}","Folders":[],"Connections":[],"Scripts":[{{script}}],"Workspace":{"Tabs":[],"ActiveIndex":null},"ScriptFolders":[]}
            """);

    /// <summary>Monta o arquivo como o `VaultService.CreateAsync` monta: a chave do cofre embrulhada pela chave da senha, e o conteúdo cifrado pela chave do cofre.</summary>
    private void WriteVault(byte[] document)
    {
        var kdf = VaultFakers.CreateKdf();
        var associatedData = VaultCrypto.AssociatedData(FormatOfTheRunValues, kdf);
        var passwordKey = VaultCrypto.DeriveKey(Password, kdf);
        var key = VaultCrypto.NewKey();
        var file = new VaultFile(FormatOfTheRunValues, kdf, VaultCrypto.Seal(passwordKey, key, associatedData), VaultCrypto.Seal(key, document, associatedData));

        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
        File.WriteAllBytes(VaultPath, JsonSerializer.SerializeToUtf8Bytes(file, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);

        return document.RootElement.Clone();
    }

    [Trait("VaultScriptRunValues", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre da 0.4.0, com o script sem os valores lembrados, abre com eles nulos, e a gravação seguinte os escreve no formato 4")]
    public async Task Unlock_VaultWithoutTheRunValues_OpensAndIsRewrittenWithThem()
    {
        //Arrange
        Assert.Equal(FormatOfTheRunValues, VaultCrypto.Version);
        WriteVault(DocumentWith(ScriptOfVersionFour));
        var service = CreateService();
        var values = """{"x":{"type":"number","value":"7"},"variável":{"type":"list","items":[{"type":"text","value":"ação"}]}}""";
        var savedAt = new DateTime(2026, 11, 5, 12, 0, 0, DateTimeKind.Utc);

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);
        var opened = service.Read().Value.Scripts.Single();
        var saved = await service.SaveAsync(document => document with { Scripts = [document.Scripts[0] with { RunValues = new VaultScriptRunValuesRecord(Json(values), null, null, savedAt) }] }, CancellationToken.None);
        service.Lock();
        var reopenedService = CreateService();
        var reopened = await reopenedService.UnlockAsync(UserName, Password, CancellationToken.None);
        var rewritten = reopenedService.Read().Value.Scripts.Single();

        //Assert
        using var header = JsonDocument.Parse(File.ReadAllBytes(VaultPath));
        Assert.True(unlocked.IsSuccess);
        Assert.Null(opened.RunValues);
        Assert.Equal((ScriptID, "Relatório", "let x = 1\nSELECT @x"), (opened.ID, opened.Name, opened.Sql));
        Assert.True(saved.IsSuccess);
        Assert.True(reopened.IsSuccess);
        Assert.NotNull(rewritten.RunValues);
        Assert.Equal(JsonSerializer.Serialize(Json(values)), JsonSerializer.Serialize(rewritten.RunValues.Values));
        Assert.Equal("ação", rewritten.RunValues.Values.GetProperty("variável").GetProperty("items")[0].GetProperty("value").GetString());
        Assert.Equal((null, null, savedAt), (rewritten.RunValues.ConnectionID, rewritten.RunValues.Database, rewritten.RunValues.SavedAt));
        Assert.Equal(opened with { RunValues = null }, rewritten with { RunValues = null });
        Assert.Equal(FormatOfTheRunValues, header.RootElement.GetProperty("version").GetInt32());
    }

    /// <summary>
    /// A versão anterior abre o que esta grava: o documento serializado como o `VaultService` serializa (opções padrão), com os valores lembrados, lido com a
    /// cópia do registro do script da 0.4.0 e as opções padrão da leitura dela. O membro `RunValues` é pulado, e o resto do script chega como está.
    /// </summary>
    [Trait("VaultScriptRunValues", "Deserialize")]
    [Fact(DisplayName = "OK o registro do script da 0.4.0 lê o que esta versão grava e pula os valores lembrados")]
    public void Deserialize_TheRecordOfVersionFour_SkipsTheRunValues()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var createdAt = new DateTime(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc);
        var record = new VaultScriptRecord(ScriptID, "Relatório", "SELECT @x", connectionID, "vendas", createdAt, createdAt, "chart", "#F2B644", null,
            new VaultScriptRunValuesRecord(Json("""{"x":{"type":"list","items":[{"type":"null","value":null}]}}"""), connectionID, "vendas", createdAt));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new VaultDocument(UserName, [], [], [record], VaultWorkspaceRecord.Empty, []));

        //Act
        using var written = JsonDocument.Parse(bytes);
        var read = JsonSerializer.Deserialize<ScriptRecordOfVersionFour[]>(written.RootElement.GetProperty("Scripts").GetRawText())!;

        //Assert
        Assert.True(written.RootElement.GetProperty("Scripts")[0].TryGetProperty("RunValues", out _));
        Assert.Equal([new ScriptRecordOfVersionFour(ScriptID, "Relatório", "SELECT @x", connectionID, "vendas", createdAt, createdAt, "chart", "#F2B644", null)], read);
    }

    [Trait("VaultScriptRunValues", "UnlockAsync")]
    [Fact(DisplayName = "OK os valores lembrados com membros que o leitor não conhece abrem, e o resto do script chega como está")]
    public async Task Unlock_RunValuesWithMembersTheReaderDoesNotKnow_Opens()
    {
        //Arrange
        var script = $$$"""{{{ScriptOfVersionFour[..^1]}}},"RunValues":{"Values":{"x":{"type":"text","value":"a"}},"ConnectionID":null,"Database":null,"SavedAt":"2026-11-05T12:00:00Z","CampoFuturo":[1]},"OutroCampoFuturo":true}""";
        WriteVault(DocumentWith(script));
        var service = CreateService();

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);

        //Assert
        Assert.True(unlocked.IsSuccess);
        var opened = service.Read().Value.Scripts.Single();
        Assert.Equal("""{"x":{"type":"text","value":"a"}}""", opened.RunValues!.Values.GetRawText());
        Assert.Equal(("Relatório", null), (opened.Name, opened.FolderID));
    }
}
