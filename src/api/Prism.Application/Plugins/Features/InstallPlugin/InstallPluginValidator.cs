using Prism.Core.Extensions;
using System.Resources;
using FluentValidation;

namespace Prism.Application.Plugins.Features.InstallPlugin;

public sealed class InstallPluginValidator : AbstractValidator<InstallPluginCommand>
{
    /// <summary>Os textos, no idioma do pedido: <c>InstallPluginValidator.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(InstallPluginValidator));

    public InstallPluginValidator()
    {
        RuleFor(request => request.SourceKind).Must(BeValidSourceKind).WithMessage(_ => Texts.Get("SourceKindInvalid")).WithErrorCode("PLUGIN_SOURCE_INVALID");
        RuleFor(request => request.Source).Must(BeNonEmptySource).WithMessage(_ => Texts.Get("SourceRequired")).WithErrorCode("PLUGIN_SOURCE_INVALID");
    }

    private static bool BeValidSourceKind(string? sourceKind)
        => sourceKind?.Trim().ToLowerInvariant() is "git" or "local";

    private static bool BeNonEmptySource(string? source)
        => !string.IsNullOrWhiteSpace(source) && source.Trim().Length <= 2048;
}
