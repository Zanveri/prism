using FluentValidation;

namespace Prism.Application.Plugins.Features.InstallPlugin;

public sealed class InstallPluginValidator : AbstractValidator<InstallPluginCommand>
{
    public InstallPluginValidator()
    {
        RuleFor(request => request.SourceKind).Must(BeValidSourceKind).WithMessage("O tipo de origem do plugin deve ser 'git' ou 'local'.").WithErrorCode("PLUGIN_SOURCE_INVALID");
        RuleFor(request => request.Source).Must(BeNonEmptySource).WithMessage("Informe a URL do repositório Git ou o caminho da pasta local do plugin.").WithErrorCode("PLUGIN_SOURCE_INVALID");
    }

    private static bool BeValidSourceKind(string? sourceKind)
        => sourceKind?.Trim().ToLowerInvariant() is "git" or "local";

    private static bool BeNonEmptySource(string? source)
        => !string.IsNullOrWhiteSpace(source) && source.Trim().Length <= 2048;
}
