using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Folders.Repositories;

/// <summary>
/// As regras das pastas (RN-PASTA-002 a 004) como perguntas sobre um documento do cofre. Moram num lugar
/// só porque são feitas duas vezes: pelo `FolderQueries`, que confere antes para responder com o erro
/// certo, e pelo `FolderRepository`, de dentro da função entregue ao `SaveAsync`. Só a segunda vale
/// contra uma requisição concorrente: o serviço do cofre a roda com o semáforo tomado, sobre o documento
/// mais recente, e é aí que a regra e a gravação deixam de poder se separar.
/// </summary>
internal static class VaultFolders
{
    public static bool ExistsByID(VaultDocument document, Guid id)
        => document.Folders.Any(folder => folder.ID == id);

    /// <summary>
    /// RN-PASTA-002: o nome é único entre as irmãs, sem diferenciar maiúsculas. `exceptID` tira da
    /// conferência a própria pasta que está sendo salva, para ela não colidir com o nome que já tem.
    /// </summary>
    public static bool Exists(VaultDocument document, string name, Guid? parentID, Guid? exceptID = null)
        => document.Folders.Any(folder => folder.ParentID == parentID && folder.ID != exceptID && string.Equals(folder.Name, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>RN-PASTA-004: subpastas e conexões contam do mesmo jeito.</summary>
    public static bool HasChildren(VaultDocument document, Guid id)
        => document.Folders.Any(folder => folder.ParentID == id) || document.Connections.Any(connection => connection.FolderID == id);

    /// <summary>
    /// RN-PASTA-003: `candidateID` é a própria pasta `ancestorID` ou está dentro dela, a qualquer profundidade.
    /// Sobe pelas pastas pai a partir do candidato. O registro das pastas já visitadas limita a subida: o
    /// documento não deveria ter ciclo (é esta regra que o impede), mas um que já tivesse prenderia a
    /// requisição num laço com o cofre reservado.
    /// </summary>
    public static bool IsSelfOrDescendant(VaultDocument document, Guid candidateID, Guid ancestorID)
    {
        var parents = document.Folders.ToDictionary(folder => folder.ID, folder => folder.ParentID);
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
}
