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
    /// <summary>RN-DRIVER-007. Quem confere é o handler de remover, com o registro de sessões: o gerenciador de drivers não conhece as sessões.</summary>
    public static ApiErrorDto InUse()
        => ApiErrorDto.CreateConflict("Driver em uso.", "DRIVER_IN_USE", "Há conexão aberta com um banco que este driver atende. Feche as conexões desse banco antes de remover o driver.");

    public static ApiErrorDto From(EDriverFailure failure)
        => failure switch
        {
            EDriverFailure.NotFound => ApiErrorDto.CreateNotFound("Driver não localizado.", "DRIVER_NOT_FOUND", "O catálogo do Prism não tem um driver com esse identificador."),
            EDriverFailure.Unavailable => ApiErrorDto.CreateUnprocessableEntity("Driver indisponível.", "DRIVER_UNAVAILABLE", "Este driver não pode ser instalado aqui: o fabricante não o publica para esta plataforma, ou o Prism ainda não conecta nesse banco."),
            EDriverFailure.AlreadyInstalled => ApiErrorDto.CreateConflict("Driver já instalado.", "DRIVER_ALREADY_INSTALLED", "O driver já está instalado. Se ele acabou de ser removido, a remoção só acontece quando o Prism reiniciar: reinicie e instale de novo."),

            // RN-DRIVER-004.
            EDriverFailure.InstallInProgress => ApiErrorDto.CreateConflict("Instalação em andamento.", "DRIVER_INSTALL_IN_PROGRESS", "Já há uma instalação deste driver em andamento."),

            // RN-DRIVER-003.
            EDriverFailure.LicenseNotAccepted => ApiErrorDto.CreateUnprocessableEntity("Licença não aceita.", "DRIVER_LICENSE_NOT_ACCEPTED", "Para instalar o driver é preciso aceitar a licença do fabricante."),
            EDriverFailure.NotInstalling => ApiErrorDto.CreateConflict("Não há instalação em andamento.", "DRIVER_NOT_INSTALLING", "Não há instalação deste driver em andamento: ela já terminou ou não começou."),
            EDriverFailure.NotInstalled => ApiErrorDto.CreateConflict("Driver não instalado.", "DRIVER_NOT_INSTALLED", "O driver não está instalado."),

            // A seção 16 não tem código para o disco que recusa a gravação: sai o erro interno da seção 6, com a causa no log do client.
            EDriverFailure.StoreUnavailable => ApiErrorDto.CreateInternalServerError("Não foi possível gravar na pasta de drivers. Tente de novo em instantes."),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
