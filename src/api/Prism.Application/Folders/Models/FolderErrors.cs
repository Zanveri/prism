using Prism.Core.Api.Models.Dtos;

namespace Prism.Application.Folders.Models;

/// <summary>Os códigos e os status são os da seção 6 da especificação. A pasta pai que não existe é o mesmo `FOLDER_NOT_FOUND`: só o detalhe diz de qual pasta se trata.</summary>
internal static class FolderErrors
{
    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound("Pasta não localizada.", "FOLDER_NOT_FOUND", $"Não existe uma pasta com o ID {id}.");

    public static ApiErrorDto ParentNotFound(Guid parentID)
        => ApiErrorDto.CreateNotFound("Pasta pai não localizada.", "FOLDER_NOT_FOUND", $"A pasta pai com o ID {parentID} não existe.");

    /// <summary>RN-PASTA-002.</summary>
    public static ApiErrorDto AlreadyExists(string name)
        => ApiErrorDto.CreateConflict("Pasta já existe.", "FOLDER_ALREADY_EXISTS", $"Já existe uma pasta chamada {name} neste lugar. O nome não pode se repetir entre pastas irmãs, nem com outras maiúsculas e minúsculas.");

    /// <summary>RN-PASTA-003.</summary>
    public static ApiErrorDto Cycle()
        => ApiErrorDto.CreateConflict("Movimento inválido.", "FOLDER_CYCLE", "Uma pasta não pode ser movida para dentro dela mesma nem de uma de suas subpastas.");

    /// <summary>RN-PASTA-004.</summary>
    public static ApiErrorDto NotEmpty()
        => ApiErrorDto.CreateConflict("Pasta não está vazia.", "FOLDER_NOT_EMPTY", "Só uma pasta vazia pode ser excluída. Mova ou exclua antes as subpastas e as conexões dela.");
}
