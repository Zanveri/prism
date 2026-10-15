using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Core.Extensions;

namespace Prism.Application.Folders.Domain;

/// <summary>
/// RN-PASTA-001: uma pasta tem nome (1 a 60 caracteres, regra do validator) e uma pasta pai opcional;
/// sem pai ela está na raiz. RN-PASTA-005: e um ambiente opcional (nome e cor), com as regras e a
/// normalização do ambiente da conexão (`EnvironmentRules`). RN-PASTA-007: e uma cor própria, opcional,
/// a do ícone dela na árvore, que não é a do ambiente (com a mesma regra de `#RRGGBB`). O ID nasce aqui,
/// e não no cofre: a tela o recebe na resposta da criação.
///
/// RN-PROT-001 e 002: e as proteções próprias, a confirmação (`ConfirmCommands`, nula é "Não") e o somente leitura, já normalizadas
/// (`ProtectionRules`). Elas valem para tudo o que está dentro da pasta (RN-PROT-004), mas a herança não é do domínio: é do documento
/// inteiro (`ProtectionRules.Of`), e quem confere a senha que o somente leitura pede é a gravação (RN-PROT-003).
/// </summary>
internal sealed class Folder
{
    public Guid ID { get; }
    public Guid? ParentID { get; private set; }
    public string Name { get; private set; }
    public string? EnvironmentName { get; private set; }
    public string? EnvironmentColor { get; private set; }
    public string? Color { get; private set; }
    public string? ConfirmCommands { get; private set; }
    public bool ReadOnly { get; private set; }
    public DateTime CreatedAt { get; }
    public DateTime UpdatedAt { get; private set; }

    private Folder(Guid id, Guid? parentID, string name, string? environmentName, string? environmentColor, string? color, string? confirmCommands, bool readOnly, DateTime createdAt, DateTime updatedAt)
    {
        ID = id;
        ParentID = parentID;
        Name = name;
        EnvironmentName = environmentName;
        EnvironmentColor = environmentColor;
        Color = color;
        ConfirmCommands = confirmCommands;
        ReadOnly = readOnly;
        CreatedAt = createdAt;
        UpdatedAt = updatedAt;
    }

    /// <summary>RN-PROT-003: criar uma pasta já somente leitura não pede a senha do usuário (nada do que existe muda).</summary>
    public static Folder Create(string name, Guid? parentID, string? environmentName, string? environmentColor, string? color, string? confirmCommands, bool readOnly, DateTime createdAt)
        => new(Guid.CreateVersion7(), parentID, name.NormalizeName(), EnvironmentRules.NormalizeName(environmentName), EnvironmentRules.NormalizeColor(environmentColor), EnvironmentRules.NormalizeColor(color), ProtectionRules.NormalizeConfirmation(confirmCommands), readOnly, createdAt, createdAt);

    /// <summary>
    /// A pasta como o cofre a guarda, para o repository: o cofre não tem SQL que materialize o construtor
    /// privado. Nada é normalizado nem carimbado, porque o que está gravado já passou pelo `Create`.
    /// </summary>
    public static Folder Restore(Guid id, Guid? parentID, string name, string? environmentName, string? environmentColor, string? color, string? confirmCommands, bool readOnly, DateTime createdAt, DateTime updatedAt)
        => new(id, parentID, name, environmentName, environmentColor, color, confirmCommands, readOnly, createdAt, updatedAt);

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

    /// <summary>RN-PASTA-007: em branco tira a cor, e o ícone da pasta volta ao neutro. O ambiente não muda.</summary>
    public void ChangeColor(string? color, DateTime updatedAt)
    {
        Color = EnvironmentRules.NormalizeColor(color);
        UpdatedAt = updatedAt;
    }

    /// <summary>
    /// RN-PROT-001 e 002: em branco (ou `none`) a confirmação volta a "Não". Marcar ou desmarcar o somente leitura de uma pasta que existe pede a senha
    /// do usuário (RN-PROT-003), e quem a confere é a gravação, contra o documento mais recente.
    /// </summary>
    public void ChangeProtections(string? confirmCommands, bool readOnly, DateTime updatedAt)
    {
        ConfirmCommands = ProtectionRules.NormalizeConfirmation(confirmCommands);
        ReadOnly = readOnly;
        UpdatedAt = updatedAt;
    }

    /// <summary>`null` é a raiz. Quem confere que a pasta pai existe e que o movimento não fecha um ciclo (RN-PASTA-003) é o handler e, dentro da gravação, o repository.</summary>
    public void MoveTo(Guid? parentID, DateTime updatedAt)
    {
        ParentID = parentID;
        UpdatedAt = updatedAt;
    }
}
