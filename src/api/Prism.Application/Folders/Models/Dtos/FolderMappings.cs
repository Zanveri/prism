using Prism.Application.Common.Protections;
using Prism.Application.Folders.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Folders.Models.Dtos;

/// <summary>
/// O mapeamento por convenção copia tudo menos `Protections`, as que valem (RN-PROT-004), que dependem das pastas acima e chegam prontas de quem leu o
/// documento; do registro do cofre, também o somente leitura, que ele guarda nulo no padrão. O `FolderMappingsTests` fixa quais ficam sem origem.
/// </summary>
internal static class FolderMappings
{
    public static FolderDto ToDto(this Folder source, EffectiveProtections protections)
        => DomainDto.ToDto<Folder, FolderDto>(source) with { Protections = protections.ToDto() };

    /// <summary>A listagem não precisa do domínio: lê os registros do cofre direto, que têm os mesmos campos.</summary>
    public static FolderDto ToDto(this VaultFolderRecord source, EffectiveProtections protections)
        => DomainDto.ToDto<VaultFolderRecord, FolderDto>(source) with { ReadOnly = source.ReadOnly == true, Protections = protections.ToDto() };
}
