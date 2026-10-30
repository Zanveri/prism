using CSharpFunctionalExtensions;
using Prism.Infrastructure.Drivers.Models;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Security.Cryptography;
using ILogger = Serilog.ILogger;

namespace Prism.Infrastructure.Drivers.Clients;

internal sealed class DriverPackageClient : IDriverPackageClient, IDisposable
{
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(15);

    /// <summary>Até os cabeçalhos da resposta chegarem (o corpo é lido depois, em fluxo).</summary>
    private static readonly TimeSpan ResponseTimeout = TimeSpan.FromSeconds(30);

    /// <summary>
    /// O prazo do download inteiro: o maior pacote tem 45 MB, e meia hora o cobre até numa conexão de 256 kbit/s.
    /// ponytail: não há prazo por inatividade; uma conexão parada segura a instalação até este prazo ou até o usuário cancelar. Se isso
    /// incomodar, cancelar quando nenhum byte chega por um minuto.
    /// </summary>
    private static readonly TimeSpan DownloadDeadline = TimeSpan.FromMinutes(30);

    private readonly DriverCatalog _catalog;
    private readonly DriverSettings _settings;
    private readonly ILogger _logger;

    /// <summary>
    /// RN-DRIVER-008. Sem seguir redirecionamento: o download só vem do endereço montado aqui, e um 3xx é falha, sem segunda requisição.
    /// A validação do certificado é a padrão do .NET e não é tocada. Sem cookies e sem descompressão automática: o que chega é gravado
    /// como veio, e é sobre esses bytes que o hash é calculado.
    /// </summary>
    private readonly HttpClient _http = new(new SocketsHttpHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.None, ConnectTimeout = ConnectTimeout, UseCookies = false }) { Timeout = ResponseTimeout };

    /// <summary>
    /// Os drivers que a conferência da partida aprovou: o nome do assembly gerenciado e de onde ele e a biblioteca nativa principal
    /// são carregados. É a única fonte dos dois ganchos de carga abaixo.
    /// </summary>
    private readonly ConcurrentDictionary<string, LoadableDriver> _loadable = new(StringComparer.Ordinal);

    public DriverPackageClient(DriverCatalog catalog, DriverSettings settings, ILogger logger)
    {
        _catalog = catalog;
        _settings = settings;
        _logger = logger.ForContext<DriverPackageClient>();

        // RN-DRIVER-001: a API não leva o driver, então o .NET não o acha ao lado dela; é por estes dois ganchos, os de resolução do
        // próprio .NET, que o assembly e a biblioteca nativa saem da pasta do driver instalado. Só respondem pelo que a partida aprovou.
        AssemblyLoadContext.Default.Resolving += ResolveAssembly;
        AssemblyLoadContext.Default.ResolvingUnmanagedDll += ResolveNativeLibrary;
    }

    public void Dispose()
    {
        AssemblyLoadContext.Default.Resolving -= ResolveAssembly;
        AssemblyLoadContext.Default.ResolvingUnmanagedDll -= ResolveNativeLibrary;
        _http.Dispose();
    }

    public bool CheckInstallation(string driverID)
    {
        if (Resolve(driverID) is not var (driver, package))
            return false;

        var probe = Send(nameof(CheckInstallation), driver, () => DriverStore.Probe(_settings.Directory, driver, package));
        if (probe.IsFailure)
            return false;

        if (probe.Value.Removed)
            _logger.Information("O driver {DriverID} {Version} foi removido, como pedido antes do reinício.", driver.ID, driver.Version);

        if (probe.Value.Refusal is { } refusal)
            _logger.Warning("O driver {DriverID} {Version} não passou na conferência da partida ({Reason}) e vale como não instalado.", driver.ID, driver.Version, refusal);

        if (!probe.Value.Installed)
            return false;

        // Aprovado: é desta pasta, e só dela, que esta execução carrega o driver. A carga em si acontece quando o primeiro tipo dele é usado.
        var installDirectory = Path.GetFullPath(DriverStore.InstallDirectory(_settings.Directory, driver));
        var nativeLibrary = package.NativeLibrary is null ? null : Path.Combine(installDirectory, DriverStore.Local(package.NativeLibrary));
        _loadable[Path.GetFileNameWithoutExtension(package.ManagedAssembly)] = new LoadableDriver(Path.Combine(installDirectory, DriverStore.Local(package.ManagedAssembly)), nativeLibrary);
        _logger.Information("O driver {DriverID} {Version} está instalado e passou na conferência da partida.", driver.ID, driver.Version);

        return true;
    }

    /// <summary>
    /// O gancho do assembly gerenciado. Chamado pelo .NET quando ele não acha um assembly ao lado da API; responde só pelo nome de um
    /// driver aprovado. Uma exceção daqui sairia no ponto da carga, fora de qualquer `Send`: por isso o arquivo que sumiu depois da
    /// conferência é "não sei" (nulo), e não uma tentativa de carregar.
    /// </summary>
    private Assembly? ResolveAssembly(AssemblyLoadContext context, AssemblyName name)
        => name.Name is { } simpleName && _loadable.TryGetValue(simpleName, out var driver) && File.Exists(driver.ManagedAssembly) ? context.LoadFromAssemblyPath(driver.ManagedAssembly) : null;

    /// <summary>
    /// O gancho da biblioteca nativa: o driver da IBM a pede só pelo nome no Linux e no macOS (no Windows ele mesmo a carrega, da pasta
    /// `clidriver` ao lado do próprio assembly). Só responde ao assembly de um driver aprovado, e só pelo nome da biblioteca do catálogo;
    /// o `SetDllImportResolver` do `IbmDatabaseConnection` roda antes, não acha nada ao lado da API, e a busca chega aqui. Sem a
    /// `libxml2` no sistema a carga falha, e quem diz isso é a mensagem do .NET no erro de conexão.
    /// </summary>
    private IntPtr ResolveNativeLibrary(Assembly assembly, string name)
        => assembly.GetName().Name is { } owner && _loadable.TryGetValue(owner, out var driver) && driver.NativeLibrary is not null && (name == Path.GetFileName(driver.NativeLibrary) || name == Path.GetFileNameWithoutExtension(driver.NativeLibrary)) && NativeLibrary.TryLoad(driver.NativeLibrary, out var library) ? library : IntPtr.Zero;

    public async Task<UnitResult<DriverInstallFailure>> InstallAsync(string driverID, DateTimeOffset acceptedAt, Action<long> onProgress, CancellationToken cancellationToken)
    {
        if (Resolve(driverID) is not var (driver, package))
            return new DriverInstallFailure(EDriverInstallFailure.DownloadFailed, "Este driver não pode ser baixado nesta plataforma.");

        string? temporaryDirectory = null;

        var installed = await Send(nameof(InstallAsync), driver, cancellationToken, async () =>
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(DownloadDeadline);

            // O arquivo baixado fica aberto, sem compartilhamento, do primeiro byte até o fim da extração: o que o hash conferiu é o que
            // o zip lê, e ninguém troca o conteúdo entre as duas coisas. Some ao fechar, com a instalação pronta ou não.
            await using var file = new FileStream(DriverStore.TemporaryPackagePath(_settings.Directory, driver), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, bufferSize: 81920, FileOptions.Asynchronous | FileOptions.DeleteOnClose);

            if (await DownloadAsync(driver, package, file, onProgress, deadline.Token) is { } notDownloaded)
                return notDownloaded;

            file.Position = 0;
            temporaryDirectory = DriverStore.CreateTemporaryDirectory(_settings.Directory, driver);

            if (DriverPackageExtractor.Extract(file, package, temporaryDirectory, deadline.Token) is { } notExtracted)
                return notExtracted;

            // O último ponto em que cancelar ainda desfaz tudo: daqui em diante a pasta ganha o nome da versão e o driver está instalado.
            deadline.Token.ThrowIfCancellationRequested();
            DriverStore.Commit(_settings.Directory, driver, package, temporaryDirectory, acceptedAt);

            return Result.Success<bool, DriverInstallFailure>(true);
        });

        if (installed.IsSuccess)
        {
            _logger.Information("O driver {DriverID} {Version} foi instalado; passa a valer no próximo reinício.", driver.ID, driver.Version);

            return UnitResult.Success<DriverInstallFailure>();
        }

        // RN-DRIVER-003: instalação interrompida não deixa nada com cara de instalado. Se esta limpeza falhar, a partida seguinte a refaz.
        if (temporaryDirectory is { } leftover)
            Send(nameof(InstallAsync), driver, () => DriverStore.Delete(leftover));

        if (installed.Error.Kind == EDriverInstallFailure.Canceled)
            _logger.Information("A instalação do driver {DriverID} {Version} foi cancelada.", driver.ID, driver.Version);
        else
            _logger.Warning("A instalação do driver {DriverID} {Version} não foi concluída ({Failure}): {Detail}", driver.ID, driver.Version, installed.Error.Kind, installed.Error.Detail);

        return installed.Error;
    }

    public UnitResult<EDriverFailure> MarkForRemoval(string driverID)
    {
        if (Resolve(driverID) is not var (driver, _))
            return EDriverFailure.NotInstalled;

        if (Send(nameof(MarkForRemoval), driver, () => DriverStore.MarkForRemoval(_settings.Directory, driver)).IsFailure)
            return EDriverFailure.StoreUnavailable;

        _logger.Information("A remoção do driver {DriverID} {Version} foi marcada; acontece no próximo reinício.", driver.ID, driver.Version);

        return UnitResult.Success<EDriverFailure>();
    }

    /// <summary>O driver e o pacote dele para esta plataforma, do catálogo; nulo para o que não se baixa aqui.</summary>
    private (DriverDefinition Driver, DriverPackage Package)? Resolve(string driverID)
        => _catalog.Find(driverID) is { Kind: EDriverKind.Downloadable } driver && driver.PackageFor(_settings.Platform) is { } package ? (driver, package) : null;

    /// <summary>
    /// Baixa o pacote para o arquivo, contando e somando o SHA-512 do que grava. O endereço é o contêiner plano do nuget.org mais o nome
    /// e a versão do catálogo, em minúsculas (é como o nuget.org os publica). O tamanho do catálogo é o teto: uma resposta que anuncia
    /// outro tamanho é recusada sem ler o corpo, e a leitura para no byte seguinte ao último esperado.
    /// </summary>
    private async Task<DriverInstallFailure?> DownloadAsync(DriverDefinition driver, DriverPackage package, FileStream file, Action<long> onProgress, CancellationToken cancellationToken)
    {
        var name = package.ID.ToLowerInvariant();
        var version = driver.Version!.ToLowerInvariant();

        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(_settings.PackageSource, $"{name}/{version}/{name}.{version}.nupkg"));
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

        var status = (int)response.StatusCode;
        if (status is >= 300 and < 400)
            return new DriverInstallFailure(EDriverInstallFailure.DownloadFailed, "O servidor redirecionou o download para outro endereço, e o Prism não segue redirecionamentos.");

        if (status != 200)
            return new DriverInstallFailure(EDriverInstallFailure.DownloadFailed, $"O nuget.org respondeu {status} ao pedido do pacote.");

        if (response.Content.Headers.ContentLength is { } announced && announced != package.SizeBytes)
            return new DriverInstallFailure(EDriverInstallFailure.IntegrityFailed, "O arquivo oferecido pelo servidor não tem o tamanho do pacote do catálogo. Nada foi instalado.");

        await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA512);
        var buffer = new byte[81920];
        var received = 0L;

        int read;
        while ((read = await body.ReadAsync(buffer, cancellationToken)) > 0)
        {
            received += read;
            if (received > package.SizeBytes)
                return new DriverInstallFailure(EDriverInstallFailure.IntegrityFailed, "O servidor enviou mais dados do que o pacote do catálogo tem. Nada foi instalado.");

            hash.AppendData(buffer, 0, read);
            await file.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            onProgress(received);
        }

        if (received < package.SizeBytes)
            return new DriverInstallFailure(EDriverInstallFailure.DownloadFailed, "O download terminou antes do fim do arquivo.");

        // RN-DRIVER-003: o SHA-512 é conferido antes de o arquivo ser aberto como zip.
        if (!hash.GetHashAndReset().AsSpan().SequenceEqual(Convert.FromBase64String(package.Sha512)))
            return new DriverInstallFailure(EDriverInstallFailure.IntegrityFailed, "O arquivo baixado não confere com o SHA-512 do catálogo. Nada foi instalado.");

        await file.FlushAsync(cancellationToken);

        return null;
    }

    /// <summary>
    /// O que cada exceção vira para a tela: uma frase do Prism, sem o texto da exceção (a de disco traz o caminho, com o nome do
    /// usuário da máquina). Numa rede que intercepta HTTPS o download falha aqui, com a causa dita (RN-DRIVER-008).
    /// </summary>
    private static DriverInstallFailure Classify(Exception exception)
        => exception switch
        {
            OperationCanceledException => Download("O download não terminou no prazo."),
            HttpRequestException { HttpRequestError: HttpRequestError.NameResolutionError } => Download("Não foi possível achar o endereço do nuget.org. Confira a conexão com a internet."),
            HttpRequestException { HttpRequestError: HttpRequestError.SecureConnectionError } => Download("A conexão segura com o nuget.org não foi aceita: o certificado apresentado não é válido neste computador. Numa rede que intercepta HTTPS o driver não é baixado."),
            HttpRequestException { HttpRequestError: HttpRequestError.ProxyTunnelError or HttpRequestError.UserAuthenticationError } => Download("O proxy da rede recusou a conexão com o nuget.org."),
            HttpRequestException { HttpRequestError: HttpRequestError.ConnectionError } => Download("Não foi possível conectar no nuget.org."),

            // A conexão que cai chega de dois jeitos, conforme o instante: antes de os cabeçalhos serem lidos, é a requisição que falha; depois, a leitura do corpo.
            HttpRequestException or HttpIOException or IOException { InnerException: SocketException } => Download("A conexão caiu durante o download."),
            InvalidDataException => new DriverInstallFailure(EDriverInstallFailure.IntegrityFailed, "O pacote baixado não pôde ser lido. Nada foi instalado."),
            IOException or UnauthorizedAccessException => Download("Não foi possível gravar o driver na pasta de dados do Prism (disco cheio ou sem permissão)."),
            _ => Download("A instalação falhou por um erro inesperado. O detalhe está no log do Prism.")
        };

    private static DriverInstallFailure Download(string detail)
        => new(EDriverInstallFailure.DownloadFailed, detail);

    /// <summary>Os arquivos de um driver aprovado, pelo caminho completo.</summary>
    private sealed record LoadableDriver(string ManagedAssembly, string? NativeLibrary);

    /// <summary>As operações só de disco passam pelo mesmo `Send`: a chamada síncrona já volta concluída, e não há o que esperar.</summary>
    private Result<T, DriverInstallFailure> Send<T>(string operation, DriverDefinition driver, Func<T> call)
        => Send(operation, driver, CancellationToken.None, () => Task.FromResult(Result.Success<T, DriverInstallFailure>(call()))).GetAwaiter().GetResult();

    private Result<bool, DriverInstallFailure> Send(string operation, DriverDefinition driver, Action call)
        => Send(operation, driver, () =>
        {
            call();

            return true;
        });

    /// <summary>
    /// O único `try` da integração: exceção nenhuma sai daqui. RN-LOG-001: o log recebe o driver, a versão, a operação e a classe do
    /// erro, e nunca a mensagem da exceção, cabeçalho ou corpo de resposta. O cancelamento pedido por quem chamou não é falha.
    /// </summary>
    private async Task<Result<T, DriverInstallFailure>> Send<T>(string operation, DriverDefinition driver, CancellationToken cancellationToken, Func<Task<Result<T, DriverInstallFailure>>> call)
    {
        try
        {
            return await call();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return new DriverInstallFailure(EDriverInstallFailure.Canceled, "A instalação foi cancelada.");
        }
        catch (Exception exception)
        {
            _logger.Error("O driver {DriverID} {Version} falhou em {Operation} ({ExceptionType}, causa {InnerExceptionType}, HResult {HResult}, erro HTTP {HttpError}).", driver.ID, driver.Version, operation, exception.GetType().Name, exception.InnerException?.GetType().Name, exception.HResult, (exception as HttpRequestException)?.HttpRequestError);

            return Classify(exception);
        }
    }
}
