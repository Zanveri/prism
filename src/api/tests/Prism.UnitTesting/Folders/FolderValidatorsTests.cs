using FluentValidation.TestHelper;
using Prism.Application.Folders.Features.CreateFolder;
using Prism.Application.Folders.Features.UpdateFolder;
using Prism.TestingCore.Fakers.Folders;

namespace Prism.UnitTesting.Folders;

/// <summary>
/// RN-PASTA-001: o nome tem de 1 a 60 caracteres depois de normalizado; RN-PASTA-005: o ambiente, opcional, segue as regras do ambiente da conexão, com a
/// recusa em `FOLDER_NAME_INVALID` no campo dele; RN-PASTA-007: a cor da pasta, opcional, é `#RRGGBB` como a do ambiente, e a recusa vai no mesmo código, no
/// campo dela. A pasta pai e o ID inexistentes são 404 do handler, e não regra de validator.
/// </summary>
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

    private static void AssertCreateInvalid(CreateFolderCommand command, string field)
    {
        //Arrange
        var validator = new CreateFolderValidator();

        //Act
        var result = validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(field).WithErrorCode("FOLDER_NAME_INVALID");
    }

    private static void AssertUpdateInvalid(UpdateFolderCommand command, string field)
    {
        //Arrange
        var validator = new UpdateFolderValidator();

        //Act
        var result = validator.TestValidate(command);

        //Assert
        result.ShouldHaveValidationErrorFor(field).WithErrorCode("FOLDER_NAME_INVALID");
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

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "OK com ambiente de 30 caracteres e cor #RRGGBB, e sem ambiente")]
    public void CreateFolder_ShouldBeOK_WithAndWithoutEnvironment()
    {
        //Arrange
        var validator = new CreateFolderValidator();

        //Act
        var with = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(environmentName: new string('a', 30), environmentColor: "#ff8a7a"));
        var blank = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(environmentName: "  ", environmentColor: ""));
        var without = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid());

        //Assert
        with.ShouldNotHaveAnyValidationErrors();
        blank.ShouldNotHaveAnyValidationErrors();
        without.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro ambiente com 31 caracteres")]
    public void CreateFolder_ShouldBeError_EnvironmentNameTooLong()
        => AssertCreateInvalid(FolderFakers.ReturnCreateFolderCommandValid(environmentName: new string('a', 31)), "EnvironmentName");

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro cor do ambiente fora do formato #RRGGBB")]
    public void CreateFolder_ShouldBeError_EnvironmentColorInvalid()
    {
        AssertCreateInvalid(FolderFakers.ReturnCreateFolderCommandValid(environmentColor: "red"), "EnvironmentColor");
        AssertCreateInvalid(FolderFakers.ReturnCreateFolderCommandValid(environmentColor: "#12345"), "EnvironmentColor");
        AssertCreateInvalid(FolderFakers.ReturnCreateFolderCommandValid(environmentColor: "#GGGGGG"), "EnvironmentColor");
    }

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro ambiente com 31 caracteres")]
    public void UpdateFolder_ShouldBeError_EnvironmentNameTooLong()
        => AssertUpdateInvalid(FolderFakers.ReturnUpdateFolderCommandValid(environmentName: new string('a', 31)), "EnvironmentName");

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro cor do ambiente fora do formato #RRGGBB")]
    public void UpdateFolder_ShouldBeError_EnvironmentColorInvalid()
        => AssertUpdateInvalid(FolderFakers.ReturnUpdateFolderCommandValid(environmentColor: "#1234567"), "EnvironmentColor");

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK com ambiente válido")]
    public void UpdateFolder_ShouldBeOK_WithEnvironment()
    {
        //Arrange
        var validator = new UpdateFolderValidator();

        //Act
        var result = validator.TestValidate(FolderFakers.ReturnUpdateFolderCommandValid(environmentName: "Produção", environmentColor: "#FF8A7A"));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "OK com cor da pasta #RRGGBB, em branco e sem ela")]
    public void CreateFolder_ShouldBeOK_WithAndWithoutColor()
    {
        //Arrange
        var validator = new CreateFolderValidator();

        //Act
        var with = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(color: "#7db2ff"));
        var blank = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(color: " "));
        var without = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid());

        //Assert
        with.ShouldNotHaveAnyValidationErrors();
        blank.ShouldNotHaveAnyValidationErrors();
        without.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "Erro cor da pasta fora do formato #RRGGBB")]
    public void CreateFolder_ShouldBeError_ColorInvalid()
    {
        AssertCreateInvalid(FolderFakers.ReturnCreateFolderCommandValid(color: "azul"), "Color");
        AssertCreateInvalid(FolderFakers.ReturnCreateFolderCommandValid(color: "7DB2FF"), "Color");
        AssertCreateInvalid(FolderFakers.ReturnCreateFolderCommandValid(color: "#7DB2FG"), "Color");
    }

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "Erro cor da pasta fora do formato #RRGGBB, e OK com ela válida")]
    public void UpdateFolder_ShouldValidateTheColor()
    {
        //Arrange
        var validator = new UpdateFolderValidator();

        //Act
        var valid = validator.TestValidate(FolderFakers.ReturnUpdateFolderCommandValid(color: "#B79CFF"));

        //Assert
        valid.ShouldNotHaveAnyValidationErrors();
        AssertUpdateInvalid(FolderFakers.ReturnUpdateFolderCommandValid(color: "#B79"), "Color");
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

    /// <summary>RN-PROT-001: a confirmação é uma da lista, e a recusa vai no código das pastas, no campo dela.</summary>
    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "OK com as proteções, e erro na confirmação fora da lista")]
    public void CreateFolder_ShouldValidateTheConfirmation()
    {
        //Arrange
        var validator = new CreateFolderValidator();

        //Act
        var valid = validator.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(confirmCommands: "all", readOnly: true));

        //Assert
        valid.ShouldNotHaveAnyValidationErrors();
        AssertCreateInvalid(FolderFakers.ReturnCreateFolderCommandValid(confirmCommands: "todos"), nameof(CreateFolderCommand.ConfirmCommands));
    }

    [Trait("UpdateFolderValidator", "UpdateFolderCommand")]
    [Fact(DisplayName = "OK com as proteções e a senha do usuário, e erro na confirmação fora da lista")]
    public void UpdateFolder_ShouldValidateTheConfirmation()
    {
        //Arrange
        var validator = new UpdateFolderValidator();

        //Act
        var valid = validator.TestValidate(FolderFakers.ReturnUpdateFolderCommandValid(confirmCommands: "irreversible", readOnly: true, userPassword: "senha"));

        //Assert
        valid.ShouldNotHaveAnyValidationErrors();
        AssertUpdateInvalid(FolderFakers.ReturnUpdateFolderCommandValid(confirmCommands: "Irreversible"), nameof(UpdateFolderCommand.ConfirmCommands));
    }

    /// <summary>
    /// RN-PASTA-001 (seção 34): o nome e o ambiente da pasta não têm caractere de controle nem de direção do texto, conferido depois da normalização (que
    /// troca a tabulação e a quebra de linha por um espaço), na criação e na alteração, com a frase de cada um: a pasta exportada com um nome desses não
    /// voltaria pela importação.
    /// </summary>
    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Theory(DisplayName = "Erro caractere de controle ou de direção do texto no nome ou no ambiente da pasta")]
    [InlineData("\u202E")]
    [InlineData("\u0007")]
    [InlineData("\u0085X\u0080")]
    [InlineData("\u2068")]
    [InlineData("\u200F")]
    public void Folder_ShouldBeError_ControlOrDirectionCharacter(string escaped)
    {
        //Arrange
        var character = System.Text.RegularExpressions.Regex.Unescape(escaped);
        var create = new CreateFolderValidator();
        var update = new UpdateFolderValidator();

        //Act
        var createdName = create.TestValidate(FolderFakers.ReturnCreateFolderCommandValid(name: $"Produ{character}ção"));
        var updatedName = update.TestValidate(FolderFakers.ReturnUpdateFolderCommandValid(name: $"Produ{character}ção"));
        var createdEnvironment = create.TestValidate(FolderFakers.ReturnCreateFolderCommandValid() with { EnvironmentName = $"Prod{character}uction" });

        //Assert
        createdName.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("FOLDER_NAME_INVALID").WithErrorMessage("O nome da pasta não pode ter caractere de controle nem de direção do texto.");
        updatedName.ShouldHaveValidationErrorFor(command => command.Name).WithErrorCode("FOLDER_NAME_INVALID").WithErrorMessage("O nome da pasta não pode ter caractere de controle nem de direção do texto.");
        createdEnvironment.ShouldHaveValidationErrorFor(command => command.EnvironmentName).WithErrorCode("FOLDER_NAME_INVALID").WithErrorMessage("O ambiente não pode ter caractere de controle nem de direção do texto.");
    }

    [Trait("CreateFolderValidator", "CreateFolderCommand")]
    [Fact(DisplayName = "OK tabulação e quebra de linha no nome da pasta viram espaço, e passam")]
    public void CreateFolder_ShouldBeOK_TabAndNewLineAreNormalized()
    {
        //Act
        var result = new CreateFolderValidator().TestValidate(FolderFakers.ReturnCreateFolderCommandValid(name: "Estoque\tProduction\nPRD"));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }
}
