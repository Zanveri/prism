using Prism.Application.DatabaseSessions.Features.ExecuteQuery;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>RN-LOG-001: o `ToString()` gerado de um record imprime todas as propriedades, e o SQL do usuário pode ter dado sensível.</summary>
public sealed class ExecuteQueryCommandTests
{
    [Trait("ExecuteQueryCommand", "ToString")]
    [Fact(DisplayName = "ExecuteQueryCommand_ToString_DoesNotContainSql")]
    public void ExecuteQueryCommand_ToString_DoesNotContainSql()
    {
        //Arrange
        var command = new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "SELECT 'sql-com-dado-sensivel'", Filter = "nome = 'filtro-com-dado-sensivel'" };

        //Act
        var text = command.ToString();

        //Assert
        Assert.DoesNotContain("sql-com-dado-sensivel", text);
        Assert.DoesNotContain("filtro-com-dado-sensivel", text);
        Assert.DoesNotContain(command.SessionID.ToString(), text);
    }
}
