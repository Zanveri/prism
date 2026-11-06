using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;

namespace Prism.Application.Journal.Features.HideHistoryEntry;

public sealed class HideHistoryEntryValidator : AbstractValidator<HideHistoryEntryCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>HideHistoryEntryValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(HideHistoryEntryValidator));

    public HideHistoryEntryValidator()
    {
        RuleFor(x => x.Id)
            .GreaterThan(0)
            .WithErrorCode("JOURNAL_ENTRY_NOT_FOUND")
            .WithMessage(_ => Texts.Get("RecordIdInvalid"));
    }
}
