using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;
using Prism.Application.Journal.Models;
using System.Globalization;

namespace Prism.Application.Journal.Features.GetAuditEntries;

public sealed class GetAuditEntriesValidator : AbstractValidator<GetAuditEntriesCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>GetAuditEntriesValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(GetAuditEntriesValidator));

    public GetAuditEntriesValidator()
    {
        RuleFor(x => x.From)
            .Must(BeValidTimestamp)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("FromInvalid"));

        RuleFor(x => x.To)
            .Must(BeValidTimestamp)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("ToInvalid"));

        RuleFor(x => x)
            .Must(HaveValidDateOrder)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("DateOrderInvalid"));

        RuleForEach(x => x.ConnectionId)
            .Must(id => string.IsNullOrWhiteSpace(id) || Guid.TryParse(id, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("ConnectionIdInvalid"));

        RuleForEach(x => x.Level)
            .Must(level => string.IsNullOrWhiteSpace(level) || JournalFormat.TryParseLevel(level, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("LevelInvalid"));

        RuleForEach(x => x.Kind)
            .Must(kind => string.IsNullOrWhiteSpace(kind) || JournalFormat.TryParseKind(kind, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("KindInvalid"));

        RuleForEach(x => x.Outcome)
            .Must(outcome => string.IsNullOrWhiteSpace(outcome) || JournalFormat.TryParseOutcome(outcome, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("OutcomeInvalid"));

        RuleFor(x => x.ScriptRunId)
            .Must(id => string.IsNullOrWhiteSpace(id) || Guid.TryParse(id, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("ScriptRunInvalid"));

        RuleFor(x => x.Before)
            .GreaterThan(0)
            .When(x => x.Before.HasValue)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("CursorInvalid"));

        RuleFor(x => x.Limit)
            .InclusiveBetween(1, 500)
            .When(x => x.Limit.HasValue)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("LimitInvalid"));
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
