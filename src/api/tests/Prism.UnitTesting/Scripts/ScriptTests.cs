using Prism.Application.Scripts.Domain;
using Prism.TestingCore.Fakers.Scripts;

namespace Prism.UnitTesting.Scripts;

/// <summary>
/// O domínio do script (RN-SCRIPT-001 e 003): o nome é gravado normalizado, o banco só existe com a conexão, e a alteração do `PATCH` muda só o que veio
/// (o ausente fica). O lugar (conexão e banco) é um par: mandar a conexão grava os dois, e o banco nulo é o banco da própria conexão. O genérico apaga o
/// lugar (RN-SCRIPT-005). O ícone e a cor (RN-SCRIPT-006) nascem nulos e seguem o mesmo "nulo fica".
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
        var script = Script.Create("  Fechamento   do mês ", sql, connectionID, "vendas", null, Now);

        //Assert
        Assert.NotEqual(Guid.Empty, script.ID);
        Assert.Equal("Fechamento do mês", script.Name);
        Assert.Equal(sql, script.Sql);
        Assert.Equal(connectionID, script.ConnectionID);
        Assert.Equal("vendas", script.Database);
        Assert.Equal(Now, script.CreatedAt);
        Assert.Equal(Now, script.UpdatedAt);
        Assert.Null(script.Icon);
        Assert.Null(script.Color);
    }

    [Trait("Script", "Create")]
    [Fact(DisplayName = "OK sem conexão, ou com o banco vazio, o banco fica nulo")]
    public void Create_WithoutConnectionOrWithAnEmptyDatabase_HasNoDatabase()
    {
        //Act
        var withoutConnection = Script.Create("a", "SELECT 1", null, "vendas", null, Now);
        var withEmptyDatabase = Script.Create("b", "SELECT 1", Guid.CreateVersion7(), "", null, Now);

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
        var changed = script.Change(null, null, null, null, false, null, null, Later);

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
        var changed = script.Change(" Relatório  mensal ", "SELECT 1", connectionID, "vendas", false, null, null, Later);

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
        var changed = script.Change("Relatório", null, null, null, false, null, null, Later);

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
        var changed = script.Change(null, "SELECT 2", otherConnection, null, false, null, null, Later);

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
        var changed = script.Change(null, null, null, "outro", false, null, null, Later);

        //Assert
        Assert.False(changed);
        Assert.Equal(connectionID, script.ConnectionID);
        Assert.Equal("vendas", script.Database);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK o genérico apaga a conexão e o banco, e o SQL enviado junto é gravado")]
    public void Change_Generic_ClearsThePlace()
    {
        //Arrange
        var script = ScriptFakers.Create(sql: "SELECT 1", connectionID: Guid.CreateVersion7(), database: "vendas", createdAt: Now);

        //Act
        var changed = script.Change(null, "SELECT 2", null, null, true, null, null, Later);

        //Assert
        Assert.True(changed);
        Assert.Null(script.ConnectionID);
        Assert.Null(script.Database);
        Assert.Equal("SELECT 2", script.Sql);
        Assert.Equal(Later, script.UpdatedAt);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK o script que já é genérico, salvo genérico com o mesmo SQL, não muda nem carimba a data")]
    public void Change_GenericOnAGenericScript_ReturnsFalse()
    {
        //Arrange
        var script = ScriptFakers.Create(sql: "SELECT 1", createdAt: Now);

        //Act
        var changed = script.Change(null, "SELECT 1", null, null, true, null, null, Later);

        //Assert
        Assert.False(changed);
        Assert.Null(script.ConnectionID);
        Assert.Equal(Now, script.UpdatedAt);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK o genérico ganha da conexão enviada junto (o validator recusa os dois antes de chegar aqui)")]
    public void Change_GenericWithAConnection_StaysGeneric()
    {
        //Arrange
        var script = ScriptFakers.Create(connectionID: Guid.CreateVersion7(), database: "vendas", createdAt: Now);

        //Act
        var changed = script.Change(null, null, Guid.CreateVersion7(), "outro", true, null, null, Later);

        //Assert
        Assert.True(changed);
        Assert.Null(script.ConnectionID);
        Assert.Null(script.Database);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK vincular um script genérico grava a conexão e o banco")]
    public void Change_PlaceOnAGenericScript_BindsIt()
    {
        //Arrange
        var script = ScriptFakers.Create(sql: "SELECT 1", createdAt: Now);
        var connectionID = Guid.CreateVersion7();

        //Act
        var changed = script.Change(null, null, connectionID, "vendas", false, null, null, Later);

        //Assert
        Assert.True(changed);
        Assert.Equal(connectionID, script.ConnectionID);
        Assert.Equal("vendas", script.Database);
        Assert.Equal("SELECT 1", script.Sql);
    }

    /// <summary>RN-SCRIPT-006: o "Editar script…" troca o ícone e a cor; a cor vai aparada, e o resto do script fica.</summary>
    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK troca o ícone e a cor, aparados, e carimba a data sem mexer no resto")]
    public void Change_IconAndColor_ShouldBeOK()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var script = ScriptFakers.Create(name: "Relatório", sql: "SELECT 1", connectionID: connectionID, database: "vendas", createdAt: Now);

        //Act
        var changed = script.Change(null, null, null, null, false, " chart ", " #F2B644 ", Later);

        //Assert
        Assert.True(changed);
        Assert.Equal(("chart", "#F2B644"), (script.Icon, script.Color));
        Assert.Equal(("Relatório", "SELECT 1", (Guid?)connectionID, "vendas"), (script.Name, script.Sql, script.ConnectionID, script.Database));
        Assert.Equal(Later, script.UpdatedAt);
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK ícone e cor nulos ficam como estão")]
    public void Change_IconAndColorAbsent_KeepsThem()
    {
        //Arrange
        var script = ScriptFakers.Create(name: "Relatório", createdAt: Now, icon: "bug", color: "#FF8A7A");

        //Act
        var changed = script.Change("Outro", null, null, null, false, null, null, Later);

        //Assert
        Assert.True(changed);
        Assert.Equal(("bug", "#FF8A7A"), (script.Icon, script.Color));
    }

    /// <summary>O padrão não se grava: `document` e o vazio voltam ao ícone nulo, e a cor vazia tira a cor.</summary>
    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK o ícone padrão ou vazio volta a nulo, e a cor vazia tira a cor")]
    public void Change_DefaultIconAndBlankColor_ClearThem()
    {
        //Arrange
        var byDefault = ScriptFakers.Create(createdAt: Now, icon: "star", color: "#5ED3A3");
        var byBlank = ScriptFakers.Create(createdAt: Now, icon: "star", color: "#5ED3A3");

        //Act
        var defaultChanged = byDefault.Change(null, null, null, null, false, "document", "", Later);
        var blankChanged = byBlank.Change(null, null, null, null, false, "  ", " ", Later);

        //Assert
        Assert.True(defaultChanged);
        Assert.True(blankChanged);
        Assert.Equal(((string?)null, (string?)null), (byDefault.Icon, byDefault.Color));
        Assert.Equal(((string?)null, (string?)null), (byBlank.Icon, byBlank.Color));
    }

    [Trait("Script", "Change")]
    [Fact(DisplayName = "OK o mesmo ícone e a mesma cor (o padrão como document) não mudam nada nem carimbam a data")]
    public void Change_SameIconAndColor_ReturnsFalse()
    {
        //Arrange
        var colored = ScriptFakers.Create(createdAt: Now, icon: "flag", color: "#7DB2FF");
        var plain = ScriptFakers.Create(createdAt: Now);

        //Act
        var coloredChanged = colored.Change(null, null, null, null, false, "flag", " #7DB2FF", Later);
        var plainChanged = plain.Change(null, null, null, null, false, "document", "", Later);

        //Assert
        Assert.False(coloredChanged);
        Assert.False(plainChanged);
        Assert.Equal(Now, colored.UpdatedAt);
        Assert.Equal(Now, plain.UpdatedAt);
    }

    /// <summary>RN-SCRIPT-009: o "Mover para…" leva o script para a pasta ou para a raiz, e não muda mais nada (RN-SCRIPT-007).</summary>
    [Trait("Script", "MoveTo")]
    [Fact(DisplayName = "OK mover para uma pasta e de volta para a raiz muda só a pasta, e carimba a data")]
    public void MoveTo_FolderAndRoot_ChangesOnlyTheFolder()
    {
        //Arrange
        var connectionID = Guid.CreateVersion7();
        var folderID = Guid.CreateVersion7();
        var script = ScriptFakers.Create(name: "Fechamento", sql: "SELECT 1", connectionID: connectionID, database: "vendas", createdAt: Now, icon: "chart", color: "#7DB2FF");

        //Act
        var moved = script.MoveTo(folderID, false, Later);
        var inFolder = script.FolderID;
        var backToRoot = script.MoveTo(null, true, Later.AddMinutes(1));

        //Assert
        Assert.True(moved);
        Assert.Equal(folderID, inFolder);
        Assert.True(backToRoot);
        Assert.Null(script.FolderID);
        Assert.Equal(Later.AddMinutes(1), script.UpdatedAt);
        Assert.Equal(("Fechamento", "SELECT 1", connectionID, "vendas", "chart", "#7DB2FF"), (script.Name, script.Sql, script.ConnectionID, script.Database, script.Icon, script.Color));
    }

    /// <summary>O `PATCH` é parcial: a pasta nula é "fica", e o `root` falso não faz nada; o mesmo destino não muda nada nem carimba a data.</summary>
    [Trait("Script", "MoveTo")]
    [Fact(DisplayName = "OK a pasta ausente, o mesmo destino e a raiz de quem já está nela não mudam nada")]
    public void MoveTo_NothingNew_ReturnsFalse()
    {
        //Arrange
        var folderID = Guid.CreateVersion7();
        var inFolder = ScriptFakers.Create(createdAt: Now, folderID: folderID);
        var atRoot = ScriptFakers.Create(createdAt: Now);

        //Act
        var absent = inFolder.MoveTo(null, false, Later);
        var same = inFolder.MoveTo(folderID, false, Later);
        var root = atRoot.MoveTo(null, true, Later);

        //Assert
        Assert.False(absent);
        Assert.False(same);
        Assert.False(root);
        Assert.Equal(folderID, inFolder.FolderID);
        Assert.Equal((Now, Now), (inFolder.UpdatedAt, atRoot.UpdatedAt));
    }

    [Trait("Script", "Create")]
    [Fact(DisplayName = "OK nasce na pasta do campo Pasta, ou na raiz")]
    public void Create_InAFolder_KeepsTheFolder()
    {
        //Arrange
        var folderID = Guid.CreateVersion7();

        //Act
        var inFolder = Script.Create("Fechamento", "SELECT 1", null, null, folderID, Now);
        var atRoot = Script.Create("Outro", "SELECT 1", null, null, null, Now);

        //Assert
        Assert.Equal(folderID, inFolder.FolderID);
        Assert.Null(atRoot.FolderID);
    }
}
