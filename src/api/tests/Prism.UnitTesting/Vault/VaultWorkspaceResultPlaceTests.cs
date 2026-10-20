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
/// RN-ABAS-016 e RN-VERSAO-005: o lugar do resultado entrou no registro da aba gravada (`VaultWorkspaceTabRecord.ResultPlace`) na 0.5.0 SEM subir o formato do
/// cofre, nos dois sentidos. Para trás: o cofre do formato 4 gravado pela 0.4.0, com as abas sem o campo, abre com ele nulo (a aba volta no painel), e a
/// gravação seguinte o escreve. Para a frente: a leitura do documento é a de opções padrão do `JsonSerializer` (a mesma desde o formato 1, e a da 0.4.0), que
/// ignora o membro que não conhece; é isso que deixa a 0.4.0 abrir o cofre gravado por esta versão, e este teste prova a regra com membros que nenhuma versão
/// tem. O conteúdo é escrito à mão e cifrado como o serviço cifra.
/// </summary>
public sealed class VaultWorkspaceResultPlaceTests : IDisposable
{
    private const string UserName = "marina.costa";
    private const string Password = "senha-do-teste-do-lugar-do-resultado";

    /// <summary>O formato do cofre da 0.4.0, que continua o atual: o campo novo não o sobe.</summary>
    private const int FormatOfTheResultPlace = 4;

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-result-place-").FullName;

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private string VaultPath
        => Path.Combine(_directory, "vaults", $"{UserName}.vault.json");

    private VaultService CreateService()
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));

        return new VaultService(new VaultFileClient(options, Logger.None), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);
    }

    /// <summary>O documento do formato 4 com uma aba de consulta e uma de tabela, como vieram, e `extra` no fim do documento.</summary>
    private static byte[] DocumentWith(string queryTab, string tableTab, string extra = "")
        => Encoding.UTF8.GetBytes($$"""
            {"UserName":"{{UserName}}","Folders":[],"Connections":[],"Scripts":[],"Workspace":{"Tabs":[{{queryTab}},{{tableTab}}],"ActiveIndex":1},"ScriptFolders":[]{{extra}}}
            """);

    /// <summary>A aba de consulta como a 0.4.0 a gravava: os dez campos, sem o lugar do resultado.</summary>
    private const string QueryTabOfVersionFour = """{"Kind":"query","ConnectionID":null,"Database":null,"Sql":"SELECT 1","ScriptID":null,"Dirty":false,"SqlTooLarge":false,"Schema":null,"Table":null,"View":null}""";

    private const string TableTabOfVersionFour = """{"Kind":"table","ConnectionID":"0199c3a0-0000-7000-8000-0000000000b1","Database":null,"Sql":null,"ScriptID":null,"Dirty":false,"SqlTooLarge":false,"Schema":"loja","Table":"pedidos","View":"data"}""";

    /// <summary>A aba com os campos de `fields` no fim, antes de fechar o objeto.</summary>
    private static string WithFields(string tab, string fields)
        => $"{tab[..^1]},{fields}}}";

    /// <summary>Monta o arquivo como o `VaultService.CreateAsync` monta: a chave do cofre embrulhada pela chave da senha, e o conteúdo cifrado pela chave do cofre.</summary>
    private void WriteVault(byte[] document)
    {
        var kdf = VaultFakers.CreateKdf();
        var associatedData = VaultCrypto.AssociatedData(FormatOfTheResultPlace, kdf);
        var passwordKey = VaultCrypto.DeriveKey(Password, kdf);
        var key = VaultCrypto.NewKey();
        var file = new VaultFile(FormatOfTheResultPlace, kdf, VaultCrypto.Seal(passwordKey, key, associatedData), VaultCrypto.Seal(key, document, associatedData));

        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
        File.WriteAllBytes(VaultPath, JsonSerializer.SerializeToUtf8Bytes(file, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
    }

    [Trait("VaultWorkspaceResultPlace", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre da 0.4.0, com as abas sem o lugar do resultado, abre com ele nulo, e a gravação seguinte o escreve")]
    public async Task Unlock_VaultWithoutTheResultPlace_OpensAndIsRewrittenWithIt()
    {
        //Arrange
        Assert.Equal(FormatOfTheResultPlace, VaultCrypto.Version);
        WriteVault(DocumentWith(QueryTabOfVersionFour, TableTabOfVersionFour));
        var service = CreateService();

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);
        var opened = service.Read().Value.Workspace;
        var saved = await service.SaveAsync(document => document with { Workspace = document.Workspace with { Tabs = [document.Workspace.Tabs[0] with { ResultPlace = "tab" }, document.Workspace.Tabs[1]] } }, CancellationToken.None);
        service.Lock();
        var reopenedService = CreateService();
        var reopened = await reopenedService.UnlockAsync(UserName, Password, CancellationToken.None);
        var rewritten = reopenedService.Read().Value.Workspace;

        //Assert
        using var header = JsonDocument.Parse(File.ReadAllBytes(VaultPath));
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(1, opened.ActiveIndex);
        Assert.Equal([null, null], opened.Tabs.Select(tab => tab.ResultPlace));
        Assert.Equal(("query", "SELECT 1"), (opened.Tabs[0].Kind, opened.Tabs[0].Sql));
        Assert.True(saved.IsSuccess);
        Assert.True(reopened.IsSuccess);
        Assert.Equal(["tab", null], rewritten.Tabs.Select(tab => tab.ResultPlace));
        Assert.Equal(opened.Tabs[1], rewritten.Tabs[1]);
        Assert.Equal(FormatOfTheResultPlace, header.RootElement.GetProperty("version").GetInt32());
    }

    /// <summary>
    /// A regra que deixa a versão anterior abrir o que a seguinte gravou: o membro que o leitor não conhece, na aba, na área de trabalho e no documento, é
    /// ignorado, e o resto abre como está. Os nomes são de propósito de nenhuma versão.
    /// </summary>
    [Trait("VaultWorkspaceResultPlace", "UnlockAsync")]
    [Fact(DisplayName = "OK o membro que o leitor não conhece, na aba, na área de trabalho e no documento, é ignorado, e o cofre abre")]
    public async Task Unlock_VaultWithMembersTheReaderDoesNotKnow_Opens()
    {
        //Arrange
        WriteVault(DocumentWith(WithFields(QueryTabOfVersionFour, "\"ResultPlace\":\"window\",\"CampoDeUmaVersaoFutura\":{\"a\":[1,2]}"), WithFields(TableTabOfVersionFour, "\"OutroCampoFuturo\":true"), extra: ""","ListaDeUmaVersaoFutura":[{"x":1}]"""));
        var service = CreateService();

        //Act
        var unlocked = await service.UnlockAsync(UserName, Password, CancellationToken.None);

        //Assert
        Assert.True(unlocked.IsSuccess);
        var workspace = service.Read().Value.Workspace;
        Assert.Equal(["window", null], workspace.Tabs.Select(tab => tab.ResultPlace));
        Assert.Equal(new VaultWorkspaceTabRecord("table", Guid.Parse("0199c3a0-0000-7000-8000-0000000000b1"), null, null, null, false, false, "loja", "pedidos", "data"), workspace.Tabs[1]);
    }
}
