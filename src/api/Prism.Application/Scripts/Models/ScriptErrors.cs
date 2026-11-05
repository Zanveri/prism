using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Scripts.Models;

/// <summary>Os códigos e os status são os da tabela de rotas da seção 23 da especificação. O detalhe nunca leva o SQL (RN-LOG-001); o nome, sim, porque é o que a pessoa digitou.</summary>
internal static class ScriptErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>ScriptErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(ScriptErrors));

    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "SCRIPT_NOT_FOUND", Texts.Get("NotFoundDetail", id));

    /// <summary>RN-SCRIPT-004.</summary>
    public static ApiErrorDto AlreadyExists(string name)
        => ApiErrorDto.CreateConflict(Texts.Get("AlreadyExistsTitle"), "SCRIPT_ALREADY_EXISTS", Texts.Get("AlreadyExistsDetail", name));
}
