using Prism.Application.Common.Vault;
using Prism.Infrastructure.Vault.Models;
using System.Net;

namespace Prism.UnitTesting.Common;

public sealed class VaultErrorsTests
{
    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "OK Locked vira 401 VAULT_LOCKED")]
    public void From_Locked_Is401VaultLocked()
    {
        //Act
        var error = VaultErrors.From(EVaultError.Locked);

        //Assert
        Assert.Equal("VAULT_LOCKED", error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, error.StatusCode);
    }

    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "OK Unavailable vira 503 VAULT_UNAVAILABLE")]
    public void From_Unavailable_Is503VaultUnavailable()
    {
        //Act
        var error = VaultErrors.From(EVaultError.Unavailable);

        //Assert
        Assert.Equal("VAULT_UNAVAILABLE", error.Type);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, error.StatusCode);
    }

    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "OK InvalidCredentials vira 401 INVALID_CREDENTIALS")]
    public void From_InvalidCredentials_Is401InvalidCredentials()
    {
        //Act
        var error = VaultErrors.From(EVaultError.InvalidCredentials);

        //Assert
        Assert.Equal("INVALID_CREDENTIALS", error.Type);
        Assert.Equal(HttpStatusCode.Unauthorized, error.StatusCode);
    }

    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "OK UserAlreadyExists vira 409 USER_ALREADY_EXISTS")]
    public void From_UserAlreadyExists_Is409UserAlreadyExists()
    {
        //Act
        var error = VaultErrors.From(EVaultError.UserAlreadyExists);

        //Assert
        Assert.Equal("USER_ALREADY_EXISTS", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
    }

    /// <summary>
    /// RN-COFRE-013: 422, e não o 401 de `INVALID_CREDENTIALS` da entrada (a chamada já está autenticada, e a tela renova a sessão e repete todo 401), e com o
    /// MESMO código que a revelação de senha usa para a senha do usuário errada: `INVALID_PASSWORD`. `PASSWORD_INVALID` é o da senha nova inválida.
    /// </summary>
    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "OK CurrentPasswordInvalid vira 422 INVALID_PASSWORD, como a revelação de senha, e não 401")]
    public void From_CurrentPasswordInvalid_Is422InvalidPassword()
    {
        //Act
        var error = VaultErrors.From(EVaultError.CurrentPasswordInvalid);

        //Assert
        Assert.Equal("INVALID_PASSWORD", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
    }

    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "OK PasswordUnchanged vira 422 PASSWORD_UNCHANGED")]
    public void From_PasswordUnchanged_Is422PasswordUnchanged()
    {
        //Act
        var error = VaultErrors.From(EVaultError.PasswordUnchanged);

        //Assert
        Assert.Equal("PASSWORD_UNCHANGED", error.Type);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, error.StatusCode);
    }

    /// <summary>RN-VERSAO-005: a recusa do cofre de formato mais novo diz o que fazer (atualizar o Prism), e não "credencial inválida".</summary>
    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "OK FormatUnsupported vira 409 VAULT_FORMAT_UNSUPPORTED com o pedido para atualizar o Prism")]
    public void From_FormatUnsupported_Is409VaultFormatUnsupported()
    {
        //Act
        var error = VaultErrors.From(EVaultError.FormatUnsupported);

        //Assert
        Assert.Equal("VAULT_FORMAT_UNSUPPORTED", error.Type);
        Assert.Equal(HttpStatusCode.Conflict, error.StatusCode);
        Assert.Equal("Cofre de uma versão mais nova do Prism.", error.Title);
        Assert.Equal("Este cofre foi criado por uma versão mais nova do Prism. Atualize o Prism para abri-lo.", error.Detail);
    }

    /// <summary>Um valor novo do enum sem caso no `From` cairia em 500 na primeira vez que o serviço o devolvesse.</summary>
    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "OK todo valor do enum do cofre tem mapeamento")]
    public void From_EveryVaultErrorKind_IsMapped()
    {
        //Act
        var unmapped = Enum.GetValues<EVaultError>().Where(kind => Record.Exception(() => VaultErrors.From(kind)) is not null).ToList();

        //Assert
        Assert.Empty(unmapped);
    }

    [Trait("VaultErrors", "From")]
    [Fact(DisplayName = "Erro valor do enum que ninguém mapeou")]
    public void From_UnmappedValue_Throws()
    {
        //Act
        var exception = Record.Exception(() => VaultErrors.From((EVaultError)999));

        //Assert
        Assert.IsType<NotImplementedException>(exception);
    }
}
