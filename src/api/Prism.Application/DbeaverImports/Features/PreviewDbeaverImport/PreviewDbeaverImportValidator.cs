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
        RuleFor(request => request.WithPasswords).Must(DbeaverRequests.WithPasswordsIsValid).WithMessage("“Levar as senhas” é verdadeiro ou falso.").WithErrorCode("IMPORT_INVALID");
        RuleFor(request => request.DrdaPorts).Must(DbeaverRequests.DrdaPortsAreValid).WithMessage("Cada porta DRDA é de 1 a 65535, de um servidor do DBeaver que não se repete, e são até 2.000.").WithErrorCode("IMPORT_INVALID");
    }
}
