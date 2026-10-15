using Prism.Infrastructure.Databases.Clients;
using Prism.Infrastructure.Databases.Models;

namespace Prism.UnitTesting.Databases;

/// <summary>RN-ARVORE-006: o banco da sessão vem primeiro, e os outros na ordem de nome em que o banco os devolveu.</summary>
public sealed class ServerDatabasesTests
{
    [Trait("AdoDatabaseConnection", "CurrentFirst")]
    [Fact(DisplayName = "OK o banco da sessão sobe para o começo e os outros ficam na ordem de nome")]
    public void CurrentFirst_ShouldBeOK()
    {
        //Arrange
        IReadOnlyList<DatabaseInfo> listed = [new("alfa", false), new("beta", false), new("prism", true), new("zeta", false)];

        //Act
        var ordered = AdoDatabaseConnection.CurrentFirst(listed);

        //Assert
        Assert.Equal([new DatabaseInfo("prism", true), new DatabaseInfo("alfa", false), new DatabaseInfo("beta", false), new DatabaseInfo("zeta", false)], ordered);
    }

    [Trait("AdoDatabaseConnection", "CurrentFirst")]
    [Fact(DisplayName = "OK o banco da sessão já no começo, ou sozinho, fica como está")]
    public void CurrentFirst_ShouldBeOK_AlreadyFirst()
    {
        //Arrange
        IReadOnlyList<DatabaseInfo> listed = [new("alfa", true), new("beta", false)];
        IReadOnlyList<DatabaseInfo> alone = [new("PRISM", true)];

        //Act
        var ordered = AdoDatabaseConnection.CurrentFirst(listed);
        var single = AdoDatabaseConnection.CurrentFirst(alone);

        //Assert
        Assert.Equal(listed, ordered);
        Assert.Equal(alone, single);
    }

    [Trait("AdoDatabaseConnection", "CurrentFirst")]
    [Fact(DisplayName = "OK sem o banco da sessão na lista, a ordem do banco fica")]
    public void CurrentFirst_ShouldBeOK_WithoutCurrent()
    {
        //Arrange
        IReadOnlyList<DatabaseInfo> listed = [new("alfa", false), new("beta", false)];

        //Act
        var ordered = AdoDatabaseConnection.CurrentFirst(listed);

        //Assert
        Assert.Equal(listed, ordered);
    }
}
