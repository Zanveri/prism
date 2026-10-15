using Prism.Application.Common.Protections;
using Prism.Application.Connections.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Connections.Models.Dtos;

/// <summary>
/// O mapeamento por convenção copia tudo menos `HasPassword`, que não existe nem no domínio nem no registro (é derivado da senha, que o DTO não leva,
/// RN-CONN-001), e `Protections`, as que valem (RN-PROT-004), que dependem das pastas acima e chegam prontas de quem leu o documento. Do registro do
/// cofre, também o somente leitura e a verificação, que ele guarda nulos no padrão. O `ConnectionMappingsTests` fixa quais propriedades ficam sem origem.
/// </summary>
internal static class ConnectionMappings
{
    public static ConnectionDto ToDto(this Connection source, EffectiveProtections protections)
        => DomainDto.ToDto<Connection, ConnectionDto>(source) with { HasPassword = source.Password.Length > 0, Protections = protections.ToDto() };

    /// <summary>A listagem e o detalhe não precisam do domínio: leem os registros do cofre direto, que têm os mesmos campos.</summary>
    public static ConnectionDto ToDto(this VaultConnectionRecord source, EffectiveProtections protections)
        => DomainDto.ToDto<VaultConnectionRecord, ConnectionDto>(source) with
        {
            HasPassword = source.Password.Length > 0,
            ReadOnly = source.ReadOnly == true,
            VerificationEnabled = source.VerificationEnabled ?? true,
            VerificationInterval = source.VerificationInterval ?? ConnectionRules.VerificationIntervalDefault,
            Protections = protections.ToDto()
        };
}
