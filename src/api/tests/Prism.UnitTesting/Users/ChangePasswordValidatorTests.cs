using FluentValidation.TestHelper;
using Prism.Application.Users.Features.ChangePassword;
using Prism.Application.Users.Features.CreateUser;
using Prism.TestingCore.Fakers.Users;

namespace Prism.UnitTesting.Users;

/// <summary>
/// RN-COFRE-013: a senha nova segue EXATAMENTE as regras da criação de conta (RN-COFRE-010: de 8 a 128 caracteres, sem regra de composição), e
/// quem as define é uma só (`UserPasswordRules`). A senha atual não é validada aqui: qualquer texto é só uma senha errada, e responde com a
/// derivação, como uma entrada errada.
/// </summary>
public sealed class ChangePasswordValidatorTests
{
    private static void AssertNewPasswordInvalid(string? newPassword)
    {
        //Arrange
        var validator = new ChangePasswordValidator();

        //Act
        var result = validator.TestValidate(new ChangePasswordCommand { CurrentPassword = UserFakers.RandomPassword(), NewPassword = newPassword! });

        //Assert
        result.ShouldHaveValidationErrorFor(command => command.NewPassword).WithErrorCode("PASSWORD_INVALID").WithErrorMessage("A senha deve ter de 8 a 128 caracteres.");
        result.ShouldNotHaveValidationErrorFor(command => command.CurrentPassword);
    }

    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "OK senhas válidas")]
    public void Validate_ShouldBeOK()
    {
        //Arrange
        var validator = new ChangePasswordValidator();

        //Act
        var result = validator.TestValidate(UserFakers.ReturnChangePasswordCommandValid());

        //Assert
        result.ShouldNotHaveAnyValidationErrors();
    }

    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "OK senha nova com 8 e com 128 caracteres")]
    public void Validate_ShouldBeOK_AtTheLimits()
    {
        //Arrange
        var validator = new ChangePasswordValidator();

        //Act
        var shortest = validator.TestValidate(UserFakers.ReturnChangePasswordCommandValid(newPassword: new string('x', 8)));
        var longest = validator.TestValidate(UserFakers.ReturnChangePasswordCommandValid(newPassword: new string('x', 128)));

        //Assert
        shortest.ShouldNotHaveAnyValidationErrors();
        longest.ShouldNotHaveAnyValidationErrors();
    }

    /// <summary>Sem regra de composição (RN-COFRE-010): oito espaços, e uma senha com espaços nas pontas, valem como na criação.</summary>
    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "OK sem regra de composição")]
    public void Validate_ShouldBeOK_WithoutCompositionRules()
    {
        //Arrange
        var validator = new ChangePasswordValidator();

        foreach (var newPassword in new[] { "        ", " senha com espaços ", "12345678", "aaaaaaaa", "ÁÉÍÓÚçãõ" })
        {
            //Act
            var result = validator.TestValidate(UserFakers.ReturnChangePasswordCommandValid(newPassword: newPassword));

            //Assert
            result.ShouldNotHaveAnyValidationErrors();
        }
    }

    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "Erro senha nova com 7 caracteres")]
    public void Validate_ShouldBeError_NewPasswordTooShort()
        => AssertNewPasswordInvalid(new string('x', 7));

    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "Erro senha nova com 129 caracteres")]
    public void Validate_ShouldBeError_NewPasswordTooLong()
        => AssertNewPasswordInvalid(new string('x', 129));

    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "Erro senha nova vazia")]
    public void Validate_ShouldBeError_NewPasswordEmpty()
        => AssertNewPasswordInvalid(string.Empty);

    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "Erro senha nova nula")]
    public void Validate_ShouldBeError_NewPasswordNull()
        => AssertNewPasswordInvalid(null);

    /// <summary>
    /// A senha atual errada responde com a derivação do cofre (e conta uma das cinco tentativas), e não com um 422 de formato que dispensaria a
    /// derivação e diria a quem tenta como é uma senha válida. Vazia, curta ou longa, ela passa pelo validator.
    /// </summary>
    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "OK a senha atual não é validada")]
    public void Validate_ShouldBeOK_WhateverTheCurrentPasswordIs()
    {
        //Arrange
        var validator = new ChangePasswordValidator();

        foreach (var currentPassword in new[] { string.Empty, "x", new string('x', 7), new string('x', 129), "   " })
        {
            //Act
            var result = validator.TestValidate(UserFakers.ReturnChangePasswordCommandValid(currentPassword: currentPassword));

            //Assert
            result.ShouldNotHaveAnyValidationErrors();
        }
    }

    /// <summary>A regra é a mesma da criação de conta: os mesmos casos dão o mesmo veredito, o mesmo código e a mesma mensagem nos dois validators.</summary>
    [Trait("ChangePasswordValidator", "ChangePasswordCommand")]
    [Fact(DisplayName = "OK mesmo veredito, código e mensagem da criação de conta")]
    public void Validate_GivesTheSameVerdictAsCreateUser()
    {
        //Arrange
        var change = new ChangePasswordValidator();
        var create = new CreateUserValidator();

        foreach (var password in new[] { null, string.Empty, "x", new string('x', 7), new string('x', 8), new string('x', 128), new string('x', 129), "        ", "ÁÉÍÓÚçãõ", "12345678" })
        {
            //Act
            var changed = change.TestValidate(new ChangePasswordCommand { CurrentPassword = "qualquer", NewPassword = password! }).Errors.Select(error => (error.ErrorCode, error.ErrorMessage)).ToList();
            var created = create.TestValidate(new CreateUserCommand { UserName = "marina.costa", Password = password! }).Errors.Select(error => (error.ErrorCode, error.ErrorMessage)).ToList();

            //Assert
            Assert.Equal(created, changed);
        }
    }
}
