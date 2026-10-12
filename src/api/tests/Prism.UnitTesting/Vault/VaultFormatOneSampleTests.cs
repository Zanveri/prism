using Microsoft.Extensions.Options;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Vault;
using Serilog.Core;
using System.Text.Json;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// O formato 1 do cofre (RN-COFRE-003 e 004) como um arquivo gravado ANTES da RN-VERSAO-005 e versionado em `Vault/Samples/`. Este
/// teste é o que acusa, numa versão futura, uma mudança de formato sem migração: o cabeçalho é dado autenticado das duas cifras (a
/// versão, o algoritmo, os parâmetros e o sal entram na conta), então mexer em qualquer coisa do formato, ou no jeito de montar esse
/// dado, faz o exemplo deixar de abrir, e a pessoa com um cofre real perderia o acesso a ele.
///
/// A SENHA ABAIXO É UMA CONSTANTE FICTÍCIA, de um cofre de exemplo com dados inventados (usuário, host e senha de banco que não existem):
/// sem ela o arquivo não serve de prova. Não protege nada de ninguém, e não deve ser trocada por uma senha de verdade. O arquivo foi
/// gerado pelo próprio código (Argon2id de 8 MiB e uma passada, o mesmo dos testes) e não é regravado: quem o regerar por uma mudança de
/// formato perde a prova de que o formato antigo continua abrindo.
/// </summary>
public sealed class VaultFormatOneSampleTests : IDisposable
{
    private const string SampleUserName = "exemplo.formato1";

    /// <summary>Fictícia, de propósito (ver o resumo da classe).</summary>
    internal const string SamplePassword = "senha-ficticia-do-cofre-de-exemplo";

    private const string SampleResource = "vault-format-1.json";

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-vault-sample-").FullName;

    /// <summary>O que o cofre de exemplo guarda: uma pasta com uma conexão dentro, tudo inventado.</summary>
    internal static VaultDocument SampleDocument { get; } = CreateSampleDocument();

    private static VaultDocument CreateSampleDocument()
    {
        var createdAt = new DateTime(2026, 10, 9, 12, 0, 0, DateTimeKind.Utc);
        var folder = new VaultFolderRecord(Guid.Parse("0199c3a0-0000-7000-8000-000000000001"), null, "Produção", createdAt, createdAt);
        var connection = new VaultConnectionRecord(Guid.Parse("0199c3a0-0000-7000-8000-000000000002"), folder.ID, "Banco de exemplo", EDatabaseEngine.PostgreSql, "db.exemplo.invalid", 5432, "exemplo", "usuario_exemplo", "senha-ficticia-do-banco-de-exemplo", "Produção", "#cc3300", createdAt, createdAt);

        return new VaultDocument(SampleUserName, [folder], [connection]);
    }

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private static byte[] ReadSample()
    {
        using var stream = typeof(VaultFormatOneSampleTests).Assembly.GetManifestResourceStream(SampleResource)!;
        using var memory = new MemoryStream();
        stream.CopyTo(memory);

        return memory.ToArray();
    }

    private string CopySampleToVaults()
    {
        var path = Path.Combine(_directory, "vaults", $"{SampleUserName}.vault.json");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, ReadSample());

        return path;
    }

    private VaultService CreateService()
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));

        return new VaultService(new VaultFileClient(options, Logger.None), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, Logger.None);
    }

    /// <summary>O exemplo é mesmo do formato 1, e não de um formato que alguém tenha gerado de novo: o número do cabeçalho é o que a prova cobre.</summary>
    [Trait("VaultFormatOneSample", "Header")]
    [Fact(DisplayName = "OK o arquivo de exemplo declara o formato 1")]
    public void Sample_DeclaresFormatOne()
    {
        //Arrange
        using var json = JsonDocument.Parse(ReadSample());

        //Act
        var format = json.RootElement.GetProperty("version").GetInt32();

        //Assert
        Assert.Equal(1, format);
        Assert.Equal(VaultCrypto.Version, format);
    }

    [Trait("VaultFormatOneSample", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre do formato 1 gravado antes da RN-VERSAO-005 abre com a senha, e o arquivo fica como estava")]
    public async Task Unlock_VaultOfFormatOneWrittenBefore_OpensAndKeepsTheFile()
    {
        //Arrange
        var path = CopySampleToVaults();
        var bytes = File.ReadAllBytes(path);
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(service.IsUnlocked);
        Assert.Equal(SampleUserName, service.UserName);
        Assert.True(service.Read().Value.JsonEquals(SampleDocument));
        Assert.Equal(bytes, File.ReadAllBytes(path));
        Assert.False(File.Exists(path + ".bak"));
    }

    /// <summary>
    /// RN-COFRE-013: o cofre do formato 1 gravado antes da regra troca de senha e continua abrindo. A troca re-embrulha com chave nova, mas escreve o mesmo formato (versão 1,
    /// Argon2id, os mesmos campos): o que a prova do exemplo cobre. A senha nova é sorteada no teste; o conteúdo volta inteiro com ela, a antiga não abre mais, e o `.bak`
    /// fica igual ao principal novo.
    /// </summary>
    [Trait("VaultFormatOneSample", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK o cofre do formato 1 troca de senha e continua abrindo, com o mesmo conteúdo, no mesmo formato")]
    public async Task ChangePassword_VaultOfFormatOneWrittenBefore_KeepsOpeningWithTheNewPassword()
    {
        //Arrange
        var path = CopySampleToVaults();
        var newPassword = $"nova-{Guid.NewGuid():N}";
        var service = CreateService();
        await service.UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None);

        //Act
        var changed = await service.ChangePasswordAsync(SamplePassword, newPassword, CancellationToken.None);
        service.Lock();
        var withTheOld = await service.UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None);
        var withTheNew = await service.UnlockAsync(SampleUserName, newPassword, CancellationToken.None);

        //Assert
        using var json = JsonDocument.Parse(File.ReadAllBytes(path));
        Assert.True(changed.IsSuccess);
        Assert.True(withTheOld.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, withTheOld.Error);
        Assert.True(withTheNew.IsSuccess);
        Assert.True(service.Read().Value.JsonEquals(SampleDocument));
        Assert.Equal(1, json.RootElement.GetProperty("version").GetInt32());
        Assert.Equal("argon2id", json.RootElement.GetProperty("kdf").GetProperty("algorithm").GetString());
        Assert.Equal(File.ReadAllBytes(path), File.ReadAllBytes(path + ".bak"));
    }

    [Trait("VaultFormatOneSample", "UnlockAsync")]
    [Fact(DisplayName = "Erro o cofre do formato 1 não abre com outra senha, e continua sendo credencial inválida")]
    public async Task Unlock_VaultOfFormatOneWithAnotherPassword_ReturnsInvalidCredentials()
    {
        //Arrange
        CopySampleToVaults();
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(SampleUserName, SamplePassword + "x", CancellationToken.None);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal(EVaultError.InvalidCredentials, result.Error);
        Assert.False(service.IsUnlocked);
    }
}
