using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Clients;
using Prism.Infrastructure.Drivers.Models;

namespace Prism.Infrastructure.Drivers.Services;

internal sealed class DriverService : IDriverService, IAsyncDisposable
{
    private readonly DriverCatalog _catalog;
    private readonly DriverSettings _settings;
    private readonly IDriverPackageClient _client;
    private readonly TimeProvider _timeProvider;

    /// <summary>Toda leitura e toda mudança de estado de um driver passam por esta trava; o download, não: ele roda fora dela.</summary>
    private readonly Lock _gate = new();

    /// <summary>Só os drivers que se baixam nesta plataforma têm estado: os outros são o que o catálogo diz.</summary>
    private readonly Dictionary<string, Installation> _installations = new(StringComparer.Ordinal);

    /// <summary>
    /// RN-DRIVER-005: é aqui, uma vez por execução da API, que se decide o que está instalado. O que a conferência da partida aprovou é o
    /// que esta execução usa (`Active`); o que for instalado depois só vale no reinício.
    /// </summary>
    public DriverService(DriverCatalog catalog, DriverSettings settings, IDriverPackageClient client, TimeProvider timeProvider)
    {
        _catalog = catalog;
        _settings = settings;
        _client = client;
        _timeProvider = timeProvider;

        foreach (var driver in catalog.Drivers.Where(driver => driver.PackageFor(settings.Platform) is not null))
        {
            var active = client.CheckInstallation(driver.ID);
            _installations[driver.ID] = new Installation { Active = active, Installed = active };
        }
    }

    public IReadOnlyList<DriverInfo> List()
    {
        lock (_gate)
            return [.. _catalog.Drivers.Select(Describe)];
    }

    public DriverInfo? Find(string driverID)
    {
        if (_catalog.Find(driverID) is not { } driver)
            return null;

        lock (_gate)
            return Describe(driver);
    }

    public DatabaseFailure? RefusalFor(EDatabaseEngine engine)
    {
        // O banco de um driver embutido (ou que nenhum driver baixável atende) não tem o que recusar aqui.
        if (_catalog.Drivers.FirstOrDefault(candidate => candidate.Kind == EDriverKind.Downloadable && (candidate.Engines ?? []).Contains(engine)) is not { } driver)
            return null;

        // RN-DRIVER-006: em plataforma sem driver, a resposta é a falha de conexão que diz isso.
        if (!_installations.TryGetValue(driver.ID, out var installation))
            return new DatabaseFailure(EDatabaseFailure.ConnectionFailed, driver.UnavailableNote!);

        // Quem decide é o que a partida aprovou, e não o que está no disco agora: o instalado depois dela ainda não foi carregado
        // (RN-DRIVER-005), e o removido depois dela continua carregado e em uso até o reinício (RN-DRIVER-007).
        if (installation.Active)
            return null;

        bool installedAfterStartup;
        lock (_gate)
            installedAfterStartup = installation.Installed;

        return new DatabaseFailure(EDatabaseFailure.DriverNotInstalled, installedAfterStartup ? $"O driver {driver.Name} foi instalado e só passa a valer quando o Prism reiniciar." : $"O driver {driver.Name} não está instalado. Instale-o na tela de Drivers: ele passa a valer quando o Prism reiniciar.", DriverID: driver.ID);
    }

    public UnitResult<EDriverFailure> Install(string driverID, bool acceptedLicense)
    {
        if (_catalog.Find(driverID) is not { } driver)
            return EDriverFailure.NotFound;

        if (driver.Kind == EDriverKind.Bundled)
            return EDriverFailure.AlreadyInstalled;

        if (!_installations.TryGetValue(driverID, out var installation))
            return EDriverFailure.Unavailable;

        lock (_gate)
        {
            if (installation.Running is not null)
                return EDriverFailure.InstallInProgress;

            // Também o driver removido à espera do reinício: a pasta dele continua no disco, e carregada, até lá.
            if (installation.Installed)
                return EDriverFailure.AlreadyInstalled;

            // RN-DRIVER-003: sem o aceite nada começa.
            if (!acceptedLicense)
                return EDriverFailure.LicenseNotAccepted;

            // O estado muda aqui, antes de a requisição responder: a lista consultada logo depois do 202 já mostra `Installing`.
            var cancellation = new CancellationTokenSource();
            installation.Error = null;
            installation.ReceivedBytes = 0;
            installation.Running = new RunningInstall(cancellation, Task.Run(() => RunAsync(driverID, installation, cancellation.Token)));
        }

        return UnitResult.Success<EDriverFailure>();
    }

