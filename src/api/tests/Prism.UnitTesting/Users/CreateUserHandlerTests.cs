using CSharpFunctionalExtensions;
using Moq;
using Prism.Application.Users.Features.CreateUser;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;
using Prism.TestingCore.Fakers.Users;
using System.Net;

namespace Prism.UnitTesting.Users;

public sealed class CreateUserHandlerTests
{
    private readonly Mock<IVaultService> _vault = new();

    [Trait("CreateUserHandler", "CreateUserCommand")]
    [Fact(DisplayName = "OK cria o cofre com o nome normalizado e a senha como veio")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnCreateUserCommandValid(userName: "  Marina.Costa ", password: " senha com espaços nas pontas ");
        _vault.Setup(v => v.CreateAsync("marina.costa", " senha com espaços nas pontas ", cancellationToken)).ReturnsAsync(UnitResult.Success<EVaultError>());
        var handler = new CreateUserHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Unlocked);
        Assert.Equal("marina.costa", result.Value.UserName);
        _vault.Verify(v => v.CreateAsync("marina.costa", " senha com espaços nas pontas ", cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("CreateUserHandler", "CreateUserCommand")]
    [Fact(DisplayName = "Erro usuário já existe")]
    public async Task Handle_ShouldBeError_IVaultService_CreateAsync_UserAlreadyExists()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnCreateUserCommandValid();
        _vault.Setup(v => v.CreateAsync(command.UserName, command.Password, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.UserAlreadyExists));
        var handler = new CreateUserHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("USER_ALREADY_EXISTS", result.Error.Type);
        Assert.Equal(HttpStatusCode.Conflict, result.Error.StatusCode);
        _vault.Verify(v => v.CreateAsync(command.UserName, command.Password, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("CreateUserHandler", "CreateUserCommand")]
    [Fact(DisplayName = "Erro disco indisponível")]
    public async Task Handle_ShouldBeError_IVaultService_CreateAsync_Unavailable()
    {
        //Arrange
        var cancellationToken = new CancellationToken();
        var command = UserFakers.ReturnCreateUserCommandValid();
        _vault.Setup(v => v.CreateAsync(command.UserName, command.Password, cancellationToken)).ReturnsAsync(UnitResult.Failure(EVaultError.Unavailable));
        var handler = new CreateUserHandler(_vault.Object);

        //Act
        var result = await handler.Handle(command, cancellationToken);

        //Assert
        Assert.True(result.IsFailure);
        Assert.Equal("VAULT_UNAVAILABLE", result.Error.Type);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, result.Error.StatusCode);
        _vault.Verify(v => v.CreateAsync(command.UserName, command.Password, cancellationToken), Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
