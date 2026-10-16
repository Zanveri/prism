using Microsoft.Extensions.Options;
using Prism.Infrastructure.ConnectionFiles.Clients;
using Prism.Infrastructure.ConnectionFiles.Models;
using Prism.Infrastructure.ConnectionFiles.Services;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Serilog.Core;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.UnitTesting.ConnectionFiles;

/// <summary>
/// RN-TRANSF-007 a 010: o arquivo da exportação de conexões, sobre o client de verdade, com uma derivação barata no lugar do Argon2id (a costura `deriveKey`,
/// como no `VaultService`). A derivação de mentira depende da senha e de todos os valores do cabeçalho, como a de verdade, e anota cada chamada: é a contagem
/// que prova que as recusas do cabeçalho vêm antes de qualquer derivação, e o buffer que ela devolve é o que o teste confere zerado.
/// </summary>
public sealed class ConnectionFileServiceTests
{
    private const string Passphrase = "senha de exportação fictícia";
    private const string Marker = "marcador-do-conteudo-em-claro";

    private readonly List<VaultKdf> _derivations = [];
    private readonly List<byte[]> _derivedKeys = [];
    private Func<string, VaultKdf, byte[]>? _deriveOverride;

    private static ConnectionFileOptions DefaultOptions()
        => new();

    private ConnectionFileService CreateService(ConnectionFileOptions? options = null)
        => new(new ConnectionFileClient(Logger.None), Options.Create(options ?? DefaultOptions()), Derive);

    /// <summary>A chave sai da senha e do cabeçalho inteiro (o algoritmo, a memória, as passadas, o paralelismo e o sal): mudar qualquer um muda a chave.</summary>
    private byte[] Derive(string passphrase, VaultKdf kdf)
    {
        if (_deriveOverride is not null)
            return _deriveOverride(passphrase, kdf);

        var key = SHA256.HashData(Encoding.UTF8.GetBytes(string.Create(CultureInfo.InvariantCulture, $"{passphrase}|{kdf.Algorithm}|{kdf.MemoryKiB}|{kdf.Iterations}|{kdf.Parallelism}|{Convert.ToBase64String(kdf.Salt)}")));
        _derivations.Add(kdf);
        _derivedKeys.Add(key);

        return key;
    }

    private sealed record SampleContent(IReadOnlyList<string> Folders, string Secret);

    private static SampleContent Content()
        => new(["Estoque", "Production PRD"], Marker);

    /// <summary>O que a leitura extrai do conteúdo aberto: o texto do campo `secret`, que prova que a leitura viu o conteúdo em claro.</summary>
    private static string ReadSecret(JsonElement root)
        => root.GetProperty("secret").GetString()!;

    private async Task<string> SealAsync(ConnectionFileOptions? options = null)
    {
        var content = await CreateService(options).SealAsync(Content(), Passphrase, CancellationToken.None);
        _derivations.Clear();
        _derivedKeys.Clear();

        return content;
    }

    private static string Change(string content, Action<JsonNode> change)
    {
        var node = JsonNode.Parse(content)!;
        change(node);

        return node.ToJsonString();
    }

    /// <summary>Troca um byte de um campo em base64 do arquivo (o conteúdo, a tag ou o nonce): o base64 continua decodificando.</summary>
    private static string FlipByte(string content, string field)
        => Change(content, node =>
        {
            var bytes = Convert.FromBase64String(node["payload"]![field]!.GetValue<string>());
            bytes[0] ^= 0x01;
            node["payload"]![field] = Convert.ToBase64String(bytes);
        });

    [Trait("ConnectionFileService", "SealAsync")]
    [Fact(DisplayName = "OK o arquivo cifrado abre com a mesma senha e devolve o conteúdo")]
    public async Task SealAndOpen_ShouldBeOK_RoundTrip()
    {
        //Arrange
        var service = CreateService();

        //Act
        var content = await service.SealAsync(Content(), Passphrase, CancellationToken.None);
        var opened = await service.OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None);

