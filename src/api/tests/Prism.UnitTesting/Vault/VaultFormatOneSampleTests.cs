using CSharpFunctionalExtensions;
using Microsoft.Extensions.Options;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Clients;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Vault;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Text.Json;

namespace Prism.UnitTesting.Vault;

/// <summary>
/// O formato 1 do cofre (RN-COFRE-003 e 004) como um arquivo gravado ANTES da RN-VERSAO-005 e versionado em `Vault/Samples/`. Este
/// teste é o que acusa uma mudança de formato sem migração: o cabeçalho é dado autenticado das duas cifras (a versão, o algoritmo, os
/// parâmetros e o sal entram na conta), então mexer em qualquer coisa do formato, ou no jeito de montar esse dado, faz o exemplo deixar
/// de abrir, e a pessoa com um cofre real perderia o acesso a ele. O formato 2 (RN-SCRIPT-002) acrescentou os scripts ao documento, o
/// formato 3 (RN-ABAS-006), a área de trabalho, e o formato 4 (RN-SCRIPT-011), as pastas de scripts: o exemplo abre, é migrado ao abrir pelos
/// três passos (ganha a lista de scripts vazia, a área de trabalho vazia e a lista de pastas de scripts vazia, e passa a declarar o formato
/// atual) e o arquivo de antes fica no `.bak`. O do formato 2 está em `VaultFormatTwoSampleTests`, e o do 3, em `VaultFormatThreeSampleTests`.
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

    /// <summary>
    /// O que o cofre de exemplo guarda: uma pasta com uma conexão dentro, tudo inventado. Os scripts são do formato 2, a área de trabalho do formato 3 e as
    /// pastas de scripts do formato 4: aberto, o exemplo ganha as três vazias.
    /// </summary>
    internal static VaultDocument SampleDocument { get; } = CreateSampleDocument();

    private static VaultDocument CreateSampleDocument()
    {
        var createdAt = new DateTime(2026, 10, 9, 12, 0, 0, DateTimeKind.Utc);
        var folder = new VaultFolderRecord(Guid.Parse("0199c3a0-0000-7000-8000-000000000001"), null, "Produção", createdAt, createdAt);
        var connection = new VaultConnectionRecord(Guid.Parse("0199c3a0-0000-7000-8000-000000000002"), folder.ID, "Banco de exemplo", EDatabaseEngine.PostgreSql, "db.exemplo.invalid", 5432, "exemplo", "usuario_exemplo", "senha-ficticia-do-banco-de-exemplo", "Produção", "#cc3300", createdAt, createdAt);

        return new VaultDocument(SampleUserName, [folder], [connection], [], VaultWorkspaceRecord.Empty, []);
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

    private VaultService CreateService(Func<IVaultFileClient, IVaultFileClient>? wrap = null, ILogger? logger = null)
    {
        var options = Options.Create(VaultFakers.CreateOptions(_directory));
        var client = new VaultFileClient(options, Logger.None);

        return new VaultService(wrap is null ? client : wrap(client), options, VaultCrypto.DeriveKey, VaultCrypto.NewKey, logger ?? Logger.None);
    }

    private static JsonDocument ReadJson(string path)
        => JsonDocument.Parse(File.ReadAllBytes(path));

    /// <summary>O exemplo é mesmo do formato 1, e não de um formato que alguém tenha gerado de novo: o número do cabeçalho é o que a prova cobre, e ele é mais antigo que o atual.</summary>
    [Trait("VaultFormatOneSample", "Header")]
    [Fact(DisplayName = "OK o arquivo de exemplo declara o formato 1, mais antigo que o atual")]
    public void Sample_DeclaresFormatOne()
    {
        //Arrange
        using var json = JsonDocument.Parse(ReadSample());

        //Act
        var format = json.RootElement.GetProperty("version").GetInt32();

        //Assert
        Assert.Equal(1, format);
        Assert.Equal(4, VaultCrypto.Version);
    }

    /// <summary>
    /// RN-VERSAO-005, RN-SCRIPT-002, RN-ABAS-006 e RN-SCRIPT-011: o cofre do formato 1 abre com a senha e é migrado ao abrir. O principal passa a declarar o
    /// formato atual, com o mesmo algoritmo, os mesmos parâmetros e o mesmo sal (a senha é a mesma), e o documento ganha a lista de scripts vazia, a área de
    /// trabalho vazia e a lista de pastas de scripts vazia; o
    /// arquivo de antes fica no `.bak`, byte a byte. O principal migrado abre de novo com a mesma senha, e só ela o abre.
    /// </summary>
    [Trait("VaultFormatOneSample", "UnlockAsync")]
    [Fact(DisplayName = "OK o cofre do formato 1 abre, é migrado ao formato atual com os scripts, a área de trabalho e as pastas de scripts vazios, e o arquivo de antes fica no .bak")]
    public async Task Unlock_VaultOfFormatOneWrittenBefore_OpensAndMigrates()
    {
        //Arrange
        var path = CopySampleToVaults();
        var sample = File.ReadAllBytes(path);
        var service = CreateService();

        //Act
        var result = await service.UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None);
        var opened = service.Read().Value;
        service.Lock();
        var reopened = await service.UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None);
        var withAnother = await CreateService().UnlockAsync(SampleUserName, SamplePassword + "x", CancellationToken.None);

        //Assert
        using var before = JsonDocument.Parse(sample);
        using var after = ReadJson(path);
        Assert.True(result.IsSuccess);
        Assert.Equal(SampleUserName, opened.UserName);
        Assert.True(opened.JsonEquals(SampleDocument));
        Assert.Empty(opened.Scripts);
        Assert.Empty(opened.ScriptFolders);
        Assert.Empty(opened.Workspace.Tabs);
        Assert.Null(opened.Workspace.ActiveIndex);
        Assert.Equal(VaultCrypto.Version, after.RootElement.GetProperty("version").GetInt32());
        Assert.Equal(before.RootElement.GetProperty("kdf").GetRawText(), after.RootElement.GetProperty("kdf").GetRawText());
        Assert.Equal(sample, File.ReadAllBytes(path + ".bak"));
        Assert.True(reopened.IsSuccess);
        Assert.True(service.Read().Value.JsonEquals(SampleDocument));
        Assert.Equal(EVaultError.InvalidCredentials, withAnother.Error);
    }

    /// <summary>
    /// A migração acontece uma vez: a entrada seguinte acha o formato atual e não regrava nada. O `.bak` continua sendo o arquivo do formato 1 (é a mesma senha,
    /// com o mesmo sal): a cura da cópia de segurança (RN-COFRE-013) não o toma por uma cópia de outra senha e não o troca pelo principal.
    /// </summary>
    [Trait("VaultFormatOneSample", "UnlockAsync")]
    [Fact(DisplayName = "OK a entrada seguinte à migração não regrava nada, e o .bak continua sendo o arquivo do formato 1")]
    public async Task Unlock_AfterTheMigration_WritesNothingAndKeepsTheBak()
    {
        //Arrange
        var path = CopySampleToVaults();
        var sample = File.ReadAllBytes(path);
        var service = CreateService();
        await service.UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None);
        service.Lock();
        var migrated = File.ReadAllBytes(path);

        //Act
        var result = await service.UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(migrated, File.ReadAllBytes(path));
        Assert.Equal(sample, File.ReadAllBytes(path + ".bak"));
    }

    /// <summary>
    /// A falha do disco na migração não impede a entrada (a entrada não precisa gravar): o cofre abre com o documento migrado, o arquivo fica como estava, no
    /// formato 1, e o aviso do log leva só a classe da falha, sem senha nem nome de usuário (RN-LOG-001). A primeira gravação seguinte escreve o formato atual,
    /// com o arquivo de antes no `.bak`, e a entrada seguinte, sem gravação no meio, migra de novo.
    /// </summary>
    [Trait("VaultFormatOneSample", "UnlockAsync")]
    [Fact(DisplayName = "OK a migração que o disco recusa não impede a entrada, e a gravação seguinte grava o formato atual")]
    public async Task Unlock_WhenTheMigrationCannotBeWritten_OpensAndTheNextSaveWritesTheCurrentFormat()
    {
        //Arrange
        var path = CopySampleToVaults();
        var sample = File.ReadAllBytes(path);
        var events = new List<LogEvent>();
        var failing = true;
        var service = CreateService(client => new WritesThatFail(client, () => failing), new LoggerConfiguration().WriteTo.Sink(new ListSink(events)).CreateLogger());

        //Act
        var result = await service.UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None);
        var leftOnDisk = File.ReadAllBytes(path);
        failing = false;
        var saved = await service.SaveAsync(document => document with { Scripts = [VaultFakers.CreateScript()] }, CancellationToken.None);

        //Assert
        using var after = ReadJson(path);
        Assert.True(result.IsSuccess);
        Assert.True(service.IsUnlocked);
        Assert.Equal(sample, leftOnDisk);
        var warning = Assert.Single(events, logEvent => logEvent.Level == LogEventLevel.Warning);
        Assert.Contains("Unavailable", warning.RenderMessage(), StringComparison.Ordinal);
        Assert.DoesNotContain(SampleUserName, warning.RenderMessage(), StringComparison.Ordinal);
        Assert.Null(warning.Exception);
        Assert.True(saved.IsSuccess);
        Assert.Equal(VaultCrypto.Version, after.RootElement.GetProperty("version").GetInt32());
        Assert.Equal(sample, File.ReadAllBytes(path + ".bak"));
        service.Lock();
        Assert.True((await CreateService().UnlockAsync(SampleUserName, SamplePassword, CancellationToken.None)).IsSuccess);
    }

    /// <summary>
    /// RN-COFRE-013: o cofre do formato 1 gravado antes da regra troca de senha e continua abrindo. A entrada já o migrou ao formato atual, e a troca re-embrulha
    /// com chave nova no formato atual (Argon2id, os mesmos campos). A senha nova é sorteada no teste; o conteúdo volta inteiro com ela, a antiga não abre mais, e o
    /// `.bak` fica igual ao principal novo.
    /// </summary>
    [Trait("VaultFormatOneSample", "ChangePasswordAsync")]
    [Fact(DisplayName = "OK o cofre do formato 1 troca de senha e continua abrindo, com o mesmo conteúdo, no formato atual")]
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
        Assert.Equal(VaultCrypto.Version, json.RootElement.GetProperty("version").GetInt32());
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

    /// <summary>O client de verdade, com as gravações recusadas enquanto `failing()` disser: é o disco que não deixa gravar a migração.</summary>
    private sealed class WritesThatFail(IVaultFileClient inner, Func<bool> failing) : IVaultFileClient
    {
        public Result<Maybe<VaultFile>, EVaultFileError> Read(string userName)
            => inner.Read(userName);

        public Result<Maybe<VaultFile>, EVaultFileError> ReadBackup(string userName)
            => inner.ReadBackup(userName);

        public UnitResult<EVaultFileError> Write(string userName, VaultFile file, CancellationToken cancellationToken = default)
            => failing() ? EVaultFileError.Unavailable : inner.Write(userName, file, cancellationToken);

        public Result<byte[], EVaultFileError> Open(byte[] key, VaultSealedBox box, byte[] associatedData)
            => inner.Open(key, box, associatedData);
    }

    private sealed class ListSink(List<LogEvent> events) : ILogEventSink
    {
        public void Emit(LogEvent logEvent)
            => events.Add(logEvent);
    }
}
