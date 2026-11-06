using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;
using Prism.Infrastructure.Databases.Models;

namespace Prism.Application.DatabaseSessions.Features.ChangeTransactionMode;

public sealed class ChangeTransactionModeValidator : AbstractValidator<ChangeTransactionModeCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>ChangeTransactionModeValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(ChangeTransactionModeValidator));

    public ChangeTransactionModeValidator()
    {
        // Seção 22 da especificação: `autoCommit` ou `manual`; ausente, o modo fica como está.
        RuleFor(request => request.TransactionMode)
            .Must(mode => mode is null or "autoCommit" or "manual")
            .WithMessage(_ => Texts.Get("TransactionModeInvalid"))
            .WithErrorCode("TRANSACTION_MODE_INVALID");

        // RN-ISOL-001 e 003: qualquer nível conhecido passa aqui; a compatibilidade com o motor e o modo de log da sessão é conferida na sessão.
        RuleFor(request => request.IsolationLevel)
            .Must(level => level is null || IsolationLevels.IsKnown(level))
            .WithMessage(_ => Texts.Get("IsolationLevelInvalid"))
            .WithErrorCode("ISOLATION_LEVEL_INVALID");
    }
}
