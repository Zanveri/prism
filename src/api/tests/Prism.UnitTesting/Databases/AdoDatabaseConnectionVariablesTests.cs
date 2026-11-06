using Moq;
using Prism.Infrastructure.Databases.Models;
using System.Data.Common;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-VAR-034 e 035: a consulta de uma variável e as leituras dos valores na base, sobre o driver de mentira: as linhas inteiras, sem o corte de 10.000, na transação
/// só de leitura; os limites (a linha depois de `maxRows`, mais de 100 colunas, mais de 16 MiB), que param a leitura e a desfazem; o cursor da página que fecha sem o
/// "carregar mais" voltar; o controle de transação recusado; e os parâmetros ligados. É a mesma classe do `AdoDatabaseConnectionTests`, em outro arquivo.
/// </summary>
public sealed partial class AdoDatabaseConnectionTests
{
    [Trait("AdoDatabaseConnection", "ReadVariableAsync")]
    [Fact(DisplayName = "OK a consulta da variável lê todas as linhas, com o valor inteiro, na transação só de leitura")]
    public async Task ReadVariable_ShouldReadEveryRowWhole()
    {
        //Arrange
        _rows = 3;
        _fieldType = typeof(string);
        _value = _ => new string('a', 10_050);
        var connection = await OpenAsync();

        //Act
        var read = await connection.ReadVariableAsync(ReadQuery, TextAndNumber, 3, CancellationToken.None);

        //Assert
        Assert.True(read.IsSuccess, read.IsFailure ? read.Error.Message : null);
        Assert.Equal(("numero", "integer", "text"), (read.Value.Columns[0].Name, read.Value.Columns[0].Type, read.Value.Columns[0].Kind));
        Assert.Equal(3, read.Value.Rows.Count);
        Assert.All(read.Value.Rows, row => Assert.Equal(10_050, row[0]!.Length));
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "COMMIT"], _sent);
        Assert.Equal(["'; DROP TABLE pedido; --", "42"], UserCommand(ReadQuery).Parameters.Select(parameter => parameter.Value));
    }

    [Trait("AdoDatabaseConnection", "ReadVariableAsync")]
    [Fact(DisplayName = "Erro a linha depois de maxRows para a leitura com VARIABLE_QUERY_TOO_LARGE rows, e a transação da leitura é desfeita")]
    public async Task ReadVariable_ShouldStopAtTheRowAfterTheLimit()
    {
        //Arrange
        _rows = 3;
        var connection = await OpenAsync();

        //Act
        var read = await connection.ReadVariableAsync(ReadQuery, [], 2, CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.VariableQueryTooLarge, "rows", 2L), (read.Error.Kind, read.Error.Reason, read.Error.Limit));
        Assert.Equal("A consulta de uma variável lê até 2 linhas, e esta devolveu mais.", read.Error.Message);
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "ROLLBACK"], _sent);
        Assert.True(connection.IsOpen);
    }

    [Trait("AdoDatabaseConnection", "ReadVariableAsync")]
    [Fact(DisplayName = "OK exatamente maxRows linhas não passam do limite, e o 10.000 se escreve com o ponto")]
    public async Task ReadVariable_WithExactlyTheLimit_ShouldPass()
    {
        //Arrange
        _rows = 2;
        var connection = await OpenAsync();
        var exact = await connection.ReadVariableAsync(ReadQuery, [], 2, CancellationToken.None);
        _rows = 10_001;

        //Act
        var over = await connection.ReadVariableAsync(ReadQuery, [], QueryPaging.MaxVariableRows, CancellationToken.None);

        //Assert
        Assert.Equal(2, exact.Value.Rows.Count);
        Assert.Equal("A consulta de uma variável lê até 10.000 linhas, e esta devolveu mais.", over.Error.Message);
    }

    [Trait("AdoDatabaseConnection", "ReadVariableAsync")]
    [Fact(DisplayName = "Erro mais de 100 colunas é VARIABLE_QUERY_TOO_LARGE columns, sem ler linha")]
    public async Task ReadVariable_WithMoreThanAHundredColumns_ShouldBeTooLarge()
    {
        //Arrange
        var wide = new Mock<DbDataReader>();
        wide.SetupGet(mock => mock.FieldCount).Returns(101);
        _readers = sql => sql == "SELECT * FROM larga" ? wide.Object : null;
        var connection = await OpenAsync();

        //Act
        var read = await connection.ReadVariableAsync("SELECT * FROM larga", [], 10_000, CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.VariableQueryTooLarge, "columns", 100L), (read.Error.Kind, read.Error.Reason, read.Error.Limit));
        Assert.Equal("A consulta de uma variável tem até 100 colunas, e esta tem 101.", read.Error.Message);
        wide.Verify(mock => mock.ReadAsync(It.IsAny<CancellationToken>()), Times.Never);
        Assert.Equal(["BEGIN READ ONLY", "SELECT * FROM larga", "ROLLBACK"], _sent);
    }

    [Trait("AdoDatabaseConnection", "ReadVariableAsync")]
    [Fact(DisplayName = "Erro mais de 16 MiB de valores é VARIABLE_QUERY_TOO_LARGE bytes")]
    public async Task ReadVariable_WithMoreThanSixteenMebibytes_ShouldBeTooLarge()
    {
        //Arrange
        _rows = 3;
        _fieldType = typeof(string);
        var value = new string('x', 6 * 1024 * 1024);
        _value = _ => value;
        var connection = await OpenAsync();

        //Act
        var read = await connection.ReadVariableAsync(ReadQuery, [], 10_000, CancellationToken.None);

        //Assert
        Assert.Equal((EDatabaseFailure.VariableQueryTooLarge, "bytes", 16L * 1024 * 1024), (read.Error.Kind, read.Error.Reason, read.Error.Limit));
        Assert.Equal(["BEGIN READ ONLY", ReadQuery, "ROLLBACK"], _sent);
    }

    /// <summary>RN-VAR-034: a consulta da variável fecha o cursor aberto, como todo comando, e o "carregar mais" do resultado de antes é o `NO_OPEN_CURSOR` de sempre.</summary>
    [Trait("AdoDatabaseConnection", "ReadVariableAsync")]
    [Fact(DisplayName = "OK a consulta da variável fecha o cursor da página, e o carregar mais depois dela não tem cursor")]
    public async Task ReadVariable_ShouldCloseTheOpenCursor()
    {
        //Arrange
        _rows = 10;
        var connection = await OpenAsync();
        var page = await connection.ExecuteAsync(ReadQuery, 2, CancellationToken.None);

        //Act
        var read = await connection.ReadVariableAsync(ReadQuery, [], 10_000, CancellationToken.None);
        var next = await connection.FetchNextAsync(CancellationToken.None);

        //Assert
        Assert.True(page.Value.Page!.HasMore);
        Assert.Equal(10, read.Value.Rows.Count);
        Assert.Equal(EDatabaseFailure.NoOpenCursor, next.Error.Kind);
    }

    /// <summary>Mais de um comando é recusado antes, no registro de sessões, pelo texto de qualquer banco (aqui a base só recusa o que o driver da IBM executaria um por um).</summary>
    [Trait("AdoDatabaseConnection", "ReadVariableAsync")]
    [Fact(DisplayName = "Erro controle de transação é recusado sem ir ao banco")]
    public async Task ReadVariable_ShouldRefuseTransactionControl()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        var control = await connection.ReadVariableAsync("COMMIT", [], 10_000, CancellationToken.None);

        //Assert
        Assert.Equal(EDatabaseFailure.TransactionControlNotSupported, control.Error.Kind);
        Assert.Empty(_sent);
    }

    [Trait("AdoDatabaseConnection", "ReadColumnValuesAsync")]
    [Fact(DisplayName = "OK a leitura dos valores vai fora de transação, com os parâmetros, e lê até o fim sem limite de linhas")]
    public async Task ReadColumnValues_ShouldReadToTheEndOutsideTransaction()
    {
        //Arrange
        var connection = await OpenAsync();

        //Act
        var read = await connection.ReadColumnValuesAsync(ReadQuery, TextAndNumber, CancellationToken.None);

        //Assert
        Assert.Equal(250, read.Value.Rows.Count);
        Assert.Equal([ReadQuery], _sent);
        Assert.Equal(["'; DROP TABLE pedido; --", "42"], UserCommand(ReadQuery).Parameters.Select(parameter => parameter.Value));
    }
}
