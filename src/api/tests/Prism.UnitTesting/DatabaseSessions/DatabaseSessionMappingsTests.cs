using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Core.Mappers;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>O mapeamento da sessão é por convenção de nome: um campo renomeado de um lado só deixaria o DTO sem valor, sem erro nenhum. É a guarda que o `DomainDto` pede.</summary>
public sealed class DatabaseSessionMappingsTests
{
    [Trait("DatabaseSessionMappings", "ToDto")]
    [Fact(DisplayName = "OK nenhuma propriedade do DTO fica sem origem")]
    public void DatabaseSessionDto_ShouldHaveNoUnmappedProperty()
    {
        //Act
        var unmapped = DomainDto.GetUnmappedProperties<DatabaseSessionInfo, DatabaseSessionDto>();

        //Assert
        Assert.Empty(unmapped);
    }

    [Trait("DatabaseSessionMappings", "ToDto")]
    [Fact(DisplayName = "OK copia os campos da sessão")]
    public void ToDto_FromSessionInfo_ShouldCopyEveryField()
    {
        //Arrange
        var info = new DatabaseSessionInfo(Guid.CreateVersion7(), Guid.CreateVersion7(), EDatabaseEngine.Informix, "producao", "14.10.FC9");

        //Act
        var dto = info.ToDto();

        //Assert
        Assert.Equal(new DatabaseSessionDto { ID = info.ID, ConnectionID = info.ConnectionID, Engine = EDatabaseEngine.Informix, Database = "producao", ServerVersion = "14.10.FC9" }, dto);
    }

    /// <summary>RN-GRADE-011: a página diz como o filtro entrou, em texto; sem filtro, nulo.</summary>
    [Trait("DatabaseSessionMappings", "ToDto")]
    [Theory(DisplayName = "OK o filtro da página vai como merged, wrapped ou nulo")]
    [InlineData(EFilterApplied.Merged, "merged")]
    [InlineData(EFilterApplied.Wrapped, "wrapped")]
    [InlineData(null, null)]
    public void ToDto_FromQueryPage_ShouldWriteHowTheFilterWentIn(EFilterApplied? applied, string? text)
    {
        //Arrange
        var page = new QueryPage([new QueryColumn("id", "integer", "number")], [["1"]], false, 3, [], FilterApplied: applied);

        //Act
        var dto = page.ToDto();

        //Assert
        Assert.Equal(text, dto.FilterApplied);
    }
}
