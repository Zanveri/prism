using Npgsql;

using Prism.Infrastructure.Databases.Clients;

namespace Prism.UnitTesting.Databases;

/// <summary>RN-SQL-009: a mensagem de uma falha que não veio do servidor diz a causa uma vez só.</summary>
public sealed class PostgresConnectionCauseTextTests
{
    [Trait("PostgresConnection", "CauseText")]
    [Fact(DisplayName = "OK a mensagem repetida pela causa (host que não resolve) sai uma vez só")]
    public void CauseText_ShouldBeOK_SameMessage()
    {
        //Arrange
        var exception = new NpgsqlException("Name or service not known", new InvalidOperationException("Name or service not known"));

        //Act
        var text = PostgresConnection.CauseText(exception);

        //Assert
        Assert.Equal("Name or service not known", text);
    }

    [Trait("PostgresConnection", "CauseText")]
    [Fact(DisplayName = "OK a mensagem e a causa diferentes saem as duas, a da exceção primeiro")]
    public void CauseText_ShouldBeOK_DifferentMessages()
    {
        //Arrange
        var exception = new InvalidOperationException("Failed to connect to db.exemplo.invalid:5432", new InvalidOperationException("Connection refused"));

        //Act
        var text = PostgresConnection.CauseText(exception);

        //Assert
        Assert.Equal("Failed to connect to db.exemplo.invalid:5432: Connection refused", text);
    }

    [Trait("PostgresConnection", "CauseText")]
    [Fact(DisplayName = "OK uma das duas que já contém a outra fica sozinha: a que diz mais")]
    public void CauseText_ShouldBeOK_OneContainsTheOther()
    {
        //Arrange
        var outerSaysIt = new InvalidOperationException("Failed to connect: Connection refused", new InvalidOperationException("Connection refused"));
        var innerSaysIt = new InvalidOperationException("Connection refused", new InvalidOperationException("Failed to connect: Connection refused"));

        //Act
        var first = PostgresConnection.CauseText(outerSaysIt);
        var second = PostgresConnection.CauseText(innerSaysIt);

        //Assert
        Assert.Equal("Failed to connect: Connection refused", first);
        Assert.Equal("Failed to connect: Connection refused", second);
    }

    [Trait("PostgresConnection", "CauseText")]
    [Fact(DisplayName = "OK sem causa, ou com a causa sem mensagem, fica a mensagem da exceção")]
    public void CauseText_ShouldBeOK_WithoutCause()
    {
        //Arrange
        var alone = new InvalidOperationException("A conexão caiu.");
        var emptyCause = new InvalidOperationException("A conexão caiu.", new InvalidOperationException(string.Empty));

        //Act
        var withoutInner = PostgresConnection.CauseText(alone);
        var withEmptyInner = PostgresConnection.CauseText(emptyCause);

        //Assert
        Assert.Equal("A conexão caiu.", withoutInner);
        Assert.Equal("A conexão caiu.", withEmptyInner);
    }
}