    public async Task<UnitResult<EDriverFailure>> CancelInstallAsync(string driverID)
    {
        if (_catalog.Find(driverID) is null)
            return EDriverFailure.NotFound;

        if (!_installations.TryGetValue(driverID, out var installation))
            return EDriverFailure.NotInstalling;

        RunningInstall? running;
        lock (_gate)
            running = installation.Running;

        if (running is null)
            return EDriverFailure.NotInstalling;

        // Fora da trava: quem observa o cancelamento pode terminar nesta mesma thread, e o fim da instalação toma a trava.
        await running.Cancellation.CancelAsync();
        await running.Task;

        lock (_gate)
        {
            // A instalação passou do ponto sem volta antes de ver o cancelamento: o driver ficou instalado.
            if (installation.Installed)
                return EDriverFailure.NotInstalling;

            // Quem cancelou não fica com um erro na tela, mesmo que o download tenha caído ao parar.
            installation.Error = null;
        }

        return UnitResult.Success<EDriverFailure>();
    }

    public UnitResult<EDriverFailure> Remove(string driverID)
    {
        if (_catalog.Find(driverID) is null)
            return EDriverFailure.NotFound;

        if (!_installations.TryGetValue(driverID, out var installation))
            return EDriverFailure.NotInstalled;

        lock (_gate)
        {
            if (!installation.Installed || installation.RemovalPending)
                return EDriverFailure.NotInstalled;

            var marked = _client.MarkForRemoval(driverID);
            if (marked.IsFailure)
                return marked.Error;

            installation.RemovalPending = true;
        }

        return UnitResult.Success<EDriverFailure>();
    }

    /// <summary>O desligamento da API interrompe a instalação em andamento e espera ela parar; a sobra, se houver, a partida seguinte apaga.</summary>
    public async ValueTask DisposeAsync()
    {
        RunningInstall[] running;
        lock (_gate)
            running = [.. _installations.Values.Select(installation => installation.Running).OfType<RunningInstall>()];

        foreach (var install in running)
            await install.Cancellation.CancelAsync();

        await Task.WhenAll(running.Select(install => install.Task));
    }

    /// <summary>A instalação em segundo plano. O client não lança: o que ele devolve é o fim da instalação.</summary>
    private async Task RunAsync(string driverID, Installation installation, CancellationToken cancellationToken)
    {
        var result = await _client.InstallAsync(driverID, _timeProvider.GetUtcNow(), received => Volatile.Write(ref installation.ReceivedBytes, received), cancellationToken);

        lock (_gate)
        {
            // A fonte de cancelamento não é descartada: um cancelamento pode estar a caminho com ela na mão, e sem temporizador ela não segura nada.
            installation.Running = null;
            installation.Installed = result.IsSuccess;

            // RN-DRIVER-004: a falha fica à vista até uma nova tentativa. O cancelamento não é falha.
            if (result.IsFailure && result.Error.Kind != EDriverInstallFailure.Canceled)
                installation.Error = result.Error;
        }
    }

    /// <summary>O item da lista (seção 16 da especificação). Chamado com a trava tomada.</summary>
    private DriverInfo Describe(DriverDefinition driver)
    {
        var engines = driver.Engines ?? [];

        if (driver.Kind != EDriverKind.Downloadable)
            return new DriverInfo(driver.ID, driver.Name, driver.Vendor, engines, driver.Kind == EDriverKind.Bundled ? EDriverState.Bundled : EDriverState.ComingSoon, driver.Version, null, driver.License, null, null, null, false);

        if (driver.PackageFor(_settings.Platform) is not { } package)
            return new DriverInfo(driver.ID, driver.Name, driver.Vendor, engines, EDriverState.Unavailable, driver.Version, null, null, driver.UnavailableNote, null, null, false);

        var installation = _installations[driver.ID];
        var received = Volatile.Read(ref installation.ReceivedBytes);

        var state = installation switch
        {
            { Running: not null } => EDriverState.Installing,
            { Error: not null } => EDriverState.Failed,
            { Installed: true, RemovalPending: false } => EDriverState.Installed,
            _ => EDriverState.Available
        };

        // `progress` é nulo até o primeiro byte chegar, e o total é sempre o tamanho do catálogo.
        var progress = state == EDriverState.Installing && received > 0 ? new DriverProgress(received, package.SizeBytes) : null;

        // RN-DRIVER-005 e 007: instalado nesta execução (ainda não está em uso) ou removido nela (ainda está).
        var restartRequired = installation.RemovalPending || (installation.Installed && !installation.Active);

        return new DriverInfo(driver.ID, driver.Name, driver.Vendor, engines, state, driver.Version, package.SizeBytes, package.License, package.Note, progress, state == EDriverState.Failed ? installation.Error : null, restartRequired);
    }

    /// <summary>O que um driver baixável está fazendo nesta execução da API.</summary>
    private sealed class Installation
    {
        public long ReceivedBytes;

        /// <summary>A conferência da partida o aprovou: é o que esta execução carrega e usa.</summary>
        public bool Active { get; init; }

        /// <summary>A pasta da versão existe no disco, completa.</summary>
        public bool Installed { get; set; }

        public bool RemovalPending { get; set; }

        public DriverInstallFailure? Error { get; set; }

        public RunningInstall? Running { get; set; }
    }

    private sealed record RunningInstall(CancellationTokenSource Cancellation, Task Task);
}
