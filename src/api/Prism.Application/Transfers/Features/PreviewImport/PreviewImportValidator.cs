using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Transfers.Models;

namespace Prism.Application.Transfers.Features.PreviewImport;

/// <summary>
/// RN-IMPORT-009 a 011, o primeiro passo: a forma do pedido e as faixas, todas de uma vez, com `IMPORT_OPTIONS_INVALID` no campo: o arquivo, o formato, as
/// opções do leitor (com as chaves do JSON), os formatos dos valores, a tabela de destino e a forma do mapeamento, quando ele vem.
/// </summary>
public sealed class PreviewImportValidator : AbstractValidator<PreviewImportCommand>
{
    public PreviewImportValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            var refusals = ImportRequestRules.FileRefusals(request.FileID, request.Format, request.Reader, keys: true)
                .Concat(ImportRequestRules.ValuesRefusals(request.Values))
                .Concat(ImportRequestRules.TargetRefusals(request.Target))
                .Concat(ImportRequestRules.MappingRefusals(request.Mapping, required: false));

            foreach (var (field, message) in refusals)
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = ImportErrors.OptionsInvalidCode });
        });
}
