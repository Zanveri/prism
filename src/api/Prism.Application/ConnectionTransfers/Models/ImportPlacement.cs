using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Connections.Domain;
using Prism.Application.Connections.Models;
using Prism.Application.Connections.Repositories;
using Prism.Application.Folders.Domain;
using Prism.Application.Folders.Repositories;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// RN-TRANSF-012 a 014: onde o que vem do arquivo fica, contra um documento do cofre. É a mesma conta na prévia (com tudo o que pode ser importado marcado,
/// contra o documento daquele instante) e na importação (com o que ficou marcado, contra o documento mais recente, dentro da gravação): a prévia diz o que
/// aconteceria no momento dela, e a importação refaz tudo.
///
/// - O que está na raiz do arquivo vai para o lugar escolhido (a raiz do navegador ou uma pasta), com a estrutura do arquivo embaixo dele. As pastas do
///   caminho de cada item marcado vão sozinhas, e cada pasta é posta antes do que está dentro dela.
/// - Pasta: a do arquivo com o mesmo nome de uma que já existe no mesmo lugar (sem diferenciar maiúsculas, o nome normalizado como na criação, RN-PASTA-002)
///   é essa pasta, e a que existe fica como está. Duas irmãs com o mesmo nome no arquivo viram uma só. As outras são criadas.
/// - Conexão: o nome tomado no lugar (RN-CONN-011), pelo que já existe e pelo que a mesma importação já pôs, segue a escolha única: outro nome, o da cópia
///   do "Duplicar conexão" (RN-CONN-016), ou fica de fora. Nada que existe é mudado nem sobrescrito.
/// - Nunca mais fraca que na origem (RN-TRANSF-013): posta no lugar, a conexão (e a pasta criada) tem as proteções que valeriam ali, as dela e as das pastas
///   acima, as que já existiam e as que a importação criou; se o somente leitura ou a confirmação da origem não valeriam, são gravados nela mesma. O ambiente
///   da conexão sem ambiente próprio que ali herdaria outro, ou nenhum, é gravado nela, com a cor.
/// - Todos os IDs são novos (os do domínio, `Folder.Create` e `Connection.Create`, com a normalização da criação), e as datas são as da importação. Criar
///   assim, mesmo somente leitura, não pede a senha do Prism (RN-PROT-003): nada do que existe muda.
///
/// Uma passada pelas pastas e uma pelas conexões, com os nomes de cada lugar num dicionário: a função roda com o cofre reservado.
/// </summary>
internal static class ImportPlacement
{
    /// <summary>A chave dos dicionários de cada lugar: `Guid.Empty` é a raiz (um dicionário não aceita chave nula).</summary>
    private static Guid PlaceKey(Guid? folderID)
        => folderID ?? Guid.Empty;

