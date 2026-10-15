using Prism.Application.Common.Protections;
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
    /// <summary>
    /// `HasPassword` (derivada da senha) e `Protections` (as que valem, RN-PROT-004, que dependem das pastas acima) nenhum dos dois lados tem, e o
    /// mapeamento as preenche à mão. Do registro do cofre, também o somente leitura e a verificação, que ele guarda nulos no padrão (RN-PROT-002,
    /// RN-VERIF-001), e que o mapeamento resolve.
    /// </summary>
    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK só HasPassword e Protections ficam sem origem automática no domínio, e no registro também os três que ele guarda nulos")]
    public void ConnectionDto_ShouldHaveOnlyTheDerivedPropertiesUnmapped()
    {
        //Act
        var fromDomain = DomainDto.GetUnmappedProperties<Connection, ConnectionDto>();
        var fromRecord = DomainDto.GetUnmappedProperties<VaultConnectionRecord, ConnectionDto>();

        //Assert
        Assert.Equal(["HasPassword", "Protections"], fromDomain.Order());
        Assert.Equal(["HasPassword", "Protections", "ReadOnly", "VerificationEnabled", "VerificationInterval"], fromRecord.Order());
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
        var safeguards = new ConnectionSafeguards("irreversible", ReadOnly: true, VerificationEnabled: false, VerificationInterval: 120, VerificationQuery: "SELECT 1 FROM SYSIBM.SYSDUMMY1");
        var connection = Connection.Restore(Guid.CreateVersion7(), Guid.CreateVersion7(), "Produção", EDatabaseEngine.Db2, "db2.local", 50000, "PROD", "operador", "segredo", "Produção", "#FF0000", safeguards, new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), new DateTime(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc));
        var folderID = Guid.CreateVersion7();
        var protections = new EffectiveProtections(true, null, "all", folderID);

        //Act
        var dto = connection.ToDto(protections);

        //Assert
        Assert.Equal(new ConnectionDto { ID = connection.ID, FolderID = connection.FolderID, Name = "Produção", Engine = EDatabaseEngine.Db2, Host = "db2.local", Port = 50000, Database = "PROD", UserName = "operador", HasPassword = true, EnvironmentName = "Produção", EnvironmentColor = "#FF0000", ConfirmCommands = "irreversible", ReadOnly = true, VerificationEnabled = false, VerificationInterval = 120, VerificationQuery = "SELECT 1 FROM SYSIBM.SYSDUMMY1", Protections = new ProtectionsDto { ReadOnly = true, ConfirmCommands = "all", ConfirmCommandsFolderID = folderID }, CreatedAt = connection.CreatedAt, UpdatedAt = connection.UpdatedAt }, dto);
    }

    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK copia os campos do registro do cofre e HasPassword vem da senha")]
    public void ToDto_FromRecord_ShouldCopyEveryField()
    {
        //Arrange
        var record = VaultFakers.CreateConnection(password: "segredo") with { ConfirmCommands = "all", ReadOnly = true, VerificationEnabled = false, VerificationInterval = 600, VerificationQuery = "SELECT 1" };

        //Act
        var dto = record.ToDto(new EffectiveProtections(true, null, "all", null));

        //Assert
        Assert.Equal(new ConnectionDto { ID = record.ID, FolderID = record.FolderID, Name = record.Name, Engine = record.Engine, Host = record.Host, Port = record.Port, Database = record.Database, UserName = record.UserName, HasPassword = true, EnvironmentName = record.EnvironmentName, EnvironmentColor = record.EnvironmentColor, ConfirmCommands = "all", ReadOnly = true, VerificationEnabled = false, VerificationInterval = 600, VerificationQuery = "SELECT 1", Protections = new ProtectionsDto { ReadOnly = true, ConfirmCommands = "all" }, CreatedAt = record.CreatedAt, UpdatedAt = record.UpdatedAt }, dto);
    }

    /// <summary>RN-PROT-001 e 002, RN-VERIF-001: a conexão gravada antes das proteções (os campos nulos) sai com o padrão de cada um.</summary>
    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK o registro sem proteções nem verificação sai com o padrão: sem confirmação, sem somente leitura, verificação ligada a cada 30 s")]
    public void ToDto_FromRecordWithoutTheNewFields_ShouldHaveTheDefaults()
    {
        //Arrange
        var record = VaultFakers.CreateConnection();

        //Act
        var dto = record.ToDto(new EffectiveProtections(false, null, null, null));

        //Assert
        Assert.Null(dto.ConfirmCommands);
        Assert.False(dto.ReadOnly);
        Assert.True(dto.VerificationEnabled);
        Assert.Equal(30, dto.VerificationInterval);
        Assert.Null(dto.VerificationQuery);
        Assert.Equal(new ProtectionsDto(), dto.Protections);
    }

    [Trait("ConnectionMappings", "ToDto")]
    [Fact(DisplayName = "OK senha vazia é HasPassword falso")]
    public void ToDto_WithEmptyPassword_ShouldNotHavePassword()
    {
        //Arrange
        var record = VaultFakers.CreateConnection(password: string.Empty);

        //Act
        var dto = record.ToDto(new EffectiveProtections(false, null, null, null));

        //Assert
        Assert.False(dto.HasPassword);
    }
}
