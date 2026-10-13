using Bogus;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Vault;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.UnitTesting.Vault;

public sealed partial class VaultFileClientTests : IDisposable
{
    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-test-").FullName;
    private readonly string _userName = new Faker().Random.String2(length: 12, chars: "abcdefghijklmnopqrstuvwxyz");

    /// <summary>Os nomes de dispositivo do Windows, em caixas diferentes e com o que vem depois do ponto.</summary>
    private static readonly string[] DeviceNames = ["con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9", "CON", "Nul", "Com1", "con.txt", "aux.vault", "lpt3.a.b"];

    private string VaultPath => Path.Combine(_directory, "vaults", $"{_userName}.vault.json");

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private VaultFileClient CreateClient(ILogger? logger = null)
        => new(Options.Create(VaultFakers.CreateOptions(_directory)), logger ?? Logger.None);

    /// <summary>Regrava o arquivo do cofre com uma alteração no JSON, como faria quem o editasse à mão.</summary>
    private void Rewrite(Action<JsonNode> change)
    {
        var node = JsonNode.Parse(File.ReadAllText(VaultPath))!;
        change(node);
        File.WriteAllText(VaultPath, node.ToJsonString());
    }

    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK o que foi gravado é o que se lê")]
    public void Write_ThenRead_ReturnsSameFile()
    {
        //Arrange
        var file = VaultFakers.CreateFile();
        var client = CreateClient();

        //Act
        var written = client.Write(_userName, file);
        var read = client.Read(_userName);

        //Assert
        Assert.True(written.IsSuccess);
        Assert.True(read.IsSuccess);
        Assert.True(read.Value.HasValue);
        Assert.True(read.Value.Value.JsonEquals(file));
        Assert.True(File.Exists(VaultPath));
    }

    /// <summary>RN-COFRE-004: o formato em disco é contrato. Trocar um nome aqui deixa ilegível todo cofre já gravado.</summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK o arquivo sai no formato documentado")]
    public void Write_ProducesTheDocumentedFormat()
    {
        //Arrange
        var file = VaultFakers.CreateFile();
        var client = CreateClient();

        //Act
        client.Write(_userName, file);

        //Assert
        using var json = JsonDocument.Parse(File.ReadAllText(VaultPath));
        var root = json.RootElement;
        var kdf = root.GetProperty("kdf");
        Assert.Equal(VaultCrypto.Version, root.GetProperty("version").GetInt32());
        Assert.Equal("argon2id", kdf.GetProperty("algorithm").GetString());
        Assert.Equal(file.Kdf.MemoryKiB, kdf.GetProperty("memoryKiB").GetInt32());
        Assert.Equal(file.Kdf.Iterations, kdf.GetProperty("iterations").GetInt32());
        Assert.Equal(file.Kdf.Parallelism, kdf.GetProperty("parallelism").GetInt32());
        Assert.Equal(Convert.ToBase64String(file.Kdf.Salt), kdf.GetProperty("salt").GetString());
        Assert.Equal(Convert.ToBase64String(file.WrappedKey.Nonce), root.GetProperty("wrappedKey").GetProperty("nonce").GetString());
        Assert.Equal(Convert.ToBase64String(file.WrappedKey.Ciphertext), root.GetProperty("wrappedKey").GetProperty("ciphertext").GetString());
        Assert.Equal(Convert.ToBase64String(file.WrappedKey.Tag), root.GetProperty("wrappedKey").GetProperty("tag").GetString());
        Assert.Equal(Convert.ToBase64String(file.Payload.Nonce), root.GetProperty("payload").GetProperty("nonce").GetString());
        Assert.Equal(Convert.ToBase64String(file.Payload.Ciphertext), root.GetProperty("payload").GetProperty("ciphertext").GetString());
        Assert.Equal(Convert.ToBase64String(file.Payload.Tag), root.GetProperty("payload").GetProperty("tag").GetString());
    }

    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK a versão anterior fica como .bak")]
    public void Write_OverExisting_KeepsPreviousAsBak()
    {
        //Arrange
        var first = VaultFakers.CreateFile();
        var second = VaultFakers.CreateFile();
        var client = CreateClient();
        client.Write(_userName, first);
        var previousBytes = File.ReadAllBytes(VaultPath);

        //Act
        var written = client.Write(_userName, second);

        //Assert
        Assert.True(written.IsSuccess);
        Assert.Equal(previousBytes, File.ReadAllBytes(VaultPath + ".bak"));
        Assert.True(client.Read(_userName).Value.Value.JsonEquals(second));
    }

    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK nenhum temporário sobra, na primeira gravação nem na troca")]
    public void Write_LeavesNoTempFile()
    {
        //Arrange
        var vaults = new DirectoryInfo(Path.Combine(_directory, "vaults"));
        var client = CreateClient();

        //Act
        client.Write(_userName, VaultFakers.CreateFile());
        var afterFirst = vaults.GetFiles().Select(file => file.Name).Order().ToArray();
        client.Write(_userName, VaultFakers.CreateFile());
        var afterSecond = vaults.GetFiles().Select(file => file.Name).Order().ToArray();

        //Assert
        Assert.Equal([$"{_userName}.vault.json"], afterFirst);
        Assert.Equal([$"{_userName}.vault.json", $"{_userName}.vault.json.bak"], afterSecond);
    }

