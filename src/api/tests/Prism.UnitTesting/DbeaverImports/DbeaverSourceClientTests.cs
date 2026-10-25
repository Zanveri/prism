using Moq;
using Prism.Infrastructure.DbeaverSources.Clients;
using Prism.Infrastructure.DbeaverSources.Models;
using Prism.Infrastructure.DbeaverSources.Services;
using Prism.Infrastructure.Transfers.Clients;
using Prism.Infrastructure.Transfers.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Dbeaver;
using Serilog.Core;
using System.Text;
using System.Text.Json;

namespace Prism.UnitTesting.DbeaverImports;

/// <summary>
/// RN-DBEAVER-006 e 008: a cópia dos arquivos do DBeaver na pasta `transfers` e a cifra do `credentials-config.json`, em pastas temporárias de verdade e com arquivos
/// SINTÉTICOS cifrados aqui, no próprio teste, com a chave pública do DBeaver e um IV conhecido ou sorteado.
/// </summary>
public sealed class DbeaverSourceClientTests : IDisposable
{
    private readonly string _data = Directory.CreateTempSubdirectory("prism-dbeaver-").FullName;

    private string Transfers => Path.Combine(_data, "transfers");

    public DbeaverSourceClientTests()
        => Directory.CreateDirectory(Transfers);

    public void Dispose()
        => Directory.Delete(_data, recursive: true);

    private DbeaverSourceClient CreateClient()
        => new(TransferSettings.For(_data), Logger.None);

    private DbeaverCopyBuilder Builder()
        => new(Transfers);

    [Trait("DbeaverSourceClient", "Read")]
    [Fact(DisplayName = "OK lê o manifesto e só os cinco nomes de arquivo conhecidos de cada projeto, em ordem ordinal")]
    public void Read_ReadsOnlyTheKnownFiles()
    {
        //Arrange
        var builder = Builder().Where("flatpak")
            .Project("General", project => project
                .DataSources("{}").DataSources("{}", "-2").DataSources("{}", "-backup")
                .Credentials("{}").Credentials("{}", "-2").Settings("{}")
                .Add("data-sources.txt", "x").Add("outro.json", "{}").Add("credentials-config-.json", "x").Add("data-sources-com espaço.json", "{}").Add("notas.md", "x"))
            .Project("Vendas", project => project.DataSources("{}"));
        var sourceId = builder.Build();

        //Act
        var read = CreateClient().Read(sourceId);

        //Assert
        Assert.True(read.IsSuccess);
        Assert.Equal("flatpak", read.Value.Where);
        Assert.Equal([("General", 1), ("Vendas", 2)], read.Value.Projects.Select(project => (project.Name, project.Position)));
        Assert.Equal(["credentials-config-2.json", "credentials-config.json", "data-sources-2.json", "data-sources-backup.json", "data-sources.json", "project-settings.json"], read.Value.Projects[0].Files.Select(file => file.Name));
        Assert.All(read.Value.Projects[0].Files, file => Assert.NotNull(file.Content));
    }

    [Trait("DbeaverSourceClient", "Read")]
    [Fact(DisplayName = "ERRO a cópia que não existe, ou sem o manifesto, é Missing")]
    public void Read_Missing()
    {
        //Arrange
        var withoutManifest = Builder();
        Directory.CreateDirectory(withoutManifest.Folder);

        //Act and Assert
        Assert.Equal(EDbeaverSourceError.Missing, CreateClient().Read(Guid.NewGuid()).Error);
        Assert.Equal(EDbeaverSourceError.Missing, CreateClient().Read(withoutManifest.SourceId).Error);
    }

