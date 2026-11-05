using CSharpFunctionalExtensions;
using FluentValidation.TestHelper;
using Moq;
using Prism.Application.DatabaseSessions.Features.CheckColumnValues;
using Prism.Application.DatabaseSessions.Features.ExecuteVariableQuery;
using Prism.Application.DatabaseSessions.Features.GetColumnValues;
using Prism.Application.DatabaseSessions.Models;
using Prism.Application.DatabaseSessions.Models.Dtos;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Databases.Services;
using System.Net;
using System.Text.Json;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>
/// RN-VAR-034 e 035: as três rotas das variáveis na Application: a forma conferida pelos validators (`QUERY_INVALID` e `VALUES_INVALID` no campo, em camelCase), o que
/// os handlers mandam ao registro de sessões, as respostas (o DTO e os erros da seção 6) e o `ToString()` sem valores (RN-VAR-036).
/// </summary>
public sealed class VariableRoutesTests
{
    private static readonly ExecuteVariableQueryValidator VariableValidator = new();
    private static readonly GetColumnValuesValidator ValuesValidator = new();
    private static readonly CheckColumnValuesValidator CheckValidator = new();

    private readonly Mock<IDatabaseSessionService> _service = new();

    private static JsonElement Json(string json)
        => JsonDocument.Parse(json).RootElement.Clone();

    private static ExecuteVariableQueryCommand Variable(string sql = "SELECT 1", string? parameters = null, string? maxRows = null)
        => new() { SessionID = Guid.CreateVersion7(), Sql = sql, Params = parameters is null ? null : Json(parameters), MaxRows = maxRows is null ? null : Json(maxRows) };

    private static GetColumnValuesCommand Values(string? column = "status", string? search = null, string? offset = null, string? limit = null, string? total = null)
        => new() { SessionID = Guid.CreateVersion7(), Schema = "loja", Table = "pedido", Column = column, Search = search, Offset = offset is null ? null : Json(offset), Limit = limit is null ? null : Json(limit), Total = total is null ? null : Json(total) };

    private static CheckColumnValuesCommand Check(string? column = "id", string? values = "[{\"type\":\"number\",\"value\":\"7\"}]")
        => new() { SessionID = Guid.CreateVersion7(), Schema = "loja", Table = "pedido", Column = column, Values = values is null ? null : Json(values) };

    [Trait("ExecuteVariableQueryValidator", "ExecuteVariableQueryCommand")]
    [Fact(DisplayName = "OK a consulta com params e maxRows de 1 a 10.000, ausente ou nulo")]
    public void VariableValidator_ShouldBeOK()
    {
        //Act
        var results = new[] { null, "null", "1", "10000" }.Select(maxRows => VariableValidator.TestValidate(Variable("SELECT $1", "[{\"type\":\"text\",\"value\":\"a\"}]", maxRows)));

        //Assert
        Assert.All(results, result => result.ShouldNotHaveAnyValidationErrors());
    }

    [Trait("ExecuteVariableQueryValidator", "ExecuteVariableQueryCommand")]
    [Fact(DisplayName = "Erro sql vazio ou de mais de 1 MB é QUERY_INVALID no campo sql")]
    public void VariableValidator_ShouldBeError_Sql()
    {
        //Act
        var empty = VariableValidator.TestValidate(Variable("  \n"));
        var huge = VariableValidator.TestValidate(Variable("SELECT '" + new string('a', 1024 * 1024) + "'"));

        //Assert
        empty.ShouldHaveValidationErrorFor("sql").WithErrorCode("QUERY_INVALID");
        huge.ShouldHaveValidationErrorFor("sql").WithErrorCode("QUERY_INVALID");
    }

    [Trait("ExecuteVariableQueryValidator", "ExecuteVariableQueryCommand")]
    [Theory(DisplayName = "Erro maxRows fora de 1 a 10.000, com casas ou que não é número é QUERY_INVALID no campo maxRows")]
    [InlineData("0")]
    [InlineData("10001")]
    [InlineData("1.5")]
    [InlineData("\"100\"")]
    public void VariableValidator_ShouldBeError_MaxRows(string maxRows)
    {
        //Act
        var result = VariableValidator.TestValidate(Variable(maxRows: maxRows));

        //Assert
        result.ShouldHaveValidationErrorFor("maxRows").WithErrorCode("QUERY_INVALID");
    }

