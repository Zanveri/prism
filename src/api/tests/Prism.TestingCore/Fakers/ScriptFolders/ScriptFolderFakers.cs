using Bogus;
using Prism.Application.ScriptFolders.Domain;
using Prism.Application.ScriptFolders.Features.CreateScriptFolder;
using Prism.Application.ScriptFolders.Features.UpdateScriptFolder;

namespace Prism.TestingCore.Fakers.ScriptFolders;

/// <summary>
/// A pasta de scripts como ela volta do cofre e os comandos de criação e de alteração (RN-SCRIPT-007). Cada parâmetro fixa um campo; o que o teste não nomeia
/// é sorteado. A pasta gravada como registro do cofre (`VaultScriptFolderRecord`) vem do `VaultFakers.CreateScriptFolder`.
/// </summary>
public static class ScriptFolderFakers
{
    internal static ScriptFolder Create(Guid? iD = null, Guid? parentID = null, string? name = null, DateTime? createdAt = null)
    {
        var created = createdAt ?? new Faker().Date.Recent().ToUniversalTime();

        return ScriptFolder.Restore(iD ?? Guid.CreateVersion7(), parentID, name ?? RandomName(), created, created);
    }

    public static CreateScriptFolderCommand ReturnCreateScriptFolderCommandValid(string? name = null, Guid? parentID = null)
        => new() { Name = name ?? RandomName(), ParentID = parentID };

    /// <summary>O `PATCH` leva a pasta por inteiro: o nome e a pasta pai (nula é a raiz).</summary>
    public static UpdateScriptFolderCommand ReturnUpdateScriptFolderCommandValid(Guid? iD = null, string? name = null, Guid? parentID = null)
        => new() { ID = iD ?? Guid.CreateVersion7(), Name = name ?? RandomName(), ParentID = parentID };

    public static string RandomName()
        => new Faker("pt_BR").Random.String2(length: 12, chars: "abcdefghijklmnopqrstuvwxyz");
}
