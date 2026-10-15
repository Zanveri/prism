using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Connections.Features.CreateConnection;
using Prism.Application.Connections.Models;

namespace Prism.Application.Connections.Features.UpdateConnection;

public sealed class UpdateConnectionValidator : AbstractValidator<UpdateConnectionCommand>
{
    public UpdateConnectionValidator()
    {
        // RN-CONN-010: os mesmos campos e limites do `CreateConnectionValidator`. O ID e a pasta que não existem são 404 do handler e da gravação, e não regra daqui.
        RuleFor(request => request.Name).Must(ConnectionRules.NameIsValid).WithMessage("O nome da conexão deve ter de 1 a 80 caracteres.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Engine).IsInEnum().WithMessage("Escolha o banco de dados.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Host).Must(host => !string.IsNullOrWhiteSpace(host)).WithMessage("Informe o host.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Port).InclusiveBetween(1, 65535).WithMessage("Informe uma porta de 1 a 65535.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Database).Must(database => !string.IsNullOrWhiteSpace(database)).WithMessage("Informe o banco de dados.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.UserName).Must(userName => !string.IsNullOrWhiteSpace(userName)).WithMessage("Informe o usuário do banco.").WithErrorCode("CONNECTION_INVALID");

        // RN-CONN-004: nula mantém a senha gravada. Enviada, é uma senha nova e tem de ter conteúdo: o texto vazio não é "omitida", e deixaria a conexão sem senha.
        RuleFor(request => request.Password).Must(password => password is null || password.Length > 0).WithMessage("Informe a nova senha do banco, ou deixe em branco para manter a atual.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.EnvironmentName).MustBeAnEnvironmentName().WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.EnvironmentColor).MustBeAnEnvironmentColor().WithErrorCode("CONNECTION_INVALID");

        // RN-PROT-001 e RN-VERIF-001: as regras do `CreateConnectionValidator`. A senha do usuário (RN-PROT-003) não é regra daqui: quem diz se ela é
        // pedida, e a confere, é a gravação.
        RuleFor(request => request.ConfirmCommands).MustBeAConfirmation().WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.VerificationInterval).Must(ConnectionRules.VerificationIntervalIsValid).WithMessage(CreateConnectionValidator.VerificationIntervalMessage).WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.VerificationQuery).Custom((query, context) =>
        {
            if (ConnectionRules.VerificationQueryRefusal(query, context.InstanceToValidate.Engine) is { } refusal)
                context.AddFailure(new ValidationFailure(nameof(UpdateConnectionCommand.VerificationQuery), refusal) { ErrorCode = "CONNECTION_INVALID" });
        });
    }
}
