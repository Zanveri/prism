using Prism.Core.Extensions;
using System.Resources;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Plugins.Models;

namespace Prism.Application.Plugins.Models;

internal static class PluginErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>PluginErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(PluginErrors));

    public const string InvalidCode = "PLUGIN_INVALID";

    public static ApiErrorDto ConsentRequired()
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ConsentRequiredTitle"), "PLUGIN_CONSENT_REQUIRED", Texts.Get("ConsentRequiredDetail"));

    public static ApiErrorDto NotFound(string id)
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "PLUGIN_NOT_FOUND", Texts.Get("NotFoundDetail", id));

    public static ApiErrorDto AlreadyInstalled(string id)
        => ApiErrorDto.CreateConflict(Texts.Get("AlreadyInstalledTitle"), "PLUGIN_ALREADY_INSTALLED", Texts.Get("AlreadyInstalledDetail", id));

    public static ApiErrorDto LocalPluginCannotPull()
        => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("LocalPluginTitle"), "PLUGIN_SOURCE_INVALID", Texts.Get("LocalPluginDetail"));

    public static ApiErrorDto From(PluginFailure failure)
        => failure.Kind switch
        {
            EPluginFailure.SourceInvalid => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("SourceInvalidTitle"), "PLUGIN_SOURCE_INVALID", failure.Message),
            EPluginFailure.ManifestInvalid => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("ManifestInvalidTitle"), "PLUGIN_MANIFEST_INVALID", failure.Message),
            EPluginFailure.AlreadyInstalled => ApiErrorDto.CreateConflict(Texts.Get("AlreadyInstalledTitle"), "PLUGIN_ALREADY_INSTALLED", failure.Message),
            EPluginFailure.GitFailed => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("GitFailedTitle"), "PLUGIN_GIT_FAILED", failure.Message),
            EPluginFailure.BundleUnavailable => ApiErrorDto.CreateUnprocessableEntity(Texts.Get("BundleUnavailableTitle"), "PLUGIN_BUNDLE_UNAVAILABLE", failure.Message),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
