using Prism.Core.Api.Models.Dtos;
using System.Net;
using Prism.Core.Extensions;
using System.Resources;

namespace Prism.Application.ScriptFolders.Models;

/// <summary>
/// Os códigos e os status são os da seção 33 da especificação (RN-SCRIPT-007 e 009). O detalhe é a frase que a tela mostra no aviso de erro, quando a recusa
/// não é de campo: leva o nome da pasta, que é o que a pessoa digitou, e nunca vai ao log.
/// </summary>
internal static class ScriptFolderErrors
{
    /// <summary>Os textos, no idioma do pedido: <c>ScriptFolderErrors.resx</c> (português) e as traduções ao lado.</summary>
    private static readonly ResourceManager Texts = new(typeof(ScriptFolderErrors));

    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "SCRIPT_FOLDER_NOT_FOUND", Texts.Get("NotFoundDetail", id));

    /// <summary>A pasta pai da criação, que outra janela excluiu no meio.</summary>
    public static ApiErrorDto ParentNotFound()
        => ApiErrorDto.CreateNotFound(Texts.Get("ParentNotFoundTitle"), "SCRIPT_FOLDER_NOT_FOUND", Texts.Get("ParentNotFoundDetail"));

    /// <summary>O destino do "Mover para…", de uma pasta ou de um script, que outra janela excluiu no meio.</summary>
    public static ApiErrorDto DestinationNotFound()
        => ApiErrorDto.CreateNotFound(Texts.Get("DestinationNotFoundTitle"), "SCRIPT_FOLDER_NOT_FOUND", Texts.Get("DestinationNotFoundDetail"));

    /// <summary>A pasta escolhida no campo "Pasta" ao salvar o script (RN-SCRIPT-010), que outra janela excluiu no meio.</summary>
    public static ApiErrorDto ChosenNotFound()
        => ApiErrorDto.CreateNotFound(Texts.Get("NotFoundTitle"), "SCRIPT_FOLDER_NOT_FOUND", Texts.Get("ChosenNotFoundDetail"));

    /// <summary>RN-SCRIPT-007: o nome repetido entre as irmãs. <paramref name="place"/> é o caminho da pasta pai, ou nulo na raiz.</summary>
    public static ApiErrorDto AlreadyExists(string name, string? place)
        => ApiErrorDto.CreateConflict(Texts.Get("AlreadyExistsTitle"), "SCRIPT_FOLDER_ALREADY_EXISTS", place is null ? Texts.Get("AlreadyExistsAtRootDetail", name) : Texts.Get("AlreadyExistsInDetail", name, place));

    /// <summary>RN-SCRIPT-007.</summary>
    public static ApiErrorDto Cycle()
        => ApiErrorDto.CreateConflict(Texts.Get("CycleTitle"), "SCRIPT_FOLDER_CYCLE", Texts.Get("CycleDetail"));

    /// <summary>RN-SCRIPT-007 e 009: só a pasta vazia se exclui. O corpo leva `folders` e `scripts`, e o detalhe diz o mesmo em palavras, só com a parte que existe.</summary>
    public static ApiErrorDto NotEmpty(string name, int folders, int scripts)
        => ApiErrorDto.Create("SCRIPT_FOLDER_NOT_EMPTY", Texts.Get("NotEmptyTitle"), HttpStatusCode.Conflict, Texts.Get("NotEmptyDetail", name, Contents(folders, scripts)), null, new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["folders"] = folders,
            ["scripts"] = scripts
        });

    /// <summary>"2 subpastas e 3 scripts", "1 subpasta", "1 script": no singular e no plural, e só com a parte que existe.</summary>
    internal static string Contents(int folders, int scripts)
    {
        var parts = new List<string>(2);
        if (folders > 0)
            parts.Add(folders == 1 ? Texts.Get("ContentsSubfolderOne") : Texts.Get("ContentsSubfolderMany", folders));

        if (scripts > 0)
            parts.Add(scripts == 1 ? Texts.Get("ContentsScriptOne") : Texts.Get("ContentsScriptMany", scripts));

        return string.Join(Texts.Get("ContentsJoin"), parts);
    }
}
