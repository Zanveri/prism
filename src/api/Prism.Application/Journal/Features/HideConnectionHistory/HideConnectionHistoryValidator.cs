using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;

namespace Prism.Application.Journal.Features.HideConnectionHistory;

public sealed class HideConnectionHistoryValidator : AbstractValidator<HideConnectionHistoryCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>HideConnectionHistoryValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(HideConnectionHistoryValidator));

    public HideConnectionHistoryValidator()
    {
        RuleFor(x => x.ConnectionId)
            .Must(id => !string.IsNullOrWhiteSpace(id) && Guid.TryParse(id, out var parsed) && parsed != Guid.Empty)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("ConnectionInvalid"));
    }
}
