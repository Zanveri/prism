namespace Prism.Application.ConnectionTransfers.Models.Dtos;

/// <summary>
/// RN-TRANSF-014: a resposta da importação. `FolderIDs` e `ConnectionIDs` são os IDs criados (as pastas criadas, não as que já existiam), na ordem da
/// gravação, cada pasta antes do que está dentro dela; `MergedFolders`, quantas pastas do arquivo entraram numa que já existia; `Renamed` e `Skipped`, quantas
/// conexões foram com outro nome e quantas ficaram de fora. Sem nada criado, nada foi gravado.
/// </summary>
public sealed record ImportedConnectionsDto
{
    public IReadOnlyList<Guid> FolderIDs { get; init; } = [];
    public IReadOnlyList<Guid> ConnectionIDs { get; init; } = [];
    public int MergedFolders { get; init; }
    public int Renamed { get; init; }
    public int Skipped { get; init; }
}
