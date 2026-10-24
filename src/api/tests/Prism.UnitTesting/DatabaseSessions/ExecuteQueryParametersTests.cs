using CSharpFunctionalExtensions;
using FluentValidation.TestHelper;
using Moq;
using Prism.Application.Connections.Queries;
using Prism.Application.DatabaseSessions.Features.ExecuteQuery;
using Prism.Application.DatabaseSessions.Models;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>
/// RN-VAR-032: o campo `params` da rota das consultas: a forma conferida pelo validator (`QUERY_INVALID` no campo, `FILTER_INVALID` para o filtro com marcador), a leitura
/// dos valores pelo handler e as duas recusas novas do registro de sessões na resposta (`QUERY_PARAMETERS_MISMATCH` com `markers` e `values`, `QUERY_INVALID` no campo).
/// </summary>
public sealed class ExecuteQueryParametersTests
{
    private static JsonElement Json(string json)
        => JsonDocument.Parse(json).RootElement.Clone();

    private readonly Mock<IDatabaseSessionService> _service = new();

    private ExecuteQueryValidator Validator => new(_service.Object);

    [Trait("ExecuteQueryValidator", "Params")]
    [Fact(DisplayName = "OK sem params, com nulo, com a lista vazia ou com os valores certos não há erro")]
    public void Validate_ShouldBeOK_WithAcceptedParams()
    {
        //Act
        var results = new[] { null, "null", "[]", "[{\"type\":\"number\",\"value\":\"1\"},{\"type\":\"text\",\"value\":null}]" }
            .Select(json => Validator.TestValidate(new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "SELECT $1", Params = json is null ? null : Json(json) }));

        //Assert
        Assert.All(results, result => result.ShouldNotHaveAnyValidationErrors());
    }

    [Trait("ExecuteQueryValidator", "Params")]
    [Fact(DisplayName = "Erro a forma errada é QUERY_INVALID no campo da entrada, e todas as entradas erradas vêm de uma vez")]
    public void Validate_ShouldBeError_WithParamsOutOfShape()
    {
        //Arrange
        var command = new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "SELECT $1", Params = Json("[{\"type\":\"number\",\"value\":\"1\"},{\"type\":\"number\",\"value\":\"x\"},{\"type\":\"int\",\"value\":\"1\"},5]") };

        //Act
        var result = Validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor("params[1].value").WithErrorCode("QUERY_INVALID");
        result.ShouldHaveValidationErrorFor("params[2].type").WithErrorCode("QUERY_INVALID");
        result.ShouldHaveValidationErrorFor("params[3]").WithErrorCode("QUERY_INVALID");
        Assert.Equal(3, result.Errors.Count);
    }

    [Trait("ExecuteQueryValidator", "Params")]
    [Fact(DisplayName = "Erro params que não é uma lista é QUERY_INVALID no campo params")]
    public void Validate_ShouldBeError_WhenParamsIsNotAList()
    {
        //Act
        var result = Validator.TestValidate(new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "SELECT $1", Params = Json("{\"type\":\"number\",\"value\":\"1\"}") });

        //Assert
        result.ShouldHaveValidationErrorFor("params").WithErrorCode("QUERY_INVALID");
    }

    [Trait("ExecuteQueryValidator", "Params")]
    [Fact(DisplayName = "Erro com params, o filtro é conferido sabendo que há valores, e a recusa dele é FILTER_INVALID")]
    public void Validate_FilterWithParams_ShouldAskTheSessionServiceWithParameters()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        _service.Setup(s => s.FilterRefusal(sessionID, "a = $2", true)).Returns("O filtro não pode ter marcador de parâmetro ($1 ou ?).");

        //Act
        var withParams = Validator.TestValidate(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT $1", Filter = "a = $2", Params = Json("[{\"type\":\"number\",\"value\":\"1\"}]") });
        var emptyList = Validator.TestValidate(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT 1", Filter = "a = $2", Params = Json("[]") });

        //Assert
        withParams.ShouldHaveValidationErrorFor(command => command.Filter).WithErrorCode("FILTER_INVALID");
        emptyList.ShouldNotHaveAnyValidationErrors();
        _service.Verify(s => s.FilterRefusal(sessionID, "a = $2", false), Times.Once);
    }

    [Trait("ExecuteQueryHandler", "Params")]
    [Fact(DisplayName = "OK o handler manda ao registro de sessões os valores lidos, na ordem")]
    public async Task Handle_ShouldSendTheParsedParameters()
    {
        //Arrange
        var sessionID = Guid.CreateVersion7();
        var connectionQueries = new Mock<IConnectionQueries>();
        IReadOnlyList<QueryParameter>? sent = null;
        _service.Setup(s => s.ExecuteAsync(sessionID, "SELECT $1, $2", null, QueryPaging.DefaultPageSize, false, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<IReadOnlyList<QueryParameter>>(), It.IsAny<CancellationToken>()))
            .Callback((Guid _, string _, string? _, int _, bool _, IReadOnlyCollection<Guid> _, IReadOnlyList<QueryParameter> parameters, CancellationToken _) => sent = parameters)
            .ReturnsAsync(Result.Success<QueryOutcome, DatabaseFailure>(new QueryOutcome(null, 0, 1)));

        //Act
        var result = await new ExecuteQueryHandler(connectionQueries.Object, _service.Object).Handle(new ExecuteQueryCommand { SessionID = sessionID, Sql = "SELECT $1, $2", Params = Json("[{\"type\":\"date\",\"value\":\"2026-10-20\"},{\"type\":\"boolean\",\"value\":null}]") }, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal([new QueryParameter(EQueryParameterType.Date, "2026-10-20"), new QueryParameter(EQueryParameterType.Boolean, null)], sent);
    }

    [Trait("ExecuteQueryCommand", "ToString")]
    [Fact(DisplayName = "OK o pedido nunca imprime o SQL nem os valores (RN-LOG-001)")]
    public void ToString_ShouldNotPrintTheValues()
    {
        //Act
        var text = new ExecuteQueryCommand { Sql = "SELECT 1", Params = Json("[{\"type\":\"text\",\"value\":\"segredo\"}]") }.ToString();

        //Assert
        Assert.Equal("ExecuteQueryCommand", text);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ParametersMismatch vira 422 QUERY_PARAMETERS_MISMATCH com markers e values")]
    public void From_ParametersMismatch_Is422WithMarkersAndValues()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ParametersMismatch, "O comando tem 3 marcadores, e vieram 2 valores.", Markers: 3, Values: 2));

        //Assert
        Assert.Equal("QUERY_PARAMETERS_MISMATCH", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        Assert.Equal("O comando tem 3 marcadores, e vieram 2 valores.", error.Detail);
        Assert.Equal(3, error.Extensions["markers"]);
        Assert.Equal(2, error.Extensions["values"]);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK QueryInvalid vira 422 QUERY_INVALID no campo do valor")]
    public void From_QueryInvalid_Is422OnTheField()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.QueryInvalid, "O número tem 35 dígitos, e o Db2 guarda até 31.", Field: "params[3].value"));

        //Assert
        Assert.Equal("QUERY_INVALID", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
        var errors = (Dictionary<string, string[]>)error.Extensions["errors"]!;
        var codes = (Dictionary<string, string[]>)error.Extensions["errorCodes"]!;
        Assert.Equal(["O número tem 35 dígitos, e o Db2 guarda até 31."], errors["params[3].value"]);
        Assert.Equal(["QUERY_INVALID"], codes["params[3].value"]);
    }
}
