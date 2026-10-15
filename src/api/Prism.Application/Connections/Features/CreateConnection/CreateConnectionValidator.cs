using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Connections.Models;

namespace Prism.Application.Connections.Features.CreateConnection;

public sealed class CreateConnectionValidator : AbstractValidator<CreateConnectionCommand>
{
    public CreateConnectionValidator()
    {
        // RN-CONN-010. Os mesmos campos e limites do `UpdateConnectionValidator`; a pasta que não existe é 404 da gravação, e não regra daqui.
        // Os textos são medidos depois de normalizados, que é o que o domínio grava. O `Must` aceita nulo (um corpo sem o campo chega vazio, e o `null` explícito o MVC já recusa).
        RuleFor(request => request.Name).Must(ConnectionRules.NameIsValid).WithMessage("O nome da conexão deve ter de 1 a 80 caracteres.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Engine).IsInEnum().WithMessage("Escolha o banco de dados.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Host).Must(host => !string.IsNullOrWhiteSpace(host)).WithMessage("Informe o host.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Port).InclusiveBetween(1, 65535).WithMessage("Informe uma porta de 1 a 65535.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Database).Must(database => !string.IsNullOrWhiteSpace(database)).WithMessage("Informe o banco de dados.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.UserName).Must(userName => !string.IsNullOrWhiteSpace(userName)).WithMessage("Informe o usuário do banco.").WithErrorCode("CONNECTION_INVALID");

        // Na criação a senha é obrigatória, e não é aparada: espaço nas pontas faz parte dela.
        RuleFor(request => request.Password).Must(password => !string.IsNullOrEmpty(password)).WithMessage("Informe a senha do banco.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.EnvironmentName).MustBeAnEnvironmentName().WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.EnvironmentColor).MustBeAnEnvironmentColor().WithErrorCode("CONNECTION_INVALID");

        // RN-PROT-001 e RN-VERIF-001: as regras do `UpdateConnectionValidator`, no mesmo código. A consulta de verificação é uma leitura só no banco
        // escolhido (RN-PROT-005), com o motivo da recusa no campo.
        RuleFor(request => request.ConfirmCommands).MustBeAConfirmation().WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.VerificationInterval).Must(ConnectionRules.VerificationIntervalIsValid).WithMessage(VerificationIntervalMessage).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.VerificationQuery).Custom((query, context) =>
        {
            if (ConnectionRules.VerificationQueryRefusal(query, context.InstanceToValidate.Engine) is { } refusal)
                context.AddFailure(new ValidationFailure(nameof(CreateConnectionCommand.VerificationQuery), refusal) { ErrorCode = "CONNECTION_INVALID" });
        });
    }

    /// <summary>RN-VERIF-001: a mensagem do intervalo fora da faixa, a mesma na criação, na alteração e no teste.</summary>
    internal const string VerificationIntervalMessage = "A verificação deve ser feita a cada 5 a 3.600 segundos.";
}
