using Prism.Core.Api.Models.Dtos;
using System.Net;

namespace Prism.Application.ScriptFolders.Models;

/// <summary>
/// Os códigos e os status são os da seção 33 da especificação (RN-SCRIPT-007 e 009). O detalhe é a frase que a tela mostra no aviso de erro, quando a recusa
/// não é de campo: leva o nome da pasta, que é o que a pessoa digitou, e nunca vai ao log.
/// </summary>
internal static class ScriptFolderErrors
{
    public static ApiErrorDto NotFound(Guid id)
        => ApiErrorDto.CreateNotFound("Pasta não localizada.", "SCRIPT_FOLDER_NOT_FOUND", $"Não existe uma pasta de scripts com o ID {id}.");

    /// <summary>A pasta pai da criação, que outra janela excluiu no meio.</summary>
    public static ApiErrorDto ParentNotFound()
        => ApiErrorDto.CreateNotFound("Pasta pai não localizada.", "SCRIPT_FOLDER_NOT_FOUND", "A pasta pai não existe mais.");

    /// <summary>O destino do "Mover para…", de uma pasta ou de um script, que outra janela excluiu no meio.</summary>
    public static ApiErrorDto DestinationNotFound()
        => ApiErrorDto.CreateNotFound("Pasta de destino não localizada.", "SCRIPT_FOLDER_NOT_FOUND", "A pasta de destino não existe mais.");

    /// <summary>A pasta escolhida no campo "Pasta" ao salvar o script (RN-SCRIPT-010), que outra janela excluiu no meio.</summary>
    public static ApiErrorDto ChosenNotFound()
        => ApiErrorDto.CreateNotFound("Pasta não localizada.", "SCRIPT_FOLDER_NOT_FOUND", "A pasta escolhida não existe mais.");

    /// <summary>RN-SCRIPT-007: o nome repetido entre as irmãs. <paramref name="place"/> é o caminho da pasta pai, ou nulo na raiz.</summary>
    public static ApiErrorDto AlreadyExists(string name, string? place)
        => ApiErrorDto.CreateConflict("Pasta já existe.", "SCRIPT_FOLDER_ALREADY_EXISTS", place is null ? $"Já existe uma pasta chamada {name} na raiz da seção Scripts." : $"Já existe uma pasta chamada {name} em {place}.");

    /// <summary>RN-SCRIPT-007.</summary>
    public static ApiErrorDto Cycle()
        => ApiErrorDto.CreateConflict("Movimento inválido.", "SCRIPT_FOLDER_CYCLE", "Uma pasta não pode ir para dentro dela mesma nem de uma subpasta dela.");

    /// <summary>RN-SCRIPT-007 e 009: só a pasta vazia se exclui. O corpo leva `folders` e `scripts`, e o detalhe diz o mesmo em palavras, só com a parte que existe.</summary>
    public static ApiErrorDto NotEmpty(string name, int folders, int scripts)
        => ApiErrorDto.Create("SCRIPT_FOLDER_NOT_EMPTY", "Pasta não está vazia.", HttpStatusCode.Conflict, $"A pasta {name} tem {Contents(folders, scripts)}. Só uma pasta vazia pode ser excluída: mova ou exclua antes o que está dentro dela.", null, new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["folders"] = folders,
            ["scripts"] = scripts
        });

    /// <summary>"2 subpastas e 3 scripts", "1 subpasta", "1 script": no singular e no plural, e só com a parte que existe.</summary>
    internal static string Contents(int folders, int scripts)
    {
        var parts = new List<string>(2);
        if (folders > 0)
            parts.Add(folders == 1 ? "1 subpasta" : $"{folders} subpastas");

        if (scripts > 0)
            parts.Add(scripts == 1 ? "1 script" : $"{scripts} scripts");

        return string.Join(" e ", parts);
    }
}
