using CSharpFunctionalExtensions;
using Prism.Application.Common.Environments;
using Prism.Application.Common.Protections;
using Prism.Infrastructure.Databases.Models;
using Prism.Infrastructure.Journal.Models;
using Prism.Infrastructure.Vault.Models;
using Prism.Infrastructure.Vault.Services;

namespace Prism.Application.Journal;

/// <summary>
/// RN-AUDIT-001 e RN-PASTA-005: monta o retrato da conexão e o resumo das proteções efetivas (próprias ou herdadas da pasta) no instante da operação.
/// </summary>
public static class JournalSnapshots
{
    public static (JournalConnectionSnapshot Connection, string? Protections) FromVault(IVaultService? vault, Guid? connectionID, DatabaseSessionInfo? session = null, bool? readOnlyFallback = null)
    {
        var effectiveConnectionID = connectionID ?? session?.ConnectionID;
        if (vault is not null && effectiveConnectionID is { } id)
        {
            var read = vault.Read();
            if (read.IsSuccess && read.Value is { } document && document.Connections.FirstOrDefault(connection => connection.ID == id) is { } record)
                return FromDocument(document, record, session?.Database);
        }

        if (session is not null)
        {
            var fallbackProtections = readOnlyFallback is { } ro ? $"Confirmar: não · Somente leitura: {(ro ? "sim" : "não")}" : null;

            return (new JournalConnectionSnapshot(session.ConnectionID, null, EngineName(session.Engine), null, null, null, session.Database), fallbackProtections);
        }

        var readOnlyProtections = readOnlyFallback is { } readOnly ? $"Confirmar: não · Somente leitura: {(readOnly ? "sim" : "não")}" : null;

        return (new JournalConnectionSnapshot(effectiveConnectionID, null, null, null, null, null, null), readOnlyProtections);
    }

    public static (JournalConnectionSnapshot? Connection, string? Protections) FromVault(Result<VaultDocument, EVaultError> read, Guid? connectionID, string? databaseOverride = null)
    {
        if (connectionID is { } id && read.IsSuccess && read.Value is { } document && document.Connections.FirstOrDefault(connection => connection.ID == id) is { } record)
            return FromDocument(document, record, databaseOverride);

        return (connectionID is { } fallbackID ? new JournalConnectionSnapshot(fallbackID, null, null, null, null, null, databaseOverride) : null, null);
    }

    public static (JournalConnectionSnapshot Connection, string Protections) FromRecord(IVaultService? vault, VaultConnectionRecord record, string? databaseOverride = null)
    {
        if (vault is not null)
        {
            var read = vault.Read();
            if (read.IsSuccess && read.Value is { } document)
                return FromDocument(document, record, databaseOverride);
        }

        return FromDocument(new VaultDocument { Connections = [record] }, record, databaseOverride);
    }

    public static (JournalConnectionSnapshot Connection, string Protections) FromDocument(VaultDocument document, VaultConnectionRecord record, string? databaseOverride = null)
    {
        var folders = ProtectionRules.FoldersOf(document);
        var environment = EnvironmentRules.ShownBy(folders, record.FolderID, record.EnvironmentName, record.EnvironmentColor);
        var protections = ProtectionRules.Of(folders, record.FolderID, record.ReadOnly == true, record.ConfirmCommands);
        var folderPath = BuildFolderPath(document.Folders, record.FolderID);
        var snapshot = new JournalConnectionSnapshot(record.ID, record.Name, EngineName(record.Engine), folderPath, environment?.Name, environment?.Color, databaseOverride ?? record.Database);

        return (snapshot, ProtectionsText(protections));
    }

    public static string EngineName(EDatabaseEngine engine)
        => engine switch
        {
            EDatabaseEngine.PostgreSql => "PostgreSQL",
            EDatabaseEngine.Db2 => "Db2",
            EDatabaseEngine.Informix => "Informix",
            EDatabaseEngine.Sqlite => "SQLite",
            EDatabaseEngine.MySql => "MySQL",
            EDatabaseEngine.MariaDb => "MariaDB",
            EDatabaseEngine.SqlServer => "Microsoft SQL Server",
            EDatabaseEngine.Oracle => "Oracle",
            EDatabaseEngine.Firebird => "Firebird",
            EDatabaseEngine.DuckDb => "DuckDB",
            EDatabaseEngine.ClickHouse => "ClickHouse",
            EDatabaseEngine.BigQuery => "Google BigQuery",
            EDatabaseEngine.Databricks => "Databricks",
            _ => engine.ToString()
        };

    internal static string ProtectionsText(EffectiveProtections protections)
    {
        var confirm = protections.ConfirmCommands switch
        {
            "all" => "todos os comandos",
            "irreversible" => "só irreversíveis",
            _ => "não"
        };

        return $"Confirmar: {confirm} · Somente leitura: {(protections.ReadOnly ? "sim" : "não")}";
    }

    private static string? BuildFolderPath(IReadOnlyCollection<VaultFolderRecord> folders, Guid? folderID)
    {
        if (folderID is null || folders.Count == 0)
            return null;

        var byID = folders.ToDictionary(folder => folder.ID);
        var visited = new HashSet<Guid>();
        var names = new List<string>();
        var current = folderID;

        while (current is { } id && visited.Add(id) && byID.TryGetValue(id, out var folder))
        {
            names.Add(folder.Name);
            current = folder.ParentID;
        }

        if (names.Count == 0)
            return null;

        names.Reverse();

        return string.Join(" / ", names);
    }
}
