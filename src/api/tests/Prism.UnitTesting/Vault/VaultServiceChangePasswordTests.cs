using Bogus;
using CSharpFunctionalExtensions;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Vault;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using Serilog.Formatting.Display;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// RN-COFRE-013: trocar a senha RECIFRA o cofre: gera uma chave do cofre nova (RN-COFRE-003), cifra o conteúdo com ela e a embrulha com a chave derivada
/// da senha nova (sal novo, parâmetros atuais, cabeçalho autenticado). Grava pela gravação de sempre e depois uma segunda vez, para o `.bak` também ficar
/// com a senha nova. É a mesma classe do `VaultServiceTests`, em outro arquivo, para usar os mesmos auxiliares (`CreateService`, `Derive`, `RecordingClient`).
/// </summary>
public sealed partial class VaultServiceTests
{
    /// <summary>Uma senha sorteada, de 16 caracteres (dentro da RN-COFRE-010) e diferente da `_password`.</summary>
    private static string NewPassword()
        => new Faker().Internet.Password(length: 16);

    private JsonNode ReadVaultJson(string? path = null)
        => JsonNode.Parse(File.ReadAllText(path ?? VaultPath(_userName)))!;

    /// <summary>Os parâmetros de derivação como o arquivo os grava (RN-COFRE-004).</summary>
    private static (string Algorithm, int MemoryKiB, int Iterations, int Parallelism, byte[] Salt) KdfOf(JsonNode file)
        => (file["kdf"]!["algorithm"]!.GetValue<string>(), file["kdf"]!["memoryKiB"]!.GetValue<int>(), file["kdf"]!["iterations"]!.GetValue<int>(), file["kdf"]!["parallelism"]!.GetValue<int>(), Convert.FromBase64String(file["kdf"]!["salt"]!.GetValue<string>()));

