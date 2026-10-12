using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Drivers.Features.CancelDriverInstall;
using Prism.Application.Drivers.Features.GetDrivers;
using Prism.Application.Drivers.Features.InstallDriver;
using Prism.Application.Drivers.Features.RemoveDriver;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using Prism.Infrastructure.Drivers.Models;
using Prism.Infrastructure.Drivers.Services;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.Drivers;

/// <summary>
/// Os handlers de `api/user/drivers` são de uma linha (chamam o gerenciador de drivers e traduzem a recusa), menos o de remover, que
/// antes pergunta ao registro de sessões (RN-DRIVER-007). Ficam juntos aqui, um bloco por handler.
/// </summary>
public sealed class DriverHandlersTests
{
    private const string DriverID = "driver-de-teste";

    private readonly Mock<IDriverService> _driverService = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetDriversHandler", "GetDriversCommand")]
    [Fact(DisplayName = "OK devolve a lista do gerenciador, na ordem dele, já no formato da tela")]
    public async Task GetDrivers_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        IReadOnlyList<DriverInfo> drivers =
        [
            new("embutido", "Embutido", "A", [EDatabaseEngine.PostgreSql], EDriverState.Bundled, "1.0.0", null, null, null, null, null, false),
            new(DriverID, "Driver de Teste", "B", [EDatabaseEngine.Db2], EDriverState.Installing, "1.2.3", 4096, new DriverLicense("Licença", "https://licenca.exemplo.test/texto"), null, new DriverProgress(10, 4096), null, false)
        ];
        _driverService.Setup(s => s.List()).Returns(drivers);
        var handler = new GetDriversHandler(_driverService.Object);

        //Act
        var result = await handler.Handle(new GetDriversCommand(), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(["embutido", DriverID], result.Value.Select(driver => driver.ID));
        Assert.Equal(["bundled", "installing"], result.Value.Select(driver => driver.State));
        Assert.Equal(new DriverProgress(10, 4096), result.Value[1].Progress);
        _driverService.Verify(s => s.List(), Times.Once);
        _driverService.VerifyNoOtherCalls();
    }

    [Trait("InstallDriverHandler", "InstallDriverCommand")]
    [Fact(DisplayName = "OK começa a instalação com o aceite que veio no corpo")]
    public async Task InstallDriver_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _driverService.Setup(s => s.Install(DriverID, true)).Returns(UnitResult.Success<EDriverFailure>());
        var handler = new InstallDriverHandler(_driverService.Object);

        //Act
        var result = await handler.Handle(new InstallDriverCommand { ID = DriverID, AcceptedLicense = true }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _driverService.Verify(s => s.Install(DriverID, true), Times.Once);
        _driverService.VerifyNoOtherCalls();
    }

    /// <summary>RN-DRIVER-003: o handler não decide o aceite; entrega o que veio, e a recusa é do gerenciador.</summary>
    [Trait("InstallDriverHandler", "InstallDriverCommand")]
    [Fact(DisplayName = "Erro sem o aceite da licença")]
    public async Task InstallDriver_ShouldBeError_DriverService_Install_LicenseNotAccepted()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _driverService.Setup(s => s.Install(DriverID, false)).Returns(EDriverFailure.LicenseNotAccepted);
        var handler = new InstallDriverHandler(_driverService.Object);

        //Act
        var result = await handler.Handle(new InstallDriverCommand { ID = DriverID }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DRIVER_LICENSE_NOT_ACCEPTED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        _driverService.Verify(s => s.Install(DriverID, false), Times.Once);
        _driverService.VerifyNoOtherCalls();
    }

    [Trait("InstallDriverHandler", "InstallDriverCommand")]
    [Fact(DisplayName = "Erro instalação em andamento")]
    public async Task InstallDriver_ShouldBeError_DriverService_Install_InstallInProgress()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _driverService.Setup(s => s.Install(DriverID, true)).Returns(EDriverFailure.InstallInProgress);
        var handler = new InstallDriverHandler(_driverService.Object);

        //Act
        var result = await handler.Handle(new InstallDriverCommand { ID = DriverID, AcceptedLicense = true }, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DRIVER_INSTALL_IN_PROGRESS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _driverService.Verify(s => s.Install(DriverID, true), Times.Once);
        _driverService.VerifyNoOtherCalls();
    }

