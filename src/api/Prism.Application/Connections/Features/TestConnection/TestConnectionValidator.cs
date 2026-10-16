using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Common.Texts;
using Prism.Application.Connections.Models;

namespace Prism.Application.Connections.Features.TestConnection;

public sealed class TestConnectionValidator : AbstractValidator<TestConnectionCommand>
{
    public TestConnectionValidator()
    {
        // RN-CONN-010: os mesmos campos e limites do `CreateConnectionValidator` (as regras do `ConnectionRules`, com os tetos e sem caractere de controle nem
        // de direção do texto), menos o que só serve para gravar (nome, pasta, ambiente).
        RuleFor(request => request.Engine).IsInEnum().WithMessage("Escolha o banco de dados.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Host).MustPass(ConnectionRules.HostRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Port).MustPass(ConnectionRules.PortRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Database).MustPass(ConnectionRules.DatabaseRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.UserName).MustPass(userName => ConnectionRules.UserNameRefusal(userName, required: true)).WithErrorCode("CONNECTION_INVALID");

        // RN-CONN-013: sem `id` não há senha guardada, e ela é obrigatória. Com `id`, ausente usa a do cofre; enviada é a que a pessoa digitou e tem de ter conteúdo (a regra da alteração, RN-CONN-004).
        RuleFor(request => request.Password).Must((request, password) => request.ID is null ? !string.IsNullOrEmpty(password) : password is null || password.Length > 0).WithMessage("Informe a senha do banco.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Password).MustPass(ConnectionRules.PasswordRefusal).WithErrorCode("CONNECTION_INVALID");

        // RN-CONN-013 e RN-VERIF-001: a consulta de verificação do formulário tem as regras da gravação, no banco escolhido, e a recusa vem antes de conectar.
        RuleFor(request => request.VerificationQuery).Custom((query, context) =>
        {
            if (ConnectionRules.VerificationQueryRefusal(query, context.InstanceToValidate.Engine) is { } refusal)
                context.AddFailure(new ValidationFailure(nameof(TestConnectionCommand.VerificationQuery), refusal) { ErrorCode = "CONNECTION_INVALID" });
        });
    }
}
