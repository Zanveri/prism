using CSharpFunctionalExtensions;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Drivers.Models;

namespace Prism.Infrastructure.Drivers.Services;

/// <summary>
/// O gerenciador de drivers (seção 16 da especificação). É `Singleton`: guarda o que cada driver está fazendo nesta execução da API
/// (baixando, com falha, instalado à espera do reinício), e a instalação segue em segundo plano depois de a requisição responder.
/// </summary>
public interface IDriverService
{
    /// <summary>Todos os drivers do catálogo, na ordem dele, no estado em que estão agora.</summary>
    IReadOnlyList<DriverInfo> List();

    /// <summary>Um driver do catálogo, no estado em que está agora; nulo para o identificador que o catálogo não tem.</summary>
    DriverInfo? Find(string driverID);

    /// <summary>
    /// RN-DRIVER-006: por que esta execução da API não conecta num banco, ou nulo quando conecta (o driver vem embutido, ou a
    /// conferência da partida aprovou o que está instalado). `DriverNotInstalled`, com o nome do driver na mensagem e o identificador
    /// dele, quando o driver não está instalado ou foi instalado depois da partida e ainda espera o reinício (RN-DRIVER-005);
    /// `ConnectionFailed`, com a nota do catálogo, quando o fabricante não publica o driver para esta plataforma. O driver removido
    /// nesta execução continua valendo até o reinício (RN-DRIVER-007), e a resposta para ele é nula.
    /// </summary>
    DatabaseFailure? RefusalFor(EDatabaseEngine engine);

    /// <summary>
    /// Começa a instalação e volta: quando responde sucesso, <see cref="List"/> já mostra o driver como `Installing`. As recusas, na
    /// ordem em que são conferidas: `NotFound`; `Unavailable` (plataforma sem pacote, ou banco que o Prism ainda não conecta);
    /// `AlreadyInstalled` (embutido, instalado, ou removido à espera do reinício); `InstallInProgress`; `LicenseNotAccepted`.
    /// </summary>
    UnitResult<EDriverFailure> Install(string driverID, bool acceptedLicense);

    /// <summary>
    /// Cancela a instalação em andamento e só volta quando ela parou: o driver está de novo `Available`, sem erro. `NotInstalling`
    /// quando não há instalação em andamento, e também quando ela terminou antes de o cancelamento chegar (o driver ficou instalado).
    /// </summary>
    Task<UnitResult<EDriverFailure>> CancelInstallAsync(string driverID);

    /// <summary>
    /// RN-DRIVER-007: marca a remoção, que acontece no próximo reinício da API; até lá o driver aparece `Available` com
    /// `RestartRequired`, e o que já estava carregado segue em uso. `NotFound`; `NotInstalled` para o que não está instalado (o embutido
    /// inclusive) ou já foi removido. Quem chama confere antes se há sessão aberta de um banco que o driver atende.
    /// </summary>
    UnitResult<EDriverFailure> Remove(string driverID);
}
