using Prism.Core.Extensions;

namespace Prism.Application.ScriptFolders.Domain;

/// <summary>
/// RN-SCRIPT-007: uma pasta de scripts é um nome (1 a 60 caracteres depois de normalizado, sem caractere de controle e único entre as irmãs: regras do
/// validator e do repository) e uma pasta pai opcional; sem ela, a pasta fica na raiz da seção Scripts. É da seção Scripts, e não uma pasta de conexões: não
/// tem ambiente, cor nem proteções. O ID nasce aqui, e não no cofre: a tela o recebe na resposta da criação.
/// </summary>
internal sealed class ScriptFolder
{
    public Guid ID { get; }
    public Guid? ParentID { get; private set; }
    public string Name { get; private set; }
    public DateTime CreatedAt { get; }
    public DateTime UpdatedAt { get; private set; }

    private ScriptFolder(Guid id, Guid? parentID, string name, DateTime createdAt, DateTime updatedAt)
    {
        ID = id;
        ParentID = parentID;
        Name = name;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    public static ScriptFolder Create(string name, Guid? parentID, DateTime createdAt)
        => new(Guid.CreateVersion7(), parentID, name.NormalizeName(), createdAt, createdAt);

    /// <summary>A pasta como o cofre a guarda, para o repository. Nada é normalizado nem carimbado: o que está gravado já passou pelo `Create`.</summary>
    public static ScriptFolder Restore(Guid id, Guid? parentID, string name, DateTime createdAt, DateTime updatedAt)
        => new(id, parentID, name, createdAt, updatedAt);

    /// <summary>
    /// A alteração do `PATCH`, que grava a pasta por inteiro: o nome e a pasta pai (`null` é a raiz). Mudar só as maiúsculas do nome é mudança. Devolve se
    /// algo mudou: nada mudou (a tela salvou sem editar) não carimba a data, e o repository não regrava o cofre. Quem confere que a pasta pai existe, que o
    /// movimento não fecha um ciclo e que o nome não se repete entre as irmãs é o repository, dentro da gravação.
    /// </summary>
    public bool Change(string name, Guid? parentID, DateTime updatedAt)
    {
        var newName = name.NormalizeName();
        if (string.Equals(newName, Name, StringComparison.Ordinal) && parentID == ParentID)
            return false;

        Name = newName;
        ParentID = parentID;
        UpdatedAt = updatedAt;

        return true;
    }
}
