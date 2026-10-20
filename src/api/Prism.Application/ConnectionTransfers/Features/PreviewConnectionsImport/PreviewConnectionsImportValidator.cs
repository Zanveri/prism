using FluentValidation;
using Prism.Application.ConnectionTransfers.Models;

namespace Prism.Application.ConnectionTransfers.Features.PreviewConnectionsImport;

/// <summary>RN-TRANSF-010, etapas 1 e 2, sem derivar nada: o texto até 5 MiB (`IMPORT_LIMITS_EXCEEDED`) e a senha de exportação (`IMPORT_PASSPHRASE_INVALID`).</summary>
public sealed class PreviewConnectionsImportValidator : AbstractValidator<PreviewConnectionsImportCommand>
{
    public PreviewConnectionsImportValidator()
    {
        RuleFor(request => request.Content).MustFitTheImportLimit();
        RuleFor(request => request.Passphrase).MustBeAnImportPassphrase();
    }
}
