using Bogus;
using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Features.CreateFolder;
using Prism.Application.Folders.Features.UpdateFolder;

namespace Prism.TestingCore.Fakers.Folders;

/// <summary>
/// A pasta como ela volta do cofre e os comandos de criação e de alteração. Cada parâmetro fixa um
/// campo; o que o teste não nomeia é sorteado, e é assim que um caso inválido quebra um campo por vez.
/// A pasta gravada como registro do cofre (`VaultFolderRecord`) vem do `VaultFakers.CreateFolder`.
/// </summary>
public static class FolderFakers
{
    /// <summary>O domínio só nasce por `Create` (ID novo, criada agora); o teste que precisa dela como o cofre a devolve usa o `Restore`.</summary>
    internal static Folder Create(Guid? iD = null, Guid? parentID = null, string? name = null, DateTime? createdAt = null, DateTime? updatedAt = null)
    {
        var created = createdAt ?? new Faker().Date.Recent().ToUniversalTime();

        return Folder.Restore(iD ?? Guid.CreateVersion7(), parentID, name ?? RandomName(), created, updatedAt ?? created);
    }

    public static CreateFolderCommand ReturnCreateFolderCommandValid(string? name = null, Guid? parentID = null)
        => new() { Name = name ?? RandomName(), ParentID = parentID };

    public static UpdateFolderCommand ReturnUpdateFolderCommandValid(Guid? iD = null, string? name = null, Guid? parentID = null)
        => new() { ID = iD ?? Guid.CreateVersion7(), Name = name ?? RandomName(), ParentID = parentID };

    public static string RandomName()
        => new Faker("pt_BR").Random.String2(length: 12, chars: "abcdefghijklmnopqrstuvwxyz");
}
