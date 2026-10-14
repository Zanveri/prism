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
    [Fact(DisplayName = "OK copia os sete campos da pasta, o ambiente inclusive")]
    public void ToDto_ShouldCopyEveryField()
    {
        //Arrange
        var folder = Folder.Restore(Guid.CreateVersion7(), Guid.CreateVersion7(), "Produção", "Produção", "#FF8A7A", new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc));

        //Act
        var dto = folder.ToDto();

        //Assert
        Assert.Equal(new FolderDto { ID = folder.ID, ParentID = folder.ParentID, Name = folder.Name, EnvironmentName = "Produção", EnvironmentColor = "#FF8A7A", CreatedAt = folder.CreatedAt, UpdatedAt = folder.UpdatedAt }, dto);
    }

    /// <summary>RN-PASTA-005: a listagem lê o registro do cofre direto, e o ambiente gravado chega à tela por ela.</summary>
    [Trait("FolderMappings", "ToDto")]
    [Fact(DisplayName = "OK o registro do cofre leva o ambiente ao DTO, e o registro sem ambiente o deixa nulo")]
    public void ToDto_FromRecord_ShouldCopyTheEnvironment()
    {
        //Arrange
        var createdAt = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
        var with = new VaultFolderRecord(Guid.CreateVersion7(), null, "Produção", createdAt, createdAt, "Produção", "#FF8A7A");
        var without = new VaultFolderRecord(Guid.CreateVersion7(), null, "Geral", createdAt, createdAt);

        //Act
        var withDto = with.ToDto();
        var withoutDto = without.ToDto();

        //Assert
        Assert.Equal("Produção", withDto.EnvironmentName);
        Assert.Equal("#FF8A7A", withDto.EnvironmentColor);
        Assert.Null(withoutDto.EnvironmentName);
        Assert.Null(withoutDto.EnvironmentColor);
    }
}
