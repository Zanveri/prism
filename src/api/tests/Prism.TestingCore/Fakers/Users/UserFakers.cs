using Bogus;
using Prism.Application.Sessions.Features.SignIn;
using Prism.Application.Users.Features.ChangePassword;
using Prism.Application.Users.Features.CreateUser;

namespace Prism.TestingCore.Fakers.Users;

/// <summary>
/// Os comandos de criação de usuário, de entrada e de troca de senha. Cada parâmetro fixa um campo; o que o teste não
/// nomeia é sorteado, e é assim que um caso inválido quebra um campo por vez.
/// </summary>
public static class UserFakers
{
    private const string Letters = "abcdefghijklmnopqrstuvwxyz";

    public static CreateUserCommand ReturnCreateUserCommandValid(string? userName = null, string? password = null)
        => new() { UserName = userName ?? RandomUserName(), Password = password ?? RandomPassword() };

    public static SignInCommand ReturnSignInCommandValid(string? userName = null, string? password = null)
        => new() { UserName = userName ?? RandomUserName(), Password = password ?? RandomPassword() };

    public static ChangePasswordCommand ReturnChangePasswordCommandValid(string? currentPassword = null, string? newPassword = null)
        => new() { CurrentPassword = currentPassword ?? RandomPassword(), NewPassword = newPassword ?? RandomPassword() };

    public static string RandomUserName()
        => new Faker().Random.String2(length: 12, chars: Letters);

    public static string RandomPassword()
        => new Faker().Internet.Password(length: 16);
}
