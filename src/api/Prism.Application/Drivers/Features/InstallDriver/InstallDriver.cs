using CSharpFunctionalExtensions;
using Prism.Application.Drivers.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Core.Mediator;
using Prism.Infrastructure.Drivers.Services;
using System.Text.Json.Serialization;

namespace Prism.Application.Drivers.Features.InstallDriver;

/// <summary>
/// RN-DRIVER-003: instalar exige o aceite da licença do fabricante, que vem no corpo (`acceptedLicense`); ausente vale "não aceitou".
/// O driver vem da rota, e o `[JsonIgnore]` impede que o corpo o escolha. O corpo não leva mais nada: o pacote, a versão e o endereço
/// são os do catálogo da API (RN-DRIVER-008).
/// </summary>
public sealed record InstallDriverCommand : IRequest<UnitResult<ApiErrorDto>>
{
    [JsonIgnore]
    public string ID { get; init; } = string.Empty;

    public bool AcceptedLicense { get; init; }
}

internal sealed class InstallDriverHandler(IDriverService driverService) : IRequestHandler<InstallDriverCommand, UnitResult<ApiErrorDto>>
{
    /// <summary>Só começa a instalação: o download segue na API depois da resposta, e a lista mostra o andamento (RN-DRIVER-004).</summary>
    public Task<UnitResult<ApiErrorDto>> Handle(InstallDriverCommand request, CancellationToken cancellationToken)
        => Task.FromResult(driverService.Install(request.ID, request.AcceptedLicense).MapError(DriverErrors.From));
}
