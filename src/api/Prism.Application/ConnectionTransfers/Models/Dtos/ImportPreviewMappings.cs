using Prism.Application.Common.Texts;
using Prism.Application.Connections.Models;

namespace Prism.Application.ConnectionTransfers.Models.Dtos;

/// <summary>
/// RN-TRANSF-011: a prévia, montada da conferência do arquivo (`ImportAnalysis`) e da conta de onde cada item fica (`ImportPlacement`, com tudo o que pode
/// ser importado marcado). O item que pode ser importado vem como seria gravado; o que não pode, como veio no arquivo, com cada texto cortado em 200
/// caracteres, e o campo do tipo errado nulo. A senha de banco não sai daqui: só `HasPassword`.
/// </summary>
internal static class ImportPreviewMappings
{
    public static ImportPreviewDto ToDto(ImportAnalysis analysis, ImportPlacementResult placement)
        => new()
        {
            Folders = [.. analysis.Folders.Select(folder => ToDto(folder, placement))],
            Connections = [.. analysis.Connections.Select(connection => ToDto(connection, placement))]
        };

    private static ImportPreviewFolderDto ToDto(ImportFolderItem folder, ImportPlacementResult placement)
    {
        if (folder.Candidate is not { } candidate || !placement.Folders.TryGetValue(folder.Key, out var placed))
        {
            var raw = folder.Raw;

            return new ImportPreviewFolderDto
            {
                Key = folder.Key,
                ParentKey = folder.ParentKey,
                Name = Cut(raw.Name),
                Color = Cut(raw.Color),
                EnvironmentName = Cut(raw.EnvironmentName),
                EnvironmentColor = Cut(raw.EnvironmentColor),
                ConfirmCommands = Cut(raw.ConfirmCommands),
                ReadOnly = raw.ReadOnly.IsMissing ? false : raw.ReadOnly.Boolean,
                Invalid = folder.Invalid
            };
        }

        return new ImportPreviewFolderDto
        {
            Key = folder.Key,
            ParentKey = folder.ParentKey,
            Name = candidate.Name,
            Color = candidate.Color,
            EnvironmentName = candidate.EnvironmentName,
            EnvironmentColor = candidate.EnvironmentColor,
            ConfirmCommands = candidate.ConfirmCommands,
            ReadOnly = candidate.ReadOnly,
            Existing = placed.Merged,
            Strengthened = ToDto(placed.Strengthening)
        };
    }

    private static ImportPreviewConnectionDto ToDto(ImportConnectionItem connection, ImportPlacementResult placement)
    {
        if (connection.Candidate is not { } candidate || !placement.Connections.TryGetValue(connection.Key, out var placed))
        {
            var raw = connection.Raw;

            return new ImportPreviewConnectionDto
            {
                Key = connection.Key,
                FolderKey = connection.FolderKey,
                Name = Cut(raw.Name),
                Engine = ImportAnalysis.EngineOf(raw.Engine),
                Host = Cut(raw.Host),
                Port = raw.Port.Integer,
                Database = Cut(raw.Database),
                UserName = Cut(raw.UserName) ?? string.Empty,
                HasPassword = raw.Password is { IsText: true, Text.Length: > 0 },
                VerificationEnabled = raw.VerificationEnabled.IsMissing ? true : raw.VerificationEnabled.Boolean,
                VerificationInterval = raw.VerificationInterval.IsMissing ? ConnectionRules.VerificationIntervalDefault : raw.VerificationInterval.Integer,
                VerificationQuery = raw.VerificationQuery is { IsText: true } query && !string.IsNullOrWhiteSpace(query.Text) ? Cut(query) : null,
                Invalid = connection.Invalid
            };
        }

        var origin = connection.Origin!;

        return new ImportPreviewConnectionDto
        {
            Key = connection.Key,
            FolderKey = connection.FolderKey,
            Name = candidate.Name,
            Engine = candidate.Engine,
            Host = candidate.Host,
            Port = candidate.Port,
            Database = candidate.Database,
            UserName = candidate.UserName,
            HasPassword = candidate.Password.Length > 0,
            VerificationEnabled = candidate.VerificationEnabled,
            VerificationInterval = candidate.VerificationInterval,
            VerificationQuery = candidate.VerificationQuery,
            Effective = new ImportEffectiveDto { ReadOnly = origin.ReadOnly, ConfirmCommands = origin.ConfirmCommands, EnvironmentName = origin.Environment?.Name, EnvironmentColor = origin.Environment?.Color },
            Conflict = placed.Conflict,
            CopyName = placed.CopyName,
            Strengthened = ToDto(placed.Strengthening)
        };
    }

    private static ImportStrengthenedDto ToDto(Strengthening strengthening)
        => new() { ReadOnly = strengthening.ReadOnly, ConfirmCommands = strengthening.ConfirmCommands, EnvironmentName = strengthening.EnvironmentName, EnvironmentColor = strengthening.EnvironmentColor };

    /// <summary>O texto do item que não pode ser importado, cortado em 200 caracteres; nulo quando o campo não veio ou não é texto.</summary>
    private static string? Cut(FileValue value)
        => value.IsText ? TextRules.Cut(value.Text!, TransferLimits.InvalidTextLength) : null;
}
