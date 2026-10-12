using Prism.Infrastructure.Drivers.Clients;
using Prism.Infrastructure.Drivers.Models;
using Prism.TestingCore.Fakers.Drivers;
using System.Security.Cryptography;
using System.Text.Json;

namespace Prism.UnitTesting.Drivers;

/// <summary>
/// A pasta de drivers no disco e a conferência da partida (RN-DRIVER-003, 007 e 009). A pasta da versão só existe completa: o que uma
/// instalação interrompida deixa é um `.tmp-*`, e a remoção é um marcador que a partida seguinte executa.
/// </summary>
public sealed class DriverStoreTests : IDisposable
{
    private static readonly DateTimeOffset AcceptedAt = new(2026, 10, 10, 12, 30, 0, TimeSpan.Zero);

    private readonly string _directory = Directory.CreateTempSubdirectory("prism-driver-store-").FullName;
    private readonly DriverDefinition _driver = DriverCatalog.Parse(DriverPackageFakers.CatalogJson()).Find(DriverPackageFakers.DriverID)!;

    private DriverPackage Package => _driver.PackageFor(DriverPackageFakers.Platform)!;

    private string DriverDirectory => Path.Combine(_directory, DriverPackageFakers.DriverID);

    private string InstallDirectory => Path.Combine(DriverDirectory, DriverPackageFakers.Version);

    private string ManagedPath => Path.Combine(InstallDirectory, DriverPackageFakers.ManagedAssembly);

    private string NativePath => Path.Combine(InstallDirectory, "nativo", "bin", "teste.bin");

    public void Dispose()
        => Directory.Delete(_directory, recursive: true);

    private DriverProbe Probe()
        => DriverStore.Probe(_directory, _driver, Package);

    /// <summary>Uma instalação completa, pelo mesmo caminho do client: arquivos numa pasta temporária e a troca de nome no fim.</summary>
    private void Install()
    {
        var temporary = DriverStore.CreateTemporaryDirectory(_directory, _driver);
        Directory.CreateDirectory(Path.Combine(temporary, "nativo", "bin"));
        File.WriteAllBytes(Path.Combine(temporary, DriverPackageFakers.ManagedAssembly), RandomNumberGenerator.GetBytes(2048));
        File.WriteAllBytes(Path.Combine(temporary, "nativo", "bin", "teste.bin"), RandomNumberGenerator.GetBytes(4096));

        DriverStore.Commit(_directory, _driver, Package, temporary, AcceptedAt);
    }

