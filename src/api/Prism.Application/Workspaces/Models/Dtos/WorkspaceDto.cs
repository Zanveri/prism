namespace Prism.Application.Workspaces.Models.Dtos;

/// <summary>A resposta do `GET api/user/workspace` (RN-ABAS-006): as abas na ordem em que estavam e o índice da ativa; a lista vazia e o índice nulo quando nada foi gravado.</summary>
public sealed record WorkspaceDto
{
    public IReadOnlyList<WorkspaceTabDto> Tabs { get; init; } = [];
    public int? ActiveIndex { get; init; }

    /// <summary>RN-LOG-001: as abas levam o SQL do usuário.</summary>
    public override string ToString() => nameof(WorkspaceDto);
}
