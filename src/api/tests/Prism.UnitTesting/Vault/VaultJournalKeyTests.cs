using Bogus;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using Serilog.Core;
using System.Security.Cryptography;
using System.Text.Json;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// RN-DIARIO-002 e RN-DIARIO-004: chave de 256 bits do diário dentro do documento do cofre, criada uma única vez quando o cofre é criado ou
/// aberto sem ela, e trocada junto da senha do usuário com callbacks de preparação (`beforeSave`) e reversão (`onSaveFailed`).
/// </summary>
public sealed class VaultJournalKeyTests : IDisposable
{
    private const string Letters = "abcdefghijklmnopqrstuvwxyz";

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-journal-test-").FullName;
    private readonly string _userName = new Faker().Random.String2(length: 12, chars: Letters);
    private readonly string _password = new Faker().Internet.Password(length: 16);

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    [Trait("VaultService", "JournalKey")]
    [Fact(DisplayName = "JSON de cofre antigo sem o campo journal desserializa com Journal nulo e ToString não vaza a chave")]
    public void OldFormatVault_DeserializesWithNullJournal()
    {
        const string legacyJson = """{"UserName":"ana.silva","Folders":[],"Connections":[],"Scripts":[],"Workspace":{"OpenTabs":[],"ActiveTabId":null},"ScriptFolders":[]}""";

        var document = JsonSerializer.Deserialize<VaultDocument>(legacyJson);

        Assert.NotNull(document);
        Assert.Null(document.Journal);

        var key = RandomNumberGenerator.GetBytes(VaultCrypto.KeySize);
        var record = new VaultJournalRecord(key, DateTimeOffset.UtcNow);
        var printed = record.ToString();

        Assert.Equal(nameof(VaultJournalRecord), printed);
        Assert.DoesNotContain(Convert.ToBase64String(key), printed, StringComparison.Ordinal);
        Assert.DoesNotContain(Convert.ToHexString(key), printed, StringComparison.OrdinalIgnoreCase);
    }

    [Trait("VaultService", "JournalKey")]
    [Fact(DisplayName = "Abrir cofre sem Journal cria chave de 32 bytes uma única vez e dispara Unlocked fora do semáforo")]
    public async Task Unlock_VaultWithoutJournal_CreatesKeyOnce()
    {
        WriteVaultWithoutJournal(_userName, _password);

        using var service = CreateService();
        var unlockedReadSucceeded = false;
        var unlockedCount = 0;
        service.Unlocked += () =>
        {
            unlockedCount++;
            unlockedReadSucceeded = service.Read().IsSuccess;
        };

        var firstUnlock = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        Assert.True(firstUnlock.IsSuccess);
        Assert.Equal(1, unlockedCount);
        Assert.True(unlockedReadSucceeded);
        var firstDoc = service.Read().Value;
        Assert.NotNull(firstDoc.Journal);
        Assert.Equal(VaultCrypto.KeySize, firstDoc.Journal.Key.Length);
        Assert.NotEqual(default, firstDoc.Journal.CreatedAt);

        var firstKey = firstDoc.Journal.Key.ToArray();
        var firstCreatedAt = firstDoc.Journal.CreatedAt;

        service.Lock();

        var secondUnlock = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        Assert.True(secondUnlock.IsSuccess);
        Assert.Equal(2, unlockedCount);
        var secondDoc = service.Read().Value;
        Assert.NotNull(secondDoc.Journal);
        Assert.Equal(firstKey, secondDoc.Journal.Key);
        Assert.Equal(firstCreatedAt, secondDoc.Journal.CreatedAt);
    }

    [Trait("VaultService", "JournalKey")]
    [Fact(DisplayName = "ChangePassword gira a chave do diário, zera a antiga e chama beforeSave com a chave nova antes de gravar")]
    public async Task ChangePassword_RotatesJournalKey_AndCallsBeforeSaveWithNewKey()
    {
        using var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        var oldKeyBuffer = service.Read().Value.Journal!.Key;
        var oldKeySnapshot = oldKeyBuffer.ToArray();
        var newPassword = _password + "-nova";
        byte[]? callbackKey = null;

        var changed = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None, beforeSave: (candidateKey, _) => { callbackKey = candidateKey.ToArray(); return Task.FromResult(true); });

        Assert.True(changed.IsSuccess);
        Assert.NotNull(callbackKey);
        Assert.Equal(VaultCrypto.KeySize, callbackKey.Length);
        Assert.NotEqual(oldKeySnapshot, callbackKey);

        var currentJournal = service.Read().Value.Journal;
        Assert.NotNull(currentJournal);
        Assert.Equal(callbackKey, currentJournal.Key);
        Assert.All(oldKeyBuffer, b => Assert.Equal(0, b));

