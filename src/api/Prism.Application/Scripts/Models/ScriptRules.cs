using Prism.Core.Extensions;
using System.Text;

namespace Prism.Application.Scripts.Models;

/// <summary>RN-SCRIPT-004 e RN-SCRIPT-006, num lugar só para a criação e a alteração: os validators e o domínio usam estas regras.</summary>
internal static class ScriptRules
{
    public const int MaxNameLength = 200;

    /// <summary>1 MB do SQL, em bytes de UTF-8 (1.048.576): a mesma conta que a tela faz antes de enviar.</summary>
    public const int MaxSqlBytes = 1024 * 1024;

    /// <summary>
    /// De 1 a 200 caracteres (unidades UTF-16, as do campo de texto) depois de normalizado, que é o que se grava, e nenhum caractere de controle no texto
    /// que veio: a tabulação e a quebra de linha também são recusadas, e não trocadas por espaço pela normalização.
    /// </summary>
    public static bool IsValidName(string? name)
        => name is not null && !name.Any(char.IsControl) && name.NormalizeName().Length is >= 1 and <= MaxNameLength;

    public static bool FitsTheLimit(string? sql)
        => sql is null || Encoding.UTF8.GetByteCount(sql) <= MaxSqlBytes;

    /// <summary>RN-SCRIPT-006: o ícone padrão, o documento de antes. Não se grava: o script com ele fica com o ícone nulo.</summary>
    public const string DefaultIcon = "document";

    /// <summary>
    /// RN-SCRIPT-006: a lista fechada dos ícones de um script, a mesma da tela (`scriptIcons`, em `saved-scripts.ts`), na mesma ordem. Ícone novo entra nas
    /// duas, e o que sai de uma lista não pode sair do cofre sem passar por aqui: o script gravado com ele voltaria recusado na próxima alteração.
    /// </summary>
    public static readonly IReadOnlyList<string> Icons = [DefaultIcon, "code", "database", "table", "chart", "clock", "lightning", "bug", "wrench", "star", "flag"];

    /// <summary>Em branco é o ícone padrão; fora disso, um da lista, como a tela o manda (minúsculas, sem espaço). Quem não manda o campo não passa por aqui.</summary>
    public static bool IsKnownIcon(string? icon)
        => string.IsNullOrWhiteSpace(icon) || Icons.Contains(icon.Trim(), StringComparer.Ordinal);

    /// <summary>O ícone como se grava: o padrão e o em branco são nulos, e o resto vai aparado.</summary>
    public static string? NormalizeIcon(string? icon)
        => string.IsNullOrWhiteSpace(icon) || icon.Trim() == DefaultIcon ? null : icon.Trim();
}
