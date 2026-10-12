using Prism.Application.Drivers.Models;
using Prism.Infrastructure.Drivers.Models;
using System.Net;

namespace Prism.UnitTesting.Drivers;

/// <summary>Os códigos e os status são os da tabela de rotas da seção 16 da especificação.</summary>
public sealed class DriverErrorsTests
{
    private static void AssertError(EDriverFailure failure, HttpStatusCode status, string type)
    {
        var error = DriverErrors.From(failure);

        Assert.Equal(type, error.Type);
        Assert.Equal(status, error.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace(error.Detail));
    }

    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK toda recusa do gerenciador de drivers tem tradução")]
    public void From_EveryFailure_IsMapped()
    {
        //Act
        var errors = Enum.GetValues<EDriverFailure>().Select(DriverErrors.From).ToList();

        //Assert
        Assert.All(errors, error => Assert.False(string.IsNullOrWhiteSpace(error.Type)));
    }

    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK NotFound vira 404 DRIVER_NOT_FOUND")]
    public void From_NotFound_Is404DriverNotFound()
        => AssertError(EDriverFailure.NotFound, HttpStatusCode.NotFound, "DRIVER_NOT_FOUND");

    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK Unavailable vira 422 DRIVER_UNAVAILABLE")]
    public void From_Unavailable_Is422DriverUnavailable()
        => AssertError(EDriverFailure.Unavailable, HttpStatusCode.UnprocessableEntity, "DRIVER_UNAVAILABLE");

    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK AlreadyInstalled vira 409 DRIVER_ALREADY_INSTALLED")]
    public void From_AlreadyInstalled_Is409DriverAlreadyInstalled()
        => AssertError(EDriverFailure.AlreadyInstalled, HttpStatusCode.Conflict, "DRIVER_ALREADY_INSTALLED");

    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK InstallInProgress vira 409 DRIVER_INSTALL_IN_PROGRESS")]
    public void From_InstallInProgress_Is409DriverInstallInProgress()
        => AssertError(EDriverFailure.InstallInProgress, HttpStatusCode.Conflict, "DRIVER_INSTALL_IN_PROGRESS");

    /// <summary>RN-DRIVER-003.</summary>
    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK LicenseNotAccepted vira 422 DRIVER_LICENSE_NOT_ACCEPTED")]
    public void From_LicenseNotAccepted_Is422DriverLicenseNotAccepted()
        => AssertError(EDriverFailure.LicenseNotAccepted, HttpStatusCode.UnprocessableEntity, "DRIVER_LICENSE_NOT_ACCEPTED");

    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK NotInstalling vira 409 DRIVER_NOT_INSTALLING")]
    public void From_NotInstalling_Is409DriverNotInstalling()
        => AssertError(EDriverFailure.NotInstalling, HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLING");

    /// <summary>O 409 de remover o que não está instalado; o 422 de mesmo código (RN-DRIVER-006) é do registro de sessões.</summary>
    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK NotInstalled vira 409 DRIVER_NOT_INSTALLED")]
    public void From_NotInstalled_Is409DriverNotInstalled()
        => AssertError(EDriverFailure.NotInstalled, HttpStatusCode.Conflict, "DRIVER_NOT_INSTALLED");

    /// <summary>RN-DRIVER-007: quem decide é o handler, que pergunta ao registro de sessões.</summary>
    [Trait("DriverErrors", "InUse")]
    [Fact(DisplayName = "OK driver com sessão aberta vira 409 DRIVER_IN_USE")]
    public void InUse_Is409DriverInUse()
    {
        //Act
        var error = DriverErrors.InUse();

        //Assert
        Assert.Equal("DRIVER_IN_USE", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace(error.Detail));
    }

    /// <summary>A seção 16 não tem código para o disco que recusa a gravação: é o erro interno da seção 6.</summary>
    [Trait("DriverErrors", "From")]
    [Fact(DisplayName = "OK StoreUnavailable vira 500 INTERNAL_SERVER_ERROR")]
    public void From_StoreUnavailable_Is500InternalServerError()
        => AssertError(EDriverFailure.StoreUnavailable, HttpStatusCode.InternalServerError, "INTERNAL_SERVER_ERROR");
}
