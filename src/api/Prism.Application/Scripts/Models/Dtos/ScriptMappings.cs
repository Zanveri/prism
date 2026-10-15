using Prism.Application.Scripts.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Scripts.Models.Dtos;

internal static class ScriptMappings
{
    public static ScriptSummaryDto ToSummaryDto(this Script source)
        => DomainDto.ToDto<Script, ScriptSummaryDto>(source);

    /// <summary>A lista e o item não precisam do domínio: leem os registros do cofre direto, que têm os mesmos campos.</summary>
    public static ScriptSummaryDto ToSummaryDto(this VaultScriptRecord source)
        => DomainDto.ToDto<VaultScriptRecord, ScriptSummaryDto>(source);

    public static ScriptDto ToDto(this VaultScriptRecord source)
        => DomainDto.ToDto<VaultScriptRecord, ScriptDto>(source);
}
