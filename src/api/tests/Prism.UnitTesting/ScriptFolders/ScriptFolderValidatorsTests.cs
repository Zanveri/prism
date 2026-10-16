using FluentValidation.TestHelper;
using Prism.Application.ScriptFolders.Features.CreateScriptFolder;
using Prism.Application.ScriptFolders.Features.UpdateScriptFolder;
using Prism.TestingCore.Fakers.ScriptFolders;

namespace Prism.UnitTesting.ScriptFolders;

/// <summary>
/// RN-SCRIPT-007: o nome da pasta de scripts tem de 1 a 60 caracteres depois de normalizado, como o da pasta de conexões, e nenhum caractere de controle no
/// texto que veio (nem tabulação nem quebra de linha, que a normalização trocaria por espaço), como o nome do script. O nome repetido entre as irmãs não é
/// regra daqui: é 409 do repository.
/// </summary>
public sealed class ScriptFolderValidatorsTests
{
    public static TheoryData<string> InvalidNames()
        => ["", "   ", new string('a', 61), "Fechamento\u0001", "Fecha\tmento", "Fecha\nmento", "Fecha\rmento", "\u007FFechamento", "Fechamento\u0085", "\0"];

    [Trait("CreateScriptFolderValidator", "CreateScriptFolderCommand")]
    [Fact(DisplayName = "OK nome válido, na raiz e dentro de outra pasta")]
    public void Create_ShouldBeOK()
    {
        //Arrange
        var validator = new CreateScriptFolderValidator();

        //Act
        var atRoot = validator.TestValidate(ScriptFolderFakers.ReturnCreateScriptFolderCommandValid(name: "Fechamento"));
        var inside = validator.TestValidate(ScriptFolderFakers.ReturnCreateScriptFolderCommandValid(name: "Mensal", parentID: Guid.CreateVersion7()));

        //Assert
        atRoot.ShouldNotHaveAnyValidationErrors();
        inside.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateScriptFolderValidator", "CreateScriptFolderCommand")]
    [Fact(DisplayName = "OK nome de 60 caracteres depois de normalizado")]
    public void Create_ShouldBeOK_AtTheLimit()
    {
        //Arrange
        var validator = new CreateScriptFolderValidator();

        //Act
        var result = validator.TestValidate(ScriptFolderFakers.ReturnCreateScriptFolderCommandValid(name: $"  {new string('é', 60)}  "));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateScriptFolderValidator", "CreateScriptFolderCommand")]
    [Theory(DisplayName = "Erro nome vazio, longo demais ou com caractere de controle responde SCRIPT_FOLDER_NAME_INVALID no campo")]
    [MemberData(nameof(InvalidNames))]
    public void Create_InvalidName_IsRefused(string name)
    {
        //Arrange
        var validator = new CreateScriptFolderValidator();

        //Act
        var result = validator.TestValidate(ScriptFolderFakers.ReturnCreateScriptFolderCommandValid(name: name));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("SCRIPT_FOLDER_NAME_INVALID");
    }

    [Trait("UpdateScriptFolderValidator", "UpdateScriptFolderCommand")]
    [Fact(DisplayName = "OK nome válido, na raiz e dentro de outra pasta")]
    public void Update_ShouldBeOK()
    {
        //Arrange
        var validator = new UpdateScriptFolderValidator();

        //Act
        var atRoot = validator.TestValidate(ScriptFolderFakers.ReturnUpdateScriptFolderCommandValid(name: "Fechamento"));
        var inside = validator.TestValidate(ScriptFolderFakers.ReturnUpdateScriptFolderCommandValid(name: $"  {new string('é', 60)}  ", parentID: Guid.CreateVersion7()));

        //Assert
        atRoot.ShouldNotHaveAnyValidationErrors();
        inside.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("UpdateScriptFolderValidator", "UpdateScriptFolderCommand")]
    [Theory(DisplayName = "Erro nome vazio, longo demais ou com caractere de controle responde SCRIPT_FOLDER_NAME_INVALID no campo")]
    [MemberData(nameof(InvalidNames))]
    public void Update_InvalidName_IsRefused(string name)
    {
        //Arrange
        var validator = new UpdateScriptFolderValidator();

        //Act
        var result = validator.TestValidate(ScriptFolderFakers.ReturnUpdateScriptFolderCommandValid(name: name));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("SCRIPT_FOLDER_NAME_INVALID");
    }
}
