using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;

namespace Prism.Application.Journal.Features.GetHistory;

public sealed class GetHistoryValidator : AbstractValidator<GetHistoryCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>GetHistoryValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(GetHistoryValidator));

    public GetHistoryValidator()
    {
        RuleFor(x => x.ConnectionId)
            .Must(id => string.IsNullOrWhiteSpace(id) || Guid.TryParse(id, out _))
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("ConnectionIdInvalid"));

        RuleFor(x => x.Before)
            .GreaterThan(0)
            .When(x => x.Before.HasValue)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("CursorInvalid"));

        RuleFor(x => x.Limit)
            .InclusiveBetween(1, 200)
            .When(x => x.Limit.HasValue)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("LimitInvalid"));
    }
}
