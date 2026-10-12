using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Models.Dtos;
using Prism.Core.Mappers;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.TestingCore.Fakers.Vault;

namespace Prism.UnitTesting.Connections;

/// <summary>O mapeamento é por convenção de nome: um campo renomeado de um lado só deixaria o DTO sem valor, sem erro nenhum. Estes testes são a guarda que o `DomainDto` pede.</summary>
public sealed class ConnectionMappingsTests
{
    /// <summary>`HasPassword` é a única propriedade que nenhum dos dois lados tem: é derivada da senha, e o mapeamento a preenche à mão.</summary>
    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK só HasPassword fica sem origem automática")]
    public void ConnectionDto_ShouldHaveOnlyHasPasswordUnmapped()
    {
        //Act
        var fromDomain = DomainDto.GetUnmappedProperties<Connection, ConnectionDto>();
        var fromRecord = DomainDto.GetUnmappedProperties<VaultConnectionRecord, ConnectionDto>();

        //Assert
        Assert.Equal(["HasPassword"], fromDomain);
        Assert.Equal(["HasPassword"], fromRecord);
    }

    /// <summary>RN-CONN-001: nenhuma senha sai nas respostas de listagem ou detalhe.</summary>
    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK o DTO não tem propriedade de senha")]
    public void ConnectionDto_ShouldNotHaveAPasswordProperty()
    {
        //Act
        var names = typeof(ConnectionDto).GetProperties().Select(property => property.Name);

        //Assert
        Assert.DoesNotContain(names, name => name.Contains("Password", StringComparison.OrdinalIgnoreCase) && name != "HasPassword");
    }

    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK copia os campos do domínio e HasPassword vem da senha")]
    public void ToDto_FromDomain_ShouldCopyEveryField()
    {
        //Arrange
        var connection = Connection.Restore(Guid.CreateVersion7(), Guid.CreateVersion7(), "Produção", EDatabaseEngine.Db2, "db2.local", 50000, "PROD", "operador", "segredo", "Produção", "#FF0000", new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc));

        //Act
        var dto = connection.ToDto();

        //Assert
        Assert.Equal(new ConnectionDto { ID = connection.ID, FolderID = connection.FolderID, Name = "Produção", Engine = EDatabaseEngine.Db2, Host = "db2.local", Port = 50000, Database = "PROD", UserName = "operador", HasPassword = true, EnvironmentName = "Produção", EnvironmentColor = "#FF0000", CreatedAt = connection.CreatedAt, UpdatedAt = connection.UpdatedAt }, dto);
    }

    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK copia os campos do registro do cofre e HasPassword vem da senha")]
    public void ToDto_FromRecord_ShouldCopyEveryField()
    {
        //Arrange
        var record = VaultFakers.CreateConnection(password: "segredo");

        //Act
        var dto = record.ToDto();

        //Assert
        Assert.Equal(new ConnectionDto { ID = record.ID, FolderID = record.FolderID, Name = record.Name, Engine = record.Engine, Host = record.Host, Port = record.Port, Database = record.Database, UserName = record.UserName, HasPassword = true, EnvironmentName = record.EnvironmentName, EnvironmentColor = record.EnvironmentColor, CreatedAt = record.CreatedAt, UpdatedAt = record.UpdatedAt }, dto);
    }

    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK senha vazia é HasPassword falso")]
    public void ToDto_WithEmptyPassword_ShouldNotHavePassword()
    {
        //Arrange
        var record = VaultFakers.CreateConnection(password: string.Empty);

        //Act
        var dto = record.ToDto();

        //Assert
        Assert.False(dto.HasPassword);
    }
}
