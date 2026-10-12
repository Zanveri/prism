using Moq;
using Prism.Application.Sessions.Features.SignOut;
using Prism.Infrastructure.Vault.Services;

namespace Prism.UnitTesting.Sessions;

public sealed class SignOutHandlerTests
{
    private readonly Mock<IVaultService> _vault = new();

    /// <summary>RN-COFRE-008: sair fecha o cofre, e fechar um cofre que já está fechado também é sucesso.</summary>
    [Trait("SignOutHandler", "SignOutCommand")]
    [Fact(DisplayName = "OK fecha o cofre")]
    public async Task Handle_ShouldBeOK()
    {
        //Arrange
        var handler = new SignOutHandler(_vault.Object);

        //Act
        var result = await handler.Handle(new SignOutCommand(), CancellationToken.None);

        //Assert
        Assert.True(result.IsSuccess);
        _vault.Verify(v => v.Lock(), Times.Once);
        _vault.VerifyNoOtherCalls();
    }
}