        //Assert
        Assert.True(opened.IsSuccess);
        Assert.Equal(Marker, opened.Value);
        Assert.Equal(2, _derivations.Count);
    }

    /// <summary>
    /// RN-TRANSF-007: o cabeçalho em claro (`kind`, `version`, `kdf` com os parâmetros das opções, o padrão da RN-COFRE-002, e o sal de 16 bytes) e o
    /// conteúdo cifrado (`payload`, com nonce de 12 bytes e tag de 16), nos nomes do cabeçalho do cofre. Nada do conteúdo aparece em claro, nem em base64.
    /// </summary>
    [Trait("ConnectionFileService", "SealAsync")]
    [Fact(DisplayName = "OK o arquivo tem o cabeçalho em claro e o conteúdo cifrado, sem nada em claro")]
    public async Task SealAsync_ShouldBeOK_HeaderInClearAndContentSealed()
    {
        //Act
        var content = await SealAsync();
        var root = JsonDocument.Parse(content).RootElement;

        //Assert
        Assert.Equal("prism-connections", root.GetProperty("kind").GetString());
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        Assert.Equal("argon2id", root.GetProperty("kdf").GetProperty("algorithm").GetString());
        Assert.Equal(65536, root.GetProperty("kdf").GetProperty("memoryKiB").GetInt32());
        Assert.Equal(3, root.GetProperty("kdf").GetProperty("iterations").GetInt32());
        Assert.Equal(4, root.GetProperty("kdf").GetProperty("parallelism").GetInt32());
        Assert.Equal(16, root.GetProperty("kdf").GetProperty("salt").GetBytesFromBase64().Length);
        Assert.Equal(12, root.GetProperty("payload").GetProperty("nonce").GetBytesFromBase64().Length);
        Assert.Equal(16, root.GetProperty("payload").GetProperty("tag").GetBytesFromBase64().Length);
        Assert.DoesNotContain(Marker, content);
        Assert.DoesNotContain("Estoque", content);
        Assert.DoesNotContain(Convert.ToBase64String(Encoding.UTF8.GetBytes(Marker))[..12], content);
        Assert.False(content.StartsWith('\uFEFF'));
    }

    /// <summary>RN-TRANSF-007: um arquivo, uma chave, uma cifragem: o sal e o nonce são novos a cada exportação, também com a mesma senha e o mesmo conteúdo.</summary>
    [Trait("ConnectionFileService", "SealAsync")]
    [Fact(DisplayName = "OK o sal e o nonce são novos a cada exportação")]
    public async Task SealAsync_ShouldBeOK_NewSaltAndNonceEachTime()
    {
        //Act
        var first = JsonDocument.Parse(await SealAsync()).RootElement;
        var second = JsonDocument.Parse(await SealAsync()).RootElement;

        //Assert
        Assert.NotEqual(first.GetProperty("kdf").GetProperty("salt").GetString(), second.GetProperty("kdf").GetProperty("salt").GetString());
        Assert.NotEqual(first.GetProperty("payload").GetProperty("nonce").GetString(), second.GetProperty("payload").GetProperty("nonce").GetString());
        Assert.NotEqual(first.GetProperty("payload").GetProperty("ciphertext").GetString(), second.GetProperty("payload").GetProperty("ciphertext").GetString());
    }

    /// <summary>RN-TRANSF-007: a chave derivada é zerada depois de cifrar, e depois de abrir (o buffer é o mesmo que a derivação devolveu).</summary>
    [Trait("ConnectionFileService", "SealAsync")]
    [Fact(DisplayName = "OK a chave derivada é zerada depois de cifrar e depois de abrir")]
    public async Task SealAndOpen_ShouldBeOK_TheDerivedKeyIsZeroed()
    {
        //Arrange
        var service = CreateService();

        //Act
        var content = await service.SealAsync(Content(), Passphrase, CancellationToken.None);
        await service.OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None);
        await service.OpenAsync(content, "outra senha de exportação", ReadSecret, CancellationToken.None);

        //Assert
        Assert.Equal(3, _derivedKeys.Count);
        Assert.All(_derivedKeys, key => Assert.All(key, value => Assert.Equal(0, value)));
    }

    /// <summary>O conteúdo que não se serializa: um defeito de quem chama, que sobe como veio.</summary>
    private sealed class UnserializableContent
    {
        public string Secret
            => throw new NotSupportedException("defeito");
    }

    /// <summary>
    /// RN-TRANSF-007 e 010: a chave derivada é zerada também quando o que vem depois da derivação lança o que ninguém trata (um defeito): a serialização do
    /// conteúdo, na exportação, e a leitura do conteúdo aberto, na importação. A exceção sobe como veio.
    /// </summary>
    [Trait("ConnectionFileService", "SealAsync")]
    [Fact(DisplayName = "OK a chave derivada é zerada também quando a serialização ou a leitura lançam")]
    public async Task SealAndOpen_ShouldBeOK_TheDerivedKeyIsZeroedOnAnException()
    {
        //Arrange
        var service = CreateService();
        var content = await service.SealAsync(Content(), Passphrase, CancellationToken.None);
        _derivedKeys.Clear();

        //Act
        var seal = () => service.SealAsync(new UnserializableContent(), Passphrase, CancellationToken.None);
        var open = () => service.OpenAsync<string>(content, Passphrase, _ => throw new NotSupportedException("defeito"), CancellationToken.None);

        //Assert
        await Assert.ThrowsAsync<NotSupportedException>(seal);
        await Assert.ThrowsAsync<NotSupportedException>(open);
        Assert.Equal(2, _derivedKeys.Count);
        Assert.All(_derivedKeys, key => Assert.All(key, value => Assert.Equal(0, value)));
    }

    /// <summary>Os parâmetros vêm das opções (o teste de integração os reduz); fora dos limites que a leitura aceita, o arquivo não sai: é defeito de configuração.</summary>
    [Trait("ConnectionFileService", "SealAsync")]
    [Fact(DisplayName = "Erro opções fora dos limites da leitura não geram arquivo")]
    public async Task SealAsync_ShouldBeError_OptionsBeyondTheLimits()
    {
        //Arrange
        var service = CreateService(new ConnectionFileOptions { MemoryKiB = VaultHeaderLimits.MaxMemoryKiB + 1 });

        //Act
        var act = () => service.SealAsync(Content(), Passphrase, CancellationToken.None);

        //Assert
        await Assert.ThrowsAsync<InvalidOperationException>(act);
    }

    /// <summary>RN-TRANSF-010, etapa 6: a senha errada é a recusa da cifra, depois de uma derivação (com os parâmetros do próprio arquivo).</summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Fact(DisplayName = "Erro senha de exportação errada")]
    public async Task OpenAsync_ShouldBeError_WrongPassphrase()
    {
        //Arrange
        var content = await SealAsync(new ConnectionFileOptions { MemoryKiB = 8192, Iterations = 1, Parallelism = 1 });

        //Act
        var opened = await CreateService().OpenAsync(content, "senha de exportação errada", ReadSecret, CancellationToken.None);

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EConnectionFileError.WrongPassphrase, opened.Error);
        Assert.Equal(8192, Assert.Single(_derivations).MemoryKiB);
    }

    /// <summary>
    /// RN-TRANSF-010, etapa 6: o arquivo alterado dá a MESMA recusa da senha errada: um byte do conteúdo, da tag ou do nonce, ou um valor do cabeçalho que
    /// ainda passa pelos limites (a memória de 65.536 para 65.537 KiB, as passadas, o paralelismo, outro sal de 16 bytes). O AES-GCM não distingue os dois.
    /// </summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Theory(DisplayName = "Erro arquivo alterado dá a mesma recusa da senha errada")]
    [InlineData("ciphertext")]
    [InlineData("tag")]
    [InlineData("nonce")]
    [InlineData("memoryKiB")]
    [InlineData("iterations")]
    [InlineData("parallelism")]
    [InlineData("salt")]
    public async Task OpenAsync_ShouldBeError_Tampered(string field)
    {
        //Arrange
        var content = await SealAsync();
        var tampered = field switch
        {
            "memoryKiB" => Change(content, node => node["kdf"]!["memoryKiB"] = 65537),
            "iterations" => Change(content, node => node["kdf"]!["iterations"] = 2),
            "parallelism" => Change(content, node => node["kdf"]!["parallelism"] = 2),
            "salt" => Change(content, node => node["kdf"]!["salt"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16))),
            _ => FlipByte(content, field)
        };

        //Act
        var opened = await CreateService().OpenAsync(tampered, Passphrase, ReadSecret, CancellationToken.None);

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EConnectionFileError.WrongPassphrase, opened.Error);
        Assert.Single(_derivations);
    }

    /// <summary>
    /// RN-TRANSF-007: o cabeçalho entra como dado autenticado com um começo próprio (`prism-connections|`). O mesmo conteúdo, a mesma chave e o mesmo
    /// cabeçalho, cifrados com o dado autenticado do cofre (`prism-vault|`), não abrem como arquivo de exportação; e o conteúdo de um arquivo de exportação
    /// não abre com o dado autenticado do cofre.
    /// </summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Fact(DisplayName = "Erro um cofre nunca abre como arquivo de exportação, nem o contrário")]
    public async Task OpenAsync_ShouldBeError_VaultAssociatedData()
    {
        //Arrange
        var service = CreateService();
        var content = await service.SealAsync(Content(), Passphrase, CancellationToken.None);
        var file = JsonSerializer.Deserialize<ConnectionFile>(content, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var key = Derive(Passphrase, file.Kdf);
        var asVault = VaultCrypto.Seal(key, JsonSerializer.SerializeToUtf8Bytes(Content(), new JsonSerializerOptions(JsonSerializerDefaults.Web)), VaultCrypto.AssociatedData(1, file.Kdf));
        var vaultSealed = JsonSerializer.Serialize(file with { Payload = asVault }, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        //Act
        var opened = await service.OpenAsync(vaultSealed, Passphrase, ReadSecret, CancellationToken.None);
        var openAsVault = () => VaultCrypto.Open(Derive(Passphrase, file.Kdf), file.Payload, VaultCrypto.AssociatedData(1, file.Kdf));

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EConnectionFileError.WrongPassphrase, opened.Error);
        Assert.ThrowsAny<CryptographicException>(openAsVault);
        Assert.Equal(ConnectionFileFormat.AssociatedData(1, file.Kdf), Encoding.UTF8.GetBytes($"prism-connections|1|argon2id|65536|3|4|{Convert.ToBase64String(file.Kdf.Salt)}"));
    }

    /// <summary>RN-TRANSF-007: mudar só os espaços e as quebras de linha do JSON, ou acrescentar ao cabeçalho um campo que este Prism não conhece, não muda a abertura.</summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Fact(DisplayName = "OK espaços, quebras de linha e campo desconhecido no cabeçalho não impedem a abertura")]
    public async Task OpenAsync_ShouldBeOK_WhitespaceAndUnknownField()
    {
        //Arrange
        var content = await SealAsync();
        var indented = JsonNode.Parse(content)!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        var withField = Change(content, node => node["comentario"] = "um campo de um Prism mais novo");

        //Act
        var fromIndented = await CreateService().OpenAsync(indented, Passphrase, ReadSecret, CancellationToken.None);
        var fromWithField = await CreateService().OpenAsync(withField, Passphrase, ReadSecret, CancellationToken.None);

        //Assert
        Assert.NotEqual(content, indented);
        Assert.Equal(Marker, fromIndented.Value);
        Assert.Equal(Marker, fromWithField.Value);
    }

    /// <summary>
    /// RN-TRANSF-010, etapas 3 e 5: o que não é uma exportação de conexões do Prism, e o cabeçalho fora da forma ou dos limites do cofre, são recusados SEM
    /// derivar nada. Sem os tetos, uma memória absurda faria a derivação tentar alocar terabytes antes de qualquer conferência.
    /// </summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Theory(DisplayName = "Erro arquivo inválido é recusado sem derivar a chave")]
    [InlineData("kind-outro")]
    [InlineData("kind-ausente")]
    [InlineData("kind-numero")]
    [InlineData("kind-maiusculas")]
    [InlineData("algoritmo")]
    [InlineData("memoria-acima-do-teto")]
    [InlineData("memoria-abaixo-do-piso")]
    [InlineData("passadas-zero")]
    [InlineData("passadas-acima-do-teto")]
    [InlineData("paralelismo-zero")]
    [InlineData("paralelismo-acima-do-teto")]
    [InlineData("sal-de-15-bytes")]
    [InlineData("nonce-de-11-bytes")]
    [InlineData("tag-de-15-bytes")]
    [InlineData("sem-ciphertext")]
    [InlineData("sem-kdf")]
    [InlineData("sem-payload")]
    [InlineData("base64-quebrado")]
    [InlineData("memoria-em-texto")]
    public async Task OpenAsync_ShouldBeError_InvalidHeader(string change)
    {
        //Arrange
        var content = await SealAsync();
        var invalid = Change(content, node =>
        {
            switch (change)
            {
                case "kind-outro": node["kind"] = "prism-vault"; break;
                case "kind-ausente": node.AsObject().Remove("kind"); break;
                case "kind-numero": node["kind"] = 1; break;
                case "kind-maiusculas": node["kind"] = "Prism-Connections"; break;
                case "algoritmo": node["kdf"]!["algorithm"] = "argon2i"; break;
                case "memoria-acima-do-teto": node["kdf"]!["memoryKiB"] = VaultHeaderLimits.MaxMemoryKiB + 1; break;
                case "memoria-abaixo-do-piso": node["kdf"]!["memoryKiB"] = 31; break;
                case "passadas-zero": node["kdf"]!["iterations"] = 0; break;
                case "passadas-acima-do-teto": node["kdf"]!["iterations"] = 9; break;
                case "paralelismo-zero": node["kdf"]!["parallelism"] = 0; break;
                case "paralelismo-acima-do-teto": node["kdf"]!["parallelism"] = 9; break;
                case "sal-de-15-bytes": node["kdf"]!["salt"] = Convert.ToBase64String(new byte[15]); break;
                case "nonce-de-11-bytes": node["payload"]!["nonce"] = Convert.ToBase64String(new byte[11]); break;
                case "tag-de-15-bytes": node["payload"]!["tag"] = Convert.ToBase64String(new byte[15]); break;
                case "sem-ciphertext": node["payload"]!.AsObject().Remove("ciphertext"); break;
                case "sem-kdf": node.AsObject().Remove("kdf"); break;
                case "sem-payload": node.AsObject().Remove("payload"); break;
                case "base64-quebrado": node["payload"]!["ciphertext"] = "isto não é base64!"; break;
                case "memoria-em-texto": node["kdf"]!["memoryKiB"] = "65536"; break;
            }
        });

        //Act
        var opened = await CreateService().OpenAsync(invalid, Passphrase, ReadSecret, CancellationToken.None);

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EConnectionFileError.Invalid, opened.Error);
        Assert.Empty(_derivations);
    }

    /// <summary>RN-TRANSF-010, etapa 3: o texto que nem é o JSON de um objeto, e o vazio, são arquivo inválido, sem derivar.</summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Theory(DisplayName = "Erro texto que não é um arquivo de exportação")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("isto não é JSON")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("\"prism-connections\"")]
    [InlineData("{\"kind\":\"prism-connections\"")]
    [InlineData("{}")]
    public async Task OpenAsync_ShouldBeError_NotAnExportFile(string content)
    {
        //Act
        var opened = await CreateService().OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None);

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EConnectionFileError.Invalid, opened.Error);
        Assert.Empty(_derivations);
    }

    /// <summary>
    /// RN-TRANSF-010, etapa 4: o `version` é lido antes do resto do cabeçalho. Um inteiro maior que o formato conhecido (1) é mais novo, sem derivar, também
    /// com o resto do cabeçalho numa forma que este Prism não lê; o que não é um inteiro de 1 até ele é inválido.
    /// </summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Theory(DisplayName = "Erro formato mais novo ou que não é um inteiro conhecido, sem derivar")]
    [InlineData("2", EConnectionFileError.Newer)]
    [InlineData("99999999999999999999", EConnectionFileError.Newer)]
    [InlineData("0", EConnectionFileError.Invalid)]
    [InlineData("-1", EConnectionFileError.Invalid)]
    [InlineData("1.0", EConnectionFileError.Invalid)]
    [InlineData("1e0", EConnectionFileError.Invalid)]
    [InlineData("\"1\"", EConnectionFileError.Invalid)]
    [InlineData("null", EConnectionFileError.Invalid)]
    [InlineData("ausente", EConnectionFileError.Invalid)]
    public async Task OpenAsync_ShouldBeError_Version(string version, EConnectionFileError expected)
    {
        //Arrange
        var content = await SealAsync();
        var node = JsonNode.Parse(content)!.AsObject();
        node.Remove("version");
        var text = node.ToJsonString();
        var changed = version == "ausente" ? text : "{\"version\":" + version + "," + text[1..];
        var newerWithAnotherShape = "{\"kind\":\"prism-connections\",\"version\":2,\"kdf\":\"outra forma\"}";

        //Act
        var opened = await CreateService().OpenAsync(changed, Passphrase, ReadSecret, CancellationToken.None);
        var newer = await CreateService().OpenAsync(newerWithAnotherShape, Passphrase, ReadSecret, CancellationToken.None);

        //Assert
        Assert.Equal(expected, opened.Error);
        Assert.Equal(EConnectionFileError.Newer, newer.Error);
        Assert.Empty(_derivations);
    }

    /// <summary>RN-TRANSF-010, etapa 7: o conteúdo aberto que não é JSON é arquivo inválido (o log recebe só o tipo da exceção, que traz um pedaço do texto).</summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Fact(DisplayName = "Erro conteúdo aberto que não é JSON")]
    public async Task OpenAsync_ShouldBeError_ContentIsNotJson()
    {
        //Arrange
        var kdf = new VaultKdf(VaultCrypto.Algorithm, 8192, 1, 1, RandomNumberGenerator.GetBytes(16));
        var key = Derive(Passphrase, kdf);
        var payload = VaultCrypto.Seal(key, Encoding.UTF8.GetBytes("isto não é JSON"), ConnectionFileFormat.AssociatedData(1, kdf));
        var content = JsonSerializer.Serialize(new ConnectionFile("prism-connections", 1, kdf, payload), new JsonSerializerOptions(JsonSerializerDefaults.Web));

        //Act
        var opened = await CreateService().OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None);

        //Assert
        Assert.True(opened.IsFailure);
        Assert.Equal(EConnectionFileError.Invalid, opened.Error);
    }

    /// <summary>
    /// RN-TRANSF-008: as derivações do arquivo rodam uma por vez, numa fila própria. Com uma derivação em andamento, a de outro pedido espera a vez (a
    /// tarefa dela volta sem terminar, e nada foi derivado), e roda quando a primeira acaba.
    /// </summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Fact(DisplayName = "OK as derivações rodam uma por vez, na fila")]
    public async Task OpenAsync_ShouldBeOK_DerivationsRunOneAtATime()
    {
        //Arrange
        var content = await SealAsync();
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        var running = 0;
        var maxRunning = 0;
        _deriveOverride = (passphrase, kdf) =>
        {
            var now = Interlocked.Increment(ref running);
            maxRunning = Math.Max(maxRunning, now);
            entered.Set();
            release.Wait(TimeSpan.FromSeconds(30));
            Interlocked.Decrement(ref running);

            return SHA256.HashData(Encoding.UTF8.GetBytes(string.Create(CultureInfo.InvariantCulture, $"{passphrase}|{kdf.Algorithm}|{kdf.MemoryKiB}|{kdf.Iterations}|{kdf.Parallelism}|{Convert.ToBase64String(kdf.Salt)}")));
        };
        var service = CreateService();

        //Act
        var first = Task.Run(() => service.OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None));
        Assert.True(entered.Wait(TimeSpan.FromSeconds(30)));
        var second = service.OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None);
        var secondWaited = !second.IsCompleted;
        release.Set();
        var results = await Task.WhenAll(first, second);

        //Assert
        Assert.True(secondWaited);
        Assert.Equal(1, maxRunning);
        Assert.All(results, result => Assert.Equal(Marker, result.Value));
    }

    /// <summary>RN-TRANSF-008: o pedido que desiste esperando a vez (a requisição abortada) não deriva nada, e a fila segue para os outros.</summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Fact(DisplayName = "Erro pedido cancelado na fila não deriva")]
    public async Task OpenAsync_ShouldBeError_CanceledWhileWaiting()
    {
        //Arrange
        var content = await SealAsync();
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        var calls = 0;
        _deriveOverride = (passphrase, kdf) =>
        {
            Interlocked.Increment(ref calls);
            entered.Set();
            release.Wait(TimeSpan.FromSeconds(30));
            _deriveOverride = null;

            return Derive(passphrase, kdf);
        };
        var service = CreateService();
        using var cancellation = new CancellationTokenSource();

        //Act
        var first = Task.Run(() => service.OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None));
        Assert.True(entered.Wait(TimeSpan.FromSeconds(30)));
        var second = service.OpenAsync(content, Passphrase, ReadSecret, cancellation.Token);
        await cancellation.CancelAsync();
        var canceled = await Record.ExceptionAsync(() => second);
        release.Set();
        var opened = await first;
        var third = await service.OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None);

        //Assert
        Assert.IsAssignableFrom<OperationCanceledException>(canceled);
        Assert.Equal(1, calls);
        Assert.Equal(Marker, opened.Value);
        Assert.Equal(Marker, third.Value);
    }

    /// <summary>A derivação que lança (um defeito) devolve a vez na fila: a exportação seguinte não fica presa.</summary>
    [Trait("ConnectionFileService", "OpenAsync")]
    [Fact(DisplayName = "OK a derivação que lança devolve a vez na fila")]
    public async Task OpenAsync_ShouldBeOK_AFailingDerivationReleasesTheQueue()
    {
        //Arrange
        var content = await SealAsync();
        _deriveOverride = (_, _) => throw new OutOfMemoryException("falha de teste");
        var service = CreateService();

        //Act
        var failing = () => service.OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None);
        await Assert.ThrowsAsync<OutOfMemoryException>(failing);
        _deriveOverride = null;
        var opened = await service.OpenAsync(content, Passphrase, ReadSecret, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(30));

        //Assert
        Assert.Equal(Marker, opened.Value);
    }
}
