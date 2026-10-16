using FluentValidation;
using Prism.Application.ConnectionTransfers.Models;

namespace Prism.Application.ConnectionTransfers.Features.ImportConnections;

/// <summary>
/// RN-TRANSF-010 e 014, nesta ordem e sem derivar nada: nenhuma chave marcada (`IMPORT_EMPTY`), as formas de `IMPORT_INVALID` que não dependem do arquivo
/// (a chave nula ou repetida, mais de 4.000 chaves, a escolha dos conflitos fora da lista), o texto até 5 MiB (`IMPORT_LIMITS_EXCEEDED`) e a senha de
/// exportação (`IMPORT_PASSPHRASE_INVALID`). A chave que o arquivo não tem só se sabe depois de abri-lo, no handler. A tela não deixa chegar a nenhuma delas.
/// </summary>
public sealed class ImportConnectionsValidator : AbstractValidator<ImportConnectionsCommand>
{
    public ImportConnectionsValidator()
    {
        RuleFor(request => request.Items).Must(items => items is { Count: > 0 }).WithMessage(TransferErrors.ImportEmptyMessage).WithErrorCode("IMPORT_EMPTY");
        RuleFor(request => request.Items).Must(items => items is null || items.Count <= TransferLimits.MaxImportItems).WithMessage("Marque até 4.000 itens por importação.").WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.Items).Must(items => items is null || (items.All(key => key is not null) && items.Distinct(StringComparer.Ordinal).Count() == items.Count)).WithMessage("Cada item é marcado uma vez só.").WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.OnConflict).Must(TransferRules.ConflictIsValid).WithMessage("Escolha importar com outro nome ou não importar.").WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.Content).MustFitTheImportLimit();
        RuleFor(request => request.Passphrase).MustBeAnImportPassphrase();
    }
}