    [Trait("DbeaverSourceClient", "Read")]
    [Theory(DisplayName = "ERRO o manifesto que o processo principal não escreve é Invalid")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""{"version":2,"where":"standard","projects":[]}""")]
    [InlineData("""{"version":"1","where":"standard","projects":[]}""")]
    [InlineData("""{"version":1,"where":"outro","projects":[]}""")]
    [InlineData("""{"version":1,"where":"standard"}""")]
    public void Read_InvalidManifest(string manifest)
    {
        //Arrange
        var builder = Builder();
        Directory.CreateDirectory(builder.Folder);
        File.WriteAllText(Path.Combine(builder.Folder, "manifest.json"), manifest);

        //Act
        var read = CreateClient().Read(builder.SourceId);

        //Assert
        Assert.Equal(EDbeaverSourceError.Invalid, read.Error);
    }

    [Trait("DbeaverSourceClient", "Read")]
    [Fact(DisplayName = "OK a pasta de projeto do manifesto que não é 1 a 50, e a repetida, são ignoradas")]
    public void Read_IgnoresProjectFoldersOutsideOneToFifty()
    {
        //Arrange
        var builder = Builder();
        Directory.CreateDirectory(builder.Folder);
        Directory.CreateDirectory(Path.Combine(builder.Folder, "1"));
        File.WriteAllText(Path.Combine(builder.Folder, "1", "data-sources.json"), "{}");
        File.WriteAllText(Path.Combine(builder.Folder, "manifest.json"), """{"version":1,"where":"chosen","projects":[{"folder":"0","name":"A"},{"folder":"51","name":"B"},{"folder":"../1","name":"C"},{"folder":"01","name":"D"},{"folder":"1","name":"General"},{"folder":"1","name":"Repetido"},{"folder":"2","name":"General"},{"folder":"abc","name":"E"}]}""");

        //Act
        var read = CreateClient().Read(builder.SourceId);

        //Assert
        Assert.Equal([("General", 5)], read.Value.Projects.Select(project => (project.Name, project.Position)));
    }

    [Trait("DbeaverSourceClient", "Read")]
    [Fact(DisplayName = "OK o arquivo com mais de 5 MiB vem sem conteúdo, e o atalho não é seguido")]
    public void Read_OversizedAndSymbolicLinks_HaveNoContent()
    {
        //Arrange
        var builder = Builder().Project("General", project => project.DataSources("{}").Add("data-sources-grande.json", new byte[DbeaverSourceClient.MaxFileBytes + 1]));
        var sourceId = builder.Build();
        var outside = Path.Combine(_data, "fora.json");
        File.WriteAllText(outside, """{"connections":{}}""");
        var linked = false;
        if (!OperatingSystem.IsWindows())
        {
            File.CreateSymbolicLink(Path.Combine(builder.Folder, "1", "data-sources-atalho.json"), outside);
            linked = true;
        }

        //Act
        var files = CreateClient().Read(sourceId).Value.Projects[0].Files.ToDictionary(file => file.Name);

        //Assert
        Assert.NotNull(files["data-sources.json"].Content);
        Assert.Null(files["data-sources-grande.json"].Content);
        if (linked)
            Assert.Null(files["data-sources-atalho.json"].Content);
    }

    [Trait("DbeaverSourceClient", "Delete")]
    [Fact(DisplayName = "OK apaga a pasta da cópia com o que tem dentro, e a que não existe não é erro; DeleteAll deixa a .part")]
    public void Delete_AndDeleteAll()
    {
        //Arrange
        var first = Builder().Project("General", project => project.DataSources("{}"));
        var second = Builder().Project("General", project => project.DataSources("{}"));
        first.Build();
        second.Build();
        var half = Path.Combine(Transfers, $"{Guid.NewGuid():D}.dbeaver.part");
        Directory.CreateDirectory(half);
        var client = CreateClient();

        //Act
        client.Delete(first.SourceId);
        client.Delete(Guid.NewGuid());
        var afterOne = Directory.Exists(first.Folder);
        client.DeleteAll();

        //Assert
        Assert.False(afterOne);
        Assert.False(Directory.Exists(second.Folder));
        Assert.True(Directory.Exists(half));
    }

    [Trait("DbeaverSourceClient", "Prepare")]
    [Fact(DisplayName = "OK a partida apaga as pastas da cópia do DBeaver com o que têm dentro, a pronta e a .part (RN-EXPORT-018)")]
    public void Prepare_DeletesTheDbeaverFolders()
    {
        //Arrange
        var ready = Builder().Project("General", project => project.DataSources("{}"));
        ready.Build();
        var half = Path.Combine(Transfers, $"{Guid.NewGuid():D}.dbeaver.part", "1");
        Directory.CreateDirectory(half);
        File.WriteAllText(Path.Combine(half, "credentials-config.json"), "x");
        File.WriteAllText(Path.Combine(Transfers, $"{Guid.NewGuid():D}.in"), "x");

        //Act
        new TransferFileClient(TransferSettings.For(_data), Logger.None).Prepare();

        //Assert
        Assert.Empty(Directory.GetFileSystemEntries(Transfers));
    }

    [Trait("DbeaverSourceClient", "Decrypt")]
    [Fact(DisplayName = "OK decifra o credentials-config cifrado com a chave pública do DBeaver e um IV conhecido, e com um IV sorteado")]
    public void Decrypt_WithAKnownAndARandomIv()
    {
        //Arrange
        const string json = """{"id-1":{"#connection":{"user":"fulano","password":"senha-fictícia-é-ç"}}}""";
        var known = DbeaverCopyBuilder.Encrypt(json, new byte[16]);
        var random = DbeaverCopyBuilder.Encrypt(json);

        //Act
        var fromKnown = CreateClient().Decrypt(known, root => root.GetRawText());
        var fromRandom = CreateClient().Decrypt(random, root => root.GetRawText());

        //Assert
        Assert.Equal(json, fromKnown.Value);
        Assert.Equal(json, fromRandom.Value);
        Assert.NotEqual(known, random);
        Assert.Equal(new byte[16], known[..16]);
    }

    [Trait("DbeaverSourceClient", "Decrypt")]
    [Fact(DisplayName = "OK o IV errado só estraga o primeiro bloco (o do próprio IV): com o IV zero os 16 primeiros bytes saem lixo e o resto sai certo")]
    public void Decrypt_ZeroIv_OnlyTheFirstBlockIsGarbage()
    {
        //Arrange
        var iv = Enumerable.Range(1, 16).Select(value => (byte)value).ToArray();
        var file = DbeaverCopyBuilder.Encrypt("""{"a":{"#connection":{"user":"fulano"}},"b":1}""", iv);
        using var aes = System.Security.Cryptography.Aes.Create();
        aes.Key = Convert.FromHexString("babb4a9f774ab853c96c2d653dfe544a");

        //Act
        var wrongIv = aes.DecryptCbc(file.AsSpan(16), new byte[16], System.Security.Cryptography.PaddingMode.PKCS7);

        //Assert: o que o `openssl` com o IV zero entrega: o conteúdo cifrado a partir do IV é o do arquivo, sem os 16 primeiros bytes do IV; só o primeiro bloco do texto muda.
        var text = Encoding.UTF8.GetString(wrongIv);
        Assert.EndsWith("""on":{"user":"fulano"}},"b":1}""", text);
        Assert.False(text.StartsWith("{\"a\"", StringComparison.Ordinal));
    }

    [Trait("DbeaverSourceClient", "Decrypt")]
    [Theory(DisplayName = "ERRO o arquivo com menos de 32 bytes, ou de um tamanho que não é múltiplo de 16, não é decifrado")]
    [InlineData(0)]
    [InlineData(16)]
    [InlineData(31)]
    [InlineData(47)]
    [InlineData(33)]
    public void Decrypt_WrongSize(int size)
        => Assert.Equal(EDbeaverCredentialsError.Undecryptable, CreateClient().Decrypt(new byte[size], root => root.GetRawText()).Error);

    [Trait("DbeaverSourceClient", "Decrypt")]
    [Fact(DisplayName = "ERRO o preenchimento que não confere é Undecryptable")]
    public void Decrypt_WrongPadding()
    {
        //Arrange: o último bloco trocado por um que, com esta chave e este IV fixos, não termina num preenchimento válido
        var file = DbeaverCopyBuilder.Encrypt("""{"a":1}""", new byte[16]);
        for (var index = 16; index < file.Length; index++)
            file[index] = (byte)(index * 7 + 3);

        //Act
        var decrypted = CreateClient().Decrypt(file, root => root.GetRawText());

        //Assert
        Assert.True(decrypted.IsFailure);
        Assert.Contains(decrypted.Error, new[] { EDbeaverCredentialsError.Undecryptable, EDbeaverCredentialsError.Invalid });
    }

    [Trait("DbeaverSourceClient", "Decrypt")]
    [Theory(DisplayName = "ERRO o que decifra mas não é um objeto JSON é Invalid")]
    [InlineData("não é json")]
    [InlineData("[1,2]")]
    [InlineData("\"texto\"")]
    public void Decrypt_NotAJsonObject(string content)
        => Assert.Equal(EDbeaverCredentialsError.Invalid, CreateClient().Decrypt(DbeaverCopyBuilder.Encrypt(content), root => root.GetRawText()).Error);

    [Trait("DbeaverSourceClient", "ReadJson")]
    [Fact(DisplayName = "OK lê o JSON até 64 níveis, sem comentários; o que não lê é nenhum valor, sem a mensagem da exceção")]
    public void ReadJson_LimitsAndComments()
    {
        //Arrange
        var client = CreateClient();
        var deep = string.Concat(Enumerable.Repeat("[", 70)) + string.Concat(Enumerable.Repeat("]", 70));
        var allowed = string.Concat(Enumerable.Repeat("[", 60)) + string.Concat(Enumerable.Repeat("]", 60));

        //Act and Assert
        Assert.True(client.ReadJson(Encoding.UTF8.GetBytes("""{"a":1}"""), root => root.GetRawText()).HasValue);
        Assert.True(client.ReadJson(Encoding.UTF8.GetBytes(allowed), root => root.ValueKind).HasValue);
        Assert.True(client.ReadJson(Encoding.UTF8.GetBytes(deep), root => root.ValueKind).HasNoValue);
        Assert.True(client.ReadJson(Encoding.UTF8.GetBytes("""{"a":1 /* x */}"""), root => root.GetRawText()).HasNoValue);
        Assert.True(client.ReadJson(Encoding.UTF8.GetBytes("""{"a":"\ud800"}"""), root => root.GetProperty("a").GetString()).HasNoValue);
    }

    [Trait("DbeaverSourceService", "Locked")]
    [Fact(DisplayName = "OK fechar o cofre apaga as cópias do DBeaver (RN-COFRE-008)")]
    public void Service_DeletesTheCopiesWhenTheVaultLocks()
    {
        //Arrange
        var copy = Builder().Project("General", project => project.DataSources("{}"));
        copy.Build();
        var vault = new Mock<IVaultService>();
        using var service = new DbeaverSourceService(CreateClient(), vault.Object);

        //Act
        vault.Raise(v => v.Locked += null);

        //Assert
        Assert.False(Directory.Exists(copy.Folder));
    }

    [Trait("DbeaverCrypto", "PublicKey")]
    [Fact(DisplayName = "OK a constante da API é a chave do comando openssl da especificação")]
    public void Crypto_PublicKey_IsTheOneFromTheSpecification()
        => Assert.Equal("babb4a9f774ab853c96c2d653dfe544a", DbeaverCrypto.PublicKeyHex);

    [Trait("DbeaverCrypto", "Json")]
    [Fact(DisplayName = "OK o ToString da cópia não imprime o conteúdo")]
    public void Source_ToString_DoesNotPrintTheContent()
    {
        //Act
        var text = new DbeaverFile("credentials-config.json", Encoding.UTF8.GetBytes("segredo")).ToString() + new DbeaverSource("standard", []).ToString();

        //Assert
        Assert.DoesNotContain("segredo", text);
        Assert.IsType<JsonElement>(default(JsonElement));
    }
}
