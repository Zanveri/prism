using FluentValidation.TestHelper;
using Prism.Application.Scripts.Features.CreateScript;
using Prism.Application.Scripts.Features.UpdateScript;
using Prism.Application.Scripts.Models;
using Prism.TestingCore.Fakers.Scripts;

namespace Prism.UnitTesting.Scripts;

/// <summary>
/// RN-SCRIPT-004: o nome tem de 1 a 200 caracteres depois de normalizado e nenhum caractere de controle (nem tabulação nem quebra de linha, que a
/// normalização trocaria por espaço); o SQL tem até 1 MB, contado em bytes de UTF-8 (1.048.576). A unicidade do nome não é regra daqui: é 409 do repository.
/// RN-SCRIPT-005: o `PATCH` com `generic` não leva conexão nem banco. RN-SCRIPT-006: o ícone é um da lista fechada e a cor dele é `#RRGGBB`, com a recusa em
/// `SCRIPT_ICON_INVALID` no campo.
/// </summary>
public sealed class ScriptValidatorsTests
{
    private const int OneMegabyte = 1024 * 1024;

    public static TheoryData<string> InvalidNames()
        => ["", "   ", new string('a', 201), "Fechamento\u0001", "Fecha\tmento", "Fecha\nmento", "Fecha\rmento", "\u007FFechamento", "Fechamento\u0085", "\0"];

