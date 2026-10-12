using FluentValidation.TestHelper;
using Prism.Application.Users.Features.CreateUser;
using Prism.TestingCore.Fakers.Users;

namespace Prism.UnitTesting.Users;

/// <summary>RN-COFRE-010: o nome (3 a 32 caracteres, `a-z0-9._-`, sem nome de dispositivo do Windows) e a senha (8 a 128), um campo inválido por vez.</summary>
public sealed class CreateUserValidatorTests
{
    private static void AssertUserNameInvalid(string userName)
    {
        //Arrange
        var validator = new CreateUserValidator();

        //Act
        var result = validator.TestValidate(UserFakers.ReturnCreateUserCommandValid(userName: userName));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.UserName).WithErrorCode("USERNAME_INVALID");
        result.ShouldNotHaveValidationErrorFor(command => command.Password);
    }

    private static void AssertPasswordInvalid(string password)
    {
        //Arrange
        var validator = new CreateUserValidator();

        //Act
        var result = validator.TestValidate(UserFakers.ReturnCreateUserCommandValid(password: password));

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.Password).WithErrorCode("PASSWORD_INVALID");
        result.ShouldNotHaveValidationErrorFor(command => command.UserName);
    }

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "OK usuário e senha válidos")]
    public void Validate_ShouldBeOK()
    {
        //Arrange
        var validator = new CreateUserValidator();

        //Act
        var result = validator.TestValidate(UserFakers.ReturnCreateUserCommandValid());

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>A tela e a API normalizam do mesmo jeito: `Marina.Costa` vira `marina.costa` antes das regras, e não é recusado.</summary>
    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "OK maiúsculas e espaços nas pontas entram normalizados")]
    public void Validate_ShouldBeOK_WhenUserNameNeedsNormalizing()
    {
        //Arrange
        var validator = new CreateUserValidator();

        //Act
        var result = validator.TestValidate(UserFakers.ReturnCreateUserCommandValid(userName: "  Marina.Costa "));

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "OK nome com 3 e com 32 caracteres, senha com 8 e com 128")]
    public void Validate_ShouldBeOK_AtTheLimits()
    {
        //Arrange
        var validator = new CreateUserValidator();

        //Act
        var shortest = validator.TestValidate(UserFakers.ReturnCreateUserCommandValid(userName: "a-b", password: new string('x', 8)));
        var longest = validator.TestValidate(UserFakers.ReturnCreateUserCommandValid(userName: new string('a', 32), password: new string('x', 128)));

        //Assert
        shortest.ShouldNotHaveAnyValidationErrors();
        longest.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome com 2 caracteres")]
    public void Validate_ShouldBeError_UserNameTooShort()
        => AssertUserNameInvalid(new string('a', 2));

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome com 33 caracteres")]
    public void Validate_ShouldBeError_UserNameTooLong()
        => AssertUserNameInvalid(new string('a', 33));

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome vazio")]
    public void Validate_ShouldBeError_UserNameEmpty()
        => AssertUserNameInvalid("   ");

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome com espaço no meio")]
    public void Validate_ShouldBeError_UserNameWithSpace()
        => AssertUserNameInvalid("marina costa");

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome com barra")]
    public void Validate_ShouldBeError_UserNameWithSlash()
        => AssertUserNameInvalid("marina/costa");

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome com barra invertida")]
    public void Validate_ShouldBeError_UserNameWithBackslash()
        => AssertUserNameInvalid(@"marina\costa");

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome que sobe de pasta")]
    public void Validate_ShouldBeError_UserNameWithParentPath()
        => AssertUserNameInvalid(@"..\x");

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome começando com ponto")]
    public void Validate_ShouldBeError_UserNameStartingWithDot()
        => AssertUserNameInvalid(".marina");

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome com acento")]
    public void Validate_ShouldBeError_UserNameWithAccent()
        => AssertUserNameInvalid("josé");

    /// <summary>`con.vault.json` é o dispositivo `CON` no Windows, não um arquivo (RN-COFRE-001): a regra é a mesma checagem de nome de arquivo do cofre.</summary>
    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro nome de dispositivo do Windows")]
    public void Validate_ShouldBeError_UserNameIsWindowsDeviceName()
    {
        foreach (var deviceName in new[] { "con", "nul", "aux", "prn", "com1", "lpt1", "Con", "COM9", "con.txt", "nul.backup" })
            AssertUserNameInvalid(deviceName);
    }

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "OK nome que só lembra um dispositivo")]
    public void Validate_ShouldBeOK_WhenUserNameOnlyLooksLikeADevice()
    {
        //Arrange
        var validator = new CreateUserValidator();

        foreach (var lookalike in new[] { "console", "com10", "lpt0", "a.con" })
        {
            //Act
            var result = validator.TestValidate(UserFakers.ReturnCreateUserCommandValid(userName: lookalike));

            //Assert
            result.ShouldNotHaveAnyValidationErrors();
        }
    }

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro senha com 7 caracteres")]
    public void Validate_ShouldBeError_PasswordTooShort()
        => AssertPasswordInvalid(new string('x', 7));

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro senha com 129 caracteres")]
    public void Validate_ShouldBeError_PasswordTooLong()
        => AssertPasswordInvalid(new string('x', 129));

    [Trait("CreateUserValidator", "CreateUserCommand")]
    [Fact(DisplayName = "Erro campos nulos no corpo")]
    public void Validate_ShouldBeError_WhenFieldsAreNull()
    {
        //Arrange
        var validator = new CreateUserValidator();

        //Act
        var result = validator.TestValidate(new CreateUserCommand { UserName = null!, Password = null! });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.UserName).WithErrorCode("USERNAME_INVALID");
        result.ShouldHaveValidationErrorFor(command => command.Password).WithErrorCode("PASSWORD_INVALID");
    }
}