    /// <summary>RN-COFRE-005: o `.tmp` que uma queda deixou não impede a gravação seguinte, que o trunca e o usa.</summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK grava por cima do temporário que uma queda deixou")]
    public void Write_AfterTempFileIsLeftBehind_Succeeds()
    {
        //Arrange
        var second = VaultFakers.CreateFile();
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        var complete = File.ReadAllBytes(VaultPath);
        File.WriteAllBytes(VaultPath + ".tmp", complete[..(complete.Length / 2)]);

        //Act
        var written = client.Write(_userName, second);

        //Assert
        Assert.True(written.IsSuccess);
        Assert.True(client.Read(_userName).Value.Value.JsonEquals(second));
        Assert.False(File.Exists(VaultPath + ".tmp"));
    }

    /// <summary>
    /// O que o `Read` recusaria não chega ao disco: um cofre criado com parâmetros acima do teto nasceria
    /// ilegível, e a pessoa só descobriria na entrada seguinte.
    /// </summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "Erro arquivo que a leitura recusaria não é gravado")]
    public void Write_FileThatReadWouldRefuse_WritesNothing()
    {
        //Arrange
        var file = VaultFakers.CreateFile();
        var client = CreateClient();

        //Act
        var written = client.Write(_userName, file with { Kdf = file.Kdf with { Iterations = 9 } });

        //Assert
        Assert.True(written.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, written.Error);
        Assert.Empty(Directory.GetFiles(_directory, "*", SearchOption.AllDirectories));
    }

    /// <summary>RN-VERSAO-005: a gravação é sempre no formato atual. O formato anterior só se lê, para ser migrado ao abrir; um arquivo dele não volta ao disco.</summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "Erro arquivo de formato anterior não é gravado")]
    public void Write_FileOfAnOlderFormat_WritesNothing()
    {
        //Arrange
        var file = VaultFakers.CreateFile();
        var client = CreateClient();

        //Act
        var written = client.Write(_userName, file with { Version = VaultCrypto.Version - 1 });

        //Assert
        Assert.True(written.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, written.Error);
        Assert.Empty(Directory.GetFiles(_directory, "*", SearchOption.AllDirectories));
    }

