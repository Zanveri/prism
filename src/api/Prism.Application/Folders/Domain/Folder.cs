using Prism.Application.Common.Environments;
using Prism.Core.Extensions;

namespace Prism.Application.Folders.Domain;

/// <summary>
/// RN-PASTA-001: uma pasta tem nome (1 a 60 caracteres, regra do validator) e uma pasta pai opcional;
/// sem pai ela está na raiz. RN-PASTA-005: e um ambiente opcional (nome e cor), com as regras e a
/// normalização do ambiente da conexão (`EnvironmentRules`). O ID nasce aqui, e não no cofre: a tela o
/// recebe na resposta da criação.
/// </summary>
internal sealed class Folder
{
    public Guid ID { get; }
    public Guid? ParentID { get; private set; }
    public string Name { get; private set; }
    public string? EnvironmentName { get; private set; }
    public string? EnvironmentColor { get; private set; }
    public DateTime CreatedAt { get; }
    public DateTime UpdatedAt { get; private set; }

    private Folder(Guid id, Guid? parentID, string name, string? environmentName, string? environmentColor, DateTime createdAt, DateTime updatedAt)
    {
        ID = id;
        ParentID = parentID;
        Name = name;
        EnvironmentName = environmentName;
        EnvironmentColor = environmentColor;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public static Folder Create(string name, Guid? parentID, string? environmentName, string? environmentColor, DateTime createdAt)
        => new(Guid.CreateVersion7(), parentID, name.NormalizeName(), EnvironmentRules.NormalizeName(environmentName), EnvironmentRules.NormalizeColor(environmentColor), createdAt, createdAt);

    /// <summary>
    /// A pasta como o cofre a guarda, para o repository: o cofre não tem SQL que materialize o construtor
    /// privado. Nada é normalizado nem carimbado, porque o que está gravado já passou pelo `Create`.
    /// </summary>
    public static Folder Restore(Guid id, Guid? parentID, string name, string? environmentName, string? environmentColor, DateTime createdAt, DateTime updatedAt)
        => new(id, parentID, name, environmentName, environmentColor, createdAt, updatedAt);

    public void Rename(string name, DateTime updatedAt)
    {
        Name = name.NormalizeName();
        UpdatedAt = updatedAt;
    }

    /// <summary>RN-PASTA-005: em branco tira o ambiente da pasta, e as conexões dela sem ambiente próprio deixam de herdá-lo.</summary>
    public void ChangeEnvironment(string? environmentName, string? environmentColor, DateTime updatedAt)
    {
        EnvironmentName = EnvironmentRules.NormalizeName(environmentName);
        EnvironmentColor = EnvironmentRules.NormalizeColor(environmentColor);
        UpdatedAt = updatedAt;
    }

    /// <summary>`null` é a raiz. Quem confere que a pasta pai existe e que o movimento não fecha um ciclo (RN-PASTA-003) é o handler e, dentro da gravação, o repository.</summary>
    public void MoveTo(Guid? parentID, DateTime updatedAt)
    {
        ParentID = parentID;
        UpdatedAt = updatedAt;
    }
}