    public static ImportPlacementResult Place(VaultDocument document, Guid? targetFolderID, ImportAnalysis analysis, IReadOnlySet<string> selected, EImportConflict onConflict, bool keepVerificationQueries, DateTime now)
    {
        var folders = document.Folders.ToDictionary(folder => folder.ID);
        var folderNames = new Dictionary<Guid, Dictionary<string, Guid>>();
        foreach (var folder in document.Folders)
            NamesIn(folderNames, folder.ParentID).TryAdd(folder.Name, folder.ID);

        var connectionNames = new Dictionary<Guid, HashSet<string>>();
        foreach (var connection in document.Connections)
            ConnectionNamesIn(connectionNames, connection.FolderID).Add(connection.Name);

        var result = new ImportPlacementResult();
        var createdFolders = new List<VaultFolderRecord>();
        var createdConnections = new List<VaultConnectionRecord>();
        var foldersToPlace = FoldersToPlace(analysis, selected);

        foreach (var item in analysis.Folders.Where(folder => folder.Candidate is not null && foldersToPlace.Contains(folder.Key)))
        {
            var candidate = item.Candidate!;
            var parentID = item.ParentKey is { } parentKey ? result.Folders[parentKey].ID : targetFolderID;
            var names = NamesIn(folderNames, parentID);

            if (names.TryGetValue(candidate.Name, out var existingID))
            {
                result.Folders[item.Key] = new FolderPlacement(existingID, Merged: true, Strengthening.None);
                result.MergedFolders++;

                continue;
            }

            var record = FolderRepository.ToRecord(Folder.Create(candidate.Name, parentID, candidate.EnvironmentName, candidate.EnvironmentColor, candidate.Color, candidate.ConfirmCommands, candidate.ReadOnly, now));
            var (strengthened, strengthening) = Strengthen(folders, parentID, record.ReadOnly == true, record.ConfirmCommands, item.Origin!);
            record = record with { ReadOnly = ProtectionRules.ToRecord(strengthened.ReadOnly), ConfirmCommands = strengthened.ConfirmCommands };

            folders[record.ID] = record;
            names[record.Name] = record.ID;
            createdFolders.Add(record);
            result.Folders[item.Key] = new FolderPlacement(record.ID, Merged: false, strengthening);
            result.CreatedFolderIDs.Add(record.ID);
            result.Strengthened += strengthening.Any ? 1 : 0;
        }

        foreach (var item in analysis.Connections.Where(connection => connection.Candidate is not null && selected.Contains(connection.Key)))
        {
            var candidate = item.Candidate!;
            var folderID = item.FolderKey is { } folderKey ? result.Folders[folderKey].ID : targetFolderID;
            var names = ConnectionNamesIn(connectionNames, folderID);
            var name = candidate.Name;
            var conflict = names.Contains(name);
            var copyName = conflict ? ConnectionRules.CopyName(name, names.Contains) : null;

            if (conflict && onConflict == EImportConflict.Skip)
            {
                result.Connections[item.Key] = new ConnectionPlacement(null, Conflict: true, copyName, Skipped: true, Strengthening.None);
                result.Skipped++;

                continue;
            }

            // RN-TRANSF-011: desmarcada a caixa "Manter as consultas de verificação do arquivo" (o padrão), a conexão de consulta própria entra com a do banco; a
            // verificação, ligada ou não, e o intervalo continuam os do arquivo.
            var query = keepVerificationQueries ? candidate.VerificationQuery : null;
            var safeguards = ConnectionSafeguards.From(candidate.ConfirmCommands, candidate.ReadOnly, candidate.VerificationEnabled, candidate.VerificationInterval, query);
            var connection = Connection.Create(folderID, copyName ?? name, candidate.Engine, candidate.Host, candidate.Port, candidate.Database, candidate.UserName, candidate.Password, candidate.EnvironmentName, candidate.EnvironmentColor, safeguards, now);
            var record = ConnectionRecords.ToRecord(connection);

            var (strengthened, strengthening) = Strengthen(folders, folderID, record.ReadOnly == true, record.ConfirmCommands, item.Origin!);
            record = record with { ReadOnly = ProtectionRules.ToRecord(strengthened.ReadOnly), ConfirmCommands = strengthened.ConfirmCommands };

            // RN-TRANSF-013: a conexão sem ambiente próprio que na origem mostrava um, e que ali herdaria outro (pelo nome, sem diferenciar maiúsculas) ou
            // nenhum, grava o da origem nela mesma, com a cor. A que na origem não tinha ambiente fica com o que o lugar lhe der.
            if (record.EnvironmentName is null && item.Origin!.Environment is { } origin)
            {
                var inherited = EnvironmentRules.InheritedIn(folders, folderID);
                if (inherited is null || !string.Equals(inherited.Name, origin.Name, StringComparison.OrdinalIgnoreCase))
                {
                    record = record with { EnvironmentName = origin.Name, EnvironmentColor = origin.Color };
                    strengthening = strengthening with { EnvironmentName = origin.Name, EnvironmentColor = origin.Color };
                }
            }

            names.Add(record.Name);
            createdConnections.Add(record);
            result.Connections[item.Key] = new ConnectionPlacement(record.ID, conflict, copyName, Skipped: false, strengthening);
            result.CreatedConnectionIDs.Add(record.ID);
            result.Renamed += conflict ? 1 : 0;
            result.Strengthened += strengthening.Any ? 1 : 0;

            if (candidate.VerificationQuery is not null)
            {
                result.QueriesKept += keepVerificationQueries ? 1 : 0;
                result.QueriesReplaced += keepVerificationQueries ? 0 : 1;
            }
        }

        // RN-TRANSF-014: nada criado é nada a gravar, e a mesma instância faz o cofre não regravar (o `.bak` continua o de antes).
        result.Document = createdFolders.Count == 0 && createdConnections.Count == 0
            ? document
            : document with { Folders = [.. document.Folders, .. createdFolders], Connections = [.. document.Connections, .. createdConnections] };

        return result;
    }

    /// <summary>
    /// RN-TRANSF-014: as pastas que vão: as marcadas e as do caminho de cada pasta e de cada conexão marcada, até a raiz do arquivo. Só o que pode ser
    /// importado conta (a chave do que não pode é ignorada), e o caminho de quem pode ser importado sempre pode (a pasta que não passa leva junto o de dentro).
    /// </summary>
    private static HashSet<string> FoldersToPlace(ImportAnalysis analysis, IReadOnlySet<string> selected)
    {
        var place = new HashSet<string>(StringComparer.Ordinal);

        void AddWithPath(string? key)
        {
            while (key is not null && analysis.FoldersByKey.TryGetValue(key, out var folder) && folder.Candidate is not null && place.Add(key))
                key = folder.ParentKey;
        }

        foreach (var key in selected)
        {
            if (analysis.FoldersByKey.TryGetValue(key, out var folder))
                AddWithPath(folder.Key);
            else if (analysis.ConnectionsByKey.TryGetValue(key, out var connection) && connection.Candidate is not null)
                AddWithPath(connection.FolderKey);
        }

        return place;
    }

