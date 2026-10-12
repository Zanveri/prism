using CSharpFunctionalExtensions;
using Microsoft.Extensions.Time.Testing;
using Moq;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Clients;
using Prism.Infrastructure.Drivers.Models;
using Prism.Infrastructure.Drivers.Services;
using Prism.TestingCore.Extensions;
using Prism.TestingCore.Fakers.Drivers;

namespace Prism.UnitTesting.Drivers;

/// <summary>
/// O estado de cada driver nesta execução da API (seção 16 da especificação, "O que a lista garante"), com o client trocado: o que o
/// disco e a rede fazem está nos testes de integração. A instalação roda em segundo plano; os testes a seguram com uma
/// <see cref="TaskCompletionSource{TResult}"/> e esperam o estado mudar olhando a lista, nunca por um tempo chutado.
/// </summary>
public sealed class DriverServiceTests
{
    private const long PackageSize = 12345;

    private readonly Mock<IDriverPackageClient> _client = new();
    private readonly FakeTimeProvider _timeProvider = new(new DateTimeOffset(2026, 10, 10, 9, 0, 0, TimeSpan.Zero));
    private readonly TaskCompletionSource<UnitResult<DriverInstallFailure>> _download = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static readonly DriverInstallFailure Canceled = new(EDriverInstallFailure.Canceled, "A instalação foi cancelada.");

    private Action<long>? _onProgress;
    private CancellationToken _installToken;

    private DriverService CreateService(bool installed = false)
    {
        _client.Setup(c => c.CheckInstallation(DriverPackageFakers.DriverID)).Returns(installed);

        return new DriverService(DriverCatalog.Parse(DriverPackageFakers.CatalogJson(PackageSize)), new DriverSettings("pasta-que-o-servico-nao-toca", new Uri("https://servidor.exemplo.test/"), DriverPackageFakers.Platform), _client.Object, _timeProvider);
    }

    /// <summary>
    /// A instalação fica em andamento até o teste concluir `_download`; o progresso e o cancelamento ficam à mão do teste. Como o client
    /// de verdade, a de mentira para quando é cancelada: sem isso o descarte do serviço esperaria para sempre. O teste que quer outro
    /// fim para o cancelamento registra o dele depois (o último registro roda primeiro).
    /// </summary>
    private void SetupInstall()
        => _client.Setup(c => c.InstallAsync(DriverPackageFakers.DriverID, _timeProvider.GetUtcNow(), It.IsAny<Action<long>>(), It.IsAny<CancellationToken>()))
            .Callback((string _, DateTimeOffset _, Action<long> onProgress, CancellationToken cancellationToken) =>
            {
                cancellationToken.Register(() => _download.TrySetResult(Canceled));
                _installToken = cancellationToken;
                _onProgress = onProgress;
            })
            .Returns(_download.Task);

    private static DriverInfo TestDriver(DriverService service)
        => service.List().Single(driver => driver.ID == DriverPackageFakers.DriverID);

    /// <summary>Espera a instalação em segundo plano terminar: o estado deixa de ser `Installing`.</summary>
    private static async Task<DriverInfo> WaitUntilNotInstalling(DriverService service)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        while (TestDriver(service).State == EDriverState.Installing)
            await Task.Delay(10, timeout.Token);

