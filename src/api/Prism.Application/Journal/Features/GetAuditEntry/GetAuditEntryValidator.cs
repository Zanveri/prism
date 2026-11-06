using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;

namespace Prism.Application.Journal.Features.GetAuditEntry;

public sealed class GetAuditEntryValidator : AbstractValidator<GetAuditEntryCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>GetAuditEntryValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(GetAuditEntryValidator));

    public GetAuditEntryValidator()
    {
        RuleFor(x => x.Id)
            .GreaterThan(0)
            .WithErrorCode("JOURNAL_ENTRY_NOT_FOUND")
            .WithMessage(_ => Texts.Get("RecordIdInvalid"));
    }
}
