using Prism.Application.ConnectionTransfers.Models;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.DbeaverImports.Models;

/// <summary>
/// RN-DBEAVER-016 e 017: onde o que veio do DBeaver fica, contra um documento do cofre. É a conta do "Importar conexões" (`ImportPlacement`, RN-TRANSF-012 a 014) com a
/// reimportação por cima: a conexão marcada que já existe (a mesma origem) é sobrescrita quando a chave dela está em `overwriteKeys`, e fica como está, sem ser
/// importada nem tocada, quando não está; a de chave em `overwriteKeys` que não está mais no cofre (outra janela a excluiu) é uma conexão nova. As conexões criadas guardam
/// a origem (RN-DBEAVER-018). Roda dentro da gravação, com o cofre reservado, contra o documento mais recente.
/// </summary>
internal static class DbeaverPlacement
{
    public static DbeaverPlacementResult Apply(VaultDocument document, Guid? targetFolderID, ImportAnalysis analysis, DbeaverAssembly assembly, IReadOnlySet<string> selected, IReadOnlySet<string> overwriteKeys, EImportConflict onConflict, DateTime now)
    {
        var index = DbeaverReimport.Index(document);
        var connections = document.Connections.ToList();
        var positions = connections.Select((record, position) => (record.ID, position)).ToDictionary(entry => entry.ID, entry => entry.position);
        var updatedIDs = new List<Guid>();
        var kept = 0;

        // As pastas marcadas vão como estão; as conexões se dividem em novas (a colocação normal), sobrescritas e as que já existem e ficam como estão.
        var forPlacement = new HashSet<string>(selected.Where(analysis.FoldersByKey.ContainsKey), StringComparer.Ordinal);

        foreach (var item in analysis.Connections.Where(item => item.Candidate is not null && selected.Contains(item.Key)))
        {
            var dbeaver = assembly.Items[item.Key];
            if (!index.TryGetValue(DbeaverReimport.OriginKey(dbeaver.ProjectName, dbeaver.Model.ID), out var existing))
            {
                forPlacement.Add(item.Key);

                continue;
            }

            if (!overwriteKeys.Contains(item.Key))
            {
                kept++;

                continue;
            }

            var current = connections[positions[existing.ID]];
            var nameTaken = connections.Any(other => other.ID != current.ID && other.FolderID == current.FolderID && string.Equals(other.Name, item.Candidate!.Name, StringComparison.OrdinalIgnoreCase));
            var plan = DbeaverReimport.Plan(current, item.Candidate!, item.Origin!, dbeaver.DrdaPort is not null, nameTaken, now);

            connections[positions[current.ID]] = plan.Updated;
            updatedIDs.Add(current.ID);
        }

        var overwritten = updatedIDs.Count == 0 ? document : document with { Connections = connections };
        var placed = ImportPlacement.Place(overwritten, targetFolderID, analysis, forPlacement, onConflict, keepVerificationQueries: false, now);

        // RN-DBEAVER-018: a conexão criada guarda de onde veio.
        var origins = analysis.Connections
            .Where(item => placed.Connections.TryGetValue(item.Key, out var placement) && placement.ID is not null)
            .ToDictionary(item => placed.Connections[item.Key].ID!.Value, item => new VaultConnectionOrigin(VaultConnectionOrigin.DbeaverSource, assembly.Items[item.Key].ProjectName, assembly.Items[item.Key].Model.ID));

        var withOrigin = origins.Count == 0
            ? placed.Document
            : placed.Document with { Connections = [.. placed.Document.Connections.Select(record => origins.TryGetValue(record.ID, out var origin) ? record with { Origin = origin } : record)] };

        // Na mesma gravação, a data da importação e o convite feito; sem nada criado nem atualizado, nada é gravado (a mesma instância).
        var changed = placed.CreatedFolderIDs.Count > 0 || placed.CreatedConnectionIDs.Count > 0 || updatedIDs.Count > 0;

        return new DbeaverPlacementResult(changed ? DbeaverState.Imported(withOrigin, now) : document, placed, updatedIDs, kept);
    }
}

/// <summary>O que a gravação deu: o documento (o mesmo, quando nada entrou nem foi atualizado), a colocação das conexões novas, os IDs das sobrescritas e quantas já existiam e ficaram como estão.</summary>
internal sealed record DbeaverPlacementResult(VaultDocument Document, ImportPlacementResult Placed, IReadOnlyList<Guid> UpdatedIDs, int Kept)
{
    public override string ToString()
        => nameof(DbeaverPlacementResult);
}
