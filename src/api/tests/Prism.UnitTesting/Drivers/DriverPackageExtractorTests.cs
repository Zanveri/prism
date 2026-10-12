using Prism.Infrastructure.Drivers.Clients;
using Prism.Infrastructure.Drivers.Models;
using Prism.TestingCore.Fakers.Drivers;
using System.Text;

namespace Prism.UnitTesting.Drivers;

/// <summary>
/// RN-DRIVER-003: do pacote só saem as entradas que o catálogo espera, e um pacote com qualquer nome de entrada que saia da pasta de
/// destino é recusado inteiro, sem nada gravado. Cada teste extrai para `destino/`, dentro de uma pasta temporária própria, e confere
/// também que nada apareceu ao lado dela.
/// </summary>
public sealed class DriverPackageExtractorTests : IDisposable
{
    private static readonly byte[] Content = Encoding.UTF8.GetBytes("conteúdo");

    private readonly string _root = Directory.CreateTempSubdirectory("prism-driver-extract-").FullName;

    private string Target => Path.Combine(_root, "destino");

    public void Dispose()
        => Directory.Delete(_root, recursive: true);

    /// <summary>O pacote da plataforma de teste, como o catálogo de teste o descreve.</summary>
    private static DriverPackage Layout()
        => DriverCatalog.Parse(DriverPackageFakers.CatalogJson()).Find(DriverPackageFakers.DriverID)!.PackageFor(DriverPackageFakers.Platform)!;

    /// <summary>Cada extração começa com o destino vazio, como a pasta temporária que o client cria.</summary>
    private DriverInstallFailure? Extract(byte[] package, long maxExtractedBytes = DriverPackageExtractor.MaxExtractedBytes, CancellationToken cancellationToken = default)
    {
        if (Directory.Exists(Target))
            Directory.Delete(Target, recursive: true);

        Directory.CreateDirectory(Target);
        using var stream = new MemoryStream(package);

        return DriverPackageExtractor.Extract(stream, Layout(), Target, cancellationToken, maxExtractedBytes);
    }

    /// <summary>As entradas de um pacote bom mais as que o teste acrescenta.</summary>
    private static byte[] PackageWith(params (string Name, byte[] Content)[] extra)
        => DriverPackageFakers.CreatePackage([.. DriverPackageFakers.ValidEntries(), .. extra]);

    private string[] ExtractedFiles()
        => [.. Directory.EnumerateFiles(Target, "*", SearchOption.AllDirectories).Select(file => Path.GetRelativePath(Target, file).Replace('\\', '/')).Order(StringComparer.Ordinal)];

