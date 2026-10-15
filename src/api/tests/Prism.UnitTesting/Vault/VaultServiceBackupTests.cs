using Bogus;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Vault;
using Serilog;
using Serilog.Events;
using Serilog.Formatting.Display;
using System.Text.Json.Nodes;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// RN-COFRE-013: a cópia de segurança (`.bak`) e a senha. A troca grava duas vezes para o `.bak` ficar com a senha nova, e a segunda gravação pode falhar
/// (a falha só dela mantém a troca). Enquanto ela não for refeita, o `.bak` é o principal de antes, com a senha ANTIGA, e se o principal sumir o app o promove
/// (RN-COFRE-005): é a janela. A cada entrada bem-sucedida o serviço confere se o `.bak` está embrulhado pela mesma senha do principal (o sal e a chave
/// embrulhada dos dois cabeçalhos, e não o arquivo inteiro: depois de uma gravação comum o `.bak` é a versão anterior e DIFERENTE do principal, com o mesmo
/// embrulho) e, se não está, o refaz na hora com uma regravação do principal. É a mesma classe do `VaultServiceTests`, em outro arquivo.
/// </summary>
public sealed partial class VaultServiceTests
{
    /// <summary>
    /// O estado da janela: o usuário tem conteúdo gravado, a senha foi trocada e SÓ a segunda gravação falhou. O principal tem a senha nova e o `.bak`, a antiga.
    /// O serviço volta fechado (`Lock`) e com o disco funcionando, como na entrada seguinte; `Writes` do client conta o que veio depois.
    /// </summary>
    private async Task<(VaultService Service, RecordingClient Client, string NewPassword)> CreateTheWindowAsync(ILogger? logger = null)
    {
        var newPassword = NewPassword();
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client, logger: logger);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        client.FailWritesFrom = client.Writes + 2;
        var changed = await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        Assert.True(changed.IsSuccess);
        service.Lock();
        client.FailWritesFrom = int.MaxValue;