    /// <summary>Abre o que está no DISCO com um serviço novo: é o que a próxima entrada veria, sem o estado em memória do serviço do teste.</summary>
    private async Task<bool> OpensFromDisk(string password, string? userName = null)
    {
        using var service = CreateService();

        return (await service.UnlockAsync(userName ?? _userName, password, CancellationToken.None)).IsSuccess;
    }

    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK a senha nova abre o cofre e a antiga deixa de abrir")]
    public async Task ChangePassword_RightCurrent_TheNewOpensAndTheOldDoesNot()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()], Connections = [VaultFakers.CreateConnection()] }, CancellationToken.None);
        var before = service.Read().Value;

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        service.Lock();
        var withTheOld = await service.UnlockAsync(_userName, _password, CancellationToken.None);
        var withTheNew = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(withTheOld.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, withTheOld.Error);
        Assert.True(withTheNew.IsSuccess);
        Assert.True((service.Read().Value with { Journal = null }).JsonEquals(before with { Journal = null }));
    }

    /// <summary>
    /// RN-COFRE-013: o cofre continua aberto, com o mesmo conteúdo, e as sessões com os bancos não caem: quem as fecha é o aviso `Locked`, e quem
    /// as recusa na abertura é a mudança de geração (`VaultChanged`). Nenhum dos dois acontece numa troca de senha.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK o cofre continua aberto, com o mesmo conteúdo, sem avisar quem assina nem mudar a geração")]
    public async Task ChangePassword_KeepsTheVaultOpenWithTheSameContent()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var before = service.Read().Value;
        var generation = service.Generation;

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(service.IsUnlocked);
        Assert.Equal(_userName, service.UserName);
        Assert.True((service.Read().Value with { Journal = null }).JsonEquals(before with { Journal = null }));
        Assert.Equal(0, lockedEvents);
        Assert.Equal(generation, service.Generation);
    }

    /// <summary>A conferência da senha (revelar, trocar de novo) já vale com a senha nova na própria sessão, sem sair e entrar.</summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK a conferência de senha da sessão passa a ser a da senha nova")]
    public async Task ChangePassword_TheOpenSessionNowChecksAgainstTheNewPassword()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var withTheOld = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);
        var withTheNew = await service.ReadIfPasswordMatchesAsync(newPassword, CancellationToken.None);

        //Assert
        Assert.Null(withTheOld.Value);
        Assert.Same(service.Read().Value, withTheNew.Value);
    }

    /// <summary>
    /// RN-COFRE-003 e 013: a chave do cofre GIRA na troca. A chave nova é outra (256 bits, do mesmo gerador da criação), a que estava viva na memória é
    /// zerada depois de o `_open` trocar, e é a nova que a entrada seguinte encontra no arquivo.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK a chave do cofre gira: a nova é outra, e a antiga é zerada da memória")]
    public async Task ChangePassword_RotatesTheVaultKey_AndZeroesTheOldOne()
    {
        //Arrange
        var newPassword = NewPassword();
        await CreateVault(_userName, _password);
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        var keyBefore = client.Opened[0].ToArray();

        //Act
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var oldBufferAfterTheChange = client.Opened[0].ToArray();
        service.Lock();
        await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        // Opened: [0] a chave do cofre e [1] o conteúdo da entrada; [2] a cópia da conferência da troca; [3] a chave do cofre da entrada seguinte.
        var keyAfter = client.Opened[3];
        Assert.Equal(32, keyBefore.Length);
        Assert.Contains(keyBefore, value => value != 0);
        Assert.All(oldBufferAfterTheChange, value => Assert.Equal(0, value));
        Assert.Equal(32, keyAfter.Length);
        Assert.NotEqual(keyBefore, keyAfter);
    }

    /// <summary>
    /// RN-COFRE-013: o que a troca quer: quem tem a senha ANTIGA e uma CÓPIA do arquivo de antes da troca (um backup, o histórico de uma pasta
    /// sincronizada) não lê o arquivo de depois. A chave do cofre que a cópia antiga entrega não decifra o conteúdo novo, nem o gravado depois da troca.
    /// O ataque é exercido de verdade: a chave é tirada da cópia antiga com a senha antiga, e abre a cópia (a prova não vale sem isso).
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK a senha antiga e uma cópia do arquivo de antes não leem o arquivo de depois")]
    public async Task ChangePassword_TheKeyOfAnOldCopyDoesNotDecryptTheNewContent()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()], Connections = [VaultFakers.CreateConnection()] }, CancellationToken.None);
        var oldCopy = ReadStoredFile();
        var keyOfTheOldCopy = UnwrapKey(oldCopy, _password);

        //Act
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var afterTheChange = ReadStoredFile();
        await service.SaveAsync(document => document with { Folders = [.. document.Folders, VaultFakers.CreateFolder()] }, CancellationToken.None);
        var afterALaterSave = ReadStoredFile();
        var backup = ReadStoredBackup();

        //Assert
        // O ataque funciona contra a cópia antiga: a chave que ela entrega abre o conteúdo dela.
        Assert.NotEmpty(VaultCrypto.Open(keyOfTheOldCopy, oldCopy.Payload, VaultCrypto.AssociatedData(oldCopy.Version, oldCopy.Kdf)));
        // E não abre nada do que veio depois: o conteúdo da troca, o gravado depois dela, e o `.bak` que a troca deixou.
        foreach (var file in new[] { afterTheChange, afterALaterSave, backup })
            Assert.ThrowsAny<CryptographicException>(() => VaultCrypto.Open(keyOfTheOldCopy, file.Payload, VaultCrypto.AssociatedData(file.Version, file.Kdf)));

        // Nem tirar a chave do arquivo novo com a senha antiga: o embrulho novo é da senha nova.
        Assert.ThrowsAny<CryptographicException>(() => UnwrapKey(afterTheChange, _password));
        var keyOfTheNewFile = UnwrapKey(afterTheChange, newPassword);
        Assert.NotEqual(keyOfTheOldCopy, keyOfTheNewFile);
        Assert.NotEmpty(VaultCrypto.Open(keyOfTheNewFile, afterTheChange.Payload, VaultCrypto.AssociatedData(afterTheChange.Version, afterTheChange.Kdf)));
    }

    /// <summary>O `.bak` como o disco o tem: o arquivo da cópia de segurança (RN-COFRE-005), lido como o client lê o principal.</summary>
    private VaultFile ReadStoredBackup()
        => JsonSerializer.Deserialize<VaultFile>(File.ReadAllBytes(VaultPath(_userName) + ".bak"), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    /// <summary>O arquivo principal como o disco o tem, lido pelo client de verdade (é o que um backup copiaria).</summary>
    private VaultFile ReadStoredFile()
        => CreateClient().Read(_userName).Value.Value;

    /// <summary>
    /// O que quem tem a senha e UM arquivo consegue: a chave do cofre, tirada do `wrappedKey` com a chave derivada da senha e o cabeçalho daquele arquivo.
    /// Lança (<see cref="CryptographicException"/>) se a senha não é a daquele arquivo.
    /// </summary>
    private static byte[] UnwrapKey(VaultFile file, string password)
        => VaultCrypto.Open(VaultCrypto.DeriveKey(password, file.Kdf), file.WrappedKey, VaultCrypto.AssociatedData(file.Version, file.Kdf));

    /// <summary>
    /// RN-COFRE-013 e RN-COFRE-004: sal novo e os parâmetros ATUAIS das opções. Um cofre criado com parâmetros mais fracos passa a ter os de agora; a
    /// conferência da senha atual usa os do arquivo, e a derivação da senha nova, os das opções com o sal novo que foi para o arquivo.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK sal novo e parâmetros atuais das opções no cabeçalho, mesmo num cofre criado com parâmetros mais fracos")]
    public async Task ChangePassword_WritesANewSaltAndTheCurrentParameters()
    {
        //Arrange
        var newPassword = NewPassword();
        await CreateVault(_userName, _password);
        var before = ReadVaultJson();
        var service = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 16384, Iterations = 2, Parallelism = 2 });
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        _derivations.Clear();

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var after = ReadVaultJson();
        service.Lock();
        _derivations.Clear();
        await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        var kdfBefore = KdfOf(before);
        var kdfAfter = KdfOf(after);
        Assert.True(result.IsSuccess);
        Assert.Equal(VaultCrypto.Version, after["version"]!.GetValue<int>());
        Assert.Equal(("argon2id", 8192, 1, 1), (kdfBefore.Algorithm, kdfBefore.MemoryKiB, kdfBefore.Iterations, kdfBefore.Parallelism));
        Assert.Equal(("argon2id", 16384, 2, 2), (kdfAfter.Algorithm, kdfAfter.MemoryKiB, kdfAfter.Iterations, kdfAfter.Parallelism));
        Assert.Equal(16, kdfAfter.Salt.Length);
        Assert.NotEqual(kdfBefore.Salt, kdfAfter.Salt);
        Assert.NotEqual(before["wrappedKey"]!["nonce"]!.GetValue<string>(), after["wrappedKey"]!["nonce"]!.GetValue<string>());
        Assert.NotEqual(before["payload"]!["nonce"]!.GetValue<string>(), after["payload"]!["nonce"]!.GetValue<string>());
        // A entrada seguinte deriva com o que ficou no arquivo.
        var unlockDerivation = Assert.Single(_derivations);
        Assert.Equal((16384, 2, 2), (unlockDerivation.MemoryKiB, unlockDerivation.Iterations, unlockDerivation.Parallelism));
        Assert.Equal(kdfAfter.Salt, unlockDerivation.Salt);
    }

    /// <summary>
    /// RN-COFRE-013: os parâmetros da troca nunca são mais fracos que os do arquivo, campo a campo (o maior entre o do arquivo e o das opções). Um arquivo
    /// criado com parâmetros mais FORTES que os das opções (por uma versão futura, ou com opções de outra época) não é rebaixado: com todos os campos mais
    /// fortes no arquivo, ficam os dele; sal novo do mesmo jeito.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK um arquivo com parâmetros mais fortes que os das opções não é rebaixado pela troca")]
    public async Task ChangePassword_FileWithStrongerParameters_IsNotDowngraded()
    {
        //Arrange
        var newPassword = NewPassword();
        using (var creator = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 32768, Iterations = 3, Parallelism = 2 }))
            await creator.CreateAsync(_userName, _password, CancellationToken.None);

        var saltBefore = KdfOf(ReadVaultJson()).Salt;
        var service = CreateService();
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        _derivations.Clear();

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var after = KdfOf(ReadVaultJson());
        service.Lock();
        _derivations.Clear();
        await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(("argon2id", 32768, 3, 2), (after.Algorithm, after.MemoryKiB, after.Iterations, after.Parallelism));
        Assert.NotEqual(saltBefore, after.Salt);
        var derivation = Assert.Single(_derivations);
        Assert.Equal((32768, 3, 2), (derivation.MemoryKiB, derivation.Iterations, derivation.Parallelism));
    }

    /// <summary>O maior é por CAMPO: o arquivo é mais forte na memória e no paralelismo, as opções nas passadas, e o resultado leva o melhor de cada um.</summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK com parâmetros mistos a troca leva o maior de cada campo")]
    public async Task ChangePassword_MixedParameters_TakesTheLargestOfEachField()
    {
        //Arrange
        using (var creator = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 32768, Iterations = 1, Parallelism = 2 }))
            await creator.CreateAsync(_userName, _password, CancellationToken.None);

        var service = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 16384, Iterations = 2, Parallelism = 1 });
        await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Act
        var result = await service.ChangePasswordAsync(_password, NewPassword(), CancellationToken.None);

        //Assert
        var after = KdfOf(ReadVaultJson());
        Assert.True(result.IsSuccess);
        Assert.Equal((32768, 2, 2), (after.MemoryKiB, after.Iterations, after.Parallelism));
    }

    /// <summary>A conferência da senha atual usa os parâmetros e o sal do arquivo (os de antes); a derivação da senha nova, os da troca.</summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK confere com os parâmetros do arquivo e deriva a senha nova com o sal que gravou")]
    public async Task ChangePassword_DerivesTwice_FileParametersThenTheNewOnes()
    {
        //Arrange
        var newPassword = NewPassword();
        await CreateVault(_userName, _password);
        var saltBefore = KdfOf(ReadVaultJson()).Salt;
        var service = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 16384, Iterations = 2, Parallelism = 2 });
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        _derivations.Clear();

        //Act
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);

        //Assert
        var saltAfter = KdfOf(ReadVaultJson()).Salt;
        Assert.Equal(2, _derivations.Count);
        Assert.Equal((8192, 1, 1), (_derivations[0].MemoryKiB, _derivations[0].Iterations, _derivations[0].Parallelism));
        Assert.Equal(saltBefore, _derivations[0].Salt);
        Assert.Equal((16384, 2, 2), (_derivations[1].MemoryKiB, _derivations[1].Iterations, _derivations[1].Parallelism));
        Assert.Equal(saltAfter, _derivations[1].Salt);
        Assert.NotEqual(saltBefore, saltAfter);
    }

    /// <summary>
    /// RN-COFRE-004: o cabeçalho é dado autenticado das duas cifras. O sal novo e o `payload` re-cifrado entram juntos: trocar um byte do sal do
    /// arquivo novo faz a senha nova não abrir mais (a tag não confere), e é o que impede um cabeçalho de uma gravação com o conteúdo de outra.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK o cabeçalho novo é autenticado: um byte trocado no sal e a senha nova não abre")]
    public async Task ChangePassword_TheNewHeaderIsAuthenticated()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var intact = await OpensFromDisk(newPassword);

        //Act
        Tamper(node => FlipOneByte(node["kdf"]!, "salt"));
        var tampered = await OpensFromDisk(newPassword);

        //Assert
        Assert.True(intact);
        Assert.False(tampered);
    }

    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro senha atual errada")]
    public async Task ChangePassword_WrongCurrent_ReturnsCurrentPasswordInvalidAndChangesNothing()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        var before = service.Read().Value;

        //Act
        var result = await service.ChangePasswordAsync(_password + "x", newPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.CurrentPasswordInvalid, result.Error);
        Assert.True(service.IsUnlocked);
        Assert.True((service.Read().Value with { Journal = null }).JsonEquals(before with { Journal = null }));
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.True(await OpensFromDisk(_password));
        Assert.False(await OpensFromDisk(newPassword));
    }

    /// <summary>
    /// RN-COFRE-013: a senha atual errada demora o mesmo que uma entrada errada (RN-COFRE-006): uma derivação, com o sal e os parâmetros do arquivo,
    /// e nenhum atalho antes dela (a senha nova nem chega a ser derivada). A prova não usa tempo: o `Derive` do teste anota cada chamada.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro senha atual errada custa a mesma derivação de uma entrada errada")]
    public async Task ChangePassword_WrongCurrent_CostsOneDerivationLikeAWrongUnlock()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var service = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 16384, Iterations = 2, Parallelism = 2 });
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        _derivations.Clear();
        var fileKdf = KdfOf(ReadVaultJson());

        //Act
        await service.ChangePasswordAsync(_password + "x", NewPassword(), CancellationToken.None);
        var forTheChange = _derivations.ToList();
        _derivations.Clear();
        await service.UnlockAsync(_userName, _password + "x", CancellationToken.None);
        var forTheUnlock = _derivations.ToList();

        //Assert
        var derivation = Assert.Single(forTheChange);
        Assert.Equal((fileKdf.MemoryKiB, fileKdf.Iterations, fileKdf.Parallelism), (derivation.MemoryKiB, derivation.Iterations, derivation.Parallelism));
        Assert.Equal(fileKdf.Salt, derivation.Salt);
        var unlockDerivation = Assert.Single(forTheUnlock);
        Assert.Equal((derivation.MemoryKiB, derivation.Iterations, derivation.Parallelism), (unlockDerivation.MemoryKiB, unlockDerivation.Iterations, unlockDerivation.Parallelism));
        Assert.Equal(derivation.Salt, unlockDerivation.Salt);
    }

    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro senha nova igual à atual")]
    public async Task ChangePassword_SameAsCurrent_ReturnsPasswordUnchangedAndChangesNothing()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var before = service.Read().Value;
        _derivations.Clear();

        //Act
        var result = await service.ChangePasswordAsync(_password, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.PasswordUnchanged, result.Error);
        // A recusa vem depois da conferência da senha atual: uma derivação (a da conferência), e nenhuma para a senha nova.
        Assert.Single(_derivations);
        Assert.True(service.IsUnlocked);
        Assert.True((service.Read().Value with { Journal = null }).JsonEquals(before with { Journal = null }));
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(VaultPath(_userName))!, "*.bak"));
    }

    /// <summary>
    /// A igualdade só se olha depois de a senha atual conferir: com a atual errada e igual à nova, a resposta é a de senha errada. Quem tentasse
    /// o atalho (comparar as duas antes de derivar) responderia "igual" a quem nem sabe a senha, e sem a derivação.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro senha atual errada e igual à nova responde senha errada, e não senha igual")]
    public async Task ChangePassword_WrongCurrentEqualToTheNew_ReturnsCurrentPasswordInvalid()
    {
        //Arrange
        var wrong = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        _derivations.Clear();

        //Act
        var result = await service.ChangePasswordAsync(wrong, wrong, CancellationToken.None);

        //Assert
        Assert.Equal(EVaultError.CurrentPasswordInvalid, result.Error);
        Assert.Single(_derivations);
    }

    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task ChangePassword_WhenLocked_ReturnsLockedWithoutDerivingOrWriting()
    {
        //Arrange
        var service = CreateService();

        //Act
        var result = await service.ChangePasswordAsync(_password, NewPassword(), CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Locked, result.Error);
        Assert.Empty(_derivations);
        Assert.False(Directory.Exists(Path.Combine(_directory, "vaults")));
    }

    /// <summary>
    /// A conferência é a mesma da revelação da senha de uma conexão (RN-CONN-002 e 003), com a mesma contagem: o quinto erro seguido, somando
    /// os dois caminhos, fecha o cofre e responde `Locked`, e acertar zera.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro o quinto erro seguido fecha o cofre, e a contagem é a mesma da revelação de senha")]
    public async Task ChangePassword_FifthWrongInARow_LocksTheVault_CountingTheRevealToo()
    {
        //Arrange
        var service = CreateService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None);
        await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None);
        var firstChanges = new List<UnitResult<EVaultError>>();

        for (var attempt = 1; attempt <= 2; attempt++)
            firstChanges.Add(await service.ChangePasswordAsync(_password + "x", NewPassword(), CancellationToken.None));

        var fifth = await service.ChangePasswordAsync(_password + "x", NewPassword(), CancellationToken.None);

        //Assert
        Assert.All(firstChanges, change => Assert.Equal(EVaultError.CurrentPasswordInvalid, change.Error));
        Assert.True(fifth.IsFailure);
        Assert.Equal(EVaultError.Locked, fifth.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(1, lockedEvents);
    }

    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK acertar a senha atual zera a contagem de erros")]
    public async Task ChangePassword_RightAfterFourWrong_ResetsTheCount()
    {
        //Arrange
        var firstPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        for (var attempt = 1; attempt <= 4; attempt++)
            await service.ChangePasswordAsync(_password + "x", NewPassword(), CancellationToken.None);

        var right = await service.ChangePasswordAsync(_password, firstPassword, CancellationToken.None);
        var afterReset = new List<UnitResult<EVaultError>>();

        for (var attempt = 1; attempt <= 4; attempt++)
            afterReset.Add(await service.ChangePasswordAsync(firstPassword + "x", NewPassword(), CancellationToken.None));

        //Assert
        Assert.True(right.IsSuccess);
        Assert.All(afterReset, change => Assert.Equal(EVaultError.CurrentPasswordInvalid, change.Error));
        Assert.True(service.IsUnlocked);
    }

    /// <summary>
    /// §7 da especificação e RN-COFRE-013: a falha da primeira gravação deixa o cofre abrindo com a senha e a CHAVE antigas, em disco e na memória, e a
    /// segunda gravação nem é tentada. A chave nova gerada para a troca nunca chega ao `_open`: a gravação comum que vem depois ainda sela com a antiga,
    /// no cabeçalho antigo, e o arquivo abre com a senha antiga.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro disco falhando mantém a senha e a chave antigas, em disco e na memória, e a troca seguinte funciona")]
    public async Task ChangePassword_WhenTheFirstWriteFails_ReturnsUnavailableAndKeepsTheOldPasswordAndKey()
    {
        //Arrange
        var newPassword = NewPassword();
        var folder = VaultFakers.CreateFolder();
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var before = service.Read().Value;
        var writesBefore = client.Writes;
        client.FailWrites = true;

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var memoryWithTheOld = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);
        var memoryWithTheNew = await service.ReadIfPasswordMatchesAsync(newPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.Equal(1, client.Writes - writesBefore);
        Assert.True(service.IsUnlocked);
        Assert.True((service.Read().Value with { Journal = null }).JsonEquals(before with { Journal = null }));
        Assert.Same(before, memoryWithTheOld.Value);
        Assert.Null(memoryWithTheNew.Value);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.True(await OpensFromDisk(_password));
        Assert.False(await OpensFromDisk(newPassword));

        // A chave e o cabeçalho antigos seguem valendo: uma gravação comum depois da falha abre com a senha antiga, com a pasta nova.
        client.FailWrites = false;
        var saved = await service.SaveAsync(document => document with { Folders = [.. document.Folders, folder] }, CancellationToken.None);

        Assert.True(saved.IsSuccess);
        Assert.True(await OpensFromDisk(_password));
        Assert.False(await OpensFromDisk(newPassword));

        var retried = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);

        Assert.True(retried.IsSuccess);
        Assert.True(await OpensFromDisk(newPassword));
        Assert.False(await OpensFromDisk(_password));
    }

    /// <summary>
    /// A falha de disco de verdade, com o client de verdade: uma pasta no lugar do temporário faz o `FileStream` recusar como recusaria um disco
    /// cheio ou sem acesso (e não depende do sistema operacional, ao contrário de segurar o arquivo aberto).
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro temporário que não dá para criar deixa o arquivo como estava e a senha antiga abrindo")]
    public async Task ChangePassword_WhenTheTemporaryFileCannotBeCreated_ReturnsUnavailableAndKeepsTheFile()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        Directory.CreateDirectory(VaultPath(_userName) + ".tmp");

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.False(File.Exists(VaultPath(_userName) + ".bak"));
        Assert.True(await OpensFromDisk(_password));
        Assert.False(await OpensFromDisk(newPassword));

        Directory.Delete(VaultPath(_userName) + ".tmp");
        var retried = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);

        Assert.True(retried.IsSuccess);
        Assert.True(await OpensFromDisk(newPassword));
    }

    /// <summary>
    /// O que a leitura recusaria não vai para o disco: com as opções acima do teto o cabeçalho novo seria recusado, e a troca deixaria o cofre
    /// ilegível. A gravação recusa, a troca responde indisponível, e a senha antiga continua abrindo.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro parâmetros acima do teto não trocam a senha")]
    public async Task ChangePassword_WithParametersAboveTheCeiling_FailsAndKeepsTheOldPassword()
    {
        //Arrange
        var newPassword = NewPassword();
        await CreateVault(_userName, _password);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var service = CreateService(options: new VaultOptions { DataDirectory = _directory, MemoryKiB = 8192, Iterations = 9, Parallelism = 1 });
        await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.True(await OpensFromDisk(_password));
        Assert.False(await OpensFromDisk(newPassword));
    }

    /// <summary>
    /// Um defeito (exceção) no meio da troca, depois da conferência e antes da gravação, não deixa meia troca: o cofre aberto e o arquivo seguem
    /// com a senha antiga, e o serviço não fica travado para a operação seguinte.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Exceção na derivação da senha nova sobe, mantém a senha antiga e não trava o serviço")]
    public async Task ChangePassword_WhenTheNewDerivationThrows_KeepsTheOldPasswordAndDoesNotBlock()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        _derivations.Clear();
        _deriveFailure = new InvalidOperationException("defeito na derivação");
        _deriveFailureAfter = 1;

        //Act
        var exception = await Record.ExceptionAsync(() => service.ChangePasswordAsync(_password, newPassword, CancellationToken.None));
        _deriveFailure = null;
        var next = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        //Assert
        Assert.IsType<InvalidOperationException>(exception);
        Assert.NotNull(next.Value);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.True(await OpensFromDisk(_password));
        Assert.False(await OpensFromDisk(newPassword));
    }

    /// <summary>
    /// RN-COFRE-005 e 013: a gravação é a de sempre (temporário, `File.Replace`, `.bak`) e depois uma SEGUNDA do mesmo arquivo. A segunda faz o `File.Replace`
    /// deixar o `.bak` byte a byte igual ao principal novo: sem ela o `.bak` seria o principal de antes, com a chave e o embrulho ANTIGOS. Nenhum
    /// temporário sobra, e a senha antiga não abre o `.bak`.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK duas gravações: o .bak fica igual ao principal novo, e a senha antiga não o abre")]
    public async Task ChangePassword_WritesTheFileTwice_TheBakIsTheNewMain()
    {
        //Arrange
        var newPassword = NewPassword();
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var mainBefore = File.ReadAllBytes(VaultPath(_userName));
        var writesBefore = client.Writes;

        //Act
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);

        //Assert
        var backup = ReadStoredBackup();
        Assert.Equal(2, client.Writes - writesBefore);
        Assert.NotEqual(mainBefore, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Equal(File.ReadAllBytes(VaultPath(_userName)), File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.Equal([$"{_userName}.vault.json", $"{_userName}.vault.json.bak"], new DirectoryInfo(Path.GetDirectoryName(VaultPath(_userName))!).GetFiles().Select(file => file.Name).Order().ToArray());
        Assert.ThrowsAny<CryptographicException>(() => UnwrapKey(backup, _password));
        Assert.NotEmpty(UnwrapKey(backup, newPassword));
    }

    /// <summary>
    /// RN-COFRE-005 e 013: o app lê o `.bak` quando o principal não existe, e então o promove. Sem a segunda gravação o `.bak` da troca era o principal de
    /// antes, e nessa situação a senha ANTIGA voltava a abrir o cofre e a NOVA deixava de abrir. Com ela, é só a senha nova que abre.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK sem o principal, o .bak da troca abre só com a senha nova")]
    public async Task ChangePassword_WithoutTheMainFile_TheBakOpensOnlyWithTheNewPassword()
    {
        //Arrange
        var newPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        service.Lock();
        File.Delete(VaultPath(_userName));

        //Act
        var withTheOld = await OpensFromDisk(_password);
        var withTheNew = await OpensFromDisk(newPassword);

        //Assert
        Assert.False(withTheOld);
        Assert.True(withTheNew);
    }

    /// <summary>
    /// RN-COFRE-013: uma falha SÓ na segunda gravação mantém a troca: o disco já tem o principal novo, e a memória também, então a resposta é sucesso
    /// (204 na API). O que fica é a janela de antes: o `.bak` ainda é o principal de antes, com o embrulho antigo, até a próxima entrada (que o refaz) ou a
    /// próxima gravação comum. Vai um aviso ao log, o único registro do serviço, e nada mais (sem senha, sem nome de usuário, sem exceção). O `.bak` é lido
    /// ANTES de qualquer entrada, porque a entrada o cura.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK falha só na segunda gravação mantém a troca e vai ao log como aviso, sem segredo")]
    public async Task ChangePassword_WhenOnlyTheSecondWriteFails_KeepsTheChangeAndLogsAWarning()
    {
        //Arrange
        var sink = new CollectingSink();
        var current = $"ATUAL-{Guid.NewGuid():N}";
        var changed = $"NOVA-{Guid.NewGuid():N}";
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client, logger: new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());
        await service.CreateAsync(_userName, current, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var mainBefore = File.ReadAllBytes(VaultPath(_userName));
        var before = service.Read().Value;
        client.FailWritesFrom = client.Writes + 2;
        var writesBefore = client.Writes;

        //Act
        var result = await service.ChangePasswordAsync(current, changed, CancellationToken.None);
        var memoryWithTheOld = await service.ReadIfPasswordMatchesAsync(current, CancellationToken.None);
        var memoryWithTheNew = await service.ReadIfPasswordMatchesAsync(changed, CancellationToken.None);
        var backupAfterTheChange = File.ReadAllBytes(VaultPath(_userName) + ".bak");

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(2, client.Writes - writesBefore);
        Assert.True(service.IsUnlocked);
        Assert.Null(memoryWithTheOld.Value);
        Assert.True((memoryWithTheNew.Value! with { Journal = null }).JsonEquals(before with { Journal = null }));
        Assert.Equal(mainBefore, backupAfterTheChange);

        var warning = Assert.Single(sink.Events);
        var text = warning.RenderMessage() + " " + string.Join(' ', warning.Properties.Values.Select(value => value.ToString()));
        Assert.Equal(LogEventLevel.Warning, warning.Level);
        Assert.Null(warning.Exception);
        Assert.Contains("cópia de segurança", text);
        AssertWarningStatesOnlyWhatIsKnown(warning);
        Assert.DoesNotContain(current, text);
        Assert.DoesNotContain(changed, text);
        Assert.DoesNotContain(_userName, text);

        // A gravação comum seguinte (que o disco volta a aceitar) usa a chave nova e já deixa o .bak com o embrulho novo.
        client.FailWritesFrom = int.MaxValue;
        var saved = await service.SaveAsync(document => document with { Folders = [.. document.Folders, VaultFakers.CreateFolder()] }, CancellationToken.None);

        Assert.True(saved.IsSuccess);
        Assert.ThrowsAny<CryptographicException>(() => UnwrapKey(ReadStoredBackup(), current));
        Assert.NotEmpty(UnwrapKey(ReadStoredBackup(), changed));
        Assert.True(await OpensFromDisk(changed));
        Assert.False(await OpensFromDisk(current));
    }

    /// <summary>
    /// A gravação comum que vem depois da troca sela o conteúdo com a chave NOVA e o cabeçalho NOVO (o `open.Key` e o `open.File` que a troca deixou): se
    /// ela usasse a chave antiga, o arquivo teria o embrulho da chave nova e o conteúdo cifrado com a antiga, e se usasse o cabeçalho antigo, o conteúdo
    /// teria o dado autenticado antigo; nos dois casos nenhuma senha abriria o arquivo.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK uma gravação comum depois da troca sela com a chave e o cabeçalho novos")]
    public async Task ChangePassword_ThenSave_SealsWithTheNewHeader()
    {
        //Arrange
        var newPassword = NewPassword();
        var folder = VaultFakers.CreateFolder();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);

        //Act
        var saved = await service.SaveAsync(document => document with { Folders = [folder] }, CancellationToken.None);
        service.Lock();
        var unlocked = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        Assert.True(saved.IsSuccess);
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(folder.ID, Assert.Single(service.Read().Value.Folders).ID);
        Assert.False(await OpensFromDisk(_password));
    }

    /// <summary>
    /// Nenhum caminho guarda a chave antiga através do semáforo: uma gravação que entra na fila ENQUANTO a troca grava (a troca está dentro do `Write` do
    /// client, segurada pelo teste) lê o `_open` só depois de tomar o semáforo, e sela com a chave NOVA e o cabeçalho novo. Chamar o `SaveAsync` na própria
    /// thread do teste, sem `Task.Run`, garante que ele já está na fila quando a gravação da troca é solta: o `SemaphoreSlim` registra quem espera antes de
    /// devolver a tarefa, então o teste não depende de tempo. Se a gravação usasse a chave antiga, o arquivo teria o `wrappedKey` novo e o conteúdo
    /// cifrado com a chave antiga, e nenhuma senha o abriria.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK uma gravação que entra na fila durante a troca sela com a chave e o cabeçalho novos")]
    public async Task ChangePassword_ASaveQueuedWhileTheChangeWrites_SealsWithTheNewKey()
    {
        //Arrange
        var newPassword = NewPassword();
        var folder = VaultFakers.CreateFolder();
        var writing = new ManualResetEventSlim();
        var release = new ManualResetEventSlim();
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        var writesBefore = client.Writes;
        client.OnWrite = number =>
        {
            if (number != writesBefore + 1)
                return;

            writing.Set();
            Assert.True(release.Wait(TimeSpan.FromSeconds(10)));
        };

        //Act
        var change = Task.Run(() => service.ChangePasswordAsync(_password, newPassword, CancellationToken.None));
        Assert.True(writing.Wait(TimeSpan.FromSeconds(10)));
        var queued = service.SaveAsync(document => document with { Folders = [folder] }, CancellationToken.None);
        var queuedWasWaiting = !queued.IsCompleted;
        release.Set();
        var results = await Task.WhenAll(change, queued);
        service.Lock();
        var unlocked = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        Assert.True(queuedWasWaiting);
        Assert.All(results, result => Assert.True(result.IsSuccess));
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(folder.ID, Assert.Single(service.Read().Value.Folders).ID);
        Assert.False(await OpensFromDisk(_password));
    }

    /// <summary>A troca re-sela o documento MAIS RECENTE: o que uma gravação anterior acrescentou está no arquivo novo.</summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK a troca depois de uma gravação leva o conteúdo gravado")]
    public async Task ChangePassword_AfterASave_CarriesTheSavedContent()
    {
        //Arrange
        var newPassword = NewPassword();
        var connection = VaultFakers.CreateConnection(password: "senha-do-banco-" + Guid.NewGuid().ToString("N"));
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Connections = [connection] }, CancellationToken.None);

        //Act
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        service.Lock();
        await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        Assert.True(service.Read().Value.Connections.Single().JsonEquals(connection));
    }

    /// <summary>
    /// Uma troca ao mesmo tempo de cinquenta gravações comuns: o semáforo serializa as duas coisas, nenhuma perde a outra, e o arquivo final abre
    /// com a senha nova e tem as cinquenta pastas (nunca o embrulho de uma com o conteúdo antigo da outra).
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK uma troca no meio de cinquenta gravações simultâneas não perde nenhuma e o arquivo abre com a senha nova")]
    public async Task ChangePassword_AmidstFiftyParallelSaves_LosesNothing()
    {
        //Arrange
        var newPassword = NewPassword();
        var folders = Enumerable.Range(0, 50).Select(_ => VaultFakers.CreateFolder()).ToArray();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var firstHalf = folders.Take(25).Select(folder => Task.Run(() => service.SaveAsync(document => document with { Folders = [.. document.Folders, folder] }, CancellationToken.None))).ToArray();
        var change = Task.Run(() => service.ChangePasswordAsync(_password, newPassword, CancellationToken.None));
        var secondHalf = folders.Skip(25).Select(folder => Task.Run(() => service.SaveAsync(document => document with { Folders = [.. document.Folders, folder] }, CancellationToken.None))).ToArray();
        var results = await Task.WhenAll([.. firstHalf, change, .. secondHalf]);
        service.Lock();
        var unlocked = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        Assert.All(results, result => Assert.True(result.IsSuccess));
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(folders.Select(folder => folder.ID).Order(), service.Read().Value.Folders.Select(folder => folder.ID).Order());
        Assert.False(await OpensFromDisk(_password));
    }

    /// <summary>
    /// Duas trocas ao mesmo tempo, as duas com a mesma senha atual: uma passa e a outra encontra a senha atual já trocada. O arquivo fica com o
    /// embrulho de UMA delas, inteiro: abre com a senha de quem venceu e com nenhuma outra.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK duas trocas simultâneas: uma vence, a outra responde senha atual errada, e o arquivo é inteiro da vencedora")]
    public async Task ChangePassword_TwoInParallel_OneWinsAndTheFileIsWhole()
    {
        //Arrange
        var firstPassword = NewPassword();
        var secondPassword = NewPassword();
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var before = service.Read().Value;

        //Act
        var results = await Task.WhenAll(Task.Run(() => service.ChangePasswordAsync(_password, firstPassword, CancellationToken.None)), Task.Run(() => service.ChangePasswordAsync(_password, secondPassword, CancellationToken.None)));

        //Assert
        var winnerIsTheFirst = results[0].IsSuccess;
        var (winner, loser) = winnerIsTheFirst ? (firstPassword, secondPassword) : (secondPassword, firstPassword);
        Assert.Equal(1, results.Count(result => result.IsSuccess));
        Assert.Equal(EVaultError.CurrentPasswordInvalid, results[winnerIsTheFirst ? 1 : 0].Error);
        Assert.True(service.IsUnlocked);
        Assert.True((service.Read().Value with { Journal = null }).JsonEquals(before with { Journal = null }));
        Assert.True(await OpensFromDisk(winner));
        Assert.False(await OpensFromDisk(loser));
        Assert.False(await OpensFromDisk(_password));
    }

    /// <summary>A troca é do usuário do cofre aberto: o arquivo de outro usuário não é tocado, e a senha dele continua a mesma.</summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK só o arquivo do usuário do cofre aberto muda")]
    public async Task ChangePassword_TouchesOnlyTheOpenUsersFile()
    {
        //Arrange
        var otherUserName = new Faker().Random.String2(length: 12, chars: Letters);
        var otherPassword = NewPassword();
        await CreateVault(otherUserName, otherPassword);
        var otherBytes = File.ReadAllBytes(VaultPath(otherUserName));
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        var result = await service.ChangePasswordAsync(_password, NewPassword(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(otherBytes, File.ReadAllBytes(VaultPath(otherUserName)));
        Assert.False(File.Exists(VaultPath(otherUserName) + ".bak"));
        Assert.True(await OpensFromDisk(otherPassword, otherUserName));
    }

    /// <summary>
    /// Zeramento como o resto do cofre: as duas chaves derivadas (a da conferência e a da senha nova), a cópia da chave do cofre que a conferência abre e,
    /// depois de o `_open` trocar, a chave do cofre ANTIGA são zeradas. A chave nova, essa, fica viva no serviço: a gravação comum que vem depois a usa.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK as chaves derivadas, a cópia da conferência e a chave antiga do cofre são zeradas")]
    public async Task ChangePassword_ZeroesTheDerivedKeysTheVerificationCopyAndTheOldVaultKey()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        _derivedKeys.Clear();

        //Act
        await service.ChangePasswordAsync(_password, NewPassword(), CancellationToken.None);

        //Assert
        Assert.Equal(2, _derivedKeys.Count);
        Assert.All(_derivedKeys, key => Assert.All(key, value => Assert.Equal(0, value)));
        // Opened: [0] a chave do cofre (a que estava viva) e [1] o conteúdo da entrada; [2] a cópia que a conferência da troca abriu.
        Assert.Equal(3, client.Opened.Count);
        Assert.All(client.Opened[2], value => Assert.Equal(0, value));
        Assert.All(client.Opened[0], value => Assert.Equal(0, value));
    }

    /// <summary>
    /// RN-LOG-001: o serviço e o client não registram a senha atual, a nova nem a errada, em nenhum dos caminhos (certo, errado, falha de disco),
    /// e nenhum registro leva a exceção (a mensagem de uma `IOException` traz o caminho do arquivo, que tem o nome do usuário). O teste confere antes
    /// que o log está ligado: os caminhos que falham registram, e procurar uma marca num log mudo não provaria nada.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK nada das senhas vai ao log, e nenhum registro leva exceção")]
    public async Task ChangePassword_DoesNotLogThePasswords()
    {
        //Arrange
        var sink = new CollectingSink();
        var current = $"ATUAL-{Guid.NewGuid():N}";
        var changed = $"NOVA-{Guid.NewGuid():N}";
        var wrong = $"ERRADA-{Guid.NewGuid():N}";
        var logger = new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger();
        var service = CreateService(new VaultFileClient(Options.Create(VaultFakers.CreateOptions(_directory)), logger), logger: logger);
        await service.CreateAsync(_userName, current, CancellationToken.None);
        Directory.CreateDirectory(VaultPath(_userName) + ".tmp");

        //Act
        await service.ChangePasswordAsync(wrong, changed, CancellationToken.None);
        await service.ChangePasswordAsync(current, changed, CancellationToken.None);
        await service.ChangePasswordAsync(current, current, CancellationToken.None);
        Directory.Delete(VaultPath(_userName) + ".tmp");
        var succeeded = await service.ChangePasswordAsync(current, changed, CancellationToken.None);

        //Assert
        Assert.True(succeeded.IsSuccess);
        Assert.Contains(sink.Events, logEvent => logEvent.Level == LogEventLevel.Warning);
        Assert.Contains(sink.Events, logEvent => logEvent.Level == LogEventLevel.Error);
        Assert.All(sink.Events, logEvent => Assert.Null(logEvent.Exception));

        var text = string.Join('\n', sink.Events.Select(logEvent => logEvent.RenderMessage() + " " + string.Join(' ', logEvent.Properties.Values.Select(value => value.ToString()))));
        Assert.DoesNotContain(current, text);
        Assert.DoesNotContain(changed, text);
        Assert.DoesNotContain(wrong, text);
        Assert.DoesNotContain(_userName, text);
    }

    /// <summary>
    /// Zeramento da chave NOVA (a regra do projeto de zerar o que é segredo): a chave que a troca gerou e que não chegou a valer, porque a primeira gravação
    /// falhou, é zerada, e o buffer é o que o serviço gerou (a costura `newKey`). A chave antiga, que segue valendo, fica inteira. Sem este teste a linha que
    /// zera a chave nova na falha podia sair sem que nada acusasse.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK a primeira gravação falhando zera a chave nova que a troca gerou, e a antiga segue inteira")]
    public async Task ChangePassword_WhenTheFirstWriteFails_ZeroesTheNewKeyAndKeepsTheOldOne()
    {
        //Arrange
        await CreateVault(_userName, _password);
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.UnlockAsync(_userName, _password, CancellationToken.None);
        _generatedKeys.Clear();
        client.FailWrites = true;

        //Act
        var result = await service.ChangePasswordAsync(_password, NewPassword(), CancellationToken.None);

        //Assert
        var generated = Assert.Single(_generatedKeys);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.Equal(32, generated.Length);
        Assert.All(generated, value => Assert.Equal(0, value));
        Assert.Contains(client.Opened[0], value => value != 0);
    }

    /// <summary>
    /// Com a troca que valeu, a chave nova é a viva: inteira enquanto o cofre está aberto (a gravação comum a usa) e zerada quando ele fecha (RN-COFRE-008), e a
    /// antiga, a da criação, já está zerada.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK depois da troca a chave nova fica inteira enquanto o cofre está aberto, a antiga é zerada, e sair zera a nova")]
    public async Task ChangePassword_TheNewKeyStaysAliveUntilTheVaultCloses()
    {
        //Arrange
        var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        //Act
        await service.ChangePasswordAsync(_password, NewPassword(), CancellationToken.None);
        var (oldKey, newKey) = (_generatedKeys[0], _generatedKeys[1]);
        var newKeyWhileOpen = newKey.ToArray();
        var oldKeyAfterTheChange = oldKey.ToArray();
        service.Lock();

        //Assert
        Assert.Equal(2, _generatedKeys.Count);
        Assert.All(oldKeyAfterTheChange, value => Assert.Equal(0, value));
        Assert.Equal(32, newKeyWhileOpen.Length);
        Assert.Contains(newKeyWhileOpen, value => value != 0);
        Assert.All(newKey, value => Assert.Equal(0, value));
    }

    /// <summary>
    /// A queda ENTRE as duas trocas de nome do `File.Replace` da PRIMEIRA gravação (o erro 1177 do Windows, ou a energia): o principal já foi renomeado para o `.bak` e o
    /// substituto ainda não tomou o lugar. O estado que fica no disco é só o `.bak`, que é o principal de antes, e a troca responde indisponível: a memória fica com a senha
    /// antiga, e a entrada seguinte promove o `.bak` (RN-COFRE-005) e abre com a mesma senha antiga, com o mesmo conteúdo. Disco e memória coerentes. O client de verdade
    /// completaria a troca na nova tentativa (ver `VaultFileClientRetryTests`); aqui é o estado a que se chega quando nem ela resolve.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "Erro a primeira gravação parada entre as duas trocas de nome deixa disco e memória com a senha antiga")]
    public async Task ChangePassword_WhenTheFirstWriteStopsBetweenTheRenames_DiskAndMemoryKeepTheOldPassword()
    {
        //Arrange
        var newPassword = NewPassword();
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var document = service.Read().Value;
        var mainBefore = File.ReadAllBytes(VaultPath(_userName));
        var stopping = client.Writes + 1;
        client.FailWritesFrom = stopping;
        client.OnWrite = number =>
        {
            if (number == stopping)
                File.Move(VaultPath(_userName), VaultPath(_userName) + ".bak", overwrite: true);
        };

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var memoryWithTheOld = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);
        var memoryWithTheNew = await service.ReadIfPasswordMatchesAsync(newPassword, CancellationToken.None);

        //Assert
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.False(File.Exists(VaultPath(_userName)));
        Assert.Equal(mainBefore, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.Same(document, memoryWithTheOld.Value);
        Assert.Null(memoryWithTheNew.Value);
        Assert.False(await OpensFromDisk(newPassword));

        using var reopened = CreateService();
        Assert.True((await reopened.UnlockAsync(_userName, _password, CancellationToken.None)).IsSuccess);
        Assert.True((reopened.Read().Value with { Journal = null }).JsonEquals(document with { Journal = null }));
        Assert.True(File.Exists(VaultPath(_userName)));
    }

    /// <summary>
    /// A queda entre as duas trocas de nome da SEGUNDA gravação: o principal (já com a senha nova, pela primeira gravação) foi renomeado para o `.bak`, e o substituto não
    /// tomou o lugar. O disco fica só com o `.bak`, que é o principal NOVO, e a memória também tem a senha nova: a entrada seguinte promove o `.bak` e abre com a senha nova
    /// e o mesmo conteúdo. A troca vale (sucesso, com o aviso), e a senha antiga não abre nada.
    /// </summary>
    [Trait("VaultService", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK a segunda gravação parada entre as duas trocas de nome mantém a troca: disco e memória com a senha nova")]
    public async Task ChangePassword_WhenTheSecondWriteStopsBetweenTheRenames_DiskAndMemoryHaveTheNewPassword()
    {
        //Arrange
        var newPassword = NewPassword();
        var sink = new CollectingSink();
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client, logger: new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        var document = service.Read().Value;
        var stopping = client.Writes + 2;
        client.FailWritesFrom = stopping;
        client.OnWrite = number =>
        {
            if (number == stopping)
                File.Move(VaultPath(_userName), VaultPath(_userName) + ".bak", overwrite: true);
        };

        //Act
        var result = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        var memoryWithTheOld = await service.ReadIfPasswordMatchesAsync(_password, CancellationToken.None);
        var memoryWithTheNew = await service.ReadIfPasswordMatchesAsync(newPassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.False(File.Exists(VaultPath(_userName)));
        Assert.Null(memoryWithTheOld.Value);
        Assert.True((memoryWithTheNew.Value! with { Journal = null }).JsonEquals(document with { Journal = null }));
        Assert.Single(sink.Events, logEvent => logEvent.Level == LogEventLevel.Warning);
        Assert.False(await OpensFromDisk(_password));

        using var reopened = CreateService();
        Assert.True((await reopened.UnlockAsync(_userName, newPassword, CancellationToken.None)).IsSuccess);
        Assert.True((reopened.Read().Value with { Journal = null }).JsonEquals(document with { Journal = null }));
        Assert.True(File.Exists(VaultPath(_userName)));
    }

    /// <summary>
    /// O aviso da segunda gravação diz o que se sabe: a cópia de segurança PODE não estar atualizada, e será refeita na próxima entrada. Não afirma que o `.bak` ficou com o
    /// embrulho antigo (a falha pode ter sido entre as duas trocas de nome, com o `.bak` já novo e o principal ausente), e o nome do erro sai sem aspas no formato do arquivo
    /// de log (`{Message:lj}`, o que o Serilog escreve por padrão).
    /// </summary>
    private static void AssertWarningStatesOnlyWhatIsKnown(LogEvent warning)
    {
        using var writer = new StringWriter();
        new MessageTemplateTextFormatter("{Message:lj}").Format(warning, writer);
        var inTheLogFile = writer.ToString();

        Assert.Contains("pode não estar atualizada", inTheLogFile);
        Assert.Contains("próxima entrada", inTheLogFile);
        Assert.Contains("Unavailable", inTheLogFile);
        Assert.DoesNotContain("embrulho antigo", inTheLogFile);
        Assert.DoesNotContain("\"", inTheLogFile);
    }

    private sealed class CollectingSink : ILogEventSink
    {
        public List<LogEvent> Events { get; } = [];

        public void Emit(LogEvent logEvent)
            => Events.Add(logEvent);
    }
}
