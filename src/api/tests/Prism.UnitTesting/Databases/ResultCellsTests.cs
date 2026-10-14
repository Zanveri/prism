using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;

namespace Prism.UnitTesting.Databases;

/// <summary>
/// RN-SQL-017: o valor completo das células que a API cortou, guardado em memória por resultado, pela linha no resultado inteiro (as
/// páginas do "carregar mais" continuam a contagem) e pela coluna, com o teto por sessão.
/// </summary>
public sealed class ResultCellsTests
{
    private static readonly QueryColumn[] TwoColumns = [new("id", "integer", "number"), new("corpo", "text", "text")];

    private static QueryPage PageOf(int rows, params (int Row, int Column, FullCellValue Value)[] cut)
        => new(TwoColumns, [.. Enumerable.Range(0, rows).Select(_ => new string?[] { "1", "x" })], false, 0, [.. cut.Select(cell => new[] { cell.Row, cell.Column })], FullValues: [.. cut.Select(cell => cell.Value)]);

    [Trait("ResultCells", "Read")]
    [Fact(DisplayName = "OK a célula de uma página seguinte é achada pela linha no resultado inteiro, e a que não foi cortada volta nula")]
    public void Read_ShouldFindTheCellsOfEveryPage_ByTheRowInTheWholeResult()
    {
        //Arrange
        var cells = new ResultCells();
        var first = new string('a', 10001);
        var second = new string('b', 50000);
        cells.Add(PageOf(200, (3, 1, FullCellValue.Text(first))));
        cells.Add(PageOf(200, (5, 1, FullCellValue.Text(second))));

        //Act
        var values = cells.Read([new CellPosition(205, 1), new CellPosition(3, 1), new CellPosition(5, 1), new CellPosition(3, 0)], TwoColumns.Length);

        //Assert
        Assert.True(values.IsSuccess);
        Assert.Equal([second, first, null, null], values.Value);
        Assert.Equal(400, cells.Rows);
    }

    [Trait("ResultCells", "Read")]
    [Fact(DisplayName = "OK o binário volta inteiro, em hexadecimal como a grade o escreve")]
    public void Read_ShouldWriteTheWholeBinary_AsTheGridWritesIt()
    {
        //Arrange
        var cells = new ResultCells();
        var bytes = Enumerable.Range(0, 1000).Select(index => (byte)index).ToArray();
        cells.Add(PageOf(1, (0, 1, FullCellValue.Binary(bytes))));

        //Act
        var values = cells.Read([new CellPosition(0, 1)], TwoColumns.Length);

        //Assert
        Assert.Equal("0x" + Convert.ToHexString(bytes), values.Value[0]);
    }

    /// <summary>
    /// O teto conta o que fica na memória: 2 bytes por caractere do texto (UTF-16) e 1 por byte do binário. A célula que não cabe e as
    /// seguintes ficam sem valor completo, mesmo uma pequena que coubesse, e a página diz quais são.
    /// </summary>
    [Trait("ResultCells", "Add")]
    [Fact(DisplayName = "OK passando do teto, a célula que não cabe e as seguintes ficam sem valor completo, e a página diz quais")]
    public void Add_ShouldLeaveTheCellsPastTheLimit_WithoutTheFullValue()
    {
        //Arrange
        var cells = new ResultCells(capacity: 100);
        var fits = FullCellValue.Text(new string('a', 30));

        //Act
        var firstMissing = cells.Add(PageOf(3, (0, 1, fits), (1, 1, FullCellValue.Binary(new byte[41]))));
        var secondMissing = cells.Add(PageOf(3, (0, 1, FullCellValue.Binary(new byte[1])), (2, 1, FullCellValue.Text("b"))));
        var values = cells.Read([new CellPosition(0, 1), new CellPosition(1, 1), new CellPosition(3, 1), new CellPosition(5, 1)], TwoColumns.Length);

        //Assert
        Assert.Equal(60, fits.Bytes);
        Assert.Equal([new[] { 1, 1 }], firstMissing);
        Assert.Equal([new[] { 0, 1 }, new[] { 2, 1 }], secondMissing);
        Assert.Equal([new string('a', 30), null, null, null], values.Value);
    }

    [Trait("ResultCells", "Add")]
    [Fact(DisplayName = "OK o que cabe exatamente no teto é guardado")]
    public void Add_ShouldKeepTheCell_ThatFillsTheLimitExactly()
    {
        //Arrange
        var cells = new ResultCells(capacity: 20);

        //Act
        var missing = cells.Add(PageOf(1, (0, 1, FullCellValue.Text(new string('a', 10)))));

        //Assert
        Assert.Empty(missing);
        Assert.Equal(new string('a', 10), cells.Read([new CellPosition(0, 1)], TwoColumns.Length).Value[0]);
    }

    [Trait("ResultCells", "Read")]
    [Theory(DisplayName = "NOK linha ou coluna fora do resultado é CellsInvalid, e nada volta")]
    [InlineData(400, 0)]
    [InlineData(-1, 0)]
    [InlineData(0, 2)]
    [InlineData(0, -1)]
    public void Read_ShouldRefuse_ACellOutsideTheResult(int row, int column)
    {
        //Arrange
        var cells = new ResultCells();
        cells.Add(PageOf(200));
        cells.Add(PageOf(200));

        //Act
        var values = cells.Read([new CellPosition(0, 0), new CellPosition(row, column)], TwoColumns.Length);

        //Assert
        Assert.Equal(EDatabaseFailure.CellsInvalid, values.Error.Kind);
    }

    [Trait("ResultCells", "Clear")]
    [Fact(DisplayName = "OK largar o resultado esquece os valores, e as células seguintes não são mais guardadas")]
    public void Clear_ShouldForgetTheValues()
    {
        //Arrange
        var cells = new ResultCells();
        cells.Add(PageOf(1, (0, 1, FullCellValue.Text(new string('a', 10001)))));

        //Act
        cells.Clear();
        var missing = cells.Add(PageOf(1, (0, 1, FullCellValue.Text(new string('b', 10001)))));
        var values = cells.Read([new CellPosition(0, 1), new CellPosition(1, 1)], TwoColumns.Length);

        //Assert
        Assert.Equal([new[] { 0, 1 }], missing);
        Assert.Equal([null, null], values.Value);
    }
}