    [Trait("CreateScriptValidator", "CreateScriptCommand")]
    [Fact(DisplayName = "OK nome, SQL, conexão e banco válidos")]
    public void Create_ShouldBeOK()
    {
        //Arrange
        var validator = new CreateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnCreateScriptCommandValid(connectionID: Guid.CreateVersion7(), database: "vendas"));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateScriptValidator", "CreateScriptCommand")]
    [Fact(DisplayName = "OK nome de 200 caracteres depois de normalizado, e SQL vazio")]
    public void Create_ShouldBeOK_AtTheLimits()
    {
        //Arrange
        var validator = new CreateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnCreateScriptCommandValid(name: $"  {new string('é', 200)}  ", sql: ""));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateScriptValidator", "CreateScriptCommand")]
    [Theory(DisplayName = "Erro nome vazio, longo demais ou com caractere de controle")]
    [MemberData(nameof(InvalidNames))]
    public void Create_InvalidName_ReturnsScriptNameInvalid(string name)
    {
        //Arrange
        var validator = new CreateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnCreateScriptCommandValid(name: name));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("SCRIPT_NAME_INVALID");
        result.ShouldNotHaveValidationErrorFor(command => command.Sql);
    }

    [Trait("CreateScriptValidator", "CreateScriptCommand")]
    [Fact(DisplayName = "OK SQL de exatamente 1 MB")]
    public void Create_SqlOfExactlyOneMegabyte_ShouldBeOK()
    {
        //Arrange
        var validator = new CreateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnCreateScriptCommandValid(sql: new string('x', OneMegabyte)));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateScriptValidator", "CreateScriptCommand")]
    [Fact(DisplayName = "Erro SQL de 1 MB e um byte")]
    public void Create_SqlOverOneMegabyte_ReturnsScriptTooLarge()
    {
        //Arrange
        var validator = new CreateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnCreateScriptCommandValid(sql: new string('x', OneMegabyte + 1)));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Sql).WithErrorCode("SCRIPT_TOO_LARGE");
        result.ShouldNotHaveValidationErrorFor(command => command.Name);
    }

    /// <summary>O limite é de bytes, e não de caracteres: "é" tem dois bytes em UTF-8, e meio milhão deles passa de 1 MB com menos de um milhão de caracteres.</summary>
    [Trait("CreateScriptValidator", "CreateScriptCommand")]
    [Fact(DisplayName = "Erro SQL com acento conta os bytes, e não os caracteres")]
    public void Create_SqlCountsBytes_ReturnsScriptTooLarge()
    {
        //Arrange
        var validator = new CreateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnCreateScriptCommandValid(sql: new string('é', (OneMegabyte / 2) + 1)));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Sql).WithErrorCode("SCRIPT_TOO_LARGE");
    }

    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "OK só o ID: o ausente fica como está")]
    public void Update_OnlyTheID_ShouldBeOK()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid());

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Theory(DisplayName = "Erro nome enviado vazio, longo demais ou com caractere de controle")]
    [MemberData(nameof(InvalidNames))]
    public void Update_InvalidName_ReturnsScriptNameInvalid(string name)
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(name: name));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("SCRIPT_NAME_INVALID");
    }

    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "Erro SQL enviado de mais de 1 MB")]
    public void Update_SqlOverOneMegabyte_ReturnsScriptTooLarge()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(sql: new string('x', OneMegabyte + 1)));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Sql).WithErrorCode("SCRIPT_TOO_LARGE");
    }

    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "OK genérico sozinho, ou com o SQL")]
    public void Update_Generic_ShouldBeOK()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        //Act
        var alone = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(generic: true));
        var withSql = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(sql: "SELECT 1", generic: true));

        //Assert
        alone.ShouldNotHaveAnyValidationErrors();
        withSql.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "Erro genérico com a conexão")]
    public void Update_GenericWithAConnection_ReturnsScriptPlaceInvalid()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(connectionID: Guid.CreateVersion7(), generic: true));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.ConnectionID).WithErrorCode("SCRIPT_PLACE_INVALID");
    }

    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "Erro genérico com o banco, mesmo sem a conexão")]
    public void Update_GenericWithADatabase_ReturnsScriptPlaceInvalid()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(database: "vendas", generic: true));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Database).WithErrorCode("SCRIPT_PLACE_INVALID");
    }

    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "OK sem o genérico, a conexão e o banco passam como antes")]
    public void Update_PlaceWithoutGeneric_ShouldBeOK()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        //Act
        var result = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(connectionID: Guid.CreateVersion7(), database: "vendas"));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>RN-SCRIPT-006: cada ícone da lista fechada, o vazio (volta ao padrão) e a cor `#RRGGBB` passam.</summary>
    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "OK todo ícone da lista, o vazio e a cor #RRGGBB ou vazia")]
    public void Update_IconFromTheListAndColor_ShouldBeOK()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        //Act
        var results = ScriptRules.Icons.Append("").Select(icon => validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(icon: icon, color: "#7db2ff"))).ToList();
        var blankColor = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(color: ""));

        //Assert
        Assert.Equal(12, results.Count);
        foreach (var result in results)
            result.ShouldNotHaveAnyValidationErrors();
        blankColor.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>A lista é fechada e é a da tela: um ícone que ela não tem, com outra caixa ou com outro nome, é recusado no campo.</summary>
    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "Erro ícone fora da lista")]
    public void Update_UnknownIcon_ReturnsScriptIconInvalid()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        foreach (var icon in new[] { "rocket", "Chart", "script", "../document" })
        {
            //Act
            var result = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(icon: icon));

            //Assert
            result.ShouldHaveValidationErrorFor(command => command.Icon).WithErrorCode("SCRIPT_ICON_INVALID");
        }
    }

    [Trait("UpdateScriptValidator", "UpdateScriptCommand")]
    [Fact(DisplayName = "Erro cor do ícone fora do formato #RRGGBB")]
    public void Update_InvalidColor_ReturnsScriptIconInvalid()
    {
        //Arrange
        var validator = new UpdateScriptValidator();

        foreach (var color in new[] { "azul", "#7DB2F", "7DB2FF", "#7DB2FG" })
        {
            //Act
            var result = validator.TestValidate(ScriptFakers.ReturnUpdateScriptCommandValid(color: color));

            //Assert
            result.ShouldHaveValidationErrorFor(command => command.Color).WithErrorCode("SCRIPT_ICON_INVALID");
        }
    }

    /// <summary>
    /// A lista que a regra tem, na ordem do diálogo. A conferência com a da tela (`scriptIcons`, em `src/client/src/app/workbench/_lib/saved-scripts.ts`) é do
    /// teste de lá, `saved-scripts.test.ts`, que lê este `ScriptRules.cs`.
    /// </summary>
    [Trait("ScriptRules", "Icons")]
    [Fact(DisplayName = "OK a lista dos ícones é a fechada, na ordem, com o documento como padrão")]
    public void Icons_ShouldBeTheClosedListInOrder_WithDocumentAsDefault()
    {
        //Assert
        Assert.Equal(["document", "code", "database", "table", "chart", "clock", "lightning", "bug", "wrench", "star", "flag"], ScriptRules.Icons);
        Assert.Equal("document", ScriptRules.DefaultIcon);
    }
}
