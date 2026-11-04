using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Common.Texts;
using Prism.Application.Connections.Models;

namespace Prism.Application.Connections.Features.CreateConnection;

public sealed class CreateConnectionValidator : AbstractValidator<CreateConnectionCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>CreateConnectionValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(CreateConnectionValidator));

    public CreateConnectionValidator()
    {
        // RN-CONN-010. Os mesmos campos e limites do `UpdateConnectionValidator`, do teste e da importação (RN-TRANSF-014), pelas regras do `ConnectionRules`;
        // a pasta que não existe é 404 da gravação, e não regra daqui. Os textos são medidos depois de normalizados, que é o que o domínio grava, com os tetos
        // e sem caractere de controle nem de direção do texto. As regras aceitam nulo (um corpo sem o campo chega vazio, e o `null` explícito o MVC já recusa).
        RuleFor(request => request.Name).MustPass(ConnectionRules.NameRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Engine).IsInEnum().WithMessage(_ => Texts.Get("EngineRequired")).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Host).MustPass(ConnectionRules.HostRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Port).MustPass(ConnectionRules.PortRefusal).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Database).MustPass(ConnectionRules.DatabaseRefusal).WithErrorCode("CONNECTION_INVALID");

        // RN-CONN-010 e RN-TRANSF-015: no formulário o usuário e a senha são obrigatórios; vazios, só na conexão que a importação trouxe sem eles.
        RuleFor(request => request.UserName).MustPass(userName => ConnectionRules.UserNameRefusal(userName, required: true)).WithErrorCode("CONNECTION_INVALID");

        // Na criação a senha é obrigatória, e não é aparada: espaço nas pontas faz parte dela. Só o teto (1.024, contada como veio).
        RuleFor(request => request.Password).MustPass(password => string.IsNullOrEmpty(password) ? Texts.Get("PasswordRequired") : ConnectionRules.PasswordRefusal(password)).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.EnvironmentName).MustBeAnEnvironmentName().WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.EnvironmentColor).MustBeAnEnvironmentColor().WithErrorCode("CONNECTION_INVALID");

        // RN-PROT-001 e RN-VERIF-001: as regras do `UpdateConnectionValidator`, no mesmo código. A consulta de verificação é uma leitura só no banco
        // escolhido (RN-PROT-005), com o motivo da recusa no campo.
        RuleFor(request => request.ConfirmCommands).MustBeAConfirmation().WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.VerificationInterval).Must(ConnectionRules.VerificationIntervalIsValid).WithMessage(_ => VerificationIntervalMessage).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.VerificationQuery).Custom((query, context) =>
        {
            if (ConnectionRules.VerificationQueryRefusal(query, context.InstanceToValidate.Engine) is { } refusal)
                context.AddFailure(new ValidationFailure(nameof(CreateConnectionCommand.VerificationQuery), refusal) { ErrorCode = "CONNECTION_INVALID" });
        });
    }

    /// <summary>RN-VERIF-001: a mensagem do intervalo fora da faixa, a mesma na criação, na alteração, no teste e na importação (`ConnectionRules`).</summary>
    internal static string VerificationIntervalMessage => ConnectionRules.VerificationIntervalMessage;
}
