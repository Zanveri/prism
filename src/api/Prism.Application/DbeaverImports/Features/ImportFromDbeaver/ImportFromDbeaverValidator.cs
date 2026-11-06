using FluentValidation;
using Prism.Application.ConnectionTransfers.Models;
using Prism.Application.DbeaverImports.Models;

namespace Prism.Application.DbeaverImports.Features.ImportFromDbeaver;

/// <summary>
/// Seção 6 e RN-DBEAVER-016 e 017, nesta ordem e sem ler a cópia: nenhuma chave marcada (`IMPORT_EMPTY`), as formas de `IMPORT_INVALID` que não dependem da cópia (o
/// `sourceId` fora do formato, "Levar as senhas" que não é booleano, as portas DRDA mal formadas, a chave nula ou repetida, mais de 4.000 chaves, a escolha dos conflitos
/// fora da lista, `overwrite` com chave nula ou repetida ou acima de 2.000). A chave que a cópia não tem só se sabe depois de lê-la, no handler.
/// </summary>
public sealed class ImportFromDbeaverValidator : AbstractValidator<ImportFromDbeaverCommand>
{
    public ImportFromDbeaverValidator()
    {
        RuleFor(request => request.Items).Must(items => items is { Count: > 0 }).WithMessage(_ => TransferErrors.ImportEmptyMessage).WithErrorCode("IMPORT_EMPTY");
        RuleFor(request => request.SourceId).MustBeASourceId();
        RuleFor(request => request.WithPasswords).Must(DbeaverRequests.WithPasswordsIsValid).WithMessage(_ => DbeaverErrors.WithPasswordsInvalidMessage).WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.DrdaPorts).Must(DbeaverRequests.DrdaPortsAreValid).WithMessage(_ => DbeaverErrors.DrdaPortsInvalidMessage).WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.Items).Must(items => items is null || items.Count <= TransferLimits.MaxImportItems).WithMessage(_ => TransferErrors.ImportItemsLimitMessage).WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.Items).Must(items => items is null || (items.All(key => key is not null) && items.Distinct(StringComparer.Ordinal).Count() == items.Count)).WithMessage(_ => TransferErrors.ImportItemsDuplicateMessage).WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.OnConflict).Must(TransferRules.ConflictIsValid).WithMessage(_ => TransferErrors.ImportConflictInvalidMessage).WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.Overwrite).Must(DbeaverRequests.OverwriteIsValid).WithMessage(_ => DbeaverErrors.OverwriteInvalidMessage).WithErrorCode("IMPORT_INVALID");
    }
}
