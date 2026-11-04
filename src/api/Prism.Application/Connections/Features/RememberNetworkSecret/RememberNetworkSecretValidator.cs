using FluentValidation;
using Prism.Application.Connections.Models;

namespace Prism.Application.Connections.Features.RememberNetworkSecret;

public sealed class RememberNetworkSecretValidator : AbstractValidator<RememberNetworkSecretCommand>
{
    public RememberNetworkSecretValidator()
    {
        // RN-CONN-010: os tetos do formulário, contados como vieram (o segredo não é aparado).
        RuleFor(request => request.SshSecret).Must(secret => secret is not { Length: > ConnectionRules.PasswordMaxLength }).WithMessage("A senha ou frase secreta do SSH pode ter até 1.024 caracteres.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.ProxyPassword).Must(password => password is not { Length: > ConnectionRules.PasswordMaxLength }).WithMessage("A senha do proxy SOCKS pode ter até 1.024 caracteres.").WithErrorCode("CONNECTION_INVALID");
    }
}
