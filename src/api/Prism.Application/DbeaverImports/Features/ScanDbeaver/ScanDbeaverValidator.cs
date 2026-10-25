using FluentValidation;
using Prism.Application.DbeaverImports.Models;

namespace Prism.Application.DbeaverImports.Features.ScanDbeaver;

/// <summary>Seção 6: o `sourceId` só passa na forma do identificador (36 caracteres, em minúsculas, com os hifens): `IMPORT_INVALID` em `SourceId`.</summary>
public sealed class ScanDbeaverValidator : AbstractValidator<ScanDbeaverCommand>
{
    public ScanDbeaverValidator()
    {
        RuleFor(request => request.SourceId).MustBeASourceId();
    }
}