    /// <summary>Nada dentro do destino e nada ao lado dele.</summary>
    private void AssertNothingWasWritten()
    {
        Assert.Empty(Directory.EnumerateFileSystemEntries(Target));
        Assert.Equal([Target], Directory.EnumerateFileSystemEntries(_root));
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "OK só as entradas que o catálogo espera saem do pacote, cada uma no lugar que o catálogo diz")]
    public void Extract_ShouldBeOK()
    {
        //Arrange
        var entries = DriverPackageFakers.ValidEntries();

        //Act
        var refusal = Extract(DriverPackageFakers.CreatePackage(entries));

        //Assert
        Assert.Null(refusal);
        Assert.Equal(["Driver.Teste.dll", "Licenca.txt", "nativo/bin/teste.bin", "nativo/msg/pt_BR/mensagens.txt"], ExtractedFiles());
        Assert.Equal(entries.Single(entry => entry.Name == "lib/net10.0/Driver.Teste.dll").Content, File.ReadAllBytes(Path.Combine(Target, "Driver.Teste.dll")));
        Assert.Equal(entries.Single(entry => entry.Name == "nativo-origem/bin/teste.bin").Content, File.ReadAllBytes(Path.Combine(Target, "nativo", "bin", "teste.bin")));
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "OK entrada de pasta, sem conteúdo, não é arquivo nem recusa")]
    public void Extract_ShouldBeOK_WhenPackageHasFolderEntries()
    {
        //Act
        var refusal = Extract(PackageWith(("nativo-origem/vazia/", [])));

        //Assert
        Assert.Null(refusal);
        Assert.DoesNotContain(ExtractedFiles(), file => file.Contains("vazia"));
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro entrada com `..` no começo do nome")]
    public void Extract_ShouldBeError_WhenEntryClimbsOut()
    {
        //Act
        var refusal = Extract(PackageWith(("../fora.txt", Content)));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
        AssertNothingWasWritten();
    }

    /// <summary>Dentro de uma pasta que o catálogo espera: sem a recusa, o arquivo seria gravado ao lado da pasta de destino.</summary>
    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro entrada com `..` no meio de uma pasta esperada")]
    public void Extract_ShouldBeError_WhenExpectedTreeEntryClimbsOut()
    {
        //Act
        var refusal = Extract(PackageWith(("nativo-origem/../../fora.txt", Content)));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
        AssertNothingWasWritten();
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro entrada com caminho absoluto")]
    public void Extract_ShouldBeError_WhenEntryIsAbsolute()
    {
        //Arrange
        var name = $"prism-teste-{Guid.NewGuid():N}.txt";

        //Act
        var refusal = Extract(PackageWith(($"/{name}", Content)));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
        Assert.False(File.Exists(Path.Combine(Path.GetPathRoot(_root)!, name)));
        AssertNothingWasWritten();
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro entrada com unidade do Windows")]
    public void Extract_ShouldBeError_WhenEntryHasDrive()
    {
        //Act
        var refusal = Extract(PackageWith(("C:/fora.txt", Content)));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
        AssertNothingWasWritten();
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro entrada com barra invertida")]
    public void Extract_ShouldBeError_WhenEntryHasBackslash()
    {
        //Act
        var refusal = Extract(PackageWith(("nativo-origem\\..\\..\\fora.txt", Content)));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
        AssertNothingWasWritten();
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro entrada com segmento vazio ou de um ponto")]
    public void Extract_ShouldBeError_WhenEntryHasEmptyOrDotSegment()
    {
        //Act
        var doubleSlash = Extract(PackageWith(("nativo-origem//x.txt", Content)));
        var dot = Extract(PackageWith(("nativo-origem/./x.txt", Content)));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, doubleSlash?.Kind);
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, dot?.Kind);
        AssertNothingWasWritten();
    }

    /// <summary>O zip feito no Unix marca o link nos atributos; o conteúdo da entrada é o caminho para onde ele aponta.</summary>
    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro entrada que é link simbólico")]
    public void Extract_ShouldBeError_WhenEntryIsSymbolicLink()
    {
        //Arrange
        var entries = DriverPackageFakers.ValidEntries().Select(entry => (entry.Name, entry.Content, ExternalAttributes: 0)).Append(("nativo-origem/lib/atalho.so", Encoding.UTF8.GetBytes("/etc/passwd"), unchecked((int)0xA1FF0000))).ToArray();

        //Act
        var refusal = Extract(DriverPackageFakers.CreatePackage(entries));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
        AssertNothingWasWritten();
    }

    /// <summary>O Windows não diferencia maiúsculas: os dois nomes disputariam o mesmo arquivo.</summary>
    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro duas entradas para o mesmo destino")]
    public void Extract_ShouldBeError_WhenTwoEntriesShareATarget()
    {
        //Act
        var refusal = Extract(PackageWith(("nativo-origem/bin/TESTE.BIN", Content)));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
        AssertNothingWasWritten();
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro pacote sem o assembly gerenciado ou sem a biblioteca nativa")]
    public void Extract_ShouldBeError_WhenExpectedFilesAreMissing()
    {
        //Arrange
        var withoutManaged = DriverPackageFakers.ValidEntries().Where(entry => entry.Name != "lib/net10.0/Driver.Teste.dll").ToArray();
        var withoutNative = DriverPackageFakers.ValidEntries().Where(entry => entry.Name != "nativo-origem/bin/teste.bin").ToArray();

        //Act
        var managedRefusal = Extract(DriverPackageFakers.CreatePackage(withoutManaged));
        var nativeRefusal = Extract(DriverPackageFakers.CreatePackage(withoutNative));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, managedRefusal?.Kind);
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, nativeRefusal?.Kind);
    }

    /// <summary>O teto conta o que é gravado: 64 KiB de zeros ocupam poucos bytes no zip, e a entrada pode declarar o tamanho que quiser.</summary>
    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro pacote que, extraído, passa do teto de tamanho")]
    public void Extract_ShouldBeError_WhenExtractedBytesPassTheLimit()
    {
        //Act
        var refusal = Extract(PackageWith(("nativo-origem/zeros.bin", new byte[64 * 1024])), maxExtractedBytes: 32 * 1024);

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro pacote com entradas demais")]
    public void Extract_ShouldBeError_WhenThereAreTooManyEntries()
    {
        //Arrange
        var many = Enumerable.Range(0, DriverPackageExtractor.MaxEntries + 1).Select(index => ($"sobras/{index}.txt", Array.Empty<byte>())).ToArray();

        //Act
        var refusal = Extract(DriverPackageFakers.CreatePackage(many));

        //Assert
        Assert.Equal(EDriverInstallFailure.IntegrityFailed, refusal?.Kind);
        AssertNothingWasWritten();
    }

    /// <summary>
    /// Uma falha de disco no meio da extração: `a` já foi gravado como arquivo quando `a/b` pede que ele seja pasta. A exceção sobe (é o
    /// `Send` do client que a transforma em falha e apaga a pasta temporária), e o que ficou está só dentro do destino.
    /// </summary>
    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro falha de disco no meio da extração sobe como exceção, sem nada fora do destino")]
    public void Extract_ShouldThrow_WhenDiskFailsHalfway()
    {
        //Act
        var exception = Record.Exception(() => Extract(PackageWith(("nativo-origem/a", Content), ("nativo-origem/a/b", Content))));

        //Assert
        Assert.IsAssignableFrom<IOException>(exception);
        Assert.Equal([Target], Directory.EnumerateFileSystemEntries(_root));
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro cancelamento durante a extração sobe como cancelamento")]
    public void Extract_ShouldThrow_WhenCanceled()
    {
        //Arrange
        using var canceled = new CancellationTokenSource();
        canceled.Cancel();

        //Act
        var exception = Record.Exception(() => Extract(DriverPackageFakers.CreateValidPackage(), cancellationToken: canceled.Token));

        //Assert
        Assert.IsAssignableFrom<OperationCanceledException>(exception);
    }

    [Trait("DriverPackageExtractor", "Extract")]
    [Fact(DisplayName = "Erro arquivo que não é zip sobe como dado inválido")]
    public void Extract_ShouldThrow_WhenPackageIsNotAZip()
    {
        //Act
        var exception = Record.Exception(() => Extract(Encoding.UTF8.GetBytes("isto não é um pacote")));

        //Assert
        Assert.IsType<InvalidDataException>(exception);
        AssertNothingWasWritten();
    }

    [Trait("DriverPaths", "IsSafe")]
    [Fact(DisplayName = "OK caminho relativo e simples passa; o resto não")]
    public void IsSafe_AcceptsOnlyPlainRelativePaths()
    {
        //Assert
        Assert.True(DriverPaths.IsSafe("a.txt"));
        Assert.True(DriverPaths.IsSafe("clidriver/bin/db2app64.dll"));
        Assert.True(DriverPaths.IsSafe("lib/icc/..arquivo"));
        Assert.False(DriverPaths.IsSafe(null));
        Assert.False(DriverPaths.IsSafe(""));
        Assert.False(DriverPaths.IsSafe("/a.txt"));
        Assert.False(DriverPaths.IsSafe("a/"));
        Assert.False(DriverPaths.IsSafe("a//b"));
        Assert.False(DriverPaths.IsSafe(".."));
        Assert.False(DriverPaths.IsSafe("a/../b"));
        Assert.False(DriverPaths.IsSafe("a/./b"));
        Assert.False(DriverPaths.IsSafe("a\\b"));
        Assert.False(DriverPaths.IsSafe("C:/a"));
        Assert.False(DriverPaths.IsSafe("a.txt:fluxo"));
        Assert.False(DriverPaths.IsSafe("a\nb"));
        Assert.True(DriverPaths.IsSafeTree("clidriver/"));
        Assert.False(DriverPaths.IsSafeTree("clidriver"));
        Assert.False(DriverPaths.IsSafeTree("/"));
        Assert.False(DriverPaths.IsSafeTree("../"));
    }
}
