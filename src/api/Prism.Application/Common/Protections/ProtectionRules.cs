using FluentValidation;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Common.Protections;

/// <summary>
/// As proteções da conexão e da pasta (RN-PROT-001 a 004) são uma regra só, como o ambiente (`EnvironmentRules`): a lista da confirmação, a forma
/// gravada, a herança (vale a mais forte entre a própria e as das pastas acima) e quando uma alteração pede a senha do usuário (RN-PROT-003). Os
/// validators, os domínios, os repositories e as leituras das duas aplicam daqui. O código de erro é de quem valida (`CONNECTION_INVALID` na conexão,
/// `FOLDER_NAME_INVALID` na pasta), por isso fica fora.
/// </summary>
internal static class ProtectionRules
{
    public const string ConfirmNone = "none";
    public const string ConfirmIrreversible = "irreversible";
    public const string ConfirmAll = "all";

    /// <summary>RN-PROT-001: "Não", "Só comandos irreversíveis" e "Todos os comandos", da mais fraca para a mais forte.</summary>
    public static readonly IReadOnlyList<string> ConfirmLevels = [ConfirmNone, ConfirmIrreversible, ConfirmAll];

    public static IRuleBuilderOptions<T, string?> MustBeAConfirmation<T>(this IRuleBuilder<T, string?> rule)
        => rule.Must(ConfirmationIsValid).WithMessage("Escolha não confirmar, só os comandos irreversíveis ou todos os comandos.");

    /// <summary>Opcional: em branco é "Não". Quando vem, é um da lista, como está escrito (`none`, `irreversible` ou `all`).</summary>
    public static bool ConfirmationIsValid(string? confirmCommands)
        => string.IsNullOrWhiteSpace(confirmCommands) || ConfirmLevels.Contains(confirmCommands.Trim(), StringComparer.Ordinal);

    /// <summary>"Não" tem uma forma só, a nula: o branco e o `none` se gravam nulos, como o ícone padrão do script (RN-SCRIPT-006).</summary>
    public static string? NormalizeConfirmation(string? confirmCommands)
        => string.IsNullOrWhiteSpace(confirmCommands) || confirmCommands.Trim() == ConfirmNone ? null : confirmCommands.Trim();

    /// <summary>O somente leitura se grava verdadeiro ou nulo: o desmarcado tem uma forma só.</summary>
    public static bool? ToRecord(bool readOnly)
        => readOnly ? true : null;

    /// <summary>RN-PROT-004: as proteções que valem para a conexão, a dela e as das pastas acima dela.</summary>
    public static EffectiveProtections Of(VaultDocument document, VaultConnectionRecord connection)
        => Of(FoldersOf(document), connection.FolderID, connection.ReadOnly == true, connection.ConfirmCommands);

    /// <summary>RN-PROT-004: as proteções que valem para a pasta, a dela e as das pastas acima dela.</summary>
    public static EffectiveProtections Of(VaultDocument document, VaultFolderRecord folder)
        => Of(FoldersOf(document), folder.ParentID, folder.ReadOnly == true, folder.ConfirmCommands);

    /// <summary>
    /// RN-PROT-004: vale a mais forte. Sobe pelas pastas a partir de `folderID` (a da conexão, ou a pasta pai da pasta): o somente leitura vem da mais
    /// próxima que o tem, quando a própria não tem, e a confirmação, da mais próxima que tem a mais alta, quando ela é mais alta que a própria. A origem
    /// nula é a própria (ou nenhuma proteção). O registro das pastas visitadas limita a subida, como em `VaultFolders.IsSelfOrDescendant`: um documento
    /// com ciclo não prende a requisição.
    /// </summary>
    public static EffectiveProtections Of(IReadOnlyDictionary<Guid, VaultFolderRecord> folders, Guid? folderID, bool readOnly, string? confirmCommands)
    {
        Guid? readOnlyFolderID = null;
        var confirm = NormalizeConfirmation(confirmCommands);
        Guid? confirmFolderID = null;
        var visited = new HashSet<Guid>();
        var current = folderID;

        while (current is { } id && visited.Add(id) && folders.TryGetValue(id, out var folder))
        {
            if (!readOnly && folder.ReadOnly == true)
            {
                readOnly = true;
                readOnlyFolderID = folder.ID;
            }

            if (Rank(folder.ConfirmCommands) > Rank(confirm))
            {
                confirm = folder.ConfirmCommands;
                confirmFolderID = folder.ID;
            }

            current = folder.ParentID;
        }

        return new EffectiveProtections(readOnly, readOnlyFolderID, confirm, confirmFolderID);
    }

    /// <summary>
    /// RN-PROT-003: a alteração pede a senha do usuário? Pede quando o somente leitura próprio de uma pasta ou de uma conexão que já existia muda
    /// (marcar ou desmarcar), e quando uma conexão que já existia deixa de ser somente leitura por herança (mover a conexão, ou uma pasta acima dela,
    /// para fora de uma pasta somente leitura). Criar, duplicar, excluir e mover para dentro de uma pasta somente leitura não pedem.
    /// </summary>
    public static bool NeedsPassword(VaultDocument before, VaultDocument after)
    {
        var foldersBefore = FoldersOf(before);
        if (after.Folders.Any(folder => foldersBefore.TryGetValue(folder.ID, out var was) && (was.ReadOnly == true) != (folder.ReadOnly == true)))
            return true;

        var foldersAfter = FoldersOf(after);
        var connectionsBefore = before.Connections.ToDictionary(connection => connection.ID);

        foreach (var connection in after.Connections)
        {
            if (!connectionsBefore.TryGetValue(connection.ID, out var was))
                continue;

            if ((was.ReadOnly == true) != (connection.ReadOnly == true))
                return true;

            if (Of(foldersBefore, was.FolderID, was.ReadOnly == true, null).ReadOnly && !Of(foldersAfter, connection.FolderID, connection.ReadOnly == true, null).ReadOnly)
                return true;
        }

        return false;
    }

    public static IReadOnlyDictionary<Guid, VaultFolderRecord> FoldersOf(VaultDocument document)
        => document.Folders.ToDictionary(folder => folder.ID);

    /// <summary>RN-PROT-001 e 004: a força da confirmação, de "Não" (0) a "Todos os comandos" (2). Vale a mais forte; a importação a usa para não afrouxar (RN-TRANSF-013).</summary>
    public static int Rank(string? confirmCommands)
        => confirmCommands switch
        {
            ConfirmAll => 2,
            ConfirmIrreversible => 1,
            _ => 0
        };
}
