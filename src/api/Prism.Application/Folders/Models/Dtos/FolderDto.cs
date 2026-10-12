namespace Prism.Application.Folders.Models.Dtos;

public sealed record FolderDto
{
    public Guid ID { get; init; }

    /// <summary>`null` é a raiz.</summary>
    public Guid? ParentID { get; init; }
    public string Name { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
}
