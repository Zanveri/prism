namespace Prism.Application.ScriptFolders.Models.Dtos;

/// <summary>Uma pasta de scripts (RN-SCRIPT-007): a lista e as respostas de criar e de alterar.</summary>
public sealed record ScriptFolderDto
{
    public Guid ID { get; init; }

    /// <summary>`null` é a raiz da seção Scripts.</summary>
    public Guid? ParentID { get; init; }
    public string Name { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o nome da pasta.</summary>
    public override string ToString() => nameof(ScriptFolderDto);
}
