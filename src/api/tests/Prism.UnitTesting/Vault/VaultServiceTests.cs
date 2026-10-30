using Bogus;
using CSharpFunctionalExtensions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Prism.Infrastructure;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Vault;
using Serilog;
using Serilog.Core;
using System.Text;
using System.Text.Json.Nodes;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// O serviço roda sobre o client de verdade, numa pasta temporária, com o Argon2id pequeno do faker.
/// O `RecordingClient` só entra onde o teste precisa segurar o que o client devolveu ou simular o disco
/// falhando. A troca de senha (RN-COFRE-013) tem os testes dela em `VaultServiceChangePasswordTests.cs`,
/// a mesma classe em outro arquivo, para dividir os auxiliares e não repeti-los.
/// </summary>
public sealed partial class VaultServiceTests : IDisposable
{
    private const string Letters = "abcdefghijklmnopqrstuvwxyz";

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-test-").FullName;
    private readonly string _userName = new Faker().Random.String2(length: 12, chars: Letters);
    private readonly string _password = new Faker().Internet.Password(length: 16);
    private readonly List<VaultKdf> _derivations = [];
    private readonly List<byte[]> _derivedKeys = [];

    /// <summary>As chaves do cofre que o serviço gerou (a criação e a troca de senha), na ordem: o buffer é o MESMO que ele guarda, e o teste confere se foi zerado.</summary>
    private readonly List<byte[]> _generatedKeys = [];
    private Exception? _deriveFailure;

    /// <summary>Quantas derivações passam antes de `_deriveFailure` começar a lançar: com 1, a conferência da senha atual passa e a derivação da senha nova lança.</summary>
    private int _deriveFailureAfter;

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private string VaultPath(string userName)
        => Path.Combine(_directory, "vaults", $"{userName}.vault.json");

    private VaultFileClient CreateClient()
        => new(Options.Create(VaultFakers.CreateOptions(_directory)), Logger.None);

    private VaultService CreateService(IVaultFileClient? client = null, VaultOptions? options = null, ILogger? logger = null)
        => new(client ?? CreateClient(), Options.Create(options ?? VaultFakers.CreateOptions(_directory)), Derive, GenerateKey, logger ?? Logger.None);

    private byte[] GenerateKey()
    {
        var key = VaultCrypto.NewKey();
        _generatedKeys.Add(key);

        return key;
    }

    /// <summary>
    /// A derivação de verdade, anotando com que parâmetros foi chamada e a chave que devolveu. Com
    /// `_deriveFailure` preenchido ela lança, no lugar de um defeito no meio de uma operação do serviço.
    /// </summary>
    private byte[] Derive(string password, VaultKdf kdf)
    {
        if (_deriveFailure is not null && _derivations.Count >= _deriveFailureAfter)
            throw _deriveFailure;

        var key = VaultCrypto.DeriveKey(password, kdf);
        _derivations.Add(kdf);
        _derivedKeys.Add(key);

        return key;
    }

    /// <summary>Cria o usuário com um serviço e o descarta: o arquivo fica no disco e o serviço do teste começa fechado.</summary>
    private async Task CreateVault(string userName, string password)
    {
        using var service = CreateService();
        await service.CreateAsync(userName, password, CancellationToken.None);
        _derivations.Clear();
        _derivedKeys.Clear();
    }

    /// <summary>Regrava o arquivo do cofre (o principal, ou o `.bak` quando o caminho é informado) com uma alteração no JSON, como faria quem o adulterasse.</summary>
    private void Tamper(Action<JsonNode> change, string? path = null)
    {
        path ??= VaultPath(_userName);
        var node = JsonNode.Parse(File.ReadAllText(path))!;
        change(node);
        File.WriteAllText(path, node.ToJsonString());
    }

    /// <summary>Cria o usuário e grava uma pasta: o arquivo principal tem a pasta, e o `.bak` guarda o cofre de antes dela. Zera a contagem de derivações.</summary>
    private async Task CreateVaultWithBackup()
    {
        using (var service = CreateService())
        {
            await service.CreateAsync(_userName, _password, CancellationToken.None);
            await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        }

        _derivations.Clear();
        _derivedKeys.Clear();
    }

