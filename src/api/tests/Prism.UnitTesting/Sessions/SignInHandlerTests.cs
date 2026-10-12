using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Sessions.Features.SignIn;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Users;
using System.Net;

namespace Prism.UnitTesting.Sessions;

public sealed class SignInHandlerTests
{
    private readonly Mock<IVaultService> _vault = new();

    [Trait("SignInHandler", "SignInCommand")]
    [Fact(DisplayName = "OK entra com o nome normalizado e a senha como veio")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnSignInCommandValid(userName: "  Marina.Costa ", password: " senha com espaços nas pontas ");
        _vault.Setup(v => v.UnlockAsync("marina.costa", " senha com espaços nas pontas ", cancellationToken)).ReturnsAsync(UnitResult.Success<EVaultError>());
        var handler = new SignInHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Unlocked);
        Assert.Equal("marina.costa", result.Value.UserName);
        _vault.Verify(v => v.UnlockAsync("marina.costa", " senha com espaços nas pontas ", cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>Ruling 18: o nome fora das regras não é recusado aqui. O serviço do cofre responde `InvalidCredentials` depois da mesma derivação de uma senha errada (RN-COFRE-006).</summary>
    [Trait("SignInHandler", "SignInCommand")]
    [Fact(DisplayName = "OK nome fora das regras segue para o cofre sem validação de formato")]
    public async Task Handle_ShouldPassAnyUserNameToTheVault()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnSignInCommandValid(userName: @"CON\..", password: string.Empty);
        _vault.Setup(v => v.UnlockAsync(@"con\..", string.Empty, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.InvalidCredentials));
        var handler = new SignInHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_CREDENTIALS", result.Error.Type);
        _vault.Verify(v => v.UnlockAsync(@"con\..", string.Empty, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("SignInHandler", "SignInCommand")]
    [Fact(DisplayName = "Erro usuário ou senha inválidos")]
    public async Task Handle_ShouldBeError_IVaultService_UnlockAsync_InvalidCredentials()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnSignInCommandValid();
        _vault.Setup(v => v.UnlockAsync(command.UserName, command.Password, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.InvalidCredentials));
        var handler = new SignInHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_CREDENTIALS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, result.Error.StatusCode);
        _vault.Verify(v => v.UnlockAsync(command.UserName, command.Password, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("SignInHandler", "SignInCommand")]
    [Fact(DisplayName = "Erro disco indisponível")]
    public async Task Handle_ShouldBeError_IVaultService_UnlockAsync_Unavailable()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnSignInCommandValid();
        _vault.Setup(v => v.UnlockAsync(command.UserName, command.Password, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.Unavailable));
        var handler = new SignInHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_UNAVAILABLE", result.Error.Type);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, result.Error.StatusCode);
        _vault.Verify(v => v.UnlockAsync(command.UserName, command.Password, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    /// <summary>RN-VERSAO-005: a única entrada recusada que não responde 401; o handler só traduz.</summary>
    [Trait("SignInHandler", "SignInCommand")]
    [Fact(DisplayName = "Erro cofre de formato mais novo")]
    public async Task Handle_ShouldBeError_IVaultService_UnlockAsync_FormatUnsupported()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnSignInCommandValid();
        _vault.Setup(v => v.UnlockAsync(command.UserName, command.Password, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.FormatUnsupported));
        var handler = new SignInHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_FORMAT_UNSUPPORTED", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _vault.Verify(v => v.UnlockAsync(command.UserName, command.Password, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