        return TestDriver(service);
    }

    /// <summary>Espera o client receber a chamada, que acontece em outra thread depois de `Install` voltar.</summary>
    private async Task WaitUntilClientWasCalled()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        while (_onProgress is null)
            await Task.Delay(10, timeout.Token);
    }

    /// <summary>A conferência da partida roda uma vez, e só para o driver que tem pacote nesta plataforma.</summary>
    private void VerifyStartup()
        => _client.Verify(c => c.CheckInstallation(DriverPackageFakers.DriverID), Times.Once);

    [Trait("DriverService", "List")]
    [Fact(DisplayName = "OK a lista traz cada driver do catálogo, na ordem dele, no estado da plataforma")]
    public void List_ShouldBeOK()
    {
        //Arrange
        var service = CreateService();

        //Act
        var drivers = service.List();

        //Assert
        Assert.Equal([DriverPackageFakers.BundledDriverID, DriverPackageFakers.DriverID, DriverPackageFakers.UnavailableDriverID, DriverPackageFakers.ComingSoonDriverID], drivers.Select(driver => driver.ID));
        Assert.True(drivers[0].JsonEquals(new DriverInfo(DriverPackageFakers.BundledDriverID, "Embutido", "Fabricante A", [EDatabaseEngine.PostgreSql], EDriverState.Bundled, "1.0.0", null, new DriverLicense("Licença Livre", "https://licenca.exemplo.test/livre"), null, null, null, false)));
        Assert.True(drivers[1].JsonEquals(new DriverInfo(DriverPackageFakers.DriverID, DriverPackageFakers.DriverName, "Fabricante B", [EDatabaseEngine.Db2], EDriverState.Available, DriverPackageFakers.Version, PackageSize, new DriverLicense(DriverPackageFakers.LicenseName, DriverPackageFakers.LicenseUrl), DriverPackageFakers.PlatformNote, null, null, false)));
        Assert.True(drivers[2].JsonEquals(new DriverInfo(DriverPackageFakers.UnavailableDriverID, "Sem Plataforma", "Fabricante C", [EDatabaseEngine.Informix], EDriverState.Unavailable, "9.9.9", null, null, DriverPackageFakers.UnavailableNote, null, null, false)));
        Assert.True(drivers[3].JsonEquals(new DriverInfo(DriverPackageFakers.ComingSoonDriverID, "Em Breve", "Fabricante D", [], EDriverState.ComingSoon, null, null, null, null, null, null, false)));
        VerifyStartup();
        _client.VerifyNoOtherCalls();
    }

    /// <summary>RN-DRIVER-005: o driver que a partida achou instalado e íntegro é o que está em uso, e não pede reinício.</summary>
    [Trait("DriverService", "List")]
    [Fact(DisplayName = "OK o driver instalado antes da partida aparece instalado, sem reinício pendente")]
    public void List_ShouldBeInstalled_WhenStartupFoundTheDriver()
    {
        //Arrange
        var service = CreateService(installed: true);

        //Act
        var driver = TestDriver(service);

        //Assert
        Assert.Equal(EDriverState.Installed, driver.State);
        Assert.False(driver.RestartRequired);
        Assert.Null(driver.Progress);
        Assert.Null(driver.Error);
        VerifyStartup();
        _client.VerifyNoOtherCalls();
    }

    [Trait("DriverService", "Find")]
    [Fact(DisplayName = "OK um driver pelo identificador, no estado de agora; nulo para o que o catálogo não tem")]
    public void Find_ReturnsTheDriverOrNull()
    {
        //Arrange
        var service = CreateService(installed: true);

        //Act
        var found = service.Find(DriverPackageFakers.DriverID);
        var bundled = service.Find(DriverPackageFakers.BundledDriverID);
        var unknown = service.Find("nao-existe");

        //Assert
        Assert.True(found!.JsonEquals(TestDriver(service)));
        Assert.Equal(EDriverState.Installed, found?.State);
        Assert.Equal(EDriverState.Bundled, bundled?.State);
        Assert.Null(unknown);
    }

    /// <summary>O banco do driver embutido e o do driver que a partida aprovou não têm recusa: esta execução conecta neles.</summary>
    [Trait("DriverService", "RefusalFor")]
    [Fact(DisplayName = "OK sem recusa para o banco do driver embutido e para o do driver aprovado na partida")]
    public void RefusalFor_IsNull_WhenTheDriverIsBundledOrActive()
    {
        //Arrange
        var service = CreateService(installed: true);

        //Act
        var bundled = service.RefusalFor(EDatabaseEngine.PostgreSql);
        var active = service.RefusalFor(EDatabaseEngine.Db2);

        //Assert
        Assert.Null(bundled);
        Assert.Null(active);
    }

    /// <summary>RN-DRIVER-006: "traz no detalhe o nome do driver que falta e, como extensão do erro, `driverID`".</summary>
    [Trait("DriverService", "RefusalFor")]
    [Fact(DisplayName = "Erro banco de driver não instalado: DriverNotInstalled com o nome do driver e o identificador")]
    public void RefusalFor_IsDriverNotInstalled_WhenTheDriverIsNotInstalled()
    {
        //Arrange
        var service = CreateService();

        //Act
        var refusal = service.RefusalFor(EDatabaseEngine.Db2);

        //Assert
        Assert.Equal(EDatabaseFailure.DriverNotInstalled, refusal?.Kind);
        Assert.Equal(DriverPackageFakers.DriverID, refusal?.DriverID);
        Assert.Contains(DriverPackageFakers.DriverName, refusal?.Message);
    }

    /// <summary>RN-DRIVER-005: instalado nesta execução, o driver ainda não está em uso; a recusa é a mesma, e a mensagem diz que falta reiniciar.</summary>
    [Trait("DriverService", "RefusalFor")]
    [Fact(DisplayName = "Erro banco de driver instalado depois da partida: DriverNotInstalled dizendo que falta reiniciar")]
    public async Task RefusalFor_IsDriverNotInstalled_WhenTheDriverWasInstalledAfterStartup()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();
        var before = service.RefusalFor(EDatabaseEngine.Db2);
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        await WaitUntilClientWasCalled();
        _download.SetResult(UnitResult.Success<DriverInstallFailure>());
        await WaitUntilNotInstalling(service);

        //Act
        var refusal = service.RefusalFor(EDatabaseEngine.Db2);

        //Assert
        Assert.Equal(EDatabaseFailure.DriverNotInstalled, refusal?.Kind);
        Assert.Equal(DriverPackageFakers.DriverID, refusal?.DriverID);
        Assert.Contains(DriverPackageFakers.DriverName, refusal?.Message);
        Assert.Contains("reiniciar", refusal?.Message);
        Assert.NotEqual(before?.Message, refusal?.Message);
    }

    /// <summary>RN-DRIVER-007: "as sessões que já o usavam continuam até o reinício"; removido nesta execução, o driver continua valendo nela.</summary>
    [Trait("DriverService", "RefusalFor")]
    [Fact(DisplayName = "OK sem recusa para o banco do driver removido nesta execução, até o reinício")]
    public void RefusalFor_IsNull_WhenTheActiveDriverWasRemovedInThisRun()
    {
        //Arrange
        _client.Setup(c => c.MarkForRemoval(DriverPackageFakers.DriverID)).Returns(UnitResult.Success<EDriverFailure>());
        var service = CreateService(installed: true);
        service.Remove(DriverPackageFakers.DriverID);

        //Act
        var refusal = service.RefusalFor(EDatabaseEngine.Db2);

        //Assert
        Assert.Null(refusal);
    }

    /// <summary>RN-DRIVER-006: "em plataforma sem driver, a resposta é 422 `DATABASE_CONNECTION_FAILED` com a mensagem que diz isso".</summary>
    [Trait("DriverService", "RefusalFor")]
    [Fact(DisplayName = "Erro banco de driver sem pacote para a plataforma: ConnectionFailed com a nota do catálogo, sem identificador")]
    public void RefusalFor_IsConnectionFailed_WhenThePlatformHasNoPackage()
    {
        //Arrange
        var service = CreateService();

        //Act
        var refusal = service.RefusalFor(EDatabaseEngine.Informix);

        //Assert
        Assert.Equal(EDatabaseFailure.ConnectionFailed, refusal?.Kind);
        Assert.Equal(DriverPackageFakers.UnavailableNote, refusal?.Message);
        Assert.Null(refusal?.DriverID);
    }

    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "Erro driver que não está no catálogo")]
    public void Install_ShouldBeError_WhenDriverIsUnknown()
    {
        //Arrange
        var service = CreateService();

        //Act
        var result = service.Install("../drivers", acceptedLicense: true);

        //Assert
        Assert.Equal(EDriverFailure.NotFound, result.Error);
        VerifyStartup();
        _client.VerifyNoOtherCalls();
    }

    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "Erro driver sem pacote para a plataforma, ou de banco que o Prism ainda não conecta")]
    public void Install_ShouldBeError_WhenDriverIsUnavailableOrComingSoon()
    {
        //Arrange
        var service = CreateService();

        //Act
        var unavailable = service.Install(DriverPackageFakers.UnavailableDriverID, acceptedLicense: true);
        var comingSoon = service.Install(DriverPackageFakers.ComingSoonDriverID, acceptedLicense: true);

        //Assert
        Assert.Equal(EDriverFailure.Unavailable, unavailable.Error);
        Assert.Equal(EDriverFailure.Unavailable, comingSoon.Error);
        VerifyStartup();
        _client.VerifyNoOtherCalls();
    }

    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "Erro driver embutido ou já instalado, com ou sem o aceite")]
    public void Install_ShouldBeError_WhenDriverIsBundledOrInstalled()
    {
        //Arrange
        var service = CreateService(installed: true);

        //Act
        var bundled = service.Install(DriverPackageFakers.BundledDriverID, acceptedLicense: true);
        var installed = service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        var installedWithoutAcceptance = service.Install(DriverPackageFakers.DriverID, acceptedLicense: false);

        //Assert
        Assert.Equal(EDriverFailure.AlreadyInstalled, bundled.Error);
        Assert.Equal(EDriverFailure.AlreadyInstalled, installed.Error);
        Assert.Equal(EDriverFailure.AlreadyInstalled, installedWithoutAcceptance.Error);
        VerifyStartup();
        _client.VerifyNoOtherCalls();
    }

    /// <summary>RN-DRIVER-003: sem o aceite da licença nada é baixado.</summary>
    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "Erro sem o aceite da licença, e o client não é chamado")]
    public void Install_ShouldBeError_WhenLicenseWasNotAccepted()
    {
        //Arrange
        var service = CreateService();

        //Act
        var result = service.Install(DriverPackageFakers.DriverID, acceptedLicense: false);

        //Assert
        Assert.Equal(EDriverFailure.LicenseNotAccepted, result.Error);
        Assert.Equal(EDriverState.Available, TestDriver(service).State);
        VerifyStartup();
        _client.VerifyNoOtherCalls();
    }

    /// <summary>"Quando o POST …/install responde 202, a lista já mostra o driver como `installing`"; `progress` é nulo até o primeiro byte.</summary>
    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "OK a instalação começa e a lista já mostra o driver instalando, sem progresso")]
    public async Task Install_ShouldBeOK_AndListShowsInstallingAtOnce()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();

        //Act
        var result = service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        var driver = TestDriver(service);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(EDriverState.Installing, driver.State);
        Assert.Null(driver.Progress);
        Assert.Null(driver.Error);
        Assert.False(driver.RestartRequired);
    }

    /// <summary>RN-DRIVER-004: o total é o tamanho do catálogo; o recebido é o que o client informa.</summary>
    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "OK o progresso aparece a partir do primeiro byte, com o tamanho do catálogo como total")]
    public async Task Install_ReportsProgress()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        await WaitUntilClientWasCalled();

        //Act
        _onProgress!(4096);
        var driver = TestDriver(service);

        //Assert
        Assert.Equal(EDriverState.Installing, driver.State);
        Assert.Equal(new DriverProgress(4096, PackageSize), driver.Progress);
    }

    /// <summary>RN-DRIVER-004: uma instalação por driver de cada vez.</summary>
    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "Erro segunda instalação do mesmo driver com a primeira em andamento")]
    public async Task Install_ShouldBeError_WhenInstallIsInProgress()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);

        //Act
        var second = service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        var withoutAcceptance = service.Install(DriverPackageFakers.DriverID, acceptedLicense: false);

        //Assert
        Assert.Equal(EDriverFailure.InstallInProgress, second.Error);
        Assert.Equal(EDriverFailure.InstallInProgress, withoutAcceptance.Error);
        await WaitUntilClientWasCalled();
        _client.Verify(c => c.InstallAsync(DriverPackageFakers.DriverID, It.IsAny<DateTimeOffset>(), It.IsAny<Action<long>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>RN-DRIVER-005: instalado, o driver só vale depois do reinício; até lá `restartRequired` é verdadeiro.</summary>
    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "OK terminada a instalação, o driver aparece instalado com reinício pendente")]
    public async Task Install_WhenFinished_IsInstalledWithRestartRequired()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        await WaitUntilClientWasCalled();
        _onProgress!(PackageSize);

        //Act
        _download.SetResult(UnitResult.Success<DriverInstallFailure>());
        var driver = await WaitUntilNotInstalling(service);

        //Assert
        Assert.Equal(EDriverState.Installed, driver.State);
        Assert.True(driver.RestartRequired);
        Assert.Null(driver.Progress);
        Assert.Null(driver.Error);
        Assert.Equal(EDriverFailure.AlreadyInstalled, service.Install(DriverPackageFakers.DriverID, acceptedLicense: true).Error);
        VerifyStartup();
        _client.Verify(c => c.InstallAsync(DriverPackageFakers.DriverID, _timeProvider.GetUtcNow(), It.IsAny<Action<long>>(), It.IsAny<CancellationToken>()), Times.Once);
        _client.VerifyNoOtherCalls();
    }

    /// <summary>RN-DRIVER-004: a falha fica à vista, com o motivo, até uma nova tentativa.</summary>
    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "Erro a instalação que falha deixa o driver com falha e o motivo, sem reinício pendente")]
    public async Task Install_WhenItFails_IsFailedWithTheCause()
    {
        //Arrange
        var failure = new DriverInstallFailure(EDriverInstallFailure.IntegrityFailed, "O arquivo baixado não confere.");
        SetupInstall();
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        await WaitUntilClientWasCalled();
        _onProgress!(100);

        //Act
        _download.SetResult(failure);
        var driver = await WaitUntilNotInstalling(service);

        //Assert
        Assert.Equal(EDriverState.Failed, driver.State);
        Assert.Equal(failure, driver.Error);
        Assert.Null(driver.Progress);
        Assert.False(driver.RestartRequired);
    }

    /// <summary>"`failed` fica até uma nova tentativa, e o POST …/install é aceito a partir de `failed`."</summary>
    [Trait("DriverService", "Install")]
    [Fact(DisplayName = "OK nova tentativa a partir da falha volta a instalar, sem o erro anterior")]
    public async Task Install_AfterAFailure_StartsAgain()
    {
        //Arrange
        _client.Setup(c => c.InstallAsync(DriverPackageFakers.DriverID, It.IsAny<DateTimeOffset>(), It.IsAny<Action<long>>(), It.IsAny<CancellationToken>())).ReturnsAsync(new DriverInstallFailure(EDriverInstallFailure.DownloadFailed, "A conexão caiu durante o download."));
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        var failed = await WaitUntilNotInstalling(service);
        SetupInstall();

        //Act
        var retry = service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        var driver = TestDriver(service);

        //Assert
        Assert.Equal(EDriverState.Failed, failed.State);
        Assert.Equal(EDriverInstallFailure.DownloadFailed, failed.Error?.Kind);
        Assert.True(retry.IsSuccess);
        Assert.Equal(EDriverState.Installing, driver.State);
        Assert.Null(driver.Error);
    }

    [Trait("DriverService", "CancelInstallAsync")]
    [Fact(DisplayName = "Erro cancelar driver desconhecido ou sem instalação em andamento")]
    public async Task CancelInstall_ShouldBeError_WhenNothingIsInstalling()
    {
        //Arrange
        var service = CreateService();

        //Act
        var unknown = await service.CancelInstallAsync("nao-existe");
        var idle = await service.CancelInstallAsync(DriverPackageFakers.DriverID);
        var bundled = await service.CancelInstallAsync(DriverPackageFakers.BundledDriverID);

        //Assert
        Assert.Equal(EDriverFailure.NotFound, unknown.Error);
        Assert.Equal(EDriverFailure.NotInstalling, idle.Error);
        Assert.Equal(EDriverFailure.NotInstalling, bundled.Error);
        VerifyStartup();
        _client.VerifyNoOtherCalls();
    }

    /// <summary>"Cancelar a instalação devolve o driver a `available`, sem `error`."</summary>
    [Trait("DriverService", "CancelInstallAsync")]
    [Fact(DisplayName = "OK cancelar interrompe o download e devolve o driver a disponível, sem erro")]
    public async Task CancelInstall_ShouldBeOK()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        await WaitUntilClientWasCalled();
        _onProgress!(100);
        
        //Act
        var result = await service.CancelInstallAsync(DriverPackageFakers.DriverID);
        var driver = TestDriver(service);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(_installToken.IsCancellationRequested);
        Assert.Equal(EDriverState.Available, driver.State);
        Assert.Null(driver.Error);
        Assert.Null(driver.Progress);
        Assert.False(driver.RestartRequired);
    }

    /// <summary>O download caiu no mesmo instante do cancelamento: quem cancelou não fica com um erro na tela.</summary>
    [Trait("DriverService", "CancelInstallAsync")]
    [Fact(DisplayName = "OK cancelar uma instalação que falha ao parar também devolve disponível, sem erro")]
    public async Task CancelInstall_ShouldBeOK_WhenTheInstallFailsWhileStopping()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        await WaitUntilClientWasCalled();
        _installToken.Register(() => _download.TrySetResult(new DriverInstallFailure(EDriverInstallFailure.DownloadFailed, "A conexão caiu durante o download.")));

        //Act
        var result = await service.CancelInstallAsync(DriverPackageFakers.DriverID);
        var driver = TestDriver(service);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(EDriverState.Available, driver.State);
        Assert.Null(driver.Error);
    }

    /// <summary>
    /// A instalação passou do ponto sem volta antes de ver o cancelamento: o driver ficou instalado, e a resposta é a mesma de quem
    /// cancela depois do fim (a tela espera 409 `DRIVER_NOT_INSTALLING` e atualiza a lista).
    /// </summary>
    [Trait("DriverService", "CancelInstallAsync")]
    [Fact(DisplayName = "Erro cancelamento que chega depois de a instalação terminar")]
    public async Task CancelInstall_ShouldBeError_WhenTheInstallFinishedAnyway()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        await WaitUntilClientWasCalled();
        _installToken.Register(() => _download.TrySetResult(UnitResult.Success<DriverInstallFailure>()));

        //Act
        var result = await service.CancelInstallAsync(DriverPackageFakers.DriverID);
        var driver = TestDriver(service);

        //Assert
        Assert.Equal(EDriverFailure.NotInstalling, result.Error);
        Assert.Equal(EDriverState.Installed, driver.State);
        Assert.True(driver.RestartRequired);
    }

    [Trait("DriverService", "Remove")]
    [Fact(DisplayName = "Erro remover o que não está no catálogo ou não está instalado")]
    public void Remove_ShouldBeError_WhenDriverIsUnknownOrNotInstalled()
    {
        //Arrange
        var service = CreateService();

        //Act
        var unknown = service.Remove("nao-existe");
        var bundled = service.Remove(DriverPackageFakers.BundledDriverID);
        var available = service.Remove(DriverPackageFakers.DriverID);
        var unavailable = service.Remove(DriverPackageFakers.UnavailableDriverID);
        var comingSoon = service.Remove(DriverPackageFakers.ComingSoonDriverID);

        //Assert
        Assert.Equal(EDriverFailure.NotFound, unknown.Error);
        Assert.Equal(EDriverFailure.NotInstalled, bundled.Error);
        Assert.Equal(EDriverFailure.NotInstalled, available.Error);
        Assert.Equal(EDriverFailure.NotInstalled, unavailable.Error);
        Assert.Equal(EDriverFailure.NotInstalled, comingSoon.Error);
        VerifyStartup();
        _client.VerifyNoOtherCalls();
    }

    /// <summary>"Depois de removido, o driver aparece como `available` com `restartRequired` verdadeiro."</summary>
    [Trait("DriverService", "Remove")]
    [Fact(DisplayName = "OK remover marca a remoção, e o driver aparece disponível com reinício pendente")]
    public void Remove_ShouldBeOK()
    {
        //Arrange
        _client.Setup(c => c.MarkForRemoval(DriverPackageFakers.DriverID)).Returns(UnitResult.Success<EDriverFailure>());
        var service = CreateService(installed: true);

        //Act
        var result = service.Remove(DriverPackageFakers.DriverID);
        var driver = TestDriver(service);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(EDriverState.Available, driver.State);
        Assert.True(driver.RestartRequired);
        Assert.Null(driver.Error);
        VerifyStartup();
        _client.Verify(c => c.MarkForRemoval(DriverPackageFakers.DriverID), Times.Once);
        _client.VerifyNoOtherCalls();
    }

    /// <summary>
    /// A remoção só acontece no reinício: até lá a pasta do driver continua no disco (e carregada), então removê-lo de novo é
    /// `NotInstalled` e instalá-lo de novo é `AlreadyInstalled`. Depois do reinício ele volta a ser um driver disponível qualquer.
    /// </summary>
    [Trait("DriverService", "Remove")]
    [Fact(DisplayName = "Erro remover ou instalar de novo um driver já removido, antes do reinício")]
    public void Remove_ThenRemoveOrInstall_ShouldBeError_UntilRestart()
    {
        //Arrange
        _client.Setup(c => c.MarkForRemoval(DriverPackageFakers.DriverID)).Returns(UnitResult.Success<EDriverFailure>());
        var service = CreateService(installed: true);
        service.Remove(DriverPackageFakers.DriverID);

        //Act
        var removeAgain = service.Remove(DriverPackageFakers.DriverID);
        var installAgain = service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);

        //Assert
        Assert.Equal(EDriverFailure.NotInstalled, removeAgain.Error);
        Assert.Equal(EDriverFailure.AlreadyInstalled, installAgain.Error);
        _client.Verify(c => c.MarkForRemoval(DriverPackageFakers.DriverID), Times.Once);
        _client.Verify(c => c.InstallAsync(It.IsAny<string>(), It.IsAny<DateTimeOffset>(), It.IsAny<Action<long>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Trait("DriverService", "Remove")]
    [Fact(DisplayName = "Erro a marcação que o disco recusa deixa o driver instalado")]
    public void Remove_ShouldBeError_DriverPackageClient_MarkForRemoval()
    {
        //Arrange
        _client.Setup(c => c.MarkForRemoval(DriverPackageFakers.DriverID)).Returns(EDriverFailure.StoreUnavailable);
        var service = CreateService(installed: true);

        //Act
        var result = service.Remove(DriverPackageFakers.DriverID);
        var driver = TestDriver(service);

        //Assert
        Assert.Equal(EDriverFailure.StoreUnavailable, result.Error);
        Assert.Equal(EDriverState.Installed, driver.State);
        Assert.False(driver.RestartRequired);
    }

    [Trait("DriverService", "Remove")]
    [Fact(DisplayName = "Erro remover um driver que ainda está instalando")]
    public async Task Remove_ShouldBeError_WhenDriverIsInstalling()
    {
        //Arrange
        SetupInstall();
        await using var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);

        //Act
        var result = service.Remove(DriverPackageFakers.DriverID);

        //Assert
        Assert.Equal(EDriverFailure.NotInstalled, result.Error);
        _client.Verify(c => c.MarkForRemoval(It.IsAny<string>()), Times.Never);
    }

    /// <summary>O desligamento da API não deixa um download correndo solto: o descarte interrompe a instalação e espera ela parar.</summary>
    [Trait("DriverService", "DisposeAsync")]
    [Fact(DisplayName = "OK o descarte interrompe a instalação em andamento e espera ela parar")]
    public async Task DisposeAsync_CancelsTheRunningInstall()
    {
        //Arrange
        SetupInstall();
        var service = CreateService();
        service.Install(DriverPackageFakers.DriverID, acceptedLicense: true);
        await WaitUntilClientWasCalled();
        
        //Act
        await service.DisposeAsync();

        //Assert
        Assert.True(_installToken.IsCancellationRequested);
        Assert.True(_download.Task.IsCompleted);
        Assert.Equal(EDriverState.Available, TestDriver(service).State);
    }
}
