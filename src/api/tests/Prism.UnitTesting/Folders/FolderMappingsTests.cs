using Prism.Application.Common.Protections;
using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Models.Dtos;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.UnitTesting.Folders;

/// <summary>O mapeamento é por convenção de nome: um campo renomeado de um lado só deixaria o DTO sem valor, sem erro nenhum. Estes testes são a guarda que o `DomainDto` pede.</summary>
public sealed class FolderMappingsTests
{
    private static readonly EffectiveProtections NoProtections = new(false, null, null, null);

    /// <summary>
    /// `Protections`, as que valem (RN-PROT-004), dependem das pastas acima e chegam prontas; do registro do cofre, também o somente leitura, que ele
    /// guarda nulo no padrão. O mapeamento preenche as duas à mão.
    /// </summary>
    [Trait("FolderMappings", "ToDto")]
    [Fact(DisplayName = "OK todo campo do DTO tem origem no domínio menos Protections, e no registro do cofre menos ReadOnly e Protections")]
    public void FolderDto_ShouldHaveOnlyTheDerivedPropertiesUnmapped()
    {
        //Act
        var fromDomain = DomainDto.GetUnmappedProperties<Folder, FolderDto>();
        var fromRecord = DomainDto.GetUnmappedProperties<VaultFolderRecord, FolderDto>();

        //Assert
        Assert.Equal(["Protections"], fromDomain);
        Assert.Equal(["Protections", "ReadOnly"], fromRecord.Order());
    }

    [Trait("FolderMappings", "ToDto")]
    [Fact(DisplayName = "OK copia os campos da pasta, o ambiente, a cor e as proteções inclusive, e as que valem")]
    public void ToDto_ShouldCopyEveryField()
    {
        //Arrange
        var folder = Folder.Restore(Guid.CreateVersion7(), Guid.CreateVersion7(), "Produção", "Produção", "#FF8A7A", "#7DB2FF", "irreversible", true, new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc));
        var aboveID = Guid.CreateVersion7();

        //Act
        var dto = folder.ToDto(new EffectiveProtections(true, null, "all", aboveID));

        //Assert
        Assert.Equal(new FolderDto { ID = folder.ID, ParentID = folder.ParentID, Name = folder.Name, EnvironmentName = "Produção", EnvironmentColor = "#FF8A7A", Color = "#7DB2FF", ConfirmCommands = "irreversible", ReadOnly = true, Protections = new ProtectionsDto { ReadOnly = true, ConfirmCommands = "all", ConfirmCommandsFolderID = aboveID }, CreatedAt = folder.CreatedAt, UpdatedAt = folder.UpdatedAt }, dto);
    }

    /// <summary>RN-PROT-001 e 002: o registro gravado antes das proteções (os dois campos nulos) é a pasta sem proteção; o marcado as leva ao DTO.</summary>
    [Trait("FolderMappings", "ToDto")]
    [Fact(DisplayName = "OK o registro do cofre leva as proteções ao DTO, e o registro sem elas é a pasta sem proteção")]
    public void ToDto_FromRecord_ShouldCopyTheProtections()
    {
        //Arrange
        var createdAt = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
        var with = new VaultFolderRecord(Guid.CreateVersion7(), null, "Produção", createdAt, createdAt, ConfirmCommands: "all", ReadOnly: true);
        var without = new VaultFolderRecord(Guid.CreateVersion7(), null, "Geral", createdAt, createdAt);

        //Act
        var withDto = with.ToDto(new EffectiveProtections(true, null, "all", null));
        var withoutDto = without.ToDto(NoProtections);

        //Assert
        Assert.Equal("all", withDto.ConfirmCommands);
        Assert.True(withDto.ReadOnly);
        Assert.Equal(new ProtectionsDto { ReadOnly = true, ConfirmCommands = "all" }, withDto.Protections);
        Assert.Null(withoutDto.ConfirmCommands);
        Assert.False(withoutDto.ReadOnly);
        Assert.Equal(new ProtectionsDto(), withoutDto.Protections);
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
        var withDto = with.ToDto(NoProtections);
        var withoutDto = without.ToDto(NoProtections);

        //Assert
        Assert.Equal("Produção", withDto.EnvironmentName);
        Assert.Equal("#FF8A7A", withDto.EnvironmentColor);
        Assert.Null(withoutDto.EnvironmentName);
        Assert.Null(withoutDto.EnvironmentColor);
    }

    /// <summary>RN-PASTA-007: a cor da pasta chega à tela pela listagem, que lê o registro do cofre direto; o registro sem cor (o de antes dela) a deixa nula.</summary>
    [Trait("FolderMappings", "ToDto")]
    [Fact(DisplayName = "OK o registro do cofre leva a cor da pasta ao DTO, e o registro sem cor a deixa nula")]
    public void ToDto_FromRecord_ShouldCopyTheColor()
    {
        //Arrange
        var createdAt = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
        var with = new VaultFolderRecord(Guid.CreateVersion7(), null, "Produção", createdAt, createdAt, Color: "#7DB2FF");
        var without = new VaultFolderRecord(Guid.CreateVersion7(), null, "Geral", createdAt, createdAt, "Produção", "#FF8A7A");

        //Act
        var withDto = with.ToDto(NoProtections);
        var withoutDto = without.ToDto(NoProtections);

        //Assert
        Assert.Equal("#7DB2FF", withDto.Color);
        Assert.Null(withDto.EnvironmentName);
        Assert.Null(withoutDto.Color);
        Assert.Equal("#FF8A7A", withoutDto.EnvironmentColor);
    }
}