    /// <summary>
    /// RN-TRANSF-013: as proteções do item posto no lugar (as dele e as das pastas acima ali, RN-PROT-004), com o que valia na origem gravado nele quando ali
    /// valeria menos. Devolve as proteções que ele grava e o que a importação acrescentou (os campos nulos quando nada mudou).
    /// </summary>
    private static ((bool ReadOnly, string? ConfirmCommands) Record, Strengthening Strengthening) Strengthen(IReadOnlyDictionary<Guid, VaultFolderRecord> folders, Guid? parentID, bool readOnly, string? confirmCommands, ImportOrigin origin)
    {
        var there = ProtectionRules.Of(folders, parentID, readOnly, confirmCommands);
        var strengthening = Strengthening.None;

        if (origin.ReadOnly && !there.ReadOnly)
        {
            readOnly = true;
            strengthening = strengthening with { ReadOnly = true };
        }

        if (ProtectionRules.Rank(origin.ConfirmCommands) > ProtectionRules.Rank(there.ConfirmCommands))
        {
            confirmCommands = origin.ConfirmCommands;
            strengthening = strengthening with { ConfirmCommands = origin.ConfirmCommands };
        }

        return ((readOnly, confirmCommands), strengthening);
    }

    private static Dictionary<string, Guid> NamesIn(Dictionary<Guid, Dictionary<string, Guid>> names, Guid? parentID)
    {
        if (!names.TryGetValue(PlaceKey(parentID), out var inPlace))
            names[PlaceKey(parentID)] = inPlace = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);

        return inPlace;
    }

    private static HashSet<string> ConnectionNamesIn(Dictionary<Guid, HashSet<string>> names, Guid? folderID)
    {
        if (!names.TryGetValue(PlaceKey(folderID), out var inPlace))
            names[PlaceKey(folderID)] = inPlace = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        return inPlace;
    }
}

/// <summary>RN-TRANSF-012: a escolha única dos conflitos de nome de conexão. `rename` é o padrão.</summary>
internal enum EImportConflict
{
    Rename,
    Skip
}

/// <summary>O que a conta da RN-TRANSF-012 a 014 deu: o documento com o que entrou (o mesmo, quando nada entrou), onde ficou cada item e as contagens.</summary>
internal sealed class ImportPlacementResult
{
    public VaultDocument Document { get; set; } = null!;

    /// <summary>De cada pasta do arquivo que foi posta, pela chave: a pasta em que ela ficou (criada, ou a que já existia no lugar).</summary>
    public Dictionary<string, FolderPlacement> Folders { get; } = new(StringComparer.Ordinal);

    /// <summary>De cada conexão marcada, pela chave: a criada, com outro nome ou não, ou a que ficou de fora.</summary>
    public Dictionary<string, ConnectionPlacement> Connections { get; } = new(StringComparer.Ordinal);

    public List<Guid> CreatedFolderIDs { get; } = [];
    public List<Guid> CreatedConnectionIDs { get; } = [];

    /// <summary>As pastas do arquivo que entraram numa que já existia no lugar (ou numa irmã de mesmo nome do próprio arquivo).</summary>
    public int MergedFolders { get; set; }

    public int Renamed { get; set; }
    public int Skipped { get; set; }

    /// <summary>Os itens com a proteção ou o ambiente gravados pela importação (RN-TRANSF-013), para o log.</summary>
    public int Strengthened { get; set; }

    /// <summary>As conexões de consulta de verificação própria que entraram com ela, e as que entraram com a do banco (RN-TRANSF-011), para o log.</summary>
    public int QueriesKept { get; set; }
    public int QueriesReplaced { get; set; }

    public override string ToString()
        => nameof(ImportPlacementResult);
}

/// <param name="Merged">A pasta do arquivo entrou numa que já existia: o conteúdo vai para ela, e ela fica como estava.</param>
internal sealed record FolderPlacement(Guid ID, bool Merged, Strengthening Strengthening);

/// <param name="ID">A conexão criada; nula na que ficou de fora.</param>
/// <param name="Conflict">O nome dela já estava tomado no lugar.</param>
/// <param name="CopyName">O nome que ela recebe com "Importar com outro nome", quando o dela está tomado.</param>
internal sealed record ConnectionPlacement(Guid? ID, bool Conflict, string? CopyName, bool Skipped, Strengthening Strengthening)
{
    public override string ToString()
        => nameof(ConnectionPlacement);
}

/// <summary>RN-TRANSF-013: o que a importação grava no item para ele não ficar mais fraco que na origem, com os campos nulos quando nada muda.</summary>
internal sealed record Strengthening(bool? ReadOnly, string? ConfirmCommands, string? EnvironmentName, string? EnvironmentColor)
{
    public static readonly Strengthening None = new(null, null, null, null);

    public bool Any
        => ReadOnly is not null || ConfirmCommands is not null || EnvironmentName is not null;

    public override string ToString()
        => nameof(Strengthening);
}
