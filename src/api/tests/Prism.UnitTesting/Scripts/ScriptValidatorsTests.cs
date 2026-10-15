using FluentValidation.TestHelper;
using Prism.Application.Scripts.Features.CreateScript;
using Prism.Application.Scripts.Features.UpdateScript;
using Prism.TestingCore.Fakers.Scripts;

namespace Prism.UnitTesting.Scripts;

/// <summary>
/// RN-SCRIPT-004: o nome tem de 1 a 200 caracteres depois de normalizado e nenhum caractere de controle (nem tabulação nem quebra de linha, que a
/// normalização trocaria por espaço); o SQL tem até 1 MB, contado em bytes de UTF-8 (1.048.576). A unicidade do nome não é regra daqui: é 409 do repository.
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
}
