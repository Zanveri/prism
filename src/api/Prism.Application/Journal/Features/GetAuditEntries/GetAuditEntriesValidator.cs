using FluentValidation;
using Prism.Application.Journal.Models;
using System.Globalization;

namespace Prism.Application.Journal.Features.GetAuditEntries;

public sealed class GetAuditEntriesValidator : AbstractValidator<GetAuditEntriesCommand>
{
    public GetAuditEntriesValidator()
    {
        RuleFor(x => x.From)
            .Must(BeValidTimestamp)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("A data inicial do filtro é inválida.");

        RuleFor(x => x.To)
            .Must(BeValidTimestamp)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("A data final do filtro é inválida.");

        RuleFor(x => x)
            .Must(HaveValidDateOrder)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("A data inicial não pode ser posterior à data final.");

        RuleForEach(x => x.ConnectionId)
            .Must(id => string.IsNullOrWhiteSpace(id) || Guid.TryParse(id, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O identificador da conexão é inválido.");

        RuleForEach(x => x.Level)
            .Must(level => string.IsNullOrWhiteSpace(level) || JournalFormat.TryParseLevel(level, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O nível de perigo informado é inválido.");

        RuleForEach(x => x.Kind)
            .Must(kind => string.IsNullOrWhiteSpace(kind) || JournalFormat.TryParseKind(kind, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O tipo de registro informado é inválido.");

        RuleForEach(x => x.Outcome)
            .Must(outcome => string.IsNullOrWhiteSpace(outcome) || JournalFormat.TryParseOutcome(outcome, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O resultado informado é inválido.");

        RuleFor(x => x.ScriptRunId)
            .Must(id => string.IsNullOrWhiteSpace(id) || Guid.TryParse(id, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O identificador da execução do script é inválido.");

        RuleFor(x => x.Before)
            .GreaterThan(0)
            .When(x => x.Before.HasValue)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O cursor de paginação deve ser positivo.");

        RuleFor(x => x.Limit)
            .InclusiveBetween(1, 500)
            .When(x => x.Limit.HasValue)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage("O limite da auditoria deve estar entre 1 e 500.");
    }

    private static bool BeValidTimestamp(string? value)
        => string.IsNullOrWhiteSpace(value) || DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _);

    private static bool HaveValidDateOrder(GetAuditEntriesCommand command)
    {
        if (string.IsNullOrWhiteSpace(command.From) || string.IsNullOrWhiteSpace(command.To))
            return true;

        if (!DateTimeOffset.TryParse(command.From, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var from))
            return true;

        if (!DateTimeOffset.TryParse(command.To, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var to))
            return true;

        return from <= to;
    }
}
