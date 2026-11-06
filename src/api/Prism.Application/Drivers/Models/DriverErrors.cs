using Prism.Core.Extensions;
using System.Resources;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Drivers.Models;

namespace Prism.Application.Drivers.Models;

/// <summary>
/// A tradução das recusas do gerenciador de drivers para o erro da API, num lugar só. Os códigos e os status são os da tabela de rotas
/// da seção 16 da especificação. O `DRIVER_NOT_INSTALLED` daqui é o 409 de remover o que não está instalado; o 422 de mesmo código, de
/// abrir sessão sem o driver (RN-DRIVER-006), é do registro de sessões.
/// </summary>
internal static class DriverErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>DriverErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(DriverErrors));

    /// <summary>RN-DRIVER-007. Quem confere é o handler de remover, com o registro de sessões: o gerenciador de drivers não conhece as sessões.</summary>
    public static ApiErrorDto InUse()
        => ApiErrorDto.CreateConflict(Texts.Get("InUseTitle"), "DRIVER_IN_USE", Texts.Get("InUseDetail"));

    public static ApiErrorDto From(EDriverFailure failure)
        => failure switch
        {
            EDriverFailure.NotFound => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "DRIVER_NOT_FOUND", Texts.Get("NotFoundDetail")),
            EDriverFailure.Unavailable => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("UnavailableTitle"), "DRIVER_UNAVAILABLE", Texts.Get("UnavailableDetail")),
            EDriverFailure.AlreadyInstalled => ApiErrorDto.CreateConflict(Texts.Get("AlreadyInstalledTitle"), "DRIVER_ALREADY_INSTALLED", Texts.Get("AlreadyInstalledDetail")),

            // RN-DRIVER-004.
            EDriverFailure.InstallInProgress => ApiErrorDto.CreateConflict(Texts.Get("InstallInProgressTitle"), "DRIVER_INSTALL_IN_PROGRESS", Texts.Get("InstallInProgressDetail")),

            // RN-DRIVER-003.
            EDriverFailure.LicenseNotAccepted => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("LicenseNotAcceptedTitle"), "DRIVER_LICENSE_NOT_ACCEPTED", Texts.Get("LicenseNotAcceptedDetail")),
            EDriverFailure.NotInstalling => ApiErrorDto.CreateConflict(Texts.Get("NotInstallingTitle"), "DRIVER_NOT_INSTALLING", Texts.Get("NotInstallingDetail")),
            EDriverFailure.NotInstalled => ApiErrorDto.CreateConflict(Texts.Get("NotInstalledTitle"), "DRIVER_NOT_INSTALLED", Texts.Get("NotInstalledDetail")),

            // A seção 16 não tem código para o disco que recusa a gravação: sai o erro interno da seção 6, com a causa no log do client.
            EDriverFailure.StoreUnavailable => ApiErrorDto.CreateInternalServerError(Texts.Get("StoreUnavailable")),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
