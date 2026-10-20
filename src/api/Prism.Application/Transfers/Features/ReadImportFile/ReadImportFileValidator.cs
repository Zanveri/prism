using FluentValidation;
using FluentValidation.Results;
using Prism.Application.Transfers.Models;

namespace Prism.Application.Transfers.Features.ReadImportFile;

/// <summary>RN-IMPORT-007: a forma do pedido, antes de abrir o arquivo: o identificador, o formato e as opções do leitor, com `IMPORT_OPTIONS_INVALID` no campo.</summary>
public sealed class ReadImportFileValidator : AbstractValidator<ReadImportFileCommand>
{
    public ReadImportFileValidator()
        => RuleFor(request => request).Custom((request, context) =>
        {
            foreach (var (field, message) in ImportRequestRules.FileRefusals(request.FileID, request.Format, request.Reader, keys: false))
                context.AddFailure(new ValidationFailure(field, message) { ErrorCode = ImportErrors.OptionsInvalidCode });
        });
}
