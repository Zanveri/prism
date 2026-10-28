using Prism.Infrastructure.Databases.Models;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Prism.Infrastructure.Drivers.Models;

internal enum EDriverKind
{
    /// <summary>Vem no pacote do Prism (RN-DRIVER-001: só o do PostgreSQL, de licença permissiva).</summary>
    Bundled,

    /// <summary>Baixado pelo usuário, do nuget.org, nas plataformas que têm pacote.</summary>
    Downloadable,

    /// <summary>O Prism ainda não conecta nesse banco.</summary>
    ComingSoon
}

/// <summary>De qual entrada (ou prefixo de entradas) do pacote sai qual arquivo (ou pasta) do driver instalado.</summary>
internal sealed record DriverPackageMapping(string From, string To);

/// <summary>
/// O pacote do nuget.org de um driver numa plataforma (RN-DRIVER-002): o nome, o SHA-512 do arquivo `.nupkg` em base64 (como o NuGet o
/// guarda) e o tamanho dele. `Files` e `Trees` são as únicas entradas que saem do pacote (RN-DRIVER-003); `ManagedAssembly` e
/// `NativeLibrary` são os dois arquivos, já na pasta do driver, cujo hash é gravado na instalação e conferido na partida.
/// </summary>
internal sealed record DriverPackage(string ID, string Sha512, long SizeBytes, DriverLicense License, IReadOnlyList<DriverPackageMapping> Files, IReadOnlyList<DriverPackageMapping> Trees, string ManagedAssembly, string? NativeLibrary = null, string? Note = null);

internal sealed record DriverDefinition(string ID, string Name, string Vendor, EDriverKind Kind, IReadOnlyList<EDatabaseEngine>? Engines = null, string? Version = null, DriverLicense? License = null, string? UnavailableNote = null, IReadOnlyDictionary<string, DriverPackage>? Packages = null)
{
    /// <summary>O pacote da plataforma (`win-x64`, `linux-x64`, `osx-arm64`), ou nulo quando o fabricante não publica o driver para ela.</summary>
    public DriverPackage? PackageFor(string platform)
        => Packages is not null && Packages.TryGetValue(platform, out var package) ? package : null;
}

/// <summary>
/// RN-DRIVER-002: o catálogo de drivers é um arquivo versionado dentro da API (`Drivers/drivers.catalog.json`, embutido no assembly), e
/// nada dele é descoberto pela rede. É dele, e só dele, que saem o endereço do download, o nome da pasta do driver e os nomes dos
/// arquivos extraídos; por isso a leitura recusa tudo o que não tem a forma esperada, e a API não sobe com um catálogo errado.
///
/// No arquivo, a ordem dos drivers é a da tela. O SHA-512 e o tamanho de cada pacote são os do `.nupkg` servido em
/// `https://api.nuget.org/v3-flatcontainer/&lt;id&gt;/&lt;versão&gt;/&lt;id&gt;.&lt;versão&gt;.nupkg`, iguais aos que o NuGet guarda no cache
/// depois do restore (`&lt;id&gt;.&lt;versão&gt;.nupkg.sha512`). A versão do driver da IBM é a da referência de compilação do
/// `Prism.Infrastructure.csproj`, e a do PostgreSQL, a do Npgsql: mudou uma, muda a outra (há teste). Os textos de licença não vêm para
/// o repositório: só o nome e o endereço oficial (RN-DRIVER-001).
/// </summary>
internal sealed partial record DriverCatalog(IReadOnlyList<DriverDefinition> Drivers)
{
    /// <summary>O nome lógico do recurso embutido, dado no `.csproj`.</summary>
    private const string ResourceName = "drivers.catalog.json";

    /// <summary>Campo a mais, campo obrigatório faltando e nulo onde não cabe são erro de quem escreveu o catálogo, e aparecem na leitura.</summary>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        // Só o tipo do driver é texto; os bancos continuam sendo os números do `EDatabaseEngine`, os mesmos que a tela recebe.
        Converters = { new JsonStringEnumConverter<EDriverKind>(JsonNamingPolicy.CamelCase, allowIntegerValues: false) },
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    public DriverDefinition? Find(string id)
        => Drivers.FirstOrDefault(driver => string.Equals(driver.ID, id, StringComparison.Ordinal));

    /// <summary>O catálogo que vai dentro da API. Lança na partida se faltar ou estiver errado: a API não sobe meio configurada.</summary>
    public static DriverCatalog LoadDefault()
    {
        using var resource = typeof(DriverCatalog).Assembly.GetManifestResourceStream(ResourceName) ?? throw Invalid("o recurso embutido não está no assembly.");
        using var reader = new StreamReader(resource);

        return Parse(reader.ReadToEnd());
    }

    /// <summary>JSON fora da forma lança `JsonException`; o que tem a forma e não faz sentido, `InvalidOperationException`. As duas param a partida.</summary>
    public static DriverCatalog Parse(string json)
    {
        var catalog = JsonSerializer.Deserialize<DriverCatalog>(json, JsonOptions);

        if (catalog?.Drivers is not { Count: > 0 })
            throw Invalid("não há drivers.");

        catalog.Validate();

        return catalog;
    }

