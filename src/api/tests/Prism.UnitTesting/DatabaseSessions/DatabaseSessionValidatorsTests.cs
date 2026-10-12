using FluentValidation.TestHelper;
using Prism.Application.DatabaseSessions.Features.ExecuteQuery;
using Prism.Application.DatabaseSessions.Features.GetSchemaObjects;
using System.Text.Json;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>Seção 6 da especificação: SQL vazio e linhas por busca fora da faixa (RN-SQL-016) são `QUERY_INVALID`, e um tipo de objeto fora dos três é `OBJECT_KIND_INVALID`. Regra de validator sem código vira 500, então cada uma leva o seu.</summary>
public sealed class DatabaseSessionValidatorsTests
{
    private static readonly ExecuteQueryValidator ExecuteQueryValidator = new();
    private static readonly GetSchemaObjectsValidator GetSchemaObjectsValidator = new();

    [Trait("ExecuteQueryValidator", "ExecuteQueryCommand")]
    [Fact(DisplayName = "OK SQL com conteúdo, inclusive com espaços e comentário em volta")]
    public void ExecuteQuery_ShouldBeOK()
    {
        //Act
        var plain = ExecuteQueryValidator.TestValidate(new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "SELECT 1" });
        var padded = ExecuteQueryValidator.TestValidate(new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "  -- só um comentário\n" });

        //Assert
        plain.ShouldNotHaveAnyValidationErrors();
        padded.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("ExecuteQueryValidator", "ExecuteQueryCommand")]
    [Fact(DisplayName = "Erro SQL vazio")]
    public void ExecuteQuery_ShouldBeError_SqlEmpty()
    {
        //Act
        var result = ExecuteQueryValidator.TestValidate(new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = string.Empty });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Sql).WithErrorCode("QUERY_INVALID");
    }

    [Trait("ExecuteQueryValidator", "ExecuteQueryCommand")]
    [Fact(DisplayName = "Erro SQL só com espaços e quebras de linha")]
    public void ExecuteQuery_ShouldBeError_SqlWhitespace()
    {
        //Act
        var result = ExecuteQueryValidator.TestValidate(new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "  \r\n\t " });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Sql).WithErrorCode("QUERY_INVALID");
    }

    /// <summary>RN-SQL-016: de 50 a 1000, e a falta do campo (ou o nulo), que vale 200.</summary>
    [Trait("ExecuteQueryValidator", "ExecuteQueryCommand")]
    [Theory(DisplayName = "OK linhas por busca de 50 a 1000, ausentes ou nulas")]
    [InlineData(null)]
    [InlineData("null")]
    [InlineData("50")]
    [InlineData("200")]
    [InlineData("1000")]
    public void ExecuteQuery_PageSize_ShouldBeOK(string? json)
    {
        //Act
        var result = ExecuteQueryValidator.TestValidate(new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "SELECT 1", PageSize = json is null ? null : JsonDocument.Parse(json).RootElement });

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>RN-SQL-016: fora da faixa, ou o que não é um número inteiro, é `QUERY_INVALID` no campo `PageSize`, e não um 400 do MVC.</summary>
    [Trait("ExecuteQueryValidator", "ExecuteQueryCommand")]
    [Theory(DisplayName = "Erro linhas por busca fora da faixa ou que não são inteiro")]
    [InlineData("49")]
    [InlineData("1001")]
    [InlineData("0")]
    [InlineData("-200")]
    [InlineData("\"texto\"")]
    [InlineData("\"200\"")]
    [InlineData("200.5")]
    [InlineData("2e2")]
    [InlineData("true")]
    [InlineData("[200]")]
    [InlineData("99999999999")]
    public void ExecuteQuery_PageSize_ShouldBeError(string json)
    {
        //Act
        var result = ExecuteQueryValidator.TestValidate(new ExecuteQueryCommand { SessionID = Guid.CreateVersion7(), Sql = "SELECT 1", PageSize = JsonDocument.Parse(json).RootElement });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.PageSize).WithErrorCode("QUERY_INVALID");
        result.ShouldNotHaveValidationErrorFor(command => command.Sql);
    }

    [Trait("GetSchemaObjectsValidator", "GetSchemaObjectsCommand")]
    [Fact(DisplayName = "OK tables, views e routines")]
    public void GetSchemaObjects_ShouldBeOK()
    {
        //Act
        var results = new[] { "tables", "views", "routines" }.Select(kind => GetSchemaObjectsValidator.TestValidate(new GetSchemaObjectsCommand(Guid.CreateVersion7(), "loja", kind)));

        //Assert
        Assert.All(results, result => result.ShouldNotHaveAnyValidationErrors());
    }

    [Trait("GetSchemaObjectsValidator", "GetSchemaObjectsCommand")]
    [Fact(DisplayName = "Erro tipo de objeto fora de tables, views e routines")]
    public void GetSchemaObjects_ShouldBeError_KindInvalid()
    {
        //Act
        var results = new[] { "sequences", "Tables", "table", " views", string.Empty }.Select(kind => GetSchemaObjectsValidator.TestValidate(new GetSchemaObjectsCommand(Guid.CreateVersion7(), "loja", kind)));

        //Assert
        Assert.All(results, result => result.ShouldHaveValidationErrorFor(command => command.Kind).WithErrorCode("OBJECT_KIND_INVALID"));
    }
}
