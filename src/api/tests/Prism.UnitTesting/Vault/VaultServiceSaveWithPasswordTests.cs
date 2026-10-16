using CSharpFunctionalExtensions;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// RN-PROT-003: a gravação que pode pedir a senha do usuário (`SaveWithPasswordAsync`), a de marcar ou desmarcar o somente leitura. A alteração,
/// a pergunta se ela pede a senha, a conferência e a gravação são uma operação só do cofre; a conferência é a da revelação e da troca de senha,
/// com a mesma contagem de erros seguidos. É a mesma classe do `VaultServiceTests`, em outro arquivo, para dividir os auxiliares.
/// </summary>
public sealed partial class VaultServiceTests
{
    private static readonly VaultFolderRecord ReadOnlyFolder = VaultFakers.CreateFolder(name: "Fábrica") with { ReadOnly = true };

    /// <summary>A alteração de teste: acrescenta a pasta somente leitura (ou outra), e a pergunta da senha é a que o teste der.</summary>
    private static Func<VaultDocument, VaultDocument> AddFolder(VaultFolderRecord folder)
        => document => document with { Folders = [.. document.Folders, folder] };

    private async Task<VaultService> CreateOpenService(RecordingClient? client = null)
    {
        var service = CreateService(client);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        _derivations.Clear();

        return service;
    }

    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "OK a mudança que não pede a senha grava sem conferir nada, também com a senha errada")]
    public async Task SaveWithPassword_NotNeeded_WritesWithoutChecking()
    {
        //Arrange
        var service = await CreateOpenService();

        //Act
        var result = await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => false, _password + "x", CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(EPasswordCheck.NotNeeded, result.Value);
        Assert.Equal([ReadOnlyFolder], service.Read().Value.Folders);
        Assert.Empty(_derivations);
    }

    /// <summary>A pergunta recebe o documento de antes e o de depois da alteração, do mesmo cofre aberto.</summary>
    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "OK a pergunta da senha recebe o documento de antes e o de depois")]
    public async Task SaveWithPassword_AsksWithTheDocumentBeforeAndAfter()
    {
        //Arrange
        var service = await CreateOpenService();
        var current = service.Read().Value;
        (VaultDocument Before, VaultDocument After)? asked = null;

        //Act
        await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (before, after) =>
        {
            asked = (before, after);

            return false;
        }, null, CancellationToken.None);

        //Assert
        Assert.NotNull(asked);
        Assert.Same(current, asked.Value.Before);
        Assert.Same(service.Read().Value, asked.Value.After);
    }

    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "OK a senha certa, quando pedida, grava")]
    public async Task SaveWithPassword_RightPassword_Writes()
    {
        //Arrange
        var client = new RecordingClient(CreateClient());
        var service = await CreateOpenService(client);
        var writesBefore = client.Writes;

        //Act
        var result = await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(EPasswordCheck.Matched, result.Value);
        Assert.Equal([ReadOnlyFolder], service.Read().Value.Folders);
        Assert.Equal(writesBefore + 1, client.Writes);
        Assert.Single(_derivations);
    }

    /// <summary>A senha que falta não é derivada nem contada, e nada é gravado.</summary>
    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Theory(DisplayName = "Erro a senha pedida que não veio não grava, não deriva e não conta erro")]
    [InlineData(null)]
    [InlineData("")]
    public async Task SaveWithPassword_MissingPassword_DoesNotWrite(string? password)
    {
        //Arrange
        var client = new RecordingClient(CreateClient());
        var service = await CreateOpenService(client);
        var writesBefore = client.Writes;

        //Act
        var results = new List<Result<EPasswordCheck, EVaultError>>();
        for (var attempt = 1; attempt <= 6; attempt++)
            results.Add(await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, password, CancellationToken.None));

        //Assert
        Assert.All(results, result => Assert.Equal(EPasswordCheck.Missing, result.Value));
        Assert.Empty(service.Read().Value.Folders);
        Assert.Equal(writesBefore, client.Writes);
        Assert.Empty(_derivations);
        Assert.True(service.IsUnlocked);
    }

    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "Erro a senha errada não grava e conta o erro")]
    public async Task SaveWithPassword_WrongPassword_DoesNotWrite()
    {
        //Arrange
        var client = new RecordingClient(CreateClient());
        var service = await CreateOpenService(client);
        var writesBefore = client.Writes;

        //Act
        var result = await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, _password + "x", CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(EPasswordCheck.Wrong, result.Value);
        Assert.Empty(service.Read().Value.Folders);
        Assert.Equal(writesBefore, client.Writes);
        Assert.Single(_derivations);
        Assert.True(service.IsUnlocked);
    }

    /// <summary>RN-CONN-003: o quinto erro seguido fecha o cofre, e a contagem é a da revelação da senha: os erros das duas somam.</summary>
    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "Erro o quinto erro seguido, somando os da revelação da senha, fecha o cofre")]
    public async Task SaveWithPassword_FifthWrongInARow_CountingTheReveal_Locks()
    {
        //Arrange
        var service = await CreateOpenService();
        var lockedEvents = 0;
        service.Locked += () => lockedEvents++;

        //Act
        var reveals = new List<Result<VaultDocument?, EVaultError>>();
        for (var attempt = 1; attempt <= 2; attempt++)
            reveals.Add(await service.ReadIfPasswordMatchesAsync(_password + "x", CancellationToken.None));

        var saves = new List<Result<EPasswordCheck, EVaultError>>();
        for (var attempt = 1; attempt <= 2; attempt++)
            saves.Add(await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, _password + "x", CancellationToken.None));

        var fifth = await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, _password + "x", CancellationToken.None);

        //Assert
        Assert.All(reveals, reveal => Assert.Null(reveal.Value));
        Assert.All(saves, save => Assert.Equal(EPasswordCheck.Wrong, save.Value));
        Assert.True(fifth.IsFailure);
        Assert.Equal(EVaultError.Locked, fifth.Error);
        Assert.False(service.IsUnlocked);
        Assert.Equal(1, lockedEvents);
    }

    /// <summary>Acertar zera a contagem, e a senha que falta não a mexe.</summary>
    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "OK acertar depois de quatro erros zera a contagem, e a senha que falta não conta")]
    public async Task SaveWithPassword_RightAfterFourWrong_ResetsTheCount()
    {
        //Arrange
        var service = await CreateOpenService();

        //Act
        for (var attempt = 1; attempt <= 4; attempt++)
            await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, _password + "x", CancellationToken.None);

        var missing = await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, null, CancellationToken.None);
        var right = await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, _password, CancellationToken.None);
        var afterReset = new List<Result<EPasswordCheck, EVaultError>>();
        for (var attempt = 1; attempt <= 4; attempt++)
            afterReset.Add(await service.SaveWithPasswordAsync(AddFolder(VaultFakers.CreateFolder()), (_, _) => true, _password + "x", CancellationToken.None));

        //Assert
        Assert.Equal(EPasswordCheck.Missing, missing.Value);
        Assert.Equal(EPasswordCheck.Matched, right.Value);
        Assert.All(afterReset, result => Assert.Equal(EPasswordCheck.Wrong, result.Value));
        Assert.True(service.IsUnlocked);
    }

    /// <summary>A alteração que recusa (devolve o mesmo documento) não pede a senha, não confere nada e não regrava o cofre.</summary>
    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "OK a alteração que devolve o mesmo documento não pergunta, não confere e não grava")]
    public async Task SaveWithPassword_SameDocument_DoesNothing()
    {
        //Arrange
        var client = new RecordingClient(CreateClient());
        var service = await CreateOpenService(client);
        var writesBefore = client.Writes;
        var asked = false;

        //Act
        var result = await service.SaveWithPasswordAsync(document => document, (_, _) => asked = true, _password + "x", CancellationToken.None);

        //Assert
        Assert.Equal(EPasswordCheck.NotNeeded, result.Value);
        Assert.False(asked);
        Assert.Equal(writesBefore, client.Writes);
        Assert.Empty(_derivations);
    }

    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task SaveWithPassword_WhenLocked_ReturnsLocked()
    {
        //Arrange
        var service = CreateService();

        //Act
        var result = await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Locked, result.Error);
        Assert.Empty(_derivations);
    }

    /// <summary>A senha conferiu e o disco falhou: o documento aberto continua o de antes (seção 7 da especificação), e a contagem foi zerada.</summary>
    [Trait("VaultService", "SaveWithPasswordAsync")]
    [Fact(DisplayName = "Erro disco falhando depois da senha certa não muda o documento aberto")]
    public async Task SaveWithPassword_WhenTheWriteFails_ReturnsUnavailable()
    {
        //Arrange
        var client = new RecordingClient(CreateClient());
        var service = await CreateOpenService(client);
        client.FailWrites = true;

        //Act
        var result = await service.SaveWithPasswordAsync(AddFolder(ReadOnlyFolder), (_, _) => true, _password, CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.Unavailable, result.Error);
        Assert.Empty(service.Read().Value.Folders);
        Assert.True(service.IsUnlocked);
    }
}
