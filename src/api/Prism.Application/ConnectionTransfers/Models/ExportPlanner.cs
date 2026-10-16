using CSharpFunctionalExtensions;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Application.Connections.Models;
using Prism.Application.Folders.Models;
using Prism.Core.Api.Models.Dtos;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.ConnectionTransfers.Models;

/// <summary>
/// RN-TRANSF-005 e 006: o que vai no arquivo da exportação, a partir de UM documento do cofre (o daquele instante, ou o que a conferência da senha do Prism
/// devolveu). `Plan` confere o pedido nele (o que foi marcado e não existe mais, as contagens e os níveis) e diz se a senha do Prism é pedida; `Build` monta o
/// conteúdo. Nada aqui grava o cofre.
/// </summary>
internal static class ExportPlanner
{
    /// <summary>
    /// A pasta ou a conexão marcada que não existe mais (outra janela a excluiu) é 404, e não é pulada em silêncio. As pastas que vão são as marcadas e as do
    /// caminho de cada pasta e de cada conexão marcada até a raiz do navegador, marcadas ou não, cada uma uma vez; as contagens (2.000 conexões e 2.000
    /// pastas) e os níveis (32, contados da raiz do navegador) são os da importação (`EXPORT_LIMITS_EXCEEDED`). A senha do Prism é pedida quando ao menos uma
    /// conexão vai com "Usuário e senha" e tem usuário e senha gravados (RN-TRANSF-005): a que não tem senha leva só o usuário, e a sem usuário não leva nada.
    /// </summary>
    public static Result<ExportPlan, ApiErrorDto> Plan(VaultDocument document, IReadOnlyList<Guid> folderIDs, IReadOnlyList<ExportChoice> choices)
    {
        var folders = document.Folders.ToDictionary(folder => folder.ID);
        var connections = document.Connections.ToDictionary(connection => connection.ID);

        if (folderIDs.Where(id => !folders.ContainsKey(id)).Select(id => (Guid?)id).FirstOrDefault() is { } missingFolder)
            return FolderErrors.NotFound(missingFolder);

        if (choices.FirstOrDefault(choice => !connections.ContainsKey(choice.ID)) is { } missingConnection)
            return ConnectionErrors.NotFound(missingConnection.ID);

        var included = new HashSet<Guid>();
        void AddWithPath(Guid? id)
        {
            while (id is { } folderID && folders.TryGetValue(folderID, out var folder) && included.Add(folderID))
                id = folder.ParentID;
        }

        foreach (var id in folderIDs)
            AddWithPath(id);

        var chosen = choices.Select(choice => (Record: connections[choice.ID], choice.Credentials)).ToList();
        foreach (var (record, _) in chosen)
            AddWithPath(record.FolderID);

        var depths = new Dictionary<Guid, int>();
        if (included.Count > TransferLimits.MaxFolders || chosen.Count > TransferLimits.MaxConnections || included.Any(id => Depth(folders, id, depths) > TransferLimits.MaxDepth))
            return TransferErrors.ExportLimitsExceeded();

        var needsUserPassword = chosen.Any(choice => choice.Credentials == ETransferCredentials.UserAndPassword && !string.IsNullOrWhiteSpace(choice.Record.UserName) && !string.IsNullOrEmpty(choice.Record.Password));

        var orderedFolders = InTreeOrder(folders, included);
        var position = orderedFolders.Select((folder, index) => (folder.ID, index)).ToDictionary(entry => entry.ID, entry => entry.index);
        var orderedConnections = chosen
            .OrderBy(choice => choice.Record.FolderID is { } folderID && position.TryGetValue(folderID, out var index) ? index + 1 : 0)
            .ThenBy(choice => choice.Record.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(choice => choice.Record.ID)
            .ToList();

        return new ExportPlan(orderedFolders, orderedConnections, needsUserPassword);
    }

    /// <summary>
    /// RN-TRANSF-006 e 007: o conteúdo do arquivo. Da pasta, o nome, a cor, o ambiente dela, as proteções dela e as que valem nela; da conexão, o banco pelo
    /// nome, o host, a porta, o banco de dados, o usuário e a senha conforme a escolha (o que não vai não aparece), o ambiente dela, as proteções dela, a
    /// verificação e o que vale nela (as proteções e o ambiente que ela mostra, próprio ou herdado). Os valores vão como o cofre os guarda: o item gravado
    /// antes das regras novas com um valor que elas recusam vai assim mesmo, e a importação o mostra como não importável (RN-TRANSF-014). Não vão os IDs do
    /// cofre (o arquivo tem chaves próprias, `f1`, `c1`…), as datas, os scripts, as abas, as preferências, o nome do usuário do Prism, as sessões e os drivers.
    /// </summary>
    public static ExportBuild Build(VaultDocument document, ExportPlan plan)
    {
        var folders = ProtectionRules.FoldersOf(document);
        var keys = plan.Folders.Select((folder, index) => (folder.ID, Key: $"f{index + 1}")).ToDictionary(entry => entry.ID, entry => entry.Key);

        var fileFolders = plan.Folders.Select(folder =>
        {
            var effective = ProtectionRules.Of(folders, folder.ParentID, folder.ReadOnly == true, folder.ConfirmCommands);

            return new TransferFileFolder(keys[folder.ID], ParentKeyOf(keys, folder.ParentID), folder.Name, folder.Color, folder.EnvironmentName, folder.EnvironmentColor, ProtectionRules.NormalizeConfirmation(folder.ConfirmCommands), folder.ReadOnly == true, new TransferFolderEffective(effective.ReadOnly, effective.ConfirmCommands));
        }).ToList();

        var fileConnections = plan.Connections.Select((choice, index) =>
        {
            var record = choice.Record;
            var hasUser = !string.IsNullOrWhiteSpace(record.UserName);
            var userName = choice.Credentials != ETransferCredentials.None && hasUser ? record.UserName : null;
            var password = choice.Credentials == ETransferCredentials.UserAndPassword && hasUser && !string.IsNullOrEmpty(record.Password) ? record.Password : null;
            var protections = ProtectionRules.Of(folders, record.FolderID, record.ReadOnly == true, record.ConfirmCommands);
            var environment = EnvironmentRules.ShownBy(folders, record.FolderID, record.EnvironmentName, record.EnvironmentColor);

            return new TransferFileConnection(
                $"c{index + 1}", ParentKeyOf(keys, record.FolderID), record.Name, record.Engine.ToString(), record.Host, record.Port, record.Database, userName, password,
                record.EnvironmentName, record.EnvironmentColor, ProtectionRules.NormalizeConfirmation(record.ConfirmCommands), record.ReadOnly == true,
                record.VerificationEnabled ?? true, record.VerificationInterval ?? ConnectionRules.VerificationIntervalDefault, record.VerificationQuery,
                new TransferConnectionEffective(protections.ReadOnly, protections.ConfirmCommands, environment?.Name, environment?.Color));
        }).ToList();

        return new ExportBuild(
            new TransferFileContent(fileFolders, fileConnections),
            fileFolders.Count,
            fileConnections.Count,
            fileConnections.Count(connection => connection.UserName is not null),
            fileConnections.Count(connection => connection.Password is not null),
            [.. plan.Folders.Select(folder => folder.ID)],
            [.. plan.Connections.Select(choice => choice.Record.ID)]);
    }

    /// <summary>A chave da pasta de cima no arquivo; nula é a raiz (e a pasta cujo pai sumiu do cofre, que não deveria existir, vai para a raiz do arquivo).</summary>
    private static string? ParentKeyOf(IReadOnlyDictionary<Guid, string> keys, Guid? parentID)
        => parentID is { } id && keys.TryGetValue(id, out var key) ? key : null;

    /// <summary>
    /// O nível da pasta a partir da raiz do navegador (a da raiz é o 1). Cada caminho sobe até uma pasta de nível já conhecido, e os níveis do caminho são
    /// guardados na volta: o cofre não limita a profundidade (RN-PASTA-001), e 2.000 pastas não custam a profundidade de cada uma. O registro das visitadas
    /// limita a subida, como em `VaultFolders.IsSelfOrDescendant`: um documento com ciclo (que o cofre não deixa existir) não prende a requisição.
    /// </summary>
    private static int Depth(IReadOnlyDictionary<Guid, VaultFolderRecord> folders, Guid folderID, Dictionary<Guid, int> depths)
    {
        var path = new List<Guid>();
        var visited = new HashSet<Guid>();
        Guid? current = folderID;

        while (current is { } id && !depths.ContainsKey(id) && visited.Add(id) && folders.TryGetValue(id, out var folder))
        {
            path.Add(id);
            current = folder.ParentID;
        }

        var depth = current is { } known && depths.TryGetValue(known, out var knownDepth) ? knownDepth : 0;
        for (var index = path.Count - 1; index >= 0; index--)
            depths[path[index]] = ++depth;

        return depths[folderID];
    }

    /// <summary>As pastas que vão na ordem da árvore do navegador: cada uma antes do que está dentro dela, e as irmãs pelo nome (sem diferenciar maiúsculas) e pelo ID.</summary>
    private static List<VaultFolderRecord> InTreeOrder(IReadOnlyDictionary<Guid, VaultFolderRecord> folders, HashSet<Guid> included)
    {
        var children = included
            .Select(id => folders[id])
            .GroupBy(folder => folder.ParentID is { } parent && included.Contains(parent) ? parent : Guid.Empty)
            .ToDictionary(group => group.Key, group => group.OrderBy(folder => folder.Name, StringComparer.OrdinalIgnoreCase).ThenBy(folder => folder.ID).ToList());

        var ordered = new List<VaultFolderRecord>(included.Count);
        var pending = new Stack<VaultFolderRecord>(Enumerable.Reverse(children.GetValueOrDefault(Guid.Empty) ?? []));

        while (pending.TryPop(out var folder))
        {
            ordered.Add(folder);
            foreach (var child in Enumerable.Reverse(children.GetValueOrDefault(folder.ID) ?? []))
                pending.Push(child);
        }

        return ordered;
    }
}

/// <summary>RN-TRANSF-003: a conexão marcada e o que vai dela.</summary>
internal sealed record ExportChoice(Guid ID, ETransferCredentials Credentials);

/// <summary>O que vai no arquivo, já conferido num documento: as pastas na ordem da árvore e as conexões com a escolha de cada uma.</summary>
internal sealed record ExportPlan(IReadOnlyList<VaultFolderRecord> Folders, IReadOnlyList<(VaultConnectionRecord Record, ETransferCredentials Credentials)> Connections, bool NeedsUserPassword)
{
    public override string ToString()
        => nameof(ExportPlan);
}

/// <summary>O conteúdo do arquivo e as contagens da resposta e do log (RN-TRANSF-008): as pastas (as do caminho contam), as conexões, quantas levam o usuário e quantas levam a senha, e os IDs do cofre do que foi.</summary>
internal sealed record ExportBuild(TransferFileContent Content, int Folders, int Connections, int WithUser, int WithPassword, IReadOnlyList<Guid> FolderIDs, IReadOnlyList<Guid> ConnectionIDs)
{
    public override string ToString()
        => nameof(ExportBuild);
}
