using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Plugins.Models;

namespace Prism.Application.Plugins.Models;

internal static class PluginErrors
{
    public const string InvalidCode = "PLUGIN_INVALID";

    public static ApiErrorDto ConsentRequired()
        => ApiErrorDto.CreateUnprocessableEntity("Consentimento de plugins de terceiros necessário.", "PLUGIN_CONSENT_REQUIRED", "É preciso aceitar o termo de responsabilidade e desativar o modo restrito antes de instalar ou habilitar plugins de terceiros.");

    public static ApiErrorDto NotFound(string id)
        => ApiErrorDto.CreateNotFound("Plugin não encontrado.", "PLUGIN_NOT_FOUND", $"O plugin '{id}' não está instalado neste cofre.");

    public static ApiErrorDto AlreadyInstalled(string id)
        => ApiErrorDto.CreateConflict("Plugin já instalado.", "PLUGIN_ALREADY_INSTALLED", $"O plugin '{id}' já está instalado.");

    public static ApiErrorDto LocalPluginCannotPull()
        => ApiErrorDto.CreateUnprocessableEntity("Plugin local não usa Git.", "PLUGIN_SOURCE_INVALID", "Plugins vinculados por pasta local já refletem os arquivos do disco ao atualizar a estrutura.");

    public static ApiErrorDto From(PluginFailure failure)
        => failure.Kind switch
        {
            EPluginFailure.SourceInvalid => ApiErrorDto.CreateUnprocessableEntity("Origem do plugin inválida.", "PLUGIN_SOURCE_INVALID", failure.Message),
            EPluginFailure.ManifestInvalid => ApiErrorDto.CreateUnprocessableEntity("Manifesto do plugin inválido.", "PLUGIN_MANIFEST_INVALID", failure.Message),
            EPluginFailure.AlreadyInstalled => ApiErrorDto.CreateConflict("Plugin já instalado.", "PLUGIN_ALREADY_INSTALLED", failure.Message),
            EPluginFailure.GitFailed => ApiErrorDto.CreateUnprocessableEntity("Falha ao acessar repositório Git.", "PLUGIN_GIT_FAILED", failure.Message),
            EPluginFailure.BundleUnavailable => ApiErrorDto.CreateUnprocessableEntity("Código do plugin indisponível.", "PLUGIN_BUNDLE_UNAVAILABLE", failure.Message),
            _ => throw new NotImplementedException("O enum informado não foi mapeado pela aplicação")
        };
}
