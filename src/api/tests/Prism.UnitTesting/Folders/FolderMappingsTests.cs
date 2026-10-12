using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Models.Dtos;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.UnitTesting.Folders;

/// <summary>O mapeamento é por convenção de nome: um campo renomeado de um lado só deixaria o DTO sem valor, sem erro nenhum. Estes testes são a guarda que o `DomainDto` pede.</summary>
public sealed class FolderMappingsTests
{
    [Trait("FolderMappings", "ToDto")]
    [Fact(DisplayName = "OK todo campo do DTO tem origem no domínio e no registro do cofre")]
    public void FolderDto_ShouldHaveNoUnmappedProperty()
    {
        //Act
        var fromDomain = DomainDto.GetUnmappedProperties<Folder, FolderDto>();
        var fromRecord = DomainDto.GetUnmappedProperties<VaultFolderRecord, FolderDto>();

        //Assert
        Assert.Empty(fromDomain);
        Assert.Empty(fromRecord);
    }

    [Trait("FolderMappings", "ToDto")]
    [Fact(DisplayName = "OK copia os cinco campos da pasta")]
    public void ToDto_ShouldCopyEveryField()
    {
        //Arrange
        var folder = Folder.Restore(Guid.CreateVersion7(), Guid.CreateVersion7(), "Produção", new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc));

        //Act
        var dto = folder.ToDto();

        //Assert
        Assert.Equal(new FolderDto { ID = folder.ID, ParentID = folder.ParentID, Name = folder.Name, CreatedAt = folder.CreatedAt, UpdatedAt = folder.UpdatedAt }, dto);
    }
}
