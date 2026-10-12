using Moq;
using Prism.Application.Sessions.Features.GetSession;
using Prism.Infrastructure.Vault.Services;

namespace Prism.UnitTesting.Sessions;

public sealed class GetSessionHandlerTests
{
    private readonly Mock<IVaultService> _vault = new();

    [Trait("GetSessionHandler", "GetSessionCommand")]
    [Fact(DisplayName = "OK cofre aberto devolve o usuário")]
    public async Task Handle_ShouldBeOK_WhenUnlocked()
    {
        //Arrange
        _vault.SetupGet(v => v.UserName).Returns("marina.costa");
        var handler = new GetSessionHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetSessionCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.True(result.Value.Unlocked);
        Assert.Equal("marina.costa", result.Value.UserName);
        _vault.VerifyGet(v => v.UserName, Times.Once);
        _vault.VerifyNoOtherCalls();
    }

    [Trait("GetSessionHandler", "GetSessionCommand")]
    [Fact(DisplayName = "OK cofre fechado devolve sem usuário")]
    public async Task Handle_ShouldBeOK_WhenLocked()
    {
        //Arrange
        _vault.SetupGet(v => v.UserName).Returns((string?)null);
        var handler = new GetSessionHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new GetSessionCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        Assert.False(result.Value.Unlocked);
        Assert.Null(result.Value.UserName);
        _vault.VerifyGet(v => v.UserName, Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
