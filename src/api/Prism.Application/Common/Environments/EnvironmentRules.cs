using FluentValidation;
using Prism.Core.Extensions;

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
        => rule.Must(NameIsValid).WithMessage("O ambiente pode ter no máximo 30 caracteres.");

    public static IRuleBuilderOptions<T, string?> MustBeAnEnvironmentColor<T>(this IRuleBuilder<T, string?> rule)
        => rule.Must(ColorIsValid).WithMessage("Use uma cor no formato #RRGGBB.");

    /// <summary>Opcional: em branco é "sem ambiente".</summary>
    public static bool NameIsValid(string? environmentName)
        => environmentName.NormalizeName().Length <= NameMaxLength;

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
}
