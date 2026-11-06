using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;

namespace Prism.Application.Journal.Features.PurgeAudit;

public sealed class PurgeAuditValidator : AbstractValidator<PurgeAuditCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>PurgeAuditValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(PurgeAuditValidator));

    public PurgeAuditValidator()
    {
        RuleFor(x => x.Before)
            .Must(before => before != default)
            .WithErrorCode("JOURNAL_FILTER_INVALID")
            .WithMessage(_ => Texts.Get("CutoffRequired"));
    }
}
