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
        var connection = Connection.Create(folderID, "  Produção   Sul ", EDatabaseEngine.Db2, "  db2.local ", 50000, " PRODUCAO ", " operador ", " senha com espaço ", "  Produção  ", " #A1b2C3 ", new ConnectionSafeguards(), CreatedAt);

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
        var connection = Connection.Create(null, "Fábrica", EDatabaseEngine.PostgreSql, "h", 5432, "d", "u", "p", null, null, new ConnectionSafeguards(), CreatedAt);

        //Assert
        Assert.Equal("Fábrica", connection.Name);
    }

    [Trait("Connection", "Create")]
    [Fact(DisplayName = "OK ambiente e cor só com espaços viram nulos")]
    public void Create_ShouldTurnBlankEnvironmentIntoNull()
    {
        //Act
        var connection = Connection.Create(null, "Produção", EDatabaseEngine.PostgreSql, "h", 5432, "d", "u", "p", "   ", "  ", new ConnectionSafeguards(), CreatedAt);

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
        var connection = Connection.Restore(id, null, "  Nome  ", EDatabaseEngine.Informix, " host ", 9089, "d", "u", "p", "Prod", "#000000", new ConnectionSafeguards(), CreatedAt, UpdatedAt);

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
        connection.Update(folderID, "  Novo   Nome ", EDatabaseEngine.Informix, " novo-host ", 9089, " novo_db ", " novo_usuario ", "nova-senha", " Homologação ", "#112233", new ConnectionSafeguards(), UpdatedAt);

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
        connection.Update(null, "Outro", EDatabaseEngine.Db2, "h", 1, "d", "u", null, null, null, new ConnectionSafeguards(), UpdatedAt);

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
        connection.Update(null, "Outro", EDatabaseEngine.Db2, "h", 1, "d", "u", null, null, null, new ConnectionSafeguards(), UpdatedAt);

        //Assert
        Assert.Null(connection.EnvironmentName);
        Assert.Null(connection.EnvironmentColor);
    }

    /// <summary>RN-CONN-016: a cópia leva todos os campos, a senha inclusive, na mesma pasta, com ID novo, o nome dado e as duas datas de agora.</summary>
    [Trait("Connection", "Duplicate")]
    [Fact(DisplayName = "OK copia todos os campos e a senha, com ID novo, o nome da cópia e as datas de agora")]
    public void Duplicate_ShouldCopyEveryField_WithANewIDNameAndDates()
    {
        //Arrange
        var folderID = Guid.CreateVersion7();
        var source = Connection.Restore(Guid.CreateVersion7(), folderID, "MES", EDatabaseEngine.Informix, "ifx.local", 9089, "mes", "informix", "segredo", "Produção", "#FF0000", new ConnectionSafeguards(), CreatedAt, UpdatedAt);
        var now = new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Utc);

        //Act
        var copy = source.Duplicate("MES (cópia)", now);

        //Assert
        Assert.NotEqual(Guid.Empty, copy.ID);
        Assert.NotEqual(source.ID, copy.ID);
        Assert.Equal(folderID, copy.FolderID);
        Assert.Equal("MES (cópia)", copy.Name);
        Assert.Equal(EDatabaseEngine.Informix, copy.Engine);
        Assert.Equal("ifx.local", copy.Host);
        Assert.Equal(9089, copy.Port);
        Assert.Equal("mes", copy.Database);
        Assert.Equal("informix", copy.UserName);
        Assert.Equal("segredo", copy.Password);
        Assert.Equal("Produção", copy.EnvironmentName);
        Assert.Equal("#FF0000", copy.EnvironmentColor);
        Assert.Equal(now, copy.CreatedAt);
        Assert.Equal(now, copy.UpdatedAt);
        Assert.Equal("MES", source.Name);
    }

    /// <summary>RN-PROT-001 e RN-VERIF-001: "Não" e a consulta em branco se guardam nulos, e a consulta é aparada.</summary>
    [Trait("Connection", "Create")]
    [Fact(DisplayName = "OK as proteções e a verificação são normalizadas na criação")]
    public void Create_ShouldNormalizeTheSafeguards()
    {
        //Act
        var none = Connection.Create(null, "a", EDatabaseEngine.PostgreSql, "h", 5432, "d", "u", "p", null, null, ConnectionSafeguards.From(" none ", false, null, null, "   "), CreatedAt);
        var set = Connection.Create(null, "b", EDatabaseEngine.PostgreSql, "h", 5432, "d", "u", "p", null, null, ConnectionSafeguards.From(" all ", true, false, 120, "  SELECT 1 \n"), CreatedAt);

        //Assert
        Assert.Equal(new ConnectionSafeguards(), none.Safeguards);
        Assert.Equal((null, false, true, 30, null), (none.ConfirmCommands, none.ReadOnly, none.VerificationEnabled, none.VerificationInterval, none.VerificationQuery));
        Assert.Equal(new ConnectionSafeguards("all", true, false, 120, "SELECT 1"), set.Safeguards);
    }

    /// <summary>O `PATCH` grava as proteções e a verificação por inteiro: o ausente volta ao padrão.</summary>
    [Trait("Connection", "Update")]
    [Fact(DisplayName = "OK alterar grava as proteções e a verificação, e o ausente volta ao padrão")]
    public void Update_ShouldWriteTheSafeguards()
    {
        //Arrange
        var connection = ConnectionFakers.Create(safeguards: new ConnectionSafeguards("all", true, false, 60, "SELECT 1"));

        //Act
        connection.Update(null, "a", EDatabaseEngine.PostgreSql, "h", 1, "d", "u", null, null, null, ConnectionSafeguards.From(null, false, null, null, null), UpdatedAt);

        //Assert
        Assert.Equal(new ConnectionSafeguards(), connection.Safeguards);
        Assert.Equal(UpdatedAt, connection.UpdatedAt);
    }

    /// <summary>RN-CONN-016 e RN-PROT-003: a cópia nasce com as proteções e a verificação da origem.</summary>
    [Trait("Connection", "Duplicate")]
    [Fact(DisplayName = "OK a cópia leva as proteções e a verificação da origem")]
    public void Duplicate_ShouldCopyTheSafeguards()
    {
        //Arrange
        var safeguards = new ConnectionSafeguards("irreversible", true, false, 90, "SELECT 1 FROM systables WHERE tabid = 1");
        var source = ConnectionFakers.Create(safeguards: safeguards);

        //Act
        var copy = source.Duplicate("cópia", UpdatedAt);

        //Assert
        Assert.Equal(safeguards, copy.Safeguards);
    }

    /// <summary>RN-LOG-001: a consulta de verificação não vai para o log por um `ToString()`.</summary>
    [Trait("Connection", "ConnectionSafeguards")]
    [Fact(DisplayName = "OK o ToString das proteções não imprime a consulta de verificação")]
    public void ConnectionSafeguards_ToString_ShouldNotPrintTheQuery()
        => Assert.Equal("ConnectionSafeguards", new ConnectionSafeguards(VerificationQuery: "SELECT marca_secreta").ToString());
}
