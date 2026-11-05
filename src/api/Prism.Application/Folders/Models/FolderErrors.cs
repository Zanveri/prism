using Prism.Core.Api.Models.Dtos;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.Folders.Models;

/// <summary>Os códigos e os status são os da seção 6 da especificação. A pasta pai que não existe é o mesmo `FOLDER_NOT_FOUND`: só o detalhe diz de qual pasta se trata.</summary>
internal static class FolderErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>FolderErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(FolderErrors));

    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "FOLDER_NOT_FOUND", Texts.Get("NotFoundDetail", id));

    public static ApiErrorDto ParentNotFound(Guid parentID)
        => ApiErrorDto.CreateNotFound(Texts.Get("ParentNotFoundTitle"), "FOLDER_NOT_FOUND", Texts.Get("ParentNotFoundDetail", parentID));

    /// <summary>RN-PASTA-002.</summary>
    public static ApiErrorDto AlreadyExists(string name)
        => ApiErrorDto.CreateConflict(Texts.Get("AlreadyExistsTitle"), "FOLDER_ALREADY_EXISTS", Texts.Get("AlreadyExistsDetail", name));

    /// <summary>RN-PASTA-003.</summary>
    public static ApiErrorDto Cycle()
        => ApiErrorDto.CreateConflict(Texts.Get("CycleTitle"), "FOLDER_CYCLE", Texts.Get("CycleDetail"));

    /// <summary>RN-PASTA-004.</summary>
    public static ApiErrorDto NotEmpty()
        => ApiErrorDto.CreateConflict(Texts.Get("NotEmptyTitle"), "FOLDER_NOT_EMPTY", Texts.Get("NotEmptyDetail"));
}
