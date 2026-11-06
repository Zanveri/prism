using Prism.Application.Scripts.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Scripts.Models.Dtos;

internal static class ScriptMappings
{
    /// <summary>A resposta de criar e de alterar leva o `declaresVariables` como a lista, para a tela trocar o item da lista por ela.</summary>
    public static ScriptSummaryDto ToSummaryDto(this Script source)
        => DomainDto.ToDto<Script, ScriptSummaryDto>(source) with { DeclaresVariables = ScriptVariablesRules.DeclaresVariables(source.Sql) };

    /// <summary>A lista e o item não precisam do domínio: leem os registros do cofre direto, que têm os mesmos campos.</summary>
    public static ScriptSummaryDto ToSummaryDto(this VaultScriptRecord source)
        => DomainDto.ToDto<VaultScriptRecord, ScriptSummaryDto>(source) with { DeclaresVariables = ScriptVariablesRules.DeclaresVariables(source.Sql) };

    /// <summary>Os valores lembrados (RN-VAR-028) têm outro tipo no registro, e o `DomainDto` os pula: vão à mão.</summary>
    public static ScriptDto ToDto(this VaultScriptRecord source)
        => DomainDto.ToDto<VaultScriptRecord, ScriptDto>(source) with { RunValues = source.RunValues is { } runValues ? new ScriptRunValuesDto(runValues.Values, runValues.ConnectionID, runValues.Database, runValues.SavedAt) : null };
}