    /// <summary>O driver é o da rota: um `id` no corpo não o escolhe, e o aceite ausente vale "não aceitou".</summary>
    [Trait("InstallDriverCommand", "JSON")]
    [Fact(DisplayName = "OK o corpo só leva o aceite: `id` é ignorado e o aceite ausente é falso")]
    public void InstallDriverCommand_Json_OnlyCarriesTheAcceptance()
    {
        //Act
        var withID = JsonSerializer.Deserialize<InstallDriverCommand>("""{ "id": "outro-driver", "acceptedLicense": true }""", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var empty = JsonSerializer.Deserialize<InstallDriverCommand>("{}", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        //Assert
        Assert.Equal(string.Empty, withID.ID);
        Assert.True(withID.AcceptedLicense);
        Assert.False(empty.AcceptedLicense);
    }

    [Trait("CancelDriverInstallHandler", "CancelDriverInstallCommand")]
    [Fact(DisplayName = "OK cancela a instalação em andamento")]
    public async Task CancelDriverInstall_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _driverService.Setup(s => s.CancelInstallAsync(DriverID)).ReturnsAsync(UnitResult.Success<EDriverFailure>());
        var handler = new CancelDriverInstallHandler(_driverService.Object);

        //Act
        var result = await handler.Handle(new CancelDriverInstallCommand(DriverID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _driverService.Verify(s => s.CancelInstallAsync(DriverID), Times.Once);
        _driverService.VerifyNoOtherCalls();
    }

    [Trait("CancelDriverInstallHandler", "CancelDriverInstallCommand")]
    [Fact(DisplayName = "Erro não há instalação em andamento")]
    public async Task CancelDriverInstall_ShouldBeError_DriverService_CancelInstallAsync()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _driverService.Setup(s => s.CancelInstallAsync(DriverID)).ReturnsAsync(EDriverFailure.NotInstalling);
        var handler = new CancelDriverInstallHandler(_driverService.Object);

        //Act
        var result = await handler.Handle(new CancelDriverInstallCommand(DriverID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DRIVER_NOT_INSTALLING", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _driverService.Verify(s => s.CancelInstallAsync(DriverID), Times.Once);
        _driverService.VerifyNoOtherCalls();
    }

    private static DriverInfo Driver(EDriverState state)
        => new(DriverID, "Driver de Teste", "B", [EDatabaseEngine.Db2, EDatabaseEngine.Informix], state, "1.2.3", 4096, new DriverLicense("Licença", "https://licenca.exemplo.test/texto"), null, null, null, false);

    [Trait("RemoveDriverHandler", "RemoveDriverCommand")]
    [Fact(DisplayName = "OK marca a remoção do driver instalado sem sessão aberta dos bancos dele")]
    public async Task RemoveDriver_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var driver = Driver(EDriverState.Installed);
        _driverService.Setup(s => s.Find(DriverID)).Returns(driver);
        _databaseSessionService.Setup(s => s.HasOpenSession(driver.Engines)).Returns(false);
        _driverService.Setup(s => s.Remove(DriverID)).Returns(UnitResult.Success<EDriverFailure>());
        var handler = new RemoveDriverHandler(_driverService.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new RemoveDriverCommand(DriverID), cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _driverService.Verify(s => s.Find(DriverID), Times.Once);
        _databaseSessionService.Verify(s => s.HasOpenSession(driver.Engines), Times.Once);
        _driverService.Verify(s => s.Remove(DriverID), Times.Once);
        _driverService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>RN-DRIVER-007: remover só é aceito sem sessão aberta de um banco que o driver atende.</summary>
    [Trait("RemoveDriverHandler", "RemoveDriverCommand")]
    [Fact(DisplayName = "Erro driver com sessão aberta de um banco que ele atende")]
    public async Task RemoveDriver_ShouldBeError_DatabaseSessionService_HasOpenSession()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var driver = Driver(EDriverState.Installed);
        _driverService.Setup(s => s.Find(DriverID)).Returns(driver);
        _databaseSessionService.Setup(s => s.HasOpenSession(driver.Engines)).Returns(true);
        var handler = new RemoveDriverHandler(_driverService.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new RemoveDriverCommand(DriverID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DRIVER_IN_USE", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _driverService.Verify(s => s.Find(DriverID), Times.Once);
        _databaseSessionService.Verify(s => s.HasOpenSession(driver.Engines), Times.Once);
        _driverService.Verify(s => s.Remove(It.IsAny<string>()), Times.Never);
        _driverService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    /// <summary>
    /// O que não está instalado não tem sessão para conferir, e a recusa é a do gerenciador: uma sessão do PostgreSQL não faz o driver
    /// embutido responder "em uso", e o driver removido à espera do reinício (que a lista mostra `Available`) responde "não instalado".
    /// </summary>
    [Trait("RemoveDriverHandler", "RemoveDriverCommand")]
    [Fact(DisplayName = "Erro driver que não está instalado, sem perguntar pelas sessões")]
    public async Task RemoveDriver_ShouldBeError_DriverService_Remove_WhenNotInstalled()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _driverService.Setup(s => s.Find(DriverID)).Returns(Driver(EDriverState.Bundled));
        _driverService.Setup(s => s.Remove(DriverID)).Returns(EDriverFailure.NotInstalled);
        var handler = new RemoveDriverHandler(_driverService.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new RemoveDriverCommand(DriverID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DRIVER_NOT_INSTALLED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _driverService.Verify(s => s.Find(DriverID), Times.Once);
        _driverService.Verify(s => s.Remove(DriverID), Times.Once);
        _driverService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }

    [Trait("RemoveDriverHandler", "RemoveDriverCommand")]
    [Fact(DisplayName = "Erro driver que o catálogo não tem")]
    public async Task RemoveDriver_ShouldBeError_DriverService_Remove_WhenNotFound()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        _driverService.Setup(s => s.Find(DriverID)).Returns((DriverInfo?)null);
        _driverService.Setup(s => s.Remove(DriverID)).Returns(EDriverFailure.NotFound);
        var handler = new RemoveDriverHandler(_driverService.Object, _databaseSessionService.Object);

        //Act
        var result = await handler.Handle(new RemoveDriverCommand(DriverID), cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("DRIVER_NOT_FOUND", result.Error.Type);
        Assert.Equal(HttpStatusCode.NotFound, result.Error.StatusCode);
        _driverService.Verify(s => s.Find(DriverID), Times.Once);
        _driverService.Verify(s => s.Remove(DriverID), Times.Once);
        _driverService.VerifyNoOtherCalls();
        _databaseSessionService.VerifyNoOtherCalls();
    }
}
