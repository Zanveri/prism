using FluentValidation;
using Prism.Application.Common.Texts;
using Prism.Core.Extensions;
using Prism.Infrastructure.Vault.Models;

namespace Prism.Application.Common.Environments;

/// <summary>
/// O ambiente (nome e cor) da conexão (RN-CONN-010) e da pasta (RN-PASTA-005) é uma regra só: o limite, o formato, a mensagem e a normalização moram
/// aqui, e os validators e os domínios das duas a aplicam daqui, sem repetir. O código de erro é de quem valida (`CONNECTION_INVALID` na conexão,
/// `FOLDER_NAME_INVALID` na pasta), por isso fica fora. A regra da cor vale também para a cor da pasta (RN-PASTA-007) e para a do ícone do script
/// (RN-SCRIPT-006): é a mesma `#RRGGBB`, com a mesma normalização.
/// </summary>
internal static class EnvironmentRules
{
    /// <summary>RN-CONN-010: o nome do ambiente tem até 30 caracteres, medidos depois de normalizado.</summary>
    public const int NameMaxLength = 30;

    public static IRuleBuilderOptions<T, string?> MustBeAnEnvironmentName<T>(this IRuleBuilder<T, string?> rule)
        => rule.MustPass(NameRefusal);

    public static IRuleBuilderOptions<T, string?> MustBeAnEnvironmentColor<T>(this IRuleBuilder<T, string?> rule)
        => rule.MustPass(ColorRefusal);

    /// <summary>Opcional: em branco é "sem ambiente".</summary>
    public static bool NameIsValid(string? environmentName)
        => NameRefusal(environmentName) is null;

    /// <summary>
    /// Por que o nome do ambiente não serve, ou nulo quando serve: até 30 caracteres e, desde a seção 34 (RN-PASTA-001 e RN-CONN-010), sem caractere de
    /// controle nem de direção do texto, os dois depois de normalizado. A mesma frase no formulário da conexão, no da pasta e na importação (RN-TRANSF-014).
    /// </summary>
    public static string? NameRefusal(string? environmentName)
    {
        var normalized = environmentName.NormalizeName();
        if (normalized.Length > NameMaxLength)
            return "O ambiente pode ter no máximo 30 caracteres.";

        return TextRules.HasControlOrDirection(normalized) ? "O ambiente não pode ter caractere de controle nem de direção do texto." : null;
    }

    public static string? ColorRefusal(string? color)
        => ColorIsValid(color) ? null : "Use uma cor no formato #RRGGBB.";

    /// <summary>Opcional: em branco é "sem cor". Quando vem, é `#RRGGBB`.</summary>
    public static bool ColorIsValid(string? environmentColor)
    {
        if (string.IsNullOrWhiteSpace(environmentColor))
            return true;

        var color = environmentColor.Trim();

        return color.Length == 7 && color[0] == '#' && color.Skip(1).All(char.IsAsciiHexDigit);
    }

    /// <summary>O ambiente é opcional: em branco é "sem ambiente", e não um nome vazio.</summary>
    public static string? NormalizeName(string? environmentName)
        => string.IsNullOrWhiteSpace(environmentName) ? null : environmentName.NormalizeName();

    /// <summary>A cor é aparada e guardada com as letras como vieram.</summary>
    public static string? NormalizeColor(string? environmentColor)
        => string.IsNullOrWhiteSpace(environmentColor) ? null : environmentColor.Trim();

    /// <summary>
    /// RN-PASTA-005: o ambiente que a conexão mostra. O próprio sempre ganha; sem ele, o da pasta mais próxima acima que tenha um (só o nome faz um ambiente:
    /// a cor sozinha não conta, e a pasta só com cor passa adiante o de cima). É a herança que a tela aplica (`environmentLookup`), e que a exportação grava
    /// no `effective` da conexão e a importação confere no lugar escolhido (RN-TRANSF-006 e 013). Nulo é "sem ambiente".
    /// </summary>
    public static ShownEnvironment? ShownBy(IReadOnlyDictionary<Guid, VaultFolderRecord> folders, Guid? folderID, string? environmentName, string? environmentColor)
        => string.IsNullOrEmpty(environmentName) ? InheritedIn(folders, folderID) : new ShownEnvironment(environmentName, environmentColor);

    /// <summary>
    /// RN-PASTA-005: o que uma conexão sem ambiente próprio herda na pasta `folderID` (nula é a raiz, que não dá nada): o ambiente da pasta mais próxima, a
    /// partir dela e subindo, que tenha um. O registro das visitadas limita a subida, como nas proteções (`ProtectionRules.Of`).
    /// </summary>
    public static ShownEnvironment? InheritedIn(IReadOnlyDictionary<Guid, VaultFolderRecord> folders, Guid? folderID)
    {
        var visited = new HashSet<Guid>();
        var current = folderID;

        while (current is { } id && visited.Add(id) && folders.TryGetValue(id, out var folder))
        {
            if (!string.IsNullOrEmpty(folder.EnvironmentName))
                return new ShownEnvironment(folder.EnvironmentName, folder.EnvironmentColor);

            current = folder.ParentID;
        }

        return null;
    }
}

/// <summary>RN-PASTA-005: o ambiente que uma conexão mostra numa etiqueta, o nome e a cor (que pode faltar).</summary>
internal sealed record ShownEnvironment(string Name, string? Color);
