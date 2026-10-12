using FluentValidation.TestHelper;
using Prism.Application.Folders.Features.CreateFolder;
using Prism.Application.Folders.Features.UpdateFolder;
using Prism.TestingCore.Fakers.Folders;

namespace Prism.UnitTesting.Folders;

/// <summary>RN-PASTA-001: o nome tem de 1 a 60 caracteres depois de normalizado, e só ele é regra de validator (a pasta pai e o ID inexistentes são 404 do handler).</summary>
public sealed class FolderValidatorsTests
{
    private static void AssertCreateNameInvalid(string name)
    {
        //Arrange
        var validator = new CreateFolderValidator();

        //Act
        var result = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(name: name));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("FOLDER_NAME_INVALID");
    }

    private static void AssertUpdateNameInvalid(string name)
    {
        //Arrange
        var validator = new UpdateFolderValidator();

        //Act
        var result = validator.TestValidate(FolderFakers.ReturnUpdateFolderCommandValid(name: name));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("FOLDER_NAME_INVALID");
    }

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "OK nome e pasta pai válidos")]
    public void CreateFolder_ShouldBeOK()
    {
        //Arrange
        var validator = new CreateFolderValidator();

        //Act
        var root = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid());
        var child = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(parentID: Guid.CreateVersion7()));

        //Assert
        root.ShouldNotHaveAnyValidationErrors();
        child.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "OK nome com 1 e com 60 caracteres, também depois de normalizar")]
    public void CreateFolder_ShouldBeOK_AtTheLimits()
    {
        //Arrange
        var validator = new CreateFolderValidator();

        //Act
        var shortest = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(name: "a"));
        var longest = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(name: new string('a', 60)));
        var paddedLongest = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(name: $"   {new string('a', 60)}  "));

        //Assert
        shortest.ShouldNotHaveAnyValidationErrors();
        longest.ShouldNotHaveAnyValidationErrors();
        paddedLongest.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro nome vazio")]
    public void CreateFolder_ShouldBeError_NameEmpty()
        => AssertCreateNameInvalid(string.Empty);

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro nome só com espaços")]
    public void CreateFolder_ShouldBeError_NameBlank()
        => AssertCreateNameInvalid("   \t ");

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro nome com 61 caracteres")]
    public void CreateFolder_ShouldBeError_NameTooLong()
        => AssertCreateNameInvalid(new string('a', 61));

    /// <summary>O limite é do nome normalizado (RN-PASTA-001): os espaços das pontas e os repetidos não contam. Aqui 30 + 30 letras e um espaço continuam 61.</summary>
    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro nome que continua com 61 caracteres depois de normalizado")]
    public void CreateFolder_ShouldBeError_NameTooLongAfterNormalizing()
        => AssertCreateNameInvalid($"  {new string('a', 30)}   {new string('b', 30)}  ");

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro nome nulo no corpo")]
    public void CreateFolder_ShouldBeError_NameNull()
    {
        //Arrange
        var validator = new CreateFolderValidator();

        //Act
        var result = validator.TestValidate(new CreateFolderCommand { Name = null! });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("FOLDER_NAME_INVALID");
    }

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK nome válido")]
    public void UpdateFolder_ShouldBeOK()
    {
        //Arrange
        var validator = new UpdateFolderValidator();

        //Act
        var result = validator.TestValidate(FolderFakers.ReturnUpdateFolderCommandValid());

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK nome com 1 e com 60 caracteres")]
    public void UpdateFolder_ShouldBeOK_AtTheLimits()
    {
        //Arrange
        var validator = new UpdateFolderValidator();

        //Act
        var shortest = validator.TestValidate(FolderFakers.ReturnUpdateFolderCommandValid(name: "a"));
        var longest = validator.TestValidate(FolderFakers.ReturnUpdateFolderCommandValid(name: new string('a', 60)));

        //Assert
        shortest.ShouldNotHaveAnyValidationErrors();
        longest.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro nome vazio")]
    public void UpdateFolder_ShouldBeError_NameEmpty()
        => AssertUpdateNameInvalid(string.Empty);

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro nome só com espaços")]
    public void UpdateFolder_ShouldBeError_NameBlank()
        => AssertUpdateNameInvalid("   ");

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro nome com 61 caracteres")]
    public void UpdateFolder_ShouldBeError_NameTooLong()
        => AssertUpdateNameInvalid(new string('a', 61));
}
