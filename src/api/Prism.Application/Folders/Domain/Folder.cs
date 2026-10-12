using Prism.Core.Extensions;

namespace Prism.Application.Folders.Domain;

/// <summary>
/// RN-PASTA-001: uma pasta tem nome (1 a 60 caracteres, regra do validator) e uma pasta pai opcional;
/// sem pai ela está na raiz. O ID nasce aqui, e não no cofre: a tela o recebe na resposta da criação.
/// </summary>
internal sealed class Folder
{
    public Guid ID { get; }
    public Guid? ParentID { get; private set; }
    public string Name { get; private set; }
    public DateTime CreatedAt { get; }
    public DateTime UpdatedAt { get; private set; }

    private Folder(Guid id, Guid? parentID, string name, DateTime createdAt, DateTime updatedAt)
    {
        ID = id;
        ParentID = parentID;
        Name = name;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public static Folder Create(string name, Guid? parentID, DateTime createdAt)
        => new(Guid.CreateVersion7(), parentID, name.NormalizeName(), createdAt, createdAt);

    /// <summary>
    /// A pasta como o cofre a guarda, para o repository: o cofre não tem SQL que materialize o construtor
    /// privado. Nada é normalizado nem carimbado, porque o que está gravado já passou pelo `Create`.
    /// </summary>
    public static Folder Restore(Guid id, Guid? parentID, string name, DateTime createdAt, DateTime updatedAt)
        => new(id, parentID, name, createdAt, updatedAt);

    public void Rename(string name, DateTime updatedAt)
    {
        Name = name.NormalizeName();
        UpdatedAt = updatedAt;
    }

    /// <summary>`null` é a raiz. Quem confere que a pasta pai existe e que o movimento não fecha um ciclo (RN-PASTA-003) é o handler e, dentro da gravação, o repository.</summary>
    public void MoveTo(Guid? parentID, DateTime updatedAt)
    {
        ParentID = parentID;
        UpdatedAt = updatedAt;
    }
}
