using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Transfers.Models;

namespace Prism.Application.Transfers.Features.StartImport;

/// <summary>
/// RN-IMPORT-014, o primeiro passo, antes de tudo e sem tocar no banco: a forma do pedido e as faixas, todas de uma vez, com `IMPORT_OPTIONS_INVALID` no
/// campo: o arquivo, o formato, as opções do leitor (com as chaves do JSON), os formatos dos valores, a tabela de destino, o mapeamento (obrigatório), a
/// carga e o número da janela.
/// </summary>
public sealed class StartImportValidator : AbstractValidator<StartImportCommand>
{
    public StartImportValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            var refusals = ImportRequestRules.FileRefusals(request.FileID, request.Format, request.Reader, keys: true)
                .Concat(ImportRequestRules.ValuesRefusals(request.Values))
                .Concat(ImportRequestRules.TargetRefusals(request.Target))
                .Concat(ImportRequestRules.MappingRefusals(request.Mapping, required: true))
                .Concat(ImportRequestRules.Load(request.Load, copy: false).Errors)
                .Concat(ImportRequestRules.WindowRefusals(request.WindowID));

            foreach (var (field, message) in refusals)
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = ImportErrors.OptionsInvalidCode });
        });
}
