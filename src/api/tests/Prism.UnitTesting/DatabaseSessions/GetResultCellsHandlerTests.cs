using CSharpFunctionalExtensions;
using FluentValidation.TestHelper;
using Moq;
using Prism.Application.DatabaseSessions.Features.GetResultCells;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>
/// RN-SQL-017: `POST .../results/{resultID}/cells`. O handler é uma linha: as células pedidas vão ao registro de sessões, e a resposta
/// leva cada uma com o valor completo, na ordem pedida (nulo quando a célula não tem). O validator recusa a lista vazia, acima de
/// 10.000 células e a posição negativa; a que passa do resultado é o registro quem diz.
/// </summary>
public sealed class GetResultCellsHandlerTests
{
    private static readonly GetResultCellsValidator Validator = new();

    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    private static GetResultCellsCommand CommandOf(params CellRefDto[] cells)
        => new() { SessionID = Guid.CreateVersion7(), ResultID = Guid.CreateVersion7(), Cells = cells };

    [Trait("GetResultCellsHandler", "GetResultCellsCommand")]
    [Fact(DisplayName = "OK devolve cada célula pedida com o valor completo, na ordem pedida, e nulo na que não tem")]
    public async Task GetResultCells_ShouldBeOK()
    {
        //Arrange
        var command = CommandOf(new CellRefDto(205, 1), new CellRefDto(3, 1));
        var full = new string('x', 50000);
        IReadOnlyList<CellPosition> asked = [];
        _databaseSessionService.Setup(s => s.GetCells(command.SessionID, command.ResultID, It.IsAny<IReadOnlyList<CellPosition>>())).Callback((Guid _, Guid _, IReadOnlyList<CellPosition> cells) => asked = cells).Returns(Result.Success<IReadOnlyList<string?>, DatabaseFailure>(new[] { full, null }));

        //Act
        var result = await new GetResultCellsHandler(_databaseSessionService.Object).Handle(command, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([new CellPosition(205, 1), new CellPosition(3, 1)], asked);
        Assert.Equal([new CellValueDto(205, 1, full), new CellValueDto(3, 1, null)], result.Value.Values);
    }

    [Trait("GetResultCellsHandler", "GetResultCellsCommand")]
    [Fact(DisplayName = "Erro outro comando já rodou vira 404 RESULT_NOT_FOUND")]
    public async Task GetResultCells_ShouldBeError_ResultNotFound()
    {
        //Arrange
        var command = CommandOf(new CellRefDto(0, 0));
        _databaseSessionService.Setup(s => s.GetCells(command.SessionID, command.ResultID, It.IsAny<IReadOnlyList<CellPosition>>())).Returns(Result.Failure<IReadOnlyList<string?>, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ResultNotFound, "O resultado não existe mais.")));

        //Act
        var result = await new GetResultCellsHandler(_databaseSessionService.Object).Handle(command, CancellationToken.None);

        //Assert
        Assert.Equal(("RESULT_NOT_FOUND", HttpStatusCode.NotFound), (result.Error.Type, result.Error.StatusCode));
    }

    [Trait("GetResultCellsValidator", "GetResultCellsCommand")]
    [Fact(DisplayName = "OK uma célula e 10.000 células")]
    public void GetResultCells_Validator_ShouldBeOK()
    {
        //Act
        var one = Validator.TestValidate(CommandOf(new CellRefDto(0, 0)));
        var limit = Validator.TestValidate(CommandOf([.. Enumerable.Range(0, 10000).Select(row => new CellRefDto(row, 3))]));

        //Assert
        one.ShouldNotHaveAnyValidationErrors();
        limit.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("GetResultCellsValidator", "GetResultCellsCommand")]
    [Fact(DisplayName = "Erro lista vazia, ausente ou acima de 10.000 células é CELLS_INVALID")]
    public void GetResultCells_Validator_ShouldBeError_CellsCount()
    {
        //Act
        var empty = Validator.TestValidate(CommandOf());
        var absent = Validator.TestValidate(CommandOf() with { Cells = null });
        var tooMany = Validator.TestValidate(CommandOf([.. Enumerable.Range(0, 10001).Select(row => new CellRefDto(row, 0))]));

        //Assert
        empty.ShouldHaveValidationErrorFor(command => command.Cells).WithErrorCode("CELLS_INVALID");
        absent.ShouldHaveValidationErrorFor(command => command.Cells).WithErrorCode("CELLS_INVALID");
        tooMany.ShouldHaveValidationErrorFor(command => command.Cells).WithErrorCode("CELLS_INVALID");
    }

    [Trait("GetResultCellsValidator", "GetResultCellsCommand")]
    [Theory(DisplayName = "Erro linha ou coluna negativa é CELLS_INVALID")]
    [InlineData(-1, 0)]
    [InlineData(0, -1)]
    public void GetResultCells_Validator_ShouldBeError_NegativePosition(int row, int column)
    {
        //Act
        var result = Validator.TestValidate(CommandOf(new CellRefDto(0, 0), new CellRefDto(row, column)));

        //Assert
        result.ShouldHaveValidationErrorFor("Cells[1]").WithErrorCode("CELLS_INVALID");
    }
}
