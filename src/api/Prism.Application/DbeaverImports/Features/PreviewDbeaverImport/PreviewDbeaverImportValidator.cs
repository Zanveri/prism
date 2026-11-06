using FluentValidation;
using Prism.Application.DbeaverImports.Models;

namespace Prism.Application.DbeaverImports.Features.PreviewDbeaverImport;

/// <summary>
/// Seção 6 e RN-DBEAVER-016, sem ler a cópia: o `sourceId` na forma do identificador, "Levar as senhas" booleano e as portas DRDA bem formadas (`IMPORT_INVALID` em
/// `SourceId`, `WithPasswords` e `DrdaPorts`).
/// </summary>
public sealed class PreviewDbeaverImportValidator : AbstractValidator<PreviewDbeaverImportCommand>
{
    public PreviewDbeaverImportValidator()
    {
        RuleFor(request => request.SourceId).MustBeASourceId();
        RuleFor(request => request.WithPasswords).Must(DbeaverRequests.WithPasswordsIsValid).WithMessage(_ => DbeaverErrors.WithPasswordsInvalidMessage).WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.DrdaPorts).Must(DbeaverRequests.DrdaPortsAreValid).WithMessage(_ => DbeaverErrors.DrdaPortsInvalidMessage).WithErrorCode("IMPORT_INVALID");
    }
}
