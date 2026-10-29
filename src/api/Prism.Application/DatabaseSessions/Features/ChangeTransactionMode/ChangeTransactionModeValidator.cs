using FluentValidation;
using Prism.Infrastructure.Databases.Models;

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

        // RN-ISOL-001 e 003: qualquer nível conhecido passa aqui; a compatibilidade com o motor e o modo de log da sessão é conferida na sessão.
        RuleFor(request => request.IsolationLevel)
            .Must(level => level is null || IsolationLevels.IsKnown(level))
            .WithMessage("O nível de isolamento informado não é válido.")
            .WithErrorCode("ISOLATION_LEVEL_INVALID");
    }
}
