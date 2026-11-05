using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Common.Texts;
using Prism.Application.Connections.Models;

namespace Prism.Application.Connections.Features.TestConnection;

public sealed class TestConnectionValidator : AbstractValidator<TestConnectionCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>TestConnectionValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(TestConnectionValidator));

    public TestConnectionValidator()
    {
        // RN-CONN-010: os mesmos campos e limites do `CreateConnectionValidator` (as regras do `ConnectionRules`, com os tetos e sem caractere de controle nem
        // de direção do texto), menos o que só serve para gravar (nome, pasta, ambiente). O usuário em branco continua sendo recusado aqui (RN-TRANSF-016).
        RuleFor(request => request.Engine).IsInEnum().WithMessage(_ => Texts.Get("EngineRequired")).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Host).MustPass(ConnectionRules.HostRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Port).MustPass(ConnectionRules.PortRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Database).MustPass(ConnectionRules.DatabaseRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.UserName).MustPass(userName => ConnectionRules.UserNameRefusal(userName, required: true)).WithErrorCode("CONNECTION_INVALID");

        // RN-CONN-013: sem `id` não há senha guardada, e ela é obrigatória. Com `id`, ausente usa a do cofre; enviada é a que a pessoa digitou e tem de ter conteúdo (a regra da alteração, RN-CONN-004).
        // A conexão gravada sem senha (RN-TRANSF-015), com `id` e sem senha no pedido, é recusada pelo handler, que sabe o que está gravado (RN-TRANSF-016).
        RuleFor(request => request.Password).Must((request, password) => request.ID is null ? !string.IsNullOrEmpty(password) : password is null || password.Length > 0).WithMessage(_ => Texts.Get("PasswordRequired")).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Password).MustPass(ConnectionRules.PasswordRefusal).WithErrorCode("CONNECTION_INVALID");

        // RN-CONN-013 e RN-VERIF-001: a consulta de verificação do formulário tem as regras da gravação, no banco escolhido, e a recusa vem antes de conectar.
        RuleFor(request => request.VerificationQuery).Custom((query, context) =>
        {
            if (ConnectionRules.VerificationQueryRefusal(query, context.InstanceToValidate.Engine) is { } refusal)
                context.AddFailure(new ValidationFailure(nameof(TestConnectionCommand.VerificationQuery), refusal) { ErrorCode = "CONNECTION_INVALID" });
        });

        RuleFor(request => request.Ssh).MustPass(ConnectionRules.SshRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Ssl).MustPass(ConnectionRules.SslRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Proxy).MustPass(ConnectionRules.ProxyRefusal).WithErrorCode("CONNECTION_INVALID");
    }
}