    [Trait("ExecuteVariableQueryValidator", "ExecuteVariableQueryCommand")]
    [Fact(DisplayName = "Erro params fora da forma é QUERY_INVALID no campo da entrada")]
    public void VariableValidator_ShouldBeError_Params()
    {
        //Act
        var result = VariableValidator.TestValidate(Variable("SELECT $1", "[{\"type\":\"number\",\"value\":\"x\"}]"));

        //Assert
        result.ShouldHaveValidationErrorFor("params[0].value").WithErrorCode("QUERY_INVALID");
    }

    [Trait("GetColumnValuesValidator", "GetColumnValuesCommand")]
    [Fact(DisplayName = "OK a coluna sozinha, e o limite 0 com total")]
    public void ValuesValidator_ShouldBeOK()
    {
        //Act
        var plain = ValuesValidator.TestValidate(Values());
        var countOnly = ValuesValidator.TestValidate(Values(search: "a%b", offset: "1000000", limit: "0", total: "true"));
        var nulls = ValuesValidator.TestValidate(Values(offset: "null", limit: "null", total: "null"));

        //Assert
        plain.ShouldNotHaveAnyValidationErrors();
        countOnly.ShouldNotHaveAnyValidationErrors();
        nulls.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("GetColumnValuesValidator", "GetColumnValuesCommand")]
    [Theory(DisplayName = "Erro cada campo fora da regra é VALUES_INVALID no campo dele")]
    [InlineData(null, null, null, null, null, "column")]
    [InlineData("status", "tab\taqui", null, null, null, "search")]
    [InlineData("status", null, "-1", null, null, "offset")]
    [InlineData("status", null, "1000001", null, null, "offset")]
    [InlineData("status", null, "\"0\"", null, null, "offset")]
    [InlineData("status", null, null, "201", null, "limit")]
    [InlineData("status", null, null, "0", null, "limit")]
    [InlineData("status", null, null, "0", "false", "limit")]
    [InlineData("status", null, null, null, "\"sim\"", "total")]
    public void ValuesValidator_ShouldBeError_OnTheField(string? column, string? search, string? offset, string? limit, string? total, string field)
    {
        //Act
        var result = ValuesValidator.TestValidate(Values(column, search, offset, limit, total));

        //Assert
        result.ShouldHaveValidationErrorFor(field).WithErrorCode("VALUES_INVALID");
        Assert.Single(result.Errors);
    }

    [Trait("GetColumnValuesValidator", "GetColumnValuesCommand")]
    [Fact(DisplayName = "Erro a busca de mais de 200 caracteres é VALUES_INVALID, e a de 200 passa")]
    public void ValuesValidator_ShouldBeError_SearchTooLong()
    {
        //Act
        var limit = ValuesValidator.TestValidate(Values(search: new string('a', 200)));
        var over = ValuesValidator.TestValidate(Values(search: new string('a', 201)));

        //Assert
        limit.ShouldNotHaveAnyValidationErrors();
        over.ShouldHaveValidationErrorFor("search").WithErrorCode("VALUES_INVALID");
    }

    [Trait("CheckColumnValuesValidator", "CheckColumnValuesCommand")]
    [Fact(DisplayName = "OK de 1 a 1.000 valores na forma dos params")]
    public void CheckValidator_ShouldBeOK()
    {
        //Act
        var one = CheckValidator.TestValidate(Check());
        var thousand = CheckValidator.TestValidate(Check(values: $"[{string.Join(',', Enumerable.Repeat("{\"type\":\"text\",\"value\":null}", 1000))}]"));

