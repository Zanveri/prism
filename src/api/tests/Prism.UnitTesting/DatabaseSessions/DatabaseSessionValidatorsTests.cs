using FluentValidation.TestHelper;
using Prism.Application.DatabaseSessions.Features.ExecuteQuery;
using Prism.Application.DatabaseSessions.Features.GetSchemaObjects;
using Prism.Application.DatabaseSessions.Features.OpenDatabaseSession;
using System.Text.Json;

namespace Prism.UnitTesting.DatabaseSessions;

/// <summary>Seção 6 da especificação: SQL vazio e linhas por busca fora da faixa (RN-SQL-016) são `QUERY_INVALID`, um tipo de objeto fora dos três é `OBJECT_KIND_INVALID`, e o nome de outro banco vazio, longo demais ou com caractere de controle é `DATABASE_NAME_INVALID` (RN-ARVORE-006). Regra de validator sem código vira 500, então cada uma leva o seu.</summary>
public sealed class DatabaseSessionValidatorsTests
{
    private static readonly ExecuteQueryValidator ExecuteQueryValidator = new();
    private static readonly GetSchemaObjectsValidator GetSchemaObjectsValidator = new();
    private static readonly OpenDatabaseSessionValidator OpenDatabaseSessionValidator = new();

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

    /// <summary>RN-ARVORE-006: sem o campo (ou nulo) vale o banco da conexão; com ele, qualquer nome que o banco aceite, inclusive com espaço, aspas, `@` e acento, até 128 caracteres.</summary>
    [Trait("OpenDatabaseSessionValidator", "OpenDatabaseSessionCommand")]
    [Theory(DisplayName = "OK sem banco, ou com um nome de até 128 caracteres sem caractere de controle")]
    [InlineData(null)]
    [InlineData("prism")]
    [InlineData("Banco \"de\" teste's @ ação")]
    [InlineData("sysmaster")]
    public void OpenDatabaseSession_ShouldBeOK(string? database)
    {
        //Act
        var result = OpenDatabaseSessionValidator.TestValidate(new OpenDatabaseSessionCommand { ConnectionID = Guid.CreateVersion7(), Database = database });

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("OpenDatabaseSessionValidator", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "OK nome com exatamente 128 caracteres")]
    public void OpenDatabaseSession_ShouldBeOK_128Characters()
    {
        //Act
        var result = OpenDatabaseSessionValidator.TestValidate(new OpenDatabaseSessionCommand { ConnectionID = Guid.CreateVersion7(), Database = new string('a', 128) });

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("OpenDatabaseSessionValidator", "OpenDatabaseSessionCommand")]
    [Theory(DisplayName = "Erro nome vazio, só de espaços, com mais de 128 caracteres ou com caractere de controle")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("a\u0000b")]
    [InlineData("prism\n")]
    [InlineData("\tprism")]
    [InlineData("pri\u007Fsm")]
    [InlineData("pri\u0085sm")]
    public void OpenDatabaseSession_ShouldBeError_DatabaseInvalid(string database)
    {
        //Act
        var result = OpenDatabaseSessionValidator.TestValidate(new OpenDatabaseSessionCommand { ConnectionID = Guid.CreateVersion7(), Database = database });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Database).WithErrorCode("DATABASE_NAME_INVALID");
    }

    [Trait("OpenDatabaseSessionValidator", "OpenDatabaseSessionCommand")]
    [Fact(DisplayName = "Erro nome com 129 caracteres")]
    public void OpenDatabaseSession_ShouldBeError_DatabaseTooLong()
    {
        //Act
        var result = OpenDatabaseSessionValidator.TestValidate(new OpenDatabaseSessionCommand { ConnectionID = Guid.CreateVersion7(), Database = new string('a', 129) });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Database).WithErrorCode("DATABASE_NAME_INVALID");
    }
}
