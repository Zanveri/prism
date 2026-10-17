using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Transfers.Models;

namespace Prism.Application.Transfers.Features.PreviewCopy;

/// <summary>
/// RN-IMPORT-024, o primeiro passo: a forma do pedido e as faixas, todas de uma vez, com `IMPORT_OPTIONS_INVALID` no campo: a origem e as colunas, nas
/// regras da exportação, a tabela de destino e a forma do mapeamento, quando ele vem.
/// </summary>
public sealed class PreviewCopyValidator : AbstractValidator<PreviewCopyCommand>
{
    public PreviewCopyValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            var refusals = ExportRequestRules.SourceRefusals(request.Source)
                .Concat(ExportRequestRules.ColumnsRefusals(request.Columns))
                .Concat(ImportRequestRules.TargetRefusals(request.Target))
                .Concat(ImportRequestRules.MappingRefusals(request.Mapping, required: false));

            foreach (var (field, message) in refusals)
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = ImportErrors.OptionsInvalidCode });
        });
}
