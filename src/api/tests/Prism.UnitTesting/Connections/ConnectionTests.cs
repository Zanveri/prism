using Prism.Application.Connections.Domain;
using Prism.Infrastructure.Databases.Models;
using Prism.TestingCore.Fakers.Connections;

namespace Prism.UnitTesting.Connections;

public sealed class ConnectionTests
{
    private static readonly DateTime CreatedAt = new(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime UpdatedAt = new(2026, 10, 2, 9, 0, 0, DateTimeKind.Utc);

    [Trait("Connection", "Create")]
    [Fact(DisplayName = "OK normaliza o nome, apara host, banco e usuário e carimba as duas datas")]
    public void Create_ShouldNormalizeAndStamp()
    {
        //Arrange
        var folderID = Guid.CreateVersion7();

        //Act
        var connection = Connection.Create(folderID, "  Produção   Sul ", EDatabaseEngine.Db2, "  db2.local ", 50000, " PRODUCAO ", " operador ", " senha com espaço ", "  Produção  ", " #A1b2C3 ", CreatedAt);

        //Assert
        Assert.NotEqual(Guid.Empty, connection.ID);
        Assert.Equal(folderID, connection.FolderID);
        Assert.Equal("Produção Sul", connection.Name);
        Assert.Equal(EDatabaseEngine.Db2, connection.Engine);
        Assert.Equal("db2.local", connection.Host);
        Assert.Equal(50000, connection.Port);
        Assert.Equal("PRODUCAO", connection.Database);
        Assert.Equal("operador", connection.UserName);
        Assert.Equal(" senha com espaço ", connection.Password);
        Assert.Equal("Produção", connection.EnvironmentName);
        Assert.Equal("#A1b2C3", connection.EnvironmentColor);
        Assert.Equal(CreatedAt, connection.CreatedAt);
        Assert.Equal(CreatedAt, connection.UpdatedAt);
    }

    [Trait("Connection", "Create")]
    [Fact(DisplayName = "OK nome na forma decomposta é gravado na forma composta")]
    public void Create_ShouldStoreTheNameComposed()
    {
        //Act
        var connection = Connection.Create(null, "Fábrica", EDatabaseEngine.PostgreSql, "h", 5432, "d", "u", "p", null, null, CreatedAt);

        //Assert
        Assert.Equal("Fábrica", connection.Name);
    }

    [Trait("Connection", "Create")]
    [Fact(DisplayName = "OK ambiente e cor só com espaços viram nulos")]
    public void Create_ShouldTurnBlankEnvironmentIntoNull()
    {
        //Act
        var connection = Connection.Create(null, "Produção", EDatabaseEngine.PostgreSql, "h", 5432, "d", "u", "p", "   ", "  ", CreatedAt);

        //Assert
        Assert.Null(connection.FolderID);
        Assert.Null(connection.EnvironmentName);
        Assert.Null(connection.EnvironmentColor);
    }

    [Trait("Connection", "Restore")]
    [Fact(DisplayName = "OK devolve o que está gravado, sem normalizar nem carimbar")]
    public void Restore_ShouldKeepEveryField()
    {
        //Arrange
        var id = Guid.CreateVersion7();

        //Act
        var connection = Connection.Restore(id, null, "  Nome  ", EDatabaseEngine.Informix, " host ", 9089, "d", "u", "p", "Prod", "#000000", CreatedAt, UpdatedAt);

        //Assert
        Assert.Equal(id, connection.ID);
        Assert.Equal("  Nome  ", connection.Name);
        Assert.Equal(" host ", connection.Host);
        Assert.Equal(CreatedAt, connection.CreatedAt);
        Assert.Equal(UpdatedAt, connection.UpdatedAt);
    }

    [Trait("Connection", "Update")]
    [Fact(DisplayName = "OK troca os campos, mantém ID e criação e carimba a alteração")]
    public void Update_ShouldChangeTheFieldsAndStamp()
    {
        //Arrange
        var connection = ConnectionFakers.Create(createdAt: CreatedAt);
        var id = connection.ID;
        var folderID = Guid.CreateVersion7();

        //Act
        connection.Update(folderID, "  Novo   Nome ", EDatabaseEngine.Informix, " novo-host ", 9089, " novo_db ", " novo_usuario ", "nova-senha", " Homologação ", "#112233", UpdatedAt);

        //Assert
        Assert.Equal(id, connection.ID);
        Assert.Equal(CreatedAt, connection.CreatedAt);
        Assert.Equal(UpdatedAt, connection.UpdatedAt);
        Assert.Equal(folderID, connection.FolderID);
        Assert.Equal("Novo Nome", connection.Name);
        Assert.Equal(EDatabaseEngine.Informix, connection.Engine);
        Assert.Equal("novo-host", connection.Host);
        Assert.Equal(9089, connection.Port);
        Assert.Equal("novo_db", connection.Database);
        Assert.Equal("novo_usuario", connection.UserName);
        Assert.Equal("nova-senha", connection.Password);
        Assert.Equal("Homologação", connection.EnvironmentName);
        Assert.Equal("#112233", connection.EnvironmentColor);
    }

    /// <summary>RN-CONN-004: senha omitida mantém a gravada.</summary>
    [Trait("Connection", "Update")]
    [Fact(DisplayName = "OK senha nula mantém a senha gravada")]
    public void Update_WithNullPassword_ShouldKeepThePassword()
    {
        //Arrange
        var connection = ConnectionFakers.Create(password: "senha-gravada");

        //Act
        connection.Update(null, "Outro", EDatabaseEngine.Db2, "h", 1, "d", "u", null, null, null, UpdatedAt);

        //Assert
        Assert.Equal("senha-gravada", connection.Password);
    }

    [Trait("Connection", "Update")]
    [Fact(DisplayName = "OK ambiente que deixou de ser informado volta a nulo")]
    public void Update_ShouldClearTheEnvironment()
    {
        //Arrange
        var connection = ConnectionFakers.Create(environmentName: "Produção", environmentColor: "#FF0000");

        //Act
        connection.Update(null, "Outro", EDatabaseEngine.Db2, "h", 1, "d", "u", null, null, null, UpdatedAt);

        //Assert
        Assert.Null(connection.EnvironmentName);
        Assert.Null(connection.EnvironmentColor);
    }
}
