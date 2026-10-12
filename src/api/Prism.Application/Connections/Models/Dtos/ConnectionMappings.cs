using Prism.Application.Connections.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Connections.Models.Dtos;

/// <summary>
/// O mapeamento por convenção copia tudo menos `HasPassword`, que não existe nem no domínio nem no registro: é derivado
/// da senha, que o DTO não leva (RN-CONN-001). O `ConnectionMappingsTests` fixa que essa é a única propriedade sem origem.
/// </summary>
internal static class ConnectionMappings
{
    public static ConnectionDto ToDto(this Connection source)
        => DomainDto.ToDto<Connection, ConnectionDto>(source) with { HasPassword = source.Password.Length > 0 };

    /// <summary>A listagem e o detalhe não precisam do domínio: leem os registros do cofre direto, que têm os mesmos campos.</summary>
    public static ConnectionDto ToDto(this VaultConnectionRecord source)
        => DomainDto.ToDto<VaultConnectionRecord, ConnectionDto>(source) with { HasPassword = source.Password.Length > 0 };
}
