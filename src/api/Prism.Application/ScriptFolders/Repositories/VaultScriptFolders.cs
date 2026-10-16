using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.ScriptFolders.Repositories;

/// <summary>
/// As regras das pastas de scripts (RN-SCRIPT-007) como perguntas sobre um documento do cofre, para a função entregue ao `SaveAsync`: o serviço a roda com o
/// semáforo tomado, sobre o documento mais recente, e é aí que a regra e a gravação deixam de poder se separar. As do script que vai para uma pasta
/// (`ScriptRepository`) usam as mesmas.
/// </summary>
internal static class VaultScriptFolders
{
    public static bool ExistsByID(VaultDocument document, Guid id)
        => document.ScriptFolders.Any(folder => folder.ID == id);

    /// <summary>O nome é único entre as irmãs, sem diferenciar maiúsculas. `exceptID` tira da conferência a própria pasta, para ela não colidir com o nome que já tem.</summary>
    public static bool Exists(VaultDocument document, string name, Guid? parentID, Guid? exceptID = null)
        => document.ScriptFolders.Any(folder => folder.ParentID == parentID && folder.ID != exceptID && string.Equals(folder.Name, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>O que impede a exclusão: as subpastas e os scripts que estão direto dentro da pasta.</summary>
    public static (int Folders, int Scripts) Contents(VaultDocument document, Guid id)
        => (document.ScriptFolders.Count(folder => folder.ParentID == id), document.Scripts.Count(script => script.FolderID == id));

    /// <summary>
    /// `candidateID` é a própria pasta `ancestorID` ou está dentro dela, a qualquer profundidade. Sobe pelas pastas pai a partir do candidato; o registro das
    /// já visitadas limita a subida, para um documento que já tivesse um ciclo não prender a requisição num laço com o cofre reservado.
    /// </summary>
    public static bool IsSelfOrDescendant(VaultDocument document, Guid candidateID, Guid ancestorID)
    {
        var parents = document.ScriptFolders.ToDictionary(folder => folder.ID, folder => folder.ParentID);
        var visited = new HashSet<Guid>();
        Guid? current = candidateID;

        while (current is { } id && visited.Add(id))
        {
            if (id == ancestorID)
                return true;

            current = parents.GetValueOrDefault(id);
        }

        return false;
    }

    /// <summary>
    /// O caminho da pasta, da raiz até ela, como a tela o escreve ("Fechamento / Mensal"), para o detalhe de uma recusa; nulo na raiz. A subida para numa
    /// pasta que não está no documento, e num ciclo.
    /// </summary>
    public static string? PathOf(VaultDocument document, Guid? id)
    {
        var byID = document.ScriptFolders.ToDictionary(folder => folder.ID);
        var names = new List<string>();
        var visited = new HashSet<Guid>();

        while (id is { } current && visited.Add(current) && byID.TryGetValue(current, out var folder))
        {
            names.Add(folder.Name);
            id = folder.ParentID;
        }

        if (names.Count == 0)
            return null;

        names.Reverse();

        return string.Join(" / ", names);
    }
}
