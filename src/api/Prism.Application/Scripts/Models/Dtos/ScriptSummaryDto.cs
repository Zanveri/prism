namespace Prism.Application.Scripts.Models.Dtos;

/// <summary>O script na lista, e na resposta de criar e de alterar: sem o SQL, que pode ter até 1 MB e só vem pela rota do item.</summary>
public sealed record ScriptSummaryDto
{
    public Guid ID { get; init; }
    public string Name { get; init; } = string.Empty;

    /// <summary>A conexão da aba em que foi salvo; pode ser de uma conexão que já não existe (RN-SCRIPT-003).</summary>
    public Guid? ConnectionID { get; init; }

    /// <summary>Nulo é o banco da conexão.</summary>
    public string? Database { get; init; }

    /// <summary>RN-SCRIPT-007: a pasta de scripts em que ele está, nula na raiz da seção Scripts.</summary>
    public Guid? FolderID { get; init; }

    /// <summary>RN-SCRIPT-006: um ícone da lista fechada, nulo no padrão (o documento), e a cor dele, nula no script sem cor.</summary>
    public string? Icon { get; init; }
    public string? Color { get; init; }
    public DateTime UpdatedAt { get; init; }
}
