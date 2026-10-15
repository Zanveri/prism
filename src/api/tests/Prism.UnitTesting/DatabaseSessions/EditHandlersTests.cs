using CSharpFunctionalExtensions;
using FluentValidation.TestHelper;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Features.ApplyEdits;
using Prism.Application.DatabaseSessions.Features.GetEditTarget;
using Prism.Application.DatabaseSessions.Features.PreviewEdits;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>
/// RN-EDIT-002, 005 e 008: as rotas `queries/edit-target`, `queries/edits` e `queries/edits/preview`. Os handlers são uma linha cada: o
/// pedido vira as alterações do registro de sessões, e a resposta, o DTO da seção 22 (sem o tipo de catálogo de cada coluna, que fica
/// na API). O validator recusa o pedido sem resultado, sem alterações ou com um tipo de alteração que não existe.
/// </summary>
public sealed class EditHandlersTests
{
    private static readonly GetEditTargetValidator GetEditTargetValidator = new();
    private static readonly ApplyEditsValidator ApplyEditsValidator = new();
    private static readonly PreviewEditsValidator PreviewEditsValidator = new();

    private readonly Mock<IConnectionQueries> _connectionQueries = new();
    private readonly Mock<IDatabaseSessionService> _databaseSessionService = new();

    [Trait("GetEditTargetHandler", "GetEditTargetCommand")]
    [Fact(DisplayName = "OK devolve as tabelas, as colunas, a linha nova e excluir e o uma por vez, sem o tipo do catálogo")]
    public async Task GetEditTarget_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var (sessionID, resultID, treeID) = (Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7());
        var target = new EditTarget([new EditTable("loja", "pedido", [0], true, null)], [new EditColumn(0, "id", true, null, false, null, "integer"), new EditColumn(null, null, false, "coluna calculada", true, null, null)], true, false);
        _databaseSessionService.Setup(s => s.GetEditTargetAsync(sessionID, resultID, treeID, cancellationToken)).ReturnsAsync(Result.Success<EditTarget, DatabaseFailure>(target));

        //Act
        var result = await new GetEditTargetHandler(_connectionQueries.Object, _databaseSessionService.Object).Handle(new GetEditTargetCommand { SessionID = sessionID, ResultID = resultID, CatalogSessionID = treeID }, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        var table = Assert.Single(result.Value.Tables);
        Assert.Equal(("loja", "pedido", true, (string?)null), (table.Schema, table.Name, table.Editable, table.Reason));
        Assert.Equal([0], table.Key);
        Assert.Equal([new EditColumnDto(0, "id", true, null, false, null), new EditColumnDto(null, null, false, "coluna calculada", true, null)], result.Value.Columns);
        Assert.True(result.Value.RowOperations);
        Assert.False(result.Value.OneAtATime);
    }

