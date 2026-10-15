namespace Prism.Application.Common.Protections;

/// <summary>
/// RN-PROT-004: as proteções que valem (`protections`), na conexão e na pasta. `ReadOnlyFolderID` e `ConfirmCommandsFolderID` são a pasta acima que impõe
/// o valor, para a tela dizer "herdado da pasta X"; nulos quando o valor é o próprio, ou quando não há proteção. `ConfirmCommands` nulo é "Não".
/// </summary>
public sealed record ProtectionsDto
{
    public bool ReadOnly { get; init; }
    public Guid? ReadOnlyFolderID { get; init; }
    public string? ConfirmCommands { get; init; }
    public Guid? ConfirmCommandsFolderID { get; init; }
}