    /// <summary>RN-VERSAO-005: o cofre de formato anterior se lê (quem o migra é o serviço, ao abrir), e o arquivo fica como estava.</summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "OK arquivo de formato anterior se lê, sem ser tocado")]
    public void Read_FileOfAnOlderFormat_ReturnsItAndTouchesNothing()
    {
        //Arrange
        var file = VaultFakers.CreateFile();
        var client = CreateClient();
        client.Write(_userName, file);
        Rewrite(node => node["version"] = VaultCrypto.Version - 1);
        var bytes = File.ReadAllBytes(VaultPath);

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsSuccess);
        Assert.Equal(VaultCrypto.Version - 1, read.Value.Value.Version);
        Assert.Equal(bytes, File.ReadAllBytes(VaultPath));
    }

    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "Erro falha de disco na gravação responde indisponível")]
    public void Write_WhenDiskFails_ReturnsUnavailable()
    {
        //Arrange
        // Um arquivo no lugar da pasta `vaults`: criar a pasta falha como falharia um disco sem acesso.
        File.WriteAllText(Path.Combine(_directory, "vaults"), string.Empty);
        var client = CreateClient();

        //Act
        var written = client.Write(_userName, VaultFakers.CreateFile());

        //Assert
        Assert.True(written.IsFailure);
        Assert.Equal(EVaultFileError.Unavailable, written.Error);
    }

    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "Erro nome com caminho não grava nada fora da pasta dos cofres")]
    public void Write_UserNameWithPath_WritesNothing()
    {
        //Arrange
        var client = CreateClient();

        //Act
        var written = client.Write(Path.Combine("..", _userName), VaultFakers.CreateFile());

        //Assert
        Assert.True(written.IsFailure);
        Assert.Equal(EVaultFileError.Unavailable, written.Error);
        Assert.Empty(Directory.GetFiles(_directory, "*", SearchOption.AllDirectories));
    }

    /// <summary>
    /// RN-COFRE-001: `con.vault.json` não é um arquivo no Windows, é o dispositivo `CON` (o que vem depois
    /// do ponto não muda isso). Nenhum nome desses chega ao disco, nem para ler nem para gravar.
    /// </summary>
    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "Erro nome de dispositivo do Windows não grava nada")]
    public void Write_DeviceName_WritesNothing()
    {
        //Arrange
        var client = CreateClient();

        foreach (var deviceName in DeviceNames)
        {
            //Act
            var written = client.Write(deviceName, VaultFakers.CreateFile());

            //Assert
            Assert.True(written.IsFailure, deviceName);
            Assert.Equal(EVaultFileError.Unavailable, written.Error);
        }

        Assert.False(Directory.Exists(Path.Combine(_directory, "vaults")));
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "OK nome de dispositivo do Windows não tem cofre")]
    public void Read_DeviceName_ReturnsNone()
    {
        //Arrange
        var client = CreateClient();

        foreach (var deviceName in DeviceNames)
        {
            //Act
            var read = client.Read(deviceName);

            //Assert
            Assert.True(read.IsSuccess, deviceName);
            Assert.True(read.Value.HasNoValue, deviceName);
        }
    }

    [Trait("VaultFileClient", "Write")]
    [Fact(DisplayName = "OK nome que só lembra um dispositivo é um nome como outro qualquer")]
    public void Write_NameThatOnlyLooksLikeADevice_WritesTheFile()
    {
        //Arrange
        var client = CreateClient();

        foreach (var lookalike in new[] { "console", "com0", "com10", "lpt", "xcon", "a.con", "nulo" })
        {
            //Act
            var written = client.Write(lookalike, VaultFakers.CreateFile());

            //Assert
            Assert.True(written.IsSuccess, lookalike);
            Assert.True(File.Exists(Path.Combine(_directory, "vaults", $"{lookalike}.vault.json")), lookalike);
        }
    }

    /// <summary>RN-COFRE-005: a queda no meio da gravação deixa um `.tmp` pela metade, e o cofre continua sendo a última versão completa.</summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "OK temporário truncado ao lado não atrapalha a leitura")]
    public void Read_WhenTempFileIsLeftBehind_ReturnsLastCompleteVersion()
    {
        //Arrange
        var file = VaultFakers.CreateFile();
        var client = CreateClient();
        client.Write(_userName, file);
        var complete = File.ReadAllBytes(VaultPath);
        File.WriteAllBytes(VaultPath + ".tmp", complete[..(complete.Length / 2)]);

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsSuccess);
        Assert.True(read.Value.Value.JsonEquals(file));
    }

    /// <summary>
    /// RN-COFRE-005: a queda entre as duas trocas de nome do `File.Replace` deixa o cofre só no `.bak`.
    /// A leitura o promove a principal, e a pessoa volta à última versão inteira; sem isso o cofre
    /// pareceria não existir, e criar de novo o mesmo usuário apagaria a única cópia.
    /// </summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "OK cofre que ficou só no .bak volta a ser o principal")]
    public void Read_WhenOnlyBakExists_PromotesItAndReturnsIt()
    {
        //Arrange
        var previous = VaultFakers.CreateFile();
        var client = CreateClient();
        client.Write(_userName, previous);
        client.Write(_userName, VaultFakers.CreateFile());
        var previousBytes = File.ReadAllBytes(VaultPath + ".bak");
        File.Delete(VaultPath);

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsSuccess);
        Assert.True(read.Value.HasValue);
        Assert.True(read.Value.Value.JsonEquals(previous));
        Assert.Equal(previousBytes, File.ReadAllBytes(VaultPath));
        Assert.False(File.Exists(VaultPath + ".bak"));
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "OK arquivo que não existe volta vazio, sem falha")]
    public void Read_MissingFile_ReturnsNone()
    {
        //Arrange
        var client = CreateClient();

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsSuccess);
        Assert.True(read.Value.HasNoValue);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "OK nome com caminho não lê arquivo de fora da pasta dos cofres")]
    public void Read_UserNameWithPath_ReturnsNone()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        File.Copy(VaultPath, Path.Combine(_directory, $"{_userName}.vault.json"));

        //Act
        var read = client.Read(Path.Combine("..", _userName));

        //Assert
        Assert.True(read.IsSuccess);
        Assert.True(read.Value.HasNoValue);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro JSON corrompido responde corrompido, e não indisponível")]
    public void Read_CorruptJson_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        File.WriteAllText(VaultPath, "{ \"version\": 1, \"kdf\": ");

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro campo faltando responde corrompido")]
    public void Read_MissingField_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node.AsObject().Remove("payload"));

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro base64 inválido responde corrompido")]
    public void Read_InvalidBase64_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["kdf"]!["salt"] = "###");

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    /// <summary>
    /// RN-VERSAO-005: o número do formato maior que o conhecido não é `Corrupt`. Sem esta resposta própria, quem voltasse a uma versão
    /// antiga do Prism concluiria que errou a senha. O arquivo e o `.bak` ficam byte a byte como estavam.
    /// </summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro formato mais novo responde formato mais novo, e não corrompido, sem tocar nos arquivos")]
    public void Read_NewerFormat_ReturnsNewerFormatAndTouchesNothing()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["version"] = VaultCrypto.Version + 1);
        var mainBytes = File.ReadAllBytes(VaultPath);
        var backupBytes = File.ReadAllBytes(VaultPath + ".bak");

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.NewerFormat, read.Error);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath + ".bak"));
    }

    /// <summary>O formato mais novo pode ter outra forma (campos que este código nem conhece): só o número do cabeçalho decide, antes de qualquer outra leitura.</summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro formato mais novo com outra forma de arquivo também responde formato mais novo")]
    public void Read_NewerFormatWithAnotherShape_ReturnsNewerFormat()
    {
        //Arrange
        var client = CreateClient();
        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath)!);
        File.WriteAllText(VaultPath, """{ "Version": 7, "kdf": "agora é um texto", "vault": { "novo": [1, 2, 3] } }""");

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.NewerFormat, read.Error);
    }

    /// <summary>RN-VERSAO-005: formato 0, negativo ou que nem é um número inteiro é arquivo corrompido, e continua respondendo como tal.</summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro formato zero, negativo ou que não é número inteiro responde corrompido")]
    public void Read_FormatThatIsNotAPositiveInteger_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();

        foreach (var literal in new[] { "0", "-1", "-2147483648", "\"2\"", "\"abc\"", "2.5", "true", "null", "[2]", "{}", "99999999999999999999" })
        {
            client.Write(_userName, VaultFakers.CreateFile());
            Rewrite(node => node["version"] = JsonNode.Parse(literal));

            //Act
            var read = client.Read(_userName);

            //Assert
            Assert.True(read.IsFailure, literal);
            Assert.Equal(EVaultFileError.Corrupt, read.Error);
        }
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro cabeçalho sem formato responde corrompido")]
    public void Read_WithoutFormat_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node.AsObject().Remove("version"));

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    /// <summary>RN-COFRE-005 com a RN-VERSAO-005: o cofre que ficou só no `.bak` volta a ser o principal, a menos que seja de um formato mais novo; esse fica onde está.</summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro .bak de formato mais novo não é promovido a principal")]
    public void Read_WhenOnlyBakExistsAndIsNewer_DoesNotPromoteIt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        client.Write(_userName, VaultFakers.CreateFile());
        File.Delete(VaultPath);
        File.WriteAllText(VaultPath + ".bak", $$"""{ "version": {{VaultCrypto.Version + 1}}, "outraForma": true }""");
        var backupBytes = File.ReadAllBytes(VaultPath + ".bak");

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.NewerFormat, read.Error);
        Assert.False(File.Exists(VaultPath));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath + ".bak"));
    }

    /// <summary>O principal manda: o `.bak` do formato atual não o substitui nem é tocado.</summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro principal de formato mais novo vale mesmo com .bak do formato atual")]
    public void Read_WhenMainIsNewerAndBakIsCurrent_ReturnsNewerFormatAndTouchesNothing()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["version"] = VaultCrypto.Version + 1);
        var mainBytes = File.ReadAllBytes(VaultPath);
        var backupBytes = File.ReadAllBytes(VaultPath + ".bak");

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.Equal(EVaultFileError.NewerFormat, read.Error);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath + ".bak"));
    }

    /// <summary>RN-LOG-001: o aviso do formato mais novo leva o formato e o pseudônimo do usuário, nunca o nome nem o caminho.</summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "A recusa do formato mais novo vai para o log sem o nome do usuário")]
    public void Read_NewerFormat_LogsWithoutTheUserName()
    {
        //Arrange
        var sink = new CollectingSink();
        var client = CreateClient(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["version"] = VaultCrypto.Version + 1);

        //Act
        client.Read(_userName);

        //Assert
        var logEvent = Assert.Single(sink.Events);
        Assert.Equal(LogEventLevel.Warning, logEvent.Level);
        Assert.Null(logEvent.Exception);
        Assert.DoesNotContain(_userName, logEvent.RenderMessage());
        Assert.DoesNotContain(_directory, logEvent.RenderMessage());
        Assert.Contains("3", logEvent.RenderMessage());
    }

    /// <summary>
    /// Os tetos dos parâmetros lidos do arquivo: 256 MiB, 8 passadas e paralelismo 8. Sem eles, um arquivo
    /// editado à mão faria a derivação alocar memória ou girar sem fim antes de qualquer conferência.
    /// Cada caso passa um do teto, com o resto do arquivo válido.
    /// </summary>
    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro memória acima do teto responde corrompido")]
    public void Read_MemoryAboveTheCeiling_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["kdf"]!["memoryKiB"] = 256 * 1024 + 1);

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro passadas acima do teto respondem corrompido")]
    public void Read_IterationsAboveTheCeiling_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["kdf"]!["iterations"] = 9);

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro paralelismo acima do teto responde corrompido")]
    public void Read_ParallelismAboveTheCeiling_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["kdf"]!["parallelism"] = 9);

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro sal com tamanho errado responde corrompido")]
    public void Read_SaltWithWrongSize_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["kdf"]!["salt"] = Convert.ToBase64String(new Faker().Random.Bytes(15)));

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro nonce com tamanho errado responde corrompido")]
    public void Read_NonceWithWrongSize_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["payload"]!["nonce"] = Convert.ToBase64String(new Faker().Random.Bytes(11)));

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro tag com tamanho errado responde corrompido")]
    public void Read_TagWithWrongSize_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["wrappedKey"]!["tag"] = Convert.ToBase64String(new Faker().Random.Bytes(17)));

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro chave do cofre cifrada com tamanho errado responde corrompido")]
    public void Read_WrappedKeyWithWrongSize_ReturnsCorrupt()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["wrappedKey"]!["ciphertext"] = Convert.ToBase64String(new Faker().Random.Bytes(31)));

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, read.Error);
    }

    [Trait("VaultFileClient", "Read")]
    [Fact(DisplayName = "Erro falha de disco na leitura responde indisponível")]
    public void Read_WhenDiskFails_ReturnsUnavailable()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());

        // Outro dono com o arquivo aberto sem compartilhar: a leitura falha como falharia um disco sem acesso.
        using var holder = new FileStream(VaultPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);

        //Act
        var read = client.Read(_userName);

        //Assert
        Assert.True(read.IsFailure);
        Assert.Equal(EVaultFileError.Unavailable, read.Error);
    }

    /// <summary>
    /// RN-LOG-001 e o brief: o log não leva o nome do usuário em claro. A mensagem de uma `IOException`
    /// traz o caminho do arquivo, que tem o nome, então a exceção não pode ir inteira para o log.
    /// </summary>
    [Trait("VaultFileClient", "Send")]
    [Fact(DisplayName = "A falha vai para o log sem o nome do usuário")]
    public void Read_WhenDiskFails_LogsWithoutTheUserName()
    {
        //Arrange
        var sink = new CollectingSink();
        var client = CreateClient(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());
        client.Write(_userName, VaultFakers.CreateFile());
        using var holder = new FileStream(VaultPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);

        //Act
        client.Read(_userName);

        //Assert
        var logEvent = Assert.Single(sink.Events);
        Assert.Equal(LogEventLevel.Error, logEvent.Level);
        Assert.Null(logEvent.Exception);
        Assert.DoesNotContain(_userName, logEvent.RenderMessage());
        Assert.Contains(nameof(IOException), logEvent.RenderMessage());
    }

    [Trait("VaultFileClient", "Open")]
    [Fact(DisplayName = "OK abre o que foi cifrado com a mesma chave")]
    public void Open_WithTheSameKey_ReturnsThePlaintext()
    {
        //Arrange
        var key = RandomNumberGenerator.GetBytes(32);
        var plaintext = new Faker().Random.Bytes(120);
        var associatedData = new Faker().Random.Bytes(40);
        var box = VaultCrypto.Seal(key, plaintext, associatedData);
        var client = CreateClient();

        //Act
        var opened = client.Open(key, box, associatedData);

        //Assert
        Assert.True(opened.IsSuccess);
        Assert.Equal(plaintext, opened.Value);
    }

    /// <summary>O ramo do `Send` que transforma a exceção de tag inválida em falha: é a resposta de senha errada, sem exceção para fora.</summary>
    [Trait("VaultFileClient", "Open")]
    [Fact(DisplayName = "Erro outra chave não abre, e a falha volta como resultado")]
    public void Open_WithWrongKey_ReturnsCorrupt()
    {
        //Arrange
        var associatedData = new Faker().Random.Bytes(40);
        var box = VaultCrypto.Seal(RandomNumberGenerator.GetBytes(32), new Faker().Random.Bytes(120), associatedData);
        var client = CreateClient();

        //Act
        var opened = client.Open(RandomNumberGenerator.GetBytes(32), box, associatedData);

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EVaultFileError.Corrupt, opened.Error);
    }

    private sealed class CollectingSink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent)
            => Events.Add(logEvent);
    }
}
