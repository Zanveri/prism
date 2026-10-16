using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Transfers.Models;

namespace Prism.Application.Transfers.Features.StartExport;

/// <summary>
/// RN-EXPORT-016, o primeiro passo, antes de tudo e sem tocar no banco: a forma do pedido e as faixas, todas de uma vez, com `EXPORT_OPTIONS_INVALID` no
/// campo (`ExportRequestRules`). O caminho do campo vai em camelCase, como a especificação o escreve.
/// </summary>
public sealed class StartExportValidator : AbstractValidator<StartExportCommand>
{
    public StartExportValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            foreach (var (field, message) in ExportRequestRules.Refusals(request))
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = TransferJobErrors.OptionsInvalidCode });
        });
}
