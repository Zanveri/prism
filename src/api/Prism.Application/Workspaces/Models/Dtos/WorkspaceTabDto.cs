namespace Prism.Application.Workspaces.Models.Dtos;

/// <summary>
/// Uma aba da área de trabalho (RN-ABAS-006), como a tela a manda no `PUT api/user/workspace` e a recebe no `GET`. `kind` é `query` (a aba de consulta: `sql`,
/// `connectionID`, `database`, `scriptID`, `dirty`, `sqlTooLarge` e `resultPlace`) ou `table` (a aba de uma tabela: `connectionID`, `database`, `schema`, `table`
/// e `view`); os campos do outro tipo vão nulos (ou falsos). `resultPlace` é o lugar do resultado da aba de consulta (RN-ABAS-016): `panel`, `tab` ou `window`;
/// ausente ou nulo no `PUT`, é `panel`, e o `GET` o traz sempre na aba de consulta (a gravada antes da 0.5.0 volta como `panel`).
/// </summary>
public sealed record WorkspaceTabDto
{
    public string Kind { get; init; } = string.Empty;
    public Guid? ConnectionID { get; init; }
    public string? Database { get; init; }
    public string? Sql { get; init; }
    public Guid? ScriptID { get; init; }
    public bool Dirty { get; init; }
    public bool SqlTooLarge { get; init; }
    public string? Schema { get; init; }
    public string? Table { get; init; }
    public string? View { get; init; }
    public string? ResultPlace { get; init; }

    /// <summary>RN-LOG-001: o `ToString()` gerado de um record imprimiria o texto do SQL.</summary>
    public override string ToString() => nameof(WorkspaceTabDto);
}
