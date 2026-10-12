using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Users.Features.ChangePassword;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Users;
using System.Net;

namespace Prism.UnitTesting.Users;

/// <summary>
/// RN-COFRE-013. Quem confere a senha atual, recusa a igual, re-embrulha e grava é o serviço do cofre, numa operação só (com o semáforo tomado): o
/// handler entrega as duas senhas como vieram e traduz a recusa.
/// </summary>
public sealed class ChangePasswordHandlerTests
{
    private readonly Mock<IVaultService> _vault = new();

    [Trait("ChangePasswordHandler", "ChangePasswordCommand")]
    [Fact(DisplayName = "OK entrega as duas senhas como vieram, com os espaços nas pontas")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnChangePasswordCommandValid(currentPassword: " senha atual com espaços ", newPassword: " senha nova com espaços ");
        _vault.Setup(v => v.ChangePasswordAsync(" senha atual com espaços ", " senha nova com espaços ", cancellationToken)).ReturnsAsync(UnitResult.Success<EVaultError>());
        var handler = new ChangePasswordHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        _vault.Verify(v => v.ChangePasswordAsync(" senha atual com espaços ", " senha nova com espaços ", cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("ChangePasswordHandler", "ChangePasswordCommand")]
    [Fact(DisplayName = "Erro senha atual errada")]
    public async Task Handle_ShouldBeError_IVaultService_ChangePasswordAsync_CurrentPasswordInvalid()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnChangePasswordCommandValid();
        _vault.Setup(v => v.ChangePasswordAsync(command.CurrentPassword, command.NewPassword, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.CurrentPasswordInvalid));
        var handler = new ChangePasswordHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_PASSWORD", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        _vault.Verify(v => v.ChangePasswordAsync(command.CurrentPassword, command.NewPassword, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("ChangePasswordHandler", "ChangePasswordCommand")]
    [Fact(DisplayName = "Erro senha nova igual à atual")]
    public async Task Handle_ShouldBeError_IVaultService_ChangePasswordAsync_PasswordUnchanged()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnChangePasswordCommandValid();
        _vault.Setup(v => v.ChangePasswordAsync(command.CurrentPassword, command.NewPassword, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.PasswordUnchanged));
        var handler = new ChangePasswordHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("PASSWORD_UNCHANGED", result.Error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, result.Error.StatusCode);
        _vault.Verify(v => v.ChangePasswordAsync(command.CurrentPassword, command.NewPassword, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>O quinto erro seguido fecha o cofre (RN-CONN-003): a resposta é a do cofre fechado, e não a de senha errada.</summary>
    [Trait("ChangePasswordHandler", "ChangePasswordCommand")]
    [Fact(DisplayName = "Erro cofre fechado")]
    public async Task Handle_ShouldBeError_IVaultService_ChangePasswordAsync_Locked()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnChangePasswordCommandValid();
        _vault.Setup(v => v.ChangePasswordAsync(command.CurrentPassword, command.NewPassword, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.Locked));
        var handler = new ChangePasswordHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_LOCKED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _vault.Verify(v => v.ChangePasswordAsync(command.CurrentPassword, command.NewPassword, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("ChangePasswordHandler", "ChangePasswordCommand")]
    [Fact(DisplayName = "Erro disco indisponível")]
    public async Task Handle_ShouldBeError_IVaultService_ChangePasswordAsync_Unavailable()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnChangePasswordCommandValid();
        _vault.Setup(v => v.ChangePasswordAsync(command.CurrentPassword, command.NewPassword, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.Unavailable));
        var handler = new ChangePasswordHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_UNAVAILABLE", result.Error.Type);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, result.Error.StatusCode);
        _vault.Verify(v => v.ChangePasswordAsync(command.CurrentPassword, command.NewPassword, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
