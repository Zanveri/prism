using FluentValidation;

namespace Prism.Application.Connections.Features.TestConnection;

public sealed class TestConnectionValidator : AbstractValidator<TestConnectionCommand>
{
    public TestConnectionValidator()
    {
        // RN-CONN-010: os mesmos campos e limites do `CreateConnectionValidator`, menos o que só serve para gravar (nome, pasta, ambiente).
        RuleFor(request => request.Engine).IsInEnum().WithMessage("Escolha o banco de dados.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Host).Must(host => !string.IsNullOrWhiteSpace(host)).WithMessage("Informe o host.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Port).InclusiveBetween(1, 65535).WithMessage("Informe uma porta de 1 a 65535.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.Database).Must(database => !string.IsNullOrWhiteSpace(database)).WithMessage("Informe o banco de dados.").WithErrorCode("CONNECTION_INVALID");
        RuleFor(request => request.UserName).Must(userName => !string.IsNullOrWhiteSpace(userName)).WithMessage("Informe o usuário do banco.").WithErrorCode("CONNECTION_INVALID");

        // RN-CONN-013: sem `id` não há senha guardada, e ela é obrigatória. Com `id`, ausente usa a do cofre; enviada é a que a pessoa digitou e tem de ter conteúdo (a regra da alteração, RN-CONN-004).
        RuleFor(request => request.Password).Must((request, password) => request.ID is null ? !string.IsNullOrEmpty(password) : password is null || password.Length > 0).WithMessage("Informe a senha do banco.").WithErrorCode("CONNECTION_INVALID");
    }
}
