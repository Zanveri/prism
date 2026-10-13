using Prism.Application.Scripts.Domain;
using Prism.TestingCore.Fakers.Scripts;

namespace Prism.UnitTesting.Scripts;

/// <summary>
/// O domínio do script (RN-SCRIPT-001 e 003): o nome é gravado normalizado, o banco só existe com a conexão, e a alteração do `PATCH` muda só o que veio
/// (o ausente fica). O lugar (conexão e banco) é um par: mandar a conexão grava os dois, e o banco nulo é o banco da própria conexão.
/// </summary>
public sealed class ScriptTests
{
    private static readonly DateTime Now = new(2026, 10, 13, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Later = Now.AddMinutes(5);

    [Trait("Script", "Create")]
    [Fact(DisplayName = "OK cria com o nome normalizado, o SQL como veio e as datas do relógio")]
    public void Create_ShouldBeOK()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        const string sql = "  SELECT 1\n\tFROM dual  ";

        //Act
        var script = Script.Create("  Fechamento   do mês ", sql, connectionID, "vendas", Now);

        //Assert
        Assert.NotEqual(Guid.Empty, script.ID);
        Assert.Equal("Fechamento do mês", script.Name);
        Assert.Equal(sql, script.Sql);
        Assert.Equal(connectionID, script.ConnectionID);
        Assert.Equal("vendas", script.Database);
        Assert.Equal(Now, script.CreatedAt);
        Assert.Equal(Now, script.UpdatedAt);
    }

    [Trait("Script", "Create")]
    [Fact(DisplayName = "OK sem conexão, ou com o banco vazio, o banco fica nulo")]
    public void Create_WithoutConnectionOrWithAnEmptyDatabase_HasNoDatabase()
    {
        //Act
        var withoutConnection = Script.Create("a", "SELECT 1", null, "vendas", Now);
        var withEmptyDatabase = Script.Create("b", "SELECT 1", Guid.CreateVersion7(), "", Now);

        //Assert
        Assert.Null(withoutConnection.ConnectionID);
        Assert.Null(withoutConnection.Database);
        Assert.Null(withEmptyDatabase.Database);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK nada enviado não muda nada nem carimba a data")]
    public void Change_WithNothing_ReturnsFalse()
    {
        //Arrange
        var script = ScriptFakers.Create(name: "Relatório", sql: "SELECT 1", connectionID: Guid.CreateVersion7(), database: "vendas", createdAt: Now);

        //Act
        var changed = script.Change(null, null, null, null, Later);

        //Assert
        Assert.False(changed);
        Assert.Equal("Relatório", script.Name);
        Assert.Equal("vendas", script.Database);
        Assert.Equal(Now, script.UpdatedAt);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK os mesmos valores, com o nome por normalizar, não contam como mudança")]
    public void Change_WithTheSameValues_ReturnsFalse()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var script = ScriptFakers.Create(name: "Relatório mensal", sql: "SELECT 1", connectionID: connectionID, database: "vendas", createdAt: Now);

        //Act
        var changed = script.Change(" Relatório  mensal ", "SELECT 1", connectionID, "vendas", Later);

        //Assert
        Assert.False(changed);
        Assert.Equal(Now, script.UpdatedAt);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK renomear muda só o nome, e outras maiúsculas contam como mudança")]
    public void Change_Name_ChangesOnlyTheName()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var script = ScriptFakers.Create(name: "relatório", sql: "SELECT 1", connectionID: connectionID, database: "vendas", createdAt: Now);

        //Act
        var changed = script.Change("Relatório", null, null, null, Later);

        //Assert
        Assert.True(changed);
        Assert.Equal("Relatório", script.Name);
        Assert.Equal("SELECT 1", script.Sql);
        Assert.Equal(connectionID, script.ConnectionID);
        Assert.Equal("vendas", script.Database);
        Assert.Equal(Later, script.UpdatedAt);
        Assert.Equal(Now, script.CreatedAt);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK gravar por cima troca o SQL e o lugar, e o banco nulo com a conexão é o banco da conexão")]
    public void Change_SqlAndPlace_ChangesBoth()
    {
        //Arrange
        var script = ScriptFakers.Create(sql: "SELECT 1", connectionID: Guid.CreateVersion7(), database: "vendas", createdAt: Now);
        var otherConnection = Guid.CreateVersion7();

        //Act
        var changed = script.Change(null, "SELECT 2", otherConnection, null, Later);

        //Assert
        Assert.True(changed);
        Assert.Equal("SELECT 2", script.Sql);
        Assert.Equal(otherConnection, script.ConnectionID);
        Assert.Null(script.Database);
        Assert.Equal(Later, script.UpdatedAt);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK o banco sem a conexão não muda o lugar")]
    public void Change_DatabaseWithoutConnection_KeepsThePlace()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var script = ScriptFakers.Create(connectionID: connectionID, database: "vendas", createdAt: Now);

        //Act
        var changed = script.Change(null, null, null, "outro", Later);

        //Assert
        Assert.False(changed);
        Assert.Equal(connectionID, script.ConnectionID);
        Assert.Equal("vendas", script.Database);
    }
}
