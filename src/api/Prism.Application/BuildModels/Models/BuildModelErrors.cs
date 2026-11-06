using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.BuildModels.Models;

/// <summary>Erros das rotas <c>api/user/build-models</c> (seção 7 da especificação). O detalhe nunca leva o corpo do modelo (RN-LOG-001).</summary>
internal static class BuildModelErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>BuildModelErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(BuildModelErrors));

    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "BUILD_MODEL_NOT_FOUND", Texts.Get("NotFoundDetail", id));

    public static ApiErrorDto AlreadyExists(string name)
        => ApiErrorDto.CreateConflict(Texts.Get("AlreadyExistsTitle"), "BUILD_MODEL_ALREADY_EXISTS", Texts.Get("AlreadyExistsDetail", name));

    public static ApiErrorDto Changed(Guid id)
        => ApiErrorDto.CreateConflict(Texts.Get("ChangedTitle"), "BUILD_MODEL_CHANGED", Texts.Get("ChangedDetail", id));
}