    [Trait("GetEditTargetHandler", "GetEditTargetCommand")]
    [Fact(DisplayName = "Erro resultado inteiro só leitura vira 422 RESULT_NOT_EDITABLE com o motivo")]
    public async Task GetEditTarget_ShouldBeError_ResultNotEditable()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var (sessionID, resultID) = (Guid.CreateVersion7(), Guid.CreateVersion7());
        _databaseSessionService.Setup(s => s.GetEditTargetAsync(sessionID, resultID, null, cancellationToken)).ReturnsAsync(Result.Failure<EditTarget, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.ResultNotEditable, "Somente leitura: DISTINCT.", Reason: "DISTINCT")));

        //Act
        var result = await new GetEditTargetHandler(_connectionQueries.Object, _databaseSessionService.Object).Handle(new GetEditTargetCommand { SessionID = sessionID, ResultID = resultID }, cancellationToken);

        //Assert
        Assert.Equal(("RESULT_NOT_EDITABLE", HttpStatusCode.UnprocessableEntity, "DISTINCT"), (result.Error.Type, result.Error.StatusCode, result.Error.Extensions["reason"]));
    }

    [Trait("ApplyEditsHandler", "ApplyEditsCommand")]
    [Fact(DisplayName = "OK as alterações do pedido chegam ao registro como foram feitas, com o set da alteração e os values da linha nova")]
    public async Task ApplyEdits_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var (sessionID, resultID) = (Guid.CreateVersion7(), Guid.CreateVersion7());
        IReadOnlyList<EditChange>? received = null;
        _databaseSessionService.Setup(s => s.ApplyEditsAsync(sessionID, resultID, It.IsAny<IReadOnlyList<EditChange>>(), cancellationToken)).Callback<Guid, Guid, IReadOnlyList<EditChange>, CancellationToken>((_, _, changes, _) => received = changes).ReturnsAsync(Result.Success<int, DatabaseFailure>(3));
        var command = new ApplyEditsCommand
        {
            SessionID = sessionID,
            ResultID = resultID,
            Changes =
            [
                new EditChangeDto { Kind = "update", Table = 0, Key = ["1"], Set = [new EditValueDto(1, "paga")] },
                new EditChangeDto { Kind = "delete", Table = 0, Key = ["2"] },
                new EditChangeDto { Kind = "insert", Table = 0, Values = [new EditValueDto(0, "9"), new EditValueDto(1, null)] }
            ]
        };

        //Act
        var result = await new ApplyEditsHandler(_connectionQueries.Object, _databaseSessionService.Object).Handle(command, cancellationToken);

        //Assert
        Assert.Equal(3, result.Value.Applied);
        Assert.NotNull(received);
        Assert.Equal([EEditKind.Update, EEditKind.Delete, EEditKind.Insert], received.Select(change => change.Kind));
        Assert.Equal([new EditValue(1, "paga")], received[0].Values);
        Assert.Equal(["2"], received[1].Key);
        Assert.Empty(received[1].Values);
        Assert.Equal([new EditValue(0, "9"), new EditValue(1, null)], received[2].Values);
        Assert.Empty(received[2].Key);
    }

    [Trait("ApplyEditsHandler", "ApplyEditsCommand")]
    [Fact(DisplayName = "Erro a linha que não existe mais vira 422 EDIT_ROW_MISMATCH com a alteração, as linhas afetadas e as já gravadas")]
    public async Task ApplyEdits_ShouldBeError_EditRowMismatch()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var (sessionID, resultID) = (Guid.CreateVersion7(), Guid.CreateVersion7());
        _databaseSessionService.Setup(s => s.ApplyEditsAsync(sessionID, resultID, It.IsAny<IReadOnlyList<EditChange>>(), cancellationToken)).ReturnsAsync(Result.Failure<int, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.EditRowMismatch, "A linha não existe mais.", Change: 1, RowsAffected: 0, Applied: 1)));

        //Act
        var result = await new ApplyEditsHandler(_connectionQueries.Object, _databaseSessionService.Object).Handle(new ApplyEditsCommand { SessionID = sessionID, ResultID = resultID, Changes = [new EditChangeDto { Kind = "delete", Key = ["1"] }] }, cancellationToken);

        //Assert
        Assert.Equal(("EDIT_ROW_MISMATCH", HttpStatusCode.UnprocessableEntity), (result.Error.Type, result.Error.StatusCode));
        Assert.Equal((1, 0L, 1), ((int)result.Error.Extensions["change"]!, (long)result.Error.Extensions["rowsAffected"]!, (int)result.Error.Extensions["applied"]!));
    }

    [Trait("PreviewEditsHandler", "PreviewEditsCommand")]
    [Fact(DisplayName = "OK devolve os comandos com os literais e o uma por vez")]
    public async Task PreviewEdits_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var (sessionID, resultID) = (Guid.CreateVersion7(), Guid.CreateVersion7());
        var preview = new EditPreview([new EditStatement("DELETE FROM \"loja\".\"pedido\" WHERE \"id\" = 1", [])], OneAtATime: true);
        _databaseSessionService.Setup(s => s.PreviewEditsAsync(sessionID, resultID, It.IsAny<IReadOnlyList<EditChange>>(), cancellationToken)).ReturnsAsync(Result.Success<EditPreview, DatabaseFailure>(preview));

        //Act
        var result = await new PreviewEditsHandler(_connectionQueries.Object, _databaseSessionService.Object).Handle(new PreviewEditsCommand { SessionID = sessionID, ResultID = resultID, Changes = [new EditChangeDto { Kind = "delete", Key = ["1"] }] }, cancellationToken);

        //Assert
        Assert.Same(preview, result.Value);
    }

    [Trait("ApplyEditsValidator", "ApplyEditsCommand")]
    [Fact(DisplayName = "Erro sem resultado, sem alterações ou com um tipo que não existe é EDIT_INVALID")]
    public void ApplyEditsValidator_ShouldBeError_EditInvalid()
    {
        //Act
        var noResult = ApplyEditsValidator.TestValidate(new ApplyEditsCommand { Changes = [new EditChangeDto { Kind = "delete", Key = ["1"] }] });
        var noChanges = ApplyEditsValidator.TestValidate(new ApplyEditsCommand { ResultID = Guid.CreateVersion7(), Changes = [] });
        var unknownKind = PreviewEditsValidator.TestValidate(new PreviewEditsCommand { ResultID = Guid.CreateVersion7(), Changes = [new EditChangeDto { Kind = "merge" }] });
        var ok = ApplyEditsValidator.TestValidate(new ApplyEditsCommand { ResultID = Guid.CreateVersion7(), Changes = [new EditChangeDto { Kind = "update", Key = ["1"], Set = [new EditValueDto(0, "x")] }] });

        //Assert
        noResult.ShouldHaveValidationErrorFor(command => command.ResultID).WithErrorCode("EDIT_INVALID");
        noChanges.ShouldHaveValidationErrorFor(command => command.Changes).WithErrorCode("EDIT_INVALID");
        unknownKind.ShouldHaveValidationErrorFor("Changes[0].Kind").WithErrorCode("EDIT_INVALID");
        ok.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("GetEditTargetValidator", "GetEditTargetCommand")]
    [Fact(DisplayName = "Erro sem resultado é EDIT_INVALID")]
    public void GetEditTargetValidator_ShouldBeError_NoResult()
    {
        //Act
        var result = GetEditTargetValidator.TestValidate(new GetEditTargetCommand());

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.ResultID).WithErrorCode("EDIT_INVALID");
    }
}
