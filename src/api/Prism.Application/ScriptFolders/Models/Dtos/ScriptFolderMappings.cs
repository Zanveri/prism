using Prism.Application.ScriptFolders.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.ScriptFolders.Models.Dtos;

internal static class ScriptFolderMappings
{
    public static ScriptFolderDto ToDto(this ScriptFolder source)
        => DomainDto.ToDto<ScriptFolder, ScriptFolderDto>(source);

    /// <summary>A listagem não precisa do domínio: lê os registros do cofre direto, que têm os mesmos campos.</summary>
    public static ScriptFolderDto ToDto(this VaultScriptFolderRecord source)
        => DomainDto.ToDto<VaultScriptFolderRecord, ScriptFolderDto>(source);
}