    private void Validate()
    {
        foreach (var driver in Drivers)
        {
            // O identificador vira nome de pasta e segmento de rota: só minúsculas, dígitos e hífen.
            if (!DriverIDFormat().IsMatch(driver.ID))
                throw Invalid($"o identificador \"{driver.ID}\" não tem a forma esperada.");

            if (string.IsNullOrWhiteSpace(driver.Name) || string.IsNullOrWhiteSpace(driver.Vendor))
                throw Invalid($"o driver {driver.ID} está sem nome ou sem fabricante.");

            if (driver.License is not null)
                ValidateLicense(driver.ID, driver.License);

            var engines = driver.Engines ?? [];
            if (engines.Any(engine => !Enum.IsDefined(engine)) || engines.Distinct().Count() != engines.Count)
                throw Invalid($"o driver {driver.ID} atende um banco desconhecido ou repetido.");

            var packages = driver.Packages ?? new Dictionary<string, DriverPackage>();

            switch (driver.Kind)
            {
                case EDriverKind.Bundled when engines.Count > 0 && IsVersion(driver.Version) && packages.Count == 0:
                case EDriverKind.ComingSoon when engines.Count == 0 && driver.Version is null && driver.License is null && packages.Count == 0:
                    break;
                case EDriverKind.Downloadable when engines.Count > 0 && IsVersion(driver.Version) && packages.Count > 0 && !string.IsNullOrWhiteSpace(driver.UnavailableNote):
                    foreach (var (platform, package) in packages)
                        ValidatePackage(driver.ID, platform, package);

                    break;
                default:
                    throw Invalid($"o driver {driver.ID} não tem os campos que o tipo dele pede.");
            }
        }

        if (Drivers.Select(driver => driver.ID).Distinct(StringComparer.Ordinal).Count() != Drivers.Count)
            throw Invalid("há identificador de driver repetido.");

        // RN-DRIVER-006: o banco diz qual driver falta. Dois drivers para o mesmo banco deixariam a resposta sem dono.
        if (Drivers.SelectMany(driver => driver.Engines ?? []).GroupBy(engine => engine).Any(group => group.Count() > 1))
            throw Invalid("há banco atendido por mais de um driver.");
    }

    private static void ValidatePackage(string driverID, string platform, DriverPackage package)
    {
        var where = $"o pacote de {driverID} para {platform}";

        // O nome do pacote entra no endereço do download: só o que um identificador do NuGet tem.
        if (!PackageIDFormat().IsMatch(package.ID))
            throw Invalid($"{where} tem um nome fora do formato.");

        Span<byte> hash = stackalloc byte[65];
        if (!Convert.TryFromBase64String(package.Sha512, hash, out var written) || written != 64)
            throw Invalid($"{where} não tem um SHA-512 em base64.");

        if (package.SizeBytes <= 0)
            throw Invalid($"{where} está sem tamanho.");

        ValidateLicense(driverID, package.License);

        if (package.Files.Count == 0 || package.Files.Any(file => !DriverPaths.IsSafe(file.From) || !DriverPaths.IsSafe(file.To)))
            throw Invalid($"{where} tem um arquivo com caminho que não é relativo e simples.");

        if (package.Trees.Any(tree => !DriverPaths.IsSafeTree(tree.From) || !DriverPaths.IsSafeTree(tree.To)))
            throw Invalid($"{where} tem uma pasta com caminho que não é relativo e simples.");

        if (!DriverPaths.IsSafe(package.ManagedAssembly) || (package.NativeLibrary is not null && !DriverPaths.IsSafe(package.NativeLibrary)))
            throw Invalid($"{where} não diz o assembly gerenciado ou a biblioteca nativa.");
    }

    /// <summary>
    /// O endereço da licença é o que a pessoa lê e copia antes de aceitar: só `https://`, e só com caracteres que se veem. É a mesma regra
    /// da tela (`isLicenseUrl`, em `drivers.schema.ts`), que trata como licença ausente o endereço que não passa.
    /// </summary>
    private static void ValidateLicense(string driverID, DriverLicense license)
    {
        if (string.IsNullOrWhiteSpace(license.Name) || !LicenseUrlFormat().IsMatch(license.Url) || !Uri.TryCreate(license.Url, UriKind.Absolute, out _))
            throw Invalid($"a licença de {driverID} está sem nome ou sem um endereço https.");
    }

    /// <summary>A versão vira nome de pasta e pedaço do endereço do download.</summary>
    private static bool IsVersion(string? version)
        => version is not null && VersionFormat().IsMatch(version);

    private static InvalidOperationException Invalid(string problem)
        => new($"Catálogo de drivers inválido: {problem}");

    [GeneratedRegex(@"^[a-z0-9]+(-[a-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex DriverIDFormat();

    [GeneratedRegex(@"^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex PackageIDFormat();

    [GeneratedRegex(@"^[0-9A-Za-z]+([.-][0-9A-Za-z]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex VersionFormat();

    [GeneratedRegex(@"^https://[^\p{C}\p{Z}]+$", RegexOptions.CultureInvariant)]
    private static partial Regex LicenseUrlFormat();
}

/// <summary>
/// O que é um caminho que não sai da pasta de destino (RN-DRIVER-003): relativo, com `/`, sem segmento vazio, `.` ou `..`, sem barra
/// invertida, sem dois-pontos (unidade ou fluxo alternativo do Windows) e sem caractere de controle. Vale para os nomes do catálogo e
/// para o nome de toda entrada do pacote baixado.
/// </summary>
internal static class DriverPaths
{
    public static bool IsSafe(string? path)
        => !string.IsNullOrEmpty(path) && !path.Any(character => character is '\\' or ':' || char.IsControl(character)) && path.Split('/').All(segment => segment.Length > 0 && segment is not ("." or ".."));

    /// <summary>O prefixo de uma pasta: um caminho simples terminado em `/`.</summary>
    public static bool IsSafeTree(string? prefix)
        => prefix is { Length: > 1 } && prefix[^1] == '/' && IsSafe(prefix[..^1]);
}
