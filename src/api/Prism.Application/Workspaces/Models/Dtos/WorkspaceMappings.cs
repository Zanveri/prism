using Prism.Application.Workspaces.Domain;
using Prism.Core.Mappers;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Workspaces.Models.Dtos;

internal static class WorkspaceMappings
{
    /// <summary>
    /// A leitura não precisa do domínio: lê o registro do cofre direto, que tem os mesmos campos. A aba de consulta gravada antes da 0.5.0 não tem o lugar do
    /// resultado, e volta no painel (RN-ABAS-016).
    /// </summary>
    public static WorkspaceDto ToDto(this VaultWorkspaceRecord source)
        => new() { Tabs = [.. source.Tabs.Select(ToDto)], ActiveIndex = source.ActiveIndex };

    private static WorkspaceTabDto ToDto(VaultWorkspaceTabRecord tab)
    {
        var dto = DomainDto.ToDto<VaultWorkspaceTabRecord, WorkspaceTabDto>(tab);

        return tab.Kind == WorkspaceTab.QueryKind ? dto with { ResultPlace = tab.ResultPlace ?? WorkspaceTab.PanelPlace } : dto;
    }

    /// <summary>O que a tela mandou, já conferido pelo validator (a forma de cada aba e o índice dentro da lista), como o domínio o guarda.</summary>
    public static Workspace ToDomain(this IReadOnlyList<WorkspaceTabDto> tabs, int? activeIndex)
        => Workspace.Create([.. tabs.Select(ToDomain)], activeIndex);

    private static WorkspaceTab ToDomain(WorkspaceTabDto tab)
        => tab.Kind == WorkspaceTab.TableKind
            ? WorkspaceTab.CreateTable(tab.ConnectionID!.Value, tab.Database, tab.Schema!, tab.Table!, tab.View!)
            : WorkspaceTab.CreateQuery(tab.ConnectionID, tab.Database, tab.Sql!, tab.ScriptID, tab.Dirty, tab.SqlTooLarge, tab.ResultPlace);
}