        service.Lock();
        var reopened = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);
        Assert.True(reopened.IsSuccess);
        Assert.Equal(callbackKey, service.Read().Value.Journal!.Key);
    }

    [Trait("VaultService", "JournalKey")]
    [Fact(DisplayName = "ChangePassword quando beforeSave devolve false falha com Unavailable, não grava e mantém a chave antiga")]
    public async Task ChangePassword_WhenBeforeSaveFails_KeepsOldKeyAndFails()
    {
        using var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        var oldKeyBuffer = service.Read().Value.Journal!.Key;
        var oldKeySnapshot = oldKeyBuffer.ToArray();
        var path = Path.Combine(_directory, "vaults", $"{_userName}.vault.json");
        var bytesOnDiskBefore = await File.ReadAllBytesAsync(path);
        byte[]? candidateBufferRef = null;
        var onSaveFailedCalled = false;

        var changed = await service.ChangePasswordAsync(_password, _password + "-nova", CancellationToken.None, beforeSave: (candidateKey, _) => { candidateBufferRef = candidateKey; return Task.FromResult(false); }, onSaveFailed: _ => { onSaveFailedCalled = true; return Task.CompletedTask; });

        Assert.True(changed.IsFailure);
        Assert.Equal(EVaultError.Unavailable, changed.Error);
        Assert.False(onSaveFailedCalled);
        Assert.NotNull(candidateBufferRef);
        Assert.All(candidateBufferRef, b => Assert.Equal(0, b));
        Assert.Equal(oldKeySnapshot, service.Read().Value.Journal!.Key);
        Assert.Equal(bytesOnDiskBefore, await File.ReadAllBytesAsync(path));
    }

    [Trait("VaultService", "JournalKey")]
    [Fact(DisplayName = "ChangePassword quando a gravação do cofre falha chama onSaveFailed e mantém a chave antiga")]
    public async Task ChangePassword_WhenSaveFails_CallsOnSaveFailed()
    {
        using var service = CreateService();
        await service.CreateAsync(_userName, _password, CancellationToken.None);

        var oldKeyBuffer = service.Read().Value.Journal!.Key;
        var oldKeySnapshot = oldKeyBuffer.ToArray();
        var path = Path.Combine(_directory, "vaults", $"{_userName}.vault.json");
        byte[]? candidateBufferRef = null;
        var onSaveFailedCount = 0;

        // Bloqueia o caminho do arquivo temporário criando uma pasta com o nome de `.tmp` para forçar a falha do `client.Write`.
        Directory.CreateDirectory(path + ".tmp");

        try
        {
            var changed = await service.ChangePasswordAsync(_password, _password + "-nova", CancellationToken.None, beforeSave: (candidateKey, _) => { candidateBufferRef = candidateKey; return Task.FromResult(true); }, onSaveFailed: _ => { onSaveFailedCount++; return Task.CompletedTask; });

            Assert.True(changed.IsFailure);
            Assert.Equal(EVaultError.Unavailable, changed.Error);
            Assert.Equal(1, onSaveFailedCount);
            Assert.NotNull(candidateBufferRef);
            Assert.All(candidateBufferRef, b => Assert.Equal(0, b));
            Assert.Equal(oldKeySnapshot, service.Read().Value.Journal!.Key);
        }
        finally
        {
            Directory.Delete(path + ".tmp", recursive: true);
        }
    }

    private VaultFileClient CreateClient()
        => new(Options.Create(VaultFakers.CreateOptions(_directory)), Logger.None);

    private VaultService CreateService()
        => new(CreateClient(), Options.Create(VaultFakers.CreateOptions(_directory)), VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);

    private void WriteVaultWithoutJournal(string userName, string password)
    {
        var options = VaultFakers.CreateOptions(_directory);
        var kdf = new VaultKdf(VaultCrypto.Algorithm, options.MemoryKiB, options.Iterations, options.Parallelism, RandomNumberGenerator.GetBytes(VaultCrypto.SaltSize));
        var derivedKey = VaultCrypto.DeriveKey(password, kdf);
        var vaultKey = VaultCrypto.NewKey();
        var aad = VaultCrypto.AssociatedData(VaultCrypto.Version, kdf);
        var wrappedKey = VaultCrypto.Seal(derivedKey, vaultKey, aad);
        var document = new VaultDocument(userName, [], [], [], VaultWorkspaceRecord.Empty, []);
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(document);
        var payload = VaultCrypto.Seal(vaultKey, plaintext, aad);
        var file = new VaultFile(VaultCrypto.Version, kdf, wrappedKey, payload);
        CreateClient().Write(userName, file);
    }
}