    private static void FlipFirstByte(string path)
    {
        var bytes = File.ReadAllBytes(path);
        bytes[0] ^= 0xFF;
        File.WriteAllBytes(path, bytes);
    }

    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "OK sem pasta de drivers, o driver não está instalado e nada vai para o log")]
    public void Probe_ShouldBeNotInstalled_WhenNothingExists()
    {
        //Act
        var probe = Probe();

        //Assert
        Assert.Equal(new DriverProbe(false, false, null), probe);
        Assert.False(Directory.Exists(DriverDirectory));
    }

    [Trait("DriverStore", "Commit")]
    [Fact(DisplayName = "OK a instalação concluída passa na conferência da partida")]
    public void Commit_ThenProbe_ShouldBeInstalled()
    {
        //Arrange
        Install();

        //Act
        var probe = Probe();

        //Assert
        Assert.Equal(new DriverProbe(true, false, null), probe);
        Assert.Equal([InstallDirectory], Directory.EnumerateFileSystemEntries(DriverDirectory));
    }

    /// <summary>RN-DRIVER-003 e 009: o aceite fica na pasta do driver, com a licença, a versão, a data e o hash do pacote.</summary>
    [Trait("DriverStore", "Commit")]
    [Fact(DisplayName = "OK o registro guarda o aceite, o hash do pacote e os hashes dos dois arquivos conferidos na partida")]
    public void Commit_WritesTheInstallRecord()
    {
        //Arrange
        Install();

        //Act
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(InstallDirectory, DriverStore.RecordFileName)));

        //Assert
        var record = json.RootElement;
        Assert.Equal(DriverPackageFakers.DriverID, record.GetProperty("driverID").GetString());
        Assert.Equal(DriverPackageFakers.Version, record.GetProperty("version").GetString());
        Assert.Equal(DriverPackageFakers.PackageID, record.GetProperty("packageID").GetString());
        Assert.Equal(Package.Sha512, record.GetProperty("packageSha512").GetString());
        Assert.Equal(DriverPackageFakers.LicenseName, record.GetProperty("license").GetProperty("name").GetString());
        Assert.Equal(DriverPackageFakers.LicenseUrl, record.GetProperty("license").GetProperty("url").GetString());
        Assert.Equal(AcceptedAt, record.GetProperty("acceptedAt").GetDateTimeOffset());
        Assert.Equal(Convert.ToBase64String(SHA512.HashData(File.ReadAllBytes(ManagedPath))), record.GetProperty("managedAssemblySha512").GetString());
        Assert.Equal(Convert.ToBase64String(SHA512.HashData(File.ReadAllBytes(NativePath))), record.GetProperty("nativeLibrarySha512").GetString());
    }

    /// <summary>
    /// O processo morreu no meio de uma instalação: sobraram a pasta temporária, com parte dos arquivos, e o pacote baixado. A pasta da
    /// versão nunca chegou a existir, então o driver não está instalado, e a partida apaga as sobras.
    /// </summary>
    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "OK a sobra de uma instalação interrompida é apagada, e o driver não está instalado")]
    public void Probe_ShouldCleanLeftovers_WhenInstallWasInterrupted()
    {
        //Arrange
        var temporary = DriverStore.CreateTemporaryDirectory(_directory, _driver);
        File.WriteAllBytes(Path.Combine(temporary, DriverPackageFakers.ManagedAssembly), RandomNumberGenerator.GetBytes(2048));
        File.WriteAllBytes(DriverStore.TemporaryPackagePath(_directory, _driver), RandomNumberGenerator.GetBytes(1024));

        //Act
        var probe = Probe();

        //Assert
        Assert.Equal(new DriverProbe(false, false, null), probe);
        Assert.Empty(Directory.EnumerateFileSystemEntries(DriverDirectory));
    }

    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "OK a sobra ao lado de uma instalação boa é apagada, e a instalação continua valendo")]
    public void Probe_ShouldCleanLeftovers_AndKeepTheInstallation()
    {
        //Arrange
        Install();
        DriverStore.CreateTemporaryDirectory(_directory, _driver);
        File.WriteAllBytes(DriverStore.TemporaryPackagePath(_directory, _driver), [1, 2, 3]);

        //Act
        var probe = Probe();

        //Assert
        Assert.True(probe.Installed);
        Assert.Equal([InstallDirectory], Directory.EnumerateFileSystemEntries(DriverDirectory));
    }

    /// <summary>RN-DRIVER-007: a remoção marcada numa execução acontece na partida seguinte, antes de qualquer carga.</summary>
    [Trait("DriverStore", "MarkForRemoval")]
    [Fact(DisplayName = "OK o driver marcado para remoção é apagado na partida seguinte")]
    public void MarkForRemoval_ThenProbe_RemovesTheInstallation()
    {
        //Arrange
        Install();

        //Act
        DriverStore.MarkForRemoval(_directory, _driver);
        var markerExisted = File.Exists(InstallDirectory + DriverStore.RemovalSuffix);
        var stillThere = Directory.Exists(InstallDirectory);
        var first = Probe();
        var second = Probe();

        //Assert
        Assert.True(markerExisted);
        Assert.True(stillThere);
        Assert.Equal(new DriverProbe(false, true, null), first);
        Assert.Equal(new DriverProbe(false, false, null), second);
        Assert.Empty(Directory.EnumerateFileSystemEntries(DriverDirectory));
    }

    /// <summary>A exclusão parou depois da pasta e antes do marcador: a partida seguinte só tira o marcador.</summary>
    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "OK marcador de remoção sem a pasta do driver é apagado")]
    public void Probe_ShouldDeleteTheMarker_WhenTheFolderIsAlreadyGone()
    {
        //Arrange
        Directory.CreateDirectory(DriverDirectory);
        File.WriteAllBytes(InstallDirectory + DriverStore.RemovalSuffix, []);

        //Act
        var probe = Probe();

        //Assert
        Assert.False(probe.Installed);
        Assert.Empty(Directory.EnumerateFileSystemEntries(DriverDirectory));
    }

    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "Erro assembly gerenciado alterado depois da instalação")]
    public void Probe_ShouldBeNotInstalled_WhenManagedAssemblyWasTampered()
    {
        //Arrange
        Install();
        FlipFirstByte(ManagedPath);

        //Act
        var probe = Probe();

        //Assert
        Assert.False(probe.Installed);
        Assert.NotNull(probe.Refusal);
    }

    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "Erro biblioteca nativa alterada depois da instalação")]
    public void Probe_ShouldBeNotInstalled_WhenNativeLibraryWasTampered()
    {
        //Arrange
        Install();
        FlipFirstByte(NativePath);

        //Act
        var probe = Probe();

        //Assert
        Assert.False(probe.Installed);
        Assert.NotNull(probe.Refusal);
    }

    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "Erro biblioteca nativa apagada depois da instalação")]
    public void Probe_ShouldBeNotInstalled_WhenNativeLibraryWasDeleted()
    {
        //Arrange
        Install();
        File.Delete(NativePath);

        //Act
        var probe = Probe();

        //Assert
        Assert.False(probe.Installed);
        Assert.NotNull(probe.Refusal);
    }

    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "Erro pasta do driver sem o registro da instalação")]
    public void Probe_ShouldBeNotInstalled_WhenRecordIsMissing()
    {
        //Arrange
        Install();
        File.Delete(Path.Combine(InstallDirectory, DriverStore.RecordFileName));

        //Act
        var probe = Probe();

        //Assert
        Assert.False(probe.Installed);
        Assert.NotNull(probe.Refusal);
    }

    /// <summary>O catálogo passou a apontar para outro pacote (outro hash) na mesma versão: o que está no disco não é o que ele descreve.</summary>
    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "Erro registro de um pacote que não é o do catálogo")]
    public void Probe_ShouldBeNotInstalled_WhenRecordIsOfAnotherPackage()
    {
        //Arrange
        Install();
        var other = DriverCatalog.Parse(DriverPackageFakers.CatalogJson([1, 2, 3])).Find(DriverPackageFakers.DriverID)!;

        //Act
        var probe = DriverStore.Probe(_directory, other, other.PackageFor(DriverPackageFakers.Platform)!);

        //Assert
        Assert.False(probe.Installed);
        Assert.NotNull(probe.Refusal);
    }

    /// <summary>Só a pasta da versão do catálogo conta: a de outra versão fica onde está e não é o driver instalado.</summary>
    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "OK pasta de outra versão não é o driver instalado")]
    public void Probe_ShouldBeNotInstalled_WhenOnlyAnotherVersionExists()
    {
        //Arrange
        Install();
        Directory.Move(InstallDirectory, Path.Combine(DriverDirectory, "1.2.2"));

        //Act
        var probe = Probe();

        //Assert
        Assert.Equal(new DriverProbe(false, false, null), probe);
    }

    /// <summary>O `Send` do client é quem transforma esta exceção em "não instalado".</summary>
    [Trait("DriverStore", "Probe")]
    [Fact(DisplayName = "Erro registro que não é JSON sobe como exceção")]
    public void Probe_ShouldThrow_WhenRecordIsNotJson()
    {
        //Arrange
        Install();
        File.WriteAllText(Path.Combine(InstallDirectory, DriverStore.RecordFileName), "{ isto não é json");

        //Act
        var exception = Record.Exception(Probe);

        //Assert
        Assert.IsType<JsonException>(exception);
    }

    /// <summary>A pasta que não passou na conferência não foi carregada, e a instalação nova a substitui.</summary>
    [Trait("DriverStore", "Commit")]
    [Fact(DisplayName = "OK instalar por cima de uma pasta que não passou na conferência a substitui")]
    public void Commit_OverATamperedInstallation_ReplacesIt()
    {
        //Arrange
        Install();
        FlipFirstByte(ManagedPath);
        File.WriteAllText(Path.Combine(InstallDirectory, "intruso.txt"), "x");

        //Act
        Install();
        var probe = Probe();

        //Assert
        Assert.True(probe.Installed);
        Assert.False(File.Exists(Path.Combine(InstallDirectory, "intruso.txt")));
    }
}