        return (service, client, newPassword);
    }

    /// <summary>A janela, ANTES da cura: com o principal perdido o `.bak` é promovido, e a senha ANTIGA abre o cofre enquanto a NOVA não abre.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK a janela: falha só da segunda gravação e o principal some, a senha antiga abre pelo .bak e a nova não")]
    public async Task Window_WhenOnlyTheSecondWriteFailedAndTheMainFileIsLost_TheBakOpensWithTheOldPassword()
    {
        //Arrange
        var (_, _, newPassword) = await CreateTheWindowAsync();
        File.Delete(VaultPath(_userName));

        //Act
        var withTheNew = await OpensFromDisk(newPassword);
        var withTheOld = await OpensFromDisk(_password);

        //Assert
        Assert.False(withTheNew);
        Assert.True(withTheOld);
    }

    /// <summary>
    /// A cura: depois da mesma falha, sair e entrar com a senha NOVA refaz o `.bak` (uma regravação do principal, e só ela), que passa a abrir só com a
    /// nova. A prova é a de sempre: o principal apagado, o `.bak` promovido, e só a senha nova abre.
    /// </summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK a cura: entrar com a senha nova depois da falha da segunda gravação refaz o .bak, que passa a abrir só com a nova")]
    public async Task Unlock_AfterTheSecondWriteFailed_RemakesTheBakWithTheNewPassword()
    {
        //Arrange
        var (service, client, newPassword) = await CreateTheWindowAsync();
        var writesBefore = client.Writes;

        //Act
        var unlocked = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);
        service.Lock();

        //Assert
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(1, client.Writes - writesBefore);
        Assert.Equal(File.ReadAllBytes(VaultPath(_userName)), File.ReadAllBytes(VaultPath(_userName) + ".bak"));

        File.Delete(VaultPath(_userName));

        Assert.False(await OpensFromDisk(_password));
        Assert.True(await OpensFromDisk(newPassword));
    }

    /// <summary>Depois de uma gravação comum o `.bak` é a versão anterior, DIFERENTE do principal, com o mesmo embrulho: entrar não refaz nada.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK depois de uma gravação comum entrar não regrava nada")]
    public async Task Unlock_AfterAnOrdinaryWrite_DoesNotWriteAnything()
    {
        //Arrange
        var newPassword = NewPassword();
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        await service.ChangePasswordAsync(_password, newPassword, CancellationToken.None);
        await service.SaveAsync(document => document with { Folders = [VaultFakers.CreateFolder()] }, CancellationToken.None);
        service.Lock();
        var mainBytes = File.ReadAllBytes(VaultPath(_userName));
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        var writesBefore = client.Writes;

        //Act
        var unlocked = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        Assert.True(unlocked.IsSuccess);
        Assert.NotEqual(mainBytes, backupBytes);
        Assert.Equal(writesBefore, client.Writes);
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath(_userName)));
        Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
    }

    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK sem .bak entrar não grava nada")]
    public async Task Unlock_WhenThereIsNoBak_DoesNotWriteAnything()
    {
        //Arrange
        var client = new RecordingClient(CreateClient());
        var service = CreateService(client);
        await service.CreateAsync(_userName, _password, CancellationToken.None);
        service.Lock();
        var writesBefore = client.Writes;

        //Act
        var unlocked = await service.UnlockAsync(_userName, _password, CancellationToken.None);

        //Assert
        Assert.True(unlocked.IsSuccess);
        Assert.Equal(writesBefore, client.Writes);
        Assert.False(File.Exists(VaultPath(_userName) + ".bak"));
    }

    /// <summary>RN-COFRE-006: a entrada que falha (senha errada, usuário inexistente) não olha o `.bak` nem grava: a cura é depois de a senha conferir.</summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "Erro entrada com senha errada não olha o .bak nem grava")]
    public async Task Unlock_WithWrongPassword_DoesNotLookAtTheBakNorWrite()
    {
        //Arrange
        var (service, client, newPassword) = await CreateTheWindowAsync();
        var writesBefore = client.Writes;
        var readsBefore = client.BackupReads;

        //Act
        var wrongPassword = await service.UnlockAsync(_userName, newPassword + "x", CancellationToken.None);
        var unknownUser = await service.UnlockAsync(new Faker().Random.String2(length: 12, chars: Letters), newPassword, CancellationToken.None);

        //Assert
        Assert.True(wrongPassword.IsFailure);
        Assert.True(unknownUser.IsFailure);
        Assert.Equal(writesBefore, client.Writes);
        Assert.Equal(readsBefore, client.BackupReads);
    }

    /// <summary>
    /// RN-VERSAO-005 e RN-COFRE-013: um `.bak` ilegível ou de formato mais novo não é tocado. A cura o sobrescreveria (o `File.Replace` da regravação do
    /// principal põe o principal antigo no lugar dele), então ela nem tenta: a entrada abre, o `.bak` fica byte a byte como estava, e nada é gravado.
    /// </summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK um .bak ilegível ou de formato mais novo não é tocado pela cura")]
    public async Task Unlock_WhenTheBakIsUnreadableOrNewer_LeavesItAlone()
    {
        foreach (var damage in new Action<string>[] { path => File.WriteAllText(path, "isto não é um cofre"), path => Tamper(node => node["version"] = VaultCrypto.Version + 1, path), path => Tamper(node => node["kdf"]!["salt"] = "curto", path) })
        {
            //Arrange
            var (service, client, newPassword) = await CreateTheWindowAsync();
            damage(VaultPath(_userName) + ".bak");
            var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
            var writesBefore = client.Writes;

            //Act
            var unlocked = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);
            service.Lock();

            //Assert
            Assert.True(unlocked.IsSuccess);
            Assert.Equal(writesBefore, client.Writes);
            Assert.Equal(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));

            Directory.Delete(Path.GetDirectoryName(VaultPath(_userName))!, recursive: true);
        }
    }

    /// <summary>
    /// A falha da cura não impede a entrada: o cofre abre, a falha vai ao log como aviso (sem senha, sem usuário e sem exceção) e o `.bak` segue como estava.
    /// A entrada seguinte tenta de novo e, com o disco de volta, refaz.
    /// </summary>
    [Trait("VaultService", "UnlockAsync")]
    [Fact(DisplayName = "OK a falha da cura não impede a entrada, vai ao log como aviso, e a entrada seguinte refaz o .bak")]
    public async Task Unlock_WhenTheHealingWriteFails_StillOpensAndLogsAWarning()
    {
        //Arrange
        var sink = new CollectingSink();
        var (service, client, newPassword) = await CreateTheWindowAsync(new LoggerConfiguration().WriteTo.Sink(sink).CreateLogger());
        sink.Events.Clear();
        var backupBytes = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        client.FailWritesFrom = client.Writes + 1;

        //Act
        var firstEntry = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);
        var backupAfterTheFirstEntry = File.ReadAllBytes(VaultPath(_userName) + ".bak");
        service.Lock();
        client.FailWritesFrom = int.MaxValue;
        var secondEntry = await service.UnlockAsync(_userName, newPassword, CancellationToken.None);

        //Assert
        var warning = Assert.Single(sink.Events);
        var text = warning.RenderMessage() + " " + string.Join(' ', warning.Properties.Values.Select(value => value.ToString()));
        Assert.True(firstEntry.IsSuccess);
        Assert.Equal(LogEventLevel.Warning, warning.Level);
        Assert.Null(warning.Exception);
        Assert.Contains("cópia de segurança", text);
        using var writer = new StringWriter();
        new MessageTemplateTextFormatter("{Message:lj}").Format(warning, writer);
        Assert.DoesNotContain("\"", writer.ToString());
        Assert.DoesNotContain(newPassword, text);
        Assert.DoesNotContain(_password, text);
        Assert.DoesNotContain(_userName, text);
        Assert.Equal(backupBytes, backupAfterTheFirstEntry);
        Assert.True(secondEntry.IsSuccess);
        Assert.NotEqual(backupBytes, File.ReadAllBytes(VaultPath(_userName) + ".bak"));
        Assert.Equal(File.ReadAllBytes(VaultPath(_userName)), File.ReadAllBytes(VaultPath(_userName) + ".bak"));
    }
}
