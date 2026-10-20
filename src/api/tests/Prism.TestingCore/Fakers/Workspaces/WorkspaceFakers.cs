using Bogus;
using Prism.Application.Workspaces.Features.SaveWorkspace;
using Prism.Application.Workspaces.Models.Dtos;

namespace Prism.TestingCore.Fakers.Workspaces;

/// <summary>
/// As abas como a tela as manda no `PUT api/user/workspace` (RN-ABAS-006): a de consulta e a de uma tabela, e o comando com a lista. Cada parâmetro fixa um
/// campo; o que o teste não nomeia é sorteado. As abas gravadas como registro do cofre vêm do `VaultFakers.CreateQueryTab` e `CreateTableTab`.
/// </summary>
public static class WorkspaceFakers
{
    public static WorkspaceTabDto QueryTab(Guid? connectionID = null, string? database = null, string? sql = null, Guid? scriptID = null, bool dirty = false, bool sqlTooLarge = false, string? resultPlace = null)
        => new() { Kind = "query", ConnectionID = connectionID, Database = database, Sql = sql ?? RandomSql(), ScriptID = scriptID, Dirty = dirty, SqlTooLarge = sqlTooLarge, ResultPlace = resultPlace };

    public static WorkspaceTabDto TableTab(Guid? connectionID = null, string? database = null, string schema = "loja", string table = "clientes", string view = "data")
        => new() { Kind = "table", ConnectionID = connectionID ?? Guid.CreateVersion7(), Database = database, Schema = schema, Table = table, View = view };

    /// <summary>Sem abas, a área de trabalho vazia; com abas e sem índice, a primeira é a ativa.</summary>
    public static SaveWorkspaceCommand ReturnSaveWorkspaceCommandValid(IReadOnlyList<WorkspaceTabDto>? tabs = null, int? activeIndex = null)
    {
        var list = tabs ?? [QueryTab(connectionID: Guid.CreateVersion7()), TableTab()];

        return new() { Tabs = list, ActiveIndex = activeIndex ?? (list.Count == 0 ? null : 0) };
    }

    public static string RandomSql()
        => $"SELECT {new Faker().Random.Int(min: 1, max: 9999)}";
}
