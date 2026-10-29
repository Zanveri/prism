using FluentValidation;

namespace Prism.Application.DatabaseSessions.Features.ChangeTransactionMode;

public sealed class ChangeTransactionModeValidator : AbstractValidator<ChangeTransactionModeCommand>
{
    public ChangeTransactionModeValidator()
    {
        // Seção 22 da especificação: `autoCommit` ou `manual`; ausente, o modo fica como está.
        RuleFor(request => request.TransactionMode)
            .Must(mode => mode is null or "autoCommit" or "manual")
            .WithMessage("O modo de transação deve ser autoCommit ou manual.")
            .WithErrorCode("TRANSACTION_MODE_INVALID");

        // RN-ISOL-001: só o padrão do banco por enquanto; os níveis de cada banco entram com o seletor.
        RuleFor(request => request.IsolationLevel)
            .Must(level => level is null or "default")
            .WithMessage("O nível de isolamento deve ser default.")
            .WithErrorCode("ISOLATION_LEVEL_INVALID");
    }
}