        //Assert
        one.ShouldNotHaveAnyValidationErrors();
        thousand.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CheckColumnValuesValidator", "CheckColumnValuesCommand")]
    [Theory(DisplayName = "Erro sem values, com a lista vazia, com mais de 1.000 ou que não é lista é QUERY_INVALID no campo values")]
    [InlineData(null)]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"type\":\"text\",\"value\":\"a\"}")]
    [InlineData("1001")]
    public void CheckValidator_ShouldBeError_Values(string? values)
    {
        //Arrange
        var json = values == "1001" ? $"[{string.Join(',', Enumerable.Repeat("{\"type\":\"text\",\"value\":\"a\"}", 1001))}]" : values;

        //Act
        var result = CheckValidator.TestValidate(Check(values: json));

        //Assert
        result.ShouldHaveValidationErrorFor("values").WithErrorCode("QUERY_INVALID");
    }

    [Trait("CheckColumnValuesValidator", "CheckColumnValuesCommand")]
    [Fact(DisplayName = "Erro a entrada fora da forma é QUERY_INVALID no campo dela, e a coluna vazia é VALUES_INVALID")]
    public void CheckValidator_ShouldBeError_EntryAndColumn()
    {
        //Act
        var entry = CheckValidator.TestValidate(Check(values: "[{\"type\":\"number\",\"value\":\"7\"},{\"type\":\"inteiro\",\"value\":\"7\"}]"));
        var column = CheckValidator.TestValidate(Check(column: string.Empty));

        //Assert
        entry.ShouldHaveValidationErrorFor("values[1].type").WithErrorCode("QUERY_INVALID");
        column.ShouldHaveValidationErrorFor("column").WithErrorCode("VALUES_INVALID");
    }

    [Trait("ExecuteVariableQueryHandler", "ExecuteVariableQueryCommand")]
    [Fact(DisplayName = "OK o handler manda os valores lidos e o padrão de 10.000 linhas, e devolve colunas, linhas e tempo")]
    public async Task VariableHandler_ShouldSendTheValuesAndTheDefaultLimit()
    {
        //Arrange
        var command = Variable("SELECT $1", "[{\"type\":\"number\",\"value\":\"7\"}]");
        _service.Setup(s => s.ExecuteVariableAsync(command.SessionID, "SELECT $1", It.Is<IReadOnlyList<QueryParameter>>(values => values.SequenceEqual(new[] { new QueryParameter(EQueryParameterType.Number, "7") })), 10_000, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<FullRows, DatabaseFailure>(new FullRows([new QueryColumn("n", "int4", "number")], [["7"], [null]], 4)));

        //Act
        var result = await new ExecuteVariableQueryHandler(_service.Object).Handle(command, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal(("n", "int4", "number"), (result.Value.Columns[0].Name, result.Value.Columns[0].Type, result.Value.Columns[0].Kind));
        Assert.Equal([["7"], [null]], result.Value.Rows);
        Assert.Equal(4, result.Value.ElapsedMs);
    }

    [Trait("ExecuteVariableQueryHandler", "ExecuteVariableQueryCommand")]
    [Fact(DisplayName = "Erro o limite da consulta vira 422 VARIABLE_QUERY_TOO_LARGE com reason e limit")]
    public async Task VariableHandler_ShouldMapTheLimit()
    {
        //Arrange
        var command = Variable(maxRows: "50");
        _service.Setup(s => s.ExecuteVariableAsync(command.SessionID, "SELECT 1", It.IsAny<IReadOnlyList<QueryParameter>>(), 50, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<FullRows, DatabaseFailure>(new DatabaseFailure(EDatabaseFailure.VariableQueryTooLarge, "A consulta de uma variável lê até 50 linhas, e esta devolveu mais.", Reason: "rows", Limit: 50)));

        //Act
        var result = await new ExecuteVariableQueryHandler(_service.Object).Handle(command, CancellationToken.None);

        //Assert
        Assert.Equal(("VARIABLE_QUERY_TOO_LARGE", HttpStatusCode.UnprocessableEntity), (result.Error.Type, result.Error.StatusCode));
        Assert.Equal("rows", result.Error.Extensions["reason"]);
        Assert.Equal(50L, result.Error.Extensions["limit"]);
    }

    [Trait("GetColumnValuesHandler", "GetColumnValuesCommand")]
    [Fact(DisplayName = "OK o handler monta o pedido com os padrões (0, 100, sem total) e devolve a página")]
    public async Task ValuesHandler_ShouldSendTheDefaults()
    {
        //Arrange
        var command = Values(search: "ab") with { Description = "nome" };
        _service.Setup(s => s.GetColumnValuesAsync(command.SessionID, "loja", "pedido", new ColumnValuesRequest("status", "nome", "ab", 0, 100, false), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<ColumnValuesPage, DatabaseFailure>(new ColumnValuesPage("text", [new ColumnValue("aberta", "Aberta", false)], true, null)));

        //Act
        var result = await new GetColumnValuesHandler(_service.Object).Handle(command, CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.Equal("text", result.Value.Kind);
        Assert.Equal(("aberta", "Aberta", false), (result.Value.Values[0].Value, result.Value.Values[0].Description, result.Value.Values[0].Truncated));
        Assert.True(result.Value.HasMore);
        Assert.Null(result.Value.Total);
    }

    [Trait("CheckColumnValuesHandler", "CheckColumnValuesCommand")]
    [Fact(DisplayName = "OK o handler manda os valores lidos e devolve as posições que faltam")]
    public async Task CheckHandler_ShouldAnswerTheMissing()
    {
        //Arrange
        var command = Check(values: "[{\"type\":\"number\",\"value\":\"7\"},{\"type\":\"text\",\"value\":null}]");
        _service.Setup(s => s.CheckColumnValuesAsync(command.SessionID, "loja", "pedido", "id", It.Is<IReadOnlyList<QueryParameter>>(values => values.Count == 2), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success<IReadOnlyList<int>, DatabaseFailure>([1]));

        //Act
        var result = await new CheckColumnValuesHandler(_service.Object).Handle(command, CancellationToken.None);

        //Assert
        Assert.Equal([1], result.Value.Missing);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK VariableQueryNotRead vira 422 VARIABLE_QUERY_NOT_READ com o motivo no detalhe e em reason")]
    public void From_VariableQueryNotRead_Is422WithTheReason()
    {
        //Act
        var error = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.VariableQueryNotRead, "A consulta de uma variável tem de ser uma leitura: um DELETE não é.", Reason: "um DELETE não é leitura"));

        //Assert
        Assert.Equal(("VARIABLE_QUERY_NOT_READ", HttpStatusCode.UnprocessableEntity), (error.Type, error.StatusCode));
        Assert.Equal("A consulta de uma variável tem de ser uma leitura: um DELETE não é.", error.Detail);
        Assert.Equal("um DELETE não é leitura", error.Extensions["reason"]);
    }

    [Trait("DatabaseSessionErrors", "From")]
    [Fact(DisplayName = "OK ValuesInvalid vira 422 VALUES_INVALID no campo, com errors e errorCodes, e ValuesTableNotFound vira 404")]
    public void From_ValuesFailures_AreTheCodesOfTheRule()
    {
        //Act
        var invalid = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ValuesInvalid, "A coluna não é da tabela.", Field: "description"));
        var missing = DatabaseSessionErrors.From(new DatabaseFailure(EDatabaseFailure.ValuesTableNotFound, "A tabela ou a visão não está no catálogo da sessão."));

        //Assert
        Assert.Equal(("VALUES_INVALID", HttpStatusCode.UnprocessableEntity), (invalid.Type, invalid.StatusCode));
        Assert.Equal(["A coluna não é da tabela."], ((Dictionary<string, string[]>)invalid.Extensions["errors"]!)["description"]);
        Assert.Equal(["VALUES_INVALID"], ((Dictionary<string, string[]>)invalid.Extensions["errorCodes"]!)["description"]);
        Assert.Equal(("VALUES_TABLE_NOT_FOUND", HttpStatusCode.NotFound), (missing.Type, missing.StatusCode));
    }

    [Trait("VariableRoutes", "ToString")]
    [Fact(DisplayName = "OK os pedidos e as respostas das três rotas nunca imprimem o SQL, os valores nem a busca")]
    public void ToString_ShouldNotPrintTheValues()
    {
        //Arrange
        object[] records =
        [
            Variable("SELECT 'segredo'", "[{\"type\":\"text\",\"value\":\"segredo\"}]"),
            Values(search: "segredo"),
            Check(values: "[{\"type\":\"text\",\"value\":\"segredo\"}]"),
            new VariableQueryResultDto([], [["segredo"]], 1),
            new ColumnValueDto("segredo", "segredo", false),
            new ColumnValuesDto("text", [new ColumnValueDto("segredo", null, false)], false, null)
        ];

        //Act
        var written = records.Select(record => record.ToString()!).ToList();

        //Assert
        Assert.All(written, text => Assert.DoesNotContain("segredo", text, StringComparison.Ordinal));
        Assert.Equal(["ExecuteVariableQueryCommand", "GetColumnValuesCommand", "CheckColumnValuesCommand", "VariableQueryResultDto", "ColumnValueDto", "ColumnValuesDto"], written);
    }
}