    private static void FlipOneByte(JsonNode parent, string property)
    {
        var bytes = Convert.FromBase64String(parent[property]!.GetValue<string>());
        bytes[0] ^= 0x01;
        parent[property] = Convert.ToBase64String(bytes);
    }

    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "OK cria o arquivo e já deixa o cofre aberto")]
    public async Task Create_NewUser_CreatesFileAndUnlocks()
    {
        //Arrange
        var service = CreateService();

        //Act
        var result = await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Assert
        var document = service.Read();
        var derivation = Assert.Single(_derivations);
        Assert.True(result.IsSuccess);
        Assert.True(File.Exists(VaultPath(_userName)));
        Assert.True(service.IsUnlocked);
        Assert.Equal(_userName, service.UserName);
        Assert.True(document.IsSuccess);
        Assert.Equal(_userName, document.Value.UserName);
        Assert.Empty(document.Value.Folders);
        Assert.Empty(document.Value.Connections);
        Assert.Equal(("argon2id", 8192, 1, 1, 16), (derivation.Algorithm, derivation.MemoryKiB, derivation.Iterations, derivation.Parallelism, derivation.Salt.Length));
    }

    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro usuário que já tem cofre")]
    public async Task Create_ExistingUser_ReturnsUserAlreadyExists()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var existingBytes = File.ReadAllBytes(VaultPath(_userName));
        var service = CreateService();

        //Act
        var result = await service.CreateAsync(_userName, new Faker().Internet.Password(length: 16), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.UserAlreadyExists, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(existingBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Empty(_derivations);
    }

    /// <summary>RN-COFRE-007: um cofre aberto por vez, também quando o novo acaba de ser criado.</summary>
    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "OK criar outro usuário fecha o cofre que estava aberto")]
    public async Task Create_WhileAnotherIsOpen_ClosesThePrevious()
    {
        //Arrange
        var otherUserName = new Faker().Random.String2(length: 12, chars: Letters);
        var service = CreateService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var result = await service.CreateAsync(otherUserName, new Faker().Internet.Password(length: 16), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(otherUserName, service.UserName);
        Assert.Equal(otherUserName, service.Read().Value.UserName);
        Assert.Equal(1, lockedEvents);
    }

    /// <summary>Uma criação recusada não é uma entrada: quem está com o cofre aberto continua com ele.</summary>
    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro criação recusada não fecha o cofre que estava aberto")]
    public async Task Create_ExistingUserWhileAnotherIsOpen_KeepsThePreviousOpen()
    {
        //Arrange
        var service = CreateService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var result = await service.CreateAsync(_userName, new Faker().Internet.Password(length: 16), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.UserAlreadyExists, result.Error);
        Assert.True(service.IsUnlocked);
        Assert.Equal(_userName, service.UserName);
        Assert.Equal(0, lockedEvents);
    }

    /// <summary>Um arquivo ilegível ainda é o cofre de alguém (§7 da especificação): criar por cima apagaria o que a pessoa poderia recuperar.</summary>
    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro arquivo ilegível no lugar também conta como usuário existente")]
    public async Task Create_OverUnreadableFile_ReturnsUserAlreadyExistsAndKeepsTheFile()
    {
        //Arrange
        Directory.CreateDirectory(Path.GetDirectoryName(VaultPath(_userName))!);
        File.WriteAllText(VaultPath(_userName), "isto não é um cofre");
        var service = CreateService();

        //Act
        var result = await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.UserAlreadyExists, result.Error);
        Assert.Equal("isto não é um cofre", File.ReadAllText(VaultPath(_userName)));
    }

    /// <summary>
    /// RN-COFRE-005: o cofre que uma queda deixou só no `.bak` ainda é o cofre da pessoa. Criar o mesmo
    /// usuário por cima apagaria a única cópia; a conferência de existência o devolve ao lugar e recusa.
    /// </summary>
    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro cofre que ficou só no .bak conta como usuário existente")]
    public async Task Create_WhenOnlyBakExists_ReturnsUserAlreadyExists()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var existingBytes = File.ReadAllBytes(VaultPath(_userName));
        File.Move(VaultPath(_userName), VaultPath(_userName) + ".bak");
        var service = CreateService();

        //Act
        var result = await service.CreateAsync(_userName, new Faker().Internet.Password(length: 16), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.UserAlreadyExists, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(existingBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Empty(_derivations);
    }

    /// <summary>
    /// O que a leitura recusaria não é gravado: com parâmetros acima do teto o cofre nasceria ilegível, e
    /// a pessoa só descobriria na entrada seguinte, sem ter como voltar.
    /// </summary>
    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro parâmetros acima do teto não criam cofre")]
    public async Task Create_WithParametersAboveTheCeiling_Fails()
    {
        //Arrange
        var service = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 8192, Iterations = 9, Parallelism = 1 });

        //Act
        var result = await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Empty(Directory.GetFiles(_directory, "*", SearchOption.AllDirectories));
    }

    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro disco falhando na conferência de existência")]
    public async Task Create_WhenReadFails_ReturnsUnavailable()
    {
        //Arrange
        var service = CreateService(new RecordingClient(CreateClient()) { FailReads = true });

        //Act
        var result = await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.False(service.IsUnlocked);
    }

    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro disco falhando na gravação não deixa cofre aberto")]
    public async Task Create_WhenWriteFails_ReturnsUnavailable()
    {
        //Arrange
        var service = CreateService(new RecordingClient(CreateClient()) { FailWrites = true });

        //Act
        var result = await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.False(File.Exists(VaultPath(_userName)));
    }

    /// <summary>Critério de aceite 2: o arquivo do cofre não contém, em texto legível, nome de conexão, host, usuário ou senha.</summary>
    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "OK o arquivo em disco não tem nada em texto legível")]
    public async Task Create_FileHasNoPlainText()
    {
        //Arrange
        var connection = VaultFakers.CreateConnection(name: "MARCA-DO-NOME", host: "marca-do-host.exemplo", userName: "marca_do_usuario", password: "marca-da-senha");
        var folder = VaultFakers.CreateFolder(name: "MARCA-DA-PASTA");
        var service = CreateService();

        //Act
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var saved = await service.SaveAsync(document => document with { Folders = [folder], Connections = [connection] }, CancellationToken.None);

        //Assert
        // O arquivo cru não basta: o `payload` vai em base64, que esconderia até um conteúdo gravado em
        // claro. As marcas também não podem estar nos bytes do `payload.ciphertext` já decodificado.
        string[] marks = [connection.Name, connection.Host, connection.UserName, connection.Password, folder.Name, _password];
        var files = Directory.GetFiles(_directory, "*", SearchOption.AllDirectories);
        var storedCiphertext = Convert.FromBase64String(JsonNode.Parse(File.ReadAllText(VaultPath(_userName)))!["payload"]!["ciphertext"]!.GetValue<string>());
        Assert.True(saved.IsSuccess);
        Assert.Equal(2, files.Length);
        Assert.True(storedCiphertext.Length > marks.Sum(mark => mark.Length));

        foreach (var path in files)
        {
            var raw = File.ReadAllBytes(path);
            var ciphertext = Convert.FromBase64String(JsonNode.Parse(raw)!["payload"]!["ciphertext"]!.GetValue<string>());

            foreach (var mark in marks)
            {
                Assert.True(raw.AsSpan().IndexOf(Encoding.UTF8.GetBytes(mark)) < 0, $"O arquivo {Path.GetFileName(path)} tem a marca {mark} em texto legível.");
                Assert.True(ciphertext.AsSpan().IndexOf(Encoding.UTF8.GetBytes(mark)) < 0, $"O conteúdo cifrado de {Path.GetFileName(path)} tem a marca {mark} em claro.");
            }
        }
    }

    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK a senha certa abre o que foi gravado")]
    public async Task Unlock_WithRightPassword_ReturnsDocument()
    {
        //Arrange
        var expected = new VaultDocument(_userName, [VaultFakers.CreateFolder()], [VaultFakers.CreateConnection(), VaultFakers.CreateConnection()], [VaultFakers.CreateScript()], VaultFakers.CreateWorkspace(1, VaultFakers.CreateQueryTab(), VaultFakers.CreateTableTab()), []);

        using (var writer = CreateService())
        {
            await writer.CreateAsync(_userName, _password, CancellationToken.None);
            await writer.SaveAsync(_ => expected, CancellationToken.None);
        }

        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        var document = service.Read();
        Assert.True(result.IsSuccess);
        Assert.True(service.IsUnlocked);
        Assert.Equal(_userName, service.UserName);
        Assert.True(document.IsSuccess);
        Assert.True((document.Value with { Journal = null }).JsonEquals(expected));
    }

    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro senha errada")]
    public async Task Unlock_WithWrongPassword_ReturnsInvalidCredentials()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password + "x", CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Null(service.UserName);
        Assert.Single(_derivations);
    }

    /// <summary>RN-COFRE-006: usuário inexistente e senha errada dão a mesma resposta e o mesmo trabalho de derivação.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro usuário inexistente responde como senha errada e deriva do mesmo jeito")]
    public async Task Unlock_UnknownUser_ReturnsInvalidCredentialsAndStillDerives()
    {
        //Arrange
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        var derivation = Assert.Single(_derivations);
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(("argon2id", 8192, 1, 1, 16), (derivation.Algorithm, derivation.MemoryKiB, derivation.Iterations, derivation.Parallelism, derivation.Salt.Length));
    }

    /// <summary>
    /// Ruling 18: a entrada não valida o formato do nome. Um nome que a guarda de arquivo recusa (dispositivo
    /// do Windows, caminho, vazio) responde como senha errada, depois da mesma derivação (RN-COFRE-006).
    /// </summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro nome que a guarda de arquivo recusa responde como senha errada e deriva do mesmo jeito")]
    public async Task Unlock_UserNameRefusedByTheFileGuard_ReturnsInvalidCredentialsAndStillDerives()
    {
        //Arrange
        var service = CreateService();

        foreach (var refused in new[] { "con", "NUL.txt", @"..\x", string.Empty })
        {
            _derivations.Clear();

            //Act
            var result = await service.UnlockAsync(refused, _password, CancellationToken.None);

            //Assert
            Assert.True(result.IsFailure, refused);
            Assert.Equal(EVaultError.InvalidCredentials, result.Error);
            Assert.Single(_derivations);
        }
    }

    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro um byte trocado no conteúdo cifrado")]
    public async Task Unlock_TamperedPayload_ReturnsInvalidCredentials_Ciphertext()
    {
        //Arrange
        await CreateVault(_userName, _password);
        Tamper(node => FlipOneByte(node["payload"]!, "ciphertext"));
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
    }

    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro um byte trocado na tag do conteúdo")]
    public async Task Unlock_TamperedPayload_ReturnsInvalidCredentials_Tag()
    {
        //Arrange
        await CreateVault(_userName, _password);
        Tamper(node => FlipOneByte(node["payload"]!, "tag"));
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
    }

    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro um byte trocado no sal")]
    public async Task Unlock_TamperedPayload_ReturnsInvalidCredentials_Salt()
    {
        //Arrange
        await CreateVault(_userName, _password);
        Tamper(node => FlipOneByte(node["kdf"]!, "salt"));
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
    }

    /// <summary>De 1 para 2 passadas: continua na faixa aceita, então quem recusa é a cifra (a chave derivada muda), e não a conferência de formato.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro número de passadas alterado no cabeçalho")]
    public async Task Unlock_TamperedPayload_ReturnsInvalidCredentials_Iterations()
    {
        //Arrange
        await CreateVault(_userName, _password);
        Tamper(node => node["kdf"]!["iterations"] = 2);
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        var derivation = Assert.Single(_derivations);
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(2, derivation.Iterations);
    }

    /// <summary>Ruling 3: cofre ilegível responde como credencial inválida (§7 da especificação), com a mesma derivação de um usuário inexistente.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro arquivo ilegível responde como credencial inválida")]
    public async Task Unlock_CorruptFile_ReturnsInvalidCredentials()
    {
        //Arrange
        await CreateVault(_userName, _password);
        File.WriteAllText(VaultPath(_userName), "{ \"version\": 1, \"kdf\": ");
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Single(_derivations);
    }

    /// <summary>RN-COFRE-005: depois de uma queda no meio da troca, a pessoa entra e encontra a última versão inteira.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK cofre que ficou só no .bak abre na versão anterior")]
    public async Task Unlock_WhenOnlyBakExists_OpensThePreviousVersion()
    {
        //Arrange
        var previousFolder = VaultFakers.CreateFolder();

        using (var writer = CreateService())
        {
            await writer.CreateAsync(_userName, _password, CancellationToken.None);
            await writer.SaveAsync(document => document with { Folders = [previousFolder] }, CancellationToken.None);
            await writer.SaveAsync(document => document with { Folders = [.. document.Folders, VaultFakers.CreateFolder()] }, CancellationToken.None);
        }

        File.Delete(VaultPath(_userName));
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(service.IsUnlocked);
        Assert.Equal(previousFolder.ID, Assert.Single(service.Read().Value.Folders).ID);
        Assert.True(File.Exists(VaultPath(_userName)));
    }

    /// <summary>
    /// RN-VERSAO-005: o cofre de formato mais novo responde com erro próprio, e a recusa vem antes de a senha ser olhada: o mesmo
    /// erro com a senha certa e com a errada, nenhuma derivação de chave, e o arquivo e o `.bak` byte a byte como estavam.
    /// </summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro cofre de formato mais novo responde formato não suportado, sem derivar nem tocar nos arquivos")]
    public async Task Unlock_NewerFormat_ReturnsFormatUnsupportedWithoutDerivingOrTouchingFiles()
    {
        //Arrange
        await CreateVaultWithBackup();
        Tamper(node => node["version"] = VaultCrypto.Version + 1);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        var service = CreateService();

        //Act
        var withRightPassword = await service.UnlockAsync(_userName, _password, CancellationToken.None);
        var withWrongPassword = await service.UnlockAsync(_userName, _password + "x", CancellationToken.None);

        //Assert
        Assert.True(withRightPassword.IsFailure);
        Assert.Equal(EVaultError.FormatUnsupported, withRightPassword.Error);
        Assert.Equal(EVaultError.FormatUnsupported, withWrongPassword.Error);
        Assert.False(service.IsUnlocked);
        Assert.Empty(_derivations);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
    }

    /// <summary>RN-COFRE-007: o cofre aberto antes fecha mesmo quando a entrada seguinte é recusada, e este erro também é uma entrada recusada.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro cofre de formato mais novo também fecha o cofre que estava aberto")]
    public async Task Unlock_NewerFormat_ClosesThePreviouslyOpenVault()
    {
        //Arrange
        var otherUserName = new Faker().Random.String2(length: 12, chars: Letters);
        await CreateVault(_userName, _password);
        Tamper(node => node["version"] = VaultCrypto.Version + 1);
        var service = CreateService();
        await service.CreateAsync(otherUserName, _password, CancellationToken.None);

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.Equal(EVaultError.FormatUnsupported, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Null(service.UserName);
    }

    /// <summary>RN-VERSAO-005 com a RN-COFRE-005: o `.bak` de formato mais novo, sem o principal, tem a mesma resposta e não é promovido.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro .bak de formato mais novo sem o principal responde formato não suportado e não é promovido")]
    public async Task Unlock_WhenOnlyBakExistsAndIsNewer_ReturnsFormatUnsupportedAndDoesNotPromote()
    {
        //Arrange
        await CreateVaultWithBackup();
        File.Delete(VaultPath(_userName));
        Tamper(node => node["version"] = VaultCrypto.Version + 1, VaultPath(_userName) + ".bak");
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.Equal(EVaultError.FormatUnsupported, result.Error);
        Assert.False(File.Exists(VaultPath(_userName)));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.Empty(_derivations);
    }

    /// <summary>O principal manda: o `.bak` do formato atual não é usado no lugar de um principal de formato mais novo.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro principal de formato mais novo vale mesmo com .bak do formato atual")]
    public async Task Unlock_WhenMainIsNewerAndBakIsCurrent_ReturnsFormatUnsupportedAndTouchesNothing()
    {
        //Arrange
        await CreateVaultWithBackup();
        Tamper(node => node["version"] = VaultCrypto.Version + 1);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.Equal(EVaultError.FormatUnsupported, result.Error);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.Empty(_derivations);
    }

    /// <summary>
    /// RN-VERSAO-005: a única exceção ao 401 único é o formato MAIS NOVO. Formato 0, negativo ou que nem é número é cofre corrompido, e
    /// continua custando a derivação de uma senha errada.
    /// </summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro formato zero, negativo ou que não é número responde como credencial inválida")]
    public async Task Unlock_FormatThatIsNotNewer_ReturnsInvalidCredentials()
    {
        //Arrange
        var service = CreateService();

        foreach (var literal in new[] { "0", "-1", "\"2\"", "\"abc\"", "2.5", "true", "null" })
        {
            await CreateVault(_userName, _password);
            Tamper(node => node["version"] = JsonNode.Parse(literal));

            //Act
            var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

            //Assert
            Assert.True(result.IsFailure, literal);
            Assert.Equal(EVaultError.InvalidCredentials, result.Error);
            Assert.Single(_derivations);
            _derivations.Clear();
            File.Delete(VaultPath(_userName));
        }
    }

    /// <summary>Quem cria por cima apagaria o cofre de uma versão mais nova: é "já existe", e o arquivo não é tocado.</summary>
    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro cofre de formato mais novo conta como usuário existente, sem tocar nos arquivos")]
    public async Task Create_OverNewerFormat_ReturnsUserAlreadyExistsAndTouchesNothing()
    {
        //Arrange
        await CreateVaultWithBackup();
        Tamper(node => node["version"] = VaultCrypto.Version + 1);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        var service = CreateService();

        //Act
        var result = await service.CreateAsync(_userName, new Faker().Internet.Password(length: 16), CancellationToken.None);

        //Assert
        Assert.Equal(EVaultError.UserAlreadyExists, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.Empty(_derivations);
    }

    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "Erro .bak de formato mais novo sem o principal conta como usuário existente e não é promovido")]
    public async Task Create_WhenOnlyBakExistsAndIsNewer_ReturnsUserAlreadyExistsAndDoesNotPromote()
    {
        //Arrange
        await CreateVaultWithBackup();
        File.Delete(VaultPath(_userName));
        Tamper(node => node["version"] = VaultCrypto.Version + 1, VaultPath(_userName) + ".bak");
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        var service = CreateService();

        //Act
        var result = await service.CreateAsync(_userName, new Faker().Internet.Password(length: 16), CancellationToken.None);

        //Assert
        Assert.Equal(EVaultError.UserAlreadyExists, result.Error);
        Assert.False(File.Exists(VaultPath(_userName)));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.Empty(_derivations);
    }

    /// <summary>
    /// O `Unlock` fecha o cofre anterior antes de tentar. Se a tentativa termina em exceção (um defeito),
    /// o cofre já fechou, e quem assina `Locked` fecha as sessões com os bancos por esse aviso
    /// (RN-COFRE-008): ele tem de sair nessa mesma chamada, e não na seguinte.
    /// </summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Exceção depois de fechar o cofre anterior ainda avisa quem assina")]
    public async Task Unlock_ThatThrowsAfterClosingThePrevious_StillRaisesLocked()
    {
        //Arrange
        var service = CreateService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        _deriveFailure = new InvalidOperationException("defeito na derivação");

        //Act
        var exception = await Record.ExceptionAsync(() => service.UnlockAsync(_userName, _password, CancellationToken.None));

        //Assert
        Assert.Same(_deriveFailure, exception);
        Assert.False(service.IsUnlocked);
        Assert.Equal(1, lockedEvents);
    }

    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro disco falhando na leitura responde indisponível")]
    public async Task Unlock_WhenReadFails_ReturnsUnavailable()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var service = CreateService(new RecordingClient(CreateClient()) { FailReads = true });

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.False(service.IsUnlocked);
    }

    /// <summary>RN-COFRE-004: quem manda são os parâmetros gravados no cabeçalho, para um cofre antigo abrir depois que o padrão mudar.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK abre com os parâmetros do arquivo, e não com os da configuração")]
    public async Task Unlock_FileCreatedWithOtherParameters_UsesTheFileParameters()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var service = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 16384, Iterations = 2, Parallelism = 2 });

        //Act
        var result = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        var derivation = Assert.Single(_derivations);
        Assert.True(result.IsSuccess);
        Assert.True(service.IsUnlocked);
        Assert.Equal((8192, 1, 1), (derivation.MemoryKiB, derivation.Iterations, derivation.Parallelism));
    }

    /// <summary>RN-COFRE-007: um cofre aberto por vez.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK entrar com outro usuário fecha o anterior")]
    public async Task Unlock_WhileAnotherIsOpen_ClosesThePrevious()
    {
        //Arrange
        var otherUserName = new Faker().Random.String2(length: 12, chars: Letters);
        var otherPassword = new Faker().Internet.Password(length: 16);
        await CreateVault(_userName, _password);
        await CreateVault(otherUserName, otherPassword);
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        var previousKey = client.Opened[0];

        //Act
        var result = await service.UnlockAsync(otherUserName, otherPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(otherUserName, service.UserName);
        Assert.Equal(otherUserName, service.Read().Value.UserName);
        Assert.Equal(1, lockedEvents);
        Assert.All(previousKey, value => Assert.Equal(0, value));
    }

    /// <summary>RN-COFRE-007: o anterior fecha antes da tentativa, então uma entrada que falha não deixa o cofre de outra pessoa aberto.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro entrada que falha também fecha o cofre que estava aberto")]
    public async Task Unlock_WrongPasswordWhileAnotherIsOpen_StillClosesThePrevious()
    {
        //Arrange
        var service = CreateService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var result = await service.UnlockAsync(_userName, _password + "x", CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(1, lockedEvents);
    }

    /// <summary>A chave que sai da senha só serve para abrir a chave do cofre; depois disso não fica na memória.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK a chave derivada da senha é zerada depois de usada")]
    public async Task Unlock_ZeroesTheDerivedKeyAfterUse()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);
        await service.UnlockAsync(new Faker().Random.String2(length: 12, chars: Letters), _password, CancellationToken.None);

        //Assert
        Assert.Equal(4, _derivedKeys.Count);
        Assert.All(_derivedKeys, key => Assert.All(key, value => Assert.Equal(0, value)));
    }

    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "OK o que foi gravado volta depois de sair e entrar")]
    public async Task Save_Persists_AcrossLockAndUnlock()
    {
        //Arrange
        var folder = VaultFakers.CreateFolder();
        var connection = VaultFakers.CreateConnection(folderID: folder.ID);
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var saved = await service.SaveAsync(document => document with { Folders = [folder], Connections = [connection] }, CancellationToken.None);
        var afterSave = service.Read();
        service.Lock();
        var unlocked = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        var expected = new VaultDocument(_userName, [folder], [connection], [], VaultWorkspaceRecord.Empty, []);
        Assert.True(saved.IsSuccess);
        Assert.True((afterSave.Value with { Journal = null }).JsonEquals(expected));
        Assert.True(unlocked.IsSuccess);
        Assert.True((service.Read().Value with { Journal = null }).JsonEquals(expected));
    }

    /// <summary>
    /// RN-SCRIPT-002: o script mora no cofre, cifrado como o resto. Nem o SQL, nem o nome, nem o banco aparecem no arquivo, no `.bak` ou no temporário, em
    /// texto ou em base64 (o `byte[]` do arquivo é base64): só quem tem a senha os lê de volta.
    /// </summary>
    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "OK o script vai cifrado para o disco: nem o SQL nem o nome aparecem no arquivo")]
    public async Task Save_Script_IsNotWrittenInTheClear()
    {
        //Arrange
        var mark = Guid.NewGuid().ToString("N");
        var script = VaultFakers.CreateScript(name: $"Fechamento {mark}", sql: $"SELECT 'segredo-{mark}' FROM clientes", connectionID: Guid.CreateVersion7(), database: $"banco_{mark}");
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var saved = await service.SaveAsync(document => document with { Scripts = [script] }, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        service.Lock();
        var unlocked = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(saved.IsSuccess);
        Assert.True(unlocked.IsSuccess);
        Assert.Equal([script], service.Read().Value.Scripts);
        foreach (var path in Directory.GetFiles(Path.Combine(_directory, "vaults")))
        {
            var text = File.ReadAllText(path);
            var bytes = File.ReadAllBytes(path);
            Assert.DoesNotContain(mark, text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(Convert.ToBase64String(Encoding.UTF8.GetBytes(mark)), text, StringComparison.Ordinal);
            Assert.DoesNotContain("segredo", Encoding.UTF8.GetString(bytes), StringComparison.Ordinal);
        }
    }

    /// <summary>RN-VERSAO-005: o cofre nasce no formato atual, com a lista de scripts vazia (RN-SCRIPT-002) e a área de trabalho vazia (RN-ABAS-006).</summary>
    [Trait("VaultService", "CreateAsync")]
    [Fact(DisplayName = "OK o cofre criado é do formato atual e começa sem scripts e sem abas")]
    public async Task Create_WritesTheCurrentFormatWithoutScriptsNorTabs()
    {
        //Arrange
        var service = CreateService();

        //Act
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Assert
        var node = JsonNode.Parse(File.ReadAllText(VaultPath(_userName)))!;
        Assert.Equal(VaultCrypto.Version, node["version"]!.GetValue<int>());
        Assert.Empty(service.Read().Value.Scripts);
        Assert.Empty(service.Read().Value.Workspace.Tabs);
        Assert.Null(service.Read().Value.Workspace.ActiveIndex);
    }

    /// <summary>
    /// RN-ABAS-006: as abas moram no cofre, cifradas como os scripts (RN-SCRIPT-002). Nem o texto, nem o banco, nem o esquema, nem a tabela aparecem no arquivo,
    /// no `.bak` ou no temporário, em texto ou em base64, e voltam inteiros, na ordem e com a ativa, na entrada seguinte.
    /// </summary>
    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "OK as abas vão cifradas para o disco: nem o texto nem os nomes aparecem no arquivo")]
    public async Task Save_Workspace_IsNotWrittenInTheClear()
    {
        //Arrange
        var mark = Guid.NewGuid().ToString("N");
        var workspace = VaultFakers.CreateWorkspace(1, VaultFakers.CreateQueryTab(connectionID: Guid.CreateVersion7(), database: $"banco_{mark}", sql: $"SELECT 'segredo-{mark}' FROM clientes", scriptID: Guid.CreateVersion7(), dirty: true), VaultFakers.CreateTableTab(schema: $"esquema_{mark}", table: $"tabela_{mark}", view: "diagram"));
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var saved = await service.SaveAsync(document => document with { Workspace = workspace }, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        service.Lock();
        var unlocked = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(saved.IsSuccess);
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(workspace.Tabs, service.Read().Value.Workspace.Tabs);
        Assert.Equal(1, service.Read().Value.Workspace.ActiveIndex);
        foreach (var path in Directory.GetFiles(Path.Combine(_directory, "vaults")))
        {
            var text = File.ReadAllText(path);
            var bytes = File.ReadAllBytes(path);
            Assert.DoesNotContain(mark, text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(Convert.ToBase64String(Encoding.UTF8.GetBytes(mark)), text, StringComparison.Ordinal);
            Assert.DoesNotContain("segredo", Encoding.UTF8.GetString(bytes), StringComparison.Ordinal);
        }
    }

    /// <summary>Review Focus 1: carregar, alterar, cifrar e gravar acontecem um de cada vez, e nenhuma alteração simultânea se perde.</summary>
    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "OK cinquenta gravações simultâneas ficam todas")]
    public async Task Save_FiftyInParallel_KeepsEveryChange()
    {
        //Arrange
        var folders = Enumerable.Range(0, 50).Select(_ => VaultFakers.CreateFolder()).ToArray();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var results = await Task.WhenAll(folders.Select(folder => Task.Run(() => service.SaveAsync(document => document with { Folders = [.. document.Folders, folder] }, CancellationToken.None))));
        service.Lock();
        var unlocked = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.All(results, result => Assert.True(result.IsSuccess));
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(folders.Select(folder => folder.ID).Order(), service.Read().Value.Folders.Select(folder => folder.ID).Order());
    }

    /// <summary>
    /// Uma recusa decidida dentro da função (um 404 de apagar duas vezes) devolve o documento que recebeu. Regravar o
    /// cofre por isso faria o `.bak` igual ao arquivo atual e perderia a versão anterior. Antes da recusa há uma
    /// gravação de verdade, para o `.bak` existir e ter conteúdo diferente do arquivo principal.
    /// </summary>
    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "OK a mesma instância do documento não toca nos arquivos")]
    public async Task Save_WhenTheChangeReturnsTheSameDocument_DoesNotTouchTheFiles()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        var before = service.Read().Value;

        //Act
        var result = await service.SaveAsync(document => document, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.NotEqual(mainBytes, backupBytes);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.Same(before, service.Read().Value);
        Assert.True(service.IsUnlocked);
    }

    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Save_WhenLocked_ReturnsLocked()
    {
        //Arrange
        var changes = 0;
        var service = CreateService();

        //Act
        var result = await service.SaveAsync(document => { changes++; return document; }, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Locked, result.Error);
        Assert.Equal(0, changes);
    }

    /// <summary>§7 da especificação: na falha de gravação, o que estava gravado antes continua valendo, em disco e na memória.</summary>
    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "Erro disco falhando mantém o documento anterior")]
    public async Task Save_WhenWriteFails_ReturnsUnavailableAndKeepsThePreviousDocument()
    {
        //Arrange
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var storedBytes = File.ReadAllBytes(VaultPath(_userName));
        client.FailWrites = true;

        //Act
        var result = await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.True(service.IsUnlocked);
        Assert.Empty(service.Read().Value.Folders);
        Assert.Equal(storedBytes, File.ReadAllBytes(VaultPath(_userName)));
    }

    /// <summary>
    /// Uma exceção em `change` é defeito de quem chamou, e sobe. O que não pode é ela deixar o semáforo
    /// preso: a gravação seguinte ficaria esperando para sempre. O limite de tempo é o que faz o teste
    /// falhar, em vez de travar, se isso acontecer.
    /// </summary>
    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "Exceção na alteração sobe e não trava a gravação seguinte")]
    public async Task Save_WhenChangeThrows_DoesNotBlockTheNextSave()
    {
        //Arrange
        var folder = VaultFakers.CreateFolder();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var exception = await Record.ExceptionAsync(() => service.SaveAsync(_ => throw new InvalidOperationException("defeito de quem chamou"), CancellationToken.None));
        var next = await service.SaveAsync(document => document with { Folders = [folder] }, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
        Assert.True(next.IsSuccess);
        Assert.Equal(folder.ID, Assert.Single(service.Read().Value.Folders).ID);
    }

    /// <summary>
    /// O cancelamento é respeitado até a nova tentativa do client (RN-COFRE-013): toda gravação do serviço (a criação, a gravação comum e as duas da troca
    /// de senha) entrega ao client o token da requisição que a pediu, e é ele que interrompe as tentativas.
    /// </summary>
    [Trait("VaultService", "SaveAsync")]
    [Fact(DisplayName = "OK toda gravação entrega ao client o token da requisição")]
    public async Task Writes_PassTheRequestTokenToTheClient()
    {
        //Arrange
        using var source = new CancellationTokenSource();
        var token = source.Token;
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);

        //Act
        await service.CreateAsync(_userName, _password, token);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, token);
        await service.ChangePasswordAsync(_password, new Faker().Internet.Password(length: 16), token);

        //Assert
        Assert.Equal(4, client.WriteTokens.Count);
        Assert.All(client.WriteTokens, writeToken => Assert.Equal(token, writeToken));
    }

    [Trait("VaultService", "Read")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public void Read_WhenLocked_ReturnsLocked()
    {
        //Arrange
        var service = CreateService();

        //Act
        var result = service.Read();

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Locked, result.Error);
    }

    [Trait("VaultService", "Lock")]
    [Fact(DisplayName = "OK fechar avisa quem assina, uma vez por cofre fechado")]
    public async Task Lock_RaisesLockedEvent()
    {
        //Arrange
        var service = CreateService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        service.Lock();
        service.Lock();

        //Assert
        Assert.Equal(1, lockedEvents);
        Assert.False(service.IsUnlocked);
        Assert.Null(service.UserName);
        Assert.Equal(EVaultError.Locked, service.Read().Error);
    }

    /// <summary>
    /// O aviso sai depois de o serviço liberar o cofre: quem assina (o registro de sessões com os bancos)
    /// pode chamar o serviço de volta sem ficar esperando por si mesmo. O limite de tempo é o que faz o
    /// teste falhar, em vez de travar, se o aviso sair com o semáforo preso.
    /// </summary>
    [Trait("VaultService", "Lock")]
    [Fact(DisplayName = "OK quem assina o aviso pode chamar o serviço de volta")]
    public async Task Lock_SubscriberCanCallTheServiceBack()
    {
        //Arrange
        var service = CreateService();
        var unlockedSeenBySubscriber = true;
        service.Locked += () =>
        {
            unlockedSeenBySubscriber = service.IsUnlocked;
            service.Lock();
        };
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        await Task.Run(service.Lock).WaitAsync(TimeSpan.FromSeconds(10));

        //Assert
        Assert.False(unlockedSeenBySubscriber);
        Assert.False(service.IsUnlocked);
    }

    /// <summary>
    /// RN-COFRE-008: o app fechando zera a chave. A chave do cofre é o primeiro buffer que o `Open` do
    /// client devolve na entrada, e o serviço guarda esse mesmo buffer: é o que deixa o teste conferir
    /// os bytes sem abrir o estado privado do serviço.
    /// </summary>
    [Trait("VaultService", "Dispose")]
    [Fact(DisplayName = "OK descartar fecha o cofre e zera a chave")]
    public async Task Dispose_LocksAndZeroesTheKey()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        var key = client.Opened[0];
        var keyWhileOpen = key.ToArray();

        //Act
        service.Dispose();

        //Assert
        Assert.Equal(32, key.Length);
        Assert.Contains(keyWhileOpen, value => value != 0);
        Assert.All(key, value => Assert.Equal(0, value));
        Assert.Equal(1, lockedEvents);
        Assert.False(service.IsUnlocked);
        Assert.Equal(EVaultError.Locked, service.Read().Error);
    }

    /// <summary>RN-CONN-002: a senha certa devolve o documento do cofre que ela abriu, e é o mesmo que a leitura entrega.</summary>
    [Trait("VaultService", "ReadIfPasswordMatchesAsync")]
    [Fact(DisplayName = "OK senha certa devolve o documento do cofre aberto")]
    public async Task ReadIfPasswordMatches_Right_ReturnsTheDocument()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);

        //Act
        var result = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Same(service.Read().Value, result.Value);
        Assert.Equal(_userName, result.Value!.UserName);
        Assert.True(service.IsUnlocked);
    }

    [Trait("VaultService", "ReadIfPasswordMatchesAsync")]
    [Fact(DisplayName = "OK senha errada responde sucesso sem documento, sem fechar o cofre")]
    public async Task ReadIfPasswordMatches_Wrong_ReturnsNull()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var result = await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.True(service.IsUnlocked);
    }

    /// <summary>RN-CONN-003: o quinto erro seguido fecha o cofre.</summary>
    [Trait("VaultService", "ReadIfPasswordMatchesAsync")]
    [Fact(DisplayName = "Erro o quinto erro seguido fecha o cofre")]
    public async Task ReadIfPasswordMatches_FifthWrongInARow_LocksAndReturnsLocked()
    {
        //Arrange
        var service = CreateService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var firstFour = new List<Result<VaultDocument?, EVaultError>>();

        for (var attempt = 1; attempt <= 4; attempt++)
            firstFour.Add(await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None));

        var fifth = await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None);

        //Assert
        Assert.All(firstFour, result => Assert.Null(result.Value));
        Assert.True(fifth.IsFailure);
        Assert.Equal(EVaultError.Locked, fifth.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(1, lockedEvents);
    }

    /// <summary>RN-CONN-003: acertar zera a contagem.</summary>
    [Trait("VaultService", "ReadIfPasswordMatchesAsync")]
    [Fact(DisplayName = "OK acertar depois de quatro erros zera a contagem")]
    public async Task ReadIfPasswordMatches_RightAfterFourWrong_ResetsTheCount()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        for (var attempt = 1; attempt <= 4; attempt++)
            await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None);

        var right = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);
        var afterReset = new List<Result<VaultDocument?, EVaultError>>();

        for (var attempt = 1; attempt <= 4; attempt++)
            afterReset.Add(await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None));

        //Assert
        Assert.NotNull(right.Value);
        Assert.All(afterReset, result => Assert.Null(result.Value));
        Assert.True(service.IsUnlocked);
    }

    [Trait("VaultService", "ReadIfPasswordMatchesAsync")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task ReadIfPasswordMatches_WhenLocked_ReturnsLocked()
    {
        //Arrange
        var service = CreateService();

        //Act
        var result = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Locked, result.Error);
        Assert.Empty(_derivations);
    }

    /// <summary>
    /// A senha e o documento saem do mesmo cofre, na mesma operação. Quando outro usuário vira o cofre aberto, a senha do anterior
    /// não confere mais, e a do novo entrega o documento do novo: quem leu um dado do cofre anterior antes disso não consegue,
    /// com a senha do novo, confirmá-lo contra o cofre errado.
    /// </summary>
    [Trait("VaultService", "ReadIfPasswordMatchesAsync")]
    [Fact(DisplayName = "OK a senha do usuário anterior não confere depois de outro virar o cofre aberto")]
    public async Task ReadIfPasswordMatches_AfterAnotherUserBecameTheOpenVault_OnlyTheNewPasswordMatches()
    {
        //Arrange
        var otherUserName = new Faker().Random.String2(length: 12, chars: Letters);
        var otherPassword = new Faker().Internet.Password(length: 16);
        var connection = VaultFakers.CreateConnection(password: "senha-do-banco-do-primeiro");
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Connections = [connection] }, CancellationToken.None);
        await service.CreateAsync(otherUserName, otherPassword, CancellationToken.None);

        //Act
        var withTheFirstPassword = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);
        var withTheNewPassword = await service.ReadIfPasswordMatchesAsync(otherPassword, CancellationToken.None);

        //Assert
        Assert.True(withTheFirstPassword.IsSuccess);
        Assert.Null(withTheFirstPassword.Value);
        Assert.Equal(otherUserName, withTheNewPassword.Value!.UserName);
        Assert.Empty(withTheNewPassword.Value.Connections);
    }

    [Trait("VaultService", "Generation")]
    [Fact(DisplayName = "OK começa em zero e muda ao criar o usuário")]
    public async Task Generation_ChangesOnCreate()
    {
        //Arrange
        var service = CreateService();
        var before = service.Generation;

        //Act
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.Equal(0, before);
        Assert.NotEqual(before, service.Generation);
    }

    [Trait("VaultService", "Generation")]
    [Fact(DisplayName = "OK muda ao entrar")]
    public async Task Generation_ChangesOnUnlock()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var service = CreateService();
        var before = service.Generation;

        //Act
        var unlocked = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(unlocked.IsSuccess);
        Assert.NotEqual(before, service.Generation);
    }

    [Trait("VaultService", "Generation")]
    [Fact(DisplayName = "OK muda ao sair")]
    public async Task Generation_ChangesOnLock()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var before = service.Generation;

        //Act
        service.Lock();

        //Assert
        Assert.NotEqual(before, service.Generation);
    }

    [Trait("VaultService", "Generation")]
    [Fact(DisplayName = "OK muda ao fechar pelo quinto erro de senha")]
    public async Task Generation_ChangesOnTheFifthWrongPassword()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var generations = new List<long>();

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None);
            generations.Add(service.Generation);
        }

        //Assert
        Assert.Single(generations.Take(4).Distinct());
        Assert.NotEqual(generations[3], generations[4]);
        Assert.False(service.IsUnlocked);
    }

    [Trait("VaultService", "Generation")]
    [Fact(DisplayName = "OK muda ao trocar de usuário, criando ou entrando")]
    public async Task Generation_ChangesWhenAnotherUserTakesOver()
    {
        //Arrange
        var otherUserName = new Faker().Random.String2(length: 12, chars: Letters);
        var otherPassword = new Faker().Internet.Password(length: 16);
        await CreateVault(otherUserName, otherPassword);
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var afterFirst = service.Generation;

        //Act
        var created = await service.CreateAsync(new Faker().Random.String2(length: 12, chars: Letters), _password, CancellationToken.None);
        var afterCreate = service.Generation;
        var unlocked = await service.UnlockAsync(otherUserName, otherPassword, CancellationToken.None);
        var afterUnlock = service.Generation;

        //Assert
        Assert.True(created.IsSuccess);
        Assert.True(unlocked.IsSuccess);
        Assert.NotEqual(afterFirst, afterCreate);
        Assert.NotEqual(afterCreate, afterUnlock);
    }

    [Trait("VaultService", "Generation")]
    [Fact(DisplayName = "OK não muda numa gravação, numa recusa, numa leitura nem numa conferência de senha")]
    public async Task Generation_DoesNotChangeOnSaveOrRead()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var before = service.Generation;

        //Act
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        await service.SaveAsync(document => document, CancellationToken.None);
        service.Read();
        await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None);
        await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);

        //Assert
        Assert.Equal(before, service.Generation);
    }

    [Trait("VaultService", "Generation")]
    [Fact(DisplayName = "OK entrada que falha com o cofre já fechado não muda a geração")]
    public async Task Generation_DoesNotChangeOnAFailedUnlockWithNothingOpen()
    {
        //Arrange
        var service = CreateService();
        var before = service.Generation;

        //Act
        var unlocked = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(unlocked.IsFailure);
        Assert.Equal(before, service.Generation);
    }

    /// <summary>
    /// O contêiner montado como no `ApiHost` dos testes de integração, sem o `UseSerilog` do `Program.cs`:
    /// o serviço resolve, é um só, grava na pasta de dados que recebeu e fecha o cofre quando o contêiner
    /// é descartado (RN-COFRE-008, o caminho do desligamento normal da API).
    /// </summary>
    [Trait("DependencyInjection", "AddInfrastructure")]
    [Fact(DisplayName = "OK o contêiner entrega um único serviço do cofre e o fecha ao ser descartado")]
    public async Task AddInfrastructure_RegistersTheVaultServiceAsADisposableSingleton()
    {
        //Arrange
        var provider = new ServiceCollection().AddInfrastructure(_directory).BuildServiceProvider();
        var service = provider.GetRequiredService<IVaultService>();
        var resolvedAgain = provider.GetRequiredService<IVaultService>();

        //Act
        var created = await service.CreateAsync(_userName, _password, CancellationToken.None);
        var unlockedBeforeDispose = service.IsUnlocked;
        await provider.DisposeAsync();

        //Assert
        Assert.Same(service, resolvedAgain);
        Assert.True(created.IsSuccess);
        Assert.True(unlockedBeforeDispose);
        Assert.True(File.Exists(VaultPath(_userName)));
        Assert.False(service.IsUnlocked);
    }

    /// <summary>
    /// O client de verdade por baixo. Guarda o que `Open` devolveu, para o teste segurar o mesmo buffer
    /// que o serviço guarda, e falha a leitura ou a gravação quando o teste pede, no lugar de um disco
    /// com defeito.
    /// </summary>
    private sealed class RecordingClient(IVaultFileClient inner) : IVaultFileClient
    {
        public List<byte[]> Opened { get; } = [];

        /// <summary>O token que cada gravação recebeu, na ordem.</summary>
        public List<CancellationToken> WriteTokens { get; } = [];

        /// <summary>Quantas vezes o serviço olhou o `.bak`.</summary>
        public int BackupReads { get; private set; }

        public bool FailReads { get; init; }
        public bool FailWrites { get; set; }

        /// <summary>Quantas gravações chegaram ao client, as que falham também (a primeira é a 1).</summary>
        public int Writes { get; private set; }

        /// <summary>A partir de qual gravação o disco falha (1 é a primeira): com 2, a primeira passa e a segunda, e as seguintes, falham.</summary>
        public int FailWritesFrom { get; set; } = int.MaxValue;

        /// <summary>Roda no começo de cada gravação, depois de contada, ainda sem gravar: é por onde o teste segura uma gravação no meio.</summary>
        public Action<int>? OnWrite { get; set; }

        public Result<Maybe<VaultFile>, EVaultFileError> Read(string userName)
            => FailReads ? EVaultFileError.Unavailable : inner.Read(userName);

        public Result<Maybe<VaultFile>, EVaultFileError> ReadBackup(string userName)
        {
            BackupReads++;

            return FailReads ? EVaultFileError.Unavailable : inner.ReadBackup(userName);
        }

        public UnitResult<EVaultFileError> Write(string userName, VaultFile file, CancellationToken cancellationToken = default)
        {
            var number = ++Writes;
            WriteTokens.Add(cancellationToken);
            OnWrite?.Invoke(number);

            return FailWrites || number >= FailWritesFrom ? EVaultFileError.Unavailable : inner.Write(userName, file);
        }

        public Result<byte[], EVaultFileError> Open(byte[] key, VaultSealedBox box, byte[] associatedData)
        {
            var opened = inner.Open(key, box, associatedData);

            if (opened.IsSuccess)
                Opened.Add(opened.Value);

            return opened;
        }
    }
}
