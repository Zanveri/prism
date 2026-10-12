using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Prism.TestingCore.Fakers.Drivers;

/// <summary>
/// Um driver de mentira para os testes do gerenciador (seção 16 da especificação): um pacote pequeno, com a forma de um `.nupkg`, e o
/// catálogo que aponta para ele. Tudo aqui é público e de tipos simples (bytes e texto): o projeto de integração monta o cenário sem
/// enxergar nada interno da aplicação.
/// </summary>
public static class DriverPackageFakers
{
    public const string DriverID = "driver-de-teste";
    public const string DriverName = "Driver de Teste";
    public const string Version = "1.2.3";
    public const string PackageID = "Prism.Driver.De.Teste";

    /// <summary>A plataforma dos testes não é a da máquina: o mesmo teste vale no Windows, no Linux e no macOS.</summary>
    public const string Platform = "plataforma-de-teste";

    public const string BundledDriverID = "embutido";
    public const string UnavailableDriverID = "sem-plataforma";
    public const string ComingSoonDriverID = "em-breve";

    public const string ManagedAssembly = "Driver.Teste.dll";
    public const string NativeLibrary = "nativo/bin/teste.bin";
    public const string LicenseFile = "Licenca.txt";
    public const string PlatformNote = "Nota da plataforma de teste.";
    public const string UnavailableNote = "O fabricante de teste não publica este driver para esta plataforma.";
    public const string LicenseName = "Licença de Teste";
    public const string LicenseUrl = "https://licenca.exemplo.test/texto";

    /// <summary>O caminho que o nuget.org usa no contêiner plano: nome e versão em minúsculas.</summary>
    public static string RequestPath
        => $"/{PackageID.ToLowerInvariant()}/{Version}/{PackageID.ToLowerInvariant()}.{Version}.nupkg";

    /// <summary>As entradas de um pacote bom: as três que o catálogo espera, a árvore nativa e o que um `.nupkg` traz e não se extrai.</summary>
    public static (string Name, byte[] Content)[] ValidEntries()
        =>
        [
            ("[Content_Types].xml", Encoding.UTF8.GetBytes("<Types />")),
            ("lib/net10.0/Driver.Teste.dll", RandomNumberGenerator.GetBytes(4096)),
            ("nativo-origem/bin/teste.bin", RandomNumberGenerator.GetBytes(8192)),
            ("nativo-origem/msg/pt_BR/mensagens.txt", Encoding.UTF8.GetBytes("mensagens")),
            (LicenseFile, Encoding.UTF8.GetBytes("texto de licença de mentira")),
            ("tools/Executavel.exe", RandomNumberGenerator.GetBytes(512)),
            (".signature.p7s", RandomNumberGenerator.GetBytes(256))
        ];

    public static byte[] CreateValidPackage()
        => CreatePackage(ValidEntries());

    /// <summary>Um zip com as entradas na ordem dada e com os nomes exatamente como vieram: é assim que o teste escreve `../fora.txt`.</summary>
    public static byte[] CreatePackage(params (string Name, byte[] Content)[] entries)
        => CreatePackage(entries.Select(entry => (entry.Name, entry.Content, ExternalAttributes: 0)).ToArray());

    /// <param name="entries">`ExternalAttributes` leva, nos 16 bits altos, o modo de arquivo do Unix: `0xA1FF &lt;&lt; 16` é um link simbólico.</param>
    public static byte[] CreatePackage(params (string Name, byte[] Content, int ExternalAttributes)[] entries)
    {
        using var buffer = new MemoryStream();

        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var (name, content, externalAttributes) in entries)
            {
                var entry = archive.CreateEntry(name, CompressionLevel.Fastest);
                entry.ExternalAttributes = externalAttributes;

                using var stream = entry.Open();
                stream.Write(content);
            }

        return buffer.ToArray();
    }

    /// <summary>O SHA-512 em base64, como o catálogo o guarda.</summary>
    public static string Sha512(byte[] bytes)
        => Convert.ToBase64String(SHA512.HashData(bytes));

    /// <summary>
    /// Um catálogo com um driver em cada situação: embutido, baixável nesta plataforma (o do pacote dado), baixável só em outra
    /// plataforma e "em breve". `sha512` e `sizeBytes` trocam o hash e o tamanho gravados, para o teste do pacote que não confere.
    /// </summary>
    public static string CatalogJson(byte[] package, string? sha512 = null, long? sizeBytes = null)
        => CatalogJson(sha512 ?? Sha512(package), sizeBytes ?? package.LongLength);

    /// <summary>
    /// O catálogo de teste com os bancos trocados: o driver baixável atende o PostgreSQL (1), e o embutido, o Db2 (2). Serve ao teste
    /// que precisa de uma sessão de verdade, aberta num banco que o driver de teste "atende", sem depender do driver da IBM.
    /// </summary>
    public static string CatalogJsonServingPostgres(byte[] package)
        => CatalogJson(Sha512(package), package.LongLength, downloadableEngine: 1, bundledEngine: 2);

    /// <summary>O mesmo catálogo para o teste que não baixa nada: o hash e o tamanho são os de um pacote que não existe.</summary>
    public static string CatalogJson(long sizeBytes = 1)
        => CatalogJson(Sha512([]), sizeBytes);

    private static string CatalogJson(string sha512, long sizeBytes, int downloadableEngine = 2, int bundledEngine = 1)
        => JsonSerializer.Serialize(new
        {
            drivers = new object[]
            {
                new { id = BundledDriverID, name = "Embutido", vendor = "Fabricante A", kind = "bundled", engines = new[] { bundledEngine }, version = "1.0.0", license = new { name = "Licença Livre", url = "https://licenca.exemplo.test/livre" } },
                new { id = DriverID, name = DriverName, vendor = "Fabricante B", kind = "downloadable", engines = new[] { downloadableEngine }, version = Version, unavailableNote = UnavailableNote, packages = new Dictionary<string, object> { [Platform] = PackageJson(sha512, sizeBytes) } },
                new { id = UnavailableDriverID, name = "Sem Plataforma", vendor = "Fabricante C", kind = "downloadable", engines = new[] { 3 }, version = "9.9.9", unavailableNote = UnavailableNote, packages = new Dictionary<string, object> { ["outra-plataforma"] = PackageJson(Sha512([]), 1) } },
                new { id = ComingSoonDriverID, name = "Em Breve", vendor = "Fabricante D", kind = "comingSoon" }
            }
        });

    private static object PackageJson(string sha512, long sizeBytes)
        => new
        {
            id = PackageID,
            sha512,
            sizeBytes,
            license = new { name = LicenseName, url = LicenseUrl },
            files = new[] { new { from = "lib/net10.0/Driver.Teste.dll", to = ManagedAssembly }, new { from = LicenseFile, to = LicenseFile } },
            trees = new[] { new { from = "nativo-origem/", to = "nativo/" } },
            managedAssembly = ManagedAssembly,
            nativeLibrary = NativeLibrary,
            note = PlatformNote
        };
}
