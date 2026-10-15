namespace Prism.Application.Common.Protections;

/// <summary>
/// RN-PROT-004: as proteções que valem para uma conexão ou uma pasta (a própria e as das pastas acima) e de onde cada uma vem: a pasta acima que impõe o
/// valor, ou nula quando ele é o próprio (ou não há proteção). `ConfirmCommands` nulo é "Não".
/// </summary>
internal sealed record EffectiveProtections(bool ReadOnly, Guid? ReadOnlyFolderID, string? ConfirmCommands, Guid? ConfirmCommandsFolderID)
{
    public ProtectionsDto ToDto()
        => new() { ReadOnly = ReadOnly, ReadOnlyFolderID = ReadOnlyFolderID, ConfirmCommands = ConfirmCommands, ConfirmCommandsFolderID = ConfirmCommandsFolderID };
}
