using Prism.Application.Folders.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Folders.Models.Dtos;

internal static class FolderMappings
{
    public static FolderDto ToDto(this Folder source)
        => DomainDto.ToDto<Folder, FolderDto>(source);

    /// <summary>A listagem não precisa do domínio: lê os registros do cofre direto, que têm os mesmos campos.</summary>
    public static FolderDto ToDto(this VaultFolderRecord source)
        => DomainDto.ToDto<VaultFolderRecord, FolderDto>(source);
}
