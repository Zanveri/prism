using Prism.Infrastructure.Drivers.Models;
using System.IO.Compression;

namespace Prism.Infrastructure.Drivers.Clients;

/// <summary>
/// RN-DRIVER-003: tira do pacote só as entradas que o catálogo espera, para dentro de uma pasta. Nada do pacote é executado, e nenhum
/// nome vindo dele escolhe onde um arquivo vai parar: o destino sai do catálogo, e um pacote com QUALQUER entrada de nome estranho
/// (caminho absoluto, `..`, unidade, barra invertida, link simbólico) é recusado inteiro, antes de o primeiro arquivo ser gravado,
/// mesmo que a entrada estranha não fosse extraída. Quem chama já conferiu o SHA-512 do arquivo; isto é a segunda barreira, para o dia
/// em que o catálogo aponte para um pacote que ninguém olhou por dentro.
///
/// Lança o que o disco e o zip lançam; só é chamado de dentro do `Send` do client.
/// </summary>
internal static class DriverPackageExtractor
{
    /// <summary>O maior driver de hoje ocupa 127 MB extraído. O teto conta os bytes gravados, e não o tamanho que a entrada declara.</summary>
    public const long MaxExtractedBytes = 512L * 1024 * 1024;

    /// <summary>O maior pacote de hoje tem 151 entradas.</summary>
    public const int MaxEntries = 4096;

    private const int UnixFileTypeMask = 0xF000;
    private const int UnixSymbolicLink = 0xA000;

    /// <returns>Nulo quando tudo o que se esperava foi extraído; senão, o motivo da recusa (sempre `IntegrityFailed`).</returns>
    public static DriverInstallFailure? Extract(Stream package, DriverPackage layout, string targetDirectory, CancellationToken cancellationToken, long maxExtractedBytes = MaxExtractedBytes)
    {
        using var archive = new ZipArchive(package, ZipArchiveMode.Read, leaveOpen: true);

        if (archive.Entries.Count > MaxEntries)
            return Refusal("O pacote tem mais arquivos do que um driver pode ter.");

        var targets = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);

        foreach (var entry in archive.Entries)
        {
            // O nome é conferido em toda entrada, também nas que não seriam extraídas. Uma entrada de pasta (termina em `/`) não tem conteúdo.
            var isFolder = entry.FullName.EndsWith('/');
            if (!(isFolder ? DriverPaths.IsSafeTree(entry.FullName) : DriverPaths.IsSafe(entry.FullName)) || IsSymbolicLink(entry))
                return Refusal("O pacote tem um arquivo com caminho que sai da pasta do driver. Nada foi instalado.");

            // Dois nomes para o mesmo destino (o Windows não diferencia maiúsculas): não há como dizer qual dos dois é o arquivo do driver.
            if (!isFolder && TargetOf(entry.FullName, layout) is { } target && !targets.TryAdd(target, entry))
                return Refusal("O pacote tem dois arquivos para o mesmo lugar. Nada foi instalado.");
        }

        var root = Path.GetFullPath(targetDirectory);
        var written = 0L;
        var buffer = new byte[81920];

        foreach (var (target, entry) in targets)
        {
            // A última conferência, sobre o caminho já resolvido pelo sistema: o destino tem de ficar dentro da pasta.
            var path = Path.GetFullPath(Path.Combine(root, target.Replace('/', Path.DirectorySeparatorChar)));
            if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                return Refusal("O pacote tem um arquivo com caminho que sai da pasta do driver. Nada foi instalado.");

            Directory.CreateDirectory(Path.GetDirectoryName(path)!);

            using var source = entry.Open();
            using var destination = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);

            int read;
            while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                cancellationToken.ThrowIfCancellationRequested();

                written += read;
                if (written > maxExtractedBytes)
                    return Refusal("O pacote é maior, depois de extraído, do que um driver pode ser. Nada foi instalado.");

                destination.Write(buffer, 0, read);
            }
        }

        return targets.ContainsKey(layout.ManagedAssembly) && targets.ContainsKey(layout.NativeLibrary) ? null : Refusal("O pacote não tem os arquivos que o driver precisa. Nada foi instalado.");
    }

    /// <summary>Para onde vai a entrada, na pasta do driver; nulo quando o catálogo não a espera (assinatura, `tools/`, o `.nuspec`).</summary>
    private static string? TargetOf(string entryName, DriverPackage layout)
        => layout.Files.FirstOrDefault(file => string.Equals(file.From, entryName, StringComparison.Ordinal))?.To
            ?? layout.Trees.Where(tree => entryName.StartsWith(tree.From, StringComparison.Ordinal)).Select(tree => tree.To + entryName[tree.From.Length..]).FirstOrDefault();

    /// <summary>O zip feito no Linux ou no macOS guarda o tipo do arquivo nos 16 bits altos dos atributos externos.</summary>
    private static bool IsSymbolicLink(ZipArchiveEntry entry)
        => ((entry.ExternalAttributes >> 16) & UnixFileTypeMask) == UnixSymbolicLink;

    private static DriverInstallFailure Refusal(string detail)
        => new(EDriverInstallFailure.IntegrityFailed, detail);
}
