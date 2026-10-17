using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Transfers.Models;

namespace Prism.Application.Transfers.Features.StartCopy;

/// <summary>
/// RN-IMPORT-027, o primeiro passo, antes de tudo e sem tocar nos bancos: a forma do pedido e as faixas, todas de uma vez, com `IMPORT_OPTIONS_INVALID` no
/// campo: a origem e as colunas, nas regras da exportação, a tabela de destino, o mapeamento (obrigatório), a carga (sem a conferência do arquivo) e o
/// número da janela.
/// </summary>
public sealed class StartCopyValidator : AbstractValidator<StartCopyCommand>
{
    public StartCopyValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            var refusals = ExportRequestRules.SourceRefusals(request.Source)
                .Concat(ExportRequestRules.ColumnsRefusals(request.Columns))
                .Concat(ImportRequestRules.TargetRefusals(request.Target))
                .Concat(ImportRequestRules.MappingRefusals(request.Mapping, required: true))
                .Concat(ImportRequestRules.Load(request.Load, copy: true).Errors)
                .Concat(ImportRequestRules.WindowRefusals(request.WindowID));

            foreach (var (field, message) in refusals)
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = ImportErrors.OptionsInvalidCode });
        });
}
