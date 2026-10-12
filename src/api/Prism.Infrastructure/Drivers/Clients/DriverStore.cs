using Prism.Infrastructure.Drivers.Models;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Prism.Infrastructure.Drivers.Clients;

/// <summary>O que a partida achou na pasta de um driver. `Refusal` é o motivo de uma instalação que existe e não vale (vai para o log).</summary>
internal sealed record DriverProbe(bool Installed, bool Removed, string? Refusal);

/// <summary>
/// A pasta de drivers no disco (RN-DRIVER-003 e 009): `&lt;drivers&gt;/&lt;id&gt;/&lt;versão&gt;/`, com o `install.json` dentro. A regra que
/// sustenta tudo: **a pasta da versão só existe com esse nome depois de completa**. A instalação extrai numa pasta `.tmp-*` ao lado,
/// grava nela o registro e só então a renomeia; o que uma queda deixa para trás é sempre um `.tmp-*`, que a partida apaga. A remoção é
/// um arquivo `&lt;versão&gt;.remove` ao lado da pasta, porque um assembly carregado não se apaga: quem apaga é a partida seguinte, antes
/// de qualquer carga.
///
/// Lança o que o disco lança; só é chamado de dentro do `Send` do client.
/// </summary>
internal static class DriverStore
{
    public const string RecordFileName = "install.json";
    public const string TemporaryPrefix = ".tmp-";
    public const string RemovalSuffix = ".remove";

    /// <summary>O registro é para ser lido por gente também: o hash em base64 e o endereço da licença vão como são, sem `+` no lugar do `+`.</summary>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, WriteIndented = true, RespectNullableAnnotations = true, RespectRequiredConstructorParameters = true };

    public static string DriverDirectory(string directory, DriverDefinition driver)
        => Path.Combine(directory, driver.ID);

    public static string InstallDirectory(string directory, DriverDefinition driver)
        => Path.Combine(directory, driver.ID, driver.Version!);

    /// <summary>
    /// O que a API faz com a pasta de um driver ao partir, antes de carregá-lo: executa a remoção pedida na execução anterior, apaga as
    /// sobras de uma instalação interrompida, e só dá o driver como instalado se a pasta é a da versão do catálogo, o registro existe e
    /// é desse pacote, e o assembly gerenciado e a biblioteca nativa principal têm o hash gravado na instalação.
    /// </summary>
    public static DriverProbe Probe(string directory, DriverDefinition driver, DriverPackage package)
    {
        var driverDirectory = DriverDirectory(directory, driver);
        if (!Directory.Exists(driverDirectory))
            return new DriverProbe(false, false, null);

        foreach (var leftover in Directory.GetFileSystemEntries(driverDirectory, TemporaryPrefix + "*"))
            Delete(leftover);

        var installDirectory = InstallDirectory(directory, driver);
        var marker = installDirectory + RemovalSuffix;

        // RN-DRIVER-007. O marcador só sai depois da pasta: se a exclusão parar no meio, a partida seguinte continua de onde parou.
        if (File.Exists(marker))
        {
            Delete(installDirectory);
            File.Delete(marker);

            return new DriverProbe(false, true, null);
        }

        if (!Directory.Exists(installDirectory))
            return new DriverProbe(false, false, null);

        var recordPath = Path.Combine(installDirectory, RecordFileName);
        if (!File.Exists(recordPath))
            return new DriverProbe(false, false, "a pasta do driver não tem o registro da instalação");

        var record = JsonSerializer.Deserialize<DriverInstallRecord>(File.ReadAllBytes(recordPath), JsonOptions);
        if (record is null || record.DriverID != driver.ID || record.Version != driver.Version || record.PackageID != package.ID || record.PackageSha512 != package.Sha512)
            return new DriverProbe(false, false, "o registro da instalação não é do pacote do catálogo");

        return Matches(installDirectory, package.ManagedAssembly, record.ManagedAssemblySha512) && Matches(installDirectory, package.NativeLibrary, record.NativeLibrarySha512)
            ? new DriverProbe(true, false, null)
            : new DriverProbe(false, false, "um arquivo do driver foi alterado ou apagado depois da instalação");
    }

    /// <summary>Uma pasta `.tmp-*` nova, ao lado de onde o driver vai ficar (no mesmo volume, para a troca de nome do fim não copiar nada).</summary>
    public static string CreateTemporaryDirectory(string directory, DriverDefinition driver)
        => Directory.CreateDirectory(Path.Combine(DriverDirectory(directory, driver), TemporaryPrefix + Guid.NewGuid().ToString("N"))).FullName;

    /// <summary>O arquivo `.tmp-*.nupkg` do download, na pasta do driver. Quem o abre o apaga ao fechar; se o processo morrer antes, a partida o apaga.</summary>
    public static string TemporaryPackagePath(string directory, DriverDefinition driver)
        => Path.Combine(Directory.CreateDirectory(DriverDirectory(directory, driver)).FullName, $"{TemporaryPrefix}{Guid.NewGuid():N}.nupkg");

    /// <summary>
    /// O fim da instalação: grava o registro na pasta temporária, com os hashes do que foi extraído, e dá a ela o nome da versão. Uma
    /// pasta da versão que já exista é a de uma instalação que não passou na conferência da partida (e por isso não foi carregada): sai antes.
    /// </summary>
    public static void Commit(string directory, DriverDefinition driver, DriverPackage package, string temporaryDirectory, DateTimeOffset acceptedAt)
    {
        var record = new DriverInstallRecord(driver.ID, driver.Version!, package.ID, package.Sha512, package.License, acceptedAt, HashFile(Path.Combine(temporaryDirectory, Local(package.ManagedAssembly))), HashFile(Path.Combine(temporaryDirectory, Local(package.NativeLibrary))));

        using (var stream = new FileStream(Path.Combine(temporaryDirectory, RecordFileName), FileMode.CreateNew, FileAccess.Write, FileShare.None, bufferSize: 4096, FileOptions.WriteThrough))
        {
            JsonSerializer.Serialize(stream, record, JsonOptions);
            stream.Flush(flushToDisk: true);
        }

        var installDirectory = InstallDirectory(directory, driver);
        Delete(installDirectory);
        Directory.Move(temporaryDirectory, installDirectory);
    }

    /// <summary>RN-DRIVER-007: a remoção fica marcada no disco, e quem a executa é a partida seguinte (<see cref="Probe"/>).</summary>
    public static void MarkForRemoval(string directory, DriverDefinition driver)
        => File.WriteAllBytes(InstallDirectory(directory, driver) + RemovalSuffix, []);

    /// <summary>Apaga um arquivo ou uma pasta inteira; o que não existe não é erro.</summary>
    public static void Delete(string path)
    {
        if (Directory.Exists(path))
            Directory.Delete(path, recursive: true);
        else
            File.Delete(path);
    }

    public static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);

        return Convert.ToBase64String(SHA512.HashData(stream));
    }

    private static bool Matches(string installDirectory, string relativePath, string expectedSha512)
    {
        var path = Path.Combine(installDirectory, Local(relativePath));

        return File.Exists(path) && HashFile(path) == expectedSha512;
    }

    /// <summary>O catálogo escreve os caminhos com `/`.</summary>
    public static string Local(string relativePath)
        => relativePath.Replace('/', Path.DirectorySeparatorChar);
}
