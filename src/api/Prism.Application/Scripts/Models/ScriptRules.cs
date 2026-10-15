using Prism.Core.Extensions;
using System.Text;

namespace Prism.Application.Scripts.Models;

/// <summary>RN-SCRIPT-004, num lugar só para a criação e a alteração: os dois validators usam estas regras.</summary>
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
}
