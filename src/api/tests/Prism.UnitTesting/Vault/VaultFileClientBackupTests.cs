using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Vault;
using System.Text.Json.Nodes;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// RN-COFRE-013: `ReadBackup` lê o `.bak` e só ele, para o serviço conferir a cada entrada se a cópia de segurança está embrulhada pela mesma senha do principal.
/// Não promove, não regrava e não olha o principal: o `.bak` que a leitura recusa (ilegível, formato mais novo) fica onde está. É o mesmo client de
/// `VaultFileClientTests`, em outro arquivo.
/// </summary>
public sealed partial class VaultFileClientTests
{
    private string BackupPath => VaultPath + ".bak";

    [Trait("VaultFileClient", "ReadBackup")]
    [Fact(DisplayName = "OK lê o .bak como está, sem promovê-lo nem tocar nos arquivos")]
    public void ReadBackup_ReturnsTheBakFileWithoutPromotingOrTouchingAnything()
    {
        //Arrange
        var first = VaultFakers.CreateFile();
        var client = CreateClient();
        client.Write(_userName, first);
        client.Write(_userName, VaultFakers.CreateFile());
        var mainBytes = File.ReadAllBytes(VaultPath);
        var backupBytes = File.ReadAllBytes(BackupPath);

        //Act
        var backup = client.ReadBackup(_userName);

        //Assert
        Assert.True(backup.IsSuccess);
        Assert.True(backup.Value.Value.JsonEquals(first));
        Assert.Equal(mainBytes, File.ReadAllBytes(VaultPath));
        Assert.Equal(backupBytes, File.ReadAllBytes(BackupPath));
    }

    [Trait("VaultFileClient", "ReadBackup")]
    [Fact(DisplayName = "OK sem .bak volta vazio, sem falha")]
    public void ReadBackup_WhenThereIsNone_ReturnsNone()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());

        //Act
        var backup = client.ReadBackup(_userName);

        //Assert
        Assert.True(backup.IsSuccess);
        Assert.True(backup.Value.HasNoValue);
    }

    /// <summary>Quem promove o `.bak` é o `Read` (RN-COFRE-005). O `ReadBackup` lê o que está lá, e o `.bak` continua sendo `.bak`.</summary>
    [Trait("VaultFileClient", "ReadBackup")]
    [Fact(DisplayName = "OK sem o principal o .bak é lido e não é promovido")]
    public void ReadBackup_WhenTheMainFileIsMissing_DoesNotPromote()
    {
        //Arrange
        var first = VaultFakers.CreateFile();
        var client = CreateClient();
        client.Write(_userName, first);
        client.Write(_userName, VaultFakers.CreateFile());
        File.Delete(VaultPath);

        //Act
        var backup = client.ReadBackup(_userName);

        //Assert
        Assert.True(backup.Value.Value.JsonEquals(first));
        Assert.False(File.Exists(VaultPath));
        Assert.True(File.Exists(BackupPath));
    }

    /// <summary>O que a leitura do principal recusaria o `ReadBackup` recusa também, sem tocar no arquivo: o serviço não cura um `.bak` ilegível.</summary>
    [Trait("VaultFileClient", "ReadBackup")]
    [Fact(DisplayName = "Erro .bak ilegível, com forma errada ou parâmetro acima do teto responde corrompido, e o arquivo fica como estava")]
    public void ReadBackup_WhenTheBakIsUnreadable_ReturnsCorruptAndLeavesItAlone()
    {
        foreach (var damage in new Action<string>[]
        {
            path => File.WriteAllText(path, "isto não é um cofre"),
            path => Rewrite(node => node["kdf"]!["salt"] = "curto", path),
            path => Rewrite(node => node["kdf"]!["iterations"] = 9, path),
            path => Rewrite(node => node.AsObject().Remove("wrappedKey"), path)
        })
        {
            //Arrange
            var client = CreateClient();
            client.Write(_userName, VaultFakers.CreateFile());
            client.Write(_userName, VaultFakers.CreateFile());
            damage(BackupPath);
            var damaged = File.ReadAllBytes(BackupPath);

            //Act
            var backup = client.ReadBackup(_userName);

            //Assert
            Assert.True(backup.IsFailure);
            Assert.Equal(EVaultFileError.Corrupt, backup.Error);
            Assert.Equal(damaged, File.ReadAllBytes(BackupPath));
            Directory.Delete(Path.GetDirectoryName(VaultPath)!, recursive: true);
        }
    }

    /// <summary>RN-VERSAO-005: o `.bak` de formato mais novo é `NewerFormat`, e fica onde está.</summary>
    [Trait("VaultFileClient", "ReadBackup")]
    [Fact(DisplayName = "Erro .bak de formato mais novo responde formato mais novo, e o arquivo fica como estava")]
    public void ReadBackup_WhenTheBakIsOfANewerFormat_ReturnsNewerFormatAndLeavesItAlone()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        client.Write(_userName, VaultFakers.CreateFile());
        Rewrite(node => node["version"] = VaultCrypto.Version + 1, BackupPath);
        var backupBytes = File.ReadAllBytes(BackupPath);

        //Act
        var backup = client.ReadBackup(_userName);

        //Assert
        Assert.True(backup.IsFailure);
        Assert.Equal(EVaultFileError.NewerFormat, backup.Error);
        Assert.Equal(backupBytes, File.ReadAllBytes(BackupPath));
    }

    [Trait("VaultFileClient", "ReadBackup")]
    [Fact(DisplayName = "OK nome com caminho não lê arquivo de fora da pasta dos cofres")]
    public void ReadBackup_UserNameWithPath_ReturnsNone()
    {
        //Arrange
        var client = CreateClient();

        //Act
        var backup = client.ReadBackup(Path.Combine("..", _userName));

        //Assert
        Assert.True(backup.IsSuccess);
        Assert.True(backup.Value.HasNoValue);
    }

    [Trait("VaultFileClient", "ReadBackup")]
    [Fact(DisplayName = "Erro falha de disco na leitura do .bak responde indisponível")]
    public void ReadBackup_WhenDiskFails_ReturnsUnavailable()
    {
        //Arrange
        var client = CreateClient();
        client.Write(_userName, VaultFakers.CreateFile());
        client.Write(_userName, VaultFakers.CreateFile());
        using var holder = new FileStream(BackupPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);

        //Act
        var backup = client.ReadBackup(_userName);

        //Assert
        Assert.True(backup.IsFailure);
        Assert.Equal(EVaultFileError.Unavailable, backup.Error);
    }

    /// <summary>Regrava um arquivo qualquer do cofre (o `.bak`, no caso) com uma alteração no JSON, como faria quem o editasse à mão.</summary>
    private static void Rewrite(Action<JsonNode> change, string path)
    {
        var node = JsonNode.Parse(File.ReadAllText(path))!;
        change(node);
        File.WriteAllText(path, node.ToJsonString());
    }
}
